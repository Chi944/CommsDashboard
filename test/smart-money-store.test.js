import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readSmartMoneySnapshot,
  selectNewestSmartMoneySnapshot,
  writeNewestSmartMoneyBlob,
  writeNewestSmartMoneyRedis,
  writeSmartMoneySnapshot,
} from '../lib/smart-money/store.js';
import { createMemoryRefreshLockAdapter, withRefreshLock } from '../lib/smart-money/lock.js';

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
  assert.deepEqual(result.blobWrite, { configured: true, ok: false, error: 'blob_write_failed' });
  assert.deepEqual(result.redisWrite, { configured: true, ok: true, error: null });
  assert.equal(JSON.stringify(result).includes('raw-secret'), false);
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
