import {
  ASSET_CLASSES,
  TRUSTED_REFERENCE_PRICE_SOURCES,
  assertSafeArray,
  assertSafePlainDataRecord,
  assertSafePlainRecord,
  schemaInvalid,
  validateSignal,
} from './contracts.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z0-9.^-]{1,32}$/;
const ACCEPTED_PRICE_STATUSES = new Set(['ok', 'live', 'closed']);

function canonicalDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw schemaInvalid();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw schemaInvalid();
  }
  return value;
}

function canonicalTicker(value) {
  if (typeof value !== 'string') throw schemaInvalid();
  const ticker = value.toUpperCase();
  if (ticker !== value || !TICKER_PATTERN.test(ticker)) throw schemaInvalid();
  return ticker;
}

function canonicalInstant(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return parsed.toISOString();
}

function retrievedAtFrom(deps) {
  const candidate = typeof deps.retrievedAt === 'function'
    ? deps.retrievedAt()
    : deps.retrievedAt;
  const value = candidate ?? new Date().toISOString();
  const canonical = canonicalInstant(value instanceof Date ? value.toISOString() : value);
  if (!canonical) throw schemaInvalid();
  return canonical;
}

function priceRows(payload) {
  if (Array.isArray(payload)) {
    assertSafeArray(payload);
    return { rows: payload, payloadSource: null, healthy: true };
  }
  try {
    assertSafePlainDataRecord(payload);
    const rows = payload.commodities;
    assertSafeArray(rows);
    return {
      rows,
      payloadSource: payload.source ?? null,
      healthy: payload.ok === true
        && TRUSTED_REFERENCE_PRICE_SOURCES.includes(payload.source),
    };
  } catch {
    return { rows: [], payloadSource: null, healthy: false };
  }
}

function normalizeQuote(row, { ticker, observedAt, batchRetrievedAt, payloadSource }) {
  try {
    assertSafePlainDataRecord(row);
  } catch {
    return null;
  }
  const rowTicker = typeof row.ticker === 'string' ? row.ticker.toUpperCase() : null;
  const source = row.source ?? payloadSource;
  const currency = (row.currency ?? 'USD')?.toUpperCase?.();
  const price = row.price;
  const asOf = canonicalInstant(row.asOf);
  const retrievedAt = canonicalInstant(row.retrievedAt ?? batchRetrievedAt);
  if (rowTicker !== ticker || typeof price !== 'number' || !Number.isFinite(price) || price <= 0
      || currency !== 'USD' || !TRUSTED_REFERENCE_PRICE_SOURCES.includes(source)
      || row.stale === true || (row.status != null && !ACCEPTED_PRICE_STATUSES.has(row.status))
      || !asOf || !retrievedAt || Date.parse(asOf) < Date.parse(observedAt)
      || Date.parse(retrievedAt) < Date.parse(asOf)
      || Date.parse(retrievedAt) > Date.parse(batchRetrievedAt)) return null;
  return { ticker, price, currency: 'USD', source, asOf, retrievedAt };
}

export async function resolveReferencePrice(signal, deps = {}) {
  if (!deps || typeof deps !== 'object') throw schemaInvalid();
  const batchRetrievedAt = retrievedAtFrom(deps);
  const normalizedSignal = validateSignal(signal, { now: new Date(batchRetrievedAt) });
  if (!normalizedSignal.asset.supported || normalizedSignal.asset.ticker === null) {
    return { skipped: true, reason: 'unsupported_asset' };
  }
  if (typeof deps.fetchPrices !== 'function') {
    return { skipped: true, reason: 'missing_reference_price' };
  }
  let payload;
  try {
    payload = await deps.fetchPrices({
      tickers: [normalizedSignal.asset.ticker],
      observedAt: normalizedSignal.observedAt,
    });
  } catch {
    return { skipped: true, reason: 'missing_reference_price' };
  }
  const { rows, payloadSource, healthy } = priceRows(payload);
  if (!healthy) return { skipped: true, reason: 'missing_reference_price' };
  const candidates = rows
    .map((row) => normalizeQuote(row, {
      ticker: normalizedSignal.asset.ticker,
      observedAt: normalizedSignal.observedAt,
      batchRetrievedAt,
      payloadSource,
    }))
    .filter(Boolean)
    .sort((left, right) => (
      Date.parse(left.asOf) - Date.parse(right.asOf)
      || Date.parse(left.retrievedAt) - Date.parse(right.retrievedAt)
      || left.source.localeCompare(right.source)
      || left.price - right.price
    ));
  return candidates[0] ?? { skipped: true, reason: 'missing_reference_price' };
}

function normalizeCompletedClose(row, { date, ticker, nowIso }) {
  try {
    assertSafePlainDataRecord(row);
  } catch {
    return null;
  }
  const rowTicker = typeof row.ticker === 'string' ? row.ticker.toUpperCase() : null;
  const currency = row.currency?.toUpperCase?.();
  const asOf = canonicalInstant(row.asOf);
  const retrievedAt = canonicalInstant(row.retrievedAt);
  const assetClass = row.assetClass;
  if (rowTicker !== ticker || row.date !== date || row.status !== 'closed'
      || typeof row.close !== 'number' || !Number.isFinite(row.close) || row.close <= 0
      || currency !== 'USD' || !TRUSTED_REFERENCE_PRICE_SOURCES.includes(row.source)
      || !ASSET_CLASSES.includes(assetClass) || !asOf || !retrievedAt
      || asOf.slice(0, 10) !== date || Date.parse(retrievedAt) < Date.parse(asOf)
      || Date.parse(retrievedAt) > Date.parse(nowIso)
      || (ticker === 'SPX' && assetClass !== 'equity')
      || (ticker === 'BTC' && assetClass !== 'crypto')) return null;
  return {
    id: `${date}:${ticker}`,
    date,
    ticker,
    assetClass,
    kind: ticker === 'SPX' || ticker === 'BTC' ? 'benchmark' : 'asset',
    price: row.close,
    currency: 'USD',
    source: row.source,
    asOf,
    retrievedAt,
  };
}

export async function resolveDailyMarks(input, deps = {}) {
  assertSafePlainRecord(input, ['date', 'tickers']);
  assertSafeArray(input.tickers);
  const date = canonicalDate(input.date);
  const nowValue = typeof deps.now === 'function' ? deps.now() : new Date();
  const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw schemaInvalid();
  const nowIso = now.toISOString();
  const completedDate = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1,
  )).toISOString().slice(0, 10);
  if (date !== completedDate) throw schemaInvalid();
  const tickers = [...new Set([
    ...input.tickers.map(canonicalTicker),
    'SPX',
    'BTC',
  ])].sort();
  if (typeof deps.fetchDailyCloses !== 'function') throw schemaInvalid();
  let rows;
  try {
    rows = await deps.fetchDailyCloses({ date, tickers: [...tickers] });
    assertSafeArray(rows);
  } catch (error) {
    if (error?.code === 'schema_invalid') throw error;
    return [];
  }
  const byTicker = new Map();
  for (const ticker of tickers) {
    const candidates = rows
      .map((row) => normalizeCompletedClose(row, { date, ticker, nowIso }))
      .filter(Boolean)
      .sort((left, right) => (
        Date.parse(right.asOf) - Date.parse(left.asOf)
        || Date.parse(left.retrievedAt) - Date.parse(right.retrievedAt)
        || left.source.localeCompare(right.source)
      ));
    if (candidates[0]) byTicker.set(ticker, candidates[0]);
  }
  return [...byTicker.values()].sort((left, right) => left.ticker.localeCompare(right.ticker));
}
