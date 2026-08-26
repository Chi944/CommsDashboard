import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  compareInstitutionalHoldings,
  fetchInstitutionalDisclosure,
  fetchInstitutionalDisclosures,
  normalizeFundDisclosure,
  normalizeTreasuryDisclosure,
} from '../lib/smart-money/disclosures.js';

const FIXTURES = new URL('./fixtures/smart-money/disclosures/', import.meta.url);
const NOW = '2026-08-26T00:00:00.000Z';
const ALL_CONFIGS = [
  { id: 'institutional-strategy', entityId: 'strategy', rightsId: 'strategy-disclosures', cik: '1050446', kind: 'treasury' },
  { id: 'institutional-tesla', entityId: 'tesla', rightsId: 'tesla-disclosures', cik: '1318605', kind: 'treasury' },
  { id: 'institutional-ibit', entityId: 'blackrock-ibit', rightsId: 'ibit-disclosures', cik: '1980994', kind: 'fund' },
  { id: 'institutional-fbtc', entityId: 'fidelity-fbtc', rightsId: 'fbtc-disclosures', cik: '1852317', kind: 'fund' },
  { id: 'institutional-arkb', entityId: 'ark-21shares-arkb', rightsId: 'arkb-disclosures', cik: '1869699', kind: 'fund' },
  { id: 'institutional-bitb', entityId: 'bitwise-bitb', rightsId: 'bitb-disclosures', cik: '1763415', kind: 'fund' },
];

function fixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8'));
}

test('one failed ETF remains visible beside successful institutional adapters', async () => {
  const configs = ALL_CONFIGS.slice(2, 4);
  const result = await fetchInstitutionalDisclosures(configs, {
    fetchOne: async (config) => {
      if (config.id === 'institutional-fbtc') throw Object.assign(new Error('private details'), { code: 'timeout' });
      return { records: [{ entityId: config.entityId, amount: 1 }], retrievedAt: NOW };
    },
    now: () => new Date(NOW),
  });
  assert.equal(result.statuses.find((row) => row.id === 'institutional-fbtc').status, 'unavailable');
  assert.equal(result.statuses.find((row) => row.id === 'institutional-fbtc').errorCode, 'timeout');
  assert.equal(result.statuses.find((row) => row.id === 'institutional-ibit').status, 'live');
  assert.equal(result.records.length, 1);
});

test('a first disclosure and complete exit always qualify without claiming a trade', () => {
  assert.deepEqual(compareInstitutionalHoldings(null, { reportedValueUsd: 20_000_000 }), {
    classification: 'new', previous: null, current: { reportedValueUsd: 20_000_000 }, isTrade: false,
  });
  assert.deepEqual(compareInstitutionalHoldings({ reportedValueUsd: 20_000_000 }, null), {
    classification: 'exited', previous: { reportedValueUsd: 20_000_000 }, current: null, isTrade: false,
  });
  assert.equal(compareInstitutionalHoldings({ btcAmount: 1 }, { btcAmount: 2 }).classification, 'changed');
  assert.equal(Object.hasOwn(compareInstitutionalHoldings(
    { btcAmount: 1, filingBody: 'unbounded filing text' },
    { btcAmount: 2, filingBody: 'unbounded filing text' },
  ).current, 'filingBody'), false);
});

test('treasury disclosures retain only validated filing metrics and no raw filing body', () => {
  const record = normalizeTreasuryDisclosure(fixture('strategy'), ALL_CONFIGS[0], { now: () => new Date(NOW) });
  assert.deepEqual(record, {
    id: 'institutional-strategy:0001050446-26-000101:2026-06-30',
    providerId: 'institutional-strategy', entityId: 'strategy', vehicle: 'corporate_bitcoin_treasury',
    reportingDate: '2026-06-30', filedAt: '2026-08-05T00:00:00.000Z', btcAmount: 597325,
    reportedValueUsd: 64800000000,
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1050446/000105044626000101/strategy-20260630.htm',
    methodology: 'sec_filing_reported', sourceAsOf: '2026-06-30T00:00:00.000Z',
    retrievedAt: NOW, freshnessBasis: 'reporting_date', paperEligible: false,
  });
  assert.equal(Object.hasOwn(record, 'filingBody'), false);
  assert.equal(Object.hasOwn(record, 'wallet'), false);
});

