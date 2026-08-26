import {
  ASSET_CLASSES,
  TRUSTED_REFERENCE_PRICE_SOURCES,
  assertSafeArray,
  assertSafePlainDataRecord,
  assertSafePlainRecord,
  safeIdentifier,
  schemaInvalid,
  validateSignal,
} from './contracts.js';

const JOURNAL_PREFIX = 'smart-money/v1/journal/';
const JOURNAL_MANIFEST = 'smart-money/v1/journal/manifest.json';
const JOURNAL_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;
const CAS_ATTEMPTS = 8;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z0-9.^-]{1,32}$/;
const HISTORY_FIELDS = [
  'schemaVersion', 'ok', 'fetchedAt', 'partial', 'since', 'through', 'entities', 'signals',
  'dailyMarks', 'nextCursor', 'providerStatuses', 'warnings', 'sourceLinks',
];

function journalError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw schemaInvalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw schemaInvalid();
  }
  return value;
}

function canonicalInstant(value) {
  if (typeof value !== 'string') throw schemaInvalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw schemaInvalid();
  return date.toISOString();
}

function normalizedNow(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw schemaInvalid();
  return date;
}

function cutoffDate(now) {
  return new Date(now.getTime() - JOURNAL_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
}

function partitionPath(date) {
  return `${JOURNAL_PREFIX}${date}.json`;
}

function emptyManifest() {
  return { schemaVersion: 1, partitions: [], signalIds: {}, dailyMarkIds: {} };
}

function emptyPartition(date) {
  return { schemaVersion: 1, date, signals: [], dailyMarks: [] };
}

function normalizeIdIndex(value) {
  assertSafePlainDataRecord(value);
  const result = {};
  for (const [id, date] of Object.entries(value)) {
    result[safeIdentifier(id)] = canonicalDate(date);
  }
  return result;
}

function normalizeManifest(value) {
  if (value == null) return emptyManifest();
  assertSafePlainRecord(value, ['schemaVersion', 'partitions', 'signalIds', 'dailyMarkIds']);
  if (value.schemaVersion !== 1) throw schemaInvalid();
  assertSafeArray(value.partitions);
  const partitions = value.partitions.map(canonicalDate);
  if (new Set(partitions).size !== partitions.length
      || partitions.some((date, index) => index > 0 && partitions[index - 1] >= date)) {
    throw schemaInvalid();
  }
  const signalIds = normalizeIdIndex(value.signalIds);
  const dailyMarkIds = normalizeIdIndex(value.dailyMarkIds);
  const partitionSet = new Set(partitions);
  for (const date of [...Object.values(signalIds), ...Object.values(dailyMarkIds)]) {
    if (!partitionSet.has(date)) throw schemaInvalid();
  }
  for (const id of Object.keys(signalIds)) {
    if (Object.hasOwn(dailyMarkIds, id)) throw schemaInvalid();
  }
  return { schemaVersion: 1, partitions, signalIds, dailyMarkIds };
}

function normalizeDailyMark(value, expectedDate = null, now = null) {
  assertSafePlainRecord(value, [
    'id', 'date', 'ticker', 'assetClass', 'kind', 'price', 'currency', 'source', 'asOf', 'retrievedAt',
  ]);
  const date = canonicalDate(value.date);
  const ticker = typeof value.ticker === 'string' ? value.ticker.toUpperCase() : '';
  const asOf = canonicalInstant(value.asOf);
  const retrievedAt = canonicalInstant(value.retrievedAt);
  if (ticker !== value.ticker || !TICKER_PATTERN.test(ticker)
      || value.id !== `${date}:${ticker}` || (expectedDate !== null && date !== expectedDate)
      || !ASSET_CLASSES.includes(value.assetClass)
      || !['asset', 'benchmark'].includes(value.kind)
      || (value.kind === 'benchmark' && !['SPX', 'BTC'].includes(ticker))
      || (value.kind === 'asset' && ['SPX', 'BTC'].includes(ticker))
      || (ticker === 'SPX' && value.assetClass !== 'equity')
      || (ticker === 'BTC' && value.assetClass !== 'crypto')
      || typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0
      || value.currency !== 'USD' || !TRUSTED_REFERENCE_PRICE_SOURCES.includes(value.source)
      || asOf.slice(0, 10) !== date || Date.parse(retrievedAt) < Date.parse(asOf)
      || (now && (date >= now.toISOString().slice(0, 10)
        || Date.parse(retrievedAt) > now.getTime() + 5 * 60_000))) throw schemaInvalid();
  return {
    id: safeIdentifier(value.id),
    date,
    ticker,
    assetClass: value.assetClass,
    kind: value.kind,
    price: value.price,
    currency: 'USD',
    source: value.source,
    asOf,
    retrievedAt,
  };
}

function normalizePartition(value, date, now) {
  if (value == null) return emptyPartition(date);
  assertSafePlainRecord(value, ['schemaVersion', 'date', 'signals', 'dailyMarks']);
  if (value.schemaVersion !== 1 || value.date !== date) throw schemaInvalid();
  assertSafeArray(value.signals);
  assertSafeArray(value.dailyMarks);
  const signals = value.signals.map((row) => validateSignal(row, { now }));
  const dailyMarks = value.dailyMarks.map((row) => normalizeDailyMark(row, date, now));
  const ids = new Set();
  for (const signal of signals) {
    if (signal.observedAt.slice(0, 10) !== date || ids.has(signal.id)) throw schemaInvalid();
    ids.add(signal.id);
  }
  for (const mark of dailyMarks) {
    if (ids.has(mark.id)) throw schemaInvalid();
    ids.add(mark.id);
  }
  return { schemaVersion: 1, date, signals, dailyMarks };
}

function productionLike() {
  const vercel = String(process.env.VERCEL || '').trim().toLowerCase();
  return process.env.NODE_ENV === 'production'
    || (Boolean(vercel) && vercel !== '0' && vercel !== 'false');
}

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN || null;
}

