import assert from 'node:assert/strict';
import test from 'node:test';

import * as marketDisplay from '../src/lib/marketDisplay.js';
import { isV2Commodity } from '../lib/market/symbolMaps.js';

test('fresh complete Yahoo data is LIVE while partial data is DEGRADED', () => {
  const fetchedAt = new Date().toISOString();

  assert.equal(marketDisplay.dataModeFromState({
    useV2: false,
    fetchedAt,
    loading: false,
    hasLiveRows: true,
    partial: false,
    staleRowCount: 0,
    failed: false,
  }), 'LIVE');

  assert.equal(marketDisplay.dataModeFromState({
    useV2: false,
    fetchedAt,
    loading: false,
    hasLiveRows: true,
    partial: true,
    staleRowCount: 0,
    failed: false,
  }), 'DEGRADED');
});

test('missing, old, or wholly stale price data is STALE', () => {
  assert.equal(marketDisplay.dataModeFromState({
    useV2: false,
    fetchedAt: null,
    loading: false,
    hasLiveRows: false,
  }), 'STALE');

  assert.equal(marketDisplay.dataModeFromState({
    useV2: false,
    fetchedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    loading: false,
    hasLiveRows: true,
  }), 'STALE');

  assert.equal(marketDisplay.dataModeFromState({
    useV2: false,
    fetchedAt: new Date().toISOString(),
    loading: false,
    hasLiveRows: true,
    liveRowCount: 2,
    staleRowCount: 2,
  }), 'STALE');
});

test('partial Yahoo results mark fallback rows as mock instead of presenting them as live', () => {
  const fallback = [
    { ticker: 'LIVE', name: 'Live row', category: 'TECH', price: 1, changePct: 999 },
    { ticker: 'MISS', name: 'Missing row', category: 'TECH', price: 2, changePct: 888 },
  ];
  const payload = {
    fetchedAt: '2026-08-25T00:00:00.000Z',
    commodities: [
      { ticker: 'LIVE', price: 10, changePct: 2, source: 'yahoo', asOf: '2026-08-24T23:59:00.000Z', stale: false },
    ],
  };

  const rows = marketDisplay.mergeYahooPriceRows?.(fallback, payload);

  assert.deepEqual(rows, [
    {
      ticker: 'LIVE', name: 'Live row', category: 'TECH', price: 10, changePct: 2,
      source: 'yahoo', asOf: '2026-08-24T23:59:00.000Z', stale: false, isLive: true,
    },
    {
      ticker: 'MISS', name: 'Missing row', category: 'TECH', price: 2, changePct: 888,
      source: 'mock', asOf: null, stale: true, isLive: false,
    },
  ]);
});

test('rankings and alert evaluation can select only fresh authoritative rows', () => {
  const rows = [
    { ticker: 'YHOO', source: 'yahoo', stale: false, isLive: true, changePct: 2 },
    { ticker: 'OLD', source: 'yahoo', stale: true, isLive: true, changePct: 500 },
    { ticker: 'MOCK', source: 'mock', stale: true, isLive: false, changePct: 999 },
    { ticker: 'V2', source: 'coingecko', stale: false, changePct: 3 },
  ];

  const trusted = marketDisplay.trustedMarketRows?.(rows);

  assert.deepEqual(trusted?.map((row) => row.ticker), ['YHOO', 'V2']);
});

test('stale v2 rows do not replace trusted Yahoo prices in ticker, table, or heatmap views', () => {
  const crypto = {
    ticker: 'BTC', category: 'CRYPTO', price: 70_000, changePct: 2,
    source: 'yahoo', stale: false, isLive: true,
  };
  const commodity = {
    ticker: 'NG', category: 'ENERGY', price: 3.2, changePct: 1,
    source: 'yahoo', stale: false, isLive: true,
  };
  const v2ByTicker = {
    BTC: { ticker: 'BTC', price: 60_000, changePct: -10, source: 'coingecko', stale: true },
    NG: { ticker: 'NG', price: 2.8, changePct: -8, source: 'eia', stale: true },
  };

  assert.strictEqual(marketDisplay.resolveTickerAsset(crypto, v2ByTicker, true), crypto);
  assert.strictEqual(marketDisplay.resolveTablePrice(commodity, v2ByTicker, true), commodity);
  assert.strictEqual(marketDisplay.resolveHeatmapAsset(commodity, v2ByTicker, true), commodity);
});

