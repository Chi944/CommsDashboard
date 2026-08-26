import assert from 'node:assert/strict';
import test from 'node:test';

import refreshHandler from '../api/market/refresh.js';
import * as refreshModule from '../api/market/refresh.js';
import snapshotHandler from '../api/market/snapshot.js';
import * as snapshotModule from '../api/market/snapshot.js';
import {
  avRowsFromCache,
  fetchAlphaVantageCommodities,
} from '../lib/market/providers/alphavantage.js';
import { fetchCoinGeckoVolumes } from '../lib/market/providers/coingecko-volumes.js';
import { fetchCoinGeckoPrices } from '../lib/market/providers/coingecko.js';
import { eiaRowsFromCache, fetchEiaEnergy } from '../lib/market/providers/eia.js';
import { fetchWithTimeout } from '../lib/market/fetch.js';
import { fromAvSeries, fromCoinGecko, fromEiaRows } from '../lib/market/normalize.js';
import * as marketStore from '../lib/market/store.js';
import { getStorageDiagnostics, readProviderCache, writeProviderCache } from '../lib/market/store.js';

function createResponse() {
  return {
    body: null,
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('CoinGecko normalization keeps provider observation time and derives staleness from it', () => {
  const observedAt = Date.parse('2026-08-25T10:00:00.000Z');
  const meta = {
    symbol: 'BTC',
    name: 'Bitcoin',
    category: 'CRYPTO',
    unit: '$',
  };

  const fresh = fromCoinGecko(
    'BTC',
    meta,
    120_000,
    2.5,
    observedAt / 1000,
    observedAt + 60_000,
  );
  const stale = fromCoinGecko(
    'BTC',
    meta,
    120_000,
    2.5,
    observedAt / 1000,
    observedAt + 60 * 60 * 1000,
  );
  const invalidTimestamp = fromCoinGecko(
    'BTC',
    meta,
    120_000,
    2.5,
    1e15,
    observedAt,
  );
  const futureTimestamp = fromCoinGecko(
    'BTC',
    meta,
    120_000,
    2.5,
    (observedAt + 60 * 60 * 1000) / 1000,
    observedAt,
  );

  assert.equal(fresh.row.asOf, '2026-08-25T10:00:00.000Z');
  assert.equal(fresh.row.stale, false);
  assert.equal(stale.row.asOf, '2026-08-25T10:00:00.000Z');
  assert.equal(stale.row.stale, true);
  assert.equal(invalidTimestamp.row.asOf, null);
  assert.equal(invalidTimestamp.row.stale, true);
  assert.equal(futureTimestamp.row.stale, true);
});

test('CoinGecko provider forwards last_updated_at into the normalized row contract', async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const observedAt = Date.parse('2026-08-25T10:00:00.000Z');
  Date.now = () => observedAt + 60 * 60 * 1000;
  globalThis.fetch = async () => Response.json({
    bitcoin: {
      usd: 120_000,
      usd_24h_change: 2.5,
      last_updated_at: observedAt / 1000,
    },
  });

  try {
    const result = await fetchCoinGeckoPrices();
    const bitcoin = result.rows.find((row) => row.ticker === 'BTC');
    assert.equal(bitcoin.asOf, '2026-08-25T10:00:00.000Z');
    assert.equal(bitcoin.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test('Alpha Vantage and EIA rows use the latest provider period as asOf', () => {
  const nowMs = Date.parse('2026-08-26T00:00:00.000Z');
  const meta = {
    symbol: 'TEST',
    name: 'Test commodity',
    category: 'ENERGY',
    unit: '$',
  };
  const av = fromAvSeries('CL', meta, {
    data: [
      { date: '2026-08-24', value: '80' },
      { date: '2026-08-25', value: '82' },
    ],
  }, nowMs);
  const eia = fromEiaRows('NG', meta, {
    response: {
      data: [
        { period: '2026-08-24', value: '3.1' },
        { period: '2026-08-25', value: '3.2' },
      ],
    },
  }, nowMs);

  assert.equal(av.row.asOf, '2026-08-25T00:00:00.000Z');
  assert.equal(av.row.stale, false);
  assert.equal(eia.row.asOf, '2026-08-25T00:00:00.000Z');
  assert.equal(eia.row.stale, false);
});

test('Alpha Vantage and EIA rows with invalid provider periods remain null and stale', () => {
  const meta = {
    symbol: 'TEST',
    name: 'Test commodity',
    category: 'ENERGY',
    unit: '$',
  };
  const av = fromAvSeries('CL', meta, {
    data: [{ date: 'not-a-date', value: '82' }],
  });
  const eia = fromEiaRows('NG', meta, {
    response: { data: [{ period: '2026-02-30', value: '3.2' }] },
  });

  assert.equal(av.row.asOf, null);
  assert.equal(av.row.stale, true);
  assert.equal(eia.row.asOf, null);
  assert.equal(eia.row.stale, true);
});

test('Alpha Vantage observation age allows a long weekend but rejects older periods', () => {
  const meta = {
    symbol: 'TEST',
    name: 'Test commodity',
    category: 'ENERGY',
    unit: '$',
  };
  const observedAt = Date.parse('2026-08-28T00:00:00.000Z');
  const json = { data: [{ date: '2026-08-28', value: '82' }] };

  const weekendSafe = fromAvSeries('CL', meta, json, observedAt + 96 * 60 * 60 * 1000 - 1);
  const tooOld = fromAvSeries('CL', meta, json, observedAt + 96 * 60 * 60 * 1000 + 1);

  assert.equal(weekendSafe.row.stale, false);
  assert.equal(tooOld.row.stale, true);
});

test('EIA daily observations remain fresh across its weekly publication window', () => {
  const meta = {
    symbol: 'TEST',
    name: 'Test commodity',
    category: 'ENERGY',
    unit: '$',
  };
  const observedAt = Date.parse('2026-08-28T00:00:00.000Z');
  const data = { response: { data: [{ period: '2026-08-28', value: '3.2' }] } };

  const publicationLagSafe = fromEiaRows(
    'NG', meta, data, observedAt + 12 * 24 * 60 * 60 * 1000,
  );
  const tooOld = fromEiaRows(
    'NG', meta, data, observedAt + 12 * 24 * 60 * 60 * 1000 + 1,
  );

  assert.equal(publicationLagSafe.row.stale, false);
  assert.equal(tooOld.row.stale, true);
});

test('Alpha Vantage refresh requests only daily-supported WTI and Brent series', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalDateNow = Date.now;
  const originalKey = process.env.ALPHA_VANTAGE_API_KEY;
  process.env.ALPHA_VANTAGE_API_KEY = 'alpha-test-key';
  Date.now = () => Date.parse('2026-08-26T12:00:00.000Z');
  const requestedFunctions = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay >= 13_000) {
      callback(...args);
      return 0;
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedFunctions.push(url.searchParams.get('function'));
    return Response.json({
      name: 'Daily commodity prices',
      interval: 'daily',
      unit: 'USD',
      data: [
        { date: '2026-08-25', value: '82' },
        { date: '2026-08-24', value: '80' },
      ],
    });
  };

  try {
    const result = await fetchAlphaVantageCommodities();

    assert.deepEqual(requestedFunctions, ['WTI', 'BRENT']);
    assert.deepEqual(result.rows.map((row) => row.ticker), ['CL', 'BZ']);
    assert.equal(result.errors.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
    if (originalKey === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = originalKey;
  }
});

test('EIA refresh keeps the maintained RNGWHHD spot series at daily frequency', async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const originalKey = process.env.EIA_API_KEY;
  process.env.EIA_API_KEY = 'eia-test-key';
  Date.now = () => Date.parse('2026-08-26T12:00:00.000Z');
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(new URL(String(input)));
    return Response.json({
      response: {
        data: [
          { period: '2026-08-25', value: '3.2' },
          { period: '2026-08-24', value: '3.1' },
        ],
      },
    });
  };

  try {
    const result = await fetchEiaEnergy();
    assert.equal(requestedUrls.length, 1);
    const [url] = requestedUrls;
    assert.equal(url.pathname, '/v2/natural-gas/pri/fut/data/');
    assert.equal(url.searchParams.get('frequency'), 'daily');
    assert.deepEqual(url.searchParams.getAll('facets[series][]'), ['RNGWHHD']);
    assert.equal(url.searchParams.get('length'), '2');
    assert.deepEqual(result.rows.map((row) => row.ticker), ['NG']);
    assert.equal(result.errors.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    if (originalKey === undefined) delete process.env.EIA_API_KEY;
    else process.env.EIA_API_KEY = originalKey;
  }
});

test('Alpha Vantage and EIA future-dated observations outside clock skew are stale', () => {
  const meta = {
    symbol: 'TEST',
    name: 'Test commodity',
    category: 'ENERGY',
    unit: '$',
  };
  const nowMs = Date.parse('2026-08-27T23:54:59.999Z');
  const av = fromAvSeries('CL', meta, {
    data: [{ date: '2026-08-28', value: '82' }],
  }, nowMs);
  const eia = fromEiaRows('NG', meta, {
    response: { data: [{ period: '2026-08-28', value: '3.2' }] },
  }, nowMs);

  assert.equal(av.row.asOf, '2026-08-28T00:00:00.000Z');
  assert.equal(av.row.stale, true);
  assert.equal(eia.row.asOf, '2026-08-28T00:00:00.000Z');
  assert.equal(eia.row.stale, true);
});

test('Alpha Vantage cache stays fresh through the 13-hour cron safety window', () => {
  const now = Date.parse('2026-08-25T23:00:00.000Z');
  const cache = {
    alphavantage: {
      rows: [{
        ticker: 'CL', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z',
      }],
      fetchedAt: '2026-08-25T10:00:00.000Z',
    },
  };

  assert.equal(avRowsFromCache(cache, now - 1).stale, false);
  assert.equal(avRowsFromCache(cache, now + 1).stale, true);
});

test('Alpha Vantage cache readers discard legacy unsupported global-price rows', () => {
  const now = Date.parse('2026-08-25T12:00:00.000Z');
  const cache = {
    alphavantage: {
      rows: [
        { ticker: 'CL', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z' },
        { ticker: 'HG', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z' },
        { ticker: 'ZW', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z' },
        { ticker: 'ZC', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z' },
      ],
      fetchedAt: '2026-08-25T10:00:00.000Z',
    },
  };

  const result = avRowsFromCache(cache, now);
  assert.deepEqual(result.rows.map((row) => row.ticker), ['CL']);
  assert.equal(result.stale, false);
});

test('EIA cache stays fresh through the 13-hour cron safety window', () => {
  const now = Date.parse('2026-08-25T23:00:00.000Z');
  const cache = {
    eia: {
      rows: [{ ticker: 'NG', source: 'eia', asOf: '2026-08-25T00:00:00.000Z' }],
      fetchedAt: '2026-08-25T10:00:00.000Z',
    },
  };

  assert.equal(eiaRowsFromCache(cache, now - 1).stale, false);
  assert.equal(eiaRowsFromCache(cache, now + 1).stale, true);
  assert.equal(eiaRowsFromCache({
    eia: {
      rows: [{
        ticker: 'NG', source: 'eia', asOf: '2026-08-25T00:00:00.000Z', stale: true,
      }],
      fetchedAt: '2026-08-25T10:00:00.000Z',
    },
  }, now - 1).stale, true);
});

test('provider cache reads revalidate persisted fresh observation timestamps', () => {
  const observedAt = Date.parse('2026-08-28T00:00:00.000Z');
  const avBoundary = observedAt + 96 * 60 * 60 * 1000;
  const eiaBoundary = observedAt + 12 * 24 * 60 * 60 * 1000;
  const avCache = {
    alphavantage: {
      rows: [{
        ticker: 'CL', source: 'alphavantage', asOf: '2026-08-28T00:00:00.000Z', stale: false,
      }],
      fetchedAt: new Date(avBoundary).toISOString(),
    },
  };
  const eiaCache = {
    eia: {
      rows: [{
        ticker: 'NG', source: 'eia', asOf: '2026-08-28T00:00:00.000Z', stale: false,
      }],
      fetchedAt: new Date(eiaBoundary).toISOString(),
    },
  };
  const futureCache = {
    eia: {
      rows: [{
        ticker: 'NG', source: 'eia', asOf: '2026-08-28T00:00:00.000Z', stale: false,
      }],
      fetchedAt: '2026-08-27T23:54:59.999Z',
    },
  };

  assert.equal(avRowsFromCache(avCache, avBoundary).stale, false);
  assert.equal(avRowsFromCache(avCache, avBoundary + 1).stale, true);
  assert.equal(eiaRowsFromCache(eiaCache, eiaBoundary).stale, false);
  assert.equal(eiaRowsFromCache(eiaCache, eiaBoundary + 1).stale, true);
  assert.equal(eiaRowsFromCache(futureCache, Date.parse('2026-08-27T23:54:59.999Z')).stale, true);
});

test('provider cache selection chooses the newest valid refreshedAt across all sources', () => {
  assert.equal(typeof marketStore.selectNewestProviderCache, 'function');
  const selected = marketStore.selectNewestProviderCache([
    {
      source: 'memory',
      data: { refreshedAt: '2026-08-25T10:00:00.000Z', marker: 'memory' },
    },
    {
      source: 'blob',
      data: { refreshedAt: 'not-a-date', marker: 'invalid-blob' },
    },
    {
      source: 'redis',
      data: { refreshedAt: '2026-08-25T12:00:00.000Z', marker: 'redis' },
    },
  ]);

  assert.equal(selected.source, 'redis');
  assert.equal(selected.data.marker, 'redis');
  assert.equal(selected.refreshedAt, '2026-08-25T12:00:00.000Z');
});

test('provider cache selection prefers a later refresh generation over later completion time', () => {
  const selected = marketStore.selectNewestProviderCache([
    {
      source: 'blob',
      data: {
        refreshStartedAt: '2026-08-25T12:00:00.000Z',
        refreshedAt: '2026-08-25T12:00:05.000Z',
        marker: 'older-slow',
      },
    },
    {
      source: 'redis',
      data: {
        refreshStartedAt: '2026-08-25T12:00:01.000Z',
        refreshedAt: '2026-08-25T12:00:02.000Z',
        marker: 'newer-fast',
      },
    },
  ]);

  assert.equal(selected.source, 'redis');
  assert.equal(selected.data.marker, 'newer-fast');
  assert.equal(selected.refreshedAt, '2026-08-25T12:00:02.000Z');
});

test('Blob cache CAS keeps the newest payload when an older refresh completes last', async () => {
  const previous = { refreshedAt: '2026-08-25T10:00:00.000Z', marker: 'previous' };
  const older = { refreshedAt: '2026-08-25T11:00:00.000Z', marker: 'older' };
  const newer = { refreshedAt: '2026-08-25T12:00:00.000Z', marker: 'newer' };
  let stored = previous;
  let etag = 1;
  let releaseOlderWrite;
  const olderWriteBlocked = new Promise((resolve) => {
    releaseOlderWrite = resolve;
  });
  let notifyOlderWrite;
  const olderReachedWrite = new Promise((resolve) => {
    notifyOlderWrite = resolve;
  });

  const adapter = {
    read: async () => ({ data: structuredClone(stored), etag: String(etag) }),
    write: async (payload, expectedEtag) => {
      if (payload.marker === 'older') {
        notifyOlderWrite();
        await olderWriteBlocked;
      }
      if (expectedEtag !== String(etag)) {
        const error = new Error('simulated ETag mismatch with secret details');
        error.name = 'BlobPreconditionFailedError';
        throw error;
      }
      stored = structuredClone(payload);
      etag += 1;
    },
    isConflict: (error) => error?.name === 'BlobPreconditionFailedError',
  };

  const olderWrite = marketStore.writeNewestBlobCache(older, adapter);
  await olderReachedWrite;
  const newerResult = await marketStore.writeNewestBlobCache(newer, adapter);
  releaseOlderWrite();
  const olderResult = await olderWrite;

  assert.equal(stored.marker, 'newer');
  assert.deepEqual(newerResult, { ok: true, skipped: false, error: null });
  assert.deepEqual(olderResult, { ok: true, skipped: true, error: null });
  assert.equal(JSON.stringify(olderResult).includes('secret details'), false);
});

test('Blob cache CAS creates the cache when the SDK reports BlobNotFoundError', async () => {
  const payload = { refreshedAt: '2026-08-25T12:00:00.000Z', marker: 'first' };
  let stored = null;
  const adapter = {
    read: async () => marketStore.readBlobCacheSnapshot(
      async () => {
        const error = new Error('missing blob with secret request details');
        error.name = 'BlobNotFoundError';
        throw error;
      },
      (error) => error?.name === 'BlobNotFoundError',
    ),
    write: async (nextPayload, expectedEtag) => {
      assert.equal(expectedEtag, null);
      stored = structuredClone(nextPayload);
    },
  };

  const result = await marketStore.writeNewestBlobCache(payload, adapter);

  assert.equal(stored.marker, 'first');
  assert.deepEqual(result, { ok: true, skipped: false, error: null });
  assert.equal(JSON.stringify(result).includes('secret request details'), false);
});

test('Redis atomic cache write keeps the newest payload when requests arrive out of order', async () => {
  const older = { refreshedAt: '2026-08-25T11:00:00.000Z', marker: 'older' };
  const newer = { refreshedAt: '2026-08-25T12:00:00.000Z', marker: 'newer' };
  let stored = null;
  let storedVersion = null;
  let releaseOlderEval;
  const olderEvalBlocked = new Promise((resolve) => {
    releaseOlderEval = resolve;
  });
  let notifyOlderEval;
  const olderReachedEval = new Promise((resolve) => {
    notifyOlderEval = resolve;
  });

  const redis = {
    eval: async (_script, keys, args) => {
      assert.deepEqual(keys, [
        'market:provider-cache',
        'market:provider-cache:refreshed-at-ms',
      ]);
      const incomingVersion = Number(args[0]);
      const incoming = JSON.parse(args[1]);
      if (incoming.marker === 'older') {
        notifyOlderEval();
        await olderEvalBlocked;
      }
      if (storedVersion !== null && storedVersion >= incomingVersion) return 0;
      stored = incoming;
      storedVersion = incomingVersion;
      return 1;
    },
  };

  const olderWrite = marketStore.writeNewestRedisCache(older, redis);
  await olderReachedEval;
  const newerResult = await marketStore.writeNewestRedisCache(newer, redis);
  releaseOlderEval();
  const olderResult = await olderWrite;

  assert.equal(stored.marker, 'newer');
  assert.deepEqual(newerResult, { ok: true, skipped: false, error: null });
  assert.deepEqual(olderResult, { ok: true, skipped: true, error: null });
});

test('provider cache reads Blob and Redis before selecting the newest durable payload', async () => {
  const memory = { refreshedAt: '2026-08-25T10:00:00.000Z', marker: 'memory' };
  const blob = { refreshedAt: '2026-08-25T11:00:00.000Z', marker: 'blob' };
  const redis = { refreshedAt: '2026-08-25T12:00:00.000Z', marker: 'redis' };

  const result = await readProviderCache({
    withDiagnostics: true,
    memory,
    blobConfigured: true,
    redisConfigured: true,
    readBlob: async () => ({ data: blob, error: null }),
    readRedis: async () => ({ data: redis, error: null }),
  });

  assert.equal(result.cache.marker, 'redis');
  assert.equal(result.diagnostics.selectedSource, 'redis');
  assert.equal(result.diagnostics.blobHit, true);
  assert.equal(result.diagnostics.redisHit, true);
  assert.equal(result.diagnostics.memoryHit, true);
});

test('provider memory fallback is short-lived instead of masking durable updates for the process lifetime', async () => {
  const writtenAt = Date.parse('2026-08-25T12:00:00.000Z');
  const payload = { refreshedAt: '2026-08-25T12:00:00.000Z', marker: 'memory-only' };
  const unavailableRead = async () => ({ data: null, error: null });

  await writeProviderCache(payload, {
    nowMs: writtenAt,
    blobConfigured: false,
    redisConfigured: false,
    writeBlob: async () => ({ ok: false }),
    writeRedis: async () => ({ ok: false }),
  });

  const fresh = await readProviderCache({
    nowMs: writtenAt + 1_000,
    blobConfigured: false,
    redisConfigured: false,
    readBlob: unavailableRead,
    readRedis: unavailableRead,
  });
  const expired = await readProviderCache({
    nowMs: writtenAt + 24 * 60 * 60 * 1000,
    blobConfigured: false,
    redisConfigured: false,
    readBlob: unavailableRead,
    readRedis: unavailableRead,
  });

  assert.equal(fresh?.marker, 'memory-only');
  assert.equal(expired, null);
});

test('provider cache writes report sanitized outcomes for both durable stores', async () => {
  const payload = { refreshedAt: '2026-08-25T12:00:00.000Z' };
  const result = await writeProviderCache(payload, {
    blobConfigured: true,
    redisConfigured: true,
    writeBlob: async () => ({
      ok: false,
      error: 'failed at https://blob.test/?token=raw-blob-secret',
    }),
    writeRedis: async () => ({ ok: true }),
  });

  assert.deepEqual(result.blobWrite, {
    configured: true,
    ok: false,
    error: 'blob_write_failed',
  });
  assert.deepEqual(result.redisWrite, {
    configured: true,
    ok: true,
    error: null,
  });
  assert.equal(result.durableWriteSucceeded, true);
  assert.equal(result.degradedPersistence, true);
  assert.equal(JSON.stringify(result).includes('raw-blob-secret'), false);
});

test('Blob diagnostics recognize SDK-default OIDC auth while retaining legacy token auth', async () => {
  const originalStoreId = process.env.BLOB_STORE_ID;
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const originalLegacyToken = process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;

  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  process.env.BLOB_STORE_ID = 'store_test';

  try {
    const oidc = await getStorageDiagnostics();
    assert.equal(oidc.blob, true);
    assert.equal(oidc.blobAuth, 'oidc-default');

    delete process.env.BLOB_STORE_ID;
    process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN = 'legacy-test-token';
    const legacy = await getStorageDiagnostics();
    assert.equal(legacy.blob, true);
    assert.equal(legacy.blobAuth, 'token');

    process.env.BLOB_STORE_ID = 'store_test';
    const combined = await getStorageDiagnostics();
    assert.equal(combined.blob, true);
    assert.equal(combined.blobAuth, 'token');
  } finally {
    if (originalStoreId === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = originalStoreId;
    if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
    if (originalLegacyToken === undefined) delete process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
    else process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN = originalLegacyToken;
  }
});

test('market refresh returns a retryable degraded response when no durable write succeeds', async () => {
  assert.equal(typeof refreshModule.createRefreshHandler, 'function');
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    readProviderCache: async () => null,
    fetchAlphaVantageCommodities: async () => ({
      rows: [{ ticker: 'CL', source: 'alphavantage' }],
      errors: [],
      fetchedAt: '2026-08-25T12:00:00.000Z',
    }),
    fetchEiaEnergy: async () => ({
      rows: [{ ticker: 'NG', source: 'eia' }],
      errors: [],
      fetchedAt: '2026-08-25T12:00:00.000Z',
    }),
    writeProviderCache: async () => ({
      blobWrite: { configured: true, ok: false, error: 'blob_write_failed' },
      redisWrite: { configured: true, ok: false, error: 'redis_write_failed' },
      durableWriteSucceeded: false,
      degradedPersistence: true,
    }),
    now: () => new Date('2026-08-25T12:01:00.000Z'),
  });
  const response = createResponse();

  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer server-secret' },
  }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.partial, true);
  assert.equal(response.body.persisted, false);
  assert.equal(response.body.degradedPersistence, true);
  assert.equal(response.body.persistence.durable, false);
  assert.deepEqual(response.body.blobWrite, {
    configured: true,
    ok: false,
    error: 'blob_write_failed',
  });
  assert.deepEqual(response.body.redisWrite, {
    configured: true,
    ok: false,
    error: 'redis_write_failed',
  });
});

test('scheduled market refresh runs market and Smart Money services and reports bounded durable outcomes', async () => {
  const calls = [];
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    refreshMarket: async () => {
      calls.push('market');
      return { persisted: true, partial: false, errorCode: null, privateRows: ['not-public'] };
    },
    refreshSmartMoney: async (input) => {
      calls.push(`smart-money:${input.trigger}`);
      return {
        persisted: true, partial: false, errorCode: null,
        signalsAccepted: [{ private: 'not-public' }], providerStatuses: [{ private: 'not-public' }],
      };
    },
  });
  const response = createResponse();

  await handler({
    method: 'GET', headers: { authorization: 'Bearer server-secret' }, query: {},
  }, response);

  assert.deepEqual(calls, ['market', 'smart-money:cron']);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    partial: false,
    market: { ok: true, persisted: true, partial: false, errorCode: null },
    smartMoney: { ok: true, persisted: true, partial: false, errorCode: null },
  });
});

test('scheduled refresh treats a fulfilled partial subsystem as a retryable failure', async () => {
  const cases = [
    {
      degraded: 'market',
      expectedCode: 'market_refresh_failed',
      market: { persisted: true, partial: true, errorCode: null },
      smartMoney: { persisted: true, partial: false, errorCode: null },
    },
    {
      degraded: 'smartMoney',
      expectedCode: 'smart_money_refresh_failed',
      market: { persisted: true, partial: false, errorCode: null },
      smartMoney: { persisted: true, partial: true, errorCode: null },
    },
  ];
  for (const row of cases) {
    const handler = refreshModule.createRefreshHandler({
      cronSecret: 'server-secret',
      refreshMarket: async () => row.market,
      refreshSmartMoney: async () => row.smartMoney,
    });
    const response = createResponse();
    await handler({
      method: 'GET', headers: { authorization: 'Bearer server-secret' }, query: {},
    }, response);
    assert.equal(response.statusCode, 503, row.degraded);
    assert.equal(response.body.ok, false, row.degraded);
    assert.equal(response.body.partial, true, row.degraded);
    assert.equal(response.body[row.degraded].errorCode, row.expectedCode, row.degraded);
  }
});

test('scheduled refresh still runs Smart Money and returns 503 when market refresh fails', async () => {
  let smartMoneyCalls = 0;
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    refreshMarket: () => { throw new Error('private market credential'); },
    refreshSmartMoney: async () => {
      smartMoneyCalls += 1;
      return { persisted: true, partial: false, errorCode: null };
    },
  });
  const response = createResponse();

  await handler({
    method: 'GET', headers: { authorization: 'Bearer server-secret' }, query: {},
  }, response);

  assert.equal(smartMoneyCalls, 1);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    ok: false,
    partial: true,
    market: { ok: false, persisted: false, partial: true, errorCode: 'market_refresh_failed' },
    smartMoney: { ok: true, persisted: true, partial: false, errorCode: null },
  });
  assert.equal(JSON.stringify(response.body).includes('credential'), false);
});

