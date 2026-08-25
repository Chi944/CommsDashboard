import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { Redis } from '@upstash/redis';

const DEFAULT_QUOTA = 10;
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_LOCAL_LIMITS = Object.freeze({
  results: 256,
  inflight: 128,
  clients: 1_024,
});

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('PTTL', KEYS[1]) }
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

let configuredRedisSignature = null;
let configuredRedisClient = null;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  return Math.max(1, Math.floor(positiveNumber(value, fallback)));
}

function generationPolicy() {
  return {
    limit: positiveInteger(process.env.AI_GENERATION_QUOTA, DEFAULT_QUOTA),
    windowMs: positiveNumber(process.env.AI_GENERATION_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS) * 1000,
  };
}

function lockPolicy(overrides) {
  const providerTimeout = positiveNumber(process.env.GROQ_TIMEOUT_MS, 15_000);
  const ttlMs = positiveNumber(
    overrides.lockTtlMs ?? process.env.AI_GENERATION_LOCK_TTL_MS,
    Math.max(20_000, providerTimeout + 5_000),
  );
  return {
    ttlMs,
    waitMs: positiveNumber(
      overrides.lockWaitMs ?? process.env.AI_GENERATION_LOCK_WAIT_MS,
      ttlMs + 2_000,
    ),
    pollMs: positiveNumber(
      overrides.lockPollMs ?? process.env.AI_GENERATION_LOCK_POLL_MS,
      75,
    ),
  };
}

function redisCredentials() {
  const candidates = [
    {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    },
    {
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    },
  ];
  const complete = candidates.find(({ url, token }) => Boolean(url && token));
  if (complete) return complete;
  const vercel = String(process.env.VERCEL || '').trim().toLowerCase();
  const isProduction = process.env.NODE_ENV === 'production'
    || (Boolean(vercel) && vercel !== '0' && vercel !== 'false');
  if (isProduction || candidates.some(({ url, token }) => Boolean(url || token))) {
    throw new AiGuardError('distributed_guard_unavailable', 'configuration');
  }
  return null;
}

function getConfiguredRedis() {
  const credentials = redisCredentials();
  if (!credentials) {
    configuredRedisSignature = null;
    configuredRedisClient = null;
    return null;
  }

  const signature = createHash('sha256')
    .update(`${credentials.url}\0${credentials.token}`)
    .digest('hex');
  if (signature !== configuredRedisSignature) {
    configuredRedisClient = new Redis({
      url: credentials.url,
      token: credentials.token,
    });
    configuredRedisSignature = signature;
  }
  return configuredRedisClient;
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function distributedKeys(cacheKey, clientId) {
  const semanticDigest = digest(cacheKey);
  return {
    cache: `ai:v1:result:${semanticDigest}`,
    lock: `ai:v1:lock:${semanticDigest}`,
    quota: `ai:v1:quota:${digest(clientId)}`,
  };
}

function setBounded(map, key, value, limit) {
  if (map.has(key)) map.delete(key);
  while (map.size >= limit) {
    map.delete(map.keys().next().value);
  }
  map.set(key, value);
}

function localLimits(configured = {}) {
  return {
    results: positiveInteger(configured.results, DEFAULT_LOCAL_LIMITS.results),
    inflight: positiveInteger(configured.inflight, DEFAULT_LOCAL_LIMITS.inflight),
    clients: positiveInteger(configured.clients, DEFAULT_LOCAL_LIMITS.clients),
  };
}

function cacheEnvelope(stored) {
  let candidate = stored;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return { found: false, value: null };
    }
  }
  if (!candidate || typeof candidate !== 'object' || candidate.schema !== 1
    || !Object.prototype.hasOwnProperty.call(candidate, 'value')) {
    return { found: false, value: null };
  }
  return { found: true, value: candidate.value };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function guardOperation(operation, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AiQuotaError) throw error;
    const guardError = error instanceof AiGuardError
      ? error
      : new AiGuardError('distributed_guard_unavailable', operation);
    logAiEvent('error', 'distributed_guard_failed', {
      code: guardError.code,
      operation,
    });
    throw guardError;
  }
}

async function readDistributedCache(redis, key) {
  const stored = await guardOperation('cache_read', () => redis.get(key));
  return cacheEnvelope(stored);
}

async function writeDistributedCache(redis, key, value, ttlMs) {
  await guardOperation('cache_write', () => redis.set(
    key,
    { schema: 1, value },
    { px: Math.max(1, Math.ceil(ttlMs)) },
  ));
}

