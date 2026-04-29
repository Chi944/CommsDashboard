import React, { useState } from 'react';
import { intel, categoryColor } from '../data/mockData.js';

const FILTERS = ['All', 'Shipping', 'Energy', 'Metals', 'Agri', 'Geopolitical'];

export default function Intel() {
  const [filter, setFilter] = useState('All');

  const list = filter === 'All' ? intel : intel.filter((i) => i.category === filter);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-50">Intel Feed</h2>
        <p className="text-sm text-gray-400 mt-1">Curated wire from shipping, energy, metals, and geopolitical sources.</p>
      </div>

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
