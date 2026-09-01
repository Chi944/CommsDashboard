// GET /api/fear-greed
// Proxies the alternative.me Fear & Greed index to avoid CORS from the browser.
// Response: { ok, value, label, updatedAt }
import { fetchWithTimeout } from '../lib/market/fetch.js';

export default async function handler(req, res) {
  if (String(req?.method || 'GET').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }
  if (Object.keys(req?.query || {}).length > 0) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ ok: false, error: 'unsupported query' });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  try {
    const r = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1', {
      headers: { 'User-Agent': 'CommsDashboard/1.0' },
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = await r.json();
    const d = j?.data?.[0];
    if (!d) throw new Error('empty response');
    res.json({
      ok: true,
      value: parseInt(d.value, 10),
      label: d.value_classification,
      updatedAt: new Date(parseInt(d.timestamp, 10) * 1000).toISOString(),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'fear and greed upstream unavailable' });
  }
}
