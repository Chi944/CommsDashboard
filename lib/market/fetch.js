const DEFAULT_TIMEOUT_MS = 8_000;

function configuredTimeout() {
  const value = Number(process.env.MARKET_FETCH_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function timeoutError() {
  const error = new Error('upstream timeout');
  error.code = 'UPSTREAM_TIMEOUT';
  return error;
}

async function fetchBufferedResponse(url, options, fetchImpl, signal) {
  const response = await fetchImpl(url, { ...options, signal });
  // Production fetch returns a standards-based Response. Keep lightweight
  // injected adapters compatible while real response bodies are buffered.
  if (typeof response?.arrayBuffer !== 'function') return response;
  const bytes = await response.arrayBuffer();
  const statusForbidsBody = [101, 204, 205, 304].includes(response.status);
  return new Response(statusForbidsBody ? null : bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function fetchWithTimeout(url, options = {}, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, configuredTimeout());
  });

  try {
    return await Promise.race([
      fetchBufferedResponse(url, options, fetchImpl, controller.signal),
      deadline,
    ]);
  } catch (error) {
    if (error?.code === 'UPSTREAM_TIMEOUT') throw error;
    if (error?.name === 'AbortError') {
      throw timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function upstreamError(error) {
  return error?.code === 'UPSTREAM_TIMEOUT'
    ? 'timeout'
    : String(error?.message || error || 'unknown');
}