test('scheduled refresh still runs market and returns 503 when Smart Money refresh fails', async () => {
  let marketCalls = 0;
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    refreshMarket: async () => {
      marketCalls += 1;
      return { persisted: true, partial: false, errorCode: null };
    },
    refreshSmartMoney: async () => { throw new Error('private Smart Money provider body'); },
  });
  const response = createResponse();

  await handler({
    method: 'GET', headers: { authorization: 'Bearer server-secret' }, query: {},
  }, response);

  assert.equal(marketCalls, 1);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    ok: false,
    partial: true,
    market: { ok: true, persisted: true, partial: false, errorCode: null },
    smartMoney: {
      ok: false, persisted: false, partial: true, errorCode: 'smart_money_refresh_failed',
    },
  });
  assert.equal(JSON.stringify(response.body).includes('provider body'), false);
});

test('market refresh marks configured write failures partial even when another durable store succeeds', async () => {
  assert.equal(typeof refreshModule.createRefreshHandler, 'function');
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    readProviderCache: async () => null,
    fetchAlphaVantageCommodities: async () => ({ rows: [], errors: [], fetchedAt: null }),
    fetchEiaEnergy: async () => ({ rows: [], errors: [], fetchedAt: null }),
    writeProviderCache: async () => ({
      blobWrite: { configured: true, ok: false, error: 'blob_write_failed' },
      redisWrite: { configured: true, ok: true, error: null },
      durableWriteSucceeded: true,
      degradedPersistence: true,
    }),
    now: () => new Date('2026-08-25T12:01:00.000Z'),
  });
  const response = createResponse();

  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer server-secret' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.partial, true);
  assert.equal(response.body.persisted, true);
  assert.equal(response.body.degradedPersistence, true);
  assert.equal(response.body.persistence.durable, true);
});

