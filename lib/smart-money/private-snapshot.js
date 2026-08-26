import { createHash } from 'node:crypto';

import {
  assertSafeArray,
  assertSafePlainRecord,
  canonicalTimestamp,
  schemaInvalid,
} from './contracts.js';
import { listEntities } from './entities.js';
import {
  getProviderFreshnessPolicy,
  normalizeAdapterSnapshot,
  normalizeProviderStatus,
  validateAcceptedSnapshot,
} from './normalize.js';
import { deriveSignals } from './signals.js';

export const ENABLED_SMART_MONEY_ADAPTER_IDS = Object.freeze([
  'sec-edgar',
  'institutional-strategy',
  'institutional-tesla',
  'institutional-ibit',
  'institutional-fbtc',
  'institutional-arkb',
  'institutional-bitb',
]);

const SEC_HOLDING_FIELDS = Object.freeze([
  'accessionNumber', 'periodEnd', 'filedAt', 'isAmendment', 'amendmentChain',
  'issuer', 'securityClass', 'cusip', 'ticker', 'reportedValue', 'shares',
  'putCall', 'shareType', 'paperEligible',
]);

const SEC_PRIVATE_SOURCE_IDENTITY = Object.freeze({
  cik: '2045724', entityId: 'situational-awareness-lp', legalEntity: 'Situational Awareness LP',
});

const INSTITUTIONAL_PRIVATE_SOURCE_IDENTITIES = Object.freeze({
  'institutional-strategy': Object.freeze({
    cik: '1050446', entityId: 'strategy', legalEntity: 'Strategy Inc.',
    vehicle: 'corporate_bitcoin_treasury',
  }),
  'institutional-tesla': Object.freeze({
    cik: '1318605', entityId: 'tesla', legalEntity: 'Tesla, Inc.',
    vehicle: 'corporate_bitcoin_treasury',
  }),
  'institutional-ibit': Object.freeze({
    cik: '1980994', entityId: 'blackrock-ibit', legalEntity: 'iShares Bitcoin Trust ETF',
    vehicle: 'spot_bitcoin_etf',
  }),
  'institutional-fbtc': Object.freeze({
    cik: '1852317', entityId: 'fidelity-fbtc', legalEntity: 'Fidelity Wise Origin Bitcoin Fund',
    vehicle: 'spot_bitcoin_etf',
  }),
  'institutional-arkb': Object.freeze({
    cik: '1869699', entityId: 'ark-21shares-arkb', legalEntity: 'ARK 21Shares Bitcoin ETF',
    vehicle: 'spot_bitcoin_etf',
  }),
  'institutional-bitb': Object.freeze({
    cik: '1763415', entityId: 'bitwise-bitb', legalEntity: 'Bitwise Bitcoin ETF Trust',
    vehicle: 'spot_bitcoin_etf',
  }),
});

function exactNow(value) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) throw schemaInvalid();
  return now;
}

function exactAdapterIds(adapters) {
  assertSafeArray(adapters);
  if (adapters.length !== ENABLED_SMART_MONEY_ADAPTER_IDS.length
      || adapters.some((adapter, index) => adapter?.id !== ENABLED_SMART_MONEY_ADAPTER_IDS[index])) {
    throw schemaInvalid();
  }
}

function compactInstitutionalStatus(status, id, retrievedAt) {
  return {
    id,
    group: 'institutional',
    status: status?.status ?? 'unavailable',
    recordCount: status?.recordCount ?? 0,
    ...(status?.status === 'live' ? {} : { errorCode: status?.errorCode ?? 'empty_dataset' }),
    retrievedAt: status?.retrievedAt ?? retrievedAt,
  };
}

function validateSecHolding(holding, now) {
  assertSafePlainRecord(holding, SEC_HOLDING_FIELDS);
  assertSafeArray(holding.amendmentChain);
  if (typeof holding.accessionNumber !== 'string'
      || !/^\d{10}-\d{2}-\d{6}$/.test(holding.accessionNumber)
      || typeof holding.periodEnd !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(holding.periodEnd)
      || new Date(`${holding.periodEnd}T00:00:00.000Z`).toISOString().slice(0, 10) !== holding.periodEnd
      || canonicalTimestamp(holding.filedAt, { now }) !== holding.filedAt
      || typeof holding.isAmendment !== 'boolean'
      || holding.amendmentChain.length < 1
      || !holding.amendmentChain.every((accession) => (
        typeof accession === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(accession)
      ))
      || (holding.issuer !== null && (typeof holding.issuer !== 'string' || holding.issuer.length > 512))
      || (holding.securityClass !== null && (typeof holding.securityClass !== 'string' || holding.securityClass.length > 128))
      || typeof holding.cusip !== 'string' || !/^[0-9A-Z]{9}$/.test(holding.cusip)
      || holding.ticker !== null
      || !Number.isSafeInteger(holding.reportedValue) || holding.reportedValue < 0
      || !Number.isSafeInteger(holding.shares) || holding.shares < 0
      || (holding.putCall !== null && !['PUT', 'CALL'].includes(holding.putCall))
      || (holding.shareType !== null && (typeof holding.shareType !== 'string' || holding.shareType.length > 32))
      || holding.paperEligible !== false) {
    throw schemaInvalid();
  }
}

