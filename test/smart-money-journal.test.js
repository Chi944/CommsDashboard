import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  appendJournal,
  listTrackedTickers,
  pruneJournal,
  readJournal,
} from '../lib/smart-money/journal.js';
import { SIGNAL, memoryJournalAdapter } from './fixtures/smart-money/journal.js';

const MANIFEST = 'smart-money/v1/journal/manifest.json';
const PARTITION = 'smart-money/v1/journal/2026-08-26.json';

function signalAt(id, observedAt, ticker = 'BTC') {
  const observedMs = Date.parse(observedAt);
  return {
    ...structuredClone(SIGNAL),
    id,
    activityId: `activity:${id}`,
    asset: {
      ...SIGNAL.asset,
      ticker,
      name: ticker,
      providerSymbol: ticker,
      assetClass: ticker === 'SPX' ? 'equity' : 'crypto',
    },
    effectiveAt: new Date(observedMs - 300_000).toISOString(),
    observedAt,
    referencePrice: {
      ...SIGNAL.referencePrice,
      ticker,
      asOf: observedAt,
      retrievedAt: new Date(observedMs + 1_000).toISOString(),
    },
  };
}

function dailyMark(date = '2026-08-26', ticker = 'BTC') {
  return {
    id: `${date}:${ticker}`,
    date,
    ticker,
    assetClass: ticker === 'SPX' ? 'equity' : 'crypto',
    kind: ['SPX', 'BTC'].includes(ticker) ? 'benchmark' : 'asset',
    price: ticker === 'BTC' ? 100_000 : 5_000,
    currency: 'USD',
    source: 'yahoo',
    asOf: `${date}T20:00:00.000Z`,
    retrievedAt: `${date}T20:00:01.000Z`,
  };
}

test('journal append returns the exact durable contract and rereads committed rows', async () => {
  const adapter = memoryJournalAdapter();
  const mark = dailyMark();
  const result = await appendJournal({ signals: [SIGNAL], dailyMarks: [mark] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(result.committedSignals, [SIGNAL]);
  assert.deepEqual(result.committedDailyMarks, [mark]);
  assert.deepEqual(adapter.paths(), [PARTITION, MANIFEST]);
});

test('journal retry preserves the original immutable signal and reference price', async () => {
  const adapter = memoryJournalAdapter();
  await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });
  const retry = await appendJournal({
    signals: [{
      ...SIGNAL,
      referencePrice: { ...SIGNAL.referencePrice, price: SIGNAL.referencePrice.price + 5_000 },
    }],
    dailyMarks: [],
  }, { adapter });
  const result = await readJournal({
    since: SIGNAL.observedAt,
    limit: 200,
  }, { adapter, now: new Date('2026-08-27T00:00:00.000Z') });
  assert.deepEqual(result.signals.map((row) => row.id), [SIGNAL.id]);
  assert.equal(retry.committedSignals[0].referencePrice.price, SIGNAL.referencePrice.price);
});

