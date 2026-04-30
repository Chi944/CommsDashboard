import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { useLiveData } from '../state/LiveData.jsx';
import { assetCategoryColor, categoryColor } from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';
import { downloadCSV } from '../utils/csv.js';

const CATS = ['ALL', 'ENERGY', 'METALS', 'AGRICULTURE', 'TECH', 'DATA', 'CRYPTO', 'MACRO', 'TRENDING', 'WATCHLIST'];
const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', 'ytd'];
const RANGE_LABEL = { '1d': '1D', '5d': '5D', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y', 'ytd': 'YTD' };
const COMPARE_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];
const STORAGE_KEY = 'comms.watchlist.v2';

const fmtPrice = (n) => {
  if (n == null) return '—';
  if (n < 1) return n.toFixed(4);
  if (n >= 1000) return n.toLocaleString();
  return n.toFixed(2);
};

const fmtVolume = (n) => {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};

const tileBg = (pct) => {
  const a = Math.min(0.65, Math.max(0.06, Math.abs(pct) / 8));
  return pct >= 0
    ? `rgba(34, 197, 94, ${a})`
    : `rgba(239, 68, 68, ${a})`;
};

// ----------- Heatmap -----------
const Heatmap = ({ items, selectedTicker, onSelect }) => {
  if (items.length === 0) {
    return <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center text-sm text-gray-500">No items.</div>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
      {items.map((c) => {
        const up = c.changePct >= 0;
        const sel = c.ticker === selectedTicker;
        return (
          <button
            key={c.ticker}
            onClick={() => onSelect(c.ticker)}
            style={{ background: tileBg(c.changePct) }}
            className={`text-left rounded-lg p-3 border transition-all
              ${sel ? 'border-cyan-400 ring-1 ring-cyan-400/40' : 'border-gray-800 hover:border-gray-600'}`}
          >
            <div className="flex items-start justify-between">
              <div className="font-mono text-sm font-semibold text-gray-100">{c.ticker}</div>
              <div className={`text-[10px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>{c.category}</div>
            </div>
            <div className="text-[11px] text-gray-300 truncate mt-0.5">{c.name}</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="font-mono text-sm text-gray-100">{fmtPrice(c.price)}</div>
              <div className={`font-mono text-xs ${up ? 'text-green-300' : 'text-red-300'}`}>
                {up ? '+' : ''}{c.changePct.toFixed(2)}%
              </div>
            </div>
            <div className="mt-2">
              <Sparkline
                data={c.history.map((h) => h.price)}
                color={up ? '#22c55e' : '#ef4444'}
                width={140}
                height={18}
                fill
              />
            </div>
          </button>
        );
      })}
    </div>
  );
};

// ----------- 52-week range bar -----------
const RangeBar = ({ low, high, current }) => {
  if (low == null || high == null || current == null || high <= low) return null;
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  return (
    <div>
      <div className="relative h-1.5 bg-gray-800 rounded-full">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-cyan-400/30"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-gray-500 mt-1">
        <span>{fmtPrice(low)}</span>
        <span className="text-gray-400">{pct.toFixed(0)}% of range</span>
        <span>{fmtPrice(high)}</span>
      </div>
    </div>
  );
};

// ----------- Detail panel -----------
const DetailPanel = ({ c }) => {
  if (!c) return null;
  const items = [
    ['Open',          c.open != null ? fmtPrice(c.open) : '—'],
    ['Previous close', c.prevClose != null ? fmtPrice(c.prevClose) : '—'],
    ['Day high',      fmtPrice(c.high)],
    ['Day low',       fmtPrice(c.low)],
    ['52w high',      c.fiftyTwoWeekHigh != null ? fmtPrice(c.fiftyTwoWeekHigh) : '—'],
    ['52w low',       c.fiftyTwoWeekLow  != null ? fmtPrice(c.fiftyTwoWeekLow)  : '—'],
    ['Volume',        fmtVolume(c.volume)],
    ['Exchange',      c.exchange || '—'],
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-gray-500">Quote details</div>
        <div className="text-sm text-gray-100">{c.name} <span className="text-gray-500 font-mono">· {c.ticker}</span></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([label, val]) => (
          <div key={label} className="bg-gray-950/40 border border-gray-800 rounded px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
            <div className="font-mono text-xs text-gray-100 mt-0.5">{val}</div>
          </div>
        ))}
      </div>
      {c.fiftyTwoWeekLow != null && c.fiftyTwoWeekHigh != null && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">52-week range</div>
          <RangeBar low={c.fiftyTwoWeekLow} high={c.fiftyTwoWeekHigh} current={c.price} />
        </div>
      )}
    </div>
  );
};

// ----------- Asset news -----------
const AssetNews = ({ asset }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/asset-news?q=${encodeURIComponent(asset.name)}&limit=6`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))
      .then((j) => { if (!cancelled) { setItems(j.ok ? j.items : []); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(String(e?.message || e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [asset?.ticker, asset?.name]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-100">
          News · {asset?.name || ''}
        </h3>
        {loading && <span className="text-[10px] text-gray-500">loading…</span>}
      </div>
      {err && <div className="text-xs text-red-400">Failed to load news.</div>}
      {!loading && !err && items.length === 0 && (
        <div className="text-xs text-gray-500">No recent items.</div>
      )}
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:bg-gray-800/40 rounded px-2 py-1.5 -mx-2"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500">
                <span>{it.source}</span>
                <span className="ml-auto text-gray-600">{it.time}</span>
              </div>
              <div className="text-xs text-gray-100 mt-1 leading-snug line-clamp-2">{it.headline}</div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ----------- Main component -----------
export default function Prices() {
  const { commodities, pricesLive, pricesUpdatedAt, refresh } = useLiveData();

  const [cat, setCat] = useState('ALL');
  const [view, setView] = useState('table');                  // 'table' | 'heatmap'
  const [selected, setSelected] = useState(commodities[0]?.ticker);
  const [range, setRange] = useState('1mo');
  const [compare, setCompare] = useState(false);
  const [compareSet, setCompareSet] = useState(
    () => new Set([commodities[0]?.ticker, commodities[11]?.ticker, commodities[21]?.ticker].filter(Boolean))
  );
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });

  // Cache of fetched history series, keyed by `${ticker}|${range}`.
  const [historyCache, setHistoryCache] = useState({});
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...watchlist])); } catch {}
  }, [watchlist]);

  const toggleWatch = (t) => setWatchlist((p) => {
    const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n;
  });
  const toggleCompare = (t) => setCompareSet((p) => {
    const n = new Set(p);
    if (n.has(t)) { if (n.size > 1) n.delete(t); }
    else if (n.size < 5) n.add(t);
    return n;
  });

  const filtered = useMemo(() => {
    if (cat === 'ALL') return commodities;
    if (cat === 'WATCHLIST') return commodities.filter((c) => watchlist.has(c.ticker));
    if (cat === 'TRENDING') {
      return [...commodities]
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 12);
    }
    return commodities.filter((c) => c.category === cat);
  }, [cat, watchlist, commodities]);

  const sel = useMemo(
    () => commodities.find((c) => c.ticker === selected) || commodities[0],
    [commodities, selected]
  );

  // Keep the chart anchored to whatever the user is filtering: if the
  // currently selected ticker isn't in the filtered set (e.g. they
  // switched ALL → METALS while WTI was selected), pick the first
  // visible item so the chart and detail panel reflect the new filter.
  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some((c) => c.ticker === selected)) {
      setSelected(filtered[0].ticker);
    }
  }, [filtered, selected]);

  // Fetch missing histories for whichever tickers the chart needs.
  const neededTickers = useMemo(
    () => (compare ? [...compareSet] : sel ? [sel.ticker] : []),
    [compare, compareSet, sel]
  );

  useEffect(() => {
    const missing = neededTickers.filter((t) => !historyCache[`${t}|${range}`]);
    if (missing.length === 0) return;
    let cancelled = false;
    setChartLoading(true);
    Promise.all(
      missing.map((t) =>
        fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=${range}`)
          .then((r) => r.ok ? r.json() : null)
          .then((j) => (j && j.ok && Array.isArray(j.points) && j.points.length) ? [t, j.points] : [t, null])
          .catch(() => [t, null])
      )
    ).then((entries) => {
      if (cancelled) return;
      setHistoryCache((prev) => {
        const next = { ...prev };
        for (const [t, pts] of entries) if (pts) next[`${t}|${range}`] = pts;
        return next;
      });
      setChartLoading(false);
    });
    return () => { cancelled = true; };
  }, [neededTickers, range]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the chart series.
  const chartData = useMemo(() => {
    if (compare) {
      const tickers = [...compareSet];
      const series = tickers.map((t) => historyCache[`${t}|${range}`]).filter(Boolean);
      if (series.length === 0) return [];
      const minLen = Math.min(...series.map((s) => s.length));
      const out = [];
      for (let i = 0; i < minLen; i++) {
        const row = { date: series[0][i].date };
        tickers.forEach((t) => {
          const arr = historyCache[`${t}|${range}`];
          if (arr && arr[i]) row[t] = arr[i].price;
        });
        out.push(row);
      }
      return out;
    }
    if (!sel) return [];
    const cached = historyCache[`${sel.ticker}|${range}`];
    if (cached && cached.length) return cached;
    // Only acceptable fallback: 1mo from /api/prices (which is the per-row sparkline).
    if (range === '1mo' && sel.history && sel.history.length) {
      return sel.history.map((h) => ({ date: h.date, price: h.price }));
    }
    return [];
  }, [compare, compareSet, sel, range, historyCache]);

  const exportCsv = () => {
    const rows = filtered.map((c) => ({
      ticker: c.ticker, name: c.name, category: c.category, unit: c.unit,
      price: c.price, changePct: c.changePct, changeAbs: c.changeAbs,
      open: c.open, high: c.high, low: c.low,
      prevClose: c.prevClose, volume: c.volume,
      fiftyTwoWeekHigh: c.fiftyTwoWeekHigh, fiftyTwoWeekLow: c.fiftyTwoWeekLow,
    }));
    downloadCSV(`prices-${cat.toLowerCase()}.csv`, rows);
  };

  const compareTickers = [...compareSet];
  // Force chart remount on selection / range / compare-set change.
  const chartKey = compare
    ? `cmp:${range}:${compareTickers.join(',')}`
    : `one:${range}:${sel?.ticker}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-50">Prices</h2>
          <div className="text-xs sm:text-sm text-gray-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="hidden sm:inline">Commodities, equities, crypto and macro via Yahoo Finance.</span>
            <span className={`text-[11px] flex items-center gap-1.5 ${pricesLive ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pricesLive ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
              {pricesLive ? 'live' : 'fetching'}
            </span>
            {pricesUpdatedAt && (
              <span className="text-[10px] text-gray-500 font-mono">
                {new Date(pricesUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-gray-900/70 border border-gray-800 rounded-md p-1">
            {['table', 'heatmap'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 text-[11px] uppercase tracking-wider rounded transition-colors
                  ${view === v ? 'bg-gray-100 text-gray-950' : 'text-gray-300 hover:text-white'}`}
              >{v}</button>
            ))}
          </div>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white"
            title="Refresh"
          ><span className="hidden sm:inline">Refresh</span><span className="sm:hidden">↻</span></button>
          <button
            onClick={() => setCompare((v) => !v)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border transition-colors
              ${compare ? 'bg-cyan-500 border-cyan-400 text-gray-950' : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white'}`}
          >{compare ? 'Comparing' : 'Compare'}</button>
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white"
            title="Export CSV"
          ><span className="hidden sm:inline">Export CSV</span><span className="sm:hidden">CSV</span></button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 sm:mx-0 px-4 sm:px-0 pb-1 sm:flex-wrap">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`shrink-0 px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border transition-all
              ${cat === c
                ? 'bg-gradient-to-b from-gray-50 to-gray-200 text-gray-950 border-gray-100 shadow'
                : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-900'}`}
          >
            {c === 'WATCHLIST' ? `★ Watchlist (${watchlist.size})` : c === 'TRENDING' ? '🔥 Trending' : c}
          </button>
        ))}
      </div>

      {view === 'table' ? (
        <>
        {/* Mobile card view */}
        <div className="md:hidden space-y-2">
          {filtered.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center text-sm text-gray-500">
              {cat === 'WATCHLIST' ? 'Watchlist is empty — tap ★ to add.' : 'No items.'}
            </div>
          )}
          {filtered.map((c) => {
            const up = c.changePct >= 0;
            const isSel = c.ticker === selected;
            const watched = watchlist.has(c.ticker);
            return (
              <div
                key={c.ticker}
                onClick={() => setSelected(c.ticker)}
                className={`relative rounded-lg border p-3 transition-all
                  ${isSel ? 'border-cyan-500/60 bg-gray-900' : 'border-gray-800 bg-gray-900/70 active:bg-gray-900'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleWatch(c.ticker); }}
                      className={`text-base leading-none ${watched ? 'text-yellow-400' : 'text-gray-600'}`}
                      aria-label="watchlist toggle"
                    >★</button>
                    <div className="min-w-0">
                      <div className="font-mono text-sm text-gray-100">{c.ticker}</div>
                      <div className="text-[11px] text-gray-400 truncate">{c.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm text-gray-100">{fmtPrice(c.price)}</div>
                    <div className={`font-mono text-[11px] ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}{c.changePct.toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className={`text-[10px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>{c.category}</span>
                  <Sparkline
                    data={c.history.map((h) => h.price)}
                    color={up ? '#22c55e' : '#ef4444'}
                    width={120} height={20}
                    fill
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table view */}
        <div className="hidden md:block bg-gray-900/70 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead className="bg-gray-950/50">
              <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500">
                <th className="px-3 py-3 w-8"></th>
                {compare && <th className="px-3 py-3 w-8">Cmp</th>}
                <th className="px-3 py-3">Ticker</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Trend (1M)</th>
                <th className="px-3 py-3 text-right">Change %</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 py-3 text-right">High</th>
                <th className="px-3 py-3 text-right">Low</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={compare ? 10 : 9} className="px-4 py-8 text-center text-sm text-gray-500">
                  {cat === 'WATCHLIST' ? 'Watchlist is empty — click ★ to add.' : 'No items.'}
                </td></tr>
              )}
              {filtered.map((c) => {
                const up = c.changePct >= 0;
                const isSel = c.ticker === selected;
                const watched = watchlist.has(c.ticker);
                const inCompare = compareSet.has(c.ticker);
                return (
                  <tr
                    key={c.ticker}
                    onClick={() => setSelected(c.ticker)}
                    className={`cursor-pointer border-t border-gray-800 transition-colors
                      ${isSel ? 'bg-gray-800/60' : 'hover:bg-gray-800/30'}`}
                  >
                    <td className="px-3 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleWatch(c.ticker); }}
                        className={`text-base leading-none ${watched ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-300'}`}
                        aria-label="watchlist toggle"
                      >★</button>
                    </td>
                    {compare && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={inCompare}
                          onChange={() => toggleCompare(c.ticker)}
                          className="accent-cyan-400"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3 font-mono text-gray-300">{c.ticker}</td>
                    <td className="px-3 py-3 text-gray-100">
                      <div>{c.name}</div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{c.unit}</div>
                    </td>
                    <td className={`px-3 py-3 text-[11px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>{c.category}</td>
                    <td className="px-3 py-3">
                      <Sparkline
                        data={c.history.map((h) => h.price)}
                        color={up ? '#22c55e' : '#ef4444'}
                        fill
                      />
                    </td>
                    <td className={`px-3 py-3 text-right font-mono ${up ? 'text-green-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}{c.changePct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-gray-100">{fmtPrice(c.price)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-400">{fmtPrice(c.high)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-400">{fmtPrice(c.low)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <Heatmap items={filtered} selectedTicker={selected} onSelect={setSelected} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                {compare ? (
                  <>
                    <div className="text-xs uppercase tracking-widest text-gray-500">Comparing {compareTickers.length} symbols</div>
                    <div className="text-xl font-semibold text-gray-100">Multi-series price overlay</div>
                    <div className="text-[11px] text-gray-500 mt-1">Tip: tick checkboxes in the table to add/remove series (max 5).</div>
                  </>
                ) : sel ? (
                  <>
                    <div className="text-xs uppercase tracking-widest text-gray-500">{sel.ticker} • {sel.unit} • {sel.category}</div>
                    <div className="text-xl font-semibold text-gray-100">{sel.name}</div>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {!compare && sel && (
                  <div className="flex flex-col items-end">
                    <div className="font-mono text-2xl text-gray-100">{fmtPrice(sel.price)}</div>
                    <div className={`font-mono text-xs ${sel.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {sel.changePct >= 0 ? '+' : ''}{sel.changePct.toFixed(2)}%
                      {' '}({sel.changeAbs >= 0 ? '+' : ''}{Math.abs(sel.changeAbs) < 1 ? sel.changeAbs.toFixed(4) : sel.changeAbs.toFixed(2)})
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded
                        ${range === r ? 'bg-gray-100 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                    >{RANGE_LABEL[r]}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="h-72 relative">
              {chartLoading && chartData.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                  Loading {RANGE_LABEL[range]} history…
                </div>
              )}
              {chartData.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart key={chartKey} data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }} minTickGap={20} />
                    <YAxis stroke="#6b7280" domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: '#9ca3af' }}
                      itemStyle={{ color: '#e5e7eb' }}
                    />
                    {compare && <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />}
                    {compare ? (
                      compareTickers.map((t, i) => (
                        <Line key={t} type="monotone" dataKey={t}
                          stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                          strokeWidth={2} dot={false} />
                      ))
                    ) : (
                      <Line type="monotone" dataKey="price" stroke="#22d3ee" strokeWidth={2} dot={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
        {!compare && <DetailPanel c={sel} />}
      </div>

      {!compare && sel && <AssetNews asset={sel} />}
    </div>
  );
}
