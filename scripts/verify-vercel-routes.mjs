import assert from 'node:assert/strict';

const baseUrl = process.env.VERCEL_DEV_BASE_URL;
if (!baseUrl) throw new Error('VERCEL_DEV_BASE_URL is required.');

const checks = [
  {
    path: '/api/smart-money/briefing?unknown=1',
    statuses: [400],
    codes: ['invalid_query_parameters'],
  },
  {
    path: '/api/smart-money/health?unknown=1',
    statuses: [400],
    codes: ['invalid_query_parameters'],
  },
  {
    path: '/api/smart-money/history?limit=1',
    statuses: [400],
    codes: ['invalid_query_parameters'],
  },
  {
    path: '/api/smart-money/refresh',
    statuses: [401, 503],
    codes: ['unauthorized', 'refresh_configuration_invalid'],
  },
  {
    path: '/api/smart-money/unknown',
    statuses: [404],
    codes: ['smart_money_route_not_found'],
  },
  {
    path: '/api/smart-money/briefing/?unknown=1',
    statuses: [400],
    codes: ['invalid_query_parameters'],
  },
  {
    path: '/api/smart-money/health?route=refresh&unknown=1',
    statuses: [400],
    codes: ['invalid_query_parameters', 'invalid_route_parameter'],
    headers: { authorization: 'Bearer definitely-not-the-cron-secret' },
  },
];

for (const check of checks) {
  const response = await fetch(new URL(check.path, baseUrl), {
    headers: check.headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  const contentType = response.headers.get('content-type') || '';
  assert.match(contentType, /^application\/json(?:;|$)/i, check.path);
  const body = await response.json();
  assert.ok(check.statuses.includes(response.status), `${check.path}: ${response.status}`);
  assert.ok(check.codes.includes(body?.error?.code), `${check.path}: ${body?.error?.code}`);
  process.stdout.write(`verified ${check.path} -> ${response.status} ${body.error.code}\n`);
}
