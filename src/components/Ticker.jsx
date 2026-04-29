import React from 'react';
import { commodities } from '../data/mockData.js';

const TickerItem = ({ c }) => {
  const up = c.changePct >= 0;
  return (
    <div className="flex items-center gap-3 px-6 border-r border-gray-800 whitespace-nowrap">
      <span className="text-xs uppercase tracking-wider text-gray-500">{c.symbol}</span>
      <span className="font-mono text-sm text-gray-100">{c.price.toLocaleString()}</span>
      <span className={`font-mono text-xs ${up ? 'text-green-400' : 'text-red-400'}`}>
        {up ? '▲' : '▼'} {up ? '+' : ''}{c.changePct.toFixed(2)}%
      </span>
    </div>
  );
};

export default function Ticker() {
  const items = [...commodities, ...commodities];
  return (
    <div className="bg-gray-900 border-b border-gray-800 overflow-hidden">
      <div className="flex animate-marquee py-2">
        {items.map((c, i) => (
          <TickerItem key={i} c={c} />
        ))}
      </div>
    </div>
  );
}
