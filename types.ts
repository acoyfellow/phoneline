export interface Env {
  VoiceAgent: DurableObjectNamespace;
  CallLogStore: DurableObjectNamespace;
  OPENAI_API_KEY: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  WEBHOOK_URL: string;
  FORWARD_NUMBER: string;
  LOGS_API_KEY?: string;
  SYSTEM_PROMPT?: string;
}

/** Twilio media stream custom parameters passed via TwiML */
export interface TwilioStreamParams {
  CallSid: string;
  From: string;
  To: string;
}

export interface CollectInfoPayload {
  name: string;
  phone: string;
  email?: string;
  reason: string;
  notes?: string;
  callSid: string;
  timestamp: string;
}

export type VoiceAgentStub = {
  // Unused for logs (kept for compatibility if you were calling them directly).
  recordCollectInfo(payload: CollectInfoPayload): Promise<{ ok: true }>;
  getCallLog(): Promise<unknown>;
};

export type CallLogStoreStub = {
  initCall(callSid: string, connectedAt: string): Promise<void>;
  markRealtimeConnected(callSid: string, at: string): Promise<void>;
  recordCollectInfo(payload: CollectInfoPayload): Promise<void>;
  endCall(callSid: string, close: { code: number; reason: string; wasClean: boolean }, endedAt: string): Promise<void>;
  getCallLog(callSid: string): Promise<unknown>;
};
