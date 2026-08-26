import assert from 'node:assert/strict';
import test from 'node:test';

import { GroqProviderError } from '../lib/groq.js';
import {
  MARKET_BRIEFING_PARAGRAPH_IDS,
  buildDeterministicMarketBriefing,
  buildMarketBriefingEvidence,
  digestMarketBriefingEvidence,
  validateMarketBriefingCompletion,
} from '../lib/briefing/market-briefing.js';

const DISCLAIMER = 'Informational only — not financial advice.';

function context(overrides = {}) {
  return {
    marketDate: '2030-08-12',
    signals: {
      gainers: [{ ticker: 'GAIN', name: 'Gainer', changePct: 4.2, source: 'yahoo' }],
      losers: [{ ticker: 'LOSS', name: 'Loser', changePct: -3.1, source: 'yahoo' }],
      headlines: [{
        id: 'wire-1',
        headline: 'Stocks rally while oil declines',
        source: 'Example Wire',
        publishedAt: '2030-08-12T11:55:00.000Z',
        sourceUrl: 'https://example.com/markets/wire-1',
      }],
      sentiment: {
        headline: { label: 'mixed', sampleSize: 1, updatedAt: '2030-08-12T11:55:00.000Z' },
        cryptoFearGreed: { value: 42, label: 'Fear', updatedAt: '2030-08-12T00:00:00.000Z' },
      },
      asOf: { market: '2030-08-12T11:59:00.000Z' },
    },
    evidence: [
      { id: 'market:gainer:GAIN', type: 'top_gainer', label: 'GAIN +4.20%', asOf: '2030-08-12T11:59:00.000Z', source: 'yahoo', sourceUrl: null, causalEligible: false },
      { id: 'market:loser:LOSS', type: 'top_loser', label: 'LOSS -3.10%', asOf: '2030-08-12T11:59:00.000Z', source: 'yahoo', sourceUrl: null, causalEligible: false },
      { id: 'news:wire-1', type: 'headline', label: 'Stocks rally while oil declines', asOf: '2030-08-12T11:55:00.000Z', source: 'Example Wire', sourceUrl: 'https://example.com/markets/wire-1', causalEligible: false },
      { id: 'sentiment:headlines', type: 'headline_sentiment', label: 'mixed headline tone (1 items)', asOf: '2030-08-12T11:55:00.000Z', source: 'Dashboard headline sample', sourceUrl: null, causalEligible: false },
      { id: 'sentiment:fear-greed', type: 'crypto_fear_greed', label: '42 · Fear', asOf: '2030-08-12T00:00:00.000Z', source: 'Alternative.me Fear & Greed', sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/', causalEligible: false },
    ],
    inputsAsOf: {
      market: '2030-08-12T11:59:00.000Z',
      marketFetchedAt: '2030-08-12T12:00:00.000Z',
      news: '2030-08-12T11:55:00.000Z',
      newsFetchedAt: '2030-08-12T12:00:00.000Z',
      sentiment: '2030-08-12T11:55:00.000Z',
    },
    upstream: {
      pricesReady: true,
      newsReady: true,
      trustedMoversReady: true,
      sentimentReady: true,
    },
    ...overrides,
  };
}

test('deterministic briefing always returns the exact three paragraph contract with resolved evidence', () => {
  const evidence = buildMarketBriefingEvidence(context());
  const result = buildDeterministicMarketBriefing(context(), {
    evidence,
    generatedAt: '2030-08-12T12:01:00.000Z',
  });

  assert.equal(result.source, 'deterministic');
  assert.equal(result.marketDate, '2030-08-12');
  assert.deepEqual(result.paragraphs.map((paragraph) => paragraph.id), MARKET_BRIEFING_PARAGRAPH_IDS);
  assert.equal(result.paragraphs.length, 3);
  assert.equal(result.text, result.paragraphs.map((paragraph) => paragraph.text).join('\n\n'));
  assert.ok(result.paragraphs[2].text.endsWith(DISCLAIMER));
  const evidenceIds = new Set(result.evidence.map((record) => record.id));
  assert.ok(result.paragraphs.flatMap((paragraph) => paragraph.evidenceIds).every((id) => evidenceIds.has(id)));
  assert.ok(result.evidence.find((record) => record.id === 'market:gainer:GAIN').sourceUrl.startsWith('https://finance.yahoo.com/quote/'));
  assert.doesNotMatch(result.text, /\b(?:because|caused?|drove|due to|triggered)\b/i);
});

test('deterministic briefing remains non-null when every upstream input is unavailable', () => {
  const empty = context({
    signals: {
      gainers: [], losers: [], headlines: [],
      sentiment: { headline: { label: 'unavailable', sampleSize: 0, updatedAt: null }, cryptoFearGreed: null },
      asOf: { market: null },
    },
    evidence: [],
    inputsAsOf: { market: null, marketFetchedAt: null, news: null, newsFetchedAt: null, sentiment: null },
    upstream: { pricesReady: false, newsReady: false, trustedMoversReady: false, sentimentReady: false },
  });

  const result = buildDeterministicMarketBriefing(empty, { generatedAt: '2030-08-12T12:01:00.000Z' });
  assert.equal(result.paragraphs.length, 3);
  assert.match(result.paragraphs[0].text, /unavailable/i);
  assert.match(result.paragraphs[1].text, /unavailable/i);
  assert.ok(result.paragraphs[2].text.endsWith(DISCLAIMER));
});

test('a single positive mover is not described as both market strength and weakness', () => {
  const oneSided = context({
    evidence: [
      { id: 'market:gainer:GAIN', type: 'top_gainer', label: 'GAIN +4.20%', asOf: '2030-08-12T11:59:00.000Z', source: 'yahoo', sourceUrl: null, causalEligible: false },
      { id: 'market:loser:GAIN', type: 'top_loser', label: 'GAIN +4.20%', asOf: '2030-08-12T11:59:00.000Z', source: 'yahoo', sourceUrl: null, causalEligible: false },
      ...context().evidence.filter((record) => record.type.includes('sentiment')),
    ],
  });

  const result = buildDeterministicMarketBriefing(oneSided);
  assert.doesNotMatch(result.paragraphs[0].text, /mixed/i);
  assert.equal(result.paragraphs[0].evidenceIds.length, 1);
  assert.match(result.paragraphs[0].text, /broader downside coverage is unavailable/i);
});

test('evidence digest changes with accepted evidence rather than generation time', () => {
  const original = context();
  const unchanged = context({
    inputsAsOf: {
      ...original.inputsAsOf,
      marketFetchedAt: '2030-08-12T12:05:00.000Z',
      newsFetchedAt: '2030-08-12T12:05:00.000Z',
    },
  });
  const changed = context({
    evidence: original.evidence.map((record) => (
      record.id === 'sentiment:fear-greed' ? { ...record, label: '25 · Extreme Fear' } : record
    )),
  });

  assert.equal(digestMarketBriefingEvidence(original), digestMarketBriefingEvidence(unchanged));
  assert.notEqual(digestMarketBriefingEvidence(original), digestMarketBriefingEvidence(changed));
});

test('generated completion requires exact IDs, resolved evidence, and non-causal language', () => {
  const marketContext = context();
  const completion = {
    model: 'test-model (Groq)',
    text: JSON.stringify({ paragraphs: [
      { id: 'market-tone', text: 'Accepted movers show gains and losses while the sentiment reading remains mixed.', evidenceIds: ['market:gainer:GAIN', 'market:loser:LOSS'] },
      { id: 'themes-catalysts', text: 'The accepted headline sample describes a rally alongside an oil decline.', evidenceIds: ['news:wire-1'] },
      { id: 'watchpoints', text: `The next update can show whether these observations persist. ${DISCLAIMER}`, evidenceIds: ['sentiment:fear-greed'] },
    ] }),
  };

  const result = validateMarketBriefingCompletion(completion, marketContext, {
    generatedAt: '2030-08-12T12:01:00.000Z',
  });
  assert.equal(result.source, 'generated');
  assert.deepEqual(result.paragraphs.map((paragraph) => paragraph.id), MARKET_BRIEFING_PARAGRAPH_IDS);
  assert.equal(result.evidence.length, 5);

  const causal = structuredClone(completion);
  const payload = JSON.parse(causal.text);
  payload.paragraphs[0].text = 'GAIN rose because the cited market observation drove a change in tone.';
  causal.text = JSON.stringify(payload);
  assert.throws(
    () => validateMarketBriefingCompletion(causal, marketContext),
    (error) => error instanceof GroqProviderError && error.code === 'provider_invalid_response',
  );
});
