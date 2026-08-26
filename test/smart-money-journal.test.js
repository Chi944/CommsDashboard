import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendJournal,
  listTrackedTickers,
  pruneJournal,
  readJournal,
} from '../lib/smart-money/journal.js';
import { SIGNAL, memoryJournalAdapter } from './fixtures/smart-money/journal.js';

const MANIFEST = 'smart-money/v1/journal/manifest.json';
const PARTITION = 'smart-money/v1/journal/2026-08-26.json';

function signalAt(id, observedAt, ticker = 'BTC') {
  const observedMs = Date.parse(observedAt);
  return {
    ...structuredClone(SIGNAL),
    id,
    activityId: `activity:${id}`,
    asset: {
      ...SIGNAL.asset,
      ticker,
      name: ticker,
      providerSymbol: ticker,
      assetClass: ticker === 'SPX' ? 'equity' : 'crypto',
    },
    effectiveAt: new Date(observedMs - 300_000).toISOString(),
    observedAt,
    referencePrice: {
      ...SIGNAL.referencePrice,
      ticker,
      asOf: observedAt,
      retrievedAt: new Date(observedMs + 1_000).toISOString(),
    },
  };
}

function dailyMark(date = '2026-08-26', ticker = 'BTC') {
  return {
    id: `${date}:${ticker}`,
    date,
    ticker,
    assetClass: ticker === 'SPX' ? 'equity' : 'crypto',
    kind: ['SPX', 'BTC'].includes(ticker) ? 'benchmark' : 'asset',
    price: ticker === 'BTC' ? 100_000 : 5_000,
    currency: 'USD',
    source: 'yahoo',
    asOf: `${date}T20:00:00.000Z`,
    retrievedAt: `${date}T20:00:01.000Z`,
  };
}

test('journal append returns the exact durable contract and rereads committed rows', async () => {
  const adapter = memoryJournalAdapter();
  const mark = dailyMark();
  const result = await appendJournal({ signals: [SIGNAL], dailyMarks: [mark] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(result.committedSignals, [SIGNAL]);
  assert.deepEqual(result.committedDailyMarks, [mark]);
  assert.deepEqual(adapter.paths(), [PARTITION, MANIFEST]);
});

test('journal retry preserves the original immutable signal and reference price', async () => {
  const adapter = memoryJournalAdapter();
  await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });
  const retry = await appendJournal({
    signals: [{
      ...SIGNAL,
      referencePrice: { ...SIGNAL.referencePrice, price: SIGNAL.referencePrice.price + 5_000 },
    }],
    dailyMarks: [],
  }, { adapter });
  const result = await readJournal({
    since: SIGNAL.observedAt,
    limit: 200,
  }, { adapter, now: new Date('2026-08-27T00:00:00.000Z') });
  assert.deepEqual(result.signals.map((row) => row.id), [SIGNAL.id]);
  assert.equal(retry.committedSignals[0].referencePrice.price, SIGNAL.referencePrice.price);
});

test('journal retry preserves the original immutable completed daily mark', async () => {
  const adapter = memoryJournalAdapter();
  const original = dailyMark();
  await appendJournal({ signals: [], dailyMarks: [original] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  const retry = await appendJournal({
    signals: [], dailyMarks: [{ ...original, price: original.price + 5_000 }],
  }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(retry.committedDailyMarks[0].price, original.price);
});

test('concurrent daily-mark writers return the first durable close to every contender', async () => {
  const original = dailyMark();
  const drifted = { ...original, price: original.price + 5_000 };
  let announceDrift;
  let releaseDrift;
  let blocked = false;
  const driftReached = new Promise((resolve) => { announceDrift = resolve; });
  const driftGate = new Promise((resolve) => { releaseDrift = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!blocked && pathname === PARTITION && data.dailyMarks[0]?.price === drifted.price) {
        blocked = true;
        announceDrift();
        await driftGate;
      }
    },
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const driftWrite = appendJournal({ signals: [], dailyMarks: [drifted] }, options);
  await driftReached;
  const firstCommit = await appendJournal({ signals: [], dailyMarks: [original] }, options);
  releaseDrift();
  const contender = await driftWrite;
  assert.equal(firstCommit.committedDailyMarks[0].price, original.price);
  assert.equal(contender.committedDailyMarks[0].price, original.price);
});

test('concurrent journal writers CAS-merge distinct rows in one partition and manifest', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt('hyperliquid-account-details:a', '2026-08-26T01:00:00.000Z');
  const second = signalAt('hyperliquid-account-details:b', '2026-08-26T01:00:00.000Z');
  const [left, right] = await Promise.all([
    appendJournal({ signals: [first], dailyMarks: [] }, { adapter }),
    appendJournal({ signals: [second], dailyMarks: [] }, { adapter }),
  ]);
  const history = await readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 200 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.equal(left.durableWriteSucceeded, true);
  assert.equal(right.durableWriteSucceeded, true);
  assert.deepEqual(history.signals.map((row) => row.id), [first.id, second.id]);
});

test('partition or manifest partial failures never report durable success or leak diagnostics', async () => {
  const partitionFailureAdapter = memoryJournalAdapter();
  partitionFailureAdapter.failNext(PARTITION);
  const partitionFailure = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, {
    adapter: partitionFailureAdapter,
  });
  assert.equal(partitionFailure.durableWriteSucceeded, false);
  assert.equal(JSON.stringify(partitionFailure).includes('secret'), false);

  const manifestFailureAdapter = memoryJournalAdapter();
  manifestFailureAdapter.failNext(MANIFEST);
  const manifestFailure = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, {
    adapter: manifestFailureAdapter,
  });
  assert.equal(manifestFailure.durableWriteSucceeded, false);
  assert.equal(manifestFailureAdapter.inspect(PARTITION).signals.length, 1);
  assert.equal(JSON.stringify(manifestFailure).includes('secret'), false);
});

