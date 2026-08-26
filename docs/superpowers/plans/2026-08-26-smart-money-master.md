# Smart Money Intelligence Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Deliver, deploy, and production-verify the approved Smart Money Intelligence, daily Smart Money Pulse, and no-trading paper simulation.

**Architecture:** A separate Smart Money subsystem ingests permitted public evidence into a normalized, durable snapshot and signal journal. Intel is the research hub, Overview is the daily summary surface, Portfolio owns browser-local simulations, and existing market health remains isolated.

**Tech Stack:** Node.js 22, Vercel Functions, React 18, Vite 8, Vitest, Node test runner, Upstash Redis, Vercel Blob, Groq, Tailwind CSS, Playwright, SEC EDGAR, Polymarket Data API, and Hyperliquid public data APIs.

**Spec:** docs/superpowers/specs/2026-08-26-smart-money-intelligence-design.md

## Global Constraints

- Use only sources whose current official terms permit every enabled retrieval, cache, derivation, retention, attribution, and display operation at no data-provider cost.
- Keep the source-rights gate fail-closed; public reachability alone is insufficient.
- Never hold trading credentials, construct orders, sign wallets, route transactions, or expose an execution endpoint.
- Preserve the existing five-item primary and mobile navigation.
- Keep Smart Money status independent from LiveData market LIVE, DEGRADED, PARTIAL, or OFFLINE state.
- Every configured concrete adapter, not merely each provider group, must be LIVE and non-empty at release.
- SEC filings retain reporting-period, filed-date, amendment, and lag semantics; no 13F record is described as live.
- Anonymous crypto accounts remain provider-scoped and anonymous.
- Polymarket performance and Hyperliquid performance remain separate and non-comparable.
- Paper Copy starts only after a user opts in and uses the first trusted price at or after signal observation.
- Paper state, followed entities, and notification preferences remain browser-local.
- Smart Money Pulse always returns exactly three evidence-grounded paragraphs for the current UTC date, with a deterministic fallback.
- Existing market briefing, live prices, alerts, holdings, and news behavior must keep passing their regression tests.
- Preserve the pre-existing untracked cursor-handoff.md file.

---

## Ordered Plan Set

1. **Provider Core:** docs/superpowers/plans/2026-08-26-smart-money-provider-core.md
   - Rights matrix, registry, transports, free adapters, normalization, signals, durable store, journal, and public APIs.
2. **Intelligence Experience:** docs/superpowers/plans/2026-08-26-smart-money-intelligence-experience.md
   - Shared market context, daily briefing, SmartMoneyProvider, Intel hub, Overview Pulse, routing, and notifications.
3. **Paper Simulation:** docs/superpowers/plans/2026-08-26-smart-money-paper-simulation.md
   - Pure simulation engine, versioned local persistence, offline reconciliation, Portfolio view, undo, export, and import.
4. **Production Release:** docs/superpowers/plans/2026-08-26-smart-money-production-release.md
   - Shared cron, source-rights build gate, production smoke, responsive tests, documentation, deployment, and verification evidence.

Plans execute in that order. Provider Core publishes the server contracts consumed by both later feature plans. Intelligence Experience mounts the client provider used by Paper Simulation. Production Release runs only after the first three plans pass their focused tests.

## Canonical Cross-Plan Contracts

Provider Core produces schemaVersion 1 envelopes:

```js
{
  schemaVersion: 1,
  ok: true,
  fetchedAt: '2026-08-26T00:00:00.000Z',
  partial: false,
  entities: [],
  activities: [],
  performances: [],
  signals: [],
  rankings: {
    investors: [],
    crypto: {
      polymarket: { month: [] },
      hyperliquid: { month: [], allTime: [] }
    }
  },
  providerStatuses: [],
  warnings: [],
  sourceLinks: []
}
```

Every entity uses this exact directory shape. `directoryCategory` is required;
it is never inferred in a component:

