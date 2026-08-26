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
  const date = validCalendarDate(String(value ?? '').slice(0, 10));
  if (!date) throw schemaError(providerId);
  return `${date}T00:00:00.000Z`;
}

function nonnegativeNumber(value, providerId) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || Math.abs(value) > Number.MAX_SAFE_INTEGER || value < 0) {
    throw schemaError(providerId);
  }
  return value;
}

function filingUrl(value, config) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw schemaError(config.id);
  }
  const expectedPrefix = `/Archives/edgar/data/${config.cik}/`;
  if (url.origin !== SEC_ARCHIVES_ORIGIN || !url.pathname.startsWith(expectedPrefix)
      || url.username || url.password || url.hash) {
    throw schemaError(config.id);
  }
  return url.toString();
}

function filingAccession(value, providerId) {
  if (typeof value !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(value)) throw schemaError(providerId);
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
  const accessionNumber = filingAccession(raw.accessionNumber, config.id);
  return {
    id: `${config.id}:${accessionNumber}:${reportingDate}`,
    providerId: config.id,
    entityId: config.entityId,
    vehicle: config.vehicle,
    reportingDate,
    filedAt: filingDate,
    btcAmount,
    reportedValueUsd,
    sourceUrl: filingUrl(raw.sourceUrl ?? raw.canonicalUrl, config),
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

export async function fetchInstitutionalDisclosures(configs, deps = {}) {
  const items = Array.isArray(configs) ? configs : [];
  const now = typeof deps.now === 'function' ? deps.now : () => new Date();
  const fetchOne = typeof deps.fetchOne === 'function'
    ? deps.fetchOne
    : (config, context) => fetchInstitutionalDisclosure(config, context);
  const settled = await Promise.allSettled(items.map((config) => fetchOne(config, deps)));
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

function amount(record) {
  if (!record || typeof record !== 'object') return null;
  const value = record.btcAmount ?? record.bitcoinAmount ?? record.reportedValueUsd ?? record.valueUsd;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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
  const currentAmount = amount(current);
  const previousAmount = amount(previous);
  let classification = 'unchanged';
  if (previous == null && current != null) classification = 'new';
  else if (current == null && previous != null) classification = 'exited';
  else if (previousAmount !== null && currentAmount !== null && previousAmount > 0 && currentAmount === 0) classification = 'exited';
  else if (JSON.stringify(current) !== JSON.stringify(previous)) classification = 'changed';
  return {
    classification,
    previous: comparableRecord(previous),
    current: comparableRecord(current),
    isTrade: false,
  };
}
