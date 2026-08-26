# Smart Money Intelligence Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add the daily Smart Money Pulse, independent client state, Intel research hub, deep links, and evidence-based Smart Money notifications without changing primary navigation or market health.

**Architecture:** The server briefing consumes only accepted normalized evidence plus a shared current market/sentiment loader and always has a deterministic result. A separately mounted SmartMoneyProvider owns API lifecycle, followed entities, and notification deduplication; Intel, Overview, Nav, and Notifications consume it without adding Smart Money state to LiveDataProvider.

**Tech Stack:** React 18, Vite 8, Tailwind CSS, Vitest, Testing Library, Node test runner, Groq structured output, existing AI runtime guards, and the Provider Core APIs.

**Spec:** docs/superpowers/specs/2026-08-26-smart-money-intelligence-design.md

## Global Constraints

- Provider Core plan and its complete regression gate must pass first.
- Smart Money state must never change LiveData market status or price polling.
- The daily Pulse always returns exactly market-regime, investor-disclosures, and crypto-paper-risk paragraphs in that order.
- Invalid, unavailable, or rate-limited AI output falls back to deterministic cited text; the UI never receives briefing null.
- Intel remains one of five main tabs and exposes News Feed and Smart Money as internal views.
- Every factual statement and signal links to normalized evidence.
- Browser notifications require explicit local opt-in, granted permission, a followed entity, a high-confidence eligible signal, and an unseen stable ID.
- The browser never calls the protected maintenance refresh route.

---

### Task 1: Extract current market and sentiment evidence without changing the existing briefing

**Files:**
- Create: lib/briefing/market-context.js
- Create: test/fixtures/smart-money/market-context.js
- Modify: api/briefing.js
- Modify: test/briefing.test.js

**Interfaces:**
- Consumes: existing /api/prices, /api/news, /api/fear-greed, trusted mover rules, and existing sentiment freshness limits.
- Produces: createMarketContextLoader(deps), loadMarketContext(), and currentUtcMarketDate(now).

- [ ] **Step 1: Add failing extraction and regression tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMarketContextLoader,
  currentUtcMarketDate,
} from '../lib/briefing/market-context.js';
import {
  FEAR_GREED_PAYLOAD,
  NEWS_PAYLOAD,
  PRICE_PAYLOAD,
} from './fixtures/smart-money/market-context.js';

test('market context exposes trusted movers and at least one fresh sentiment source', async () => {
  const load = createMarketContextLoader({
    getPrices: async () => PRICE_PAYLOAD,
    getNews: async () => NEWS_PAYLOAD,
    getFearGreed: async () => FEAR_GREED_PAYLOAD,
    now: () => new Date('2026-08-26T12:00:00.000Z'),
  });
  const context = await load();
  assert.equal(context.upstream.trustedMoversReady, true);
  assert.equal(context.upstream.sentimentReady, true);
  assert.ok(context.signals.gainers.length > 0);
  assert.ok(context.signals.sentiment.headline || context.signals.sentiment.cryptoFearGreed);
});

test('market date is the current UTC date even when accepted evidence is older', () => {
  assert.equal(
    currentUtcMarketDate(new Date('2026-08-30T00:05:00Z')),
    '2026-08-30',
  );
});
```

Move the existing briefing fixture values into
test/fixtures/smart-money/market-context.js as PRICE_PAYLOAD, NEWS_PAYLOAD, and
FEAR_GREED_PAYLOAD so the extracted loader and original route see identical
inputs.

- [ ] **Step 2: Run the existing briefing suite and confirm the new module is missing**

Run:

```powershell
node --test test/briefing.test.js
```

Expected: FAIL on the new import while pre-existing assertions identify the behavior that must remain unchanged.

- [ ] **Step 3: Extract the loader and delegate from api/briefing.js**

Export exact interfaces:

```js
export function createMarketContextLoader(deps = {}) {
  return async function loadMarketContext() {
    const [prices, news, fearGreed] = await Promise.all([
      deps.getPrices(),
      deps.getNews(),
      deps.getFearGreed(),
    ]);
    return buildValidatedMarketContext({
      prices,
      news,
      fearGreed,
      now: deps.now ? deps.now() : new Date(),
    });
  };
}