function blobConfigured() {
  return Boolean(blobToken() || process.env.BLOB_STORE_ID);
}

function blobOptions(options) {
  if (process.env.BLOB_READ_WRITE_TOKEN) return options;
  const token = process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  return token ? { ...options, token } : options;
}

async function blobData(result) {
  if (!result?.stream) return null;
  const value = JSON.parse(await new Response(result.stream).text());
  return value && typeof value === 'object' ? value : null;
}

async function createBlobAdapter() {
  if (!blobConfigured()) return null;
  try {
    const {
      BlobNotFoundError,
      BlobPreconditionFailedError,
      del,
      get,
      put,
    } = await import('@vercel/blob');
    const readOptions = blobOptions({ access: 'private', useCache: false });
    return {
      async read(pathname) {
        try {
          const result = await get(pathname, readOptions);
          return { data: await blobData(result), etag: result?.blob?.etag ?? null };
        } catch (error) {
          if (error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError') {
            return { data: null, etag: null };
          }
          throw error;
        }
      },
      async write(pathname, data, expectedEtag) {
        return put(pathname, JSON.stringify(data), blobOptions({
          access: 'private',
          addRandomSuffix: false,
          contentType: 'application/json',
          ...(expectedEtag ? { ifMatch: expectedEtag } : { allowOverwrite: false }),
        }));
      },
      async delete(pathname) {
        await del(pathname, blobOptions({ access: 'private' }));
        return true;
      },
      isConflict(error) {
        return error instanceof BlobPreconditionFailedError
          || error?.name === 'BlobPreconditionFailedError';
      },
    };
  } catch {
    return null;
  }
}

async function resolveAdapter(options) {
  if (options.adapter) return options.adapter;
  const adapter = await createBlobAdapter();
  if (!adapter && productionLike()) throw journalError('journal_configuration_invalid');
  return adapter;
}

function fixedWriteFailure(kind, date = null) {
  return date === null
    ? { ok: false, error: `${kind}_write_failed` }
    : { date, ok: false, error: `${kind}_write_failed` };
}

async function readRecord(adapter, pathname) {
  try {
    return await adapter.read(pathname);
  } catch {
    throw journalError('journal_read_failed');
  }
}

