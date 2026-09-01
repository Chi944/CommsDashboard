import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readDurableSmartMoneyCandidate,
  readSmartMoneySnapshot,
  selectNewestSmartMoneySnapshot,
  writeNewestSmartMoneyBlob,
  writeNewestSmartMoneyRedis,
  writeSmartMoneySnapshot,
} from '../lib/smart-money/store.js';
import { createMemoryRefreshLockAdapter, withRefreshLock } from '../lib/smart-money/lock.js';
import { createRefreshDeps } from './fixtures/smart-money/scenarios.js';

function snapshot(refreshStartedAt, marker, refreshedAt = refreshStartedAt) {
  return { refreshStartedAt, refreshedAt, marker };
}

test('snapshot selection uses refresh generation rather than later completion time', () => {
  const selected = selectNewestSmartMoneySnapshot([
    { source: 'redis', data: snapshot('2026-08-26T01:00:00.000Z', 'older-slow', '2026-08-26T03:00:00.000Z') },
    { source: 'blob', data: snapshot('2026-08-26T02:00:00.000Z', 'newer-fast', '2026-08-26T02:01:00.000Z') },
  ]);
  assert.equal(selected.source, 'blob');
  assert.equal(selected.data.marker, 'newer-fast');
});

test('candidate recovery requires exact agreement from every configured durable store and ignores memory', async () => {
  const candidate = snapshot('2026-08-26T02:00:00.000Z', 'candidate');
  assert.deepEqual(await readDurableSmartMoneyCandidate({
    blobConfigured: true,
    redisConfigured: true,
    memory: snapshot('2026-08-26T03:00:00.000Z', 'memory-only'),
    readBlob: async () => ({ data: structuredClone(candidate), error: null }),
    readRedis: async () => ({ data: structuredClone(candidate), error: null }),
  }), { status: 'ready', snapshot: candidate });
  assert.deepEqual(await readDurableSmartMoneyCandidate({
    blobConfigured: true,
    redisConfigured: true,
    readBlob: async () => ({ data: structuredClone(candidate), error: null }),
    readRedis: async () => ({
      data: snapshot('2026-08-26T02:00:00.000Z', 'conflict'), error: null,
    }),
  }), { status: 'conflict' });
  assert.deepEqual(await readDurableSmartMoneyCandidate({
    blobConfigured: true,
    redisConfigured: true,
    readBlob: async () => { throw new Error('private Blob error'); },
    readRedis: async () => ({ data: null, error: null }),
  }), { status: 'unavailable' });
  assert.deepEqual(await readDurableSmartMoneyCandidate({
    blobConfigured: true,
    redisConfigured: true,
    readBlob: async () => ({ data: structuredClone(candidate), error: null }),
    readRedis: async () => ({ data: null, error: null }),
  }), { status: 'conflict' });
  assert.deepEqual(await readDurableSmartMoneyCandidate({
    blobConfigured: true,
    redisConfigured: true,
    readBlob: async () => ({ data: null, error: null }),
    readRedis: async () => ({ data: null, error: null }),
  }), { status: 'absent' });
  assert.deepEqual(await readDurableSmartMoneyCandidate({
    blobConfigured: false, redisConfigured: false, memory: candidate,
  }), { status: 'unavailable' });
});

test('equal snapshot generations preserve the first accepted candidate', () => {
  const selected = selectNewestSmartMoneySnapshot([
    { source: 'redis', data: snapshot('2026-08-26T02:00:00.000Z', 'accepted') },
    { source: 'blob', data: snapshot('2026-08-26T02:00:00.000Z', 'collision') },
  ]);
  assert.equal(selected.source, 'redis');
  assert.equal(selected.data.marker, 'accepted');
});

