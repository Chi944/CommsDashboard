import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildPolymarketClosedPositionsRequest,
  buildPolymarketLeaderboardRequest,
  buildPolymarketPositionsRequest,
  fetchPolymarketClosedPositions,
  fetchPolymarketLeaderboard,
  fetchPolymarketPositions,
  fetchPolymarketSnapshot,
  joinPolymarketWindows,
  normalizePolymarketLeaderboard,
  planPolymarketLeaderboardPages,
} from '../lib/smart-money/polymarket.js';

const FIXTURES = new URL('./fixtures/smart-money/polymarket/', import.meta.url);
const MONTH = JSON.parse(fs.readFileSync(new URL('leaderboard-month.json', FIXTURES), 'utf8'));
const ALL_TIME = JSON.parse(fs.readFileSync(new URL('leaderboard-all.json', FIXTURES), 'utf8'));
const WALLET = '0x0000000000000000000000000000000000000abc';

test('Polymarket joins MONTH and ALL by wallet without crossing providers', () => {
  const rows = joinPolymarketWindows(MONTH, ALL_TIME);
  assert.equal(rows[0].windows.month.pnlUsd, 50000);
  assert.equal(rows[0].windows.allTime.pnlUsd, 200000);
  assert.equal(rows[0].providerId, 'polymarket-leaderboard');
  assert.equal(rows[0].entityId, `polymarket:${WALLET}`);
  const normalizedMonth = normalizePolymarketLeaderboard(MONTH, { window: 'month', retrievedAt: '2026-08-26T00:00:00Z' });
  const normalizedAll = normalizePolymarketLeaderboard(ALL_TIME, { window: 'allTime', retrievedAt: '2026-08-26T00:00:00Z' });
  const joinedNormalizedRows = joinPolymarketWindows(normalizedMonth, normalizedAll, { retrievedAt: '2026-08-26T00:00:00Z' });
  assert.equal(joinedNormalizedRows[0].windows.allTime.pnlUsd, 200000);
  assert.deepEqual(joinPolymarketWindows([{
    ...normalizedMonth[0], providerId: 'hyperliquid-leaderboard', venue: 'hyperliquid',
  }], []), []);
  assert.deepEqual(joinPolymarketWindows([{
    proxyWallet: WALLET, pnl: 1, vol: 1, rank: 1, providerId: 'other-provider',
  }], []), []);
});

test('Polymarket hides a username that is not public and rejects malformed records', () => {
  const rows = normalizePolymarketLeaderboard([{
    proxyWallet: WALLET,
    userName: 'Private Name',
    displayUsernamePublic: false,
    pnl: 100000,
    vol: 300000,
    rank: 1,
  }, { proxyWallet: 'not-a-wallet', pnl: 1, vol: 1, rank: 2 }], {
    window: 'month', retrievedAt: '2026-08-26T00:00:00Z',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].displayName, '0x0000…0abc');
  assert.equal(rows[0].sourceAsOf, null);
  assert.equal(normalizePolymarketLeaderboard([
    { proxyWallet: WALLET, pnl: null, vol: 1, rank: 1 },
    { proxyWallet: WALLET, pnl: 1, vol: -1, rank: 1 },
    { proxyWallet: WALLET, pnl: 1, vol: 1, rank: 1.5 },
  ], { window: 'month', retrievedAt: '2026-08-26T00:00:00Z' }).length, 0);
});

test('Polymarket request descriptors stay on the documented GET paths and cap pagination', () => {
  const leaderboard = buildPolymarketLeaderboardRequest({ period: 'MONTH', offset: 5000, limit: 500 });
  assert.equal(leaderboard.url, 'https://data-api.polymarket.com/v1/leaderboard?category=CRYPTO&timePeriod=MONTH&orderBy=PNL&limit=50&offset=1000');
  assert.deepEqual(leaderboard.options.requestOptions, { method: 'GET' });
  assert.equal(leaderboard.options.maxBytes, 1_000_000);
  assert.equal(buildPolymarketPositionsRequest(WALLET).url, `https://data-api.polymarket.com/positions?user=${WALLET}&limit=500&offset=0`);
  assert.equal(buildPolymarketClosedPositionsRequest(WALLET).url, `https://data-api.polymarket.com/closed-positions?user=${WALLET}&limit=500&offset=0`);
  assert.throws(() => buildPolymarketPositionsRequest('bad'), /invalid_wallet/);
  const pages = planPolymarketLeaderboardPages({ period: 'ALL', pages: 999 });
  assert.equal(pages.length, 21);
  assert.equal(new URL(pages.at(-1).url).searchParams.get('offset'), '1000');
});

test('Polymarket production fetch entries are rights-gated before every transport call', async () => {
  let requests = 0;
  const deps = { fetchProviderJson: async () => { requests += 1; return MONTH; } };
  const results = await Promise.all([
    fetchPolymarketLeaderboard({ period: 'MONTH' }, deps),
    fetchPolymarketPositions(WALLET, deps),
    fetchPolymarketClosedPositions(WALLET, deps),
    fetchPolymarketSnapshot({}, deps),
  ]);
  assert.deepEqual(results, [
    { providerId: 'polymarket-leaderboard', records: [], linkOnly: true },
    { providerId: 'polymarket-positions', records: [], linkOnly: true },
    { providerId: 'polymarket-closed-positions', records: [], linkOnly: true },
    { providerId: 'polymarket-leaderboard', performances: [], positions: [], closedPositions: [], linkOnly: true },
  ]);
  assert.equal(requests, 0);
});
