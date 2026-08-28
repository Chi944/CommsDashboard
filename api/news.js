// Vercel serverless function: live news from Google News RSS.
// Each item carries the real article URL (via Google's redirector to
// the original publisher). No API key required.
//
// GET /api/news -> { ok, fetchedAt, items: [...] }

import { parseGoogleNewsFeed } from '../lib/feeds.js';
import { fetchWithTimeout } from '../lib/market/fetch.js';

const QUERIES = [
  { category: 'Shipping',     q: 'shipping disruption red sea suez container' },
  { category: 'Energy',       q: 'crude oil prices brent wti opec' },
  { category: 'Metals',       q: 'gold silver copper futures price' },
  { category: 'Agri',         q: 'wheat corn soybean futures price' },
  { category: 'Geopolitical', q: 'iran israel hormuz strait tanker' },
  { category: 'Tech',         q: 'tech stocks earnings Apple Microsoft Nvidia' },
  { category: 'Data',         q: 'AI infrastructure cloud computing Palantir Snowflake' },
  { category: 'Crypto',       q: 'bitcoin ethereum cryptocurrency price' },
  { category: 'Currency',     q: 'forex EUR USD JPY currency markets central bank' },
  { category: 'Finance',      q: 'stock market S&P 500 Federal Reserve earnings' },
];

const PER_QUERY = 4;
const TOTAL_LIMIT = 36;
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

async function fetchTopic({ category, q }, referenceMs) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)',
      'Accept': 'application/rss+xml, application/xml, text/xml',
    },
  });
  if (!r.ok) throw new Error(`${category} ${r.status}`);
  const xml = await r.text();
  const items = parseGoogleNewsFeed(xml, {
    maxItems: PER_QUERY,
  });
  return items.map((it, i) => {
    const ts = Date.parse(it.pubDate) || 0;
    return {
      id: `${category}-${ts}-${i}`,
      category,
      source: it.source || 'Google News',
      time: timeAgo(it.pubDate),
      headline: it.title,
      desc: it.description.slice(0, 200),
      url: it.url,
      ts,
    };
  }).filter((item) => item.ts > 0
    && item.ts <= referenceMs + MAX_FUTURE_SKEW_MS
    && referenceMs - item.ts <= MAX_NEWS_AGE_MS);
}

export default async function handler(req, res) {
  try {
    const referenceMs = Date.now();
    const settled = await Promise.allSettled(QUERIES.map((topic) => fetchTopic(topic, referenceMs)));
    const all = settled
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value);

    if (all.length === 0) {
      res.status(502).json({ ok: false, error: 'all news fetches failed' });
      return;
    }

    const seen = new Set();
    const items = [];
    for (const it of all.sort((a, b) => b.ts - a.ts)) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      items.push(it);
      if (items.length >= TOTAL_LIMIT) break;
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    const publishedTimes = items.map((item) => item.ts);
    const newestPublishedAtMs = Math.max(...publishedTimes);
    const oldestPublishedAtMs = Math.min(...publishedTimes);
    res.status(200).json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      freshness: {
        isFresh: true,
        maxAgeHours: MAX_NEWS_AGE_MS / (60 * 60 * 1000),
        ageMs: Math.max(0, referenceMs - newestPublishedAtMs),
        newestPublishedAt: new Date(newestPublishedAtMs).toISOString(),
        oldestPublishedAt: new Date(oldestPublishedAtMs).toISOString(),
      },
      items,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'news service unavailable' });
  }
}
