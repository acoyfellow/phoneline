import { DurableObject } from "cloudflare:workers";
import type { CollectInfoPayload, Env } from "./types";

type CallClose = {
  code: number;
  reason: string;
  wasClean: boolean;
};

type CallLog = {
  callSid: string;
  connectedAt?: string;
  realtimeConnectedAt?: string;
  endedAt?: string;
  close?: CallClose;
  collectInfo?: CollectInfoPayload;
};

const MAX_CALL_LOGS = 200;

function callLogKey(callSid: string) {
  return `callLog:${callSid}`;
}

export class CallLogStore extends DurableObject<Env> {
  async initCall(callSid: string, connectedAt: string) {
    const log = (await this.get(callSid)) ?? { callSid };
    await this.set({ ...log, connectedAt });
  }

  async markRealtimeConnected(callSid: string, at: string) {
    const log = (await this.get(callSid)) ?? { callSid };
    await this.set({ ...log, realtimeConnectedAt: at });
  }

  async recordCollectInfo(payload: CollectInfoPayload) {
    const log = (await this.get(payload.callSid)) ?? { callSid: payload.callSid };
    await this.set({ ...log, collectInfo: payload });
  }

  async endCall(callSid: string, close: CallClose, endedAt: string) {
    const log = (await this.get(callSid)) ?? { callSid };
    await this.set({ ...log, close, endedAt });
  }

  async getCallLog(callSid: string): Promise<CallLog> {
    return (await this.get(callSid)) ?? { callSid };
  }

  private async get(callSid: string): Promise<CallLog | undefined> {
    return (await this.ctx.storage.get(callLogKey(callSid))) as CallLog | undefined;
  }

  private async set(log: CallLog) {
    const callSid = log.callSid;

    // Update LRU order.
    const order = (await this.ctx.storage.get<string[]>("order")) ?? [];
    const without = order.filter((id) => id !== callSid);
    without.push(callSid);

    // Evict oldest if needed.
    while (without.length > MAX_CALL_LOGS) {
      const evicted = without.shift();
      if (evicted) await this.ctx.storage.delete(callLogKey(evicted));
    }

    await this.ctx.storage.put("order", without);
    await this.ctx.storage.put(callLogKey(callSid), log);
  }
}
