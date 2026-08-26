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
  `{ schemaVersion: 1, refreshStartedAt, publicSnapshot, adapterState, stateDigest }`.
  Public routes validate the envelope and return only `publicSnapshot`.
- `stateDigest` is an internally computed stable SHA-256 binding over the
  complete canonical private envelope except the digest itself, including
  `schemaVersion`, `refreshStartedAt`, the public snapshot, and private adapter
  state. Validation also enforces
  exact child ID/group/enabled/status/source/count coherence, so swapped or
  mismatched public/private children fail closed.
- `adapterState` is an exact seven-child canonical schema containing only
  normalized SEC/institutional source records, normalized status, and pending
  confirmations. HTTP bodies, transport errors, and secrets are rejected.
- Production refresh order is rights, accepted previous state, durable raw
  candidate recovery, due-provider
  `Promise.allSettled`, LKG/freshness normalization, deterministic derivation,
  unavailable reference-price evidence, an empty completed-day mark set,
  durable staged journal, durable raw snapshot candidate, then one idempotent
  final accepted-generation CAS that atomically binds the snapshot digest,
  accepted private snapshot, journal generation, signal IDs, and daily-mark
  IDs. Both the public snapshot route and history read only through that final
  record; raw candidates and staged rows are never public. A marker failure
  leaves the previous accepted LKG visible, and a retry finalizes the exact
  durable staged candidate without provider calls or re-derivation. Failed or
  superseded snapshot writes publish none. Provider normalization and
  publication validation use trusted post-I/O completion times while
  `refreshStartedAt` remains the invocation/CAS generation.
- Production enables only SEC EDGAR and the six institutional SEC adapters.
  Polymarket and Hyperliquid remain dormant/link-only and receive no production
  network calls.
- The six institutional adapters select the latest aligned 10-Q/10-K tuple from
  the configured registrant's SEC submissions JSON by strictly validated
  report/filing dates independent of row order. A malformed newest tuple fails
  before archive transport instead of falling back. They then fetch exactly that
  filing's primary archive HTML through the shared fair-access scheduler with a
  5 MB hard cap. Filing-agent accession prefixes are accepted; the submissions
  CIK and registrant archive directory remain exact bindings.
- Fixed structural inline-XBRL profiles bind entity CIK, instant report date,
  concept, unit, scale, exact explicit/typed dimensions, and the reviewed
  profile-specific table/row/sentence container,
  and identical duplicates. Comparison-period and wrong-dimension contexts are
  filtered before target unit/scale/conflict validation; absent scale defaults
  to zero as required by inline XBRL.
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
  exposes enabled/retrieval/freshness/cache-age fields and only explicitly
  allowlisted typed provider error codes—not raw error detail. Protected refresh
  is GET-only, and history validates decoded cursor IDs with the journal's
  canonical ID validator before storage.
- SEC EDGAR `sourceAsOf` is the latest accepted authoritative 13F `periodEnd`
  and is preserved on LKG failure; retrieval freshness remains independently
  based on `retrievedAt`.
- Publication metadata uses schema version 2. Successful publication removes
  the generation from staging; pruning compacts expired accepted IDs and
  removes abandoned staging after a seven-day retry grace while retaining
  in-grace retry work and the current accepted generation.

## Review fix round 1 TDD evidence

Focused RED runs were made before each production fix:

- Journal/refresh: the new staged-publication tests failed on missing
  `stageJournal`/`publishJournalGeneration` exports and missing publication
  ordering/failure behavior.
- SEC: `node --test test/smart-money-sec.test.js` exited `1` with 16 passed and
  7 failed. Failures covered comparison-context contamination, wrong
  dimensions/default scale, official `text/html` rejection, older-filing
  fallback, and profile drift.
- Private envelope/child isolation: `node --test test/smart-money-refresh.test.js`
  first exited `1` because `buildSmartMoneyPrivateSnapshot` did not exist, then
  exposed malformed-child sibling isolation until fixed.
- APIs/health/cursor: `node --test test/smart-money-api.test.js` exited `1` with
  16 passed and 4 failed for noncanonical decoded cursor IDs, POST refresh,
  missing health fields, and unknown error-code leakage.

The corresponding focused GREEN runs were journal 24/24, refresh 28/28, SEC
23/23, and API 20/20.

## Reviewed SEC filing evidence

