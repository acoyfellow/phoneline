# phoneline

minimal voice AI agent on cloudflare workers. twilio phone call in, openai realtime out. two tools: collect info, forward call. that's it.

## architecture

```
caller → twilio → cloudflare worker (twiml) → durable object (websocket)
                                                    ↓
                                              openai realtime api
                                                    ↓
                                           tools: collect_info → webhook POST
                                                   forward_call → twilio REST api
```

- **cloudflare workers** — twiml endpoint + routing
- **durable objects** — one per call, holds the websocket + realtime session
- **twilio media streams** — bidirectional audio over websocket
- **openai realtime api** — speech-to-speech via `@openai/agents` sdk

## setup

```sh
npm install
```

### secrets

```sh
wrangler secret put OPENAI_API_KEY
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put WEBHOOK_URL        # where collect_info POSTs to
wrangler secret put FORWARD_NUMBER     # e.g. +15551234567
wrangler secret put SYSTEM_PROMPT      # optional, has a sensible default
```

### deploy

```sh
npm run deploy
```

### twilio config

1. buy a phone number in the [twilio console](https://console.twilio.com/)
2. set the voice webhook to `https://phoneline.<your-subdomain>.workers.dev/twiml` (HTTP POST)
3. call the number

## local dev

```sh
cp .dev.vars.example .dev.vars   # fill in real values
npm run dev
# in another terminal:
npx cloudflared tunnel --url http://localhost:8787
```

use the cloudflared tunnel url as your twilio webhook (e.g. `https://<random>.trycloudflare.com/twiml`).

## tools

### collect_info

collects caller name, phone, email, reason, and notes. POSTs json to `WEBHOOK_URL` with the call sid and timestamp.

### forward_call

transfers the live call to `FORWARD_NUMBER` via twilio's rest api. the caller hears "transferring you now" before the dial.

## project structure

```
index.ts   worker entry + hono routes
agent.ts   durable object voice agent
tools.ts   collect_info + forward_call
types.ts   env bindings
```

## demo it

**Local demo**

1. `cp .dev.vars.example .dev.vars` — fill in `OPENAI_API_KEY`, Twilio creds, `WEBHOOK_URL` (use a request bin or ngrok echo), `FORWARD_NUMBER`.
2. `npm run dev`
3. `npx cloudflared tunnel --url http://localhost:8787`
4. Twilio console: set number voice webhook to `https://<tunnel-host>.trycloudflare.com/twiml` (POST).
5. Call the number. Say your name, phone, reason; agent will `collect_info`. Then say "transfer me" to hit `forward_call`.

**Deployed demo**

1. `wrangler secret put` all vars (OPENAI_API_KEY, TWILIO_*, WEBHOOK_URL, FORWARD_NUMBER; SYSTEM_PROMPT optional).
2. `npm run deploy`
3. Twilio console: set voice webhook to `https://phoneline.<subdomain>.workers.dev/twiml` (POST).
4. Call and run the same flow — check WEBHOOK_URL receiver for the `collect_info` payload and confirm transfer to FORWARD_NUMBER.

## license

MIT
