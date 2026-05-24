import React from 'react';

const STYLES = {
  LIVE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  STALE: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  MOCK: 'border-gray-600 bg-gray-900/80 text-gray-400',
};

/**
 * Data freshness pill — Geist-style monospace, tight padding.
 * @see wiki/tools/awesome-design-md.md (Vercel: Geist, mono data)
 */
export default function DataModeBadge({ mode = 'MOCK', updatedLabel, onRefresh, refreshing }) {
  const pill = STYLES[mode] || STYLES.MOCK;

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-mono text-[10px] uppercase tracking-widest ${pill}`}
        title={updatedLabel || mode}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            mode === 'LIVE' ? 'bg-emerald-400' : mode === 'STALE' ? 'bg-amber-400' : 'bg-gray-500'
          }`}
        />
        {mode}
      </span>
      {updatedLabel && (
        <span className="hidden sm:inline font-mono text-[10px] text-gray-500 tabular-nums">
          {updatedLabel}
        </span>
      )}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="p-1 rounded-md border border-gray-800 bg-gray-900/60 text-gray-400 hover:text-gray-100 hover:border-gray-600 disabled:opacity-50 transition-colors"
          aria-label="Refresh market snapshot"
          title="Refresh market data"
        >
          <svg
            className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      )}
    </div>
  );
}