test('journal retry preserves the original immutable completed daily mark', async () => {
  const adapter = memoryJournalAdapter();
  const original = dailyMark();
  await appendJournal({ signals: [], dailyMarks: [original] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  const retry = await appendJournal({
    signals: [], dailyMarks: [{ ...original, price: original.price + 5_000 }],
  }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(retry.committedDailyMarks[0].price, original.price);
});

test('concurrent daily-mark writers return the first durable close to every contender', async () => {
  const original = dailyMark();
  const drifted = { ...original, price: original.price + 5_000 };
  let announceDrift;
  let releaseDrift;
  let blocked = false;
  const driftReached = new Promise((resolve) => { announceDrift = resolve; });
  const driftGate = new Promise((resolve) => { releaseDrift = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!blocked && pathname === PARTITION && data.dailyMarks[0]?.price === drifted.price) {
        blocked = true;
        announceDrift();
        await driftGate;
      }
    },
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const driftWrite = appendJournal({ signals: [], dailyMarks: [drifted] }, options);
  await driftReached;
  const firstCommit = await appendJournal({ signals: [], dailyMarks: [original] }, options);
  releaseDrift();
  const contender = await driftWrite;
  assert.equal(firstCommit.committedDailyMarks[0].price, original.price);
  assert.equal(contender.committedDailyMarks[0].price, original.price);
});

test('concurrent journal writers CAS-merge distinct rows in one partition and manifest', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt('hyperliquid-account-details:a', '2026-08-26T01:00:00.000Z');
  const second = signalAt('hyperliquid-account-details:b', '2026-08-26T01:00:00.000Z');
  const [left, right] = await Promise.all([
    appendJournal({ signals: [first], dailyMarks: [] }, { adapter }),
    appendJournal({ signals: [second], dailyMarks: [] }, { adapter }),
  ]);
  const history = await readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 200 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.equal(left.durableWriteSucceeded, true);
  assert.equal(right.durableWriteSucceeded, true);
  assert.deepEqual(history.signals.map((row) => row.id), [first.id, second.id]);
});

test('partition or manifest partial failures never report durable success or leak diagnostics', async () => {
  const partitionFailureAdapter = memoryJournalAdapter();
  partitionFailureAdapter.failNext(PARTITION);
  const partitionFailure = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, {
    adapter: partitionFailureAdapter,
  });
  assert.equal(partitionFailure.durableWriteSucceeded, false);
  assert.deepEqual(partitionFailure.committedSignals, []);
  assert.deepEqual(partitionFailure.committedDailyMarks, []);
  assert.equal(JSON.stringify(partitionFailure).includes('secret'), false);

  const manifestFailureAdapter = memoryJournalAdapter();
  manifestFailureAdapter.failNext(MANIFEST);
  const manifestFailure = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, {
    adapter: manifestFailureAdapter,
  });
  assert.equal(manifestFailure.durableWriteSucceeded, false);
  assert.equal(manifestFailureAdapter.inspect(PARTITION).signals.length, 1);
  assert.deepEqual(manifestFailure.committedSignals, []);
  assert.deepEqual(manifestFailure.committedDailyMarks, []);
  assert.equal(JSON.stringify(manifestFailure).includes('secret'), false);
});

test('journal reread failure returns no committed rows after partition and manifest writes', async () => {
  const memory = memoryJournalAdapter();
  let manifestReads = 0;
  const adapter = {
    ...memory,
    async read(pathname) {
      if (pathname === MANIFEST) {
        manifestReads += 1;
        if (manifestReads === 4) throw new Error('reread failed with secret=never-return');
      }
      return memory.read(pathname);
    },
  };
  const result = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });
  assert.equal(result.durableWriteSucceeded, false);
  assert.deepEqual(result.committedSignals, []);
  assert.deepEqual(result.committedDailyMarks, []);
  assert.equal(JSON.stringify(result).includes('never-return'), false);

  const corruptMemory = memoryJournalAdapter();
  let partitionReads = 0;
  const corruptRereadAdapter = {
    ...corruptMemory,
    async read(pathname) {
      if (pathname === PARTITION) {
        partitionReads += 1;
        if (partitionReads === 3) {
          return {
            data: { schemaVersion: 1, date: '2026-08-26', signals: 'private-corruption' },
            etag: 'corrupt',
          };
        }
      }
      return corruptMemory.read(pathname);
    },
  };
  const corruptResult = await appendJournal(
    { signals: [SIGNAL], dailyMarks: [] },
    { adapter: corruptRereadAdapter },
  );
  assert.equal(corruptResult.durableWriteSucceeded, false);
  assert.deepEqual(corruptResult.committedSignals, []);
  assert.deepEqual(corruptResult.committedDailyMarks, []);
  assert.equal(JSON.stringify(corruptResult).includes('private-corruption'), false);
});

