# Commodities Dashboard v2 — Live API Wiring (Proposal)

**Status:** Historical implementation spec — the feature is now implemented; use the root `README.md` for current operations
**Live app:** https://comms-dashboard-navy.vercel.app/  
**Parent context:** Vault `wiki/projects/commodities-dashboard.md`, `commodities-dashboard-v2.md`  
**Feature flag:** `VITE_USE_LIVE_DATA=true` (Yahoo baseline plus v2 overlays; Yahoo-only when false)

---

## Executive summary

Wire three providers behind a **Vercel BFF** (`/api/market/*`) with **server-side caching**. Do **not** call Alpha Vantage from the browser on every ticker poll — the free tier allows **25 requests/day**, which is exhausted in minutes if the UI polls 20+ symbols.

**Phase 1 scope (this spec):** Replace **spot prices and % change** for crypto, listed commodities, and US energy benchmarks. **Phase 2 (out of scope here):** equities in the ticker, full PRICES-tab history, currency FX, corridor map, portfolio positions, AI briefing.

---

## 1. Endpoints to hit

### 1.1 CoinGecko — crypto (client or BFF)

| Use case | Method | URL | Query / body |
|----------|--------|-----|----------------|
| Ticker + heatmap crypto rows | `GET` | `https://api.coingecko.com/api/v3/simple/price` | `ids=bitcoin,ethereum,solana,...` (map from `mockData` symbol → CoinGecko `id`), `vs_currencies=usd`, `include_24hr_change=true`, `include_last_updated_at=true` |
| Optional: ranked list for “most active” crypto | `GET` | `https://api.coingecko.com/api/v3/coins/markets` | `vs_currency=usd`, `order=volume_desc`, `per_page=20`, `page=1`, `sparkline=false`, `price_change_percentage=24h` |
| PRICES tab history (Phase 1b) | `GET` | `https://api.coingecko.com/api/v3/coins/{id}/market_chart` | `vs_currency=usd`, `days=7|30|90|365` — **one id per request** |

**Auth header (optional):** `x-cg-demo-api-key: <COINGECKO_API_KEY>` when using Demo plan.

**Symbol map (maintain in `src/lib/symbolMaps.ts`):**

| UI label | CoinGecko `id` |
|----------|----------------|
| BTC | `bitcoin` |
| ETH | `ethereum` |
| SOL | `solana` |
| … | align to whatever `mockData.js` lists |

---

### 1.2 Alpha Vantage — commodities (BFF only, cached)

Base: `https://www.alphavantage.co/query`

| Use case | `function` | Params | Notes |
|----------|------------|--------|-------|
| WTI crude (`CL`) | `WTI` | `interval=daily`, `outputsize=compact` | Wired; `data` array → latest daily spot proxy |
| Brent (`BZ`) | `BRENT` | same | Wired |
| Copper / wheat / corn | `COPPER`, `WHEAT`, `CORN` | monthly/quarterly/annual only | **Not wired:** global-price units and cadence do not match `HG`/`ZW`/`ZC` futures; Yahoo stays authoritative |
| Aggregated refresh (optional) | `ALL_COMMODITIES` | `interval=monthly` | **Not** for ticker; useful for macro chart only |

**Every request:** `apikey=<ALPHA_VANTAGE_API_KEY>`

**Response shape:** JSON with `name`, `interval`, `unit`, `data: [{ date, value }]`. Map `value` → price; % change = `(last - prev) / prev * 100`.

**Not in Phase 1 (rate budget):** `GLOBAL_QUOTE` for equities — 1 symbol = 1 daily request; a 15-symbol ticker would consume 60% of the free daily quota in one refresh.

---

### 1.3 EIA Open Data API v2 — energy (BFF only, cached)

Base: `https://api.eia.gov/v2/`  
**Every request:** `api_key=<EIA_API_KEY>` (query param)

