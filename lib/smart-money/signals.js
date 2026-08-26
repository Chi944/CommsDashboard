import {
  ACTIVITY_KINDS,
  DIRECTIONS,
  FRESHNESS_VALUES,
  assertProviderEntity,
  assertSafeArray,
  assertSafePlainRecord,
  canonicalTimestamp,
  enumValue,
  finiteNumber,
  httpsUrl,
  normalizeAsset,
  normalizeReferencePrice,
  safeIdentifier,
  schemaInvalid,
  stringValue,
  validateSignal,
} from './contracts.js';

export const THRESHOLD_VERSION = 'smart-money-v1';
export const SEC_MIN_REPORTED_VALUE_USD = 1_000_000;
export const SEC_MIN_SHARE_CHANGE_PCT = 10;
export const HYPERLIQUID_MIN_NOTIONAL_USD = 100_000;
export const HYPERLIQUID_MIN_ACCOUNT_CHANGE_PCT = 1;
export const POLYMARKET_MIN_RANK_CHANGE = 10;
export const POLYMARKET_MIN_PNL_CHANGE_USD = 25_000;
export const POLYMARKET_MIN_PNL_CHANGE_PCT = 10;
export const POLYMARKET_MIN_VOLUME_CHANGE_USD = 100_000;
export const INSTITUTIONAL_MIN_VALUE_CHANGE_USD = 10_000_000;
export const INSTITUTIONAL_MIN_HOLDING_CHANGE_PCT = 1;

const HOUR_MS = 60 * 60_000;
const CHANGE_FIELDS = Object.freeze([
  'id', 'sourceStableId', 'providerId', 'entityId', 'activityId', 'kind', 'sourceUrl',
  'sourceGrade', 'identityStatus', 'confidence', 'asset', 'previousNotionalUsd',
  'currentNotionalUsd', 'previousDirection', 'currentDirection', 'accountValueUsd',
  'effectiveAt', 'disclosedAt', 'observedAt', 'retrievedAt', 'acceptedSnapshotId',
  'freshness', 'lastKnownGood', 'referencePrice', 'cusip', 'classification',
  'previousShares', 'currentShares', 'reportedValueUsd', 'previousValueUsd',
  'currentValueUsd', 'previousRank', 'currentRank', 'previousPnl30dUsd',
  'currentPnl30dUsd', 'previousVolume30dUsd', 'currentVolume30dUsd',
]);
const REQUIRED_CHANGE_FIELDS = Object.freeze([
  'id', 'providerId', 'entityId', 'activityId', 'kind', 'sourceUrl', 'sourceGrade',
  'identityStatus', 'confidence', 'asset', 'effectiveAt', 'disclosedAt', 'observedAt',
  'retrievedAt', 'freshness', 'lastKnownGood', 'referencePrice',
]);
const PENDING_FIELDS = Object.freeze([
  'id', 'entityId', 'providerId', 'assetTicker', 'providerSymbol', 'baselineNotionalUsd',
  'candidateNotionalUsd', 'baselineDirection', 'candidateDirection',
  'signedBaselineNotionalUsd', 'signedCandidateNotionalUsd', 'observationId',
  'acceptedSnapshotId', 'observedAt',
]);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function normalizeOptionalNumber(record, field, options = {}) {
  if (!Object.hasOwn(record, field)) return;
  finiteNumber(record[field], options);
}

