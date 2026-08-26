import { randomUUID } from 'node:crypto';

const REFRESH_LOCK_KEY = 'smart-money:v1:refresh-lock';
const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 300_000;
const MIN_TTL_MS = 10;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

function lockError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function boundedTtl(value) {
  const numeric = Number(value ?? DEFAULT_TTL_MS);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TTL_MS;
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.floor(numeric)));
}

function productionLike() {
  const vercel = String(process.env.VERCEL || '').trim().toLowerCase();
  return process.env.NODE_ENV === 'production'
    || (Boolean(vercel) && vercel !== '0' && vercel !== 'false');
}

function redisCredentials() {
  const candidates = [
    { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN },
    { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN },
  ];
  const complete = candidates.find(({ url, token }) => Boolean(url && token));
  const incomplete = candidates.some(({ url, token }) => Boolean(url || token) && !Boolean(url && token));
  if (incomplete || (!complete && productionLike())) throw lockError('refresh_lock_configuration_invalid');
  return complete ?? null;
}

function redisAdapter(redis) {
  return {
    async acquire(key, token, ttlMs) {
      const result = await redis.set(key, token, { nx: true, px: ttlMs });
      return result === 'OK' || result === true;
    },
    async renew(key, token, ttlMs) {
      return Number(await redis.eval(RENEW_SCRIPT, [key], [token, String(ttlMs)])) === 1;
    },
    async release(key, token) {
      return Number(await redis.eval(RELEASE_SCRIPT, [key], [token])) === 1;
    },
  };
}

export function createMemoryRefreshLockAdapter(options = {}) {
  const locks = new Map();
  const now = options.now || (() => Date.now());
  function current(key) {
    const row = locks.get(key);
    if (row && row.expiresAt <= now()) {
      locks.delete(key);
      return null;
    }
    return row ?? null;
  }
  return {
    async acquire(key, token, ttlMs) {
      if (current(key)) return false;
      locks.set(key, { token, expiresAt: now() + ttlMs });
      return true;
    },
    async renew(key, token, ttlMs) {
      const row = current(key);
      if (!row || row.token !== token) return false;
      locks.set(key, { token, expiresAt: now() + ttlMs });
      return true;
    },
    async release(key, token) {
      const row = current(key);
      if (!row || row.token !== token) return false;
      locks.delete(key);
      return true;
    },
  };
}

const localDevelopmentAdapter = createMemoryRefreshLockAdapter();

async function configuredAdapter(options) {
  if (options.adapter) return options.adapter;
  const credentials = redisCredentials();
  if (!credentials) return localDevelopmentAdapter;
  try {
    const { Redis } = await import('@upstash/redis');
    return redisAdapter(new Redis(credentials));
  } catch {
    throw lockError('refresh_lock_configuration_invalid');
  }
}

export async function withRefreshLock(action, options = {}) {
  if (typeof action !== 'function') throw lockError('refresh_lock_invalid_action');
  const adapter = await configuredAdapter(options);
  if (!adapter || typeof adapter.acquire !== 'function'
      || typeof adapter.renew !== 'function' || typeof adapter.release !== 'function') {
    throw lockError('refresh_lock_configuration_invalid');
  }
  const ttlMs = boundedTtl(options.ttlMs);
  const requestedRenew = Number(options.renewEveryMs ?? Math.floor(ttlMs / 3));
  const renewEveryMs = Math.max(1, Math.min(
    Math.max(1, ttlMs - 1),
    Number.isFinite(requestedRenew) && requestedRenew > 0
      ? Math.floor(requestedRenew)
      : Math.max(1, Math.floor(ttlMs / 3)),
  ));
  const token = randomUUID();
  let acquired;
  try {
    acquired = await adapter.acquire(REFRESH_LOCK_KEY, token, ttlMs);
  } catch {
    throw lockError('refresh_lock_unavailable');
  }
  if (!acquired) throw lockError('refresh_lock_unavailable');

  let stopped = false;
  let lost = false;
  let timer = null;
  const scheduleRenewal = () => {
    timer = setTimeout(async () => {
      if (stopped) return;
      try {
        if (!await adapter.renew(REFRESH_LOCK_KEY, token, ttlMs)) lost = true;
      } catch {
        lost = true;
      }
      if (!stopped && !lost) scheduleRenewal();
    }, renewEveryMs);
    timer.unref?.();
  };
  scheduleRenewal();
  let result;
  let actionError = null;
  try {
    result = await action();
  } catch (error) {
    actionError = error;
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      if (!await adapter.release(REFRESH_LOCK_KEY, token)) lost = true;
    } catch {
      if (!actionError) actionError = lockError('refresh_lock_release_failed');
    }
  }
  if (actionError) throw actionError;
  if (lost) throw lockError('refresh_lock_lost');
  return result;
}
