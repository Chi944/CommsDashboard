export const STOCK_RESEARCH_URL = 'https://stock-research-ecru.vercel.app/';
export const STOCK_RESEARCH_RUN_URL = `${STOCK_RESEARCH_URL}run.json`;
const DAY_MS = 86_400_000;
const MAX_RUN_BYTES = 2 * 1024 * 1024;

export function stockResearchTickerUrl(ticker) {
  return `${STOCK_RESEARCH_URL}?ticker=${encodeURIComponent(ticker)}`;
}

export function stockResearchSummary(run, nowMs = Date.now()) {
  if (run?.schema_version !== '2.0.0' || !/^run_\d{4}-\d{2}-\d{2}$/.test(run?.run_id || '')) {
    throw new Error('unsupported research snapshot');
  }
  const asOf = run.run_id.slice(4);
  const asOfMs = Date.parse(`${asOf}T00:00:00.000Z`);
  const todayMs = Math.floor(nowMs / DAY_MS) * DAY_MS;
  if (!Number.isFinite(todayMs) || !Number.isFinite(asOfMs)
    || new Date(asOfMs).toISOString().slice(0, 10) !== asOf || asOfMs > todayMs) {
    throw new Error('invalid research as-of date');
  }
  if (!Array.isArray(run.candidates) || run.candidates.length > 10_000
    || !run.candidates.every((row) => row && typeof row.ticker === 'string'
      && /^[A-Z0-9][A-Z0-9.\-]{0,15}$/.test(row.ticker) && typeof row.excluded === 'boolean')
    || new Set(run.candidates.map((row) => row.ticker)).size !== run.candidates.length
    || !Number.isSafeInteger(run.passed) || run.passed < 0
    || run.passed !== run.candidates.filter((row) => !row.excluded).length
    || !Number.isSafeInteger(run.stale_after_days) || run.stale_after_days < 1) {
    throw new Error('invalid research coverage');
  }
  const ageDays = Math.floor((todayMs - asOfMs) / DAY_MS);
  return {
    asOf, ageDays,
    stale: ageDays >= Math.min(run.stale_after_days, 8),
    screened: run.candidates.length,
    passed: run.passed,
  };
}

export async function fetchStockResearchRun(signal) {
  const response = await fetch(STOCK_RESEARCH_RUN_URL, {
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
  });
  if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) {
    throw new Error('research snapshot unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RUN_BYTES) throw new Error('research snapshot too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const run = JSON.parse(new TextDecoder().decode(bytes));
  stockResearchSummary(run);
  return run;
}