export function currentUtcMarketDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
```

Pulse cache partitioning always uses currentUtcMarketDate(now). Market,
sentiment, filing, and venue evidence retain their own as-of/retrieved times and
may be older on weekends or holidays; the route never relabels those timestamps
as current.

Move internal-origin resolution, bounded upstream fetches, mover trust,
headline normalization, sentiment calculation, canonical news links, and
freshness validation out of api/briefing.js. Keep its public response,
structured output, error codes, cache keys, and tests unchanged.

- [ ] **Step 4: Run the full existing briefing and AI smoke unit suites**

Run:

```powershell
node --test test/briefing.test.js test/smoke-ai.test.js
```

Expected: PASS with no response-shape changes.

- [ ] **Step 5: Commit the shared evidence loader**

```powershell
git add lib/briefing/market-context.js api/briefing.js test/fixtures/smart-money/market-context.js test/briefing.test.js
git diff --cached --check
git commit -m "refactor: share current market briefing evidence"
```

---

### Task 2: Build the deterministic/AI Smart Money briefing and daily route

**Files:**
- Create: lib/smart-money/briefing.js
- Create: api/smart-money/briefing.js
- Create: test/fixtures/smart-money/briefing.js
- Test: test/smart-money-briefing.test.js

**Interfaces:**
- Consumes: accepted SmartMoneySnapshot from Provider Core, loadMarketContext() from Task 1, requestGroqCompletion(), runAiGeneration(), and existing AI status helpers.
- Produces: buildSmartMoneyEvidence(input), digestSmartMoneyEvidence(input), buildDeterministicSmartMoneyBriefing(input), buildSmartMoneyPrompt(input), validateSmartMoneyCompletion(completion, context), and createSmartMoneyBriefingHandler(deps).

- [ ] **Step 1: Write failing evidence, fallback, validation, and handler tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicSmartMoneyBriefing,
  buildSmartMoneyEvidence,
  validateSmartMoneyCompletion,
} from '../lib/smart-money/briefing.js';
import { createSmartMoneyBriefingHandler } from '../api/smart-money/briefing.js';
import {
  BRIEFING_HANDLER_DEPS_WITH_GROQ_FAILURE,
  INVALID_COMPLETION,
  MARKET_CONTEXT,
  NO_NEW_INVESTOR_INPUT,
  SMART_MONEY_SNAPSHOT,
  VALIDATION_CONTEXT,
} from './fixtures/smart-money/briefing.js';
import { mockRequest } from './helpers/api.js';

test('deterministic briefing always returns the three fixed paragraphs', () => {
  const evidence = buildSmartMoneyEvidence({
    snapshot: SMART_MONEY_SNAPSHOT,
    marketContext: MARKET_CONTEXT,
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  const result = buildDeterministicSmartMoneyBriefing({
    marketDate: '2026-08-26',
    evidence,
    providerStatuses: SMART_MONEY_SNAPSHOT.providerStatuses,
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  assert.deepEqual(result.paragraphs.map((row) => row.id), [
    'market-regime',
    'investor-disclosures',
    'crypto-paper-risk',
  ]);
  assert.equal(result.paragraphs.length, 3);
});

test('no-disclosure paragraph states the checked result and latest source date', () => {
  const result = buildDeterministicSmartMoneyBriefing(NO_NEW_INVESTOR_INPUT);
  assert.match(result.paragraphs[1].text, /No material new disclosure was found/);
  assert.match(result.paragraphs[1].text, /2026-08-25/);
});

test('invalid AI evidence IDs are rejected before caching', () => {
  assert.throws(
    () => validateSmartMoneyCompletion(INVALID_COMPLETION, VALIDATION_CONTEXT),
    /unknown_evidence_id/,
  );
});

test('AI failure still returns HTTP 200 with deterministic briefing', async () => {
  const handler = createSmartMoneyBriefingHandler(BRIEFING_HANDLER_DEPS_WITH_GROQ_FAILURE);
  const { req, res } = mockRequest('/api/smart-money/briefing');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.briefing.source, 'deterministic');
  assert.equal(res.body.briefing.paragraphs.length, 3);
});
```

