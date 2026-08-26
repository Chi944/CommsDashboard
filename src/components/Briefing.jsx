import React, {
  useEffect, useId, useReducer, useRef, useState,
} from 'react';
import { readDashboardJson } from '../lib/apiClient.js';
import {
  createDailyBriefingState,
  dailyBriefingReducer,
  isValidDailyBriefingEnvelope,
} from '../lib/dailyBriefingState.js';

const utcDay = () => new Date().toISOString().slice(0, 10);
const STALE_DAY_RETRY_MS = 60_000;
const MAX_STALE_DAY_RETRY_MS = 15 * 60_000;
const MARKET_PARAGRAPH_IDS = Object.freeze([
  'market-tone', 'themes-catalysts', 'watchpoints',
]);
const PARAGRAPH_LABELS = Object.freeze({
  'market-tone': 'Market tone',
  'themes-catalysts': 'Themes and catalysts',
  watchpoints: 'Watchpoints',
});

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isValidMarketBriefingEnvelope(value) {
  return isValidDailyBriefingEnvelope(value)
    && value.briefing.paragraphs.every(
      (paragraph, index) => paragraph.id === MARKET_PARAGRAPH_IDS[index],
    );
}

function inputLabel(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Unavailable';
  return `Current · as of ${new Date(value).toUTCString().replace('GMT', 'UTC')}`;
}

function InputState({ label, value }) {
  return (
    <li className="text-[10px] text-gray-500">
      <span><span className="uppercase tracking-widest">{label} input</span> — {inputLabel(value)}</span>
    </li>
  );
}

