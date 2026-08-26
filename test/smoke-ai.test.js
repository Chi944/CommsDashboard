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
const completeBriefingText = 'Market tone is balanced.\n\nSentiment is mixed.\n\nWatch the next session. Informational only — not financial advice.';
const marketEvidence = [
  {
    id: 'market:gainer:NVDA', type: 'top_gainer', label: 'NVDA +2.00%',
    asOf: new Date().toISOString(), source: 'yahoo', sourceUrl: null, causalEligible: false,
  },
  {
    id: 'sentiment:fear-greed', type: 'crypto_fear_greed', label: '27 · Fear',
    asOf: new Date().toISOString(), source: 'Alternative.me',
    sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/', causalEligible: false,
  },
  {
    id: 'input:coverage', type: 'input_coverage', label: 'Accepted daily input coverage.',
    asOf: new Date().toISOString(), source: 'Dashboard input status',
    sourceUrl: null, causalEligible: false,
  },
];
const completeBriefing = {
  ok: true,
  briefing: {
    text: completeBriefingText,
    evidence: marketEvidence,
    paragraphs: completeBriefingText.split('\n\n').map((text, index) => ({
      id: ['market-tone', 'themes-catalysts', 'watchpoints'][index],
      text,
      evidenceIds: index === 0
        ? ['market:gainer:NVDA']
        : (index === 1 ? ['sentiment:fear-greed'] : ['input:coverage']),
    })),
    marketDate: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    inputsAsOf: {
      market: new Date().toISOString(),
      marketFetchedAt: new Date().toISOString(),
      news: new Date().toISOString(),
      sentiment: new Date().toISOString(),
    },
  },
  signals: {
    sentiment: {
      headline: {
        label: 'mixed',
        score: 0,
        positive: 1,
        negative: 1,
        neutral: 1,
        sampleSize: 3,
        updatedAt: new Date().toISOString(),
      },
      cryptoFearGreed: { value: 27, label: 'Fear', updatedAt: new Date().toISOString() },
    },
  },
  aiStatus: { state: 'ready', source: 'generated' },
};

const smartMoneyEvidence = [
  {
    id: 'snapshot:coverage', type: 'snapshot_coverage',
    label: 'Accepted snapshot contains public research coverage.',
    asOf: new Date().toISOString(), source: 'Accepted Smart Money snapshot',
    sourceUrl: null, causalEligible: false,
  },
  {
    id: 'capability:simulation', type: 'simulation_capability',
    label: 'Simulation is research-only and transactions are disabled.',
    asOf: new Date().toISOString(), source: 'Dashboard capability policy',
    sourceUrl: null, causalEligible: false,
  },
];
const smartMoneyTexts = [
  'Accepted market and provider observations remain separate.',
  'No material new investor or firm disclosure was found in the accepted snapshot.',
  'Simulation remains research-only. Research intelligence only — not financial advice. No transaction was prepared or executed.',
];
const completeSmartMoneyBriefing = {
  schemaVersion: 1,
  ok: true,
  briefing: {
    source: 'generated',
    marketDate: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    evidence: smartMoneyEvidence,
    paragraphs: smartMoneyTexts.map((text, index) => ({
      id: ['market-regime', 'investor-disclosures', 'crypto-paper-risk'][index],
      text,
      evidenceIds: [index === 2 ? 'capability:simulation' : 'snapshot:coverage'],
    })),
    text: smartMoneyTexts.join('\n\n'),
  },
  aiStatus: { state: 'ready', source: 'generated' },
};
const providerIds = [
  'sec-edgar', 'institutional-strategy', 'institutional-tesla',
  'institutional-ibit', 'institutional-fbtc', 'institutional-arkb',
  'institutional-bitb',
];
const completeSmartMoneyHealth = {
  schemaVersion: 1,
  ok: true,
  providerStatuses: providerIds.map((id) => ({ id, state: 'fresh' })),
};
const DEFAULT_RESPONSES = Object.freeze({
  '/api/smart-money/briefing': completeSmartMoneyBriefing,
  '/api/smart-money/health': completeSmartMoneyHealth,
});

