import assert from 'node:assert/strict';
import test from 'node:test';

import { createSmartMoneyRouteHandler } from '../api/smart-money/[route].js';
import { mockRequest } from './helpers/api.js';

test('unknown API paths return one non-cacheable JSON 404 contract', async () => {
  const handler = createSmartMoneyRouteHandler({ handlers: {} });

  for (const { path, method } of [
    { path: '/api/does-not-exist?private=value', method: 'GET' },
    { path: '/api/smart-money/briefing/extra', method: 'POST' },
  ]) {
    const { req, res } = mockRequest(path, { method });

    await handler(req, res);

    assert.equal(res.statusCode, 404, `${method} ${path}`);
    assert.deepEqual(res.body, {
      ok: false,
      error: { code: 'api_route_not_found', message: 'API route not found.' },
    });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});
