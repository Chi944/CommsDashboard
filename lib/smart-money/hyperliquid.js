import { ProviderError } from './errors.js';
import { fetchProviderJson } from './http.js';
import { assertAdapterRights } from './rights.js';

const HYPERLIQUID_STATS_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const HYPERLIQUID_STATS_ORIGIN = 'https://stats-data.hyperliquid.xyz';
const HYPERLIQUID_INFO_ORIGIN = 'https://api.hyperliquid.xyz';
const ALLOWED_INFO_TYPES = new Set(['portfolio', 'clearinghouseState', 'userFillsByTime']);
const MAX_LEADERBOARD_BYTES = 50 * 1024 * 1024;
const MAX_CANDIDATES = 10;
const MAX_DETAIL_CONCURRENCY = 4;
const INFO_WEIGHT = Object.freeze({ portfolio: 20, clearinghouseState: 2, userFillsByTime: 20 });
const HYPERLIQUID_WEIGHT_BUDGET = 1_200;
const REQUIRED_PURPOSES = Object.freeze(['fetch', 'cache', 'history', 'display', 'ranking', 'attribute']);

function isWallet(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizedWallet(value) {
  if (!isWallet(value)) throw new Error('invalid_wallet');
  return value.toLowerCase();
}

function finiteNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoTimestamp(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function hasCurrentRights(rightsIds) {
  try {
    assertAdapterRights(rightsIds.map((rightsId) => ({ id: rightsId, rightsId, requiredPurposes: REQUIRED_PURPOSES })));
    return true;
  } catch {
    return false;
  }
}

function linkOnly(providerId, key = 'records') {
  return { providerId, [key]: [], linkOnly: true };
}

function infoTransportOptions() {
  return {
    providerId: 'hyperliquid-info-api', allowedOrigins: [HYPERLIQUID_INFO_ORIGIN], maxBytes: 1_000_000, maxRetries: 1,
  };
}

export function validateHyperliquidInfoType(type) {
  if (!ALLOWED_INFO_TYPES.has(type)) throw new Error('read_only_info_type');
  return type;
}

export function buildHyperliquidLeaderboardRequest() {
  return {
    url: HYPERLIQUID_STATS_URL,
    options: {
      providerId: 'hyperliquid-stats-api', allowedOrigins: [HYPERLIQUID_STATS_ORIGIN], maxBytes: MAX_LEADERBOARD_BYTES, maxRetries: 1,
      requestOptions: { method: 'GET' },
    },
  };
}

export function buildHyperliquidInfoRequest(type, address, range = {}) {
  validateHyperliquidInfoType(type);
  const wallet = normalizedWallet(address);
  const body = { type, user: wallet };
  if (type === 'userFillsByTime') {
    if (!Number.isSafeInteger(range.startTime) || range.startTime < 0
        || (range.endTime != null && (!Number.isSafeInteger(range.endTime) || range.endTime < range.startTime))) {
      throw new Error('invalid_fill_range');
    }
    body.startTime = range.startTime;
    if (range.endTime != null) body.endTime = range.endTime;
  }
  return {
    url: HYPERLIQUID_INFO_URL,
    options: {
      ...infoTransportOptions(),
      requestOptions: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    },
  };
}

export function normalizeHyperliquidLeaderboard(rows, context = {}) {
  const window = context.window === 'allTime' || context.window === 'ALL' ? 'allTime' : context.window === 'month' || context.window === 'MONTH' ? 'month' : null;
  const retrievedAt = isoTimestamp(context.retrievedAt);
  if (!window || !retrievedAt || !Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const address = row?.address ?? row?.ethAddress ?? row?.user;
    if (!isWallet(address)) return [];
    const pnlUsd = finiteNumber(row.pnl);
    const roiPct = finiteNumber(row.roi);
    const volumeUsd = finiteNumber(row.volume ?? row.vol);
    const accountValueUsd = finiteNumber(row.accountValue);
    const rank = finiteNumber(row.rank);
    if ([pnlUsd, roiPct, volumeUsd, accountValueUsd, rank].some((value) => value === null)) return [];
    const wallet = address.toLowerCase();
    return [{
      id: `hyperliquid:${wallet}:${window}:${retrievedAt.slice(0, 10)}`,
      entityId: `hyperliquid:${wallet}`, providerId: 'hyperliquid-leaderboard', venue: 'hyperliquid', scope: 'account', wallet,
      displayName: typeof row.userName === 'string' && row.userName.trim() ? row.userName.trim() : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
      rank, accountValueUsd,
      windows: { day: null, month: null, allTime: null, [window]: { pnlUsd, roiPct, volumeUsd } },
      methodology: 'provider_reported', sourceAsOf: isoTimestamp(row.sourceAsOf), retrievedAt,
      freshnessBasis: 'retrieval_time', notComparableAcrossProviders: true,
    }];
  });
}

export function planHyperliquidProtectedRefresh(rows) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => isWallet(row?.address ?? row?.ethAddress ?? row?.user))
    .filter((row) => [row.accountValue, row.pnl, row.volume ?? row.vol].every((value) => finiteNumber(value) !== null))
    .slice(0, MAX_CANDIDATES);
  const detailRequests = candidates.flatMap((row) => {
    const address = (row.address ?? row.ethAddress ?? row.user).toLowerCase();
    return [
      buildHyperliquidInfoRequest('clearinghouseState', address),
      buildHyperliquidInfoRequest('portfolio', address),
    ];
  });
  const weightedRequests = 1 + candidates.length * (INFO_WEIGHT.clearinghouseState + INFO_WEIGHT.portfolio);
  if (weightedRequests >= HYPERLIQUID_WEIGHT_BUDGET) throw new ProviderError('configuration_missing', 'hyperliquid-stats-api');
  return { candidates, detailRequests, concurrency: MAX_DETAIL_CONCURRENCY, weightedRequests };
}

