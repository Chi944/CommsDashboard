// GET /api/fear-greed
// Proxies the alternative.me Fear & Greed index to avoid CORS from the browser.
// Response: { ok, value, label, updatedAt }
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1', {
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
    res.json({ ok: false, error: String(e?.message || e) });
  }
}
