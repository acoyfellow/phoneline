# phoneline

Minimal phone voice agent on Cloudflare Workers: Twilio phone call in, OpenAI Realtime out.

- Tool 1: `collect_info` (posts caller details to your webhook)
- Tool 2: `forward_call` (transfers the live call to a number you control)

This repo is a **minimal framework** for building a “phone support agent”:

- An incoming phone call triggers the agent to answer.
- The agent collects support/lead details during the conversation.
- When it has the details, it calls `collect_info`, which **POSTs JSON to `WEBHOOK_URL`**.
- If the caller asks for a real person, it calls `forward_call`, which **transfers the live call** to `FORWARD_NUMBER`.

## Architecture

```
caller → twilio → cloudflare worker (twiml) → durable object (websocket)
                                                    ↓
                                              openai realtime api
                                                    ↓
                                           tools: collect_info → webhook POST
                                                   forward_call → twilio REST api
```

| Component              | Role                                                    |
| ---------------------- | ------------------------------------------------------- |
| **Cloudflare Workers** | TwiML endpoint + HTTP routing                           |
| **Durable Objects**    | One per call — holds the WebSocket + Realtime session   |
| **Twilio Media Streams** | Bidirectional audio over WebSocket                    |
| **OpenAI Realtime API** | Speech-to-speech via `@openai/agents` SDK              |

## Custom Glue (what had to be done)

This example uses the `agents` Durable Object routing to receive the Twilio WebSocket, but Twilio speaks the **Twilio Media Streams** wire format (not the `agents` protocol). A few small pieces of glue make that work reliably:

- **Durable Object protocol suppression**: In `agent.ts`, `VoiceAgent.shouldSendProtocolMessages()` returns `false` so the `agents` SDK does not send JSON identity/state/MCP messages on the same socket where Twilio expects only media-stream events.
- **Stable WebSocket upgrade in Workers**: `TwilioRealtimeTransportLayer` is given a `createWebSocket` function that uses `fetch(..., { Upgrade: websocket })` (Workers do not allow the normal outbound `new WebSocket()` path).
- **Avoid delayed WebSocket handshakes**: `session.connect()` is started in the background so the `101 Switching Protocols` response is not delayed by OpenAI session setup (Twilio is sensitive to handshake latency).
- **Route naming compatibility**: Twilio connects to `/agents/voice-agent/<callSid>/media-stream`. This matches how the `agents` SDK maps binding/class names into durable object namespaces.

If you want to reuse this integration elsewhere, the reusable pieces to extract are:
`shouldSendProtocolMessages() => false`, the Workers-friendly `createWebSocket` transport shim, and the “start realtime connect in the background” handshake pattern.

## Prerequisites

