import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDashboardSearch,
  parseDashboardSearch,
} from '../src/lib/dashboardRoute.js';
import {
  DEFAULT_SMART_MONEY_PREFERENCES,
  SMART_MONEY_STORAGE_KEYS,
  loadNotifiedSignalIds,
  loadSmartMoneyPreferences,
  saveNotifiedSignalIds,
  saveSmartMoneyPreferences,
} from '../src/lib/smartMoneyStorage.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key); },
  };
}

test('dashboard route preserves Intel evidence and durable Prices ticker state', () => {
  assert.deepEqual(
    parseDashboardSearch('?tab=Intel&view=smart-money&record=sec:abc&t=btc'),
    { tab: 'Intel', view: 'smart-money', recordId: 'sec:abc', ticker: 'BTC' },
  );
  assert.equal(
    buildDashboardSearch('?campaign=research&t=ETH', {
      tab: 'Intel', view: 'smart-money', recordId: 'sec:abc', ticker: 'BTC',
    }),
    '?campaign=research&tab=Intel&view=smart-money&record=sec%3Aabc&t=BTC',
  );
});

test('dashboard routes fail closed and canonicalize retired simulation links to holdings', () => {
  assert.deepEqual(parseDashboardSearch('?tab=Unsafe&view=paper-copy&t=%00BTC'), {
    tab: 'Overview', view: null, recordId: null, ticker: null,
  });
  assert.deepEqual(parseDashboardSearch('?tab=Portfolio&view=paper-copy'), {
    tab: 'Portfolio', view: 'holdings', recordId: null, ticker: null,
  });
  assert.equal(buildDashboardSearch('', {
    tab: 'Portfolio', view: 'simulation-readiness', recordId: 'ignored', ticker: null,
  }), '?tab=Portfolio&view=holdings');
});

test('preferences round-trip with stable IDs and no executable or credential state', () => {
  const storage = memoryStorage();
  const value = {
    schemaVersion: 1,
    followedEntityIds: ['situational-awareness-lp', 'strategy', 'strategy'],
    browserNotificationsEnabled: true,
  };
  assert.equal(saveSmartMoneyPreferences(storage, value), true);
  assert.deepEqual(loadSmartMoneyPreferences(storage), {
    ...value,
    followedEntityIds: ['situational-awareness-lp', 'strategy'],
  });
  assert.doesNotMatch(storage.value(SMART_MONEY_STORAGE_KEYS.preferences), /order|trade|token|secret|wallet/i);
});

test('malformed, future, accessor, and storage failures return independent defaults', () => {
  for (const raw of [
    '{',
    JSON.stringify({ ...DEFAULT_SMART_MONEY_PREFERENCES, schemaVersion: 2 }),
    JSON.stringify({ ...DEFAULT_SMART_MONEY_PREFERENCES, privateKey: 'x' }),
    JSON.stringify({ ...DEFAULT_SMART_MONEY_PREFERENCES, followedEntityIds: ['bad id'] }),
  ]) {
    const loaded = loadSmartMoneyPreferences(memoryStorage({
      [SMART_MONEY_STORAGE_KEYS.preferences]: raw,
    }));
    assert.deepEqual(loaded, DEFAULT_SMART_MONEY_PREFERENCES);
    assert.notEqual(loaded, DEFAULT_SMART_MONEY_PREFERENCES);
  }
  assert.deepEqual(loadSmartMoneyPreferences({ getItem() { throw new Error('denied'); } }), DEFAULT_SMART_MONEY_PREFERENCES);
  assert.equal(saveSmartMoneyPreferences({ setItem() { throw new Error('full'); } }, DEFAULT_SMART_MONEY_PREFERENCES), false);
});

test('notification deduplication storage is bounded, versioned, and canonical', () => {
  const storage = memoryStorage();
  const ids = Array.from({ length: 550 }, (_, index) => `signal:${String(index).padStart(4, '0')}`);
  assert.equal(saveNotifiedSignalIds(storage, [...ids, ids.at(-1)]), true);
  const loaded = loadNotifiedSignalIds(storage);
  assert.equal(loaded.length, 500);
  assert.deepEqual(loaded, ids.slice(-500));
  assert.deepEqual(JSON.parse(storage.value(SMART_MONEY_STORAGE_KEYS.notified)), {
    schemaVersion: 1,
    signalIds: ids.slice(-500),
  });
});
