// Fallback data used when the live API is unavailable.
// All on-screen "live" indicators reflect whether the API succeeded.

const seeded = (seed) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

const buildHistory = (start, vol, seed) => {
  const rnd = seeded(seed);
  const arr = [];
  let p = start;
  for (let i = 29; i >= 0; i--) {
    p = p + (rnd() - 0.48) * vol;
    arr.push({
      day: `D-${i}`,
      date: new Date(Date.now() - i * 86400000).toISOString().slice(5, 10),
      price: Math.round(p * 100) / 100,
    });
  }
  return arr;
};

// Minimal fallback rows. Real numbers come from /api/prices.
// Categories: ENERGY, METALS, AGRICULTURE, TECH, DATA, CRYPTO.
export const commodities = [
  { ticker: 'CL',    symbol: 'WTI',    name: 'WTI Crude',    category: 'ENERGY',      unit: '$/bbl',   price: 80,    high: 81,    low: 79,    changePct: 0, changeAbs: 0, history: buildHistory(80, 1.4, 11) },
  { ticker: 'BZ',    symbol: 'BRENT',  name: 'Brent Crude',  category: 'ENERGY',      unit: '$/bbl',   price: 85,    high: 86,    low: 84,    changePct: 0, changeAbs: 0, history: buildHistory(85, 1.5, 23) },
  { ticker: 'NG',    symbol: 'NATGAS', name: 'Natural Gas',  category: 'ENERGY',      unit: '$/MMBtu', price: 2.4,   high: 2.45,  low: 2.35,  changePct: 0, changeAbs: 0, history: buildHistory(2.4, 0.08, 31) },
  { ticker: 'GC',    symbol: 'GOLD',   name: 'Gold',         category: 'METALS',      unit: '$/oz',    price: 2300,  high: 2320,  low: 2280,  changePct: 0, changeAbs: 0, history: buildHistory(2300, 18, 41) },
  { ticker: 'SI',    symbol: 'SILVER', name: 'Silver',       category: 'METALS',      unit: '$/oz',    price: 28,    high: 28.5,  low: 27.5,  changePct: 0, changeAbs: 0, history: buildHistory(28, 0.4, 53) },
  { ticker: 'HG',    symbol: 'COPPER', name: 'Copper',       category: 'METALS',      unit: '$/lb',    price: 4.4,   high: 4.5,   low: 4.3,   changePct: 0, changeAbs: 0, history: buildHistory(4.4, 0.06, 67) },
  { ticker: 'ZW',    symbol: 'WHEAT',  name: 'Wheat',        category: 'AGRICULTURE', unit: '¢/bu',    price: 620,   high: 625,   low: 615,   changePct: 0, changeAbs: 0, history: buildHistory(620, 8, 71) },
  { ticker: 'ZC',    symbol: 'CORN',   name: 'Corn',         category: 'AGRICULTURE', unit: '¢/bu',    price: 440,   high: 445,   low: 435,   changePct: 0, changeAbs: 0, history: buildHistory(440, 6, 79) },
  { ticker: 'ZS',    symbol: 'SOY',    name: 'Soybeans',     category: 'AGRICULTURE', unit: '¢/bu',    price: 1175,  high: 1185,  low: 1165,  changePct: 0, changeAbs: 0, history: buildHistory(1175, 12, 89) },
  { ticker: 'AAPL',  symbol: 'AAPL',   name: 'Apple',        category: 'TECH',        unit: '$',       price: 220,   high: 222,   low: 218,   changePct: 0, changeAbs: 0, history: buildHistory(215, 2.5, 97) },
  { ticker: 'MSFT',  symbol: 'MSFT',   name: 'Microsoft',    category: 'TECH',        unit: '$',       price: 420,   high: 425,   low: 415,   changePct: 0, changeAbs: 0, history: buildHistory(420, 4, 103) },
  { ticker: 'NVDA',  symbol: 'NVDA',   name: 'Nvidia',       category: 'TECH',        unit: '$',       price: 880,   high: 895,   low: 870,   changePct: 0, changeAbs: 0, history: buildHistory(870, 25, 109) },
  { ticker: 'GOOGL', symbol: 'GOOGL',  name: 'Alphabet',     category: 'TECH',        unit: '$',       price: 175,   high: 177,   low: 173,   changePct: 0, changeAbs: 0, history: buildHistory(170, 2.2, 113) },
  { ticker: 'META',  symbol: 'META',   name: 'Meta',         category: 'TECH',        unit: '$',       price: 500,   high: 510,   low: 495,   changePct: 0, changeAbs: 0, history: buildHistory(490, 6, 127) },
  { ticker: 'TSLA',  symbol: 'TSLA',   name: 'Tesla',        category: 'TECH',        unit: '$',       price: 200,   high: 205,   low: 195,   changePct: 0, changeAbs: 0, history: buildHistory(195, 5, 131) },
  { ticker: 'PLTR',  symbol: 'PLTR',   name: 'Palantir',     category: 'DATA',        unit: '$',       price: 25,    high: 26,    low: 24,    changePct: 0, changeAbs: 0, history: buildHistory(23, 0.6, 137) },
  { ticker: 'SNOW',  symbol: 'SNOW',   name: 'Snowflake',    category: 'DATA',        unit: '$',       price: 160,   high: 165,   low: 155,   changePct: 0, changeAbs: 0, history: buildHistory(155, 3.2, 139) },
  { ticker: 'NET',   symbol: 'NET',    name: 'Cloudflare',   category: 'DATA',        unit: '$',       price: 95,    high: 97,    low: 93,    changePct: 0, changeAbs: 0, history: buildHistory(92, 1.8, 149) },
  { ticker: 'DDOG',  symbol: 'DDOG',   name: 'Datadog',      category: 'DATA',        unit: '$',       price: 130,   high: 134,   low: 128,   changePct: 0, changeAbs: 0, history: buildHistory(128, 2.0, 151) },
  { ticker: 'MDB',   symbol: 'MDB',    name: 'MongoDB',      category: 'DATA',        unit: '$',       price: 360,   high: 370,   low: 350,   changePct: 0, changeAbs: 0, history: buildHistory(355, 6, 157) },
  { ticker: 'CRWD',  symbol: 'CRWD',   name: 'CrowdStrike',  category: 'DATA',        unit: '$',       price: 320,   high: 325,   low: 315,   changePct: 0, changeAbs: 0, history: buildHistory(315, 5, 163) },
  { ticker: 'BTC',   symbol: 'BTC',    name: 'Bitcoin',      category: 'CRYPTO',      unit: '$',       price: 65000, high: 66000, low: 64000, changePct: 0, changeAbs: 0, history: buildHistory(63000, 800, 167) },
  { ticker: 'ETH',   symbol: 'ETH',    name: 'Ethereum',     category: 'CRYPTO',      unit: '$',       price: 3200,  high: 3250,  low: 3150,  changePct: 0, changeAbs: 0, history: buildHistory(3100, 60, 173) },
  { ticker: 'SOL',   symbol: 'SOL',    name: 'Solana',       category: 'CRYPTO',      unit: '$',       price: 145,   high: 150,   low: 140,   changePct: 0, changeAbs: 0, history: buildHistory(140, 4, 179) },
  { ticker: 'DOGE',  symbol: 'DOGE',   name: 'Dogecoin',     category: 'CRYPTO',      unit: '$',       price: 0.16,  high: 0.17,  low: 0.155, changePct: 0, changeAbs: 0, history: buildHistory(0.16, 0.005, 181) },
];

