// AI / technical analysis for a single asset.
// GET /api/analysis?ticker=NVDA -> {
//   ok, ticker, technicals: {...}, news: [...],
//   ai: { narrative, signals, outlook, confidence } | null,
//   aiAvailable: boolean
// }
//
// If ANTHROPIC_API_KEY is set as a Vercel env var, the response
// includes a Claude-generated narrative. Otherwise it returns the
// technical signals only (no fabricated narrative).

import { findSymbol, ALLOWED_RANGES } from '../lib/symbols.js';

const round2 = (n) => Math.round(n * 100) / 100;

async function fetchHistory(yahoo, range = '6mo', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=${interval}&range=${range}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)' },
  });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error('empty');
  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const highs = result.indicators?.quote?.[0]?.high || [];
  const lows = result.indicators?.quote?.[0]?.low || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] != null) points.push({ t: ts[i], c: closes[i], h: highs[i], l: lows[i] });
  }
  return { points, meta: result.meta || {} };
}

const sma = (arr, n) => {
  if (arr.length < n) return null;
  const slice = arr.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
};

const stdev = (arr) => {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
};

// Wilder's RSI(14) over close-to-close diffs.
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function computeTechnicals(history) {
  const closes = history.points.map((p) => p.c);
  if (closes.length < 5) return null;
  const last = closes[closes.length - 1];
  const idx = (n) => closes[Math.max(0, closes.length - 1 - n)];

  const ret = (a, b) => (b ? (a - b) / b * 100 : null);
  const ret1m = ret(last, idx(21));
  const ret3m = ret(last, idx(63));
  const ret6m = ret(last, idx(closes.length - 1));

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);

  // 20-day daily-return volatility, annualised.
  const dailyReturns = [];
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (i > 0) dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const vol = stdev(dailyReturns) * Math.sqrt(252) * 100;

  const rsi14 = rsi(closes);

  const meta = history.meta;
  const hi52 = meta.fiftyTwoWeekHigh ?? Math.max(...closes);
  const lo52 = meta.fiftyTwoWeekLow  ?? Math.min(...closes);
  const rangePct = hi52 > lo52 ? (last - lo52) / (hi52 - lo52) * 100 : 50;

  return {
    last:        round2(last),
    sma20:       sma20  != null ? round2(sma20)  : null,
    sma50:       sma50  != null ? round2(sma50)  : null,
    rsi14:       rsi14  != null ? round2(rsi14)  : null,
    vol_annual:  round2(vol),
    return_1m:   ret1m  != null ? round2(ret1m)  : null,
    return_3m:   ret3m  != null ? round2(ret3m)  : null,
    return_6m:   ret6m  != null ? round2(ret6m)  : null,
    fiftyTwoWeekHigh: round2(hi52),
    fiftyTwoWeekLow:  round2(lo52),
    range_pct:   round2(rangePct),
    above_sma20: sma20 != null ? last > sma20 : null,
    above_sma50: sma50 != null ? last > sma50 : null,
  };
}

// Deterministic technical signals, no AI required.
function deriveSignals(t) {
  const signals = [];
  if (t.above_sma20 && t.above_sma50) signals.push({ tier: 'positive', text: 'Trading above both 20- and 50-day moving averages' });
  else if (!t.above_sma20 && !t.above_sma50) signals.push({ tier: 'negative', text: 'Trading below both 20- and 50-day moving averages' });
  else if (t.above_sma20 && !t.above_sma50) signals.push({ tier: 'mixed', text: 'Above 20-day MA but below 50-day MA — short-term recovery' });
  else signals.push({ tier: 'mixed', text: 'Above 50-day MA but below 20-day MA — recent pullback' });

  if (t.rsi14 != null) {
    if (t.rsi14 >= 70) signals.push({ tier: 'caution', text: `RSI ${t.rsi14.toFixed(0)} — overbought conditions` });
    else if (t.rsi14 <= 30) signals.push({ tier: 'caution', text: `RSI ${t.rsi14.toFixed(0)} — oversold conditions` });
    else signals.push({ tier: 'neutral', text: `RSI ${t.rsi14.toFixed(0)} — neutral momentum` });
  }

  if (t.range_pct >= 85) signals.push({ tier: 'caution', text: 'Near 52-week high — extended' });
  else if (t.range_pct <= 15) signals.push({ tier: 'caution', text: 'Near 52-week low — capitulation territory' });

  if (t.return_1m != null) {
    const lbl = t.return_1m > 0 ? 'positive' : 'negative';
    signals.push({ tier: lbl, text: `1-month return ${t.return_1m > 0 ? '+' : ''}${t.return_1m.toFixed(1)}%` });
  }

  if (t.vol_annual >= 60) signals.push({ tier: 'caution', text: `High volatility (~${t.vol_annual.toFixed(0)}% annualised)` });
  else if (t.vol_annual <= 15) signals.push({ tier: 'neutral', text: `Low volatility (~${t.vol_annual.toFixed(0)}% annualised)` });

  return signals;
}

