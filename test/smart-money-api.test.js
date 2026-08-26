import assert from 'node:assert/strict';
import test from 'node:test';

import { createSmartMoneyHandler } from '../api/smart-money.js';
import { createSmartMoneyHealthHandler } from '../api/smart-money/health.js';
import { createSmartMoneyHistoryHandler } from '../api/smart-money/history.js';
import { createSmartMoneyRefreshHandler } from '../api/smart-money/refresh.js';
import { buildSmartMoneyHealth } from '../lib/smart-money/health.js';
import { buildSmartMoneyPrivateSnapshot } from '../lib/smart-money/refresh.js';
import { SOURCE_RIGHTS } from '../lib/smart-money/rights.js';
import { mockRequest } from './helpers/api.js';
import {
  ACCEPTED_HISTORY,
  ACCEPTED_SNAPSHOT,
  ENABLED_ADAPTER_IDS,
  createRefreshDeps,
} from './fixtures/smart-money/scenarios.js';

const PUBLIC_SNAPSHOT_FIELDS = [
  'schemaVersion', 'ok', 'fetchedAt', 'partial', 'entities', 'activities',
  'performances', 'signals', 'rankings', 'providerStatuses', 'warnings', 'sourceLinks',
];

function acceptedStoredSnapshot() {
  return structuredClone(createRefreshDeps({ signals: [] }).previous);
}

function storedWithStatuses(statuses) {
  const stored = acceptedStoredSnapshot();
  stored.publicSnapshot.providerStatuses = structuredClone(statuses);
  stored.adapterState.adapters.forEach((row, index) => { row.status = structuredClone(statuses[index]); });
  return buildSmartMoneyPrivateSnapshot({
    refreshStartedAt: stored.refreshStartedAt,
    publicSnapshot: stored.publicSnapshot,
    adapterState: stored.adapterState,
  }, { now: new Date('2026-08-28T12:00:00.000Z') });
}

function enabledStatuses() {
  return ENABLED_ADAPTER_IDS.map((id, index) => ({
    id,
    group: id === 'sec-edgar' ? 'sec' : 'institutional',
    enabled: true,
    status: index === 2 ? 'stale' : index === 3 ? 'unavailable' : 'live',
    lastAttemptAt: '2026-08-26T11:00:00.000Z',
    lastSuccessAt: index === 3 ? null : '2026-08-26T11:00:00.000Z',
    sourceAsOf: null,
    retrievedAt: '2026-08-26T11:00:00.000Z',
    freshnessBasis: 'retrieval_time',
    recordCount: 1,
    cacheAgeSeconds: 0,
    errorCode: index === 3 ? 'timeout' : null,
  }));
}

test('public refresh=1 only rereads accepted data and uses no-store', async () => {
  let reads = 0;
  let refreshes = 0;
  const handler = createSmartMoneyHandler({
    readSnapshot: async () => { reads += 1; return acceptedStoredSnapshot(); },
    refreshSmartMoney: async () => { refreshes += 1; },
  });
  const { req, res } = mockRequest('/api/smart-money?refresh=1');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(reads, 1);
  assert.equal(refreshes, 0);
  assert.match(res.headers['Cache-Control'], /no-store/);
});

test('public snapshot returns exactly the sanitized accepted envelope', async () => {
  const handler = createSmartMoneyHandler({ readSnapshot: async () => acceptedStoredSnapshot() });
  const { req, res } = mockRequest('/api/smart-money');
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body), PUBLIC_SNAPSHOT_FIELDS);
  assert.deepEqual(res.body.performances, ACCEPTED_SNAPSHOT.performances);
  assert.equal(JSON.stringify(res.body).includes('adapterState'), false);
  assert.equal(JSON.stringify(res.body).includes('pendingConfirmations'), false);
  assert.match(res.headers['Cache-Control'], /s-maxage/);
});

