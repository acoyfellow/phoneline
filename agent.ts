import { Agent, type Connection, type ConnectionContext } from "agents";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { TwilioRealtimeTransportLayer } from "@openai/agents-extensions";
import { createTools } from "./tools";
import type { Env } from "./types";
import type { CallLogStore } from "./call-log-store";

// Common headers expected by the OpenAI Realtime WebSocket.
// (We intentionally keep this minimal to avoid relying on internal dist imports.)
const OPENAI_REALTIME_COMMON_HEADERS = {
  "User-Agent": "Agents/JavaScript",
  "X-OpenAI-Agents-SDK": "openai-agents-sdk",
} as const;

// ── Customize these two constants ──────────────────────────────────────────
// GREETING is spoken aloud as soon as the call connects (before the caller
// says anything). SYSTEM_PROMPT tells the LLM how to behave for the rest of
// the conversation. Edit them here — no env vars needed.

const GREETING =
  "Hi, thanks for calling! How can I help you today?";

const SYSTEM_PROMPT = [
  "You are a friendly, professional phone assistant.",
  "Your job is to help the caller.",
  "",
  "You have two tools:",
  "",
  "1. collect_info — call this once you have the caller's name, phone number,",
  "   reason for calling, and optionally their email and any extra notes.",
  "   Before calling it, repeat the details back and ask the caller to confirm.",
  "",
  "2. forward_call — call this when the caller asks to speak with a real person",
  "   or to be transferred. Include a short reason.",
  "",
  "Rules:",
  "- Be concise. This is a phone call — keep responses to 1-2 sentences.",
  "- Ask for one piece of information at a time.",
  "- Always confirm details before calling collect_info.",
  "- If the caller gives partial info, ask follow-up questions to fill in the",
  "  required fields (name, phone, reason).",
  "- Do not make up information the caller did not provide.",
].join("\n");

export class VoiceAgent extends Agent<Env> {
  // Disable hibernation — the DO must stay alive to relay audio
  // between Twilio and OpenAI Realtime for the duration of the call.
  static options = { hibernate: false };

  #sessions = new Map<string, RealtimeSession>();
  #callSidByConnectionId = new Map<string, string>();

  // Twilio Media Streams expects raw audio frames on the WebSocket.
  // The agents SDK normally sends protocol messages (identity, state, MCP)
  // on connect — these corrupt the Twilio stream and cause it to disconnect.
  shouldSendProtocolMessages(
    _connection: Connection,
    _ctx: ConnectionContext
  ): boolean {
    return false;
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    if (!url.pathname.includes("media-stream")) return;

    // Extract CallSid from URL: /agents/voice-agent/<callSid>/media-stream
    const segments = url.pathname.split("/");
    const callSid =
      segments[segments.indexOf("voice-agent") + 1] ?? "unknown";

    this.#callSidByConnectionId.set(connection.id, callSid);

    const store = this.#getLogStore();

    // Best-effort: initialize log entry.
    void store.initCall(callSid, new Date().toISOString()).catch(() => undefined);

    if (!this.env.WEBHOOK_URL?.trim())
      throw new Error("WEBHOOK_URL is not configured");
    if (!this.env.FORWARD_NUMBER?.trim())
      throw new Error("FORWARD_NUMBER is not configured");

    const prompt = SYSTEM_PROMPT;
    const tools = createTools(this.env, callSid);

    const agent = new RealtimeAgent({
      name: "phoneline",
      instructions: prompt,
      tools,
    });

    const transport = new TwilioRealtimeTransportLayer({
      twilioWebSocket: connection,
      // Cloudflare Workers cannot use the global WebSocket constructor for
      // outbound connections. Use fetch() + Upgrade: websocket instead.
      createWebSocket: async ({ url, apiKey }) => {
        const resp = await fetch(url.replace(/^ws/i, "http"), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Sec-WebSocket-Protocol": "realtime",
            Connection: "Upgrade",
            Upgrade: "websocket",
            ...OPENAI_REALTIME_COMMON_HEADERS,
          },
        });
        const ws = resp.webSocket;
        if (!ws) throw new Error(`WebSocket upgrade failed: ${resp.status}`);
        ws.accept();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return ws as any;
      },
      skipOpenEventListeners: true,
    });

    transport.on("error", (error) => {
      console.error(`[phoneline] transport error (${callSid}):`, error);
    });

    const session = new RealtimeSession(agent, { transport });
    this.#sessions.set(connection.id, session);

    session.on("error", (error) => {
      console.error(`[phoneline] session error (${callSid}):`, error);
    });

    // PartyServer does not send the 101 Switching Protocols response until
    // onConnect resolves. Twilio is sensitive to that handshake latency, so
    // start the Realtime session in the background instead of blocking setup.
    void this.#connectSession(connection, session, callSid);
  }

  async #connectSession(
    connection: Connection,
    session: RealtimeSession,
    callSid: string
  ) {
    try {
      console.log(`[phoneline] connect() -> OpenAI Realtime (${callSid})`);
      await session.connect({
        apiKey: this.env.OPENAI_API_KEY,
      });
      console.log(`[phoneline] call connected: ${callSid}`);

      // Speak the greeting immediately so the caller hears something
      // before they say anything. We inject a pre-filled assistant message
      // and ask the model to turn it into speech.
      try {
        session.transport.sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: GREETING }],
          },
        } as any);
        session.transport.sendEvent({
          type: "response.create",
        } as any);
      } catch {
        // Best-effort — don't break the call if greeting fails.
      }

      void this.#getLogStore()
        .markRealtimeConnected(callSid, new Date().toISOString())
        .catch(() => undefined);
    } catch (err) {
      console.error(
        `[phoneline] Realtime connect failed (${callSid}):`,
        err
      );
      this.#sessions.delete(connection.id);
      try {
        connection.close(1011, "Realtime session setup failed");
      } catch {
        // Ignore close races if Twilio already disconnected.
      }
    }
  }

  onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean
  ): void {
    const callSid = this.#callSidByConnectionId.get(connection.id) ?? "unknown";
    this.#callSidByConnectionId.delete(connection.id);

    const session = this.#sessions.get(connection.id);
    if (session) {
      this.#sessions.delete(connection.id);
      session.close();
    }

    console.log(
      `[phoneline] call ended — code=${code} reason="${reason}" clean=${wasClean}`
    );

    void this.#getLogStore()
      .endCall(
        callSid,
        { code, reason, wasClean },
        new Date().toISOString()
      )
      .catch(() => undefined);
  }

  #getLogStore(): DurableObjectStub<CallLogStore> {
    return this.env.CallLogStore.get(
      this.env.CallLogStore.idFromName("singleton")
    ) as DurableObjectStub<CallLogStore>;
  }
}
