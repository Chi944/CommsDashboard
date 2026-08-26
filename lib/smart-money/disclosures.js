import { ProviderError, sanitizeProviderError } from './errors.js';
import { listConfiguredAdapters } from './entities.js';
import { assertAdapterRights } from './rights.js';

const SEC_ARCHIVES_ORIGIN = 'https://www.sec.gov';
const INSTITUTIONAL_ADAPTERS = Object.freeze({
  'institutional-strategy': Object.freeze({
    id: 'institutional-strategy', entityId: 'strategy', rightsId: 'strategy-disclosures', cik: '1050446', kind: 'treasury', vehicle: 'corporate_bitcoin_treasury',
  }),
  'institutional-tesla': Object.freeze({
    id: 'institutional-tesla', entityId: 'tesla', rightsId: 'tesla-disclosures', cik: '1318605', kind: 'treasury', vehicle: 'corporate_bitcoin_treasury',
  }),
  'institutional-ibit': Object.freeze({
    id: 'institutional-ibit', entityId: 'blackrock-ibit', rightsId: 'ibit-disclosures', cik: '1980994', kind: 'fund', vehicle: 'spot_bitcoin_etf',
  }),
  'institutional-fbtc': Object.freeze({
    id: 'institutional-fbtc', entityId: 'fidelity-fbtc', rightsId: 'fbtc-disclosures', cik: '1852317', kind: 'fund', vehicle: 'spot_bitcoin_etf',
  }),
  'institutional-arkb': Object.freeze({
    id: 'institutional-arkb', entityId: 'ark-21shares-arkb', rightsId: 'arkb-disclosures', cik: '1869699', kind: 'fund', vehicle: 'spot_bitcoin_etf',
  }),
  'institutional-bitb': Object.freeze({
    id: 'institutional-bitb', entityId: 'bitwise-bitb', rightsId: 'bitb-disclosures', cik: '1763415', kind: 'fund', vehicle: 'spot_bitcoin_etf',
  }),
});

export const INSTITUTIONAL_DISCLOSURE_CONFIGS = Object.freeze(Object.values(INSTITUTIONAL_ADAPTERS));

function schemaError(providerId) {
  return new ProviderError('schema_invalid', providerId);
}

function completeConfig(config = {}) {
  const canonical = INSTITUTIONAL_ADAPTERS[config?.id];
  if (!canonical) throw new ProviderError('configuration_missing', config?.id || null);
  for (const key of ['entityId', 'rightsId', 'cik', 'kind', 'vehicle']) {
    if (config[key] != null && config[key] !== canonical[key]) {
      throw new ProviderError('configuration_missing', canonical.id);
    }
  }
  return canonical;
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value ? value : null;
}

function isoDate(value, providerId) {
  if (typeof value !== 'string') throw schemaError(providerId);
  const calendarDate = validCalendarDate(value);
  if (calendarDate) return `${calendarDate}T00:00:00.000Z`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw schemaError(providerId);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw schemaError(providerId);
  return value;
}

function nonnegativeNumber(value, providerId) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || Math.abs(value) > Number.MAX_SAFE_INTEGER || value < 0) {
    throw schemaError(providerId);
  }
  return value;
}

function filingUrl(value, config, accessionNumber) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw schemaError(config.id);
  }
  const expectedPrefix = `/Archives/edgar/data/${config.cik}/${accessionNumber.replace(/-/g, '')}/`;
  if (url.origin !== SEC_ARCHIVES_ORIGIN || !url.pathname.startsWith(expectedPrefix)
      || url.username || url.password || url.hash) {
    throw schemaError(config.id);
  }
  return url.toString();
}

function filingAccession(value, config) {
  if (typeof value !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(value)) throw schemaError(config.id);
  const filerCik = value.slice(0, 10).replace(/^0+/, '') || '0';
  if (filerCik !== config.cik) throw schemaError(config.id);
  return value;
}

function retrievedAt(deps, providerId) {
  const now = typeof deps?.now === 'function' ? deps.now() : new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ProviderError('configuration_missing', providerId);
  return now.toISOString();
}

