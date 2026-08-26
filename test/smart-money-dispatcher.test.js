import assert from 'node:assert/strict';
import test from 'node:test';

import { mockRequest } from './helpers/api.js';

const ROUTES = ['briefing', 'health', 'history', 'refresh'];

async function dispatcherModule() {
  return import('../api/smart-money/[route].js');
}

function requestFor(route, path = `/api/smart-money/${route}`) {
  return mockRequest(`${path}${path.includes('?') ? '&' : '?'}route=${encodeURIComponent(route)}`);
}

function echoHandlers() {
  return Object.fromEntries(ROUTES.map((route) => [
    route,
    async (req, res) => res.status(200).json({ route, query: req.query }),
  ]));
}

test('Smart Money dispatcher preserves every known public sub-route', async () => {
  const { createSmartMoneyRouteHandler } = await dispatcherModule();
  const handler = createSmartMoneyRouteHandler({ handlers: echoHandlers() });

  for (const route of ROUTES) {
    const { req, res } = requestFor(route);
    await handler(req, res);
    assert.equal(res.statusCode, 200, route);
    assert.deepEqual(res.body, { route, query: {} }, route);
  }
});

test('Smart Money dispatcher strips only the injected path parameter before delegation', async () => {
  const { createSmartMoneyRouteHandler } = await dispatcherModule();
  const handler = createSmartMoneyRouteHandler({ handlers: echoHandlers() });
  const { req, res } = requestFor(
    'history',
    '/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=1&limit=2',
  );

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    route: 'history',
    query: {
      since: '2026-08-25T00:00:00.000Z',
      limit: ['1', '2'],
    },
  });
  assert.deepEqual(req.query, {
    since: '2026-08-25T00:00:00.000Z',
    limit: ['1', '2'],
    route: 'history',
  });
});

test('Smart Money dispatcher preserves the request contract while replacing only query', async () => {
  const { createSmartMoneyRouteHandler } = await dispatcherModule();
  const body = { probe: true };
  const { req, res } = mockRequest('/api/smart-money/health?probe=1&route=health', {
    method: 'POST',
    headers: { 'x-probe': 'preserved' },
    authorization: 'Bearer preserved',
  });
  req.body = body;
  const handler = createSmartMoneyRouteHandler({
    handlers: {
      ...echoHandlers(),
      health: async (forwarded, response) => response.status(200).json({
        method: forwarded.method,
        url: forwarded.url,
        headers: forwarded.headers,
        bodyIdentityPreserved: forwarded.body === body,
        query: forwarded.query,
      }),
    },
  });

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    method: 'POST',
    url: '/api/smart-money/health?probe=1&route=health',
    headers: { 'x-probe': 'preserved', authorization: 'Bearer preserved' },
    bodyIdentityPreserved: true,
    query: { probe: '1' },
  });
});

test('Smart Money dispatcher rejects unknown path parameters without delegating', async () => {
  const { createSmartMoneyRouteHandler } = await dispatcherModule();
  let delegated = false;
  const handlers = Object.fromEntries(ROUTES.map((route) => [route, async () => { delegated = true; }]));
  const handler = createSmartMoneyRouteHandler({ handlers });
  const { req, res } = requestFor('unknown');

  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    ok: false,
    error: { code: 'smart_money_route_not_found', message: 'Smart Money route not found.' },
  });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(delegated, false);
});

test('Smart Money dispatcher rejects a duplicate injected path parameter', async () => {
  const { createSmartMoneyRouteHandler } = await dispatcherModule();
  let delegated = false;
  const handlers = Object.fromEntries(ROUTES.map((route) => [route, async () => { delegated = true; }]));
  const handler = createSmartMoneyRouteHandler({ handlers });

  const duplicate = mockRequest('/api/smart-money/health?route=health');
  duplicate.req.query.route = ['health', 'refresh'];
  await handler(duplicate.req, duplicate.res);
  assert.equal(duplicate.res.statusCode, 400);
  assert.equal(duplicate.res.body.error.code, 'invalid_route_parameter');
  assert.equal(delegated, false);
});

test('Smart Money dispatcher cannot be aliased by a client route query', async () => {
  const {
    createSmartMoneyHealthHandler,
    createSmartMoneyRefreshHandler,
    createSmartMoneyRouteHandler,
  } = await dispatcherModule();
  let healthReads = 0;
  let refreshes = 0;
  const handler = createSmartMoneyRouteHandler({
    handlers: {
      ...echoHandlers(),
      health: createSmartMoneyHealthHandler({
        readSnapshot: async () => { healthReads += 1; return null; },
      }),
      refresh: createSmartMoneyRefreshHandler({
        cronSecret: 'secret',
        refreshSmartMoney: async () => {
          refreshes += 1;
          return { persisted: true, providerStatuses: [], signalsAccepted: [], warnings: [] };
        },
      }),
    },
  });
  const collision = mockRequest('/api/smart-money/health?route=refresh', {
    authorization: 'Bearer secret',
  });

  await handler(collision.req, collision.res);

  assert.equal(collision.res.statusCode, 400);
  assert.equal(collision.res.body.error.code, 'invalid_route_parameter');
  assert.equal(healthReads, 0);
  assert.equal(refreshes, 0);
});

test('Smart Money dispatcher safely treats an indistinguishable same-value route query as metadata', async () => {
  const { createSmartMoneyRouteHandler } = await dispatcherModule();
  const handler = createSmartMoneyRouteHandler({ handlers: echoHandlers() });
  const { req, res } = mockRequest('/api/smart-money/health?route=health');

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { route: 'health', query: {} });
});
