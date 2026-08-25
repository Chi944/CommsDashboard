const CACHE_KEY = 'market:provider-cache';
const CACHE_VERSION_KEY = `${CACHE_KEY}:refreshed-at-ms`;
const BLOB_PATHNAME = 'market/provider-cache.json';
const MEMORY_CACHE_MAX_AGE_MS = 60 * 1000;
const DURABLE_CACHE_TTL_SECONDS = 90_000;
const BLOB_CAS_ATTEMPTS = 4;

const REDIS_WRITE_NEWEST_SCRIPT = `
local currentPayload = redis.call('GET', KEYS[1])
local currentVersion = nil
if currentPayload then
  currentVersion = tonumber(redis.call('GET', KEYS[2]))
end

if currentVersion and currentVersion >= tonumber(ARGV[1]) then
  return 0
end

if currentPayload and not currentVersion then
  local decodedOk, decoded = pcall(cjson.decode, currentPayload)
  if decodedOk and type(decoded) == 'table' then
    local decodedVersion = decoded.refreshStartedAt
    if type(decodedVersion) ~= 'string' then
      decodedVersion = decoded.refreshedAt
    end
    local canonical = string.match(
      decodedVersion or '',
      '^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%.%d%d%dZ$'
    )
    if canonical and decodedVersion >= ARGV[4] then
      return 0
    end
  end
end

redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[3])
return 1
`;

/** @type {{ alphavantage?: { rows: object[], fetchedAt: string }, eia?: { rows: object[], fetchedAt: string }, refreshedAt?: string } | null} */
let memoryCache = null;
let memoryCachedAt = 0;
let lastStorageDiagnostics = null;

export function selectNewestProviderCache(candidates) {
  let newest = null;

  for (const candidate of candidates || []) {
    const refreshedAt = candidate?.data?.refreshedAt;
    const versionMs = cacheVersionMs(candidate?.data);
    if (versionMs === null) continue;
    if (!newest || versionMs >= newest.versionMs) {
      newest = {
        source: candidate.source,
        data: candidate.data,
        refreshedAt,
        versionMs,
      };
    }
  }

  if (!newest) return { source: null, data: null, refreshedAt: null };
  return {
    source: newest.source,
    data: newest.data,
    refreshedAt: newest.refreshedAt,
  };
}

function cacheVersionMs(data) {
  const version = Date.parse(data?.refreshStartedAt ?? data?.refreshedAt);
  return Number.isFinite(version) ? version : null;
}

/**
 * Store only a newer Blob cache payload using an adapter backed by an atomic
 * create or ETag-conditional update. A conflict is retried against the winner.
 */
export async function writeNewestBlobCache(payload, adapter, options = {}) {
  const incomingVersion = cacheVersionMs(payload);
  if (incomingVersion === null || !adapter?.read || !adapter?.write) {
    return { ok: false, skipped: false, error: 'blob_write_failed' };
  }

  const attempts = Math.max(1, options.attempts ?? BLOB_CAS_ATTEMPTS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let current;
    try {
      current = await adapter.read();
    } catch {
      return { ok: false, skipped: false, error: 'blob_write_failed' };
    }

    const currentVersion = cacheVersionMs(current?.data);
    if (currentVersion !== null && currentVersion >= incomingVersion) {
      return { ok: true, skipped: true, error: null };
    }

    try {
      await adapter.write(payload, current?.etag ?? null);
      return { ok: true, skipped: false, error: null };
    } catch (error) {
      // A missing blob is created with overwrite disabled, so any failed create
      // may be a concurrent winner. Existing blobs expose a typed ETag conflict.
      const mayBeConcurrentCreate = !current?.etag;
      const isEtagConflict = Boolean(adapter.isConflict?.(error));
      if (!mayBeConcurrentCreate && !isEtagConflict) {
        return { ok: false, skipped: false, error: 'blob_write_failed' };
      }
    }
  }

  return { ok: false, skipped: false, error: 'blob_write_failed' };
}

/** Store a cache payload through a single timestamp-aware Redis Lua command. */
export async function writeNewestRedisCache(payload, redis) {
  const incomingVersion = cacheVersionMs(payload);
  if (incomingVersion === null || typeof redis?.eval !== 'function') {
    return { ok: false, skipped: false, error: 'redis_write_failed' };
  }

  try {
    const result = await redis.eval(
      REDIS_WRITE_NEWEST_SCRIPT,
      [CACHE_KEY, CACHE_VERSION_KEY],
      [
        String(incomingVersion),
        JSON.stringify(payload),
        String(DURABLE_CACHE_TTL_SECONDS),
        new Date(incomingVersion).toISOString(),
      ],
    );
    if (Number(result) === 1) return { ok: true, skipped: false, error: null };
    if (Number(result) === 0) return { ok: true, skipped: true, error: null };
  } catch {
    // Keep provider and credential details out of durable-write diagnostics.
  }
  return { ok: false, skipped: false, error: 'redis_write_failed' };
}

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN || null;
}

