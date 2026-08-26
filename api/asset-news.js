// Vercel serverless function: news for a single asset, by name/symbol query.
// GET /api/asset-news?q=Nvidia&limit=6 -> { ok, items: [...] }

import { parseFeed } from '../lib/feeds.js';

const PER_QUERY_LIMIT = 8;

function timeAgo(date) {
  const t = Date.parse(date);
  if (!t) return '';
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default async function handler(req, res) {
  try {
    const q = (req.query?.q || '').toString().trim();
    if (!q) {
      res.status(400).json({ ok: false, error: 'missing query' });
      return;
    }
    const limit = Math.max(1, Math.min(12, parseInt(req.query?.limit || '6', 10)));

    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!r.ok) {
      res.status(502).json({ ok: false, error: `upstream ${r.status}` });
      return;
    }
    const xml = await r.text();
    const items = parseFeed(xml, {
      maxItems: PER_QUERY_LIMIT,
      allowedOrigins: ['https://news.google.com'],
      allowExternalHttpsLinks: true,
    }).map((it, i) => {
      const ts = Date.parse(it.pubDate) || 0;
      return {
        id: `${ts}-${i}`,
        source: it.source || 'Google News',
        time: timeAgo(it.pubDate),
        headline: it.title,
        desc: it.description.slice(0, 160),
        url: it.url,
        ts,
      };
    }).sort((a, b) => b.ts - a.ts).slice(0, limit);

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');
    res.status(200).json({ ok: true, query: q, fetchedAt: new Date().toISOString(), items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
