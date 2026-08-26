import assert from 'node:assert/strict';
import test from 'node:test';

import { createSmartMoneyBriefingHandler } from '../api/smart-money/briefing.js';
import {
  SMART_MONEY_PARAGRAPH_IDS,
  buildDeterministicSmartMoneyBriefing,
  buildSmartMoneyEvidence,
  digestSmartMoneyEvidence,
  validateSmartMoneyCompletion,
} from '../lib/smart-money/briefing.js';
import { mockRequest } from './helpers/api.js';
import { SMART_MONEY_RESPONSE } from './fixtures/smart-money/client.js';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const MARKET_CONTEXT = {
  marketDate: '2026-08-27',
  inputsAsOf: {
    market: '2026-08-27T11:59:00.000Z', marketFetchedAt: '2026-08-27T12:00:00.000Z',
    news: null, newsFetchedAt: null, sentiment: '2026-08-27T11:00:00.000Z',
  },
  upstream: {
    pricesReady: true, newsReady: false, trustedMoversReady: true, sentimentReady: true,
  },
  evidence: [
    { id: 'market:gainer:NVDA', type: 'top_gainer', label: 'NVDA +3.20%', asOf: '2026-08-27T11:59:00.000Z', source: 'yahoo', sourceUrl: null, causalEligible: false },
    { id: 'sentiment:fear-greed', type: 'crypto_fear_greed', label: '61 · Greed', asOf: '2026-08-27T11:00:00.000Z', source: 'Alternative.me Fear & Greed', sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/', causalEligible: false },
  ],
};

test('deterministic Smart Money briefing always has three grounded fixed paragraphs', () => {
  const evidence = buildSmartMoneyEvidence({
    snapshot: SMART_MONEY_RESPONSE,
    marketContext: MARKET_CONTEXT,
    now: NOW,
  });
  const briefing = buildDeterministicSmartMoneyBriefing({
    snapshot: SMART_MONEY_RESPONSE,
    marketContext: MARKET_CONTEXT,
    evidence,
    now: NOW,
  });
  assert.deepEqual(briefing.paragraphs.map((row) => row.id), SMART_MONEY_PARAGRAPH_IDS);
  assert.equal(briefing.source, 'deterministic');
  assert.equal(briefing.marketDate, '2026-08-27');
  assert.equal(briefing.paragraphs.every((row) => row.evidenceIds.every((id) => (
    briefing.evidence.some((evidenceRow) => evidenceRow.id === id)
  ))), true);
  assert.match(briefing.paragraphs[1].text, /No material new investor or firm disclosure was found/i);
  assert.match(briefing.paragraphs[2].text, /research-only/i);
});

test('digest follows accepted evidence and provider coverage, not generation time', () => {
  const evidence = buildSmartMoneyEvidence({ snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, now: NOW });
  const first = digestSmartMoneyEvidence({
    marketDate: '2026-08-27', thresholdVersion: 'smart-money-v1', evidence,
    providerStatuses: SMART_MONEY_RESPONSE.providerStatuses,
  });
  const second = digestSmartMoneyEvidence({
    marketDate: '2026-08-27', thresholdVersion: 'smart-money-v1',
    evidence: evidence.map((row, index) => index ? row : { ...row, label: `${row.label} changed` }),
    providerStatuses: SMART_MONEY_RESPONSE.providerStatuses,
  });
  assert.match(first, /^[a-f0-9]{24}$/);
  assert.notEqual(first, second);
});

test('AI selection rejects unknown, cross-section, uncited-capability, and prose fields', () => {
  const evidence = buildSmartMoneyEvidence({ snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, now: NOW });
  const base = SMART_MONEY_PARAGRAPH_IDS.map((id) => ({
    id,
    evidenceIds: [id === 'market-regime'
      ? evidence[0].id
      : id === 'investor-disclosures' ? 'snapshot:coverage' : 'capability:simulation'],
  }));
  for (const paragraphs of [
    base.map((row, index) => index ? row : { ...row, evidenceIds: ['unknown'] }),
    base.map((row, index) => index ? row : { ...row, evidenceIds: ['capability:simulation'] }),
    base.map((row, index) => index === 2 ? { ...row, evidenceIds: ['snapshot:coverage'] } : row),
    base.map((row, index) => index ? row : { ...row, text: 'Go long NVDA and maintain an overweight allocation.' }),
  ]) {
    assert.throws(() => validateSmartMoneyCompletion({ text: JSON.stringify({ paragraphs }) }, {
      snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, evidence, now: NOW,
    }), /provider_invalid_response/);
  }
});

test('AI completion accepts only the fixed cited research contract', () => {
  const evidence = buildSmartMoneyEvidence({ snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, now: NOW });
  const completion = {
    model: 'test/research-model',
    text: JSON.stringify({
      paragraphs: [
        { id: 'market-regime', evidenceIds: [evidence[0].id] },
        { id: 'investor-disclosures', evidenceIds: ['snapshot:coverage'] },
        { id: 'crypto-paper-risk', evidenceIds: ['capability:simulation'] },
      ],
    }),
  };
  const briefing = validateSmartMoneyCompletion(completion, {
    snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, evidence, now: NOW,
  });
  assert.equal(briefing.source, 'generated');
  assert.equal(briefing.model, 'test/research-model');
  assert.deepEqual(briefing.paragraphs.map((row) => row.id), SMART_MONEY_PARAGRAPH_IDS);
  assert.match(briefing.paragraphs[1].text, /No material new investor or firm disclosure was found/i);
  assert.match(briefing.paragraphs[2].text, /research-only/i);
  assert.equal(JSON.stringify(briefing).includes('Go long'), false);
});

test('AI selection cannot omit accepted investor activity or crypto coverage and claim absence', () => {
  const evidence = [
    ...buildSmartMoneyEvidence({ snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, now: NOW }),
    {
      id: 'activity:accepted-investor', type: 'investor_activity',
      label: 'Accepted investor filing activity.', asOf: NOW.toISOString(),
      source: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/', causalEligible: false,
    },
    {
      id: 'activity:accepted-crypto', type: 'crypto_activity',
      label: 'Accepted venue-scoped crypto observation.', asOf: NOW.toISOString(),
      source: 'Accepted public source', sourceUrl: 'https://example.com/crypto', causalEligible: false,
    },
  ];
  const base = [
    { id: 'market-regime', evidenceIds: [evidence[0].id] },
    { id: 'investor-disclosures', evidenceIds: ['activity:accepted-investor'] },
    { id: 'crypto-paper-risk', evidenceIds: ['activity:accepted-crypto', 'capability:simulation'] },
  ];
  assert.doesNotThrow(() => validateSmartMoneyCompletion({ text: JSON.stringify({ paragraphs: base }) }, {
    snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, evidence, now: NOW,
  }));
  for (const paragraphs of [
    base.map((row, index) => index === 1 ? { ...row, evidenceIds: ['snapshot:coverage'] } : row),
    base.map((row, index) => index === 2 ? { ...row, evidenceIds: ['capability:simulation'] } : row),
  ]) {
    assert.throws(() => validateSmartMoneyCompletion({ text: JSON.stringify({ paragraphs }) }, {
      snapshot: SMART_MONEY_RESPONSE, marketContext: MARKET_CONTEXT, evidence, now: NOW,
    }), /provider_invalid_response/);
  }
});

test('handler uses the v2 cache namespace so legacy free-form values cannot be reused', async () => {
  let cacheKey = null;
  const handler = createSmartMoneyBriefingHandler({
    now: () => new Date(NOW),
    readSnapshot: async () => structuredClone(SMART_MONEY_RESPONSE),
    loadMarketContext: async () => structuredClone(MARKET_CONTEXT),
    aiAvailable: true,
    runGeneration: async ({ snapshot, marketContext, evidence, now }) => (
      buildDeterministicSmartMoneyBriefing({ snapshot, marketContext, evidence, now })
    ),
    guardedGeneration: async (options) => {
      cacheKey = options.cacheKey;
      return { value: await options.generate(), source: 'generated' };
    },
  });
  const { req, res } = mockRequest('/api/smart-money/briefing');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(cacheKey, /^smart-money-briefing:v2:/);
});

test('handler returns deterministic HTTP 200 when generation fails', async () => {
  const handler = createSmartMoneyBriefingHandler({
    now: () => new Date(NOW),
    readSnapshot: async () => structuredClone(SMART_MONEY_RESPONSE),
    loadMarketContext: async () => structuredClone(MARKET_CONTEXT),
    aiAvailable: true,
    runGeneration: async () => { throw Object.assign(new Error('provider secret'), { code: 'provider_unavailable' }); },
  });
  const { req, res } = mockRequest('/api/smart-money/briefing');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.briefing.source, 'deterministic');
  assert.equal(res.body.briefing.paragraphs.length, 3);
  assert.equal(JSON.stringify(res.body).includes('provider secret'), false);
});

