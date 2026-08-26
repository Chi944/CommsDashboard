import assert from 'node:assert/strict';
import test from 'node:test';

import { listEntities } from '../lib/smart-money/entities.js';
import { normalizeHyperliquidLeaderboard } from '../lib/smart-money/hyperliquid.js';
import {
  PROVIDER_FRESHNESS_POLICIES,
  classifyProviderFreshness,
  dedupeByStableId,
  getProviderFreshnessPolicy,
  isProviderRefreshDue,
  normalizeActivity,
  normalizeAdapterSnapshot,
  normalizeEntity,
  normalizePerformance,
  normalizeProviderStatus,
  validateAcceptedSnapshot,
} from '../lib/smart-money/normalize.js';
import { ACCEPTED_SNAPSHOT, DEPS_WITH_ONE_TIMEOUT } from './fixtures/smart-money/scenarios.js';

const NOW = new Date('2026-08-26T12:00:00.000Z');
const BASE_PERFORMANCE = {
  id: 'hyperliquid:0xabc:month:2026-08-26', entityId: 'hyperliquid:0xabc',
  providerId: 'hyperliquid-leaderboard', venue: 'hyperliquid', scope: 'account',
  accountValueUsd: 1_500_000,
  windows: {
    day: null,
    month: { pnlUsd: 20_000, roiPct: 4, volumeUsd: 6_000_000 },
    allTime: { pnlUsd: 100_000, roiPct: 20, volumeUsd: 20_000_000 },
  },
  methodology: 'provider_reported', sourceAsOf: null,
  retrievedAt: '2026-08-26T11:00:00.000Z', freshnessBasis: 'retrieval_time',
  notComparableAcrossProviders: true,
};

const BASE_ACTIVITY = {
  id: 'activity:sec:1', entityId: 'situational-awareness-lp', providerId: 'sec-edgar',
  kind: 'filing', sourceStableId: '0002045724-26-000001',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/2045724/000204572426000001/index.json',
  publisher: 'SEC EDGAR', sourceGrade: 'official_filing', identityConfidence: 'high',
  asset: null, direction: null, magnitude: null,
  effectiveAt: '2026-06-30T00:00:00.000Z', disclosedAt: '2026-08-14T00:00:00.000Z',
  observedAt: '2026-08-26T10:00:00.000Z', retrievedAt: '2026-08-26T10:00:00.000Z',
  delaySeconds: 3_888_000, summary: 'A new official filing was observed.', caveats: ['Delayed disclosure.'], freshness: 'fresh',
};

function statusAt(ageMs, overrides = {}) {
  const timestamp = new Date(NOW.getTime() - ageMs).toISOString();
  return {
    id: 'polymarket-leaderboard', group: 'polymarket', enabled: true, status: 'live',
    lastAttemptAt: timestamp, lastSuccessAt: timestamp, sourceAsOf: null,
    retrievedAt: timestamp, freshnessBasis: 'retrieval_time', recordCount: 1,
    cacheAgeSeconds: Math.floor(ageMs / 1000), errorCode: null, ...overrides,
  };
}

test('Task 1 entities normalize to the exact schemaVersion 1 directory shape', () => {
  const normalized = normalizeEntity(listEntities()[0], { now: NOW });
  assert.deepEqual(Object.keys(normalized), [
    'id', 'displayName', 'legalEntity', 'actorType', 'directoryCategory', 'strategyTags',
    'people', 'relatedEntityIds', 'officialUrls', 'identity', 'evidenceCoverage',
    'performanceVerification', 'lastCheckedAt', 'caveats',
  ]);
  assert.equal(normalized.identity.status, 'verified');
  assert.equal(normalized.identity.verifiedAt, '2026-08-26T00:00:00.000Z');
  assert.deepEqual(normalized.evidenceCoverage, ['official-profile-link-only']);
  assert.equal(Object.hasOwn(normalized, 'followed'), false);
});