test('public snapshot rejects unsupported query keys, duplicate refresh, and non-GET methods', async () => {
  let reads = 0;
  const handler = createSmartMoneyHandler({ readSnapshot: async () => { reads += 1; return acceptedStoredSnapshot(); } });
  for (const path of [
    '/api/smart-money?secret=x',
    '/api/smart-money?refresh=0',
    '/api/smart-money?refresh=1&other=x',
    '/api/smart-money?refresh=1&refresh=1',
  ]) {
    const { req, res } = mockRequest(path);
    await handler(req, res);
    assert.equal(res.statusCode, 400, path);
    assert.equal(res.body.error.code, 'invalid_query_parameters');
    assert.match(res.headers['Cache-Control'], /no-store/);
  }
  const { req, res } = mockRequest('/api/smart-money', { method: 'POST' });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.equal(reads, 0);
});

test('public snapshot storage failures return only a fixed sanitized error', async () => {
  const handler = createSmartMoneyHandler({
    readSnapshot: async () => { throw new Error('https://blob.invalid/?token=raw-secret'); },
  });
  const { req, res } = mockRequest('/api/smart-money');
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    error: { code: 'smart_money_unavailable', message: 'Smart Money data is temporarily unavailable.' },
  });
  assert.equal(JSON.stringify(res.body).includes('raw-secret'), false);
  assert.match(res.headers['Cache-Control'], /no-store/);
});

test('public snapshot rejects corrupt private wrappers without exposing their contents', async () => {
  const handler = createSmartMoneyHandler({
    readSnapshot: async () => ({
      schemaVersion: 1,
      refreshStartedAt: '2026-08-26T10:59:00.000Z',
      publicSnapshot: structuredClone(ACCEPTED_SNAPSHOT),
      adapterState: {
        schemaVersion: 1,
        adapters: [],
        pendingConfirmations: [],
        rawBody: 'private provider response',
        secret: 'never-public',
      },
    }),
  });
  const { req, res } = mockRequest('/api/smart-money');
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.stringify(res.body).includes('private provider response'), false);
  assert.equal(res.body.error.code, 'smart_money_unavailable');
});

test('history forwards inclusive since, bounded limit, and opaque cursor and returns the exact master envelope', async () => {
  let query;
  const handler = createSmartMoneyHistoryHandler({
    now: () => new Date('2026-08-28T12:00:00.000Z'),
    readJournal: async (input) => { query = input; return structuredClone(ACCEPTED_HISTORY); },
  });
  const cursor = Buffer.from(JSON.stringify({
    observedAt: '2026-08-26T11:00:00.000Z', id: ACCEPTED_SNAPSHOT.signals[0].id,
  }), 'utf8').toString('base64url');
  const { req, res } = mockRequest(`/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=200&cursor=${cursor}`);
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(query, {
    since: '2026-08-25T00:00:00.000Z', limit: 200, cursor,
  });
  assert.deepEqual(Object.keys(res.body), Object.keys(ACCEPTED_HISTORY));
  assert.deepEqual(res.body.dailyMarks, ACCEPTED_HISTORY.dailyMarks);
  assert.equal(res.body.nextCursor, null);
});

test('history enforces required canonical since, limit 1-500, 400 days, and strict query keys', async () => {
  let reads = 0;
  const handler = createSmartMoneyHistoryHandler({
    now: () => new Date('2026-08-28T12:00:00.000Z'),
    readJournal: async () => { reads += 1; return structuredClone(ACCEPTED_HISTORY); },
  });
  const invalid = [
    '/api/smart-money/history?limit=1',
    '/api/smart-money/history?since=not-a-date&limit=1',
    '/api/smart-money/history?since=2026-08-25T00%3A00%3A00Z&limit=1',
    '/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=0',
    '/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=501',
    '/api/smart-money/history?since=2025-07-24T11%3A59%3A59.999Z&limit=1',
    '/api/smart-money/history?since=2026-08-29T00%3A00%3A00.000Z&limit=1',
    '/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=1&secret=x',
    '/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=1&limit=2',
    '/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=1&cursor=not-opaque',
    `/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=1&cursor=${Buffer.from(JSON.stringify({ observedAt: '2026-08-26T11:00:00.000Z', id: 'bad\u0000id' })).toString('base64url')}`,
  ];
  for (const path of invalid) {
    const { req, res } = mockRequest(path);
    await handler(req, res);
    assert.equal(res.statusCode, 400, path);
    assert.equal(res.body.error.code, 'invalid_query_parameters');
  }
  const { req, res } = mockRequest('/api/smart-money/history?since=2026-08-25T00%3A00%3A00.000Z&limit=1', { method: 'DELETE' });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
  assert.equal(reads, 0);
});

