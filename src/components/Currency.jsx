import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { useLiveData } from '../state/LiveData.jsx';
import Sparkline from './Sparkline.jsx';

const RANGES = ['1d', '5d', '1mo', '3mo', '6mo', '1y', 'ytd'];
const RANGE_LABEL = { '1d': '1D', '5d': '5D', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y', 'ytd': 'YTD' };
const COMPARE_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

const fmtRate = (n) => {
  if (n == null) return '—';
  if (n < 1) return n.toFixed(4);
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return n.toFixed(4);
};
const fmtAmount = (n, currency) => {
  if (n == null || !isFinite(n)) return '—';
  const digits = currency === 'JPY' || currency === 'KRW' || currency === 'IDR' ? 0 : 2;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
};

// Build a rate(from, to) function from the FX pairs we have.
function makeRateFn(fxList) {
  const direct = new Map();           // 'EUR->USD' -> price
  for (const f of fxList) {
    if (f.base && f.quote) direct.set(`${f.base}->${f.quote}`, f.price);
  }
  return (from, to) => {
    if (from === to) return 1;
    if (direct.has(`${from}->${to}`)) return direct.get(`${from}->${to}`);
    if (direct.has(`${to}->${from}`)) {
      const p = direct.get(`${to}->${from}`);
      return p ? 1 / p : null;
    }
    // Cross via USD
    const fromUSD = from === 'USD' ? 1
      : (direct.get(`${from}->USD`) ?? (direct.has(`USD->${from}`) ? 1 / direct.get(`USD->${from}`) : null));
    const toUSD = to === 'USD' ? 1
      : (direct.get(`${to}->USD`) ?? (direct.has(`USD->${to}`) ? 1 / direct.get(`USD->${to}`) : null));
    if (fromUSD && toUSD) return fromUSD / toUSD;
    return null;
  };
}

// Map symbol metadata to the FX pair entry, attaching base/quote.
function withBQ(c) {
  if (c.base && c.quote) return c;
  // Recover from symbol like "EUR/USD"
  const m = (c.symbol || '').match(/^([A-Z]{3})\/([A-Z]{3})$/);
  return m ? { ...c, base: m[1], quote: m[2] } : c;
}

const Converter = ({ fxList }) => {
  const allCurrencies = useMemo(() => {
    const set = new Set(['USD']);
    fxList.forEach((f) => { f.base && set.add(f.base); f.quote && set.add(f.quote); });
    return [...set].sort();
  }, [fxList]);

  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [amount, setAmount] = useState(1000);

  const rate = useMemo(() => makeRateFn(fxList)(from, to), [fxList, from, to]);
  const result = rate != null ? amount * rate : null;

  const swap = () => { setFrom(to); setTo(from); };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">Currency Converter</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-gray-500">From</label>
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-3 py-2 font-mono focus:outline-none focus:border-cyan-500"
            />
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-2 py-2"
            >
              {allCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <button
          onClick={swap}
          className="self-end h-[42px] px-3 rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white"
          title="Swap"
        >⇄</button>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-gray-500">To</label>
          <div className="mt-1 flex gap-2">
            <div className="flex-1 min-w-0 bg-gray-950 border border-gray-800 text-emerald-300 text-sm rounded-md px-3 py-2 font-mono">
              {fmtAmount(result, to)}
            </div>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-2 py-2"
            >
              {allCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="mt-3 text-[11px] text-gray-500 font-mono">
        {rate != null ? `1 ${from} = ${fmtRate(rate)} ${to}` : 'Rate not available for this pair'}
      </div>
    </div>
  );
};

const CurrencyNews = () => {
  const { intel, newsLive } = useLiveData();
  const items = useMemo(
    () => intel.filter((i) => i.category === 'Currency' || i.category === 'Finance').slice(0, 8),
    [intel]
  );
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-gray-100">Currency &amp; Markets News</h3>
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
            <a
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:bg-gray-800/40 rounded px-2 py-2 -mx-2"
            >
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
  const { commodities, pricesLive, pricesUpdatedAt, refresh } = useLiveData();

  const fxList = useMemo(
    () => commodities.filter((c) => c.category === 'FX').map(withBQ),
    [commodities]
  );

  const [selected, setSelected] = useState(fxList[0]?.ticker || 'EURUSD');
  const [range, setRange] = useState('1mo');
  const [compare, setCompare] = useState(false);
  const [compareSet, setCompareSet] = useState(() => new Set(['EURUSD', 'USDJPY', 'GBPUSD']));
  const [historyCache, setHistoryCache] = useState({});
  const [chartLoading, setChartLoading] = useState(false);

  // Re-anchor selection if it falls out of the FX list (e.g. on first load).
  useEffect(() => {
    if (fxList.length === 0) return;
    if (!fxList.some((c) => c.ticker === selected)) setSelected(fxList[0].ticker);
  }, [fxList, selected]);

  const sel = useMemo(() => fxList.find((c) => c.ticker === selected) || fxList[0], [fxList, selected]);

  const toggleCompare = (t) => setCompareSet((p) => {
    const n = new Set(p);
    if (n.has(t)) { if (n.size > 1) n.delete(t); }
    else if (n.size < 5) n.add(t);
    return n;
  });

  const neededTickers = useMemo(
    () => (compare ? [...compareSet] : sel ? [sel.ticker] : []),
    [compare, compareSet, sel]
  );

  useEffect(() => {
    const missing = neededTickers.filter((t) => !historyCache[`${t}|${range}`]);
    if (missing.length === 0) return;
    let cancelled = false;
    setChartLoading(true);
    Promise.all(
      missing.map((t) =>
        fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=${range}`)
          .then((r) => r.ok ? r.json() : null)
          .then((j) => (j && j.ok && Array.isArray(j.points) && j.points.length) ? [t, j.points] : [t, null])
          .catch(() => [t, null])
      )
    ).then((entries) => {
      if (cancelled) return;
      setHistoryCache((prev) => {
        const next = { ...prev };
        for (const [t, pts] of entries) if (pts) next[`${t}|${range}`] = pts;
        return next;
      });
      setChartLoading(false);
    });
    return () => { cancelled = true; };
  }, [neededTickers, range]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => {
    if (compare) {
      const tickers = [...compareSet];
      const series = tickers.map((t) => historyCache[`${t}|${range}`]).filter(Boolean);
      if (series.length === 0) return [];
      const minLen = Math.min(...series.map((s) => s.length));
      const out = [];
      for (let i = 0; i < minLen; i++) {
        const row = { date: series[0][i].date };
        tickers.forEach((t) => {
          const arr = historyCache[`${t}|${range}`];
          if (arr && arr[i]) row[t] = arr[i].price;
        });
        out.push(row);
      }
      return out;
    }
    if (!sel) return [];
    const cached = historyCache[`${sel.ticker}|${range}`];
    if (cached && cached.length) return cached;
    if (range === '1mo' && sel.history?.length) return sel.history.map((h) => ({ date: h.date, price: h.price }));
    return [];
  }, [compare, compareSet, sel, range, historyCache]);

  const chartKey = compare ? `cmp:${range}:${[...compareSet].join(',')}` : `one:${range}:${sel?.ticker}`;
  const compareTickers = [...compareSet];

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-br from-emerald-200 to-cyan-300 bg-clip-text text-transparent">
            Currency
          </h2>
          <div className="text-xs sm:text-sm text-gray-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Live FX rates, conversion, and pair tracking.</span>
            <span className={`text-[11px] flex items-center gap-1.5 ${pricesLive ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pricesLive ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
              {pricesLive ? 'live' : 'fetching'}
            </span>
            {pricesUpdatedAt && (
              <span className="text-[10px] text-gray-500 font-mono">
                {new Date(pricesUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white"
          >Refresh</button>
          <button
            onClick={() => setCompare((v) => !v)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border transition-colors
              ${compare ? 'bg-cyan-500 border-cyan-400 text-gray-950' : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white'}`}
          >{compare ? 'Comparing' : 'Compare'}</button>
        </div>
      </div>

      <Converter fxList={fxList} />

      {/* Two-column layout on desktop: chart sticky on right, list on left */}
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-6">
        {/* Chart panel — first on mobile, right column on lg */}
        <div className="lg:col-span-7 lg:order-2 lg:sticky lg:top-28 lg:self-start space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                {compare ? (
                  <>
                    <div className="text-xs uppercase tracking-widest text-gray-500">Comparing {compareTickers.length} pairs</div>
                    <div className="text-lg sm:text-xl font-semibold text-gray-100">FX overlay</div>
                  </>
                ) : sel ? (
                  <>
                    <div className="text-xs uppercase tracking-widest text-gray-500">{sel.symbol}</div>
                    <div className="text-lg sm:text-xl font-semibold text-gray-100">{sel.name}</div>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {!compare && sel && (
                  <div className="flex flex-col items-end">
                    <div className="font-mono text-xl sm:text-2xl text-gray-100">{fmtRate(sel.price)}</div>
                    <div className={`font-mono text-[11px] ${sel.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sel.changePct >= 0 ? '+' : ''}{sel.changePct.toFixed(2)}%
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded
                        ${range === r ? 'bg-gray-100 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                    >{RANGE_LABEL[r]}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="h-64 sm:h-72 relative">
              {chartLoading && chartData.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                  Loading {RANGE_LABEL[range]} history…
                </div>
              )}
              {chartData.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart key={chartKey} data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
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
                        <Line key={t} type="monotone" dataKey={t}
                          stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                          strokeWidth={2} dot={false} />
                      ))
                    ) : (
                      <Line type="monotone" dataKey="price" stroke="#34d399" strokeWidth={2} dot={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* List of FX pairs — left column on lg, after chart on mobile */}
        <div className="lg:col-span-5 lg:order-1">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-widest text-gray-500">FX Pairs ({fxList.length})</div>
              {compare && <div className="text-[10px] text-gray-500">{compareTickers.length}/5 selected</div>}
            </div>
            <div className="divide-y divide-gray-800 max-h-[640px] overflow-y-auto">
              {fxList.map((c) => {
                const up = c.changePct >= 0;
                const isSel = c.ticker === selected;
                const inCompare = compareSet.has(c.ticker);
                return (
                  <div
                    key={c.ticker}
                    onClick={() => setSelected(c.ticker)}
                    className={`flex items-center gap-3 p-3 cursor-pointer transition-colors
                      ${isSel ? 'bg-gray-800/60' : 'hover:bg-gray-800/30'}`}
                  >
                    {compare && (
                      <input
                        type="checkbox"
                        checked={inCompare}
                        onChange={() => toggleCompare(c.ticker)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-cyan-400"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-gray-100">{c.symbol}</div>
                      <div className="text-[10px] text-gray-500 truncate">{c.name}</div>
                    </div>
                    <Sparkline
                      data={c.history.map((h) => h.price)}
                      color={up ? '#22c55e' : '#ef4444'}
                      width={70} height={20}
                    />
                    <div className="text-right w-20">
                      <div className="font-mono text-xs text-gray-100">{fmtRate(c.price)}</div>
                      <div className={`font-mono text-[10px] ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                        {up ? '+' : ''}{c.changePct.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <CurrencyNews />
    </div>
  );
}
