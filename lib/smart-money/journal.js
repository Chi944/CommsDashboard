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
import { validateSmartMoneyPrivateSnapshot } from './private-snapshot.js';

const JOURNAL_PREFIX = 'smart-money/v1/journal/';
const JOURNAL_MANIFEST = 'smart-money/v1/journal/manifest.json';
const JOURNAL_PUBLICATIONS = 'smart-money/v1/journal/publications.json';
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

function emptyPublications() {
  return { schemaVersion: 2, staged: {}, published: {}, current: null };
}

function normalizePublicationIds(value) {
  assertSafePlainRecord(value, ['signalIds', 'dailyMarkIds']);
  assertSafeArray(value.signalIds);
  assertSafeArray(value.dailyMarkIds);
  const signalIds = value.signalIds.map((id) => safeIdentifier(id)).sort();
  const dailyMarkIds = value.dailyMarkIds.map((id) => safeIdentifier(id)).sort();
  if (new Set(signalIds).size !== signalIds.length
      || new Set(dailyMarkIds).size !== dailyMarkIds.length
      || signalIds.some((id) => dailyMarkIds.includes(id))) throw schemaInvalid();
  return { signalIds, dailyMarkIds };
}

function normalizeGenerationIndex(value) {
  assertSafePlainDataRecord(value);
  const result = {};
  for (const [generation, ids] of Object.entries(value)) {
    const canonical = canonicalInstant(generation);
    if (canonical !== generation) throw schemaInvalid();
    result[generation] = normalizePublicationIds(ids);
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function normalizeAcceptedSnapshot(value, generation, digest, now) {
  const snapshot = validateSmartMoneyPrivateSnapshot(value, { now });
  if (snapshot.refreshStartedAt !== generation || snapshot.stateDigest !== digest) throw schemaInvalid();
  const signalIds = snapshot.publicSnapshot.signals.map((signal) => {
    return safeIdentifier(signal.id);
  }).sort();
  if (new Set(signalIds).size !== signalIds.length) throw schemaInvalid();
  return { snapshot, signalIds };
}

function normalizePublishedIndex(value) {
  assertSafePlainDataRecord(value);
  const result = {};
  for (const [generation, publication] of Object.entries(value)) {
    if (canonicalInstant(generation) !== generation) throw schemaInvalid();
    assertSafePlainRecord(publication, ['signalIds', 'dailyMarkIds', 'snapshotDigest']);
    const ids = normalizePublicationIds({
      signalIds: publication.signalIds,
      dailyMarkIds: publication.dailyMarkIds,
    });
    if (typeof publication.snapshotDigest !== 'string'
        || !DIGEST_PATTERN.test(publication.snapshotDigest)) throw schemaInvalid();
    result[generation] = { ...ids, snapshotDigest: publication.snapshotDigest };
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeCurrentPublication(value, published, now) {
  if (value === null) {
    if (Object.keys(published).length !== 0) throw schemaInvalid();
    return null;
  }
  assertSafePlainRecord(value, ['refreshStartedAt', 'snapshotDigest', 'snapshot']);
  const refreshStartedAt = canonicalInstant(value.refreshStartedAt);
  if (typeof value.snapshotDigest !== 'string' || !DIGEST_PATTERN.test(value.snapshotDigest)) {
    throw schemaInvalid();
  }
  const publication = published[refreshStartedAt];
  if (!publication || publication.snapshotDigest !== value.snapshotDigest) throw schemaInvalid();
  const { snapshot, signalIds } = normalizeAcceptedSnapshot(
    value.snapshot, refreshStartedAt, value.snapshotDigest, now,
  );
  if (JSON.stringify(signalIds) !== JSON.stringify(publication.signalIds)) throw schemaInvalid();
  return { refreshStartedAt, snapshotDigest: value.snapshotDigest, snapshot };
}

function normalizePublications(value, now = new Date()) {
  if (value == null) return emptyPublications();
  assertSafePlainRecord(value, ['schemaVersion', 'staged', 'published', 'current']);
  if (value.schemaVersion !== 2) throw schemaInvalid();
  const published = normalizePublishedIndex(value.published);
  return {
    schemaVersion: 2,
    staged: normalizeGenerationIndex(value.staged),
    published,
    current: normalizeCurrentPublication(value.current, published, normalizedNow(now)),
  };
}

function samePublicationIds(left, right) {
  return JSON.stringify({ signalIds: left.signalIds, dailyMarkIds: left.dailyMarkIds })
    === JSON.stringify({ signalIds: right.signalIds, dailyMarkIds: right.dailyMarkIds });
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
      list,
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
      async delete(pathname, expectedEtag) {
        if (typeof expectedEtag !== 'string' || expectedEtag.length < 1
            || expectedEtag.length > 4_096) throw journalError('partition_delete_failed');
        await del(pathname, blobOptions({ access: 'private', ifMatch: expectedEtag }));
        return true;
      },
      async list(prefix) {
        const pathnames = [];
        let cursor;
        do {
          const page = await list(blobOptions({
            prefix,
            limit: 1_000,
            ...(cursor ? { cursor } : {}),
          }));
          for (const blob of page?.blobs || []) {
            if (typeof blob?.pathname === 'string') pathnames.push(blob.pathname);
          }
          cursor = page?.hasMore ? page.cursor : null;
        } while (cursor);
        return pathnames;
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
    let partition;
    let next;
    try {
      partition = normalizePartition(current?.data, date, now);
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
      next = {
        schemaVersion: 1,
        date,
        signals: [...signalById.values()].sort((left, right) => (
          left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id)
        )),
        dailyMarks: [...markById.values()].sort((left, right) => left.id.localeCompare(right.id)),
      };
    } catch {
      return { ...fixedWriteFailure('partition', date), data: null };
    }
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

async function removePartitionRows(adapter, date, removals, now) {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    let current;
    try {
      current = await adapter.read(partitionPath(date));
    } catch {
      return false;
    }
    if (!current?.data) return true;
    const partition = normalizePartition(current.data, date, now);
    const next = {
      schemaVersion: 1,
      date,
      signals: partition.signals.filter((row) => !removals.signalIds.has(row.id)),
      dailyMarks: partition.dailyMarks.filter((row) => !removals.dailyMarkIds.has(row.id)),
    };
    if (next.signals.length === partition.signals.length
        && next.dailyMarks.length === partition.dailyMarks.length) return true;
    try {
      await adapter.write(partitionPath(date), next, current.etag ?? null);
      return true;
    } catch (error) {
      if (!adapter.isConflict?.(error)) return false;
    }
  }
  return false;
}

function retainedManifest(manifest, cutoff, protectedIds = null) {
  const protectedDates = new Set();
  if (protectedIds) {
    for (const id of protectedIds.signalIds ?? []) {
      if (manifest.signalIds[id]) protectedDates.add(manifest.signalIds[id]);
    }
    for (const id of protectedIds.dailyMarkIds ?? []) {
      if (manifest.dailyMarkIds[id]) protectedDates.add(manifest.dailyMarkIds[id]);
    }
  }
  const partitions = manifest.partitions.filter((date) => date >= cutoff || protectedDates.has(date));
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
  const removalDates = removals instanceof Set ? removals : removals.dates ?? new Set();
  const removalSignalIds = removals instanceof Set ? new Set() : removals.signalIds ?? new Set();
  const removalDailyMarkIds = removals instanceof Set ? new Set() : removals.dailyMarkIds ?? new Set();
  const protectedIds = removals instanceof Set ? null : removals.protectedIds ?? null;
  const dropEmptyPartitions = !(removals instanceof Set) && removals.dropEmptyPartitions === true;
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    let current;
    try {
      current = await adapter.read(JOURNAL_MANIFEST);
    } catch {
      return { ...fixedWriteFailure('manifest'), data: null };
    }
    let currentManifest;
    try {
      currentManifest = normalizeManifest(current?.data);
    } catch {
      return { ...fixedWriteFailure('manifest'), data: null };
    }
    let next = currentManifest;
    const partitions = new Set([...next.partitions, ...additions.partitions]);
    for (const date of removalDates) partitions.delete(date);
    const signalIds = { ...next.signalIds };
    const dailyMarkIds = { ...next.dailyMarkIds };
    for (const [id, date] of Object.entries(additions.signalIds)) {
      if (Object.hasOwn(dailyMarkIds, id)
          || (Object.hasOwn(signalIds, id) && signalIds[id] !== date)) {
        return {
          ok: false,
          error: 'manifest_collision',
          data: next,
          collision: { id, kind: 'signal', date },
        };
      }
      signalIds[id] = date;
    }
    for (const [id, date] of Object.entries(additions.dailyMarkIds)) {
      if (Object.hasOwn(signalIds, id)
          || (Object.hasOwn(dailyMarkIds, id) && dailyMarkIds[id] !== date)) {
        return {
          ok: false,
          error: 'manifest_collision',
          data: next,
          collision: { id, kind: 'dailyMark', date },
        };
      }
      dailyMarkIds[id] = date;
    }
    for (const [id, date] of Object.entries(signalIds)) {
      if (removalDates.has(date) || removalSignalIds.has(id)) delete signalIds[id];
    }
    for (const [id, date] of Object.entries(dailyMarkIds)) {
      if (removalDates.has(date) || removalDailyMarkIds.has(id)) delete dailyMarkIds[id];
    }
    next = retainedManifest({
      schemaVersion: 1,
      partitions: [...partitions].sort(),
      signalIds,
      dailyMarkIds,
    }, cutoff, protectedIds);
    if (dropEmptyPartitions) {
      const referenced = new Set([
        ...Object.values(next.signalIds), ...Object.values(next.dailyMarkIds),
      ]);
      next = {
        ...next,
        partitions: next.partitions.filter((date) => referenced.has(date)),
      };
    }
    if (current?.data != null && sameManifest(currentManifest, next)) {
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

async function casPublications(adapter, update, now) {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    let current;
    let publications;
    try {
      current = await adapter.read(JOURNAL_PUBLICATIONS);
      publications = normalizePublications(current?.data, now);
    } catch {
      return { ok: false, skipped: false, error: 'publication_read_failed', data: null };
    }
    let updated;
    try {
      updated = update(publications);
    } catch {
      return { ok: false, skipped: false, error: 'publication_collision', data: null };
    }
    if (updated.skipped) {
      return { ok: true, skipped: true, error: null, data: publications };
    }
    const next = normalizePublications(updated.data, now);
    try {
      await adapter.write(JOURNAL_PUBLICATIONS, next, current?.etag ?? null);
      const committed = await readRecord(adapter, JOURNAL_PUBLICATIONS);
      return {
        ok: true,
        skipped: false,
        error: null,
        data: normalizePublications(committed?.data, now),
      };
    } catch (error) {
      try {
        const committed = await adapter.read(JOURNAL_PUBLICATIONS);
        const reread = normalizePublications(committed?.data, now);
        if (JSON.stringify(reread) === JSON.stringify(next)) {
          return { ok: true, skipped: false, error: null, data: reread };
        }
      } catch {
        // The fixed write failure below remains authoritative.
      }
      if (!adapter.isConflict?.(error)) {
        return { ok: false, skipped: false, error: 'publication_write_failed', data: null };
      }
    }
  }
  return { ok: false, skipped: false, error: 'publication_write_failed', data: null };
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
  let initialManifest;
  try {
    initialManifest = normalizeManifest(initialManifestRecord?.data);
  } catch {
    return appendFailure('journal_read_failed');
  }
  const groups = new Map();
  function group(date) {
    if (date < cutoff) throw schemaInvalid();
    if (!groups.has(date)) groups.set(date, { signals: [], dailyMarks: [] });
    return groups.get(date);
  }
  for (const signal of normalized.signals) {
    const date = signal.observedAt.slice(0, 10);
    const existingDate = initialManifest.signalIds[signal.id];
    if (Object.hasOwn(initialManifest.dailyMarkIds, signal.id)) {
      return appendFailure('manifest_collision');
    }
    if (existingDate && existingDate !== date) return appendFailure('manifest_collision');
    if (!existingDate) group(date).signals.push(signal);
  }
  for (const mark of normalized.dailyMarks) {
    const existingDate = initialManifest.dailyMarkIds[mark.id];
    if (Object.hasOwn(initialManifest.signalIds, mark.id)) {
      return appendFailure('manifest_collision');
    }
    if (existingDate && existingDate !== mark.date) return appendFailure('manifest_collision');
    if (!existingDate) group(mark.date).dailyMarks.push(mark);
  }

  const partitionResults = [];
  for (const [date, additions] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    let result;
    try {
      result = await casPartition(adapter, date, additions, now);
    } catch {
      result = { ...fixedWriteFailure('partition', date), data: null };
    }
    partitionResults.push({ ...result, additions });
  }
  const partitionsOk = partitionResults.every((result) => result.ok);
  const manifestAdditions = { partitions: [], signalIds: {}, dailyMarkIds: {} };
  for (const result of partitionResults) {
    if (!result.ok) continue;
    manifestAdditions.partitions.push(result.date);
    const committedSignalIds = new Set(result.data.signals.map((row) => row.id));
    const committedMarkIds = new Set(result.data.dailyMarks.map((row) => row.id));
    for (const signal of result.additions.signals) {
      if (committedSignalIds.has(signal.id)) manifestAdditions.signalIds[signal.id] = result.date;
    }
    for (const mark of result.additions.dailyMarks) {
      if (committedMarkIds.has(mark.id)) manifestAdditions.dailyMarkIds[mark.id] = result.date;
    }
  }
  let manifestResult;
  if (partitionsOk) {
    try {
      manifestResult = await casManifest(adapter, manifestAdditions, cutoff, now);
    } catch {
      manifestResult = { ...fixedWriteFailure('manifest'), data: null };
    }
  } else {
    manifestResult = { ...fixedWriteFailure('manifest'), data: null };
  }

  if (!manifestResult.ok) {
    if (manifestResult.error === 'manifest_collision' && manifestResult.collision) {
      const collision = manifestResult.collision;
      const removals = {
        signalIds: new Set(collision.kind === 'signal' ? [collision.id] : []),
        dailyMarkIds: new Set(collision.kind === 'dailyMark' ? [collision.id] : []),
      };
      try {
        await removePartitionRows(adapter, collision.date, removals, now);
      } catch {
        // Cleanup is best effort; the manifest remains authoritative.
      }
    }
    return appendFailure(
      manifestResult.error,
      partitionResults.map(publicPartitionResult),
      publicManifestResult(manifestResult),
    );
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
    } catch {
      return appendFailure(
        'journal_read_failed',
        partitionResults.map(publicPartitionResult),
        publicManifestResult(manifestResult),
      );
    }
  }
  const allRequestedCommitted = committedSignals.length === normalized.signals.length
    && committedDailyMarks.length === normalized.dailyMarks.length;
  if (!partitionsOk || !allRequestedCommitted) {
    return appendFailure(
      !partitionsOk ? 'partition_write_failed' : 'journal_read_failed',
      partitionResults.map(publicPartitionResult),
      publicManifestResult(manifestResult),
    );
  }
  return {
    durableWriteSucceeded: partitionsOk && manifestResult.ok && allRequestedCommitted,
    partitions: partitionResults.map(publicPartitionResult),
    manifest: publicManifestResult(manifestResult),
    committedSignals,
    committedDailyMarks,
  };
}

export async function stageJournal(input, options = {}) {
  assertSafePlainRecord(input, ['refreshStartedAt', 'signals', 'dailyMarks']);
  const now = normalizedNow(options.now ?? new Date());
  const refreshStartedAt = canonicalInstant(input.refreshStartedAt);
  if (Date.parse(refreshStartedAt) > now.getTime() + 5 * 60_000) throw schemaInvalid();
  const appended = await appendJournal({ signals: input.signals, dailyMarks: input.dailyMarks }, {
    ...options,
    now,
  });
  if (!appended.durableWriteSucceeded) return appended;
  let adapter;
  try {
    adapter = await resolveAdapter(options);
  } catch {
    return appendFailure('journal_configuration_invalid', appended.partitions, appended.manifest);
  }
  if (!adapter) return appendFailure('journal_configuration_invalid', appended.partitions, appended.manifest);
  const ids = normalizePublicationIds({
    signalIds: appended.committedSignals.map((row) => row.id),
    dailyMarkIds: appended.committedDailyMarks.map((row) => row.id),
  });
  const staged = await casPublications(adapter, (current) => {
    const existing = current.staged[refreshStartedAt] ?? current.published[refreshStartedAt];
    if (existing) {
      if (!samePublicationIds(existing, ids)) throw schemaInvalid();
      return { skipped: true, data: current };
    }
    if (current.current && refreshStartedAt <= current.current.refreshStartedAt) throw schemaInvalid();
    return {
      skipped: false,
      data: {
        ...current,
        staged: { ...current.staged, [refreshStartedAt]: ids },
      },
    };
  }, now);
  if (!staged.ok) return appendFailure(staged.error, appended.partitions, appended.manifest);
  return appended;
}

export async function publishJournalGeneration(input, options = {}) {
  assertSafePlainRecord(input, ['refreshStartedAt', 'snapshot']);
  const now = normalizedNow(options.now ?? new Date());
  const refreshStartedAt = canonicalInstant(input.refreshStartedAt);
  if (Date.parse(refreshStartedAt) > now.getTime() + 5 * 60_000) throw schemaInvalid();
  if (typeof input.snapshot?.stateDigest !== 'string'
      || !DIGEST_PATTERN.test(input.snapshot.stateDigest)) throw schemaInvalid();
  const accepted = normalizeAcceptedSnapshot(
    input.snapshot, refreshStartedAt, input.snapshot.stateDigest, now,
  );
  let adapter;
  try {
    adapter = await resolveAdapter(options);
  } catch {
    return { durableWriteSucceeded: false, skipped: false, error: 'journal_configuration_invalid' };
  }
  if (!adapter) {
    return { durableWriteSucceeded: false, skipped: false, error: 'journal_configuration_invalid' };
  }
  const published = await casPublications(adapter, (current) => {
    const staged = current.staged[refreshStartedAt];
    const existing = current.published[refreshStartedAt];
    if (existing) {
      if (existing.snapshotDigest !== input.snapshot.stateDigest
          || (staged && !samePublicationIds(existing, staged))
          || current.current?.refreshStartedAt !== refreshStartedAt
          || current.current?.snapshotDigest !== input.snapshot.stateDigest
          || JSON.stringify(current.current?.snapshot) !== JSON.stringify(accepted.snapshot)) {
        throw schemaInvalid();
      }
      return { skipped: true, data: current };
    }
    if (!staged || (current.current && refreshStartedAt <= current.current.refreshStartedAt)
        || JSON.stringify(staged.signalIds) !== JSON.stringify(accepted.signalIds)) {
      throw schemaInvalid();
    }
    const nextStaged = { ...current.staged };
    delete nextStaged[refreshStartedAt];
    return {
      skipped: false,
      data: {
        ...current,
        staged: nextStaged,
        published: {
          ...current.published,
          [refreshStartedAt]: { ...staged, snapshotDigest: input.snapshot.stateDigest },
        },
        current: {
          refreshStartedAt,
          snapshotDigest: input.snapshot.stateDigest,
          snapshot: accepted.snapshot,
        },
      },
    };
  }, now);
  return {
    durableWriteSucceeded: published.ok,
    skipped: published.ok ? published.skipped : false,
    error: published.error,
  };
}

export async function readAcceptedSmartMoneySnapshot(options = {}) {
  const adapter = await resolveAdapter(options);
  if (!adapter) throw journalError('journal_configuration_invalid');
  const record = await readRecord(adapter, JOURNAL_PUBLICATIONS);
  const publications = normalizePublications(record?.data, options.now ?? new Date());
  return publications.current === null
    ? null
    : structuredClone(publications.current.snapshot);
}

async function readRetainedJournal(adapter, now, range = {}) {
  const publicationRecord = await readRecord(adapter, JOURNAL_PUBLICATIONS);
  const publications = normalizePublications(publicationRecord?.data, now);
  const publishedSignalIds = new Set();
  const publishedDailyMarkIds = new Set();
  for (const ids of Object.values(publications.published)) {
    for (const id of ids.signalIds) publishedSignalIds.add(id);
    for (const id of ids.dailyMarkIds) publishedDailyMarkIds.add(id);
  }
  const manifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
  const manifest = retainedManifest(normalizeManifest(manifestRecord?.data), cutoffDate(now));
  const sinceDate = range.since?.slice(0, 10) ?? manifest.partitions[0] ?? null;
  const throughDate = range.through?.slice(0, 10) ?? manifest.partitions.at(-1) ?? null;
  const selectedDates = manifest.partitions.filter((date) => (
    sinceDate !== null && throughDate !== null && date >= sinceDate && date <= throughDate
  ));
  const selectedDateSet = new Set(selectedDates);
  const selectedSignalIds = new Map(Object.entries(manifest.signalIds).filter(([, date]) => (
    selectedDateSet.has(date)
  )));
  const selectedDailyMarkIds = new Map(Object.entries(manifest.dailyMarkIds).filter(([, date]) => (
    selectedDateSet.has(date)
  )));
  const signals = [];
  const dailyMarks = [];
  const seenSignals = new Set();
  const seenMarks = new Set();
  for (const date of selectedDates) {
    const record = await readRecord(adapter, partitionPath(date));
    if (!record?.data) throw schemaInvalid();
    const partition = normalizePartition(record.data, date, now);
    for (const signal of partition.signals) {
      if (selectedSignalIds.get(signal.id) !== date) continue;
      if (seenSignals.has(signal.id) || seenMarks.has(signal.id)) throw schemaInvalid();
      seenSignals.add(signal.id);
      if (publishedSignalIds.has(signal.id)) signals.push(signal);
    }
    for (const mark of partition.dailyMarks) {
      if (selectedDailyMarkIds.get(mark.id) !== date) continue;
      if (seenMarks.has(mark.id) || seenSignals.has(mark.id)) throw schemaInvalid();
      seenMarks.add(mark.id);
      if (publishedDailyMarkIds.has(mark.id)) dailyMarks.push(mark);
    }
  }
  if ([...selectedSignalIds.keys()].some((id) => !seenSignals.has(id))
      || [...selectedDailyMarkIds.keys()].some((id) => !seenMarks.has(id))) throw schemaInvalid();
  return { manifest, signals, dailyMarks };
}

function encodeCursor(event, through) {
  return Buffer.from(JSON.stringify({
    through,
    timestamp: event.timestamp,
    type: event.type,
    id: event.id,
  }), 'utf8')
    .toString('base64url');
}

export function parseJournalCursor(value, { since, now }) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_000
      || !/^[A-Za-z0-9_-]+$/.test(value)) throw schemaInvalid();
  try {
    const decodedText = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decodedText, 'utf8').toString('base64url') !== value) throw schemaInvalid();
    const decoded = JSON.parse(decodedText);
    assertSafePlainRecord(decoded, ['through', 'timestamp', 'type', 'id']);
    const through = canonicalInstant(decoded.through);
    const timestamp = canonicalInstant(decoded.timestamp);
    if (!['daily_mark', 'signal'].includes(decoded.type)) throw schemaInvalid();
    const id = canonicalJournalCursorId(decoded.id);
    if (through < since || through > normalizedNow(now).toISOString()
        || timestamp < since || timestamp > through) throw schemaInvalid();
    return { through, timestamp, type: decoded.type, id };
  } catch (error) {
    if (error?.code === 'schema_invalid') throw error;
    throw schemaInvalid();
  }
}

