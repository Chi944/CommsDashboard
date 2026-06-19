import React, { useState, useCallback } from 'react';

// Seeded deterministic random for stable SSR-like renders
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const TICKERS = ['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'META', 'AMZN', 'MSFT', 'AMD', 'GOOGL', 'GLD', 'BTC', 'MSTR', 'BABA', 'NFLX'];
const TYPES = ['CALL', 'PUT'];
const SENTIMENTS = { CALL: { label: 'Bullish', color: 'text-emerald-400' }, PUT: { label: 'Bearish', color: 'text-red-400' } };

function generateFlows(seed = 42) {
  const rand = seededRand(seed);
  return Array.from({ length: 12 }, (_, i) => {
    const ticker = TICKERS[Math.floor(rand() * TICKERS.length)];
    const type = rand() > 0.5 ? 'CALL' : 'PUT';
    const basePrice = 50 + Math.floor(rand() * 900);
    const strike = (basePrice * (1 + (rand() - 0.5) * 0.2)).toFixed(0);
    const today = new Date();
    const expDays = [7, 14, 30, 45, 60, 90][Math.floor(rand() * 6)];
    const exp = new Date(today.getTime() + expDays * 86400000);
    const expStr = `${exp.toLocaleString('default', { month: 'short' })} ${exp.getDate()}`;
    const volume = Math.floor(rand() * 15000) + 500;
    const oi = Math.floor(rand() * 5000) + 100;
    const premium = ((rand() * 4.5) + 0.5).toFixed(2);
    const totalPremium = ((volume * Number(premium) * 100) / 1e6).toFixed(2);
    const unusual = rand() > 0.5;
    return { ticker, type, strike, exp: expStr, volume, oi, premium, totalPremium, unusual };
  });
}

const fmtNum = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

export default function OptionsFlow() {
  const [seed, setSeed] = useState(Date.now() & 0xffffff);
  const flows = generateFlows(seed);

  const refresh = useCallback(() => setSeed((s) => (s + 7919) & 0xffffff), []);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden">
      <div className="px-4 py-3 sm:px-5 border-b border-gray-800 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Options Flow</div>
          <div className="text-xs text-gray-300 mt-0.5">Unusual activity · mock data</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-amber-400 flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            Simulated
          </span>
          <button
            onClick={refresh}
            className="px-2 py-1 text-[10px] uppercase tracking-wider rounded border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white transition-colors"
          >Refresh</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-[10px] uppercase tracking-widest text-gray-500">
              <th className="px-3 py-2 text-left font-medium">Ticker</th>
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-right font-medium">Strike</th>
              <th className="px-2 py-2 text-right font-medium">Exp</th>
              <th className="px-2 py-2 text-right font-medium">Vol</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Prem</th>
              <th className="px-3 py-2 text-right font-medium">Total $M</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {flows.map((f, i) => {
              const sent = SENTIMENTS[f.type];
              return (
                <tr key={i} className={`hover:bg-gray-800/30 transition-colors ${f.unusual ? 'bg-cyan-500/[0.03]' : ''}`}>
                  <td className="px-3 py-2 font-mono text-gray-100 font-semibold">
                    <div className="flex items-center gap-1.5">
                      {f.unusual && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" title="Unusual" />}
                      {f.ticker}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`font-mono font-semibold text-[11px] ${sent.color}`}>{f.type}</span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-gray-300">${f.strike}</td>
                  <td className="px-2 py-2 text-right font-mono text-gray-400">{f.exp}</td>
                  <td className="px-2 py-2 text-right font-mono text-gray-300">{fmtNum(f.volume)}</td>
                  <td className="px-2 py-2 text-right font-mono text-gray-400 hidden sm:table-cell">${f.premium}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-200 font-medium">${f.totalPremium}M</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
