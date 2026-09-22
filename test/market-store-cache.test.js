import assert from 'node:assert/strict';
import test from 'node:test';

import { createSnapshotHandler } from '../api/market/snapshot.js';
import { readProviderCache } from '../lib/market/store.js';

const NOW_MS = Date.parse('2026-09-22T17:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function cacheAt(ageHours, marker = 'redis') {
  const refreshedAt = new Date(NOW_MS - ageHours * HOUR_MS).toISOString();
  return {
    marker,
    refreshStartedAt: refreshedAt,
    refreshedAt,
    eia: {
      fetchedAt: refreshedAt,
      rows: [{ ticker: 'NG', price: 3.1, source: 'eia', asOf: '2026-09-21T00:00:00.000Z' }],
      errors: [],
    },
  };
}

function readOptions(overrides = {}) {
  return {
    preferRedis: true,
    withDiagnostics: true,
    nowMs: NOW_MS,
    memory: null,
    blobConfigured: true,
    redisConfigured: true,
    ...overrides,
  };
}

test('snapshot cache mode reads recent Redis once and performs no Blob operation', async () => {
  let redisReads = 0;
  let blobReads = 0;
  const result = await readProviderCache(readOptions({
    readRedis: async () => {
      redisReads += 1;
      return { data: cacheAt(13), error: null };
    },
    readBlob: async () => {
      blobReads += 1;
      return { data: cacheAt(1, 'blob'), error: null };
    },
  }));

  assert.equal(redisReads, 1);
  assert.equal(blobReads, 0);
  assert.equal(result.cache.marker, 'redis');
  assert.equal(result.diagnostics.blobReadSkipped, true);
  assert.equal(result.diagnostics.blobHit, false);
  assert.equal(result.diagnostics.blobError, null);
  assert.equal(result.diagnostics.selectedSource, 'redis');
  assert.equal(result.diagnostics.durableHit, true);
  assert.equal(result.diagnostics.readDegraded, false);
});

test('maintenance mode still compares both stores when Redis is recent', async () => {
  let blobReads = 0;
  const result = await readProviderCache(readOptions({
    preferRedis: false,
    readRedis: async () => ({ data: cacheAt(2), error: null }),
    readBlob: async () => {
      blobReads += 1;
      return { data: cacheAt(1, 'blob'), error: null };
    },
  }));

  assert.equal(blobReads, 1);
  assert.equal(result.cache.marker, 'blob');
  assert.equal(result.diagnostics.blobReadSkipped, false);
  assert.equal(result.diagnostics.redisHit, true);
  assert.equal(result.diagnostics.blobHit, true);
});

const fallbackCases = [
  { label: 'unconfigured', redisConfigured: false, expectedError: null },
  { label: 'missing', readRedis: async () => ({ data: null }), expectedError: null },
  {
    label: 'rejected',
    readRedis: async () => { throw new Error('https://private-redis.test/?token=secret'); },
    expectedError: 'redis_read_failed',
  },
  {
    label: 'failed with data',
    readRedis: async () => ({ data: cacheAt(2), error: 'private failure detail' }),
    expectedError: 'redis_read_failed',
  },
  {
    label: 'malformed',
    readRedis: async () => ({ data: { refreshedAt: 'invalid' } }),
    expectedError: 'redis_invalid_cache',
  },
  {
    label: 'invalid generation',
    readRedis: async () => ({ data: { ...cacheAt(1), refreshStartedAt: 'invalid' } }),
    expectedError: 'redis_invalid_cache',
  },
  {
    label: 'future completion',
    readRedis: async () => ({ data: cacheAt(-1) }),
    expectedError: 'redis_invalid_cache',
  },
  {
    label: 'generation after completion',
    readRedis: async () => ({
      data: { ...cacheAt(2), refreshStartedAt: new Date(NOW_MS - HOUR_MS).toISOString() },
    }),
    expectedError: 'redis_invalid_cache',
  },
  {
    label: 'expired generation',
    readRedis: async () => ({ data: cacheAt(13 + 1 / HOUR_MS) }),
    expectedError: 'redis_stale_cache',
  },
];

for (const { label, expectedError, ...overrides } of fallbackCases) {
  test(`snapshot cache mode reads Blob when Redis is ${label}`, async () => {
    let blobReads = 0;
    const result = await readProviderCache(readOptions({
      readRedis: async () => { throw new Error('unconfigured Redis must not run'); },
      ...overrides,
      readBlob: async () => {
        blobReads += 1;
        return { data: cacheAt(0.5, 'blob'), error: null };
      },
    }));

    assert.equal(blobReads, 1);
    assert.equal(result.cache.marker, 'blob');
    assert.equal(result.diagnostics.blobReadSkipped, false);
    assert.equal(result.diagnostics.redisError, expectedError);
    assert.equal(result.diagnostics.readDegraded, Boolean(expectedError));
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(JSON.stringify(result).includes('private failure detail'), false);
  });
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
}

function snapshotDependencies(overrides) {
  return {
    now: () => new Date(NOW_MS),
    fallbackCommodities: [],
    fetchCoinGeckoPrices: async () => ({ rows: [], errors: [] }),
    fetchCoinGeckoVolumes: async () => ({ volumes: {}, errors: [] }),
    fetchEiaEnergy: async () => ({ rows: [], errors: ['eia request_failed'] }),
    ...overrides,
  };
}

test('snapshot opts into Redis reads and publicly distinguishes an unprobed Blob', async () => {
  let blobReads = 0;
  const handler = createSnapshotHandler(snapshotDependencies({
    readProviderCache: (options) => {
      assert.equal(options.preferRedis, true);
      assert.equal(options.nowMs, NOW_MS);
      return readProviderCache(readOptions({
        ...options,
        readRedis: async () => ({ data: cacheAt(1) }),
        readBlob: async () => { blobReads += 1; return { data: null }; },
      }));
    },
  }));
  const response = responseRecorder();
  await handler({ method: 'GET', query: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(blobReads, 0);
  assert.equal(response.body.providers.blobReadSkipped, true);
  assert.equal(response.body.providers.blobHit, false);
  assert.equal(response.body.providers.redisHit, true);
  assert.equal(response.body.providers.persistenceDegraded, false);
  assert.equal(response.body.commodities.find((row) => row.ticker === 'NG').stale, false);
});

test('expired Redis survives a Blob outage as visibly stale last-good snapshot data', async () => {
  let blobReads = 0;
  const handler = createSnapshotHandler(snapshotDependencies({
    readProviderCache: (options) => readProviderCache(readOptions({
      ...options,
      readRedis: async () => ({ data: cacheAt(14) }),
      readBlob: async () => { blobReads += 1; throw new Error('Blob unavailable'); },
    })),
  }));
  const response = responseRecorder();
  await handler({ method: 'GET', query: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(blobReads, 1);
  assert.equal(response.body.partial, true);
  assert.equal(response.body.providers.redisError, 'redis_stale_cache');
  assert.equal(response.body.providers.blobError, 'blob_read_failed');
  assert.equal(response.body.providers.blobReadSkipped, false);
  assert.equal(response.body.providers.persistenceDegraded, true);
  assert.equal(response.body.commodities.find((row) => row.ticker === 'NG').price, 3.1);
  assert.equal(response.body.commodities.find((row) => row.ticker === 'NG').stale, true);
  assert.ok(response.body.staleProviders.includes('eia'));
});