function EvidenceList({ evidenceIds, evidenceById }) {
  const records = evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
  if (!records.length) return null;
  return (
    <ul aria-label="Paragraph evidence" className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {records.map((record) => {
        const url = safeHttpsUrl(record.sourceUrl);
        const label = String(record.label || record.source || 'Evidence');
        return (
          <li key={record.id} className="text-[10px] text-cyan-300/80">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-cyan-700/60 underline-offset-2 hover:text-cyan-200"
              >{label}</a>
            ) : <span>{label}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function Briefing() {
  const [briefingState, dispatchBriefing] = useReducer(
    dailyBriefingReducer,
    undefined,
    () => createDailyBriefingState(),
  );
  const [open, setOpen] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);
  const requestIdRef = useRef(0);
  const acceptedMarketDayRef = useRef(null);
  const requestedMarketDayRef = useRef(null);
  const staleDayRetryRef = useRef(null);
  const staleDayRetryAttemptRef = useRef(0);
  const staleDayRetryDateRef = useRef(null);
  const detailsId = useId();

  const scheduleDailyRetry = (delayOverride = null) => {
    if (staleDayRetryRef.current != null) return;
    const currentDay = utcDay();
    if (staleDayRetryDateRef.current !== currentDay) {
      staleDayRetryDateRef.current = currentDay;
      staleDayRetryAttemptRef.current = 0;
    }
    const delay = delayOverride ?? Math.min(
      STALE_DAY_RETRY_MS * (2 ** staleDayRetryAttemptRef.current),
      MAX_STALE_DAY_RETRY_MS,
    );
    staleDayRetryAttemptRef.current += 1;
    staleDayRetryRef.current = window.setTimeout(() => {
      staleDayRetryRef.current = null;
      requestedMarketDayRef.current = utcDay();
      setRequestVersion((version) => version + 1);
    }, delay);
  };

  useEffect(() => {
    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestedDay = utcDay();
    requestedMarketDayRef.current = requestedDay;
    dispatchBriefing({ type: 'request', requestId });
    const url = requestVersion > 0 ? '/api/briefing?refresh=1' : '/api/briefing';
    fetch(url, { method: 'GET', credentials: 'omit' })
      .then(readDashboardJson)
      .then((candidate) => {
        if (cancelled) return;
        const valid = isValidMarketBriefingEnvelope(candidate);
        dispatchBriefing({
          type: 'success',
          requestId,
          candidate: valid ? candidate : null,
        });
        requestedMarketDayRef.current = null;
        const currentDay = utcDay();
        if (valid && candidate.briefing.marketDate === currentDay) {
          acceptedMarketDayRef.current = currentDay;
          window.clearTimeout(staleDayRetryRef.current);
          staleDayRetryRef.current = null;
          staleDayRetryAttemptRef.current = 0;
          staleDayRetryDateRef.current = currentDay;
        } else if (valid && candidate.briefing.marketDate !== currentDay) {
          if (requestVersion === 0) scheduleDailyRetry(0);
          else scheduleDailyRetry();
        } else if (candidate?.aiStatus?.retryable === true
          || acceptedMarketDayRef.current !== currentDay) {
          scheduleDailyRetry();
        }
      })
      .catch(() => {
        if (cancelled) return;
        dispatchBriefing({
          type: 'failure',
          requestId,
          error: 'Briefing refresh failed. Showing the last available briefing.',
        });
        if (requestedMarketDayRef.current === requestedDay) {
          requestedMarketDayRef.current = null;
        }
        if (acceptedMarketDayRef.current !== utcDay()) scheduleDailyRetry();
      });
    return () => { cancelled = true; };
  }, [requestVersion]);

  useEffect(() => {
    let dayBoundaryTimer;
    const refreshForNewDay = () => {
      const currentDay = utcDay();
      if (currentDay === acceptedMarketDayRef.current
        || currentDay === requestedMarketDayRef.current) return;
      requestedMarketDayRef.current = currentDay;
      setRequestVersion((version) => version + 1);
    };
    const scheduleDayBoundary = () => {
      const now = new Date();
      const nextDayMs = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0, 0, 1,
      );
      dayBoundaryTimer = window.setTimeout(() => {
        refreshForNewDay();
        scheduleDayBoundary();
      }, Math.max(1_000, nextDayMs - now.getTime()));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshForNewDay();
    };

    window.addEventListener('focus', refreshForNewDay);
    document.addEventListener('visibilitychange', onVisibilityChange);
    scheduleDayBoundary();
    return () => {
      window.clearTimeout(dayBoundaryTimer);
      window.clearTimeout(staleDayRetryRef.current);
      window.removeEventListener('focus', refreshForNewDay);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const data = briefingState.accepted;
  const briefing = data?.briefing;
  const hasBriefing = Boolean(briefing);
  const evidenceById = new Map(
    (Array.isArray(briefing?.evidence) ? briefing.evidence : [])
      .map((record) => [record.id, record]),
  );
  const sourceLabel = briefing?.source === 'generated' ? 'AI generated' : 'Deterministic fallback';
  const inputsAsOf = briefing?.inputsAsOf || {};

  const refresh = () => {
    window.clearTimeout(staleDayRetryRef.current);
    staleDayRetryRef.current = null;
    staleDayRetryAttemptRef.current = 0;
    staleDayRetryDateRef.current = utcDay();
    requestedMarketDayRef.current = utcDay();
    setRequestVersion((version) => version + 1);
  };

  return (
    <div className="rounded-xl border border-cyan-700/30 bg-gradient-to-br from-cyan-900/20 via-gray-900/80 to-gray-900/40 overflow-hidden">
      <div className="w-full flex items-center hover:bg-white/5 transition-colors">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${open ? 'Collapse' : 'Expand'} market briefing`}
          className="min-w-0 flex-1 flex items-center justify-between gap-3 pl-4 sm:pl-5 pr-2 py-3 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-400 to-violet-500 grid place-items-center shadow-glow shrink-0">
              <span className="text-[10px] font-bold text-gray-950">AI</span>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-cyan-300/80">Market Briefing</div>
              <div className="text-sm text-gray-100 truncate">
                {briefingState.loading
                  ? (hasBriefing ? 'Refreshing today\'s briefing…' : 'Loading today\'s briefing…')
                  : (hasBriefing ? 'Today\'s market in three paragraphs' : 'Briefing')}
              </div>
            </div>
          </div>
          <span aria-hidden="true" className="text-gray-500 text-base shrink-0">{open ? '▾' : '▸'}</span>
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={briefingState.loading}
          aria-label="Refresh market briefing"
          className="mr-4 sm:mr-5 shrink-0 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-md border border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-50"
        >{briefingState.loading ? '…' : 'refresh'}</button>
      </div>

      {open && (
        <div id={detailsId} role="region" aria-label="Market briefing details" className="border-t border-gray-800 p-4 sm:p-5 space-y-3">
          {briefingState.error && (
            <div role="alert" className="text-xs text-amber-300">
              Briefing refresh failed. Showing the last available briefing.
            </div>
          )}

          {briefingState.loading && hasBriefing && (
            <div role="status" aria-label="Refreshing market briefing" className="text-[10px] text-cyan-300/80">
              Checking for a newer daily briefing…
            </div>
          )}

          {hasBriefing && (
            <>
              <div
                role="status"
                aria-label="Briefing source"
                className={`text-[10px] uppercase tracking-widest ${briefing.source === 'generated' ? 'text-cyan-300' : 'text-amber-300'}`}
              >
                {sourceLabel}
                {briefing.source === 'deterministic' ? ' · AI generation unavailable; evidence-based fallback shown' : ''}
              </div>

              <div className="space-y-4">
                {briefing.paragraphs.map((paragraph) => (
                  <article
                    key={paragraph.id}
                    data-briefing-paragraph-id={paragraph.id}
                    className="text-xs sm:text-sm text-gray-200 leading-relaxed"
                  >
                    <h3 className="mb-1 text-[10px] uppercase tracking-widest text-gray-500">
                      {PARAGRAPH_LABELS[paragraph.id]}
                    </h3>
                    <p>{paragraph.text}</p>
                    <EvidenceList evidenceIds={paragraph.evidenceIds} evidenceById={evidenceById} />
                  </article>
                ))}
              </div>

              <ul aria-label="Briefing input status" className="grid grid-cols-1 gap-1 border-t border-gray-800 pt-3 sm:grid-cols-3">
                <InputState label="Market prices" value={inputsAsOf.market} />
                <InputState label="Headlines" value={inputsAsOf.news} />
                <InputState label="Sentiment" value={inputsAsOf.sentiment} />
              </ul>
            </>
          )}

          {data?.signals && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-800">
              <SignalList title="Top Gainers" rows={data.signals.gainers} positive />
              <SignalList title="Top Losers" rows={data.signals.losers} positive={false} />
            </div>
          )}

          {hasBriefing && (
            <div className="text-[9px] uppercase tracking-widest text-gray-600 pt-1">
              Updated {new Date(briefing.generatedAt).toUTCString().replace('GMT', 'UTC')}
            </div>
          )}

          {briefingState.loading && !hasBriefing && (
            <div role="status" aria-live="polite" aria-label="Loading market briefing" className="space-y-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-3 rounded bg-gray-800/70 animate-pulse" style={{ width: `${95 - index * 5}%` }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SignalList = ({ title, rows, positive }) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">{title}</div>
    <ul className="space-y-1">
      {(rows || []).slice(0, 3).map((row) => (
        <li key={row.ticker} className="flex items-center gap-2 text-xs">
          <span className="font-mono text-gray-100 w-14">{row.ticker}</span>
          <span className="text-gray-400 truncate flex-1">{row.name}</span>
          <span className={`font-mono ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(2)}%
          </span>
        </li>
      ))}
    </ul>
  </div>
);