test('authenticated fallback smoke makes no AI generation call', async () => {
  let calls = 0;
  const handler = createSmartMoneyBriefingHandler({
    now: () => new Date(NOW),
    readSnapshot: async () => structuredClone(SMART_MONEY_RESPONSE),
    loadMarketContext: async () => structuredClone(MARKET_CONTEXT),
    aiAvailable: true,
    smokeAuthorized: () => true,
    runGeneration: async () => { calls += 1; throw new Error('must not run'); },
  });
  const { req, res } = mockRequest('/api/smart-money/briefing?fallbackSmoke=1');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.briefing.source, 'deterministic');
  assert.equal(calls, 0);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('route rejects methods, unknown queries, and unauthorized smoke before loading inputs', async () => {
  let reads = 0;
  const handler = createSmartMoneyBriefingHandler({
    now: () => new Date(NOW),
    readSnapshot: async () => { reads += 1; return structuredClone(SMART_MONEY_RESPONSE); },
    loadMarketContext: async () => { reads += 1; return structuredClone(MARKET_CONTEXT); },
    aiAvailable: false,
  });
  for (const [url, method, status] of [
    ['/api/smart-money/briefing', 'POST', 405],
    ['/api/smart-money/briefing?unknown=1', 'GET', 400],
    ['/api/smart-money/briefing?aiSmoke=1', 'GET', 400],
    ['/api/smart-money/briefing?fallbackSmoke=1', 'GET', 400],
  ]) {
    const { req, res } = mockRequest(url, { method });
    await handler(req, res);
    assert.equal(res.statusCode, status);
  }
  assert.equal(reads, 0);
});

test('input failures still return a current non-null research-only briefing', async () => {
  const handler = createSmartMoneyBriefingHandler({
    now: () => new Date(NOW),
    readSnapshot: async () => { throw new Error('private storage detail'); },
    loadMarketContext: async () => { throw new Error('private market detail'); },
    aiAvailable: true,
    runGeneration: async () => { throw new Error('must not run without a snapshot'); },
  });
  const { req, res } = mockRequest('/api/smart-money/briefing');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.briefing.marketDate, '2026-08-27');
  assert.deepEqual(res.body.briefing.paragraphs.map((row) => row.id), SMART_MONEY_PARAGRAPH_IDS);
  assert.equal(res.body.inputStatus.smartMoney, 'unavailable');
  assert.equal(res.body.inputStatus.market, 'unavailable');
  assert.equal(JSON.stringify(res.body).includes('private'), false);
});
