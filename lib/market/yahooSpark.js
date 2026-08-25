import { fetchWithTimeout, upstreamError } from './fetch.js';

const YAHOO_SPARK_URL = 'https://query1.finance.yahoo.com/v7/finance/spark';

// Yahoo returns HTTP 400 when a spark request contains more than 20 symbols.
export const YAHOO_SPARK_BATCH_SIZE = 20;
export const MAX_DAILY_QUOTE_AGE_MS = 4 * 24 * 60 * 60 * 1000;

const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10000) / 10000;

function displayPrice(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.abs(value) < 1 ? round4(value) : round2(value);
}

function batchesOf(rows, size) {
  const batches = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
}

/** Fetch all Yahoo symbols with bounded multi-symbol spark requests. */
export async function fetchYahooSparkBatches(symbols, {
  fetchImpl = globalThis.fetch,
  batchSize = YAHOO_SPARK_BATCH_SIZE,
} = {}) {
  const batches = batchesOf(symbols, batchSize);
  const settled = await Promise.all(batches.map(async (batch) => {
    const url = new URL(YAHOO_SPARK_URL);
    url.searchParams.set('symbols', batch.join(','));
    url.searchParams.set('range', '5d');
    url.searchParams.set('interval', '1d');

    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)',
          Accept: 'application/json',
        },
      }, fetchImpl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json?.spark?.error) throw new Error(String(json.spark.error.description || json.spark.error));
      return { batch, results: json?.spark?.result || [] };
    } catch (error) {
      return {
        batch,
        results: [],
        error: upstreamError(error),
      };
    }
  }));

  const bySymbol = new Map();
  const errors = [];
  for (const result of settled) {
    if (result.error) {
      errors.push(`Yahoo batch (${result.batch.length} symbols): ${result.error}`);
      continue;
    }
    for (const entry of result.results) {
      const symbol = String(entry?.symbol || '').toUpperCase();
      const response = entry?.response?.[0];
      if (symbol && response) bySymbol.set(symbol, response);
    }
  }

  return { bySymbol, errors, requestCount: batches.length };
}

/** Convert one Yahoo daily spark response into the dashboard row contract. */
export function yahooSparkRow(symbol, result, fetchedAt = new Date().toISOString()) {
  const meta = result?.meta || {};
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];

  const points = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    if (closes[index] == null || timestamps[index] == null) continue;
    const close = Number(closes[index]);
    const timestamp = Number(timestamps[index]);
    if (!Number.isFinite(close) || !Number.isFinite(timestamp)) continue;
    points.push({
      index,
      timestamp,
      date: new Date(timestamp * 1000).toISOString().slice(5, 10),
      price: displayPrice(close),
      rawPrice: close,
    });
  }
  if (points.length === 0) throw new Error(`${symbol.yahoo} no daily closes`);

  const compactPoints = points.slice(-7);
  const lastPoint = points.at(-1);
  const previousPoint = points.at(-2);
  const last = lastPoint.rawPrice;
  const previous = previousPoint?.rawPrice;
  const hasDailyComparison = Number.isFinite(previous);
  const changeAbs = hasDailyComparison ? last - previous : null;
  const changePct = hasDailyComparison && previous !== 0 ? (changeAbs / previous) * 100 : null;

  const quoteTimestamp = Number(meta.regularMarketTime);
  const asOfSeconds = Number.isFinite(quoteTimestamp) ? quoteTimestamp : lastPoint.timestamp;
  const asOf = new Date(asOfSeconds * 1000).toISOString();
  const fetchedMs = new Date(fetchedAt).getTime();
  const stale = !Number.isFinite(fetchedMs)
    || fetchedMs - asOfSeconds * 1000 > MAX_DAILY_QUOTE_AGE_MS;
  const lastIndex = lastPoint.index;
  const todayHigh = Number.isFinite(Number(meta.regularMarketDayHigh))
    ? Number(meta.regularMarketDayHigh)
    : Number(highs[lastIndex]);
  const todayLow = Number.isFinite(Number(meta.regularMarketDayLow))
    ? Number(meta.regularMarketDayLow)
    : Number(lows[lastIndex]);

  return {
    ticker: symbol.ticker,
    symbol: symbol.symbol,
    name: symbol.name,
    category: symbol.category,
    unit: symbol.unit,
    price: displayPrice(last),
    high: displayPrice(Number.isFinite(todayHigh) ? todayHigh : last),
    low: displayPrice(Number.isFinite(todayLow) ? todayLow : last),
    open: Number.isFinite(Number(meta.regularMarketOpen)) ? displayPrice(Number(meta.regularMarketOpen)) : null,
    prevClose: hasDailyComparison ? displayPrice(previous) : null,
    changeAbs: hasDailyComparison ? round4(changeAbs) : null,
    changePct: changePct == null ? null : round2(changePct),
    volume: meta.regularMarketVolume ?? null,
    fiftyTwoWeekHigh: Number.isFinite(Number(meta.fiftyTwoWeekHigh)) ? displayPrice(Number(meta.fiftyTwoWeekHigh)) : null,
    fiftyTwoWeekLow: Number.isFinite(Number(meta.fiftyTwoWeekLow)) ? displayPrice(Number(meta.fiftyTwoWeekLow)) : null,
    currency: meta.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    history: compactPoints.map((point, index) => ({
      day: `D-${compactPoints.length - 1 - index}`,
      date: point.date,
      price: point.price,
    })),
    source: 'yahoo',
    asOf,
    stale,
  };
}