function blobAuthMode() {
  if (process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN && !process.env.BLOB_READ_WRITE_TOKEN) {
    return 'token';
  }
  if (process.env.BLOB_STORE_ID) return 'oidc-default';
  if (blobToken()) return 'token';
  return 'none';
}

function blobConfigured() {
  return blobAuthMode() !== 'none';
}

function blobOptions(options) {
  if (process.env.BLOB_READ_WRITE_TOKEN) return options;
  const token = process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  return token ? { ...options, token } : options;
}

function redisConfig() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    };
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    };
  }
  return null;
}

async function blobJsonFromStream(result) {
  if (!result?.stream) return null;
  const text = await new Response(result.stream).text();
  const data = JSON.parse(text);
  return data && typeof data === 'object' ? data : null;
}

export async function readBlobCacheSnapshot(getBlob, isNotFound) {
  try {
    const result = await getBlob();
    if (!result) return { data: null, etag: null };
    let data = null;
    try {
      data = await blobJsonFromStream(result);
    } catch {
      // Preserve the ETag so a valid payload can replace corrupt JSON safely.
    }
    return {
      data,
      etag: result.blob?.etag ?? null,
    };
  } catch (error) {
    if (isNotFound?.(error)) return { data: null, etag: null };
    throw error;
  }
}

async function readFromBlob() {
  if (!blobConfigured()) return { data: null, error: null };

  try {
    const { get, list } = await import('@vercel/blob');
    const opts = blobOptions({ access: 'private', useCache: false });

    let result = await get(BLOB_PATHNAME, opts);
    let data = await blobJsonFromStream(result);

    if (!data) {
      const { blobs } = await list(blobOptions({ prefix: 'market/', limit: 20 }));
      const hit = blobs?.find(
        (b) => b.pathname === BLOB_PATHNAME || b.pathname?.endsWith('provider-cache.json'),
      );
      if (hit?.url) {
        result = await get(hit.url, opts);
        data = await blobJsonFromStream(result);
      }
    }

    if (!data) return { data: null, error: null };
    return { data, error: null };
  } catch (e) {
    if (e?.name === 'BlobNotFoundError') return { data: null, error: null };
    return { data: null, error: 'blob_read_failed' };
  }
}

async function writeToBlob(payload) {
  if (!blobConfigured()) return { ok: false, error: null };

  try {
    const {
      BlobNotFoundError,
      BlobPreconditionFailedError,
      get,
      put,
    } = await import('@vercel/blob');
    const readOptions = blobOptions({ access: 'private', useCache: false });
    const writeOptions = {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
    };
    return await writeNewestBlobCache(payload, {
      read: async () => readBlobCacheSnapshot(
        () => get(BLOB_PATHNAME, readOptions),
        (error) => (
          error instanceof BlobNotFoundError
          || error?.name === 'BlobNotFoundError'
        ),
      ),
      write: async (nextPayload, expectedEtag) => {
        const concurrencyOptions = expectedEtag
          ? { ifMatch: expectedEtag }
          : { allowOverwrite: false };
        await put(
          BLOB_PATHNAME,
          JSON.stringify(nextPayload),
          blobOptions({ ...writeOptions, ...concurrencyOptions }),
        );
      },
      isConflict: (error) => (
        error instanceof BlobPreconditionFailedError
        || error?.name === 'BlobPreconditionFailedError'
      ),
    });
  } catch {
    return { ok: false, error: 'blob_write_failed' };
  }
}

async function readFromRedis() {
  const config = redisConfig();
  if (!config) return { data: null, error: null };
  try {
    const { Redis } = await import('@upstash/redis');
    const v = await new Redis(config).get(CACHE_KEY);
    if (v && typeof v === 'object') return { data: v, error: null };
    return { data: null, error: null };
  } catch {
    return { data: null, error: 'redis_read_failed' };
  }
}

async function writeToRedis(payload) {
  const config = redisConfig();
  if (!config) return { ok: false, error: null };
  try {
    const { Redis } = await import('@upstash/redis');
    return await writeNewestRedisCache(payload, new Redis(config));
  } catch {
    return { ok: false, error: 'redis_write_failed' };
  }
}

function validCacheData(data) {
  return Boolean(data && typeof data === 'object' && Number.isFinite(Date.parse(data.refreshedAt)));
}

function memoryCandidate(nowMs) {
  if (!memoryCache) return null;
  if (nowMs - memoryCachedAt <= MEMORY_CACHE_MAX_AGE_MS) return memoryCache;
  memoryCache = null;
  memoryCachedAt = 0;
  return null;
}

