const CACHE_KEY = 'market:provider-cache';

/** @type {{ alphavantage?: { rows: object[], fetchedAt: string }, eia?: { rows: object[], fetchedAt: string } } | null} */
let memoryCache = null;

export async function readProviderCache() {
  if (memoryCache) return memoryCache;

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      const v = await kv.get(CACHE_KEY);
      if (v && typeof v === 'object') {
        memoryCache = v;
        return v;
      }
    } catch {
      /* fall through */
    }
  }

  return memoryCache;
}

export async function writeProviderCache(payload) {
  memoryCache = payload;

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      await kv.set(CACHE_KEY, payload, { ex: 90_000 });
    } catch {
      /* memory-only */
    }
  }

  return payload;
}