test('an older overlapping refresh cannot overwrite a later-started durable generation', async () => {
  const startedAtA = '2026-08-25T12:00:00.000Z';
  const startedAtB = '2026-08-25T12:00:01.000Z';
  const completedAtB = '2026-08-25T12:00:02.000Z';
  const completedAtA = '2026-08-25T12:00:03.000Z';
  let clockMs = Date.parse(startedAtA);
  let avCalls = 0;
  let eiaCalls = 0;
  let releaseA;
  let announceA;
  let releaseB;
  let announceB;
  const aBlocked = new Promise((resolve) => { releaseA = resolve; });
  const aStarted = new Promise((resolve) => { announceA = resolve; });
  const bBlocked = new Promise((resolve) => { releaseB = resolve; });
  const bReadyToComplete = new Promise((resolve) => { announceB = resolve; });
  let stored = null;
  let storedVersion = null;
  const redis = {
    async eval(_script, _keys, args) {
      const incomingVersion = Number(args[0]);
      if (storedVersion !== null && storedVersion >= incomingVersion) return 0;
      storedVersion = incomingVersion;
      stored = JSON.parse(args[1]);
      return 1;
    },
  };
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    now: () => new Date(clockMs),
    readProviderCache: async () => null,
    fetchAlphaVantageCommodities: async () => {
      avCalls += 1;
      if (avCalls === 1) {
        announceA();
        await aBlocked;
        return {
          rows: [{ ticker: 'CL', price: 80, source: 'alphavantage' }],
          errors: [],
          fetchedAt: completedAtA,
        };
      }
      return {
        rows: [{ ticker: 'CL', price: 82, source: 'alphavantage' }],
        errors: [],
        fetchedAt: completedAtB,
      };
    },
    fetchEiaEnergy: async () => {
      eiaCalls += 1;
      if (eiaCalls === 1) {
        announceB();
        await bBlocked;
      }
      return { rows: [], errors: [], fetchedAt: null };
    },
    writeProviderCache: async (payload) => {
      const redisWrite = await marketStore.writeNewestRedisCache(payload, redis);
      return {
        blobWrite: { configured: false, ok: false, error: null },
        redisWrite: { configured: true, ...redisWrite },
      };
    },
  });
  const request = {
    method: 'POST',
    headers: { authorization: 'Bearer server-secret' },
  };
  const responseA = createResponse();
  const responseB = createResponse();

  const runA = handler(request, responseA);
  await aStarted;
  clockMs = Date.parse(startedAtB);
  const runB = handler(request, responseB);
  await bReadyToComplete;
  clockMs = Date.parse(completedAtB);
  releaseB();
  await runB;
  clockMs = Date.parse(completedAtA);
  releaseA();
  await runA;

  assert.equal(stored.alphavantage.rows[0].price, 82);
  assert.equal(stored.refreshStartedAt, startedAtB);
  assert.equal(stored.refreshedAt, completedAtB);
  assert.equal(responseA.body.refreshStartedAt, startedAtA);
  assert.equal(responseA.body.refreshedAt, completedAtA);
  assert.equal(responseA.body.alphavantage.fetchedAt, completedAtA);
  assert.equal(responseB.body.refreshStartedAt, startedAtB);
  assert.equal(responseB.body.refreshedAt, completedAtB);
  assert.equal(responseB.body.alphavantage.fetchedAt, completedAtB);
});

