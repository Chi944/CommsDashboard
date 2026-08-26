import assert from 'node:assert/strict';
import test from 'node:test';

import { nextSmartMoneyRefreshAt } from '../src/lib/smartMoneyRefreshSchedule.js';

test('Smart Money foreground refresh follows the daily 00:01, 06:05, and 18:05 UTC slots', () => {
  assert.equal(
    nextSmartMoneyRefreshAt('2026-08-27T00:00:00.000Z').toISOString(),
    '2026-08-27T00:01:00.000Z',
  );
  assert.equal(
    nextSmartMoneyRefreshAt('2026-08-27T00:01:00.000Z').toISOString(),
    '2026-08-27T06:05:00.000Z',
  );
  assert.equal(
    nextSmartMoneyRefreshAt('2026-08-27T06:04:59.999Z').toISOString(),
    '2026-08-27T06:05:00.000Z',
  );
  assert.equal(
    nextSmartMoneyRefreshAt('2026-08-27T06:05:00.000Z').toISOString(),
    '2026-08-27T18:05:00.000Z',
  );
  assert.equal(
    nextSmartMoneyRefreshAt('2026-08-27T18:05:00.000Z').toISOString(),
    '2026-08-28T00:01:00.000Z',
  );
});

test('Smart Money refresh scheduling rejects invalid timestamps', () => {
  assert.throws(() => nextSmartMoneyRefreshAt('not-a-date'), TypeError);
});
