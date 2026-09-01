import React, { useMemo, useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';
import { CURRENCY_META, CURRENCY_NO_DECIMAL } from '../../lib/symbols.js';
import { dataModeLabel } from '../lib/marketDisplay.js';

const fmtAmount = (n, ccy) => {
  if (n == null || !isFinite(n)) return '—';
  const noDec = CURRENCY_NO_DECIMAL.has(ccy);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: noDec ? 0 : 2,
    maximumFractionDigits: noDec ? 0 : (Math.abs(n) < 1 ? 4 : 2),
  });
};
const fmtRate = (n) => n == null ? '—' : (n < 1 ? n.toFixed(4) : n.toLocaleString(undefined, { maximumFractionDigits: 4 }));

const rateModeCopy = (dataMode) => {
  if (dataMode === 'LIVE') {
    return {
      converter: 'Live Converter',
      summary: 'Live rates · convert any of 40+ currencies including SGD, HKD, INR, AED, ZAR.',
      short: 'live',
    };
  }
  if (dataMode === 'DEGRADED') {
    return {
      converter: 'Degraded converter',
      summary: 'Partially live rates · some conversions may use fallback data.',
      short: 'degraded',
    };
  }
  return {
    converter: 'Fallback converter',
    summary: 'Fallback rates · conversions may be outdated.',
    short: 'stale',
  };
};

const Converter = () => {
  const { availableCurrencies, getRate, dataMode } = useLiveData();
  const modeCopy = rateModeCopy(dataMode);

  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('SGD');
  const [amount, setAmount] = useState(1000);

  const rate = useMemo(() => getRate(from, to), [getRate, from, to]);
  const result = rate != null ? amount * rate : null;
  const swap = () => { setFrom(to); setTo(from); };

  return (
    <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/90 to-gray-900/60 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-emerald-400">{modeCopy.converter}</div>
          <h3 className="text-lg font-semibold text-gray-50 mt-0.5">Convert any pair</h3>
        </div>
        <span className="text-[10px] text-gray-500 font-mono">
          {availableCurrencies.length} currencies
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-end">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-gray-500">Amount &amp; from</label>
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              aria-label="Amount to convert"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-3 py-2 font-mono focus:outline-none focus:border-cyan-500"
            />
            <select
              aria-label="From currency"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-2 py-2 max-w-[180px]"
            >
              {availableCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}{CURRENCY_META[c] ? ` · ${CURRENCY_META[c].name}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          aria-label="Swap currencies"
          onClick={swap}
          className="self-end h-[42px] px-3 rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200"
          title="Swap"
        >⇄</button>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-gray-500">Result &amp; to</label>
          <div className="mt-1 flex gap-2">
            <output
              aria-label="Converted amount"
              aria-live="polite"
              className="flex-1 min-w-0 bg-gray-950 border border-emerald-500/30 text-emerald-300 text-sm rounded-md px-3 py-2 font-mono"
            >
              {(CURRENCY_META[to]?.sym || '')}{fmtAmount(result, to)}
            </output>
            <select
              aria-label="To currency"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-2 py-2 max-w-[180px]"
            >
              {availableCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}{CURRENCY_META[c] ? ` · ${CURRENCY_META[c].name}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 font-mono">
        {rate != null
          ? <>
              <span>1 {from} = {fmtRate(rate)} {to}</span>
              <span className="text-gray-700">|</span>
              <span>1 {to} = {fmtRate(1 / rate)} {from}</span>
            </>
          : <span>Rate not available for this pair.</span>
        }
      </div>
    </div>
  );
};

const QuickRates = () => {
  const { getRate, dashboardCurrency, dataMode } = useLiveData();
  const modeCopy = rateModeCopy(dataMode);
  const popular = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'SGD', 'HKD', 'KRW'];
  const base = dashboardCurrency;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-100">
          Rates vs {base}
        </h3>
        <span className="text-[10px] text-gray-500">{modeCopy.short}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {popular.filter((c) => c !== base).map((ccy) => {
          const r = getRate(base, ccy);
          return (
            <div key={ccy} className="bg-gray-950/50 border border-gray-800 rounded-md px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 flex items-center justify-between">
                <span>{base}/{ccy}</span>
                <span className="text-gray-600">{CURRENCY_META[ccy]?.sym}</span>
              </div>
              <div className="font-mono text-sm text-gray-100 mt-0.5">{fmtRate(r)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CurrencyNews = () => {
  const { intel, newsLive } = useLiveData();
  const items = useMemo(
    () => intel.filter((i) => i.category === 'Currency' || i.category === 'Finance').slice(0, 10),
    [intel]
  );
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-100">Currency &amp; Markets News</h3>
        <span className={`text-[10px] flex items-center gap-1 ${newsLive ? 'text-emerald-400' : 'text-amber-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${newsLive ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
          {newsLive ? 'live' : 'fetching'}
        </span>
      </div>
      {items.length === 0 && (
        <div className="text-xs text-gray-500">No items yet — feed loading.</div>
      )}
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id}>
            <a href={it.url} target="_blank" rel="noopener noreferrer"
               className="block hover:bg-gray-800/40 rounded px-2 py-2 -mx-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500">
                <span className="text-emerald-300">{it.category}</span>
                <span className="text-gray-500 truncate">{it.source}</span>
                <span className="text-gray-600 ml-auto">{it.time}</span>
              </div>
              <div className="text-xs text-gray-100 mt-1 leading-snug line-clamp-2">{it.headline}</div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default function Currency() {
  const { dataMode, pricesUpdatedAt, pricesLoading, newsLoading, refresh } = useLiveData();
  const modeCopy = rateModeCopy(dataMode);
  const refreshBusy = Boolean(pricesLoading || newsLoading);
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-br from-emerald-200 to-cyan-300 bg-clip-text text-transparent">
            Currency
          </h2>
          <div className="text-xs sm:text-sm text-gray-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{modeCopy.summary}</span>
            <span className={`text-[11px] flex items-center gap-1.5 ${dataMode === 'LIVE' ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dataMode === 'LIVE' ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
              {dataModeLabel(dataMode)}
            </span>
            {pricesUpdatedAt && (
              <span className="text-[10px] text-gray-500 font-mono">
                {new Date(pricesUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshBusy}
          aria-busy={refreshBusy}
          aria-label={refreshBusy ? 'Refreshing currency data' : 'Refresh currency data'}
          className="self-start px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white"
        >{refreshBusy ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <Converter />
      <QuickRates />
      <CurrencyNews />
    </div>
  );
}
