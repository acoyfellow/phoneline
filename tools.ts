import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import type { Env } from "./types";

// Creates the two voice agent tools, closed over env + call context.
export function createTools(env: Env, callSid: string) {
  const collectInfo = tool({
    name: "collect_info",
    description:
      "Collect information from the caller and send it to our system. " +
      "Use this once you have gathered the relevant details from the conversation.",
    parameters: z.object({
      name: z.string().describe("Caller's name"),
      phone: z.string().describe("Caller's phone number"),
      email: z.string().optional().describe("Caller's email if provided"),
      reason: z.string().describe("Reason for calling"),
      notes: z.string().optional().describe("Any additional details"),
    }),
    execute: async (input) => {
      const payload = { ...input, callSid, timestamp: new Date().toISOString() };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // If you're using this repo's built-in webhook receiver, it will
      // validate this header.
      if (env.LOGS_API_KEY?.trim()) {
        headers["Authorization"] = `Bearer ${env.LOGS_API_KEY}`;
      }

      const res = await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`collect_info webhook failed: ${res.status} ${res.statusText}`);
      return "Information collected and submitted successfully.";
    },
  });

  const forwardCall = tool({
    name: "forward_call",
    description:
      "Transfer this call to another phone number. " +
      "Use this when the caller asks to speak with a real person or be transferred.",
    parameters: z.object({
      reason: z.string().describe("Why the call is being transferred"),
    }),
    execute: async (input) => {
      const target = env.FORWARD_NUMBER;
      if (!target?.trim()) throw new Error("FORWARD_NUMBER is not configured");
      const twiml = `<Response><Say>Transferring you now. Please hold.</Say><Dial>${target}</Dial></Response>`;
      const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`;
      const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Twiml: twiml }).toString(),
      });
      if (!res.ok) throw new Error(`forward_call Twilio API failed: ${res.status} ${res.statusText}`);
      return `Call is being transferred to ${target}. Reason: ${input.reason}`;
    },
  });

  return [collectInfo, forwardCall];
}
