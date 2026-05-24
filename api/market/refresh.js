// GET /api/market/refresh — cron / manual AV + EIA cache warm.
// Requires Authorization: Bearer <CRON_SECRET> or ?secret=

import { fetchAlphaVantageCommodities } from '../../lib/market/providers/alphavantage.js';
import { fetchEiaEnergy } from '../../lib/market/providers/eia.js';
import { readProviderCache, writeProviderCache } from '../../lib/market/store.js';

function authorize(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${secret}`) return true;
  const q = req.query?.secret;
  return q === secret;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  if (!authorize(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const prev = await readProviderCache();
    const av = await fetchAlphaVantageCommodities();
    const eia = await fetchEiaEnergy();

    const payload = {
      alphavantage: {
        rows: av.rows,
        fetchedAt: av.fetchedAt,
        errors: av.errors,
      },
      eia: {
        rows: eia.rows,
        fetchedAt: eia.fetchedAt,
        errors: eia.errors,
      },
      refreshedAt: new Date().toISOString(),
      previousRefresh: prev?.refreshedAt ?? null,
    };

    const writeResult = await writeProviderCache(payload);

    res.status(200).json({
      ok: true,
      ...payload,
      kv: Boolean(process.env.KV_REST_API_URL),
      blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN),
      blobWrite: writeResult.blobWrite,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
