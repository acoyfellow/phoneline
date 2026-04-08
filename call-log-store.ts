import type { CollectInfoPayload } from "./types";

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

export class CallLogStore {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

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

  async get(callSid: string): Promise<CallLog | undefined> {
    return (await this.state.storage.get(callLogKey(callSid))) as CallLog | undefined;
  }

  async set(log: CallLog) {
    const callSid = log.callSid;

    // Update LRU order.
    const order = (await this.state.storage.get<string[]>("order")) ?? [];
    const without = order.filter((id) => id !== callSid);
    without.push(callSid);

    // Evict oldest if needed.
    while (without.length > MAX_CALL_LOGS) {
      const evicted = without.shift();
      if (evicted) await this.state.storage.delete(callLogKey(evicted));
    }

    await this.state.storage.put("order", without);
    await this.state.storage.put(callLogKey(callSid), log);
  }
}
