import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const REQUEST_TIMEOUT_MS = 8_000;

function formatDate(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : date;
}

function formatDateRange(event) {
  return event.endDate && event.endDate !== event.date
    ? `${formatDate(event.date)}–${formatDate(event.endDate)}`
    : formatDate(event.date);
}

function relativeDay(date, from) {
  const target = Date.parse(`${date}T00:00:00.000Z`);
  const start = Date.parse(`${from}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(start)) return '';
  const days = Math.round((target - start) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `in ${days}d`;
}

function checkedLabel(value) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return '';
  return `Checked ${instant.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function statusClasses(state) {
  if (state === 'live') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (state === 'degraded') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  if (state === 'loading') return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
  return 'border-red-500/40 bg-red-500/10 text-red-300';
}

export default function EconomicCalendar() {
  const mounted = useRef(true);
  const [result, setResult] = useState({ loading: true, data: null, failed: false });

  const loadCalendar = useCallback(async () => {
    if (mounted.current) setResult((current) => ({ ...current, loading: true, failed: false }));
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('calendar request timeout'));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([fetch('/api/calendar', { signal: controller.signal }), deadline]);
      const payload = await response.json();
      const data = {
        ...payload,
        providers: Array.isArray(payload?.providers) ? payload.providers : [],
        events: Array.isArray(payload?.events) ? payload.events : [],
      };
      if (mounted.current) setResult({ loading: false, data, failed: !response.ok || !payload?.ok });
    } catch {
      if (mounted.current) setResult({ loading: false, data: null, failed: true });
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadCalendar();
    return () => { mounted.current = false; };
  }, [loadCalendar]);

  const unavailableProviders = useMemo(
    () => (result.data?.providers || []).filter((provider) => provider.status !== 'live'),
    [result.data],
  );
  const state = result.loading && !result.data
    ? 'loading'
    : result.failed || result.data?.state === 'unavailable'
      ? 'unavailable'
      : result.data?.state === 'degraded'
        ? 'degraded'
        : 'live';

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden" aria-labelledby="economic-calendar-title">
      <div className="px-4 py-3 sm:px-5 border-b border-gray-800 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 id="economic-calendar-title" className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Economic Calendar</h2>
          <div className="text-xs text-gray-300 mt-0.5">Next 90 days · official U.S. schedules</div>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" aria-label="Economic calendar status" className={`rounded border px-2 py-1 text-[10px] font-mono tracking-widest ${statusClasses(state)}`}>
            {state.toUpperCase()}
          </span>
          <button type="button" onClick={loadCalendar} disabled={result.loading} aria-label="Refresh economic calendar" className="rounded border border-gray-700 px-2 py-1 text-[10px] font-mono text-gray-300 hover:border-cyan-500/50 hover:text-cyan-300 disabled:cursor-wait disabled:opacity-50">
            {result.loading ? 'LOADING' : 'REFRESH'}
          </button>
        </div>
      </div>

      {state === 'degraded' && (
        <div role="alert" className="mx-4 mt-3 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {unavailableProviders.length === 1
            ? `${unavailableProviders[0].name} is temporarily unavailable; other official schedules remain live.`
            : `${unavailableProviders.map((provider) => provider.name).join(' and ')} are temporarily unavailable; other official schedules remain live.`}
        </div>
      )}

      {state === 'unavailable' ? (
        <div className="px-4 py-8 text-center">
          <div role="alert" className="text-sm text-red-300">Economic calendar unavailable. No static or estimated events are being shown.</div>
          <button type="button" onClick={loadCalendar} aria-label="Retry economic calendar" className="mt-3 rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:border-cyan-500/50 hover:text-cyan-300">Retry</button>
        </div>
      ) : state === 'loading' ? (
        <div className="px-4 py-8 text-center text-xs text-gray-500">Loading official schedules…</div>
      ) : (
        <div className="overflow-x-auto" role="region" aria-label="Official economic release schedule" tabIndex={0}>
          <table className="w-full min-w-[480px] text-xs sm:min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-800 text-[10px] uppercase tracking-widest text-gray-500">
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Event</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Release time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {result.data.events.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No official events are scheduled in this window.</td></tr>
              )}
              {result.data.events.map((event) => {
                const relative = relativeDay(event.date, result.data.window?.from);
                return (
                  <tr key={event.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                      <div className="text-gray-100">{formatDateRange(event)}</div>
                      <div className={`mt-0.5 text-[10px] ${relative === 'Today' ? 'text-cyan-400 font-semibold' : 'text-gray-500'}`}>{relative}</div>
                      <div className={`mt-0.5 text-[10px] font-mono sm:hidden ${event.timeStatus === 'scheduled' ? 'text-gray-300' : 'text-gray-500'}`}>{event.timeLabel}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-gray-100 hover:text-cyan-300">{event.title}</a>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-cyan-300">{event.sourceShortName}</td>
                    <td className={`hidden px-4 py-2.5 text-right font-mono sm:table-cell ${event.timeStatus === 'scheduled' ? 'text-gray-300' : 'text-gray-500'}`}>{event.timeLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.data && state !== 'unavailable' && (
        <div className="border-t border-gray-800 px-4 py-3 sm:px-5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Economic calendar sources">
            {result.data.providers.map((provider) => (
              <span key={provider.id} className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${provider.status === 'live' ? 'bg-emerald-400' : 'bg-red-400'}`} aria-hidden="true" />
                <a href={provider.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-300">{provider.name} source</a>
              </span>
            ))}
          </div>
          <time dateTime={result.data.asOf} title={result.data.asOf}>{checkedLabel(result.data.asOf)}</time>
        </div>
      )}
    </section>
  );
}
