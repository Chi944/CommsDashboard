# Smart Money Paper Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship a truthful research-only simulation-readiness experience now,
while preserving a disconnected synthetic-test design for any future
rights-cleared Paper Copy capability.

**Architecture:** Production exposes a server-controlled, fail-closed capability
contract and a read-only readiness panel. It never retrieves or attaches Smart
Money prices and has no transaction state. The legacy pure-engine design below
is retained only as a disconnected future test seam.

**Tech Stack:** JavaScript ESM, node:test, React 18, Vitest, Testing Library, localStorage, existing SmartMoneyProvider, Provider Core history API, and trusted LiveData marks.

**Spec:** docs/superpowers/specs/2026-08-26-smart-money-intelligence-design.md

## Binding execution amendments (2026-08-27)

These amendments supersede every conflicting interface, example, test, and UI
instruction below. The price-source rights review found no free source that
permits the complete production use we require: automated retrieval, durable
400-day storage, public display, and derived simulation. Production therefore
ships an honest research-readiness surface and performs zero Smart Money price
retrievals, marks, or simulated transactions.

### Exact production capability contract

Provider Core and every accepted client fixture expose this exact public value:

```js
{
  schemaVersion: 1,
  status: 'research_only',
  reason: 'no_rights_cleared_price_source',
  transactionsEnabled: false,
  enabledEntryPriceSources: [],
  enabledDailyMarkSources: [],
  effectiveAt: null,
}
```

- Smart Money never consumes prices from LiveData, chart routes, browser state,
  a broker/exchange/wallet, or an authenticated provider.
- Provider refresh, history publication, browser reconciliation, focus handlers,
  and maintenance jobs make zero Smart Money price calls and create zero entry
  prices, daily marks, positions, transactions, cash balances, performance
  metrics, or benchmarks.
- Signal evidence may preserve public disclosure values that are part of the
  source filing or public position disclosure. Such evidence is not a market
  price and can never become a simulated fill or mark.
- No production fallback, hidden feature flag, URL parameter, import, local
  storage payload, or stale client state may enable transactions.

### Research-only experience

- The Portfolio/Intel integration is a read-only **Simulation readiness** panel,
  not an enabled Paper Copy account. It displays the capability contract,
  eligible-signal methodology, evidence coverage, and this exact primary copy:

  > No rights-cleared free market-price source is currently enabled. Signals remain research-only; no simulated transaction was created.

- Do not render a starting balance, cash/equity/performance value, position,
  transaction, benchmark, Start/Stop/Add/Import/Export/Reset action, or a disabled
  control that implies a simulation can presently be activated.
- Notification and signal views may link to the readiness panel to explain why a
  signal was not simulated. They never say an order, trade, fill, allocation, or
  simulated transaction is ready.
- The panel explicitly states that the dashboard does not recommend, prepare,
  route, sign, or execute trades.

### Test-only future engine seam

The numerical simulation engine described below may be implemented only as a
pure module exercised with synthetic test fixtures. It is not imported by any
production browser or server module while the capability is `research_only`.
If retained, its entry allocation is computed in integer cents from:

```text
N = max(0, min(0.05E, C/1.001, (0.20E-Ge)/1.0002, (E-G)/1.001))
```

where `E` is equity, `C` free cash, `Ge` entity gross exposure, and `G` total
gross exposure immediately before the entry. Tests must cover correct long and
short equity, reductions, closes, and reversals; entry and exit friction; and
rounding without creating buying power.

Future enablement requires a reviewed rights revision with a non-null
`effectiveAt`, explicit permitted source IDs, immutable first-valid entry-price
attachment at or after observation, and no pre-effective-date backfill. Rights
and capability changes are server-controlled and cannot be imported from local
state. Quota exhaustion, missing checkpoints, or a retention gap must stop
reconciliation with an explicit unavailable reason; none may guess or borrow a
price.

### Amended implementation order and release gate

1. Add the exact capability to canonical schema, snapshot, history/briefing
   metadata, fixtures, and client validation.
2. Add the read-only Simulation readiness panel and explanatory routing.
3. Add tests proving zero Smart Money price requests/marks and no enabled paper
   state or actions in production. Scan `.js`, `.jsx`, `.ts`, and `.tsx` source
   and the built browser bundle.
4. Only after those tests pass may a disconnected pure synthetic engine be
   added. It is not a release requirement and must not weaken the production
   boundary.

