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

  // TECH (mega-cap)
  { ticker: 'AAPL', symbol: 'AAPL',    name: 'Apple',            category: 'TECH',        unit: '$',       yahoo: 'AAPL' },
  { ticker: 'MSFT', symbol: 'MSFT',    name: 'Microsoft',        category: 'TECH',        unit: '$',       yahoo: 'MSFT' },
  { ticker: 'NVDA', symbol: 'NVDA',    name: 'Nvidia',           category: 'TECH',        unit: '$',       yahoo: 'NVDA' },
  { ticker: 'GOOGL',symbol: 'GOOGL',   name: 'Alphabet',         category: 'TECH',        unit: '$',       yahoo: 'GOOGL' },
  { ticker: 'META', symbol: 'META',    name: 'Meta Platforms',   category: 'TECH',        unit: '$',       yahoo: 'META' },
  { ticker: 'TSLA', symbol: 'TSLA',    name: 'Tesla',            category: 'TECH',        unit: '$',       yahoo: 'TSLA' },

  // DATA / AI infrastructure
  { ticker: 'PLTR', symbol: 'PLTR',    name: 'Palantir',         category: 'DATA',        unit: '$',       yahoo: 'PLTR' },
  { ticker: 'SNOW', symbol: 'SNOW',    name: 'Snowflake',        category: 'DATA',        unit: '$',       yahoo: 'SNOW' },
  { ticker: 'NET',  symbol: 'NET',     name: 'Cloudflare',       category: 'DATA',        unit: '$',       yahoo: 'NET' },
  { ticker: 'DDOG', symbol: 'DDOG',    name: 'Datadog',          category: 'DATA',        unit: '$',       yahoo: 'DDOG' },
  { ticker: 'MDB',  symbol: 'MDB',     name: 'MongoDB',          category: 'DATA',        unit: '$',       yahoo: 'MDB' },
  { ticker: 'CRWD', symbol: 'CRWD',    name: 'CrowdStrike',      category: 'DATA',        unit: '$',       yahoo: 'CRWD' },

  // CRYPTO
  { ticker: 'BTC',  symbol: 'BTC',     name: 'Bitcoin',          category: 'CRYPTO',      unit: '$',       yahoo: 'BTC-USD' },
  { ticker: 'ETH',  symbol: 'ETH',     name: 'Ethereum',         category: 'CRYPTO',      unit: '$',       yahoo: 'ETH-USD' },
  { ticker: 'SOL',  symbol: 'SOL',     name: 'Solana',           category: 'CRYPTO',      unit: '$',       yahoo: 'SOL-USD' },
  { ticker: 'DOGE', symbol: 'DOGE',    name: 'Dogecoin',         category: 'CRYPTO',      unit: '$',       yahoo: 'DOGE-USD' },
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
