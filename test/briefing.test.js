import assert from 'node:assert/strict';
import test from 'node:test';

import briefingHandler from '../api/briefing.js';

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

function createProviderFetch(supportedModel) {
  return async (url, options = {}) => {
    const target = String(url);

    if (target.endsWith('/api/prices')) {
      return jsonResponse({
        commodities: [
          { ticker: 'GAIN', name: 'Gainer', category: 'Stocks', changePct: 4.2 },
          { ticker: 'LOSS', name: 'Loser', category: 'Stocks', changePct: -3.1 },
        ],
      });
    }

    if (target.endsWith('/api/news')) {
      return jsonResponse({ items: [] });
    }

    if (target === 'https://api.groq.com/openai/v1/chat/completions') {
      const request = JSON.parse(options.body);
      if (request.model !== supportedModel) {
        return jsonResponse({
          error: {
            message: `The model ${request.model} does not exist`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        }, 404);
      }

      return jsonResponse({
        choices: [{ message: { content: 'Risk tone is mixed.\n\nCatalysts remain limited.\n\nWatch the next session. Informational only — not financial advice.' } }],
      });
    }

    throw new Error(`Unexpected fetch: ${target}`);
  };
}

test('generates a briefing with Groq\'s supported production replacement model', async () => {
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  delete process.env.GROQ_MODEL;

  globalThis.fetch = createProviderFetch('openai/gpt-oss-120b');

  try {
    const response = createResponse();
    await briefingHandler({ headers: { host: 'dashboard.test', 'x-forwarded-proto': 'https' } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.aiError, null);
    assert.equal(response.body.briefing?.model, 'openai/gpt-oss-120b (Groq)');
    assert.match(response.body.briefing?.text || '', /Informational only/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  }
});

test('uses the configured Groq model without a code change', async () => {
  const originalApiKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_MODEL;
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  process.env.GROQ_MODEL = 'custom/model-v2';
  globalThis.fetch = createProviderFetch('custom/model-v2');

  try {
    const response = createResponse();
    await briefingHandler({ headers: { host: 'dashboard.test', 'x-forwarded-proto': 'https' } }, response);

    assert.equal(response.body.aiError, null);
    assert.equal(response.body.briefing?.model, 'custom/model-v2 (Groq)');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  }
});