test('concurrently corrupt manifest normalization returns the exact nondurable append envelope', async () => {
  let adapter;
  let corrupted = false;
  adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname }) => {
      if (!corrupted && pathname === MANIFEST) {
        corrupted = true;
        adapter.seed(MANIFEST, {
          schemaVersion: 1,
          partitions: ['2026-13-40'],
          signalIds: { 'private-secret-id': '2026-13-40' },
          dailyMarkIds: {},
        });
      }
    },
  });

  const result = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });

  assert.deepEqual(Object.keys(result).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(result.durableWriteSucceeded, false);
  assert.deepEqual(result.committedSignals, []);
  assert.deepEqual(result.committedDailyMarks, []);
  assert.deepEqual(result.partitions, [{ date: '2026-08-26', ok: true, error: null }]);
  assert.deepEqual(result.manifest, { ok: false, error: 'manifest_write_failed' });
  assert.equal(adapter.inspect(PARTITION).signals[0].id, SIGNAL.id);
  assert.equal(JSON.stringify(result).includes('private-secret-id'), false);
});

test('concurrent same-ID signal and daily mark contention returns a nondurable loser envelope', async () => {
  const mark = dailyMark('2026-08-26', 'ETH');
  const contender = signalAt(mark.id, '2026-08-26T19:00:00.000Z', 'ETH');
  let announceContender;
  let releaseContender;
  let blocked = false;
  const contenderAtPartition = new Promise((resolve) => { announceContender = resolve; });
  const contenderGate = new Promise((resolve) => { releaseContender = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!blocked && pathname === PARTITION
          && data.signals.some((row) => row.id === contender.id)) {
        blocked = true;
        announceContender();
        await contenderGate;
      }
    },
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const contenderWrite = appendJournal({ signals: [contender], dailyMarks: [] }, options);
  await contenderAtPartition;
  const winner = await appendJournal({ signals: [], dailyMarks: [mark] }, options);
  releaseContender();
  const loser = await contenderWrite;

  assert.equal(winner.durableWriteSucceeded, true);
  assert.deepEqual(Object.keys(loser).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(loser.durableWriteSucceeded, false);
  assert.deepEqual(loser.committedSignals, []);
  assert.deepEqual(loser.committedDailyMarks, []);
  assert.deepEqual(loser.partitions, [
    { date: '2026-08-26', ok: false, error: 'partition_write_failed' },
  ]);
  assert.deepEqual(loser.manifest, { ok: false, error: 'manifest_write_failed' });
  assert.equal(JSON.stringify(loser).includes('private'), false);

  const retry = await appendJournal({ signals: [contender], dailyMarks: [] }, options);
  assert.equal(retry.durableWriteSucceeded, false);
  assert.deepEqual(retry.committedSignals, []);
  assert.deepEqual(retry.committedDailyMarks, []);

  const history = await readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 20 }, options);
  assert.deepEqual(history.signals, []);
  assert.deepEqual(history.dailyMarks.map((row) => row.id), [mark.id]);
});

