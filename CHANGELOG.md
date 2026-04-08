# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.0.1] - 2026-04-08

### Added

- Initial release
- Twilio → OpenAI Realtime voice agent on Cloudflare Workers
- `collect_info` tool — posts caller details to configurable webhook
- `forward_call` tool — transfers live call via Twilio REST API
- `CallLogStore` Durable Object with LRU-bounded storage (200 entries)
- Built-in webhook receiver + call log viewer (behind `LOGS_API_KEY`)
