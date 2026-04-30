import React, { useMemo } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { categoryColor, assetCategoryColor } from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';

const StatCard = ({ label, value, sub, accent }) => (
  <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/90 to-gray-900/40 p-4 sm:p-5 transition-colors hover:border-gray-700">
    <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
    <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
    <div className={`mt-2 font-mono text-2xl sm:text-3xl tracking-tight ${accent || 'text-gray-100'}`}>{value}</div>
    {sub && <div className="mt-1 text-[11px] sm:text-xs text-gray-400">{sub}</div>}
  </div>
);

const fmtPrice = (c) => {
  if (!c) return '—';
  if (c.price < 1) return `$${c.price.toFixed(4)}`;
  if (c.price >= 1000) return `$${c.price.toLocaleString()}`;
  return `$${c.price.toFixed(2)}`;
};

const Movers = ({ commodities, title, sortFn, accent }) => {
  const sorted = useMemo(() => [...commodities].sort(sortFn), [commodities, sortFn]);
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ${accent}`}>{title}</h3>
      </div>
      <ul className="divide-y divide-gray-800">
        {sorted.slice(0, 5).map((c) => {
          const up = c.changePct >= 0;
          return (
            <li key={c.ticker} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-gray-100 truncate">{c.name}</div>
                <div className={`text-[10px] font-mono ${assetCategoryColor(c.category)}`}>{c.ticker} · {c.category}</div>
              </div>
              <Sparkline
                data={c.history.map((h) => h.price)}
                color={up ? '#22c55e' : '#ef4444'}
                width={70}
                height={22}
              />
              <div className={`font-mono text-xs ${up ? 'text-green-400' : 'text-red-400'} w-16 text-right`}>
                {up ? '+' : ''}{c.changePct.toFixed(2)}%
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const HeadlinesPreview = ({ intel, newsLive }) => {
  const items = intel.slice(0, 6);
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-100">Latest Headlines</h3>
        <span className={`text-[10px] flex items-center gap-1 ${newsLive ? 'text-emerald-400' : 'text-amber-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${newsLive ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
          {newsLive ? 'live' : 'fetching'}
        </span>
      </div>
      <ul className="space-y-2">
        {items.length === 0 && (
          <li className="text-xs text-gray-500">No items yet — feed loading.</li>
        )}
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:bg-gray-800/40 rounded px-2 py-1.5 -mx-2 transition-colors"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
                <span className={`px-1.5 py-0.5 rounded border ${categoryColor(it.category)}`}>{it.category}</span>
                <span className="text-gray-500 truncate">{it.source}</span>
                <span className="text-gray-600 ml-auto">{it.time}</span>
              </div>
              <div className="text-xs text-gray-100 mt-1 leading-snug line-clamp-2">{it.headline}</div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default function Overview() {
  const {
    commodities, intel, pricesLive, newsLive, pricesUpdatedAt, newsUpdatedAt, refresh,
  } = useLiveData();

  // Pick representative names from each major asset class for the stat cards.
  const find = (sym) => commodities.find((c) => c.symbol === sym);
  const wti  = find('WTI');
  const gold = find('GOLD');
  const nvda = find('NVDA');
  const btc  = find('BTC');

  const stats = [
    { label: 'WTI Crude',  c: wti  },
    { label: 'Gold',       c: gold },
    { label: 'Nvidia',     c: nvda },
    { label: 'Bitcoin',    c: btc  },
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-xs uppercase tracking-[0.22em] text-gray-500">
            <span>Live Markets</span>
            <span className={`flex items-center gap-1.5 normal-case tracking-normal text-[11px] ${pricesLive ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pricesLive ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
              {pricesLive ? 'live prices' : 'fetching'}
            </span>
            {pricesUpdatedAt && (
              <span className="normal-case tracking-normal text-[10px] text-gray-500 font-mono">
                {new Date(pricesUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </div>
          <h2 className="mt-1.5 text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-br from-gray-50 to-gray-300 bg-clip-text text-transparent">
            Markets &amp; Headlines
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-gray-400 max-w-3xl">
            Live prices across commodities, equities, crypto, and macro indicators, with real-time news from Google News.
          </p>
        </div>
        <button
          onClick={refresh}
          className="self-start px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={fmtPrice(s.c)}
            sub={s.c
              ? `${s.c.changePct >= 0 ? '+' : ''}${s.c.changePct.toFixed(2)}% today`
              : '—'}
            accent={s.c
              ? (s.c.changePct >= 0 ? 'text-green-400' : 'text-red-400')
              : 'text-gray-300'}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Movers
          commodities={commodities}
          title="Top Gainers"
          accent="text-green-400"
          sortFn={(a, b) => b.changePct - a.changePct}
        />
        <Movers
          commodities={commodities}
          title="Top Losers"
          accent="text-red-400"
          sortFn={(a, b) => a.changePct - b.changePct}
        />
        <HeadlinesPreview intel={intel} newsLive={newsLive} />
      </div>
    </div>
  );
}
