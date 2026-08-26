import assert from 'node:assert/strict';
import test from 'node:test';

import * as analysisApi from '../api/analysis.js';
import * as marketApi from '../api/briefing.js';
import * as marketBriefing from '../lib/briefing/market-briefing.js';
import * as groq from '../lib/groq.js';
import * as smartMoneyBriefing from '../lib/smart-money/briefing.js';
import * as smartMoneyApi from '../server/smart-money/briefing.js';

const LIMIT = 7_500;
const NOW = '2026-08-27T12:00:00.000Z';

function record(id, type, label, index = 0) {
  return {
    id,
    type,
    label,
    asOf: new Date(Date.parse(NOW) - index * 60_000).toISOString(),
    source: 'Public source',
    causalEligible: false,
  };
}

function marketFixture(text = 'Production market observation') {
  const evidence = [
    ...Array.from({ length: 3 }, (_, index) => record(
      `market:gainer:G${index}`,
      'top_gainer',
      `G${index} +${12 - index}.5% ${text}`,
      index,
    )),
    ...Array.from({ length: 3 }, (_, index) => record(
      `market:loser:L${index}`,
      'top_loser',
      `L${index} -${11 - index}.5% ${text}`,
      index,
    )),
    ...Array.from({ length: 8 }, (_, index) => record(
      `headline:${index}`,
      'headline',
      `${text} headline ${index}`,
      index,
    )),
    record('sentiment:headlines', 'headline_sentiment', `${text} sentiment is mixed`),
    record('sentiment:fear-greed', 'crypto_fear_greed', `${text} fear and greed is 48`),
    ...Array.from({ length: 4 }, (_, index) => record(
      `market:asset:${index}`,
      'market_asset',
      `${text} asset ${index}`,
      index,
    )),
    record('input:coverage', 'input_coverage', `${text} accepted prices, headlines, sentiment`),
  ];
  return {
    context: {
      marketDate: NOW.slice(0, 10),
      upstream: {
        pricesReady: true,
        newsReady: true,
        trustedMoversReady: true,
        sentimentReady: true,
      },
    },
    evidence,
  };
}

function smartMoneyFixture(text = 'Production Smart Money observation') {
  const market = [
    record('smart:market:gainer', 'market_top_gainer', `${text} gainer +12.5%`),
    record('smart:market:loser', 'market_top_loser', `${text} loser -11.5%`),
    record('smart:market:headline', 'market_headline', `${text} headline`),
    record('smart:market:sentiment', 'market_headline_sentiment', `${text} sentiment`),
    record('smart:market:fear-greed', 'market_crypto_fear_greed', `${text} fear and greed`),
    ...Array.from({ length: 15 }, (_, index) => record(
      `smart:market:${index}`,
      'market_asset',
      `${text} market asset ${index}`,
      index + 1,
    )),
  ];
  const investorActivities = Array.from({ length: 18 }, (_, index) => record(
    `smart:investor:${index}`,
    'investor_activity',
    `${text} investor disclosure ${index}`,
    index,
  ));
  const cryptoActivities = Array.from({ length: 6 }, (_, index) => record(
    `smart:crypto:${index}`,
    'crypto_activity',
    `${text} crypto activity ${index}`,
    index,
  ));
  const signals = Array.from({ length: 24 }, (_, index) => record(
    `smart:signal:${index}`,
    'crypto_signal',
    `${text} crypto signal ${index}`,
    index,
  ));
  const entities = Array.from({ length: 18 }, (_, index) => record(
    `smart:entity:${index}`,
    'entity_institutional-flows',
    `${text} institutional flow entity ${index}`,
    index,
  ));
  const providers = Array.from({ length: 7 }, (_, index) => record(
    `smart:provider:${index}`,
    index === 0 ? 'provider_sec' : 'provider_institutional',
    `${text} provider ${index}`,
    index,
  ));
  return [
    ...market,
    ...investorActivities,
    ...cryptoActivities,
    ...signals,
    ...entities,
    ...providers,
    record('snapshot:coverage', 'snapshot_coverage', `${text} accepted snapshot coverage`),
    record('capability:simulation', 'simulation_capability', `${text} research-only simulation`),
  ];
}

function analysisFixture(text = 'Production headline') {
  return {
    symbol: { name: `${text} asset`, ticker: 'NVDA', category: 'Equity' },
    technicals: {
      last: 183.22,
      return_1m: 4.12,
      return_3m: 11.9,
      return_6m: 19.44,
      sma20: 179.1,
      sma50: 165.4,
      above_sma20: true,
      above_sma50: true,
      rsi14: 61.4,
      vol_annual: 39.2,
      fiftyTwoWeekLow: 90,
      fiftyTwoWeekHigh: 190,
      range_pct: 93.2,
    },
    headlines: Array.from({ length: 5 }, (_, index) => ({
      title: `${text} ${index}`,
      source: `Wire ${index}`,
      pubDate: new Date(Date.parse(NOW) - index * 60_000).toISOString(),
    })),
  };
}