The required production tests intercept every server and browser request,
exercise refresh/history/focus/notification flows, and assert that every Smart
Money network request is a public GET without body or credentials. They also
assert that the runtime and built bundle contain no broker/exchange/wallet SDK,
order DTO, order mutation, transaction preparation, reference-price attachment,
or daily-mark path.

## Inactive future-engine design

Everything below this heading is non-production reference material and is not
part of the present release unless a later rights review replaces the binding
amendments above.

### Legacy global constraints

- No paper function performs fetch, storage, logging, order construction, signing, or credential handling.
- Default starting balance is USD 100,000.
- Each new/increase signal uses five percent of current virtual equity.
- Exposure is capped at twenty percent per followed entity and one hundred percent gross.
- No leverage; short notional reserves equal cash and short proceeds are not buying power.
- Every simulated entry and exit applies ten basis points total friction.
- Only signals observed during an active strategy interval are eligible.
- Entry uses the server-journaled first trusted price at or after observedAt.
- Missing, stale, unsupported, pre-start, duplicate, and over-limit signals create explicit skipped records.
- One entity cannot close another entity's position.
- Reset has one local undo backup; import/export uses schemaVersion 1 JSON.
- Follow/unfollow notification state and start/stop Paper Copy intervals remain independent.

---

### Task 1: Implement the pure immutable paper engine

**Files:**
- Create: lib/smart-money/paper.js
- Test: test/smart-money-paper.test.js

**Interfaces:**
- Consumes: canonical Signal and daily mark shapes from Provider Core.
- Produces: createPaperState(input), startPaperStrategy(state, input), stopPaperStrategy(state, input), applyPaperSignal(state, signal), reconcilePaperHistory(state, input), markPaperState(state, input), calculatePaperMetrics(state), exportPaperState(state), and importPaperState(payload).

- [ ] **Step 1: Write failing lifecycle, sizing, friction, short, and timing tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPaperSignal,
  calculatePaperMetrics,
  createPaperState,
  markPaperState,
  startPaperStrategy,
  stopPaperStrategy,
} from '../lib/smart-money/paper.js';

const START = '2026-08-26T00:00:00.000Z';
const longSignal = {
  id: 'hyperliquid:signal-1',
  entityId: 'hyperliquid:0xabc',
  action: 'open',
  direction: 'long',
  observedAt: '2026-08-26T00:05:00.000Z',
  paperEligibility: { eligible: true, reason: 'supported_reference_price' },
  asset: { ticker: 'BTC', assetClass: 'crypto', supported: true },
  positionChange: {
    previousNotionalUsd: 0,
    currentNotionalUsd: 100000,
    deltaNotionalUsd: 100000,
  },
  referencePrice: {
    ticker: 'BTC',
    price: 100000,
    currency: 'USD',
    source: 'yahoo',
    asOf: '2026-08-26T00:05:00.000Z',
    retrievedAt: '2026-08-26T00:05:01.000Z',
  },
};

test('first signal allocates five percent and applies ten basis points friction', () => {
  const started = startPaperStrategy(createPaperState({
    startingBalance: 100000,
    startedAt: START,
  }), {
    entityId: longSignal.entityId,
    startedAt: START,
  });
  const next = applyPaperSignal(started, longSignal);
  assert.equal(next.positions[0].notionalUsd, 5000);
  assert.equal(next.transactions[0].frictionUsd, 5);
  assert.equal(next.cash, 94995);
});

test('a signal before strategy start is skipped without changing cash', () => {
  const started = startPaperStrategy(createPaperState({
    startingBalance: 100000,
    startedAt: '2026-08-27T00:00:00.000Z',
  }), {
    entityId: longSignal.entityId,
    startedAt: '2026-08-27T00:00:00.000Z',
  });
  const next = applyPaperSignal(started, longSignal);
  assert.equal(next.transactions.length, 0);
  assert.equal(next.skippedSignals[0].reason, 'before_strategy_start');
  assert.equal(next.cash, 100000);
});

test('short notional reserves cash and does not create buying power', () => {
  const shortSignal = { ...longSignal, id: 'short-1', direction: 'short' };
  const started = startPaperStrategy(createPaperState({
    startingBalance: 100000,
    startedAt: START,
  }), {
    entityId: shortSignal.entityId,
    startedAt: START,
  });
  const next = applyPaperSignal(started, shortSignal);
  assert.equal(next.reservedShortCollateral, 5000);
  assert.equal(next.cash, 94995);
});