test('Blob CAS keeps the newer generation when the older write completes last', async () => {
  let stored = snapshot('2026-08-26T00:00:00.000Z', 'initial');
  let etag = 1;
  let releaseOlder;
  let reachedOlder;
  const olderBlocked = new Promise((resolve) => { releaseOlder = resolve; });
  const olderReached = new Promise((resolve) => { reachedOlder = resolve; });
  const adapter = {
    read: async () => ({ data: structuredClone(stored), etag: String(etag) }),
    write: async (data, expectedEtag) => {
      if (data.marker === 'older') {
        reachedOlder();
        await olderBlocked;
      }
      if (expectedEtag !== String(etag)) {
        const error = new Error('private stale ETag details');
        error.name = 'BlobPreconditionFailedError';
        throw error;
      }
      stored = structuredClone(data);
      etag += 1;
    },
    isConflict: (error) => error?.name === 'BlobPreconditionFailedError',
  };

  const olderWrite = writeNewestSmartMoneyBlob(snapshot('2026-08-26T01:00:00.000Z', 'older'), adapter);
  await olderReached;
  const newerResult = await writeNewestSmartMoneyBlob(snapshot('2026-08-26T02:00:00.000Z', 'newer'), adapter);
  releaseOlder();
  const olderResult = await olderWrite;

  assert.equal(stored.marker, 'newer');
  assert.deepEqual(newerResult, { ok: true, skipped: false, error: null });
  assert.deepEqual(olderResult, { ok: true, skipped: true, error: null });
  assert.equal(JSON.stringify(olderResult).includes('private'), false);
});

test('Redis Lua write uses isolated namespaces and rejects out-of-order and equal generations', async () => {
  let stored = null;
  let version = null;
  const redis = {
    async eval(_script, keys, args) {
      assert.deepEqual(keys, [
        'smart-money:v1:snapshot',
        'smart-money:v1:snapshot:refresh-started-at-ms',
      ]);
      const incomingVersion = Number(args[0]);
      if (version !== null && version >= incomingVersion) return 0;
      version = incomingVersion;
      stored = JSON.parse(args[1]);
      return 1;
    },
  };
  const newer = snapshot('2026-08-26T02:00:00.000Z', 'newer');
  assert.deepEqual(await writeNewestSmartMoneyRedis(newer, redis), { ok: true, skipped: false, error: null });
  assert.deepEqual(
    await writeNewestSmartMoneyRedis(snapshot('2026-08-26T01:00:00.000Z', 'older'), redis),
    { ok: true, skipped: true, error: null },
  );
  assert.deepEqual(
    await writeNewestSmartMoneyRedis(snapshot('2026-08-26T02:00:00.000Z', 'equal-collision'), redis),
    { ok: true, skipped: true, error: null },
  );
  assert.equal(stored.marker, 'newer');
});

test('Redis atomic write keeps the newer generation when an older eval completes last', async () => {
  let stored = null;
  let version = null;
  let releaseOlder;
  let announceOlder;
  const olderGate = new Promise((resolve) => { releaseOlder = resolve; });
  const olderStarted = new Promise((resolve) => { announceOlder = resolve; });
  const redis = {
    async eval(_script, _keys, args) {
      const incoming = JSON.parse(args[1]);
      const incomingVersion = Number(args[0]);
      if (incoming.marker === 'older') {
        announceOlder();
        await olderGate;
      }
      if (version !== null && version >= incomingVersion) return 0;
      version = incomingVersion;
      stored = incoming;
      return 1;
    },
  };
  const olderWrite = writeNewestSmartMoneyRedis(
    snapshot('2026-08-26T01:00:00.000Z', 'older'),
    redis,
  );
  await olderStarted;
  const newerResult = await writeNewestSmartMoneyRedis(
    snapshot('2026-08-26T02:00:00.000Z', 'newer'),
    redis,
  );
  releaseOlder();
  const olderResult = await olderWrite;
  assert.equal(stored.marker, 'newer');
  assert.equal(newerResult.skipped, false);
  assert.equal(olderResult.skipped, true);
});

test('snapshot publication requires every configured durable write and sanitizes failures', async () => {
  const result = await writeSmartMoneySnapshot(snapshot('2026-08-26T02:00:00.000Z', 'candidate'), {
    blobConfigured: true,
    redisConfigured: true,
    writeBlob: async () => ({ ok: false, error: 'https://blob.test/?token=raw-secret' }),
    writeRedis: async () => ({ ok: true, skipped: false, error: null }),
  });
  assert.equal(result.durableWriteSucceeded, false);
  assert.deepEqual(result.blobWrite, {
    configured: true, ok: false, accepted: false, error: 'blob_write_failed',
  });
  assert.deepEqual(result.redisWrite, {
    configured: true, ok: true, accepted: true, error: null,
  });
  assert.equal(JSON.stringify(result).includes('raw-secret'), false);
});

