import { Hono } from "hono";
import { routeAgentRequest } from "agents";
import { z } from "zod";
import type { Env } from "./types";
import type { CallLogStore } from "./call-log-store";

const app = new Hono<{ Bindings: Env }>();

// Escape a string for safe inclusion in XML/TwiML.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const CollectInfoSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  reason: z.string(),
  notes: z.string().optional(),
  callSid: z.string(),
  timestamp: z.string(),
});

function requireApiKey(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
  const expected = c.env.LOGS_API_KEY?.trim();
  if (!expected) throw new Error("LOGS_API_KEY is not configured");
  const provided = c.req.header("authorization") ?? "";
  const m = provided.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1] ?? provided;
  if (!token || token !== expected) throw new Error("Unauthorized");
}

app.get("/", (c) => c.json({ name: "phoneline", status: "ok" }));

// Optional but useful for testing: accept collect_info payloads and persist them
// so you can fetch a call log later.
app.all("/webhook/collect-info", async (c) => {
  if (c.req.method !== "POST" && c.req.method !== "GET") return c.text("", 404);
  try {
    requireApiKey(c);
  } catch (e) {
    return c.text("Unauthorized", 401);
  }

  if (c.req.method === "GET") {
    return c.json({ ok: true, usage: "POST a CollectInfoPayload" });
  }

  const body = await c.req.json().catch(() => null);
  const parsed = CollectInfoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  }

  const payload = parsed.data;

  const store = c.env.CallLogStore.get(
    c.env.CallLogStore.idFromName("singleton")
  ) as DurableObjectStub<CallLogStore>;

  await store.recordCollectInfo(payload);
  return c.json({ ok: true });
});

// Secure endpoint to view what happened for a given callSid.
app.get("/call-log/:callSid", async (c) => {
  try {
    requireApiKey(c);
  } catch {
    return c.text("Unauthorized", 401);
  }

  const callSid = c.req.param("callSid");
  const store = c.env.CallLogStore.get(
    c.env.CallLogStore.idFromName("singleton")
  ) as DurableObjectStub<CallLogStore>;

  const log = await store.getCallLog(callSid);
  return c.json(log);
});

// Twilio webhook — called when a phone number receives an incoming call.
// Returns TwiML that opens a bidirectional media stream to the voice agent.
// Accept GET too so local probes (or misconfigured webhook methods) still
// return valid TwiML.
app.all("/twiml", async (c) => {
  const body = await c.req.text();
  const params = Object.fromEntries(new URLSearchParams(body));
  const callSid = escapeXml(params["CallSid"] ?? "unknown");
  const from = escapeXml(params["From"] ?? "");
  const to = escapeXml(params["To"] ?? "");
  const host = escapeXml(c.req.header("host")!);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/agents/voice-agent/${callSid}/media-stream">
      <Parameter name="CallSid" value="${callSid}" />
      <Parameter name="From" value="${from}" />
      <Parameter name="To" value="${to}" />
    </Stream>
  </Connect>
</Response>`;

  return c.body(twiml, 200, { "Content-Type": "text/xml" });
});

// Route all agent WebSocket + HTTP traffic to Durable Objects.
app.all("/agents/*", async (c) => {
  const res = await routeAgentRequest(c.req.raw, c.env);
  return res ?? c.notFound();
});

export default app;
export { VoiceAgent } from "./agent";
export { CallLogStore } from "./call-log-store";