test('stopping a strategy prevents later signals without synthesizing an exit', () => {
  const started = startPaperStrategy(createPaperState({
    startingBalance: 100000,
    startedAt: START,
  }), {
    entityId: longSignal.entityId,
    startedAt: START,
  });
  const stopped = stopPaperStrategy(started, {
    entityId: longSignal.entityId,
    stoppedAt: '2026-08-26T00:04:00.000Z',
  });
  const next = applyPaperSignal(stopped, longSignal);
  assert.equal(next.transactions.length, 0);
  assert.equal(next.skippedSignals[0].reason, 'outside_strategy_interval');
});

test('benchmarks follow validated asset classes for crypto, equity, and mixed strategies', () => {
  const equitySignal = {
    ...longSignal,
    id: 'equity-1',
    asset: { ticker: 'SPY', assetClass: 'equity', supported: true },
    referencePrice: { ...longSignal.referencePrice, ticker: 'SPY', price: 500 },
  };
  const metricsFor = (signals) => {
    let state = startPaperStrategy(createPaperState({ startedAt: START }), {
      entityId: longSignal.entityId,
      startedAt: START,
    });
    for (const signal of signals) state = applyPaperSignal(state, signal);
    state = markPaperState(state, {
      at: '2026-08-26T20:00:00.000Z',
      prices: { BTC: 101000, SPY: 505 },
      benchmarks: { sp500: { price: 5100 }, bitcoin: { price: 101000 } },
    });
    return calculatePaperMetrics(state);
  };
  const crypto = metricsFor([longSignal]);
  const equity = metricsFor([equitySignal]);
  const mixed = metricsFor([longSignal, equitySignal]);
  assert.ok(crypto.benchmarks.bitcoin);
  assert.equal(crypto.benchmarks.sp500, null);
  assert.ok(equity.benchmarks.sp500);
  assert.equal(equity.benchmarks.bitcoin, null);
  assert.ok(mixed.benchmarks.bitcoin);
  assert.ok(mixed.benchmarks.sp500);
});
```

- [ ] **Step 2: Run the focused test and verify the engine is missing**

Run:

```powershell
node --test test/smart-money-paper.test.js
```

Expected: FAIL because lib/smart-money/paper.js does not exist.

- [ ] **Step 3: Implement versioned state and pure transitions**

Create this exact initial state:

```js
export function createPaperState({
  startingBalance = 100_000,
  startedAt,
} = {}) {
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    throw new TypeError('invalid_starting_balance');
  }
  return {
    schemaVersion: 1,
    startingBalance,
    cash: startingBalance,
    reservedShortCollateral: 0,
    strategyIntervals: [],
    positions: [],
    transactions: [],
    skippedSignals: [],
    processedSignalIds: [],
    dailyEquity: [],
    benchmarkBaselines: {},
    lastProcessedObservedAt: startedAt || null,
  };
}

