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
      return {
        providerId: config.id,
        records: [normalizeFundDisclosure(fixture('ibit'), ALL_CONFIGS[2], { now: () => new Date(NOW) })],
        retrievedAt: NOW,
      };
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
      if (config.id === 'institutional-strategy') return { providerId: config.id, records: [], retrievedAt: NOW };
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

test('plural fetching isolates synchronous child throws and rejects a mismatched child before retrieval', async () => {
  const called = [];
  const result = await fetchInstitutionalDisclosures([
    ALL_CONFIGS[0],
    { ...ALL_CONFIGS[1], entityId: 'strategy' },
    ALL_CONFIGS[2],
  ], {
    fetchOne(config) {
      called.push(config.id);
      if (config.id === 'institutional-ibit') throw new Error('untrusted sync detail');
      return { providerId: config.id, records: [normalizeTreasuryDisclosure(fixture('strategy'), ALL_CONFIGS[0], { now: () => new Date(NOW) })], retrievedAt: NOW };
    },
    now: () => new Date(NOW),
  });
  assert.deepEqual(called, ['institutional-strategy', 'institutional-ibit']);
  assert.deepEqual(result.statuses.map((row) => [row.id, row.status, row.errorCode]), [
    ['institutional-strategy', 'live', undefined],
    ['institutional-tesla', 'unavailable', 'configuration_missing'],
    ['institutional-ibit', 'unavailable', 'provider_unavailable'],
  ]);
});

test('a filing accession and archive directory must bind exactly to the configured CIK', () => {
  const crossFiler = fixture('strategy');
  crossFiler.accessionNumber = '0001318605-26-000101';
  assert.throws(() => normalizeTreasuryDisclosure(crossFiler, ALL_CONFIGS[0], { now: () => new Date(NOW) }), { code: 'schema_invalid' });

  const crossDirectory = fixture('strategy');
  crossDirectory.sourceUrl = 'https://www.sec.gov/Archives/edgar/data/1050446/000131860526000101/strategy-20260630.htm';
  assert.throws(() => normalizeTreasuryDisclosure(crossDirectory, ALL_CONFIGS[0], { now: () => new Date(NOW) }), { code: 'schema_invalid' });
});

test('filing dates require an exact calendar or canonical ISO timestamp', () => {
  const trailing = fixture('strategy');
  trailing.filingDate = '2026-08-05 trailing filing text';
  assert.throws(() => normalizeTreasuryDisclosure(trailing, ALL_CONFIGS[0], { now: () => new Date(NOW) }), { code: 'schema_invalid' });
});

test('holding comparison ignores refreshed metadata, property order, and unknown fields', () => {
  const previous = {
    btcAmount: 100, reportedValueUsd: 10_000_000, retrievedAt: '2026-08-01T00:00:00.000Z',
    filingBody: 'not retained', arbitrary: 'old',
  };
  const current = {
    arbitrary: 'new', reportedValueUsd: 10_000_000, btcAmount: 100,
    retrievedAt: '2026-08-26T00:00:00.000Z', sourceUrl: 'https://www.sec.gov/changed-link',
  };
  assert.equal(compareInstitutionalHoldings(previous, current).classification, 'unchanged');
});

test('plural rollup rejects malformed child records without hiding valid siblings', async () => {
  const valid = normalizeTreasuryDisclosure(fixture('strategy'), ALL_CONFIGS[0], { now: () => new Date(NOW) });
  const rawBody = { ...normalizeFundDisclosure(fixture('ibit'), ALL_CONFIGS[2], { now: () => new Date(NOW) }), filingBody: 'raw filing text' };
  const result = await fetchInstitutionalDisclosures(ALL_CONFIGS.slice(0, 4), {
    fetchOne: async (config) => ({
      providerId: config.id === 'institutional-fbtc' ? 'institutional-ibit' : config.id,
      records: config.id === 'institutional-strategy'
        ? [valid]
        : config.id === 'institutional-tesla'
          ? [{ ...valid, providerId: 'institutional-tesla' }]
          : config.id === 'institutional-ibit'
            ? [rawBody]
            : [],
      retrievedAt: NOW,
    }),
    now: () => new Date(NOW),
  });
  assert.deepEqual(result.statuses.map((row) => [row.id, row.status, row.errorCode]), [
    ['institutional-strategy', 'live', undefined],
    ['institutional-tesla', 'unavailable', 'schema_invalid'],
    ['institutional-ibit', 'unavailable', 'schema_invalid'],
    ['institutional-fbtc', 'unavailable', 'schema_invalid'],
  ]);
  assert.deepEqual(result.records.map((record) => record.id), [valid.id]);
});

test('plural rollup rejects duplicate stable record IDs', async () => {
  const valid = normalizeFundDisclosure(fixture('ibit'), ALL_CONFIGS[2], { now: () => new Date(NOW) });
  const result = await fetchInstitutionalDisclosures([ALL_CONFIGS[2]], {
    fetchOne: async () => ({ providerId: 'institutional-ibit', records: [valid, { ...valid }], retrievedAt: NOW }),
    now: () => new Date(NOW),
  });
  assert.deepEqual(result, {
    records: [],
    statuses: [{
      id: 'institutional-ibit', group: 'institutional', status: 'unavailable', recordCount: 0,
      errorCode: 'schema_invalid', retrievedAt: NOW,
    }],
  });
});

test('plural rollup rejects inherited and hidden raw fields while copying clean records', async () => {
  const valid = normalizeTreasuryDisclosure(fixture('strategy'), ALL_CONFIGS[0], { now: () => new Date(NOW) });
  const inherited = Object.assign(Object.create({ filingBody: 'inherited filing text' }),
    normalizeTreasuryDisclosure(fixture('tesla'), ALL_CONFIGS[1], { now: () => new Date(NOW) }));
  const hidden = normalizeFundDisclosure(fixture('ibit'), ALL_CONFIGS[2], { now: () => new Date(NOW) });
  Object.defineProperty(hidden, 'filingBody', { value: 'hidden filing text', enumerable: false });
  const result = await fetchInstitutionalDisclosures(ALL_CONFIGS.slice(0, 3), {
    fetchOne: async (config) => ({
      providerId: config.id,
      records: config.id === 'institutional-strategy' ? [valid]
        : config.id === 'institutional-tesla' ? [inherited] : [hidden],
      retrievedAt: NOW,
    }),
    now: () => new Date(NOW),
  });
  assert.deepEqual(result.statuses.map((row) => [row.id, row.status, row.errorCode]), [
    ['institutional-strategy', 'live', undefined],
    ['institutional-tesla', 'unavailable', 'schema_invalid'],
    ['institutional-ibit', 'unavailable', 'schema_invalid'],
  ]);
  assert.notEqual(result.records[0], valid);
  assert.deepEqual(Object.keys(result.records[0]).sort(), [
    'btcAmount', 'entityId', 'filedAt', 'freshnessBasis', 'id', 'methodology',
    'paperEligible', 'providerId', 'reportedValueUsd', 'reportingDate', 'retrievedAt',
    'sourceAsOf', 'sourceUrl', 'vehicle',
  ]);
  assert.equal(Object.hasOwn(result.records[0], 'filingBody'), false);
});
