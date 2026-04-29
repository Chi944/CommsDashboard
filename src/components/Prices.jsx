import React, { useState, useMemo, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { commodities } from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';
import { downloadCSV } from '../utils/csv.js';

const CATS = ['ALL', 'ENERGY', 'METALS', 'AGRICULTURE', 'WATCHLIST'];
const COMPARE_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];
const STORAGE_KEY = 'comms.watchlist';

export default function Prices() {
  const [cat, setCat] = useState('ALL');
  const [selected, setSelected] = useState(commodities[0].ticker);
  const [range, setRange] = useState('1M');
  const [compare, setCompare] = useState(false);
  const [compareSet, setCompareSet] = useState(new Set([commodities[0].ticker, commodities[3].ticker]));
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

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
    return commodities.filter((c) => c.category === cat);
  }, [cat, watchlist]);

  const sel = commodities.find((c) => c.ticker === selected) || commodities[0];

  const chartData = useMemo(() => {
    if (compare) {
      const tickers = [...compareSet];
      const series = tickers.map((t) => commodities.find((c) => c.ticker === t)).filter(Boolean);
      if (series.length === 0) return [];
      const length = series[0].history.length;
      const slice = range === '5D' ? 5 : length;
      return Array.from({ length: slice }).map((_, i) => {
        const idx = length - slice + i;
        const row = { date: series[0].history[idx].date };
        series.forEach((s) => { row[s.ticker] = s.history[idx].price; });
        return row;
      });
    }
    return range === '5D' ? sel.history.slice(-5) : sel.history;
  }, [compare, compareSet, sel, range]);

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
          <h2 className="text-3xl font-bold text-gray-50">Commodity Prices</h2>
          <p className="text-sm text-gray-400 mt-1">Spot and futures across energy, metals, and agriculture.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompare((v) => !v)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border
              ${compare ? 'bg-cyan-500 border-cyan-400 text-gray-950' : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'}`}
          >
            {compare ? 'Comparing' : 'Compare mode'}
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
            {c === 'WATCHLIST' ? `★ Watchlist (${watchlist.size})` : c}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-950/50">
            <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500">
              <th className="px-3 py-3 w-8"></th>
              {compare && <th className="px-3 py-3 w-8">Cmp</th>}
              <th className="px-3 py-3">Ticker</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Trend</th>
              <th className="px-3 py-3 text-right">Change %</th>
              <th className="px-3 py-3 text-right">Price</th>
              <th className="px-3 py-3 text-right">High</th>
              <th className="px-3 py-3 text-right">Low</th>
              <th className="px-3 py-3 text-right">Change $</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan="10" className="px-4 py-8 text-center text-sm text-gray-500">
                  Watchlist is empty — click ★ to add commodities.
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
                  <td className="px-3 py-3 text-right font-mono text-gray-100">{c.price.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-400">{c.high.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right font-mono text-gray-400">{c.low.toLocaleString()}</td>
                  <td className={`px-3 py-3 text-right font-mono ${up ? 'text-green-400' : 'text-red-400'}`}>
                    {up ? '+' : ''}{c.changeAbs.toFixed(2)}
                  </td>
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
                <div className="text-xs uppercase tracking-widest text-gray-500">Comparing {compareTickers.length} commodities</div>
                <div className="text-xl font-semibold text-gray-100">Multi-series price overlay</div>
                <div className="text-[11px] text-gray-500 mt-1">Tip: tick checkboxes in the table to add/remove series (max 5).</div>
              </>
            ) : (
              <>
                <div className="text-xs uppercase tracking-widest text-gray-500">{sel.ticker} • {sel.unit}</div>
                <div className="text-xl font-semibold text-gray-100">{sel.name}</div>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            {!compare && (
              <div className="font-mono text-2xl text-gray-100">{sel.price.toLocaleString()}</div>
            )}
            <div className="flex gap-1">
              {['5D', '1M'].map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded
                    ${range === r ? 'bg-gray-100 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }} />
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
