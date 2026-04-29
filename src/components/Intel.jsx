import React, { useState, useMemo } from 'react';
import { intel, categoryColor } from '../data/mockData.js';

const FILTERS = ['All', 'Shipping', 'Energy', 'Metals', 'Agri', 'Geopolitical'];

export default function Intel() {
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    let arr = filter === 'All' ? intel : intel.filter((i) => i.category === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter((i) =>
        i.headline.toLowerCase().includes(q) ||
        i.desc.toLowerCase().includes(q) ||
        i.source.toLowerCase().includes(q)
      );
    }
    return arr;
  }, [filter, query]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-50">Intel Feed</h2>
        <p className="text-sm text-gray-400 mt-1">Curated wire from shipping, energy, metals, and geopolitical sources.</p>
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
        {list.map((it) => (
          <a
            key={it.id}
            href="#"
            className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-lg p-4 transition-colors"
          >
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest">
              <span className={`px-2 py-0.5 rounded border ${categoryColor(it.category)}`}>{it.category}</span>
              <span className="text-gray-400">{it.source}</span>
              <span className="text-gray-600">•</span>
              <span className="text-gray-500">{it.time}</span>
            </div>
            <div className="mt-2 text-sm font-semibold text-gray-100">{it.headline}</div>
            <div className="mt-1 text-xs text-gray-400">{it.desc}</div>
          </a>
        ))}
        {list.length === 0 && (
          <div className="text-sm text-gray-500 py-8 text-center">No items match this filter.</div>
        )}
      </div>
    </div>
  );
}
