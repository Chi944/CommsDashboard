import React, { useEffect, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';

const TABS = ['Overview', 'Prices', 'Intel'];

export default function Nav({ active, setActive, onOpenAlerts }) {
  const [now, setNow] = useState(new Date());
  const { pricesLive, newsLive, notifications } = useLiveData();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const liveStatus = pricesLive && newsLive ? 'LIVE' : pricesLive || newsLive ? 'PARTIAL' : 'OFFLINE';
  const liveColor = liveStatus === 'LIVE' ? 'text-emerald-400' : liveStatus === 'PARTIAL' ? 'text-amber-400' : 'text-gray-500';
  const liveDot = liveStatus === 'LIVE' ? 'bg-emerald-400 animate-pulse-soft' : liveStatus === 'PARTIAL' ? 'bg-amber-400' : 'bg-gray-500';
  const criticalCount = (notifications || []).filter((n) => n.severity === 'CRITICAL' || n.severity === 'HIGH').length;

  return (
    <nav className="bg-gray-950/85 backdrop-blur border-b border-gray-800/80 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-400 to-violet-500 grid place-items-center shadow-glow shrink-0">
            <span className="text-[11px] font-bold text-gray-950">M</span>
          </div>
          <h1 className="text-[12px] sm:text-sm font-semibold tracking-wide text-gray-100 truncate">
            <span className="hidden sm:inline">Markets &amp; Headlines</span>
            <span className="sm:hidden">Markets</span>
          </h1>
        </div>
        <div className="hidden md:flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setActive(t)}
              className={`relative px-3 py-1.5 text-xs uppercase tracking-wider rounded-lg transition-all
                ${active === t
                  ? 'text-white bg-gray-800/80 shadow-inner'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-900/60'}`}
            >
              {t}
              {active === t && <span className="absolute -bottom-px left-1/2 -translate-x-1/2 w-6 h-px bg-cyan-400" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 text-xs text-gray-400">
        <div className="hidden lg:flex items-center gap-2 px-2 py-1 rounded-md bg-gray-900/60 border border-gray-800" title="Data source status">
          <span className={`w-1.5 h-1.5 rounded-full ${liveDot}`} />
          <span className={`uppercase tracking-widest text-[10px] ${liveColor}`}>{liveStatus}</span>
        </div>
        <button
          onClick={onOpenAlerts}
          className="relative p-2 rounded-md bg-gray-900/60 border border-gray-800 text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
          aria-label="open alerts"
          title="Alerts"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10 21a2 2 0 0 0 4 0" />
          </svg>
          {criticalCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-[9px] font-bold text-gray-950 rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
              {criticalCount}
            </span>
          )}
        </button>
        <div className="hidden sm:block font-mono text-gray-300 text-xs">
          {now.toUTCString().slice(17, 25)} <span className="text-gray-500">UTC</span>
        </div>
      </div>
    </nav>
  );
}
