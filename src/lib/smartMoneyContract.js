const SNAPSHOT_FIELDS = Object.freeze([
  'schemaVersion', 'ok', 'fetchedAt', 'partial', 'entities', 'activities',
  'performances', 'signals', 'rankings', 'providerStatuses', 'warnings',
  'sourceLinks', 'simulationCapability',
]);
const CAPABILITY_FIELDS = Object.freeze([
  'schemaVersion', 'status', 'reason', 'transactionsEnabled',
  'enabledEntryPriceSources', 'enabledDailyMarkSources', 'effectiveAt',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export const RESEARCH_ONLY_SIMULATION_CAPABILITY = Object.freeze({
  schemaVersion: 1,
  status: 'research_only',
  reason: 'no_rights_cleared_price_source',
  transactionsEnabled: false,
  enabledEntryPriceSources: Object.freeze([]),
  enabledDailyMarkSources: Object.freeze([]),
  effectiveAt: null,
});

function exactPlainObject(value, fields) {
  if (value === null || typeof value !== 'object'
      || Object.getPrototypeOf(value) !== Object.prototype
      || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !keys.includes(field))) return false;
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function canonicalInstant(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}

function safeRows(value, max = 10_000) {
  return Array.isArray(value) && value.length <= max && !value.some((row) => (
    row === null || typeof row !== 'object' || Object.getPrototypeOf(row) !== Object.prototype
  ));
}

export function isResearchOnlySimulationCapability(value) {
  return exactPlainObject(value, CAPABILITY_FIELDS)
    && value.schemaVersion === 1
    && value.status === 'research_only'
    && value.reason === 'no_rights_cleared_price_source'
    && value.transactionsEnabled === false
    && Array.isArray(value.enabledEntryPriceSources)
    && value.enabledEntryPriceSources.length === 0
    && Array.isArray(value.enabledDailyMarkSources)
    && value.enabledDailyMarkSources.length === 0
    && value.effectiveAt === null;
}

export function validateSmartMoneySnapshot(value) {
  if (!exactPlainObject(value, SNAPSHOT_FIELDS)
      || value.schemaVersion !== 1 || value.ok !== true
      || typeof value.partial !== 'boolean' || !canonicalInstant(value.fetchedAt)
      || !isResearchOnlySimulationCapability(value.simulationCapability)) return null;
  for (const field of [
    'entities', 'activities', 'performances', 'signals', 'providerStatuses',
    'sourceLinks',
  ]) {
    if (!safeRows(value[field])) return null;
  }
  if (!Array.isArray(value.warnings)
      || value.warnings.some((warning) => typeof warning !== 'string')
      || value.entities.some((entity) => typeof entity.id !== 'string' || !SAFE_ID.test(entity.id))
      || value.providerStatuses.some((status) => typeof status.id !== 'string' || !SAFE_ID.test(status.id))
      || value.rankings === null || typeof value.rankings !== 'object'
      || Object.getPrototypeOf(value.rankings) !== Object.prototype) return null;
  return value;
}

export function researchOnlyCapabilityCopy() {
  return {
    ...RESEARCH_ONLY_SIMULATION_CAPABILITY,
    enabledEntryPriceSources: [],
    enabledDailyMarkSources: [],
  };
}
