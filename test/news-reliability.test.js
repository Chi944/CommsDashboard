import assert from 'node:assert/strict';
import test from 'node:test';

import newsHandler from '../api/news.js';
import assetNewsHandler from '../api/asset-news.js';
import historyHandler from '../api/history.js';
import fearGreedHandler from '../api/fear-greed.js';

function responseRecorder() {
  return {
    body: null,
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function rss(items) {
  return `<?xml version="1.0"?><rss><channel>${items.map((item) => `
    <item>
      <title>${item.title}</title>
      <link>${item.url}</link>
      <pubDate>${item.pubDate}</pubDate>
      <description>${item.description || ''}</description>
      <source>${item.source || 'Example Wire'}</source>
    </item>`).join('')}</channel></rss>`;
}

test('public market GET routes reject unsupported methods before upstream access', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('upstream must not be called');
  };

  try {
    const cases = [
      [newsHandler, {}],
      [fearGreedHandler, {}],
      [historyHandler, { ticker: 'NVDA', range: '1mo' }],
      [assetNewsHandler, { q: 'Nvidia', limit: '6' }],
    ];
    for (const method of ['POST', 'PUT']) {
      for (const [handler, query] of cases) {
        const response = responseRecorder();
        await handler({ method, query }, response);
        assert.equal(response.statusCode, 405);
        assert.equal(response.headers.Allow, 'GET');
        assert.equal(response.headers['Cache-Control'], 'no-store');
        assert.deepEqual(response.body, { ok: false, error: 'method not allowed' });
      }
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public market GET routes reject unsupported query keys before upstream access', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('upstream must not be called');
  };

  try {
    const cases = [
      [newsHandler, { cacheBust: '1' }],
      [fearGreedHandler, { cacheBust: '1' }],
      [historyHandler, { ticker: 'NVDA', range: '1mo', cacheBust: '1' }],
      [assetNewsHandler, { q: 'Nvidia', limit: '6', cacheBust: '1' }],
    ];
    for (const [handler, query] of cases) {
      const response = responseRecorder();
      await handler({ method: 'GET', query }, response);
      assert.equal(response.statusCode, 400);
      assert.equal(response.headers['Cache-Control'], 'no-store');
      assert.deepEqual(response.body, { ok: false, error: 'unsupported query' });
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('asset news rejects malformed limits instead of returning a successful empty feed', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('upstream must not be called');
  };

  try {
    const invalidQueries = [
      { q: 'Nvidia', limit: 'abc' },
      { q: 'Nvidia', limit: '0' },
      { q: 'Nvidia', limit: '13' },
      { q: 'Nvidia', limit: ['6', '7'] },
      { q: ['Nvidia', 'Apple'], limit: '6' },
      { q: ' ', limit: '6' },
      { q: 'x'.repeat(161), limit: '6' },
    ];
    for (const query of invalidQueries) {
      const response = responseRecorder();
      await assetNewsHandler({ method: 'GET', query }, response);
      assert.equal(response.statusCode, 400);
      assert.equal(response.headers['Cache-Control'], 'no-store');
      assert.deepEqual(response.body, { ok: false, error: 'invalid query' });
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('history rejects duplicate scalar parameters before upstream access', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    throw new Error('upstream must not be called');
  };

  try {
    for (const query of [
      { ticker: ['NVDA', 'AAPL'], range: '1mo' },
      { ticker: 'NVDA', range: ['1mo', '3mo'] },
    ]) {
      const response = responseRecorder();
      await historyHandler({ method: 'GET', query }, response);
      assert.equal(response.statusCode, 400);
      assert.equal(response.headers['Cache-Control'], 'no-store');
      assert.deepEqual(response.body, { ok: false, error: 'invalid query' });
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('general news excludes articles older than seven days and reports publication freshness separately', async () => {
  const originalFetch = globalThis.fetch;
  const startedAt = Date.now();
  const freshPublishedAt = new Date(startedAt - 60 * 60 * 1000).toUTCString();
  const stalePublishedAt = new Date(startedAt - 8 * 24 * 60 * 60 * 1000).toUTCString();
  const xml = rss([
    { title: 'Fresh market update', url: 'https://publisher.example/fresh', pubDate: freshPublishedAt },
    { title: 'Old market update', url: 'https://publisher.example/old', pubDate: stalePublishedAt },
    { title: 'Undated market update', url: 'https://publisher.example/undated', pubDate: 'not-a-date' },
  ]);
  globalThis.fetch = async () => new Response(xml, { status: 200 });

  try {
    const response = responseRecorder();
    await newsHandler({ method: 'GET', query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.items.map((item) => item.headline), ['Fresh market update']);
    assert.equal(response.body.freshness.isFresh, true);
    assert.equal(response.body.freshness.maxAgeHours, 168);
    assert.equal(response.body.freshness.newestPublishedAt, new Date(freshPublishedAt).toISOString());
    assert.equal(response.body.freshness.oldestPublishedAt, new Date(freshPublishedAt).toISOString());
    assert.ok(response.body.freshness.ageMs >= 60 * 60 * 1000);
    assert.notEqual(response.body.freshness.newestPublishedAt, response.body.fetchedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('general news gives every upstream request an abort deadline', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.MARKET_FETCH_TIMEOUT_MS;
  process.env.MARKET_FETCH_TIMEOUT_MS = '10';
  let boundedCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.signal) throw new Error('unbounded request secret');
    boundedCalls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    const response = responseRecorder();
    await newsHandler({ method: 'GET', query: {} }, response);

    assert.equal(boundedCalls, 10);
    assert.equal(response.statusCode, 502);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.MARKET_FETCH_TIMEOUT_MS;
    else process.env.MARKET_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

test('general news does not expose unexpected internal error details', async () => {
  const originalNow = Date.now;
  Date.now = () => { throw new Error('raw internal news secret'); };

  try {
    const response = responseRecorder();
    await newsHandler({ method: 'GET', query: {} }, response);

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { ok: false, error: 'news service unavailable' });
    assert.equal(JSON.stringify(response.body).includes('raw internal news secret'), false);
  } finally {
    Date.now = originalNow;
  }
});

test('asset news gives its upstream request an abort deadline', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.MARKET_FETCH_TIMEOUT_MS;
  process.env.MARKET_FETCH_TIMEOUT_MS = '10';
  let boundedCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.signal) throw new Error('unbounded request secret');
    boundedCalls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    const response = responseRecorder();
    await assetNewsHandler({ method: 'GET', query: { q: 'Nvidia' } }, response);

    assert.equal(boundedCalls, 1);
    assert.equal(response.statusCode, 502);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.MARKET_FETCH_TIMEOUT_MS;
    else process.env.MARKET_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

test('asset news excludes articles older than seven days', async () => {
  const originalFetch = globalThis.fetch;
  const startedAt = Date.now();
  const xml = rss([
    {
      title: 'Fresh Nvidia update',
      url: 'https://publisher.example/nvidia-fresh',
      pubDate: new Date(startedAt - 60 * 60 * 1000).toUTCString(),
    },
    {
      title: 'Old Nvidia update',
      url: 'https://publisher.example/nvidia-old',
      pubDate: new Date(startedAt - 8 * 24 * 60 * 60 * 1000).toUTCString(),
    },
  ]);
  globalThis.fetch = async () => new Response(xml, { status: 200 });

  try {
    const response = responseRecorder();
    await assetNewsHandler({ method: 'GET', query: { q: 'Nvidia', limit: '6' } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.items.map((item) => item.headline), ['Fresh Nvidia update']);
    assert.equal(response.body.freshness.maxAgeHours, 168);
    assert.equal(response.body.asOf, response.body.freshness.newestPublishedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('price history bounds upstream failure behind a safe 502 response', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.MARKET_FETCH_TIMEOUT_MS;
  process.env.MARKET_FETCH_TIMEOUT_MS = '10';
  let boundedCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.signal) throw new Error('raw history provider secret');
    boundedCalls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('raw history provider secret');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    const response = responseRecorder();
    await historyHandler({ method: 'GET', query: { ticker: 'NVDA', range: '1mo' } }, response);

    assert.equal(boundedCalls, 1);
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, { ok: false, error: 'history upstream unavailable' });
    assert.equal(JSON.stringify(response.body).includes('raw history provider secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.MARKET_FETCH_TIMEOUT_MS;
    else process.env.MARKET_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

test('fear and greed bounds upstream failure behind a safe 502 response', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.MARKET_FETCH_TIMEOUT_MS;
  process.env.MARKET_FETCH_TIMEOUT_MS = '10';
  let boundedCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.signal) throw new Error('raw sentiment provider secret');
    boundedCalls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('raw sentiment provider secret');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };

  try {
    const response = responseRecorder();
    await fearGreedHandler({ method: 'GET', query: {} }, response);

    assert.equal(boundedCalls, 1);
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, { ok: false, error: 'fear and greed upstream unavailable' });
    assert.equal(JSON.stringify(response.body).includes('raw sentiment provider secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.MARKET_FETCH_TIMEOUT_MS;
    else process.env.MARKET_FETCH_TIMEOUT_MS = originalTimeout;
  }
});
