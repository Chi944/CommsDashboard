import { listConfiguredAdapters } from './entities.js';
import { ProviderError, sanitizeProviderError } from './errors.js';
import { assertAdapterRights } from './rights.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_RETRIES = 1;
const HARD_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_TEXT_CONTENT_TYPES = Object.freeze([
  'text/plain',
  'text/xml',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
]);

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function hasAcceptedContentType(response, acceptedContentTypes) {
  const contentType = normalizeContentType(response?.headers?.get?.('content-type'));
  return Boolean(contentType && acceptedContentTypes.includes(contentType));
}

function parseRetryAfter(value, nowMs) {
  if (!value) return null;
  const seconds = Number(value);
  const rawMs = Number.isFinite(seconds)
    ? Math.max(0, Math.round(seconds * 1_000))
    : Math.max(0, Date.parse(value) - nowMs);
  return Number.isFinite(rawMs) ? Math.min(rawMs, DEFAULT_MAX_RETRY_AFTER_MS) : null;
}

async function cancelBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Cancellation is best-effort; provider errors remain stable and sanitized.
  }
}

async function readLimitedText(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelBody(response);
    throw new ProviderError('response_too_large');
  }

  const reader = response?.body?.getReader?.();
  if (!reader) return '';
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ProviderError('response_too_large');
      }
      chunks.push(decoder.decode(chunk, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock?.();
  }
}

function resolveAndAssertRights(providerId) {
  const adapterConfig = listConfiguredAdapters().find((adapter) => adapter.id === providerId);
  if (!providerId || !adapterConfig) throw new ProviderError('rights_gate_failed', providerId || null);

  try {
    assertAdapterRights([adapterConfig]);
  } catch {
    throw new ProviderError('rights_gate_failed', providerId);
  }
  return providerId;
}

function parseAllowedUrl(url, allowedOrigins, providerId) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new ProviderError('configuration_missing', providerId);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError('origin_not_allowed', providerId);
  }
  const origins = new Set(allowedOrigins.map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }).filter(Boolean));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !origins.has(parsed.origin)) {
    throw new ProviderError('origin_not_allowed', providerId);
  }
  return parsed.toString();
}

function isRetryableStatus(status) {
  return status === 429 || status === 408 || status === 425 || status === 502 || status === 503 || status === 504;
}

function requestOptions(options, signal) {
  return {
    ...(options?.requestOptions || {}),
    redirect: 'manual',
    signal,
  };
}

function waitForRetry(ms, signal, providerId) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('provider_unavailable', providerId));
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new ProviderError('provider_unavailable', providerId));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchAndRead(url, options, providerId, signal, allowedOrigins) {
  const response = await (options.fetchImpl || globalThis.fetch)(url, requestOptions(options, signal));
  if (response?.status >= 300 && response?.status < 400) {
    await cancelBody(response);
    throw new ProviderError('origin_not_allowed', providerId);
  }
  if (response?.url) parseAllowedUrl(response.url, allowedOrigins, providerId);
  if (!response?.ok) {
    const retryAfterMs = response?.status === 429
      ? parseRetryAfter(
        response.headers?.get?.('retry-after'),
        Date.now(),
      )
      : null;
    await cancelBody(response);
    const error = new ProviderError(
      response?.status === 429 ? 'rate_limited' : 'provider_unavailable',
      providerId,
      retryAfterMs,
    );
    error.retryable = isRetryableStatus(response?.status);
    throw error;
  }
  if (!hasAcceptedContentType(response, options.acceptedContentTypes)) {
    await cancelBody(response);
    throw new ProviderError('invalid_content_type', providerId);
  }
  return readLimitedText(response, options.maxBytes);
}

async function oneAttempt(url, options, providerId, allowedOrigins) {
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  let timer;
  let rejectCallerAbort;
  const callerAbort = new Promise((_, reject) => {
    rejectCallerAbort = reject;
  });
  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort();
    rejectCallerAbort(new ProviderError('provider_unavailable', providerId));
  };
  if (options.signal?.aborted) onCallerAbort();
  else options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ProviderError('timeout', providerId));
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([
      fetchAndRead(url, options, providerId, controller.signal, allowedOrigins),
      timeout,
      callerAbort,
    ]);
  } catch (error) {
    if (callerAborted) throw new ProviderError('provider_unavailable', providerId);
    if (timedOut || error?.name === 'AbortError') throw new ProviderError('timeout', providerId);
    if (error instanceof ProviderError) {
      if (!error.providerId) error.providerId = providerId;
      throw error;
    }
    const unavailable = new ProviderError('provider_unavailable', providerId);
    unavailable.retryable = true;
    throw unavailable;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
    controller.abort();
  }
}

export async function fetchProviderText(url, options = {}) {
  const providerId = typeof options.providerId === 'string' ? options.providerId : '';
  resolveAndAssertRights(providerId);
  const safeUrl = parseAllowedUrl(url, options.allowedOrigins, providerId);
  const normalized = {
    ...options,
    acceptedContentTypes: (options.acceptedContentTypes || DEFAULT_TEXT_CONTENT_TYPES)
      .map(normalizeContentType)
      .filter(Boolean),
    maxBytes: positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES),
    maxRetries: Math.min(positiveInteger(options.maxRetries, DEFAULT_MAX_RETRIES), HARD_MAX_RETRIES),
    retryDelayMs: Math.min(
      positiveInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS),
      DEFAULT_MAX_RETRY_AFTER_MS,
    ),
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
  };
  if (normalized.acceptedContentTypes.length === 0 || normalized.maxBytes === 0 || normalized.timeoutMs === 0) {
    throw new ProviderError('configuration_missing', providerId);
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await oneAttempt(safeUrl, normalized, providerId, normalized.allowedOrigins);
    } catch (error) {
      if (!error?.retryable || attempt >= normalized.maxRetries) throw error;
      const delay = error.retryAfterMs ?? Math.min(
        normalized.retryDelayMs * (2 ** attempt),
        DEFAULT_MAX_RETRY_AFTER_MS,
      );
      await waitForRetry(delay, normalized.signal, providerId);
    }
  }
}

export async function fetchProviderJson(url, options = {}) {
  const text = await fetchProviderText(url, {
    ...options,
    acceptedContentTypes: ['application/json', 'text/json'],
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('invalid_json', options.providerId);
  }
}

export { ProviderError, sanitizeProviderError };
