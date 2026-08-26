import assert from 'node:assert/strict';
import test from 'node:test';

import { createSmartMoneyHandler } from '../api/smart-money.js';
import { createSmartMoneyHistoryHandler } from '../api/smart-money/history.js';
import {
  publishJournalGeneration,
  readAcceptedSmartMoneySnapshot,
  readJournal,
  stageJournal,
} from '../lib/smart-money/journal.js';
import {
  buildSecHoldingChanges,
  buildSmartMoneyPrivateSnapshot,
  createProductionSmartMoneyDependencies,
  createSmartMoneyRefresher,
  normalizeSmartMoneySettledState,
  validateSmartMoneyPrivateSnapshot,
} from '../lib/smart-money/refresh.js';
import { computeSmartMoneyPrivateStateDigest } from '../lib/smart-money/private-snapshot.js';
import { readDurableSmartMoneyCandidate } from '../lib/smart-money/store.js';
import { mockRequest } from './helpers/api.js';
import { memoryJournalAdapter } from './fixtures/smart-money/journal.js';
import {
  ACCEPTED_SNAPSHOT,
  ACCEPTED_PENDING_CONFIRMATION,
  ENABLED_ADAPTER_IDS,
  createRefreshDeps,
} from './fixtures/smart-money/scenarios.js';

function rebindPrivateSnapshot(snapshot) {
  Object.assign(snapshot, buildSmartMoneyPrivateSnapshot({
    refreshStartedAt: snapshot.refreshStartedAt,
    publicSnapshot: snapshot.publicSnapshot,
    adapterState: snapshot.adapterState,
  }, { now: new Date('2026-08-28T12:00:00.000Z') }));
}

test('refresh runs only the exact seven currently enabled adapters', async () => {
  const { deps, calls } = createRefreshDeps({ signals: [] });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(Object.keys(calls.fetchByAdapter), ENABLED_ADAPTER_IDS);
  assert.ok(Object.values(calls.fetchByAdapter).every((count) => count === 1));
  assert.equal(JSON.stringify(calls).includes('polymarket'), false);
  assert.equal(JSON.stringify(calls).includes('hyperliquid'), false);
  assert.equal(result.persisted, true);
});

test('one due adapter failure preserves its LKG context but creates no new signal', async () => {
  const { deps, calls, captured } = createRefreshDeps({
    timeoutId: 'institutional-fbtc',
    signals: [],
  });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.partial, true);
  assert.equal(result.providerStatuses.find((row) => row.id === 'institutional-fbtc').status, 'unavailable');
  assert.equal(result.signalsAccepted.some((row) => row.providerId === 'institutional-fbtc'), false);
  assert.equal(
    captured.normalizeInput.previous.adapterState.adapters
      .find((row) => row.id === 'institutional-fbtc').source.records[0].id,
    'institutional-fbtc:0001852317-26-000001:2026-06-30',
  );
  assert.equal(captured.normalizeInput.settled.find((row) => row.adapter.id === 'institutional-fbtc').result.status, 'rejected');
  assert.equal(calls.writeSnapshot, 1);
  assert.equal(result.persisted, true);
});

test('fulfilled empty or malformed children preserve only their own LKG while successful siblings continue', () => {
  const { previous, deps } = createRefreshDeps({ signals: [] });
  const strategyPrior = previous.adapterState.adapters.find((row) => row.id === 'institutional-strategy');
  const teslaPrior = previous.adapterState.adapters.find((row) => row.id === 'institutional-tesla');
  const strategyRecord = structuredClone(strategyPrior.source.records[0]);
  const result = normalizeSmartMoneySettledState({
    adapters: deps.adapters,
    dueAdapters: deps.adapters.filter((adapter) => [
      'institutional-strategy', 'institutional-tesla', 'institutional-ibit',
    ].includes(adapter.id)),
    settled: [
      { adapter: deps.adapters[1], result: { status: 'fulfilled', value: { providerId: 'institutional-strategy', records: [strategyRecord], retrievedAt: strategyRecord.retrievedAt } } },
      { adapter: deps.adapters[2], result: { status: 'fulfilled', value: { providerId: 'institutional-tesla', records: [], retrievedAt: '2026-08-28T12:00:00.000Z' } } },
      { adapter: deps.adapters[3], result: { status: 'fulfilled', value: { providerId: 'institutional-ibit', records: [{}], retrievedAt: '2026-08-28T12:00:00.000Z' } } },
    ],
    previous,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });
  assert.deepEqual(result.adapterState.adapters[1].source, strategyPrior.source);
  assert.equal(result.providerStatuses[1].status, 'live');
  assert.equal(result.providerStatuses[1].sourceAsOf, '2026-06-30T00:00:00.000Z');
  assert.equal(result.providerStatuses[1].freshnessBasis, 'retrieval_time');
  assert.deepEqual(result.adapterState.adapters[2].source, teslaPrior.source);
  assert.equal(result.providerStatuses[2].status, 'unavailable');
  assert.equal(result.providerStatuses[2].errorCode, 'empty_dataset');
  assert.deepEqual(
    result.adapterState.adapters[3].source,
    previous.adapterState.adapters[3].source,
  );
  assert.equal(result.providerStatuses[3].status, 'unavailable');
  assert.equal(result.changes.length, 0);
});

