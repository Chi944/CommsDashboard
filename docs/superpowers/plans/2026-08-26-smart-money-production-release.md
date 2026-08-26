# Smart Money Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Enforce source permissions and provider health in CI, share scheduled refresh safely, add production/API/browser smoke coverage, document the feature, deploy it, and record verifiable evidence.

**Architecture:** Build and deployment fail before compilation when an enabled source lacks valid rights. Existing twice-daily refresh jobs become one isolated market-plus-Smart-Money orchestrator, while a scheduled smoke validates every concrete adapter, both generated and deterministic daily briefings, commit identity, and the no-trading UI boundary.

**Tech Stack:** Node.js 22, GitHub Actions, Vercel CLI 52, Vercel Cron, Vercel Functions, Playwright Chromium, existing CI, production URL https://comms-dashboard-navy.vercel.app, and the complete Provider/Experience/Paper plans.

**Spec:** docs/superpowers/specs/2026-08-26-smart-money-intelligence-design.md

## Global Constraints

- Provider Core, Intelligence Experience, and Paper Simulation plans must pass before deployment work.
- npm run build itself must fail when the source-rights matrix is invalid or expired.
- Keep exactly the existing two cron schedules, 06:00 and 18:00 UTC.
- Add one protected GitHub Smart Money refresh schedule every ten minutes; the
  server fetches only adapters whose source-specific cache TTL has elapsed.
- Authenticate internal refresh with Authorization Bearer CRON_SECRET only.
- One refresh subsystem failure must not prevent the other from finishing or rewrite its health.
- Production smoke must inspect every enabled concrete adapter, not only group rollups.
- The generated and forced-deterministic Pulse must both be current and evidence-grounded.
- The deployed Vercel commit must equal local HEAD.
- Do not complete the goal while any enabled adapter is stale, unavailable, empty, or rights-blocked.
- Preserve cursor-handoff.md untracked and unstaged.

---

### Task 1: Turn the rights matrix into a build and CI gate

**Files:**
- Create: scripts/check-smart-money-rights.mjs
- Modify: lib/smart-money/rights.js
- Modify: config/smart-money-source-rights.json
- Modify: docs/smart-money-source-rights.md
- Modify: package.json
- Create: test/fixtures/smart-money/rights-unclear.json
- Test: test/smart-money-rights.test.js

**Interfaces:**
- Consumes: Task 1 Provider Core matrix and validator.
- Produces: npm run check:smart-money-rights and a prebuild failure for invalid enabled sources.

- [ ] **Step 1: Add failing CLI exit-code and concrete-adapter coverage tests**

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { listConfiguredAdapters } from '../lib/smart-money/entities.js';
import { canUseSourceFor } from '../lib/smart-money/rights.js';
import rights from '../config/smart-money-source-rights.json' with { type: 'json' };

test('every enabled concrete adapter names a current enabling rights record', () => {
  const byId = new Map(rights.map((row) => [row.id, row]));
  for (const adapter of listConfiguredAdapters({ now: new Date('2026-08-26T00:00:00Z') })) {
    const record = byId.get(adapter.rightsId);
    assert.ok(record, adapter.id);
    assert.equal(record.decision, 'enable', adapter.id);
    assert.ok(Date.parse(record.reviewDueAt) >= Date.parse('2026-08-26'), adapter.id);
    assert.equal(record.cost.tier, 'free', adapter.id);
    assert.equal(record.cost.paidCredentialRequired, false, adapter.id);
    for (const purpose of adapter.requiredPurposes) {
      assert.equal(canUseSourceFor(record.id, purpose, rights, {
        now: new Date('2026-08-26T00:00:00Z'),
      }), true, adapter.id + ':' + purpose);
    }
  }
});

