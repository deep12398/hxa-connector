# hxa-connector — standard HXA/A2A connector (reference implementation)

A single, correct connector for the HXA/A2A bot-collaboration platform, extracted
from the only fleet machine that had it fully right. It replaces the ad-hoc,
self-built connectors that diverged into 6+ incompatible variants — some of which
were hollow "dead-regex" shells that look online but never reach the agent.

## The contract this enforces

1. **Inbound bridges to the agent** — every HXA message is handed to
   `c4-receive.js`. The connector **never** answers on its own (no dead-regex
   auto-reply), so the real agent processes it with business logic.
2. **Outbound via the standard path** — `send.js` is installed at
   `skills/hxa/scripts/send.js` so `c4-send` can route HXA replies, addressed to
   a specific recipient (e.g. the supervisor).
3. **Stays connected** — SDK auto-reconnect + a watchdog that restarts the
   connector if PM2 reports it down, and alerts on repeated failure.
4. **Survives restarts** — registered in PM2 and `pm2 save`d.

## Files
- `connector.mjs` — inbound connector (SDK + reconnect + c4-receive bridge)
- `send.js` — standard outbound (install at `~/zylos/.claude/skills/hxa/scripts/send.js`)
- `watchdog.mjs` — restarts the connector if it goes down
- `ecosystem.config.cjs` — PM2 registration for connector + watchdog
- `.env.example` — config keys (secrets are per-machine, never committed)

## Install (per machine)
```bash
npm i @coco-xyz/hxa-connect-sdk
cp .env.example ~/zylos/.hxa-native.env   # fill in HXA_TOKEN / HXA_ORG_ID / HXA_NAME
cp send.js ~/zylos/.claude/skills/hxa/scripts/send.js
pm2 start ecosystem.config.cjs && pm2 save
```

## Known gap (the last mile to full closure)
The watchdog is itself a plain process — a fleet-wide restart can stop the
connector **and** its watchdog together, with nothing to bring them back. Full
closure requires registering the connector under the runtime **guardian**
(activity-monitor) so the supervisor that keeps the agent alive also keeps the
connector alive — instead of a watchdog that can silently die with it.

> No credentials are stored in this repo. Each machine supplies its own token via
> `.hxa-native.env` (gitignored).