test('sec-edgar sourceAsOf uses the latest accepted 13F period and survives LKG failure', () => {
  const { previous, deps } = createRefreshDeps({ signals: [] });
  const secAdapter = deps.adapters[0];
  const acceptedSource = structuredClone(previous.adapterState.adapters[0].source.snapshot);
  const accepted = normalizeSmartMoneySettledState({
    adapters: deps.adapters,
    dueAdapters: [secAdapter],
    settled: [{ adapter: secAdapter, result: { status: 'fulfilled', value: acceptedSource } }],
    previous,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });
  assert.equal(accepted.providerStatuses[0].sourceAsOf, '2026-06-30T00:00:00.000Z');
  assert.equal(accepted.providerStatuses[0].freshnessBasis, 'retrieval_time');

  const failed = normalizeSmartMoneySettledState({
    adapters: deps.adapters,
    dueAdapters: [secAdapter],
    settled: [{ adapter: secAdapter, result: { status: 'rejected', reason: { code: 'timeout' } } }],
    previous: { adapterState: accepted.adapterState },
    now: new Date('2026-08-28T13:00:00.000Z'),
  });
  assert.equal(failed.providerStatuses[0].status, 'unavailable');
  assert.equal(failed.providerStatuses[0].sourceAsOf, '2026-06-30T00:00:00.000Z');
  assert.deepEqual(failed.adapterState.adapters[0].source, accepted.adapterState.adapters[0].source);
});

test('a partial refresh preserves valid signals derived from successful settled siblings', async () => {
  const { deps, previous, captured } = createRefreshDeps({
    timeoutId: 'institutional-fbtc',
    echoJournalSignals: true,
  });
  previous.adapterState.pendingConfirmations = [structuredClone(ACCEPTED_PENDING_CONFIRMATION)];
  rebindPrivateSnapshot(previous);
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.partial, true);
  assert.deepEqual(captured.journalInput.signals, [ACCEPTED_SNAPSHOT.signals[0]]);
  assert.deepEqual(result.signalsAccepted, [ACCEPTED_SNAPSHOT.signals[0]]);
  assert.equal(result.signalsAccepted.some((signal) => signal.providerId === 'institutional-fbtc'), false);
});

test('a not-due adapter performs no fetch, reuses accepted state, and creates no signal', async () => {
  const { deps, calls, captured } = createRefreshDeps({ dueIds: [], signals: [] });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.ok(Object.values(calls.fetchByAdapter).every((count) => count === 0));
  assert.deepEqual(captured.normalizeInput.dueAdapters, []);
  assert.equal(captured.normalizeInput.previous.refreshStartedAt, '2026-08-26T10:59:00.000Z');
  assert.deepEqual(result.signalsAccepted, []);
  assert.equal(result.persisted, true);
});

test('production not-due LKG state recomputes freshness at the trusted refresh time', async () => {
  const { deps, calls } = createRefreshDeps({ dueIds: [], signals: [] });
  delete deps.normalizeSettled;
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.ok(Object.values(calls.fetchByAdapter).every((count) => count === 0));
  assert.ok(result.providerStatuses.every((status) => status.status === 'stale'));
  assert.deepEqual(result.signalsAccepted, []);
});

