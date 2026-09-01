import React, { useId, useMemo, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { assetCategoryColor } from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';
import { downloadCSV } from '../utils/csv.js';
import CorrelationMatrix from './CorrelationMatrix.jsx';
import { dataModeLabel } from '../lib/marketDisplay.js';

const fmtPctChange = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const AddRow = ({ commodities, onAdd }) => {
  const [ticker, setTicker] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [matches, setMatches] = useState([]);
  const [activeMatch, setActiveMatch] = useState(-1);
  const fieldId = useId();
  const tickerId = `${fieldId}-ticker`;
  const quantityId = `${fieldId}-quantity`;
  const averageCostId = `${fieldId}-average-cost`;
  const suggestionsId = `${fieldId}-ticker-suggestions`;

  const selectedAsset = commodities.find(
    (c) => c.ticker.toUpperCase() === ticker.trim().toUpperCase(),
  );
  const quantity = Number(qty);
  const averageCost = Number(cost);
  const canSubmit = Boolean(selectedAsset)
    && qty.trim() !== ''
    && Number.isFinite(quantity)
    && quantity > 0
    && cost.trim() !== ''
    && Number.isFinite(averageCost)
    && averageCost > 0;

  const onTickerChange = (v) => {
    setTicker(v);
    setActiveMatch(-1);
    if (!v.trim()) { setMatches([]); return; }
    const q = v.toLowerCase();
    setMatches(commodities
      .filter((c) => c.category !== 'FX' && (c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)))
      .slice(0, 6));
  };

  const chooseTicker = (asset) => {
    setTicker(asset.ticker);
    setMatches([]);
    setActiveMatch(-1);
  };

  const onTickerKeyDown = (event) => {
    if (event.key === 'Escape') {
      setMatches([]);
      setActiveMatch(-1);
      return;
    }
    if (!matches.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveMatch((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveMatch((current) => (current <= 0 ? matches.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeMatch >= 0) {
      event.preventDefault();
      chooseTicker(matches[activeMatch]);
    }
  };

  const submit = (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    onAdd({ ticker: selectedAsset.ticker, qty: quantity, avgCost: averageCost });
    setTicker(''); setQty(''); setCost(''); setMatches([]);
    setActiveMatch(-1);
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5 space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-gray-500">Add a position</div>
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
        <div className="relative">
          <label htmlFor={tickerId} className="text-[10px] uppercase tracking-widest text-gray-500">Ticker</label>
          <input
            id={tickerId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={matches.length > 0}
            aria-controls={suggestionsId}
            aria-activedescendant={activeMatch >= 0 ? `${suggestionsId}-${activeMatch}` : undefined}
            value={ticker}
            onChange={(e) => onTickerChange(e.target.value)}
            onKeyDown={onTickerKeyDown}
            placeholder="e.g. NVDA"
            className="mt-1 w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-3 py-2 font-mono uppercase focus:outline-none focus:border-cyan-500"
          />
          {matches.length > 0 && (
            <ul
              id={suggestionsId}
              role="listbox"
              aria-label="Ticker suggestions"
              className="absolute left-0 right-0 mt-1 z-10 max-h-56 overflow-y-auto rounded-md border border-gray-800 bg-gray-950 shadow-xl"
            >
              {matches.map((m, index) => (
                <li
                  key={m.ticker}
                  id={`${suggestionsId}-${index}`}
                  role="option"
                  aria-selected={index === activeMatch}
                  onMouseEnter={() => setActiveMatch(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseTicker(m)}
                  className="px-3 py-2 cursor-pointer hover:bg-gray-800/70 flex items-center gap-2"
                >
                  <span className="font-mono text-xs text-gray-100 w-16">{m.ticker}</span>
                  <span className="text-xs text-gray-300 truncate flex-1">{m.name}</span>
                  <span className={`text-[10px] uppercase ${assetCategoryColor(m.category)}`}>{m.category}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label htmlFor={quantityId} className="text-[10px] uppercase tracking-widest text-gray-500">Quantity</label>
          <input
            id={quantityId}
            type="number" inputMode="decimal" step="any" value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="mt-1 w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-3 py-2 font-mono focus:outline-none focus:border-cyan-500"
          />
        </div>
        <div>
          <label htmlFor={averageCostId} className="text-[10px] uppercase tracking-widest text-gray-500">Average cost ($)</label>
          <input
            id={averageCostId}
            type="number" inputMode="decimal" step="any" value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="mt-1 w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-3 py-2 font-mono focus:outline-none focus:border-cyan-500"
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="h-[38px] px-4 rounded-md text-xs uppercase tracking-wider bg-cyan-500 text-gray-950 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >Add</button>
      </div>
    </form>
  );
};

function HoldingsView({ onSelectAsset }) {
  const {
    commodities, positions, upsertPosition, removePosition,
    formatAssetPrice, dashboardCurrency, dataMode,
  } = useLiveData();

  const enriched = useMemo(() => positions.map((p) => {
    const c = commodities.find((x) => x.ticker === p.ticker);
    if (!c) return { ...p, missing: true };
    const value = c.price * p.qty;
    const cost = p.avgCost * p.qty;
    const pnl = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const changeRate = Number(c.changePct) / 100;
    const previousPrice = Number.isFinite(c.prevClose) && c.prevClose > 0
      ? c.prevClose
      : Number.isFinite(changeRate) && changeRate > -1
        ? c.price / (1 + changeRate)
        : c.price;
    const dayChange = (c.price - previousPrice) * p.qty;
    return { ...p, c, value, cost, pnl, pnlPct, dayChange };
  }), [positions, commodities]);

  const totals = useMemo(() => {
    const visible = enriched.filter((p) => !p.missing);
    const value = visible.reduce((s, p) => s + p.value, 0);
    const cost = visible.reduce((s, p) => s + p.cost, 0);
    const pnl = value - cost;
    const dayChange = visible.reduce((s, p) => s + p.dayChange, 0);
    return { value, cost, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : 0, dayChange, count: visible.length };
  }, [enriched]);

  const exportCsv = () => {
    downloadCSV('portfolio.csv', enriched.filter((p) => !p.missing).map((p) => ({
      ticker: p.ticker, name: p.c.name, qty: p.qty, avgCost: p.avgCost,
      currentPrice: p.c.price, marketValue: p.value.toFixed(2),
      pnl: p.pnl.toFixed(2), pnlPct: p.pnlPct.toFixed(2), dayChange: p.dayChange.toFixed(2),
    })));
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-br from-gray-50 to-gray-300 bg-clip-text text-transparent">
            Portfolio
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            Track positions with live P&amp;L. Stored locally in your browser; there is no brokerage connection or trade execution.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={!totals.count}
          className="self-start px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >Export CSV</button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard label="Market value" value={`${formatPriceUSD(totals.value, formatAssetPrice)}`}
          sub={`${totals.count} position${totals.count === 1 ? '' : 's'}`} />
        <SummaryCard label="Cost basis" value={`${formatPriceUSD(totals.cost, formatAssetPrice)}`} />
        <SummaryCard
          label="Total P&L"
          value={`${formatPriceUSD(totals.pnl, formatAssetPrice)}`}
          sub={`${fmtPctChange(totals.pnlPct)} vs cost`}
          accent={totals.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <SummaryCard
          label="Today's change"
          value={`${formatPriceUSD(totals.dayChange, formatAssetPrice)}`}
          sub={dataModeLabel(dataMode)}
          accent={totals.dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
      </div>

      <AddRow commodities={commodities} onAdd={upsertPosition} />

      {/* Holdings list */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-widest text-gray-500">Holdings ({enriched.length})</div>
          <div className="text-[10px] text-gray-500 font-mono">displayed in {dashboardCurrency}</div>
        </div>
        {enriched.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            No holdings yet — add one above to get started.
          </div>
        )}
        <ul className="divide-y divide-gray-800">
          {enriched.map((p) => {
            if (p.missing) {
              return (
                <li key={p.ticker} className="px-4 py-3 flex items-center justify-between text-sm text-gray-400">
                  <span className="font-mono">{p.ticker}</span>
                  <span className="text-amber-400 text-xs">not in catalogue — open price tab to view, or remove</span>
                  <button
                    onClick={() => removePosition(p.ticker)}
                    aria-label={`Remove ${p.ticker} position`}
                    className="text-[10px] text-red-300 hover:underline"
                  >remove</button>
                </li>
              );
            }
            const up = p.pnl >= 0;
            return (
              <li key={p.ticker} className="px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 hover:bg-gray-800/30 transition-colors">
                <button onClick={() => onSelectAsset?.(p.ticker)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm text-gray-100">{p.ticker}</span>
                    <span className={`text-[10px] uppercase tracking-wider ${assetCategoryColor(p.c.category)}`}>{p.c.category}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">{p.c.name}</div>
                </button>
                <Sparkline data={p.c.history.map((h) => h.price)} color={up ? '#22c55e' : '#ef4444'} width={64} height={20} />
                <div className="text-right w-20 hidden sm:block">
                  <div className="text-[10px] text-gray-500 uppercase">Qty</div>
                  <div className="font-mono text-xs text-gray-100">{p.qty}</div>
                </div>
                <div className="text-right w-24">
                  <div className="text-[10px] text-gray-500 uppercase">Value</div>
                  <div className="font-mono text-xs text-gray-100">{formatPriceUSD(p.value, formatAssetPrice)}</div>
                </div>
                <div className="text-right w-24">
                  <div className="text-[10px] text-gray-500 uppercase">P&amp;L</div>
                  <div className={`font-mono text-xs ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                    {up ? '+' : ''}{formatPriceUSD(p.pnl, formatAssetPrice)}
                  </div>
                  <div className={`font-mono text-[10px] ${up ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                    {fmtPctChange(p.pnlPct)}
                  </div>
                </div>
                <button
                  onClick={() => removePosition(p.ticker)}
                  aria-label={`Remove ${p.ticker} position`}
                  className="text-gray-600 hover:text-red-400 text-base leading-none px-2"
                  title={`Remove ${p.ticker} position`}
                >×</button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="text-[11px] text-gray-500">
        Holdings are stored only on this device (localStorage). Clear your browser data and they're gone.
      </div>

      {enriched.filter((p) => !p.missing).length >= 2 && (
        <CorrelationMatrix tickers={enriched.filter((p) => !p.missing).map((p) => p.ticker)} />
      )}
    </div>
  );
}

function formatPriceUSD(amountUsd, formatAssetPrice) {
  // Use the same converter used elsewhere by passing a synthetic asset.
  const formatted = formatAssetPrice({ unit: '$', category: 'TECH' }, Math.abs(amountUsd));
  return amountUsd < 0 ? `-${formatted}` : formatted;
}

const SummaryCard = ({ label, value, sub, accent }) => (
  <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/90 to-gray-900/40 p-4 sm:p-5">
    <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
    <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
    <div className={`mt-2 font-mono text-2xl sm:text-3xl tracking-tight ${accent || 'text-gray-100'}`}>{value}</div>
    {sub && <div className="mt-1 text-[11px] sm:text-xs text-gray-400">{sub}</div>}
  </div>
);

export default function Portfolio({ onSelectAsset }) {
  return <HoldingsView onSelectAsset={onSelectAsset} />;
}
