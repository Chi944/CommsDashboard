const SNAPSHOT_KEY = 'smart-money:v1:snapshot';
const SNAPSHOT_VERSION_KEY = 'smart-money:v1:snapshot:refresh-started-at-ms';
const SNAPSHOT_BLOB = 'smart-money/v1/snapshot.json';
const BLOB_CAS_ATTEMPTS = 6;

const REDIS_WRITE_NEWEST_SCRIPT = `
local currentPayload = redis.call('GET', KEYS[1])
local currentVersion = redis.call('GET', KEYS[2])
local currentVersionNumber = tonumber(currentVersion)
local function finite(value)
  return type(value) == 'number'
    and value == value
    and value ~= math.huge
    and value ~= -math.huge
end
if not finite(currentVersionNumber) then
  currentVersionNumber = nil
end
local legacyVersionNumber = tonumber(ARGV[4])
if not currentVersionNumber
  and finite(legacyVersionNumber)
  and currentPayload
  and currentPayload == ARGV[5] then
  currentVersionNumber = legacyVersionNumber
end
if currentVersionNumber and currentVersionNumber >= tonumber(ARGV[1]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[1])
return 1
`;

let memorySnapshot = null;
let memoryStoredAt = 0;

function generationMs(data) {
  if (typeof data?.refreshStartedAt !== 'string') return null;
  const parsed = new Date(data.refreshStartedAt);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === data.refreshStartedAt
    ? parsed.getTime()
    : null;
}

function productionLike() {
  const vercel = String(process.env.VERCEL || '').trim().toLowerCase();
  return process.env.NODE_ENV === 'production'
    || (Boolean(vercel) && vercel !== '0' && vercel !== 'false');
}

function redisConfiguration() {
  const candidates = [
    { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN },
    { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN },
  ];
  const complete = candidates.find(({ url, token }) => Boolean(url && token));
  const incomplete = candidates.some(({ url, token }) => Boolean(url || token) && !Boolean(url && token));
  return { complete: complete ?? null, incomplete };
}

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN || null;
}

function blobConfiguration() {
  return {
    configured: Boolean(blobToken() || process.env.BLOB_STORE_ID),
    auth: blobToken() ? 'token' : process.env.BLOB_STORE_ID ? 'oidc-default' : 'none',
  };
}

function blobOptions(options) {
  if (process.env.BLOB_READ_WRITE_TOKEN) return options;
  const token = process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  return token ? { ...options, token } : options;
}

function storageConfiguration(options) {
  const explicitBlob = Object.hasOwn(options, 'blobConfigured');
  const explicitRedis = Object.hasOwn(options, 'redisConfigured');
  const redis = redisConfiguration();
  const blob = blobConfiguration();
  const blobConfigured = explicitBlob ? options.blobConfigured === true : blob.configured;
  const redisConfigured = explicitRedis ? options.redisConfigured === true : Boolean(redis.complete);
  const invalid = (!explicitRedis && redis.incomplete)
    || ((!explicitBlob && !explicitRedis) && productionLike() && !blobConfigured && !redisConfigured);
  return { blobConfigured, redisConfigured, invalid, blobAuth: blob.auth };
}

export function selectNewestSmartMoneySnapshot(candidates) {
  let selected = null;
  for (const candidate of candidates || []) {
    const version = generationMs(candidate?.data);
    if (version === null) continue;
    if (!selected || version > selected.version) {
      selected = { source: candidate.source, data: candidate.data, version };
    }
  }
  return selected
    ? { source: selected.source, data: selected.data, refreshStartedAt: selected.data.refreshStartedAt }
    : { source: null, data: null, refreshStartedAt: null };
}