Define the named fixture objects from one small accepted snapshot, one current
market context, and one invalid structured completion. Keep those complete
reusable objects in test/fixtures/smart-money/briefing.js;
the handler dependency fixture injects readSnapshot, loadMarketContext,
runAiGeneration that rejects, and a fixed now function.

- [ ] **Step 2: Run the focused suite and verify missing implementation**

Run:

```powershell
node --test test/smart-money-briefing.test.js
```

Expected: FAIL because the engine and route do not exist.

- [ ] **Step 3: Implement evidence selection, fixed structured output, and fallback**

Use this exact paragraph contract:

```js
export const SMART_MONEY_PARAGRAPH_IDS = Object.freeze([
  'market-regime',
  'investor-disclosures',
  'crypto-paper-risk',
]);

export function digestSmartMoneyEvidence({ marketDate, thresholdVersion, evidence, providerStatuses }) {
  return createHash('sha256')
    .update(JSON.stringify({
      marketDate,
      thresholdVersion,
      evidence: evidence.map((row) => [row.id, row.retrievedAt]),
      providerStatuses: providerStatuses.map((row) => [row.id, row.status, row.lastSuccessAt]),
    }))
    .digest('hex')
    .slice(0, 24);
}
```

The route is GET-only. Public query refresh=1 sets no-store and bypasses the
semantic cache subject to existing quota. Authenticated aiSmoke and fallback
queries use x-ai-smoke-secret. Cache key format is
smart-money-briefing:v1:model:marketDate:evidenceDigest with a 36-hour TTL.

The validated response contains current market date, exactly three paragraphs,
resolved evidence IDs, effective/disclosed distinction, provider coverage, and
inputsAsOf. Catch disabled AI, quota, timeout, invalid output, provider error,
and distributed guard error and return deterministic content with an honest
aiStatus. Raw adapter text and private adapterState never enter the prompt.

- [ ] **Step 4: Run focused and existing briefing suites**

Run:

```powershell
node --test test/smart-money-briefing.test.js test/briefing.test.js test/smoke-ai.test.js
```

Expected: PASS, including invalid-output non-caching and deterministic fallback cases.

- [ ] **Step 5: Commit the daily Smart Money route**

```powershell
git add lib/smart-money/briefing.js api/smart-money/briefing.js test/fixtures/smart-money/briefing.js test/smart-money-briefing.test.js
git diff --cached --check
git commit -m "feat: generate daily smart money pulse"
```

---

### Task 3: Add durable dashboard routing and independent Smart Money client state

**Files:**
- Create: src/lib/dashboardRoute.js
- Create: src/lib/smartMoneyStorage.js
- Create: src/state/SmartMoney.jsx
- Create: test/fixtures/smart-money/client.js
- Create: test/helpers/smart-money-ui.jsx
- Modify: src/App.jsx
- Modify: src/components/Prices.jsx
- Test: test/smart-money-storage.test.js
- Test: test/smart-money-provider.test.jsx
- Test: test/smart-money-routing.test.jsx

**Interfaces:**
- Consumes: /api/smart-money, /api/smart-money/briefing, /api/smart-money/history, LiveData trusted prices, and readDashboardJson().
- Produces: parseDashboardSearch(search), buildDashboardSearch(currentSearch, routeState), loadSmartMoneyPreferences(storage), saveSmartMoneyPreferences(storage, value), SmartMoneyProvider({ children }), and useSmartMoney().

- [ ] **Step 1: Write failing route, storage, and provider-isolation tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDashboardSearch } from '../src/lib/dashboardRoute.js';

