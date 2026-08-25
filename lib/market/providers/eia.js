import { SYMBOLS } from '../../symbols.js';
import { EIA_SERIES } from '../symbolMaps.js';
import { fromEiaRows, observationFreshness } from '../normalize.js';
import { fetchWithTimeout } from '../fetch.js';

const BASE = 'https://api.eia.gov/v2';
const PROVIDER_CACHE_TTL_MS = 13 * 60 * 60 * 1000;
const providerFailureCode = (error) => (
  error?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'request_failed'
);

const metaByTicker = Object.fromEntries(
  SYMBOLS.map((s) => [s.ticker, s]),
);

/**
 * @param {{ route: string, facets: Record<string, string[]>, frequency: string }} cfg
 */
async function fetchEiaSeries(cfg) {
  const key = process.env.EIA_API_KEY;
  if (!key) return { error: 'missing_key' };

  const url = new URL(`${BASE}/${cfg.route}`);
  url.searchParams.set('api_key', key);
  url.searchParams.set('frequency', cfg.frequency);
  url.searchParams.set('data[0]', 'value');
  url.searchParams.set('sort[0][column]', 'period');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('length', '2');

  for (const [facet, values] of Object.entries(cfg.facets)) {
    for (const v of values) {
      url.searchParams.append(`facets[${facet}][]`, v);
    }
  }

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
 * @returns {Promise<{ rows: object[], errors: string[], fetchedAt: string }>}
 */
export async function fetchEiaEnergy() {
  const rows = [];
  const errors = [];

  for (const cfg of EIA_SERIES) {
    const meta = metaByTicker[cfg.ticker];
    const { json, error } = await fetchEiaSeries(cfg);
    if (error) {
      errors.push(`eia ${cfg.ticker}: ${error}`);
      continue;
    }

    const out = fromEiaRows(cfg.ticker, {
      symbol: meta?.symbol ?? cfg.ticker,
      name: cfg.name || meta?.name,
      category: meta?.category ?? 'ENERGY',
      unit: cfg.unit || meta?.unit,
    }, json);

    if (out.row) rows.push(out.row);
    else errors.push(`eia ${cfg.ticker}: ${out.error || out.message}`);
  }

  return {
    rows,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}

export function eiaRowsFromCache(cache, nowMs = Date.now()) {
  if (!cache?.eia?.rows?.length) return { rows: [], stale: true };
  const fetchedAtMs = new Date(cache.eia.fetchedAt || 0).getTime();
  const age = nowMs - fetchedAtMs;
  const cacheStale = !Number.isFinite(fetchedAtMs) || age > PROVIDER_CACHE_TTL_MS;
  const rows = cache.eia.rows.map((r) => ({
    ...r,
    stale: cacheStale
      || Boolean(r.stale)
      || observationFreshness('eia', r.asOf, nowMs).stale,
  }));
  return {
    rows,
    stale: rows.some((row) => row.stale),
  };
}
