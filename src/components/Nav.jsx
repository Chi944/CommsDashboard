import React, { useEffect, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { CURRENCY_META } from '../../lib/symbols.js';
import DataModeBadge from './DataModeBadge.jsx';

const TABS = ['Overview', 'Prices', 'Currency', 'Portfolio', 'Intel'];

export default function Nav({ active, setActive, onOpenAlerts, onOpenPalette }) {
  const [now, setNow] = useState(new Date());
  const {
    pricesLive, newsLive, notifications,
    dashboardCurrency, setDashboardCurrency, availableCurrencies,
    dataMode, marketUpdatedLabel, marketRefreshing, refreshMarketSnapshot,
    useMarketV2,
  } = useLiveData();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const liveStatus = pricesLive && newsLive ? 'LIVE' : pricesLive || newsLive ? 'PARTIAL' : 'OFFLINE';
  const liveColor = liveStatus === 'LIVE' ? 'text-emerald-400' : liveStatus === 'PARTIAL' ? 'text-amber-400' : 'text-gray-500';
  const liveDot = liveStatus === 'LIVE' ? 'bg-emerald-400 animate-pulse-soft' : liveStatus === 'PARTIAL' ? 'bg-amber-400' : 'bg-gray-500';
  const criticalCount = (notifications || []).filter((n) => n.severity === 'CRITICAL' || n.severity === 'HIGH').length;

  return (
    <nav className="bg-[#000000]/90 backdrop-blur border-b border-[#262626] px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[#171717] border border-[#333] grid place-items-center shrink-0">
            <span className="text-[11px] font-bold font-mono text-[#f5f5f5]">M</span>
          </div>
          <h1 className="text-[12px] sm:text-sm font-semibold tracking-tight text-[#f5f5f5] truncate">
            <span className="hidden sm:inline">Markets &amp; Headlines</span>
            <span className="sm:hidden">Markets</span>
          </h1>
        </div>
        <div className="hidden md:flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setActive(t)}
              aria-current={active === t ? 'page' : undefined}
              className={`relative px-3 py-1.5 text-xs uppercase tracking-wider rounded-lg transition-all font-mono
                ${active === t
                  ? 'text-white bg-[#171717] border border-[#333]'
                  : 'text-[#737373] hover:text-[#f5f5f5] hover:bg-[#0a0a0a]'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5 text-xs text-[#737373]">
        <label className="flex items-center gap-1.5 px-1.5 sm:px-2 py-1 rounded-md bg-[#0a0a0a] border border-[#333] hover:border-[#525252] transition-colors cursor-pointer">
          <select
            value={dashboardCurrency}
            onChange={(e) => setDashboardCurrency(e.target.value)}
            className="w-12 sm:w-auto bg-transparent text-[#f5f5f5] font-mono text-xs focus:outline-none cursor-pointer"
            aria-label="Display currency"
          >
            {availableCurrencies.map((c) => (
              <option key={c} value={c} className="bg-[#171717]">
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={onOpenPalette}
          className="flex items-center p-1.5 rounded-md border border-[#333] bg-[#0a0a0a] text-[#737373] hover:text-[#f5f5f5] hover:border-[#525252] transition-colors"
          aria-label="open command palette"
          title="Command palette"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3-3" />
          </svg>
        </button>
        <button
          onClick={onOpenAlerts}
          className="relative p-1.5 rounded-md border border-[#333] bg-[#0a0a0a] text-[#a3a3a3] hover:text-[#f5f5f5] hover:border-[#525252] transition-colors"
          aria-label="open alerts"
          title="Alerts"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10 21a2 2 0 0 0 4 0" />
          </svg>
          {criticalCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-[9px] font-bold text-[#0a0a0a] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center font-mono">
              {criticalCount}
            </span>
          )}
        </button>
        <DataModeBadge
          mode={dataMode}
          updatedLabel={marketUpdatedLabel}
          onRefresh={refreshMarketSnapshot}
          refreshing={marketRefreshing}
        />
        {!useMarketV2 && (
          <div className="hidden xl:flex items-center gap-2 px-2 py-1 rounded-md bg-[#0a0a0a] border border-[#333]" title="News + Yahoo prices">
            <span className={`w-1.5 h-1.5 rounded-full ${liveDot}`} />
            <span className={`uppercase tracking-widest text-[10px] font-mono ${liveColor}`}>{liveStatus}</span>
          </div>
        )}
        <div className="hidden lg:block font-mono text-[#a3a3a3] text-xs tabular-nums">
          {now.toUTCString().slice(17, 25)} <span className="text-[#525252]">UTC</span>
        </div>
      </div>
    </nav>
  );
}
