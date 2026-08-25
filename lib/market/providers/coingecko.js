import { SYMBOLS } from '../../symbols.js';
import { COINGECKO_IDS } from '../symbolMaps.js';
import { fromCoinGecko } from '../normalize.js';
import { fetchWithTimeout } from '../fetch.js';

const BASE = 'https://api.coingecko.com/api/v3';
const providerFailureCode = (error) => (
  error?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'request_failed'
);

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

  let r;
  try {
    r = await fetchWithTimeout(url, { headers: headers() });
  } catch (error) {
    return { rows: [], errors: [`coingecko ${providerFailureCode(error)}`] };
  }
  if (!r.ok) {
    return { rows: [], errors: [`coingecko ${r.status}`] };
  }

  let j;
  try {
    j = await r.json();
  } catch {
    return { rows: [], errors: ['coingecko invalid_response'] };
  }
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
      entry.last_updated_at,
    );
    if (out.row) rows.push(out.row);
    else errors.push(`coingecko ${ticker}: ${out.error}`);
  }

  return { rows, errors };
}