test('a concurrent cross-date ID loser returns nondurable, cleans its orphan, and does not poison history', async () => {
  const winner = signalAt('hyperliquid-account-details:cross-date', '2026-08-25T23:59:59.000Z');
  const loser = signalAt('hyperliquid-account-details:cross-date', '2026-08-26T00:00:01.000Z');
  const loserCompanion = signalAt('hyperliquid-account-details:loser-companion', '2026-08-26T00:30:00.000Z');
  const later = signalAt('hyperliquid-account-details:later', '2026-08-26T01:00:00.000Z');
  let announceLoserManifest;
  let releaseLoserManifest;
  let blocked = false;
  const loserAtManifest = new Promise((resolve) => { announceLoserManifest = resolve; });
  const loserManifestGate = new Promise((resolve) => { releaseLoserManifest = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!blocked && pathname === MANIFEST
          && data.signalIds[loser.id] === '2026-08-26') {
        blocked = true;
        announceLoserManifest();
        await loserManifestGate;
      }
    },
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const loserWrite = appendJournal({ signals: [loser, loserCompanion], dailyMarks: [] }, options);
  await loserAtManifest;
  const winnerResult = await appendJournal({ signals: [winner], dailyMarks: [] }, options);
  releaseLoserManifest();
  const loserResult = await loserWrite;

  assert.equal(winnerResult.durableWriteSucceeded, true);
  assert.equal(loserResult.durableWriteSucceeded, false);
  assert.deepEqual(loserResult.committedSignals, []);
  assert.deepEqual(loserResult.committedDailyMarks, []);
  assert.equal(JSON.stringify(loserResult).includes('secret'), false);
  const rejectedPartition = adapter.inspect('smart-money/v1/journal/2026-08-26.json');
  assert.equal(rejectedPartition?.signals.some((row) => row.id === loser.id), false);
  assert.equal(rejectedPartition?.signals.some((row) => row.id === loserCompanion.id), true);

  const laterResult = await appendJournal({ signals: [later], dailyMarks: [] }, options);
  assert.equal(laterResult.durableWriteSucceeded, true);
  const history = await readJournal({ since: winner.observedAt, limit: 20 }, options);
  assert.deepEqual(history.signals.map((row) => row.id), [winner.id, later.id]);
});

test('history ignores partition-only rows when the manifest maps only authoritative IDs', async () => {
  const adapter = memoryJournalAdapter();
  const authoritative = signalAt('hyperliquid-account-details:authoritative', '2026-08-26T01:00:00.000Z');
  const orphan = signalAt('hyperliquid-account-details:orphan', '2026-08-26T02:00:00.000Z');
  adapter.seed(MANIFEST, {
    schemaVersion: 1,
    partitions: ['2026-08-26'],
    signalIds: { [authoritative.id]: '2026-08-26' },
    dailyMarkIds: {},
  });
  adapter.seed(PARTITION, {
    schemaVersion: 1,
    date: '2026-08-26',
    signals: [authoritative, orphan],
    dailyMarks: [],
  });
  const history = await readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 20 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(history.signals.map((row) => row.id), [authoritative.id]);
});

test('prune commits manifest removal before deletion and performs zero deletes on manifest failure', async () => {
  const oldDate = '2025-07-21';
  const oldPath = `smart-money/v1/journal/${oldDate}.json`;
  let deletes = 0;
  const adapter = memoryJournalAdapter({ beforeDelete: async () => { deletes += 1; } });
  const old = signalAt('hyperliquid-account-details:old-prune-failure', `${oldDate}T12:00:00.000Z`);
  await appendJournal({ signals: [old], dailyMarks: [] }, {
    adapter,
    now: new Date('2025-07-22T00:00:00.000Z'),
  });
  adapter.failNext(MANIFEST);
  const result = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') }, { adapter });
  assert.equal(result.durableWriteSucceeded, false);
  assert.equal(deletes, 0);
  assert.ok(adapter.inspect(oldPath));
  assert.deepEqual(adapter.inspect(MANIFEST).partitions, [oldDate]);
});

