// Fallback rows used when /api/prices is offline.
// Live API values overlay these on first successful poll.

import { SYMBOLS } from '../../lib/symbols.js';

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
      price: Math.round(p * 10000) / 10000,
    });
  }
  return arr;
};

// Coarse anchor prices so fallbacks aren't all $1. Live API replaces.
const ANCHOR = {
  CL: 80, BZ: 85, NG: 2.4,
  GC: 2300, SI: 28, HG: 4.4,
  ZW: 620, ZC: 440, ZS: 1175,
  AAPL: 220, MSFT: 420, GOOGL: 175, META: 500, AMZN: 185, NFLX: 620,
  ADBE: 510, CRM: 280, ORCL: 130, IBM: 175, NOW: 760, INTU: 620,
  NVDA: 880, AVGO: 1450, AMD: 165, TSM: 155, INTC: 32, MU: 110, QCOM: 175,
  ASML: 950, AMAT: 210, LRCX: 950, KLAC: 720, MRVL: 75,
  PLTR: 25, SNOW: 160, NET: 95, DDOG: 130, MDB: 360, CRWD: 320, PANW: 320,
  ZS: 200, OKTA: 95, AI: 22, SMCI: 720, ARM: 110, COIN: 220,
  TSLA: 200, RIVN: 12, LCID: 3.5, NIO: 5.5, XPEV: 9, LI: 22, F: 12, GM: 45, STLA: 25,
  JPM: 200, BAC: 38, GS: 470, WFC: 60, C: 60, MS: 100, SCHW: 75, USB: 45,
  V: 275, MA: 460, AXP: 235, 'BRK-B': 410,
  LLY: 760, UNH: 490, JNJ: 150, PFE: 27, MRNA: 110, ABT: 105, NVO: 130,
  AZN: 70, NVS: 100, AMGN: 280, GILD: 70, VRTX: 420, REGN: 920, ISRG: 380,
  WMT: 60, COST: 800, HD: 350, LOW: 230, TGT: 150, MCD: 270, SBUX: 80,
  KO: 60, PEP: 175, PG: 165, NKE: 90, LULU: 360, DIS: 105, MO: 45,
  XOM: 115, CVX: 160, COP: 125, SLB: 50, OXY: 65, MPC: 175, PSX: 165, EOG: 130,
  BA: 175, CAT: 350, GE: 160, HON: 200, RTX: 100, LMT: 460, NOC: 470, DE: 400, UPS: 145, FDX: 270,
  T: 17, VZ: 40, TMUS: 165, CMCSA: 40,
  O: 55, AMT: 195, PLD: 110, SPG: 150, EQIX: 770,
  NEE: 65, DUK: 100, AEP: 90, SO: 75,
  DAL: 50, UAL: 50, LUV: 28, AAL: 14, BKNG: 3700, MAR: 240, EXPE: 130, CCL: 16,
  BABA: 80, JD: 30, PDD: 130, BIDU: 100, SE: 65, MELI: 1500,
  HOOD: 22, RBLX: 35, ABNB: 160, SHOP: 70, SQ: 70, PYPL: 65, UBER: 70, LYFT: 18,
  SPOT: 320, MSTR: 1500, RIOT: 10, MARA: 18, DKNG: 40, SOFI: 8, GME: 22, AMC: 4,
  BTC: 65000, ETH: 3200, SOL: 145, BNB: 580, XRP: 0.52, DOGE: 0.16, ADA: 0.46,
  AVAX: 35, DOT: 6.8, LINK: 14.5, MATIC: 0.7, ATOM: 8.5, NEAR: 7, APT: 9,
  LTC: 80, TRX: 0.12,
  SPX: 5100, NDX: 16000, DJI: 38500, VIX: 14, TNX: 4.4, DXY: 104,
  // FX anchors
  EURUSD: 1.08, GBPUSD: 1.25, AUDUSD: 0.66, NZDUSD: 0.60,
  USDJPY: 155, USDCHF: 0.91, USDCAD: 1.37, USDCNY: 7.23, USDINR: 83.5,
  USDMXN: 17, USDBRL: 5.1, USDKRW: 1370, USDSGD: 1.35, USDHKD: 7.83,
  USDTWD: 32.4, USDTHB: 36.8, USDIDR: 16100, USDPHP: 57, USDMYR: 4.7,
  USDVND: 25400, USDAED: 3.67, USDSAR: 3.75, USDILS: 3.7, USDTRY: 32.2,
  USDZAR: 18.6, USDEGP: 47, USDNGN: 1500, USDKES: 130, USDPKR: 280, USDBDT: 110,
  USDSEK: 10.8, USDNOK: 10.9, USDDKK: 6.9, USDPLN: 4.0, USDCZK: 23.2,
  USDHUF: 358, USDRON: 4.6, USDARS: 870, USDCLP: 950, USDCOP: 3850, USDPEN: 3.7,
};

const VOL_RATIO = 0.012; // typical daily move ~1.2%

export const commodities = SYMBOLS.map((s, i) => {
  const anchor = ANCHOR[s.ticker] ?? 100;
  const vol = anchor * VOL_RATIO;
  return {
    ...s,
    price: anchor,
    high: anchor * 1.01,
    low:  anchor * 0.99,
    changePct: 0,
    changeAbs: 0,
    history: buildHistory(anchor, vol, (i + 11) * 7),
  };
});

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
  OIL:         'text-orange-200',
  INDUST:      'text-stone-300',
  TELECOM:     'text-sky-300',
  REIT:        'text-lime-300',
  UTIL:        'text-teal-300',
  TRAVEL:      'text-indigo-300',
  ASIA:        'text-red-300',
  FX:          'text-emerald-300',
}[c] || 'text-gray-300');
