// Vercel serverless function: live prices for all tracked assets.
// Pulls 1-month daily history from Yahoo Finance for sparklines and
// derives current quote, today's high/low and intraday change.
//
// GET /api/prices -> { ok, fetchedAt, partial, commodities: [...] }

import { SYMBOLS } from '../lib/symbols.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

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
      const r2 = closes[i] < 1 ? round4(closes[i]) : round2(closes[i]);
      points.push({ t: ts[i], date: d.toISOString().slice(5, 10), price: r2 });
    }
  }
  if (points.length === 0) throw new Error(`${s.yahoo} no closes`);

  const history = points.map((p, i) => ({
    day: `D-${points.length - 1 - i}`,
    date: p.date,
    price: p.price,
  }));

  const last = meta.regularMarketPrice ?? points[points.length - 1].price;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? points[points.length - 2]?.price ?? last;
  const changeAbs = last - prev;
  const changePct = prev ? (changeAbs / prev) * 100 : 0;
  const todayHigh = meta.regularMarketDayHigh ?? highs[highs.length - 1] ?? last;
  const todayLow  = meta.regularMarketDayLow  ?? lows[lows.length - 1]  ?? last;
  const r2 = (n) => (n != null && last < 1) ? round4(n) : round2(n);

  return {
    ticker: s.ticker,
    symbol: s.symbol,
    name: s.name,
    category: s.category,
    unit: s.unit,
    price: r2(last),
    high: r2(todayHigh),
    low: r2(todayLow),
    open: meta.regularMarketOpen != null ? r2(meta.regularMarketOpen) : null,
    prevClose: prev != null ? r2(prev) : null,
    changeAbs: round4(changeAbs),
    changePct: round2(changePct),
    volume: meta.regularMarketVolume ?? null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh != null ? r2(meta.fiftyTwoWeekHigh) : null,
    fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  != null ? r2(meta.fiftyTwoWeekLow)  : null,
    currency: meta.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
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