test('prune removes old orphan blobs, tolerates missing partitions, and preserves cutoff/newer paths', async () => {
  const adapter = memoryJournalAdapter();
  const missingDate = '2025-07-20';
  const oldDate = '2025-07-21';
  const cutoffDate = '2025-07-22';
  const newerDate = '2026-08-26';
  const oldPath = `smart-money/v1/journal/${oldDate}.json`;
  const cutoffPath = `smart-money/v1/journal/${cutoffDate}.json`;
  const newerPath = `smart-money/v1/journal/${newerDate}.json`;
  const invalidDatePath = 'smart-money/v1/journal/2025-13-40.json';
  adapter.seed(MANIFEST, {
    schemaVersion: 1,
    partitions: [missingDate],
    signalIds: { 'hyperliquid-account-details:missing-old': missingDate },
    dailyMarkIds: {},
  });
  adapter.seed(oldPath, {
    schemaVersion: 1, date: oldDate,
    signals: [signalAt('hyperliquid-account-details:orphan-old', `${oldDate}T12:00:00.000Z`)],
    dailyMarks: [],
  });
  adapter.seed(cutoffPath, { schemaVersion: 1, date: cutoffDate, signals: [], dailyMarks: [] });
  adapter.seed(newerPath, { schemaVersion: 1, date: newerDate, signals: [], dailyMarks: [] });
  adapter.seed(invalidDatePath, { private: 'unrecognized-shape' });

  const result = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') }, { adapter });
  assert.equal(result.durableWriteSucceeded, true);
  assert.equal(adapter.inspect(oldPath), null);
  assert.ok(adapter.inspect(cutoffPath));
  assert.ok(adapter.inspect(newerPath));
  assert.ok(adapter.inspect(invalidDatePath));
  assert.deepEqual(adapter.inspect(MANIFEST).partitions, []);
});

test('prune reports delete and stale-ETag failures after authoritative manifest removal', async () => {
  const oldDate = '2025-07-21';
  const deleteFailurePath = `smart-money/v1/journal/${oldDate}.json`;
  const deleteFailureAdapter = memoryJournalAdapter();
  deleteFailureAdapter.seed(deleteFailurePath, {
    schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [],
  });
  deleteFailureAdapter.failNextDelete(deleteFailurePath);
  const deleteFailure = await pruneJournal(
    { now: new Date('2026-08-26T12:00:00.000Z') },
    { adapter: deleteFailureAdapter },
  );
  assert.equal(deleteFailure.durableWriteSucceeded, false);
  assert.deepEqual(deleteFailureAdapter.inspect(MANIFEST).partitions, []);
  assert.ok(deleteFailureAdapter.inspect(deleteFailurePath));

  let staleAdapter;
  let mutated = false;
  staleAdapter = memoryJournalAdapter({
    beforeDelete: async ({ pathname }) => {
      if (!mutated) {
        mutated = true;
        staleAdapter.seed(pathname, {
          schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [],
        });
      }
    },
  });
  staleAdapter.seed(deleteFailurePath, {
    schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [],
  });
  const stale = await pruneJournal(
    { now: new Date('2026-08-26T12:00:00.000Z') },
    { adapter: staleAdapter },
  );
  assert.equal(stale.durableWriteSucceeded, false);
  assert.ok(staleAdapter.inspect(deleteFailurePath));
});