test('protected refresh requires exact Bearer authorization and forbids query secrets', async () => {
  let refreshes = 0;
  const handler = createSmartMoneyRefreshHandler({
    cronSecret: 'secret',
    refreshSmartMoney: async () => { refreshes += 1; return { persisted: true, signalsAccepted: [], providerStatuses: [], warnings: [], errorCode: null }; },
  });
  for (const [path, authorization] of [
    ['/api/smart-money/refresh?secret=secret', undefined],
    ['/api/smart-money/refresh?token=secret', 'Bearer secret'],
    ['/api/smart-money/refresh', undefined],
    ['/api/smart-money/refresh', 'secret'],
    ['/api/smart-money/refresh', 'bearer secret'],
    ['/api/smart-money/refresh', 'Bearer secret '],
    ['/api/smart-money/refresh', 'Bearer wrong'],
  ]) {
    const { req, res } = mockRequest(path, { authorization });
    await handler(req, res);
    assert.equal(res.statusCode, path.includes('?') && authorization === 'Bearer secret' ? 400 : 401, `${path} ${authorization}`);
    assert.match(res.headers['Cache-Control'], /no-store/);
  }
  assert.equal(refreshes, 0);
});

test('protected refresh rejects missing server configuration without invoking maintenance', async () => {
  let refreshes = 0;
  const handler = createSmartMoneyRefreshHandler({
    cronSecret: '',
    refreshSmartMoney: async () => { refreshes += 1; },
  });
  const { req, res } = mockRequest('/api/smart-money/refresh', { authorization: 'Bearer anything' });
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'refresh_configuration_invalid');
  assert.equal(refreshes, 0);
});

test('protected refresh permits only authenticated GET and advertises only GET', async () => {
  let refreshes = 0;
  const handler = createSmartMoneyRefreshHandler({
    cronSecret: 'secret',
    refreshSmartMoney: async () => {
      refreshes += 1;
      return { persisted: true, signalsAccepted: [], providerStatuses: [], warnings: [], errorCode: null };
    },
  });
  const accepted = mockRequest('/api/smart-money/refresh', { method: 'GET', authorization: 'Bearer secret' });
  await handler(accepted.req, accepted.res);
  assert.equal(accepted.res.statusCode, 200);
  for (const method of ['POST', 'PUT']) {
    const rejected = mockRequest('/api/smart-money/refresh', { method, authorization: 'Bearer secret' });
    await handler(rejected.req, rejected.res);
    assert.equal(rejected.res.statusCode, 405);
    assert.equal(rejected.res.headers.Allow, 'GET');
  }
  assert.equal(refreshes, 1);
});

test('protected refresh returns 503 for either journal or snapshot nondurability', async () => {
  for (const errorCode of ['journal_persistence_failed', 'snapshot_persistence_failed']) {
    const handler = createSmartMoneyRefreshHandler({
      cronSecret: 'secret',
      refreshSmartMoney: async () => ({
        persisted: false, signalsAccepted: [], providerStatuses: [], warnings: [], errorCode,
      }),
    });
    const { req, res } = mockRequest('/api/smart-money/refresh', { authorization: 'Bearer secret' });
    await handler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.errorCode, errorCode);
    assert.deepEqual(res.body.signalsAccepted, []);
  }
});

test('protected refresh sanitizes thrown failures', async () => {
  const handler = createSmartMoneyRefreshHandler({
    cronSecret: 'secret',
    refreshSmartMoney: async () => { throw new Error('https://provider.invalid/?token=raw-secret'); },
  });
  const { req, res } = mockRequest('/api/smart-money/refresh', { authorization: 'Bearer secret' });
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    ok: false,
    error: { code: 'refresh_failed', message: 'Smart Money refresh failed.' },
  });
  assert.equal(JSON.stringify(res.body).includes('raw-secret'), false);
});