export const PAPER_RULES = Object.freeze({
  allocationPct: 5,
  maxEntityExposurePct: 20,
  maxGrossExposurePct: 100,
  frictionBps: 10,
});
```

Every transition returns a new object and deduplicates by stable signal ID.
Long and short quantities use notional divided by reference price. Increase
adds one five-percent slice until caps. Reduce and close affect only matching
entity/ticker/direction lots. A reversal closes matching source lots before
opening the opposite direction. Advance lastProcessedObservedAt monotonically
for applied, skipped, and duplicate valid signals.

Transitions switch only on the validated master-contract action. Open and
increase allocate a slice; reduce, close, and reverse use positionChange to
alter only lots created by the same entity; observe is always skipped. Never
infer an exit or reversal from direction alone.

markPaperState uses daily marks to calculate long and short unrealized P&L.
calculatePaperMetrics returns equity, cash, reserved short collateral, gross
exposure and percentage, return, max drawdown, closed/winning count, win rate,
S&P 500 and Bitcoin comparisons, positions, transactions, and skipped signals.
Equity-only strategies expose S&P only, crypto-only strategies expose Bitcoin
only, and a strategy with both asset classes exposes both; add explicit tests
for all three cases.

- [ ] **Step 4: Run the complete engine suite**

Run:

```powershell
node --test test/smart-money-paper.test.js
```

Expected: PASS for timing, deduplication, friction, caps, reversals, marks, drawdown, win rate, and benchmarks.

- [ ] **Step 5: Commit the pure paper engine**

```powershell
git add lib/smart-money/paper.js test/smart-money-paper.test.js
git diff --cached --check
git commit -m "feat: add deterministic paper simulation engine"
```

---

### Task 2: Add versioned persistence, offline history reconciliation, and reset recovery

**Files:**
- Modify: src/lib/smartMoneyStorage.js
- Modify: src/state/SmartMoney.jsx
- Create: src/utils/downloadJson.js
- Create: test/fixtures/smart-money/paper.js
- Modify: test/helpers/smart-money-ui.jsx
- Modify: test/smart-money-storage.test.js
- Modify: test/smart-money-provider.test.jsx

**Interfaces:**
- Consumes: all Task 1 pure functions, GET /api/smart-money/history, trusted LiveData marks, and the SmartMoneyProvider from the Intelligence Experience plan.
- Produces: loadPaperCopy(storage), savePaperCopy(storage, state), loadPaperResetBackup(storage), savePaperResetBackup(storage, stateOrNull), serializePaperBackup(state, exportedAt), parsePaperBackup(serialized), startPaperCopy(entityId, { startingBalance } = {}), stopPaperCopy(entityId), addSignalToPaper(signalId), resetPaperCopy(input), undoPaperReset(), exportPaperCopy(), and importPaperCopy(serialized).

- [ ] **Step 1: Write failing persistence, future-version, catch-up, and undo tests**

In test/smart-money-storage.test.js:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadPaperCopy,
  parsePaperBackup,
  serializePaperBackup,
} from '../src/lib/smartMoneyStorage.js';
import {
  HISTORY_PAGE_WITH_BOUNDARY_DUPLICATE,
  PAPER_STATE,
  PAPER_STATE_WITH_LAST_SIGNAL,
} from './fixtures/smart-money/paper.js';

test('paper state round-trips through the versioned export envelope', () => {
  const serialized = serializePaperBackup(PAPER_STATE, '2026-08-26T12:00:00.000Z');
  const parsed = parsePaperBackup(serialized);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.state, PAPER_STATE);
});

test('future schema import is rejected without replacing current state', () => {
  const parsed = parsePaperBackup(JSON.stringify({
    kind: 'comms-dashboard.paper-copy',
    schemaVersion: 2,
    exportedAt: '2026-08-26T12:00:00.000Z',
    state: PAPER_STATE,
  }));
  assert.deepEqual(parsed, { ok: false, error: 'unsupported_schema_version' });
});
```

In test/smart-money-provider.test.jsx:

```jsx
import { screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SMART_MONEY_RESPONSE, jsonResponse } from './fixtures/smart-money/client.js';
import {
  HISTORY_PAGE_WITH_BOUNDARY_DUPLICATE,
  PAPER_STATE_WITH_LAST_SIGNAL,
} from './fixtures/smart-money/paper.js';
import { renderProviderWithPaperState } from './helpers/smart-money-ui.jsx';

it('reconciles inclusive history while deduplicating the boundary signal', async () => {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/smart-money/history?')) {
      return jsonResponse(HISTORY_PAGE_WITH_BOUNDARY_DUPLICATE);
    }
    return jsonResponse(SMART_MONEY_RESPONSE);
  });
  renderProviderWithPaperState(PAPER_STATE_WITH_LAST_SIGNAL);
  await waitFor(() => expect(screen.getByTestId('processed-count')).toHaveTextContent('2'));
  expect(screen.getByTestId('transaction-count')).toHaveTextContent('2');
  expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('since=2026-08-26T00%3A05%3A00.000Z'),
    expect.any(Object),
  );
});
```

- [ ] **Step 2: Run focused storage/provider tests**

Run:

```powershell
node --test test/smart-money-storage.test.js
npx vitest run test/smart-money-provider.test.jsx
```

Expected: FAIL because paper persistence and reconciliation are not wired.

- [ ] **Step 3: Implement exact local keys, paging, reset backup, and imports**

Use these exact keys:

```js
export const SMART_MONEY_STORAGE_KEYS = Object.freeze({
  preferences: 'comms.smartMoney.preferences.v1',
  paper: 'comms.smartMoney.paper.v1',
  resetBackup: 'comms.smartMoney.paper.resetBackup.v1',
  notified: 'comms.smartMoney.notified.v1',
});
```

The export envelope is:

