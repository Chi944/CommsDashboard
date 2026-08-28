import React, { useMemo } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { isTrustedMarketRow } from '../lib/marketDisplay.js';

const tileBg = (pct) => {
  const a = Math.min(0.85, Math.max(0.08, Math.abs(pct) / 5));
  return pct >= 0 ? `rgba(16, 185, 129, ${a})` : `rgba(239, 68, 68, ${a})`;
};

const SECTOR_LABEL = {
  TECH: 'Tech', SEMI: 'Semis', DATA: 'Software & AI', AUTO: 'Auto',
  FINANCE: 'Finance', HEALTH: 'Health', CONSUMER: 'Consumer',
  OIL: 'Oil & Gas', INDUST: 'Industrials', TELECOM: 'Telecom',
  REIT: 'REIT', UTIL: 'Utilities', TRAVEL: 'Travel', ASIA: 'Asia',
  MOMENTUM: 'Momentum', CRYPTO: 'Crypto',
  ENERGY: 'Energy futures', METALS: 'Metals', AGRICULTURE: 'Agri',
};

export default function SectorHeatmap({ onSelectAsset }) {
  const { commodities, resolveHeatmapAsset } = useLiveData();

  const sectors = useMemo(() => {
    const map = {};
    for (const c of commodities) {
      const row = resolveHeatmapAsset(c);
      if (row.category === 'FX' || row.category === 'MACRO') continue;
      if (!isTrustedMarketRow(row)) continue;
      if (typeof row.changePct !== 'number') continue;
      if (!map[row.category]) map[row.category] = [];
      map[row.category].push(row);
    }
    const rows = Object.entries(map).map(([cat, items]) => {
      const avg = items.reduce((s, i) => s + i.changePct, 0) / items.length;
      const top = [...items].sort((a, b) => b.changePct - a.changePct)[0];
      const bottom = [...items].sort((a, b) => a.changePct - b.changePct)[0];
      return { cat, items, avg, top, bottom };
    });
    return rows.sort((a, b) => b.avg - a.avg);
  }, [commodities, resolveHeatmapAsset]);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-100">
          Sector Heatmap
        </h3>
        <span className="text-[10px] text-gray-500 font-mono">avg % today</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {sectors.map((s) => (
          <button
            key={s.cat}
            onClick={() => s.top && onSelectAsset?.(s.top.ticker)}
            style={{ background: tileBg(s.avg) }}
            className="text-left rounded-lg p-3 border border-gray-800 hover:border-gray-600 transition-all"
            title={`Click to open ${s.top?.ticker} — best in sector`}
          >
            <div className="flex items-start justify-between">
              <div className="text-xs font-semibold text-gray-50 truncate">{SECTOR_LABEL[s.cat] || s.cat}</div>
              <div className={`font-mono text-xs ${s.avg >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>
                {s.avg >= 0 ? '+' : ''}{s.avg.toFixed(2)}%
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
              <div className="bg-black/20 rounded px-1.5 py-1 truncate">
                <div className="text-gray-300/70 uppercase tracking-wider text-[9px]">Top</div>
                <div className="font-mono text-gray-50 truncate">{s.top.ticker}</div>
                <div className="font-mono text-emerald-200">{s.top.changePct >= 0 ? '+' : ''}{s.top.changePct.toFixed(1)}%</div>
              </div>
              <div className="bg-black/20 rounded px-1.5 py-1 truncate">
                <div className="text-gray-300/70 uppercase tracking-wider text-[9px]">Worst</div>
                <div className="font-mono text-gray-50 truncate">{s.bottom.ticker}</div>
                <div className="font-mono text-red-200">{s.bottom.changePct.toFixed(1)}%</div>
              </div>
            </div>
            <div className="mt-1 text-[10px] text-gray-300/60">{s.items.length} names</div>
          </button>
        ))}
      </div>
    </div>
  );
}
