import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildValidatedMarketContext,
  createMarketContextLoader,
  currentUtcMarketDate,
} from '../lib/briefing/market-context.js';

const NOW = '2026-08-27T00:05:00.000Z';

const PRICES = {
  ok: true,
  asOf: '2026-08-26T20:00:00.000Z',
  fetchedAt: '2026-08-26T20:01:00.000Z',
  commodities: [
    { ticker: 'NVDA', name: 'NVIDIA', category: 'Stocks', changePct: 4.2, stale: false, source: 'yahoo' },
    { ticker: 'WTI', name: 'WTI crude', category: 'Energy', changePct: -2.1, stale: false, source: 'alphavantage' },
    { ticker: 'FAKE', name: 'Fallback', category: 'Stocks', changePct: 99, stale: false, source: 'yahoo', mock: true },
  ],
};

const NEWS = {
  ok: true,
  fetchedAt: '2026-08-26T23:59:00.000Z',
  items: [{
    id: 'stocks-1', headline: 'Stocks rally after strong earnings beat',
    source: 'Example Wire', category: 'Stocks', ts: Date.parse('2026-08-26T23:30:00.000Z'),
    url: 'https://news.google.com/rss/articles/example',
  }],
};

const FEAR_GREED = {
  ok: true, value: 61, label: 'Greed', updatedAt: '2026-08-26T23:00:00.000Z',
};

test('market context uses the current UTC date while preserving evidence timestamps', async () => {
  const load = createMarketContextLoader({
    getPrices: async () => PRICES,
    getNews: async () => NEWS,
    getFearGreed: async () => FEAR_GREED,
    now: () => new Date(NOW),
  });

  const context = await load();

  assert.equal(currentUtcMarketDate(new Date(NOW)), '2026-08-27');
  assert.equal(context.marketDate, '2026-08-27');
  assert.equal(context.inputsAsOf.market, '2026-08-26T20:00:00.000Z');
  assert.equal(context.inputsAsOf.sentiment, '2026-08-26T23:30:00.000Z');
  assert.deepEqual(context.signals.gainers.map((row) => row.ticker), ['NVDA', 'WTI']);
  assert.deepEqual(context.signals.losers.map((row) => row.ticker), ['WTI', 'NVDA']);
  assert.equal(context.signals.gainers.some((row) => row.ticker === 'FAKE'), false);
  assert.deepEqual(context.upstream, {
    pricesReady: true,
    newsReady: true,
    trustedMoversReady: true,
    sentimentReady: true,
  });
  assert.equal(context.evidence.some((row) => row.id === 'sentiment:fear-greed'), true);
  const headline = context.evidence.find((row) => row.id === 'news:stocks-1');
  assert.equal(headline.sourceUrl, NEWS.items[0].url);
  assert.equal(headline.causalEligible, false);
});

test('market context degrades individual failed inputs without throwing or inventing freshness', async () => {
  const context = await createMarketContextLoader({
    getPrices: async () => { throw new Error('price secret must not escape'); },
    getNews: async () => NEWS,
    getFearGreed: async () => null,
    now: () => new Date(NOW),
  })();

  assert.equal(context.marketDate, '2026-08-27');
  assert.equal(context.upstream.pricesReady, false);
  assert.equal(context.upstream.newsReady, true);
  assert.equal(context.upstream.trustedMoversReady, false);
  assert.equal(context.upstream.sentimentReady, true);
  assert.deepEqual(context.signals.gainers, []);
  assert.equal(JSON.stringify(context).includes('price secret'), false);
});

test('currentUtcMarketDate rejects an invalid clock', () => {
  assert.throws(() => currentUtcMarketDate(new Date('invalid')), /invalid_market_clock/);
});

test('briefing context excludes headlines older than 72 hours', () => {
  const nowMs = Date.parse(NOW);
  const context = buildValidatedMarketContext({
    prices: PRICES,
    fearGreed: FEAR_GREED,
    now: new Date(NOW),
    news: {
      ok: true,
      fetchedAt: NOW,
      items: [
        {
          id: 'boundary', headline: 'Headline at freshness boundary', source: 'Wire',
          ts: nowMs - 72 * 60 * 60 * 1000, url: 'https://publisher.example/boundary',
        },
        {
          id: 'expired', headline: 'Headline beyond freshness boundary', source: 'Wire',
          ts: nowMs - 72 * 60 * 60 * 1000 - 1, url: 'https://publisher.example/expired',
        },
      ],
    },
  });

  assert.deepEqual(context.signals.headlines.map((item) => item.id), ['boundary']);
  assert.equal(context.evidence.some((item) => item.id === 'news:expired'), false);
});
