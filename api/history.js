// Vercel serverless function: historical price series at a chosen range.
// GET /api/history?ticker=NVDA&range=1y -> { ok, ticker, range, points: [{date, price}] }
//
// Allowed ranges: 1d, 5d, 1mo, 3mo, 6mo, 1y, ytd

import { SYMBOLS, ALLOWED_RANGES, findSymbol } from '../lib/symbols.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

const fmtDate = (d, range) => {
  if (range === '1d')   return d.toISOString().slice(11, 16);          // HH:MM
  if (range === '5d')   return d.toISOString().slice(5, 16).replace('T', ' ');
  return d.toISOString().slice(5, 10);                                  // MM-DD
};

export default async function handler(req, res) {
  try {
    const ticker = (req.query?.ticker || '').toString();
    const rangeKey = (req.query?.range || '1mo').toString();
    const sym = findSymbol(ticker);
    if (!sym) {
      res.status(400).json({ ok: false, error: `unknown ticker: ${ticker}` });
      return;
    }
    const cfg = ALLOWED_RANGES[rangeKey];
    if (!cfg) {
      res.status(400).json({ ok: false, error: `unknown range: ${rangeKey}`, allowed: Object.keys(ALLOWED_RANGES) });
      return;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.yahoo)}?interval=${cfg.interval}&range=${cfg.range}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)',
        'Accept': 'application/json',
      },
    });
    if (!r.ok) {
      res.status(502).json({ ok: false, error: `upstream ${r.status}` });
      return;
    }
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) {
      res.status(502).json({ ok: false, error: 'empty upstream' });
      return;
    }

    const ts = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = [];
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) {
        const d = new Date(ts[i] * 1000);
        const v = closes[i];
        points.push({
          date: fmtDate(d, rangeKey),
          price: v < 1 ? round4(v) : round2(v),
        });
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      ok: true,
      ticker: sym.ticker,
      symbol: sym.symbol,
      name: sym.name,
      unit: sym.unit,
      range: rangeKey,
      points,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
