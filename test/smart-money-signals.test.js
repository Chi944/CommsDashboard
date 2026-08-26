import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HYPERLIQUID_MIN_ACCOUNT_CHANGE_PCT,
  HYPERLIQUID_MIN_NOTIONAL_USD,
  INSTITUTIONAL_MIN_HOLDING_CHANGE_PCT,
  INSTITUTIONAL_MIN_VALUE_CHANGE_USD,
  POLYMARKET_MIN_PNL_CHANGE_PCT,
  POLYMARKET_MIN_PNL_CHANGE_USD,
  POLYMARKET_MIN_RANK_CHANGE,
  POLYMARKET_MIN_VOLUME_CHANGE_USD,
  SEC_MIN_REPORTED_VALUE_USD,
  SEC_MIN_SHARE_CHANGE_PCT,
  THRESHOLD_VERSION,
  deriveSignals,
} from '../lib/smart-money/signals.js';
import { validateSignal } from '../lib/smart-money/contracts.js';
import { FIRST_CHANGE, SECOND_CHANGE, UNMAPPED_13F_CHANGE } from './fixtures/smart-money/scenarios.js';

test('materiality constants are the named smart-money-v1 contract', () => {
  assert.equal(THRESHOLD_VERSION, 'smart-money-v1');
  assert.deepEqual([
    SEC_MIN_REPORTED_VALUE_USD, SEC_MIN_SHARE_CHANGE_PCT,
    HYPERLIQUID_MIN_NOTIONAL_USD, HYPERLIQUID_MIN_ACCOUNT_CHANGE_PCT,
    POLYMARKET_MIN_RANK_CHANGE, POLYMARKET_MIN_PNL_CHANGE_USD,
    POLYMARKET_MIN_PNL_CHANGE_PCT, POLYMARKET_MIN_VOLUME_CHANGE_USD,
    INSTITUTIONAL_MIN_VALUE_CHANGE_USD, INSTITUTIONAL_MIN_HOLDING_CHANGE_PCT,
  ], [1_000_000, 10, 100_000, 1, 10, 25_000, 10, 100_000, 10_000_000, 1]);
});

test('same Hyperliquid candidate confirms on two consecutive accepted hourly snapshots', () => {
  const first = deriveSignals(FIRST_CHANGE);
  assert.equal(first.signals.length, 0);
  assert.equal(first.pendingConfirmations.length, 1);
  assert.equal(first.pendingConfirmations[0].baselineNotionalUsd, 200_000);
  assert.equal(first.pendingConfirmations[0].candidateNotionalUsd, 350_000);
  const second = deriveSignals({ ...SECOND_CHANGE, pendingConfirmations: first.pendingConfirmations });
  assert.equal(second.signals.length, 1);
  assert.equal(second.pendingConfirmations.length, 0);
  assert.equal(second.signals[0].action, 'increase');
  assert.deepEqual(second.signals[0].positionChange, {
    previousNotionalUsd: 200_000, currentNotionalUsd: 350_000, deltaNotionalUsd: 150_000,
  });
  assert.deepEqual(second.signals[0].notificationEligibility, { eligible: true, reason: 'material_confirmed_change' });
  assert.deepEqual(second.signals[0].paperEligibility, { eligible: true, reason: 'supported_reference_price' });
});

test('pending confirmation cannot confirm through replay, mismatch, nonconsecutive, stale, or LKG input', () => {
  const pending = deriveSignals(FIRST_CHANGE).pendingConfirmations;
  const replay = deriveSignals({ ...FIRST_CHANGE, pendingConfirmations: pending });
  assert.equal(replay.signals.length, 0);
  const mismatch = structuredClone(SECOND_CHANGE);
  mismatch.changes[0].currentNotionalUsd = 400_000;
  assert.equal(deriveSignals({ ...mismatch, pendingConfirmations: pending }).signals.length, 0);
  const skipped = structuredClone(SECOND_CHANGE);
  skipped.changes[0].observedAt = '2026-08-26T12:00:00.000Z';
  skipped.changes[0].retrievedAt = '2026-08-26T12:00:00.000Z';
  skipped.nowMs = Date.parse(skipped.changes[0].observedAt);
  assert.equal(deriveSignals({ ...skipped, pendingConfirmations: pending }).signals.length, 0);
  for (const patch of [{ freshness: 'stale' }, { lastKnownGood: true }]) {
    const input = structuredClone(SECOND_CHANGE);
    Object.assign(input.changes[0], patch);
    const result = deriveSignals({ ...input, pendingConfirmations: pending });
    assert.equal(result.signals.length, 0);
    assert.deepEqual(result.pendingConfirmations, pending);
  }
});

