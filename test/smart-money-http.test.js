import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchProviderJson,
  fetchProviderText,
  sanitizeProviderError,
} from '../lib/smart-money/http.js';

test('provider transport rejects an origin outside its allowlist', async () => {
  await assert.rejects(
    fetchProviderJson('https://evil.example/data', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    }),
    (error) => error.code === 'origin_not_allowed',
  );
});

test('provider transport rejects oversized text bodies', async () => {
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      maxBytes: 4,
      fetchImpl: async () => new Response('12345', { headers: { 'content-type': 'text/plain' } }),
    }),
    (error) => error.code === 'response_too_large',
  );
});

test('provider transport fails closed for a missing provider before fetch', async () => {
  let fetches = 0;
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'missing-provider',
      allowedOrigins: ['https://data.sec.gov'],
      fetchImpl: async () => {
        fetches += 1;
        return new Response('ok', { headers: { 'content-type': 'text/plain' } });
      },
    }),
    (error) => error.code === 'rights_gate_failed',
  );
  assert.equal(fetches, 0);
});

test('provider transport fails closed for a link-only source before fetch', async () => {
  let fetches = 0;
  await assert.rejects(
    fetchProviderText('https://www.oaktreecapital.com/insights', {
      providerId: 'oaktree-insights',
      allowedOrigins: ['https://www.oaktreecapital.com'],
      fetchImpl: async () => {
        fetches += 1;
        return new Response('ok', { headers: { 'content-type': 'text/plain' } });
      },
    }),
    (error) => error.code === 'rights_gate_failed',
  );
  assert.equal(fetches, 0);
});

test('provider transport ignores removed per-call rights injection options', async () => {
  let fetches = 0;
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'missing-provider',
      adapterConfig: { id: 'sec-edgar', rightsId: 'sec-edgar', requiredPurposes: ['fetch'] },
      assertRights: () => {},
      allowedOrigins: ['https://data.sec.gov'],
      fetchImpl: async () => {
        fetches += 1;
        return new Response('ok', { headers: { 'content-type': 'text/plain' } });
      },
    }),
    (error) => error.code === 'rights_gate_failed',
  );
  assert.equal(fetches, 0);
});

test('provider transport rejects manual redirects and a mismatched final response URL', async () => {
  for (const response of [
    Response.redirect('https://evil.example/redirect', 302),
    new Response('ok', {
      headers: { 'content-type': 'text/plain' },
    }),
  ]) {
    let request;
    if (response.url === '') {
      Object.defineProperty(response, 'url', { value: 'https://evil.example/final' });
    }
    await assert.rejects(
      fetchProviderText('https://data.sec.gov/test', {
        providerId: 'sec-edgar',
        allowedOrigins: ['https://data.sec.gov'],
        fetchImpl: async (_url, options) => {
          request = options;
          return response;
        },
      }),
      (error) => error.code === 'origin_not_allowed',
    );
    assert.equal(request.redirect, 'manual');
  }
});

test('provider transport applies timeout while consuming the response body', async () => {
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      timeoutMs: 10,
      fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      }), { headers: { 'content-type': 'text/plain' } }),
    }),
    (error) => error.code === 'timeout',
  );
});

test('provider transport retries rate limits once and retains Retry-After', async () => {
  let calls = 0;
  const result = await fetchProviderText('https://data.sec.gov/test', {
    providerId: 'sec-edgar',
    allowedOrigins: ['https://data.sec.gov'],
    maxRetries: 1,
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '0' } });
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    },
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('provider transport returns a bounded rate-limit error with Retry-After', async () => {
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      maxRetries: 0,
      fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '3' } }),
    }),
    (error) => error.code === 'rate_limited' && error.retryAfterMs === 3_000,
  );
});

test('provider transport hard-caps retries and aborts a Retry-After wait', async () => {
  let calls = 0;
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      maxRetries: 99,
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: 503 });
      },
    }),
    (error) => error.code === 'provider_unavailable',
  );
  assert.equal(calls, 3);

  const controller = new AbortController();
  const waiting = fetchProviderText('https://data.sec.gov/test', {
    providerId: 'sec-edgar',
    allowedOrigins: ['https://data.sec.gov'],
    maxRetries: 1,
    fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '30' } }),
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, (error) => error.code === 'provider_unavailable');
});

test('provider transport enforces streamed byte limits, MIME types, and JSON errors', async () => {
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      maxBytes: 3,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('éé'));
          controller.close();
        },
      }), { headers: { 'content-type': 'text/plain' } }),
    }),
    (error) => error.code === 'response_too_large',
  );
  await assert.rejects(
    fetchProviderText('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      fetchImpl: async () => new Response('ok', { headers: { 'content-type': 'text/html' } }),
    }),
    (error) => error.code === 'invalid_content_type',
  );
  await assert.rejects(
    fetchProviderJson('https://data.sec.gov/test', {
      providerId: 'sec-edgar',
      allowedOrigins: ['https://data.sec.gov'],
      fetchImpl: async () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    }),
    (error) => error.code === 'invalid_json',
  );
  assert.equal(sanitizeProviderError(new Error('secret provider body')), 'provider_unavailable');
});