test('rights checker exits nonzero for an unclear operation', () => {
  const result = spawnSync(process.execPath, ['scripts/check-smart-money-rights.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, SMART_MONEY_RIGHTS_FIXTURE: 'test/fixtures/smart-money/rights-unclear.json' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rights gate failed/i);
});
```

- [ ] **Step 2: Run the focused suite and verify the CLI is absent**

Run:

```powershell
node --test test/smart-money-rights.test.js
```

Expected: FAIL because scripts/check-smart-money-rights.mjs does not exist.

- [ ] **Step 3: Implement the checker and prebuild script**

```js
import fs from 'node:fs';
import {
  assertAdapterRights,
  validateRightsMatrix,
} from '../lib/smart-money/rights.js';
import { listConfiguredAdapters } from '../lib/smart-money/entities.js';

const path = process.env.SMART_MONEY_RIGHTS_FIXTURE
  || new URL('../config/smart-money-source-rights.json', import.meta.url);

try {
  const matrix = JSON.parse(fs.readFileSync(path, 'utf8'));
  const result = validateRightsMatrix(matrix, { now: new Date() });
  if (!result.ok) throw new Error(result.errors.join(','));
  assertAdapterRights(listConfiguredAdapters({ now: new Date() }), matrix, { now: new Date() });
  console.log('Smart Money source-rights gate passed');
} catch {
  console.error('Smart Money source-rights gate failed');
  process.exitCode = 1;
}
```

Add exact scripts:

```json
{
  "check:smart-money-rights": "node scripts/check-smart-money-rights.mjs",
  "prebuild": "npm run check:smart-money-rights"
}
```

Update the human-readable rights document from the machine-readable matrix.
Every enabled record must contain affirmative evidence for its exact operations;
link-only/excluded records must not appear in adapter config. The checker also
requires machine-readable `cost.tier === 'free'`, no paid credential, current
review dates, the full permission-key set, attribution permission, and evidence
URLs before compilation.

- [ ] **Step 4: Run rights, build, and CI-equivalent checks**

Run:

```powershell
npm run check:smart-money-rights
npm run build
npm test
```

Expected: all commands PASS; changing any required permission to unclear makes build fail before Vite.

- [ ] **Step 5: Commit the release gate**

```powershell
git add scripts/check-smart-money-rights.mjs lib/smart-money/rights.js config/smart-money-source-rights.json docs/smart-money-source-rights.md package.json test/smart-money-rights.test.js test/fixtures/smart-money/rights-unclear.json
git diff --cached --check
git commit -m "build: enforce smart money source rights"
```

---

### Task 2: Share the existing twice-daily cron safely

**Files:**
- Modify: api/market/refresh.js
- Create: api/cron/refresh.js
- Modify: api/smart-money/refresh.js
- Modify: vercel.json
- Create: .github/workflows/smart-money-refresh.yml
- Create: test/smart-money-operations.test.js
- Modify: test/market-reliability.test.js

**Interfaces:**
- Consumes: refreshMarketProviders(deps), refreshSmartMoney(options), CRON_SECRET, and separate durable-write results.
- Produces: createCombinedRefreshHandler(deps) and GET /api/cron/refresh.

- [ ] **Step 1: Write failing authentication and subsystem-isolation tests**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createCombinedRefreshHandler } from '../api/cron/refresh.js';
import { mockRequest } from './helpers/api.js';

test('combined cron authenticates once and lets both subsystems finish', async () => {
  const calls = [];
  const handler = createCombinedRefreshHandler({
    cronSecret: 'secret',
    refreshMarket: async () => { calls.push('market'); return { ok: true, persisted: true }; },
    refreshSmartMoney: async () => { calls.push('smart'); return { ok: true, persisted: true }; },
  });
  const { req, res } = mockRequest('/api/cron/refresh', {
    authorization: 'Bearer secret',
  });
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.sort(), ['market', 'smart']);
});

test('one thrown subsystem does not stop the other from completing', async () => {
  let smartFinished = false;
  const handler = createCombinedRefreshHandler({
    cronSecret: 'secret',
    refreshMarket: async () => { throw new Error('market failed'); },
    refreshSmartMoney: async () => { smartFinished = true; return { ok: true, persisted: true }; },
  });
  const { req, res } = mockRequest('/api/cron/refresh', {
    authorization: 'Bearer secret',
  });
  await handler(req, res);
  assert.equal(smartFinished, true);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.smartMoney.persisted, true);
});

test('protected Smart Money workflow refreshes by bearer header every ten minutes', () => {
  const workflow = fs.readFileSync('.github/workflows/smart-money-refresh.yml', 'utf8');
  assert.match(workflow, /cron:\s*['"]\*\/10 \* \* \* \*['"]/);
  assert.match(workflow, /Authorization: Bearer \$\{CRON_SECRET\}/);
  assert.match(workflow, /\/api\/smart-money\/refresh/);
  assert.match(workflow, /run-name: Smart Money refresh/);
  assert.match(workflow, /dispatch_id/);
  assert.doesNotMatch(workflow, /[?&](secret|token)=/i);
});
```

- [ ] **Step 2: Run operations and market reliability tests**

Run:

```powershell
node --test test/smart-money-operations.test.js test/market-reliability.test.js
```

Expected: FAIL because the shared cron handler and auth-free market core do not exist.

- [ ] **Step 3: Extract the market core and implement isolated combined refresh**

Export from api/market/refresh.js:

```js
export async function refreshMarketProviders(dependencies = {}) {
  return runMarketProviderRefresh(dependencies);
}
```

Keep the existing /api/market/refresh wrapper behavior for compatibility.
Implement the combined handler:

```js
export function createCombinedRefreshHandler(deps = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method_not_allowed' });
    if (req.headers.authorization !== 'Bearer ' + deps.cronSecret) {
      return send(res, 401, { ok: false, error: 'unauthorized' });
    }
    const [market, smartMoney] = await Promise.allSettled([
      deps.refreshMarket(),
      deps.refreshSmartMoney({ trigger: 'cron' }),
    ]);
    return sendCombinedRefresh(res, market, smartMoney);
  };
}
```

Change vercel.json to these exact schedules and limits:

```json
{
  "functions": {
    "api/market/refresh.js": { "maxDuration": 120 },
    "api/cron/refresh.js": { "maxDuration": 120 },
    "api/smart-money/refresh.js": { "maxDuration": 120 }
  },
  "crons": [
    { "path": "/api/cron/refresh", "schedule": "0 6 * * *" },
    { "path": "/api/cron/refresh", "schedule": "0 18 * * *" }
  ]
}
```

Preserve framework, build, output, install, and rewrite settings already present.

Create .github/workflows/smart-money-refresh.yml with schedule `*/10 * * * *`
and workflow_dispatch input `dispatch_id`. Set
`run-name: Smart Money refresh ${{ inputs.dispatch_id || github.run_id }}` so a
release can identify the exact manual run without racing an older schedule. It
sends repository secret CRON_SECRET only as a Bearer
header to `https://comms-dashboard-navy.vercel.app/api/smart-money/refresh`, uses
a 120-second request timeout plus bounded retry, and has concurrency cancellation
disabled so a newer run cannot interrupt a durable journal/snapshot commit.
Provider Core skips not-due adapters: Polymarket can refresh each run,
Hyperliquid hourly, and official sources twice daily. A delayed workflow is
reported honestly by freshness health rather than relabeled LIVE.

- [ ] **Step 4: Run operations, market, and full tests**

Run:

```powershell
node --test test/smart-money-operations.test.js test/market-reliability.test.js
npm test
npm run build
```

Expected: PASS; one subsystem failure never prevents the other from executing.

- [ ] **Step 5: Commit shared refresh orchestration**

```powershell
git add api/market/refresh.js api/cron/refresh.js api/smart-money/refresh.js vercel.json .github/workflows/smart-money-refresh.yml test/smart-money-operations.test.js test/market-reliability.test.js
git diff --cached --check
git commit -m "feat: refresh market and smart money caches safely"
```

---

### Task 3: Add strict Smart Money production smoke

**Files:**
- Create: scripts/smoke-smart-money.mjs
- Create: test/fixtures/smart-money/smoke.js
- Create: test/smoke-smart-money.test.js
- Modify: package.json
- Modify: .github/workflows/production-smoke.yml

**Interfaces:**
- Consumes: protected combined refresh, public Smart Money snapshot/health/briefing routes, SMART_MONEY_REFRESH_SECRET, AI_SMOKE_SECRET, EXPECTED_DEPLOYMENT_COMMIT, listConfiguredAdapters(), and existing production smoke conventions.
- Produces: exported runSmartMoneySmoke(baseUrl, options), npm run smoke:smart-money, optional machine-readable --json evidence, and scheduled production verification.

- [ ] **Step 1: Write failing success, stale-provider, evidence, commit, and timeout tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { runSmartMoneySmoke } from '../scripts/smoke-smart-money.mjs';
import { SUCCESS_RESPONSES } from './fixtures/smart-money/smoke.js';

test('smart smoke checks every concrete provider and both briefing paths', async () => {
  await withServer(SUCCESS_RESPONSES, async (baseUrl, seen) => {
    const result = await runSmartMoneySmoke(baseUrl, {
      expectedCommit: 'abc123',
      refreshSecret: 'refresh-secret',
      secret: 'smoke-secret',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(seen.map((row) => row.pathname), [
      '/api/cron/refresh',
      '/api/smart-money',
      '/api/smart-money/health',
      '/api/smart-money/briefing',
      '/api/smart-money/briefing',
    ]);
    assert.equal(seen[0].authorization, 'Bearer refresh-secret');
    assert.equal(seen[0].search, '');
  });
});

test('smart smoke fails when one enabled concrete adapter is stale', async () => {
  const responses = structuredClone(SUCCESS_RESPONSES);
  responses.health.providerStatuses[1].status = 'stale';
  const result = await runAgainst(responses);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /provider.*stale/i);
});

test('smart smoke fails when deployed commit differs from expected commit', async () => {
  const responses = structuredClone(SUCCESS_RESPONSES);
  responses.health.deployment.commitSha = 'wrong';
  const result = await runAgainst(responses, { expectedCommit: 'abc123' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /deployment commit/i);
});

test('smart smoke makes no request without both secrets', async () => {
  await withServer(SUCCESS_RESPONSES, async (baseUrl, seen) => {
    const result = await runSmartMoneySmoke(baseUrl, {
      expectedCommit: 'abc123',
      refreshSecret: '',
      secret: 'smoke-secret',
    });
    assert.notEqual(result.code, 0);
    assert.deepEqual(seen, []);
  });
});
```

Follow test/smoke-ai.test.js for the local HTTP server and child-process runner.
Export SUCCESS_RESPONSES from test/fixtures/smart-money/smoke.js. The fixture
must contain the exact enabled IDs returned by listConfiguredAdapters(), exactly three fixed
paragraph IDs, resolved dated evidence, current sentiment, an AI normal source
when health reports Groq configured, deterministic fallback source, and commit
abc123. Also include a valid missing_optional-Groq variant whose normal path is
deterministic. Keep withServer and runAgainst
as local test helpers in test/smoke-smart-money.test.js so the test has no hidden
dependency on the implementation script.

- [ ] **Step 2: Run the focused test and verify the script is missing**

Run:

```powershell
node --test test/smoke-smart-money.test.js
```

Expected: FAIL because scripts/smoke-smart-money.mjs does not exist.

- [ ] **Step 3: Implement bounded smoke and extend the existing workflow**

The script requests, in order:

```text
/api/cron/refresh
/api/smart-money?refresh=1
/api/smart-money/health
/api/smart-money/briefing?aiSmoke=generated-runtime-nonce
/api/smart-money/briefing?aiSmoke=generated-runtime-nonce&fallback=1
```

Generate generated-runtime-nonce once per process from Date.now(), process.pid,
and randomUUID(), then URL-encode the same value for both briefing requests.

Send SMART_MONEY_REFRESH_SECRET only as the Authorization Bearer header on the
first request; never put it in a URL or log. This protected warm is required
because Polymarket and Hyperliquid freshness windows are shorter than the gap
between the twice-daily crons and the 12:17 UTC smoke.

Use AbortController and x-ai-smoke-secret. Import listConfiguredAdapters and
assert the returned concrete provider-ID set equals the exact enabled config
set—no missing or extra enabled provider. Assert every enabled concrete status
is live, recordCount is positive, timestamps are valid, group rollups do not
replace children, marketDate is current UTC, paragraph IDs are exact, every
evidence ID resolves, forced source is deterministic, current sentiment exists,
and deployment commit matches EXPECTED_DEPLOYMENT_COMMIT. When health reports
`configuration.groq === 'configured'`, require normal source `ai`; when it
reports `missing_optional`, accept and require normal source `deterministic`.
In both cases all three current evidence-grounded paragraphs are mandatory.
Export runSmartMoneySmoke without executing the CLI;
guard CLI startup with an import.meta.url/pathToFileURL check. `--json` emits one
sanitized JSON object with adapter rows and assertion results. Never print
secrets or raw provider bodies.

Add:

```json
{
  "smoke:smart-money": "node scripts/smoke-smart-money.mjs"
}
```

Rename the workflow to Production smoke and run both node scripts at the
existing 12:17 UTC schedule. Pass AI_SMOKE_BASE_URL, AI_SMOKE_SECRET, and
EXPECTED_DEPLOYMENT_COMMIT from github.sha, plus SMART_MONEY_REFRESH_SECRET from
the repository CRON_SECRET secret. Fail before any request if either secret is
empty.

- [ ] **Step 4: Run both smoke unit suites**

Run:

```powershell
node --test test/smoke-ai.test.js test/smoke-smart-money.test.js
```

Expected: PASS for success and every negative condition.

- [ ] **Step 5: Commit production smoke**

```powershell
git add scripts/smoke-smart-money.mjs test/fixtures/smart-money/smoke.js test/smoke-smart-money.test.js package.json .github/workflows/production-smoke.yml
git diff --cached --check
git commit -m "test: smoke smart money production health"
```

---

### Task 4: Add real responsive/browser coverage

**Files:**
- Create: playwright.config.js
- Create: test/fixtures/smart-money/e2e.js
- Create: test/e2e/smart-money-responsive.spec.js
- Create: test/e2e/smart-money-persistence.spec.js
- Modify: package.json
- Modify: package-lock.json
- Modify: .github/workflows/ci.yml

**Interfaces:**
- Consumes: built Vite or deployed application, deterministic safe read fixtures, and stable accessible labels from the feature plans.
- Produces: npm run test:e2e plus local/production Chromium viewport, persistence, and captured-request no-trading checks.

- [ ] **Step 1: Write the failing responsive browser spec**

```js
import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(viewport.name + ' Smart Money layout has no document overflow', async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?tab=Intel&view=smart-money');
    await expect(page.getByRole('tab', { name: 'Smart Money' })).toHaveAttribute('aria-selected', 'true');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('navigation').last().getByRole('button')).toHaveCount(5);
    await expect(page.getByText(/No orders are placed/i)).toBeVisible();
  });
}

test('Paper Copy exposes no trading action', async ({ page }) => {
  await page.goto('/?tab=Portfolio&view=paper-copy');
  await expect(page.getByRole('button', { name: /buy|sell|execute|connect wallet/i })).toHaveCount(0);
});
```

In test/e2e/smart-money-persistence.spec.js, import
installSmartMoneyScenario(page) from test/fixtures/smart-money/e2e.js and add
this deterministic deployed-client flow:

```js
test('follow, start, post-opt-in signal, and reload stay local and read-only', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push({
    method: request.method(),
    url: request.url(),
  }));
  const scenario = await installSmartMoneyScenario(page, {
    now: '2026-08-26T10:00:00.000Z',
    nextSignalAt: '2026-08-26T10:01:00.000Z',
  });
  await page.goto('/?tab=Intel&view=smart-money&record=hyperliquid:0xabc');
  await page.getByRole('button', { name: /follow/i }).click();
  await page.goto('/?tab=Portfolio&view=paper-copy');
  await page.getByRole('button', { name: /start paper tracking/i }).click();
  await scenario.publishPostOptInSignal();
  await page.getByRole('button', { name: /refresh smart money/i }).click();
  await expect(page.getByTestId('paper-transaction-1')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('paper-transaction-1')).toBeVisible();
  await expect(page.getByText(/Following/i)).toBeVisible();
  expect(requests.every((row) => ['GET', 'HEAD'].includes(row.method))).toBe(true);
  expect(requests.some((row) => /order|exchange|sign|wallet|deposit|withdraw|credential/i.test(row.url))).toBe(false);
});
```

The helper freezes browser time, fulfills only the documented read routes with
master-contract fixtures, exposes a supported signal observed after the fixed
strategy start, and captures no user state. It must not fulfill or allow an
order-like request; such a request fails the test immediately.

- [ ] **Step 2: Install Playwright and observe the spec fail before fixtures are wired**

Run:

```powershell
npm install --save-dev @playwright/test@^1.55.0
npx playwright install chromium
npx playwright test test/e2e/smart-money-responsive.spec.js --project=chromium
```

Expected: FAIL until the test server and deterministic Smart Money API fixtures are configured.

- [ ] **Step 3: Configure Vite webServer and deterministic route fixtures**

Use:

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    port: 4173,
    reuseExistingServer: false,
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
});
```

