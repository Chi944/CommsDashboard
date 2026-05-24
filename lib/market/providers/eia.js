import { SYMBOLS } from '../../symbols.js';
import { EIA_SERIES } from '../symbolMaps.js';
import { fromEiaRows } from '../normalize.js';

const BASE = 'https://api.eia.gov/v2';

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

  const r = await fetch(url);
  if (!r.ok) return { error: `http_${r.status}` };
  return { json: await r.json() };
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

export function eiaRowsFromCache(cache) {
  if (!cache?.eia?.rows?.length) return { rows: [], stale: true };
  const age = Date.now() - new Date(cache.eia.fetchedAt || 0).getTime();
  const stale = age > 60 * 60 * 1000;
  return {
    rows: cache.eia.rows.map((r) => ({ ...r, stale })),
    stale,
  };
}
