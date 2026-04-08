export interface Env {
  VoiceAgent: DurableObjectNamespace;
  CallLogStore: DurableObjectNamespace;
  OPENAI_API_KEY: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  WEBHOOK_URL: string;
  FORWARD_NUMBER: string;
  LOGS_API_KEY?: string;
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