test('V2 overlays update spot fields but preserve Yahoo session change across market views', () => {
  const yahooAsOf = '2026-08-25T11:55:00.000Z';
  const v2AsOf = '2026-08-25T12:00:00.000Z';
  const crypto = {
    ticker: 'BTC', category: 'CRYPTO', price: 70_000, changePct: 2.5, changeAbs: 1_700,
    source: 'yahoo', asOf: yahooAsOf, stale: false, isLive: true,
  };
  const commodity = {
    ticker: 'NG', category: 'ENERGY', price: 3.2, changePct: 1.25, changeAbs: 0.04,
    source: 'yahoo', asOf: yahooAsOf, stale: false, isLive: true,
  };
  const v2ByTicker = {
    BTC: {
      ticker: 'BTC', price: 68_000, changePct: -10, changeAbs: -7_000,
      source: 'coingecko', asOf: v2AsOf, stale: false,
    },
    NG: {
      ticker: 'NG', price: 3.1, changePct: -8, changeAbs: -0.27,
      source: 'eia', asOf: v2AsOf, stale: false,
    },
  };

  const ticker = marketDisplay.resolveTickerAsset(crypto, v2ByTicker, true);
  const table = marketDisplay.resolveTablePrice(commodity, v2ByTicker, true);
  const heatmap = marketDisplay.resolveHeatmapAsset(commodity, v2ByTicker, true);

  assert.deepEqual(
    [ticker.price, ticker.source, ticker.asOf, ticker.changePct, ticker.changeAbs],
    [68_000, 'coingecko', v2AsOf, 2.5, 1_700],
  );
  for (const row of [table, heatmap]) {
    assert.deepEqual(
      [row.price, row.source, row.asOf, row.changePct, row.changeAbs],
      [3.1, 'eia', v2AsOf, 1.25, 0.04],
    );
  }
});

test('retired Alpha Vantage oil and unsupported global-price series leave Yahoo futures authoritative', () => {
  const asOf = '2026-08-25T12:00:00.000Z';
  const assets = [
    { ticker: 'CL', category: 'ENERGY', price: 82 },
    { ticker: 'BZ', category: 'ENERGY', price: 86 },
    { ticker: 'HG', category: 'METALS', price: 4.4 },
    { ticker: 'ZW', category: 'AGRICULTURE', price: 620 },
    { ticker: 'ZC', category: 'AGRICULTURE', price: 440 },
  ].map((asset) => ({
    ...asset,
    changePct: 1,
    changeAbs: 0.1,
    source: 'yahoo',
    asOf,
    stale: false,
    isLive: true,
  }));
  const v2ByTicker = Object.fromEntries(assets.map((asset) => [asset.ticker, {
    ticker: asset.ticker,
    price: asset.price * 2,
    source: 'alphavantage',
    asOf,
    stale: false,
  }]));

  assert.equal(isV2Commodity('CL'), false);
  assert.equal(isV2Commodity('BZ'), false);
  assert.equal(isV2Commodity('NG'), true);

  for (const asset of assets) {
    assert.equal(isV2Commodity(asset.ticker), false);
    assert.strictEqual(marketDisplay.resolveTablePrice(asset, v2ByTicker, true), asset);
    assert.strictEqual(marketDisplay.resolveHeatmapAsset(asset, v2ByTicker, true), asset);
  }
});

