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

const fmtPctChange = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const fmtVolume = (n) => {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
};

const MoversCard = ({ items, title, accent, fmt, count = 8 }) => {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ${accent}`}>{title}</h3>
        <span className="text-[10px] text-gray-500 font-mono">{items.length}</span>
      </div>
      <ul className="divide-y divide-gray-800">
        {items.slice(0, count).map((c, i) => {
          const up = c.changePct >= 0;
          return (
            <li key={c.ticker} className="py-2 flex items-center gap-3">
              <span className="font-mono text-[10px] text-gray-600 w-4 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-100">{c.ticker}</span>
                  <span className={`text-[9px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>{c.category}</span>
                </div>
                <div className="text-[10px] text-gray-500 truncate">{c.name}</div>
              </div>
              <Sparkline
                data={c.history.map((h) => h.price)}
                color={up ? '#22c55e' : '#ef4444'}
                width={64} height={20}
              />
              <div className="text-right w-20">
                <div className="font-mono text-[11px] text-gray-100">{fmt(c)}</div>
                <div className={`font-mono text-[10px] ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtPctChange(c.changePct)}
                </div>
              </div>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="text-xs text-gray-500 py-4 text-center">No data yet.</li>
        )}
      </ul>
    </div>
  );
};

const MostActiveCard = ({ items, fmt }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-cyan-300">Most Active</h3>
      <span className="text-[10px] text-gray-500 font-mono">by volume</span>
    </div>
    <ul className="divide-y divide-gray-800">
      {items.slice(0, 8).map((c, i) => {
        const up = c.changePct >= 0;
        return (
          <li key={c.ticker} className="py-2 flex items-center gap-3">
            <span className="font-mono text-[10px] text-gray-600 w-4 shrink-0">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-gray-100">{c.ticker}</span>
                <span className={`text-[9px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>{c.category}</span>
              </div>
              <div className="text-[10px] text-gray-500 truncate">{c.name}</div>
            </div>
            <div className="text-right w-20">
              <div className="font-mono text-[11px] text-gray-100">{fmt(c)}</div>
              <div className="font-mono text-[10px] text-gray-400">{fmtVolume(c.volume)}</div>
            </div>
            <div className={`font-mono text-[10px] w-12 text-right ${up ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmtPctChange(c.changePct)}
            </div>
          </li>
        );
      })}
      {items.length === 0 && (
        <li className="text-xs text-gray-500 py-4 text-center">No data yet.</li>
      )}
    </ul>
  </div>
);

const HeadlinesPreview = ({ intel, newsLive }) => {
  const items = intel.slice(0, 8);
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
    commodities, intel, pricesLive, newsLive,
    pricesUpdatedAt, newsUpdatedAt, refresh,
    formatAssetPrice, dashboardCurrency,
  } = useLiveData();

  // Exclude FX from movers/headline rankings.
  const tradable = useMemo(
    () => commodities.filter((c) => c.category !== 'FX' && typeof c.changePct === 'number'),
    [commodities]
  );

  const fmt = (c) => formatAssetPrice(c);

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

  const gainers = useMemo(
    () => [...tradable].filter((c) => c.changePct > 0).sort((a, b) => b.changePct - a.changePct),
    [tradable]
  );
  const losers = useMemo(
    () => [...tradable].filter((c) => c.changePct < 0).sort((a, b) => a.changePct - b.changePct),
    [tradable]
  );
  const mostActive = useMemo(
    () => [...tradable]
      .filter((c) => typeof c.volume === 'number' && c.volume > 0)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0)),
    [tradable]
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-xs uppercase tracking-[0.22em] text-gray-500">
            <span>Live Markets · {dashboardCurrency}</span>
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
            Real-time prices across {tradable.length}+ stocks, ETFs, commodities, crypto and macro indicators,
            plus live news. Switch the dashboard currency from the top-right to view everything in your local FX.
          </p>
        </div>
        <button
          onClick={refresh}
          className="self-start px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.c ? fmt(s.c) : '—'}
            sub={s.c ? `${fmtPctChange(s.c.changePct)} today` : '—'}
            accent={s.c
              ? (s.c.changePct >= 0 ? 'text-emerald-400' : 'text-red-400')
              : 'text-gray-300'}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MoversCard items={gainers} title="Top Gainers" accent="text-emerald-400" fmt={fmt} />
        <MoversCard items={losers}  title="Top Losers"  accent="text-red-400"     fmt={fmt} />
        <MostActiveCard items={mostActive} fmt={fmt} />
      </div>

      <HeadlinesPreview intel={intel} newsLive={newsLive} />
    </div>
  );
}
