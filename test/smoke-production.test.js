import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const nowIso = () => new Date().toISOString();
const futureIso = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

function fixtureFor(url, overrides = {}) {
  const { pathname } = new URL(url, 'http://surface.test');
  const fixtures = {
    '/api/prices': {
      ok: true,
      partial: false,
      fetchedAt: nowIso(),
      counts: { requested: 268, received: 268, failed: 0, stale: 0 },
    },
    '/api/market/snapshot': {
      ok: true,
      partial: false,
      fetchedAt: nowIso(),
      liveSymbolCount: 17,
      counts: { live: 17, fallback: 0, total: 17 },
      commodities: Array.from({ length: 17 }, (_, index) => ({
        ticker: `LIVE${index}`,
        source: index < 16 ? 'coingecko' : 'eia',
        stale: false,
      })),
      staleProviders: [],
    },
    '/api/news': {
      ok: true,
      partial: false,
      fetchedAt: nowIso(),
      asOf: nowIso(),
      freshness: { maxAgeHours: 168, staleRejected: 2 },
      items: [{ id: 'fresh', ts: Date.now() - 60_000, headline: 'Fresh market headline' }],
    },
    '/api/fear-greed': {
      ok: true,
      value: 63,
      label: 'Greed',
      updatedAt: nowIso(),
    },
    '/api/calendar': {
      ok: true,
      partial: false,
      state: 'live',
      fetchedAt: nowIso(),
      asOf: nowIso(),
      providerStatuses: [
        { id: 'bls', status: 'live' },
        { id: 'bea', status: 'live' },
        { id: 'federal-reserve', status: 'live' },
      ],
      events: [{
        id: 'bls-cpi',
        title: 'Consumer Price Index',
        startsAt: futureIso(),
        source: 'BLS',
        sourceUrl: 'https://www.bls.gov/schedule/',
      }],
    },
    '/api/history': {
      ok: true,
      ticker: 'NVDA',
      range: '1mo',
      points: [{ date: '08-28', price: 101.25 }],
    },
    '/api/asset-news': {
      ok: true,
      query: 'Nvidia',
      fetchedAt: nowIso(),
      items: [{ id: 'nvda-news', ts: Date.now() - 3_600_000, headline: 'Nvidia update' }],
    },
    '/api/smart-money': {
      ok: true,
      partial: false,
      fetchedAt: nowIso(),
      providerStatuses: Array.from({ length: 7 }, (_, index) => ({ id: `provider-${index}`, status: 'live' })),
    },
    '/api/smart-money/history': {
      ok: true,
      partial: false,
      fetchedAt: nowIso(),
      signals: [],
    },
    '/api/smart-money/health': {
      ok: true,
      providerStatuses: Array.from({ length: 7 }, (_, index) => ({ id: `provider-${index}`, state: 'fresh' })),
      deployment: { commitSha: 'abc123', environment: 'production' },
    },
  };
  return Object.hasOwn(overrides, pathname) ? overrides[pathname] : fixtures[pathname] || null;
}

