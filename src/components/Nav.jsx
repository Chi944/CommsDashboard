import React, { useEffect, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';

const TABS = ['Overview', 'Prices', 'Intel'];

export default function Nav({ active, setActive, onOpenAlerts }) {
  const [now, setNow] = useState(new Date());
  const { pricesLive, newsLive, notifications } = useLiveData();
  const liveStatus = pricesLive && newsLive ? 'LIVE' : pricesLive || newsLive ? 'PARTIAL' : 'OFFLINE';
  const liveColor = liveStatus === 'LIVE' ? 'text-green-400' : liveStatus === 'PARTIAL' ? 'text-yellow-400' : 'text-gray-500';
  const liveDot = liveStatus === 'LIVE' ? 'bg-green-400 animate-pulse' : liveStatus === 'PARTIAL' ? 'bg-yellow-400' : 'bg-gray-500';

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const criticalCount = (notifications || []).filter((n) => n.severity === 'CRITICAL' || n.severity === 'HIGH').length;

  return (
    <nav className="bg-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <h1 className="text-sm font-bold tracking-widest uppercase text-gray-100">
            Commodities &amp; Shipping Disruption Monitor
          </h1>
        </div>
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setActive(t)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded transition-colors
                ${active === t
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-900'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <div className="hidden md:flex items-center gap-2" title="Data source status">
          <span className="text-gray-500">DATA</span>
          <span className={`flex items-center gap-1.5 ${liveColor}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${liveDot}`} />
            {liveStatus}
          </span>
        </div>
        <button
          onClick={onOpenAlerts}
          className="relative px-2 py-1 rounded hover:bg-gray-900 text-gray-300 hover:text-white"
          aria-label="open alerts"
          title="Open alerts"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10 21a2 2 0 0 0 4 0" />
          </svg>
          {criticalCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-[9px] font-bold text-gray-950 rounded-full w-4 h-4 flex items-center justify-center">
              {criticalCount}
            </span>
          )}
        </button>
        <div className="font-mono text-gray-300">
          {now.toUTCString().slice(17, 25)} <span className="text-gray-500">UTC</span>
        </div>
      </div>
    </nav>
  );
}
