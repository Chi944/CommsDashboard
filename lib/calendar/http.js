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
    const response = await Promise.race([
      fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/calendar, text/html;q=0.9, text/plain;q=0.8',
          'User-Agent': 'CommsDashboard/1.0 (official economic calendar)',
        },
      }),
      deadline,
    ]);
    if (!response?.ok) throw upstreamError('upstream_unavailable');
    const text = await response.text();
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw upstreamError('upstream_invalid');
    return { text, sourceLastModifiedAt: canonicalHttpDate(response.headers?.get?.('last-modified')) };
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') throw upstreamError('upstream_timeout');
    throw upstreamError('upstream_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