test('snapshot publication rejects both-skipped and mixed accepted/skipped generations', async () => {
  const candidate = snapshot('2026-08-26T02:00:00.000Z', 'candidate');
  const bothSkipped = await writeSmartMoneySnapshot(candidate, {
    blobConfigured: true,
    redisConfigured: true,
    writeBlob: async () => ({ ok: true, skipped: true, error: null }),
    writeRedis: async () => ({ ok: true, skipped: true, error: null }),
  });
  assert.equal(bothSkipped.durableWriteSucceeded, false);
  assert.equal(bothSkipped.snapshot, null);
  assert.equal(bothSkipped.blobWrite.accepted, false);
  assert.equal(bothSkipped.redisWrite.accepted, false);

  const mixed = await writeSmartMoneySnapshot(candidate, {
    blobConfigured: true,
    redisConfigured: true,
    writeBlob: async () => ({ ok: true, skipped: false, error: null }),
    writeRedis: async () => ({ ok: true, skipped: true, error: null }),
  });
  assert.equal(mixed.durableWriteSucceeded, false);
  assert.equal(mixed.snapshot, null);
  assert.equal(mixed.blobWrite.accepted, true);
  assert.equal(mixed.redisWrite.accepted, false);

  const memoryBaseline = snapshot('2099-08-26T02:00:00.000Z', 'durable-memory-baseline');
  await writeSmartMoneySnapshot(memoryBaseline, {
    blobConfigured: true,
    redisConfigured: false,
    writeBlob: async () => ({ ok: true, skipped: false, error: null }),
  });
  await writeSmartMoneySnapshot(snapshot('2100-08-26T02:00:00.000Z', 'rejected-memory'), {
    blobConfigured: true,
    redisConfigured: false,
    writeBlob: async () => ({ ok: true, skipped: true, error: null }),
  });
  const memoryRead = await readSmartMoneySnapshot({
    blobConfigured: false,
    redisConfigured: false,
  });
  assert.equal(memoryRead.marker, 'durable-memory-baseline');
});

test('equal same-content, equal conflicting-content, and older snapshots are superseded', async () => {
  let stored = snapshot('2026-08-26T02:00:00.000Z', 'accepted');
  let etag = 1;
  const adapter = {
    read: async () => ({ data: structuredClone(stored), etag: String(etag) }),
    write: async (data, expectedEtag) => {
      assert.equal(expectedEtag, String(etag));
      stored = structuredClone(data);
      etag += 1;
    },
    isConflict: (error) => error?.name === 'BlobPreconditionFailedError',
  };
  const write = (data) => writeSmartMoneySnapshot(data, {
    blobConfigured: true,
    redisConfigured: false,
    writeBlob: (payload) => writeNewestSmartMoneyBlob(payload, adapter),
  });

  for (const candidate of [
    snapshot('2026-08-26T02:00:00.000Z', 'accepted'),
    snapshot('2026-08-26T02:00:00.000Z', 'equal-conflict'),
    snapshot('2026-08-26T01:00:00.000Z', 'older'),
  ]) {
    const result = await write(candidate);
    assert.equal(result.durableWriteSucceeded, false);
    assert.equal(result.snapshot, null);
    assert.equal(result.blobWrite.skipped, true);
  }
  assert.equal(stored.marker, 'accepted');
});

test('only a generation explicitly accepted by every configured store is durable', async () => {
  const candidate = snapshot('2026-08-26T03:00:00.000Z', 'accepted-by-all');
  const result = await writeSmartMoneySnapshot(candidate, {
    blobConfigured: true,
    redisConfigured: true,
    writeBlob: async () => ({ ok: true, skipped: false, error: null }),
    writeRedis: async () => ({ ok: true, skipped: false, error: null }),
  });
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(result.snapshot, candidate);
  assert.equal(result.blobWrite.accepted, true);
  assert.equal(result.redisWrite.accepted, true);

  const ambiguous = await writeSmartMoneySnapshot(candidate, {
    blobConfigured: true,
    redisConfigured: false,
    writeBlob: async () => ({ ok: true, error: null }),
  });
  assert.equal(ambiguous.durableWriteSucceeded, false);
  assert.equal(ambiguous.snapshot, null);
  assert.equal(ambiguous.blobWrite.accepted, false);
});