```js
{
  id: 'leopold-aschenbrenner',
  displayName: 'Leopold Aschenbrenner',
  legalEntity: null,
  actorType: 'person',
  directoryCategory: 'investors',
  strategyTags: [],
  people: [],
  relatedEntityIds: ['situational-awareness-lp'],
  officialUrls: [],
  identity: {
    status: 'verified',
    confidence: 'high',
    provider: 'official_publication',
    verifiedAt: '2026-08-26T00:00:00.000Z'
  },
  evidenceCoverage: [],
  performanceVerification: { status: 'not_publicly_verified' },
  lastCheckedAt: '2026-08-26T00:00:00.000Z',
  caveats: []
}
```

`directoryCategory` is exactly one of `investors`, `firms`, `crypto-traders`,
or `institutional-flows`. People map to investors; ordinary investment
organizations map to firms; provider-scoped venue accounts map to
crypto-traders; treasury and ETF disclosure entities map to
institutional-flows.

Every returned performance record uses this exact provider-scoped shape:

```js
{
  id: 'hyperliquid:0xabc:month:2026-08-26',
  entityId: 'hyperliquid:0xabc',
  providerId: 'hyperliquid-leaderboard',
  venue: 'hyperliquid',
  scope: 'account',
  accountValueUsd: 1500000,
  windows: {
    day: null,
    month: { pnlUsd: 20000, roiPct: 4, volumeUsd: 6000000 },
    allTime: { pnlUsd: 100000, roiPct: 20, volumeUsd: 20000000 }
  },
  methodology: 'provider_reported',
  sourceAsOf: null,
  retrievedAt: '2026-08-26T00:00:00.000Z',
  freshnessBasis: 'retrieval_time',
  notComparableAcrossProviders: true
}
```

Every signal uses this exact public shape:

```js
{
  id: 'provider:stable-id',
  entityId: 'provider:entity-id',
  activityId: 'provider:activity-id',
  kind: 'position_change',
  action: 'open',
  asset: {
    ticker: 'BTC',
    name: 'Bitcoin',
    providerSymbol: 'BTC',
    assetClass: 'crypto',
    supported: true
  },
  direction: 'long',
  magnitude: { value: 100000, unit: 'usd_notional' },
  positionChange: {
    previousNotionalUsd: 0,
    currentNotionalUsd: 100000,
    deltaNotionalUsd: 100000
  },
  effectiveAt: '2026-08-26T00:00:00.000Z',
  disclosedAt: null,
  observedAt: '2026-08-26T00:05:00.000Z',
  delaySeconds: 300,
  providerId: 'hyperliquid-account-details',
  sourceUrl: 'https://app.hyperliquid.xyz/explorer/address/0x0000000000000000000000000000000000000000',
  sourceGrade: 'provider_reported',
  identityStatus: 'anonymous',
  confidence: 'high',
  thresholdVersion: 'smart-money-v1',
  notificationEligibility: { eligible: true, reason: 'material_confirmed_change' },
  paperEligibility: { eligible: true, reason: 'supported_reference_price' },
  referencePrice: {
    ticker: 'BTC',
    price: 100000,
    currency: 'USD',
    source: 'yahoo',
    asOf: '2026-08-26T00:05:00.000Z',
    retrievedAt: '2026-08-26T00:05:01.000Z'
  },
  freshness: 'fresh'
}
```

`action` is exactly `open`, `increase`, `reduce`, `close`, `reverse`, or
`observe`. A paper-eligible signal must use one of the first five actions and a
non-null `positionChange`; `observe` is research-only. `asset.assetClass` is
exactly `equity`, `crypto`, `fund`, `prediction-market`, or `other`. These fields
drive lot transitions and applicable S&P 500/Bitcoin benchmarks and must be
validated by Provider Core rather than inferred in the browser.

History uses this exact envelope and exact daily-mark shape:

```js
{
  schemaVersion: 1,
  ok: true,
  fetchedAt: '2026-08-26T00:10:00.000Z',
  partial: false,
  since: '2026-08-25T00:00:00.000Z',
  through: '2026-08-26T00:10:00.000Z',
  entities: [],
  signals: [],
  dailyMarks: [{
    id: '2026-08-26:BTC',
    date: '2026-08-26',
    ticker: 'BTC',
    assetClass: 'crypto',
    kind: 'asset',
    price: 100000,
    currency: 'USD',
    source: 'yahoo',
    asOf: '2026-08-26T20:00:00.000Z',
    retrievedAt: '2026-08-26T20:00:01.000Z'
  }],
  nextCursor: null,
  providerStatuses: [],
  warnings: [],
  sourceLinks: []
}
```

