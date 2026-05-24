import {
  isV2Crypto,
  isV2Commodity,
  isV2HeatmapCategory,
} from '../../lib/market/symbolMaps.js';

/** Overlay v2 spot fields onto a commodity row (price / change only). */
export function overlayV2Fields(base, v2Row) {
  if (!base || !v2Row) return base;
  return {
    ...base,
    price: v2Row.price,
    changePct: v2Row.changePct,
    changeAbs: v2Row.changeAbs,
    marketSource: v2Row.source,
    marketStale: Boolean(v2Row.stale),
  };
}

/** Ticker strip: crypto only from v2. */
export function resolveTickerAsset(asset, v2ByTicker, useV2) {
  if (!useV2 || !asset || !isV2Crypto(asset.ticker)) return asset;
  const v2 = v2ByTicker[asset.ticker];
  return v2 ? overlayV2Fields(asset, v2) : asset;
}

/** Sector / prices heatmap: commodity categories from v2. */
export function resolveHeatmapAsset(asset, v2ByTicker, useV2) {
  if (!useV2 || !asset || !isV2HeatmapCategory(asset.category)) return asset;
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
  if (!useV2 || !asset) return asset;
  const v2 = v2ByTicker[asset.ticker];
  if (!v2) return asset;
  if (isV2Crypto(asset.ticker) || isV2Commodity(asset.ticker)) {
    return overlayV2Fields(asset, v2);
  }
  return asset;
}

/** LIVE/STALE from snapshot age only (30 min), not AV cache gaps. */
export function dataModeFromState({ useV2, fetchedAt, loading }) {
  if (!useV2) return 'MOCK';
  if (loading && !fetchedAt) return 'MOCK';
  if (!fetchedAt) return 'STALE';
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  return ageMs > 30 * 60 * 1000 ? 'STALE' : 'LIVE';
}

export function secondsAgo(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}