async function getJson(request, deps) {
  return (deps.fetchProviderJson || fetchProviderJson)(request.url, request.options);
}

export async function fetchHyperliquidLeaderboard(deps = {}) {
  if (!hasCurrentRights(['hyperliquid-stats-api'])) return linkOnly('hyperliquid-leaderboard');
  // The stats response is intentionally maintenance-only: request handlers must
  // consume a persisted snapshot, never create a live leaderboard fan-out.
  if (deps.refreshContext !== 'protected') return {
    providerId: 'hyperliquid-leaderboard', records: [], maintenanceOnly: true, linkOnly: false,
  };
  const payload = await getJson(buildHyperliquidLeaderboardRequest(), deps);
  if (!Array.isArray(payload)) throw new ProviderError('schema_invalid', 'hyperliquid-stats-api');
  return { providerId: 'hyperliquid-leaderboard', records: normalizeHyperliquidLeaderboard(payload, { window: 'month', retrievedAt: new Date().toISOString() }), linkOnly: false };
}

async function fetchInfo(type, address, range, deps) {
  if (!hasCurrentRights(['hyperliquid-info-api'])) return linkOnly('hyperliquid-info-api');
  return { providerId: 'hyperliquid-info-api', records: await getJson(buildHyperliquidInfoRequest(type, address, range), deps), linkOnly: false };
}

export async function fetchHyperliquidAccountState(address, deps = {}) {
  return fetchInfo('clearinghouseState', address, undefined, deps);
}

export async function fetchHyperliquidPortfolio(address, deps = {}) {
  return fetchInfo('portfolio', address, undefined, deps);
}

export async function fetchHyperliquidRecentFills(address, range, deps = {}) {
  return fetchInfo('userFillsByTime', address, range, deps);
}

export async function fetchHyperliquidSnapshot(config = {}, deps = {}) {
  if (!hasCurrentRights(['hyperliquid-stats-api', 'hyperliquid-info-api'])) return {
    providerId: 'hyperliquid-leaderboard', performances: [], accounts: [], portfolios: [], fills: [], linkOnly: true,
  };
  const leaderboard = await fetchHyperliquidLeaderboard({ ...deps, refreshContext: 'protected' });
  const plan = planHyperliquidProtectedRefresh(leaderboard.records);
  const accounts = [];
  const portfolios = [];
  for (let index = 0; index < plan.candidates.length; index += plan.concurrency) {
    const batch = plan.candidates.slice(index, index + plan.concurrency);
    const results = await Promise.all(batch.flatMap((candidate) => [
      fetchHyperliquidAccountState(candidate.address ?? candidate.wallet, deps),
      fetchHyperliquidPortfolio(candidate.address ?? candidate.wallet, deps),
    ]));
    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 2) {
      accounts.push(results[resultIndex]);
      portfolios.push(results[resultIndex + 1]);
    }
  }
  return { providerId: 'hyperliquid-leaderboard', performances: leaderboard.records, accounts, portfolios, fills: [], linkOnly: false };
}
