const CACHE_KEY = 'market:provider-cache';
const BLOB_PATHNAME = 'market/provider-cache.json';

/** @type {{ alphavantage?: { rows: object[], fetchedAt: string }, eia?: { rows: object[], fetchedAt: string }, refreshedAt?: string } | null} */
let memoryCache = null;

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN || null;
}

async function readFromBlob() {
  const token = blobToken();
  if (!token) return { data: null, error: 'no_blob_token' };

  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: 'market/', token, limit: 20 });
    const hit = blobs?.find(
      (b) => b.pathname === BLOB_PATHNAME || b.pathname?.endsWith('provider-cache.json'),
    );
    if (!hit?.url) return { data: null, error: 'blob_not_found' };

    const res = await fetch(hit.url, { cache: 'no-store' });
    if (!res.ok) return { data: null, error: `blob_fetch_${res.status}` };

    const data = await res.json();
    if (!data || typeof data !== 'object') return { data: null, error: 'blob_invalid_json' };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: String(e?.message || e) };
  }
}

async function writeToBlob(payload) {
  const token = blobToken();
  if (!token) return { ok: false, error: 'no_blob_token' };

  try {
    const { put } = await import('@vercel/blob');
    const result = await put(BLOB_PATHNAME, JSON.stringify(payload), {
      access: 'public',
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    return { ok: true, url: result?.url };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
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

/** @returns {Promise<{ blob: boolean, blobHit: boolean, blobError: string | null, kv: boolean, avRows: number }>} */
export async function getStorageDiagnostics(cache = null) {
  const blob = Boolean(blobToken());
  const kv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const avRows = cache?.alphavantage?.rows?.length ?? 0;
  let blobHit = false;
  let blobError = null;

  if (blob) {
    const probe = await readFromBlob();
    blobHit = Boolean(probe.data?.alphavantage?.rows?.length);
    blobError = probe.error;
  }

  return { blob, blobHit, blobError, kv, avRows };
}

export async function readProviderCache() {
  if (memoryCache) return memoryCache;

  const blobProbe = await readFromBlob();
  if (blobProbe.data) {
    memoryCache = blobProbe.data;
    return memoryCache;
  }

  memoryCache = (await readFromKv()) || null;
  return memoryCache;
}

export async function writeProviderCache(payload) {
  memoryCache = payload;
  const [blobResult] = await Promise.all([
    writeToBlob(payload),
    writeToKv(payload),
  ]);
  return { payload, blobWrite: blobResult };
}