test('market refresh merges missing tickers from last-known-good rows after a partial provider result', async () => {
  let written;
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    readProviderCache: async () => ({
      alphavantage: {
        rows: [
          { ticker: 'CL', price: 80, source: 'alphavantage' },
          { ticker: 'BZ', price: 84.25, source: 'alphavantage' },
          { ticker: 'HG', price: 4.4, source: 'alphavantage' },
          { ticker: 'ZW', price: 620, source: 'alphavantage' },
          { ticker: 'ZC', price: 440, source: 'alphavantage' },
        ],
        fetchedAt: '2026-08-25T00:00:00.000Z',
        errors: [],
      },
      eia: { rows: [], fetchedAt: null, errors: [] },
      refreshedAt: '2026-08-25T00:00:00.000Z',
    }),
    fetchAlphaVantageCommodities: async () => ({
      rows: [{ ticker: 'CL', price: 82, source: 'alphavantage' }],
      errors: ['av BZ: request_failed'],
      fetchedAt: '2026-08-25T12:00:00.000Z',
    }),
    fetchEiaEnergy: async () => ({ rows: [], errors: [], fetchedAt: null }),
    writeProviderCache: async (payload) => {
      written = payload;
      return {
        blobWrite: { configured: false, ok: false, error: null },
        redisWrite: { configured: true, ok: true, error: null },
      };
    },
    now: () => new Date('2026-08-25T12:01:00.000Z'),
  });
  const response = createResponse();

  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer server-secret' },
  }, response);

  const wti = written.alphavantage.rows.find((row) => row.ticker === 'CL');
  const brent = written.alphavantage.rows.find((row) => row.ticker === 'BZ');
  assert.deepEqual(written.alphavantage.rows.map((row) => row.ticker), ['CL', 'BZ']);
  assert.equal(wti.price, 82);
  assert.equal(brent.price, 84.25);
  assert.equal(brent.stale, true);
  assert.equal(written.alphavantage.fetchedAt, '2026-08-25T12:00:00.000Z');
  assert.equal(avRowsFromCache(written, Date.parse('2026-08-25T12:01:00.000Z')).stale, true);
  assert.equal(response.body.partial, true);
});