test('fund disclosures retain holdings and reported value with exact SEC filing URLs', () => {
  const record = normalizeFundDisclosure(fixture('ibit'), ALL_CONFIGS[2], { now: () => new Date(NOW) });
  assert.equal(record.providerId, 'institutional-ibit');
  assert.equal(record.entityId, 'blackrock-ibit');
  assert.equal(record.vehicle, 'spot_bitcoin_etf');
  assert.equal(record.btcAmount, 738401);
  assert.equal(record.reportedValueUsd, 80800000000);
  assert.equal(record.sourceUrl, 'https://www.sec.gov/Archives/edgar/data/1980994/000198099426000044/ibit-20260630.htm');
});

test('six concrete adapters have independently stable records and statuses', async () => {
  const result = await fetchInstitutionalDisclosures(ALL_CONFIGS, {
    fetchRaw: async (config) => fixture(config.id.replace('institutional-', '')),
    now: () => new Date(NOW),
  });
  assert.deepEqual(result.statuses.map((row) => [row.id, row.status, row.recordCount]), [
    ['institutional-strategy', 'live', 1], ['institutional-tesla', 'live', 1],
    ['institutional-ibit', 'live', 1], ['institutional-fbtc', 'live', 1],
    ['institutional-arkb', 'live', 1], ['institutional-bitb', 'live', 1],
  ]);
  assert.equal(new Set(result.records.map((row) => row.id)).size, 6);
  assert.ok(result.records.every((row) => row.retrievedAt === NOW && row.sourceUrl.startsWith('https://www.sec.gov/')));
});

test('invalid dates, negative metrics, and wrong source origins are rejected', () => {
  const raw = fixture('tesla');
  for (const mutate of [
    (value) => { value.reportingDate = '2026-02-31'; },
    (value) => { value.btcAmount = -1; },
    (value) => { value.reportedValueUsd = -1; },
    (value) => { value.sourceUrl = 'https://evil.example/filing'; },
  ]) {
    const value = structuredClone(raw);
    mutate(value);
    assert.throws(() => normalizeTreasuryDisclosure(value, ALL_CONFIGS[1], { now: () => new Date(NOW) }), { code: 'schema_invalid' });
  }
});

test('BTC amounts may be fractional but never unsafe or negative', () => {
  const fractional = fixture('ibit');
  fractional.btcAmount = 738401.125;
  assert.equal(normalizeFundDisclosure(fractional, ALL_CONFIGS[2], { now: () => new Date(NOW) }).btcAmount, 738401.125);

  const unsafe = fixture('ibit');
  unsafe.btcAmount = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => normalizeFundDisclosure(unsafe, ALL_CONFIGS[2], { now: () => new Date(NOW) }), { code: 'schema_invalid' });
});

test('fulfilled empty results are typed empty_dataset and raw failure detail never leaks', async () => {
  const result = await fetchInstitutionalDisclosures(ALL_CONFIGS.slice(0, 2), {
    fetchOne: async (config) => {
      if (config.id === 'institutional-strategy') return { records: [], retrievedAt: NOW };
      throw new Error('raw filing body: secret');
    },
    now: () => new Date(NOW),
  });
  assert.deepEqual(result.statuses.map((row) => [row.status, row.errorCode]), [
    ['unavailable', 'empty_dataset'], ['unavailable', 'provider_unavailable'],
  ]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('a concrete adapter rejects mismatched entity, CIK, and rights bindings before retrieval', async () => {
  let called = false;
  await assert.rejects(fetchInstitutionalDisclosure({ ...ALL_CONFIGS[0], entityId: 'tesla' }, {
    fetchRaw: async () => { called = true; return fixture('strategy'); },
  }), { code: 'configuration_missing' });
  await assert.rejects(fetchInstitutionalDisclosure({ ...ALL_CONFIGS[0], cik: '1318605' }, {
    fetchRaw: async () => { called = true; return fixture('strategy'); },
  }), { code: 'configuration_missing' });
  await assert.rejects(fetchInstitutionalDisclosure({ ...ALL_CONFIGS[0], rightsId: 'tesla-disclosures' }, {
    fetchRaw: async () => { called = true; return fixture('strategy'); },
  }), { code: 'configuration_missing' });
  assert.equal(called, false);
});