test('journal append returns its exact sanitized failure contract when storage is unavailable', async () => {
  const unavailableAdapter = {
    async read() { throw new Error('https://blob.test/?token=raw-secret'); },
    async write() { throw new Error('must not write'); },
    isConflict() { return false; },
  };
  const unavailable = await appendJournal({ signals: [], dailyMarks: [] }, {
    adapter: unavailableAdapter,
  });
  assert.deepEqual(Object.keys(unavailable).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(unavailable.durableWriteSucceeded, false);
  assert.equal(JSON.stringify(unavailable).includes('raw-secret'), false);

  const env = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    COMMS_DASHBOARD_READ_WRITE_TOKEN: process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN,
    BLOB_STORE_ID: process.env.BLOB_STORE_ID,
  };
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  try {
    const unconfigured = await appendJournal({ signals: [], dailyMarks: [] });
    assert.equal(unconfigured.durableWriteSucceeded, false);
    assert.equal(unconfigured.manifest.error, 'journal_configuration_invalid');
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('journal rejects unsafe shapes, duplicate and type-colliding IDs, and cross-day marks', async () => {
  const adapter = memoryJournalAdapter();
  const unsafe = {};
  Object.defineProperty(unsafe, 'signals', { enumerable: true, get: () => { throw new Error('getter ran'); } });
  Object.defineProperty(unsafe, 'dailyMarks', { enumerable: true, value: [] });
  await assert.rejects(appendJournal(unsafe, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({ signals: [SIGNAL, SIGNAL], dailyMarks: [] }, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [], dailyMarks: [{ ...dailyMark(), id: '2026-08-25:BTC' }],
  }, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [{ ...SIGNAL, id: '2026-08-26:BTC' }], dailyMarks: [dailyMark()],
  }, { adapter }), /schema_invalid/);
});

test('journal rejects future signals and marks from an incomplete UTC day', async () => {
  const adapter = memoryJournalAdapter();
  const now = new Date('2026-08-26T00:00:00.000Z');
  await assert.rejects(appendJournal({
    signals: [signalAt('hyperliquid-account-details:future', '2026-08-26T01:00:00.000Z')],
    dailyMarks: [],
  }, { adapter, now }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [],
    dailyMarks: [dailyMark('2026-08-26', 'BTC')],
  }, { adapter, now: new Date('2026-08-26T23:59:59.999Z') }), /schema_invalid/);
});

test('journal rejects stored rows placed in the wrong UTC-day partition', async () => {
  const adapter = memoryJournalAdapter();
  adapter.seed(MANIFEST, {
    schemaVersion: 1,
    partitions: ['2026-08-26'],
    signalIds: { [SIGNAL.id]: '2026-08-26' },
    dailyMarkIds: {},
  });
  adapter.seed(PARTITION, {
    schemaVersion: 1,
    date: '2026-08-26',
    signals: [signalAt('hyperliquid-account-details:wrong-day', '2026-08-25T23:59:59.000Z')],
    dailyMarks: [],
  });
  await assert.rejects(readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 10 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  }), /schema_invalid/);
});