test('position action and signed delta arithmetic cover open, increase, reduce, close, and reverse', () => {
  const pendingFor = (previous, current, previousDirection = 'long', currentDirection = 'long') => {
    const first = structuredClone(FIRST_CHANGE);
    Object.assign(first.changes[0], { previousNotionalUsd: previous, currentNotionalUsd: current, previousDirection, currentDirection });
    return deriveSignals(first).pendingConfirmations;
  };
  const cases = [
    [0, 150_000, 'long', 'long', 'open', 150_000],
    [200_000, 350_000, 'long', 'long', 'increase', 150_000],
    [350_000, 200_000, 'long', 'long', 'reduce', -150_000],
    [200_000, 0, 'long', 'long', 'close', -200_000],
    [200_000, 250_000, 'long', 'short', 'reverse', -450_000],
  ];
  for (const [previous, current, previousDirection, currentDirection, action, delta] of cases) {
    const second = structuredClone(SECOND_CHANGE);
    Object.assign(second.changes[0], { previousNotionalUsd: previous, currentNotionalUsd: current, previousDirection, currentDirection });
    const result = deriveSignals({ ...second, pendingConfirmations: pendingFor(previous, current, previousDirection, currentDirection) });
    assert.equal(result.signals[0].action, action);
    assert.equal(result.signals[0].positionChange.deltaNotionalUsd, delta);
  }
});

test('unmapped 13F holdings remain research signals and never paper eligible', () => {
  const result = deriveSignals(UNMAPPED_13F_CHANGE);
  assert.equal(result.signals[0].asset.ticker, null);
  assert.deepEqual(result.signals[0].paperEligibility, { eligible: false, reason: 'unsupported_asset' });
});

test('SEC materiality honors exact value and share-change boundaries', () => {
  const exact = structuredClone(UNMAPPED_13F_CHANGE);
  Object.assign(exact.changes[0], { previousShares: 1_000, currentShares: 1_100, reportedValueUsd: 1_000_000 });
  assert.equal(deriveSignals(exact).signals.length, 1);
  const belowShares = structuredClone(exact);
  belowShares.changes[0].currentShares = 1_099;
  assert.equal(deriveSignals(belowShares).signals.length, 0);
  const belowValue = structuredClone(exact);
  belowValue.changes[0].reportedValueUsd = 999_999;
  assert.equal(deriveSignals(belowValue).signals.length, 0);
});

test('Hyperliquid account-relative threshold can exceed the USD floor', () => {
  const belowFloor = structuredClone(FIRST_CHANGE);
  belowFloor.changes[0].currentNotionalUsd = 299_999;
  assert.equal(deriveSignals(belowFloor).pendingConfirmations.length, 0);
  const exactFloor = structuredClone(FIRST_CHANGE);
  exactFloor.changes[0].currentNotionalUsd = 300_000;
  assert.equal(deriveSignals(exactFloor).pendingConfirmations.length, 1);
  const accountRelative = structuredClone(FIRST_CHANGE);
  Object.assign(accountRelative.changes[0], { accountValueUsd: 20_000_000, currentNotionalUsd: 350_000 });
  assert.equal(deriveSignals(accountRelative).pendingConfirmations.length, 0);
});

