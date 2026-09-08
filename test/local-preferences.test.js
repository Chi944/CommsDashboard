import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAlerts, normalizePositions, normalizeTriggeredAlerts, normalizeWatchlists,
} from '../src/lib/localPreferences.js';

test('damaged preference containers recover to usable empty values', () => {
  for (const value of [null, false, 1, 'stale schema', [], {}]) {
    assert.deepEqual(normalizeWatchlists(value), { active: 'Default', lists: { Default: [] } });
    assert.deepEqual(normalizePositions(value), []);
    assert.deepEqual(normalizeAlerts(value), []);
    assert.deepEqual(normalizeTriggeredAlerts(value), []);
  }
});

test('watchlist recovery keeps valid symbols and repairs missing active lists', () => {
  const value = JSON.parse('{"active":"missing","lists":{"Macro":["CL",null,"CL",{}],"Broken":null,"__proto__":[],"constructor":[]}}');
  assert.deepEqual(normalizeWatchlists(value), { active: 'Macro', lists: { Macro: ['CL'] } });
});

test('holdings recovery preserves valid records and drops unsafe values without losing the collection', () => {
  assert.deepEqual(normalizePositions([
    { ticker: 'NVDA', qty: 2, avgCost: 100 }, null,
    { ticker: 'AMD', qty: -1, avgCost: 50 },
    { ticker: 'BTC', qty: Infinity, avgCost: 100 },
    { ticker: 'NVDA', qty: 3, avgCost: 110 },
    { ticker: 'ZZZZ', qty: 1, avgCost: 20 },
  ]), [{ ticker: 'NVDA', qty: 3, avgCost: 110 }, { ticker: 'ZZZZ', qty: 1, avgCost: 20 }]);
});

test('alerts recovery requires a valid threshold and never enables malformed saved flags', () => {
  const valid = { id: 'a1', ticker: 'NVDA', op: '>', price: 150, enabled: true };
  assert.deepEqual(normalizeAlerts([null, valid, { ...valid, id: 'a2', price: NaN },
    { ...valid, id: 'a3', enabled: 'true', name: {} }]), [
    { ...valid, name: 'NVDA', lastTriggeredAt: null },
    { ...valid, id: 'a3', enabled: false, name: 'NVDA', lastTriggeredAt: null },
  ]);
});
