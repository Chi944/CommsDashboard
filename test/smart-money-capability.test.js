import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SMART_MONEY_SIMULATION_CAPABILITY,
  simulationCapability,
  validateSimulationCapability,
} from '../lib/smart-money/capability.js';

const EXPECTED = {
  schemaVersion: 1,
  status: 'research_only',
  reason: 'no_rights_cleared_price_source',
  transactionsEnabled: false,
  enabledEntryPriceSources: [],
  enabledDailyMarkSources: [],
  effectiveAt: null,
};

test('production capability is the exact fail-closed research-only contract', () => {
  assert.deepEqual(SMART_MONEY_SIMULATION_CAPABILITY, EXPECTED);
  assert.deepEqual(simulationCapability(), EXPECTED);
  assert.notEqual(simulationCapability(), SMART_MONEY_SIMULATION_CAPABILITY);
  assert.equal(Object.isFrozen(SMART_MONEY_SIMULATION_CAPABILITY), true);
  assert.equal(Object.isFrozen(SMART_MONEY_SIMULATION_CAPABILITY.enabledEntryPriceSources), true);
  assert.equal(Object.isFrozen(SMART_MONEY_SIMULATION_CAPABILITY.enabledDailyMarkSources), true);
});

test('capability validation rejects every attempt to enable or extend it', () => {
  assert.deepEqual(validateSimulationCapability(EXPECTED), EXPECTED);
  for (const candidate of [
    { ...EXPECTED, transactionsEnabled: true },
    { ...EXPECTED, status: 'enabled' },
    { ...EXPECTED, effectiveAt: '2026-08-27T00:00:00.000Z' },
    { ...EXPECTED, enabledEntryPriceSources: ['yahoo'] },
    { ...EXPECTED, enabledDailyMarkSources: ['coingecko'] },
    { ...EXPECTED, extra: true },
  ]) {
    assert.throws(() => validateSimulationCapability(candidate), /schema_invalid/);
  }
});