test('dashboard route preserves Intel record and durable Prices ticker', () => {
  assert.deepEqual(
    parseDashboardSearch('?tab=Intel&view=smart-money&record=sec:abc&t=BTC'),
    {
      tab: 'Intel',
      view: 'smart-money',
      recordId: 'sec:abc',
      ticker: 'BTC',
    },
  );
});
```

In test/smart-money-provider.test.jsx:

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { LiveDataProvider } from '../src/state/LiveData.jsx';
import { SmartMoneyProvider } from '../src/state/SmartMoney.jsx';
import { SMART_MONEY_RESPONSE, jsonResponse } from './fixtures/smart-money/client.js';
import { Probe } from './helpers/smart-money-ui.jsx';

it('keeps last-known-good Smart Money data without changing market status', async () => {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(SMART_MONEY_RESPONSE))
    .mockRejectedValueOnce(new Error('network down'));
  render(
    <LiveDataProvider>
      <SmartMoneyProvider>
        <Probe />
      </SmartMoneyProvider>
    </LiveDataProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('entity-count')).toHaveTextContent('1'));
  expect(screen.getByTestId('performance-count')).toHaveTextContent('1');
  await userEvent.click(screen.getByRole('button', { name: /refresh smart money/i }));
  expect(screen.getByTestId('entity-count')).toHaveTextContent('1');
  expect(screen.getByTestId('smart-error')).toHaveTextContent(/network/i);
  expect(screen.getByTestId('market-mode')).not.toHaveTextContent(/smart money/i);
});
```

Keep Node-only route/storage assertions in test/smart-money-storage.test.js and
Vitest/React assertions in the two JSX test files.
test/helpers/smart-money-ui.jsx supplies Probe, render providers, userEvent,
and fixed LiveData API responses; test/fixtures/smart-money/client.js supplies
complete schemaVersion 1 snapshot, briefing, history, signal, and provider
status records using the master contract, including top-level performances and
the exact daily-mark/history envelope.

- [ ] **Step 2: Run focused tests and confirm missing modules**

Run:

```powershell
node --test test/smart-money-storage.test.js
npx vitest run test/smart-money-provider.test.jsx test/smart-money-routing.test.jsx
```

Expected: FAIL because routing, storage, and SmartMoneyProvider do not exist.

- [ ] **Step 3: Implement canonical URLs, monotonic briefing acceptance, and separate context**

Canonical routes:

```text
?tab=Intel&view=news
?tab=Intel&view=smart-money
?tab=Intel&view=smart-money&record=sec:stable-id
?tab=Prices&t=BTC
?tab=Portfolio&view=paper-copy
```

Mount providers in this exact order:

```jsx
<LiveDataProvider>
  <SmartMoneyProvider>
    <Dashboard />
  </SmartMoneyProvider>
</LiveDataProvider>
```

SmartMoneyProvider fetches snapshot and briefing independently, accepts a new
briefing only when marketDate is newer or the same date has a newer generatedAt,
exposes entities, activities, performances, signals, rankings, statuses, and
sources, retains accepted data after failures, and memoizes its context. refreshSmartMoney
calls /api/smart-money?refresh=1; refreshBriefing calls
/api/smart-money/briefing?refresh=1. Neither calls /api/smart-money/refresh.

Use versioned local preferences:

```js
const PREFERENCES_KEY = 'comms.smartMoney.preferences.v1';
const NOTIFIED_KEY = 'comms.smartMoney.notified.v1';
const DEFAULT_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  followedEntityIds: [],
  browserNotificationsEnabled: false,
});
```

Change Prices to Prices({ initialTicker = null, onTickerChange }) and remove
onTickerConsumed so a deep-linked ticker remains in the URL.

- [ ] **Step 4: Run provider, routing, and existing live-data tests**

Run:

```powershell
node --test test/smart-money-storage.test.js
npx vitest run test/smart-money-provider.test.jsx test/smart-money-routing.test.jsx test/live-data.test.jsx
```

Expected: PASS; Smart Money failures do not change dataMode or market status.

- [ ] **Step 5: Commit independent client state and routing**

```powershell
git add src/lib/dashboardRoute.js src/lib/smartMoneyStorage.js src/state/SmartMoney.jsx src/App.jsx src/components/Prices.jsx test/fixtures/smart-money/client.js test/helpers/smart-money-ui.jsx test/smart-money-storage.test.js test/smart-money-provider.test.jsx test/smart-money-routing.test.jsx
git diff --cached --check
git commit -m "feat: add independent smart money client state"
```