test('rights assertion occurs before providers, storage mutation, or publication', async () => {
  const { deps, calls } = createRefreshDeps({ rightsError: true });
  await assert.rejects(createSmartMoneyRefresher(deps)({ trigger: 'cron' }), /smart_money_rights_invalid/);
  assert.deepEqual(calls.events, ['lock', 'rights']);
  assert.ok(Object.values(calls.fetchByAdapter).every((count) => count === 0));
  assert.equal(calls.appendJournal, 0);
  assert.equal(calls.writeSnapshot, 0);
});

test('ambiguous durable-candidate probes fail closed before generation C can overwrite B', async () => {
  const generationB = {
    refreshStartedAt: '2026-08-27T12:00:00.000Z', marker: 'recoverable-generation-b',
  };
  const cases = [
    {
      expected: 'candidate_storage_unavailable',
      readCandidate: async () => null,
    },
    {
      expected: 'candidate_storage_unavailable',
      readCandidate: () => readDurableSmartMoneyCandidate({
        blobConfigured: true,
        redisConfigured: true,
        readBlob: async () => { throw new Error('private Blob outage'); },
        readRedis: async () => ({ data: null, error: null }),
      }),
    },
    {
      expected: 'candidate_storage_conflict',
      readCandidate: () => readDurableSmartMoneyCandidate({
        blobConfigured: true,
        redisConfigured: true,
        readBlob: async () => ({ data: generationB, error: null }),
        readRedis: async () => ({
          data: { ...generationB, marker: 'different-generation-b-content' }, error: null,
        }),
      }),
    },
  ];
  for (const { expected, readCandidate } of cases) {
    const { deps, calls } = createRefreshDeps({ signals: [] });
    deps.readCandidateSnapshot = readCandidate;
    const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
    assert.equal(result.persisted, false);
    assert.equal(result.errorCode, expected);
    assert.ok(Object.values(calls.fetchByAdapter).every((count) => count === 0));
    assert.equal(calls.appendJournal, 0);
    assert.equal(calls.writeSnapshot, 0);
    assert.equal(calls.publishJournal, 0);
  }
});

test('only an explicit unanimous absent durable-candidate result may start a new generation', async () => {
  const { deps, calls } = createRefreshDeps({ signals: [] });
  deps.readCandidateSnapshot = async () => ({ status: 'absent' });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, true);
  assert.equal(result.errorCode, null);
  assert.ok(ENABLED_ADAPTER_IDS.every((id) => calls.fetchByAdapter[id] === 1));
  assert.equal(calls.appendJournal, 1);
  assert.equal(calls.writeSnapshot, 1);
  assert.equal(calls.publishJournal, 1);
});

test('all due adapters settle synchronous failures without erasing successful siblings', async () => {
  const { deps, calls, captured } = createRefreshDeps({ signals: [] });
  deps.adapters[2].fetch = () => {
    calls.events.push(`fetch:${deps.adapters[2].id}`);
    calls.fetchByAdapter[deps.adapters[2].id] += 1;
    throw Object.assign(new Error('private synchronous failure'), { code: 'timeout' });
  };
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, true);
  assert.ok(ENABLED_ADAPTER_IDS.every((id) => calls.fetchByAdapter[id] === 1));
  assert.equal(captured.normalizeInput.settled[2].result.status, 'rejected');
  assert.ok(captured.normalizeInput.settled.filter((row) => row.result.status === 'fulfilled').length > 0);
});

test('deriveSignals receives changes, accepted pending confirmations, and the trusted nowMs', async () => {
  const { deps, captured, previous } = createRefreshDeps({ signals: [] });
  previous.adapterState.pendingConfirmations = [structuredClone(ACCEPTED_PENDING_CONFIRMATION)];
  rebindPrivateSnapshot(previous);
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(captured.deriveInput.changes, []);
  assert.deepEqual(captured.deriveInput.pendingConfirmations, [ACCEPTED_PENDING_CONFIRMATION]);
  assert.equal(captured.deriveInput.nowMs, Date.parse('2026-08-28T12:00:00.000Z'));
  assert.equal(Number.isFinite(captured.deriveInput.nowMs), true);
  assert.deepEqual(Object.keys(captured.deriveInput).sort(), ['changes', 'nowMs', 'pendingConfirmations']);
});

