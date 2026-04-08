# phoneline

Minimal phone agent on Cloudflare Workers. Twilio call in, OpenAI Realtime out.

- `collect_info` — posts caller details to your webhook
- `forward_call` — transfers the live call to a human

```
caller → twilio → worker (twiml) → durable object → openai realtime
                                                      ↓
                                         collect_info → POST webhook
                                         forward_call → twilio transfer
```

## Quick Start

```sh
nvm use && npm install
cp .dev.vars.example .dev.vars   # fill in real values
npm run dev                      # starts local worker
npm run deploy                   # deploy to workers.dev
```

Set your Twilio number's voice webhook to `https://<your-url>/twiml` (POST).

Call the number. Say your name/reason — the agent collects info and POSTs it. Say "transfer me" — it forwards the call.

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Needs Realtime access |
| `TWILIO_ACCOUNT_SID` | Yes | Starts with `AC` |
| `TWILIO_AUTH_TOKEN` | Yes | |
| `WEBHOOK_URL` | Yes | Where `collect_info` POSTs data. Use [webhook.site](https://webhook.site) to test, or this worker's own `/webhook/collect-info` after deploy |
| `FORWARD_NUMBER` | Yes | Must differ from Twilio number |
| `LOGS_API_KEY` | Optional | Enables built-in webhook receiver + `/call-log/:callSid` |

Local: `.dev.vars`. Production: `wrangler secret put <KEY>`.

## Customizing

Edit two constants at the top of `agent.ts`:

- **`GREETING`** — what the agent says when the call connects
- **`SYSTEM_PROMPT`** — how the LLM behaves, what tools to use, when

No env vars needed. Edit, deploy.

## Call Logs

When `LOGS_API_KEY` is set:

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /webhook/collect-info` | `Bearer <key>` | Stores `collect_info` payload |
| `GET /call-log/:callSid` | `Bearer <key>` | Returns stored log for that call |

Stored in a `CallLogStore` Durable Object. LRU-bounded to 200 entries.

<details>
<summary>Example call log shape</summary>

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
    "reason": "Billing question"
  }
}
```
</details>

### Manual test (no phone call)

```sh
# POST a sample payload
curl -X POST "$BASE_URL/webhook/collect-info" \
  -H "Authorization: Bearer $LOGS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane","phone":"+15551234567","reason":"Test","callSid":"CA_TEST","timestamp":"2026-04-07T12:00:00Z"}'

# Read it back
curl "$BASE_URL/call-log/CA_TEST" -H "Authorization: Bearer $LOGS_API_KEY"
```

## Custom Glue

Twilio speaks **Media Streams**, not the `agents` protocol. Three small shims make it work:

1. **Protocol suppression** — `shouldSendProtocolMessages() => false` prevents the agents SDK from sending identity/state/MCP frames on the Twilio socket
2. **Workers WebSocket shim** — custom `createWebSocket` using `fetch(..., { Upgrade: websocket })` since Workers can't use outbound `new WebSocket()`
3. **Non-blocking connect** — `session.connect()` runs in the background so the 101 upgrade isn't delayed (Twilio is latency-sensitive)

> A few `as any` casts remain at the `@openai/agents-extensions` boundary (Node `ws` types vs Workers runtime). Can't be removed without upstream changes.

## Troubleshooting

| Symptom | Check |
|---|---|
| "Application error" on call | Webhook method is POST, URL ends in `/twiml` |
| Call connects then hangs up | `OPENAI_API_KEY` set? Worker logs show errors? |
| `collect_info` not arriving | `WEBHOOK_URL` reachable? `Authorization` header included? |

## Project Structure

```
index.ts             Worker + Hono routes (TwiML, webhook, logs)
agent.ts             VoiceAgent Durable Object (Realtime session)
tools.ts             collect_info + forward_call
call-log-store.ts    LRU call log storage (Durable Object)
types.ts             Env bindings
```

## Cost

OpenAI Realtime: ~$0.06/min input + $0.24/min output. A 2-min test call is ~$0.60. See [pricing](https://openai.com/api/pricing/).

## Known Limitations

- No call recording or transcript
- No memory across calls
- `LOGS_API_KEY` is a static token — add rate limiting for production

## License

MIT