async function casPartition(adapter, date, additions, now) {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    let current;
    try {
      current = await adapter.read(partitionPath(date));
    } catch {
      return { ...fixedWriteFailure('partition', date), data: null };
    }
    const partition = normalizePartition(current?.data, date, now);
    const signalById = new Map(partition.signals.map((row) => [row.id, row]));
    const markById = new Map(partition.dailyMarks.map((row) => [row.id, row]));
    for (const row of additions.signals) {
      if (markById.has(row.id)) throw schemaInvalid();
      if (!signalById.has(row.id)) signalById.set(row.id, row);
    }
    for (const row of additions.dailyMarks) {
      if (signalById.has(row.id)) throw schemaInvalid();
      if (!markById.has(row.id)) markById.set(row.id, row);
    }
    const next = {
      schemaVersion: 1,
      date,
      signals: [...signalById.values()].sort((left, right) => (
        left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id)
      )),
      dailyMarks: [...markById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    };
    const changed = next.signals.length !== partition.signals.length
      || next.dailyMarks.length !== partition.dailyMarks.length;
    if (!changed && current?.data != null) {
      return { date, ok: true, skipped: true, error: null, data: next };
    }
    try {
      await adapter.write(partitionPath(date), next, current?.etag ?? null);
      const committed = await readRecord(adapter, partitionPath(date));
      return {
        date,
        ok: true,
        skipped: false,
        error: null,
        data: normalizePartition(committed?.data, date, now),
      };
    } catch (error) {
      if (!adapter.isConflict?.(error)) {
        return { ...fixedWriteFailure('partition', date), data: null };
      }
    }
  }
  return { ...fixedWriteFailure('partition', date), data: null };
}

function retainedManifest(manifest, cutoff) {
  const partitions = manifest.partitions.filter((date) => date >= cutoff);
  const retained = new Set(partitions);
  const signalIds = Object.fromEntries(
    Object.entries(manifest.signalIds).filter(([, date]) => retained.has(date)),
  );
  const dailyMarkIds = Object.fromEntries(
    Object.entries(manifest.dailyMarkIds).filter(([, date]) => retained.has(date)),
  );
  return { schemaVersion: 1, partitions, signalIds, dailyMarkIds };
}

function sameManifest(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function casManifest(adapter, additions, cutoff, now, removals = new Set()) {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    let current;
    try {
      current = await adapter.read(JOURNAL_MANIFEST);
    } catch {
      return { ...fixedWriteFailure('manifest'), data: null };
    }
    let next = normalizeManifest(current?.data);
    const partitions = new Set([...next.partitions, ...additions.partitions]);
    for (const date of removals) partitions.delete(date);
    const signalIds = { ...next.signalIds };
    const dailyMarkIds = { ...next.dailyMarkIds };
    for (const [id, date] of Object.entries(additions.signalIds)) {
      if (Object.hasOwn(dailyMarkIds, id)) throw schemaInvalid();
      if (Object.hasOwn(signalIds, id) && signalIds[id] !== date) throw schemaInvalid();
      signalIds[id] = date;
    }
    for (const [id, date] of Object.entries(additions.dailyMarkIds)) {
      if (Object.hasOwn(signalIds, id)) throw schemaInvalid();
      if (Object.hasOwn(dailyMarkIds, id) && dailyMarkIds[id] !== date) throw schemaInvalid();
      dailyMarkIds[id] = date;
    }
    for (const [id, date] of Object.entries(signalIds)) {
      if (removals.has(date)) delete signalIds[id];
    }
    for (const [id, date] of Object.entries(dailyMarkIds)) {
      if (removals.has(date)) delete dailyMarkIds[id];
    }
    next = retainedManifest({
      schemaVersion: 1,
      partitions: [...partitions].sort(),
      signalIds,
      dailyMarkIds,
    }, cutoff);
    if (current?.data != null && sameManifest(normalizeManifest(current.data), next)) {
      return { ok: true, skipped: true, error: null, data: next };
    }
    try {
      await adapter.write(JOURNAL_MANIFEST, next, current?.etag ?? null);
      const committed = await readRecord(adapter, JOURNAL_MANIFEST);
      return { ok: true, skipped: false, error: null, data: normalizeManifest(committed?.data) };
    } catch (error) {
      if (!adapter.isConflict?.(error)) return { ...fixedWriteFailure('manifest'), data: null };
    }
  }
  return { ...fixedWriteFailure('manifest'), data: null };
}

function publicPartitionResult(result) {
  return {
    date: result.date,
    ok: result.ok,
    ...(result.skipped ? { skipped: true } : {}),
    error: result.error,
  };
}