function exactRegisteredEntity(entities, identity) {
  const entity = entities.find((row) => row.id === identity.entityId);
  if (!entity || entity.legalEntity !== identity.legalEntity) throw schemaInvalid();
}

function validateSecSourceOwnership(source, entities) {
  exactRegisteredEntity(entities, SEC_PRIVATE_SOURCE_IDENTITY);
  const filings = [...source.snapshot.filings, ...source.snapshot.disclosures];
  if (filings.some((filing) => filing.cik !== SEC_PRIVATE_SOURCE_IDENTITY.cik)) {
    throw schemaInvalid();
  }
  const filingKeys = new Set(source.snapshot.filings.map((filing) => (
    `${filing.accessionNumber}\u0000${filing.periodEnd}`
  )));
  if (source.snapshot.holdings.some((holding) => !filingKeys.has(
    `${holding.accessionNumber}\u0000${holding.periodEnd}`,
  ))) throw schemaInvalid();
}

function validateInstitutionalSourceOwnership(source, id, entities) {
  const identity = INSTITUTIONAL_PRIVATE_SOURCE_IDENTITIES[id];
  if (!identity) throw schemaInvalid();
  exactRegisteredEntity(entities, identity);
  for (const record of source.records) {
    const match = typeof record.id === 'string'
      ? record.id.match(new RegExp(`^${id}:(\\d{10}-\\d{2}-\\d{6}):(\\d{4}-\\d{2}-\\d{2})$`))
      : null;
    let sourceUrl;
    try {
      sourceUrl = new URL(record.sourceUrl);
    } catch {
      throw schemaInvalid();
    }
    const accession = match?.[1] ?? '';
    const expectedPrefix = `/Archives/edgar/data/${identity.cik}/${accession.replaceAll('-', '')}/`;
    if (!match || match[2] !== record.reportingDate
        || record.providerId !== id || record.entityId !== identity.entityId
        || record.vehicle !== identity.vehicle
        || sourceUrl.origin !== 'https://www.sec.gov'
        || !sourceUrl.pathname.startsWith(expectedPrefix)
        || sourceUrl.username || sourceUrl.password || sourceUrl.hash) {
      throw schemaInvalid();
    }
  }
}

export function validateSmartMoneyAdapterSource(source, id, status, nowValue, entities = listEntities()) {
  const now = exactNow(nowValue);
  if (source === null) return null;
  if (id === 'sec-edgar') {
    assertSafePlainRecord(
      source,
      ['kind', 'snapshot', 'scheduleBaselineEstablished'],
      ['kind', 'snapshot'],
    );
    if (source.kind !== 'sec') throw schemaInvalid();
    if (Object.hasOwn(source, 'scheduleBaselineEstablished')
        && source.scheduleBaselineEstablished !== true) throw schemaInvalid();
    assertSafePlainRecord(source.snapshot, ['filings', 'disclosures', 'holdings']);
    for (const field of ['filings', 'disclosures', 'holdings']) assertSafeArray(source.snapshot[field]);
    for (const holding of source.snapshot.holdings) validateSecHolding(holding, now);
    normalizeAdapterSnapshot(source.snapshot, {
      now,
      retrievedAt: status?.retrievedAt ?? now.toISOString(),
      providerId: 'sec-edgar',
      entityId: 'situational-awareness-lp',
      entities,
    });
    validateSecSourceOwnership(source, entities);
    return structuredClone(source);
  }
  assertSafePlainRecord(source, ['kind', 'records']);
  if (source.kind !== 'institutional') throw schemaInvalid();
  assertSafeArray(source.records);
  normalizeAdapterSnapshot({
    records: source.records,
    statuses: [compactInstitutionalStatus(status, id, status?.retrievedAt ?? now.toISOString())],
  }, { now, entities });
  validateInstitutionalSourceOwnership(source, id, entities);
  return structuredClone(source);
}