function buildersAvailable() {
  assert.equal(typeof marketApi.buildMarketBriefingGroqRequest, 'function');
  assert.equal(typeof analysisApi.buildAnalysisGroqRequest, 'function');
  assert.equal(typeof smartMoneyApi.buildSmartMoneyGroqRequest, 'function');
  assert.equal(typeof groq.groqRequestReservedTokenUpperBound, 'function');
  assert.equal(groq.GROQ_REQUEST_RESERVED_TOKEN_LIMIT, LIMIT);
}

function buildRequests({ adversarial = false } = {}) {
  buildersAvailable();
  const unicode = '🧿'.repeat(400);
  const { context, evidence: baseMarketEvidence } = marketFixture(
    adversarial ? unicode : 'Production market observation',
  );
  const marketEvidence = adversarial
    ? baseMarketEvidence.map((item) => (
      ['input_coverage', 'top_gainer', 'top_loser'].includes(item.type)
        ? { ...item, id: item.id === 'input:coverage' ? item.id : `${unicode}:${item.id}` }
        : { ...item, id: `${unicode}:${item.id}` }
    ))
    : baseMarketEvidence;

  const baseSmartEvidence = smartMoneyFixture(adversarial ? unicode : undefined);
  const smartEvidence = adversarial
    ? baseSmartEvidence.map((item) => (
      item.id === 'capability:simulation'
        ? item
        : { ...item, id: `${unicode}:${item.id}` }
    ))
    : baseSmartEvidence;

  const analysisInput = analysisFixture(adversarial ? unicode : undefined);
  if (adversarial) {
    analysisInput.symbol = { name: unicode, ticker: unicode, category: unicode };
    analysisInput.headlines = Array.from({ length: 5 }, () => ({
      title: unicode,
      source: unicode,
      pubDate: NOW,
    }));
  }

  const market = marketApi.buildMarketBriefingGroqRequest(context, marketEvidence).request;
  const analysis = analysisApi.buildAnalysisGroqRequest(analysisInput);
  const smartMoney = smartMoneyApi.buildSmartMoneyGroqRequest({
    snapshot: {},
    marketContext: context,
    evidence: smartEvidence,
    generationEvidence: smartEvidence,
  }).request;
  return { market, analysis, smartMoney };
}

function assertBudget(requests) {
  const measured = Object.fromEntries(Object.entries(requests).map(([name, request]) => [
    name,
    groq.groqRequestReservedTokenUpperBound(request),
  ]));
  for (const [name, reserved] of Object.entries(measured)) {
    assert.equal(requests[name].maxReservedTokens, LIMIT);
    assert.ok(reserved <= LIMIT, `${name} reserved-token upper bound ${reserved} exceeds ${LIMIT}`);
  }
  return measured;
}

test('production-shaped forced-smoke requests reserve no more than the free 8K TPM budget', (t) => {
  t.diagnostic(`reserved upper bounds ${JSON.stringify(assertBudget(buildRequests()))}`);
});

test('max-length four-byte Unicode inputs cannot escape the forced-smoke token budget', (t) => {
  t.diagnostic(`reserved upper bounds ${JSON.stringify(assertBudget(buildRequests({ adversarial: true })))}`);
});

