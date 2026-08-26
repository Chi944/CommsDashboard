import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDailyMarks, resolveReferencePrice } from '../lib/smart-money/reference-prices.js';
import { DAILY_MARK_DEPS, SIGNAL } from './fixtures/smart-money/journal.js';

test('reference price chooses the causally nearest valid quote independent of input order', async () => {
  const result = await resolveReferencePrice(SIGNAL, {
    fetchPrices: async () => [
      { ticker: 'BTC', price: 100_100, currency: 'USD', asOf: '2026-08-26T00:05:02.000Z', retrievedAt: '2026-08-26T00:05:03.000Z', source: 'yahoo', stale: false },
      { ticker: 'BTC', price: 99_000, currency: 'USD', asOf: '2026-08-26T00:04:59.000Z', retrievedAt: '2026-08-26T00:05:00.000Z', source: 'yahoo', stale: false },
      { ticker: 'BTC', price: 100_000, currency: 'USD', asOf: '2026-08-26T00:05:00.000Z', retrievedAt: '2026-08-26T00:05:01.000Z', source: 'yahoo', stale: false },
    ],
    retrievedAt: '2026-08-26T00:05:04.000Z',
  });
  assert.equal(result.price, 100_000);
  assert.equal(result.asOf, SIGNAL.observedAt);
});

test('reference price rejects pre-observation, stale, untrusted, fallback, wrong-ticker, non-USD, and invalid-order quotes', async () => {
  const result = await resolveReferencePrice(SIGNAL, {
    fetchPrices: async () => ({
      ok: true,
      source: 'yahoo',
      commodities: [
        { ticker: 'BTC', price: 1, currency: 'USD', source: 'yahoo', asOf: '2026-08-26T00:04:59.000Z', stale: false },
        { ticker: 'BTC', price: 2, currency: 'USD', source: 'yahoo', asOf: SIGNAL.observedAt, stale: true },
        { ticker: 'BTC', price: 3, currency: 'USD', source: 'mock', asOf: SIGNAL.observedAt, stale: false },
        { ticker: 'BTC', price: 4, currency: 'USD', source: 'fallback', asOf: SIGNAL.observedAt, stale: false },
        { ticker: 'ETH', price: 5, currency: 'USD', source: 'yahoo', asOf: SIGNAL.observedAt, stale: false },
        { ticker: 'BTC', price: 6, currency: 'EUR', source: 'yahoo', asOf: SIGNAL.observedAt, stale: false },
        { ticker: 'BTC', price: 0, currency: 'USD', source: 'yahoo', asOf: SIGNAL.observedAt, stale: false },
        { ticker: 'BTC', price: 7, currency: 'USD', source: 'yahoo', asOf: '2026-08-26T00:05:03.000Z', retrievedAt: '2026-08-26T00:05:02.000Z', stale: false },
        { ticker: 'BTC', price: 8, currency: 'USD', source: 'yahoo', asOf: SIGNAL.observedAt, retrievedAt: '2026-08-26T00:05:05.000Z', stale: false },
      ],
    }),
    retrievedAt: '2026-08-26T00:05:04.000Z',
  });
  assert.deepEqual(result, { skipped: true, reason: 'missing_reference_price' });
});

test('reference price rejects an unhealthy dashboard payload and does not trust a row status override', async () => {
  for (const payload of [
    { ok: false, source: 'yahoo', commodities: [{ ...SIGNAL.referencePrice, stale: false }] },
    { ok: true, source: 'fallback', commodities: [{ ...SIGNAL.referencePrice, stale: false }] },
    { ok: true, source: 'yahoo', commodities: [{ ...SIGNAL.referencePrice, status: 'fallback', stale: false }] },
  ]) {
    const result = await resolveReferencePrice(SIGNAL, {
      fetchPrices: async () => payload,
      retrievedAt: '2026-08-26T00:05:02.000Z',
    });
    assert.deepEqual(result, { skipped: true, reason: 'missing_reference_price' });
  }
});

