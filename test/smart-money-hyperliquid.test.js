import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildHyperliquidInfoRequest,
  buildHyperliquidLeaderboardRequest,
  fetchHyperliquidAccountState,
  fetchHyperliquidLeaderboard,
  fetchHyperliquidPortfolio,
  fetchHyperliquidRecentFills,
  fetchHyperliquidSnapshot,
  normalizeHyperliquidLeaderboard,
  planHyperliquidProtectedRefresh,
  validateHyperliquidInfoType,
} from '../lib/smart-money/hyperliquid.js';

const FIXTURES = new URL('./fixtures/smart-money/hyperliquid/', import.meta.url);
const LEADERBOARD = JSON.parse(fs.readFileSync(new URL('leaderboard.json', FIXTURES), 'utf8'));
const PORTFOLIO = JSON.parse(fs.readFileSync(new URL('portfolio.json', FIXTURES), 'utf8'));
const WALLET = '0x0000000000000000000000000000000000000def';

test('Hyperliquid normalizes provider-scoped performance windows', () => {
  const rows = normalizeHyperliquidLeaderboard(LEADERBOARD, {
    window: 'month', retrievedAt: '2026-08-26T00:00:00.000Z',
  });
  assert.deepEqual(rows[0].windows.month, { pnlUsd: 20000, roiPct: 4, volumeUsd: 6000000 });
  assert.equal(rows[0].providerId, 'hyperliquid-leaderboard');
  assert.equal(rows[0].notComparableAcrossProviders, true);
  assert.equal(normalizeHyperliquidLeaderboard([{ address: 'bad', pnl: 1 }], {}).length, 0);
});

test('Hyperliquid read adapter rejects trading info types', () => {
  assert.throws(() => validateHyperliquidInfoType('exchange'), /read_only_info_type/);
  assert.doesNotThrow(() => validateHyperliquidInfoType('portfolio'));
});

test('Hyperliquid descriptors use only stats GET and allowlisted Info POST bodies', () => {
  const leaderboard = buildHyperliquidLeaderboardRequest();
  assert.equal(leaderboard.url, 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard');
  assert.deepEqual(leaderboard.options.requestOptions, { method: 'GET' });
  assert.equal(leaderboard.options.maxBytes, 50 * 1024 * 1024);
  const info = buildHyperliquidInfoRequest('userFillsByTime', WALLET, { startTime: 1, endTime: 2 });
  assert.equal(info.url, 'https://api.hyperliquid.xyz/info');
  assert.deepEqual(info.options.requestOptions, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'userFillsByTime', user: WALLET, startTime: 1, endTime: 2 }),
  });
  assert.throws(() => buildHyperliquidInfoRequest('exchange', WALLET), /read_only_info_type/);
  assert.throws(() => buildHyperliquidInfoRequest('portfolio', 'bad'), /invalid_wallet/);
});

test('Hyperliquid protected refresh caps candidates, concurrency, and weighted requests', () => {
  const plan = planHyperliquidProtectedRefresh(Array.from({ length: 20 }, (_, index) => ({
    ...LEADERBOARD[0], address: `0x${index.toString(16).padStart(40, '0')}`,
  })));
  assert.equal(plan.candidates.length, 10);
  assert.equal(plan.concurrency, 4);
  assert.ok(plan.weightedRequests < 1200);
  assert.equal(plan.detailRequests.length, 20);
  assert.equal(PORTFOLIO.accountValueHistory.length, 1);
});

test('Hyperliquid production fetch entries are rights-gated before every transport call', async () => {
  let requests = 0;
  const deps = { fetchProviderJson: async () => { requests += 1; return LEADERBOARD; } };
  const results = await Promise.all([
    fetchHyperliquidLeaderboard(deps),
    fetchHyperliquidAccountState(WALLET, deps),
    fetchHyperliquidPortfolio(WALLET, deps),
    fetchHyperliquidRecentFills(WALLET, { startTime: 1, endTime: 2 }, deps),
    fetchHyperliquidSnapshot({}, deps),
  ]);
  assert.deepEqual(results, [
    { providerId: 'hyperliquid-leaderboard', records: [], linkOnly: true },
    { providerId: 'hyperliquid-info-api', records: [], linkOnly: true },
    { providerId: 'hyperliquid-info-api', records: [], linkOnly: true },
    { providerId: 'hyperliquid-info-api', records: [], linkOnly: true },
    { providerId: 'hyperliquid-leaderboard', performances: [], accounts: [], portfolios: [], fills: [], linkOnly: true },
  ]);
  assert.equal(requests, 0);
});