export function canonicalJournalCursorId(value) {
  return safeIdentifier(value);
}

function compareEventKey(left, right) {
  return left.timestamp.localeCompare(right.timestamp)
    || left.type.localeCompare(right.type)
    || left.id.localeCompare(right.id);
}

function afterCursor(event, cursor) {
  return !cursor || compareEventKey(event, cursor) > 0;
}

export async function readJournal(query, options = {}) {
  assertSafePlainRecord(query, ['since', 'limit', 'cursor'], ['since', 'limit']);
  const now = normalizedNow(options.now ?? new Date());
  const since = canonicalInstant(query.since);
  const sinceMs = Date.parse(since);
  if (sinceMs > now.getTime() || sinceMs < now.getTime() - JOURNAL_RETENTION_DAYS * DAY_MS
      || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500) throw schemaInvalid();
  const cursor = parseJournalCursor(query.cursor, { since, now });
  const through = cursor?.through ?? now.toISOString();
  const adapter = await resolveAdapter(options);
  if (!adapter) throw journalError('journal_configuration_invalid');
  const journal = await readRetainedJournal(adapter, now, { since, through });
  const events = [
    ...journal.signals.map((row) => ({
      timestamp: row.observedAt, type: 'signal', id: row.id, row,
    })),
    ...journal.dailyMarks.map((row) => ({
      timestamp: row.asOf, type: 'daily_mark', id: row.id, row,
    })),
  ].filter((event) => (
    event.timestamp >= since && event.timestamp <= through && afterCursor(event, cursor)
  )).sort(compareEventKey);
  const hasNext = events.length > query.limit;
  const page = events.slice(0, query.limit);
  const signals = page.filter((event) => event.type === 'signal').map((event) => event.row);
  const dailyMarks = page.filter((event) => event.type === 'daily_mark').map((event) => event.row);
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
    nextCursor: hasNext ? encodeCursor(page.at(-1), through) : null,
    providerStatuses: [],
    warnings: [],
    sourceLinks: [],
  };
  if (Object.keys(result).some((field, index) => HISTORY_FIELDS[index] !== field)) throw schemaInvalid();
  return result;
}