Route /api/smart-money, history, health, briefing, and trusted market marks
inside each Playwright test before page.goto so tests never depend on external
providers or mutate shared production data. Because production runs use the
deployed JS/CSS with only read API responses fulfilled, they verify the actual
deployed client bundle and browser-local persistence safely. Add package script:

```json
{
  "test:e2e": "playwright test --project=chromium"
}
```

After npm ci in .github/workflows/ci.yml, install Chromium with
npx playwright install --with-deps chromium and run npm run test:e2e after
npm test. Keep the existing build and high-severity audit steps.

- [ ] **Step 4: Run responsive and full local verification**

Run:

```powershell
npm run test:e2e
npm test
npm run build
```

Expected: PASS at 390x844, 768x1024, and 1440x900 with no horizontal overflow and exactly five bottom-nav items.
The persistence flow also passes after reload and its request capture contains
only GET/HEAD requests with no execution or credential path.

- [ ] **Step 5: Commit browser coverage**

```powershell
git add playwright.config.js test/fixtures/smart-money/e2e.js test/e2e/smart-money-responsive.spec.js test/e2e/smart-money-persistence.spec.js package.json package-lock.json .github/workflows/ci.yml
git diff --cached --check
git commit -m "test: cover smart money responsive flows"
```

---

### Task 5: Document, deploy, and production-verify the completed feature

