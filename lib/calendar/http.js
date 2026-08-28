const DEFAULT_TIMEOUT_MS = 6_500;
const MAX_RESPONSE_BYTES = 2_000_000;

function upstreamError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalHttpDate(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function validateDeclaredLength(response) {
  const header = response.headers?.get?.('content-length');
  if (header == null || header === '') return;
  const length = Number(header);
  if (!Number.isFinite(length) || length <= 0 || length > MAX_RESPONSE_BYTES) {
    throw upstreamError('upstream_invalid');
  }
}

async function readBoundedBytes(response) {
  if (typeof response.body?.getReader !== 'function') {
    if (typeof response.arrayBuffer !== 'function') throw upstreamError('upstream_invalid');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) throw upstreamError('upstream_invalid');
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw upstreamError('upstream_invalid');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw upstreamError('upstream_invalid');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchOfficialText(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(upstreamError('upstream_timeout'));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/calendar, text/html;q=0.9, text/plain;q=0.8',
          'User-Agent': 'CommsDashboard/1.0 (official economic calendar)',
        },
      });
      if (!response?.ok) throw upstreamError('upstream_unavailable');
      validateDeclaredLength(response);
      const text = new TextDecoder().decode(await readBoundedBytes(response));
      if (!text) throw upstreamError('upstream_invalid');
      return { text, sourceLastModifiedAt: canonicalHttpDate(response.headers?.get?.('last-modified')) };
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') throw upstreamError('upstream_timeout');
    throw upstreamError('upstream_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOfficialBytes(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(upstreamError('upstream_timeout'));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'application/pdf',
          'User-Agent': 'CommsDashboard/1.0 (official economic calendar)',
        },
      });
      if (!response?.ok) throw upstreamError('upstream_unavailable');
      const contentType = String(response.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/pdf') throw upstreamError('upstream_invalid');
      validateDeclaredLength(response);
      const bytes = await readBoundedBytes(response);
      if (bytes.byteLength < 5 || bytes.byteLength > MAX_RESPONSE_BYTES
          || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) {
        throw upstreamError('upstream_invalid');
      }
      return { bytes, sourceLastModifiedAt: canonicalHttpDate(response.headers?.get?.('last-modified')) };
    })();
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') throw upstreamError('upstream_timeout');
    throw upstreamError('upstream_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