// Empty by default — populated by /api/news.
export const intel = [];

// ----------- HELPERS -----------
export const severityBg = (s) => ({
  CRITICAL: 'bg-red-500',
  HIGH:     'bg-orange-500',
  MODERATE: 'bg-yellow-500',
  LOW:      'bg-green-500',
}[s] || 'bg-gray-500');

export const severityText = (s) => ({
  CRITICAL: 'text-red-400',
  HIGH:     'text-orange-400',
  MODERATE: 'text-yellow-400',
  LOW:      'text-green-400',
}[s] || 'text-gray-400');

export const categoryColor = (c) => ({
  Shipping:     'bg-blue-500/20 text-blue-300 border-blue-500/40',
  Energy:       'bg-orange-500/20 text-orange-300 border-orange-500/40',
  Metals:       'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Agri:         'bg-green-500/20 text-green-300 border-green-500/40',
  Geopolitical: 'bg-red-500/20 text-red-300 border-red-500/40',
  Tech:         'bg-violet-500/20 text-violet-300 border-violet-500/40',
  Data:         'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  Crypto:       'bg-amber-500/20 text-amber-300 border-amber-500/40',
}[c] || 'bg-gray-500/20 text-gray-300 border-gray-500/40');

export const assetCategoryColor = (c) => ({
  ENERGY:      'text-orange-300',
  METALS:      'text-yellow-300',
  AGRICULTURE: 'text-green-300',
  TECH:        'text-violet-300',
  DATA:        'text-cyan-300',
  CRYPTO:      'text-amber-300',
}[c] || 'text-gray-300');