test('production Blob pruning forwards the just-read partition ETag to conditional delete', () => {
  const journalModuleUrl = new URL('../lib/smart-money/journal.js', import.meta.url).href;
  const probe = String.raw`
    import { mock } from 'node:test';

    const manifestPath = 'smart-money/v1/journal/manifest.json';
    const oldDate = '2025-07-21';
    const oldPath = 'smart-money/v1/journal/2025-07-21.json';
    let nextEtag = 1;
    const deleteAttempts = [];
    let deleteCalls = 0;
    let replaceStaleRead = false;
    const records = new Map([
      [manifestPath, {
        data: {
          schemaVersion: 1,
          partitions: [oldDate],
          signalIds: {},
          dailyMarkIds: {},
        },
        etag: 'manifest-etag',
      }],
      [oldPath, {
        data: { schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [] },
        etag: 'partition-etag',
      }],
    ]);
    class BlobNotFoundError extends Error {}
    class BlobPreconditionFailedError extends Error {}
    function blobResult(record) {
      return {
        stream: new Blob([JSON.stringify(record.data)]).stream(),
        blob: { etag: record.etag },
      };
    }
    await mock.module('@vercel/blob', {
      namedExports: {
        BlobNotFoundError,
        BlobPreconditionFailedError,
        async get(pathname) {
          const record = records.get(pathname);
          if (!record) throw new BlobNotFoundError('missing');
          const result = blobResult(record);
          if (replaceStaleRead && pathname === 'smart-money/v1/journal/2025-07-18.json') {
            replaceStaleRead = false;
            records.set(pathname, { ...record, etag: 'stale-replacement-etag' });
          }
          return result;
        },
        async put(pathname, body, options) {
          const current = records.get(pathname);
          if (current?.etag !== options.ifMatch) {
            throw new BlobPreconditionFailedError('private stale manifest secret');
          }
          records.set(pathname, {
            data: JSON.parse(body),
            etag: 'manifest-next-' + nextEtag++,
          });
        },
        async del(pathname, options) {
          deleteCalls += 1;
          deleteAttempts.push({ pathname, options });
          const current = records.get(pathname);
          if (!current || options?.ifMatch !== current.etag) {
            throw new BlobPreconditionFailedError('private stale delete secret');
          }
          records.delete(pathname);
        },
        async list() {
          return {
            blobs: [...records.keys()].map((pathname) => ({ pathname })),
            hasMore: false,
            cursor: null,
          };
        },
      },
    });
    const { pruneJournal } = await import(process.env.JOURNAL_MODULE_URL);
    const result = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    const stalePath = 'smart-money/v1/journal/2025-07-18.json';
    records.set(stalePath, {
      data: { schemaVersion: 1, date: '2025-07-18', signals: [], dailyMarks: [] },
      etag: 'stale-read-etag',
    });
    replaceStaleRead = true;
    const staleResult = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    const stalePartitionExists = records.has(stalePath);
    records.delete(stalePath);
    const missingEtagPath = 'smart-money/v1/journal/2025-07-20.json';
    records.set(missingEtagPath, {
      data: { schemaVersion: 1, date: '2025-07-20', signals: [], dailyMarks: [] },
      etag: null,
    });
    const missingEtagResult = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    const missingEtagPartitionExists = records.has(missingEtagPath);
    records.delete(missingEtagPath);
    const invalidEtagPath = 'smart-money/v1/journal/2025-07-19.json';
    records.set(invalidEtagPath, {
      data: { schemaVersion: 1, date: '2025-07-19', signals: [], dailyMarks: [] },
      etag: 42,
    });
    const invalidEtagResult = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    process.stdout.write(JSON.stringify({
      result,
      deleteAttempts,
      deleteCalls,
      oldPartitionExists: records.has(oldPath),
      staleResult,
      stalePartitionExists,
      missingEtagResult,
      missingEtagPartitionExists,
      invalidEtagResult,
      invalidEtagPartitionExists: records.has(invalidEtagPath),
    }));
  `;
  const child = spawnSync(process.execPath, [
    '--experimental-test-module-mocks',
    '--input-type=module',
    '--eval',
    probe,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      BLOB_READ_WRITE_TOKEN: 'private-test-token',
      JOURNAL_MODULE_URL: journalModuleUrl,
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.result.durableWriteSucceeded, true);
  assert.deepEqual(observed.deleteAttempts, [
    {
      pathname: 'smart-money/v1/journal/2025-07-21.json',
      options: { access: 'private', ifMatch: 'partition-etag' },
    },
    {
      pathname: 'smart-money/v1/journal/2025-07-18.json',
      options: { access: 'private', ifMatch: 'stale-read-etag' },
    },
  ]);
  assert.equal(observed.deleteCalls, 2);
  assert.equal(observed.oldPartitionExists, false);
  assert.equal(observed.staleResult.durableWriteSucceeded, false);
  assert.deepEqual(observed.staleResult.partitions, [
    { date: '2025-07-18', ok: false, error: 'partition_delete_failed' },
  ]);
  assert.equal(observed.stalePartitionExists, true);
  assert.equal(observed.missingEtagResult.durableWriteSucceeded, false);
  assert.equal(observed.missingEtagPartitionExists, true);
  assert.equal(observed.invalidEtagResult.durableWriteSucceeded, false);
  assert.equal(observed.invalidEtagPartitionExists, true);
  assert.equal(JSON.stringify(observed.result).includes('private'), false);
  assert.equal(JSON.stringify(observed.staleResult).includes('private'), false);
  assert.equal(JSON.stringify(observed.missingEtagResult).includes('private'), false);
  assert.equal(JSON.stringify(observed.invalidEtagResult).includes('private'), false);
});

test('journal append returns its exact sanitized failure contract when storage is unavailable', async () => {
  const unavailableAdapter = {
    async read() { throw new Error('https://blob.test/?token=raw-secret'); },
    async write() { throw new Error('must not write'); },
    isConflict() { return false; },
  };
  const unavailable = await appendJournal({ signals: [], dailyMarks: [] }, {
    adapter: unavailableAdapter,
  });
  assert.deepEqual(Object.keys(unavailable).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(unavailable.durableWriteSucceeded, false);
  assert.equal(JSON.stringify(unavailable).includes('raw-secret'), false);

  const env = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    COMMS_DASHBOARD_READ_WRITE_TOKEN: process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN,
    BLOB_STORE_ID: process.env.BLOB_STORE_ID,
  };
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  try {
    const unconfigured = await appendJournal({ signals: [], dailyMarks: [] });
    assert.equal(unconfigured.durableWriteSucceeded, false);
    assert.equal(unconfigured.manifest.error, 'journal_configuration_invalid');
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('journal rejects unsafe shapes, duplicate and type-colliding IDs, and cross-day marks', async () => {
  const adapter = memoryJournalAdapter();
  const unsafe = {};
  Object.defineProperty(unsafe, 'signals', { enumerable: true, get: () => { throw new Error('getter ran'); } });
  Object.defineProperty(unsafe, 'dailyMarks', { enumerable: true, value: [] });
  await assert.rejects(appendJournal(unsafe, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({ signals: [SIGNAL, SIGNAL], dailyMarks: [] }, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [], dailyMarks: [{ ...dailyMark(), id: '2026-08-25:BTC' }],
  }, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [{ ...SIGNAL, id: '2026-08-26:BTC' }], dailyMarks: [dailyMark()],
  }, { adapter }), /schema_invalid/);
});

test('journal rejects future signals and marks from an incomplete UTC day', async () => {
  const adapter = memoryJournalAdapter();
  const now = new Date('2026-08-26T00:00:00.000Z');
  await assert.rejects(appendJournal({
    signals: [signalAt('hyperliquid-account-details:future', '2026-08-26T01:00:00.000Z')],
    dailyMarks: [],
  }, { adapter, now }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [],
    dailyMarks: [dailyMark('2026-08-26', 'BTC')],
  }, { adapter, now: new Date('2026-08-26T23:59:59.999Z') }), /schema_invalid/);
});

test('journal rejects stored rows placed in the wrong UTC-day partition', async () => {
  const adapter = memoryJournalAdapter();
  adapter.seed(MANIFEST, {
    schemaVersion: 1,
    partitions: ['2026-08-26'],
    signalIds: { [SIGNAL.id]: '2026-08-26' },
    dailyMarkIds: {},
  });
  adapter.seed(PARTITION, {
    schemaVersion: 1,
    date: '2026-08-26',
    signals: [signalAt('hyperliquid-account-details:wrong-day', '2026-08-25T23:59:59.000Z')],
    dailyMarks: [],
  });
  await assert.rejects(readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 10 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  }), /schema_invalid/);
});

