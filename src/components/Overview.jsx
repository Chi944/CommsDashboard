import React, { useMemo, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { categoryColor, assetCategoryColor } from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';
import SectorHeatmap from './SectorHeatmap.jsx';
import Briefing from './Briefing.jsx';
import SmartMoneyPulse from './smart-money/SmartMoneyPulse.jsx';
import FearGreed from './FearGreed.jsx';
import { dataModeLabel } from '../lib/marketDisplay.js';
const fmtPctChange = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const fmtVolume = (n) => {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
};

const SF_OPTIONS = ['7D', '30D'];

const StatCard = ({ label, c, fmt, onClick, sfRange }) => {
  const accent = c
    ? (c.changePct >= 0 ? 'text-emerald-400' : 'text-red-400')
    : 'text-gray-300';
  const value = c ? fmt(c) : '—';
  const sub = c ? `${fmtPctChange(c.changePct)} today` : '—';
  const up = c?.changePct >= 0;

  const sparkData = useMemo(() => {
    if (!c?.history) return [];
    const pts = c.history.map((h) => h.price);
    if (sfRange === '7D') return pts.slice(-7);
    return pts;
  }, [c, sfRange]);

  return (
    <button
      onClick={() => c && onClick && onClick(c.ticker)}
      disabled={!c}
      className="group relative overflow-hidden rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/90 to-gray-900/40 p-4 sm:p-5 text-left transition-all hover:border-cyan-700/60 hover:bg-gray-900 disabled:cursor-default disabled:hover:border-gray-800 cursor-pointer"
    >
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
      <div className="flex items-start justify-between">
        <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
        {c && (
          <span className="text-gray-600 group-hover:text-cyan-300 transition-colors text-[10px]">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
            </svg>
          </span>
        )}
      </div>
      <div className={`mt-2 font-mono text-2xl sm:text-3xl tracking-tight ${accent}`}>{value}</div>
      <div className="mt-1 flex items-center gap-2">
        <div className="text-[11px] sm:text-xs text-gray-400">{sub}</div>
        {sparkData.length > 1 && (
          <div className="ml-auto">
            <Sparkline
              data={sparkData}
              color={up ? '#22c55e' : '#ef4444'}
              width={70} height={20}
            />
          </div>
        )}
      </div>
    </button>
  );
};

const MoversCard = ({ items, title, accent, fmt, onSelect, count = 8 }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
    <div className="flex items-center justify-between mb-3">
      <h3 className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ${accent}`}>{title}</h3>
      <span className="text-[10px] text-gray-500 font-mono">{items.length}</span>
    </div>
    <ul className="divide-y divide-gray-800">
      {items.slice(0, count).map((c, i) => {
        const up = c.changePct >= 0;
        return (
          <li key={c.ticker}>
            <button
              onClick={() => onSelect && onSelect(c.ticker)}
              className="w-full text-left py-2 flex items-center gap-3 group hover:bg-gray-800/30 -mx-2 px-2 rounded-md transition-colors cursor-pointer"
            >
              <span className="font-mono text-[10px] text-gray-600 w-4 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-100 group-hover:text-cyan-300 transition-colors">{c.ticker}</span>
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
            </button>
          </li>
        );
      })}
      {items.length === 0 && (
        <li className="text-xs text-gray-500 py-4 text-center">No data yet.</li>
      )}
    </ul>
  </div>
);

const MostActiveCard = ({ items, fmt, onSelect }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-cyan-300">Most Active</h3>
      <span className="text-[10px] text-gray-500 font-mono">by volume</span>
    </div>
    <ul className="divide-y divide-gray-800">
      {items.slice(0, 8).map((c, i) => {
        const up = c.changePct >= 0;
        return (
          <li key={c.ticker}>
            <button
              onClick={() => onSelect && onSelect(c.ticker)}
              className="w-full text-left py-2 flex items-center gap-3 group hover:bg-gray-800/30 -mx-2 px-2 rounded-md transition-colors cursor-pointer"
            >
              <span className="font-mono text-[10px] text-gray-600 w-4 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-100 group-hover:text-cyan-300 transition-colors">{c.ticker}</span>
                  <span className={`text-[9px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>{c.category}</span>
                </div>
                <div className="text-[10px] text-gray-500 truncate">{c.name}</div>
              </div>
              <div className="text-right w-20">
                <div className="font-mono text-[11px] text-gray-100">{fmt(c)}</div>
                <div className="font-mono text-[10px] text-gray-400">
                  {fmtVolume(c.displayVolume ?? c.volume)}
                </div>
              </div>
              <div className={`font-mono text-[10px] w-12 text-right ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtPctChange(c.changePct)}
              </div>
            </button>
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

export default function Overview({ onSelectAsset, onOpenSmartMoney }) {
  const {
    commodities, rankingCommodities, intel, newsLive, dataMode,
    pricesUpdatedAt, refresh,
    formatAssetPrice, dashboardCurrency,
    activityScore, marketVolumes,
  } = useLiveData();
  const [sfRange, setSfRange] = useState('30D');

  // Exclude FX from movers/headline rankings.
  const tradable = useMemo(
    () => rankingCommodities.filter((c) => c.category !== 'FX' && typeof c.changePct === 'number'),
    [rankingCommodities]
  );

  const fmt = (c) => formatAssetPrice(c);

  const find = (sym) => commodities.find((c) => c.symbol === sym);
  const stats = [
    { label: 'WTI Crude', c: find('WTI')  },  // oil
    { label: 'Gold',      c: find('GOLD') },  // safe-haven metal
    { label: 'S&P 500',   c: find('SPX')  },  // broad equities
    { label: 'Bitcoin',   c: find('BTC')  },  // crypto
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
      .map((c) => ({
        ...c,
        displayVolume: (typeof c.volume === 'number' && c.volume > 0)
          ? c.volume
          : marketVolumes?.[c.ticker],
      }))
      .filter((c) => activityScore(c) > 0)
      .sort((a, b) => activityScore(b) - activityScore(a))
      .slice(0, 8),
    [tradable, activityScore, marketVolumes],
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] sm:text-xs uppercase tracking-[0.22em] text-gray-500">
            <span>Live Markets · {dashboardCurrency}</span>
            <span className={`flex items-center gap-1.5 normal-case tracking-normal text-[11px] ${dataMode === 'LIVE' ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dataMode === 'LIVE' ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
              {dataModeLabel(dataMode)} prices
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
            Click any asset to open its full chart in Prices. Switch the dashboard currency from the top-right
            to view everything in your local FX.
          </p>
        </div>
        <button
          onClick={refresh}
          className="self-start px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      <Briefing />

      <SmartMoneyPulse onOpen={onOpenSmartMoney} />

      {/* Stat cards with sparkline range toggle */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Key Assets</div>
          <div className="flex gap-1">
            {SF_OPTIONS.map((o) => (
              <button
                key={o}
                onClick={() => setSfRange(o)}
                className={`px-2 py-0.5 text-[10px] rounded font-mono transition-colors ${
                  sfRange === o
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
              >{o}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} c={s.c} fmt={fmt} onClick={onSelectAsset} sfRange={sfRange} />
          ))}
        </div>
      </div>

      {/* Fear & Greed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FearGreed />
      </div>

      <SectorHeatmap onSelectAsset={onSelectAsset} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MoversCard items={gainers} title="Top Gainers" accent="text-emerald-400" fmt={fmt} onSelect={onSelectAsset} />
        <MoversCard items={losers}  title="Top Losers"  accent="text-red-400"     fmt={fmt} onSelect={onSelectAsset} />
        <MostActiveCard items={mostActive} fmt={fmt} onSelect={onSelectAsset} />
      </div>

      <HeadlinesPreview intel={intel} newsLive={newsLive} />
    </div>
  );
}
