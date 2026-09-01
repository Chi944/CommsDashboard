import assert from 'node:assert/strict';
import test from 'node:test';

import { mockRequest } from './helpers/api.js';

async function apiFallbackModule() {
  try {
    return await import('../api/not-found.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
}

test('unknown API paths return one non-cacheable JSON 404 contract', async () => {
  const module = await apiFallbackModule();
  assert.equal(
    typeof module?.default,
    'function',
    'an API fallback handler must exist before the SPA fallback',
  );

  for (const { path, method } of [
    { path: '/api/does-not-exist?private=value', method: 'GET' },
    { path: '/api/smart-money/briefing/extra', method: 'POST' },
  ]) {
    const { req, res } = mockRequest(path, { method });

    await module.default(req, res);

    assert.equal(res.statusCode, 404, `${method} ${path}`);
    assert.deepEqual(res.body, {
      ok: false,
      error: { code: 'api_route_not_found', message: 'API route not found.' },
    });
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});
