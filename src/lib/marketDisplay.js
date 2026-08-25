import {
  isV2Crypto,
  isV2Commodity,
  isV2HeatmapCategory,
} from '../../lib/market/symbolMaps.js';

/** Overlay a trusted V2 spot observation while retaining Yahoo session change. */
export function overlayV2Fields(base, v2Row) {
  if (!base || !v2Row) return base;
  const hasTrustedYahooBaseline = isTrustedMarketRow(base);
  const observedAtMs = typeof v2Row.asOf === 'string' ? Date.parse(v2Row.asOf) : Number.NaN;
  const hasObservationTime = Number.isFinite(observedAtMs);
  const v2Stale = v2Row.stale !== false || !hasObservationTime;
  if (hasTrustedYahooBaseline && v2Stale) return base;
  return {
    ...base,
    price: v2Row.price,
    ...(!hasTrustedYahooBaseline ? { changePct: null, changeAbs: null } : {}),
    source: v2Row.source,
    asOf: hasObservationTime ? new Date(observedAtMs).toISOString() : null,
    stale: v2Stale,
    isLive: hasTrustedYahooBaseline && !v2Stale,
    marketSource: v2Row.source,
    marketStale: v2Stale,
  };
}

/** Merge a partial Yahoo payload without disguising catalogue fallbacks as live rows. */
export function mergeYahooPriceRows(fallbackRows, payload) {
  const liveRows = Array.isArray(payload?.commodities) ? payload.commodities : [];
  const liveByTicker = new Map(liveRows.map((row) => [row.ticker, row]));
  return fallbackRows.map((fallback) => {
    const live = liveByTicker.get(fallback.ticker);
    if (!live) {
      return {
        ...fallback,
        source: 'mock',
        asOf: null,
        stale: true,
        isLive: false,
      };
    }
    return {
      ...fallback,
      ...live,
      source: live.source || payload?.source || 'yahoo',
      asOf: live.asOf || null,
      stale: Boolean(live.stale),
      isLive: true,
    };
  });
}

/** Rows safe to use for rankings, market signals, and price alerts. */
export function isTrustedMarketRow(row) {
  return Boolean(
    row
    && row.source
    && row.source !== 'mock'
    && row.source !== 'fallback'
    && row.isLive !== false
    && row.stale !== true,
  );
}

export function trustedMarketRows(rows) {
  return (rows || []).filter(isTrustedMarketRow);
}

/** Ticker strip: crypto only from v2. */
export function resolveTickerAsset(asset, v2ByTicker, useV2) {
  if (!useV2 || !asset || !v2ByTicker || !isV2Crypto(asset.ticker)) return asset;
  const v2 = v2ByTicker[asset.ticker];
  return v2 ? overlayV2Fields(asset, v2) : asset;
}

/** Sector / prices heatmap: commodity categories from v2. */
export function resolveHeatmapAsset(asset, v2ByTicker, useV2) {
  if (!useV2 || !asset || !v2ByTicker || !isV2HeatmapCategory(asset.category)) return asset;
  const v2 = v2ByTicker[asset.ticker];
  if (!v2) return asset;
  if (asset.category === 'CRYPTO' && !isV2Crypto(asset.ticker)) return asset;
  if (['ENERGY', 'METALS', 'AGRICULTURE'].includes(asset.category) && !isV2Commodity(asset.ticker)) {
    return asset;
  }
  return overlayV2Fields(asset, v2);
}

/** Prices table: last price column for v2-eligible tickers only. */
export function resolveTablePrice(asset, v2ByTicker, useV2) {
  if (!useV2 || !asset || !v2ByTicker) return asset;
  const v2 = v2ByTicker[asset.ticker];
  if (!v2) return asset;
  if (isV2Crypto(asset.ticker) || isV2Commodity(asset.ticker)) {
    return overlayV2Fields(asset, v2);
  }
  return asset;
}

/** Global market health: freshness plus coverage/provenance, for Yahoo and v2. */
export function dataModeFromState({
  fetchedAt,
  hasLiveRows,
  liveRowCount,
  staleRowCount = 0,
  partial = false,
  failed = false,
}) {
  if (!fetchedAt) return 'STALE';
  const fetchedMs = new Date(fetchedAt).getTime();
  const ageMs = Date.now() - fetchedMs;
  if (!Number.isFinite(fetchedMs) || ageMs > 30 * 60 * 1000) return 'STALE';

  const hasRows = hasLiveRows ?? (liveRowCount == null ? true : liveRowCount > 0);
  if (!hasRows) return 'STALE';
  if (liveRowCount > 0 && staleRowCount >= liveRowCount) return 'STALE';
  if (partial || failed || staleRowCount > 0) return 'DEGRADED';
  return 'LIVE';
}

export function combineDataModes(first, second, options = {}) {
  if (first === 'LIVE' && options.supplementalFallbackCovered) return 'LIVE';
  if (first === 'LIVE' && second === 'LIVE') return 'LIVE';
  if (first === 'STALE' && second === 'STALE') return 'STALE';
  return 'DEGRADED';
}

export function dataModeLabel(mode) {
  return ({ LIVE: 'live', DEGRADED: 'degraded', STALE: 'stale', MOCK: 'mock' })[mode] || 'unknown';
}

export function secondsAgo(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}