export function validateSmartMoneyAdapterState(value, options = {}) {
  const now = exactNow(options.now ?? new Date());
  assertSafePlainRecord(value, ['schemaVersion', 'adapters', 'pendingConfirmations']);
  if (value.schemaVersion !== 1) throw schemaInvalid();
  exactAdapterIds(value.adapters);
  const entities = listEntities();
  const adapters = value.adapters.map((row, index) => {
    assertSafePlainRecord(row, ['id', 'source', 'status']);
    const id = ENABLED_SMART_MONEY_ADAPTER_IDS[index];
    if (row.id !== id) throw schemaInvalid();
    const status = row.status === null
      ? null
      : normalizeProviderStatus(row.status, getProviderFreshnessPolicy(id), { now });
    return {
      id,
      source: validateSmartMoneyAdapterSource(row.source, id, status, now, entities),
      status,
    };
  });
  assertSafeArray(value.pendingConfirmations);
  const pendingConfirmations = deriveSignals({
    changes: [],
    pendingConfirmations: value.pendingConfirmations,
    nowMs: now.getTime(),
  }).pendingConfirmations;
  return { schemaVersion: 1, adapters, pendingConfirmations };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sourceRecordCount(id, source) {
  if (source === null) return 0;
  return id === 'sec-edgar'
    ? source.snapshot.filings.length + source.snapshot.disclosures.length
    : source.records.length;
}

function assertPrivateSnapshotCoherence(publicSnapshot, adapterState) {
  if (publicSnapshot.providerStatuses.length !== ENABLED_SMART_MONEY_ADAPTER_IDS.length) {
    throw schemaInvalid();
  }
  adapterState.adapters.forEach((row, index) => {
    const id = ENABLED_SMART_MONEY_ADAPTER_IDS[index];
    const status = publicSnapshot.providerStatuses[index];
    if (row.id !== id || row.status === null || status.id !== id
        || status.group !== (id === 'sec-edgar' ? 'sec' : 'institutional')
        || status.enabled !== true
        || status.recordCount !== sourceRecordCount(id, row.source)
        || stableJson(status) !== stableJson(row.status)) {
      throw schemaInvalid();
    }
  });
}

export function computeSmartMoneyPrivateStateDigest(value) {
  const fields = ['schemaVersion', 'refreshStartedAt', 'publicSnapshot', 'adapterState'];
  const keys = Object.keys(value ?? {});
  assertSafePlainRecord(
    value,
    keys.includes('stateDigest') ? [...fields, 'stateDigest'] : fields,
  );
  return `sha256:${createHash('sha256').update(stableJson({
    schemaVersion: value.schemaVersion,
    refreshStartedAt: value.refreshStartedAt,
    publicSnapshot: value.publicSnapshot,
    adapterState: value.adapterState,
  })).digest('hex')}`;
}

function canonicalPrivatePayload(value, now) {
  const refreshStartedAt = canonicalTimestamp(value.refreshStartedAt, { now });
  const publicSnapshot = validateAcceptedSnapshot(value.publicSnapshot, { now });
  if (Date.parse(refreshStartedAt) > Date.parse(publicSnapshot.fetchedAt)) throw schemaInvalid();
  const adapterState = validateSmartMoneyAdapterState(value.adapterState, {
    now: new Date(publicSnapshot.fetchedAt),
  });
  assertPrivateSnapshotCoherence(publicSnapshot, adapterState);
  return { schemaVersion: 1, refreshStartedAt, publicSnapshot, adapterState };
}

export function validateSmartMoneyPrivateSnapshot(value, options = {}) {
  const now = exactNow(options.now ?? new Date());
  assertSafePlainRecord(value, [
    'schemaVersion', 'refreshStartedAt', 'publicSnapshot', 'adapterState', 'stateDigest',
  ]);
  if (value.schemaVersion !== 1) throw schemaInvalid();
  const canonical = canonicalPrivatePayload(value, now);
  const stateDigest = computeSmartMoneyPrivateStateDigest(canonical);
  if (value.stateDigest !== stateDigest) throw schemaInvalid();
  return { ...canonical, stateDigest };
}

export function buildSmartMoneyPrivateSnapshot(value, options = {}) {
  const now = exactNow(options.now ?? new Date());
  assertSafePlainRecord(value, ['refreshStartedAt', 'publicSnapshot', 'adapterState']);
  const canonical = canonicalPrivatePayload({ schemaVersion: 1, ...value }, now);
  return {
    ...canonical,
    stateDigest: computeSmartMoneyPrivateStateDigest(canonical),
  };
}