test('market providers expose stable failure codes without raw URLs or credentials', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalAlphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  const originalEiaKey = process.env.EIA_API_KEY;
  process.env.ALPHA_VANTAGE_API_KEY = 'alpha-test-secret';
  process.env.EIA_API_KEY = 'eia-test-secret';
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay >= 13_000) {
      callback(...args);
      return 0;
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  globalThis.fetch = async () => {
    throw new Error('request failed at https://provider.test/?api_key=raw-provider-secret');
  };

  try {
    const results = await Promise.all([
      fetchCoinGeckoPrices(),
      fetchCoinGeckoVolumes(),
      fetchAlphaVantageCommodities(),
      fetchEiaEnergy(),
    ]);
    const serialized = JSON.stringify(results);
    assert.equal(serialized.includes('raw-provider-secret'), false);
    assert.equal(serialized.includes('provider.test'), false);
    assert.ok(results.every((result) => result.errors.some(
      (error) => error.includes('request_failed'),
    )));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    if (originalAlphaKey === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = originalAlphaKey;
    if (originalEiaKey === undefined) delete process.env.EIA_API_KEY;
    else process.env.EIA_API_KEY = originalEiaKey;
  }
});

test('market providers return invalid_response instead of rejecting malformed 2xx JSON', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalAlphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  const originalEiaKey = process.env.EIA_API_KEY;
  process.env.ALPHA_VANTAGE_API_KEY = 'alpha-test-secret';
  process.env.EIA_API_KEY = 'eia-test-secret';
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay >= 13_000) {
      callback(...args);
      return 0;
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('malformed body contains raw-json-secret');
    },
  });

  try {
    const settled = await Promise.allSettled([
      fetchCoinGeckoPrices(),
      fetchCoinGeckoVolumes(),
      fetchAlphaVantageCommodities(),
      fetchEiaEnergy(),
    ]);
    assert.ok(settled.every((result) => result.status === 'fulfilled'));
    assert.ok(settled.every((result) => result.value.errors.some(
      (error) => error.includes('invalid_response'),
    )));
    assert.equal(JSON.stringify(settled).includes('raw-json-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    if (originalAlphaKey === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = originalAlphaKey;
    if (originalEiaKey === undefined) delete process.env.EIA_API_KEY;
    else process.env.EIA_API_KEY = originalEiaKey;
  }
});

