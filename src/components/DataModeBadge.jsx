import React from 'react';

/** Vercel dashboard tokens — wiki/tools/awesome-design-md.md */
const STYLES = {
  LIVE: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  DEGRADED: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  STALE: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  MOCK: 'border-[#333] bg-[#0a0a0a] text-[#737373]',
};

export default function DataModeBadge({
  mode = 'MOCK',
  updatedLabel,
  onRefresh,
  refreshing,
}) {
  const pill = STYLES[mode] || STYLES.MOCK;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-mono text-[10px] uppercase tracking-[0.14em] ${pill}`}
        title={updatedLabel || mode}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            mode === 'LIVE' ? 'bg-emerald-400 animate-pulse-soft' : (mode === 'DEGRADED' || mode === 'STALE') ? 'bg-amber-400' : 'bg-[#525252]'
          }`}
        />
        {mode}
      </span>
      {updatedLabel && (
        <span className="hidden md:inline font-mono text-[10px] text-[#737373] tabular-nums tracking-tight">
          {updatedLabel}
        </span>
      )}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="p-1.5 rounded-md border border-[#333] bg-[#0a0a0a] text-[#737373] hover:text-[#0070f3] hover:border-[#0070f3]/40 disabled:opacity-40 transition-colors"
          aria-label="Refresh market snapshot"
          title="Refresh snapshot"
        >
          <svg
            className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      )}
    </div>
  );
}