async function withServer(responses, run) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({
      url: req.url,
      smokeSecret: req.headers['x-ai-smoke-secret'],
    });
    const normalizedUrl = new URL(req.url, 'http://smoke.test');
    normalizedUrl.searchParams.delete('aiSmoke');
    normalizedUrl.searchParams.delete('fallbackSmoke');
    const lookupKey = `${normalizedUrl.pathname}${normalizedUrl.search}`;
    const body = Object.hasOwn(responses, lookupKey)
      ? responses[lookupKey]
      : DEFAULT_RESPONSES[lookupKey];
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

async function runSmoke(baseUrl, {
  secret = 'smoke-test-secret',
  timeoutMs = 500,
  expectedCommitSha,
  expectedDeploymentEnvironment,
} = {}) {
  try {
    const result = await execFileAsync(process.execPath, ['scripts/smoke-ai.mjs'], {
      cwd: new URL('..', import.meta.url),
      timeout: 3_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AI_SMOKE_BASE_URL: baseUrl,
        AI_SMOKE_TICKER: 'NVDA',
        AI_SMOKE_SECRET: secret,
        AI_SMOKE_TIMEOUT_MS: String(timeoutMs),
        AI_SMOKE_TEST_WINDOW_GAP_MS: '0',
        AI_SMOKE_EXPECTED_COMMIT_SHA: expectedCommitSha,
        AI_SMOKE_EXPECTED_DEPLOYMENT_ENVIRONMENT: expectedDeploymentEnvironment,
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
    '/api/briefing': completeBriefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl, seen) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(seen.length, 4);
    assert.equal(seen.some(({ url }) => /^\/api\/briefing\?aiSmoke=[^&]+$/.test(url)), true);
    assert.equal(seen.some(({ url }) => /^\/api\/analysis\?ticker=NVDA&aiSmoke=[^&]+$/.test(url)), true);
    assert.equal(seen.some(({ url }) => url === '/api/smart-money/briefing?aiSmoke=1'), true);
    assert.equal(seen.some(({ url }) => url === '/api/smart-money/health'), true);
    assert.deepEqual(seen.map(({ smokeSecret }) => smokeSecret), Array(4).fill('smoke-test-secret'));
    assert.doesNotMatch(seen.map(({ url }) => url).join('\n'), /smoke-test-secret/);
    assert.match(result.stdout, /AI and Smart Money smoke check passed/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /smoke-test-secret/);
  });
});

test('smoke script accepts the exact expected production deployment identity', async () => {
  await withServer({
    '/api/briefing': completeBriefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/smart-money/health': {
      ...completeSmartMoneyHealth,
      deployment: { commitSha: 'abc123def456', environment: 'production' },
    },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl, {
      expectedCommitSha: 'abc123def456',
      expectedDeploymentEnvironment: 'production',
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /deployment abc123def456 \(production\)/i);
  });
});

test('smoke script rejects a mismatched deployment identity', async (t) => {
  const cases = [
    {
      name: 'commit SHA',
      deployment: { commitSha: 'old456', environment: 'production' },
      expectedError: /deployment commit.*old456.*expected abc123/i,
    },
    {
      name: 'environment',
      deployment: { commitSha: 'abc123', environment: 'preview' },
      expectedError: /deployment environment.*preview.*expected production/i,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      await withServer({
        '/api/briefing': completeBriefing,
        '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
        '/api/smart-money/health': {
          ...completeSmartMoneyHealth,
          deployment: fixture.deployment,
        },
      }, async (baseUrl) => {
        const result = await runSmoke(baseUrl, {
          expectedCommitSha: 'abc123',
          expectedDeploymentEnvironment: 'production',
        });

        assert.equal(result.code, 1);
        assert.match(result.stderr, fixture.expectedError);
      });
    });
  }
});

test('smoke script rejects a missing deployment identity when commit binding is enabled', async () => {
  await withServer({
    '/api/briefing': completeBriefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/smart-money/health': completeSmartMoneyHealth,
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl, {
      expectedCommitSha: 'abc123',
      expectedDeploymentEnvironment: 'production',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /health did not report deployment commit and environment/i);
  });
});