export async function listTrackedTickers(query, options = {}) {
  assertSafePlainRecord(query, ['since']);
  const now = normalizedNow(options.now ?? new Date());
  const since = canonicalInstant(query.since);
  if (Date.parse(since) > now.getTime()
      || Date.parse(since) < now.getTime() - JOURNAL_RETENTION_DAYS * DAY_MS) throw schemaInvalid();
  const adapter = await resolveAdapter(options);
  if (!adapter) throw journalError('journal_configuration_invalid');
  const through = now.toISOString();
  const journal = await readRetainedJournal(adapter, now, { since, through });
  const tickers = new Set();
  for (const signal of journal.signals) {
    if (signal.observedAt >= since && signal.observedAt <= through
        && signal.asset.supported && signal.asset.ticker) tickers.add(signal.asset.ticker);
  }
  for (const mark of journal.dailyMarks) {
    if (mark.asOf >= since && mark.asOf <= through && mark.kind === 'asset') tickers.add(mark.ticker);
  }
  return [...tickers].sort();
}

function publicationIds(entries) {
  const signalIds = new Set();
  const dailyMarkIds = new Set();
  for (const entry of Object.values(entries)) {
    for (const id of entry.signalIds) signalIds.add(id);
    for (const id of entry.dailyMarkIds) dailyMarkIds.add(id);
  }
  return { signalIds, dailyMarkIds };
}

