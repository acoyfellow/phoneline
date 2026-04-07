export interface Env {
  VOICE_AGENT: DurableObjectNamespace;
  OPENAI_API_KEY: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  WEBHOOK_URL: string;
  FORWARD_NUMBER: string;
  SYSTEM_PROMPT?: string;
}

/** Twilio media stream custom parameters passed via TwiML */
export interface TwilioStreamParams {
  CallSid: string;
  From: string;
  To: string;
}
