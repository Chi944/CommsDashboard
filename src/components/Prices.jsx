import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { useLiveData } from '../state/LiveData.jsx';
import { assetCategoryColor } from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';
import { downloadCSV } from '../utils/csv.js';

const CATS = ['ALL', 'ENERGY', 'METALS', 'AGRICULTURE', 'TECH', 'DATA', 'CRYPTO', 'TRENDING', 'WATCHLIST'];
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

export default function Prices() {
  const { commodities, pricesLive, pricesUpdatedAt, refresh } = useLiveData();

  const [cat, setCat] = useState('ALL');
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
    } catch {
      return new Set();
    }
  });

  // Cache of fetched history series, keyed by `${ticker}|${range}`.
  const [historyCache, setHistoryCache] = useState({});
  const [chartLoading, setChartLoading] = useState(false);
  const fetchKeyRef = useRef('');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...watchlist])); } catch {}
  }, [watchlist]);

  const toggleWatch = (ticker) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      next.has(ticker) ? next.delete(ticker) : next.add(ticker);
      return next;
    });
  };
  const toggleCompare = (ticker) => {
    setCompareSet((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        if (next.size > 1) next.delete(ticker);
      } else if (next.size < 5) {
        next.add(ticker);
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (cat === 'ALL') return commodities;
    if (cat === 'WATCHLIST') return commodities.filter((c) => watchlist.has(c.ticker));
    if (cat === 'TRENDING') {
      return [...commodities]
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 10);
    }
    return commodities.filter((c) => c.category === cat);
  }, [cat, watchlist, commodities]);

  const sel = commodities.find((c) => c.ticker === selected) || commodities[0];

  // Tickers we need to fetch for the current chart view.
  const neededTickers = useMemo(
    () => (compare ? [...compareSet] : sel ? [sel.ticker] : []),
    [compare, compareSet, sel]
  );

  // Fetch missing histories whenever range or set changes.
  useEffect(() => {
    const missing = neededTickers.filter((t) => !historyCache[`${t}|${range}`]);
    if (missing.length === 0) return;
    const myKey = `${range}|${missing.join(',')}|${Date.now()}`;
    fetchKeyRef.current = myKey;
    setChartLoading(true);
    Promise.all(
      missing.map((t) =>
        fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=${range}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j && j.ok ? [t, j.points] : [t, null]))
          .catch(() => [t, null])
      )
    ).then((entries) => {
      if (fetchKeyRef.current !== myKey) return;
      setHistoryCache((prev) => {
        const next = { ...prev };
        for (const [t, pts] of entries) {
          if (pts && pts.length) next[`${t}|${range}`] = pts;
        }
        return next;
      });
      setChartLoading(false);
    });
  }, [neededTickers, range, historyCache]);

  // Build chart data from cache. Falls back to commodity.history (1M) for 1mo range.
  const chartData = useMemo(() => {
    if (compare) {
      const tickers = [...compareSet];
      const series = tickers.map((t) => historyCache[`${t}|${range}`] || (range === '1mo' ? commodities.find((c) => c.ticker === t)?.history : null)).filter(Boolean);
      if (series.length === 0) return [];
      const minLen = Math.min(...series.map((s) => s.length));
      const out = [];
      for (let i = 0; i < minLen; i++) {
        const row = { date: series[0][i].date };
        tickers.forEach((t, idx) => {
          const arr = historyCache[`${t}|${range}`] || (range === '1mo' ? commodities.find((c) => c.ticker === t)?.history : null);
          if (arr && arr[i]) row[t] = arr[i].price;
        });
        out.push(row);
      }
      return out;
    }
    if (!sel) return [];
    const cached = historyCache[`${sel.ticker}|${range}`];
    if (cached) return cached;
    if (range === '1mo' && sel.history) return sel.history;
    return [];
  }, [compare, compareSet, sel, range, historyCache, commodities]);

  const exportCsv = () => {
    const rows = filtered.map((c) => ({
      ticker: c.ticker,
      name: c.name,
      category: c.category,
      unit: c.unit,
      price: c.price,
      changePct: c.changePct,
      changeAbs: c.changeAbs,
      high: c.high,
      low: c.low,
    }));
    downloadCSV(`prices-${cat.toLowerCase()}.csv`, rows);
  };

  const compareTickers = [...compareSet];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold text-gray-50">Prices</h2>
          <p className="text-sm text-gray-400 mt-1 flex flex-wrap items-center gap-3">
            <span>Commodities, equities, and crypto via Yahoo Finance.</span>
            <span className={`text-[11px] flex items-center gap-1.5 ${pricesLive ? 'text-green-400' : 'text-yellow-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pricesLive ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
              {pricesLive ? 'live' : 'fetching'}
            </span>
            {pricesUpdatedAt && (
              <span className="text-[10px] text-gray-500 font-mono">
                {new Date(pricesUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded border bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600"
          >
            Refresh
          </button>
          <button
            onClick={() => setCompare((v) => !v)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border
              ${compare ? 'bg-cyan-500 border-cyan-400 text-gray-950' : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'}`}
          >
            {compare ? 'Comparing' : 'Compare'}
          </button>
          <button
            onClick={exportCsv}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded border bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border
              ${cat === c
                ? 'bg-gray-100 text-gray-950 border-gray-100'
                : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'}`}
          >
            {c === 'WATCHLIST' ? `★ Watchlist (${watchlist.size})` : c === 'TRENDING' ? '🔥 Trending' : c}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-x-auto">
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
              <tr>
                <td colSpan={compare ? 10 : 9} className="px-4 py-8 text-center text-sm text-gray-500">
                  {cat === 'WATCHLIST' ? 'Watchlist is empty — click ★ to add commodities.' : 'No items match this filter.'}
                </td>
              </tr>
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
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={inCompare}
                        onChange={(e) => { e.stopPropagation(); toggleCompare(c.ticker); }}
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
                <div className="text-xs uppercase tracking-widest text-gray-500">{sel.ticker} • {sel.unit}</div>
                <div className="text-xl font-semibold text-gray-100">{sel.name}</div>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {!compare && sel && (
              <div className="font-mono text-2xl text-gray-100">{fmtPrice(sel.price)}</div>
            )}
            <div className="flex flex-wrap gap-1">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded
                    ${range === r ? 'bg-gray-100 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                >
                  {RANGE_LABEL[r]}
                </button>
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
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
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
                  <Line
                    key={t}
                    type="monotone"
                    dataKey={t}
                    stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))
              ) : (
                <Line type="monotone" dataKey="price" stroke="#22d3ee" strokeWidth={2} dot={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
