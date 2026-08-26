import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HYPERLIQUID_MIN_ACCOUNT_VALUE_USD,
  HYPERLIQUID_MIN_VOLUME_30D_USD,
  MAX_ABS_ROI_PCT,
  POLYMARKET_MIN_ALL_TIME_PNL_USD,
  POLYMARKET_MIN_VOLUME_30D_USD,
  qualifyCryptoAccount,
  rankCryptoAccounts,
  rankInvestors,
} from '../lib/smart-money/rank.js';

function account(overrides = {}) {
  return {
    id: 'hyperliquid:a:combined:2026-08-26', entityId: 'hyperliquid:a',
    providerId: 'hyperliquid-leaderboard', venue: 'hyperliquid', scope: 'account',
    accountValueUsd: 1_500_000,
    windows: {
      day: null,
      month: { pnlUsd: 20_000, roiPct: 4, volumeUsd: 6_000_000 },
      allTime: { pnlUsd: 100_000, roiPct: 20, volumeUsd: 20_000_000 },
    },
    methodology: 'provider_reported', sourceAsOf: null,
    retrievedAt: '2026-08-26T11:00:00.000Z', freshnessBasis: 'retrieval_time',
    notComparableAcrossProviders: true, freshness: 'fresh', sourceUrl: 'https://hyperliquid.xyz/a',
    ...overrides,
  };
}

test('crypto qualification uses exact v1 threshold edges', () => {
  assert.equal(HYPERLIQUID_MIN_ACCOUNT_VALUE_USD, 1_000_000);
  assert.equal(HYPERLIQUID_MIN_VOLUME_30D_USD, 5_000_000);
  assert.equal(POLYMARKET_MIN_ALL_TIME_PNL_USD, 100_000);
  assert.equal(POLYMARKET_MIN_VOLUME_30D_USD, 250_000);
  assert.equal(MAX_ABS_ROI_PCT, 1_000);
  assert.equal(qualifyCryptoAccount(account({
    accountValueUsd: 1_000_000,
    windows: { day: null, month: { pnlUsd: 1, roiPct: 1_000, volumeUsd: 5_000_000 }, allTime: { pnlUsd: 1, roiPct: 1, volumeUsd: 1 } },
  })).eligible, true);
  assert.equal(qualifyCryptoAccount(account({ accountValueUsd: 999_999 })).eligible, false);
  assert.equal(qualifyCryptoAccount(account({ windows: { ...account().windows, month: { ...account().windows.month, volumeUsd: 4_999_999 } } })).eligible, false);
  assert.equal(qualifyCryptoAccount(account({ windows: { ...account().windows, month: { ...account().windows.month, roiPct: 1_000.001 } } })).eligible, false);
});

test('Polymarket qualification is crypto-category and provider scoped', () => {
  const polymarket = account({
    id: 'polymarket:a:combined:2026-08-26', entityId: 'polymarket:a',
    providerId: 'polymarket-leaderboard', venue: 'polymarket', accountValueUsd: null, category: 'crypto',
    windows: {
      day: null,
      month: { pnlUsd: 1, roiPct: null, volumeUsd: 250_000 },
      allTime: { pnlUsd: 100_000, roiPct: null, volumeUsd: 1_000_000 },
    },
  });
  assert.equal(qualifyCryptoAccount(polymarket).eligible, true);
  assert.equal(qualifyCryptoAccount({ ...polymarket, category: 'politics' }).eligible, false);
  assert.equal(qualifyCryptoAccount({ ...polymarket, freshness: 'stale' }).eligible, false);
});

test('rankings keep venues separate and use deterministic entity ID tie breaks', () => {
  const a = account({ id: 'hyperliquid:b', entityId: 'hyperliquid:b' });
  const b = account({ id: 'hyperliquid:a', entityId: 'hyperliquid:a' });
  const poly = account({ id: 'polymarket:z', entityId: 'polymarket:z', providerId: 'polymarket-leaderboard', venue: 'polymarket' });
  assert.deepEqual(rankCryptoAccounts([a, poly, b], { venue: 'hyperliquid', window: 'month' }).map((row) => row.entityId), ['hyperliquid:a', 'hyperliquid:b']);
  assert.deepEqual(rankCryptoAccounts([a, poly, b], { venue: 'polymarket', window: 'month' }).map((row) => row.entityId), ['polymarket:z']);
  assert.deepEqual(rankCryptoAccounts([a, { ...a }], { venue: 'hyperliquid', window: 'month' }), []);
});

test('investor base order uses evidence and freshness but ignores followed state', () => {
  const entities = [
    { id: 'b', evidenceCoverage: ['one'], followed: false },
    { id: 'a', evidenceCoverage: ['one'], followed: true },
    { id: 'c', evidenceCoverage: ['one', 'two'], followed: false },
  ];
  const activities = [
    { id: '1', entityId: 'a', freshness: 'fresh', observedAt: '2026-08-26T10:00:00.000Z' },
    { id: '2', entityId: 'b', freshness: 'fresh', observedAt: '2026-08-26T10:00:00.000Z' },
  ];
  const first = rankInvestors(entities, activities);
  const second = rankInvestors(entities.map((entity) => ({ ...entity, followed: !entity.followed })), activities);
  assert.deepEqual(first.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(second.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(entities.map((row) => row.id), ['b', 'a', 'c']);
});
