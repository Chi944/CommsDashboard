import { SYMBOLS } from '../../symbols.js';
import { ALPHA_VANTAGE_COMMODITIES, AV_TICKERS } from '../symbolMaps.js';
import { fromAvSeries, observationFreshness } from '../normalize.js';
import { fetchWithTimeout } from '../fetch.js';

const BASE = 'https://www.alphavantage.co/query';
const PROVIDER_CACHE_TTL_MS = 13 * 60 * 60 * 1000;
const SUPPORTED_AV_TICKERS = new Set(AV_TICKERS);
const providerFailureCode = (error) => (
  error?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'request_failed'
);

const metaByTicker = Object.fromEntries(
  SYMBOLS.map((s) => [s.ticker, s]),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} fn Alpha Vantage commodity function name
 */
async function fetchOne(fn) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return { error: 'missing_key' };

  const url = new URL(BASE);
  url.searchParams.set('function', fn);
  url.searchParams.set('interval', 'daily');
  url.searchParams.set('outputsize', 'compact');
  url.searchParams.set('apikey', key);

  let r;
  try {
    r = await fetchWithTimeout(url);
  } catch (error) {
    return { error: providerFailureCode(error) };
  }
  if (!r.ok) return { error: `http_${r.status}` };
  try {
    return { json: await r.json() };
  } catch {
    return { error: 'invalid_response' };
  }
}

/**
 * Cron-only batch fetch. Respects ~5 req/min with delays.
 * @returns {Promise<{ rows: object[], errors: string[], fetchedAt: string }>}
 */
export async function fetchAlphaVantageCommodities() {
  const rows = [];
  const errors = [];

  for (let i = 0; i < ALPHA_VANTAGE_COMMODITIES.length; i++) {
    const { ticker, fn, unit } = ALPHA_VANTAGE_COMMODITIES[i];
    const meta = metaByTicker[ticker];
    if (!meta) continue;

    if (i > 0) await sleep(13_000);

    const { json, error } = await fetchOne(fn);
    if (error) {
      errors.push(`av ${ticker}: ${error}`);
      continue;
    }

    const out = fromAvSeries(ticker, {
      symbol: meta.symbol,
      name: meta.name,
      category: meta.category,
      unit: unit || meta.unit,
    }, json);

    if (out.row) rows.push(out.row);
    else errors.push(`av ${ticker}: ${out.error || out.message}`);
  }

  return {
    rows,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Read cached AV rows from provider cache (no live AV calls).
 * @param {import('../store.js').readProviderCache extends Function ? Awaited<ReturnType<import('../store.js').readProviderCache>> : any} cache
 */
export function avRowsFromCache(cache, nowMs = Date.now()) {
  const cachedRows = (cache?.alphavantage?.rows || [])
    .filter((row) => SUPPORTED_AV_TICKERS.has(row.ticker));
  if (!cachedRows.length) return { rows: [], stale: true };
  const fetchedAtMs = new Date(cache.alphavantage.fetchedAt || 0).getTime();
  const age = nowMs - fetchedAtMs;
  const cacheStale = !Number.isFinite(fetchedAtMs) || age > PROVIDER_CACHE_TTL_MS;
  const rows = cachedRows.map((r) => ({
    ...r,
    stale: cacheStale
      || Boolean(r.stale)
      || observationFreshness('alphavantage', r.asOf, nowMs).stale,
  }));
  return {
    rows,
    stale: rows.some((row) => row.stale),
  };
}
