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

export function createSnapshotHandler(dependencies = {}) {
  const readCache = dependencies.readProviderCache || readProviderCache;
  const storageDiagnostics = dependencies.getStorageDiagnostics || getStorageDiagnostics;
  const fetchCg = dependencies.fetchCoinGeckoPrices || fetchCoinGeckoPrices;
  const fetchCgVolumes = dependencies.fetchCoinGeckoVolumes || fetchCoinGeckoVolumes;
  const fetchEia = dependencies.fetchEiaEnergy || fetchEiaEnergy;
  const rowsFromAvCache = dependencies.avRowsFromCache || avRowsFromCache;
  const rowsFromEiaCache = dependencies.eiaRowsFromCache || eiaRowsFromCache;
  const mergeSnapshot = dependencies.mergeMarketSnapshot || mergeMarketSnapshot;
  const fallbackRows = Object.prototype.hasOwnProperty.call(dependencies, 'fallbackCommodities')
    ? dependencies.fallbackCommodities
    : fallbackCommodities;
  const now = dependencies.now || (() => new Date());

  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.setHeader('Cache-Control', 'no-store');
      res.status(405).json({ ok: false, error: 'method not allowed' });
      return;
    }
    if (Object.keys(req.query || {}).length > 0) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ ok: false, error: 'unsupported query' });
      return;
    }

    try {
      const errors = [];
      const currentDate = now();
      const nowMs = currentDate.getTime();
      const readResult = await readCache({ withDiagnostics: true });
      const hasReadState = Boolean(
        readResult
        && typeof readResult === 'object'
        && Object.prototype.hasOwnProperty.call(readResult, 'cache')
      );
      const cache = hasReadState ? readResult.cache : readResult;
      const storage = hasReadState && readResult.diagnostics
        ? readResult.diagnostics
        : await storageDiagnostics(cache);

      const [cgResult, cgVolResult] = await Promise.allSettled([
        fetchCg(),
        fetchCgVolumes(),
      ]);
      const cg = cgResult.status === 'fulfilled'
        ? cgResult.value
        : { rows: [], errors: ['coingecko request_failed'] };
      const cgVol = cgVolResult.status === 'fulfilled'
        ? cgVolResult.value
        : { volumes: {}, errors: ['coingecko volumes request_failed'] };
      const avCached = rowsFromAvCache(cache, nowMs);
      const eiaCached = rowsFromEiaCache(cache, nowMs);

      errors.push(...(cg.errors || []), ...(cgVol.errors || []));
      if (cache?.alphavantage?.errors?.length) {
        errors.push('alphavantage: cached refresh degraded');
      }

      let eiaRows = eiaCached.rows;
      let eiaStale = eiaCached.stale;
      let eiaRecoveredFromLive = false;
      if (!eiaRows.length || eiaStale) {
        try {
          const liveEia = await fetchEia();
          if (liveEia.rows.length) {
            const liveTickers = new Set(liveEia.rows.map((row) => row.ticker));
            const retainedRows = eiaCached.rows
              .filter((row) => !liveTickers.has(row.ticker))
              .map((row) => ({ ...row, stale: true }));
            eiaRows = [...liveEia.rows, ...retainedRows];
            eiaStale = eiaRows.some((row) => row.stale);
            eiaRecoveredFromLive = retainedRows.length === 0
              && !(liveEia.errors?.length);
          }
          errors.push(...(liveEia.errors || []));
        } catch {
          errors.push('eia request_failed');
        }
      }
      if (cache?.eia?.errors?.length && !eiaRecoveredFromLive) {
        errors.push('eia: cached refresh degraded');
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

      const { commodities, meta } = mergeSnapshot(liveRows, fallbackRows);
      const coveredTickers = new Set(liveRows.map((row) => row.ticker));
      const liveSymbolCount = meta.liveTickers.filter((ticker) => coveredTickers.has(ticker)).length;

      const staleProviders = [...new Set([
        ...(cg.rows.some((row) => row.stale) ? ['coingecko'] : []),
        ...(avRows.length > 0 && avCached.stale ? ['alphavantage'] : []),
        ...(eiaRows.length > 0 && eiaStale ? ['eia'] : []),
        ...meta.staleProviders,
      ])];
      const persistenceDegraded = Boolean(
        storage.readDegraded
        || !storage.durableHit
        || storage.selectedSource === 'memory'
      );
      const partial = liveSymbolCount < meta.liveTickers.length
        || staleProviders.length > 0
        || errors.length > 0
        || persistenceDegraded;

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      res.status(200).json({
        ok: true,
        mode: 'market-v2',
        fetchedAt: currentDate.toISOString(),
        partial,
        commodities,
        providers: {
          ...meta.sources,
          blob: storage.blob,
          blobAuth: storage.blobAuth,
          blobHit: storage.blobHit,
          blobError: storage.blobError || undefined,
          redis: storage.redis,
          redisHit: storage.redisHit,
          redisError: storage.redisError || undefined,
          kv: storage.kv,
          memoryHit: storage.memoryHit,
          cacheSource: storage.selectedSource,
          durableCache: storage.durableHit,
          persistenceDegraded,
        },
        liveSymbolCount,
        staleProviders,
        marketVolumes: cgVol.volumes || {},
        errors: errors.length ? errors : undefined,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'market snapshot failed' });
    }
  };
}

export default createSnapshotHandler();
