# Markets & Headlines

Live multi-asset dashboard: 268 tracked stocks, crypto assets,
commodities futures, macro indices, and 40+ FX
currencies — with real-time news per asset and an optional
**AI-generated analysis** panel powered by Groq. Intel also includes a
live 90-day economic calendar sourced from BLS, BEA, and Federal Reserve
schedules. When BLS blocks the serverless network, principal BLS release dates
come from the free official OMB/OIRA schedule hosted by the Census Bureau; the
free St. Louis Fed FRED calendar remains a transparently attributed final fallback.

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
| `AI_BRIEFING_TTL_SECONDS` / `AI_ANALYSIS_TTL_SECONDS` | Market AI result cache | Optional; defaults to 15 / 30 minutes |
| `AI_SMART_MONEY_BRIEFING_TTL_SECONDS` | Smart Money AI result cache | Optional; defaults to 36 hours and is also partitioned by UTC market date and accepted-evidence digest |
| `AI_SMOKE_SECRET` | Forced-generation production smoke | Required for the scheduled smoke; configure the same value as a GitHub Actions secret |
| `EIA_API_KEY` | Henry Hub spot (v2) | [EIA Open Data](https://www.eia.gov/opendata/register.php) — daily observations published weekly |
| `COINGECKO_API_KEY` | Crypto (v2) | Optional; [CoinGecko API](https://www.coingecko.com/en/api/pricing) |
| `CRON_SECRET` | Scheduled market and Smart Money refresh | Random string; secures `/api/market/refresh` and `/api/smart-money/refresh` |
| `VITE_USE_LIVE_DATA` | v2 price path | `true` → `/api/market/snapshot`; `false` → `/api/prices` (Yahoo) |
| `MARKET_FETCH_TIMEOUT_MS` | Provider timeout | Optional; defaults to 8 seconds |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Distributed AI guard and provider-cache persistence | Required when AI is enabled on Vercel; legacy `KV_REST_API_*` names are still accepted |
| `BLOB_STORE_ID` | Provider-cache and Smart Money journal persistence | Required with Redis for production Smart Money health; connect the project with OIDC rather than a long-lived read/write token |
| `SEC_USER_AGENT` | Seven enabled Smart Money adapters | Required monitored contact, for example `CommsDashboard/1.0 ops@example.com`; placeholder or unmonitored contacts are rejected before any SEC request |

`SEC_USER_AGENT` must be a sensitive, Production-only, server-side value owned by the deployer. Only bearer-protected scheduled maintenance sends it to the SEC; site visitors and public refresh controls cannot read, supply, or trigger it. Anyone deploying a separate instance must configure a monitored contact they control.

See [docs/commodities-v2-api-spec.md](docs/commodities-v2-api-spec.md) for architecture and rate limits.

## v2 market API routes

| Route | Purpose |
| ----- | ------- |
| `GET /api/prices` | Batched Yahoo daily quotes and history for the full catalogue |
| `GET /api/market/snapshot` | CoinGecko (live) + EIA; legacy Alpha Vantage cache rows are quarantined |
| `GET /api/calendar` | Next 90 days from BLS (with official OMB/OIRA and FRED fallbacks), BEA, and Federal Reserve schedules |
| `GET /api/market/refresh` | Cron: refresh EIA cache and clear retired Alpha Vantage rows (Bearer `CRON_SECRET`) |
| `GET /api/briefing` | Date-partitioned, quota-protected AI briefing grounded in movers, headline sentiment, and Fear & Greed |
| `GET /api/analysis?ticker=NVDA` | Cached, quota-protected technical and AI analysis |
| `GET /api/smart-money` | Latest accepted public research snapshot |
| `GET /api/smart-money/briefing` | Daily three-paragraph research briefing grounded only in accepted public evidence |
| `GET /api/smart-money/history?since=2026-08-01T00%3A00%3A00.000Z&limit=20` | Inclusive, bounded accepted research history (`since` is required) |
| `GET /api/smart-money/health` | Exact health for all seven enabled SEC-backed adapters and both durable stores |
| `GET /api/smart-money/refresh` | Protected Smart Money-only refresh (Bearer `CRON_SECRET`) |

The four Smart Money sub-routes share one dynamic Vercel Function; their public URLs and request contracts remain independent. The dispatcher requires Vercel's normalized `route` value to match the URL pathname, rejects duplicate or mismatched values, and strips that routing metadata before endpoint query validation. An explicit same-value `route` query is indistinguishable from Vercel's injected metadata and is therefore handled as metadata.

The combined market and Smart Money refresh runs at 06:00 and 18:00 UTC (`vercel.json`). The production AI smoke runs daily at 12:17 UTC, forces both generated briefings, validates current evidence, and requires all seven enabled Smart Money providers to be fresh.

## Data trust and resilience

- Daily change is derived from Yahoo's final two valid daily closes, not the start of a multi-day range.
- Alpha Vantage is retired from the enabled market path because its free WTI/Brent feed returned week-old EIA/FRED spot observations for instruments represented in the dashboard as current oil futures. WTI (`CL`) and Brent (`BZ`) therefore remain on the fresh Yahoo futures baseline; legacy Alpha Vantage cache rows are ignored and scheduled refresh makes no Alpha Vantage request.
- EIA Henry Hub remains a daily observation series even though EIA publishes it weekly; its observation-age allowance is 12 days to cover publication lag and holidays.
- Yahoo symbols are fetched in 20-symbol batches, cutting the normal price refresh to 14 upstream requests for all 268 assets.
- The supplemental market snapshot returns only source-tagged CoinGecko/EIA rows and reports live, stale, missing, and fallback coverage explicitly. Static catalogue anchors are never exposed as live provider observations.
- General and per-asset news reject undated, future-dated, and more-than-seven-day-old articles. The briefing applies a stricter 72-hour headline boundary, and the UI drops its LIVE claim after a failed or expired news refresh while retaining the last good headlines visibly.
- The economic calendar has no static event fallback, consensus forecast, or invented prior values. Direct BLS schedules are preferred; if that network path fails, the dashboard uses the official OMB/OIRA Principal Federal Economic Indicators schedule hosted by Census and then FRED as a final fallback. OMB/OIRA dates are explicitly labelled `Date only` because its BLS table does not publish a time. Event titles link only when an exact human-readable release page is available; provider-wide subscriptions and schedule documents are labelled separately. Partial provider failure is shown as degraded rather than live.
- News, per-asset news, history, sentiment, market, AI, and Smart Money upstream calls all have bounded deadlines and safe public errors.
- The UI reports `LIVE`, `DEGRADED`, or `STALE` from the effective displayed coverage. A complete fresh Yahoo feed keeps the dashboard live when an optional provider overlay is stale; stale overlays are rejected rather than shown. Mock fallback rows remain visible but are excluded from movers, heatmaps, and alerts.
- Provider requests time out and partial failures preserve usable or last-known-good data.
- Briefings use a UTC market-date cache partition and preserve their true generation/input timestamps. Stale or future-dated sentiment is rejected, and every paragraph must cite validated mover and sentiment evidence before it can be cached. The Refresh button uses a stable, quota-protected no-store route to retrieve the newest shared briefing without serving an older edge-cached response.
- AI calls use distributed semantic caching, cross-instance generation locks, atomic per-client quotas, safe client errors, structured server logs, and a scheduled forced-generation production smoke test. Vercel fails closed if its Redis guard is unavailable.
- Smart Money uses only reviewed free public sources. SEC filing dates, effective dates, observation dates, and retrieval dates remain distinct; unverified performance is never presented as success. No rights-cleared free crypto-whale leaderboard is currently enabled.
- Smart Money simulation is deliberately fail-closed and research-only because no free source passed the full retrieval, retention, public-display, and derived-simulation rights gate. The dashboard has no order, broker, exchange, wallet, signing, or credential capability and cannot prepare or execute trades.

## Verify

```bash
npm test
npm run build
npm audit
npm run smoke:production -- https://comms-dashboard-navy.vercel.app
npm run smoke:ai -- https://comms-dashboard-navy.vercel.app NVDA
npm run test:e2e:production
```

CI repeats the build and test suite on Node 22 and Node 24, plus a production-dependency security audit, on every push and pull request. The daily exact-commit production release smoke verifies all public data routes, forced AI generation, provider freshness, every dashboard view, and mobile/tablet/desktop overflow and runtime health.

## Tabs

- **Overview** — hero stats, evidence-backed daily market briefing, Smart Money pulse, top movers, headlines
- **Prices** — full asset table, charts, AI analysis
- **Currency** — 40+ FX pairs
- **Portfolio** — holdings and explicit research-only simulation readiness
- **Intel** — freshness-bounded RSS headlines, an official live economic calendar, plus Smart Money people, firms, SEC-backed institutional flows, provider health, and public findings