| Use case | Route | Example facets / params |
|----------|-------|-------------------------|
| Petroleum spot / rack prices | `GET /petroleum/pri/spt/data/` | `frequency=daily`, `data[0]=value`, `sort[0][column]=period`, `sort[0][direction]=desc`, `length=2` (for % change), facets for `product`, `area` per [EIA petroleum pri docs](https://www.eia.gov/opendata/documentation.php) |
| Henry Hub spot (wired) | `GET /natural-gas/pri/fut/data/` | `frequency=daily`, `facets[series][]=RNGWHHD`, same sort and `length=2` pattern |
| STEO / outlook (optional, INTEL) | `GET /steo/data/` | Low priority; monthly series |

**Wired series:** `RNGWHHD`, Henry Hub natural-gas spot (`NG`, $/MMBtu). The API returns daily observations, but EIA publishes this series weekly. Keep `frequency=daily` and allow observations up to 12 days old so normal publication lag, weekends, and holidays do not create false staleness.

**Pagination:** use `offset` / `length`; default page size can be large — always request `length=2` for spot + prior period only.

---

### 1.4 Proposed BFF surface (Vercel serverless)

Single consumer for the React app — hides keys and enforces cache headers.

| Route | Upstream | Cache-Control |
|-------|----------|---------------|
| `GET /api/market/snapshot` | CoinGecko `simple/price` + merged AV + EIA rows from edge cache | `s-maxage=300, stale-while-revalidate=600` (5 min) |
| `GET /api/market/history?symbol=WTI&range=1M` | AV commodity or CoinGecko `market_chart` | `s-maxage=3600` (1 h) |
| `GET /api/market/refresh` (cron, optional) | Pull all AV functions once, write to Vercel KV / blob / `public/data/market-snapshot.json` at build | Run **2×/day** max on free AV |

**Cron strategy (required for Alpha Vantage free tier):**

1. Vercel Cron hits `/api/market/refresh` at 06:00 and 18:00 UTC.
2. Refresh job calls exactly **2** AV `function=` endpoints per run (`WTI`, `BRENT`), or 4 requests/day.
3. CoinGecko snapshot can run every 5 min (separate, cheaper).
4. EIA refresh piggybacks on the twice-daily AV cron; its daily observations publish weekly.

---

## 2. Rate limit constraints

| Provider | Documented limit | Practical budget for this app |
|----------|------------------|-------------------------------|
| **CoinGecko** (public) | Dynamic IP throttle; often cited ~10–30 calls/min | BFF: 1 call per snapshot (batch all `ids` in one `simple/price`). Max ~288 calls/day at 5 min polling — use Demo key if throttled. |
| **CoinGecko** (Demo API key) | ~30 calls/min | Recommended for production ticker. |
| **Alpha Vantage** (free) | **25 requests/day**, **5 requests/minute** | **4 AV calls/day** via two-series cron refresh; **zero** per-page client calls. Dev: mock or replay `public/data/av-cache.json`. |
| **EIA** | ~9,000 requests/hour sustained; burst &lt;5 req/sec | 1–3 calls per snapshot refresh; safe to poll hourly. |

**Failure modes:**

- AV returns `"Note": "Thank you for using Alpha Vantage..."` → treat as rate limit; serve last cached snapshot; show stale badge in UI.
- CoinGecko 429 → backoff 60s; fall back to mock for crypto row only.
- EIA 403/invalid key → disable energy rows; log once.

---

## 3. Live data vs mock data

Source of truth today: **`mockData.js`** (single file). Target: **`src/hooks/useMarketData.ts`** (or React Query) merges live snapshot + mock fallbacks.

### Replaced by live APIs (Phase 1)

| UI surface | Mock field(s) (typical) | Live source |
|----------|-------------------------|-------------|
| Scrolling **ticker** | `tickerItems[].price`, `change`, `changePercent` | CoinGecko (crypto ids), AV (`WTI`, `BRENT`), EIA (`RNGWHHD` Henry Hub spot) |
| **Sector heatmap** | sector rows with `% change` | Derive from same snapshot where symbol maps; unmapped sectors stay mock |
| **Top gainers / losers / most active** | sorted lists built from mock | Recompute client-side from snapshot; cap lists at symbols we actually fetch |
| **PRICES tab** — spot label | latest point in mock series | Last point from AV `compact` or EIA `length=2` |
| **PRICES tab** — full history chart | `history[]` per commodity | **Phase 1b** only: AV daily series or CoinGecko `market_chart`; until then keep mock series with live **last price** dot |

### Stays mock (Phase 1)

| UI surface | Reason |
|----------|--------|
| **Equities** in ticker (e.g. AAPL, NVDA) | Not assigned to CoinGecko/EIA; AV `GLOBAL_QUOTE` blows 25/day quota |
| **HG / ZW / ZC spot overlay** | AV global-price cadence/units do not match the dashboard futures; Yahoo remains authoritative |
| **PORTFOLIO** tab positions & P/L | User-specific; no API in scope |
| **CURRENCY** tab (40+ FX pairs) | No FX provider in scope; optional later AV `CURRENCY_EXCHANGE_RATE` |
| **Corridor cards** + **SVG map** | Requires Marine Traffic / manual admin — not in three APIs |
| **Route cost calculator** | Freight model not in APIs |
| **News / INTEL headlines** | Already live (RSS) per vault audit — do not regress |
| **AI Market Briefing** | LLM-generated; separate server-only `GROQ_API_KEY` |
| **Alerts panel** (pre-seeded) | User thresholds = Phase 2 feature |
| **Command palette** metadata | Static |

### Feature-flag behaviour

```text
VITE_USE_LIVE_DATA=false  → batched Yahoo /api/prices; explicit mock fallback for missing rows
VITE_USE_LIVE_DATA=true   → Yahoo baseline + /api/market/snapshot overlay; explicit mock fallback for missing rows
```

Show **“LIVE” / “DEGRADED” / “STALE”** from freshness, provider health, and symbol coverage. Mock rows never participate in rankings or alerts.

---

## 4. API keys needed

| Secret | Env var (Vercel + local `.env`) | Required? | Register |
|--------|-----------------------------------|-----------|----------|
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY` | **Yes** (commodities) | https://www.alphavantage.co/support/#api-key |
| EIA | `EIA_API_KEY` | **Yes** (energy) | https://www.eia.gov/opendata/register.php |
| CoinGecko Demo | `COINGECKO_API_KEY` | Optional (recommended prod) | https://www.coingecko.com/en/api/pricing |
| — | `VITE_USE_LIVE_DATA` | Yes (build-time) | `true` / `false` |
| — | `CRON_SECRET` | Yes if cron refresh | Random string; validate on `/api/market/refresh` |
| Upstash Redis | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Required for production AI; optional for market-cache redundancy alone | Vercel Marketplace / Upstash |
| Vercel Blob | `BLOB_STORE_ID` + platform OIDC | Optional | Connect a Blob store to the Vercel project; avoid long-lived read/write tokens |

**Never** expose AV or EIA keys in Vite `VITE_*` client bundles — server routes only.

---

## 5. Implementation checklist (for Cursor build session)

1. Clone or link the deployed app source into `comms-dashboard/` (repo not found locally as of 2026-05-24).
2. Add `api/market/snapshot.ts` + `api/market/refresh.ts` (Vercel functions).
3. Add `src/lib/symbolMaps.ts` + `src/lib/normalizeMarket.ts` (provider JSON → internal `TickerItem` shape).
4. Replace direct `mockData` imports in ticker / heatmap / gainers with `useMarketData()`.
5. Add `vercel.json` cron + env docs in `README.md`.
6. Verify on preview: ticker shows LIVE chip; disconnect AV key → stale mock fallback without white screen.

---

## 6. Acceptance criteria

- [ ] With `VITE_USE_LIVE_DATA=true`, crypto plus WTI, Brent, and Henry Hub show provider spot prices; HG, ZW, and ZC remain Yahoo-authoritative.
- [ ] No Alpha Vantage calls from browser DevTools Network tab on idle page.
- [ ] Full page reload &lt; 25 AV requests per 24h in production (cron-only).
- [ ] `VITE_USE_LIVE_DATA=false` returns a complete, fresh Yahoo baseline or explicitly reports degraded coverage.
- [ ] API keys absent in client bundle (`grep` build output).

---

## 7. Risks & decisions

| Risk | Mitigation |
|------|------------|
| AV 25/day unusable for multi-symbol polling | Cron + server cache only |
| AV global copper/grain series mismatch futures | Limit AV overlays to daily WTI/Brent; retain Yahoo for HG/ZW/ZC |
| EIA daily Henry Hub observations publish weekly | Keep `frequency=daily`; allow 12 days of observation age |
| Duplicate WTI/Brent from AV and EIA | Pick one canonical source per symbol in `symbolMaps` |
| CoinGecko id drift | Central map file; unit test ids resolve |
| Provider symbol drift | Central symbol catalogue plus live smoke and regression tests |

---

*Spec author: Cursor · 2026-05-24*