test('causal reference-price resolution completes before journal append', async () => {
  const { deps, calls } = createRefreshDeps();
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  const priceIndex = calls.events.findIndex((event) => event.startsWith('price:'));
  assert.ok(priceIndex >= 0);
  assert.ok(priceIndex < calls.events.indexOf('journal'));
});

test('production defaults make zero market-data calls and persist no price evidence or daily marks', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('production market data must stay dormant');
  };
  try {
    const deps = createProductionSmartMoneyDependencies(new Date('2026-08-28T12:00:00.000Z'));
    const signal = structuredClone(ACCEPTED_SNAPSHOT.signals[0]);
    signal.referencePrice = null;
    signal.paperEligibility = { eligible: false, reason: 'missing_reference_price' };
    assert.deepEqual(await deps.resolveReferencePrice(signal), {
      skipped: true,
      reason: 'source_not_permitted',
    });
    assert.deepEqual(await deps.resolveDailyMarks({
      tickers: ['BTC', 'SPX'], date: '2026-08-27',
    }), []);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the private Yahoo bridge uses raw SYMBOLS evidence for causal quotes and completed closes', async () => {
  const signal = structuredClone(ACCEPTED_SNAPSHOT.signals[0]);
  signal.referencePrice = null;
  signal.paperEligibility = { eligible: false, reason: 'missing_reference_price' };
  const { deps, captured } = createRefreshDeps({ signals: [signal], trackedTickers: [] });
  delete deps.resolveReferencePrice;
  delete deps.resolveDailyMarks;
  const yahooCalls = [];
  deps.fetchYahooSparkBatches = async (symbols) => {
    yahooCalls.push([...symbols]);
    const responseFor = (ticker, closes) => ({
      meta: { currency: 'USD', regularMarketTime: Date.parse('2026-08-27T23:59:59.000Z') / 1_000 },
      timestamp: [
        Date.parse('2026-08-26T11:00:00.000Z') / 1_000,
        Date.parse('2026-08-27T23:59:59.000Z') / 1_000,
      ],
      indicators: { quote: [{ close: closes }] },
      ticker,
    });
    const bySymbol = new Map();
    if (symbols.includes('BTC-USD')) bySymbol.set('BTC-USD', responseFor('BTC', [100_000, 101_000]));
    if (symbols.includes('^GSPC')) bySymbol.set('^GSPC', responseFor('SPX', [6_700, 6_800]));
    return { bySymbol, errors: [], requestCount: 1 };
  };
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(captured.journalInput.signals[0].referencePrice.price, 100_000);
  assert.equal(captured.journalInput.signals[0].referencePrice.asOf, signal.observedAt);
  assert.deepEqual(captured.journalInput.signals[0].paperEligibility, {
    eligible: true, reason: 'supported_reference_price',
  });
  assert.deepEqual(captured.journalInput.dailyMarks.map((row) => [row.id, row.price]).sort(), [
    ['2026-08-27:BTC', 101_000],
    ['2026-08-27:SPX', 6_800],
  ]);
  assert.ok(yahooCalls.flat().every((symbol) => ['BTC-USD', '^GSPC'].includes(symbol)));
});

test('the Yahoo bridge accepts an actual post-observation meta quote without fabricating a candle', async () => {
  const signal = structuredClone(ACCEPTED_SNAPSHOT.signals[0]);
  signal.referencePrice = null;
  signal.paperEligibility = { eligible: false, reason: 'missing_reference_price' };
  const { deps, captured } = createRefreshDeps({
    signals: [signal],
    echoJournalSignals: true,
  });
  delete deps.resolveReferencePrice;
  deps.completionNow = () => new Date('2026-08-28T12:00:02.000Z');
  deps.fetchYahooSparkBatches = async (symbols) => ({
    bySymbol: new Map(symbols.map((symbol) => [symbol.toUpperCase(), {
      meta: {
        currency: 'USD', regularMarketPrice: symbol === 'BTC-USD' ? 102_000 : 6_800,
        regularMarketTime: Date.parse('2026-08-28T12:00:01.000Z') / 1_000,
      },
      timestamp: [Date.parse('2026-08-25T23:59:59.000Z') / 1_000],
      indicators: { quote: [{ close: [symbol === 'BTC-USD' ? 101_000 : 6_700] }] },
    }])),
    errors: [], requestCount: 1,
  });
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(captured.journalInput.signals[0].referencePrice, {
    ticker: 'BTC', price: 102_000, currency: 'USD', source: 'yahoo',
    asOf: '2026-08-28T12:00:01.000Z', retrievedAt: '2026-08-28T12:00:02.000Z',
  });
  assert.deepEqual(
    captured.writtenSnapshot.publicSnapshot.signals[0].referencePrice,
    captured.journalInput.signals[0].referencePrice,
  );
  assert.equal(captured.writtenSnapshot.refreshStartedAt, '2026-08-28T12:00:00.000Z');
  assert.equal(captured.writtenSnapshot.publicSnapshot.fetchedAt, '2026-08-28T12:00:02.000Z');
});

