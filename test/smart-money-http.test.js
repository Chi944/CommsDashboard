import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchProviderJson,
  fetchProviderText,
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
      adapterConfig: {
        id: 'oaktree-insights',
        rightsId: 'oaktree-insights',
        requiredPurposes: ['fetch'],
      },
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