function normalizeChange(change, now) {
  assertSafePlainRecord(change, CHANGE_FIELDS, REQUIRED_CHANGE_FIELDS);
  const providerId = safeIdentifier(change.providerId);
  const entityId = safeIdentifier(change.entityId);
  assertProviderEntity(providerId, entityId);
  const asset = normalizeAsset(change.asset);
  const effectiveAt = canonicalTimestamp(change.effectiveAt, { now });
  const disclosedAt = canonicalTimestamp(change.disclosedAt, { nullable: true, now });
  const observedAt = canonicalTimestamp(change.observedAt, { now });
  const retrievedAt = canonicalTimestamp(change.retrievedAt, { now });
  if (Date.parse(retrievedAt) < Date.parse(observedAt)
      || (disclosedAt !== null && Date.parse(observedAt) < Date.parse(disclosedAt))) throw schemaInvalid();
  const referencePrice = normalizeReferencePrice(change.referencePrice, asset, now);
  if (referencePrice !== null && Date.parse(referencePrice.asOf) < Date.parse(observedAt)) throw schemaInvalid();
  if (typeof change.lastKnownGood !== 'boolean') throw schemaInvalid();
  if (Object.hasOwn(change, 'sourceStableId')) safeIdentifier(change.sourceStableId);
  if (Object.hasOwn(change, 'acceptedSnapshotId')) safeIdentifier(change.acceptedSnapshotId);
  if (Object.hasOwn(change, 'cusip') && (typeof change.cusip !== 'string' || !/^[0-9A-Z]{9}$/.test(change.cusip))) throw schemaInvalid();
  if (Object.hasOwn(change, 'classification')) enumValue(change.classification, ['new', 'increased', 'reduced', 'exited', 'changed', 'unchanged']);
  for (const field of [
    'previousNotionalUsd', 'currentNotionalUsd', 'accountValueUsd', 'currentShares',
    'reportedValueUsd', 'previousValueUsd', 'currentValueUsd', 'previousVolume30dUsd',
    'currentVolume30dUsd',
  ]) normalizeOptionalNumber(change, field, { nonnegative: true });
  if (Object.hasOwn(change, 'previousShares') && change.previousShares !== null) {
    finiteNumber(change.previousShares, { nonnegative: true });
  }
  for (const field of ['previousPnl30dUsd', 'currentPnl30dUsd']) normalizeOptionalNumber(change, field);
  for (const field of ['previousRank', 'currentRank']) {
    if (Object.hasOwn(change, field)) {
      const rank = finiteNumber(change[field], { nonnegative: true });
      if (!Number.isInteger(rank) || rank < 1) throw schemaInvalid();
    }
  }
  if (providerId.startsWith('hyperliquid-')) {
    for (const field of ['previousNotionalUsd', 'currentNotionalUsd', 'accountValueUsd']) {
      if (!Object.hasOwn(change, field)) throw schemaInvalid();
    }
    enumValue(change.previousDirection, DIRECTIONS);
    enumValue(change.currentDirection, DIRECTIONS);
    safeIdentifier(change.acceptedSnapshotId);
  }
  const normalized = structuredClone(change);
  Object.assign(normalized, {
    id: safeIdentifier(change.id), providerId, entityId,
    activityId: safeIdentifier(change.activityId),
    kind: enumValue(change.kind, ACTIVITY_KINDS),
    sourceUrl: httpsUrl(change.sourceUrl),
    sourceGrade: stringValue(change.sourceGrade, { maxLength: 100 }),
    identityStatus: enumValue(change.identityStatus, ['verified', 'anonymous', 'unverified']),
    confidence: enumValue(change.confidence, ['high', 'medium', 'low']),
    asset, effectiveAt, disclosedAt, observedAt, retrievedAt,
    freshness: enumValue(change.freshness, FRESHNESS_VALUES),
    referencePrice,
  });
  return normalized;
}

function normalizePending(pending, now) {
  assertSafePlainRecord(pending, PENDING_FIELDS);
  const providerId = safeIdentifier(pending.providerId);
  const entityId = safeIdentifier(pending.entityId);
  assertProviderEntity(providerId, entityId);
  const assetTicker = pending.assetTicker === null ? null : stringValue(pending.assetTicker, { maxLength: 32 }).toUpperCase();
  const providerSymbol = pending.providerSymbol === null ? null : stringValue(pending.providerSymbol, { maxLength: 64 });
  if (assetTicker === null && providerSymbol === null) throw schemaInvalid();
  const baselineNotionalUsd = finiteNumber(pending.baselineNotionalUsd, { nonnegative: true });
  const candidateNotionalUsd = finiteNumber(pending.candidateNotionalUsd, { nonnegative: true });
  const baselineDirection = enumValue(pending.baselineDirection, DIRECTIONS);
  const candidateDirection = enumValue(pending.candidateDirection, DIRECTIONS);
  const signedBaselineNotionalUsd = finiteNumber(pending.signedBaselineNotionalUsd);
  const signedCandidateNotionalUsd = finiteNumber(pending.signedCandidateNotionalUsd);
  if (signedNotional(baselineNotionalUsd, baselineDirection) !== signedBaselineNotionalUsd
      || (candidateNotionalUsd === 0 ? 0 : signedNotional(candidateNotionalUsd, candidateDirection)) !== signedCandidateNotionalUsd) throw schemaInvalid();
  return {
    id: safeIdentifier(pending.id), entityId, providerId, assetTicker, providerSymbol,
    baselineNotionalUsd, candidateNotionalUsd, baselineDirection, candidateDirection,
    signedBaselineNotionalUsd, signedCandidateNotionalUsd,
    observationId: safeIdentifier(pending.observationId),
    acceptedSnapshotId: safeIdentifier(pending.acceptedSnapshotId),
    observedAt: canonicalTimestamp(pending.observedAt, { now }),
  };
}

