// Shared symbol catalogue for prices/history APIs.
// Each entry maps a friendly ticker to a Yahoo Finance symbol.

export const SYMBOLS = [
  // ENERGY (futures)
  { ticker: 'CL',   symbol: 'WTI',     name: 'WTI Crude',        category: 'ENERGY',      unit: '$/bbl',   yahoo: 'CL=F' },
  { ticker: 'BZ',   symbol: 'BRENT',   name: 'Brent Crude',      category: 'ENERGY',      unit: '$/bbl',   yahoo: 'BZ=F' },
  { ticker: 'NG',   symbol: 'NATGAS',  name: 'Natural Gas',      category: 'ENERGY',      unit: '$/MMBtu', yahoo: 'NG=F' },

  // METALS (futures)
  { ticker: 'GC',   symbol: 'GOLD',    name: 'Gold',             category: 'METALS',      unit: '$/oz',    yahoo: 'GC=F' },
  { ticker: 'SI',   symbol: 'SILVER',  name: 'Silver',           category: 'METALS',      unit: '$/oz',    yahoo: 'SI=F' },
  { ticker: 'HG',   symbol: 'COPPER',  name: 'Copper',           category: 'METALS',      unit: '$/lb',    yahoo: 'HG=F' },

  // AGRICULTURE (futures)
  { ticker: 'ZW',   symbol: 'WHEAT',   name: 'Wheat',            category: 'AGRICULTURE', unit: '¢/bu',    yahoo: 'ZW=F' },
  { ticker: 'ZC',   symbol: 'CORN',    name: 'Corn',             category: 'AGRICULTURE', unit: '¢/bu',    yahoo: 'ZC=F' },
  { ticker: 'ZS',   symbol: 'SOY',     name: 'Soybeans',         category: 'AGRICULTURE', unit: '¢/bu',    yahoo: 'ZS=F' },

  // TECH (mega-cap and popular)
  { ticker: 'AAPL', symbol: 'AAPL',    name: 'Apple',            category: 'TECH',        unit: '$',       yahoo: 'AAPL' },
  { ticker: 'MSFT', symbol: 'MSFT',    name: 'Microsoft',        category: 'TECH',        unit: '$',       yahoo: 'MSFT' },
  { ticker: 'NVDA', symbol: 'NVDA',    name: 'Nvidia',           category: 'TECH',        unit: '$',       yahoo: 'NVDA' },
  { ticker: 'GOOGL',symbol: 'GOOGL',   name: 'Alphabet',         category: 'TECH',        unit: '$',       yahoo: 'GOOGL' },
  { ticker: 'META', symbol: 'META',    name: 'Meta Platforms',   category: 'TECH',        unit: '$',       yahoo: 'META' },
  { ticker: 'AMZN', symbol: 'AMZN',    name: 'Amazon',           category: 'TECH',        unit: '$',       yahoo: 'AMZN' },
  { ticker: 'TSLA', symbol: 'TSLA',    name: 'Tesla',            category: 'TECH',        unit: '$',       yahoo: 'TSLA' },
  { ticker: 'AVGO', symbol: 'AVGO',    name: 'Broadcom',         category: 'TECH',        unit: '$',       yahoo: 'AVGO' },
  { ticker: 'AMD',  symbol: 'AMD',     name: 'AMD',              category: 'TECH',        unit: '$',       yahoo: 'AMD' },
  { ticker: 'NFLX', symbol: 'NFLX',    name: 'Netflix',          category: 'TECH',        unit: '$',       yahoo: 'NFLX' },
  { ticker: 'TSM',  symbol: 'TSM',     name: 'TSMC',             category: 'TECH',        unit: '$',       yahoo: 'TSM' },

  // DATA / AI infrastructure & momentum
  { ticker: 'PLTR', symbol: 'PLTR',    name: 'Palantir',         category: 'DATA',        unit: '$',       yahoo: 'PLTR' },
  { ticker: 'SNOW', symbol: 'SNOW',    name: 'Snowflake',        category: 'DATA',        unit: '$',       yahoo: 'SNOW' },
  { ticker: 'NET',  symbol: 'NET',     name: 'Cloudflare',       category: 'DATA',        unit: '$',       yahoo: 'NET' },
  { ticker: 'DDOG', symbol: 'DDOG',    name: 'Datadog',          category: 'DATA',        unit: '$',       yahoo: 'DDOG' },
  { ticker: 'MDB',  symbol: 'MDB',     name: 'MongoDB',          category: 'DATA',        unit: '$',       yahoo: 'MDB' },
  { ticker: 'CRWD', symbol: 'CRWD',    name: 'CrowdStrike',      category: 'DATA',        unit: '$',       yahoo: 'CRWD' },
  { ticker: 'AI',   symbol: 'AI',      name: 'C3.ai',            category: 'DATA',        unit: '$',       yahoo: 'AI' },
  { ticker: 'SMCI', symbol: 'SMCI',    name: 'Super Micro',      category: 'DATA',        unit: '$',       yahoo: 'SMCI' },
  { ticker: 'ARM',  symbol: 'ARM',     name: 'Arm Holdings',     category: 'DATA',        unit: '$',       yahoo: 'ARM' },
  { ticker: 'COIN', symbol: 'COIN',    name: 'Coinbase',         category: 'DATA',        unit: '$',       yahoo: 'COIN' },

  // CRYPTO (top-cap)
  { ticker: 'BTC',  symbol: 'BTC',     name: 'Bitcoin',          category: 'CRYPTO',      unit: '$',       yahoo: 'BTC-USD' },
  { ticker: 'ETH',  symbol: 'ETH',     name: 'Ethereum',         category: 'CRYPTO',      unit: '$',       yahoo: 'ETH-USD' },
  { ticker: 'SOL',  symbol: 'SOL',     name: 'Solana',           category: 'CRYPTO',      unit: '$',       yahoo: 'SOL-USD' },
  { ticker: 'BNB',  symbol: 'BNB',     name: 'BNB',              category: 'CRYPTO',      unit: '$',       yahoo: 'BNB-USD' },
  { ticker: 'XRP',  symbol: 'XRP',     name: 'Ripple',           category: 'CRYPTO',      unit: '$',       yahoo: 'XRP-USD' },
  { ticker: 'DOGE', symbol: 'DOGE',    name: 'Dogecoin',         category: 'CRYPTO',      unit: '$',       yahoo: 'DOGE-USD' },
  { ticker: 'ADA',  symbol: 'ADA',     name: 'Cardano',          category: 'CRYPTO',      unit: '$',       yahoo: 'ADA-USD' },
  { ticker: 'AVAX', symbol: 'AVAX',    name: 'Avalanche',        category: 'CRYPTO',      unit: '$',       yahoo: 'AVAX-USD' },
  { ticker: 'DOT',  symbol: 'DOT',     name: 'Polkadot',         category: 'CRYPTO',      unit: '$',       yahoo: 'DOT-USD' },
  { ticker: 'LINK', symbol: 'LINK',    name: 'Chainlink',        category: 'CRYPTO',      unit: '$',       yahoo: 'LINK-USD' },

  // MACRO indicators
  { ticker: 'SPX',  symbol: 'SPX',     name: 'S&P 500',          category: 'MACRO',       unit: 'index',   yahoo: '^GSPC' },
  { ticker: 'NDX',  symbol: 'NDX',     name: 'Nasdaq Composite', category: 'MACRO',       unit: 'index',   yahoo: '^IXIC' },
  { ticker: 'DJI',  symbol: 'DJI',     name: 'Dow Jones',        category: 'MACRO',       unit: 'index',   yahoo: '^DJI' },
  { ticker: 'VIX',  symbol: 'VIX',     name: 'CBOE Volatility',  category: 'MACRO',       unit: 'index',   yahoo: '^VIX' },
  { ticker: 'US10Y',symbol: 'US10Y',   name: 'US 10Y Yield',     category: 'MACRO',       unit: '%',       yahoo: '^TNX' },
  { ticker: 'DXY',  symbol: 'DXY',     name: 'US Dollar Index',  category: 'MACRO',       unit: 'index',   yahoo: 'DX=F' },
];

export const ALLOWED_RANGES = {
  '1d':  { range: '1d',  interval: '5m'  },
  '5d':  { range: '5d',  interval: '30m' },
  '1mo': { range: '1mo', interval: '1d'  },
  '3mo': { range: '3mo', interval: '1d'  },
  '6mo': { range: '6mo', interval: '1d'  },
  '1y':  { range: '1y',  interval: '1wk' },
  'ytd': { range: 'ytd', interval: '1d'  },
};

export const findSymbol = (ticker) =>
  SYMBOLS.find((s) => s.ticker.toUpperCase() === String(ticker || '').toUpperCase());