async function consumeDistributedQuota(redis, key) {
  const { limit, windowMs } = generationPolicy();
  const result = await guardOperation('rate_limit', () => redis.eval(
    RATE_LIMIT_SCRIPT,
    [key],
    [String(Math.ceil(windowMs))],
  ));
  const count = Number(result?.[0]);
  const ttlMs = Number(result?.[1]);
  if (!Number.isFinite(count)) {
    await guardOperation('rate_limit', () => {
      throw new AiGuardError('distributed_guard_unavailable', 'rate_limit');
    });
  }
  if (count > limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : windowMs) / 1000),
    );
    throw new AiQuotaError(retryAfterSeconds);
  }
}

async function acquireDistributedLock(redis, key, token, ttlMs) {
  const result = await guardOperation('lock_acquire', () => redis.set(
    key,
    token,
    { nx: true, px: Math.ceil(ttlMs) },
  ));
  return result === 'OK' || result === true;
}

async function releaseDistributedLock(redis, key, token) {
  const released = await guardOperation('lock_release', () => redis.eval(
    RELEASE_LOCK_SCRIPT,
    [key],
    [token],
  ));
  if (Number(released) !== 1) {
    await guardOperation('lock_release', () => {
      throw new AiGuardError('distributed_guard_unavailable', 'lock_release');
    });
  }
}

function readSmokeSecret(req) {
  const headers = req?.headers || {};
  const candidate = headers['x-ai-smoke-secret'];
  return Array.isArray(candidate) ? candidate[0] : candidate;
}

export function isAiSmokeBypassAuthorized(req) {
  const configured = process.env.AI_SMOKE_SECRET;
  const candidate = readSmokeSecret(req);
  if (!configured || candidate == null) return false;
  const configuredDigest = createHash('sha256').update(String(configured)).digest();
  const candidateDigest = createHash('sha256').update(String(candidate)).digest();
  return timingSafeEqual(configuredDigest, candidateDigest);
}

export function getAiTtlMs(envName, fallbackSeconds) {
  return positiveNumber(process.env[envName], fallbackSeconds) * 1000;
}

export function getClientId(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  const candidate = req?.headers?.['x-vercel-forwarded-for']
    || firstForwarded
    || req?.headers?.['x-real-ip']
    || req?.socket?.remoteAddress
    || 'unknown';
  return String(candidate).trim().slice(0, 128) || 'unknown';
}