test('health exposes exact enabled children, deterministic rollups, deployment, rights, and configuration', () => {
  const snapshot = storedWithStatuses(enabledStatuses());
  const health = buildSmartMoneyHealth({
    snapshot,
    adapters: ENABLED_ADAPTER_IDS.map((id) => ({ id })),
    rights: SOURCE_RIGHTS,
    rightsValid: true,
    storageDiagnostics: {
      blob: true, redis: true, blobError: null, redisError: null, selectedSource: 'blob',
    },
    deploymentCommit: 'abc123',
    deploymentEnvironment: 'production',
    groqConfigured: false,
    secUserAgent: 'CommsDashboard/1.0 placeholder@example.com',
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  assert.equal(health.deployment.commitSha, 'abc123');
  assert.equal(health.deployment.environment, 'production');
  assert.equal(health.configuration.secUserAgent, 'invalid');
  assert.equal(health.configuration.groq, 'missing_optional');
  assert.equal(health.configuration.rights, 'configured');
  assert.equal(health.configuration.storage, 'ready');
  assert.deepEqual(health.providerStatuses.map((row) => row.id), ENABLED_ADAPTER_IDS);
  assert.ok(health.providerStatuses.every((row) => row.enabled === true));
  assert.ok(health.providerStatuses.every((row) => row.retrievedAt === '2026-08-26T11:00:00.000Z'));
  assert.ok(health.providerStatuses.every((row) => row.freshnessBasis === 'retrieval_time'));
  assert.ok(health.providerStatuses.every((row) => Number.isInteger(row.cacheAgeSeconds)));
  assert.deepEqual(health.providerStatuses.map((row) => row.state), [
    'fresh', 'fresh', 'fresh', 'unavailable', 'fresh', 'fresh', 'fresh',
  ]);
  assert.deepEqual(health.providerRollups.map((row) => row.id), ['sec', 'institutional', 'all-enabled']);
  assert.equal(health.providerRollups.find((row) => row.id === 'institutional').state, 'unavailable');
  assert.equal(health.rights.policyRecords.find((row) => row.id === 'polymarket-data-api').decision, 'link-only');
  assert.equal(health.rights.policyRecords.find((row) => row.id === 'hyperliquid-stats-api').decision, 'link-only');
  assert.equal(health.ok, false);
});

test('health distinguishes never-run and optional Groq never degrades provider state', () => {
  const health = buildSmartMoneyHealth({
    snapshot: null,
    adapters: ENABLED_ADAPTER_IDS.map((id) => ({ id })),
    rights: SOURCE_RIGHTS,
    rightsValid: true,
    storageDiagnostics: { blob: true, redis: true, blobError: null, redisError: null, selectedSource: null },
    deploymentCommit: null,
    deploymentEnvironment: 'preview',
    groqConfigured: false,
    secUserAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  assert.ok(health.providerStatuses.every((row) => row.state === 'never-run'));
  assert.equal(health.configuration.groq, 'missing_optional');
  assert.equal(health.providerRollups.find((row) => row.id === 'all-enabled').state, 'never-run');
});

test('health recomputes stored live children as stale against the wall clock', () => {
  const stored = acceptedStoredSnapshot();
  stored.publicSnapshot.providerStatuses = enabledStatuses().map((status) => ({
    ...status,
    status: 'live',
    lastAttemptAt: '2026-08-26T11:00:00.000Z',
    lastSuccessAt: '2026-08-26T11:00:00.000Z',
    retrievedAt: '2026-08-26T11:00:00.000Z',
    recordCount: 1,
    errorCode: null,
  }));
  stored.adapterState.adapters.forEach((row, index) => {
    row.status = structuredClone(stored.publicSnapshot.providerStatuses[index]);
  });
  const rebound = buildSmartMoneyPrivateSnapshot({
    refreshStartedAt: stored.refreshStartedAt,
    publicSnapshot: stored.publicSnapshot,
    adapterState: stored.adapterState,
  }, { now: new Date('2026-08-28T12:00:00.000Z') });
  const health = buildSmartMoneyHealth({
    snapshot: rebound,
    adapters: ENABLED_ADAPTER_IDS.map((id) => ({ id })),
    rights: SOURCE_RIGHTS,
    rightsValid: true,
    storageDiagnostics: { blob: true, redis: true, blobError: null, redisError: null },
    secUserAgent: 'CommsDashboard ops@company.com',
    now: new Date('2026-08-28T12:00:00.000Z'),
  });
  assert.ok(health.providerStatuses.every((status) => status.state === 'stale'));
  assert.equal(health.providerRollups.find((row) => row.id === 'all-enabled').state, 'stale');
});

test('health distinguishes a missing SEC User-Agent from an invalid configured contact', () => {
  const health = buildSmartMoneyHealth({
    snapshot: null,
    adapters: ENABLED_ADAPTER_IDS.map((id) => ({ id })),
    rights: SOURCE_RIGHTS,
    rightsValid: true,
    storageDiagnostics: { blob: true, redis: true, blobError: null, redisError: null, selectedSource: null },
    deploymentCommit: null,
    deploymentEnvironment: 'preview',
    groqConfigured: false,
    secUserAgent: undefined,
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  assert.equal(health.configuration.secUserAgent, 'missing');
});

test('health route reads accepted state with diagnostics and never leaks storage details', async () => {
  const handler = createSmartMoneyHealthHandler({
    readSnapshot: async () => ({
      snapshot: acceptedStoredSnapshot(),
      diagnostics: {
        blob: true, redis: true, selectedSource: 'blob',
        blobError: 'https://blob.invalid/?token=raw-secret', redisError: null,
      },
    }),
    buildHealth: (input) => ({ ok: false, storage: input.storageDiagnostics }),
  });
  const { req, res } = mockRequest('/api/smart-money/health');
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.stringify(res.body).includes('raw-secret'), false);
  assert.match(res.headers['Cache-Control'], /no-store/);

  const unsupported = mockRequest('/api/smart-money/health?refresh=1');
  await handler(unsupported.req, unsupported.res);
  assert.equal(unsupported.res.statusCode, 400);
});

test('health route preserves allowlisted provider error codes but strips raw error detail', async () => {
  const handler = createSmartMoneyHealthHandler({
    readSnapshot: async () => ({ snapshot: null, diagnostics: {} }),
    buildHealth: () => ({
      ok: false,
      providerStatuses: [{ id: 'sec-edgar', errorCode: 'timeout', errorDetail: 'raw-secret' }],
    }),
  });
  const { req, res } = mockRequest('/api/smart-money/health');
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.providerStatuses[0].errorCode, 'timeout');
  assert.equal(Object.hasOwn(res.body.providerStatuses[0], 'errorDetail'), false);
  assert.equal(JSON.stringify(res.body).includes('raw-secret'), false);
});

test('health maps unknown internal provider error codes to one fixed safe code', async () => {
  const handler = createSmartMoneyHealthHandler({
    readSnapshot: async () => ({ snapshot: null, diagnostics: {} }),
    buildHealth: () => ({
      ok: false,
      providerStatuses: [{ id: 'sec-edgar', errorCode: 'database_password_leaked' }],
    }),
  });
  const { req, res } = mockRequest('/api/smart-money/health');
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.providerStatuses[0].errorCode, 'provider_unavailable');
  assert.equal(JSON.stringify(res.body).includes('database_password_leaked'), false);
});

test('health keeps exact seven canonical children when the rights review is expired', async () => {
  const handler = createSmartMoneyHealthHandler({
    readSnapshot: async () => ({
      snapshot: null,
      diagnostics: { blob: true, redis: true, blobError: null, redisError: null },
    }),
    now: () => new Date('2027-03-01T00:00:00.000Z'),
    secUserAgent: 'CommsDashboard ops@company.com',
  });
  const { req, res } = mockRequest('/api/smart-money/health');
  await handler(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.configuration.rights, 'invalid');
  assert.deepEqual(res.body.providerStatuses.map((row) => row.id), ENABLED_ADAPTER_IDS);
  assert.ok(res.body.providerStatuses.every((row) => row.state === 'never-run'));
});
