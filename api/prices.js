// Vercel serverless function: live commodity futures from Yahoo Finance.
// GET /api/prices  -> { ok, fetchedAt, commodities: [...] }

const SYMBOLS = [
  { ticker: 'CL', symbol: 'WTI',    name: 'WTI Crude',   category: 'ENERGY',      unit: '$/bbl',   yahoo: 'CL=F' },
  { ticker: 'BZ', symbol: 'BRENT',  name: 'Brent Crude', category: 'ENERGY',      unit: '$/bbl',   yahoo: 'BZ=F' },
  { ticker: 'NG', symbol: 'NATGAS', name: 'Natural Gas', category: 'ENERGY',      unit: '$/MMBtu', yahoo: 'NG=F' },
  { ticker: 'GC', symbol: 'GOLD',   name: 'Gold',        category: 'METALS',      unit: '$/oz',    yahoo: 'GC=F' },
  { ticker: 'SI', symbol: 'SILVER', name: 'Silver',      category: 'METALS',      unit: '$/oz',    yahoo: 'SI=F' },
  { ticker: 'HG', symbol: 'COPPER', name: 'Copper',      category: 'METALS',      unit: '$/lb',    yahoo: 'HG=F' },
  { ticker: 'ZW', symbol: 'WHEAT',  name: 'Wheat',       category: 'AGRICULTURE', unit: '¢/bu',    yahoo: 'ZW=F' },
  { ticker: 'ZC', symbol: 'CORN',   name: 'Corn',        category: 'AGRICULTURE', unit: '¢/bu',    yahoo: 'ZC=F' },
  { ticker: 'ZS', symbol: 'SOY',    name: 'Soybeans',    category: 'AGRICULTURE', unit: '¢/bu',    yahoo: 'ZS=F' },
];

const round2 = (n) => Math.round(n * 100) / 100;

async function fetchOne(s) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.yahoo)}?interval=1d&range=1mo`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)',
      'Accept': 'application/json',
    },
  });
  if (!r.ok) throw new Error(`${s.yahoo} -> ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(`${s.yahoo} empty`);

  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const closes = q.close || [];
  const highs = q.high || [];
  const lows = q.low || [];

  const points = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] != null) {
      const d = new Date(ts[i] * 1000);
      points.push({ t: ts[i], date: d.toISOString().slice(5, 10), price: round2(closes[i]) });
    }
  }
  if (points.length === 0) throw new Error(`${s.yahoo} no closes`);

  const history = points.map((p, i) => ({
    day: `D-${points.length - 1 - i}`,
    date: p.date,
    price: p.price,
  }));

  const last = points[points.length - 1].price;
  const prev = meta.chartPreviousClose ?? points[points.length - 2]?.price ?? last;
  const changeAbs = last - prev;
  const changePct = prev ? (changeAbs / prev) * 100 : 0;
  const todayHigh = highs[highs.length - 1] ?? last;
  const todayLow  = lows[lows.length - 1]  ?? last;

  return {
    ticker: s.ticker,
    symbol: s.symbol,
    name: s.name,
    category: s.category,
    unit: s.unit,
    price: round2(last),
    high: round2(todayHigh),
    low: round2(todayLow),
    changeAbs: round2(changeAbs),
    changePct: round2(changePct),
    history,
  };
}

export default async function handler(req, res) {
  try {
    const settled = await Promise.allSettled(SYMBOLS.map(fetchOne));
    const commodities = settled
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    if (commodities.length === 0) {
      res.status(502).json({ ok: false, error: 'all upstream fetches failed' });
      return;
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      partial: commodities.length < SYMBOLS.length,
      commodities,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
