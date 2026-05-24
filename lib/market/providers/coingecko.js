import { SYMBOLS } from '../../symbols.js';
import { COINGECKO_IDS } from '../symbolMaps.js';
import { fromCoinGecko } from '../normalize.js';

const BASE = 'https://api.coingecko.com/api/v3';

function headers() {
  const h = { Accept: 'application/json' };
  const key = process.env.COINGECKO_API_KEY;
  if (key) h['x-cg-demo-api-key'] = key;
  return h;
}

const metaByTicker = Object.fromEntries(
  SYMBOLS.filter((s) => s.category === 'CRYPTO').map((s) => [s.ticker, s]),
);

/**
 * @returns {Promise<{ rows: object[], errors: string[] }>}
 */
export async function fetchCoinGeckoPrices() {
  const ids = Object.values(COINGECKO_IDS).join(',');
  const url = new URL(`${BASE}/simple/price`);
  url.searchParams.set('ids', ids);
  url.searchParams.set('vs_currencies', 'usd');
  url.searchParams.set('include_24hr_change', 'true');
  url.searchParams.set('include_last_updated_at', 'true');

  const r = await fetch(url, { headers: headers() });
  if (!r.ok) {
    return { rows: [], errors: [`coingecko ${r.status}`] };
  }

  const j = await r.json();
  const rows = [];
  const errors = [];

  for (const [ticker, id] of Object.entries(COINGECKO_IDS)) {
    const meta = metaByTicker[ticker];
    if (!meta) continue;
    const entry = j[id];
    if (!entry) {
      errors.push(`coingecko missing ${ticker}`);
      continue;
    }
    const out = fromCoinGecko(
      ticker,
      { symbol: meta.symbol, name: meta.name, category: meta.category, unit: meta.unit },
      entry.usd,
      entry.usd_24h_change,
    );
    if (out.row) rows.push(out.row);
    else errors.push(`coingecko ${ticker}: ${out.error}`);
  }

  return { rows, errors };
}