**Files:**
- Modify: README.md
- Modify: .env.example
- Create: docs/smart-money-methodology.md
- Create: docs/smart-money-production-verification.md
- Modify: test/smart-money-rights.test.js

**Interfaces:**
- Consumes: every local test/build result, rights matrix, Vercel project link, production health/smoke output, and deployment commit.
- Produces: one clean release commit, its matching production deployment, and an immutable annotated evidence tag targeting that exact commit.

- [ ] **Step 1: Write documentation assertions before editing docs**

Add to test/smart-money-rights.test.js:

```js
import fs from 'node:fs';

test('README documents required Smart Money operations and no-trading boundary', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const required of [
    'SEC_USER_AGENT',
    '/api/smart-money',
    '/api/smart-money/health',
    '/api/smart-money/history',
    '/api/smart-money/briefing',
    '/api/cron/refresh',
    'No orders are placed',
  ]) {
    assert.match(readme, new RegExp(required.replaceAll('/', '\\/'), 'i'));
  }
});
```

- [ ] **Step 2: Run the documentation assertion and verify it fails**

Run:

```powershell
node --test test/smart-money-rights.test.js
```

Expected: FAIL because README does not yet document the new subsystem.

- [ ] **Step 3: Document sources, methodology, operations, and environment**

README and docs/smart-money-methodology.md must describe:

