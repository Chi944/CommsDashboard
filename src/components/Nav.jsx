import React, { useEffect, useState } from 'react';

const TABS = ['Overview', 'Prices', 'Routes', 'Calculator', 'Intel'];

export default function Nav({ active, setActive }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <nav className="bg-gray-950 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <h1 className="text-sm font-bold tracking-widest uppercase text-gray-100">
            Commodities & Shipping Disruption Monitor
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
        <div className="hidden md:flex items-center gap-2">
          <span className="text-gray-500">STATUS</span>
          <span className="text-green-400">● LIVE</span>
        </div>
        <div className="font-mono text-gray-300">
          {now.toUTCString().slice(17, 25)} <span className="text-gray-500">UTC</span>
        </div>
      </div>
    </nav>
  );
}