test('V2-only overlays remain untrusted and omit session change across market views', () => {
  const fallbackCommodity = {
    ticker: 'NG', category: 'ENERGY', price: 2.75, changePct: 0,
    source: 'mock', asOf: null, stale: true, isLive: false,
  };
  const fallbackCrypto = {
    ticker: 'BTC', category: 'CRYPTO', price: 60_000, changePct: 0,
    source: 'mock', asOf: null, stale: true, isLive: false,
  };
  const freshV2 = {
    NG: {
      ticker: 'NG', price: 3.1, changePct: -2, changeAbs: -0.06,
      source: 'eia', asOf: '2026-08-25T12:00:00.000Z', stale: false,
    },
    BTC: {
      ticker: 'BTC', price: 68_000, changePct: -10, changeAbs: -7_000,
      source: 'coingecko', asOf: '2026-08-25T12:00:00.000Z', stale: false,
    },
  };

  const resolvedRows = [
    marketDisplay.resolveTablePrice(fallbackCommodity, freshV2, true),
    marketDisplay.resolveHeatmapAsset(fallbackCommodity, freshV2, true),
    marketDisplay.resolveTickerAsset(fallbackCrypto, freshV2, true),
  ];
  assert.deepEqual(
    resolvedRows.map((row) => (
      [row.price, row.source, row.asOf, row.changePct, row.changeAbs, row.isLive]
    )),
    [
      [3.1, 'eia', '2026-08-25T12:00:00.000Z', null, null, false],
      [3.1, 'eia', '2026-08-25T12:00:00.000Z', null, null, false],
      [68_000, 'coingecko', '2026-08-25T12:00:00.000Z', null, null, false],
    ],
  );
  assert.ok(resolvedRows.every((row) => !marketDisplay.isTrustedMarketRow(row)));
});

test('missing or invalid V2 observation time never inherits the Yahoo asOf', () => {
  const yahoo = {
    ticker: 'CL', category: 'ENERGY', price: 82, changePct: 1, changeAbs: 0.8,
    source: 'yahoo', asOf: '2026-08-25T11:55:00.000Z', stale: false, isLive: true,
  };
  const missingAsOf = {
    ticker: 'CL', price: 83, changePct: -8, source: 'eia', stale: false,
  };
  const invalidAsOf = { ...missingAsOf, asOf: 'not-a-date' };
  const fallback = {
    ticker: 'CL', category: 'ENERGY', price: 75, changePct: 0,
    source: 'mock', asOf: null, stale: true, isLive: false,
  };

  assert.strictEqual(marketDisplay.overlayV2Fields(yahoo, missingAsOf), yahoo);
  assert.strictEqual(marketDisplay.overlayV2Fields(yahoo, invalidAsOf), yahoo);
  const unresolved = marketDisplay.overlayV2Fields(fallback, missingAsOf);
  assert.deepEqual(
    [unresolved.source, unresolved.asOf, unresolved.changePct, unresolved.stale, unresolved.isLive],
    ['eia', null, null, true, false],
  );
});

test('a parseable V2 timestamp is not trusted without validated freshness', () => {
  const yahoo = {
    ticker: 'CL', category: 'ENERGY', price: 82, changePct: 1, changeAbs: 0.8,
    source: 'yahoo', asOf: '2026-08-25T11:55:00.000Z', stale: false, isLive: true,
  };
  const unvalidatedV2 = {
    ticker: 'CL', price: 83, source: 'eia', asOf: '2026-08-25T12:00:00.000Z',
  };

  assert.strictEqual(marketDisplay.overlayV2Fields(yahoo, unvalidatedV2), yahoo);
});

test('combined provider health cannot report LIVE when either required feed is degraded', () => {
  assert.equal(marketDisplay.combineDataModes?.('LIVE', 'LIVE'), 'LIVE');
  assert.equal(marketDisplay.combineDataModes?.('LIVE', 'DEGRADED'), 'DEGRADED');
  assert.equal(marketDisplay.combineDataModes?.('LIVE', 'DEGRADED', {
    supplementalFallbackCovered: true,
  }), 'LIVE');
  assert.equal(marketDisplay.combineDataModes?.('STALE', 'LIVE'), 'DEGRADED');
  assert.equal(marketDisplay.combineDataModes?.('STALE', 'STALE'), 'STALE');
});

test('market status copy never describes degraded or stale data as fetching or live', () => {
  assert.equal(marketDisplay.dataModeLabel?.('LIVE'), 'live');
  assert.equal(marketDisplay.dataModeLabel?.('DEGRADED'), 'degraded');
  assert.equal(marketDisplay.dataModeLabel?.('STALE'), 'stale');
  assert.equal(marketDisplay.dataModeLabel?.('MOCK'), 'mock');
});