- every enabled concrete source and rights-matrix link;
- investor attribution, 13F period/filed/lag limitations, and verified performance;
- provider-separated crypto eligibility and materiality thresholds;
- cache/stale windows, health semantics, LKG exclusion from signals, and twice-daily shared cron;
- daily AI and deterministic Pulse behavior;
- Paper Copy timing, sizing, exposure, friction, benchmarks, local privacy, and no-order boundary;
- SEC_USER_AGENT, CRON_SECRET, optional GROQ_API_KEY, Redis, Blob, and Vercel system variables;
- all public/internal routes and smoke commands.

SEC_USER_AGENT must use this format in local and Vercel configuration:

```text
CommsDashboard/1.0 <user-confirmed-monitored-email>
```

The mailbox must be actively monitored and must not use an example/placeholder
domain. docs/smart-money-production-verification.md is a runbook for the exact
release, smoke, browser, evidence-tag, and rollback checks; it contains no
claimed production result before those checks run.

- [ ] **Step 4: Commit the documentation and prove one clean release commit locally**

Run:

```powershell
git add README.md .env.example docs/smart-money-methodology.md docs/smart-money-production-verification.md test/smart-money-rights.test.js
git diff --cached --check
git commit -m "docs: document smart money operations"

npm ci
npm run check:smart-money-rights
npm test
npm run test:e2e
npm run build
npm audit --audit-level=high
git status --short
git push origin main
```

