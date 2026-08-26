# Smart Money Provider Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build the permitted-source registry, normalized free-provider ingestion, durable Smart Money snapshot and signal journal, and read-only public APIs.

**Architecture:** Provider adapters emit private raw snapshots that pass a fail-closed rights gate, strict transport limits, normalization, and source-scoped materiality rules. A protected refresher isolates adapter failures, appends immutable signals with trusted reference prices, and atomically publishes a sanitized snapshot; public handlers only read accepted data.

**Tech Stack:** Node.js 22 ESM, Vercel Functions, node:test, fast-xml-parser, cheerio, native fetch, Upstash Redis, Vercel Blob, SEC EDGAR, Polymarket Data API, and Hyperliquid public data APIs.

**Spec:** docs/superpowers/specs/2026-08-26-smart-money-intelligence-design.md

## Global Constraints

- Only no-cost sources with affirmative current rights records may be enabled.
- Fail closed before network access when a rights record is missing, unclear, expired, link-only, or excludes a planned operation.
- Keep person records separate from legal reporting entities.
- Never infer a dashboard ticker from an issuer name or CUSIP; unsupported SEC holdings remain research-only.
- Never merge P&L across Polymarket and Hyperliquid.
- A large transfer is not a trade and cannot create a paper signal.
- Hyperliquid leaderboard ingestion is protected maintenance work, never request-time work.
- Public APIs strip adapterState and raw source bodies.
- Concrete adapter health is authoritative; group health is only a rollup.
- No server module may expose an order, signing, deposit, withdrawal, or execution operation.

---

### Task 1: Add the fail-closed source-rights matrix and entity registry

**Files:**
- Create: config/smart-money-source-rights.json
- Create: lib/smart-money/rights.js
- Create: lib/smart-money/entities.js
- Create: docs/smart-money-source-rights.md
- Test: test/smart-money-rights.test.js
- Test: test/smart-money-entities.test.js

**Interfaces:**
- Produces: getSourceRight(rightsId, matrix = SOURCE_RIGHTS), validateRightsMatrix(matrix, { now }), assertAdapterRights(adapterConfigs, matrix = SOURCE_RIGHTS, { now } = {}), canUseSourceFor(sourceId, purpose, matrix = SOURCE_RIGHTS), listEntities(), getEntity(entityId), and listConfiguredAdapters({ now }).
- Consumes: the exact source-rights requirements and initial roster in the approved spec.

- [ ] **Step 1: Write failing rights and registry tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAdapterRights,
  canUseSourceFor,
  validateRightsMatrix,
} from '../lib/smart-money/rights.js';
import { getEntity, listEntities } from '../lib/smart-money/entities.js';

test('rights validation rejects unclear public-display permission', () => {
  const matrix = [{
    id: 'source-a',
    checkedAt: '2026-08-26',
    reviewDueAt: '2027-02-26',
    decision: 'enable',
    permissions: {
      serverRetrieval: 'allowed',
      temporaryCaching: 'allowed',
      durableHistoricalCaching: 'allowed',
      publicDisplay: 'unclear',
      derivedMetrics: 'allowed',
      attribution: 'allowed',
    },
  }];
  const result = validateRightsMatrix(matrix, { now: new Date('2026-08-26T00:00:00Z') });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /publicDisplay/);
});

test('rights validation rejects omitted permissions, invalid dates, and paid access', () => {
  const result = validateRightsMatrix([{
    id: 'unsafe-source',
    provider: 'Unsafe',
    endpoint: 'https://example.invalid/data',
    fieldsUsed: ['id'],
    termsUrl: 'https://example.invalid/terms',
    evidenceUrls: ['https://example.invalid/pricing'],
    attribution: 'required',
    retention: 'unspecified',
    checkedAt: 'not-a-date',
    reviewDueAt: 'also-not-a-date',
    decision: 'enable',
    permissions: { publicDisplay: 'allowed' },
    cost: { tier: 'paid', paidCredentialRequired: true },
  }], { now: new Date('2026-08-26T00:00:00Z') });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /invalid_review_dates/);
  assert.match(result.errors.join('\n'), /serverRetrieval/);
  assert.match(result.errors.join('\n'), /not_verified_free/);
});

test('link-only sources cannot feed rankings or paper signals', () => {
  assert.equal(canUseSourceFor('oaktree-insights', 'ranking'), false);
  assert.equal(canUseSourceFor('oaktree-insights', 'paper'), false);
});

test('Leopold and Situational Awareness are separate related entities', () => {
  const person = getEntity('leopold-aschenbrenner');
  const firm = getEntity('situational-awareness-lp');
  assert.equal(person.actorType, 'person');
  assert.equal(firm.actorType, 'firm');
  assert.ok(person.relatedEntityIds.includes(firm.id));
  assert.ok(firm.relatedEntityIds.includes(person.id));
  assert.equal(person.directoryCategory, 'investors');
  assert.equal(firm.directoryCategory, 'firms');
  assert.equal(firm.performanceVerification.status, 'not_publicly_verified');
});

test('the initial static roster has unique stable IDs', () => {
  const ids = listEntities().map((entity) => entity.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('bitwise-bitb'));
});
```

- [ ] **Step 2: Run the focused tests and verify missing-module failures**

Run:

```powershell
node --test test/smart-money-rights.test.js test/smart-money-entities.test.js
```

Expected: FAIL because lib/smart-money/rights.js and lib/smart-money/entities.js do not exist.

- [ ] **Step 3: Implement the matrix validator and registry**

Use explicit permission enums and fail-closed validation:

```js
const PURPOSE_PERMISSION = Object.freeze({
  fetch: 'serverRetrieval',
  cache: 'temporaryCaching',
  history: 'durableHistoricalCaching',
  display: 'publicDisplay',
  ranking: 'derivedMetrics',
  briefing: 'derivedMetrics',
  paper: 'derivedMetrics',
  attribute: 'attribution',
});

const REQUIRED_PERMISSION_KEYS = Object.freeze([
  'serverRetrieval',
  'temporaryCaching',
  'durableHistoricalCaching',
  'publicDisplay',
  'derivedMetrics',
  'attribution',
]);
const PERMISSION_VALUES = new Set(['allowed', 'prohibited', 'unclear']);
const DECISIONS = new Set(['enable', 'link-only', 'exclude']);
const REQUIRED_RIGHTS_FIELDS = Object.freeze([
  'id', 'provider', 'endpoint', 'fieldsUsed', 'termsUrl', 'evidenceUrls',
  'attribution', 'retention', 'checkedAt', 'reviewDueAt', 'decision', 'cost',
]);

