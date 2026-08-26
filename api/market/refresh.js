// GET /api/market/refresh — cron / manual AV + EIA cache warm.
// Requires Authorization: Bearer <CRON_SECRET>.

import { fetchAlphaVantageCommodities } from '../../lib/market/providers/alphavantage.js';
import { fetchEiaEnergy } from '../../lib/market/providers/eia.js';
import { readProviderCache, writeProviderCache } from '../../lib/market/store.js';
import { AV_TICKERS, EIA_TICKERS } from '../../lib/market/symbolMaps.js';
import { refreshSmartMoney as refreshSmartMoneyService } from '../../lib/smart-money/refresh.js';

function supportedProviderRows(payload, supportedTickers) {
  const allowed = new Set(supportedTickers);
  return {
    ...(payload || {}),
    rows: (payload?.rows || []).filter((row) => allowed.has(row.ticker)),
  };
}

export function keepLastKnownGood(current, previous, provider) {
  const currentRows = current.rows || [];
  const previousRows = previous?.rows || [];
  if (!previousRows.length) return current;
  if (!currentRows.length) {
    return {
      rows: previousRows,
      fetchedAt: previous.fetchedAt,
      errors: [
        ...(current.errors || []),
        `${provider}: empty refresh; kept last-known-good rows`,
      ],
    };
  }
  if (!current.errors?.length) return current;

  const currentTickers = new Set(currentRows.map((row) => row.ticker));
  const retainedRows = previousRows
    .filter((row) => !currentTickers.has(row.ticker))
    .map((row) => ({ ...row, stale: true }));
  if (!retainedRows.length) return current;

  return {
    ...current,
    rows: [...currentRows, ...retainedRows],
    errors: [
      ...current.errors,
      `${provider}: partial refresh; kept ${retainedRows.length} last-known-good rows`,
    ],
  };
}

function authorize(req, secret) {
  if (!secret) return false;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${secret}`;
}

function durableWriteState(writeResult) {
  const normalize = (source) => {
    const result = writeResult?.[`${source}Write`];
    const configured = Boolean(result?.configured);
    const ok = configured && Boolean(result?.ok);
    return {
      configured,
      ok,
      error: configured && !ok ? `${source}_write_failed` : null,
    };
  };
  const blobWrite = normalize('blob');
  const redisWrite = normalize('redis');
  const successfulWrites = [blobWrite, redisWrite].filter((write) => write.ok).length;
  const configuredFailures = [blobWrite, redisWrite]
    .filter((write) => write.configured && !write.ok).length;
  const durable = successfulWrites > 0;
  return {
    blobWrite,
    redisWrite,
    durable,
    degraded: !durable || configuredFailures > 0,
    configuredWrites: [blobWrite, redisWrite].filter((write) => write.configured).length,
    successfulWrites,
  };
}

export async function refreshMarketProviders(dependencies = {}) {
  const fetchAv = dependencies.fetchAlphaVantageCommodities
    || fetchAlphaVantageCommodities;
  const fetchEia = dependencies.fetchEiaEnergy || fetchEiaEnergy;
  const readCache = dependencies.readProviderCache || readProviderCache;
  const writeCache = dependencies.writeProviderCache || writeProviderCache;
  const now = dependencies.now || (() => new Date());

  // This generation timestamp is captured before any upstream work so a
  // slower, older invocation cannot outrank a later-started refresh.
  const refreshStartedAt = now().toISOString();
  const prev = await readCache();
  const av = await fetchAv();
  const eia = await fetchEia();
  const nextAv = keepLastKnownGood(
    supportedProviderRows(av, AV_TICKERS),
    supportedProviderRows(prev?.alphavantage, AV_TICKERS),
    'alphavantage',
  );
  const nextEia = keepLastKnownGood(
    supportedProviderRows(eia, EIA_TICKERS),
    supportedProviderRows(prev?.eia, EIA_TICKERS),
    'eia',
  );
  const refreshedAt = now().toISOString();

  const payload = {
    alphavantage: {
      rows: nextAv.rows,
      fetchedAt: nextAv.fetchedAt,
      errors: nextAv.errors,
    },
    eia: {
      rows: nextEia.rows,
      fetchedAt: nextEia.fetchedAt,
      errors: nextEia.errors,
    },
    refreshStartedAt,
    refreshedAt,
    previousRefresh: prev?.refreshedAt ?? null,
  };

  const writeResult = await writeCache(payload);
  const persistence = durableWriteState(writeResult);
  const providerDegraded = Boolean(nextAv.errors?.length || nextEia.errors?.length);
  const partial = persistence.degraded || providerDegraded;
  return {
    ok: persistence.durable && !partial,
    partial,
    persisted: persistence.durable,
    errorCode: persistence.durable ? null : 'market_persistence_unavailable',
    payload,
    persistence,
  };
}

function boundedErrorCode(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_]{0,63}$/.test(value)
    ? value
    : null;
}

function boundedOutcome(settled, failureCode) {
  if (settled.status !== 'fulfilled' || settled.value === null
      || typeof settled.value !== 'object' || Array.isArray(settled.value)) {
    return { ok: false, persisted: false, partial: true, errorCode: failureCode };
  }
  const persisted = settled.value.persisted === true;
  const ok = persisted && settled.value.partial === false;
  return {
    ok,
    persisted,
    partial: !ok,
    errorCode: ok ? null : boundedErrorCode(settled.value.errorCode) ?? failureCode,
  };
}

async function runCombinedRefresh(refreshMarket, refreshSmartMoney) {
  const [marketResult, smartMoneyResult] = await Promise.allSettled([
    Promise.resolve().then(() => refreshMarket()),
    Promise.resolve().then(() => refreshSmartMoney({ trigger: 'cron' })),
  ]);
  const market = boundedOutcome(marketResult, 'market_refresh_failed');
  const smartMoney = boundedOutcome(smartMoneyResult, 'smart_money_refresh_failed');
  return {
    ok: market.ok && smartMoney.ok,
    partial: !(market.ok && smartMoney.ok),
    market,
    smartMoney,
  };
}

function sendLegacyMarketResponse(res, result) {
  const { payload, persistence } = result;
  res.status(persistence.durable ? 200 : 503).json({
    ok: result.ok,
    partial: result.partial,
    persisted: result.persisted,
    degradedPersistence: persistence.degraded,
    ...payload,
    redis: persistence.redisWrite.configured,
    kv: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    blob: persistence.blobWrite.configured,
    blobWrite: persistence.blobWrite,
    redisWrite: persistence.redisWrite,
    persistence: {
      durable: persistence.durable,
      degraded: persistence.degraded,
      configuredWrites: persistence.configuredWrites,
      successfulWrites: persistence.successfulWrites,
    },
    error: persistence.durable ? undefined : 'provider cache persistence unavailable',
  });
}

export function createRefreshHandler(dependencies = {}) {
  const refreshMarket = dependencies.refreshMarket
    || (() => refreshMarketProviders(dependencies));
  const refreshSmartMoney = dependencies.refreshSmartMoney || refreshSmartMoneyService;

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method not allowed' });
      return;
    }

    const cronSecret = dependencies.cronSecret ?? process.env.CRON_SECRET;
    if (!authorize(req, cronSecret)) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET') {
      const result = await runCombinedRefresh(refreshMarket, refreshSmartMoney);
      res.status(result.ok ? 200 : 503).json(result);
      return;
    }

    try {
      sendLegacyMarketResponse(res, await refreshMarketProviders(dependencies));
    } catch {
      res.status(500).json({ ok: false, error: 'market refresh failed' });
    }
  };
}

export default createRefreshHandler();
