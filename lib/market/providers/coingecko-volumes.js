import { COINGECKO_IDS } from '../symbolMaps.js';

const BASE = 'https://api.coingecko.com/api/v3';

function headers() {
  const h = { Accept: 'application/json' };
  const key = process.env.COINGECKO_API_KEY;
  if (key) h['x-cg-demo-api-key'] = key;
  return h;
}

const idToTicker = Object.fromEntries(
  Object.entries(COINGECKO_IDS).map(([ticker, id]) => [id, ticker]),
);

/**
 * 24h USD volume for dashboard "Most Active" (crypto leg).
 * @returns {Promise<{ volumes: Record<string, number>, errors: string[] }>}
 */
export async function fetchCoinGeckoVolumes() {
  const url = new URL(`${BASE}/coins/markets`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('order', 'volume_desc');
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', '1');
  url.searchParams.set('sparkline', 'false');

  const r = await fetch(url, { headers: headers() });
  if (!r.ok) {
    return { volumes: {}, errors: [`coingecko markets ${r.status}`] };
  }

  const list = await r.json();
  const volumes = {};
  const errors = [];

  if (!Array.isArray(list)) {
    return { volumes: {}, errors: ['coingecko markets invalid'] };
  }

  for (const row of list) {
    const ticker = idToTicker[row.id];
    if (!ticker) continue;
    const vol = row.total_volume;
    if (typeof vol === 'number' && vol > 0) volumes[ticker] = vol;
  }

  for (const ticker of Object.keys(COINGECKO_IDS)) {
    if (!volumes[ticker]) errors.push(`coingecko volume missing ${ticker}`);
  }

  return { volumes, errors };
}