function signedNotional(value, direction) {
  if (!finite(value) || value < 0 || !['long', 'short'].includes(direction)) throw schemaInvalid();
  return direction === 'short' ? -value : value;
}

function position(change) {
  const previous = signedNotional(change.previousNotionalUsd, change.previousDirection);
  const current = change.currentNotionalUsd === 0 ? 0 : signedNotional(change.currentNotionalUsd, change.currentDirection);
  return { previousNotionalUsd: previous, currentNotionalUsd: current, deltaNotionalUsd: current - previous };
}

function actionFor(positionChange) {
  const previous = positionChange.previousNotionalUsd;
  const current = positionChange.currentNotionalUsd;
  if (previous === 0 && current !== 0) return 'open';
  if (previous !== 0 && current === 0) return 'close';
  if (Math.sign(previous) !== Math.sign(current)) return 'reverse';
  return Math.abs(current) > Math.abs(previous) ? 'increase' : 'reduce';
}

function materialHyperliquid(change) {
  const changed = Math.abs(position(change).deltaNotionalUsd);
  const accountThreshold = finite(change.accountValueUsd) && change.accountValueUsd >= 0
    ? change.accountValueUsd * HYPERLIQUID_MIN_ACCOUNT_CHANGE_PCT / 100 : Infinity;
  return changed >= Math.max(HYPERLIQUID_MIN_NOTIONAL_USD, accountThreshold);
}

function pendingKey(change) {
  return `${change.providerId}\u0000${change.entityId}\u0000${change.asset?.ticker || change.asset?.providerSymbol}`;
}

function normalizedPendingKey(pending) {
  return `${pending.providerId}\u0000${pending.entityId}\u0000${pending.assetTicker || pending.providerSymbol}`;
}

function makePending(change) {
  const candidate = position(change);
  return {
    id: `pending:${change.providerId}:${change.entityId}:${change.asset?.ticker || change.asset?.providerSymbol}`,
    entityId: safeIdentifier(change.entityId),
    providerId: safeIdentifier(change.providerId),
    assetTicker: change.asset?.ticker ?? null,
    providerSymbol: change.asset?.providerSymbol ?? null,
    baselineNotionalUsd: change.previousNotionalUsd,
    candidateNotionalUsd: change.currentNotionalUsd,
    baselineDirection: change.previousDirection,
    candidateDirection: change.currentDirection,
    signedBaselineNotionalUsd: candidate.previousNotionalUsd,
    signedCandidateNotionalUsd: candidate.currentNotionalUsd,
    observationId: safeIdentifier(change.sourceStableId ?? change.id),
    acceptedSnapshotId: safeIdentifier(change.acceptedSnapshotId),
    observedAt: new Date(change.observedAt).toISOString(),
  };
}

function sameCandidate(pending, change) {
  const candidate = position(change);
  return pending.entityId === change.entityId
    && pending.providerId === change.providerId
    && pending.assetTicker === (change.asset?.ticker ?? null)
    && pending.providerSymbol === (change.asset?.providerSymbol ?? null)
    && pending.baselineNotionalUsd === change.previousNotionalUsd
    && pending.candidateNotionalUsd === change.currentNotionalUsd
    && pending.baselineDirection === change.previousDirection
    && pending.candidateDirection === change.currentDirection
    && pending.signedBaselineNotionalUsd === candidate.previousNotionalUsd
    && pending.signedCandidateNotionalUsd === candidate.currentNotionalUsd;
}

function consecutive(pending, change) {
  const difference = Date.parse(change.observedAt) - Date.parse(pending.observedAt);
  return difference === HOUR_MS
    && pending.observationId !== (change.sourceStableId ?? change.id)
    && pending.acceptedSnapshotId !== change.acceptedSnapshotId;
}

function percentChange(previous, current) {
  if (!finite(previous) || !finite(current)) return 0;
  if (previous === 0) return current === 0 ? 0 : Infinity;
  return Math.abs(current - previous) / Math.abs(previous) * 100;
}