test('a new SEC quarter compares against the previous accepted latest quarter', () => {
  const holding = (periodEnd, shares, accessionNumber) => ({
    accessionNumber, periodEnd, filedAt: `${periodEnd.slice(0, 4)}-08-14T00:00:00.000Z`,
    isAmendment: false, amendmentChain: [accessionNumber], issuer: 'NVIDIA Corporation',
    securityClass: 'COM', cusip: '67066G104', ticker: null, reportedValue: 2_000,
    shares, putCall: null, shareType: 'SH', paperEligible: false,
  });
  const changes = buildSecHoldingChanges(
    { kind: 'sec', snapshot: { filings: [], disclosures: [], holdings: [holding('2026-06-30', 800, '0002045724-26-000002')] } },
    { kind: 'sec', snapshot: { filings: [], disclosures: [], holdings: [holding('2026-03-31', 1_000, '0002045724-26-000001')] } },
    new Date('2026-08-28T12:00:00.000Z'),
  );
  assert.equal(changes[0].classification, 'reduced');
  assert.equal(changes[0].previousShares, 1_000);
  assert.equal(changes[0].currentShares, 800);
});

test('completed-day marks cover retained, signaled, SPX, and BTC tickers on the latest completed UTC date', async () => {
  const signal = structuredClone(ACCEPTED_SNAPSHOT.signals[0]);
  signal.asset = { ...signal.asset, ticker: 'SOL', name: 'Solana', providerSymbol: 'SOL' };
  signal.referencePrice = { ...signal.referencePrice, ticker: 'SOL' };
  const { deps, captured } = createRefreshDeps({ signals: [signal], trackedTickers: ['ETH', 'SOL'] });
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(captured.dailyMarkTickers.sort(), ['BTC', 'ETH', 'SOL', 'SPX']);
  assert.equal(captured.dailyMarkDate, '2026-08-27');
  assert.equal(captured.retainedSince, '2025-07-24T12:00:00.000Z');
});

test('a no-signal refresh still journals daily marks for retained assets and benchmarks', async () => {
  const { deps, captured } = createRefreshDeps({ signals: [], trackedTickers: ['ETH'] });
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(captured.dailyMarkTickers.sort(), ['BTC', 'ETH', 'SPX']);
});

test('journal nondurability accepts no signal and performs zero snapshot writes', async () => {
  const { deps, calls } = createRefreshDeps({ journalDurable: false });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, false);
  assert.deepEqual(result.signalsAccepted, []);
  assert.equal(result.errorCode, 'journal_persistence_failed');
  assert.equal(calls.appendJournal, 1);
  assert.equal(calls.writeSnapshot, 0);
});

test('snapshot nondurability leaves the journal row but accepts no signal', async () => {
  const { deps, calls } = createRefreshDeps({ snapshotDurable: false });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, false);
  assert.deepEqual(result.signalsAccepted, []);
  assert.equal(result.errorCode, 'snapshot_persistence_failed');
  assert.equal(calls.appendJournal, 1);
  assert.equal(calls.writeSnapshot, 1);
  assert.equal(calls.publishJournal, 0);
});

test('a superseded snapshot generation publishes none of its staged rows', async () => {
  const { deps, calls } = createRefreshDeps({
    snapshotWriteResult: {
      snapshot: null,
      durableWriteSucceeded: false,
      supersededWrites: 2,
    },
  });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, false);
  assert.deepEqual(result.signalsAccepted, []);
  assert.equal(result.errorCode, 'snapshot_persistence_failed');
  assert.equal(calls.appendJournal, 1);
  assert.equal(calls.writeSnapshot, 1);
  assert.equal(calls.publishJournal, 0);
});

