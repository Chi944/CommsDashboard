import assert from 'node:assert/strict';
import test from 'node:test';

import analysisHandler from '../api/analysis.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function createResponse() {
  return {
    body: null,
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('generates per-asset analysis with Groq\'s supported production replacement model', async () => {
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  delete process.env.GROQ_MODEL;

  const closes = Array.from({ length: 70 }, (_, index) => 100 + index);
  const timestamps = Array.from({ length: 70 }, (_, index) => 1_700_000_000 + index * 86_400);

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);

    if (target.startsWith('https://query1.finance.yahoo.com/')) {
      return jsonResponse({
        chart: {
          result: [{
            timestamp: timestamps,
            indicators: {
              quote: [{
                close: closes,
                high: closes.map((value) => value + 1),
                low: closes.map((value) => value - 1),
              }],
            },
            meta: { fiftyTwoWeekHigh: 180, fiftyTwoWeekLow: 90 },
          }],
          error: null,
        },
      });
    }

    if (target.startsWith('https://news.google.com/rss/search')) {
      return new Response('<?xml version="1.0"?><rss><channel></channel></rss>', { status: 200 });
    }

    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      const request = JSON.parse(options.body);
      if (request.model !== 'openai/gpt-oss-120b') {
        return jsonResponse({
          error: {
            message: `The model ${request.model} does not exist`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        }, 404);
      }

      return jsonResponse({
        choices: [{ message: { content: [
          'TREND: Momentum is constructive.',
          'CATALYSTS: No notable headline catalysts in the recent set.',
          'RISKS: The asset is extended within its annual range.',
          'OUTLOOK: Constructive with caution. Informational only — not financial advice.',
        ].join('\n') } }],
      });
    }

    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = createResponse();
    await analysisHandler({ query: { ticker: 'NVDA' } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.aiError, null);
    assert.equal(response.body.ai?.model, 'openai/gpt-oss-120b (Groq)');
    assert.equal(response.body.ai?.trend, 'Momentum is constructive.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  }
});
