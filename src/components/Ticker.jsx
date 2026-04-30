import React from 'react';
import { useLiveData } from '../state/LiveData.jsx';

const TickerItem = ({ c }) => {
  const up = c.changePct >= 0;
  const fmt = (n) =>
    n == null ? '—'
    : n < 1 ? n.toFixed(4)
    : n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : n.toFixed(2);
  return (
    <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 border-r border-gray-800/70 whitespace-nowrap">
      <span className="text-[10px] sm:text-xs uppercase tracking-wider text-gray-500">{c.symbol}</span>
      <span className="font-mono text-xs sm:text-sm text-gray-100">{fmt(c.price)}</span>
      <span className={`font-mono text-[10px] sm:text-xs ${up ? 'text-emerald-400' : 'text-red-400'}`}>
        {up ? '▲' : '▼'} {up ? '+' : ''}{c.changePct.toFixed(2)}%
      </span>
    </div>
  );
};

export default function Ticker() {
  const { commodities } = useLiveData();
  // Limit ticker to a curated selection so the marquee stays readable.
  const featured = ['WTI', 'BRENT', 'GOLD', 'SILVER', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'BTC', 'ETH', 'SOL', 'SPX', 'NDX', 'VIX'];
  const items = commodities.filter((c) => featured.includes(c.symbol));
  const looped = [...items, ...items];
  return (
    <div className="bg-gray-950/80 backdrop-blur border-b border-gray-800/80 overflow-hidden">
      <div className="flex animate-marquee py-1.5 sm:py-2">
        {looped.map((c, i) => <TickerItem key={i} c={c} />)}
      </div>
    </div>
  );
}