async function planPublicationPrune(adapter, now) {
  let publications;
  try {
    const record = await readRecord(adapter, JOURNAL_PUBLICATIONS);
    publications = normalizePublications(record?.data, now);
  } catch {
    return { ok: false };
  }
  const retainedStaged = Object.fromEntries(Object.entries(publications.staged).filter(([generation]) => (
    publications.current === null || generation > publications.current.refreshStartedAt
  )));
  const droppedEntries = Object.fromEntries(Object.entries(publications.staged).filter(([generation]) => (
    publications.current !== null && generation <= publications.current.refreshStartedAt
  )));
  const retainedIds = publicationIds(retainedStaged);
  const publishedIds = publicationIds(publications.published);
  const droppedIds = publicationIds(droppedEntries);
  return {
    ok: true,
    droppedEntries,
    removedSignalIds: [...droppedIds.signalIds].filter((id) => (
      !retainedIds.signalIds.has(id) && !publishedIds.signalIds.has(id)
    )).sort(),
    removedDailyMarkIds: [...droppedIds.dailyMarkIds].filter((id) => (
      !retainedIds.dailyMarkIds.has(id) && !publishedIds.dailyMarkIds.has(id)
    )).sort(),
    protectedSignalIds: [...retainedIds.signalIds].sort(),
    protectedDailyMarkIds: [...retainedIds.dailyMarkIds].sort(),
  };
}

