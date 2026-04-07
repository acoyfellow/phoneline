import { Agent, type Connection, type ConnectionContext } from "agents";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { TwilioRealtimeTransportLayer } from "@openai/agents-extensions";
import { createTools } from "./tools";
import type { Env } from "./types";

const DEFAULT_PROMPT = [
  "You are a friendly, professional phone assistant.",
  "Your job is to help the caller. You have two capabilities:",
  "1. Collect the caller's information (name, phone, email, reason for calling) and submit it.",
  "2. Transfer the call to a real person if the caller requests it.",
  "Be concise. This is a phone call — keep responses short and natural.",
  "Always confirm details before submitting collected information.",
].join(" ");

export class VoiceAgent extends Agent<Env> {
  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    if (!url.pathname.includes("media-stream")) return;

    // Extract CallSid from URL: /agents/VoiceAgent/<callSid>/media-stream
    const segments = url.pathname.split("/");
    const callSid = segments[segments.indexOf("VoiceAgent") + 1] ?? "unknown";

    if (!this.env.WEBHOOK_URL?.trim()) throw new Error("WEBHOOK_URL is not configured");
    if (!this.env.FORWARD_NUMBER?.trim()) throw new Error("FORWARD_NUMBER is not configured");

    const prompt = this.env.SYSTEM_PROMPT || DEFAULT_PROMPT;
    const tools = createTools(this.env, callSid);

    const agent = new RealtimeAgent({
      name: "phoneline",
      instructions: prompt,
      tools,
    });

    const transport = new TwilioRealtimeTransportLayer({
      twilioWebSocket: connection,
    });

    const session = new RealtimeSession(agent, { transport });

    try {
      await session.connect({
        apiKey: this.env.OPENAI_API_KEY,
      });
      console.log(`[phoneline] call connected: ${callSid}`);
    } catch (err) {
      console.error(`[phoneline] Realtime connect failed (${callSid}):`, err);
      throw err;
    }
  }

  onClose(_connection: Connection, _code: number, _reason: string, _wasClean: boolean): void {
    console.log(`[phoneline] call ended`);
  }
}
