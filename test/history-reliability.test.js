import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/history.js';
import { mockRequest } from './helpers/api.js';

test('history rejects inherited range names before any provider request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected fetch'); };
  try {
    for (const range of ['__proto__', 'constructor', 'toString']) {
      const { req, res } = mockRequest(`/api/history?ticker=NVDA&range=${range}`);
      await handler(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.headers['cache-control'], 'no-store');
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('one malformed provider point cannot poison otherwise usable history', async () => {
  const original = globalThis.fetch;
  const day = Date.parse('2026-09-01T12:00:00Z') / 1000;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ chart: { result: [{
      timestamp: [day, day + 86400, day + 172800, Number.MAX_VALUE, day + 259200],
      indicators: { quote: [{ close: [100, '101', NaN, 102, 103] }] },
    }] } }),
  });
  try {
    const { req, res } = mockRequest('/api/history?ticker=NVDA&range=1mo');
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.points, [{ date: '09-01', price: 100 }, { date: '09-04', price: 103 }]);
  } finally { globalThis.fetch = original; }
});