test('Polymarket and institutional materiality honor their exact source-scoped edges', () => {
  const polymarket = {
    ...UNMAPPED_13F_CHANGE.changes[0], id: 'poly:1', sourceStableId: 'poly:1',
    providerId: 'polymarket-leaderboard', entityId: 'polymarket:0x0000000000000000000000000000000000000abc',
    kind: 'rank_change', classification: undefined,
    asset: { ticker: null, name: 'Crypto leaderboard', providerSymbol: 'CRYPTO', assetClass: 'prediction-market', supported: false },
    previousRank: 20, currentRank: 10,
  };
  assert.equal(deriveSignals({ changes: [polymarket] }).signals.length, 1);
  assert.equal(deriveSignals({ changes: [{ ...polymarket, currentRank: 11 }] }).signals.length, 0);
  assert.equal(deriveSignals({ changes: [{ ...polymarket, previousRank: undefined, currentRank: undefined, previousPnl30dUsd: 100_000, currentPnl30dUsd: 125_000 }] }).signals.length, 1);
  assert.equal(deriveSignals({ changes: [{ ...polymarket, previousRank: undefined, currentRank: undefined, previousVolume30dUsd: 1_000_000, currentVolume30dUsd: 1_100_000 }] }).signals.length, 1);

  const institutional = {
    ...UNMAPPED_13F_CHANGE.changes[0], id: 'institutional:edge', sourceStableId: 'institutional:edge',
    providerId: 'institutional-strategy', entityId: 'strategy', classification: 'changed',
    previousValueUsd: 100_000_000, currentValueUsd: 110_000_000,
    asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true },
  };
  assert.equal(deriveSignals({ changes: [institutional] }).signals.length, 1);
  assert.equal(deriveSignals({ changes: [{ ...institutional, currentValueUsd: 109_999_999 }] }).signals.length, 0);
});

test('large transfers and institutional disclosure balance changes are observations, not trades', () => {
  for (const change of [
    { ...UNMAPPED_13F_CHANGE.changes[0], id: 'transfer:1', providerId: 'official-publication-oaktree', entityId: 'oaktree-capital', kind: 'transfer', asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true } },
    { ...UNMAPPED_13F_CHANGE.changes[0], id: 'institutional:1', providerId: 'institutional-strategy', entityId: 'strategy', kind: 'holding_change', classification: 'changed', reportedValueUsd: 20_000_000, previousValueUsd: 100_000_000, currentValueUsd: 120_000_000, asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true } },
  ]) {
    const result = deriveSignals({ changes: [change], nowMs: Date.parse(change.observedAt) });
    assert.equal(result.signals[0].action, 'observe');
    assert.equal(result.signals[0].positionChange, null);
    assert.equal(result.signals[0].paperEligibility.eligible, false);
  }
});

test('signal validator rejects pollution, invalid enums, arithmetic, ticker mismatches, and unsafe paper eligibility', () => {
  const pending = deriveSignals(FIRST_CHANGE).pendingConfirmations;
  const signal = deriveSignals({ ...SECOND_CHANGE, pendingConfirmations: pending }).signals[0];
  assert.deepEqual(validateSignal(signal, { now: new Date('2026-08-26T11:00:00.000Z') }), signal);
  assert.throws(() => validateSignal({ ...signal, orderType: 'market' }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, action: 'buy' }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, asset: { ...signal.asset, assetClass: 'commodity' } }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, positionChange: { ...signal.positionChange, deltaNotionalUsd: 1 } }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, action: 'reduce' }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, magnitude: { ...signal.magnitude, value: 149_999 } }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, referencePrice: { ...signal.referencePrice, ticker: 'ETH' } }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, observedAt: '2026-08-26T11:05:00.001Z' }, { now: new Date('2026-08-26T11:00:00.000Z') }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, entityId: 'polymarket:0xabc' }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, delaySeconds: 1 }, { now: new Date(signal.observedAt) }), /schema_invalid/);
  const accessor = { ...signal };
  Object.defineProperty(accessor, 'action', { enumerable: true, get: () => 'open' });
  assert.throws(() => validateSignal(accessor, { now: new Date(signal.observedAt) }), /schema_invalid/);
  assert.throws(() => validateSignal({ ...signal, action: 'observe', positionChange: null }, { now: new Date(signal.observedAt) }), /schema_invalid/);
});

test('deriveSignals is deterministic and does not mutate inputs', () => {
  const input = structuredClone(FIRST_CHANGE);
  const before = structuredClone(input);
  const first = deriveSignals(input);
  const second = deriveSignals(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});
