import { normalizeAsset, safeIdentifier, schemaInvalid, validateSignal } from './contracts.js';

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

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
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
  return `${change.entityId}\u0000${change.asset?.ticker || change.asset?.providerSymbol}`;
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
  if (['new', 'exited'].includes(change.classification)) return true;
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
  const changes = Array.isArray(input.changes) ? input.changes : [];
  const incomingPending = Array.isArray(input.pendingConfirmations) ? input.pendingConfirmations : [];
  const inferredNowMs = changes.reduce((latest, change) => Math.max(latest, Date.parse(change?.observedAt) || 0), 0);
  const nowMs = input.nowMs ?? inferredNowMs;
  if (!finite(nowMs) || nowMs < 0) throw schemaInvalid();
  const now = new Date(nowMs);
  const pendingByKey = new Map(incomingPending.map((pending) => [
    `${pending.entityId}\u0000${pending.assetTicker || pending.providerSymbol}`, structuredClone(pending),
  ]));
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
