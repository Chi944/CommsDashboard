// GET /api/market/snapshot
// CoinGecko (live) + Alpha Vantage (cached, cron-only) + EIA (live or cached).
// Response shape matches /api/prices for drop-in use.

import { commodities as fallbackCommodities } from '../../src/data/mockData.js';
import { fetchCoinGeckoPrices } from '../../lib/market/providers/coingecko.js';
import { fetchCoinGeckoVolumes } from '../../lib/market/providers/coingecko-volumes.js';
import { avRowsFromCache } from '../../lib/market/providers/alphavantage.js';
import { fetchEiaEnergy, eiaRowsFromCache } from '../../lib/market/providers/eia.js';
import { getStorageDiagnostics, readProviderCache } from '../../lib/market/store.js';
import { mergeMarketSnapshot } from '../../lib/market/merge.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const errors = [];
    const cache = await readProviderCache();
    const storage = await getStorageDiagnostics(cache);

    const [cg, cgVol, avCached, eiaCached] = await Promise.all([
      fetchCoinGeckoPrices(),
      fetchCoinGeckoVolumes(),
      Promise.resolve(avRowsFromCache(cache)),
      Promise.resolve(eiaRowsFromCache(cache)),
    ]);

    errors.push(...(cg.errors || []), ...(cgVol.errors || []));

    let eiaRows = eiaCached.rows;
    let eiaStale = eiaCached.stale;
    if (!eiaRows.length || eiaStale) {
      const liveEia = await fetchEiaEnergy();
      if (liveEia.rows.length) {
        eiaRows = liveEia.rows;
        eiaStale = false;
      }
      errors.push(...(liveEia.errors || []));
    }

    const avRows = avCached.rows;
    if (!avRows.length) {
      errors.push('alphavantage: no cache — run /api/market/refresh cron');
    }

    const liveRows = [
      ...cg.rows,
      ...avRows,
      ...eiaRows,
    ];

    const { commodities, meta } = mergeMarketSnapshot(liveRows, fallbackCommodities);

    const staleProviders = [...new Set([
      ...(avCached.stale ? ['alphavantage'] : []),
      ...(eiaStale ? ['eia'] : []),
      ...meta.staleProviders,
    ])];

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      ok: true,
      mode: 'market-v2',
      fetchedAt: new Date().toISOString(),
      partial: liveRows.length < meta.liveSymbolCount || staleProviders.length > 0,
      commodities,
      providers: {
        ...meta.sources,
        blob: storage.blob,
        blobHit: storage.blobHit,
        blobError: storage.blobError || undefined,
        kv: storage.kv,
      },
      liveSymbolCount: meta.liveSymbolCount,
      staleProviders,
      marketVolumes: cgVol.volumes || {},
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
