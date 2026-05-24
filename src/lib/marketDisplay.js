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

export function dataModeFromState({ useV2, fetchedAt, staleProviders, loading }) {
  if (!useV2) return 'MOCK';
  if (loading && !fetchedAt) return 'MOCK';
  const stale = Array.isArray(staleProviders) && staleProviders.length > 0;
  if (!fetchedAt) return stale ? 'STALE' : 'MOCK';
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  if (ageMs > 30 * 60 * 1000 || stale) return 'STALE';
  return 'LIVE';
}

export function minutesAgo(iso) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return Math.max(0, m);
}