test('market snapshot rejects unsupported queries and methods before cache or provider fanout', async () => {
  let fanoutCalls = 0;
  const unexpectedAsync = async () => {
    fanoutCalls += 1;
    throw new Error('unexpected fanout');
  };
  const unexpectedSync = () => {
    fanoutCalls += 1;
    throw new Error('unexpected fanout');
  };
  const handler = snapshotModule.createSnapshotHandler({
    now: unexpectedSync,
    readProviderCache: unexpectedAsync,
    getStorageDiagnostics: unexpectedAsync,
    fetchCoinGeckoPrices: unexpectedAsync,
    fetchCoinGeckoVolumes: unexpectedAsync,
    fetchEiaEnergy: unexpectedAsync,
    avRowsFromCache: unexpectedSync,
    eiaRowsFromCache: unexpectedSync,
    mergeMarketSnapshot: unexpectedSync,
    fallbackCommodities: [],
  });
  const queryResponse = createResponse();
  const methodResponse = createResponse();

  await handler({ method: 'GET', query: { _: 'cache-bust' } }, queryResponse);
  await handler({ method: 'POST', query: { _: 'cache-bust' } }, methodResponse);

  assert.equal(queryResponse.statusCode, 400);
  assert.equal(queryResponse.headers['Cache-Control'], 'no-store');
  assert.deepEqual(queryResponse.body, { ok: false, error: 'unsupported query' });
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, 'GET');
  assert.equal(methodResponse.headers['Cache-Control'], 'no-store');
  assert.equal(fanoutCalls, 0);
});

test('market snapshot exposes Redis read diagnostics and CoinGecko observation staleness', async () => {
  assert.equal(typeof snapshotModule.createSnapshotHandler, 'function');
  const fetchedAt = '2026-08-25T12:00:00.000Z';
  const cache = {
    alphavantage: {
      rows: [{ ticker: 'CL', source: 'alphavantage', stale: false }],
      fetchedAt,
      errors: [],
    },
    eia: {
      rows: [{ ticker: 'NG', source: 'eia', stale: false }],
      fetchedAt,
      errors: [],
    },
    refreshedAt: fetchedAt,
  };
  const handler = snapshotModule.createSnapshotHandler({
    now: () => new Date(fetchedAt),
    readProviderCache: async () => ({
      cache,
      diagnostics: {
        blob: true,
        blobAuth: 'oidc-default',
        blobHit: false,
        blobError: 'blob_read_failed',
        redis: true,
        redisHit: true,
        redisError: null,
        kv: false,
        memoryHit: false,
        selectedSource: 'redis',
        durableHit: true,
        readDegraded: true,
      },
    }),
    fetchCoinGeckoPrices: async () => ({
      rows: [{ ticker: 'BTC', source: 'coingecko', stale: true }],
      errors: [],
    }),
    fetchCoinGeckoVolumes: async () => ({ volumes: { BTC: 10 }, errors: [] }),
    fetchEiaEnergy: async () => {
      throw new Error('fresh EIA cache should avoid a live request');
    },
  });
  const response = createResponse();

  await handler({ method: 'GET' }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.partial, true);
  assert.ok(response.body.staleProviders.includes('coingecko'));
  assert.equal(response.body.providers.redis, true);
  assert.equal(response.body.providers.redisHit, true);
  assert.equal(response.body.providers.redisError, undefined);
  assert.equal(response.body.providers.cacheSource, 'redis');
  assert.equal(response.body.providers.persistenceDegraded, true);
});

test('market snapshot counts unique live ticker coverage when deciding partial status', async () => {
  assert.equal(typeof snapshotModule.createSnapshotHandler, 'function');
  const fetchedAt = '2026-08-25T12:00:00.000Z';
  const handler = snapshotModule.createSnapshotHandler({
    now: () => new Date(fetchedAt),
    fallbackCommodities: [],
    readProviderCache: async () => ({
      cache: {
        alphavantage: {
          rows: [{
            ticker: 'CL', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z',
          }],
          fetchedAt,
          errors: [],
        },
        eia: {
          rows: [{ ticker: 'NG', source: 'eia', asOf: '2026-08-25T00:00:00.000Z' }],
          fetchedAt,
          errors: [],
        },
        refreshedAt: fetchedAt,
      },
      diagnostics: {
        blob: true,
        blobHit: true,
        blobError: null,
        redis: true,
        redisHit: true,
        redisError: null,
        kv: false,
        memoryHit: false,
        selectedSource: 'redis',
        durableHit: true,
        readDegraded: false,
      },
    }),
    fetchCoinGeckoPrices: async () => ({
      rows: [
        { ticker: 'BTC', source: 'coingecko', stale: false },
        { ticker: 'BTC', source: 'coingecko', stale: false },
      ],
      errors: [],
    }),
    fetchCoinGeckoVolumes: async () => ({ volumes: {}, errors: [] }),
    mergeMarketSnapshot: () => ({
      commodities: [],
      meta: {
        liveSymbolCount: 4,
        liveTickers: ['BTC', 'CL', 'NG'],
        sources: { coingecko: 2, alphavantage: 1, eia: 1 },
        staleProviders: [],
      },
    }),
  });
  const response = createResponse();

  await handler({ method: 'GET' }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.liveSymbolCount, 3);
  assert.equal(response.body.partial, false);
});

test('market refresh does not expose dependency exception messages', async () => {
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    readProviderCache: async () => {
      throw new Error('Redis URL https://redis.test/?token=raw-refresh-secret');
    },
  });
  const response = createResponse();

  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer server-secret' },
  }, response);

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, 'market refresh failed');
  assert.equal(JSON.stringify(response.body).includes('raw-refresh-secret'), false);
});

test('market snapshot does not expose rejected provider exception messages', async () => {
  const fetchedAt = '2026-08-25T12:00:00.000Z';
  const handler = snapshotModule.createSnapshotHandler({
    now: () => new Date(fetchedAt),
    readProviderCache: async () => ({
      cache: {
        alphavantage: { rows: [], fetchedAt, errors: [] },
        eia: { rows: [], fetchedAt, errors: [] },
        refreshedAt: fetchedAt,
      },
      diagnostics: {
        blob: false,
        blobHit: false,
        blobError: null,
        redis: false,
        redisHit: false,
        redisError: null,
        kv: false,
        memoryHit: true,
        selectedSource: 'memory',
        durableHit: false,
        readDegraded: false,
      },
    }),
    fetchCoinGeckoPrices: async () => {
      throw new Error('signed request https://provider.test/?token=raw-snapshot-secret');
    },
    fetchCoinGeckoVolumes: async () => ({ volumes: {}, errors: [] }),
    fetchEiaEnergy: async () => ({ rows: [], errors: [], fetchedAt }),
  });
  const response = createResponse();

  await handler({ method: 'GET' }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.stringify(response.body).includes('raw-snapshot-secret'), false);
  assert.ok(response.body.errors.some((error) => error.includes('request_failed')));
});