test('aliased Unicode evidence remains satisfiable in each strict schema and resolves to the full audit IDs', () => {
  buildersAvailable();
  const env = process.env.GROQ_MODEL;
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  try {
    const unicode = '🧿'.repeat(50);
    const { context, evidence: marketBase } = marketFixture(unicode);
    const marketEvidence = marketBase.map((item, index) => (
      item.id === 'input:coverage'
        ? item
        : { ...item, id: `${item.type}:${index}:${unicode}` }
    ));
    const marketRequest = marketApi.buildMarketBriefingGroqRequest(context, marketEvidence);
    const marketPrompt = marketRequest.request.messages.find(({ role }) => role === 'user').content;
    const marketRecords = marketPrompt
      .split('BEGIN_UNTRUSTED_MARKET_DATA_JSONL\n')[1]
      .split('\nEND_UNTRUSTED_MARKET_DATA_JSONL')[0]
      .split('\n')
      .map((line) => JSON.parse(line));
    const marketSchemaIds = marketRequest.request.responseFormat.json_schema.schema
      .properties.paragraphs.items.properties.evidenceIds.items.enum;
    assert.deepEqual(marketRecords.map(({ evidenceId }) => evidenceId), marketSchemaIds);
    assert.ok(marketSchemaIds.includes('input:coverage'));
    const marketModelId = (type) => marketRecords.find((row) => row.recordType === type).evidenceId;
    const marketCompletion = marketApi.resolveMarketBriefingGroqCompletion({
      text: JSON.stringify({ paragraphs: [
        { id: 'market-tone', evidenceIds: [marketModelId('top_gainer'), marketModelId('top_loser')] },
        { id: 'themes-catalysts', evidenceIds: [marketModelId('headline'), marketModelId('headline_sentiment')] },
        { id: 'watchpoints', evidenceIds: ['input:coverage'] },
      ] }),
    }, marketRequest.aliasToEvidenceId);
    const marketResult = marketBriefing.validateMarketBriefingCompletion(
      marketCompletion,
      context,
      { evidence: marketEvidence, generationEvidence: marketRequest.generationEvidence },
    );
    assert.deepEqual(marketResult.evidence, marketEvidence);

    const smartBase = smartMoneyFixture(unicode);
    const smartEvidence = smartBase.map((item, index) => (
      item.id === 'capability:simulation'
        ? item
        : { ...item, id: `${item.type}:${index}:${unicode}` }
    ));
    const smartRequest = smartMoneyApi.buildSmartMoneyGroqRequest({
      snapshot: {},
      marketContext: context,
      evidence: smartEvidence,
      generationEvidence: smartEvidence,
    });
    const smartPrompt = smartRequest.request.messages.find(({ role }) => role === 'user').content;
    const smartRecords = smartPrompt
      .split('BEGIN_UNTRUSTED_SMART_MONEY_DATA_JSONL\n')[1]
      .split('\nEND_UNTRUSTED_SMART_MONEY_DATA_JSONL')[0]
      .split('\n')
      .map((line) => JSON.parse(line));
    const smartSchemaIds = smartRequest.request.responseFormat.json_schema.schema
      .properties.paragraphs.items.properties.evidenceIds.items.enum;
    assert.deepEqual(smartRecords.map(({ evidenceId }) => evidenceId), smartSchemaIds);
    assert.ok(smartSchemaIds.includes('capability:simulation'));
    const smartModelId = (type) => smartRecords.find((row) => row.recordType === type).evidenceId;
    const smartCompletion = smartMoneyApi.resolveSmartMoneyGroqCompletion({
      text: JSON.stringify({ paragraphs: [
        { id: 'market-regime', evidenceIds: [smartModelId('market_top_gainer')] },
        { id: 'investor-disclosures', evidenceIds: [smartModelId('investor_activity')] },
        { id: 'crypto-paper-risk', evidenceIds: [smartModelId('crypto_activity'), 'capability:simulation'] },
      ] }),
    }, smartRequest.aliasToEvidenceId);
    const smartResult = smartMoneyBriefing.validateSmartMoneyCompletion(smartCompletion, {
      snapshot: {},
      marketContext: context,
      evidence: smartEvidence,
      generationEvidence: smartRequest.generationEvidence,
      now: NOW,
    });
    assert.deepEqual(smartResult.evidence, smartEvidence);
  } finally {
    if (env === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = env;
  }
});

test('generated evidence aliases never collide with accepted short IDs', () => {
  const unicode = '🧿'.repeat(40);
  const { context, evidence } = marketFixture();
  const marketEvidence = evidence.map((item) => {
    if (item.type === 'top_gainer') return { ...item, id: 'm1' };
    if (item.type === 'top_loser') return { ...item, id: `${item.id}:${unicode}` };
    return item;
  });
  const marketRequest = marketApi.buildMarketBriefingGroqRequest(context, marketEvidence);
  const marketIds = marketRequest.request.responseFormat.json_schema.schema
    .properties.paragraphs.items.properties.evidenceIds.items.enum;
  assert.equal(new Set(marketIds).size, marketIds.length);
  assert.ok(marketIds.includes('m1'));
  assert.equal(marketRequest.aliasToEvidenceId.has('m1'), false);

  const smartEvidence = smartMoneyFixture().map((item) => {
    if (item.type === 'market_top_gainer') return { ...item, id: 's1' };
    if (item.type === 'investor_activity') return { ...item, id: `${item.id}:${unicode}` };
    return item;
  });
  const smartRequest = smartMoneyApi.buildSmartMoneyGroqRequest({
    snapshot: {}, marketContext: context, evidence: smartEvidence, generationEvidence: smartEvidence,
  });
  const smartIds = smartRequest.request.responseFormat.json_schema.schema
    .properties.paragraphs.items.properties.evidenceIds.items.enum;
  assert.equal(new Set(smartIds).size, smartIds.length);
  assert.ok(smartIds.includes('s1'));
  assert.equal(smartRequest.aliasToEvidenceId.has('s1'), false);
});

test('Groq rejects an over-budget request before making an upstream call', async () => {
  buildersAvailable();
  const env = process.env.GROQ_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('must not call provider');
  };
  try {
    await assert.rejects(
      groq.requestGroqCompletion({
        temperature: 0,
        maxCompletionTokens: 1_024,
        maxReservedTokens: LIMIT,
        messages: [{ role: 'user', content: '🧿'.repeat(2_000) }],
      }),
      (error) => error instanceof groq.GroqProviderError
        && error.code === 'provider_configuration_error',
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (env === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = env;
  }
});
