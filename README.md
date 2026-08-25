# Markets & Headlines

Live multi-asset dashboard: 268 tracked stocks, crypto assets,
commodities futures, macro indices, and 40+ FX
currencies — with real-time news per asset and an optional
**AI-generated analysis** panel powered by Groq.

**Live:** https://comms-dashboard-navy.vercel.app/

## Run locally

```bash
npm ci
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
| `GROQ_API_KEY` | AI briefing and analysis | [Groq console](https://console.groq.com/) |
| `GROQ_MODEL` | Groq model selection | Optional; defaults to `openai/gpt-oss-120b` |
| `GROQ_TIMEOUT_MS` / `GROQ_REASONING_EFFORT` | Groq request policy | Optional; defaults to `15000` / `low` |
| `AI_GENERATION_QUOTA` / `AI_GENERATION_WINDOW_SECONDS` | Per-client AI generation limit | Optional; defaults to 10 uncached generations per 60 seconds |
| `AI_BRIEFING_TTL_SECONDS` / `AI_ANALYSIS_TTL_SECONDS` | AI result cache | Optional; defaults to 15 / 30 minutes |
| `AI_SMOKE_SECRET` | Forced-generation production smoke | Required for the scheduled smoke; configure the same value as a GitHub Actions secret |
| `ALPHA_VANTAGE_API_KEY` | WTI + Brent (v2) | [Alpha Vantage](https://www.alphavantage.co/support/#api-key) — two requests per refresh, four per day |
| `EIA_API_KEY` | Henry Hub spot (v2) | [EIA Open Data](https://www.eia.gov/opendata/register.php) — daily observations published weekly |
| `COINGECKO_API_KEY` | Crypto (v2) | Optional; [CoinGecko API](https://www.coingecko.com/en/api/pricing) |
| `CRON_SECRET` | AV cache refresh | Random string; secures `/api/market/refresh` |
| `VITE_USE_LIVE_DATA` | v2 price path | `true` → `/api/market/snapshot`; `false` → `/api/prices` (Yahoo) |
| `MARKET_FETCH_TIMEOUT_MS` | Provider timeout | Optional; defaults to 8 seconds |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Distributed AI guard and provider-cache persistence | Required when AI is enabled on Vercel; legacy `KV_REST_API_*` names are still accepted |
| `BLOB_STORE_ID` | Provider-cache persistence | Optional Vercel Blob store; connect the project with OIDC rather than a long-lived read/write token |

See [docs/commodities-v2-api-spec.md](docs/commodities-v2-api-spec.md) for architecture and rate limits.

## v2 market API routes

| Route | Purpose |
| ----- | ------- |
| `GET /api/prices` | Batched Yahoo daily quotes and history for the full catalogue |
| `GET /api/market/snapshot` | CoinGecko (live) + cached Alpha Vantage + EIA |
| `GET /api/market/refresh` | Cron: refresh AV + EIA cache (Bearer `CRON_SECRET`) |
| `GET /api/briefing` | Cached, quota-protected AI market briefing |
| `GET /api/analysis?ticker=NVDA` | Cached, quota-protected technical and AI analysis |

Cron schedule: 06:00 and 18:00 UTC (`vercel.json`).

## Data trust and resilience

- Daily change is derived from Yahoo's final two valid daily closes, not the start of a multi-day range.
- Alpha Vantage overlays only the daily-supported WTI (`CL`) and Brent (`BZ`) series. Copper (`HG`), wheat (`ZW`), and corn (`ZC`) stay on Yahoo because Alpha Vantage publishes incompatible global-price series at slower cadences.
- EIA Henry Hub remains a daily observation series even though EIA publishes it weekly; its observation-age allowance is 12 days to cover publication lag and holidays.
- Yahoo symbols are fetched in 20-symbol batches, cutting the normal price refresh to 14 upstream requests for all 268 assets.
- The UI reports `LIVE`, `DEGRADED`, or `STALE` from freshness, coverage, and provider errors. Mock fallback rows remain visible but are excluded from movers, heatmaps, and alerts.
- Provider requests time out and partial failures preserve usable or last-known-good data.
- AI calls use distributed semantic caching, cross-instance generation locks, atomic per-client quotas, safe client errors, structured server logs, and a scheduled forced-generation production smoke test. Vercel fails closed if its Redis guard is unavailable.

## Verify

```bash
npm test
npm run build
npm audit
npm run smoke:ai -- https://comms-dashboard-navy.vercel.app NVDA
```

CI repeats tests, the production build, and a production-dependency security audit on every push and pull request.

## Tabs

- **Overview** — hero stats, top movers, headlines
- **Prices** — full asset table, charts, AI analysis
- **Currency** — 40+ FX pairs
- **Intel** — RSS headlines
