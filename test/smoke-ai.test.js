import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const completeAnalysis = {
  trend: 'Constructive trend',
  catalysts: 'No notable headline catalysts.',
  risks: 'Volatility remains elevated.',
  outlook: 'Constructive with caution.',
};

async function withServer(responses, run) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({
      url: req.url,
      smokeSecret: req.headers['x-ai-smoke-secret'],
    });
    const normalizedUrl = new URL(req.url, 'http://smoke.test');
    normalizedUrl.searchParams.delete('aiSmoke');
    const lookupKey = `${normalizedUrl.pathname}${normalizedUrl.search}`;
    const body = responses[lookupKey];
    if (typeof body === 'function') {
      body(req, res);
      return;
    }
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

async function runSmoke(baseUrl, { secret = 'smoke-test-secret', timeoutMs = 500 } = {}) {
  try {
    const result = await execFileAsync(process.execPath, ['scripts/smoke-ai.mjs'], {
      cwd: new URL('..', import.meta.url),
      timeout: 3_000,
      env: {
        ...process.env,
        AI_SMOKE_BASE_URL: baseUrl,
        AI_SMOKE_TICKER: 'NVDA',
        AI_SMOKE_SECRET: secret,
        AI_SMOKE_TIMEOUT_MS: String(timeoutMs),
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

test('smoke script checks briefing and configured per-asset AI endpoints', async () => {
  await withServer({
    '/api/briefing': { ok: true, briefing: { text: 'Market briefing' }, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl, seen) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(seen.length, 2);
    assert.match(seen[0].url, /^\/api\/briefing\?aiSmoke=[^&]+$/);
    assert.match(seen[1].url, /^\/api\/analysis\?ticker=NVDA&aiSmoke=[^&]+$/);
    assert.deepEqual(seen.map(({ smokeSecret }) => smokeSecret), [
      'smoke-test-secret',
      'smoke-test-secret',
    ]);
    assert.doesNotMatch(seen.map(({ url }) => url).join('\n'), /smoke-test-secret/);
    assert.match(result.stdout, /AI smoke check passed/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /smoke-test-secret/);
  });
});

test('smoke script fails when the briefing has no generated text', async () => {
  await withServer({
    '/api/briefing': { ok: true, briefing: null, aiStatus: { state: 'degraded' } },
    '/api/analysis?ticker=NVDA': { ok: true, ai: { trend: 'Constructive trend' }, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /briefing\.text/);
  });
});

test('smoke script fails when per-asset AI content is absent', async () => {
  await withServer({
    '/api/briefing': { ok: true, briefing: { text: 'Market briefing' }, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/analysis?ticker=NVDA': { ok: true, ai: null, aiStatus: { state: 'degraded' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /all four.*analysis sections/i);
  });
});

test('smoke script requires every rendered analysis section to be non-empty', async () => {
  await withServer({
    '/api/briefing': { ok: true, briefing: { text: 'Market briefing' }, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/analysis?ticker=NVDA': {
      ok: true,
      ai: { ...completeAnalysis, risks: '' },
      aiStatus: { state: 'ready', source: 'generated' },
    },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /all four.*analysis sections/i);
  });
});

test('smoke script rejects raw analysis text when rendered sections are empty', async () => {
  await withServer({
    '/api/briefing': { ok: true, briefing: { text: 'Market briefing' }, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/analysis?ticker=NVDA': {
      ok: true,
      ai: { raw: 'Unparsed provider output', trend: '', catalysts: '', risks: '', outlook: '' },
      aiStatus: { state: 'ready', source: 'generated' },
    },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /all four.*analysis sections/i);
  });
});

test('smoke script rejects cached AI responses instead of reporting a false generation pass', async () => {
  await withServer({
    '/api/briefing': { ok: true, briefing: { text: 'Market briefing' }, aiStatus: { state: 'ready', source: 'cache' } },
    '/api/analysis?ticker=NVDA': { ok: true, ai: { trend: 'Constructive trend' }, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /briefing.*source.*generated/i);
  });
});

test('smoke script bounds endpoint fetches with a timeout', async () => {
  await withServer({
    '/api/briefing': () => {},
    '/api/analysis?ticker=NVDA': { ok: true, ai: { trend: 'Constructive trend' }, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl, { timeoutMs: 30 });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /briefing.*timed out/i);
  });
});