export function validateRightsMatrix(matrix, { now = new Date() } = {}) {
  const errors = [];
  const ids = new Set();
  for (const record of matrix) {
    if (!record.id || ids.has(record.id)) errors.push('duplicate_or_missing_id');
    ids.add(record.id);
    for (const field of REQUIRED_RIGHTS_FIELDS) {
      if (record[field] == null || record[field] === '') {
        errors.push(String(record.id) + ':missing_' + field);
      }
    }
    if (!Array.isArray(record.fieldsUsed) || record.fieldsUsed.length === 0
        || !Array.isArray(record.evidenceUrls) || record.evidenceUrls.length === 0) {
      errors.push(String(record.id) + ':missing_review_evidence');
    }
    const checkedAt = Date.parse(record.checkedAt);
    const reviewDueAt = Date.parse(record.reviewDueAt);
    if (!Number.isFinite(checkedAt) || !Number.isFinite(reviewDueAt)
        || reviewDueAt < checkedAt) {
      errors.push(String(record.id) + ':invalid_review_dates');
    } else if (reviewDueAt < now.getTime()) {
      errors.push(String(record.id) + ':review_expired');
    }
    if (!DECISIONS.has(record.decision)) errors.push(String(record.id) + ':invalid_decision');
    for (const key of REQUIRED_PERMISSION_KEYS) {
      if (!Object.hasOwn(record.permissions || {}, key)
          || !PERMISSION_VALUES.has(record.permissions[key])) {
        errors.push(String(record.id) + ':invalid_or_missing_' + key);
      }
    }
    if (record.decision === 'enable') {
      if (record.cost?.tier !== 'free'
          || record.cost?.paidCredentialRequired !== false
          || !record.cost?.evidenceUrl) {
        errors.push(String(record.id) + ':not_verified_free');
      }
      for (const name of REQUIRED_PERMISSION_KEYS) {
        if (record.permissions[name] !== 'allowed') errors.push(String(record.id) + ':' + name);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function canUseSourceFor(
  sourceId,
  purpose,
  matrix = SOURCE_RIGHTS,
  { now = new Date() } = {},
) {
  const record = matrix.find((item) => item.id === sourceId);
  const permission = PURPOSE_PERMISSION[purpose];
  return Boolean(
    record
    && validateRightsMatrix([record], { now }).ok
    && record.decision === 'enable'
    && permission
    && record.permissions?.[permission] === 'allowed'
  );
}

export function assertAdapterRights(
  adapterConfigs,
  matrix = SOURCE_RIGHTS,
  { now = new Date() } = {},
) {
  const validation = validateRightsMatrix(matrix, { now });
  if (!validation.ok) throw new Error('smart_money_rights_invalid');
  for (const adapter of adapterConfigs) {
    for (const purpose of adapter.requiredPurposes) {
      if (!canUseSourceFor(adapter.rightsId, purpose, matrix, { now })) {
        throw new Error('smart_money_source_not_permitted:' + adapter.id);
      }
    }
  }
}
```

Populate the matrix for these exact source records: sec-edgar, leopold-official,
berkshire-letters, pershing-performance, fundsmith-documents,
oaktree-insights, ark-publications, strategy-disclosures, tesla-disclosures,
ibit-disclosures, fbtc-disclosures, arkb-disclosures, bitb-disclosures,
polymarket-data-api, hyperliquid-stats-api, hyperliquid-info-api,
arkham-excluded, and nansen-excluded. Record exact endpoints, fields,
attribution, retention, evidence URLs, checkedAt 2026-08-26, and a six-month
reviewDueAt. Mark publication pages link-only whenever the reviewed terms do not
affirm metadata caching. Mark Arkham and Nansen excluded.

Each record must include exact endpoint and fields, current terms and evidence
URLs, attribution/retention text, every permission key, and
`cost: { tier: 'free', paidCredentialRequired: false, evidenceUrl }`. A missing,
invalid, expired, ambiguous, paid, or credential-gated value fails validation
before any adapter performs a network request.

Create separate related records for these six person/firm pairs:

- leopold-aschenbrenner and situational-awareness-lp
- warren-buffett and berkshire-hathaway
- bill-ackman and pershing-square
- terry-smith and fundsmith
- howard-marks and oaktree-capital
- cathie-wood and ark-invest

Add institutional records strategy, tesla, blackrock-ibit, fidelity-fbtc,
ark-21shares-arkb, and bitwise-bitb. Dynamic venue accounts are not static
registry entries. Every static entity includes the required master-contract
`directoryCategory`: person records use investors, ordinary investment firms
use firms, and the six treasury/ETF records use institutional-flows. Task 6
assigns dynamic provider-scoped venue accounts to crypto-traders.

- [ ] **Step 4: Run tests and the matrix checker directly**

Run:

```powershell
node --test test/smart-money-rights.test.js test/smart-money-entities.test.js
node -e "Promise.all([import('./lib/smart-money/rights.js'),import('./lib/smart-money/entities.js')]).then(([r,e]) => r.assertAdapterRights(e.listConfiguredAdapters({ now: new Date('2026-08-26T00:00:00Z') }), undefined, { now: new Date('2026-08-26T00:00:00Z') }))"
```

Expected: both test files PASS and the direct check exits 0 without network access.

- [ ] **Step 5: Commit the rights gate and registry**

```powershell
git add config/smart-money-source-rights.json lib/smart-money/rights.js lib/smart-money/entities.js docs/smart-money-source-rights.md test/smart-money-rights.test.js test/smart-money-entities.test.js
git diff --cached --check
git commit -m "feat: gate smart money sources by usage rights"
```

---

### Task 2: Add bounded provider transport and shared feed parsing

**Files:**
- Create: lib/smart-money/errors.js
- Create: lib/smart-money/http.js
- Create: lib/feeds.js
- Modify: api/news.js
- Modify: api/asset-news.js
- Modify: api/analysis.js
- Modify: package.json
- Modify: package-lock.json
- Test: test/smart-money-http.test.js
- Test: test/feed-parser.test.js

**Interfaces:**
- Consumes: assertAdapterRights() from Task 1.
- Produces: fetchProviderJson(url, options), fetchProviderText(url, options), parseFeed(xml, options), canonicalizeSourceUrl(url, allowedOrigins), ProviderError, and sanitizeProviderError(error).

- [ ] **Step 1: Write failing transport and feed tests**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  fetchProviderJson,
  fetchProviderText,
} from '../lib/smart-money/http.js';
import { parseFeed } from '../lib/feeds.js';

test('provider transport rejects an origin outside its allowlist', async () => {
  await assert.rejects(
    fetchProviderJson('https://evil.example/data', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    }),
    (error) => error.code === 'origin_not_allowed',
  );
});

test('provider transport rejects oversized text bodies', async () => {
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      maxBytes: 4,
      fetchImpl: async () => new Response('12345', { headers: { 'content-type': 'text/plain' } }),
    }),
    (error) => error.code === 'response_too_large',
  );
});

test('shared feed parser keeps only allowlisted canonical links', () => {
  const xml = '<rss><channel><item><title>A</title><link>https://example.com/a?utm_source=x</link><pubDate>Wed, 26 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>';
  const rows = parseFeed(xml, { maxItems: 5, allowedOrigins: ['https://example.com'] });
  assert.deepEqual(rows.map((row) => row.url), ['https://example.com/a']);
});
```

- [ ] **Step 2: Install parsers and run the focused tests**

Run:

```powershell
npm install fast-xml-parser@^5.3.0 cheerio@^1.1.2
node --test test/smart-money-http.test.js test/feed-parser.test.js
```

Expected: FAIL because the new transport and feed modules do not exist.

- [ ] **Step 3: Implement bounded fetch and extract existing RSS parsing**

Implement one body reader that enforces timeout through body consumption,
content type, maximum bytes, retry count, and Retry-After:

```js
export async function fetchProviderJson(url, options) {
  const text = await fetchProviderText(url, {
    ...options,
    acceptedContentTypes: ['application/json', 'text/json'],
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('invalid_json', options.providerId);
  }
}

export class ProviderError extends Error {
  constructor(code, providerId, retryAfterMs = null) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
  }
}

export function sanitizeProviderError(error) {
  const allowed = new Set([
    'rights_gate_failed',
    'configuration_missing',
    'origin_not_allowed',
    'timeout',
    'rate_limited',
    'invalid_content_type',
    'response_too_large',
    'invalid_json',
    'schema_invalid',
    'empty_dataset',
  ]);
  return allowed.has(error?.code) ? error.code : 'provider_unavailable';
}
```

Move RSS and Atom normalization into lib/feeds.js without changing existing
news response fields. Preserve canonical source URLs and strip tracking
parameters.

- [ ] **Step 4: Run transport, feed, and existing news/analysis tests**

Run:

```powershell
node --test test/smart-money-http.test.js test/feed-parser.test.js test/analysis.test.js
npm run test:unit
```

Expected: all tests PASS and existing news/analysis contracts remain unchanged.

- [ ] **Step 5: Commit transport and parser extraction**

```powershell
git add package.json package-lock.json lib/smart-money/errors.js lib/smart-money/http.js lib/feeds.js api/news.js api/asset-news.js api/analysis.js test/smart-money-http.test.js test/feed-parser.test.js
git diff --cached --check
git commit -m "refactor: centralize bounded source fetching"
```

---

### Task 3: Implement SEC and official-publication adapters

**Files:**
- Create: lib/smart-money/sec.js
- Create: lib/smart-money/publications.js
- Create: test/fixtures/smart-money/sec/submissions.json
- Create: test/fixtures/smart-money/sec/filing-index.json
- Create: test/fixtures/smart-money/sec/information-table.xml
- Create: test/fixtures/smart-money/publications/feed.xml
- Test: test/smart-money-sec.test.js
- Test: test/smart-money-publications.test.js
- Modify: .env.example

**Interfaces:**
- Consumes: fetchProviderJson(), fetchProviderText(), parseFeed(), and the Task 1 registry.
- Produces: fetchSecSnapshot(config, deps), parseSecSubmissions(payload, config), parseSecInformationTable(xml, filing), selectCanonical13FByPeriod(filings), compare13FPeriods(current, previous), fetchPublicationSnapshot(config, deps), normalizePublicationEntry(entry, config), and publicationStableId(input).

- [ ] **Step 1: Add minimal SEC and publication fixtures plus failing tests**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  compare13FPeriods,
  parseSecInformationTable,
  selectCanonical13FByPeriod,
} from '../lib/smart-money/sec.js';

const INFORMATION_TABLE_XML = fs.readFileSync(
  new URL('./fixtures/smart-money/sec/information-table.xml', import.meta.url),
  'utf8',
);

test('13F parser preserves period, filing, amendment, CUSIP, and research-only ticker', () => {
  const rows = parseSecInformationTable(INFORMATION_TABLE_XML, {
    accessionNumber: '0002045724-26-000001',
    periodEnd: '2026-06-30',
    filedAt: '2026-08-14T00:00:00.000Z',
    isAmendment: false,
  });
  assert.equal(rows[0].cusip, '67066G104');
  assert.equal(rows[0].ticker, null);
  assert.equal(rows[0].periodEnd, '2026-06-30');
  assert.equal(rows[0].filedAt, '2026-08-14T00:00:00.000Z');
});

test('an amended filing replaces the original for the same period', () => {
  const selected = selectCanonical13FByPeriod([
    { periodEnd: '2026-06-30', filedAt: '2026-08-14', isAmendment: false },
    { periodEnd: '2026-06-30', filedAt: '2026-08-20', isAmendment: true },
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].isAmendment, true);
});

test('period comparison classifies new, increased, reduced, and exited holdings', () => {
  const changes = compare13FPeriods(
    [{ cusip: 'A', shares: 150 }, { cusip: 'B', shares: 20 }],
    [{ cusip: 'A', shares: 100 }, { cusip: 'C', shares: 50 }],
  );
  assert.deepEqual(changes.map((row) => row.classification).sort(), ['exited', 'increased', 'new']);
});
```

- [ ] **Step 2: Run focused tests and confirm missing adapter failures**

Run:

```powershell
node --test test/smart-money-sec.test.js test/smart-money-publications.test.js
```

Expected: FAIL because the adapters do not exist.

- [ ] **Step 3: Implement SEC filing semantics and metadata-only publications**

Require a configured identified SEC client:

```js
export function secHeaders(userAgent = process.env.SEC_USER_AGENT) {
  const monitoredEmail = typeof userAgent === 'string'
    ? userAgent.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
    : null;
  if (!monitoredEmail
      || /@(example\.(com|org|net)|[^@]+\.invalid)$/i.test(monitoredEmail)) {
    throw new ProviderError('configuration_missing', 'sec-edgar');
  }
  return {
    Accept: 'application/json, application/xml, text/xml',
    'User-Agent': userAgent,
  };
}

export function publicationStableId({ canonicalUrl, contentHash }) {
  return 'publication:' + createHash('sha256')
    .update(String(canonicalUrl) + '\n' + String(contentHash))
    .digest('hex')
    .slice(0, 24);
}
```

Use SEC submissions JSON to locate 13F-HR, 13F-HR/A, SC 13D, SC 13D/A,
SC 13G, and SC 13G/A. Fetch the filing index, select the information-table XML,
and parse with fast-xml-parser. Retain period end, filed time, accession number,
amendment chain, CUSIP, security class, shares, reported value, and put/call.
Do not synthesize ticker symbols.

Publication adapters ingest only allowlisted RSS/Atom entries or metadata links
whose rights record permits caching. Persist the title, canonical URL, official
publisher, published date, metadata hash, and a bounded dashboard-authored
summary; never persist full document text.

Add this exact environment example:

```dotenv
SEC_USER_AGENT=CommsDashboard/1.0 your-monitored-contact@your-domain.invalid
```

The example value is intentionally invalid. Deployment must replace it with a
user-confirmed monitored mailbox. Tests reject placeholder domains, health
reports missing/invalid configuration, and no SEC request runs without it.

- [ ] **Step 4: Run adapter and regression tests**

Run:

```powershell
node --test test/smart-money-sec.test.js test/smart-money-publications.test.js
npm run test:unit
```

Expected: all tests PASS; 13F rows without audited mapping remain paper-ineligible.

- [ ] **Step 5: Commit SEC and publication ingestion**

```powershell
git add .env.example lib/smart-money/sec.js lib/smart-money/publications.js test/fixtures/smart-money/sec test/fixtures/smart-money/publications test/smart-money-sec.test.js test/smart-money-publications.test.js
git diff --cached --check
git commit -m "feat: ingest official investor disclosures"
```

---

### Task 4: Implement Polymarket and Hyperliquid research adapters

**Files:**
- Create: lib/smart-money/polymarket.js
- Create: lib/smart-money/hyperliquid.js
- Create: test/fixtures/smart-money/polymarket/leaderboard-month.json
- Create: test/fixtures/smart-money/polymarket/leaderboard-all.json
- Create: test/fixtures/smart-money/hyperliquid/leaderboard.json
- Create: test/fixtures/smart-money/hyperliquid/portfolio.json
- Test: test/smart-money-polymarket.test.js
- Test: test/smart-money-hyperliquid.test.js

**Interfaces:**
- Consumes: bounded Task 2 transport and Task 1 rights records.
- Produces: fetchPolymarketLeaderboard(input, deps), fetchPolymarketPositions(address, deps), fetchPolymarketClosedPositions(address, deps), fetchPolymarketSnapshot(config, deps), joinPolymarketWindows(month, allTime), normalizePolymarketLeaderboard(rows, context), fetchHyperliquidLeaderboard(deps), fetchHyperliquidAccountState(address, deps), fetchHyperliquidPortfolio(address, deps), fetchHyperliquidRecentFills(address, range, deps), fetchHyperliquidSnapshot(config, deps), normalizeHyperliquidLeaderboard(rows, context), and validateHyperliquidInfoType(type).

- [ ] **Step 1: Write failing provider-contract tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  joinPolymarketWindows,
  normalizePolymarketLeaderboard,
} from '../lib/smart-money/polymarket.js';
import {
  normalizeHyperliquidLeaderboard,
  validateHyperliquidInfoType,
} from '../lib/smart-money/hyperliquid.js';

test('Polymarket joins MONTH and ALL by wallet without crossing providers', () => {
  const rows = joinPolymarketWindows(
    [{ proxyWallet: '0x0000000000000000000000000000000000000abc', pnl: 50000, vol: 300000, rank: 4 }],
    [{ proxyWallet: '0x0000000000000000000000000000000000000abc', pnl: 200000, vol: 900000, rank: 8 }],
  );
  assert.equal(rows[0].windows.month.pnlUsd, 50000);
  assert.equal(rows[0].windows.allTime.pnlUsd, 200000);
  assert.equal(rows[0].providerId, 'polymarket-leaderboard');
});

test('Polymarket hides a username that is not public', () => {
  const rows = normalizePolymarketLeaderboard([{
    proxyWallet: '0x0000000000000000000000000000000000000abc',
    userName: 'Private Name',
    displayUsernamePublic: false,
    pnl: 100000,
    vol: 300000,
    rank: 1,
  }], { window: 'month', retrievedAt: '2026-08-26T00:00:00Z' });
  assert.equal(rows[0].displayName, '0x0000…0abc');
});

test('Hyperliquid read adapter rejects trading info types', () => {
  assert.throws(() => validateHyperliquidInfoType('exchange'), /read_only_info_type/);
  assert.doesNotThrow(() => validateHyperliquidInfoType('portfolio'));
});
```

- [ ] **Step 2: Run focused tests and confirm missing adapter failures**

Run:

```powershell
node --test test/smart-money-polymarket.test.js test/smart-money-hyperliquid.test.js
```

Expected: FAIL because both adapters do not exist.

- [ ] **Step 3: Implement bounded read-only adapters**

Use only these Polymarket GET endpoints:

```js
const POLYMARKET_BASE = 'https://data-api.polymarket.com';
const POLYMARKET_ENDPOINTS = Object.freeze({
  leaderboard: '/v1/leaderboard',
  positions: '/positions',
  closedPositions: '/closed-positions',
});
```

Query leaderboard pages with category CRYPTO, periods MONTH and ALL, orderBy
PNL, and maximum documented page size. Join by lowercased wallet. Preserve
retrieval time and set sourceAsOf to null when absent.

Use only these Hyperliquid read surfaces:

```js
const HYPERLIQUID_STATS_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const ALLOWED_INFO_TYPES = new Set([
  'portfolio',
  'clearinghouseState',
  'userFillsByTime',
]);
```

Fetch the large leaderboard only inside protected refresh orchestration, cap the
accepted body at 50 MB, reduce to eligible candidates before persistence, fetch
details for at most ten candidates with concurrency four, and keep total
weighted requests below the documented budget. The Info API uses POST only for
read queries; no exchange endpoint or signing library is imported.

- [ ] **Step 4: Run provider tests and verify outbound URL/method allowlists**

Run:

```powershell
node --test test/smart-money-polymarket.test.js test/smart-money-hyperliquid.test.js
```

Expected: all tests PASS, every captured URL matches an allowlisted origin, and no request targets a trading endpoint.

- [ ] **Step 5: Commit crypto research adapters**

```powershell
git add lib/smart-money/polymarket.js lib/smart-money/hyperliquid.js test/fixtures/smart-money/polymarket test/fixtures/smart-money/hyperliquid test/smart-money-polymarket.test.js test/smart-money-hyperliquid.test.js
git diff --cached --check
git commit -m "feat: ingest public crypto performance signals"
```

---

### Task 5: Implement six independent institutional-disclosure adapters

**Files:**
- Create: lib/smart-money/disclosures.js
- Create: test/fixtures/smart-money/disclosures/strategy.json
- Create: test/fixtures/smart-money/disclosures/tesla.json
- Create: test/fixtures/smart-money/disclosures/ibit.json
- Create: test/fixtures/smart-money/disclosures/fbtc.json
- Create: test/fixtures/smart-money/disclosures/arkb.json
- Create: test/fixtures/smart-money/disclosures/bitb.json
- Test: test/smart-money-disclosures.test.js

**Interfaces:**
- Consumes: SEC/official metadata from Task 3 and rights records from Task 1.
- Produces: fetchInstitutionalDisclosure(config, deps), fetchInstitutionalDisclosures(configs, deps), normalizeTreasuryDisclosure(raw, config), normalizeFundDisclosure(raw, config), and compareInstitutionalHoldings(current, previous).

- [ ] **Step 1: Write failing independent-health and normalization tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareInstitutionalHoldings,
  fetchInstitutionalDisclosures,
} from '../lib/smart-money/disclosures.js';

test('one failed ETF remains visible beside successful institutional adapters', async () => {
  const NOW = '2026-08-26T00:00:00.000Z';
  const CONFIGS = [
    { id: 'institutional-ibit', entityId: 'blackrock-ibit' },
    { id: 'institutional-fbtc', entityId: 'fidelity-fbtc' },
  ];
  const result = await fetchInstitutionalDisclosures(CONFIGS, {
    fetchOne: async (config) => {
      if (config.id === 'institutional-fbtc') throw Object.assign(new Error('x'), { code: 'timeout' });
      return { records: [{ entityId: config.entityId, amount: 1 }], retrievedAt: NOW };
    },
    now: () => new Date(NOW),
  });
  assert.equal(result.statuses.find((row) => row.id === 'institutional-fbtc').status, 'unavailable');
  assert.equal(result.statuses.find((row) => row.id === 'institutional-ibit').status, 'live');
});

test('a first disclosure and complete exit always qualify', () => {
  assert.equal(compareInstitutionalHoldings(null, { valueUsd: 20_000_000 }).classification, 'new');
  assert.equal(compareInstitutionalHoldings({ valueUsd: 20_000_000 }, null).classification, 'exited');
});
```

- [ ] **Step 2: Run the focused test and confirm missing-module failure**

Run:

```powershell
node --test test/smart-money-disclosures.test.js
```

Expected: FAIL because lib/smart-money/disclosures.js does not exist.

- [ ] **Step 3: Implement exact source adapters and group rollup**

Configure only strategy, tesla, blackrock-ibit, fidelity-fbtc,
ark-21shares-arkb, and bitwise-bitb. Prefer SEC structured filings for metrics.
Official pages that passed only link-only rights may contribute canonical links
but cannot supply cached values.

```js
export async function fetchInstitutionalDisclosures(configs, deps) {
  const settled = await Promise.allSettled(
    configs.map((config) => deps.fetchOne(config, deps)),
  );
  return settled.reduce((result, item, index) => {
    const config = configs[index];
    if (item.status === 'fulfilled' && item.value.records.length > 0) {
      result.records.push(...item.value.records);
      result.statuses.push(liveStatus(config, item.value, deps.now()));
    } else if (item.status === 'fulfilled') {
      result.statuses.push(failedStatus(
        config,
        new ProviderError('empty_dataset', config.id),
        deps.now(),
      ));
    } else {
      result.statuses.push(failedStatus(config, item.reason, deps.now()));
    }
    return result;
  }, { records: [], statuses: [] });
}
```

`fetchInstitutionalDisclosure(config, deps)` implements one concrete adapter;
the plural function is the group orchestrator above. A fulfilled empty result is
always a typed `empty_dataset`, never an undefined rejection reason.

Retain vehicle, reporting date, filing date, BTC amount, reported USD value,
source URL, and methodology. Do not infer wallet addresses, buys, sells, or
profits from balance changes.

- [ ] **Step 4: Run disclosure tests**

Run:

```powershell
node --test test/smart-money-disclosures.test.js
```

Expected: PASS with six concrete status records and an honest failed-child rollup.

- [ ] **Step 5: Commit institutional disclosures**

```powershell
git add lib/smart-money/disclosures.js test/fixtures/smart-money/disclosures test/smart-money-disclosures.test.js
git diff --cached --check
git commit -m "feat: track official institutional crypto disclosures"
```

---

### Task 6: Normalize records, rank evidence, and derive material signals

**Files:**
- Create: lib/smart-money/contracts.js
- Create: lib/smart-money/normalize.js
- Create: lib/smart-money/rank.js
- Create: lib/smart-money/signals.js
- Create: test/fixtures/smart-money/scenarios.js
- Test: test/smart-money-normalize.test.js
- Test: test/smart-money-rank.test.js
- Test: test/smart-money-signals.test.js

**Interfaces:**
- Consumes: all Task 3–5 adapter snapshots and Task 1 entities.
- Produces: normalizeAdapterSnapshot(input, context), normalizeEntity(value), normalizeActivity(value), normalizePerformance(value), normalizeProviderStatus(value, policy), validateSignal(value), getProviderFreshnessPolicy(providerId), classifyProviderFreshness(status, policy, now), dedupeByStableId(records), qualifyCryptoAccount(performance, options), rankCryptoAccounts(accounts, options), rankInvestors(entities, activities), and deriveSignals(input).

- [ ] **Step 1: Write failing contract, ranking, and two-snapshot-confirmation tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HYPERLIQUID_MIN_ACCOUNT_VALUE_USD,
  HYPERLIQUID_MIN_VOLUME_30D_USD,
  qualifyCryptoAccount,
} from '../lib/smart-money/rank.js';
import {
  PROVIDER_FRESHNESS_POLICIES,
  classifyProviderFreshness,
} from '../lib/smart-money/normalize.js';
import { deriveSignals } from '../lib/smart-money/signals.js';
import {
  FIRST_CHANGE,
  SECOND_CHANGE,
  UNMAPPED_13F_CHANGE,
} from './fixtures/smart-money/scenarios.js';

test('Hyperliquid eligibility uses the named v1 thresholds', () => {
  assert.equal(HYPERLIQUID_MIN_ACCOUNT_VALUE_USD, 1_000_000);
  assert.equal(HYPERLIQUID_MIN_VOLUME_30D_USD, 5_000_000);
  assert.equal(qualifyCryptoAccount({
    providerId: 'hyperliquid-leaderboard',
    venue: 'hyperliquid',
    accountValueUsd: 1_500_000,
    windows: {
      month: { pnlUsd: 20_000, volumeUsd: 6_000_000, roiPct: 4 },
      allTime: { pnlUsd: 100_000, volumeUsd: 20_000_000, roiPct: 20 },
    },
  }).eligible, true);
});

test('freshness boundaries match the approved source policies', () => {
  assert.equal(PROVIDER_FRESHNESS_POLICIES.polymarket.cacheTtlMs, 600000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.polymarket.staleAfterMs, 1800000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.hyperliquid.cacheTtlMs, 3600000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.hyperliquid.staleAfterMs, 7200000);
  assert.equal(classifyProviderFreshness(
    { lastSuccessAt: '2026-08-26T10:00:00.000Z' },
    PROVIDER_FRESHNESS_POLICIES.polymarket,
    new Date('2026-08-26T10:30:00.000Z'),
  ), 'stale');
});

test('a Hyperliquid material change requires the same candidate twice', () => {
  const first = deriveSignals(FIRST_CHANGE);
  assert.equal(first.signals.length, 0);
  assert.equal(first.pendingConfirmations.length, 1);
  const second = deriveSignals({ ...SECOND_CHANGE, pendingConfirmations: first.pendingConfirmations });
  assert.equal(second.signals.length, 1);
  assert.equal(second.signals[0].notificationEligibility.eligible, true);
  assert.equal(second.signals[0].action, 'increase');
  assert.deepEqual(second.signals[0].positionChange, {
    previousNotionalUsd: 200000,
    currentNotionalUsd: 350000,
    deltaNotionalUsd: 150000,
  });
  assert.equal(second.signals[0].asset.assetClass, 'crypto');
});

test('an unmapped 13F holding is never paper eligible', () => {
  const result = deriveSignals(UNMAPPED_13F_CHANGE);
  assert.equal(result.signals[0].asset.ticker, null);
  assert.deepEqual(result.signals[0].paperEligibility, {
    eligible: false,
    reason: 'unsupported_asset',
  });
});
```

- [ ] **Step 2: Run focused tests and verify missing modules**

Run:

```powershell
node --test test/smart-money-normalize.test.js test/smart-money-rank.test.js test/smart-money-signals.test.js
```

Expected: FAIL because normalization, ranking, and signals modules do not exist.

- [ ] **Step 3: Implement canonical validators, constants, and signal rules**

Use these exact constants:

```js
export const THRESHOLD_VERSION = 'smart-money-v1';
export const HYPERLIQUID_MIN_ACCOUNT_VALUE_USD = 1_000_000;
export const HYPERLIQUID_MIN_VOLUME_30D_USD = 5_000_000;
export const POLYMARKET_MIN_ALL_TIME_PNL_USD = 100_000;
export const POLYMARKET_MIN_VOLUME_30D_USD = 250_000;
export const MAX_ABS_ROI_PCT = 1_000;
export const SEC_MIN_REPORTED_VALUE_USD = 1_000_000;
export const SEC_MIN_SHARE_CHANGE_PCT = 10;
export const HYPERLIQUID_MIN_NOTIONAL_USD = 100_000;
export const HYPERLIQUID_MIN_ACCOUNT_CHANGE_PCT = 1;
export const POLYMARKET_MIN_RANK_CHANGE = 10;
export const POLYMARKET_MIN_PNL_CHANGE_USD = 25_000;
export const POLYMARKET_MIN_PNL_CHANGE_PCT = 10;
export const POLYMARKET_MIN_VOLUME_CHANGE_USD = 100_000;
export const INSTITUTIONAL_MIN_VALUE_CHANGE_USD = 10_000_000;
export const INSTITUTIONAL_MIN_HOLDING_CHANGE_PCT = 1;
export const PROVIDER_FRESHNESS_POLICIES = Object.freeze({
  polymarket: { cacheTtlMs: 10 * 60_000, staleAfterMs: 30 * 60_000 },
  hyperliquid: { cacheTtlMs: 60 * 60_000, staleAfterMs: 2 * 60 * 60_000 },
  official: { cacheTtlMs: 12 * 60 * 60_000, staleAfterMs: 36 * 60 * 60_000 },
});
```

Manual validators must reject NaN, Infinity, future timestamps beyond five
minutes, unsupported status enums, duplicate stable IDs, and mismatched
asset/reference-price tickers. Entity validation requires one of the four exact
directoryCategory values in the master contract; dynamic venue accounts use
crypto-traders. Performance validation preserves provider, venue, scope, exact
time windows, methodology, as-of/retrieval timestamps, and
notComparableAcrossProviders. Public snapshot/API fixtures expose performances
as a separate top-level array.

Signal validation requires action `open|increase|reduce|close|reverse|observe`,
validated `asset.assetClass`, and internally consistent before/after/delta
notional. An `observe` signal or a missing positionChange is never paper
eligible. Derive no new signals from stale or
last-known-good records. Persist the pending Hyperliquid baseline and candidate
size so the second accepted snapshot confirms the same change.

`rankInvestors` creates the server base order using freshness and evidence
coverage only. Followed state is browser-local; the Intelligence plan performs
a stable followed-first partition without sending it to the server.

Map Polymarket adapters to polymarket, Hyperliquid adapters to hyperliquid, and
SEC/publication/institutional adapters to official. `cacheTtlMs` decides whether
a protected refresh fetches a provider; `staleAfterMs` alone decides LIVE versus
STALE. Add boundary tests at TTL-1/TTL and stale-1/stale for every policy.

test/fixtures/smart-money/scenarios.js exports FIRST_CHANGE and SECOND_CHANGE
with the same Hyperliquid entity changing BTC notional from USD 200,000 to USD
400,000 at two consecutive hourly observations; UNMAPPED_13F_CHANGE with a valid
CUSIP and null ticker; ACCEPTED_SNAPSHOT using the schemaVersion 1 master
contract; and DEPS_WITH_ONE_TIMEOUT whose FBTC adapter rejects with code timeout
while all other fixture adapters return one valid record.

- [ ] **Step 4: Run normalization, ranking, and signal tests**

Run:

```powershell
node --test test/smart-money-normalize.test.js test/smart-money-rank.test.js test/smart-money-signals.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit contracts, rankings, and signals**

```powershell
git add lib/smart-money/contracts.js lib/smart-money/normalize.js lib/smart-money/rank.js lib/smart-money/signals.js test/fixtures/smart-money/scenarios.js test/smart-money-normalize.test.js test/smart-money-rank.test.js test/smart-money-signals.test.js
git diff --cached --check
git commit -m "feat: normalize and qualify smart money signals"
```

---

### Task 7: Persist the newest snapshot, immutable journal, and reference prices

**Files:**
- Create: lib/smart-money/store.js
- Create: lib/smart-money/journal.js
- Create: lib/smart-money/reference-prices.js
- Create: lib/smart-money/lock.js
- Create: test/fixtures/smart-money/journal.js
- Test: test/smart-money-store.test.js
- Test: test/smart-money-journal.test.js
- Test: test/smart-money-reference-prices.test.js

**Interfaces:**
- Consumes: normalized snapshot and signal contracts from Task 6, existing Redis/Blob environment conventions, and trusted dashboard price payloads.
- Produces: selectNewestSmartMoneySnapshot(candidates), readSmartMoneySnapshot(options), writeSmartMoneySnapshot(snapshot, options), appendJournal(input, options), readJournal(query, options), listTrackedTickers(query, options), pruneJournal(input, options), resolveReferencePrice(signal, deps), resolveDailyMarks(input, deps), and withRefreshLock(action, options).

- [ ] **Step 1: Write failing concurrency, journal, and price-timing tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { appendJournal, readJournal } from '../lib/smart-money/journal.js';
import { resolveDailyMarks, resolveReferencePrice } from '../lib/smart-money/reference-prices.js';
import { selectNewestSmartMoneySnapshot } from '../lib/smart-money/store.js';
import {
  DAILY_MARK_DEPS,
  SIGNAL,
  memoryJournalAdapter,
} from './fixtures/smart-money/journal.js';

test('an older-started snapshot cannot replace a newer generation', () => {
  const selected = selectNewestSmartMoneySnapshot([
    { source: 'redis', data: { refreshStartedAt: '2026-08-26T01:00:00.000Z' } },
    { source: 'blob', data: { refreshStartedAt: '2026-08-26T02:00:00.000Z' } },
  ]);
  assert.equal(selected.source, 'blob');
});

test('journal append deduplicates a signal committed before snapshot failure', async () => {
  const adapter = memoryJournalAdapter();
  await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });
  const retry = await appendJournal({
    signals: [{
      ...SIGNAL,
      referencePrice: { ...SIGNAL.referencePrice, price: SIGNAL.referencePrice.price + 5000 },
    }],
    dailyMarks: [],
  }, { adapter });
  const result = await readJournal({ since: SIGNAL.observedAt, limit: 200 }, { adapter });
  assert.deepEqual(result.signals.map((row) => row.id), [SIGNAL.id]);
  assert.equal(retry.committedSignals[0].referencePrice.price, SIGNAL.referencePrice.price);
});

test('reference price never uses a quote before observedAt', async () => {
  const result = await resolveReferencePrice(SIGNAL, {
    fetchPrices: async () => [
      { ticker: 'BTC', price: 99000, asOf: '2026-08-26T00:04:59.000Z', source: 'yahoo' },
      { ticker: 'BTC', price: 100000, asOf: '2026-08-26T00:05:00.000Z', source: 'yahoo' },
    ],
    retrievedAt: '2026-08-26T00:05:01.000Z',
  });
  assert.equal(result.price, 100000);
});

test('daily marks include retained assets and both benchmarks without a new signal', async () => {
  const result = await resolveDailyMarks({
    date: '2026-08-27',
    tickers: ['ETH'],
  }, DAILY_MARK_DEPS);
  assert.deepEqual(result.map((row) => row.ticker).sort(), ['BTC', 'ETH', 'SPX']);
  assert.ok(result.every((row) => row.id.startsWith('2026-08-27:')));
});
```

test/fixtures/smart-money/journal.js exports a complete master-contract SIGNAL,
DAILY_MARK_DEPS, and memoryJournalAdapter() with deterministic CAS behavior.

- [ ] **Step 2: Run focused tests and confirm missing storage failures**

Run:

```powershell
node --test test/smart-money-store.test.js test/smart-money-journal.test.js test/smart-money-reference-prices.test.js
```

Expected: FAIL because the new storage modules do not exist.

- [ ] **Step 3: Implement isolated Redis/Blob namespaces and append-first journal semantics**

Use these exact namespaces:

```js
const SNAPSHOT_KEY = 'smart-money:v1:snapshot';
const SNAPSHOT_VERSION_KEY = 'smart-money:v1:snapshot:refresh-started-at-ms';
const SNAPSHOT_BLOB = 'smart-money/v1/snapshot.json';
const JOURNAL_PREFIX = 'smart-money/v1/journal/';
const JOURNAL_MANIFEST = 'smart-money/v1/journal/manifest.json';
const JOURNAL_RETENTION_DAYS = 400;
```

Follow lib/market/store.js newest-generation Redis Lua and Blob ETag CAS
patterns without sharing its module-level memory state. Journal partitions are
private daily JSON blobs keyed by observed UTC date. CAS-merge signals and marks
by stable ID, maintain a 400-day manifest, and prune only partitions older than
the cutoff.

The reference-price resolver accepts only trusted supported dashboard sources,
requires price asOf at or after observedAt, embeds price and signal in the same
journal entry, and returns an explicit skip reason when no valid quote exists.
`listTrackedTickers({ since })` returns the distinct supported asset universe in
the retained 400-day journal. `resolveDailyMarks({ tickers, date }, deps)` unions
that universe with canonical SPX and BTC benchmarks and emits master-contract
marks for the most recently completed UTC day even when that day produced no new
signal. It never freezes an intraday quote as the immutable daily close.

`appendJournal` returns
`{ durableWriteSucceeded, partitions, manifest, committedSignals, committedDailyMarks }`.
`durableWriteSucceeded` is true only when every affected partition and the
manifest commit durably; callers may not publish a new signal otherwise.
Committed rows are read back from the successful CAS result. If a retry supplies
the same stable signal ID with a different quote, committedSignals returns the
original immutable row and price.

- [ ] **Step 4: Run storage tests**

Run:

```powershell
node --test test/smart-money-store.test.js test/smart-money-journal.test.js test/smart-money-reference-prices.test.js
```

Expected: all tests PASS, including concurrent append and retry cases.

- [ ] **Step 5: Commit durable Smart Money storage**

```powershell
git add lib/smart-money/store.js lib/smart-money/journal.js lib/smart-money/reference-prices.js lib/smart-money/lock.js test/fixtures/smart-money/journal.js test/smart-money-store.test.js test/smart-money-journal.test.js test/smart-money-reference-prices.test.js
git diff --cached --check
git commit -m "feat: persist smart money snapshots and signals"
```

---

### Task 8: Orchestrate refresh and expose sanitized read APIs

**Files:**
- Create: lib/smart-money/refresh.js
- Create: lib/smart-money/health.js
- Create: api/smart-money.js
- Create: api/smart-money/history.js
- Create: api/smart-money/health.js
- Create: api/smart-money/refresh.js
- Create: test/helpers/api.js
- Modify: test/fixtures/smart-money/scenarios.js
- Test: test/smart-money-refresh.test.js
- Test: test/smart-money-api.test.js
- Test: test/smart-money-no-trading.test.js

**Interfaces:**
- Consumes: every Task 1–7 provider, rights, normalization, storage, lock, journal, and reference-price interface.
- Produces: createSmartMoneyRefresher(deps), refreshSmartMoney(options), buildSmartMoneyHealth(input), createSmartMoneyHandler(deps), createSmartMoneyHistoryHandler(deps), createSmartMoneyHealthHandler(deps), and createSmartMoneyRefreshHandler(deps).

- [ ] **Step 1: Write failing orchestration, route, and no-trading tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmartMoneyRefresher } from '../lib/smart-money/refresh.js';
import { buildSmartMoneyHealth } from '../lib/smart-money/health.js';
import { createSmartMoneyHandler } from '../api/smart-money.js';
import { createSmartMoneyHistoryHandler } from '../api/smart-money/history.js';
import { createSmartMoneyRefreshHandler } from '../api/smart-money/refresh.js';
import { mockRequest } from './helpers/api.js';
import {
  ACCEPTED_HISTORY,
  ACCEPTED_SNAPSHOT,
  createRefreshDeps,
  DEPS_WITH_ONE_TIMEOUT,
} from './fixtures/smart-money/scenarios.js';

test('one adapter failure preserves its LKG rows but creates no new signals', async () => {
  const refresh = createSmartMoneyRefresher(DEPS_WITH_ONE_TIMEOUT);
  const result = await refresh({ trigger: 'cron' });
  assert.equal(result.partial, true);
  assert.equal(result.providerStatuses.find((row) => row.id === 'institutional-fbtc').status, 'unavailable');
  assert.equal(result.signalsAccepted.some((row) => row.providerId === 'institutional-fbtc'), false);
  assert.equal(result.persisted, true);
});

test('journal failure never publishes a snapshot or accepts a new signal', async () => {
  const { deps, calls } = createRefreshDeps({ journalDurable: false });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, false);
  assert.deepEqual(result.signalsAccepted, []);
  assert.equal(result.errorCode, 'journal_persistence_failed');
  assert.equal(calls.writeSnapshot, 0);
});

