// Vercel serverless function: news for a single asset, by name/symbol query.
// GET /api/asset-news?q=Nvidia&limit=6 -> { ok, items: [...] }

import { parseGoogleNewsFeed } from '../lib/feeds.js';
import { fetchWithTimeout } from '../lib/market/fetch.js';

const PER_QUERY_LIMIT = 8;
const MAX_NEWS_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

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
  if (String(req?.method || 'GET').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  const query = req?.query || {};
  if (Object.keys(query).some((key) => !['q', 'limit'].includes(key))) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ ok: false, error: 'unsupported query' });
    return;
  }
  const rawQuery = query.q;
  const rawLimit = query.limit;
  const validQuery = typeof rawQuery === 'string'
    && rawQuery.trim().length > 0
    && rawQuery.trim().length <= 160;
  const validLimit = rawLimit === undefined
    || (typeof rawLimit === 'string' && /^(?:[1-9]|1[0-2])$/.test(rawLimit));
  if (!validQuery || !validLimit) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ ok: false, error: 'invalid query' });
    return;
  }
  try {
    const q = rawQuery.trim();
    const limit = Number.parseInt(rawLimit || '6', 10);

    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetchWithTimeout(url, {
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
    const referenceMs = Date.now();
    const items = parseGoogleNewsFeed(xml, {
      maxItems: PER_QUERY_LIMIT,
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
    }).filter((item) => item.ts > 0
      && item.ts <= referenceMs + MAX_FUTURE_SKEW_MS
      && referenceMs - item.ts <= MAX_NEWS_AGE_MS)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);

    const newestPublishedAt = items.length ? new Date(items[0].ts).toISOString() : null;
    const oldestPublishedAt = items.length ? new Date(items.at(-1).ts).toISOString() : null;

    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');
    res.status(200).json({
      ok: true,
      query: q,
      fetchedAt: new Date().toISOString(),
      asOf: newestPublishedAt,
      freshness: {
        isFresh: items.length > 0,
        maxAgeHours: MAX_NEWS_AGE_MS / (60 * 60 * 1000),
        newestPublishedAt,
        oldestPublishedAt,
      },
      items,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'asset news upstream unavailable' });
  }
}
