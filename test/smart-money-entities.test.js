import assert from 'node:assert/strict';
import test from 'node:test';
import { getEntity, listConfiguredAdapters, listEntities } from '../lib/smart-money/entities.js';

test('Leopold and Situational Awareness are separate related entities', () => {
  const person = getEntity('leopold-aschenbrenner');
  const firm = getEntity('situational-awareness-lp');
  assert.equal(person.actorType, 'person');
  assert.equal(firm.actorType, 'firm');
  assert.ok(person.relatedEntityIds.includes(firm.id));
  assert.ok(firm.relatedEntityIds.includes(person.id));
  assert.equal(person.directoryCategory, 'investors');
  assert.equal(firm.directoryCategory, 'firms');
  assert.equal(firm.performanceVerification.status, 'not_publicly_verified');
});

test('the initial static roster has unique stable IDs', () => {
  const ids = listEntities().map((entity) => entity.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('bitwise-bitb'));
});

test('institutional adapter IDs remain distinct from their source-rights IDs', () => {
  const adapters = listConfiguredAdapters({ now: new Date('2026-08-26T00:00:00.000Z') });
  assert.deepEqual(adapters.filter((adapter) => adapter.id.startsWith('institutional-')).map((adapter) => [adapter.id, adapter.rightsId]), [
    ['institutional-strategy', 'strategy-disclosures'],
    ['institutional-tesla', 'tesla-disclosures'],
    ['institutional-ibit', 'ibit-disclosures'],
    ['institutional-fbtc', 'fbtc-disclosures'],
    ['institutional-arkb', 'arkb-disclosures'],
    ['institutional-bitb', 'bitb-disclosures'],
  ]);
});