Expected: git status contains only the pre-existing untracked cursor-handoff.md.
If a gate fails, keep the goal active, fix and commit the specific failure, and
rerun this entire step. The resulting pushed HEAD is the immutable release
candidate; do not change tracked files after it is deployed.

- [ ] **Step 5: Configure, deploy, production-test, and tag immutable evidence**

Preflight user-supplied secrets without printing them, deploy exactly HEAD, and
run API plus real-browser verification:

```powershell
$ErrorActionPreference = 'Stop'
function Assert-NativeSuccess([string]$label) {
  if ($LASTEXITCODE -ne 0) { throw "$label failed with exit $LASTEXITCODE" }
}

$requiredSecretNames = @('AI_SMOKE_SECRET', 'SMART_MONEY_REFRESH_SECRET', 'SEC_USER_AGENT')
foreach ($name in $requiredSecretNames) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "$name is required" }
}
if ($env:SEC_USER_AGENT -notmatch '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' -or
    $env:SEC_USER_AGENT -match '@(example\.(com|org|net)|[^@]+\.invalid)') {
  throw 'SEC_USER_AGENT must contain the confirmed monitored mailbox'
}

# Replace the three production values from confirmed local secrets so Vercel and
# GitHub use the same refresh secret; never print or commit either value.
npx vercel env rm SEC_USER_AGENT production --yes | Out-Null
$env:SEC_USER_AGENT | npx vercel env add SEC_USER_AGENT production
Assert-NativeSuccess 'Vercel SEC_USER_AGENT update'
npx vercel env rm CRON_SECRET production --yes | Out-Null
$env:SMART_MONEY_REFRESH_SECRET | npx vercel env add CRON_SECRET production
Assert-NativeSuccess 'Vercel CRON_SECRET update'
npx vercel env rm AI_SMOKE_SECRET production --yes | Out-Null
$env:AI_SMOKE_SECRET | npx vercel env add AI_SMOKE_SECRET production
Assert-NativeSuccess 'Vercel AI_SMOKE_SECRET update'
npx vercel env ls
Assert-NativeSuccess 'Vercel environment listing'
$env:SMART_MONEY_REFRESH_SECRET | gh secret set CRON_SECRET --repo Chi944/CommsDashboard
Assert-NativeSuccess 'GitHub CRON_SECRET update'
$env:AI_SMOKE_SECRET | gh secret set AI_SMOKE_SECRET --repo Chi944/CommsDashboard
Assert-NativeSuccess 'GitHub AI_SMOKE_SECRET update'

$releaseCommit = (git rev-parse HEAD).Trim()
Assert-NativeSuccess 'Read release commit'
git fetch origin main
Assert-NativeSuccess 'Fetch origin/main'
$originMain = (git rev-parse origin/main).Trim()
Assert-NativeSuccess 'Read origin/main'
if ($originMain -ne $releaseCommit) { throw 'origin/main does not match release commit' }

$deploymentUrl = (npx vercel --prod --yes | Select-Object -Last 1).Trim()
Assert-NativeSuccess 'Vercel production deployment'
npx vercel inspect $deploymentUrl --wait
Assert-NativeSuccess 'Vercel deployment inspection'

$dispatchId = 'release-' + $releaseCommit.Substring(0, 12) + '-' + [guid]::NewGuid().ToString('N')
gh workflow run smart-money-refresh.yml --repo Chi944/CommsDashboard -f "dispatch_id=$dispatchId"
Assert-NativeSuccess 'Dispatch protected refresh workflow'
$deadline = (Get-Date).AddMinutes(2)
do {
  $runJson = gh run list --repo Chi944/CommsDashboard --workflow smart-money-refresh.yml --limit 20 --json databaseId,displayTitle,status
  Assert-NativeSuccess 'List protected refresh workflow runs'
  $refreshRun = ($runJson | ConvertFrom-Json) |
    Where-Object { $_.displayTitle -eq "Smart Money refresh $dispatchId" } |
    Select-Object -First 1
  if (-not $refreshRun) { Start-Sleep -Seconds 3 }
} while (-not $refreshRun -and (Get-Date) -lt $deadline)
if (-not $refreshRun) { throw 'new protected refresh workflow run was not found' }
$refreshRunId = [string]$refreshRun.databaseId
gh run watch $refreshRunId --repo Chi944/CommsDashboard --exit-status
Assert-NativeSuccess 'Protected refresh workflow'

$base = 'https://comms-dashboard-navy.vercel.app'
$env:AI_SMOKE_BASE_URL = $base
$env:EXPECTED_DEPLOYMENT_COMMIT = $releaseCommit
npm run smoke:ai -- $base NVDA
Assert-NativeSuccess 'Existing AI smoke'
$smartMoneyEvidenceJson = (npm run --silent smoke:smart-money -- $base --json | Out-String).Trim()
Assert-NativeSuccess 'Smart Money smoke'
$smartMoneyEvidence = $smartMoneyEvidenceJson | ConvertFrom-Json

$env:PLAYWRIGHT_BASE_URL = $base
npx playwright test test/e2e/smart-money-responsive.spec.js test/e2e/smart-money-persistence.spec.js --project=chromium
Assert-NativeSuccess 'Production browser verification'

$health = Invoke-RestMethod "$base/api/smart-money/health"
if ($health.deployment.commitSha -ne $releaseCommit) { throw 'production commit mismatch' }

$evidence = [ordered]@{
  schemaVersion = 1
  verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  releaseCommit = $releaseCommit
  deploymentUrl = $deploymentUrl
  productionAlias = $base
  rightsGate = 'passed'
  protectedRefreshWorkflow = @{
    runId = $refreshRunId
    status = 'passed'
  }
  existingMarketAiSmoke = 'passed'
  productionBrowser = @{
    viewports = @('390x844', '768x1024', '1440x900')
    persistenceReload = 'passed'
    capturedRequests = 'GET_HEAD_only_no_execution_or_credentials'
  }
  smartMoneySmoke = $smartMoneyEvidence
  health = $health
}
$evidenceFile = New-TemporaryFile
$evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $evidenceFile
$tag = 'smart-money-production-2026-08-26'
git rev-parse --verify --quiet "refs/tags/$tag" | Out-Null
if ($LASTEXITCODE -eq 0) { throw "tag already exists: $tag" }
git tag -a $tag $releaseCommit -F $evidenceFile
Assert-NativeSuccess 'Create production evidence tag'
Remove-Item -LiteralPath $evidenceFile
git push origin "refs/tags/$tag"
Assert-NativeSuccess 'Push production evidence tag'

$head = (git rev-parse HEAD).Trim()
Assert-NativeSuccess 'Verify HEAD'
$localTagTarget = (git rev-list -n 1 $tag).Trim()
Assert-NativeSuccess 'Verify local tag target'
$remoteTagLine = (git ls-remote --tags origin "refs/tags/$tag^{}" | Out-String).Trim()
Assert-NativeSuccess 'Verify remote tag'
$remoteTagTarget = ($remoteTagLine -split '\s+')[0]
if ($head -ne $releaseCommit -or $localTagTarget -ne $releaseCommit -or
    $remoteTagTarget -ne $releaseCommit) {
  throw 'release commit or evidence tag target mismatch'
}
$status = @(git status --short)
Assert-NativeSuccess 'Read final git status'
$unexpected = @($status | Where-Object { $_ -ne '?? cursor-handoff.md' })
if ($unexpected.Count -gt 0) { throw 'unexpected final worktree changes' }
```

If a Vercel value is absent, a nonzero remove is acceptable only for
`not_found`; every add must succeed. Never leave duplicate values.
The protected Smart Money smoke warms `/api/cron/refresh` first, so every
short-freshness adapter is tested immediately after a real authenticated fetch.

Expected: the deployment and health commit equal releaseCommit; every configured
adapter is live/non-empty; both briefing paths are current; local and production
browser flows pass; the annotated tag contains sanitized cron, adapter, storage,
briefing, responsive, persistence, and no-execution evidence; tag target equals
HEAD; git status contains only cursor-handoff.md. No tracked file is changed
after deployment. Only then may the active goal be marked complete.
