export const HYPERLIQUID_MIN_ACCOUNT_VALUE_USD = 1_000_000;
export const HYPERLIQUID_MIN_VOLUME_30D_USD = 5_000_000;
export const POLYMARKET_MIN_ALL_TIME_PNL_USD = 100_000;
export const POLYMARKET_MIN_VOLUME_30D_USD = 250_000;
export const MAX_ABS_ROI_PCT = 1_000;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function anomaly(performance) {
  const values = ['day', 'month', 'allTime'].flatMap((window) => {
    const value = performance?.windows?.[window]?.roiPct;
    return value === null || value === undefined ? [] : [value];
  });
  return values.some((value) => !finite(value) || Math.abs(value) > MAX_ABS_ROI_PCT)
    || (performance?.accountValueUsd != null && (!finite(performance.accountValueUsd) || performance.accountValueUsd < 0));
}

export function qualifyCryptoAccount(performance, options = {}) {
  const reasons = [];
  const month = performance?.windows?.month;
  const allTime = performance?.windows?.allTime;
  const venue = performance?.venue;
  if (!performance || performance.scope !== 'account' || performance.notComparableAcrossProviders !== true) reasons.push('missing_provider_scope');
  if (performance?.freshness === 'stale' || options.freshness === 'stale') reasons.push('stale');
  if (options.duplicate === true) reasons.push('duplicate');
  if (options.attributable === false || performance?.sourceUrl === null) reasons.push('not_attributable');
  if (anomaly(performance)) reasons.push('anomalous_metric');
  if (!month || !allTime || !finite(month.pnlUsd) || !finite(allTime.pnlUsd)
      || month.pnlUsd <= 0 || allTime.pnlUsd <= 0) reasons.push('nonpositive_pnl');
  if (venue === 'hyperliquid') {
    if (performance.providerId !== 'hyperliquid-leaderboard') reasons.push('provider_venue_mismatch');
    if (!finite(performance.accountValueUsd) || performance.accountValueUsd < HYPERLIQUID_MIN_ACCOUNT_VALUE_USD) reasons.push('account_value_below_threshold');
    if (!finite(month?.volumeUsd) || month.volumeUsd < HYPERLIQUID_MIN_VOLUME_30D_USD) reasons.push('volume_below_threshold');
  } else if (venue === 'polymarket') {
    if (performance.providerId !== 'polymarket-leaderboard') reasons.push('provider_venue_mismatch');
    if (performance.category != null && String(performance.category).toLowerCase() !== 'crypto') reasons.push('not_crypto_category');
    if (!finite(allTime?.pnlUsd) || allTime.pnlUsd < POLYMARKET_MIN_ALL_TIME_PNL_USD) reasons.push('pnl_below_threshold');
    if (!finite(month?.volumeUsd) || month.volumeUsd < POLYMARKET_MIN_VOLUME_30D_USD) reasons.push('volume_below_threshold');
  } else {
    reasons.push('unsupported_venue');
  }
  return { eligible: reasons.length === 0, reasons };
}

export function rankCryptoAccounts(accounts, options = {}) {
  const venue = options.venue;
  const window = options.window || 'month';
  if (!['hyperliquid', 'polymarket'].includes(venue) || !['day', 'month', 'allTime'].includes(window)) return [];
  const scoped = (Array.isArray(accounts) ? accounts : []).filter((account) => account?.venue === venue);
  const counts = scoped.reduce((result, account) => {
    const key = `${account?.providerId}\u0000${account?.id}`;
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map());
  return scoped
    .filter((account) => counts.get(`${account?.providerId}\u0000${account?.id}`) === 1)
    .map((account) => ({ account, qualification: qualifyCryptoAccount(account, options) }))
    .filter((item) => item.qualification.eligible)
    .sort((left, right) => {
      const leftPnl = left.account.windows?.[window]?.pnlUsd ?? -Infinity;
      const rightPnl = right.account.windows?.[window]?.pnlUsd ?? -Infinity;
      return rightPnl - leftPnl
        || String(left.account.entityId).localeCompare(String(right.account.entityId))
        || String(left.account.id).localeCompare(String(right.account.id));
    })
    .map(({ account }) => structuredClone(account));
}

export function rankInvestors(entities, activities) {
  const activityRows = Array.isArray(activities) ? activities : [];
  const evidenceFor = (entity) => {
    const entityCoverage = Array.isArray(entity?.evidenceCoverage) ? entity.evidenceCoverage.length : 0;
    const matching = activityRows.filter((activity) => activity?.entityId === entity?.id);
    const fresh = matching.filter((activity) => activity.freshness === 'fresh');
    const newest = fresh.reduce((value, activity) => Math.max(value, Date.parse(activity.observedAt) || 0), 0);
    return { fresh: fresh.length > 0 ? 1 : 0, coverage: entityCoverage + matching.length, newest };
  };
  return (Array.isArray(entities) ? entities : [])
    .map((entity) => ({ entity, evidence: evidenceFor(entity) }))
    .sort((left, right) => right.evidence.fresh - left.evidence.fresh
      || right.evidence.coverage - left.evidence.coverage
      || right.evidence.newest - left.evidence.newest
      || String(left.entity.id).localeCompare(String(right.entity.id)))
    .map(({ entity }) => {
      const { followed: _followed, ...publicEntity } = entity;
      return structuredClone(publicEntity);
    });
}
