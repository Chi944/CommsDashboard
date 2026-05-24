import { SYMBOLS } from '../symbols.js';
import { AV_TICKERS, CRYPTO_TICKERS, EIA_TICKERS } from './symbolMaps.js';

const LIVE_TICKERS = new Set([...CRYPTO_TICKERS, ...AV_TICKERS, ...EIA_TICKERS]);

/**
 * Merge live provider rows into full SYMBOLS catalogue shape.
 * Live rows override mock/Yahoo for mapped tickers only.
 *
 * @param {object[]} liveRows
 * @param {object[]} [fallbackRows] optional mock catalogue rows
 */
export function mergeMarketSnapshot(liveRows, fallbackRows = []) {
  const liveByTicker = Object.fromEntries(liveRows.map((r) => [r.ticker, r]));
  const fallbackByTicker = Object.fromEntries(fallbackRows.map((r) => [r.ticker, r]));

  const commodities = SYMBOLS.filter((s) => s.category !== 'FX').map((s) => {
    const live = liveByTicker[s.ticker];
    const fb = fallbackByTicker[s.ticker];
    if (live) {
      return {
        ...(fb || s),
        ...live,
        history: fb?.history?.length ? fb.history : live.history || [],
      };
    }
    return fb ? { ...s, ...fb } : null;
  }).filter(Boolean);

  const sources = {
    coingecko: liveRows.filter((r) => r.source === 'coingecko').length,
    alphavantage: liveRows.filter((r) => r.source === 'alphavantage').length,
    eia: liveRows.filter((r) => r.source === 'eia').length,
  };

  const staleProviders = [];
  if (liveRows.some((r) => r.source === 'alphavantage' && r.stale)) staleProviders.push('alphavantage');
  if (liveRows.some((r) => r.source === 'eia' && r.stale)) staleProviders.push('eia');

  return {
    commodities,
    meta: {
      liveSymbolCount: liveRows.filter((r) => LIVE_TICKERS.has(r.ticker)).length,
      liveTickers: [...LIVE_TICKERS],
      sources,
      staleProviders,
    },
  };
}
