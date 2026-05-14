import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { assetCategoryColor } from '../data/mockData.js';

const TABS = ['Overview', 'Prices', 'Currency', 'Portfolio', 'Intel'];

export default function CommandPalette({ open, onClose, onSelectAsset, onSwitchTab }) {
  const { commodities } = useLiveData();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    const tabs = TABS.map((t) => ({ kind: 'tab', label: `Go to ${t}`, value: t }));
    const assets = commodities
      .filter((c) => c.category !== 'FX')
      .map((c) => ({ kind: 'asset', label: `${c.ticker} · ${c.name}`, c }));

    let pool = [...tabs, ...assets];
    if (query) {
      pool = pool.filter((r) => {
        if (r.kind === 'tab') return r.value.toLowerCase().includes(query);
        const c = r.c;
        return c.ticker.toLowerCase().includes(query)
            || c.name.toLowerCase().includes(query)
            || c.symbol.toLowerCase().includes(query)
            || c.category.toLowerCase().includes(query);
      });
    } else {
      // No query: show tabs first then a few popular assets
      pool = [...tabs, ...assets.slice(0, 12)];
    }
    return pool.slice(0, 40);
  }, [commodities, q]);

  useEffect(() => { if (cursor >= results.length) setCursor(0); }, [cursor, results.length]);

  const choose = (r) => {
    if (!r) return;
    if (r.kind === 'tab') onSwitchTab?.(r.value);
    if (r.kind === 'asset') onSelectAsset?.(r.c.ticker);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === 'Enter')     { e.preventDefault(); choose(results[cursor]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, cursor]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-xl rounded-xl border border-gray-800 bg-gray-950/95 shadow-2xl overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            placeholder="Jump to ticker, name, or tab…"
            className="flex-1 bg-transparent text-sm text-gray-100 focus:outline-none placeholder:text-gray-500"
          />
          <kbd className="text-[10px] text-gray-500 font-mono px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900">esc</kbd>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto divide-y divide-gray-900">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-500">No matches.</li>
          )}
          {results.map((r, i) => (
            <li
              key={`${r.kind}-${r.kind === 'tab' ? r.value : r.c.ticker}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(r)}
              className={`px-4 py-2.5 cursor-pointer flex items-center gap-3 ${cursor === i ? 'bg-gray-800/70' : 'hover:bg-gray-900'}`}
            >
              {r.kind === 'tab' ? (
                <>
                  <div className="w-6 h-6 grid place-items-center text-gray-400">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-100">{r.label}</span>
                </>
              ) : (
                <>
                  <span className="font-mono text-xs text-gray-100 w-16">{r.c.ticker}</span>
                  <span className="text-sm text-gray-100 flex-1 truncate">{r.c.name}</span>
                  <span className={`text-[10px] uppercase tracking-wider ${assetCategoryColor(r.c.category)}`}>{r.c.category}</span>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-800 px-4 py-2 text-[10px] text-gray-500 flex items-center gap-3">
          <span className="flex items-center gap-1"><kbd className="font-mono px-1 rounded border border-gray-700 bg-gray-900">↑</kbd><kbd className="font-mono px-1 rounded border border-gray-700 bg-gray-900">↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="font-mono px-1 rounded border border-gray-700 bg-gray-900">↵</kbd> select</span>
          <span className="ml-auto">{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