test('overlapping snapshot publications report only the newer accepted generation durable', async () => {
  let stored = snapshot('2026-08-26T00:00:00.000Z', 'initial');
  let etag = 1;
  let releaseOlder;
  let announceOlder;
  const olderGate = new Promise((resolve) => { releaseOlder = resolve; });
  const olderStarted = new Promise((resolve) => { announceOlder = resolve; });
  const adapter = {
    read: async () => ({ data: structuredClone(stored), etag: String(etag) }),
    write: async (data, expectedEtag) => {
      if (data.marker === 'older-overlap') {
        announceOlder();
        await olderGate;
      }
      if (expectedEtag !== String(etag)) {
        const error = new Error('stale ETag with private details');
        error.name = 'BlobPreconditionFailedError';
        throw error;
      }
      stored = structuredClone(data);
      etag += 1;
    },
    isConflict: (error) => error?.name === 'BlobPreconditionFailedError',
  };
  const write = (data) => writeSmartMoneySnapshot(data, {
    blobConfigured: true,
    redisConfigured: false,
    writeBlob: (payload) => writeNewestSmartMoneyBlob(payload, adapter),
  });
  const olderWrite = write(snapshot('2026-08-26T01:00:00.000Z', 'older-overlap'));
  await olderStarted;
  const newerResult = await write(snapshot('2026-08-26T02:00:00.000Z', 'newer-overlap'));
  releaseOlder();
  const olderResult = await olderWrite;

  assert.equal(newerResult.durableWriteSucceeded, true);
  assert.equal(olderResult.durableWriteSucceeded, false);
  assert.equal(olderResult.snapshot, null);
  assert.equal(stored.marker, 'newer-overlap');
});

test('Redis write accepts a new generation despite malformed legacy metadata', async () => {
  class LegacyRedis {
    constructor({ payload, version }) {
      this.payload = payload;
      this.version = version;
    }

    async eval(script, _keys, args) {
      const incomingVersion = Number(args[0]);
      const incoming = JSON.parse(args[1]);
      const numericVersion = Number(this.version);
      if (this.version != null && !Number.isFinite(numericVersion)
          && !script.includes('local function finite(value)')) {
        throw new Error('legacy nonnumeric version crashed Lua with redis-secret');
      }
      let currentVersion = this.version != null && this.version !== '' && Number.isFinite(numericVersion)
        ? numericVersion
        : null;
      if (currentVersion === null && this.payload && typeof this.payload === 'object') {
        const parsed = Date.parse(this.payload.refreshStartedAt);
        const canonical = Number.isFinite(parsed)
          && new Date(parsed).toISOString() === this.payload.refreshStartedAt;
        currentVersion = canonical ? parsed : null;
      }
      if (currentVersion !== null && currentVersion >= incomingVersion) return 0;
      this.payload = incoming;
      this.version = String(incomingVersion);
      return 1;
    }
  }

  for (const state of [
    { payload: { refreshStartedAt: '2026-13-40T00:00:00.000Z' }, version: null },
    { payload: { refreshStartedAt: '2026-02-30T00:00:00.000Z' }, version: null },
    { payload: { refreshStartedAt: 'not-json-metadata' }, version: 'not-a-number' },
    { payload: '{malformed-json', version: null },
    { payload: null, version: 'Infinity' },
  ]) {
    const redis = new LegacyRedis(state);
    const result = await writeNewestSmartMoneyRedis(
      snapshot('2026-08-26T04:00:00.000Z', 'replacement'),
      redis,
    );
    assert.deepEqual(result, { ok: true, skipped: false, error: null });
    assert.equal(redis.payload.marker, 'replacement');
    assert.equal(JSON.stringify(result).includes('redis-secret'), false);
  }

  const migrated = new LegacyRedis({
    payload: { refreshStartedAt: '2026-08-26T05:00:00.000Z', marker: 'valid-newer' },
    version: null,
  });
  assert.deepEqual(
    await writeNewestSmartMoneyRedis(snapshot('2026-08-26T04:00:00.000Z', 'older'), migrated),
    { ok: true, skipped: true, error: null },
  );
  assert.equal(migrated.payload.marker, 'valid-newer');
});