function publicManifestResult(result) {
  return {
    ok: result.ok,
    ...(result.skipped ? { skipped: true } : {}),
    error: result.error,
  };
}

function appendFailure(error, partitions = [], manifest = null) {
  return {
    durableWriteSucceeded: false,
    partitions,
    manifest: manifest ?? { ok: false, error },
    committedSignals: [],
    committedDailyMarks: [],
  };
}

function validateAppendInput(input, now) {
  assertSafePlainRecord(input, ['signals', 'dailyMarks']);
  assertSafeArray(input.signals);
  assertSafeArray(input.dailyMarks);
  const signals = input.signals.map((row) => validateSignal(row, { now }));
  const dailyMarks = input.dailyMarks.map((row) => normalizeDailyMark(row, null, now));
  const ids = new Set();
  for (const row of [...signals, ...dailyMarks]) {
    if (ids.has(row.id)) throw schemaInvalid();
    ids.add(row.id);
  }
  return { signals, dailyMarks };
}

async function rereadRequested(adapter, manifest, signals, dailyMarks, now) {
  const dates = new Set();
  for (const signal of signals) {
    const date = manifest.signalIds[signal.id];
    if (date) dates.add(date);
  }
  for (const mark of dailyMarks) {
    const date = manifest.dailyMarkIds[mark.id];
    if (date) dates.add(date);
  }
  const signalById = new Map();
  const markById = new Map();
  for (const date of [...dates].sort()) {
    const stored = await readRecord(adapter, partitionPath(date));
    const partition = normalizePartition(stored?.data, date, now);
    for (const row of partition.signals) signalById.set(row.id, row);
    for (const row of partition.dailyMarks) markById.set(row.id, row);
  }
  return {
    committedSignals: signals.map((row) => signalById.get(row.id)).filter(Boolean),
    committedDailyMarks: dailyMarks.map((row) => markById.get(row.id)).filter(Boolean),
  };
}

export async function appendJournal(input, options = {}) {
  const now = normalizedNow(options.now ?? new Date());
  const normalized = validateAppendInput(input, now);
  let adapter;
  try {
    adapter = await resolveAdapter(options);
  } catch (error) {
    if (error?.code !== 'journal_configuration_invalid') throw error;
    return appendFailure('journal_configuration_invalid');
  }
  if (!adapter) {
    return appendFailure('journal_configuration_invalid');
  }
  const cutoff = cutoffDate(now);
  let initialManifestRecord;
  try {
    initialManifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
  } catch (error) {
    if (error?.code !== 'journal_read_failed') throw error;
    return appendFailure('journal_read_failed');
  }
  const initialManifest = normalizeManifest(initialManifestRecord?.data);
  const groups = new Map();
  function group(date) {
    if (date < cutoff) throw schemaInvalid();
    if (!groups.has(date)) groups.set(date, { signals: [], dailyMarks: [] });
    return groups.get(date);
  }
  for (const signal of normalized.signals) {
    const date = signal.observedAt.slice(0, 10);
    const existingDate = initialManifest.signalIds[signal.id];
    if (Object.hasOwn(initialManifest.dailyMarkIds, signal.id)
        || (existingDate && existingDate !== date)) throw schemaInvalid();
    if (!existingDate) group(date).signals.push(signal);
  }
  for (const mark of normalized.dailyMarks) {
    const existingDate = initialManifest.dailyMarkIds[mark.id];
    if (Object.hasOwn(initialManifest.signalIds, mark.id)
        || (existingDate && existingDate !== mark.date)) throw schemaInvalid();
    if (!existingDate) group(mark.date).dailyMarks.push(mark);
  }

  const partitionResults = [];
  for (const [date, additions] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    partitionResults.push(await casPartition(adapter, date, additions, now));
  }
  const partitionsOk = partitionResults.every((result) => result.ok);
  const manifestAdditions = { partitions: [], signalIds: {}, dailyMarkIds: {} };
  for (const result of partitionResults) {
    if (!result.ok) continue;
    manifestAdditions.partitions.push(result.date);
    for (const signal of result.data.signals) manifestAdditions.signalIds[signal.id] = result.date;
    for (const mark of result.data.dailyMarks) manifestAdditions.dailyMarkIds[mark.id] = result.date;
  }
  let manifestResult;
  if (partitionsOk) {
    manifestResult = await casManifest(adapter, manifestAdditions, cutoff, now);
  } else {
    manifestResult = { ...fixedWriteFailure('manifest'), data: null };
  }

  let committedSignals = [];
  let committedDailyMarks = [];
  if (manifestResult.ok) {
    try {
      const committedManifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
      const committedManifest = normalizeManifest(committedManifestRecord?.data);
      ({ committedSignals, committedDailyMarks } = await rereadRequested(
        adapter,
        committedManifest,
        normalized.signals,
        normalized.dailyMarks,
        now,
      ));
    } catch (error) {
      if (error?.code !== 'journal_read_failed') throw error;
      return appendFailure(
        'journal_read_failed',
        partitionResults.map(publicPartitionResult),
        publicManifestResult(manifestResult),
      );
    }
  } else {
    const fallbackManifest = {
      ...initialManifest,
      signalIds: { ...initialManifest.signalIds, ...manifestAdditions.signalIds },
      dailyMarkIds: { ...initialManifest.dailyMarkIds, ...manifestAdditions.dailyMarkIds },
    };
    try {
      ({ committedSignals, committedDailyMarks } = await rereadRequested(
        adapter,
        fallbackManifest,
        normalized.signals,
        normalized.dailyMarks,
        now,
      ));
    } catch (error) {
      if (error?.code === 'schema_invalid') throw error;
      committedSignals = [];
      committedDailyMarks = [];
    }
  }
  const allRequestedCommitted = committedSignals.length === normalized.signals.length
    && committedDailyMarks.length === normalized.dailyMarks.length;
  return {
    durableWriteSucceeded: partitionsOk && manifestResult.ok && allRequestedCommitted,
    partitions: partitionResults.map(publicPartitionResult),
    manifest: publicManifestResult(manifestResult),
    committedSignals,
    committedDailyMarks,
  };
}