- **Node.js** `>=20.19.0` (run `nvm use` — `.nvmrc` is included)
- A [Twilio account](https://www.twilio.com/try-twilio) with a phone number
- An [OpenAI API key](https://platform.openai.com/api-keys) with Realtime access
- A webhook receiver for `collect_info` — [webhook.site](https://webhook.site) or [requestbin](https://pipedream.com/requestbin)
- Optional but recommended: `LOGS_API_KEY` enables the built-in `collect_info` receiver + `/call-log/:callSid` viewer (see below)

## Quick Start (Local Dev)

### 1. Install dependencies

```sh
nvm use            # picks up .nvmrc → v20.19.0
npm install
```

### 2. Configure secrets

```sh
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with real values:

| Variable            | Required | Description                                      |
| ------------------- | -------- | ------------------------------------------------ |
| `OPENAI_API_KEY`    | Yes      | OpenAI API key with Realtime access              |
| `TWILIO_ACCOUNT_SID`| Yes     | Twilio Account SID (starts with `AC`)            |
| `TWILIO_AUTH_TOKEN` | Yes      | Twilio Auth Token                                |
| `WEBHOOK_URL`       | Yes      | URL where `collect_info` POSTs caller data       |
| `FORWARD_NUMBER`    | Yes      | Phone number for call transfers (e.g. `+15551234567`) |
| `SYSTEM_PROMPT`     | No       | Custom system prompt (sensible default included) |
| `LOGS_API_KEY`      | Optional | Enables the built-in webhook + logs endpoints |

### 3. Start the worker

```sh
npm run dev
```

Verify it's running:

```sh
curl http://localhost:8787/
# → {"name":"phoneline","status":"ok"}
```

### 4. Expose to the internet

Twilio must be able to reach your worker over the internet.

Pick one:

1. **Recommended (no tunnel): deploy and use the `workers.dev` URL**
   - Run: `npm run deploy`
   - Copy the `https://...workers.dev/twiml` URL shown by `wrangler deploy`
2. **Local tunnel (stable while it’s running):**
   - Run a tunnel in a second terminal and keep it running
   - Your Twilio webhook URL must be: `https://<your-tunnel-host>/twiml` (HTTP POST)
   - Any tunnel method is fine; if your tunnel hostname changes between restarts, you’ll need to update the Twilio webhook.

### 5. Point Twilio at it

1. Go to [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Select your number → **Voice Configuration**
3. Set the webhook to:
    ```
    https://<public-url>/twiml
    ```
 Method: **HTTP POST**

### 6. Call the number

- Say your name, phone number, and reason for calling — the agent will use `collect_info` to POST the data to your `WEBHOOK_URL`.
- Say **"transfer me"** or **"speak to a real person"** — the agent will use `forward_call` to transfer via Twilio.

## Deploy to Production

### 1. Set secrets

```sh
wrangler secret put OPENAI_API_KEY
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put WEBHOOK_URL
wrangler secret put FORWARD_NUMBER
# optional but recommended if you want the built-in log viewer
wrangler secret put LOGS_API_KEY
wrangler secret put SYSTEM_PROMPT
```

### 2. Deploy

```sh
npm run deploy
```

### 3. Update Twilio webhook

Set your number's voice webhook to the `workers.dev` URL shown by `wrangler deploy` (for example):

```
https://phoneline.<something>.workers.dev/twiml
```

## Built-in Webhook Receiver and Call Logs (recommended)

When `LOGS_API_KEY` is set, this worker provides two secure endpoints to make debugging easy:

- `POST /webhook/collect-info` (stores the last `collect_info` payload for a given `callSid`)
- `GET /call-log/:callSid` (retrieves what the agent stored for that call)

Where the data is stored:

- In a separate Durable Object (`CallLogStore`) that keeps a small in-memory-style **LRU cache** of the most recent call logs.
- Current limit: **200 call logs** (evicts older entries).

Call log shape (example):

```json
{
  "callSid": "CA_TEST_123",
  "connectedAt": "2026-04-07T12:00:00.000Z",
  "realtimeConnectedAt": "2026-04-07T12:00:00.500Z",
  "endedAt": "2026-04-07T12:00:20.000Z",
  "close": { "code": 1006, "reason": "...", "wasClean": false },
  "collectInfo": {
    "name": "Jane Doe",
    "phone": "+15551234567",
    "email": "jane@example.com",
    "reason": "Billing question",
    "notes": "Wants to upgrade plan",
    "callSid": "CA_TEST_123",
    "timestamp": "2026-04-07T12:00:00.000Z"
  }
}
```

Both endpoints require:

`Authorization: Bearer <LOGS_API_KEY>`

Recommended local setup for faster iteration:

1. Set `WEBHOOK_URL` to your own worker’s `.../webhook/collect-info` endpoint.
2. Keep `LOGS_API_KEY` set so the agent’s `collect_info` tool can authorize its webhook POST.

### Manual test (no phone call)

Set `BASE_URL` to one of:

- Local: `http://localhost:8787`
- Deployed: the `workers.dev` URL you see from `wrangler deploy`

1. POST a sample payload:

```sh
curl -X POST "$BASE_URL/webhook/collect-info" \
  -H "Authorization: Bearer $LOGS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Jane Doe",
    "phone":"+15551234567",
    "email":"jane@example.com",
    "reason":"Billing question",
    "notes":"Wants to upgrade plan",
    "callSid":"CA_TEST_123",
    "timestamp":"2026-04-07T12:00:00.000Z"
  }'
```

2. Read the stored call log:

```sh
curl "$BASE_URL/call-log/CA_TEST_123" \
  -H "Authorization: Bearer $LOGS_API_KEY"
```

## Tools

### `collect_info`

Collects caller name, phone, email, reason, and notes. POSTs JSON to `WEBHOOK_URL` with the call SID and timestamp.

Example payload:

```json
{
  "name": "Jane Doe",
  "phone": "+15559876543",
  "email": "jane@example.com",
  "reason": "Billing question",
  "notes": "Wants to upgrade plan",
  "callSid": "CA1234567890abcdef",
  "timestamp": "2026-04-07T12:00:00.000Z"
}
```

### `forward_call`

Transfers the live call to `FORWARD_NUMBER` via Twilio's REST API. The caller hears "Transferring you now. Please hold." before the dial.

## Project Structure

```
index.ts         Worker entry + Hono routes (TwiML endpoint, agent routing)
agent.ts         Durable Object voice agent (OpenAI Realtime session)
tools.ts         collect_info + forward_call tool definitions
types.ts         TypeScript types for env bindings
.nvmrc           Pins Node.js version
```

## License

MIT