---

### Task 4: Refactor Intel into an accessible News Feed and Smart Money hub

**Files:**
- Create: src/components/SegmentedTabs.jsx
- Create: src/components/intel/NewsFeed.jsx
- Create: src/components/smart-money/SmartMoneyView.jsx
- Create: src/components/smart-money/EntityDirectory.jsx
- Create: src/components/smart-money/EntityProfile.jsx
- Create: src/components/smart-money/EvidenceTimeline.jsx
- Create: src/components/smart-money/SignalsTable.jsx
- Create: src/components/smart-money/ProviderHealthPanel.jsx
- Create: src/components/smart-money/SmartMoneyDisclosure.jsx
- Modify: src/components/Intel.jsx
- Modify: test/helpers/smart-money-ui.jsx
- Modify: test/fixtures/smart-money/client.js
- Test: test/smart-money-ui.test.jsx
- Test: test/ui-accessibility.test.jsx

**Interfaces:**
- Consumes: useSmartMoney() entities, activities, performances, signals, provider status, Intel route state from Task 3, and the onOpenPrices callback.
- Produces: Intel({ view, recordId, onViewChange, onOpenPrices }), orderEntitiesForDirectory(entities, followedIds), and reusable accessible SegmentedTabs.

- [ ] **Step 1: Write failing Intel semantics, filtering, health, and deep-link tests**

```jsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import {
  onViewChange,
  renderIntel,
  renderSmartMoney,
} from './helpers/smart-money-ui.jsx';
import { DELAYED_13F_ACTIVITY } from './fixtures/smart-money/client.js';

it('renders News Feed and Smart Money as keyboard-operable tabs', async () => {
  renderIntel({ view: 'news' });
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(2);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  tabs[0].focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(tabs[1]).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(onViewChange).toHaveBeenCalledWith('smart-money');
});

it('shows concrete provider failure beneath its group rollup', () => {
  renderSmartMoney({
    providerStatuses: [
      { id: 'institutional-ibit', group: 'institutional', status: 'live', recordCount: 1 },
      { id: 'institutional-fbtc', group: 'institutional', status: 'unavailable', recordCount: 0, errorCode: 'timeout' },
    ],
  });
  expect(screen.getByText('INSTITUTIONAL-FBTC')).toBeVisible();
  expect(screen.getByText('UNAVAILABLE')).toBeVisible();
});

it('labels a delayed filing and never calls it live', () => {
  renderSmartMoney({ activities: [DELAYED_13F_ACTIVITY] });
  expect(screen.getByText(/SEC filing · 45-day delay/i)).toBeVisible();
  expect(screen.queryByText(/live position/i)).not.toBeInTheDocument();
});

it('shows provider-scoped performance without cross-provider comparison', () => {
  renderSmartMoney({ recordId: 'hyperliquid:0xabc' });
  expect(screen.getByText(/Hyperliquid · account/i)).toBeVisible();
  expect(screen.getByText(/30-day P&L/i)).toBeVisible();
  expect(screen.getByText(/Provider reported/i)).toBeVisible();
  expect(screen.getByText(/Not comparable across providers/i)).toBeVisible();
  expect(screen.queryByText(/success score/i)).not.toBeInTheDocument();
});

it('filters by canonical directory category and keeps followed entities first', async () => {
  renderSmartMoney({
    followedEntityIds: new Set(['firm-b']),
    entities: [
      { id: 'firm-a', displayName: 'Firm A', directoryCategory: 'firms' },
      { id: 'firm-b', displayName: 'Firm B', directoryCategory: 'firms' },
      { id: 'wallet-a', displayName: 'Wallet A', directoryCategory: 'crypto-traders' },
    ],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Firms' }));
  expect(screen.queryByText('Wallet A')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('entity-row').map((row) => row.textContent)).toEqual([
    expect.stringContaining('Firm B'),
    expect.stringContaining('Firm A'),
  ]);
});
```