async function compactPublicationMetadata(adapter, manifest, plan, now) {
  const retainedSignalIds = new Set(Object.keys(manifest.signalIds));
  const retainedDailyMarkIds = new Set(Object.keys(manifest.dailyMarkIds));
  return casPublications(adapter, (current) => {
    const staged = { ...current.staged };
    for (const [generation, expected] of Object.entries(plan.droppedEntries)) {
      if (staged[generation] && !samePublicationIds(staged[generation], expected)) {
        throw schemaInvalid();
      }
      delete staged[generation];
    }
    const published = {};
    for (const [generation, entry] of Object.entries(current.published)) {
      if (generation === current.current?.refreshStartedAt) {
        published[generation] = entry;
        continue;
      }
      const compacted = {
        signalIds: entry.signalIds.filter((id) => retainedSignalIds.has(id)),
        dailyMarkIds: entry.dailyMarkIds.filter((id) => retainedDailyMarkIds.has(id)),
        snapshotDigest: entry.snapshotDigest,
      };
      if (compacted.signalIds.length > 0 || compacted.dailyMarkIds.length > 0) {
        published[generation] = compacted;
      }
    }
    const next = { ...current, staged, published };
    return JSON.stringify(next) === JSON.stringify(current)
      ? { skipped: true, data: current }
      : { skipped: false, data: next };
  }, now);
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
  const publicationPlan = await planPublicationPrune(adapter, now);
  if (!publicationPlan.ok) {
    return {
      durableWriteSucceeded: false,
      partitions: [],
      manifest: { ok: false, error: 'publication_write_failed' },
    };
  }
  const removedSignalIds = new Set(publicationPlan.removedSignalIds);
  const removedDailyMarkIds = new Set(publicationPlan.removedDailyMarkIds);
  const protectedSignalIds = new Set(publicationPlan.protectedSignalIds);
  const protectedDailyMarkIds = new Set(publicationPlan.protectedDailyMarkIds);
  const protectedDates = new Set([
    ...[...protectedSignalIds].map((id) => current.signalIds[id]).filter(Boolean),
    ...[...protectedDailyMarkIds].map((id) => current.dailyMarkIds[id]).filter(Boolean),
  ]);
  const expired = current.partitions.filter((date) => date < cutoff && !protectedDates.has(date));
  const manifestResult = await casManifest(
    adapter,
    { partitions: [], signalIds: {}, dailyMarkIds: {} },
    cutoff,
    now,
    {
      dates: new Set(expired),
      signalIds: removedSignalIds,
      dailyMarkIds: removedDailyMarkIds,
      protectedIds: {
        signalIds: protectedSignalIds,
        dailyMarkIds: protectedDailyMarkIds,
      },
      dropEmptyPartitions: true,
    },
  );
  if (!manifestResult.ok) {
    return {
      durableWriteSucceeded: false,
      partitions: [],
      manifest: publicManifestResult(manifestResult),
    };
  }
  const publicationsResult = await compactPublicationMetadata(
    adapter, manifestResult.data, publicationPlan, now,
  );
  if (!publicationsResult.ok) {
    return {
      durableWriteSucceeded: false,
      partitions: [],
      manifest: publicManifestResult(manifestResult),
    };
  }

  const referenced = new Set(manifestResult.data.partitions);
  const cleanupDates = new Set(
    current.partitions.filter((date) => !referenced.has(date)),
  );
  if (typeof adapter.list === 'function') {
    try {
      const pathnames = await adapter.list(JOURNAL_PREFIX);
      for (const pathname of pathnames) {
        const match = new RegExp(`^${JOURNAL_PREFIX.replaceAll('/', '\\/')}(\\d{4}-\\d{2}-\\d{2})\\.json$`).exec(pathname);
        if (!match) continue;
        let date;
        try {
          date = canonicalDate(match[1]);
        } catch {
          continue;
        }
        if (date < cutoff && !referenced.has(date)) cleanupDates.add(date);
      }
    } catch {
      return {
        durableWriteSucceeded: false,
        partitions: [],
        manifest: publicManifestResult(manifestResult),
      };
    }
  }
  const partitionResults = [];
  const rowRemovalsByDate = new Map();
  function removalsFor(date) {
    if (!rowRemovalsByDate.has(date)) {
      rowRemovalsByDate.set(date, { signalIds: new Set(), dailyMarkIds: new Set() });
    }
    return rowRemovalsByDate.get(date);
  }
  for (const id of removedSignalIds) {
    const date = current.signalIds[id];
    if (date && referenced.has(date)) removalsFor(date).signalIds.add(id);
  }
  for (const id of removedDailyMarkIds) {
    const date = current.dailyMarkIds[id];
    if (date && referenced.has(date)) removalsFor(date).dailyMarkIds.add(id);
  }
  for (const [date, removals] of [...rowRemovalsByDate.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    let ok = false;
    try {
      ok = await removePartitionRows(adapter, date, removals, now);
    } catch {
      ok = false;
    }
    partitionResults.push({
      date,
      ok,
      error: ok ? null : 'partition_delete_failed',
    });
  }
  for (const date of [...cleanupDates].sort()) {
    try {
      const record = await adapter.read(partitionPath(date));
      if (record?.data && typeof adapter.delete !== 'function') throw journalError('partition_delete_failed');
      if (record?.data) await adapter.delete(partitionPath(date), record.etag ?? null);
      partitionResults.push({ date, ok: true, ...(record?.data ? {} : { skipped: true }), error: null });
    } catch {
      partitionResults.push({ date, ok: false, error: 'partition_delete_failed' });
    }
  }
  const partitionsOk = partitionResults.every((result) => result.ok);
  return {
    durableWriteSucceeded: partitionsOk && manifestResult.ok,
    partitions: partitionResults,
    manifest: publicManifestResult(manifestResult),
  };
}

export const SMART_MONEY_JOURNAL_NAMESPACES = Object.freeze({
  prefix: JOURNAL_PREFIX,
  manifest: JOURNAL_MANIFEST,
  publications: JOURNAL_PUBLICATIONS,
  retentionDays: JOURNAL_RETENTION_DAYS,
});
