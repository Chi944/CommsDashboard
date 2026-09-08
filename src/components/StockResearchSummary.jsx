import React, { useEffect, useState } from 'react';
import { fetchStockResearchRun, stockResearchSummary, STOCK_RESEARCH_URL } from '../lib/stockResearch.js';

export default function StockResearchSummary() {
  const [run, setRun] = useState(null);
  const [state, setState] = useState('loading');
  const [revision, setRevision] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let active = true;
    setState('loading');
    fetchStockResearchRun(controller.signal).then((next) => {
      if (active) { setRun(next); setState('ready'); setNowMs(Date.now()); }
    }).catch(() => {
      if (active) setState('unavailable');
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [revision]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  let summary = null;
  try { if (run) summary = stockResearchSummary(run, nowMs); } catch { /* invalid clock or expired contract */ }
  return (
    <section aria-label="Weekly stock research" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
      <div>
        <a href={STOCK_RESEARCH_URL} className="text-sm font-semibold text-gray-200 hover:text-white">Weekly stock screen</a>
        <p role="status" className="mt-1 text-xs text-gray-400">
          {summary ? <>
            <span className={summary.stale || state === 'unavailable' ? 'text-amber-300' : 'text-gray-200'}>
              {summary.passed} passed of {summary.screened} screened
            </span>
            {' · '}Data as of <time dateTime={summary.asOf}>{summary.asOf}</time>
            {summary.stale ? ' · Stale snapshot' : ''}
            {state === 'unavailable' ? ' · Refresh unavailable; showing last snapshot' : ''}
          </> : state === 'loading' ? 'Loading the published weekly screen…' : 'Snapshot unavailable. Open Stock Research or retry.'}
        </p>
        <p className="mt-1 text-[11px] text-gray-500">Screening evidence from Stock Research. MiroFish simulations are separate in Research Lab.</p>
      </div>
      <button type="button" disabled={state === 'loading'} onClick={() => setRevision((value) => value + 1)}
        aria-label="Refresh weekly stock research"
        className="px-3 py-1.5 text-xs rounded-md border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-50">
        {state === 'loading' ? 'Loading…' : 'Refresh screen'}
      </button>
    </section>
  );
}
