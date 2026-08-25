// Daily/on-demand market briefing.
// GET /api/briefing -> { ok, generatedAt, briefing, signals: { gainers, losers, newsHeadlines } }
//
// Pulls top movers + headline news from our existing endpoints, then
// asks an LLM to produce a 3-paragraph market summary. If GROQ_API_KEY
// is missing, returns the structured signals only.

import { SYMBOLS } from '../lib/symbols.js';
import { getGroqModel } from '../lib/groq.js';

async function getJSON(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)', ...headers } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function fetchTop(req) {
  // Reuse our own /api/prices and /api/news.
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const host  = req.headers.host;
  const base = `${proto}://${host}`;
  const [p, n] = await Promise.all([
    getJSON(`${base}/api/prices`).catch(() => null),
    getJSON(`${base}/api/news`).catch(() => null),
  ]);

  const commodities = (p?.commodities || []).filter((c) => c.category !== 'FX');
  const tradable = commodities.filter((c) => typeof c.changePct === 'number');

  const gainers = [...tradable].sort((a, b) => b.changePct - a.changePct).slice(0, 5);
  const losers  = [...tradable].sort((a, b) => a.changePct - b.changePct).slice(0, 5);
  const headlines = (n?.items || []).slice(0, 8).map((it) => ({
    headline: it.headline, source: it.source, category: it.category, time: it.time,
  }));

  return { gainers, losers, headlines };
}

async function callLLM({ gainers, losers, headlines }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = getGroqModel();

  const fmt = (rows) => rows.map((r) => `${r.ticker} (${r.name}, ${r.category}): ${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(2)}%`).join('\n');
  const headlineText = headlines.length
    ? headlines.map((h, i) => `${i + 1}. [${h.category}] "${h.headline}" — ${h.source}`).join('\n')
    : '(no headlines)';

  const prompt = `Today's market signals:

TOP GAINERS:
${fmt(gainers)}

TOP LOSERS:
${fmt(losers)}

RECENT HEADLINES:
${headlineText}

Write a concise market briefing in EXACTLY three short paragraphs (2-3 sentences each), separated by blank lines:

1) MARKET TONE: Overall risk-on / risk-off read based on what's leading and lagging.
2) THEMES & CATALYSTS: Connect the movers to themes or specific headlines where you can.
3) WATCHPOINTS: One or two things to keep an eye on in the next session.

No specific price targets, no markdown headings, neutral tone, end with: "Informational only — not financial advice."`;

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 600,
      messages: [
        { role: 'system', content: 'You are a measured market strategist writing a brief daily market summary. Use only the data provided. No price targets.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`groq ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return {
    text: j?.choices?.[0]?.message?.content || '',
    model: `${model} (Groq)`,
  };
}

export default async function handler(req, res) {
  try {
    const signals = await fetchTop(req);
    const aiAvailable = Boolean(process.env.GROQ_API_KEY);
    let briefing = null;
    let aiError = null;
    if (aiAvailable) {
      try { briefing = await callLLM(signals); }
      catch (e) { aiError = String(e?.message || e); }
    }
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      aiAvailable,
      aiError,
      briefing,
      signals,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