- Strategy: https://www.sec.gov/Archives/edgar/data/1050446/000105044626000044/mstr-20260630.htm
- Tesla: https://www.sec.gov/Archives/edgar/data/1318605/000162828026049270/tsla-20260630.htm
- IBIT: https://www.sec.gov/Archives/edgar/data/1980994/000143774926026004/bit20260630c_10q.htm
- FBTC: https://www.sec.gov/Archives/edgar/data/1852317/000119312526337679/ck0001852317-20260630.htm
- ARKB: https://www.sec.gov/Archives/edgar/data/1869699/000121390026086191/ea0299118-10q_ark21shares.htm
- BITB: https://www.sec.gov/Archives/edgar/data/1763415/000119312526340183/bitb-20260630.htm

The SEC FAQ supporting filing-agent accession handling is
https://www.sec.gov/about/webmaster-frequently-asked-questions.

Live probes on 2026-08-26 used the identified
`CommsDashboard/1.0 compliance@monitored-contact.co` User-Agent and retained
only these bounded summaries (never filing bodies):

- Strategy: HTTP 200 `text/html`, 2,814,628 bytes; 846,000 BTC and
  $49,672,080,000.
- Tesla: HTTP 200 `text/html`, 1,573,323 bytes; 11,509 BTC and no BTC-specific
  reported USD value.
- IBIT: HTTP 200 `text/html`, 626,623 bytes; 734,261 BTC and $43,395,920,710.
- FBTC: HTTP 200 `text/html`, 946,973 bytes; 174,383 BTC and $10,306,297,000.
- ARKB: HTTP 200 `text/html`, 358,089 bytes; 32,178.2280 BTC and
  $1,889,314,000.
- BITB: HTTP 200 `text/html`, 1,186,417 bytes; 36,207.6919 BTC and
  $2,125,990,000.

## Review fix round 2 TDD evidence

All new regressions were written before the round-2 production changes. The
combined RED command was:

```text
node --test test/smart-money-journal.test.js test/smart-money-store.test.js test/smart-money-sec.test.js test/smart-money-refresh.test.js test/smart-money-api.test.js
```

It exited `1`: 48 tests were discovered, 43 passed, and 5 failed. Journal,
refresh, and store suites failed to load because the new authoritative accepted
snapshot and durable-candidate exports did not exist; the SEC relocation and
row-order regressions both failed because production accepted the unsafe input.
After implementation, the same focused set reached 122/122 (the first GREEN
attempt exposed and corrected a test harness that injected failure into staging
instead of the final acceptance write).

Round-2 live probes were rerun through `fetchSecInstitutionalDisclosure` and
the shared bounded production transport. All six returned the cited current
2026-06-30 filing facts: Strategy 846,000 / $49,672,080,000; Tesla 11,509 /
null; IBIT 734,261 / $43,395,920,710; FBTC 174,383 / $10,306,297,000; ARKB
32,178.2280 / $1,889,314,000; and BITB 36,207.6919 / $2,125,990,000. Only
these bounded summaries and the already listed official archive links were
recorded; no filing body was retained.

The acceptance regressions call both public snapshot and history handlers.
They prove that both remain on the prior accepted generation after a final-CAS
failure, then expose the same signal only after an idempotent retry, with no
second provider fetch or signal derivation. Separate coverage simulates a
committed acceptance write whose response is lost and verifies the reread is
treated as durable.

## Final verification

- Provider Core focused command after review fixes: exit `0`; 227 tests, 227
  passed, 0 failed.
- `npm test`: exit `0`; 351 Node unit tests plus 33 UI tests, 384 total,
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

## Review fix round 2 final verification

- Provider Core focused command: exit `0`; 235 tests, 235 passed, 0 failed.
- `npm test`: exit `0`; 359 Node unit tests plus 33 UI tests, 392 total, all
  passed (2/2 UI test files).
- `npm run build`: exit `0`; Vite transformed 623 modules and completed the
  production build.
- `git diff --check`: exit `0`; no whitespace errors. Git emitted only the
  repository's expected LF-to-CRLF working-copy notices.

Round-2 changed scope is limited to the journal/store/refresh acceptance path,
public snapshot and health default readers, SEC institutional structural and
filing selection, the minimized SEC fixtures and focused tests, and this
report. Production still has exactly seven enabled SEC adapters, makes zero
Yahoo/Polymarket/Hyperliquid requests, and contains no trading, order, wallet,
credential, deposit, withdrawal, signing, or allocation-execution path.