function materialSec(change) {
  if (['new', 'exited'].includes(change.classification)) return true;
  return ['increased', 'reduced'].includes(change.classification)
    && finite(change.reportedValueUsd) && change.reportedValueUsd >= SEC_MIN_REPORTED_VALUE_USD
    && percentChange(change.previousShares, change.currentShares) >= SEC_MIN_SHARE_CHANGE_PCT;
}

function materialInstitutional(change) {
  if (change.classification === 'new') return finite(change.currentValueUsd ?? change.reportedValueUsd);
  if (change.classification === 'exited') return finite(change.previousValueUsd ?? change.reportedValueUsd);
  if (!finite(change.previousValueUsd) || !finite(change.currentValueUsd)) return false;
  return Math.abs(change.currentValueUsd - change.previousValueUsd) >= Math.max(
    INSTITUTIONAL_MIN_VALUE_CHANGE_USD,
    Math.abs(change.previousValueUsd) * INSTITUTIONAL_MIN_HOLDING_CHANGE_PCT / 100,
  );
}

function materialPolymarket(change) {
  const rank = finite(change.previousRank) && finite(change.currentRank)
    && change.currentRank <= 100 && Math.abs(change.currentRank - change.previousRank) >= POLYMARKET_MIN_RANK_CHANGE;
  const pnlDelta = finite(change.previousPnl30dUsd) && finite(change.currentPnl30dUsd)
    ? Math.abs(change.currentPnl30dUsd - change.previousPnl30dUsd) : 0;
  const pnl = pnlDelta >= Math.max(POLYMARKET_MIN_PNL_CHANGE_USD,
    Math.abs(change.previousPnl30dUsd || 0) * POLYMARKET_MIN_PNL_CHANGE_PCT / 100);
  const volume = finite(change.previousVolume30dUsd) && finite(change.currentVolume30dUsd)
    && Math.abs(change.currentVolume30dUsd - change.previousVolume30dUsd) >= POLYMARKET_MIN_VOLUME_CHANGE_USD;
  return rank || pnl || volume;
}

function mappedAction(change) {
  if (change.providerId.startsWith('institutional-') || change.kind === 'transfer'
      || change.providerId.startsWith('polymarket-') || change.kind === 'filing'
      || change.kind === 'statement' || change.kind === 'performance') return 'observe';
  return ({ new: 'open', increased: 'increase', reduced: 'reduce', exited: 'close' })[change.classification] || 'observe';
}

function paperEligibility(change, action, positionChange, asset, referencePrice) {
  if (!asset.supported || asset.ticker === null) return { eligible: false, reason: 'unsupported_asset' };
  if (action === 'observe') return { eligible: false, reason: 'research_only' };
  if (positionChange === null) return { eligible: false, reason: 'missing_position_change' };
  if (change.providerId.startsWith('polymarket-')) return { eligible: false, reason: 'provider_research_only' };
  if (referencePrice === null) return { eligible: false, reason: 'missing_reference_price' };
  return { eligible: true, reason: 'supported_reference_price' };
}

function buildSignal(change, { confirmedHyperliquid = false, now } = {}) {
  const asset = normalizeAsset(change.asset);
  const hyperliquid = change.providerId.startsWith('hyperliquid-');
  const positionChange = hyperliquid ? position(change) : null;
  const action = hyperliquid ? actionFor(positionChange) : mappedAction(change);
  const magnitudeValue = positionChange
    ? Math.abs(positionChange.deltaNotionalUsd)
    : finite(change.reportedValueUsd) ? Math.abs(change.reportedValueUsd)
      : finite(change.currentValueUsd) && finite(change.previousValueUsd) ? Math.abs(change.currentValueUsd - change.previousValueUsd)
        : 0;
  const observedAt = new Date(change.observedAt).toISOString();
  const effectiveAt = new Date(change.effectiveAt).toISOString();
  const disclosedAt = change.disclosedAt == null ? null : new Date(change.disclosedAt).toISOString();
  const referencePrice = change.referencePrice == null ? null : structuredClone(change.referencePrice);
  const signal = {
    id: `${change.providerId}:${change.sourceStableId ?? change.id}`,
    entityId: change.entityId,
    activityId: change.activityId,
    kind: change.kind,
    action,
    asset,
    direction: hyperliquid
      ? (positionChange.currentNotionalUsd === 0 ? change.previousDirection : change.currentDirection)
      : null,
    magnitude: { value: magnitudeValue, unit: positionChange ? 'usd_notional' : 'reported_value_usd' },
    positionChange,
    effectiveAt,
    disclosedAt,
    observedAt,
    delaySeconds: Math.max(0, (Date.parse(['filing', 'holding_change'].includes(change.kind) && disclosedAt !== null ? disclosedAt : observedAt) - Date.parse(effectiveAt)) / 1000),
    providerId: change.providerId,
    sourceUrl: change.sourceUrl,
    sourceGrade: change.sourceGrade,
    identityStatus: change.identityStatus,
    confidence: change.confidence,
    thresholdVersion: THRESHOLD_VERSION,
    notificationEligibility: {
      eligible: true,
      reason: confirmedHyperliquid ? 'material_confirmed_change' : change.kind === 'filing' || change.kind === 'statement' ? 'new_evidence' : 'material_change',
    },
    paperEligibility: paperEligibility(change, action, positionChange, asset, referencePrice),
    referencePrice,
    freshness: 'fresh',
  };
  return validateSignal(signal, { now });
}

