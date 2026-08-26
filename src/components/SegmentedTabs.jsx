import React, { useRef } from 'react';

export default function SegmentedTabs({ label, value, onChange, tabs }) {
  const tabRefs = useRef([]);
  const select = (next) => {
    onChange(tabs[next].id);
    tabRefs.current[next]?.focus();
  };
  const move = (index, direction) => {
    select((index + direction + tabs.length) % tabs.length);
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-lg border border-gray-800 bg-gray-950/70 p-1"
    >
      {tabs.map((tab, index) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            ref={(node) => { tabRefs.current[index] = node; }}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') { event.preventDefault(); move(index, 1); }
              if (event.key === 'ArrowLeft') { event.preventDefault(); move(index, -1); }
              if (event.key === 'Home') { event.preventDefault(); select(0); }
              if (event.key === 'End') { event.preventDefault(); select(tabs.length - 1); }
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${active
              ? 'bg-cyan-400 text-gray-950'
              : 'text-gray-400 hover:text-gray-100'}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
