import React, { useState, useMemo } from 'react';
import { categoryColor } from '../data/mockData.js';
import { useLiveData } from '../state/LiveData.jsx';

const FILTERS = ['All', 'Breaking', 'Shipping', 'Energy', 'Metals', 'Agri', 'Geopolitical', 'Tech', 'Data', 'Crypto'];

const severityDot = (s) => ({
  CRITICAL: 'bg-red-500',
  HIGH:     'bg-orange-500',
  MODERATE: 'bg-yellow-500',
}[s] || null);

const severityLabel = (s) => ({
  CRITICAL: 'CRITICAL',
  HIGH:     'IMPORTANT',
  MODERATE: 'NOTABLE',
}[s] || null);

export default function Intel() {
  const { intel, newsLive, newsUpdatedAt, newsLoading, refresh } = useLiveData();
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    let arr;
    if (filter === 'All') arr = intel;
    else if (filter === 'Breaking') arr = intel.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH');
    else arr = intel.filter((i) => i.category === filter);

    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter((i) =>
        i.headline?.toLowerCase().includes(q) ||
        i.desc?.toLowerCase().includes(q) ||
        i.source?.toLowerCase().includes(q)
      );
    }
    return arr;
  }, [filter, query, intel]);

  const breakingCount = useMemo(
    () => intel.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').length,
    [intel]
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-br from-gray-50 to-gray-300 bg-clip-text text-transparent">
            Intel Feed
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-gray-400">
            <span className="hidden sm:inline">Curated wire from real publishers via Google News.</span>
            <span className={`text-[11px] flex items-center gap-1.5 ${newsLive ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${newsLive ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
              {newsLive ? 'live · Google News' : newsLoading ? 'fetching…' : 'offline'}
            </span>
            {newsUpdatedAt && (
              <span className="text-[10px] text-gray-500 font-mono">
                {new Date(newsUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </div>
        </div>
        <button
          onClick={refresh}
          className="self-start px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 sm:mx-0 px-4 sm:px-0 pb-1 sm:flex-wrap">
          {FILTERS.map((f) => {
            const isBreaking = f === 'Breaking';
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border transition-all flex items-center gap-1.5
                  ${filter === f
                    ? (isBreaking
                        ? 'bg-red-500/90 border-red-400 text-gray-950 shadow'
                        : 'bg-gradient-to-b from-gray-50 to-gray-200 text-gray-950 border-gray-100')
                    : (isBreaking
                        ? 'bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20'
                        : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-900')}`}
              >
                {isBreaking && (
                  <span className={`w-1.5 h-1.5 rounded-full ${filter === f ? 'bg-gray-950' : 'bg-red-400 animate-pulse-soft'}`} />
                )}
                {f}
                {isBreaking && breakingCount > 0 && (
                  <span className={`ml-0.5 text-[10px] font-mono ${filter === f ? 'text-red-900' : 'text-red-200'}`}>
                    {breakingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="sm:ml-auto relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headlines…"
            className="bg-gray-900/70 border border-gray-800 text-sm text-gray-100 rounded-md px-3 py-2 w-full sm:w-72 focus:outline-none focus:border-cyan-500 placeholder:text-gray-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200 text-sm"
              aria-label="clear"
            >×</button>
          )}
        </div>
      </div>

      <div className="text-[11px] uppercase tracking-widest text-gray-500">
        Showing {list.length} of {intel.length} items
      </div>

      <div className="space-y-2">
        {list.map((it) => {
          const href = it.url || '#';
          const external = href !== '#';
          return (
            <a
              key={it.id}
              href={href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
              className="group block rounded-xl border border-gray-800 bg-gray-900/70 hover:border-cyan-700/60 hover:bg-gray-900 p-4 transition-all"
            >
              <div className="flex items-center gap-2 sm:gap-3 text-[10px] uppercase tracking-widest flex-wrap">
                {severityDot(it.severity) && (
                  <span className="flex items-center gap-1" title={severityLabel(it.severity) || ''}>
                    <span className={`w-1.5 h-1.5 rounded-full ${severityDot(it.severity)} ${it.severity === 'CRITICAL' ? 'animate-pulse-soft' : ''}`} />
                    <span className={
                      it.severity === 'CRITICAL' ? 'text-red-400'
                      : it.severity === 'HIGH'   ? 'text-orange-400'
                      : 'text-yellow-400'
                    }>{severityLabel(it.severity)}</span>
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded border ${categoryColor(it.category)}`}>{it.category}</span>
                <span className="text-gray-400 truncate max-w-[180px]">{it.source}</span>
                {it.time && <><span className="text-gray-600">•</span><span className="text-gray-500">{it.time}</span></>}
                {external && (
                  <span className="ml-auto text-gray-500 group-hover:text-cyan-300 normal-case tracking-normal text-[10px] flex items-center gap-1 transition-colors">
                    open
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 3h7v7" /><path d="M21 3l-9 9" /><path d="M21 14v7H3V3h7" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-100 leading-snug">{it.headline}</div>
              {it.desc && <div className="mt-1 text-xs text-gray-400 line-clamp-2">{it.desc}</div>}
            </a>
          );
        })}
        {list.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 text-sm text-gray-500 py-10 text-center">
            No items match this filter.
          </div>
        )}
      </div>
    </div>
  );
}