test('smoke script fails unless all seven Smart Money providers are fresh', async () => {
  await withServer({
    '/api/briefing': completeBriefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/smart-money/health': {
      ...completeSmartMoneyHealth,
      providerStatuses: completeSmartMoneyHealth.providerStatuses.map((status, index) => (
        index === 0 ? { ...status, state: 'stale' } : status
      )),
    },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /all seven.*fresh/i);
  });
});

test('smoke script rejects a deterministic Smart Money result during forced generation smoke', async () => {
  await withServer({
    '/api/briefing': completeBriefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/smart-money/briefing': {
      ...completeSmartMoneyBriefing,
      briefing: { ...completeSmartMoneyBriefing.briefing, source: 'deterministic' },
      aiStatus: { state: 'degraded' },
    },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /smart-money\/briefing source was not generated/i);
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
    '/api/briefing': completeBriefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: null, aiStatus: { state: 'degraded' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /all four.*analysis sections/i);
  });
});

test('smoke script requires every rendered analysis section to be non-empty', async () => {
  await withServer({
    '/api/briefing': completeBriefing,
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
    '/api/briefing': completeBriefing,
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
    '/api/briefing': { ...completeBriefing, aiStatus: { state: 'ready', source: 'cache' } },
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

test('smoke script fails when a generated briefing lacks current sentiment evidence', async () => {
  await withServer({
    '/api/briefing': {
      ...completeBriefing,
      signals: {},
    },
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /briefing.*sentiment/i);
  });
});

test('smoke script fails when generated paragraphs are not grounded in today\'s market date', async () => {
  await withServer({
    '/api/briefing': {
      ...completeBriefing,
      briefing: { ...completeBriefing.briefing, marketDate: '1999-12-31' },
    },
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /briefing.*market date/i);
  });
});

test('smoke script fails when the briefing uses a stale market observation', async () => {
  await withServer({
    '/api/briefing': {
      ...completeBriefing,
      briefing: {
        ...completeBriefing.briefing,
        inputsAsOf: {
          ...completeBriefing.briefing.inputsAsOf,
          market: '1999-12-31T00:00:00.000Z',
        },
      },
    },
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /briefing.*market observation/i);
  });
});

test('smoke script rejects generic prose without per-paragraph market and sentiment evidence', async () => {
  await withServer({
    '/api/briefing': {
      ...completeBriefing,
      briefing: { ...completeBriefing.briefing, paragraphs: undefined },
    },
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /paragraph.*evidence/i);
  });
});

test('smoke script rejects market evidence assigned to the wrong paragraph', async () => {
  const briefing = structuredClone(completeBriefing);
  briefing.briefing.paragraphs[1].evidenceIds = ['market:gainer:NVDA'];
  await withServer({
    '/api/briefing': briefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /evidence.*wrong paragraph/i);
  });
});

test('smoke script rejects Smart Money briefing without the research-only capability evidence', async () => {
  const briefing = structuredClone(completeSmartMoneyBriefing);
  briefing.briefing.paragraphs[2].evidenceIds = ['snapshot:coverage'];
  await withServer({
    '/api/briefing': completeBriefing,
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
    '/api/smart-money/briefing': briefing,
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /smart-money.*evidence.*wrong paragraph/i);
  });
});

test('smoke script rejects stale sentiment evidence', async () => {
  await withServer({
    '/api/briefing': {
      ...completeBriefing,
      signals: {
        sentiment: {
          headline: {
            ...completeBriefing.signals.sentiment.headline,
            updatedAt: '1999-12-31T00:00:00.000Z',
          },
          cryptoFearGreed: {
            ...completeBriefing.signals.sentiment.cryptoFearGreed,
            updatedAt: '1999-12-31T00:00:00.000Z',
          },
        },
      },
    },
    '/api/analysis?ticker=NVDA': { ok: true, ai: completeAnalysis, aiStatus: { state: 'ready', source: 'generated' } },
  }, async (baseUrl) => {
    const result = await runSmoke(baseUrl);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /sentiment.*stale/i);
  });
});
