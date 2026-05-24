# Markets & Headlines

Live multi-asset dashboard: ~190 stocks across all major sectors, all
major crypto, commodities futures, macro indices, and 40+ FX
currencies — with real-time news per asset and an optional
**AI-generated analysis** panel powered by Claude.

**Live:** https://comms-dashboard-navy.vercel.app/

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open `http://localhost:5173`.

For v2 market APIs locally, use `npx vercel dev` (serverless routes under `api/` are not served by Vite alone).

## Deploy

Push to `main` and Vercel auto-deploys (Vite + serverless API routes under `api/`).

## Environment variables

Add in **Vercel → Project → Settings → Environment Variables** (or `.env.local`):

| Variable | Required for | Notes |
| -------- | ------------ | ----- |
| `GROQ_API_KEY` | AI analysis panel | [Groq console](https://console.groq.com/) — `llama-3.3-70b-versatile` |
| `ALPHA_VANTAGE_API_KEY` | Commodities (v2) | [Alpha Vantage](https://www.alphavantage.co/support/#api-key) — free tier 25 req/day |
| `EIA_API_KEY` | Energy (v2) | [EIA Open Data](https://www.eia.gov/opendata/register.php) |
| `COINGECKO_API_KEY` | Crypto (v2) | Optional; [CoinGecko API](https://www.coingecko.com/en/api/pricing) |
| `CRON_SECRET` | AV cache refresh | Random string; secures `/api/market/refresh` |
| `VITE_USE_LIVE_DATA` | v2 price path | `true` → `/api/market/snapshot`; `false` → `/api/prices` (Yahoo) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | AV cache persistence | Optional Vercel KV / Upstash Redis |
| `BLOB_READ_WRITE_TOKEN` | AV cache persistence | **Recommended** — Vercel → Storage → Blob → Create store → copy token |

See [docs/commodities-v2-api-spec.md](docs/commodities-v2-api-spec.md) for architecture and rate limits.

## v2 market API routes

| Route | Purpose |
| ----- | ------- |
| `GET /api/market/snapshot` | CoinGecko (live) + cached Alpha Vantage + EIA |
| `GET /api/market/refresh` | Cron: refresh AV + EIA cache (Bearer `CRON_SECRET`) |

Cron schedule: 06:00 and 18:00 UTC (`vercel.json`).

## Tabs

- **Overview** — hero stats, top movers, headlines
- **Prices** — full asset table, charts, AI analysis
- **Currency** — 40+ FX pairs
- **Intel** — RSS headlines