export class AiQuotaError extends Error {
  constructor(retryAfterSeconds) {
    super('AI generation quota exceeded');
    this.name = 'AiQuotaError';
    this.code = 'ai_generation_quota_exceeded';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AiGuardError extends Error {
  constructor(code = 'distributed_guard_unavailable', operation = null) {
    super(code);
    this.name = 'AiGuardError';
    this.code = code;
    this.operation = operation;
  }
}

export function createAiRuntime(options = {}) {
  const resultCache = new Map();
  const inFlightGenerations = new Map();
  const clientGenerations = new Map();
  const limits = localLimits(options.localLimits);
  const hasRedisOverride = Object.prototype.hasOwnProperty.call(options, 'redis');
  const resolveRedis = hasRedisOverride ? () => options.redis : getConfiguredRedis;
  const wait = options.sleep || sleep;

  function getLocalCache(cacheKey, now) {
    const cached = resultCache.get(cacheKey);
    if (!cached) return { found: false, value: null };
    if (cached.expiresAt <= now) {
      resultCache.delete(cacheKey);
      return { found: false, value: null };
    }
    setBounded(resultCache, cacheKey, cached, limits.results);
    return { found: true, value: cached.value };
  }

  function setLocalCache(cacheKey, value, ttlMs) {
    setBounded(resultCache, cacheKey, {
      value,
      expiresAt: Date.now() + ttlMs,
    }, limits.results);
  }

  function consumeLocalQuota(clientId, now) {
    const { limit, windowMs } = generationPolicy();
    const cutoff = now - windowMs;
    const recent = (clientGenerations.get(clientId)?.timestamps || [])
      .filter((timestamp) => timestamp > cutoff);

    if (recent.length >= limit) {
      setBounded(clientGenerations, clientId, {
        timestamps: recent,
        lastSeen: now,
      }, limits.clients);
      const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      throw new AiQuotaError(retryAfterSeconds);
    }

    recent.push(now);
    setBounded(clientGenerations, clientId, {
      timestamps: recent,
      lastSeen: now,
    }, limits.clients);
  }

  async function performLocal({ cacheKey, clientId, ttlMs, generate }) {
    consumeLocalQuota(clientId, Date.now());
    const value = await generate();
    setLocalCache(cacheKey, value, ttlMs);
    return { value, source: 'generated' };
  }

  async function performDistributed({ redis, cacheKey, clientId, ttlMs, generate, bypassCache }) {
    const keys = distributedKeys(cacheKey, clientId);
    const policy = lockPolicy(options);
    const deadline = Date.now() + policy.waitMs;
    let contended = false;

    while (true) {
      if (!bypassCache) {
        const cached = await readDistributedCache(redis, keys.cache);
        if (cached.found) {
          return { value: cached.value, source: contended ? 'inflight' : 'cache' };
        }
      }

      const token = randomUUID();
      const acquired = await acquireDistributedLock(redis, keys.lock, token, policy.ttlMs);
      if (acquired) {
        try {
          if (!bypassCache) {
            const cached = await readDistributedCache(redis, keys.cache);
            if (cached.found) {
              return { value: cached.value, source: contended ? 'inflight' : 'cache' };
            }
          }
          await consumeDistributedQuota(redis, keys.quota);
          const value = await generate();
          await writeDistributedCache(redis, keys.cache, value, ttlMs);
          setLocalCache(cacheKey, value, ttlMs);
          return { value, source: 'generated' };
        } finally {
          await releaseDistributedLock(redis, keys.lock, token);
        }
      }

      contended = true;
      if (Date.now() >= deadline) {
        const error = new AiGuardError('distributed_lock_timeout', 'lock_wait');
        logAiEvent('error', 'distributed_guard_failed', {
          code: error.code,
          operation: error.operation,
        });
        throw error;
      }
      await wait(Math.min(policy.pollMs, Math.max(1, deadline - Date.now())));
    }
  }

  async function runAiGeneration({
    cacheKey,
    clientId,
    ttlMs,
    generate,
    bypassCache = false,
  }) {
    let redis;
    try {
      redis = resolveRedis();
    } catch (error) {
      const guardError = error instanceof AiGuardError
        ? error
        : new AiGuardError('distributed_guard_unavailable', 'configuration');
      logAiEvent('error', 'distributed_guard_failed', {
        code: guardError.code,
        operation: guardError.operation || 'configuration',
      });
      throw guardError;
    }

    if (!bypassCache) {
      const cached = getLocalCache(cacheKey, Date.now());
      if (cached.found) return { value: cached.value, source: 'cache' };
    }

    const existing = inFlightGenerations.get(cacheKey);
    if (existing) {
      if (!bypassCache) {
        const result = await existing;
        return { value: result.value, source: 'inflight' };
      }
      try {
        await existing;
      } catch {
        // An authenticated bypass still gets its own serialized generation.
      }
      return runAiGeneration({ cacheKey, clientId, ttlMs, generate, bypassCache });
    }

    const task = redis
      ? performDistributed({ redis, cacheKey, clientId, ttlMs, generate, bypassCache })
      : performLocal({ cacheKey, clientId, ttlMs, generate });
    setBounded(inFlightGenerations, cacheKey, task, limits.inflight);

    try {
      return await task;
    } finally {
      if (inFlightGenerations.get(cacheKey) === task) {
        inFlightGenerations.delete(cacheKey);
      }
    }
  }

  return { runAiGeneration };
}

const defaultRuntime = createAiRuntime();

export function runAiGeneration(options) {
  return defaultRuntime.runAiGeneration(options);
}

export function readyAiStatus(source) {
  return {
    state: 'ready',
    code: null,
    message: null,
    retryable: false,
    source,
  };
}

export function disabledAiStatus() {
  return {
    state: 'disabled',
    code: 'not_configured',
    message: 'AI commentary is disabled.',
    retryable: false,
  };
}

const DEGRADED_MESSAGES = {
  provider_configuration_error: 'AI service configuration needs attention. Live market data is still available.',
  provider_rate_limited: 'AI commentary is temporarily busy. Live market data is still available.',
  provider_invalid_response: 'AI commentary is temporarily unavailable. Live market data is still available.',
  provider_unavailable: 'AI commentary is temporarily unavailable. Live market data is still available.',
  upstream_market_data_unavailable: 'AI commentary is temporarily unavailable because trusted market inputs could not be verified.',
  distributed_guard_unavailable: 'AI safety controls are temporarily unavailable. Live market data is still available.',
  distributed_lock_timeout: 'AI generation is temporarily busy. Live market data is still available.',
};

export function degradedAiStatus(error) {
  const code = DEGRADED_MESSAGES[error?.code] ? error.code : 'provider_unavailable';
  return {
    state: 'degraded',
    code,
    message: DEGRADED_MESSAGES[code],
    retryable: !['provider_configuration_error'].includes(code),
  };
}

export function quotaAiStatus() {
  return {
    state: 'rate_limited',
    code: 'ai_generation_quota_exceeded',
    message: 'AI generation limit reached for this client. Try again shortly.',
    retryable: true,
  };
}

export function logAiEvent(level, event, fields = {}) {
  const entry = {
    event,
    ...fields,
    timestamp: new Date().toISOString(),
  };
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger(`[ai] ${JSON.stringify(entry)}`);
}