function shouldEmit(change) {
  if (change.providerId === 'sec-edgar') return materialSec(change);
  if (change.providerId.startsWith('institutional-')) return materialInstitutional(change);
  if (change.providerId.startsWith('polymarket-')) return materialPolymarket(change);
  if (change.kind === 'transfer' || change.kind === 'filing' || change.kind === 'statement' || change.kind === 'performance') return true;
  return false;
}

export function deriveSignals(input = {}) {
  assertSafePlainRecord(input, ['changes', 'pendingConfirmations', 'nowMs', 'scenarioAvailability'], ['changes', 'pendingConfirmations', 'nowMs']);
  assertSafeArray(input.changes);
  assertSafeArray(input.pendingConfirmations);
  const nowMs = input.nowMs;
  if (!finite(nowMs) || nowMs < 0) throw schemaInvalid();
  const now = new Date(nowMs);
  if (!Number.isFinite(now.getTime())) throw schemaInvalid();
  if (Object.hasOwn(input, 'scenarioAvailability') && input.scenarioAvailability !== 'future_permitted_output') throw schemaInvalid();
  const changes = input.changes.map((change) => normalizeChange(change, now));
  const changeIds = new Set();
  for (const change of changes) {
    if (changeIds.has(change.id)) throw schemaInvalid();
    changeIds.add(change.id);
  }
  const incomingPending = input.pendingConfirmations.map((pending) => normalizePending(pending, now));
  const pendingByKey = new Map();
  const pendingIds = new Set();
  for (const pending of incomingPending) {
    const key = normalizedPendingKey(pending);
    if (pendingIds.has(pending.id) || pendingByKey.has(key)) throw schemaInvalid();
    pendingIds.add(pending.id);
    pendingByKey.set(key, pending);
  }
  const signals = [];
  for (const change of changes) {
    if (!change || change.freshness !== 'fresh' || change.lastKnownGood === true) continue;
    if (change.providerId?.startsWith('hyperliquid-')) {
      if (!materialHyperliquid(change)) continue;
      const key = pendingKey(change);
      const previousPending = pendingByKey.get(key);
      if (previousPending && sameCandidate(previousPending, change) && consecutive(previousPending, change)) {
        signals.push(buildSignal(change, { confirmedHyperliquid: true, now }));
        pendingByKey.delete(key);
      } else if (!previousPending || previousPending.observationId !== (change.sourceStableId ?? change.id)) {
        pendingByKey.set(key, makePending(change));
      }
      continue;
    }
    if (shouldEmit(change)) signals.push(buildSignal(change, { now }));
  }
  const unique = new Set();
  const dedupedSignals = signals.filter((signal) => {
    if (unique.has(signal.id)) return false;
    unique.add(signal.id);
    return true;
  });
  return {
    signals: dedupedSignals,
    pendingConfirmations: [...pendingByKey.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function attachReferencePrice(signal, referencePrice, options = {}) {
  const nowValue = options.now ?? referencePrice?.retrievedAt ?? Date.now();
  const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw schemaInvalid();
  const normalized = validateSignal(signal, { now });
  const candidate = {
    ...normalized,
    referencePrice: structuredClone(referencePrice),
    paperEligibility: normalized.action !== 'observe'
      && normalized.positionChange !== null
      && normalized.asset.supported
      ? { eligible: true, reason: 'supported_reference_price' }
      : normalized.paperEligibility,
  };
  return validateSignal(candidate, { now });
}
