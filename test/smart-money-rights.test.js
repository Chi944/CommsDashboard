import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAdapterRights,
  canUseSourceFor,
  SOURCE_RIGHTS,
  validateRightsMatrix,
} from '../lib/smart-money/rights.js';

test('rights validation rejects unclear public-display permission', () => {
  const matrix = [{
    id: 'source-a',
    checkedAt: '2026-08-26',
    reviewDueAt: '2027-02-26',
    decision: 'enable',
    permissions: {
      serverRetrieval: 'allowed',
      temporaryCaching: 'allowed',
      durableHistoricalCaching: 'allowed',
      publicDisplay: 'unclear',
      derivedMetrics: 'allowed',
      attribution: 'allowed',
    },
  }];
  const result = validateRightsMatrix(matrix, { now: new Date('2026-08-26T00:00:00Z') });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /publicDisplay/);
});

test('rights validation rejects omitted permissions, invalid dates, and paid access', () => {
  const result = validateRightsMatrix([{
    id: 'unsafe-source',
    provider: 'Unsafe',
    endpoint: 'https://example.invalid/data',
    fieldsUsed: ['id'],
    termsUrl: 'https://example.invalid/terms',
    evidenceUrls: ['https://example.invalid/pricing'],
    attribution: 'required',
    retention: 'unspecified',
    checkedAt: 'not-a-date',
    reviewDueAt: 'also-not-a-date',
    decision: 'enable',
    permissions: { publicDisplay: 'allowed' },
    cost: { tier: 'paid', paidCredentialRequired: true },
  }], { now: new Date('2026-08-26T00:00:00Z') });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /invalid_review_dates/);
  assert.match(result.errors.join('\n'), /serverRetrieval/);
  assert.match(result.errors.join('\n'), /not_verified_free/);
});

test('rights validation rejects a non-calendar review date', () => {
  const result = validateRightsMatrix([{
    id: 'bad-calendar-date',
    provider: 'Test',
    endpoint: 'https://example.com/data',
    fieldsUsed: ['id'],
    termsUrl: 'https://example.com/terms',
    evidenceUrls: ['https://example.com/terms'],
    attribution: 'required',
    retention: 'none',
    checkedAt: '2026-02-31',
    reviewDueAt: '2026-08-31',
    decision: 'link-only',
    permissions: {
      serverRetrieval: 'prohibited', temporaryCaching: 'prohibited',
      durableHistoricalCaching: 'prohibited', publicDisplay: 'allowed',
      derivedMetrics: 'prohibited', attribution: 'allowed',
    },
    cost: { tier: 'free', paidCredentialRequired: false, evidenceUrl: 'https://example.com/terms' },
  }], { now: new Date('2026-08-26T00:00:00Z') });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /invalid_review_dates/);
});

test('enabled sources require meaningful provider, attribution, and retention metadata', () => {
  const invalidMetadata = [
    ['provider', '   '],
    ['attribution', '   '],
    ['retention', {}],
    ['attribution', 'unclear'],
    ['retention', 'unknown'],
  ];
  for (const [field, value] of invalidMetadata) {
    const record = structuredClone(SOURCE_RIGHTS[0]);
    record[field] = value;
    const result = validateRightsMatrix([record], { now: new Date('2026-08-26T00:00:00Z') });
    assert.equal(result.ok, false, `${field}=${String(value)}`);
    assert.match(result.errors.join('\n'), new RegExp(`invalid_${field}`));
  }
});

test('link-only sources cannot feed rankings or paper signals', () => {
  assert.equal(canUseSourceFor('oaktree-insights', 'ranking'), false);
  assert.equal(canUseSourceFor('oaktree-insights', 'paper'), false);
});

test('Yahoo spark is explicitly excluded from Smart Money retrieval, history, display, and paper use', () => {
  const record = SOURCE_RIGHTS.find((row) => row.id === 'yahoo-finance-spark');
  assert.ok(record);
  assert.equal(record.decision, 'exclude');
  for (const purpose of ['fetch', 'cache', 'history', 'display', 'ranking', 'paper']) {
    assert.equal(canUseSourceFor(record.id, purpose), false, purpose);
  }
});

test('rights assertion rejects an adapter with an unknown rights record', () => {
  assert.throws(
    () => assertAdapterRights([{ id: 'unknown-adapter', rightsId: 'missing', requiredPurposes: ['fetch'] }]),
    /smart_money_source_not_permitted:unknown-adapter/,
  );
});
