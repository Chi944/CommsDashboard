import { randomUUID } from 'node:crypto';

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
const CLAIM_LEASE_MS = 120_000;
const CLAIM_RECLAIM_GRACE_MS = 600_000;
const MAX_MANIFEST_CLAIMS = 2_048;
const MAX_IDS_PER_CLAIM = 10_000;
const MAX_TOTAL_CLAIM_IDS = 100_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLAIM_TOKEN_PATTERN = /^claim:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
  return {
    schemaVersion: 2,
    partitions: [],
    signalIds: {},
    dailyMarkIds: {},
    claims: {},
    maintenance: null,
  };
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

function normalizeCleanup(value) {
  assertSafePlainRecord(
    value,
    ['staged', 'signalIds', 'dailyMarkIds', 'claims'],
    ['staged', 'signalIds', 'dailyMarkIds'],
  );
  const staged = normalizeGenerationIndex(value.staged);
  const claims = value.claims === undefined ? {} : normalizeClaims(value.claims);
  if (Object.keys(staged).length === 0 && Object.keys(claims).length === 0) throw schemaInvalid();
  const signalIds = Object.fromEntries(
    Object.entries(normalizeIdIndex(value.signalIds)).sort(([left], [right]) => left.localeCompare(right)),
  );
  const dailyMarkIds = Object.fromEntries(
    Object.entries(normalizeIdIndex(value.dailyMarkIds)).sort(([left], [right]) => left.localeCompare(right)),
  );
  const stagedSignalIds = new Set();
  const stagedDailyMarkIds = new Set();
  for (const ids of Object.values(staged)) {
    for (const id of ids.signalIds) stagedSignalIds.add(id);
    for (const id of ids.dailyMarkIds) stagedDailyMarkIds.add(id);
  }
  for (const claim of Object.values(claims)) {
    for (const id of Object.keys(claim.signalIds)) stagedSignalIds.add(id);
    for (const id of Object.keys(claim.dailyMarkIds)) stagedDailyMarkIds.add(id);
  }
  if (Object.keys(signalIds).some((id) => !stagedSignalIds.has(id))
      || Object.keys(dailyMarkIds).some((id) => !stagedDailyMarkIds.has(id))) {
    throw schemaInvalid();
  }
  return {
    staged,
    ...(Object.keys(claims).length === 0 ? {} : { claims }),
    signalIds: Object.fromEntries(Object.entries(signalIds).sort(([left], [right]) => left.localeCompare(right))),
    dailyMarkIds: Object.fromEntries(Object.entries(dailyMarkIds).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function normalizeReconciliation(value) {
  assertSafePlainRecord(value, ['signalIds', 'dailyMarkIds']);
  const signalIds = Object.fromEntries(
    Object.entries(normalizeIdIndex(value.signalIds)).sort(([left], [right]) => left.localeCompare(right)),
  );
  const dailyMarkIds = Object.fromEntries(
    Object.entries(normalizeIdIndex(value.dailyMarkIds)).sort(([left], [right]) => left.localeCompare(right)),
  );
  if (Object.keys(signalIds).some((id) => Object.hasOwn(dailyMarkIds, id))
      || Object.keys(signalIds).length + Object.keys(dailyMarkIds).length > MAX_TOTAL_CLAIM_IDS) {
    throw schemaInvalid();
  }
  return { signalIds, dailyMarkIds };
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
  assertSafePlainRecord(
    value,
    ['schemaVersion', 'staged', 'published', 'current', 'cleanup', 'reconciliation'],
    ['schemaVersion', 'staged', 'published', 'current'],
  );
  if (value.schemaVersion !== 2) throw schemaInvalid();
  const staged = normalizeGenerationIndex(value.staged);
  const published = normalizePublishedIndex(value.published);
  const cleanup = value.cleanup === undefined ? null : normalizeCleanup(value.cleanup);
  const reconciliation = value.reconciliation === undefined
    ? null
    : normalizeReconciliation(value.reconciliation);
  if (cleanup && Object.entries(cleanup.staged).some(([generation, ids]) => (
    !staged[generation] || !samePublicationIds(staged[generation], ids)
  ))) throw schemaInvalid();
  const publishedIds = publicationIds(published);
  const privateMappings = [
    ...(cleanup ? [cleanup] : []),
    ...(reconciliation ? [reconciliation] : []),
  ];
  if (privateMappings.some((mapping) => (
    Object.keys(mapping.signalIds).some((id) => (
      publishedIds.signalIds.has(id) || publishedIds.dailyMarkIds.has(id)
    ))
      || Object.keys(mapping.dailyMarkIds).some((id) => (
        publishedIds.signalIds.has(id) || publishedIds.dailyMarkIds.has(id)
      ))
  ))) throw schemaInvalid();
  return {
    schemaVersion: 2,
    staged,
    published,
    current: normalizeCurrentPublication(value.current, published, normalizedNow(now)),
    ...(cleanup === null ? {} : { cleanup }),
    ...(reconciliation === null ? {} : { reconciliation }),
  };
}

function samePublicationIds(left, right) {
  return JSON.stringify({ signalIds: left.signalIds, dailyMarkIds: left.dailyMarkIds })
    === JSON.stringify({ signalIds: right.signalIds, dailyMarkIds: right.dailyMarkIds });
}

function publicationIdsIntersect(left, right) {
  const ids = new Set([...left.signalIds, ...left.dailyMarkIds]);
  return right.signalIds.some((id) => ids.has(id))
    || right.dailyMarkIds.some((id) => ids.has(id));
}

function cleanupPublicationIds(cleanup) {
  const staged = publicationIds(cleanup.staged);
  for (const claim of Object.values(cleanup.claims ?? {})) {
    for (const id of Object.keys(claim.signalIds)) staged.signalIds.add(id);
    for (const id of Object.keys(claim.dailyMarkIds)) staged.dailyMarkIds.add(id);
  }
  return staged;
}

function normalizeIdIndex(value) {
  assertSafePlainDataRecord(value);
  const result = {};
  for (const [id, date] of Object.entries(value)) {
    result[safeIdentifier(id)] = canonicalDate(date);
  }
  return result;
}

function claimToken() {
  return `claim:${randomUUID()}`;
}

function canonicalClaimToken(value) {
  if (typeof value !== 'string' || !CLAIM_TOKEN_PATTERN.test(value)) throw schemaInvalid();
  return value;
}

function normalizeClaim(value) {
  assertSafePlainRecord(value, [
    'token', 'state', 'claimedAt', 'leaseUntil', 'signalIds', 'dailyMarkIds',
  ]);
  const token = canonicalClaimToken(value.token);
  if (!['writing', 'staged'].includes(value.state)) throw schemaInvalid();
  const claimedAt = canonicalInstant(value.claimedAt);
  const leaseUntil = canonicalInstant(value.leaseUntil);
  const leaseMs = Date.parse(leaseUntil) - Date.parse(claimedAt);
  if (leaseMs < CLAIM_LEASE_MS || leaseMs > CLAIM_LEASE_MS + CLAIM_RECLAIM_GRACE_MS) {
    throw schemaInvalid();
  }
  const signalIds = Object.fromEntries(
    Object.entries(normalizeIdIndex(value.signalIds)).sort(([left], [right]) => left.localeCompare(right)),
  );
  const dailyMarkIds = Object.fromEntries(
    Object.entries(normalizeIdIndex(value.dailyMarkIds)).sort(([left], [right]) => left.localeCompare(right)),
  );
  const idCount = Object.keys(signalIds).length + Object.keys(dailyMarkIds).length;
  if (idCount > MAX_IDS_PER_CLAIM
      || Object.keys(signalIds).some((id) => Object.hasOwn(dailyMarkIds, id))) throw schemaInvalid();
  return { token, state: value.state, claimedAt, leaseUntil, signalIds, dailyMarkIds };
}

function normalizeClaims(value) {
  assertSafePlainDataRecord(value);
  const entries = Object.entries(value);
  if (entries.length > MAX_MANIFEST_CLAIMS) throw schemaInvalid();
  let totalIds = 0;
  const claims = {};
  for (const [generation, valueClaim] of entries) {
    if (canonicalInstant(generation) !== generation) throw schemaInvalid();
    const claim = normalizeClaim(valueClaim);
    totalIds += Object.keys(claim.signalIds).length + Object.keys(claim.dailyMarkIds).length;
    if (totalIds > MAX_TOTAL_CLAIM_IDS) throw schemaInvalid();
    claims[generation] = claim;
  }
  return Object.fromEntries(Object.entries(claims).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeMaintenance(value) {
  if (value === null) return null;
  assertSafePlainRecord(value, ['token', 'claimedAt', 'leaseUntil']);
  const token = canonicalClaimToken(value.token);
  const claimedAt = canonicalInstant(value.claimedAt);
  const leaseUntil = canonicalInstant(value.leaseUntil);
  const leaseMs = Date.parse(leaseUntil) - Date.parse(claimedAt);
  if (leaseMs < CLAIM_LEASE_MS || leaseMs > CLAIM_LEASE_MS + CLAIM_RECLAIM_GRACE_MS) {
    throw schemaInvalid();
  }
  return { token, claimedAt, leaseUntil };
}

function normalizeAbandonmentEvidence(value) {
  assertSafePlainRecord(value, ['candidateStatus', 'current']);
  if (!['absent', 'ready'].includes(value.candidateStatus)) throw schemaInvalid();
  let current = null;
  if (value.current !== null) {
    assertSafePlainRecord(value.current, ['refreshStartedAt', 'snapshotDigest']);
    if (typeof value.current.snapshotDigest !== 'string'
        || !DIGEST_PATTERN.test(value.current.snapshotDigest)) throw schemaInvalid();
    current = {
      refreshStartedAt: canonicalInstant(value.current.refreshStartedAt),
      snapshotDigest: value.current.snapshotDigest,
    };
  }
  if (value.candidateStatus === 'ready' && current === null) throw schemaInvalid();
  return { candidateStatus: value.candidateStatus, current };
}

function normalizeAbandonment(value, now) {
  if (value === undefined) return null;
  assertSafePlainRecord(value, ['mode', 'generation', 'through', 'evidence'], ['mode', 'evidence']);
  if (!['exact', 'expired'].includes(value.mode)) throw schemaInvalid();
  const evidence = normalizeAbandonmentEvidence(value.evidence);
  if (value.mode === 'exact') {
    if (value.through !== undefined || value.generation === undefined) throw schemaInvalid();
    const generation = canonicalInstant(value.generation);
    if (Date.parse(generation) > now.getTime() + 5 * 60_000) throw schemaInvalid();
    return { mode: 'exact', generation, evidence };
  }
  if (value.generation !== undefined || value.through === undefined) throw schemaInvalid();
  const through = canonicalInstant(value.through);
  if (Date.parse(through) > now.getTime() + 5 * 60_000) throw schemaInvalid();
  return { mode: 'expired', through, evidence };
}

function normalizeManifest(value) {
  if (value == null) return emptyManifest();
  if (value.schemaVersion === 1) {
    assertSafePlainRecord(value, ['schemaVersion', 'partitions', 'signalIds', 'dailyMarkIds']);
  } else {
    assertSafePlainRecord(value, [
      'schemaVersion', 'partitions', 'signalIds', 'dailyMarkIds', 'claims', 'maintenance',
    ]);
    if (value.schemaVersion !== 2) throw schemaInvalid();
  }
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
  const claims = value.schemaVersion === 1 ? {} : normalizeClaims(value.claims);
  const maintenance = value.schemaVersion === 1 ? null : normalizeMaintenance(value.maintenance);
  for (const claim of Object.values(claims)) {
    if (claim.state !== 'staged') continue;
    if (Object.entries(claim.signalIds).some(([id, date]) => signalIds[id] !== date)
        || Object.entries(claim.dailyMarkIds).some(([id, date]) => dailyMarkIds[id] !== date)) {
      throw schemaInvalid();
    }
  }
  return { schemaVersion: 2, partitions, signalIds, dailyMarkIds, claims, maintenance };
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

async function removePartitionRows(adapter, date, removals, now, maintenanceToken = null) {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    if (maintenanceToken !== null
        && !await manifestMaintenanceOwned(adapter, maintenanceToken)) return false;
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
      if (maintenanceToken !== null
          && !await manifestMaintenanceOwned(adapter, maintenanceToken)) return false;
      await adapter.write(partitionPath(date), next, current.etag ?? null);
      return true;
    } catch (error) {
      if (!adapter.isConflict?.(error)) return false;
    }
  }
  return false;
}

function retainedManifest(manifest, cutoff, protectedIds = null, ignoredClaimGenerations = new Set()) {
  const protectedDates = new Set();
  for (const [generation, claim] of Object.entries(manifest.claims)) {
    if (ignoredClaimGenerations.has(generation)) continue;
    for (const date of [...Object.values(claim.signalIds), ...Object.values(claim.dailyMarkIds)]) {
      protectedDates.add(date);
    }
  }
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
  return {
    schemaVersion: 2,
    partitions,
    signalIds,
    dailyMarkIds,
    claims: manifest.claims,
    maintenance: manifest.maintenance,
  };
}

function sameManifest(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function casManifest(adapter, additions, cutoff, now, removals = new Set()) {
  const removalDates = removals instanceof Set ? removals : removals.dates ?? new Set();
  const removalSignalIds = removals instanceof Set ? new Set() : removals.signalIds ?? new Set();
  const removalDailyMarkIds = removals instanceof Set ? new Set() : removals.dailyMarkIds ?? new Set();
  const protectedIds = removals instanceof Set ? null : removals.protectedIds ?? null;
  const ignoredClaimGenerations = removals instanceof Set
    ? new Set()
    : removals.ignoredClaimGenerations ?? new Set();
  const dropEmptyPartitions = !(removals instanceof Set) && removals.dropEmptyPartitions === true;
  const expectedMaintenanceToken = removals instanceof Set
    ? null
    : removals.expectedMaintenanceToken ?? null;
  const requireNoMaintenance = !(removals instanceof Set)
    && removals.requireNoMaintenance === true;
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
    if (expectedMaintenanceToken !== null
        && currentManifest.maintenance?.token !== expectedMaintenanceToken) {
      return { ok: false, error: 'manifest_collision', data: currentManifest };
    }
    if (requireNoMaintenance && currentManifest.maintenance !== null) {
      return { ok: false, error: 'manifest_collision', data: currentManifest };
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
      schemaVersion: 2,
      partitions: [...partitions].sort(),
      signalIds,
      dailyMarkIds,
      claims: next.claims,
      maintenance: next.maintenance,
    }, cutoff, protectedIds, ignoredClaimGenerations);
    if (dropEmptyPartitions) {
      const referenced = new Set([
        ...Object.values(next.signalIds), ...Object.values(next.dailyMarkIds),
        ...Object.entries(next.claims).flatMap(([generation, claim]) => (
          ignoredClaimGenerations.has(generation)
            ? []
            : [...Object.values(claim.signalIds), ...Object.values(claim.dailyMarkIds)]
        )),
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

async function casManifestState(adapter, update) {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    let current;
    let manifest;
    try {
      current = await adapter.read(JOURNAL_MANIFEST);
      manifest = normalizeManifest(current?.data);
    } catch {
      return { ...fixedWriteFailure('manifest'), data: null };
    }
    let updated;
    try {
      updated = update(manifest);
    } catch {
      return { ok: false, error: 'manifest_collision', data: manifest };
    }
    if (updated.skipped) {
      return { ok: true, skipped: true, error: null, data: manifest };
    }
    let next;
    try {
      next = normalizeManifest(updated.data);
    } catch {
      return { ok: false, error: 'manifest_collision', data: manifest };
    }
    try {
      await adapter.write(JOURNAL_MANIFEST, next, current?.etag ?? null);
      const committed = await readRecord(adapter, JOURNAL_MANIFEST);
      return {
        ok: true,
        skipped: false,
        error: null,
        data: normalizeManifest(committed?.data),
      };
    } catch (error) {
      if (!adapter.isConflict?.(error)) return { ...fixedWriteFailure('manifest'), data: null };
    }
  }
  return { ...fixedWriteFailure('manifest'), data: null };
}

function claimPastReclaimGrace(claim, now) {
  return now.getTime() > Date.parse(claim.leaseUntil) + CLAIM_RECLAIM_GRACE_MS;
}

async function acquireManifestMaintenance(adapter, now) {
  const token = claimToken();
  const claimedAt = now.toISOString();
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  const result = await casManifestState(adapter, (current) => {
    if (current.maintenance && !claimPastReclaimGrace(current.maintenance, now)) {
      throw schemaInvalid();
    }
    return {
      skipped: false,
      data: {
        ...current,
        maintenance: { token, claimedAt, leaseUntil },
      },
    };
  });
  return result.ok ? { ok: true, token, manifest: result.data } : { ok: false };
}

async function clearManifestMaintenance(adapter, token) {
  return casManifestState(adapter, (current) => {
    if (current.maintenance?.token !== token) throw schemaInvalid();
    return { skipped: false, data: { ...current, maintenance: null } };
  });
}

async function manifestMaintenanceOwned(adapter, token) {
  try {
    const record = await readRecord(adapter, JOURNAL_MANIFEST);
    return normalizeManifest(record?.data).maintenance?.token === token;
  } catch {
    return false;
  }
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

function claimIndexes(normalized) {
  return {
    signalIds: Object.fromEntries(normalized.signals
      .map((row) => [row.id, row.observedAt.slice(0, 10)])
      .sort(([left], [right]) => left.localeCompare(right))),
    dailyMarkIds: Object.fromEntries(normalized.dailyMarks
      .map((row) => [row.id, row.date])
      .sort(([left], [right]) => left.localeCompare(right))),
  };
}

function sameClaimIndexes(claim, indexes) {
  return JSON.stringify({ signalIds: claim.signalIds, dailyMarkIds: claim.dailyMarkIds })
    === JSON.stringify(indexes);
}

function claimPublicationIds(claim) {
  return {
    signalIds: Object.keys(claim.signalIds).sort(),
    dailyMarkIds: Object.keys(claim.dailyMarkIds).sort(),
  };
}

async function acquireStageClaim(adapter, generation, normalized, now) {
  const indexes = claimIndexes(normalized);
  const token = claimToken();
  const claimedAt = now.toISOString();
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
  const result = await casManifestState(adapter, (current) => {
    if (current.maintenance !== null) throw schemaInvalid();
    const existing = current.claims[generation];
    if (existing) {
      if (!sameClaimIndexes(existing, indexes)) throw schemaInvalid();
      return { skipped: true, data: current };
    }
    for (const claim of Object.values(current.claims)) {
      for (const [id, date] of Object.entries(indexes.signalIds)) {
        if ((claim.signalIds[id] && claim.signalIds[id] !== date)
            || Object.hasOwn(claim.dailyMarkIds, id)) throw schemaInvalid();
      }
      for (const [id, date] of Object.entries(indexes.dailyMarkIds)) {
        if ((claim.dailyMarkIds[id] && claim.dailyMarkIds[id] !== date)
            || Object.hasOwn(claim.signalIds, id)) throw schemaInvalid();
      }
    }
    for (const [id, date] of Object.entries(indexes.signalIds)) {
      if ((current.signalIds[id] && current.signalIds[id] !== date)
          || Object.hasOwn(current.dailyMarkIds, id)) throw schemaInvalid();
    }
    for (const [id, date] of Object.entries(indexes.dailyMarkIds)) {
      if ((current.dailyMarkIds[id] && current.dailyMarkIds[id] !== date)
          || Object.hasOwn(current.signalIds, id)) throw schemaInvalid();
    }
    return {
      skipped: false,
      data: {
        ...current,
        claims: {
          ...current.claims,
          [generation]: {
            token,
            state: 'writing',
            claimedAt,
            leaseUntil,
            ...indexes,
          },
        },
      },
    };
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    claim: result.data.claims[generation],
    manifest: result.data,
  };
}

function publicationAllowsStage(publications, generation, ids) {
  if (publications.current && generation <= publications.current.refreshStartedAt) return false;
  if (publications.cleanup && (
    Object.hasOwn(publications.cleanup.staged, generation)
      || Object.hasOwn(publications.cleanup.claims ?? {}, generation)
      || publicationIdsIntersect(cleanupPublicationIds(publications.cleanup), ids)
  )) return false;
  const existing = publications.staged[generation] ?? publications.published[generation];
  if (existing && !samePublicationIds(existing, ids)) return false;
  return !Object.entries(publications.staged).some(([otherGeneration, pending]) => (
    otherGeneration !== generation && publicationIdsIntersect(pending, ids)
  ));
}

async function adoptReconciliation(adapter, generation, claim, now) {
  try {
    const manifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
    const manifest = normalizeManifest(manifestRecord?.data);
    if (manifest.maintenance !== null || manifest.claims[generation]?.token !== claim.token) return false;
  } catch {
    return false;
  }
  const result = await casPublications(adapter, (current) => {
    const reconciliation = current.reconciliation;
    if (!reconciliation) return { skipped: true, data: current };
    const signalIds = { ...reconciliation.signalIds };
    const dailyMarkIds = { ...reconciliation.dailyMarkIds };
    for (const [id, date] of Object.entries(claim.signalIds)) {
      if (signalIds[id] && signalIds[id] !== date) throw schemaInvalid();
      delete signalIds[id];
    }
    for (const [id, date] of Object.entries(claim.dailyMarkIds)) {
      if (dailyMarkIds[id] && dailyMarkIds[id] !== date) throw schemaInvalid();
      delete dailyMarkIds[id];
    }
    const { reconciliation: _reconciliation, ...withoutReconciliation } = current;
    const next = Object.keys(signalIds).length > 0 || Object.keys(dailyMarkIds).length > 0
      ? { ...withoutReconciliation, reconciliation: { signalIds, dailyMarkIds } }
      : withoutReconciliation;
    return { skipped: false, data: next };
  }, now);
  return result.ok;
}

async function readPublicationsForStage(adapter, generation, ids, now) {
  try {
    const record = await readRecord(adapter, JOURNAL_PUBLICATIONS);
    const publications = normalizePublications(record?.data, now);
    return publicationAllowsStage(publications, generation, ids) ? publications : null;
  } catch {
    return null;
  }
}

async function rereadClaimRows(adapter, claim, normalized, now) {
  const dates = [...new Set([
    ...Object.values(claim.signalIds), ...Object.values(claim.dailyMarkIds),
  ])].sort();
  const signals = new Map();
  const dailyMarks = new Map();
  for (const date of dates) {
    const record = await readRecord(adapter, partitionPath(date));
    const partition = normalizePartition(record?.data, date, now);
    for (const row of partition.signals) signals.set(row.id, row);
    for (const row of partition.dailyMarks) dailyMarks.set(row.id, row);
  }
  return {
    committedSignals: normalized.signals.map((row) => signals.get(row.id)).filter(Boolean),
    committedDailyMarks: normalized.dailyMarks.map((row) => dailyMarks.get(row.id)).filter(Boolean),
  };
}

function sameCommittedRows(committed, normalized) {
  return JSON.stringify(committed.committedSignals) === JSON.stringify(normalized.signals)
    && JSON.stringify(committed.committedDailyMarks) === JSON.stringify(normalized.dailyMarks);
}

async function verifyStageAuthority(adapter, generation, token, normalized, now) {
  try {
    const initialManifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
    const initialManifest = normalizeManifest(initialManifestRecord?.data);
    const initialClaim = initialManifest.claims[generation];
    if (!initialClaim || initialClaim.token !== token || initialClaim.state !== 'staged') return null;
    const committed = await rereadClaimRows(adapter, initialClaim, normalized, now);
    if (!sameCommittedRows(committed, normalized)) return null;
    const manifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
    const manifest = normalizeManifest(manifestRecord?.data);
    const claim = manifest.claims[generation];
    if (!claim || claim.token !== token || claim.state !== 'staged'
        || manifest.maintenance !== null || !sameClaimIndexes(claim, claimIndexes(normalized))
        || Object.entries(claim.signalIds).some(([id, date]) => manifest.signalIds[id] !== date)
        || Object.entries(claim.dailyMarkIds).some(([id, date]) => manifest.dailyMarkIds[id] !== date)) {
      return null;
    }
    const ids = claimPublicationIds(claim);
    const publications = await readPublicationsForStage(adapter, generation, ids, now);
    if (!publications || !publications.staged[generation]
        || !samePublicationIds(publications.staged[generation], ids)) return null;
    return committed;
  } catch {
    return null;
  }
}

async function publicationRowsAreDurable(adapter, ids, acceptedSignals, now) {
  const acceptedById = new Map(acceptedSignals.map((signal) => [signal.id, signal]));
  if (acceptedById.size !== acceptedSignals.length
      || JSON.stringify([...acceptedById.keys()].sort()) !== JSON.stringify(ids.signalIds)) {
    return false;
  }
  if (ids.signalIds.length === 0 && ids.dailyMarkIds.length === 0) return true;
  try {
    const manifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
    const manifest = normalizeManifest(manifestRecord?.data);
    const expectedByDate = new Map();
    function expected(date) {
      if (!expectedByDate.has(date)) {
        expectedByDate.set(date, { signalIds: new Set(), dailyMarkIds: new Set() });
      }
      return expectedByDate.get(date);
    }
    for (const id of ids.signalIds) {
      const date = manifest.signalIds[id];
      if (!date) return false;
      expected(date).signalIds.add(id);
    }
    for (const id of ids.dailyMarkIds) {
      const date = manifest.dailyMarkIds[id];
      if (!date) return false;
      expected(date).dailyMarkIds.add(id);
    }
    for (const [date, expectedIds] of expectedByDate) {
      const partitionRecord = await readRecord(adapter, partitionPath(date));
      if (!partitionRecord?.data) return false;
      const partition = normalizePartition(partitionRecord.data, date, now);
      const signalIds = new Set(partition.signals.map((row) => row.id));
      const dailyMarkIds = new Set(partition.dailyMarks.map((row) => row.id));
      if ([...expectedIds.signalIds].some((id) => !signalIds.has(id))
          || [...expectedIds.dailyMarkIds].some((id) => !dailyMarkIds.has(id))) return false;
      const storedSignals = new Map(partition.signals.map((row) => [row.id, row]));
      for (const id of expectedIds.signalIds) {
        if (JSON.stringify(storedSignals.get(id)) !== JSON.stringify(acceptedById.get(id))) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function writeClaimRows(adapter, claim, normalized, now) {
  const groups = new Map();
  function group(date) {
    if (!groups.has(date)) groups.set(date, { signals: [], dailyMarks: [] });
    return groups.get(date);
  }
  for (const row of normalized.signals) group(claim.signalIds[row.id]).signals.push(row);
  for (const row of normalized.dailyMarks) group(claim.dailyMarkIds[row.id]).dailyMarks.push(row);
  const results = [];
  for (const [date, additions] of [...groups.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    const result = await casPartition(adapter, date, additions, now);
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}

async function finalizeManifestClaim(adapter, generation, token, normalized) {
  const indexes = claimIndexes(normalized);
  return casManifestState(adapter, (current) => {
    if (current.maintenance !== null) throw schemaInvalid();
    const claim = current.claims[generation];
    if (!claim || claim.token !== token || !sameClaimIndexes(claim, indexes)) throw schemaInvalid();
    if (claim.state === 'staged') return { skipped: true, data: current };
    const signalIds = { ...current.signalIds };
    const dailyMarkIds = { ...current.dailyMarkIds };
    for (const [id, date] of Object.entries(claim.signalIds)) {
      if ((signalIds[id] && signalIds[id] !== date) || Object.hasOwn(dailyMarkIds, id)) {
        throw schemaInvalid();
      }
      signalIds[id] = date;
    }
    for (const [id, date] of Object.entries(claim.dailyMarkIds)) {
      if ((dailyMarkIds[id] && dailyMarkIds[id] !== date) || Object.hasOwn(signalIds, id)) {
        throw schemaInvalid();
      }
      dailyMarkIds[id] = date;
    }
    const partitions = [...new Set([
      ...current.partitions,
      ...Object.values(claim.signalIds),
      ...Object.values(claim.dailyMarkIds),
    ])].sort();
    return {
      skipped: false,
      data: {
        ...current,
        partitions,
        signalIds,
        dailyMarkIds,
        claims: {
          ...current.claims,
          [generation]: { ...claim, state: 'staged' },
        },
      },
    };
  });
}

async function retirePublishedClaim(adapter, generation, ids) {
  return casManifestState(adapter, (current) => {
    if (current.maintenance !== null) throw schemaInvalid();
    const claim = current.claims[generation];
    if (!claim) return { skipped: true, data: current };
    if (claim.state !== 'staged' || !samePublicationIds(claimPublicationIds(claim), ids)) {
      throw schemaInvalid();
    }
    const claims = { ...current.claims };
    delete claims[generation];
    return { skipped: false, data: { ...current, claims } };
  });
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
    if (date < cutoff) throw schemaInvalid();
    const existingDate = initialManifest.signalIds[signal.id];
    if (Object.hasOwn(initialManifest.dailyMarkIds, signal.id)) {
      return appendFailure('manifest_collision');
    }
    if (existingDate && existingDate !== date) return appendFailure('manifest_collision');
    if (!existingDate) group(date).signals.push(signal);
  }
  for (const mark of normalized.dailyMarks) {
    if (mark.date < cutoff) throw schemaInvalid();
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
      manifestResult = await casManifest(adapter, manifestAdditions, cutoff, now, {
        requireNoMaintenance: true,
      });
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
  const normalized = validateAppendInput({ signals: input.signals, dailyMarks: input.dailyMarks }, now);
  const cutoff = cutoffDate(now);
  if (normalized.signals.some((row) => row.observedAt.slice(0, 10) < cutoff)
      || normalized.dailyMarks.some((row) => row.date < cutoff)) throw schemaInvalid();
  let adapter;
  try {
    adapter = await resolveAdapter(options);
  } catch {
    return appendFailure('journal_configuration_invalid');
  }
  if (!adapter) return appendFailure('journal_configuration_invalid');
  const requestedIds = normalizePublicationIds({
    signalIds: normalized.signals.map((row) => row.id),
    dailyMarkIds: normalized.dailyMarks.map((row) => row.id),
  });
  if (!await readPublicationsForStage(adapter, refreshStartedAt, requestedIds, now)) {
    return appendFailure('publication_collision');
  }
  const acquired = await acquireStageClaim(adapter, refreshStartedAt, normalized, now);
  if (!acquired.ok) return appendFailure(acquired.error);
  const { claim } = acquired;
  if (!await adoptReconciliation(adapter, refreshStartedAt, claim, now)) {
    return appendFailure('publication_collision');
  }
  if (!await readPublicationsForStage(adapter, refreshStartedAt, requestedIds, now)) {
    return appendFailure('publication_collision');
  }
  let partitionResults = [];
  if (claim.state === 'writing') {
    partitionResults = await writeClaimRows(adapter, claim, normalized, now);
    if (partitionResults.some((result) => !result.ok)) {
      return appendFailure(
        'partition_write_failed', partitionResults.map(publicPartitionResult),
      );
    }
  }
  let committed;
  try {
    committed = await rereadClaimRows(adapter, claim, normalized, now);
  } catch {
    return appendFailure('journal_read_failed', partitionResults.map(publicPartitionResult));
  }
  if (!sameCommittedRows(committed, normalized)) {
    return appendFailure('publication_collision', partitionResults.map(publicPartitionResult));
  }
  const manifestResult = await finalizeManifestClaim(
    adapter, refreshStartedAt, claim.token, normalized,
  );
  if (!manifestResult.ok) {
    return appendFailure(
      manifestResult.error,
      partitionResults.map(publicPartitionResult),
      publicManifestResult(manifestResult),
    );
  }
  const ids = claimPublicationIds(claim);
  const staged = await casPublications(adapter, (current) => {
    if (!publicationAllowsStage(current, refreshStartedAt, ids)) throw schemaInvalid();
    const existing = current.staged[refreshStartedAt] ?? current.published[refreshStartedAt];
    if (existing) {
      if (!samePublicationIds(existing, ids)) throw schemaInvalid();
      return { skipped: true, data: current };
    }
    if (Object.entries(current.staged).some(([generation, pending]) => (
      generation !== refreshStartedAt && publicationIdsIntersect(pending, ids)
    ))) throw schemaInvalid();
    return {
      skipped: false,
      data: {
        ...current,
        staged: { ...current.staged, [refreshStartedAt]: ids },
      },
    };
  }, now);
  if (!staged.ok) {
    return appendFailure(
      staged.error,
      partitionResults.map(publicPartitionResult),
      publicManifestResult(manifestResult),
    );
  }
  const verified = await verifyStageAuthority(
    adapter, refreshStartedAt, claim.token, normalized, now,
  );
  if (!verified) {
    return appendFailure(
      'publication_rows_unavailable',
      partitionResults.map(publicPartitionResult),
      publicManifestResult(manifestResult),
    );
  }
  return {
    durableWriteSucceeded: true,
    partitions: partitionResults.map(publicPartitionResult),
    manifest: publicManifestResult(manifestResult),
    ...verified,
  };
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
  let candidateIds;
  let alreadyPublished = false;
  try {
    const record = await readRecord(adapter, JOURNAL_PUBLICATIONS);
    const publications = normalizePublications(record?.data, now);
    candidateIds = publications.staged[refreshStartedAt] ?? publications.published[refreshStartedAt];
    alreadyPublished = Boolean(publications.published[refreshStartedAt]);
  } catch {
    return { durableWriteSucceeded: false, skipped: false, error: 'publication_read_failed' };
  }
  if (!candidateIds) {
    return { durableWriteSucceeded: false, skipped: false, error: 'publication_collision' };
  }
  try {
    const manifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
    const manifest = normalizeManifest(manifestRecord?.data);
    const claim = manifest.claims[refreshStartedAt];
    if (!alreadyPublished && (manifest.maintenance !== null
        || !claim || claim.state !== 'staged'
        || !samePublicationIds(claimPublicationIds(claim), candidateIds))) {
      return { durableWriteSucceeded: false, skipped: false, error: 'publication_rows_unavailable' };
    }
  } catch {
    return { durableWriteSucceeded: false, skipped: false, error: 'publication_rows_unavailable' };
  }
  if (!(await publicationRowsAreDurable(
    adapter, candidateIds, accepted.snapshot.publicSnapshot.signals, now,
  ))) {
    return { durableWriteSucceeded: false, skipped: false, error: 'publication_rows_unavailable' };
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
    if (current.cleanup && (
      Object.hasOwn(current.cleanup.staged, refreshStartedAt)
        || Object.hasOwn(current.cleanup.claims ?? {}, refreshStartedAt)
        || publicationIdsIntersect(cleanupPublicationIds(current.cleanup), candidateIds)
    )) throw schemaInvalid();
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
  if (!published.ok) {
    return { durableWriteSucceeded: false, skipped: false, error: published.error };
  }
  try {
    await retirePublishedClaim(adapter, refreshStartedAt, candidateIds);
  } catch {
    // Publication acceptance is already durable. Pruning retries claim retirement.
  }
  return {
    durableWriteSucceeded: true,
    skipped: published.skipped,
    error: null,
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
  const hasPublicationWatermark = range.publicationThrough !== undefined;
  const publicationThrough = !hasPublicationWatermark
    ? publications.current?.refreshStartedAt ?? null
    : canonicalInstant(range.publicationThrough);
  if (hasPublicationWatermark && (
    publications.current === null
      || publicationThrough > publications.current.refreshStartedAt
  )) throw schemaInvalid();
  const publishedSignalIds = new Set();
  const publishedDailyMarkIds = new Set();
  for (const [generation, ids] of Object.entries(publications.published)) {
    if (publicationThrough === null || generation > publicationThrough) continue;
    for (const id of ids.signalIds) publishedSignalIds.add(id);
    for (const id of ids.dailyMarkIds) publishedDailyMarkIds.add(id);
  }
  const manifestRecord = await readRecord(adapter, JOURNAL_MANIFEST);
  const manifest = retainedManifest(normalizeManifest(manifestRecord?.data), cutoffDate(now));
  const sinceDate = (range.after ?? range.since)?.slice(0, 10) ?? null;
  const throughDate = range.through?.slice(0, 10) ?? manifest.partitions.at(-1) ?? null;
  const dateSelected = (date) => (
    sinceDate !== null && throughDate !== null && date >= sinceDate && date <= throughDate
  );
  const selectedSignalIds = new Map(Object.entries(manifest.signalIds).filter(([id, date]) => (
    publishedSignalIds.has(id) && dateSelected(date)
  )));
  const selectedDailyMarkIds = new Map(Object.entries(manifest.dailyMarkIds).filter(([id, date]) => (
    publishedDailyMarkIds.has(id) && dateSelected(date)
  )));
  const selectedDates = [...new Set([
    ...selectedSignalIds.values(), ...selectedDailyMarkIds.values(),
  ])].sort();
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
      signals.push(signal);
    }
    for (const mark of partition.dailyMarks) {
      if (selectedDailyMarkIds.get(mark.id) !== date) continue;
      if (seenMarks.has(mark.id) || seenSignals.has(mark.id)) throw schemaInvalid();
      seenMarks.add(mark.id);
      dailyMarks.push(mark);
    }
  }
  if ([...selectedSignalIds.keys()].some((id) => !seenSignals.has(id))
      || [...selectedDailyMarkIds.keys()].some((id) => !seenMarks.has(id))) throw schemaInvalid();
  return { manifest, signals, dailyMarks, publicationThrough };
}

function encodeCursor(event, through, publicationThrough) {
  return Buffer.from(JSON.stringify({
    through,
    publicationThrough,
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
    assertSafePlainRecord(decoded, ['through', 'publicationThrough', 'timestamp', 'type', 'id']);
    const through = canonicalInstant(decoded.through);
    const publicationThrough = canonicalInstant(decoded.publicationThrough);
    const timestamp = canonicalInstant(decoded.timestamp);
    if (!['daily_mark', 'signal'].includes(decoded.type)) throw schemaInvalid();
    const id = canonicalJournalCursorId(decoded.id);
    if (through < since || through > normalizedNow(now).toISOString()
        || Date.parse(publicationThrough) > normalizedNow(now).getTime() + 5 * 60_000
        || timestamp < since || timestamp > through) throw schemaInvalid();
    return { through, publicationThrough, timestamp, type: decoded.type, id };
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
  const journal = await readRetainedJournal(adapter, now, {
    since,
    through,
    ...(cursor ? { after: cursor.timestamp, publicationThrough: cursor.publicationThrough } : {}),
  });
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
    nextCursor: hasNext ? encodeCursor(page.at(-1), through, journal.publicationThrough) : null,
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

function sameAbandonmentCurrent(current, expected) {
  if (current === null || expected === null) return current === expected;
  return current.refreshStartedAt === expected.refreshStartedAt
    && current.snapshotDigest === expected.snapshotDigest;
}

function buildPublicationPrunePlan(publications, manifest = null, abandonment = null, now = null) {
  if (abandonment && !publications.cleanup
      && !sameAbandonmentCurrent(publications.current, abandonment.evidence.current)) {
    throw schemaInvalid();
  }
  const droppedEntries = {};
  const retainedStaged = {};
  let abandonmentPending = false;
  for (const [generation, ids] of Object.entries(publications.staged)) {
    const alreadyCleaning = Boolean(publications.cleanup?.staged[generation]);
    const superseded = publications.current !== null
      && generation <= publications.current.refreshStartedAt;
    let explicitlyAbandoned = false;
    if (abandonment && !publications.cleanup && !superseded) {
      if (abandonment.mode === 'exact' && generation === abandonment.generation) {
        const claim = manifest?.claims[generation];
        if (!claim || claim.state !== 'staged'
            || !samePublicationIds(claimPublicationIds(claim), ids)) throw schemaInvalid();
        explicitlyAbandoned = true;
      } else if (abandonment.mode === 'expired' && generation <= abandonment.through) {
        const claim = manifest?.claims[generation];
        if (claim) {
          if (claim.state !== 'staged'
              || !samePublicationIds(claimPublicationIds(claim), ids)) throw schemaInvalid();
          if (claimPastReclaimGrace(claim, now)) explicitlyAbandoned = true;
          else abandonmentPending = true;
        } else if (now.getTime() > Date.parse(generation) + CLAIM_LEASE_MS + CLAIM_RECLAIM_GRACE_MS) {
          explicitlyAbandoned = true;
        } else {
          abandonmentPending = true;
        }
      }
    }
    if (alreadyCleaning || superseded || explicitlyAbandoned) droppedEntries[generation] = ids;
    else retainedStaged[generation] = ids;
  }
  if (abandonment?.mode === 'exact' && !publications.cleanup
      && !Object.hasOwn(droppedEntries, abandonment.generation)) throw schemaInvalid();
  const abandonedClaimGenerations = new Set(Object.keys(publications.cleanup?.claims ?? {}));
  if (abandonment?.mode === 'expired' && !publications.cleanup) {
    for (const [generation, claim] of Object.entries(manifest?.claims ?? {})) {
      if (generation > abandonment.through
          || publications.current?.refreshStartedAt === generation
          || Object.hasOwn(publications.published, generation)
          || Object.hasOwn(publications.staged, generation)) continue;
      if (claimPastReclaimGrace(claim, now)) abandonedClaimGenerations.add(generation);
      else abandonmentPending = true;
    }
  }
  const retainedIds = publicationIds(retainedStaged);
  const publishedIds = publicationIds(publications.published);
  const droppedIds = publicationIds(droppedEntries);
  return {
    droppedEntries,
    publishedEntries: publications.published,
    currentGeneration: publications.current?.refreshStartedAt ?? null,
    removedSignalIds: [...droppedIds.signalIds].filter((id) => (
      !retainedIds.signalIds.has(id) && !publishedIds.signalIds.has(id)
    )).sort(),
    removedDailyMarkIds: [...droppedIds.dailyMarkIds].filter((id) => (
      !retainedIds.dailyMarkIds.has(id) && !publishedIds.dailyMarkIds.has(id)
    )).sort(),
    protectedSignalIds: [...retainedIds.signalIds].sort(),
    protectedDailyMarkIds: [...retainedIds.dailyMarkIds].sort(),
    abandonedClaimGenerations,
    abandonmentPending,
  };
}

async function discoverCleanupMappings(adapter, manifest, signalIds, dailyMarkIds, now) {
  const signalDates = Object.fromEntries(signalIds.flatMap((id) => (
    manifest.signalIds[id] ? [[id, manifest.signalIds[id]]] : []
  )));
  const dailyMarkDates = Object.fromEntries(dailyMarkIds.flatMap((id) => (
    manifest.dailyMarkIds[id] ? [[id, manifest.dailyMarkIds[id]]] : []
  )));
  const missingSignals = new Set(signalIds.filter((id) => !signalDates[id]));
  const missingDailyMarks = new Set(dailyMarkIds.filter((id) => !dailyMarkDates[id]));
  if (missingSignals.size === 0 && missingDailyMarks.size === 0) {
    return { signalIds: signalDates, dailyMarkIds: dailyMarkDates };
  }
  if (typeof adapter.list !== 'function') throw journalError('journal_read_failed');
  const pathnames = await adapter.list(JOURNAL_PREFIX);
  for (const pathname of pathnames) {
    if (missingSignals.size === 0 && missingDailyMarks.size === 0) break;
    const match = new RegExp(`^${JOURNAL_PREFIX.replaceAll('/', '\\/')}(\\d{4}-\\d{2}-\\d{2})\\.json$`).exec(pathname);
    if (!match) continue;
    let date;
    try {
      date = canonicalDate(match[1]);
    } catch {
      continue;
    }
    const record = await readRecord(adapter, pathname);
    if (!record?.data) continue;
    const partition = normalizePartition(record.data, date, now);
    for (const row of partition.signals) {
      if (missingSignals.delete(row.id)) signalDates[row.id] = date;
    }
    for (const row of partition.dailyMarks) {
      if (missingDailyMarks.delete(row.id)) dailyMarkDates[row.id] = date;
    }
  }
  return { signalIds: signalDates, dailyMarkIds: dailyMarkDates };
}

function planClaimFences(manifest, publicationPlan, now) {
  const targetClaims = {};
  const fencedClaims = {};
  const publishedIds = publicationIds(publicationPlan.publishedEntries);
  const protectedByPublication = {
    signalIds: new Set([...publishedIds.signalIds, ...publicationPlan.protectedSignalIds]),
    dailyMarkIds: new Set([...publishedIds.dailyMarkIds, ...publicationPlan.protectedDailyMarkIds]),
  };
  for (const [generation, claim] of Object.entries(manifest.claims)) {
    const published = publicationPlan.publishedEntries[generation];
    if (published && !samePublicationIds(published, claimPublicationIds(claim))) throw schemaInvalid();
    const shouldFence = claim.state === 'writing'
      ? claimPastReclaimGrace(claim, now)
        || publicationPlan.abandonedClaimGenerations.has(generation)
      : Boolean(publicationPlan.publishedEntries[generation])
        || Boolean(publicationPlan.droppedEntries[generation])
        || publicationPlan.abandonedClaimGenerations.has(generation)
        || (publicationPlan.currentGeneration !== null
          && generation <= publicationPlan.currentGeneration
          && !publicationPlan.publishedEntries[generation]);
    if (!shouldFence) continue;
    targetClaims[generation] = claim;
    fencedClaims[generation] = {
      ...claim,
      token: claimToken(),
      state: 'writing',
      claimedAt: now.toISOString(),
      leaseUntil: new Date(now.getTime() + CLAIM_LEASE_MS).toISOString(),
    };
  }
  const targetGenerations = new Set(Object.keys(targetClaims));
  const otherClaims = Object.entries(manifest.claims).filter(([generation]) => (
    !targetGenerations.has(generation)
  ));
  const signalIds = {};
  const dailyMarkIds = {};
  for (const claim of Object.values(targetClaims)) {
    for (const [id, date] of Object.entries(claim.signalIds)) {
      if (!protectedByPublication.signalIds.has(id)
          && !otherClaims.some(([, other]) => other.signalIds[id] === date)) signalIds[id] = date;
    }
    for (const [id, date] of Object.entries(claim.dailyMarkIds)) {
      if (!protectedByPublication.dailyMarkIds.has(id)
          && !otherClaims.some(([, other]) => other.dailyMarkIds[id] === date)) dailyMarkIds[id] = date;
    }
  }
  return { targetClaims, fencedClaims, signalIds, dailyMarkIds };
}

async function preparePublicationPrune(adapter, manifest, now, abandonment = null) {
  const prepared = await casPublications(adapter, (current) => {
    const plan = buildPublicationPrunePlan(current, manifest, abandonment, now);
    if (plan.abandonmentPending && !current.cleanup) {
      return { skipped: true, data: current };
    }
    const claimPlan = planClaimFences(manifest, plan, now);
    const needsCleanup = current.cleanup
      || Object.keys(plan.droppedEntries).length > 0
      || Object.keys(claimPlan.fencedClaims).length > 0;
    if (!needsCleanup) {
      return { skipped: true, data: current };
    }
    const cleanup = current.cleanup ?? {
      staged: plan.droppedEntries,
      claims: claimPlan.fencedClaims,
      signalIds: {
        ...Object.fromEntries(plan.removedSignalIds.flatMap((id) => (
        manifest.signalIds[id] ? [[id, manifest.signalIds[id]]] : []
        ))),
        ...claimPlan.signalIds,
      },
      dailyMarkIds: {
        ...Object.fromEntries(plan.removedDailyMarkIds.flatMap((id) => (
        manifest.dailyMarkIds[id] ? [[id, manifest.dailyMarkIds[id]]] : []
        ))),
        ...claimPlan.dailyMarkIds,
      },
    };
    const reconciliation = {
      signalIds: { ...current.reconciliation?.signalIds, ...cleanup.signalIds },
      dailyMarkIds: { ...current.reconciliation?.dailyMarkIds, ...cleanup.dailyMarkIds },
    };
    const next = { ...current, cleanup, reconciliation };
    return JSON.stringify(next) === JSON.stringify(current)
      ? { skipped: true, data: current }
      : { skipped: false, data: next };
  }, now);
  if (!prepared.ok) return { ok: false };
  let preparedData = prepared.data;
  let plan = buildPublicationPrunePlan(preparedData, manifest, abandonment, now);
  if (plan.abandonmentPending && !preparedData.cleanup) return { ok: false, pending: true };
  if (!preparedData.cleanup) {
    return {
      ok: true,
      ...plan,
      reconciliation: preparedData.reconciliation ?? { signalIds: {}, dailyMarkIds: {} },
      claimTargets: {},
    };
  }
  let discovered;
  try {
    discovered = await discoverCleanupMappings(
      adapter, manifest, plan.removedSignalIds, plan.removedDailyMarkIds, now,
    );
  } catch {
    return { ok: false };
  }
  const enriched = await casPublications(adapter, (current) => {
    if (!current.cleanup
        || JSON.stringify(current.cleanup.staged) !== JSON.stringify(preparedData.cleanup.staged)) {
      throw schemaInvalid();
    }
    const cleanup = {
      ...current.cleanup,
      signalIds: { ...current.cleanup.signalIds, ...discovered.signalIds },
      dailyMarkIds: { ...current.cleanup.dailyMarkIds, ...discovered.dailyMarkIds },
    };
    const reconciliation = {
      signalIds: { ...current.reconciliation?.signalIds, ...cleanup.signalIds },
      dailyMarkIds: { ...current.reconciliation?.dailyMarkIds, ...cleanup.dailyMarkIds },
    };
    if (JSON.stringify(cleanup) === JSON.stringify(current.cleanup)
        && JSON.stringify(reconciliation) === JSON.stringify(current.reconciliation)) {
      return { skipped: true, data: current };
    }
    return { skipped: false, data: { ...current, cleanup, reconciliation } };
  }, now);
  if (!enriched.ok) return { ok: false };
  preparedData = enriched.data;
  plan = buildPublicationPrunePlan(preparedData, manifest, abandonment, now);
  return {
    ok: true,
    ...plan,
    droppedEntries: preparedData.cleanup.staged,
    removedSignalIds: Object.keys(preparedData.cleanup.signalIds),
    removedDailyMarkIds: Object.keys(preparedData.cleanup.dailyMarkIds),
    cleanup: preparedData.cleanup,
    reconciliation: preparedData.reconciliation ?? { signalIds: {}, dailyMarkIds: {} },
    claimTargets: Object.fromEntries(Object.keys(preparedData.cleanup.claims ?? {}).flatMap((generation) => (
      manifest.claims[generation] ? [[generation, manifest.claims[generation]]] : []
    ))),
  };
}

async function compactPublicationMetadata(adapter, plan, now) {
  const removedSignalIds = new Set(plan.compactedSignalIds ?? []);
  const removedDailyMarkIds = new Set(plan.compactedDailyMarkIds ?? []);
  return casPublications(adapter, (current) => {
    if (plan.cleanup
        && JSON.stringify(current.cleanup) !== JSON.stringify(plan.cleanup)) throw schemaInvalid();
    if (!plan.cleanup && current.cleanup) throw schemaInvalid();
    const staged = { ...current.staged };
    for (const [generation, expected] of Object.entries(plan.droppedEntries)) {
      if (staged[generation] && !samePublicationIds(staged[generation], expected)) {
        throw schemaInvalid();
      }
      delete staged[generation];
    }
    const published = {};
    for (const [generation, entry] of Object.entries(current.published)) {
      const expected = plan.publishedEntries[generation];
      if (!expected) {
        published[generation] = entry;
        continue;
      }
      if (JSON.stringify(expected) !== JSON.stringify(entry)) throw schemaInvalid();
      if (generation === current.current?.refreshStartedAt) {
        published[generation] = entry;
        continue;
      }
      const compacted = {
        signalIds: entry.signalIds.filter((id) => !removedSignalIds.has(id)),
        dailyMarkIds: entry.dailyMarkIds.filter((id) => !removedDailyMarkIds.has(id)),
        snapshotDigest: entry.snapshotDigest,
      };
      if (compacted.signalIds.length > 0 || compacted.dailyMarkIds.length > 0) {
        published[generation] = compacted;
      }
    }
    const { cleanup: _cleanup, reconciliation: _reconciliation, ...withoutCleanup } = current;
    const reconciliation = current.reconciliation ? {
      signalIds: Object.fromEntries(Object.entries(current.reconciliation.signalIds).filter(([, date]) => (
        date >= plan.cutoff
      ))),
      dailyMarkIds: Object.fromEntries(Object.entries(current.reconciliation.dailyMarkIds).filter(([, date]) => (
        date >= plan.cutoff
      ))),
    } : null;
    const next = {
      ...withoutCleanup,
      staged,
      published,
      ...(reconciliation && (
        Object.keys(reconciliation.signalIds).length > 0
          || Object.keys(reconciliation.dailyMarkIds).length > 0
      ) ? { reconciliation } : {}),
    };
    return JSON.stringify(next) === JSON.stringify(current)
      ? { skipped: true, data: current }
      : { skipped: false, data: next };
  }, now);
}

async function fenceManifestCleanupClaims(adapter, maintenanceToken, plan) {
  const fencedClaims = plan.cleanup?.claims ?? {};
  if (Object.keys(fencedClaims).length === 0) {
    const record = await readRecord(adapter, JOURNAL_MANIFEST);
    const manifest = normalizeManifest(record?.data);
    return manifest.maintenance?.token === maintenanceToken
      ? { ok: true, data: manifest }
      : { ok: false };
  }
  return casManifestState(adapter, (current) => {
    if (current.maintenance?.token !== maintenanceToken) throw schemaInvalid();
    const claims = { ...current.claims };
    for (const [generation, fenced] of Object.entries(fencedClaims)) {
      const existing = claims[generation];
      const expected = plan.claimTargets[generation];
      if (existing && JSON.stringify(existing) === JSON.stringify(fenced)) continue;
      if (!existing && !expected) continue;
      if (!existing || !expected || JSON.stringify(existing) !== JSON.stringify(expected)) {
        throw schemaInvalid();
      }
      claims[generation] = fenced;
    }
    return { skipped: false, data: { ...current, claims } };
  });
}

async function removeFencedManifestClaims(adapter, maintenanceToken, cleanupClaims) {
  if (Object.keys(cleanupClaims).length === 0) return { ok: true };
  return casManifestState(adapter, (current) => {
    if (current.maintenance?.token !== maintenanceToken) throw schemaInvalid();
    const claims = { ...current.claims };
    for (const [generation, fenced] of Object.entries(cleanupClaims)) {
      if (!claims[generation]) continue;
      if (JSON.stringify(claims[generation]) !== JSON.stringify(fenced)) {
        throw schemaInvalid();
      }
      delete claims[generation];
    }
    return { skipped: false, data: { ...current, claims } };
  });
}

async function restoreManifestRetryMappings(
  adapter, manifest, signalIds, dailyMarkIds, cutoff, now, maintenanceToken,
) {
  const additions = { partitions: [], signalIds: {}, dailyMarkIds: {} };
  const partitions = new Set();
  for (const id of signalIds) {
    const date = manifest.signalIds[id];
    if (date && date >= cutoff) {
      additions.signalIds[id] = date;
      partitions.add(date);
    }
  }
  for (const id of dailyMarkIds) {
    const date = manifest.dailyMarkIds[id];
    if (date && date >= cutoff) {
      additions.dailyMarkIds[id] = date;
      partitions.add(date);
    }
  }
  additions.partitions = [...partitions].sort();
  if (additions.partitions.length === 0) return true;
  const restored = await casManifest(adapter, additions, cutoff, now, {
    expectedMaintenanceToken: maintenanceToken,
  });
  return restored.ok;
}

async function abandonmentSatisfied(adapter, abandonment, now) {
  if (!abandonment) return { ok: true, pending: false };
  try {
    const [manifestRecord, publicationRecord] = await Promise.all([
      readRecord(adapter, JOURNAL_MANIFEST),
      readRecord(adapter, JOURNAL_PUBLICATIONS),
    ]);
    const manifest = normalizeManifest(manifestRecord?.data);
    const publications = normalizePublications(publicationRecord?.data, now);
    if (!sameAbandonmentCurrent(publications.current, abandonment.evidence.current)) {
      return { ok: false, pending: false };
    }
    if (abandonment.mode === 'exact') {
      if (publications.current?.refreshStartedAt === abandonment.generation
          || Object.hasOwn(publications.published, abandonment.generation)) {
        return { ok: false, pending: false };
      }
      const pending = Object.hasOwn(publications.staged, abandonment.generation)
        || Object.hasOwn(manifest.claims, abandonment.generation);
      return { ok: !pending, pending };
    }
    const pendingStage = Object.keys(publications.staged).some((generation) => (
      generation <= abandonment.through
        && (publications.current === null || generation > publications.current.refreshStartedAt)
    ));
    const pendingClaim = Object.keys(manifest.claims).some((generation) => (
      generation <= abandonment.through
        && publications.current?.refreshStartedAt !== generation
        && !Object.hasOwn(publications.published, generation)
    ));
    const pending = pendingStage || pendingClaim;
    return { ok: !pending, pending };
  } catch {
    return { ok: false, pending: false };
  }
}

export async function pruneJournal(input, options = {}) {
  assertSafePlainRecord(input, ['now', 'abandonment'], ['now']);
  const now = normalizedNow(input.now);
  const abandonment = normalizeAbandonment(input.abandonment, now);
  function decorateAbandonment(result, status = { ok: false, pending: false }) {
    if (!abandonment) return result;
    const ok = status.ok === true;
    const pending = !ok && status.pending === true;
    return {
      ...result,
      abandonment: {
        ok,
        pending,
        error: ok ? null : pending ? 'journal_generation_pending' : 'journal_reconciliation_failed',
      },
    };
  }
  const cutoff = cutoffDate(now);
  const adapter = await resolveAdapter(options);
  if (!adapter) {
    return decorateAbandonment({
      durableWriteSucceeded: false,
      partitions: [],
      manifest: { ok: false, error: 'journal_configuration_invalid' },
    });
  }
  const maintenance = await acquireManifestMaintenance(adapter, now);
  if (!maintenance.ok) {
    return decorateAbandonment({
      durableWriteSucceeded: false,
      partitions: [],
      manifest: { ok: false, error: 'manifest_write_failed' },
    });
  }
  async function finish(result) {
    const status = await abandonmentSatisfied(adapter, abandonment, now);
    const cleared = await clearManifestMaintenance(adapter, maintenance.token);
    const targetResult = status.ok ? result : { ...result, durableWriteSucceeded: false };
    const finalResult = cleared.ok
      ? targetResult
      : { ...targetResult, durableWriteSucceeded: false };
    return decorateAbandonment(
      finalResult,
      cleared.ok ? status : { ok: false, pending: status.pending || status.ok },
    );
  }
  let current = maintenance.manifest;
  const publicationPlan = await preparePublicationPrune(adapter, current, now, abandonment);
  if (!publicationPlan.ok) {
    return finish({
      durableWriteSucceeded: false,
      partitions: [],
      manifest: { ok: false, error: 'publication_write_failed' },
    });
  }
  const fenced = await fenceManifestCleanupClaims(adapter, maintenance.token, publicationPlan);
  if (!fenced.ok) {
    return finish({
      durableWriteSucceeded: false,
      partitions: [],
      manifest: { ok: false, error: 'manifest_write_failed' },
    });
  }
  current = fenced.data;
  const reconciliation = publicationPlan.reconciliation ?? { signalIds: {}, dailyMarkIds: {} };
  const removedSignalIds = new Set([
    ...publicationPlan.removedSignalIds, ...Object.keys(reconciliation.signalIds),
  ]);
  const removedDailyMarkIds = new Set([
    ...publicationPlan.removedDailyMarkIds, ...Object.keys(reconciliation.dailyMarkIds),
  ]);
  const cleanupSignalDates = {
    ...reconciliation.signalIds,
    ...publicationPlan.cleanup?.signalIds,
  };
  const cleanupDailyMarkDates = {
    ...reconciliation.dailyMarkIds,
    ...publicationPlan.cleanup?.dailyMarkIds,
  };
  const protectedSignalIds = new Set(publicationPlan.protectedSignalIds);
  const protectedDailyMarkIds = new Set(publicationPlan.protectedDailyMarkIds);
  const ignoredClaimGenerations = new Set(Object.keys(publicationPlan.cleanup?.claims ?? {}));
  const protectedDates = new Set([
    ...[...protectedSignalIds].map((id) => current.signalIds[id]).filter(Boolean),
    ...[...protectedDailyMarkIds].map((id) => current.dailyMarkIds[id]).filter(Boolean),
  ]);
  for (const [generation, claim] of Object.entries(current.claims)) {
    if (ignoredClaimGenerations.has(generation)) continue;
    for (const [id, date] of Object.entries(claim.signalIds)) {
      protectedSignalIds.add(id);
      protectedDates.add(date);
    }
    for (const [id, date] of Object.entries(claim.dailyMarkIds)) {
      protectedDailyMarkIds.add(id);
      protectedDates.add(date);
    }
  }
  for (const id of protectedSignalIds) removedSignalIds.delete(id);
  for (const id of protectedDailyMarkIds) removedDailyMarkIds.delete(id);
  const expired = current.partitions.filter((date) => date < cutoff && !protectedDates.has(date));
  const expiredDates = new Set(expired);
  publicationPlan.cutoff = cutoff;
  publicationPlan.compactedSignalIds = [...new Set([
    ...publicationPlan.removedSignalIds,
    ...Object.entries(current.signalIds).flatMap(([id, date]) => expiredDates.has(date) ? [id] : []),
    ...Object.values(publicationPlan.publishedEntries).flatMap((entry) => (
      entry.signalIds.filter((id) => !Object.hasOwn(current.signalIds, id))
    )),
  ])].sort();
  publicationPlan.compactedDailyMarkIds = [...new Set([
    ...publicationPlan.removedDailyMarkIds,
    ...Object.entries(current.dailyMarkIds).flatMap(([id, date]) => expiredDates.has(date) ? [id] : []),
    ...Object.values(publicationPlan.publishedEntries).flatMap((entry) => (
      entry.dailyMarkIds.filter((id) => !Object.hasOwn(current.dailyMarkIds, id))
    )),
  ])].sort();
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
      ignoredClaimGenerations,
      expectedMaintenanceToken: maintenance.token,
    },
  );
  if (!manifestResult.ok) {
    return finish({
      durableWriteSucceeded: false,
      partitions: [],
      manifest: publicManifestResult(manifestResult),
    });
  }
  const referenced = new Set(manifestResult.data.partitions);
  const cleanupDates = new Set(
    current.partitions.filter((date) => !referenced.has(date)),
  );
  for (const date of [...Object.values(cleanupSignalDates), ...Object.values(cleanupDailyMarkDates)]) {
    if (!referenced.has(date)) cleanupDates.add(date);
  }
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
      await restoreManifestRetryMappings(
        adapter, current, removedSignalIds, removedDailyMarkIds, cutoff, now, maintenance.token,
      );
      return finish({
        durableWriteSucceeded: false,
        partitions: [],
        manifest: publicManifestResult(manifestResult),
      });
    }
  }
  const partitionResults = [];
  const failedSignalIds = new Set();
  const failedDailyMarkIds = new Set();
  const rowRemovalsByDate = new Map();
  function removalsFor(date) {
    if (!rowRemovalsByDate.has(date)) {
      rowRemovalsByDate.set(date, { signalIds: new Set(), dailyMarkIds: new Set() });
    }
    return rowRemovalsByDate.get(date);
  }
  for (const id of removedSignalIds) {
    const date = cleanupSignalDates[id] ?? current.signalIds[id];
    if (date && referenced.has(date)) removalsFor(date).signalIds.add(id);
  }
  for (const id of removedDailyMarkIds) {
    const date = cleanupDailyMarkDates[id] ?? current.dailyMarkIds[id];
    if (date && referenced.has(date)) removalsFor(date).dailyMarkIds.add(id);
  }
  for (const [date, removals] of [...rowRemovalsByDate.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    let ok = false;
    try {
      ok = await removePartitionRows(adapter, date, removals, now, maintenance.token);
    } catch {
      ok = false;
    }
    if (!ok) {
      for (const id of removals.signalIds) failedSignalIds.add(id);
      for (const id of removals.dailyMarkIds) failedDailyMarkIds.add(id);
    }
    partitionResults.push({
      date,
      ok,
      error: ok ? null : 'partition_delete_failed',
    });
  }
  for (const date of [...cleanupDates].sort()) {
    try {
      if (!await manifestMaintenanceOwned(adapter, maintenance.token)) {
        throw journalError('partition_delete_failed');
      }
      const record = await adapter.read(partitionPath(date));
      if (record?.data && typeof adapter.delete !== 'function') throw journalError('partition_delete_failed');
      if (record?.data) {
        if (!await manifestMaintenanceOwned(adapter, maintenance.token)) {
          throw journalError('partition_delete_failed');
        }
        await adapter.delete(partitionPath(date), record.etag ?? null);
      }
      partitionResults.push({ date, ok: true, ...(record?.data ? {} : { skipped: true }), error: null });
    } catch {
      for (const id of removedSignalIds) {
        if ((cleanupSignalDates[id] ?? current.signalIds[id]) === date) failedSignalIds.add(id);
      }
      for (const id of removedDailyMarkIds) {
        if ((cleanupDailyMarkDates[id] ?? current.dailyMarkIds[id]) === date) failedDailyMarkIds.add(id);
      }
      partitionResults.push({ date, ok: false, error: 'partition_delete_failed' });
    }
  }
  const partitionsOk = partitionResults.every((result) => result.ok);
  if (!partitionsOk) {
    await restoreManifestRetryMappings(
      adapter, current, failedSignalIds, failedDailyMarkIds, cutoff, now, maintenance.token,
    );
    return finish({
      durableWriteSucceeded: false,
      partitions: partitionResults,
      manifest: publicManifestResult(manifestResult),
    });
  }
  const removedClaims = await removeFencedManifestClaims(
    adapter, maintenance.token, publicationPlan.cleanup?.claims ?? {},
  );
  if (!removedClaims.ok) {
    return finish({
      durableWriteSucceeded: false,
      partitions: partitionResults,
      manifest: publicManifestResult(manifestResult),
    });
  }
  const publicationsResult = await compactPublicationMetadata(
    adapter, publicationPlan, now,
  );
  if (!publicationsResult.ok) {
    return finish({
      durableWriteSucceeded: false,
      partitions: partitionResults,
      manifest: publicManifestResult(manifestResult),
    });
  }
  return finish({
    durableWriteSucceeded: manifestResult.ok && publicationsResult.ok,
    partitions: partitionResults,
    manifest: publicManifestResult(manifestResult),
  });
}

export const SMART_MONEY_JOURNAL_NAMESPACES = Object.freeze({
  prefix: JOURNAL_PREFIX,
  manifest: JOURNAL_MANIFEST,
  publications: JOURNAL_PUBLICATIONS,
  retentionDays: JOURNAL_RETENTION_DAYS,
});
