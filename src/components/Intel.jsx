import React, { useState, useMemo } from 'react';
import { categoryColor } from '../data/mockData.js';
import { useLiveData } from '../state/LiveData.jsx';

const FILTERS = ['All', 'Shipping', 'Energy', 'Metals', 'Agri', 'Geopolitical', 'Tech', 'Data', 'Crypto'];

export default function Intel() {
  const { intel, newsLive, newsUpdatedAt, newsLoading, refresh } = useLiveData();
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    let arr = filter === 'All' ? intel : intel.filter((i) => i.category === filter);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-50">Intel Feed</h2>
          <p className="text-sm text-gray-400 mt-1 flex items-center gap-3">
            <span>Curated wire from shipping, energy, metals, and geopolitical sources.</span>
            <span className={`text-[11px] flex items-center gap-1.5 ${newsLive ? 'text-green-400' : 'text-yellow-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${newsLive ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
              {newsLive ? 'live · Google News' : newsLoading ? 'fetching...' : 'fallback (mock)'}
            </span>
            {newsUpdatedAt && (
              <span className="text-[10px] text-gray-500 font-mono">
                {new Date(newsUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-xs uppercase tracking-wider rounded border bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border
                ${filter === f
                  ? 'bg-gray-100 text-gray-950 border-gray-100'
                  : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headlines, sources..."
            className="bg-gray-800 border border-gray-700 text-sm text-gray-100 rounded px-3 py-1.5 w-full sm:w-72 focus:outline-none focus:border-cyan-500 placeholder:text-gray-500"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200 text-sm"
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
              className="block bg-gray-900 border border-gray-800 hover:border-cyan-700 hover:bg-gray-900/80 rounded-lg p-4 transition-colors"
            >
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest">
                <span className={`px-2 py-0.5 rounded border ${categoryColor(it.category)}`}>{it.category}</span>
                <span className="text-gray-400">{it.source}</span>
                {it.time && <><span className="text-gray-600">•</span><span className="text-gray-500">{it.time}</span></>}
                {external && (
                  <span className="ml-auto text-gray-500 normal-case tracking-normal text-[10px] flex items-center gap-1">
                    open
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 3h7v7" /><path d="M21 3l-9 9" /><path d="M21 14v7H3V3h7" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm font-semibold text-gray-100">{it.headline}</div>
              {it.desc && <div className="mt-1 text-xs text-gray-400">{it.desc}</div>}
            </a>
          );
        })}
        {list.length === 0 && (
          <div className="text-sm text-gray-500 py-8 text-center">No items match this filter.</div>
        )}
      </div>
    </div>
  );
}