function normalizeDisclosure(raw, givenConfig, deps = {}) {
  const config = completeConfig(givenConfig);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw schemaError(config.id);
  const reportingDate = validCalendarDate(raw.reportingDate ?? raw.reportDate);
  if (!reportingDate) throw schemaError(config.id);
  const filingDate = isoDate(raw.filingDate ?? raw.filedAt, config.id);
  const btcAmount = nonnegativeNumber(raw.btcAmount ?? raw.bitcoinAmount, config.id);
  const reportedValueUsd = nonnegativeNumber(raw.reportedValueUsd ?? raw.valueUsd, config.id);
  const accessionNumber = filingAccession(raw.accessionNumber, config);
  return {
    id: `${config.id}:${accessionNumber}:${reportingDate}`,
    providerId: config.id,
    entityId: config.entityId,
    vehicle: config.vehicle,
    reportingDate,
    filedAt: filingDate,
    btcAmount,
    reportedValueUsd,
    sourceUrl: filingUrl(raw.sourceUrl ?? raw.canonicalUrl, config, accessionNumber),
    methodology: 'sec_filing_reported',
    sourceAsOf: `${reportingDate}T00:00:00.000Z`,
    retrievedAt: retrievedAt(deps, config.id),
    freshnessBasis: 'reporting_date',
    paperEligible: false,
  };
}

export function normalizeTreasuryDisclosure(raw, config, deps = {}) {
  const resolved = completeConfig(config);
  if (resolved.kind !== 'treasury') throw new ProviderError('configuration_missing', resolved.id);
  return normalizeDisclosure(raw, resolved, deps);
}

export function normalizeFundDisclosure(raw, config, deps = {}) {
  const resolved = completeConfig(config);
  if (resolved.kind !== 'fund') throw new ProviderError('configuration_missing', resolved.id);
  return normalizeDisclosure(raw, resolved, deps);
}

function assertDisclosureRights(config) {
  const adapter = listConfiguredAdapters().find((item) => item.id === config.id);
  if (!adapter || adapter.rightsId !== config.rightsId) throw new ProviderError('rights_gate_failed', config.id);
  try {
    assertAdapterRights([adapter]);
  } catch {
    throw new ProviderError('rights_gate_failed', config.id);
  }
}

function rawFetcher(deps, config) {
  const fetchRaw = deps?.fetchRaw || deps?.fetchInstitutionalRaw;
  if (typeof fetchRaw !== 'function') throw new ProviderError('configuration_missing', config.id);
  return fetchRaw(config, deps);
}

export async function fetchInstitutionalDisclosure(config, deps = {}) {
  const resolved = completeConfig(config);
  assertDisclosureRights(resolved);
  const raw = await rawFetcher(deps, resolved);
  const record = resolved.kind === 'treasury'
    ? normalizeTreasuryDisclosure(raw, resolved, deps)
    : normalizeFundDisclosure(raw, resolved, deps);
  return { providerId: resolved.id, records: [record], retrievedAt: record.retrievedAt };
}

function failedStatus(config, error, now) {
  return {
    id: config?.id || null,
    group: 'institutional',
    status: 'unavailable',
    recordCount: 0,
    errorCode: sanitizeProviderError(error),
    retrievedAt: retrievedAt({ now }, config?.id),
  };
}

function liveStatus(config, value, now) {
  return {
    id: config.id,
    group: 'institutional',
    status: 'live',
    recordCount: value.records.length,
    retrievedAt: typeof value.retrievedAt === 'string' ? value.retrievedAt : retrievedAt({ now }, config.id),
  };
}

const DISCLOSURE_FIELD_NAMES = Object.freeze([
  'id', 'providerId', 'entityId', 'vehicle', 'reportingDate', 'filedAt',
  'btcAmount', 'reportedValueUsd', 'sourceUrl', 'methodology', 'sourceAsOf',
  'retrievedAt', 'freshnessBasis', 'paperEligible',
]);
const DISCLOSURE_FIELDS = new Set(DISCLOSURE_FIELD_NAMES);

function isSafePlainShape(value, allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.entries(descriptors).every(([key, descriptor]) => (
    allowedFields.has(key)
    && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
  ));
}

function exactIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validateNormalizedRecord(record, config, envelopeRetrievedAt) {
  if (!isSafePlainShape(record, DISCLOSURE_FIELDS)) {
    throw schemaError(config.id);
  }
  const reportingDate = validCalendarDate(record.reportingDate);
  const accessionMatch = typeof record.id === 'string'
    ? record.id.match(new RegExp(`^${config.id}:(\\d{10}-\\d{2}-\\d{6}):(\\d{4}-\\d{2}-\\d{2})$`))
    : null;
  if (!reportingDate || !accessionMatch || accessionMatch[2] !== reportingDate
      || record.providerId !== config.id || record.entityId !== config.entityId
      || record.vehicle !== config.vehicle || record.methodology !== 'sec_filing_reported'
      || record.sourceAsOf !== `${reportingDate}T00:00:00.000Z`
      || record.freshnessBasis !== 'reporting_date' || record.paperEligible !== false
      || !exactIsoTimestamp(record.filedAt) || !exactIsoTimestamp(record.retrievedAt)
      || record.retrievedAt !== envelopeRetrievedAt) {
    throw schemaError(config.id);
  }
  nonnegativeNumber(record.btcAmount, config.id);
  nonnegativeNumber(record.reportedValueUsd, config.id);
  const accessionNumber = filingAccession(accessionMatch[1], config);
  filingUrl(record.sourceUrl, config, accessionNumber);
  return Object.fromEntries(DISCLOSURE_FIELD_NAMES.map((field) => [field, record[field]]));
}

function validateFetchResult(value, config) {
  const envelopeFields = new Set(['providerId', 'records', 'retrievedAt']);
  if (!isSafePlainShape(value, envelopeFields)
      || value.providerId !== config.id || !Array.isArray(value.records)
      || !exactIsoTimestamp(value.retrievedAt)) {
    throw schemaError(config.id);
  }
  const records = value.records.map((record) => validateNormalizedRecord(record, config, value.retrievedAt));
  if (new Set(records.map((record) => record.id)).size !== records.length) throw schemaError(config.id);
  return { providerId: config.id, records, retrievedAt: value.retrievedAt };
}

export async function fetchInstitutionalDisclosures(configs, deps = {}) {
  const items = Array.isArray(configs) ? configs : [];
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  const fetchOne = typeof deps.fetchOne === 'function'
    ? deps.fetchOne
    : (config, context) => fetchInstitutionalDisclosure(config, context);
  const settled = await Promise.allSettled(items.map((config) => Promise.resolve().then(() => {
    const canonical = completeConfig(config);
    return fetchOne(canonical, deps);
  }).then((value) => validateFetchResult(value, completeConfig(config)))));
  return settled.reduce((result, item, index) => {
    const config = items[index];
    if (item.status === 'fulfilled' && Array.isArray(item.value?.records) && item.value.records.length > 0) {
      result.records.push(...item.value.records);
      result.statuses.push(liveStatus(config, item.value, now));
    } else if (item.status === 'fulfilled') {
      result.statuses.push(failedStatus(config, new ProviderError('empty_dataset', config?.id), now));
    } else {
      result.statuses.push(failedStatus(config, item.reason, now));
    }
    return result;
  }, { records: [], statuses: [] });
}

function holdingProjection(record) {
  if (!record || typeof record !== 'object') return null;
  const metric = (primary, legacy) => {
    const value = record[primary] ?? record[legacy];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  };
  return {
    btcAmount: metric('btcAmount', 'bitcoinAmount'),
    reportedValueUsd: metric('reportedValueUsd', 'valueUsd'),
  };
}

function comparableRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const fields = [
    'id', 'providerId', 'entityId', 'vehicle', 'reportingDate', 'filedAt',
    'btcAmount', 'bitcoinAmount', 'reportedValueUsd', 'valueUsd', 'sourceUrl',
    'methodology', 'sourceAsOf', 'retrievedAt',
  ];
  return Object.fromEntries(fields.flatMap((field) => (
    Object.hasOwn(record, field) ? [[field, record[field]]] : []
  )));
}

// Disclosures are compared in chronological order: prior filing, then current filing.
// A change is evidence of a newly reported balance, never evidence of a transaction.
export function compareInstitutionalHoldings(previous, current) {
  const currentHolding = holdingProjection(current);
  const previousHolding = holdingProjection(previous);
  let classification = 'unchanged';
  if (previous == null && current != null) classification = 'new';
  else if (current == null && previous != null) classification = 'exited';
  else if (previousHolding && currentHolding
      && Object.values(previousHolding).some((value) => value !== null && value > 0)
      && Object.values(currentHolding).every((value) => value === 0 || value === null)) {
    classification = 'exited';
  } else if (JSON.stringify(currentHolding) !== JSON.stringify(previousHolding)) classification = 'changed';
  return {
    classification,
    previous: comparableRecord(previous),
    current: comparableRecord(current),
    isTrade: false,
  };
}