// Headline fetch (keyword matched to asset name) — reused from
// /api/asset-news shape so we can include 3-5 recent headlines.
async function fetchHeadlines(name, limit = 5) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(name)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)' },
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null && items.length < limit) {
      const block = m[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const link  = (block.match(/<link>([\s\S]*?)<\/link>/)   || [])[1] || '';
      const date  = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const sm    = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      const cleaned = title.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
      const source = sm ? sm[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim() : 'Google News';
      if (cleaned && link) items.push({ title: cleaned, url: link, source, pubDate: date });
    }
    return items;
  } catch {
    return [];
  }
}

async function callClaude({ symbol, technicals, headlines }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const headlineText = headlines.length
    ? headlines.map((h, i) => `${i + 1}. "${h.title}" — ${h.source}`).join('\n')
    : '(no recent headlines)';

  const prompt = `You are a measured, neutral financial analyst. Analyse the asset below using ONLY the data provided. Respond in plain prose (no markdown headings) suitable for a finance dashboard panel.

Asset: ${symbol.name} (${symbol.ticker}) — ${symbol.category}
Current price: ${technicals.last}
Returns: 1-month ${technicals.return_1m}%, 3-month ${technicals.return_3m}%, 6-month ${technicals.return_6m}%
Moving averages: 20-day ${technicals.sma20}, 50-day ${technicals.sma50} (price ${technicals.above_sma20 ? 'above' : 'below'} 20-day, ${technicals.above_sma50 ? 'above' : 'below'} 50-day)
RSI(14): ${technicals.rsi14}
Annualised volatility: ${technicals.vol_annual}%
52-week range: ${technicals.fiftyTwoWeekLow} to ${technicals.fiftyTwoWeekHigh} (currently at ${technicals.range_pct}% of range)

Recent headlines:
${headlineText}

Respond with EXACTLY these sections, each as a single short paragraph (2-3 sentences):

TREND: Describe the current trend and what the technicals indicate.
CATALYSTS: Reference the headlines if relevant, or note 'No notable headline catalysts in the recent set.'
RISKS: Highlight the key risk factors visible in the data (overbought/oversold, near highs/lows, high volatility, etc).
OUTLOOK: A qualitative directional view (constructive / cautious / neutral / mixed). Do NOT give specific price targets or forecasts. End with: "Informational only — not financial advice."`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`claude ${r.status}: ${detail.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = j?.content?.[0]?.text || '';
  // Parse sections.
  const sect = (label) => {
    const re = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:TREND|CATALYSTS|RISKS|OUTLOOK)\\s*:|$)`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    raw: text,
    trend:     sect('TREND'),
    catalysts: sect('CATALYSTS'),
    risks:     sect('RISKS'),
    outlook:   sect('OUTLOOK'),
    model: 'claude-haiku-4-5',
  };
}

export default async function handler(req, res) {
  try {
    const ticker = (req.query?.ticker || '').toString();
    const sym = findSymbol(ticker);
    if (!sym) {
      res.status(400).json({ ok: false, error: `unknown ticker: ${ticker}` });
      return;
    }

    const history = await fetchHistory(sym.yahoo, '6mo', '1d');
    const technicals = computeTechnicals(history);
    if (!technicals) {
      res.status(502).json({ ok: false, error: 'insufficient history' });
      return;
    }
    const signals = deriveSignals(technicals);
    const headlines = await fetchHeadlines(sym.name, 5);

    const aiAvailable = Boolean(process.env.ANTHROPIC_API_KEY);
    let ai = null;
    let aiError = null;
    if (aiAvailable) {
      try {
        ai = await callClaude({ symbol: sym, technicals, headlines });
      } catch (e) {
        aiError = String(e?.message || e);
      }
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      ok: true,
      ticker: sym.ticker,
      name: sym.name,
      category: sym.category,
      technicals,
      signals,
      headlines,
      ai,
      aiAvailable,
      aiError,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