async function readRetainedJournal(adapter, now) {
  const manifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
  const manifest = retainedManifest(normalizeManifest(manifestRecord?.data), cutoffDate(now));
  const signals = [];
  const dailyMarks = [];
  const seenSignals = new Set();
  const seenMarks = new Set();
  for (const date of manifest.partitions) {
    const record = await readRecord(adapter, partitionPath(date));
    if (!record?.data) throw schemaInvalid();
    const partition = normalizePartition(record.data, date, now);
    for (const signal of partition.signals) {
      if (seenSignals.has(signal.id) || seenMarks.has(signal.id)
          || manifest.signalIds[signal.id] !== date) throw schemaInvalid();
      seenSignals.add(signal.id);
      signals.push(signal);
    }
    for (const mark of partition.dailyMarks) {
      if (seenMarks.has(mark.id) || seenSignals.has(mark.id)
          || manifest.dailyMarkIds[mark.id] !== date) throw schemaInvalid();
      seenMarks.add(mark.id);
      dailyMarks.push(mark);
    }
  }
  if (Object.keys(manifest.signalIds).some((id) => !seenSignals.has(id))
      || Object.keys(manifest.dailyMarkIds).some((id) => !seenMarks.has(id))) throw schemaInvalid();
  return { manifest, signals, dailyMarks };
}

function encodeCursor(signal) {
  return Buffer.from(JSON.stringify({ observedAt: signal.observedAt, id: signal.id }), 'utf8')
    .toString('base64url');
}

function decodeCursor(value, since) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_000
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw schemaInvalid();
  try {
    const decodedText = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decodedText, 'utf8').toString('base64url') !== value) throw schemaInvalid();
    const decoded = JSON.parse(decodedText);
    assertSafePlainRecord(decoded, ['observedAt', 'id']);
    const observedAt = canonicalInstant(decoded.observedAt);
    const id = safeIdentifier(decoded.id);
    if (observedAt < since) throw schemaInvalid();
    return { observedAt, id };
  } catch (error) {
    if (error?.code === 'schema_invalid') throw error;
    throw schemaInvalid();
  }
}

function afterCursor(signal, cursor) {
  return !cursor || signal.observedAt > cursor.observedAt
    || (signal.observedAt === cursor.observedAt && signal.id > cursor.id);
}

