const CACHE_KEY = 'market:provider-cache';
const BLOB_PATHNAME = 'market/provider-cache.json';

/** @type {{ alphavantage?: { rows: object[], fetchedAt: string }, eia?: { rows: object[], fetchedAt: string } } | null} */
let memoryCache = null;

async function readFromBlob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const { head } = await import('@vercel/blob');
    const meta = await head(BLOB_PATHNAME, { token });
    if (!meta?.url) return null;
    const res = await fetch(meta.url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data === 'object') return data;
  } catch {
    /* optional storage */
  }
  return null;
}

async function writeToBlob(payload) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    const { put } = await import('@vercel/blob');
    await put(BLOB_PATHNAME, JSON.stringify(payload), {
      access: 'public',
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch {
    /* optional storage */
  }
}

async function readFromKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    const { kv } = await import('@vercel/kv');
    const v = await kv.get(CACHE_KEY);
    if (v && typeof v === 'object') return v;
  } catch {
    /* fall through */
  }
  return null;
}

async function writeToKv(payload) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
  try {
    const { kv } = await import('@vercel/kv');
    await kv.set(CACHE_KEY, payload, { ex: 90_000 });
  } catch {
    /* optional */
  }
}

export async function readProviderCache() {
  if (memoryCache) return memoryCache;

  memoryCache = (await readFromBlob()) || (await readFromKv());
  return memoryCache;
}

export async function writeProviderCache(payload) {
  memoryCache = payload;
  await Promise.all([writeToBlob(payload), writeToKv(payload)]);
  return payload;
}