test('Redis legacy migration seeds Lua only from a canonical payload observed by preflight', async () => {
  const legacyPayload = JSON.stringify(
    snapshot('2026-08-26T05:00:00.000Z', 'valid-newer'),
  );
  const calls = [];
  const redis = {
    async get(key) {
      if (key === 'smart-money:v1:snapshot') return legacyPayload;
      if (key === 'smart-money:v1:snapshot:refresh-started-at-ms') return 'not-a-number';
      throw new Error('unexpected key');
    },
    async eval(_script, _keys, args) {
      calls.push(args);
      assert.equal(args[4], legacyPayload);
      assert.equal(args[3], String(Date.parse('2026-08-26T05:00:00.000Z')));
      return 0;
    },
  };
  assert.deepEqual(
    await writeNewestSmartMoneyRedis(snapshot('2026-08-26T04:00:00.000Z', 'older'), redis),
    { ok: true, skipped: true, error: null },
  );
  assert.equal(calls.length, 1);

  const malformedRedis = {
    async get(key) {
      if (key === SMART_MONEY_STORE_NAMESPACES.snapshot) {
        return JSON.stringify({ refreshStartedAt: '2026-02-30T00:00:00.000Z' });
      }
      return '';
    },
    async eval(_script, _keys, args) {
      assert.equal(args[3], '');
      assert.equal(args[4], '');
      return 1;
    },
  };
  assert.deepEqual(
    await writeNewestSmartMoneyRedis(
      snapshot('2026-08-26T04:00:00.000Z', 'replacement'),
      malformedRedis,
    ),
    { ok: true, skipped: false, error: null },
  );
});

test('Redis write rejects impossible incoming calendar timestamps before eval', async () => {
  let evalCalls = 0;
  const redis = { async eval() { evalCalls += 1; return 1; } };
  for (const refreshStartedAt of [
    '2026-13-01T00:00:00.000Z',
    '2026-02-30T00:00:00.000Z',
    '2026-08-26T00:00:00Z',
  ]) {
    assert.deepEqual(
      await writeNewestSmartMoneyRedis({ refreshStartedAt }, redis),
      { ok: false, skipped: false, error: 'redis_write_failed' },
    );
  }
  assert.equal(evalCalls, 0);
});