export async function readJournal(query, options = {}) {
  assertSafePlainRecord(query, ['since', 'limit', 'cursor'], ['since', 'limit']);
  const now = normalizedNow(options.now ?? new Date());
  const through = now.toISOString();
  const since = canonicalInstant(query.since);
  const sinceMs = Date.parse(since);
  if (sinceMs > now.getTime() || sinceMs < now.getTime() - JOURNAL_RETENTION_DAYS * DAY_MS
      || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) throw schemaInvalid();
  const cursor = decodeCursor(query.cursor, since);
  const adapter = await resolveAdapter(options);
  if (!adapter) throw journalError('journal_configuration_invalid');
  const journal = await readRetainedJournal(adapter, now);
  const eligibleSignals = journal.signals
    .filter((signal) => signal.observedAt >= since && signal.observedAt <= through && afterCursor(signal, cursor))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
  const hasNext = eligibleSignals.length > query.limit;
  const signals = eligibleSignals.slice(0, query.limit);
  const sinceDate = since.slice(0, 10);
  const throughDate = through.slice(0, 10);
  const dailyMarks = journal.dailyMarks
    .filter((mark) => mark.date >= sinceDate && mark.date <= throughDate)
    .sort((left, right) => left.date.localeCompare(right.date) || left.ticker.localeCompare(right.ticker));
  const result = {
    schemaVersion: 1,
    ok: true,
    fetchedAt: through,
    partial: false,
    since,
    through,
    entities: [],
    signals,
    dailyMarks,
    nextCursor: hasNext ? encodeCursor(signals.at(-1)) : null,
    providerStatuses: [],
    warnings: [],
    sourceLinks: [],
  };
  if (Object.keys(result).some((field, index) => HISTORY_FIELDS[index] !== field)) throw schemaInvalid();
  return result;
}

export async function listTrackedTickers(query, options = {}) {
  assertSafePlainRecord(query, ['since']);
  let cursor = null;
  const tickers = new Set();
  do {
    const history = await readJournal({ since: query.since, limit: 500, ...(cursor ? { cursor } : {}) }, options);
    for (const signal of history.signals) {
      if (signal.asset.supported && signal.asset.ticker) tickers.add(signal.asset.ticker);
    }
    for (const mark of history.dailyMarks) {
      if (mark.kind === 'asset') tickers.add(mark.ticker);
    }
    cursor = history.nextCursor;
  } while (cursor);
  return [...tickers].sort();
}

export async function pruneJournal(input, options = {}) {
  assertSafePlainRecord(input, ['now']);
  const now = normalizedNow(input.now);
  const cutoff = cutoffDate(now);
  const adapter = await resolveAdapter(options);
  if (!adapter) {
    return {
      durableWriteSucceeded: false,
      partitions: [],
      manifest: { ok: false, error: 'journal_configuration_invalid' },
    };
  }
  const currentRecord = await readRecord(adapter, JOURNAL_MANIFEST);
  const current = normalizeManifest(currentRecord?.data);
  const expired = current.partitions.filter((date) => date < cutoff);
  const partitionResults = [];
  const removals = new Set();
  for (const date of expired) {
    try {
      const record = await adapter.read(partitionPath(date));
      if (record?.data && typeof adapter.delete !== 'function') throw journalError('partition_delete_failed');
      if (record?.data) await adapter.delete(partitionPath(date), record.etag ?? null);
      removals.add(date);
      partitionResults.push({ date, ok: true, error: null });
    } catch {
      partitionResults.push({ date, ok: false, error: 'partition_delete_failed' });
    }
  }
  const partitionsOk = partitionResults.every((result) => result.ok);
  const manifestResult = partitionsOk
    ? await casManifest(adapter, { partitions: [], signalIds: {}, dailyMarkIds: {} }, cutoff, now, removals)
    : fixedWriteFailure('manifest');
  return {
    durableWriteSucceeded: partitionsOk && manifestResult.ok,
    partitions: partitionResults,
    manifest: publicManifestResult(manifestResult),
  };
}

export const SMART_MONEY_JOURNAL_NAMESPACES = Object.freeze({
  prefix: JOURNAL_PREFIX,
  manifest: JOURNAL_MANIFEST,
  retentionDays: JOURNAL_RETENTION_DAYS,
});
