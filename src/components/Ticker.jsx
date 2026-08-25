import React, { useMemo } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { isV2Crypto } from '../../lib/market/symbolMaps.js';

const FEATURED = ['WTI', 'BRENT', 'GOLD', 'SILVER', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'BTC', 'ETH', 'SOL', 'SPX', 'NDX', 'VIX'];

const TickerItem = ({ c, fmt, live }) => {
  const hasSessionChange = Number.isFinite(c.changePct);
  const up = hasSessionChange ? c.changePct >= 0 : null;
  return (
    <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 border-r border-[#262626] whitespace-nowrap">
      <span className="text-[10px] sm:text-xs uppercase tracking-wider text-[#737373] font-mono">
        {c.symbol}
        {live && <span className="ml-1 text-emerald-500/80">●</span>}
      </span>
      <span className="font-mono text-xs sm:text-sm text-[#f5f5f5] tabular-nums">{fmt(c)}</span>
      <span
        aria-label={`${c.ticker} session change`}
        className={`font-mono text-[10px] sm:text-xs tabular-nums ${up === null ? 'text-gray-400' : up ? 'text-emerald-400' : 'text-red-400'}`}
      >
        {up === null ? '—' : `${up ? '▲' : '▼'} ${up ? '+' : ''}${c.changePct.toFixed(2)}%`}
      </span>
    </div>
  );
};

export default function Ticker() {
  const {
    commodities,
    formatAssetPrice,
    resolveTickerAsset,
    useMarketV2,
  } = useLiveData();

  const items = useMemo(() => {
    const find = (sym) => commodities.find((c) => c.symbol === sym || c.ticker === sym);

    return FEATURED.map((sym) => {
      const base = find(sym);
      if (!base) return null;

      const row = useMarketV2 ? resolveTickerAsset(base) : base;
      const live = Boolean(
        useMarketV2
        && isV2Crypto(base.ticker)
        && row?.marketSource
        && row?.isLive === true
        && row?.stale !== true
        && row?.marketStale !== true
      );
      return live ? { ...row, _live: true } : row;
    }).filter(Boolean);
  }, [commodities, useMarketV2, resolveTickerAsset]);

  const looped = [...items, ...items];
  const fmt = (c) => formatAssetPrice(c);

  return (
    <div className="bg-[#000000]/90 backdrop-blur border-b border-[#262626] overflow-hidden">
      <div className="flex animate-marquee py-1.5 sm:py-2">
        {looped.map((c, i) => (
          <TickerItem key={`${c.ticker}-${i}`} c={c} fmt={fmt} live={Boolean(c._live)} />
        ))}
      </div>
    </div>
  );
}
