// Vercel serverless function: live prices for all tracked assets.
// Pulls compact daily history from Yahoo Finance's multi-symbol spark API
// and derives the daily change from the final two valid closes.
//
// GET /api/prices -> { ok, fetchedAt, partial, commodities: [...] }

import { SYMBOLS } from '../lib/symbols.js';
import { fetchYahooSparkBatches, yahooSparkRow } from '../lib/market/yahooSpark.js';

export default async function handler(req, res) {
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
    const fetchedAt = new Date().toISOString();
    const { bySymbol, errors: batchErrors, requestCount } = await fetchYahooSparkBatches(
      SYMBOLS.map((symbol) => symbol.yahoo),
    );
    const errors = [...batchErrors];
    const commodities = [];
    const missingTickers = [];

    for (const symbol of SYMBOLS) {
      const result = bySymbol.get(symbol.yahoo.toUpperCase());
      if (!result) {
        missingTickers.push(symbol.ticker);
        continue;
      }
      try {
        commodities.push(yahooSparkRow(symbol, result, fetchedAt));
      } catch (error) {
        missingTickers.push(symbol.ticker);
        errors.push(`${symbol.yahoo}: ${String(error?.message || error)}`);
      }
    }

    if (missingTickers.length && errors.length === 0) {
      errors.push(`Yahoo omitted ${missingTickers.length} symbols`);
    }

    const staleCount = commodities.filter((row) => row.stale).length;
    const counts = {
      requested: SYMBOLS.length,
      received: commodities.length,
      failed: SYMBOLS.length - commodities.length,
      stale: staleCount,
      requests: requestCount,
    };

    if (commodities.length === 0) {
      res.status(502).json({
        ok: false,
        error: 'all upstream fetches failed',
        fetchedAt,
        partial: true,
        counts,
        missingTickers,
        errors,
      });
      return;
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      ok: true,
      source: 'yahoo',
      fetchedAt,
      asOf: commodities
        .map((row) => row.asOf)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
      partial: counts.failed > 0 || counts.stale > 0,
      counts,
      missingTickers,
      errors: errors.length ? errors : undefined,
      commodities,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