test('accepted snapshot generation publishes after snapshot durability and marker failure stays nondurable', async () => {
  const { deps, calls, captured } = createRefreshDeps({ publicationDurable: false });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.equal(result.persisted, false);
  assert.equal(result.errorCode, 'journal_publication_failed');
  assert.deepEqual(result.signalsAccepted, []);
  assert.deepEqual(captured.publicationInput, {
    refreshStartedAt: '2026-08-28T12:00:00.000Z',
    snapshot: captured.writtenSnapshot,
  });
  assert.ok(calls.events.indexOf('snapshot') < calls.events.indexOf('publication'));
});

test('snapshot and history share one acceptance gate across marker failure and retry without re-derivation', async () => {
  let failAcceptance = false;
  let adapter;
  adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (failAcceptance && pathname === 'smart-money/v1/journal/publications.json'
          && data.current?.refreshStartedAt === '2026-08-28T12:00:00.000Z') {
        failAcceptance = false;
        adapter.failNext(pathname);
      }
    },
  });
  const fixture = createRefreshDeps({ echoJournalSignals: true });
  const baseline = buildSmartMoneyPrivateSnapshot({
    refreshStartedAt: fixture.previous.refreshStartedAt,
    publicSnapshot: { ...structuredClone(fixture.previous.publicSnapshot), signals: [] },
    adapterState: fixture.previous.adapterState,
  }, { now: new Date('2026-08-28T12:00:00.000Z') });
  await stageJournal({
    refreshStartedAt: baseline.refreshStartedAt, signals: [], dailyMarks: [],
  }, { adapter, now: new Date('2026-08-28T12:00:00.000Z') });
  await publishJournalGeneration({
    refreshStartedAt: baseline.refreshStartedAt, snapshot: baseline,
  }, { adapter, now: new Date('2026-08-28T12:00:00.000Z') });

  let durableCandidate = null;
  fixture.deps.readSnapshot = () => readAcceptedSmartMoneySnapshot({
    adapter, now: new Date('2026-08-28T12:00:00.000Z'),
  });
  fixture.deps.readCandidateSnapshot = async () => durableCandidate === null
    ? { status: 'absent' }
    : { status: 'ready', snapshot: structuredClone(durableCandidate) };
  fixture.deps.appendJournal = (input) => stageJournal(input, {
    adapter, now: new Date('2026-08-28T12:00:00.000Z'),
  });
  fixture.deps.writeSnapshot = async (snapshot) => {
    fixture.calls.events.push('snapshot');
    fixture.calls.writeSnapshot += 1;
    fixture.captured.writtenSnapshot = structuredClone(snapshot);
    durableCandidate = structuredClone(snapshot);
    return { snapshot, durableWriteSucceeded: true };
  };
  fixture.deps.publishJournalGeneration = (input) => publishJournalGeneration(input, {
    adapter, now: new Date('2026-08-28T12:00:00.000Z'),
  });
  failAcceptance = true;

  const snapshotHandler = createSmartMoneyHandler({
    readSnapshot: () => readAcceptedSmartMoneySnapshot({
      adapter, now: new Date('2026-08-28T12:00:00.000Z'),
    }),
    now: () => new Date('2026-08-28T12:00:00.000Z'),
  });
  const historyHandler = createSmartMoneyHistoryHandler({
    readJournal: (query) => readJournal(query, {
      adapter, now: new Date('2026-08-28T12:00:00.000Z'),
    }),
    now: () => new Date('2026-08-28T12:00:00.000Z'),
  });
  async function readPublicRoutes() {
    const snapshotRequest = mockRequest('/api/smart-money');
    await snapshotHandler(snapshotRequest.req, snapshotRequest.res);
    const historyRequest = mockRequest('/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=20');
    await historyHandler(historyRequest.req, historyRequest.res);
    return { snapshot: snapshotRequest.res, history: historyRequest.res };
  }

  const first = await createSmartMoneyRefresher(fixture.deps)({ trigger: 'cron' });
  assert.equal(first.persisted, false);
  assert.equal(first.errorCode, 'journal_publication_failed');
  const beforeRetry = await readPublicRoutes();
  assert.deepEqual(beforeRetry.snapshot.body.signals, []);
  assert.deepEqual(beforeRetry.history.body.signals, []);

  const fetchesBeforeRetry = structuredClone(fixture.calls.fetchByAdapter);
  const derivationsBeforeRetry = fixture.calls.events.filter((event) => event === 'derive').length;
  const retry = await createSmartMoneyRefresher(fixture.deps)({ trigger: 'cron' });
  assert.equal(retry.persisted, true);
  assert.deepEqual(fixture.calls.fetchByAdapter, fetchesBeforeRetry);
  assert.equal(fixture.calls.events.filter((event) => event === 'derive').length, derivationsBeforeRetry);
  const afterRetry = await readPublicRoutes();
  assert.deepEqual(afterRetry.snapshot.body.signals, [ACCEPTED_SNAPSHOT.signals[0]]);
  assert.deepEqual(afterRetry.history.body.signals, [ACCEPTED_SNAPSHOT.signals[0]]);
});

