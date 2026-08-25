const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
// Daily provider periods skip weekends; EIA publishes its daily spot observations weekly.
const OBSERVATION_POLICIES = Object.freeze({
  coingecko: { maxAgeMs: 15 * 60 * 1000, maxFutureSkewMs: 5 * 60 * 1000 },
  alphavantage: { maxAgeMs: 96 * 60 * 60 * 1000, maxFutureSkewMs: 5 * 60 * 1000 },
  eia: { maxAgeMs: 12 * 24 * 60 * 60 * 1000, maxFutureSkewMs: 5 * 60 * 1000 },
});

function providerPeriodAsOf(period) {
  if (typeof period !== 'string' || !period.trim()) return null;
  const value = period.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return date.toISOString();
  }
  const observedAtMs = Date.parse(value);
  return Number.isFinite(observedAtMs) ? new Date(observedAtMs).toISOString() : null;
}

export function observationFreshness(source, asOf, nowMs = Date.now()) {
  const policy = OBSERVATION_POLICIES[source];
  const observedAtMs = typeof asOf === 'string' ? Date.parse(asOf) : Number.NaN;
  const observationAgeMs = Number(nowMs) - observedAtMs;
  const stale = !policy
    || !Number.isFinite(observedAtMs)
    || !Number.isFinite(observationAgeMs)
    || observationAgeMs > policy.maxAgeMs
    || observationAgeMs < -policy.maxFutureSkewMs;
  return { stale };
}

export function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.abs(n) < 1 ? round4(n) : round2(n);
}

/**
 * @param {{ ticker: string, symbol?: string, name: string, category: string, unit?: string }} meta
 * @param {number} price
 * @param {number} changePct
 * @param {{ source: string, stale?: boolean, asOf?: string | null }} extra
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
    asOf: extra.asOf ?? null,
    stale: extra.stale ?? false,
  };
}

/** Alpha Vantage commodity time series → spot + % change */
export function fromAvSeries(ticker, meta, json, nowMs = Date.now()) {
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
  const asOf = providerPeriodAsOf(sorted[0]?.date);
  const { stale } = observationFreshness('alphavantage', asOf, nowMs);
  return {
    row: toCommodityRow(
      { ticker, ...meta },
      last,
      changePct,
      { source: 'alphavantage', asOf, stale },
    ),
  };
}

/** CoinGecko simple/price entry. `lastUpdatedAtSeconds` is provider observation time. */
export function fromCoinGecko(
  ticker,
  meta,
  usd,
  changePct24h,
  lastUpdatedAtSeconds,
  nowMs = Date.now(),
) {
  if (usd == null || !Number.isFinite(usd)) return { error: 'invalid' };
  const observedAtMs = Number(lastUpdatedAtSeconds) * 1000;
  const observedDate = new Date(observedAtMs);
  const hasObservationTime = Number.isFinite(observedAtMs)
    && observedAtMs > 0
    && Number.isFinite(observedDate.getTime());
  const asOf = hasObservationTime ? observedDate.toISOString() : null;
  const { stale } = observationFreshness('coingecko', asOf, nowMs);
  return {
    row: toCommodityRow(
      { ticker, ...meta },
      usd,
      changePct24h ?? 0,
      { source: 'coingecko', asOf, stale },
    ),
  };
}

/** EIA v2 response → spot + % change */
export function fromEiaRows(ticker, meta, data, nowMs = Date.now()) {
  const rows = data?.response?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: 'empty', message: 'no eia data' };
  }
  const sorted = [...rows].sort((a, b) => String(b.period).localeCompare(String(a.period)));
  const last = Number(sorted[0]?.value);
  const prev = Number(sorted[1]?.value ?? last);
  if (!Number.isFinite(last)) return { error: 'invalid' };
  const changePct = prev ? ((last - prev) / prev) * 100 : 0;
  const asOf = providerPeriodAsOf(sorted[0]?.period);
  const { stale } = observationFreshness('eia', asOf, nowMs);
  return {
    row: toCommodityRow(
      { ticker, ...meta },
      last,
      changePct,
      { source: 'eia', asOf, stale },
    ),
  };
}