```js
{
  kind: 'comms-dashboard.paper-copy',
  schemaVersion: 1,
  exportedAt: '2026-08-26T12:00:00.000Z',
  state: {
    schemaVersion: 1,
    startingBalance: 100000,
    cash: 100000,
    reservedShortCollateral: 0,
    strategyIntervals: [],
    positions: [],
    transactions: [],
    skippedSignals: [],
    processedSignalIds: [],
    dailyEquity: [],
    benchmarkBaselines: {},
    lastProcessedObservedAt: null
  }
}
```

Reject malformed/future imports before changing state. Before reset, write one
validated current envelope to resetBackup, then replace paper state. Undo
restores once and clears the backup. A second reset replaces the one backup.

test/fixtures/smart-money/paper.js exports a complete schemaVersion 1 PAPER_STATE,
the same state with one processed boundary signal and lastProcessedObservedAt,
and a two-row inclusive history page containing that boundary ID plus one new
eligible signal and matching daily marks.

On mount and focus, request inclusive paged history from lastProcessedObservedAt
or the earliest active strategy start. Follow nextCursor until null, abort stale
request generations, dedupe IDs, reconcile signals and daily marks, persist once,
and never upload local state.

- [ ] **Step 4: Run persistence, provider, and engine tests**

Run:

```powershell
node --test test/smart-money-paper.test.js test/smart-money-storage.test.js
npx vitest run test/smart-money-provider.test.jsx
```

Expected: PASS for reload, inclusive paging, deduplication, reset, undo, import, and export.

- [ ] **Step 5: Commit local paper lifecycle**

```powershell
git add src/lib/smartMoneyStorage.js src/state/SmartMoney.jsx src/utils/downloadJson.js test/fixtures/smart-money/paper.js test/helpers/smart-money-ui.jsx test/smart-money-storage.test.js test/smart-money-provider.test.jsx
git diff --cached --check
git commit -m "feat: persist and reconcile paper simulations"
```

---

### Task 3: Add the accessible Portfolio Paper Copy experience

**Files:**
- Create: src/components/portfolio/HoldingsView.jsx
- Create: src/components/smart-money/PaperCopyView.jsx
- Create: src/components/smart-money/PaperResetDialog.jsx
- Modify: src/components/Portfolio.jsx
- Modify: src/components/NotificationsDrawer.jsx
- Modify: src/App.jsx
- Modify: test/helpers/smart-money-ui.jsx
- Modify: test/fixtures/smart-money/paper.js
- Modify: test/smart-money-ui.test.jsx
- Modify: test/ui-accessibility.test.jsx

**Interfaces:**
- Consumes: useSmartMoney() paper state/actions, SegmentedTabs, existing Portfolio holdings, onSelectAsset, and route view paper-copy.
- Produces: Portfolio({ view, onViewChange, onSelectAsset }), Holdings and Paper Copy panels, and notification Add to paper simulation routing.

Use renderPortfolio and renderPaperCopy from test/helpers/smart-money-ui.jsx,
and export SIGNAL_OBSERVED_BEFORE_NOW and POPULATED_PAPER_STATE from
test/fixtures/smart-money/paper.js.

- [ ] **Step 1: Write failing panel, metrics, start, skip, reset, and routing tests**

```jsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import {
  addSignalToPaper,
  onViewChange,
  renderPaperCopy,
  renderPortfolio,
  resetPaperCopy,
  startPaperCopy,
} from './helpers/smart-money-ui.jsx';
import {
  POPULATED_PAPER_STATE,
  SIGNAL_OBSERVED_BEFORE_NOW,
} from './fixtures/smart-money/paper.js';

it('preserves Holdings and adds an accessible Paper Copy panel', async () => {
  renderPortfolio({ view: 'holdings' });
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Holdings', 'Paper Copy']);
  await userEvent.click(screen.getByRole('tab', { name: 'Paper Copy' }));
  expect(onViewChange).toHaveBeenCalledWith('paper-copy');
  expect(screen.getByText(/Simulation only · No orders are placed/i)).toBeVisible();
});

it('starts future tracking without applying the alert that predates opt-in', async () => {
  renderPaperCopy({ signal: SIGNAL_OBSERVED_BEFORE_NOW });
  await userEvent.click(screen.getByRole('button', { name: /start paper tracking/i }));
  expect(startPaperCopy).toHaveBeenCalledWith(SIGNAL_OBSERVED_BEFORE_NOW.entityId);
  expect(addSignalToPaper).not.toHaveBeenCalled();
});

it('accepts a validated starting balance on first start', async () => {
  renderPaperCopy({ paperState: null, signal: SIGNAL_OBSERVED_BEFORE_NOW });
  const startingBalance = screen.getByRole('spinbutton', { name: /starting balance/i });
  await userEvent.clear(startingBalance);
  await userEvent.type(startingBalance, '250000');
  await userEvent.click(screen.getByRole('button', { name: /start paper tracking/i }));
  expect(startPaperCopy).toHaveBeenCalledWith(
    SIGNAL_OBSERVED_BEFORE_NOW.entityId,
    { startingBalance: 250000 },
  );
});

it('accepts a validated starting balance on reset', async () => {
  renderPaperCopy({ paperState: POPULATED_PAPER_STATE });
  await userEvent.click(screen.getByRole('button', { name: /reset paper copy/i }));
  const resetBalance = within(screen.getByRole('dialog')).getByRole('spinbutton', { name: /starting balance/i });
  await userEvent.clear(resetBalance);
  await userEvent.type(resetBalance, '125000');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^reset$/i }));
  expect(resetPaperCopy).toHaveBeenCalledWith({ startingBalance: 125000 });
});

it('reset confirmation traps focus and undo restores exact prior metrics', async () => {
  renderPaperCopy({ paperState: POPULATED_PAPER_STATE });
  await userEvent.click(screen.getByRole('button', { name: /reset paper copy/i }));
  const dialog = screen.getByRole('dialog', { name: /reset paper copy/i });
  expect(dialog).toBeVisible();
  await userEvent.click(within(dialog).getByRole('button', { name: /^reset$/i }));
  expect(screen.getByRole('button', { name: /undo reset/i })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /undo reset/i }));
  expect(screen.getByText('$105,000')).toBeVisible();
});

it('renders auditable transaction provenance and cost fields', () => {
  renderPaperCopy({ paperState: POPULATED_PAPER_STATE });
  const transaction = screen.getByTestId('paper-transaction-1');
  expect(within(transaction).getByText(/Hyperliquid/i)).toBeVisible();
  expect(within(transaction).getByText(/Observed 2026-08-26 00:05 UTC/i)).toBeVisible();
  expect(within(transaction).getByText(/Reference price 2026-08-26 00:05 UTC/i)).toBeVisible();
  expect(within(transaction).getByText(/Friction \$5/i)).toBeVisible();
  expect(within(transaction).getByText(/material confirmed change/i)).toBeVisible();
});
```

- [ ] **Step 2: Run focused UI/accessibility tests**

Run:

```powershell
npx vitest run test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
```

Expected: FAIL because Portfolio has no Paper Copy panel.

- [ ] **Step 3: Extract holdings unchanged and implement Paper Copy**

Move current Portfolio summary, AddRow, holdings list, export CSV, local-storage
notice, and correlation matrix into HoldingsView without behavior changes.

PaperCopyView shows:

- virtual equity, cash, reserved short collateral, return, gross exposure, and max drawdown;
- S&P 500 and Bitcoin benchmark comparison when applicable;
- active strategy intervals with explicit stop controls;
- open positions, transaction history, and skipped signals with reasons;
- Start Paper Tracking for followed and discovered entities;
- a validated positive finite starting-balance control on first start and reset,
  defaulting to USD 100,000 and persisting the chosen value;
- entry source, signal observation time, reference-price as-of time, friction,
  action, and eligibility reason on every transaction row;
- reset with focus-trapped confirmation, one-use undo banner, JSON export, and JSON import;
- persistent Simulation only and No orders are placed language.

Portfolio route view is holdings or paper-copy. Notification Add to paper
simulation calls addSignalToPaper only if an active strategy interval already
covers observedAt; otherwise it opens Paper Copy and offers future tracking.
Unsupported assets never receive an active add button.

- [ ] **Step 4: Run Portfolio, Smart Money, and existing UI regressions**

Run:

```powershell
npx vitest run test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx test/live-data.test.jsx
npm run build
```

Expected: PASS; existing manual holdings remain unchanged and paper state is separate.

- [ ] **Step 5: Commit the Portfolio Paper Copy view**

```powershell
git add src/components/portfolio/HoldingsView.jsx src/components/smart-money/PaperCopyView.jsx src/components/smart-money/PaperResetDialog.jsx src/components/Portfolio.jsx src/components/NotificationsDrawer.jsx src/App.jsx test/helpers/smart-money-ui.jsx test/fixtures/smart-money/paper.js test/smart-money-ui.test.jsx test/ui-accessibility.test.jsx
git diff --cached --check
git commit -m "feat: integrate paper copy into portfolio"
```

