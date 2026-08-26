import {
  assertSafeArray,
  assertSafePlainRecord,
  schemaInvalid,
  validateSignal,
} from './contracts.js';

const NO_SOURCES = Object.freeze([]);

export const SMART_MONEY_SIMULATION_CAPABILITY = Object.freeze({
  schemaVersion: 1,
  status: 'research_only',
  reason: 'no_rights_cleared_price_source',
  transactionsEnabled: false,
  enabledEntryPriceSources: NO_SOURCES,
  enabledDailyMarkSources: NO_SOURCES,
  effectiveAt: null,
});

const CAPABILITY_FIELDS = Object.freeze([
  'schemaVersion',
  'status',
  'reason',
  'transactionsEnabled',
  'enabledEntryPriceSources',
  'enabledDailyMarkSources',
  'effectiveAt',
]);

export function simulationCapability() {
  return {
    ...SMART_MONEY_SIMULATION_CAPABILITY,
    enabledEntryPriceSources: [],
    enabledDailyMarkSources: [],
  };
}

export function validateSimulationCapability(value) {
  assertSafePlainRecord(value, CAPABILITY_FIELDS);
  assertSafeArray(value.enabledEntryPriceSources);
  assertSafeArray(value.enabledDailyMarkSources);
  if (value.schemaVersion !== 1
      || value.status !== 'research_only'
      || value.reason !== 'no_rights_cleared_price_source'
      || value.transactionsEnabled !== false
      || value.enabledEntryPriceSources.length !== 0
      || value.enabledDailyMarkSources.length !== 0
      || value.effectiveAt !== null) {
    throw schemaInvalid();
  }
  return simulationCapability();
}

export function makeSignalResearchOnly(value, options = {}) {
  const normalized = validateSignal(value, options);
  const reason = normalized.freshness === 'stale'
    ? 'stale_source'
    : normalized.asset.supported
      ? 'research_only'
      : 'unsupported_asset';
  return validateSignal({
    ...normalized,
    paperEligibility: { eligible: false, reason },
    referencePrice: null,
  }, options);
}