test('snapshot publication uses only journal committedSignals', async () => {
  const derived = structuredClone(ACCEPTED_SNAPSHOT.signals[0]);
  derived.referencePrice.price = 999_999;
  const committed = structuredClone(ACCEPTED_SNAPSHOT.signals[0]);
  committed.referencePrice.price = 100_000;
  const { deps, captured } = createRefreshDeps({
    signals: [derived],
    committedSignals: [committed],
  });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(captured.snapshotSignals, [committed]);
  assert.deepEqual(result.signalsAccepted, [committed]);
  assert.notDeepEqual(captured.snapshotSignals, [derived]);
});

test('durable storage receives the exact private wrapper and never mixes private fields into publicSnapshot', async () => {
  const { deps, captured } = createRefreshDeps();
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  assert.deepEqual(Object.keys(captured.writtenSnapshot), [
    'schemaVersion', 'refreshStartedAt', 'publicSnapshot', 'adapterState', 'stateDigest',
  ]);
  assert.equal(captured.writtenSnapshot.schemaVersion, 1);
  assert.equal(captured.writtenSnapshot.refreshStartedAt, '2026-08-28T12:00:00.000Z');
  assert.equal(Object.hasOwn(captured.writtenSnapshot.publicSnapshot, 'adapterState'), false);
  assert.equal(Object.hasOwn(captured.writtenSnapshot.publicSnapshot, 'refreshStartedAt'), false);
  assert.deepEqual(captured.writtenSnapshot.publicSnapshot.signals, captured.snapshotSignals);
});

test('private envelope digest rejects swapped child statuses and public/private count mismatches', () => {
  const { previous } = createRefreshDeps({ signals: [] });
  const swapped = structuredClone(previous);
  [swapped.adapterState.adapters[1].status, swapped.adapterState.adapters[2].status] = [
    swapped.adapterState.adapters[2].status,
    swapped.adapterState.adapters[1].status,
  ];
  assert.throws(
    () => validateSmartMoneyPrivateSnapshot(swapped, { now: new Date('2026-08-28T12:00:00.000Z') }),
    /snapshot_invalid|schema_invalid/,
  );
  const countMismatch = structuredClone(previous);
  countMismatch.publicSnapshot.providerStatuses[1].recordCount = 0;
  assert.throws(
    () => validateSmartMoneyPrivateSnapshot(countMismatch, { now: new Date('2026-08-28T12:00:00.000Z') }),
    /snapshot_invalid|schema_invalid/,
  );
  assert.match(previous.stateDigest, /^sha256:[a-f0-9]{64}$/);
});

