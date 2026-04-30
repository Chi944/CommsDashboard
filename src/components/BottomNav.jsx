import React from 'react';

const ICONS = {
  Overview: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  Prices: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l5-5 4 4 8-9" />
      <path d="M14 7h6v6" />
    </svg>
  ),
  Intel: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h12a3 3 0 0 1 3 3v9a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V5z" />
      <path d="M8 9h7" /><path d="M8 13h7" /><path d="M8 17h4" />
    </svg>
  ),
};

export default function BottomNav({ active, setActive }) {
  const tabs = ['Overview', 'Prices', 'Intel'];
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-gray-950/90 backdrop-blur border-t border-gray-800 safe-bottom">
      <div className="grid grid-cols-3">
        {tabs.map((t) => {
          const sel = active === t;
          return (
            <button
              key={t}
              onClick={() => setActive(t)}
              className={`flex flex-col items-center gap-1 py-2 text-[10px] uppercase tracking-widest transition-colors
                ${sel ? 'text-cyan-300' : 'text-gray-500 hover:text-gray-200'}`}
              aria-current={sel ? 'page' : undefined}
            >
              <span className={sel ? 'text-cyan-300' : 'text-gray-400'}>{ICONS[t]}</span>
              <span>{t}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