- [ ] **Step 2: Run focused UI tests and confirm missing component failures**

Run:

```powershell
npx vitest run test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
```

Expected: FAIL because the segmented hub and Smart Money components do not exist.

- [ ] **Step 3: Extract NewsFeed unchanged and implement the Smart Money panels**

SegmentedTabs uses role tablist, role tab, role tabpanel, roving tabIndex, and
ArrowLeft, ArrowRight, Home, End, Enter, and Space behavior.

Smart Money directory filters use exactly:

```js
export const SMART_MONEY_FILTERS = Object.freeze([
  ['all', 'All'],
  ['investors', 'Investors'],
  ['firms', 'Firms'],
  ['crypto-traders', 'Crypto Traders'],
  ['institutional-flows', 'Institutional Flows'],
]);
```

Show entity identity, legal organization, themes, official links, followed
state, source-grade labels, verified/reported/not-publicly-verified performance,
as-of date, filed date, evidence age, and caveats. Signals show supported assets
as chart buttons; unsupported assets render text and the paper-ineligibility
reason. External links always use target blank plus noopener noreferrer.

Entity profiles join top-level performance records by entityId and show exact
provider/venue/account scope, supplied account value, day/month/all-time P&L,
ROI and volume, methodology, source/retrieval timestamps, and the explicit
not-comparable-across-providers warning. Missing values render unavailable; the
UI never computes or implies a universal success score.

EntityDirectory filters only on the validated directoryCategory field. Within
the server's freshness/evidence base order, apply a stable followed-first
partition locally. Never send followed IDs to a ranking or API route.

Deep-linked recordId focuses its heading after data loads. Loading, empty,
partial, stale, unavailable, and LKG states are distinct. A persistent
SmartMoneyDisclosure states that disclosures are delayed, transfers are not
necessarily trades, venue P&L is scoped, and Paper Copy places no orders.

- [ ] **Step 4: Run Intel and accessibility suites**

Run:

```powershell
npx vitest run test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
```

Expected: PASS for keyboard, focus, filters, source links, and degraded states.

- [ ] **Step 5: Commit the Intel Smart Money hub**

```powershell
git add src/components/SegmentedTabs.jsx src/components/intel src/components/smart-money/SmartMoneyView.jsx src/components/smart-money/EntityDirectory.jsx src/components/smart-money/EntityProfile.jsx src/components/smart-money/EvidenceTimeline.jsx src/components/smart-money/SignalsTable.jsx src/components/smart-money/ProviderHealthPanel.jsx src/components/smart-money/SmartMoneyDisclosure.jsx src/components/Intel.jsx test/helpers/smart-money-ui.jsx test/fixtures/smart-money/client.js test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
git diff --cached --check
git commit -m "feat: add smart money intelligence hub"
```

---

### Task 5: Integrate Overview Pulse, durable navigation, and Smart Money alerts

**Files:**
- Create: src/components/smart-money/SmartMoneyPulse.jsx
- Create: src/components/smart-money/SmartMoneySignalPreview.jsx
- Modify: src/components/Overview.jsx
- Modify: src/components/NotificationsDrawer.jsx
- Modify: src/components/Nav.jsx
- Modify: src/components/CommandPalette.jsx
- Modify: src/App.jsx
- Modify: test/helpers/smart-money-ui.jsx
- Modify: test/fixtures/smart-money/client.js
- Test: test/smart-money-ui.test.jsx
- Test: test/ui-accessibility.test.jsx

**Interfaces:**
- Consumes: briefing/signals/follow state from useSmartMoney() and route callbacks from Task 3.
- Produces: Overview-to-evidence, Overview-to-Prices, notification-to-evidence, notification-to-Prices, command-palette-to-Smart-Money navigation, shouldCreateInAppNotification(signal, existingIds), and shouldSendBrowserNotification(signal, options).

- [ ] **Step 1: Write failing Pulse and notification eligibility tests**