test('private validation rejects recomputed institutional source swaps and foreign SEC CIK state', () => {
  const { previous } = createRefreshDeps({ signals: [] });
  const sourceSwap = structuredClone(previous);
  [sourceSwap.adapterState.adapters[1].source, sourceSwap.adapterState.adapters[2].source] = [
    sourceSwap.adapterState.adapters[2].source,
    sourceSwap.adapterState.adapters[1].source,
  ];
  sourceSwap.stateDigest = computeSmartMoneyPrivateStateDigest(sourceSwap);
  assert.throws(
    () => validateSmartMoneyPrivateSnapshot(sourceSwap, {
      now: new Date('2026-08-28T12:00:00.000Z'),
    }),
    /schema_invalid/,
  );

  const foreignSecCik = structuredClone(previous);
  foreignSecCik.adapterState.adapters[0].source.snapshot.filings[0].cik = '1050446';
  foreignSecCik.stateDigest = computeSmartMoneyPrivateStateDigest(foreignSecCik);
  assert.throws(
    () => validateSmartMoneyPrivateSnapshot(foreignSecCik, {
      now: new Date('2026-08-28T12:00:00.000Z'),
    }),
    /schema_invalid/,
  );
});

test('private envelope constructor computes its digest internally and rejects caller digest input', () => {
  const { previous } = createRefreshDeps({ signals: [] });
  assert.throws(() => buildSmartMoneyPrivateSnapshot({
    refreshStartedAt: previous.refreshStartedAt,
    publicSnapshot: previous.publicSnapshot,
    adapterState: previous.adapterState,
    stateDigest: 'sha256:caller-controlled',
  }, { now: new Date('2026-08-28T12:00:00.000Z') }), /schema_invalid/);
});

test('private envelope digest rejects refresh generation timestamp tampering', () => {
  const { previous } = createRefreshDeps({ signals: [] });
  const tampered = structuredClone(previous);
  tampered.refreshStartedAt = '2026-08-26T10:58:00.000Z';
  assert.throws(
    () => validateSmartMoneyPrivateSnapshot(tampered, { now: new Date('2026-08-28T12:00:00.000Z') }),
    /snapshot_invalid|schema_invalid/,
  );
});

test('a private wrapper round-trips as the next accepted previous state', async () => {
  const first = createRefreshDeps({ signals: [] });
  await createSmartMoneyRefresher(first.deps)({ trigger: 'cron' });
  const second = createRefreshDeps({ previous: first.captured.writtenSnapshot, signals: [] });
  await createSmartMoneyRefresher(second.deps)({ trigger: 'cron' });
  assert.equal(
    second.captured.normalizeInput.previous.refreshStartedAt,
    first.captured.writtenSnapshot.refreshStartedAt,
  );
  assert.deepEqual(
    second.captured.normalizeInput.previous.publicSnapshot,
    first.captured.writtenSnapshot.publicSnapshot,
  );
});

test('a corrupt private wrapper fails before adapters or durable mutation', async () => {
  const corrupt = {
    schemaVersion: 1,
    refreshStartedAt: '2026-08-26T11:00:00.000Z',
    publicSnapshot: structuredClone(ACCEPTED_SNAPSHOT),
    adapterState: { schemaVersion: 1, adapters: [], pendingConfirmations: [], rawBody: 'private provider response' },
  };
  const { deps, calls } = createRefreshDeps({ previous: corrupt });
  await assert.rejects(
    createSmartMoneyRefresher(deps)({ trigger: 'cron' }),
    /snapshot_invalid|schema_invalid/,
  );
  assert.ok(Object.values(calls.fetchByAdapter).every((count) => count === 0));
  assert.equal(calls.appendJournal, 0);
  assert.equal(calls.writeSnapshot, 0);
});

test('refresh transaction follows the exact durable publication order', async () => {
  const { deps, calls } = createRefreshDeps();
  await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  const phases = calls.events.filter((event) => [
    'rights', 'readSnapshot', 'normalize', 'derive', 'trackedTickers', 'dailyMarks',
    'journal', 'buildSnapshot', 'snapshot', 'publication',
  ].includes(event) || event.startsWith('price:'));
  assert.deepEqual(phases, [
    'rights', 'readSnapshot', 'normalize', 'derive',
    `price:${ACCEPTED_SNAPSHOT.signals[0].id}`,
    'trackedTickers', 'dailyMarks', 'journal', 'buildSnapshot', 'snapshot', 'publication',
  ]);
});

test('operational failure details are sanitized from refresh results', async () => {
  const { deps } = createRefreshDeps({ timeoutId: 'institutional-fbtc', signals: [] });
  const result = await createSmartMoneyRefresher(deps)({ trigger: 'cron' });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('raw-secret'), false);
  assert.equal(serialized.includes('provider.invalid'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.match(serialized, /timeout/);
});