Benchmark marks use canonical tickers `SPX` and `BTC` and `kind: 'benchmark'`.
An opaque cursor encodes the last `(observedAt,id)` tuple; `since` is inclusive,
ordering is ascending by the same tuple, and clients must deduplicate stable IDs.

The client provider exports:

```js
export function SmartMoneyProvider({ children })
export function useSmartMoney()
```

The pure paper module exports:

```js
createPaperState({ startingBalance, startedAt })
startPaperStrategy(state, { entityId, startedAt })
stopPaperStrategy(state, { entityId, stoppedAt })
applyPaperSignal(state, signal)
reconcilePaperHistory(state, { signals, dailyMarks })
markPaperState(state, { at, prices, benchmarks })
calculatePaperMetrics(state)
exportPaperState(state)
importPaperState(payload)
```

The canonical inner PaperState always includes `schemaVersion: 1`; the exported
envelope has its own `schemaVersion: 1` and preserves the inner field so an
export/import round trip is exactly equal.

## Execution Gates

- Do not begin Intelligence Experience until Provider Core routes and fixtures pass.
- Do not begin Paper Simulation UI until the pure paper engine and SmartMoneyProvider interfaces agree.
- Do not deploy while any enabled source-rights record is missing, unclear, expired, link-only, or excluded for an operation the adapter performs.
- Do not deploy while any enabled concrete adapter is stale, unavailable, empty, or missing required configuration.
- Do not mark the goal complete until the production deployment commit matches HEAD, all Smart Money and existing market smoke tests pass, and browser inspection confirms the no-trading boundary.
- Server investor rankings use only evidence coverage and freshness. The client applies a stable followed-first partition locally; followed state never reaches the server.

## Specification Coverage Map

| Approved requirement | Implementing plan and tasks |
|---|---|
| Free-source rights and exact entity roster | Provider Core Tasks 1, 3, 4, and 5; Production Release Task 1 |
| Canonical entity categories and provider-scoped performances | Provider Core Tasks 1, 4, and 6; Intelligence Experience Tasks 3 and 4 |
| Bounded transport and sanitized external evidence | Provider Core Task 2 |
| SEC periods, amendments, filing lag, and research-only unmapped holdings | Provider Core Task 3 |
| Provider-separated profitable crypto research | Provider Core Tasks 4 and 6 |
| Concrete institutional health | Provider Core Tasks 5 and 8 |
| Materiality, freshness, identity, and provenance | Provider Core Task 6 |
| Source TTLs and continuously protected refresh | Provider Core Tasks 6 and 8; Production Release Tasks 2 and 3 |
| Durable LKG snapshot, 400-day journal, and post-observation prices | Provider Core Task 7 |
| Actionable signal transitions and exact history/daily marks | Provider Core Tasks 6–8; Paper Simulation Tasks 1 and 2 |
| Snapshot, history, health, and protected refresh APIs | Provider Core Task 8 |
| Current market/sentiment evidence and exactly three daily paragraphs | Intelligence Experience Tasks 1 and 2 |
| Independent client state and shareable routing | Intelligence Experience Task 3 |
| Intel News/Smart Money hub and source evidence | Intelligence Experience Task 4 |
| Overview Pulse, Prices links, and notifications | Intelligence Experience Task 5 |
| Five-item navigation and enforced UI tests | Intelligence Experience Task 6 |
| Sizing, friction, caps, short collateral, and benchmarks | Paper Simulation Task 1 |
| Offline reconciliation, local privacy, reset undo, export, and import | Paper Simulation Task 2 |
| Portfolio Paper Copy interface | Paper Simulation Task 3 |
| No trading or credential surface | Paper Simulation Task 4 |
| Rights build gate, shared cron, production smoke, responsive coverage, docs, and deployment evidence | Production Release Tasks 1–5 |

## Commit Discipline

Each task in each child plan ends with a focused commit. Never stage cursor-handoff.md. Before every commit run git diff --check and the focused command listed in that task. At each plan boundary run npm test and npm run build.