```jsx
import {
  notificationConstructor,
  renderNavigation,
  renderNotifications,
  renderOverview,
} from './helpers/smart-money-ui.jsx';
import {
  ELIGIBLE_SIGNAL,
  SMART_MONEY_BRIEFING,
  UNSUPPORTED_SIGNAL,
} from './fixtures/smart-money/client.js';
import {
  shouldSendBrowserNotification,
} from '../src/components/NotificationsDrawer.jsx';

it('shows exactly three Pulse paragraphs and evidence links below Market Briefing', () => {
  renderOverview({ briefing: SMART_MONEY_BRIEFING });
  const pulse = screen.getByRole('region', { name: /smart money pulse/i });
  expect(within(pulse).getAllByTestId('smart-money-paragraph')).toHaveLength(3);
  expect(within(pulse).getByText('2026-08-26')).toBeVisible();
  expect(within(pulse).getByRole('link', { name: /SEC evidence/i })).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

it('previews high-confidence signals with evidence and supported chart actions', () => {
  renderOverview({
    briefing: SMART_MONEY_BRIEFING,
    signals: [ELIGIBLE_SIGNAL, UNSUPPORTED_SIGNAL],
  });
  const preview = screen.getByRole('region', { name: /recent smart money signals/i });
  expect(within(preview).getAllByRole('button', { name: /view evidence/i })).toHaveLength(2);
  expect(within(preview).getByRole('button', { name: /open BTC chart/i })).toBeEnabled();
  expect(within(preview).queryByRole('button', { name: /open unsupported chart/i })).not.toBeInTheDocument();
});

it('explains an empty preview separately from degraded provider coverage', () => {
  const { rerenderOverview } = renderOverview({ signals: [], partial: false });
  expect(screen.getByText(/No current high-confidence signals/i)).toBeVisible();
  rerenderOverview({ signals: [], partial: true });
  expect(screen.getByText(/Provider coverage is degraded/i)).toBeVisible();
});

it('shows all eligible in-app signals but browser-notifies only opted-in followed signals', async () => {
  renderNotifications({
    browserNotificationsEnabled: true,
    notificationPermission: 'granted',
    followedEntityIds: new Set(['hyperliquid:0xabc']),
    signals: [
      ELIGIBLE_SIGNAL,
      { ...ELIGIBLE_SIGNAL, id: 'medium', confidence: 'medium' },
      { ...ELIGIBLE_SIGNAL, id: 'unfollowed', entityId: 'hyperliquid:0xdef' },
    ],
  });
  expect(screen.getAllByTestId('smart-money-notification')).toHaveLength(2);
  expect(notificationConstructor).toHaveBeenCalledTimes(1);
});

it.each([
  { optedIn: false, permission: 'granted' },
  { optedIn: true, permission: 'default' },
  { optedIn: true, permission: 'denied' },
])('blocks browser delivery for $permission with optedIn=$optedIn', ({ optedIn, permission }) => {
  expect(shouldSendBrowserNotification(ELIGIBLE_SIGNAL, {
    browserNotificationsEnabled: optedIn,
    followedIds: new Set([ELIGIBLE_SIGNAL.entityId]),
    permission,
    seenIds: new Set(),
  })).toBe(false);
});

it('keeps the primary and mobile navigation at five items', () => {
  renderNavigation();
  expect(screen.getByTestId('desktop-nav').querySelectorAll('[data-main-tab]')).toHaveLength(5);
  expect(screen.getByTestId('bottom-nav').querySelectorAll('[data-main-tab]')).toHaveLength(5);
});
```

- [ ] **Step 2: Run focused UI tests and verify failures**

Run:

```powershell
npx vitest run test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
```

Expected: FAIL because Pulse and Smart Money notification integration do not exist.

- [ ] **Step 3: Add the Pulse, deep-link actions, and deduplicated alert group**

Insert SmartMoneyPulse immediately after the existing Briefing in Overview.
Render all three paragraphs, evidence links, generated time, market date,
evidence age, provider coverage, and AI/deterministic source. Retain an accepted
briefing while a manual refresh is pending.