test('snapshot storage fails closed when production credentials are absent or incomplete', async () => {
  const env = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    COMMS_DASHBOARD_READ_WRITE_TOKEN: process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN,
    BLOB_STORE_ID: process.env.BLOB_STORE_ID,
  };
  Object.assign(process.env, { NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://redis.secret.test' });
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  try {
    const result = await writeSmartMoneySnapshot(snapshot('2026-08-26T02:00:00.000Z', 'candidate'));
    assert.equal(result.durableWriteSucceeded, false);
    assert.equal(result.configurationError, 'storage_configuration_invalid');
    assert.equal(JSON.stringify(result).includes('redis.secret'), false);
    await assert.rejects(
      withRefreshLock(async () => 'must-not-run'),
      (error) => error?.code === 'refresh_lock_configuration_invalid'
        && !String(error).includes('redis.secret'),
    );
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('snapshot reads select the newest durable generation and keep diagnostics sanitized', async () => {
  const result = await readSmartMoneySnapshot({
    withDiagnostics: true,
    memory: snapshot('2026-08-26T00:00:00.000Z', 'memory'),
    blobConfigured: true,
    redisConfigured: true,
    readBlob: async () => ({ data: snapshot('2026-08-26T02:00:00.000Z', 'blob') }),
    readRedis: async () => { throw new Error('https://redis.test/?token=raw-secret'); },
  });
  assert.equal(result.snapshot.marker, 'blob');
  assert.equal(result.diagnostics.selectedSource, 'blob');
  assert.equal(result.diagnostics.redisError, 'redis_read_failed');
  assert.equal(JSON.stringify(result).includes('raw-secret'), false);
});

test('snapshot read diagnostics fingerprint each configured durable store independently', async () => {
  const durable = structuredClone(createRefreshDeps({ signals: [] }).previous);
  const digest = durable.stateDigest;
  const generation = durable.refreshStartedAt;
  const result = await readSmartMoneySnapshot({
    withDiagnostics: true,
    memory: snapshot('2026-08-26T03:00:00.000Z', 'memory'),
    blobConfigured: true,
    redisConfigured: true,
    readBlob: async () => ({
      data: structuredClone(durable),
      error: null,
    }),
    readRedis: async () => ({ data: null, error: null }),
  });

  assert.equal(result.diagnostics.blobHit, true);
  assert.equal(result.diagnostics.blobGeneration, generation);
  assert.equal(result.diagnostics.blobDigest, digest);
  assert.equal(result.diagnostics.redisHit, false);
  assert.equal(result.diagnostics.redisGeneration, null);
  assert.equal(result.diagnostics.redisDigest, null);
});

test('snapshot read diagnostics never copy a noncanonical stored digest', async () => {
  const privateDetail = 'https://blob.invalid/?token=raw-secret';
  const durable = structuredClone(createRefreshDeps({ signals: [] }).previous);
  durable.stateDigest = privateDetail;
  const result = await readSmartMoneySnapshot({
    withDiagnostics: true,
    memory: null,
    blobConfigured: true,
    redisConfigured: false,
    readBlob: async () => ({
      data: durable,
      error: null,
    }),
  });

  assert.equal(result.diagnostics.blobDigest, null);
  assert.equal(JSON.stringify(result.diagnostics).includes(privateDetail), false);
});

test('refresh lock excludes concurrent workers and releases only its ownership token', async () => {
  const adapter = createMemoryRefreshLockAdapter();
  let releaseAction;
  let actionStarted;
  const actionGate = new Promise((resolve) => { releaseAction = resolve; });
  const started = new Promise((resolve) => { actionStarted = resolve; });
  const first = withRefreshLock(async () => {
    actionStarted();
    await actionGate;
    return 'first';
  }, { adapter, ttlMs: 100, renewEveryMs: 20 });
  await started;
  await assert.rejects(
    withRefreshLock(async () => 'second', { adapter, ttlMs: 100, renewEveryMs: 20 }),
    (error) => error?.code === 'refresh_lock_unavailable',
  );
  releaseAction();
  assert.equal(await first, 'first');
  assert.equal(await withRefreshLock(async () => 'third', { adapter }), 'third');
});

test('expired lock owner cannot release the replacement owner lock', async () => {
  let owner = null;
  let firstToken = null;
  let secondToken = null;
  let releaseFirstAction;
  let firstStarted;
  let releaseSecondAction;
  let secondStarted;
  const gate = new Promise((resolve) => { releaseFirstAction = resolve; });
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecondAction = resolve; });
  const replacementStarted = new Promise((resolve) => { secondStarted = resolve; });
  const adapter = {
    async acquire(_key, token) {
      if (owner !== null) return false;
      owner = token;
      if (!firstToken) firstToken = token;
      else secondToken = token;
      return true;
    },
    async renew(_key, token) {
      return owner === token;
    },
    async release(_key, token) {
      if (owner !== token) return false;
      owner = null;
      return true;
    },
  };
  const first = withRefreshLock(async () => {
    firstStarted();
    await gate;
  }, { adapter, ttlMs: 50, renewEveryMs: 10 });
  await started;
  owner = null;
  const second = withRefreshLock(async () => {
    assert.notEqual(secondToken, firstToken);
    secondStarted();
    await secondGate;
  }, { adapter, ttlMs: 50, renewEveryMs: 10 });
  await replacementStarted;
  await new Promise((resolve) => setTimeout(resolve, 15));
  releaseFirstAction();
  await assert.rejects(first, (error) => error?.code === 'refresh_lock_lost');
  assert.equal(owner, secondToken);
  releaseSecondAction();
  await second;
  assert.equal(owner, null);
});

test('refresh lock bounds TTL and renews ownership during a long action', async () => {
  const seenTtls = [];
  let renewals = 0;
  let owner = null;
  const adapter = {
    async acquire(_key, token, ttlMs) { owner = token; seenTtls.push(ttlMs); return true; },
    async renew(_key, token, ttlMs) { seenTtls.push(ttlMs); renewals += 1; return owner === token; },
    async release(_key, token) { if (owner === token) owner = null; return true; },
  };
  await withRefreshLock(
    () => new Promise((resolve) => setTimeout(resolve, 35)),
    { adapter, ttlMs: Number.MAX_SAFE_INTEGER, renewEveryMs: 5 },
  );
  assert.ok(renewals >= 1);
  assert.ok(seenTtls.every((ttl) => ttl <= 300_000));
  assert.equal(owner, null);
});

test('refresh lock fails the action when ownership expired before release', async () => {
  const adapter = {
    async acquire() { return true; },
    async renew() { return true; },
    async release() { return false; },
  };
  await assert.rejects(
    withRefreshLock(async () => 'must-not-publish', { adapter, ttlMs: 100, renewEveryMs: 90 }),
    (error) => error?.code === 'refresh_lock_lost',
  );
});
