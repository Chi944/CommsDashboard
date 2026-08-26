import { SYMBOLS } from '../symbols.js';
import { CRYPTO_TICKERS, EIA_TICKERS } from './symbolMaps.js';

const LIVE_TICKERS = new Set([...CRYPTO_TICKERS, ...EIA_TICKERS]);

/**
 * Merge live provider rows into full SYMBOLS catalogue shape.
 * Live rows override mock/Yahoo for mapped tickers only.
 *
 * @param {object[]} liveRows
 * @param {object[]} [fallbackRows] optional mock catalogue rows
 * @param {{ disabledTickers?: string[] }} [options]
 */
export function mergeMarketSnapshot(liveRows, fallbackRows = [], options = {}) {
  const disabledTickers = new Set(options.disabledTickers || []);
  const liveTickers = [...LIVE_TICKERS].filter((ticker) => !disabledTickers.has(ticker));
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
      liveSymbolCount: liveRows.filter((r) => liveTickers.includes(r.ticker)).length,
      liveTickers,
      sources,
      staleProviders,
    },
  };
}
