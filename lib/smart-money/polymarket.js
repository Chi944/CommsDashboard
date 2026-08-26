import { ProviderError } from './errors.js';
import { fetchProviderJson } from './http.js';
import { assertAdapterRights } from './rights.js';

const POLYMARKET_BASE = 'https://data-api.polymarket.com';
const POLYMARKET_ENDPOINTS = Object.freeze({
  leaderboard: '/v1/leaderboard',
  positions: '/positions',
  closedPositions: '/closed-positions',
});
const POLYMARKET_ORIGIN = 'https://data-api.polymarket.com';
const MAX_LEADERBOARD_PAGE_SIZE = 50;
const MAX_LEADERBOARD_OFFSET = 1_000;
const MAX_LEADERBOARD_PAGES = (MAX_LEADERBOARD_OFFSET / MAX_LEADERBOARD_PAGE_SIZE) + 1;
const MAX_ACCOUNT_PAGE_SIZE = 500;
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUIRED_PURPOSES = Object.freeze(['fetch', 'cache', 'history', 'display', 'ranking', 'attribute']);

function isWallet(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizedWallet(value) {
  if (!isWallet(value)) throw new Error('invalid_wallet');
  return value.toLowerCase();
}

function finiteNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegativeNumber(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveInteger(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value, fallback, maximum) {
  const candidate = Number.isInteger(value) && value >= 0 ? value : fallback;
  return Math.min(candidate, maximum);
}

function pageSize(value, fallback, maximum) {
  const candidate = Number.isInteger(value) && value > 0 ? value : fallback;
  return Math.min(candidate, maximum);
}

function isoTimestamp(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function abbreviatedWallet(wallet) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function hasCurrentRights() {
  try {
    assertAdapterRights([{
      id: 'polymarket-data-api', rightsId: 'polymarket-data-api', requiredPurposes: REQUIRED_PURPOSES,
    }]);
    return true;
  } catch {
    return false;
  }
}

function linkOnly(providerId, key = 'records') {
  return { providerId, [key]: [], linkOnly: true };
}

function transportOptions(providerId, requestOptions = {}) {
  return {
    providerId,
    allowedOrigins: [POLYMARKET_ORIGIN],
    maxBytes: MAX_RESPONSE_BYTES,
    maxRetries: 1,
    requestOptions,
  };
}

function requestUrl(path, params) {
  const url = new URL(path, POLYMARKET_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

export function buildPolymarketLeaderboardRequest(input = {}) {
  const period = input.period === 'ALL' ? 'ALL' : input.period === 'MONTH' ? 'MONTH' : null;
  if (!period) throw new Error('invalid_leaderboard_period');
  return {
    url: requestUrl(POLYMARKET_ENDPOINTS.leaderboard, {
      category: 'CRYPTO', timePeriod: period, orderBy: 'PNL',
      limit: pageSize(input.limit, MAX_LEADERBOARD_PAGE_SIZE, MAX_LEADERBOARD_PAGE_SIZE),
      offset: nonNegativeInteger(input.offset, 0, MAX_LEADERBOARD_OFFSET),
    }),
    options: transportOptions('polymarket-leaderboard', { method: 'GET' }),
  };
}

export function planPolymarketLeaderboardPages(input = {}) {
  const pages = Math.min(nonNegativeInteger(input.pages, 1, MAX_LEADERBOARD_PAGES), MAX_LEADERBOARD_PAGES);
  return Array.from({ length: pages }, (_, page) => buildPolymarketLeaderboardRequest({
    ...input, offset: page * MAX_LEADERBOARD_PAGE_SIZE,
  }));
}

function buildPolymarketAccountRequest(path, providerId, address, input = {}) {
  const wallet = normalizedWallet(address);
  return {
    url: requestUrl(path, {
      user: wallet,
      limit: pageSize(input.limit, MAX_ACCOUNT_PAGE_SIZE, MAX_ACCOUNT_PAGE_SIZE),
      offset: nonNegativeInteger(input.offset, 0, 10_000),
    }),
    options: transportOptions(providerId, { method: 'GET' }),
  };
}

export function buildPolymarketPositionsRequest(address, input = {}) {
  return buildPolymarketAccountRequest(POLYMARKET_ENDPOINTS.positions, 'polymarket-positions', address, input);
}

export function buildPolymarketClosedPositionsRequest(address, input = {}) {
  return buildPolymarketAccountRequest(POLYMARKET_ENDPOINTS.closedPositions, 'polymarket-closed-positions', address, input);
}

export function normalizePolymarketLeaderboard(rows, context = {}) {
  const window = context.window === 'allTime' || context.window === 'ALL' ? 'allTime' : context.window === 'month' || context.window === 'MONTH' ? 'month' : null;
  const retrievedAt = isoTimestamp(context.retrievedAt);
  if (!window || !retrievedAt || !Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!isWallet(row?.proxyWallet)) return [];
    const pnlUsd = finiteNumber(row.pnl);
    const volumeUsd = nonnegativeNumber(row.vol);
    const rank = positiveInteger(row.rank);
    if (pnlUsd === null || volumeUsd === null || rank === null) return [];
    const wallet = row.proxyWallet.toLowerCase();
    const publicName = row.displayUsernamePublic === true && typeof row.userName === 'string' && row.userName.trim();
    return [{
      id: `polymarket:${wallet}:${window}:${retrievedAt.slice(0, 10)}`,
      entityId: `polymarket:${wallet}`,
      providerId: 'polymarket-leaderboard',
      venue: 'polymarket',
      scope: 'account',
      wallet,
      displayName: publicName || abbreviatedWallet(wallet),
      rank,
      accountValueUsd: null,
      windows: { day: null, month: null, allTime: null, [window]: { pnlUsd, roiPct: null, volumeUsd } },
      methodology: 'provider_reported',
      sourceAsOf: isoTimestamp(row.sourceAsOf),
      retrievedAt,
      freshnessBasis: 'retrieval_time',
      notComparableAcrossProviders: true,
    }];
  });
}

export function joinPolymarketWindows(month, allTime, context = {}) {
  const retrievedAt = isoTimestamp(context.retrievedAt) || null;
  const byWallet = new Map();
  const add = (rows, window) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const isObject = Boolean(row && typeof row === 'object');
      const normalized = isObject && row.providerId === 'polymarket-leaderboard'
        && row?.venue === 'polymarket'
        && row?.scope === 'account'
        && isWallet(row?.wallet)
        && row?.windows && typeof row.windows === 'object';
      const raw = isObject && !Object.hasOwn(row, 'providerId')
        && !Object.hasOwn(row, 'venue')
        && !Object.hasOwn(row, 'wallet')
        && !Object.hasOwn(row, 'windows')
        && isWallet(row.proxyWallet)
        && Object.hasOwn(row, 'pnl')
        && Object.hasOwn(row, 'vol')
        && Object.hasOwn(row, 'rank');
      if (!normalized && !raw) continue;
      const address = normalized ? row.wallet : row.proxyWallet;
      const sourceWindow = normalized ? row.windows[window] : null;
      const pnlUsd = finiteNumber(sourceWindow?.pnlUsd ?? row.pnl);
      const volumeUsd = nonnegativeNumber(sourceWindow?.volumeUsd ?? row.vol);
      const rank = positiveInteger(row.rank);
      if (pnlUsd === null || volumeUsd === null || rank === null) continue;
      const wallet = address.toLowerCase();
      const existing = byWallet.get(wallet) || {
        entityId: `polymarket:${wallet}`, providerId: 'polymarket-leaderboard', venue: 'polymarket', scope: 'account',
        wallet, displayName: row.displayName || (row.displayUsernamePublic === true && typeof row.userName === 'string' && row.userName.trim() ? row.userName.trim() : abbreviatedWallet(wallet)),
        rank: null, accountValueUsd: null, windows: { day: null, month: null, allTime: null }, methodology: 'provider_reported',
        sourceAsOf: isoTimestamp(row.sourceAsOf), retrievedAt, freshnessBasis: 'retrieval_time', notComparableAcrossProviders: true,
      };
      existing.rank = rank;
      existing.windows[window] = { pnlUsd, roiPct: null, volumeUsd };
      byWallet.set(wallet, existing);
    }
  };
  add(month, 'month');
  add(allTime, 'allTime');
  return [...byWallet.values()].map((row) => ({
    ...row,
    id: `polymarket:${row.wallet}:combined:${retrievedAt?.slice(0, 10) || 'unknown'}`,
  }));
}

async function fetchJson(request, deps) {
  const getJson = deps.fetchProviderJson || fetchProviderJson;
  const payload = await getJson(request.url, request.options);
  if (!Array.isArray(payload)) throw new ProviderError('schema_invalid', request.options.providerId);
  return payload;
}

export async function fetchPolymarketLeaderboard(input = {}, deps = {}) {
  if (!hasCurrentRights()) return linkOnly('polymarket-leaderboard');
  const period = input.period || 'MONTH';
  const rows = [];
  for (const request of planPolymarketLeaderboardPages({ ...input, period })) {
    rows.push(...await fetchJson(request, deps));
  }
  return { providerId: 'polymarket-leaderboard', records: normalizePolymarketLeaderboard(rows, { window: period, retrievedAt: new Date().toISOString() }), linkOnly: false };
}

export async function fetchPolymarketPositions(address, deps = {}) {
  if (!hasCurrentRights()) return linkOnly('polymarket-positions');
  return { providerId: 'polymarket-positions', records: await fetchJson(buildPolymarketPositionsRequest(address), deps), linkOnly: false };
}

export async function fetchPolymarketClosedPositions(address, deps = {}) {
  if (!hasCurrentRights()) return linkOnly('polymarket-closed-positions');
  return { providerId: 'polymarket-closed-positions', records: await fetchJson(buildPolymarketClosedPositionsRequest(address), deps), linkOnly: false };
}

export async function fetchPolymarketSnapshot(config = {}, deps = {}) {
  if (!hasCurrentRights()) return {
    providerId: 'polymarket-leaderboard', performances: [], positions: [], closedPositions: [], linkOnly: true,
  };
  const month = await fetchPolymarketLeaderboard({ ...config, period: 'MONTH' }, deps);
  const allTime = await fetchPolymarketLeaderboard({ ...config, period: 'ALL' }, deps);
  const performances = joinPolymarketWindows(month.records, allTime.records, { retrievedAt: new Date().toISOString() });
  return { providerId: 'polymarket-leaderboard', performances, positions: [], closedPositions: [], linkOnly: false };
}
