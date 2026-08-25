import assert from 'node:assert/strict';
import test from 'node:test';

import pricesHandler from '../api/prices.js';
import { SYMBOLS } from '../lib/symbols.js';

const NOW_SECONDS = Math.floor(Date.now() / 1000) - 60;
const TIMESTAMPS = [NOW_SECONDS - 3 * 86400, NOW_SECONDS - 2 * 86400, NOW_SECONDS - 86400, NOW_SECONDS];

function yahooSeries(yahoo) {
  const closes = yahoo === 'MRNA' ? [40, 41, null, 43] : [100, 101, null, 102];
  const last = closes.at(-1);
  return {
    meta: {
      currency: 'USD',
      symbol: yahoo,
      exchangeName: 'TEST',
      regularMarketTime: NOW_SECONDS,
      regularMarketPrice: last,
      regularMarketDayHigh: last + 1,
      regularMarketDayLow: last - 1,
      regularMarketVolume: 1234,
      chartPreviousClose: yahoo === 'MRNA' ? 15 : 50,
      fiftyTwoWeekHigh: last + 10,
      fiftyTwoWeekLow: last - 10,
    },
    timestamp: TIMESTAMPS,
    indicators: {
      quote: [{
        close: closes,
        high: closes.map((value) => value == null ? null : value + 1),
        low: closes.map((value) => value == null ? null : value - 1),
      }],
    },
  };
}

function yahooFetch({ failBatchContaining } = {}) {
  const calls = [];
  const fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);

    if (url.pathname === '/v7/finance/spark') {
      const symbols = (url.searchParams.get('symbols') || '').split(',').filter(Boolean);
      if (failBatchContaining && symbols.includes(failBatchContaining)) {
        return new Response('upstream unavailable', { status: 503 });
      }
      return Response.json({
        spark: {
          result: symbols.map((symbol) => ({ symbol, response: [yahooSeries(symbol)] })),
          error: null,
        },
      });
    }

    const marker = '/v8/finance/chart/';
    if (url.pathname.includes(marker)) {
      const symbol = decodeURIComponent(url.pathname.split(marker)[1]);
      if (failBatchContaining === symbol) {
        return new Response('upstream unavailable', { status: 503 });
      }
      return Response.json({ chart: { result: [yahooSeries(symbol)], error: null } });
    }

    throw new Error(`Unexpected Yahoo URL: ${url}`);
  };
  fetch.calls = calls;
  return fetch;
}

function createResponse() {
  return {
    body: null,
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function runPrices(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const response = createResponse();
    await pricesHandler({ method: 'GET' }, response);
    return response;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('non-GET prices requests return 405 before any Yahoo fanout', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('Yahoo must not be called');
  };

  try {
    const response = createResponse();
    await pricesHandler({ method: 'POST', query: {} }, response);

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.Allow, 'GET');
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(response.body, { ok: false, error: 'method not allowed' });
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('irrelevant prices query parameters are rejected before Yahoo fanout', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('Yahoo must not be called');
  };

  try {
    const response = createResponse();
    await pricesHandler({ method: 'GET', query: { _: 'cache-bust' } }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(response.body, { ok: false, error: 'unsupported query' });
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('daily change uses the final two valid closes, not Yahoo range-start metadata', async () => {
  const response = await runPrices(yahooFetch());
  const moderna = response.body.commodities.find((row) => row.ticker === 'MRNA');

  assert.equal(response.statusCode, 200);
  assert.equal(moderna.price, 43);
  assert.equal(moderna.prevClose, 41);
  assert.equal(moderna.changeAbs, 2);
  assert.equal(moderna.changePct, 4.88);
  assert.deepEqual(moderna.history.map((point) => point.price), [40, 41, 43]);
  assert.equal(moderna.source, 'yahoo');
  assert.equal(moderna.asOf, new Date(NOW_SECONDS * 1000).toISOString());
  assert.equal(moderna.stale, false);
});

test('all tracked symbols are fetched through Yahoo-supported multi-symbol spark batches', async () => {
  const fetchImpl = yahooFetch();
  const response = await runPrices(fetchImpl);

  assert.equal(response.body.commodities.length, SYMBOLS.length);
  assert.equal(fetchImpl.calls.length, Math.ceil(SYMBOLS.length / 20));
  assert.ok(fetchImpl.calls.every((url) => url.pathname === '/v7/finance/spark'));
  assert.ok(fetchImpl.calls.every((url) => url.searchParams.get('symbols').split(',').length <= 20));
});

test('a failed batch returns useful live rows plus explicit degraded metadata', async () => {
  const response = await runPrices(yahooFetch({ failBatchContaining: 'AAPL' }));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.partial, true);
  assert.equal(response.body.counts.requested, SYMBOLS.length);
  assert.ok(response.body.counts.received > 0);
  assert.ok(response.body.counts.failed > 0);
  assert.equal(response.body.counts.requested, response.body.counts.received + response.body.counts.failed);
  assert.ok(response.body.missingTickers.includes('AAPL'));
  assert.ok(response.body.errors.length > 0);
});

test('renamed and colliding assets request their current Yahoo Finance symbols', async () => {
  const fetchImpl = yahooFetch();
  await runPrices(fetchImpl);
  const requested = new Set(fetchImpl.calls.flatMap((url) => url.searchParams.get('symbols').split(',')));

  assert.ok(requested.has('XYZ'));
  assert.ok(requested.has('POL28321-USD'));
  assert.ok(requested.has('APT21794-USD'));
  assert.ok(requested.has('DX-Y.NYB'));
  assert.equal(requested.has('SQ'), false);
  assert.equal(requested.has('MATIC-USD'), false);
  assert.equal(requested.has('APT-USD'), false);
  assert.equal(requested.has('DX=F'), false);
});

test('Yahoo batch timeouts terminate and return explicit degraded metadata', async () => {
  const originalTimeout = process.env.MARKET_FETCH_TIMEOUT_MS;
  process.env.MARKET_FETCH_TIMEOUT_MS = '10';
  const fetchImpl = async (_url, options = {}) => {
    if (!options.signal) return new Response('missing abort signal', { status: 500 });
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    const response = await runPrices(fetchImpl);
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.partial, true);
    assert.equal(response.body.counts.received, 0);
    assert.equal(response.body.counts.failed, SYMBOLS.length);
    assert.ok(response.body.errors.some((error) => error.includes('timeout')));
  } finally {
    if (originalTimeout === undefined) delete process.env.MARKET_FETCH_TIMEOUT_MS;
    else process.env.MARKET_FETCH_TIMEOUT_MS = originalTimeout;
  }
});
