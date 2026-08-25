import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { assetCategoryColor } from '../data/mockData.js';

const TABS = ['Overview', 'Prices', 'Currency', 'Portfolio', 'Intel'];
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableElements = (container) => (
  container ? Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)) : []
);

export default function CommandPalette({ open, onClose, onSelectAsset, onSwitchTab }) {
  const { commodities } = useLiveData();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const listboxId = useId();

  // Reset on open
  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    setQ('');
    setCursor(0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      previousFocus?.focus?.();
    };
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

  useEffect(() => {
    if (!open || !results[cursor]) return;
    const activeOption = document.getElementById(`${listboxId}-option-${cursor}`);
    activeOption?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor, listboxId, open, results]);

  const choose = (r) => {
    if (!r) return;
    if (r.kind === 'tab') onSwitchTab?.(r.value);
    if (r.kind === 'asset') onSelectAsset?.(r.c.ticker);
    onClose();
  };

  const onDialogKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    if (e.target !== inputRef.current) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((current) => results.length ? Math.min(results.length - 1, current + 1) : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((current) => Math.max(0, current - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[cursor]);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4" onClick={onClose}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="relative w-full max-w-xl rounded-xl border border-gray-800 bg-gray-950/95 shadow-2xl overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-label="Search commands and assets"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-activedescendant={results[cursor] ? `${listboxId}-option-${cursor}` : undefined}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            placeholder="Jump to ticker, name, or tab…"
            className="flex-1 bg-transparent text-sm text-gray-100 focus:outline-none placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="text-[10px] text-gray-500 font-mono px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 hover:text-gray-200"
          >esc</button>
        </div>
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Commands and assets"
          className="max-h-[60vh] overflow-y-auto divide-y divide-gray-900"
        >
          {results.length === 0 && (
            <li role="presentation" className="px-4 py-6 text-center text-sm text-gray-500">No matches.</li>
          )}
          {results.map((r, i) => (
            <li
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={cursor === i}
              key={`${r.kind}-${r.kind === 'tab' ? r.value : r.c.ticker}`}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => e.preventDefault()}
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