test('snapshot failure leaves an idempotent journal row but returns unpersisted', async () => {
  const { deps, calls } = createRefreshDeps({ snapshotDurable: false });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, false);
  assert.deepEqual(result.signalsAccepted, []);
  assert.equal(result.errorCode, 'snapshot_persistence_failed');
  assert.equal(calls.appendJournal, 1);
});

test('a no-signal refresh still journals daily marks for retained assets and benchmarks', async () => {
  const { deps, captured } = createRefreshDeps({ signals: [], trackedTickers: ['ETH'] });
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(captured.dailyMarkTickers.sort(), ['BTC', 'ETH', 'SPX']);
});

test('public refresh rereads accepted data and never invokes adapters', async () => {
  let adapterCalls = 0;
  const handler = createSmartMoneyHandler({
    readSnapshot: async () => ACCEPTED_SNAPSHOT,
    refreshSmartMoney: async () => { adapterCalls += 1; },
  });
  const { req, res } = mockRequest('/api/smart-money?refresh=1');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(adapterCalls, 0);
  assert.match(res.headers['Cache-Control'], /no-store/);
});

test('protected refresh rejects query-string secrets', async () => {
  const handler = createSmartMoneyRefreshHandler({ cronSecret: 'secret' });
  const { req, res } = mockRequest('/api/smart-money/refresh?secret=secret');
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('public snapshot exposes performances and history follows the master envelope', async () => {
  const snapshotHandler = createSmartMoneyHandler({ readSnapshot: async () => ACCEPTED_SNAPSHOT });
  const snapshotIo = mockRequest('/api/smart-money');
  await snapshotHandler(snapshotIo.req, snapshotIo.res);
  assert.deepEqual(snapshotIo.res.body.performances, ACCEPTED_SNAPSHOT.performances);

  const historyHandler = createSmartMoneyHistoryHandler({
    readJournal: async () => ACCEPTED_HISTORY,
  });
  const historyIo = mockRequest('/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=200');
  await historyHandler(historyIo.req, historyIo.res);
  assert.deepEqual(historyIo.res.body.dailyMarks, ACCEPTED_HISTORY.dailyMarks);
  assert.equal(historyIo.res.body.nextCursor, null);
});

test('health exposes deployment identity and invalid SEC contact state', () => {
  const health = buildSmartMoneyHealth({
    snapshot: ACCEPTED_SNAPSHOT,
    deploymentCommit: 'abc123',
    deploymentEnvironment: 'production',
    groqConfigured: false,
    secUserAgent: 'CommsDashboard/1.0 placeholder@example.com',
    now: new Date('2026-08-26T12:00:00Z'),
  });
  assert.equal(health.deployment.commitSha, 'abc123');
  assert.equal(health.configuration.secUserAgent, 'invalid');
  assert.equal(health.configuration.groq, 'missing_optional');
});
```

- [ ] **Step 2: Run focused tests and confirm missing orchestration failures**

Run:

```powershell
node --test test/smart-money-refresh.test.js test/smart-money-api.test.js test/smart-money-no-trading.test.js
```

Expected: FAIL because the refresher and handlers do not exist.

- [ ] **Step 3: Implement refresh ordering, health, and dependency-injected handlers**

Refresh in this exact order:

```js
export function createSmartMoneyRefresher(deps) {
  return async function refreshSmartMoney({ trigger = 'cron' } = {}) {
    return deps.withRefreshLock(async () => {
      const now = deps.now();
      deps.assertAdapterRights(deps.adapters, deps.rights, { now });
      const previous = await deps.readSnapshot();
      const dueAdapters = deps.adapters.filter((adapter) =>
        deps.isAdapterDue(adapter, previous, now));
      const settled = await Promise.allSettled(
        dueAdapters.map((adapter) => adapter.fetch(deps)),
      );
      const normalized = deps.normalizeSettled({
        allAdapters: deps.adapters,
        dueAdapters,
        settled,
        previous,
        now,
      });
      const derived = deps.deriveSignals({
        current: normalized,
        previous,
        pendingConfirmations: previous?.adapterState?.pendingConfirmations || [],
        nowMs: now.getTime(),
      });
      const pricedSignals = await deps.resolveReferencePrices(derived.signals);
      const retainedTickers = await deps.listTrackedTickers({
        since: new Date(now.getTime() - 400 * 86400000).toISOString(),
      });
      const dailyMarkTickers = [...new Set([
        ...retainedTickers,
        ...pricedSignals.flatMap((signal) => signal.asset?.ticker || []),
        'SPX',
        'BTC',
      ])];
      const completedUtcDate = new Date(now.getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
      const dailyMarks = await deps.resolveDailyMarks({
        tickers: dailyMarkTickers,
        date: completedUtcDate,
      });
      const journalWrites = await deps.appendJournal({
        signals: pricedSignals,
        dailyMarks,
      });
      if (!journalWrites.durableWriteSucceeded) {
        return deps.buildRefreshResult({
          trigger,
          normalized,
          acceptedSignals: [],
          journalWrites,
          persistence: null,
          errorCode: 'journal_persistence_failed',
        });
      }
      const committedSignals = journalWrites.committedSignals;
      const persistence = await deps.writeSnapshot(
        deps.buildSnapshot(normalized, derived, committedSignals),
      );
      return deps.buildRefreshResult({
        trigger,
        normalized,
        acceptedSignals: persistence.durableWriteSucceeded ? committedSignals : [],
        journalWrites,
        persistence,
        errorCode: persistence.durableWriteSucceeded
          ? null
          : 'snapshot_persistence_failed',
      });
    });
  };
}
```

GET /api/smart-money permits only refresh=1, which rereads accepted data with
no-store and returns entities, activities, performances, signals, and rankings.
GET /api/smart-money/history returns the exact master history envelope, requires
inclusive since, limit 1–500, maximum 400-day lookback, and an opaque cursor for
observedAt plus ID. Health returns concrete children and derived rollups plus
`deployment.commitSha = process.env.VERCEL_GIT_COMMIT_SHA || null`, deployment
environment, storage diagnostics, rights state, and SEC user-agent
configured/missing/invalid state. It also reports optional Groq as
`configured` or `missing_optional`; missing Groq never degrades provider health.
Protected refresh requires exact Authorization
Bearer CRON_SECRET and returns 503 when either the journal or accepted snapshot
lacks a durable commit. A durable journal alone never makes a signal public;
retry deduplication safely completes the snapshot later. Snapshot publication
always uses appendJournal.committedSignals, never freshly re-resolved prices, so
the journal and public snapshot cannot disagree after a price-drift retry.

`isAdapterDue` uses the Task 6 cache TTL. Not-due adapters reuse accepted cached
records with freshness recomputed at `now`, make no network request, and create
no new signal. Every configured adapter remains present in snapshot and health
output whether it was fetched or skipped.

test/helpers/api.js exports mockRequest(path, options), where options defaults to
method GET and may contain authorization. It returns a Node-style req plus a res
that captures statusCode, headers, and parsed JSON body. Reuse that helper in
operations and briefing handler tests.

test/fixtures/smart-money/scenarios.js exports ACCEPTED_HISTORY,
ACCEPTED_SNAPSHOT, DEPS_WITH_ONE_TIMEOUT, and createRefreshDeps(overrides).
createRefreshDeps returns `{ deps, calls, captured }`; its append/snapshot
durability switches and captured daily-mark tickers make both one-sided commit
failures and the no-signal day deterministic.

The no-trading test imports all lib/smart-money and api/smart-money modules,
inspects exports and captured fetch origins, and fails on order creation,
exchange routes, wallet signing, deposits, withdrawals, credential fields, or
target-allocation execution.

- [ ] **Step 4: Run all Provider Core tests and full regressions**

Run:

```powershell
node --test test/smart-money-rights.test.js test/smart-money-entities.test.js test/smart-money-http.test.js test/feed-parser.test.js test/smart-money-sec.test.js test/smart-money-publications.test.js test/smart-money-polymarket.test.js test/smart-money-hyperliquid.test.js test/smart-money-disclosures.test.js test/smart-money-normalize.test.js test/smart-money-rank.test.js test/smart-money-signals.test.js test/smart-money-store.test.js test/smart-money-journal.test.js test/smart-money-reference-prices.test.js test/smart-money-refresh.test.js test/smart-money-api.test.js test/smart-money-no-trading.test.js
npm test
npm run build
```

Expected: all tests and production build PASS.

- [ ] **Step 5: Commit Provider Core APIs**

```powershell
git add lib/smart-money api/smart-money.js api/smart-money test/helpers/api.js test/fixtures/smart-money/scenarios.js test/smart-money-refresh.test.js test/smart-money-api.test.js test/smart-money-no-trading.test.js
git diff --cached --check
git commit -m "feat: expose smart money intelligence APIs"
```