SmartMoneySignalPreview renders a compact bounded list of current
high-confidence eligible signals. Every row opens its Intel evidence record;
supported assets also expose a Prices action, while unsupported assets show the
paper-ineligibility reason and no chart action. Distinguish empty data from
partial/degraded coverage.

Compute in-app and browser eligibility separately:

```js
export function shouldCreateInAppNotification(signal, existingIds) {
  return signal.confidence === 'high'
    && signal.notificationEligibility?.eligible === true
    && signal.freshness === 'fresh'
    && !existingIds.has(signal.id);
}

export function shouldSendBrowserNotification(signal, {
  browserNotificationsEnabled,
  followedIds,
  permission,
  seenIds,
}) {
  return shouldCreateInAppNotification(signal, seenIds)
    && browserNotificationsEnabled === true
    && permission === 'granted'
    && followedIds.has(signal.entityId);
}
```

Add a distinct Smart Money group to the existing drawer with View evidence and
Open chart actions. The Paper Simulation plan adds the third Add to paper
simulation action only after that engine and Portfolio panel exist. Convert the
drawer aside to flex flex-col and its body to flex-1 min-h-0 overflow-y-auto so
the larger header does not break scrolling. Nav badge can count eligible unseen
Smart Money notifications but must not change the global live-status label.

The helper fixture exports every named render/notification helper above,
including rerenderOverview; the client fixture exports the complete briefing,
eligible supported signal, and unsupported signal. Browser permission default,
denied, and local opt-out never invoke Notification or request permission
implicitly.

Add Go to Smart Money to CommandPalette without adding a tab. It invokes the
App route callback that sets tab Intel and view smart-money.

- [ ] **Step 4: Run all client tests and build**

Run:

```powershell
npx vitest run test/live-data.test.jsx test/smart-money-provider.test.jsx test/smart-money-routing.test.jsx test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
npm run build
```

Expected: PASS with five navigation items and no Smart Money effect on market status.

- [ ] **Step 5: Commit the integrated research experience**

```powershell
git add src/components/smart-money/SmartMoneyPulse.jsx src/components/smart-money/SmartMoneySignalPreview.jsx src/components/Overview.jsx src/components/NotificationsDrawer.jsx src/components/Nav.jsx src/components/CommandPalette.jsx src/App.jsx test/helpers/smart-money-ui.jsx test/fixtures/smart-money/client.js test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
git diff --cached --check
git commit -m "feat: surface smart money pulse and alerts"
```

---

### Task 6: Enforce focused UI suites in package scripts

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Modify: test/smart-money-storage.test.js

**Interfaces:**
- Consumes: all Task 3–5 UI tests.
- Produces: a test:ui command that cannot silently omit Smart Money suites.

- [ ] **Step 1: Write a failing package-script coverage assertion**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('test:ui explicitly runs every Smart Money Vitest suite', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const file of [
    'test/smart-money-provider.test.jsx',
    'test/smart-money-routing.test.jsx',
    'test/smart-money-ui.test.jsx',
  ]) {
    assert.match(pkg.scripts['test:ui'], new RegExp(file.replaceAll('.', '\\.')));
  }
});
```

Add this assertion to test/smart-money-storage.test.js.

- [ ] **Step 2: Run the assertion and verify the current script omits new files**

Run:

```powershell
node --test test/smart-money-storage.test.js
```

Expected: FAIL because package.json currently lists only live-data and ui-accessibility.

- [ ] **Step 3: Extend test:ui with every JSX suite**

Set:

```json
{
  "test:ui": "vitest run test/live-data.test.jsx test/ui-accessibility.test.jsx test/smart-money-provider.test.jsx test/smart-money-routing.test.jsx test/smart-money-ui.test.jsx"
}
```

Do not use a broad glob that could accidentally pull Node-only tests into
Vitest.

- [ ] **Step 4: Run the complete experience gate**

Run:

```powershell
npm run test:unit
npm run test:ui
npm run build
```

Expected: all commands PASS.

- [ ] **Step 5: Commit enforced UI coverage**

```powershell
git add package.json package-lock.json test/smart-money-storage.test.js
git diff --cached --check
git commit -m "test: enforce smart money UI coverage"
```
