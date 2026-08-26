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
const PROTECTED_MAINTENANCE_CAPABILITY = Symbol('hyperliquid-protected-maintenance');

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
    const volumeUsd = nonnegativeNumber(row.volume ?? row.vol);
    const accountValueUsd = nonnegativeNumber(row.accountValue);
    const rank = positiveInteger(row.rank);
    if ([pnlUsd, roiPct, volumeUsd, accountValueUsd, rank].some((value) => value === null)) return [];
    const wallet = address.toLowerCase();
    return [{
      id: `hyperliquid:${wallet}:${window}:${retrievedAt.slice(0, 10)}`,
      entityId: `hyperliquid:${wallet}`, providerId: 'hyperliquid-leaderboard', venue: 'hyperliquid', scope: 'account', wallet,
      displayName: row.displayUsernamePublic === true && typeof row.userName === 'string' && row.userName.trim()
        ? row.userName.trim()
        : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
      rank, accountValueUsd,
      windows: { day: null, month: null, allTime: null, [window]: { pnlUsd, roiPct, volumeUsd } },
      methodology: 'provider_reported', sourceAsOf: isoTimestamp(row.sourceAsOf), retrievedAt,
      freshnessBasis: 'retrieval_time', notComparableAcrossProviders: true,
    }];
  });
}

export function planHyperliquidProtectedRefresh(rows) {
  const candidateFor = (row) => {
    const normalized = row?.providerId === 'hyperliquid-leaderboard'
      && row?.venue === 'hyperliquid'
      && row?.scope === 'account'
      && isWallet(row?.wallet)
      ? {
        wallet: row.wallet.toLowerCase(), accountValueUsd: nonnegativeNumber(row.accountValueUsd), rank: positiveInteger(row.rank),
        pnlUsd: finiteNumber(row.windows?.month?.pnlUsd ?? row.windows?.allTime?.pnlUsd),
        volumeUsd: nonnegativeNumber(row.windows?.month?.volumeUsd ?? row.windows?.allTime?.volumeUsd),
      }
      : row && typeof row === 'object'
        && !Object.hasOwn(row, 'providerId')
        && !Object.hasOwn(row, 'venue')
        && !Object.hasOwn(row, 'wallet')
        && !Object.hasOwn(row, 'windows')
        ? (() => {
        const address = row?.address ?? row?.ethAddress ?? row?.user;
        if (!isWallet(address)) return null;
        return {
          wallet: address.toLowerCase(), accountValueUsd: nonnegativeNumber(row.accountValue), rank: positiveInteger(row.rank),
          pnlUsd: finiteNumber(row.pnl), volumeUsd: nonnegativeNumber(row.volume ?? row.vol),
        };
      })()
        : null;
    return normalized && Object.values(normalized).every((value) => value !== null) ? normalized : null;
  };
  const byWallet = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidate = candidateFor(row);
    if (candidate && !byWallet.has(candidate.wallet)) byWallet.set(candidate.wallet, candidate);
  }
  const candidates = [...byWallet.values()].slice(0, MAX_CANDIDATES);
  const detailRequests = candidates.flatMap((row) => {
    return [
      { ...buildHyperliquidInfoRequest('clearinghouseState', row.wallet), wallet: row.wallet, type: 'clearinghouseState' },
      { ...buildHyperliquidInfoRequest('portfolio', row.wallet), wallet: row.wallet, type: 'portfolio' },
    ];
  });
  const weightedRequests = 1 + candidates.length * (INFO_WEIGHT.clearinghouseState + INFO_WEIGHT.portfolio);
  if (weightedRequests >= HYPERLIQUID_WEIGHT_BUDGET) throw new ProviderError('configuration_missing', 'hyperliquid-stats-api');
  return { candidates, detailRequests, concurrency: MAX_DETAIL_CONCURRENCY, weightedRequests };
}

async function getJson(request, deps) {
  return (deps.fetchProviderJson || fetchProviderJson)(request.url, request.options);
}

async function executeDetailRequests(detailRequests, runRequest) {
  if (typeof runRequest !== 'function') throw new Error('invalid_detail_runner');
  const results = new Array(detailRequests.length);
  let next = 0;
  async function worker() {
    while (next < detailRequests.length) {
      const index = next;
      next += 1;
      results[index] = await runRequest(detailRequests[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_DETAIL_CONCURRENCY, detailRequests.length) }, worker));
  return results;
}

function assertMaintenanceCapability(capability) {
  if (capability !== PROTECTED_MAINTENANCE_CAPABILITY) throw new ProviderError('configuration_missing', 'hyperliquid-stats-api');
}

async function fetchHyperliquidLeaderboardForMaintenance(deps, capability) {
  assertMaintenanceCapability(capability);
  if (!hasCurrentRights(['hyperliquid-stats-api'])) return linkOnly('hyperliquid-leaderboard');
  const payload = await getJson(buildHyperliquidLeaderboardRequest(), deps);
  if (!Array.isArray(payload)) throw new ProviderError('schema_invalid', 'hyperliquid-stats-api');
  return { providerId: 'hyperliquid-leaderboard', records: normalizeHyperliquidLeaderboard(payload, { window: 'month', retrievedAt: new Date().toISOString() }), linkOnly: false };
}

export async function fetchHyperliquidLeaderboard() {
  if (!hasCurrentRights(['hyperliquid-stats-api'])) return linkOnly('hyperliquid-leaderboard');
  throw new ProviderError('configuration_missing', 'hyperliquid-stats-api');
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
  throw new ProviderError('configuration_missing', 'hyperliquid-stats-api');
}

async function fetchHyperliquidMaintenanceSnapshot(config, deps, capability) {
  assertMaintenanceCapability(capability);
  if (!hasCurrentRights(['hyperliquid-stats-api', 'hyperliquid-info-api'])) return {
    providerId: 'hyperliquid-leaderboard', performances: [], accounts: [], portfolios: [], fills: [], linkOnly: true,
  };
  const leaderboard = await fetchHyperliquidLeaderboardForMaintenance(deps, capability);
  const plan = planHyperliquidProtectedRefresh(leaderboard.records);
  const detailResults = await executeDetailRequests(plan.detailRequests, (request) => getJson(request, deps));
  const accounts = [];
  const portfolios = [];
  for (let index = 0; index < detailResults.length; index += 1) {
    if (plan.detailRequests[index].type === 'clearinghouseState') accounts.push(detailResults[index]);
    else portfolios.push(detailResults[index]);
  }
  return { providerId: 'hyperliquid-leaderboard', performances: leaderboard.records, accounts, portfolios, fills: [], linkOnly: false };
}

export function createHyperliquidProtectedMaintenanceAdapter() {
  return Object.freeze({
    fetchLeaderboard: (deps = {}) => fetchHyperliquidLeaderboardForMaintenance(deps, PROTECTED_MAINTENANCE_CAPABILITY),
    fetchSnapshot: (config = {}, deps = {}) => fetchHyperliquidMaintenanceSnapshot(config, deps, PROTECTED_MAINTENANCE_CAPABILITY),
    plan: planHyperliquidProtectedRefresh,
    executeDetailRequests,
  });
}