test('market snapshot is partial when the selected cache exists only in bounded memory', async () => {
  const fetchedAt = '2026-08-25T12:00:00.000Z';
  const handler = snapshotModule.createSnapshotHandler({
    now: () => new Date(fetchedAt),
    fallbackCommodities: [],
    readProviderCache: async () => ({
      cache: {
        alphavantage: {
          rows: [{ ticker: 'B', source: 'alphavantage' }],
          fetchedAt,
          errors: [],
        },
        eia: {
          rows: [{ ticker: 'C', source: 'eia' }],
          fetchedAt,
          errors: [],
        },
        refreshedAt: fetchedAt,
      },
      diagnostics: {
        blob: true,
        blobHit: true,
        blobError: null,
        redis: true,
        redisHit: true,
        redisError: null,
        kv: false,
        memoryHit: true,
        selectedSource: 'memory',
        durableHit: true,
        readDegraded: false,
      },
    }),
    fetchCoinGeckoPrices: async () => ({
      rows: [{ ticker: 'A', source: 'coingecko', stale: false }],
      errors: [],
    }),
    fetchCoinGeckoVolumes: async () => ({ volumes: {}, errors: [] }),
    mergeMarketSnapshot: () => ({
      commodities: [],
      meta: {
        liveSymbolCount: 3,
        liveTickers: ['A', 'B', 'C'],
        sources: { coingecko: 1, alphavantage: 1, eia: 1 },
        staleProviders: [],
      },
    }),
  });
  const response = createResponse();

  await handler({ method: 'GET' }, response);

  assert.equal(response.body.providers.cacheSource, 'memory');
  assert.equal(response.body.providers.persistenceDegraded, true);
  assert.equal(response.body.partial, true);
});

test('market snapshot retains the stale cached EIA row when a live retry fails', async () => {
  const now = Date.parse('2026-08-25T15:00:00.000Z');
  const staleFetchedAt = new Date(now - 14 * 60 * 60 * 1000).toISOString();
  const handler = snapshotModule.createSnapshotHandler({
    now: () => new Date(now),
    fallbackCommodities: [],
    readProviderCache: async () => ({
      cache: {
        alphavantage: {
          rows: [{
            ticker: 'CL', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z',
          }],
          fetchedAt: new Date(now).toISOString(),
          errors: [],
        },
        eia: {
          rows: [{ ticker: 'NG', price: 3.1, source: 'eia' }],
          fetchedAt: staleFetchedAt,
          errors: [],
        },
        refreshedAt: new Date(now).toISOString(),
      },
      diagnostics: {
        blob: true,
        blobHit: true,
        blobError: null,
        redis: true,
        redisHit: true,
        redisError: null,
        kv: false,
        memoryHit: false,
        selectedSource: 'redis',
        durableHit: true,
        readDegraded: false,
      },
    }),
    fetchCoinGeckoPrices: async () => ({
      rows: [{ ticker: 'BTC', source: 'coingecko', stale: false }],
      errors: [],
    }),
    fetchCoinGeckoVolumes: async () => ({ volumes: {}, errors: [] }),
    fetchEiaEnergy: async () => ({
      rows: [],
      errors: ['eia NG: request_failed'],
      fetchedAt: new Date(now).toISOString(),
    }),
    mergeMarketSnapshot: (liveRows) => ({
      commodities: liveRows,
      meta: {
        liveSymbolCount: liveRows.length,
        liveTickers: ['BTC', 'CL', 'NG'],
        sources: { coingecko: 1, alphavantage: 1, eia: 1 },
        staleProviders: [],
      },
    }),
  });
  const response = createResponse();

  await handler({ method: 'GET' }, response);

  assert.equal(response.body.commodities.find((row) => row.ticker === 'NG').price, 3.1);
  assert.equal(response.body.commodities.find((row) => row.ticker === 'NG').stale, true);
  assert.ok(response.body.staleProviders.includes('eia'));
  assert.equal(response.body.partial, true);
});

test('market snapshot reports unavailable empty providers as missing rather than stale', async () => {
  const now = new Date('2026-08-25T15:00:00.000Z');
  const handler = snapshotModule.createSnapshotHandler({
    now: () => now,
    fallbackCommodities: [],
    readProviderCache: async () => ({
      cache: null,
      diagnostics: {
        blob: false,
        blobHit: false,
        blobError: null,
        redis: false,
        redisHit: false,
        redisError: null,
        kv: false,
        memoryHit: false,
        selectedSource: null,
        durableHit: false,
        readDegraded: false,
      },
    }),
    fetchCoinGeckoPrices: async () => ({
      rows: [{ ticker: 'A', source: 'coingecko', stale: false }],
      errors: [],
    }),
    fetchCoinGeckoVolumes: async () => ({ volumes: {}, errors: [] }),
    fetchEiaEnergy: async () => ({
      rows: [],
      errors: ['eia request_failed'],
      fetchedAt: now.toISOString(),
    }),
    mergeMarketSnapshot: (liveRows) => ({
      commodities: liveRows,
      meta: {
        liveSymbolCount: 1,
        liveTickers: ['A'],
        sources: { coingecko: 1, alphavantage: 0, eia: 0 },
        staleProviders: [],
      },
    }),
  });
  const response = createResponse();

  await handler({ method: 'GET' }, response);

  assert.equal(response.body.partial, true);
  assert.equal(response.body.staleProviders.includes('alphavantage'), false);
  assert.equal(response.body.staleProviders.includes('eia'), false);
  assert.ok(response.body.errors.some((error) => error.includes('alphavantage')));
  assert.ok(response.body.errors.some((error) => error.includes('eia')));
});

