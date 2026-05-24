/**
 * Maps dashboard tickers → upstream provider identifiers.
 * Canonical source per symbol avoids duplicate WTI/Brent rows.
 */

/** @type {Record<string, string>} ticker → CoinGecko id */
export const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  MATIC: 'polygon-ecosystem-token',
  ATOM: 'cosmos',
  NEAR: 'near',
  APT: 'aptos',
  LTC: 'litecoin',
  TRX: 'tron',
};

/** @type {{ ticker: string, fn: string, unit?: string }[]} */
export const ALPHA_VANTAGE_COMMODITIES = [
  { ticker: 'CL', fn: 'WTI', unit: '$/bbl' },
  { ticker: 'BZ', fn: 'BRENT', unit: '$/bbl' },
  { ticker: 'HG', fn: 'COPPER', unit: '$/lb' },
  { ticker: 'ZW', fn: 'WHEAT', unit: '¢/bu' },
  { ticker: 'ZC', fn: 'CORN', unit: '¢/bu' },
];

/**
 * EIA v2 routes — latest 2 periods for % change.
 * @see https://www.eia.gov/opendata/documentation.php
 */
export const EIA_SERIES = [
  {
    ticker: 'NG',
    route: 'natural-gas/pri/fut/data/',
    facets: { series: ['RNGWHHD'] },
    frequency: 'daily',
    name: 'Natural Gas (Henry Hub)',
    unit: '$/MMBtu',
  },
];

export const CRYPTO_TICKERS = Object.keys(COINGECKO_IDS);
export const AV_TICKERS = ALPHA_VANTAGE_COMMODITIES.map((x) => x.ticker);
export const EIA_TICKERS = EIA_SERIES.map((x) => x.ticker);

/** Tickers that receive v2 API overlay (not Yahoo). */
export const V2_COMMODITY_TICKERS = new Set([...AV_TICKERS, ...EIA_TICKERS]);
export const V2_CRYPTO_TICKERS = new Set(CRYPTO_TICKERS);
export const V2_HEATMAP_CATEGORIES = new Set(['ENERGY', 'METALS', 'AGRICULTURE', 'CRYPTO']);

export const isV2Crypto = (ticker) => V2_CRYPTO_TICKERS.has(ticker);
export const isV2Commodity = (ticker) => V2_COMMODITY_TICKERS.has(ticker);
export const isV2HeatmapCategory = (cat) => V2_HEATMAP_CATEGORIES.has(cat);
