# Task 8 report — Smart Money orchestration and APIs

## TDD RED

Command (run once before production implementation):

```text
node --test test/smart-money-refresh.test.js test/smart-money-api.test.js test/smart-money-no-trading.test.js
```

Exit code: `1`

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\User\Documents\Projects\active\CommsDashboard\.worktrees\smart-money-intelligence\api\smart-money.js'
...
✖ test\smart-money-api.test.js
✖ every Smart Money library and API module exposes no trading or credential capability
✔ dormant Polymarket and Hyperliquid production entries make zero network calls
✔ captured enabled transport origins and payloads contain no trading or secret query data
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\User\Documents\Projects\active\CommsDashboard\.worktrees\smart-money-intelligence\lib\smart-money\refresh.js'
...
✖ test\smart-money-refresh.test.js
ℹ tests 5
ℹ suites 0
ℹ pass 2
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 99.8216
```

The no-trading import audit also failed with `ENOENT` for the not-yet-created
`api/smart-money` directory. These are the expected missing-module failures;
no production Task 8 module existed at this point.

## Implementation notes

- The durable accepted state is an exact private envelope:
  `{ schemaVersion: 1, refreshStartedAt, publicSnapshot, adapterState }`.
  Public routes validate the envelope and return only `publicSnapshot`.
- `adapterState` is an exact seven-child canonical schema containing only
  normalized SEC/institutional source records, normalized status, and pending
  confirmations. HTTP bodies, transport errors, and secrets are rejected.
- Production refresh order is rights, accepted previous state, due-provider
  `Promise.allSettled`, LKG/freshness normalization, deterministic derivation,
  unavailable reference-price evidence, an empty completed-day mark set,
  durable journal, then durable accepted snapshot. Provider normalization and
  publication validation use trusted post-I/O completion times while
  `refreshStartedAt` remains the invocation/CAS generation.
- Production enables only SEC EDGAR and the six institutional SEC adapters.
  Polymarket and Hyperliquid remain dormant/link-only and receive no production
  network calls.
- The six institutional adapters select the latest aligned 10-Q/10-K tuple from
  the configured registrant's SEC submissions JSON, then fetch exactly that
  filing's primary archive HTML through the shared fair-access scheduler with a
  5 MB hard cap. Filing-agent accession prefixes are accepted; the submissions
  CIK and registrant archive directory remain exact bindings.
- Fixed structural inline-XBRL profiles bind entity CIK, instant report date,
  concept, unit, scale, dimensions/table anchors, and identical duplicates.
  Nil, negative, conflicting, nonfinite, context-drifted, or structurally
  changed facts fail closed.
- Tesla's reviewed filing reports exactly 11,509 BTC without a BTC-specific USD
  value. The adapter remains live with `reportedValueUsd: null`, its public
  activity carries a visible caveat, and it cannot create a material signal or
  paper eligibility from aggregate digital-asset values.
- Yahoo Finance spark is explicitly excluded by the Smart Money rights policy.
  Production makes zero Yahoo calls, retains no Yahoo response/reference price
  or daily mark, and therefore leaves all paper entry unavailable. The raw
  `SYMBOLS`/spark validator remains only as an injected pure test seam; it is not
  a production dependency: production defaults have no Yahoo import or call
  path, and the seam calls no internal public HTTP route. The exclusion is based
  on Yahoo's general terms and API terms of use:
  https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html and
  https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html.
- The seven enabled SEC/institutional adapters are research-only. Until a
  separately reviewed market-data source is affirmatively permitted, missing
  reference-price evidence cannot be fabricated and no paper position becomes
  eligible.
- Partial provider failure is isolated by provenance: a failed/LKG source emits
  no change or signal, while valid signals from successfully settled siblings
  remain eligible for the durable transaction. A skipped/superseded snapshot
  CAS remains nondurable and reports no accepted signal.
- Health recomputes accepted provider freshness against its wall clock, keeps
  the exact seven canonical children even when rights are invalid/expired, and
  exposes only allowlisted typed provider error codes—not raw error detail.

## Reviewed SEC filing evidence

- Strategy: https://www.sec.gov/Archives/edgar/data/1050446/000105044626000044/mstr-20260630.htm
- Tesla: https://www.sec.gov/Archives/edgar/data/1318605/000162828026049270/tsla-20260630.htm
- IBIT: https://www.sec.gov/Archives/edgar/data/1980994/000143774926026004/bit20260630c_10q.htm
- FBTC: https://www.sec.gov/Archives/edgar/data/1852317/000119312526337679/ck0001852317-20260630.htm
- ARKB: https://www.sec.gov/Archives/edgar/data/1869699/000121390026086191/ea0299118-10q_ark21shares.htm
- BITB: https://www.sec.gov/Archives/edgar/data/1763415/000119312526340183/bitb-20260630.htm

The SEC FAQ supporting filing-agent accession handling is
https://www.sec.gov/about/webmaster-frequently-asked-questions.

## Final verification

- Provider Core focused command: exit `0`; 214 tests, 214 passed, 0 failed.
- `npm test`: exit `0`; 338 Node unit tests plus 33 UI tests, 371 total,
  all passed (2/2 UI test files).
- `npm run build`: exit `0`; Vite transformed 623 modules and completed the
  production build.
- `git diff --check`: exit `0`; no whitespace errors. Git emitted only the
  repository's expected LF-to-CRLF working-copy notices.

Self-review confirmed exact public response allowlists, private-envelope
stripping and validation, factory-only dependency injection, SEC-only
production provider fetch origins, exact server-side Bearer secret handling,
zero production Yahoo/Polymarket/Hyperliquid calls, and no trading, order,
allocation, signing, deposit, withdrawal, wallet, exchange, or credential
capability.
