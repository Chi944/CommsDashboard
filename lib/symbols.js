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
  { ticker: 'GOOGL',symbol: 'GOOGL',   name: 'Alphabet',         category: 'TECH',        unit: '$',       yahoo: 'GOOGL' },
  { ticker: 'META', symbol: 'META',    name: 'Meta Platforms',   category: 'TECH',        unit: '$',       yahoo: 'META' },
  { ticker: 'AMZN', symbol: 'AMZN',    name: 'Amazon',           category: 'TECH',        unit: '$',       yahoo: 'AMZN' },
  { ticker: 'NFLX', symbol: 'NFLX',    name: 'Netflix',          category: 'TECH',        unit: '$',       yahoo: 'NFLX' },
  { ticker: 'ADBE', symbol: 'ADBE',    name: 'Adobe',            category: 'TECH',        unit: '$',       yahoo: 'ADBE' },
  { ticker: 'CRM',  symbol: 'CRM',     name: 'Salesforce',       category: 'TECH',        unit: '$',       yahoo: 'CRM' },
  { ticker: 'ORCL', symbol: 'ORCL',    name: 'Oracle',           category: 'TECH',        unit: '$',       yahoo: 'ORCL' },
  { ticker: 'IBM',  symbol: 'IBM',     name: 'IBM',              category: 'TECH',        unit: '$',       yahoo: 'IBM' },

  // SEMI (chips)
  { ticker: 'NVDA', symbol: 'NVDA',    name: 'Nvidia',           category: 'SEMI',        unit: '$',       yahoo: 'NVDA' },
  { ticker: 'AVGO', symbol: 'AVGO',    name: 'Broadcom',         category: 'SEMI',        unit: '$',       yahoo: 'AVGO' },
  { ticker: 'AMD',  symbol: 'AMD',     name: 'AMD',              category: 'SEMI',        unit: '$',       yahoo: 'AMD' },
  { ticker: 'TSM',  symbol: 'TSM',     name: 'TSMC',             category: 'SEMI',        unit: '$',       yahoo: 'TSM' },
  { ticker: 'INTC', symbol: 'INTC',    name: 'Intel',            category: 'SEMI',        unit: '$',       yahoo: 'INTC' },
  { ticker: 'MU',   symbol: 'MU',      name: 'Micron',           category: 'SEMI',        unit: '$',       yahoo: 'MU' },
  { ticker: 'QCOM', symbol: 'QCOM',    name: 'Qualcomm',         category: 'SEMI',        unit: '$',       yahoo: 'QCOM' },
  { ticker: 'ASML', symbol: 'ASML',    name: 'ASML',             category: 'SEMI',        unit: '$',       yahoo: 'ASML' },
  { ticker: 'AMAT', symbol: 'AMAT',    name: 'Applied Materials',category: 'SEMI',        unit: '$',       yahoo: 'AMAT' },

  // DATA / AI / cyber / fintech
  { ticker: 'PLTR', symbol: 'PLTR',    name: 'Palantir',         category: 'DATA',        unit: '$',       yahoo: 'PLTR' },
  { ticker: 'SNOW', symbol: 'SNOW',    name: 'Snowflake',        category: 'DATA',        unit: '$',       yahoo: 'SNOW' },
  { ticker: 'NET',  symbol: 'NET',     name: 'Cloudflare',       category: 'DATA',        unit: '$',       yahoo: 'NET' },
  { ticker: 'DDOG', symbol: 'DDOG',    name: 'Datadog',          category: 'DATA',        unit: '$',       yahoo: 'DDOG' },
  { ticker: 'MDB',  symbol: 'MDB',     name: 'MongoDB',          category: 'DATA',        unit: '$',       yahoo: 'MDB' },
  { ticker: 'CRWD', symbol: 'CRWD',    name: 'CrowdStrike',      category: 'DATA',        unit: '$',       yahoo: 'CRWD' },
  { ticker: 'PANW', symbol: 'PANW',    name: 'Palo Alto Nets',   category: 'DATA',        unit: '$',       yahoo: 'PANW' },
  { ticker: 'AI',   symbol: 'AI',      name: 'C3.ai',            category: 'DATA',        unit: '$',       yahoo: 'AI' },
  { ticker: 'SMCI', symbol: 'SMCI',    name: 'Super Micro',      category: 'DATA',        unit: '$',       yahoo: 'SMCI' },
  { ticker: 'ARM',  symbol: 'ARM',     name: 'Arm Holdings',     category: 'DATA',        unit: '$',       yahoo: 'ARM' },
  { ticker: 'COIN', symbol: 'COIN',    name: 'Coinbase',         category: 'DATA',        unit: '$',       yahoo: 'COIN' },

  // AUTO / EV
  { ticker: 'TSLA', symbol: 'TSLA',    name: 'Tesla',            category: 'AUTO',        unit: '$',       yahoo: 'TSLA' },
  { ticker: 'RIVN', symbol: 'RIVN',    name: 'Rivian',           category: 'AUTO',        unit: '$',       yahoo: 'RIVN' },
  { ticker: 'LCID', symbol: 'LCID',    name: 'Lucid',            category: 'AUTO',        unit: '$',       yahoo: 'LCID' },
  { ticker: 'NIO',  symbol: 'NIO',     name: 'NIO',              category: 'AUTO',        unit: '$',       yahoo: 'NIO' },
  { ticker: 'F',    symbol: 'F',       name: 'Ford',             category: 'AUTO',        unit: '$',       yahoo: 'F' },
  { ticker: 'GM',   symbol: 'GM',      name: 'General Motors',   category: 'AUTO',        unit: '$',       yahoo: 'GM' },

  // FINANCE
  { ticker: 'JPM',   symbol: 'JPM',    name: 'JPMorgan',         category: 'FINANCE',     unit: '$',       yahoo: 'JPM' },
  { ticker: 'BAC',   symbol: 'BAC',    name: 'Bank of America',  category: 'FINANCE',     unit: '$',       yahoo: 'BAC' },
  { ticker: 'GS',    symbol: 'GS',     name: 'Goldman Sachs',    category: 'FINANCE',     unit: '$',       yahoo: 'GS' },
  { ticker: 'WFC',   symbol: 'WFC',    name: 'Wells Fargo',      category: 'FINANCE',     unit: '$',       yahoo: 'WFC' },
  { ticker: 'C',     symbol: 'C',      name: 'Citigroup',        category: 'FINANCE',     unit: '$',       yahoo: 'C' },
  { ticker: 'V',     symbol: 'V',      name: 'Visa',             category: 'FINANCE',     unit: '$',       yahoo: 'V' },
  { ticker: 'MA',    symbol: 'MA',     name: 'Mastercard',       category: 'FINANCE',     unit: '$',       yahoo: 'MA' },
  { ticker: 'BRK-B', symbol: 'BRK.B',  name: 'Berkshire Hathaway',category: 'FINANCE',    unit: '$',       yahoo: 'BRK-B' },

  // HEALTH
  { ticker: 'LLY',  symbol: 'LLY',     name: 'Eli Lilly',        category: 'HEALTH',      unit: '$',       yahoo: 'LLY' },
  { ticker: 'UNH',  symbol: 'UNH',     name: 'UnitedHealth',     category: 'HEALTH',      unit: '$',       yahoo: 'UNH' },
  { ticker: 'JNJ',  symbol: 'JNJ',     name: 'Johnson & Johnson',category: 'HEALTH',      unit: '$',       yahoo: 'JNJ' },
  { ticker: 'PFE',  symbol: 'PFE',     name: 'Pfizer',           category: 'HEALTH',      unit: '$',       yahoo: 'PFE' },
  { ticker: 'MRNA', symbol: 'MRNA',    name: 'Moderna',          category: 'HEALTH',      unit: '$',       yahoo: 'MRNA' },
  { ticker: 'ABT',  symbol: 'ABT',     name: 'Abbott',           category: 'HEALTH',      unit: '$',       yahoo: 'ABT' },
  { ticker: 'NVO',  symbol: 'NVO',     name: 'Novo Nordisk',     category: 'HEALTH',      unit: '$',       yahoo: 'NVO' },

  // CONSUMER
  { ticker: 'WMT',  symbol: 'WMT',     name: 'Walmart',          category: 'CONSUMER',    unit: '$',       yahoo: 'WMT' },
  { ticker: 'COST', symbol: 'COST',    name: 'Costco',           category: 'CONSUMER',    unit: '$',       yahoo: 'COST' },
  { ticker: 'HD',   symbol: 'HD',      name: 'Home Depot',       category: 'CONSUMER',    unit: '$',       yahoo: 'HD' },
  { ticker: 'MCD',  symbol: 'MCD',     name: "McDonald's",       category: 'CONSUMER',    unit: '$',       yahoo: 'MCD' },
  { ticker: 'KO',   symbol: 'KO',      name: 'Coca-Cola',        category: 'CONSUMER',    unit: '$',       yahoo: 'KO' },
  { ticker: 'NKE',  symbol: 'NKE',     name: 'Nike',             category: 'CONSUMER',    unit: '$',       yahoo: 'NKE' },
  { ticker: 'DIS',  symbol: 'DIS',     name: 'Disney',           category: 'CONSUMER',    unit: '$',       yahoo: 'DIS' },
  { ticker: 'SBUX', symbol: 'SBUX',    name: 'Starbucks',        category: 'CONSUMER',    unit: '$',       yahoo: 'SBUX' },

  // MOMENTUM / popular speculative
  { ticker: 'HOOD', symbol: 'HOOD',    name: 'Robinhood',        category: 'MOMENTUM',    unit: '$',       yahoo: 'HOOD' },
  { ticker: 'RBLX', symbol: 'RBLX',    name: 'Roblox',           category: 'MOMENTUM',    unit: '$',       yahoo: 'RBLX' },
  { ticker: 'ABNB', symbol: 'ABNB',    name: 'Airbnb',           category: 'MOMENTUM',    unit: '$',       yahoo: 'ABNB' },
  { ticker: 'SHOP', symbol: 'SHOP',    name: 'Shopify',          category: 'MOMENTUM',    unit: '$',       yahoo: 'SHOP' },
  { ticker: 'SQ',   symbol: 'SQ',      name: 'Block',            category: 'MOMENTUM',    unit: '$',       yahoo: 'SQ' },
  { ticker: 'PYPL', symbol: 'PYPL',    name: 'PayPal',           category: 'MOMENTUM',    unit: '$',       yahoo: 'PYPL' },
  { ticker: 'UBER', symbol: 'UBER',    name: 'Uber',             category: 'MOMENTUM',    unit: '$',       yahoo: 'UBER' },
  { ticker: 'SPOT', symbol: 'SPOT',    name: 'Spotify',          category: 'MOMENTUM',    unit: '$',       yahoo: 'SPOT' },
  { ticker: 'MSTR', symbol: 'MSTR',    name: 'MicroStrategy',    category: 'MOMENTUM',    unit: '$',       yahoo: 'MSTR' },
  { ticker: 'RIOT', symbol: 'RIOT',    name: 'Riot Platforms',   category: 'MOMENTUM',    unit: '$',       yahoo: 'RIOT' },
  { ticker: 'GME',  symbol: 'GME',     name: 'GameStop',         category: 'MOMENTUM',    unit: '$',       yahoo: 'GME' },
  { ticker: 'AMC',  symbol: 'AMC',     name: 'AMC Entertainment',category: 'MOMENTUM',    unit: '$',       yahoo: 'AMC' },

  // CRYPTO
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
  { ticker: 'MATIC',symbol: 'MATIC',   name: 'Polygon',          category: 'CRYPTO',      unit: '$',       yahoo: 'MATIC-USD' },
  { ticker: 'ATOM', symbol: 'ATOM',    name: 'Cosmos',           category: 'CRYPTO',      unit: '$',       yahoo: 'ATOM-USD' },
  { ticker: 'NEAR', symbol: 'NEAR',    name: 'Near',             category: 'CRYPTO',      unit: '$',       yahoo: 'NEAR-USD' },
  { ticker: 'APT',  symbol: 'APT',     name: 'Aptos',            category: 'CRYPTO',      unit: '$',       yahoo: 'APT-USD' },

  // MACRO indices / rates
  { ticker: 'SPX',  symbol: 'SPX',     name: 'S&P 500',          category: 'MACRO',       unit: 'index',   yahoo: '^GSPC' },
  { ticker: 'NDX',  symbol: 'NDX',     name: 'Nasdaq Composite', category: 'MACRO',       unit: 'index',   yahoo: '^IXIC' },
  { ticker: 'DJI',  symbol: 'DJI',     name: 'Dow Jones',        category: 'MACRO',       unit: 'index',   yahoo: '^DJI' },
  { ticker: 'VIX',  symbol: 'VIX',     name: 'VIX',              category: 'MACRO',       unit: 'index',   yahoo: '^VIX' },
  { ticker: 'TNX',  symbol: 'US10Y',   name: 'US 10Y Yield',     category: 'MACRO',       unit: '%',       yahoo: '^TNX' },
  { ticker: 'DXY',  symbol: 'DXY',     name: 'Dollar Index',     category: 'MACRO',       unit: 'index',   yahoo: 'DX=F' },

  // FX (currency pairs) — rendered on the Currency tab
  { ticker: 'EURUSD', symbol: 'EUR/USD', name: 'Euro / US Dollar',       category: 'FX', unit: 'rate', yahoo: 'EURUSD=X', base: 'EUR', quote: 'USD' },
  { ticker: 'USDJPY', symbol: 'USD/JPY', name: 'US Dollar / Yen',        category: 'FX', unit: 'rate', yahoo: 'USDJPY=X', base: 'USD', quote: 'JPY' },
  { ticker: 'GBPUSD', symbol: 'GBP/USD', name: 'Pound / US Dollar',      category: 'FX', unit: 'rate', yahoo: 'GBPUSD=X', base: 'GBP', quote: 'USD' },
  { ticker: 'USDCHF', symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc',category: 'FX', unit: 'rate', yahoo: 'USDCHF=X', base: 'USD', quote: 'CHF' },
  { ticker: 'USDCAD', symbol: 'USD/CAD', name: 'US Dollar / Canadian',   category: 'FX', unit: 'rate', yahoo: 'USDCAD=X', base: 'USD', quote: 'CAD' },
  { ticker: 'AUDUSD', symbol: 'AUD/USD', name: 'Australian / US Dollar', category: 'FX', unit: 'rate', yahoo: 'AUDUSD=X', base: 'AUD', quote: 'USD' },
  { ticker: 'NZDUSD', symbol: 'NZD/USD', name: 'New Zealand / US Dollar',category: 'FX', unit: 'rate', yahoo: 'NZDUSD=X', base: 'NZD', quote: 'USD' },
  { ticker: 'USDCNY', symbol: 'USD/CNY', name: 'US Dollar / Yuan',       category: 'FX', unit: 'rate', yahoo: 'USDCNY=X', base: 'USD', quote: 'CNY' },
  { ticker: 'USDINR', symbol: 'USD/INR', name: 'US Dollar / Rupee',      category: 'FX', unit: 'rate', yahoo: 'USDINR=X', base: 'USD', quote: 'INR' },
  { ticker: 'USDMXN', symbol: 'USD/MXN', name: 'US Dollar / Peso',       category: 'FX', unit: 'rate', yahoo: 'USDMXN=X', base: 'USD', quote: 'MXN' },
  { ticker: 'USDBRL', symbol: 'USD/BRL', name: 'US Dollar / Real',       category: 'FX', unit: 'rate', yahoo: 'USDBRL=X', base: 'USD', quote: 'BRL' },
  { ticker: 'USDKRW', symbol: 'USD/KRW', name: 'US Dollar / Won',        category: 'FX', unit: 'rate', yahoo: 'USDKRW=X', base: 'USD', quote: 'KRW' },
  { ticker: 'EURGBP', symbol: 'EUR/GBP', name: 'Euro / Pound',           category: 'FX', unit: 'rate', yahoo: 'EURGBP=X', base: 'EUR', quote: 'GBP' },
  { ticker: 'EURJPY', symbol: 'EUR/JPY', name: 'Euro / Yen',             category: 'FX', unit: 'rate', yahoo: 'EURJPY=X', base: 'EUR', quote: 'JPY' },
  { ticker: 'GBPJPY', symbol: 'GBP/JPY', name: 'Pound / Yen',            category: 'FX', unit: 'rate', yahoo: 'GBPJPY=X', base: 'GBP', quote: 'JPY' },
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