test('history is inclusive, bounded, exact, and pages equal timestamps by stable ID', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt('hyperliquid-account-details:a', '2026-08-26T01:00:00.000Z');
  const second = signalAt('hyperliquid-account-details:b', '2026-08-26T01:00:00.000Z');
  await appendJournal({ signals: [second, first], dailyMarks: [dailyMark()] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const pageOne = await readJournal({ since: first.observedAt, limit: 1 }, options);
  assert.deepEqual(Object.keys(pageOne), [
    'schemaVersion', 'ok', 'fetchedAt', 'partial', 'since', 'through', 'entities', 'signals',
    'dailyMarks', 'nextCursor', 'providerStatuses', 'warnings', 'sourceLinks',
  ]);
  assert.deepEqual(pageOne.signals.map((row) => row.id), [first.id]);
  assert.equal(typeof pageOne.nextCursor, 'string');
  const pageTwo = await readJournal({ since: first.observedAt, limit: 1, cursor: pageOne.nextCursor }, options);
  assert.deepEqual(pageTwo.signals.map((row) => row.id), [second.id]);
  assert.equal(pageTwo.nextCursor, null);
  assert.deepEqual(pageTwo.dailyMarks.map((row) => row.id), ['2026-08-26:BTC']);

  for (const query of [
    { since: first.observedAt, limit: 0 },
    { since: first.observedAt, limit: 501 },
    { since: '2025-07-22T23:59:59.999Z', limit: 1 },
    { since: first.observedAt, limit: 1, cursor: 'not-an-opaque-cursor' },
  ]) {
    await assert.rejects(readJournal(query, options), /schema_invalid/);
  }
});

test('tracked tickers use retained supported assets and exclude unsupported research rows', async () => {
  const adapter = memoryJournalAdapter();
  const eth = signalAt('hyperliquid-account-details:eth', '2026-08-26T02:00:00.000Z', 'ETH');
  const unsupported = {
    ...signalAt('sec-edgar:research', '2026-08-26T03:00:00.000Z', 'ABC'),
    providerId: 'sec-edgar',
    entityId: 'situational-awareness-lp',
    kind: 'holding_change',
    action: 'observe',
    asset: { ticker: null, name: 'Research only', providerSymbol: 'ABC', assetClass: 'equity', supported: false },
    direction: null,
    magnitude: { value: 1_000_000, unit: 'reported_value_usd' },
    positionChange: null,
    disclosedAt: '2026-08-26T03:00:00.000Z',
    effectiveAt: '2026-08-25T03:00:00.000Z',
    delaySeconds: 86_400,
    paperEligibility: { eligible: false, reason: 'unsupported_asset' },
    referencePrice: null,
  };
  await appendJournal({ signals: [eth, unsupported], dailyMarks: [] }, { adapter });
  const tickers = await listTrackedTickers({ since: '2026-08-26T00:00:00.000Z' }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(tickers, ['ETH']);
});

test('prune removes only expired partitions and a stale manifest ETag cannot erase a concurrent newer date', async () => {
  let armPrune = false;
  let blocked = false;
  let announceBlocked;
  let releasePrune;
  const pruneBlocked = new Promise((resolve) => { announceBlocked = resolve; });
  const pruneRelease = new Promise((resolve) => { releasePrune = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (armPrune && !blocked && pathname === MANIFEST && !data.partitions.includes('2025-07-21')) {
        blocked = true;
        announceBlocked();
        await pruneRelease;
      }
    },
  });
  const old = signalAt('hyperliquid-account-details:old', '2025-07-21T12:00:00.000Z');
  await appendJournal({ signals: [old], dailyMarks: [] }, {
    adapter,
    now: new Date('2025-07-23T00:00:00.000Z'),
  });
  armPrune = true;
  const pruning = pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') }, { adapter });
  await pruneBlocked;
  const recent = signalAt('hyperliquid-account-details:recent', '2026-08-26T10:00:00.000Z');
  await appendJournal({ signals: [recent], dailyMarks: [] }, {
    adapter,
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  releasePrune();
  const result = await pruning;
  const manifest = adapter.inspect(MANIFEST);
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(manifest.partitions, ['2026-08-26']);
  assert.equal(manifest.signalIds[recent.id], '2026-08-26');
  assert.equal(adapter.inspect('smart-money/v1/journal/2025-07-21.json'), null);
});