test('reference price explicitly skips unsupported assets without fetching', async () => {
  let calls = 0;
  const result = await resolveReferencePrice({
    ...SIGNAL,
    asset: { ticker: null, name: 'Unmapped', providerSymbol: 'CUSIP', assetClass: 'equity', supported: false },
    paperEligibility: { eligible: false, reason: 'unsupported_asset' },
    referencePrice: null,
  }, {
    fetchPrices: async () => { calls += 1; return []; },
    retrievedAt: '2026-08-26T00:05:02.000Z',
  });
  assert.deepEqual(result, { skipped: true, reason: 'unsupported_asset' });
  assert.equal(calls, 0);
});

test('daily marks include retained assets and both canonical benchmarks without a new signal', async () => {
  const result = await resolveDailyMarks({ date: '2026-08-27', tickers: ['ETH'] }, DAILY_MARK_DEPS);
  assert.deepEqual(result.map((row) => row.ticker).sort(), ['BTC', 'ETH', 'SPX']);
  assert.ok(result.every((row) => row.id.startsWith('2026-08-27:')));
  assert.equal(result.find((row) => row.ticker === 'ETH').kind, 'asset');
  assert.equal(result.find((row) => row.ticker === 'BTC').kind, 'benchmark');
  assert.equal(result.find((row) => row.ticker === 'SPX').kind, 'benchmark');
});

test('daily marks accept only completed UTC-day closes, never intraday or current-day quotes', async () => {
  await assert.rejects(resolveDailyMarks({ date: '2026-08-27', tickers: ['ETH'] }, {
    now: () => new Date('2026-08-27T23:59:59.999Z'),
    fetchDailyCloses: DAILY_MARK_DEPS.fetchDailyCloses,
  }), /schema_invalid/);

  const marks = await resolveDailyMarks({ date: '2026-08-27', tickers: ['ETH'] }, {
    now: () => new Date('2026-08-28T00:00:00.000Z'),
    fetchDailyCloses: async () => [
      { ticker: 'ETH', assetClass: 'crypto', price: 4_900, currency: 'USD', source: 'yahoo', date: '2026-08-27', asOf: '2026-08-27T12:00:00.000Z', retrievedAt: '2026-08-27T12:00:01.000Z', status: 'intraday' },
      { ticker: 'BTC', assetClass: 'crypto', close: 100_000, currency: 'USD', source: 'yahoo', date: '2026-08-27', asOf: '2026-08-27T23:59:59.000Z', retrievedAt: '2026-08-27T23:59:59.500Z', status: 'closed' },
      { ticker: 'SPX', assetClass: 'equity', close: 6_800, currency: 'USD', source: 'yahoo', date: '2026-08-27', asOf: '2026-08-27T20:00:00.000Z', retrievedAt: '2026-08-27T20:00:01.000Z', status: 'closed' },
    ],
  });
  assert.deepEqual(marks.map((row) => row.ticker).sort(), ['BTC', 'SPX']);
});

test('daily mark validation rejects cross-day, untrusted, nonpositive, and retrieval-before-close rows', async () => {
  const invalidRows = [
    { ticker: 'ETH', assetClass: 'crypto', close: 1, currency: 'USD', source: 'yahoo', date: '2026-08-26', asOf: '2026-08-27T20:00:00.000Z', retrievedAt: '2026-08-27T20:00:01.000Z', status: 'closed' },
    { ticker: 'ETH', assetClass: 'crypto', close: 1, currency: 'USD', source: 'mock', date: '2026-08-27', asOf: '2026-08-27T20:00:00.000Z', retrievedAt: '2026-08-27T20:00:01.000Z', status: 'closed' },
    { ticker: 'ETH', assetClass: 'crypto', close: 0, currency: 'USD', source: 'yahoo', date: '2026-08-27', asOf: '2026-08-27T20:00:00.000Z', retrievedAt: '2026-08-27T20:00:01.000Z', status: 'closed' },
    { ticker: 'ETH', assetClass: 'crypto', close: 1, currency: 'USD', source: 'yahoo', date: '2026-08-27', asOf: '2026-08-27T20:00:01.000Z', retrievedAt: '2026-08-27T20:00:00.000Z', status: 'closed' },
  ];
  const marks = await resolveDailyMarks({ date: '2026-08-27', tickers: ['ETH'] }, {
    now: () => new Date('2026-08-28T00:00:00.000Z'),
    fetchDailyCloses: async () => invalidRows,
  });
  assert.deepEqual(marks, []);
});