async function withServer(overrides, run) {
  if (typeof overrides === 'function') {
    run = overrides;
    overrides = {};
  }
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, smokeSecret: req.headers['x-ai-smoke-secret'] });
    const body = fixtureFor(req.url, overrides);
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body || { ok: false }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`, seen);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runSmoke(baseUrl) {
  try {
    const result = await execFileAsync(process.execPath, ['scripts/smoke-production.mjs'], {
      cwd: new URL('..', import.meta.url),
      timeout: 5_000,
      env: {
        ...process.env,
        PRODUCTION_SMOKE_BASE_URL: baseUrl,
        PRODUCTION_SMOKE_TIMEOUT_MS: '500',
        PRODUCTION_SMOKE_EXPECTED_COMMIT_SHA: 'abc123',
        PRODUCTION_SMOKE_EXPECTED_DEPLOYMENT_ENVIRONMENT: 'production',
      },
    });
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

test('production surface smoke verifies every non-AI public data flow without sending a secret', async () => {
  await withServer(async (baseUrl, seen) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      new Set(seen.map(({ url }) => new URL(url, baseUrl).pathname)),
      new Set([
        '/api/prices', '/api/market/snapshot', '/api/news', '/api/fear-greed',
        '/api/calendar', '/api/history', '/api/asset-news', '/api/smart-money',
        '/api/smart-money/history', '/api/smart-money/health',
      ]),
    );
    assert.equal(seen.every(({ smokeSecret }) => smokeSecret === undefined), true);
    assert.match(result.stdout, /production surface smoke passed/i);
  });
});

test('production surface smoke rejects news content older than seven days', async () => {
  const oldTimestamp = Date.now() - 8 * 86_400_000;
  await withServer({
    '/api/news': {
      ok: true,
      partial: false,
      fetchedAt: nowIso(),
      asOf: new Date(oldTimestamp).toISOString(),
      freshness: { maxAgeHours: 168, staleRejected: 0 },
      items: [{ id: 'old', ts: oldTimestamp, headline: 'Old headline' }],
    },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /news.*stale/i);
  });
});

test('production surface smoke rejects degraded public data contracts', async (t) => {
  const staleTimestamp = Date.now() - 8 * 86_400_000;
  const cases = [
    {
      name: 'incomplete price coverage',
      path: '/api/prices',
      body: {
        ok: true, partial: true, fetchedAt: nowIso(),
        counts: { requested: 268, received: 267, failed: 1, stale: 0 },
      },
      error: /prices.*coverage/i,
    },
    {
      name: 'fallback market snapshot rows',
      path: '/api/market/snapshot',
      body: {
        ok: true, partial: false, fetchedAt: nowIso(), liveSymbolCount: 16,
        counts: { live: 16, fallback: 1, total: 17 },
        commodities: [{ ticker: 'FALLBACK', stale: true }],
        staleProviders: [],
      },
      error: /market\/snapshot.*live/i,
    },
    {
      name: 'stale fear and greed observation',
      path: '/api/fear-greed',
      body: {
        ok: true, value: 50, label: 'Neutral',
        updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
      error: /fear-greed.*stale/i,
    },
    {
      name: 'calendar without a live official source',
      path: '/api/calendar',
      body: {
        ok: true, partial: true, fetchedAt: nowIso(), asOf: nowIso(), events: [],
        providerStatuses: [{ id: 'bls', status: 'unavailable' }],
      },
      error: /calendar.*official/i,
    },
    {
      name: 'calendar with a degraded official provider',
      path: '/api/calendar',
      body: {
        ok: true,
        partial: true,
        fetchedAt: nowIso(),
        asOf: nowIso(),
        providers: [
          { id: 'bls', status: 'live' },
          { id: 'bea', status: 'live' },
          { id: 'federal-reserve', status: 'unavailable' },
        ],
        events: [{
          id: 'bls-cpi',
          title: 'Consumer Price Index',
          startsAt: futureIso(),
          sourceUrl: 'https://www.bls.gov/schedule/',
        }],
      },
      error: /calendar.*official/i,
    },
    {
      name: 'empty price history',
      path: '/api/history',
      body: { ok: true, ticker: 'NVDA', range: '1mo', points: [] },
      error: /history.*points/i,
    },
    {
      name: 'stale asset news',
      path: '/api/asset-news',
      body: {
        ok: true, query: 'Nvidia', fetchedAt: nowIso(),
        items: [{ id: 'old-nvda', ts: staleTimestamp, headline: 'Old Nvidia story' }],
      },
      error: /asset-news.*stale/i,
    },
    {
      name: 'partial Smart Money snapshot',
      path: '/api/smart-money',
      body: {
        ok: true, partial: true, fetchedAt: nowIso(),
        providerStatuses: Array.from({ length: 6 }, (_, index) => ({ id: `provider-${index}`, status: 'live' })),
      },
      error: /smart-money.*seven.*live/i,
    },
    {
      name: 'stale Smart Money health',
      path: '/api/smart-money/health',
      body: {
        ok: true,
        providerStatuses: Array.from({ length: 7 }, (_, index) => ({
          id: `provider-${index}`,
          state: index === 0 ? 'stale' : 'fresh',
        })),
        deployment: { commitSha: 'abc123', environment: 'production' },
      },
      error: /health.*seven.*fresh/i,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      await withServer({ [fixture.path]: fixture.body }, async (baseUrl) => {
        const result = await runSmoke(baseUrl);
        assert.equal(result.code, 1);
        assert.match(result.stderr, fixture.error);
      });
    });
  }
});
