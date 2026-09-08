import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchStockResearchRun, stockResearchSummary, STOCK_RESEARCH_RUN_URL } from '../src/lib/stockResearch.js';

const now = Date.parse('2026-09-08T12:00:00Z');
const run = () => ({
  schema_version: '2.0.0', run_id: 'run_2026-09-04',
  built_at: '2026-09-08T12:00:00Z', run_at: '2026-09-08T11:00:00Z', run_age_days: 0,
  stale_after_days: 8, universe_size: 967, passed: 1,
  candidates: [{ ticker: 'NVDA', excluded: false }, { ticker: 'AMD', excluded: true }],
});

test('weekly summary derives coverage and data age without trusting build time or filing counts', () => {
  assert.deepEqual(stockResearchSummary(run(), now), {
    asOf: '2026-09-04', ageDays: 4, stale: false, screened: 2, passed: 1,
  });
  assert.equal(stockResearchSummary(run(), now + 4 * 86400000).stale, true);
  assert.equal(stockResearchSummary({ ...run(), run_id: 'run_2026-08-01', stale_after_days: 999 }, now).stale, true);
});

test('weekly summary rejects incompatible, future, impossible, duplicated and inconsistent evidence', () => {
  for (const change of [
    { schema_version: '3.0.0' }, { run_id: 'run_2026-09-09' }, { run_id: 'run_2026-02-30' },
    { passed: 2 }, { candidates: [null] }, { stale_after_days: 0 },
    { candidates: [{ ticker: 'NVDA', excluded: false }, { ticker: 'NVDA', excluded: true }] },
  ]) assert.throws(() => stockResearchSummary({ ...run(), ...change }, now));
});

test('optional weekly fetch reads only the public equity snapshot without credentials', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return Response.json(run());
  };
  try {
    await fetchStockResearchRun(controller.signal);
    assert.equal(call.url, STOCK_RESEARCH_RUN_URL);
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.signal, controller.signal);
    assert.equal(call.options.redirect, 'error');
  } finally { globalThis.fetch = original; }
});

test('optional weekly fetch rejects oversized bodies, HTML fallbacks and invalid schemas', async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
      new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
      Response.json({ schema_version: '0' }),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(fetchStockResearchRun());
    }
  } finally { globalThis.fetch = original; }
});