test('dynamic venue entities must use crypto-traders and canonical provider scope', () => {
  const venue = normalizeEntity({
    id: 'hyperliquid:0xabc', displayName: '0xabc', legalEntity: null,
    actorType: 'venue_account', directoryCategory: 'crypto-traders', strategyTags: ['crypto'],
    people: [], relatedEntityIds: [], officialUrls: ['https://app.hyperliquid.xyz/explorer/address/0xabc'],
    identity: { status: 'anonymous', confidence: 'high', provider: 'hyperliquid', verifiedAt: '2026-08-26T11:00:00.000Z' },
    evidenceCoverage: ['hyperliquid-leaderboard'], performanceVerification: { status: 'provider_reported' },
    lastCheckedAt: '2026-08-26T11:00:00.000Z', caveats: ['Provider-reported performance.'],
  }, { now: NOW });
  assert.equal(venue.directoryCategory, 'crypto-traders');
  assert.throws(() => normalizeEntity({ ...venue, directoryCategory: 'investors' }, { now: NOW }), /schema_invalid/);
});

test('public validators reject unknown fields, prototypes, accessors, symbols, and future skew', () => {
  const entity = normalizeEntity(listEntities()[0], { now: NOW });
  assert.throws(() => normalizeEntity({ ...entity, followed: true }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizeEntity(Object.assign(Object.create({ followed: true }), entity), { now: NOW }), /schema_invalid/);
  const accessor = { ...entity };
  Object.defineProperty(accessor, 'displayName', { enumerable: true, get: () => 'unsafe' });
  assert.throws(() => normalizeEntity(accessor, { now: NOW }), /schema_invalid/);
  const symbol = { ...entity, [Symbol('unsafe')]: true };
  assert.throws(() => normalizeEntity(symbol, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizeEntity({
    ...entity, lastCheckedAt: '2026-08-26T12:05:00.001Z',
  }, { now: NOW }), /schema_invalid/);
});

test('performance remains provider, venue, account, and window scoped without merging P&L', () => {
  const normalized = normalizePerformance(BASE_PERFORMANCE, { now: NOW });
  assert.deepEqual(normalized, BASE_PERFORMANCE);
  assert.notEqual(normalized, BASE_PERFORMANCE);
  assert.notEqual(normalized.windows, BASE_PERFORMANCE.windows);
  assert.equal(normalized.notComparableAcrossProviders, true);
  assert.throws(() => normalizePerformance({ ...BASE_PERFORMANCE, providerId: 'polymarket-leaderboard' }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizePerformance({ ...BASE_PERFORMANCE, entityId: 'polymarket:0xabc' }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizePerformance({ ...BASE_PERFORMANCE, windows: { ...BASE_PERFORMANCE.windows, month: { ...BASE_PERFORMANCE.windows.month, roiPct: Infinity } } }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizePerformance({ ...BASE_PERFORMANCE, accountValueUsd: Number.NaN }, { now: NOW }), /schema_invalid/);
});

test('activity validation binds provider, entity, asset fields, and exact public fields', () => {
  assert.deepEqual(normalizeActivity(BASE_ACTIVITY, { now: NOW }), BASE_ACTIVITY);
  assert.throws(() => normalizeActivity({ ...BASE_ACTIVITY, entityId: 'hyperliquid:0xabc' }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizeActivity({ ...BASE_ACTIVITY, rawFiling: 'unsafe' }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizeActivity({ ...BASE_ACTIVITY, kind: 'trade' }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizeActivity({ ...BASE_ACTIVITY, delaySeconds: 1 }, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizeActivity({ ...BASE_ACTIVITY, retrievedAt: '2026-08-26T09:59:59.999Z' }, { now: NOW }), /schema_invalid/);
});

test('freshness group mapping recognizes every configured provider family', () => {
  assert.equal(getProviderFreshnessPolicy('polymarket-leaderboard'), PROVIDER_FRESHNESS_POLICIES.polymarket);
  assert.equal(getProviderFreshnessPolicy('hyperliquid-account-details'), PROVIDER_FRESHNESS_POLICIES.hyperliquid);
  for (const id of ['sec-edgar', 'official-publication-oaktree', 'institutional-strategy', 'institutional-tesla', 'institutional-ibit', 'institutional-fbtc', 'institutional-arkb', 'institutional-bitb']) {
    assert.equal(getProviderFreshnessPolicy(id), PROVIDER_FRESHNESS_POLICIES.official);
  }
  for (const id of ['leopold-official', 'berkshire-letters', 'pershing-performance', 'fundsmith-documents', 'oaktree-insights', 'ark-publications']) {
    assert.equal(getProviderFreshnessPolicy(id), PROVIDER_FRESHNESS_POLICIES.official);
  }
  assert.equal(getProviderFreshnessPolicy('unknown-provider'), null);
});

test('cache TTL controls due fetch and stale threshold alone controls live versus stale', () => {
  for (const policy of Object.values(PROVIDER_FRESHNESS_POLICIES)) {
    assert.equal(isProviderRefreshDue(statusAt(policy.cacheTtlMs - 1), policy, NOW), false);
    assert.equal(isProviderRefreshDue(statusAt(policy.cacheTtlMs), policy, NOW), true);
    assert.equal(classifyProviderFreshness(statusAt(policy.staleAfterMs - 1), policy, NOW), 'live');
    assert.equal(classifyProviderFreshness(statusAt(policy.staleAfterMs), policy, NOW), 'stale');
  }
  assert.equal(PROVIDER_FRESHNESS_POLICIES.polymarket.cacheTtlMs, 600_000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.polymarket.staleAfterMs, 1_800_000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.hyperliquid.cacheTtlMs, 3_600_000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.hyperliquid.staleAfterMs, 7_200_000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.official.cacheTtlMs, 43_200_000);
  assert.equal(PROVIDER_FRESHNESS_POLICIES.official.staleAfterMs, 129_600_000);
});

test('provider statuses reject invalid enums, future timestamps, and recompute freshness without mutating input', () => {
  const input = statusAt(1_800_000, { status: 'live' });
  const normalized = normalizeProviderStatus(input, PROVIDER_FRESHNESS_POLICIES.polymarket, { now: NOW });
  assert.equal(normalized.status, 'stale');
  assert.equal(input.status, 'live');
  assert.throws(() => normalizeProviderStatus({ ...input, status: 'degraded' }, PROVIDER_FRESHNESS_POLICIES.polymarket, { now: NOW }), /schema_invalid/);
  assert.throws(() => normalizeProviderStatus({ ...input, retrievedAt: '2026-08-26T12:05:00.001Z' }, PROVIDER_FRESHNESS_POLICIES.polymarket, { now: NOW }), /schema_invalid/);
});

test('deduplication is stable, rejects duplicate IDs, and never mutates records', () => {
  const records = [{ id: 'b', value: 2 }, { id: 'a', value: 1 }];
  const before = structuredClone(records);
  assert.deepEqual(dedupeByStableId(records), records);
  assert.deepEqual(records, before);
  assert.throws(() => dedupeByStableId([{ id: 'a' }, { id: 'a' }]), /duplicate_id/);
  assert.throws(() => dedupeByStableId([{ id: '__proto__' }]), /schema_invalid/);
});

test('adapter snapshot publishes separate canonical arrays and rejects duplicate or mismatched records', () => {
  const entity = normalizeEntity(listEntities()[1], { now: NOW });
  const input = {
    entities: [entity], activities: [BASE_ACTIVITY], performances: [BASE_PERFORMANCE],
    providerStatuses: [statusAt(1_000)],
  };
  const result = normalizeAdapterSnapshot(input, { now: NOW });
  assert.deepEqual(Object.keys(result), ['entities', 'activities', 'performances', 'providerStatuses']);
  assert.equal(result.performances.length, 1);
  assert.equal(Object.hasOwn(result.activities[0], 'windows'), false);
  assert.throws(() => normalizeAdapterSnapshot({ ...input, activities: [BASE_ACTIVITY, { ...BASE_ACTIVITY }] }, { now: NOW }), /duplicate_id/);
});

test('Task 4 venue envelopes create anonymous crypto-trader entities and strip adapter-only ranking fields', () => {
  const [performance] = normalizeHyperliquidLeaderboard([{
    address: '0x0000000000000000000000000000000000000def', accountValue: 1_500_000,
    rank: 1, pnl: 20_000, roi: 4, volume: 6_000_000,
  }], { window: 'month', retrievedAt: '2026-08-26T11:00:00.000Z' });
  const normalized = normalizeAdapterSnapshot({
    providerId: 'hyperliquid-leaderboard', performances: [performance],
    accounts: [], portfolios: [], fills: [], linkOnly: false,
  }, { now: NOW, entities: listEntities() });
  assert.equal(normalized.entities[0].directoryCategory, 'crypto-traders');
  assert.equal(normalized.entities[0].identity.status, 'anonymous');
  assert.equal(Object.hasOwn(normalized.performances[0], 'wallet'), false);
  assert.equal(Object.hasOwn(normalized.performances[0], 'rank'), false);
  assert.equal(normalized.providerStatuses[0].status, 'live');
});

test('dormant link-only venue envelopes normalize as unavailable without claiming live data', () => {
  const normalized = normalizeAdapterSnapshot({
    providerId: 'polymarket-leaderboard', performances: [], positions: [], closedPositions: [], linkOnly: true,
  }, { now: NOW, entities: listEntities() });
  assert.deepEqual(normalized.performances, []);
  assert.equal(normalized.providerStatuses[0].status, 'unavailable');
  assert.equal(normalized.providerStatuses[0].errorCode, 'rights_gate_failed');
});

test('Task 5 institutional envelopes become filing observations bound to canonical entities', () => {
  const record = {
    id: 'institutional-ibit:0001980994-26-000044:2026-06-30', providerId: 'institutional-ibit',
    entityId: 'blackrock-ibit', vehicle: 'spot_bitcoin_etf', reportingDate: '2026-06-30',
    filedAt: '2026-08-05T00:00:00.000Z', btcAmount: 738_401, reportedValueUsd: 80_800_000_000,
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1980994/000198099426000044/ibit-20260630.htm',
    methodology: 'sec_filing_reported', sourceAsOf: '2026-06-30T00:00:00.000Z',
    retrievedAt: '2026-08-26T11:00:00.000Z', freshnessBasis: 'reporting_date', paperEligible: false,
  };
  const normalized = normalizeAdapterSnapshot({
    records: [record], statuses: [{
      id: 'institutional-ibit', group: 'institutional', status: 'live', recordCount: 1,
      retrievedAt: '2026-08-26T11:00:00.000Z',
    }],
  }, { now: NOW, entities: listEntities() });
  assert.equal(normalized.entities[0].id, 'blackrock-ibit');
  assert.equal(normalized.activities[0].kind, 'filing');
  assert.equal(normalized.activities[0].asset.ticker, 'BTC');
  assert.equal(normalized.activities[0].direction, null);
  assert.equal(normalized.activities[0].summary.includes('trade'), false);
});

test('timeout scenario uses all six canonical institutional IDs and valid successful records', async () => {
  assert.deepEqual(DEPS_WITH_ONE_TIMEOUT.adapters.map((adapter) => adapter.id), [
    'institutional-strategy', 'institutional-tesla', 'institutional-ibit',
    'institutional-fbtc', 'institutional-arkb', 'institutional-bitb',
  ]);
  const settled = await Promise.allSettled(DEPS_WITH_ONE_TIMEOUT.adapters.map((adapter) => adapter.fetch()));
  assert.equal(settled[3].status, 'rejected');
  assert.equal(settled[3].reason.code, 'timeout');
  for (const [index, result] of settled.entries()) {
    if (index === 3) continue;
    assert.equal(result.status, 'fulfilled');
    assert.equal(result.value.records.length, 1);
    assert.equal(result.value.records[0].providerId, DEPS_WITH_ONE_TIMEOUT.adapters[index].id);
    assert.equal(result.value.records[0].methodology, 'sec_filing_reported');
  }
});

test('Task 3 SEC and publication envelopes preserve disclosure timing without inventing trades', () => {
  const sec = normalizeAdapterSnapshot({
    filings: [{
      cik: '2045724', form: '13F-HR', accessionNumber: '0002045724-26-000001',
      periodEnd: '2026-06-30', filedAt: '2026-08-14T00:00:00.000Z', isAmendment: false,
      amendmentChain: ['0002045724-26-000001'], primaryDocument: 'primary.xml',
    }],
    disclosures: [], holdings: [],
  }, { providerId: 'sec-edgar', entityId: 'situational-awareness-lp', retrievedAt: '2026-08-26T11:00:00.000Z', now: NOW, entities: listEntities() });
  assert.equal(sec.activities[0].effectiveAt, '2026-06-30T00:00:00.000Z');
  assert.equal(sec.activities[0].disclosedAt, '2026-08-14T00:00:00.000Z');
  assert.ok(sec.activities[0].delaySeconds > 0);

  const publication = normalizeAdapterSnapshot({ publications: [{
    id: 'publication:abcdef', title: 'Official memo', canonicalUrl: 'https://publisher.example/memo',
    officialPublisher: 'Official Publisher', publishedAt: '2026-08-26T10:00:00.000Z',
    metadataHash: 'abcdef', dashboardSummary: 'An official memo was published.',
  }], linkOnly: false }, {
    providerId: 'oaktree-insights', entityId: 'oaktree-capital',
    retrievedAt: '2026-08-26T11:00:00.000Z', now: NOW, entities: listEntities(),
  });
  assert.equal(publication.activities[0].kind, 'statement');
  assert.equal(publication.activities[0].summary, 'An official memo was published.');
});

test('accepted snapshot and ranking envelopes enforce the exact schemaVersion 1 public shape', () => {
  assert.deepEqual(validateAcceptedSnapshot(ACCEPTED_SNAPSHOT, { now: NOW }), ACCEPTED_SNAPSHOT);
  assert.equal(ACCEPTED_SNAPSHOT.providerStatuses[0].status, 'unavailable');
  assert.match(ACCEPTED_SNAPSHOT.warnings[0], /fixture-only future-permitted/i);
  assert.throws(() => validateAcceptedSnapshot({ ...ACCEPTED_SNAPSHOT, adapterState: {} }, { now: NOW }), /schema_invalid/);
  assert.throws(() => validateAcceptedSnapshot({
    ...ACCEPTED_SNAPSHOT,
    rankings: { ...ACCEPTED_SNAPSHOT.rankings, crypto: { ...ACCEPTED_SNAPSHOT.rankings.crypto, combined: [] } },
  }, { now: NOW }), /schema_invalid/);
  assert.throws(() => validateAcceptedSnapshot({ ...ACCEPTED_SNAPSHOT, signals: [{ id: 'duplicate' }, { id: 'duplicate' }] }, { now: NOW }), /schema_invalid/);
  assert.throws(() => validateAcceptedSnapshot({
    ...ACCEPTED_SNAPSHOT,
    activities: [{ ...ACCEPTED_SNAPSHOT.activities[0], entityId: 'hyperliquid:0x0000000000000000000000000000000000000aaa' }],
  }, { now: NOW }), /schema_invalid/);
});
