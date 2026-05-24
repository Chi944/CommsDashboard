const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

export function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.abs(n) < 1 ? round4(n) : round2(n);
}

/**
 * @param {{ ticker: string, symbol?: string, name: string, category: string, unit?: string }} meta
 * @param {number} price
 * @param {number} changePct
 * @param {{ source: string, stale?: boolean }} extra
 */
export function toCommodityRow(meta, price, changePct, extra = {}) {
  const p = fmtPrice(price);
  const prev = changePct != null && Number.isFinite(changePct)
    ? price / (1 + changePct / 100)
    : price;
  const changeAbs = p != null && prev != null ? fmtPrice(price - prev) : 0;
  return {
    ticker: meta.ticker,
    symbol: meta.symbol ?? meta.ticker,
    name: meta.name,
    category: meta.category,
    unit: meta.unit ?? '$',
    price: p,
    high: p,
    low: p,
    changePct: changePct != null ? round2(changePct) : 0,
    changeAbs: changeAbs ?? 0,
    history: [],
    source: extra.source,
    stale: extra.stale ?? false,
  };
}

/** Alpha Vantage commodity time series → spot + % change */
export function fromAvSeries(ticker, meta, json) {
  if (json?.Note || json?.Information) {
    return { error: 'rate_limited', message: json.Note || json.Information };
  }
  const rows = json?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'empty', message: 'no data' };
  }
  const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const last = Number(sorted[0]?.value);
  const prev = Number(sorted[1]?.value ?? last);
  if (!Number.isFinite(last)) return { error: 'invalid', message: 'bad value' };
  const changePct = prev ? ((last - prev) / prev) * 100 : 0;
  return {
    row: toCommodityRow(
      { ticker, ...meta },
      last,
      changePct,
      { source: 'alphavantage' },
    ),
  };
}

/** CoinGecko simple/price entry */
export function fromCoinGecko(ticker, meta, usd, changePct24h) {
  if (usd == null || !Number.isFinite(usd)) return { error: 'invalid' };
  return {
    row: toCommodityRow(
      { ticker, ...meta },
      usd,
      changePct24h ?? 0,
      { source: 'coingecko' },
    ),
  };
}

/** EIA v2 response → spot + % change */
export function fromEiaRows(ticker, meta, data) {
  const rows = data?.response?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'empty', message: 'no eia data' };
  }
  const sorted = [...rows].sort((a, b) => String(b.period).localeCompare(String(a.period)));
  const last = Number(sorted[0]?.value);
  const prev = Number(sorted[1]?.value ?? last);
  if (!Number.isFinite(last)) return { error: 'invalid' };
  const changePct = prev ? ((last - prev) / prev) * 100 : 0;
  return {
    row: toCommodityRow(
      { ticker, ...meta },
      last,
      changePct,
      { source: 'eia' },
    ),
  };
}
