import { Hono } from "hono";
import { routeAgentRequest } from "agents";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.json({ name: "phoneline", status: "ok" }));

/**
 * Twilio webhook — called when a phone number receives an incoming call.
 * Returns TwiML that opens a bidirectional media stream to the voice agent.
 */
app.post("/twiml", async (c) => {
  const body = await c.req.text();
  const params = Object.fromEntries(new URLSearchParams(body));
  const callSid = params["CallSid"] ?? "unknown";
  const from = params["From"] ?? "";
  const to = params["To"] ?? "";
  const host = c.req.header("host")!;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/agents/VoiceAgent/${callSid}/media-stream">
      <Parameter name="CallSid" value="${callSid}" />
      <Parameter name="From" value="${from}" />
      <Parameter name="To" value="${to}" />
    </Stream>
  </Connect>
</Response>`;

  return c.body(twiml, 200, { "Content-Type": "text/xml" });
});

/** Route all agent WebSocket + HTTP traffic to Durable Objects */
app.all("/agents/*", async (c) => {
  const res = await routeAgentRequest(c.req.raw, c.env);
  return res ?? c.notFound();
});

export default app;
export { VoiceAgent } from "./agent";