test('market snapshot clears cached EIA degradation after a complete live recovery', async () => {
  const now = Date.parse('2026-08-25T15:00:00.000Z');
  const staleFetchedAt = new Date(now - 14 * 60 * 60 * 1000).toISOString();
  const handler = snapshotModule.createSnapshotHandler({
    now: () => new Date(now),
    fallbackCommodities: [],
    readProviderCache: async () => ({
      cache: {
        alphavantage: {
          rows: [{
            ticker: 'CL', source: 'alphavantage', asOf: '2026-08-25T00:00:00.000Z',
          }],
          fetchedAt: new Date(now).toISOString(),
          errors: [],
        },
        eia: {
          rows: [{ ticker: 'NG', price: 3.1, source: 'eia' }],
          fetchedAt: staleFetchedAt,
          errors: ['eia: previous refresh degraded'],
        },
        refreshedAt: new Date(now).toISOString(),
      },
      diagnostics: {
        blob: true,
        blobHit: true,
        blobError: null,
        redis: true,
        redisHit: true,
        redisError: null,
        kv: false,
        memoryHit: false,
        selectedSource: 'redis',
        durableHit: true,
        readDegraded: false,
      },
    }),
    fetchCoinGeckoPrices: async () => ({
      rows: [{ ticker: 'BTC', source: 'coingecko', stale: false }],
      errors: [],
    }),
    fetchCoinGeckoVolumes: async () => ({ volumes: {}, errors: [] }),
    fetchEiaEnergy: async () => ({
      rows: [{
        ticker: 'NG', price: 3.2, source: 'eia',
        asOf: '2026-08-25T00:00:00.000Z', stale: false,
      }],
      errors: [],
      fetchedAt: new Date(now).toISOString(),
    }),
    mergeMarketSnapshot: (liveRows) => ({
      commodities: liveRows,
      meta: {
        liveSymbolCount: liveRows.length,
        liveTickers: ['BTC', 'CL', 'NG'],
        sources: { coingecko: 1, alphavantage: 1, eia: 1 },
        staleProviders: [],
      },
    }),
  });
  const response = createResponse();

  await handler({ method: 'GET' }, response);

  assert.equal(response.body.partial, false);
  assert.equal(response.body.staleProviders.includes('eia'), false);
  assert.equal(response.body.errors, undefined);
});

test('market refresh rejects cron secrets supplied in the query string', async () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalAlphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  const originalEiaKey = process.env.EIA_API_KEY;
  const originalSetTimeout = globalThis.setTimeout;

  process.env.CRON_SECRET = 'server-secret';
  delete process.env.ALPHA_VANTAGE_API_KEY;
  delete process.env.EIA_API_KEY;
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };

  try {
    const response = createResponse();
    await refreshHandler({
      method: 'GET',
      headers: {},
      query: { secret: 'server-secret' },
    }, response);

    assert.equal(response.statusCode, 401);
    assert.equal(response.body?.error, 'unauthorized');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
    if (originalAlphaKey === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = originalAlphaKey;
    if (originalEiaKey === undefined) delete process.env.EIA_API_KEY;
    else process.env.EIA_API_KEY = originalEiaKey;
  }
});

test('market refresh preserves last-known-good provider rows when refreshes are empty', async () => {
  const previous = {
    alphavantage: {
      rows: [{ ticker: 'CL', price: 81.25, source: 'alphavantage' }],
      fetchedAt: '2026-08-25T10:00:00.000Z',
      errors: [],
    },
    eia: {
      rows: [{ ticker: 'NG', price: 3.25, source: 'eia' }],
      fetchedAt: '2026-08-25T10:00:00.000Z',
      errors: [],
    },
    refreshedAt: '2026-08-25T10:00:00.000Z',
  };
  let stored;
  const handler = refreshModule.createRefreshHandler({
    cronSecret: 'server-secret',
    now: () => new Date('2026-08-25T12:00:00.000Z'),
    readProviderCache: async () => previous,
    fetchAlphaVantageCommodities: async () => ({
      rows: [],
      fetchedAt: '2026-08-25T12:00:00.000Z',
      errors: ['alphavantage unavailable'],
    }),
    fetchEiaEnergy: async () => ({
      rows: [],
      fetchedAt: '2026-08-25T12:00:00.000Z',
      errors: ['eia unavailable'],
    }),
    writeProviderCache: async (payload) => {
      stored = payload;
      return {
        blobWrite: { configured: false, ok: false, error: null },
        redisWrite: { configured: false, ok: false, error: null },
      };
    },
  });
  const response = createResponse();
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer server-secret' },
    query: {},
  }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.degradedPersistence, true);
  assert.equal(response.body.alphavantage.rows[0]?.ticker, 'CL');
  assert.equal(response.body.eia.rows[0]?.ticker, 'NG');
  assert.equal(stored.alphavantage.rows[0]?.price, 81.25);
  assert.equal(stored.eia.rows[0]?.price, 3.25);
});

test('market snapshot degrades gracefully when one live provider throws', async () => {
  const originalFetch = globalThis.fetch;
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/simple/price')) throw new Error('network down');
    if (target.includes('/coins/markets')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const fetchedAt = new Date().toISOString();
    await writeProviderCache({
      alphavantage: {
        rows: [{ ticker: 'CL', price: 81.25, changePct: 1, source: 'alphavantage' }],
        fetchedAt,
      },
      eia: {
        rows: [{ ticker: 'NG', price: 3.25, changePct: -1, source: 'eia' }],
        fetchedAt,
      },
      refreshedAt: fetchedAt,
    });

    const response = createResponse();
    await snapshotHandler({ method: 'GET' }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.partial, true);
    assert.ok(response.body.commodities.length > 0);
    assert.ok(response.body.errors.some((error) => error.includes('coingecko')));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  }
});

test('live provider requests time out and return a degraded result', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.MARKET_FETCH_TIMEOUT_MS;
  process.env.MARKET_FETCH_TIMEOUT_MS = '10';

  globalThis.fetch = async (_url, options = {}) => {
    if (!options.signal) throw new Error('missing abort signal');
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    let thrown;
    let result;
    try {
      result = await fetchCoinGeckoPrices();
    } catch (error) {
      thrown = error;
    }

    assert.equal(thrown, undefined);
    assert.deepEqual(result.rows, []);
    assert.ok(result.errors.some((error) => error.includes('timeout')));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.MARKET_FETCH_TIMEOUT_MS;
    else process.env.MARKET_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

test('market fetch timeout remains active while the response body is consumed', async () => {
  const originalTimeout = process.env.MARKET_FETCH_TIMEOUT_MS;
  process.env.MARKET_FETCH_TIMEOUT_MS = '10';
  let bodyController;
  const stalledBody = new ReadableStream({
    start(controller) {
      bodyController = controller;
    },
  });

  try {
    await assert.rejects(
      fetchWithTimeout(
        'https://provider.test/stalled-body?token=must-not-leak',
        {},
        async () => new Response(stalledBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
      (error) => (
        error?.code === 'UPSTREAM_TIMEOUT'
        && error.message === 'upstream timeout'
        && !String(error).includes('must-not-leak')
      ),
    );
  } finally {
    try {
      bodyController?.close();
    } catch {
      // The aborted response may already have closed its stream.
    }
    if (originalTimeout === undefined) delete process.env.MARKET_FETCH_TIMEOUT_MS;
    else process.env.MARKET_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

test('storage diagnostics recognize the supported Upstash Redis integration', async () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const diagnostics = await getStorageDiagnostics({ alphavantage: { rows: [] } });
    assert.equal(diagnostics.redis, true);
    assert.equal(diagnostics.kv, false);
  } finally {
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalKvUrl;
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalKvToken;
  }
});

test('Redis configuration requires a complete Upstash or complete legacy KV credential pair', async () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;

  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  process.env.KV_REST_API_TOKEN = 'legacy-token-without-legacy-url';

  try {
    const mixed = await getStorageDiagnostics();
    assert.equal(mixed.redis, false);

    delete process.env.UPSTASH_REDIS_REST_URL;
    process.env.KV_REST_API_URL = 'https://legacy-redis.example.test';
    const legacy = await getStorageDiagnostics();
    assert.equal(legacy.redis, true);
    assert.equal(legacy.kv, true);
  } finally {
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalKvUrl;
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalKvToken;
  }
});