export async function writeNewestSmartMoneyBlob(payload, adapter, options = {}) {
  const incomingVersion = generationMs(payload);
  if (incomingVersion === null || typeof adapter?.read !== 'function'
      || typeof adapter?.write !== 'function') {
    return { ok: false, skipped: false, error: 'blob_write_failed' };
  }
  const attempts = Math.max(1, Math.min(20, Math.floor(options.attempts ?? BLOB_CAS_ATTEMPTS)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let current;
    try {
      current = await adapter.read();
    } catch {
      return { ok: false, skipped: false, error: 'blob_write_failed' };
    }
    const currentVersion = generationMs(current?.data);
    if (currentVersion !== null && currentVersion >= incomingVersion) {
      return { ok: true, skipped: true, error: null };
    }
    try {
      await adapter.write(payload, current?.etag ?? null);
      return { ok: true, skipped: false, error: null };
    } catch (error) {
      const concurrentCreate = !current?.etag;
      if (!concurrentCreate && !adapter.isConflict?.(error)) {
        return { ok: false, skipped: false, error: 'blob_write_failed' };
      }
    }
  }
  return { ok: false, skipped: false, error: 'blob_write_failed' };
}

export async function writeNewestSmartMoneyRedis(payload, redis) {
  const incomingVersion = generationMs(payload);
  if (incomingVersion === null || typeof redis?.eval !== 'function') {
    return { ok: false, skipped: false, error: 'redis_write_failed' };
  }
  try {
    let legacyVersion = '';
    let legacyPayload = '';
    if (typeof redis.get === 'function') {
      try {
        const [currentPayload, currentVersion] = await Promise.all([
          redis.get(SNAPSHOT_KEY),
          redis.get(SNAPSHOT_VERSION_KEY),
        ]);
        const numericVersion = Number(currentVersion);
        const finiteVersion = currentVersion !== null && currentVersion !== undefined
          && currentVersion !== '' && Number.isFinite(numericVersion);
        if (!finiteVersion && currentPayload != null) {
          let decoded = currentPayload;
          if (typeof decoded === 'string') {
            try { decoded = JSON.parse(decoded); } catch { decoded = null; }
          }
          const candidate = generationMs(decoded);
          if (candidate !== null) {
            legacyVersion = String(candidate);
            legacyPayload = typeof currentPayload === 'string'
              ? currentPayload
              : JSON.stringify(currentPayload);
          }
        }
      } catch {
        // The atomic Lua command remains authoritative if preflight reads fail.
      }
    }
    const result = await redis.eval(
      REDIS_WRITE_NEWEST_SCRIPT,
      [SNAPSHOT_KEY, SNAPSHOT_VERSION_KEY],
      [
        String(incomingVersion),
        JSON.stringify(payload),
        new Date(incomingVersion).toISOString(),
        legacyVersion,
        legacyPayload,
      ],
    );
    if (Number(result) === 1) return { ok: true, skipped: false, error: null };
    if (Number(result) === 0) return { ok: true, skipped: true, error: null };
  } catch {
    // Diagnostics are deliberately reduced to a fixed code below.
  }
  return { ok: false, skipped: false, error: 'redis_write_failed' };
}

async function blobJson(result) {
  if (!result?.stream) return null;
  const data = JSON.parse(await new Response(result.stream).text());
  return data && typeof data === 'object' ? data : null;
}

async function readBlobSnapshot() {
  try {
    const { BlobNotFoundError, get } = await import('@vercel/blob');
    try {
      const result = await get(SNAPSHOT_BLOB, blobOptions({ access: 'private', useCache: false }));
      return { data: await blobJson(result), error: null };
    } catch (error) {
      if (error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError') {
        return { data: null, error: null };
      }
      throw error;
    }
  } catch {
    return { data: null, error: 'blob_read_failed' };
  }
}

async function writeBlobSnapshot(payload) {
  try {
    const { BlobNotFoundError, BlobPreconditionFailedError, get, put } = await import('@vercel/blob');
    const readOptions = blobOptions({ access: 'private', useCache: false });
    return await writeNewestSmartMoneyBlob(payload, {
      read: async () => {
        try {
          const result = await get(SNAPSHOT_BLOB, readOptions);
          return { data: await blobJson(result), etag: result?.blob?.etag ?? null };
        } catch (error) {
          if (error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError') {
            return { data: null, etag: null };
          }
          throw error;
        }
      },
      write: async (data, expectedEtag) => {
        await put(SNAPSHOT_BLOB, JSON.stringify(data), blobOptions({
          access: 'private',
          addRandomSuffix: false,
          contentType: 'application/json',
          ...(expectedEtag ? { ifMatch: expectedEtag } : { allowOverwrite: false }),
        }));
      },
      isConflict: (error) => (
        error instanceof BlobPreconditionFailedError
        || error?.name === 'BlobPreconditionFailedError'
      ),
    });
  } catch {
    return { ok: false, skipped: false, error: 'blob_write_failed' };
  }
}

async function redisClient() {
  const config = redisConfiguration().complete;
  if (!config) return null;
  const { Redis } = await import('@upstash/redis');
  return new Redis(config);
}

async function readRedisSnapshot() {
  try {
    const redis = await redisClient();
    if (!redis) return { data: null, error: null };
    const data = await redis.get(SNAPSHOT_KEY);
    return { data: data && typeof data === 'object' ? data : null, error: null };
  } catch {
    return { data: null, error: 'redis_read_failed' };
  }
}

async function writeRedisSnapshot(payload) {
  try {
    const redis = await redisClient();
    return redis
      ? await writeNewestSmartMoneyRedis(payload, redis)
      : { ok: false, skipped: false, error: 'redis_write_failed' };
  } catch {
    return { ok: false, skipped: false, error: 'redis_write_failed' };
  }
}

async function readProbe(reader, source, configured) {
  if (!configured) return { data: null, error: null };
  try {
    const result = await reader();
    if (result?.data != null && generationMs(result.data) === null) {
      return { data: null, error: `${source}_invalid_snapshot` };
    }
    return { data: result?.data ?? null, error: result?.error ? `${source}_read_failed` : null };
  } catch {
    return { data: null, error: `${source}_read_failed` };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function readDurableSmartMoneyCandidate(options = {}) {
  const configuration = storageConfiguration(options);
  if (configuration.invalid) return { status: 'unavailable' };
  const configured = [];
  if (configuration.blobConfigured) {
    configured.push(await readProbe(options.readBlob || readBlobSnapshot, 'blob', true));
  }
  if (configuration.redisConfigured) {
    configured.push(await readProbe(options.readRedis || readRedisSnapshot, 'redis', true));
  }
  if (configured.length === 0 || configured.some((probe) => probe.error)) {
    return { status: 'unavailable' };
  }
  if (configured.every((probe) => probe.data === null)) return { status: 'absent' };
  if (configured.some((probe) => probe.data === null)) return { status: 'conflict' };
  const canonical = stableJson(configured[0].data);
  if (configured.some((probe) => stableJson(probe.data) !== canonical)) return { status: 'conflict' };
  return { status: 'ready', snapshot: structuredClone(configured[0].data) };
}

export async function readSmartMoneySnapshot(options = {}) {
  const configuration = storageConfiguration(options);
  const memory = Object.hasOwn(options, 'memory') ? options.memory : memorySnapshot;
  if (configuration.invalid) {
    const diagnostics = {
      configurationError: 'storage_configuration_invalid',
      blob: configuration.blobConfigured,
      redis: configuration.redisConfigured,
      blobError: null,
      redisError: null,
      selectedSource: null,
    };
    return options.withDiagnostics ? { snapshot: null, diagnostics } : null;
  }
  const [blob, redis] = await Promise.all([
    readProbe(options.readBlob || readBlobSnapshot, 'blob', configuration.blobConfigured),
    readProbe(options.readRedis || readRedisSnapshot, 'redis', configuration.redisConfigured),
  ]);
  const selected = selectNewestSmartMoneySnapshot([
    { source: 'memory', data: memory },
    { source: 'blob', data: blob.data },
    { source: 'redis', data: redis.data },
  ]);
  if (selected.data && selected.source !== 'memory') {
    memorySnapshot = structuredClone(selected.data);
    memoryStoredAt = options.nowMs ?? Date.now();
  }
  const diagnostics = {
    configurationError: null,
    blob: configuration.blobConfigured,
    redis: configuration.redisConfigured,
    blobError: blob.error,
    redisError: redis.error,
    selectedSource: selected.source,
    refreshStartedAt: selected.refreshStartedAt,
    memoryStoredAt: selected.source === 'memory' ? memoryStoredAt : null,
  };
  return options.withDiagnostics
    ? { snapshot: selected.data, diagnostics }
    : selected.data;
}

async function writeProbe(writer, source, configured, payload) {
  if (!configured) return { configured: false, ok: false, accepted: false, error: null };
  try {
    const result = await writer(payload);
    if (result?.ok === true && result.skipped === false) {
      return { configured: true, ok: true, accepted: true, error: null };
    }
    if (result?.ok === true && result.skipped === true) {
      return {
        configured: true,
        ok: true,
        accepted: false,
        skipped: true,
        error: null,
      };
    }
    return { configured: true, ok: false, accepted: false, error: `${source}_write_failed` };
  } catch {
    return { configured: true, ok: false, accepted: false, error: `${source}_write_failed` };
  }
}

export async function writeSmartMoneySnapshot(snapshot, options = {}) {
  const configuration = storageConfiguration(options);
  const invalidSnapshot = generationMs(snapshot) === null;
  if (configuration.invalid || invalidSnapshot) {
    return {
      snapshot: null,
      blobWrite: { configured: configuration.blobConfigured, ok: false, accepted: false, error: configuration.blobConfigured ? 'blob_write_failed' : null },
      redisWrite: { configured: configuration.redisConfigured, ok: false, accepted: false, error: configuration.redisConfigured ? 'redis_write_failed' : null },
      durableWriteSucceeded: false,
      configuredWrites: Number(configuration.blobConfigured) + Number(configuration.redisConfigured),
      successfulWrites: 0,
      configurationError: configuration.invalid ? 'storage_configuration_invalid' : 'snapshot_invalid',
    };
  }
  const [blobWrite, redisWrite] = await Promise.all([
    writeProbe(options.writeBlob || writeBlobSnapshot, 'blob', configuration.blobConfigured, snapshot),
    writeProbe(options.writeRedis || writeRedisSnapshot, 'redis', configuration.redisConfigured, snapshot),
  ]);
  const writes = [blobWrite, redisWrite];
  const configuredWrites = writes.filter((write) => write.configured).length;
  const successfulWrites = writes.filter((write) => write.accepted).length;
  const supersededWrites = writes.filter((write) => write.configured && write.skipped).length;
  const durableWriteSucceeded = configuredWrites > 0 && successfulWrites === configuredWrites;
  if (durableWriteSucceeded) {
    const incomingVersion = generationMs(snapshot);
    const memoryVersion = generationMs(memorySnapshot);
    if (memoryVersion === null || incomingVersion > memoryVersion) {
      memorySnapshot = structuredClone(snapshot);
      memoryStoredAt = options.nowMs ?? Date.now();
    }
  }
  return {
    snapshot: durableWriteSucceeded ? snapshot : null,
    blobWrite,
    redisWrite,
    durableWriteSucceeded,
    configuredWrites,
    successfulWrites,
    supersededWrites,
    configurationError: configuredWrites === 0 ? 'storage_configuration_invalid' : null,
  };
}

export const SMART_MONEY_STORAGE_NAMESPACES = Object.freeze({
  snapshotKey: SNAPSHOT_KEY,
  snapshotVersionKey: SNAPSHOT_VERSION_KEY,
  snapshotBlob: SNAPSHOT_BLOB,
});