async function runReadProbe(reader, source, configured) {
  if (!configured) return { data: null, error: null };
  try {
    const result = await reader();
    const data = result?.data ?? null;
    if (data && !validCacheData(data)) {
      return { data: null, error: `${source}_invalid_cache` };
    }
    return {
      data,
      error: result?.error ? `${source}_read_failed` : null,
    };
  } catch {
    return { data: null, error: `${source}_read_failed` };
  }
}

export async function readProviderCache(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const hasMemoryOverride = Object.prototype.hasOwnProperty.call(options, 'memory');
  const memory = hasMemoryOverride ? options.memory : memoryCandidate(nowMs);
  const isBlobConfigured = options.blobConfigured ?? blobConfigured();
  const isRedisConfigured = options.redisConfigured ?? Boolean(redisConfig());

  const [blobProbe, redisProbe] = await Promise.all([
    runReadProbe(options.readBlob || readFromBlob, 'blob', isBlobConfigured),
    runReadProbe(options.readRedis || readFromRedis, 'redis', isRedisConfigured),
  ]);
  const selected = selectNewestProviderCache([
    { source: 'memory', data: memory },
    { source: 'blob', data: blobProbe.data },
    { source: 'redis', data: redisProbe.data },
  ]);

  if (selected.data && selected.source !== 'memory') {
    memoryCache = selected.data;
    memoryCachedAt = nowMs;
  }

  const diagnostics = {
    blob: isBlobConfigured,
    blobAuth: options.blobAuth ?? blobAuthMode(),
    blobHit: Boolean(blobProbe.data),
    blobError: blobProbe.error,
    redis: isRedisConfigured,
    redisHit: Boolean(redisProbe.data),
    redisError: redisProbe.error,
    kv: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    memoryHit: validCacheData(memory),
    selectedSource: selected.source,
    cacheRefreshedAt: selected.refreshedAt,
    durableHit: Boolean(blobProbe.data || redisProbe.data),
    readDegraded: Boolean(
      (isBlobConfigured && blobProbe.error)
      || (isRedisConfigured && redisProbe.error)
    ),
  };
  lastStorageDiagnostics = diagnostics;

  if (options.withDiagnostics) return { cache: selected.data, diagnostics };
  return selected.data;
}

/** @returns {Promise<{ blob: boolean, blobHit: boolean, blobError: string | null, redis: boolean, redisHit: boolean, redisError: string | null, kv: boolean, avRows: number }>} */
export async function getStorageDiagnostics(cache = null) {
  const sameCache = cache?.refreshedAt
    && cache.refreshedAt === lastStorageDiagnostics?.cacheRefreshedAt;
  const diagnostics = sameCache
    ? lastStorageDiagnostics
    : {
      blob: blobConfigured(),
      blobAuth: blobAuthMode(),
      blobHit: false,
      blobError: null,
      redis: Boolean(redisConfig()),
      redisHit: false,
      redisError: null,
      kv: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
      memoryHit: validCacheData(cache),
      selectedSource: null,
      cacheRefreshedAt: cache?.refreshedAt ?? null,
      durableHit: false,
      readDegraded: false,
    };
  return {
    ...diagnostics,
    avRows: cache?.alphavantage?.rows?.length ?? 0,
  };
}

async function runWrite(writer, source, configured, payload) {
  if (!configured) return { configured: false, ok: false, error: null };
  try {
    const result = await writer(payload);
    if (result?.ok) {
      return {
        configured: true,
        ok: true,
        error: null,
        ...(result.skipped ? { skipped: true } : {}),
      };
    }
    return { configured: true, ok: false, error: `${source}_write_failed` };
  } catch {
    return { configured: true, ok: false, error: `${source}_write_failed` };
  }
}

export async function writeProviderCache(payload, options = {}) {
  const incomingVersion = cacheVersionMs(payload);
  const memoryVersion = cacheVersionMs(memoryCache);
  if (incomingVersion !== null && (memoryVersion === null || incomingVersion >= memoryVersion)) {
    memoryCache = payload;
    memoryCachedAt = options.nowMs ?? Date.now();
  }
  const isBlobConfigured = options.blobConfigured ?? blobConfigured();
  const isRedisConfigured = options.redisConfigured ?? Boolean(redisConfig());
  const [blobWrite, redisWrite] = await Promise.all([
    runWrite(options.writeBlob || writeToBlob, 'blob', isBlobConfigured, payload),
    runWrite(options.writeRedis || writeToRedis, 'redis', isRedisConfigured, payload),
  ]);
  const writes = [blobWrite, redisWrite];
  const configuredWrites = writes.filter((write) => write.configured).length;
  const successfulWrites = writes.filter((write) => write.ok).length;
  const configuredFailures = writes.filter((write) => write.configured && !write.ok).length;
  const durableWriteSucceeded = successfulWrites > 0;
  const degradedPersistence = !durableWriteSucceeded || configuredFailures > 0;

  return {
    payload,
    blobWrite,
    redisWrite,
    durableWriteSucceeded,
    degradedPersistence,
    configuredWrites,
    successfulWrites,
  };
}