---

### Task 4: Prove the no-trading boundary and complete paper regressions

**Files:**
- Modify: test/smart-money-no-trading.test.js
- Modify: test/smart-money-paper.test.js
- Modify: test/smart-money-storage.test.js
- Modify: test/smart-money-provider.test.jsx
- Modify: test/smart-money-ui.test.jsx
- Modify: test/fixtures/smart-money/client.js

**Interfaces:**
- Consumes: all paper engine, storage, provider, and UI modules.
- Produces: a regression gate that fails if later code adds trading surfaces or leaks local state.

- [ ] **Step 1: Add failing forbidden-network and privacy assertions**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SERVER_RESPONSE_FIXTURES } from './fixtures/smart-money/client.js';

test('Smart Money source contains no execution endpoints or credential fields', () => {
  const roots = [
    'lib/smart-money',
    'api/smart-money.js',
    'api/smart-money',
    'src/App.jsx',
    'src/state/SmartMoney.jsx',
    'src/lib/smartMoneyStorage.js',
    'src/utils/downloadJson.js',
    'src/components/NotificationsDrawer.jsx',
    'src/components/Portfolio.jsx',
    'src/components/portfolio',
    'src/components/smart-money',
  ];
  const source = roots.flatMap(readSourceFiles).join('\n');
  for (const forbidden of [
    '/exchange',
    'createOrder',
    'submitOrder',
    'signTransaction',
    'privateKey',
    'apiSecret',
    'withdraw',
    'depositAddress',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('the pure paper engine cannot fetch, persist, log, or read environment secrets', () => {
  const source = fs.readFileSync('lib/smart-money/paper.js', 'utf8');
  for (const forbidden of [
    /\bfetch\s*\(/,
    /localStorage|sessionStorage/,
    /console\.(log|info|warn|error)/,
    /process\.env/,
    /node:(fs|http|https|net|tls)/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test('paper state is absent from every server API envelope fixture', () => {
  for (const payload of SERVER_RESPONSE_FIXTURES) {
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /strategyIntervals|processedSignalIds|startingBalance/);
  }
});
```

Implement readSourceFiles so it accepts an explicit file or directory, uses
fs.readdirSync with recursive true for directories, and filters .js/.jsx files.
The engine tests also replace globalThis.fetch and storage accessors with
throwing sentinels while exercising every export, proving no hidden runtime
side effect. Export SERVER_RESPONSE_FIXTURES from
test/fixtures/smart-money/client.js as the complete accepted snapshot, history,
health, and briefing fixture envelopes.

- [ ] **Step 2: Run the no-trading test and observe any missing coverage**

Run:

```powershell
node --test test/smart-money-no-trading.test.js
```

Expected: FAIL until all relevant source roots and API fixtures are included.

- [ ] **Step 3: Complete edge-case coverage without weakening assertions**

Add tests for:

- long and short exits, reversals, and entity isolation;
- five-percent slices and twenty/one-hundred-percent caps;
- ten-basis-point entry and exit friction;
- stale, unsupported, price-before-observation, and missing-price skips;
- equal observedAt IDs with inclusive history paging;
- stop/restart intervals without backfill;
- malformed/future import without state loss;
- reset backup replacement and one-use undo;
- offline daily marks, max drawdown, win rate, and both benchmarks;
- equity-only S&P, crypto-only Bitcoin, and mixed-strategy dual benchmarks;
- StrictMode notification and reconciliation deduplication;
- absence of credential/order fields in local import schema.

Do not add allowlist exceptions for forbidden trading terms in production code.

- [ ] **Step 4: Run the full paper and application gate**

Run:

```powershell
node --test test/smart-money-paper.test.js test/smart-money-storage.test.js test/smart-money-no-trading.test.js
npm run test:ui
npm test
npm run build
```

Expected: all commands PASS.

- [ ] **Step 5: Commit completed paper safety coverage**

```powershell
git add test/fixtures/smart-money/client.js test/smart-money-no-trading.test.js test/smart-money-paper.test.js test/smart-money-storage.test.js test/smart-money-provider.test.jsx test/smart-money-ui.test.jsx
git diff --cached --check
git commit -m "test: prove paper copy cannot trade"
```
