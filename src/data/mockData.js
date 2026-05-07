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

// Compact seed rows: just the metadata + a starting price. The 30-day
// history is built deterministically. Live values from /api/prices will
// overlay these on first successful fetch.
const SEED = [
  // ENERGY
  ['CL','WTI','WTI Crude','ENERGY','$/bbl', 80, 1.4],
  ['BZ','BRENT','Brent Crude','ENERGY','$/bbl', 85, 1.5],
  ['NG','NATGAS','Natural Gas','ENERGY','$/MMBtu', 2.4, 0.08],
  // METALS
  ['GC','GOLD','Gold','METALS','$/oz', 2300, 18],
  ['SI','SILVER','Silver','METALS','$/oz', 28, 0.4],
  ['HG','COPPER','Copper','METALS','$/lb', 4.4, 0.06],
  // AGRICULTURE
  ['ZW','WHEAT','Wheat','AGRICULTURE','¢/bu', 620, 8],
  ['ZC','CORN','Corn','AGRICULTURE','¢/bu', 440, 6],
  ['ZS','SOY','Soybeans','AGRICULTURE','¢/bu', 1175, 12],
  // TECH
  ['AAPL','AAPL','Apple','TECH','$', 220, 2.5],
  ['MSFT','MSFT','Microsoft','TECH','$', 420, 4],
  ['GOOGL','GOOGL','Alphabet','TECH','$', 175, 2.2],
  ['META','META','Meta Platforms','TECH','$', 500, 6],
  ['AMZN','AMZN','Amazon','TECH','$', 185, 2.5],
  ['NFLX','NFLX','Netflix','TECH','$', 620, 8],
  ['ADBE','ADBE','Adobe','TECH','$', 510, 6],
  ['CRM','CRM','Salesforce','TECH','$', 280, 4],
  ['ORCL','ORCL','Oracle','TECH','$', 130, 1.6],
  ['IBM','IBM','IBM','TECH','$', 175, 1.8],
  // SEMI
  ['NVDA','NVDA','Nvidia','SEMI','$', 880, 25],
  ['AVGO','AVGO','Broadcom','SEMI','$', 1450, 22],
  ['AMD','AMD','AMD','SEMI','$', 165, 3.5],
  ['TSM','TSM','TSMC','SEMI','$', 155, 2.4],
  ['INTC','INTC','Intel','SEMI','$', 32, 0.6],
  ['MU','MU','Micron','SEMI','$', 110, 2],
  ['QCOM','QCOM','Qualcomm','SEMI','$', 175, 2.4],
  ['ASML','ASML','ASML','SEMI','$', 950, 14],
  ['AMAT','AMAT','Applied Materials','SEMI','$', 210, 3],
  // DATA
  ['PLTR','PLTR','Palantir','DATA','$', 25, 0.6],
  ['SNOW','SNOW','Snowflake','DATA','$', 160, 3.2],
  ['NET','NET','Cloudflare','DATA','$', 95, 1.8],
  ['DDOG','DDOG','Datadog','DATA','$', 130, 2],
  ['MDB','MDB','MongoDB','DATA','$', 360, 6],
  ['CRWD','CRWD','CrowdStrike','DATA','$', 320, 5],
  ['PANW','PANW','Palo Alto Nets','DATA','$', 320, 4],
  ['AI','AI','C3.ai','DATA','$', 22, 0.5],
  ['SMCI','SMCI','Super Micro','DATA','$', 720, 18],
  ['ARM','ARM','Arm Holdings','DATA','$', 110, 2.5],
  ['COIN','COIN','Coinbase','DATA','$', 220, 6],
  // AUTO
  ['TSLA','TSLA','Tesla','AUTO','$', 200, 5],
  ['RIVN','RIVN','Rivian','AUTO','$', 12, 0.4],
  ['LCID','LCID','Lucid','AUTO','$', 3.5, 0.15],
  ['NIO','NIO','NIO','AUTO','$', 5.5, 0.2],
  ['F','F','Ford','AUTO','$', 12, 0.2],
  ['GM','GM','General Motors','AUTO','$', 45, 0.7],
  // FINANCE
  ['JPM','JPM','JPMorgan','FINANCE','$', 200, 2.5],
  ['BAC','BAC','Bank of America','FINANCE','$', 38, 0.5],
  ['GS','GS','Goldman Sachs','FINANCE','$', 470, 5],
  ['WFC','WFC','Wells Fargo','FINANCE','$', 60, 0.7],
  ['C','C','Citigroup','FINANCE','$', 60, 0.8],
  ['V','V','Visa','FINANCE','$', 275, 2.5],
  ['MA','MA','Mastercard','FINANCE','$', 460, 4],
  ['BRK-B','BRK.B','Berkshire Hathaway','FINANCE','$', 410, 3.5],
  // HEALTH
  ['LLY','LLY','Eli Lilly','HEALTH','$', 760, 10],
  ['UNH','UNH','UnitedHealth','HEALTH','$', 490, 5],
  ['JNJ','JNJ','Johnson & Johnson','HEALTH','$', 150, 1.5],
  ['PFE','PFE','Pfizer','HEALTH','$', 27, 0.4],
  ['MRNA','MRNA','Moderna','HEALTH','$', 110, 3],
  ['ABT','ABT','Abbott','HEALTH','$', 105, 1],
  ['NVO','NVO','Novo Nordisk','HEALTH','$', 130, 2],
  // CONSUMER
  ['WMT','WMT','Walmart','CONSUMER','$', 60, 0.6],
  ['COST','COST','Costco','CONSUMER','$', 800, 8],
  ['HD','HD','Home Depot','CONSUMER','$', 350, 4],
  ['MCD','MCD','McDonald\'s','CONSUMER','$', 270, 2.5],
  ['KO','KO','Coca-Cola','CONSUMER','$', 60, 0.5],
  ['NKE','NKE','Nike','CONSUMER','$', 90, 1.2],
  ['DIS','DIS','Disney','CONSUMER','$', 105, 1.4],
  ['SBUX','SBUX','Starbucks','CONSUMER','$', 80, 1],
  // MOMENTUM
  ['HOOD','HOOD','Robinhood','MOMENTUM','$', 22, 0.6],
  ['RBLX','RBLX','Roblox','MOMENTUM','$', 35, 0.8],
  ['ABNB','ABNB','Airbnb','MOMENTUM','$', 160, 2.2],
  ['SHOP','SHOP','Shopify','MOMENTUM','$', 70, 1.4],
  ['SQ','SQ','Block','MOMENTUM','$', 70, 1.4],
  ['PYPL','PYPL','PayPal','MOMENTUM','$', 65, 0.9],
  ['UBER','UBER','Uber','MOMENTUM','$', 70, 1.2],
  ['SPOT','SPOT','Spotify','MOMENTUM','$', 320, 5],
  ['MSTR','MSTR','MicroStrategy','MOMENTUM','$', 1500, 60],
  ['RIOT','RIOT','Riot Platforms','MOMENTUM','$', 10, 0.4],
  ['GME','GME','GameStop','MOMENTUM','$', 22, 0.8],
  ['AMC','AMC','AMC Entertainment','MOMENTUM','$', 4, 0.2],
  // CRYPTO
  ['BTC','BTC','Bitcoin','CRYPTO','$', 65000, 800],
  ['ETH','ETH','Ethereum','CRYPTO','$', 3200, 60],
  ['SOL','SOL','Solana','CRYPTO','$', 145, 4],
  ['BNB','BNB','BNB','CRYPTO','$', 580, 10],
  ['XRP','XRP','Ripple','CRYPTO','$', 0.52, 0.012],
  ['DOGE','DOGE','Dogecoin','CRYPTO','$', 0.16, 0.005],
  ['ADA','ADA','Cardano','CRYPTO','$', 0.46, 0.012],
  ['AVAX','AVAX','Avalanche','CRYPTO','$', 35, 1.0],
  ['DOT','DOT','Polkadot','CRYPTO','$', 6.8, 0.18],
  ['LINK','LINK','Chainlink','CRYPTO','$', 14.5, 0.4],
  ['MATIC','MATIC','Polygon','CRYPTO','$', 0.7, 0.02],
  ['ATOM','ATOM','Cosmos','CRYPTO','$', 8.5, 0.25],
  ['NEAR','NEAR','Near','CRYPTO','$', 7, 0.2],
  ['APT','APT','Aptos','CRYPTO','$', 9, 0.3],
  // MACRO
  ['SPX','SPX','S&P 500','MACRO','index', 5100, 30],
  ['NDX','NDX','Nasdaq Composite','MACRO','index', 16000, 120],
  ['DJI','DJI','Dow Jones','MACRO','index', 38500, 200],
  ['VIX','VIX','VIX','MACRO','index', 14, 0.6],
  ['TNX','US10Y','US 10Y Yield','MACRO','%', 4.4, 0.05],
  ['DXY','DXY','Dollar Index','MACRO','index', 104, 0.4],
  // FX
  ['EURUSD','EUR/USD','Euro / US Dollar','FX','rate', 1.08, 0.005],
  ['USDJPY','USD/JPY','US Dollar / Yen','FX','rate', 155, 0.5],
  ['GBPUSD','GBP/USD','Pound / US Dollar','FX','rate', 1.25, 0.006],
  ['USDCHF','USD/CHF','US Dollar / Swiss Franc','FX','rate', 0.91, 0.004],
  ['USDCAD','USD/CAD','US Dollar / Canadian','FX','rate', 1.37, 0.005],
  ['AUDUSD','AUD/USD','Australian / US Dollar','FX','rate', 0.66, 0.004],
  ['NZDUSD','NZD/USD','New Zealand / US Dollar','FX','rate', 0.60, 0.004],
  ['USDCNY','USD/CNY','US Dollar / Yuan','FX','rate', 7.23, 0.02],
  ['USDINR','USD/INR','US Dollar / Rupee','FX','rate', 83.5, 0.1],
  ['USDMXN','USD/MXN','US Dollar / Peso','FX','rate', 17, 0.1],
  ['USDBRL','USD/BRL','US Dollar / Real','FX','rate', 5.1, 0.04],
  ['USDKRW','USD/KRW','US Dollar / Won','FX','rate', 1370, 5],
  ['EURGBP','EUR/GBP','Euro / Pound','FX','rate', 0.86, 0.003],
  ['EURJPY','EUR/JPY','Euro / Yen','FX','rate', 167, 0.6],
  ['GBPJPY','GBP/JPY','Pound / Yen','FX','rate', 194, 0.7],
];

export const commodities = SEED.map(([ticker, symbol, name, category, unit, price, vol], i) => ({
  ticker, symbol, name, category, unit,
  price,
  high: price * 1.01,
  low:  price * 0.99,
  changePct: 0,
  changeAbs: 0,
  history: buildHistory(price, vol, (i + 11) * 7),
}));

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
  Currency:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  Finance:      'bg-blue-500/20 text-blue-300 border-blue-500/40',
}[c] || 'bg-gray-500/20 text-gray-300 border-gray-500/40');

export const assetCategoryColor = (c) => ({
  ENERGY:      'text-orange-300',
  METALS:      'text-yellow-300',
  AGRICULTURE: 'text-green-300',
  TECH:        'text-violet-300',
  SEMI:        'text-fuchsia-300',
  DATA:        'text-cyan-300',
  AUTO:        'text-rose-300',
  FINANCE:     'text-blue-300',
  HEALTH:      'text-emerald-300',
  CONSUMER:    'text-pink-300',
  MOMENTUM:    'text-orange-300',
  CRYPTO:      'text-amber-300',
  MACRO:       'text-slate-300',
  FX:          'text-emerald-300',
}[c] || 'text-gray-300');
