import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { commodities } from '../data/mockData.js';

const CATS = ['ALL', 'ENERGY', 'METALS', 'AGRICULTURE'];

export default function Prices() {
  const [cat, setCat] = useState('ALL');
  const [selected, setSelected] = useState(commodities[0].ticker);
  const [range, setRange] = useState('1M');

  const filtered = useMemo(
    () => (cat === 'ALL' ? commodities : commodities.filter((c) => c.category === cat)),
    [cat]
  );

  const sel = commodities.find((c) => c.ticker === selected) || commodities[0];
  const data = range === '5D' ? sel.history.slice(-5) : sel.history;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-50">Commodity Prices</h2>
        <p className="text-sm text-gray-400 mt-1">Spot and futures across energy, metals, and agriculture.</p>
      </div>

      <div className="flex gap-2">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border
              ${cat === c
                ? 'bg-gray-100 text-gray-950 border-gray-100'
                : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'}`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-950/50">
            <tr className="text-left text-[11px] uppercase tracking-widest text-gray-500">
              <th className="px-4 py-3">Ticker</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 text-right">Change %</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">High</th>
              <th className="px-4 py-3 text-right">Low</th>
              <th className="px-4 py-3 text-right">Change $</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const up = c.changePct >= 0;
              const isSel = c.ticker === selected;
              return (
                <tr
                  key={c.ticker}
                  onClick={() => setSelected(c.ticker)}
                  className={`cursor-pointer border-t border-gray-800 transition-colors
                    ${isSel ? 'bg-gray-800/60' : 'hover:bg-gray-800/30'}`}
                >
                  <td className="px-4 py-3 font-mono text-gray-300">{c.ticker}</td>
                  <td className="px-4 py-3 text-gray-100">
                    <div>{c.name}</div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">{c.unit}</div>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${up ? 'text-green-400' : 'text-red-400'}`}>
                    {up ? '+' : ''}{c.changePct.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-100">{c.price.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">{c.high.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">{c.low.toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right font-mono ${up ? 'text-green-400' : 'text-red-400'}`}>
                    {up ? '+' : ''}{c.changeAbs.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-gray-500">{sel.ticker} • {sel.unit}</div>
            <div className="text-xl font-semibold text-gray-100">{sel.name}</div>
          </div>
          <div className="flex items-center gap-4">
            <div className="font-mono text-2xl text-gray-100">{sel.price.toLocaleString()}</div>
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
            <LineChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }} />
              <YAxis stroke="#6b7280" domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#9ca3af' }}
                itemStyle={{ color: '#e5e7eb' }}
              />
              <Line type="monotone" dataKey="price" stroke="#22d3ee" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