test('history is inclusive, bounded, exact, and pages equal timestamps by stable ID', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt('hyperliquid-account-details:a', '2026-08-26T01:00:00.000Z');
  const second = signalAt('hyperliquid-account-details:b', '2026-08-26T01:00:00.000Z');
  await appendJournal({ signals: [second, first], dailyMarks: [dailyMark()] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const pageOne = await readJournal({ since: first.observedAt, limit: 1 }, options);
  assert.deepEqual(Object.keys(pageOne), [
    'schemaVersion', 'ok', 'fetchedAt', 'partial', 'since', 'through', 'entities', 'signals',
    'dailyMarks', 'nextCursor', 'providerStatuses', 'warnings', 'sourceLinks',
  ]);
  assert.deepEqual(pageOne.signals.map((row) => row.id), [first.id]);
  assert.equal(typeof pageOne.nextCursor, 'string');
  const pageTwo = await readJournal({ since: first.observedAt, limit: 1, cursor: pageOne.nextCursor }, options);
  assert.deepEqual(pageTwo.signals.map((row) => row.id), [second.id]);
  assert.equal(pageTwo.nextCursor, null);
  assert.deepEqual(pageTwo.dailyMarks.map((row) => row.id), ['2026-08-26:BTC']);

  for (const query of [
    { since: first.observedAt, limit: 0 },
    { since: first.observedAt, limit: 501 },
    { since: '2025-07-22T23:59:59.999Z', limit: 1 },
    { since: first.observedAt, limit: 1, cursor: 'not-an-opaque-cursor' },
  ]) {
    await assert.rejects(readJournal(query, options), /schema_invalid/);
  }
});

test('tracked tickers use retained supported assets and exclude unsupported research rows', async () => {
  const adapter = memoryJournalAdapter();
  const eth = signalAt('hyperliquid-account-details:eth', '2026-08-26T02:00:00.000Z', 'ETH');
  const unsupported = {
    ...signalAt('sec-edgar:research', '2026-08-26T03:00:00.000Z', 'ABC'),
    providerId: 'sec-edgar',
    entityId: 'situational-awareness-lp',
    kind: 'holding_change',
    action: 'observe',
    asset: { ticker: null, name: 'Research only', providerSymbol: 'ABC', assetClass: 'equity', supported: false },
    direction: null,
    magnitude: { value: 1_000_000, unit: 'reported_value_usd' },
    positionChange: null,
    disclosedAt: '2026-08-26T03:00:00.000Z',
    effectiveAt: '2026-08-25T03:00:00.000Z',
    delaySeconds: 86_400,
    paperEligibility: { eligible: false, reason: 'unsupported_asset' },
    referencePrice: null,
  };
  await appendJournal({ signals: [eth, unsupported], dailyMarks: [] }, { adapter });
  const tickers = await listTrackedTickers({ since: '2026-08-26T00:00:00.000Z' }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(tickers, ['ETH']);
});

test('prune removes only expired partitions and a stale manifest ETag cannot erase a concurrent newer date', async () => {
  let armPrune = false;
  let blocked = false;
  let announceBlocked;
  let releasePrune;
  const pruneBlocked = new Promise((resolve) => { announceBlocked = resolve; });
  const pruneRelease = new Promise((resolve) => { releasePrune = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (armPrune && !blocked && pathname === MANIFEST && !data.partitions.includes('2025-07-21')) {
        blocked = true;
        announceBlocked();
        await pruneRelease;
      }
    },
  });
  const old = signalAt('hyperliquid-account-details:old', '2025-07-21T12:00:00.000Z');
  await appendJournal({ signals: [old], dailyMarks: [] }, {
    adapter,
    now: new Date('2025-07-23T00:00:00.000Z'),
  });
  armPrune = true;
  const pruning = pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') }, { adapter });
  await pruneBlocked;
  const recent = signalAt('hyperliquid-account-details:recent', '2026-08-26T10:00:00.000Z');
  await appendJournal({ signals: [recent], dailyMarks: [] }, {
    adapter,
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  releasePrune();
  const result = await pruning;
  const manifest = adapter.inspect(MANIFEST);
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(manifest.partitions, ['2026-08-26']);
  assert.equal(manifest.signalIds[recent.id], '2026-08-26');
  assert.equal(adapter.inspect('smart-money/v1/journal/2025-07-21.json'), null);
});
