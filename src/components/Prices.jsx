import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
  ReferenceLine,
} from 'recharts';
import { useLiveData } from '../state/LiveData.jsx';
import { assetCategoryColor } from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';
import AnalysisPanel from './AnalysisPanel.jsx';
import AlertButton from './AlertButton.jsx';
import { downloadCSV } from '../utils/csv.js';
import { dataModeLabel, isTrustedMarketRow } from '../lib/marketDisplay.js';

// Quick filter pills (always visible).
const PRIMARY_CATS = ['ALL', 'TRENDING', 'WATCHLIST'];

// Categories grouped by sector for the secondary nav. Keeps the pill
// row from getting overwhelmingly long while still surfacing every
// category on tap.
const CATEGORY_GROUPS = [
  { label: 'Stocks',      cats: ['TECH', 'SEMI', 'DATA', 'AUTO', 'FINANCE', 'HEALTH', 'CONSUMER', 'INDUST', 'TELECOM', 'REIT', 'UTIL', 'TRAVEL', 'ASIA', 'OIL', 'MOMENTUM'] },
  { label: 'Commodities', cats: ['ENERGY', 'METALS', 'AGRICULTURE'] },
  { label: 'Crypto',      cats: ['CRYPTO'] },
  { label: 'Macro',       cats: ['MACRO'] },
];
const ALL_CATS = [...PRIMARY_CATS, ...CATEGORY_GROUPS.flatMap((g) => g.cats)];

const RANGES = ['1D', '7D', '30D', '90D', 'YTD'];
// Maps display range labels to the API range param used by /api/history
const API_RANGE = { '1D': '1d', '7D': '5d', '30D': '1mo', '90D': '3mo', 'YTD': 'ytd' };
const COMPARE_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

export const fmtPctChange = (n) => (
  Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'
);

// RSI (Wilder, period 14) from an array of prices + parallel dates array.
function computeRSI(prices, dates, period = 14) {
  if (prices.length < period + 1) return [];
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]; else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period; avgLoss /= period;
  const result = [];
  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({ date: dates[period], rsi: +(100 - 100 / (1 + rs0)).toFixed(1) });
  for (let i = period; i < changes.length; i++) {
    const gain = Math.max(0, changes[i]);
    const loss = Math.max(0, -changes[i]);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ date: dates[i + 1], rsi: +(100 - 100 / (1 + rs)).toFixed(1) });
  }
  return result;
}

const PRESETS_KEY = 'comms.presets.v1';
const NOTES_KEY = 'comms.notes.v1';

function orderedHistoryDates(tickers, byTicker) {
  const nextDates = new Map();
  const indegree = new Map();
  const firstSeen = new Map();
  let sequence = 0;
  const addDate = (date) => {
    if (indegree.has(date)) return;
    indegree.set(date, 0);
    nextDates.set(date, new Set());
    firstSeen.set(date, sequence++);
  };

  for (const ticker of tickers) {
    const dates = [...byTicker.get(ticker).keys()];
    for (const date of dates) addDate(date);
    for (let index = 1; index < dates.length; index += 1) {
      const previous = dates[index - 1];
      const current = dates[index];
      if (previous === current || nextDates.get(previous).has(current)) continue;
      nextDates.get(previous).add(current);
      indegree.set(current, indegree.get(current) + 1);
    }
  }

  const ready = [...indegree.keys()]
    .filter((date) => indegree.get(date) === 0)
    .sort((a, b) => firstSeen.get(a) - firstSeen.get(b));
  const ordered = [];
  while (ready.length) {
    const date = ready.shift();
    ordered.push(date);
    for (const next of nextDates.get(date)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
        ready.sort((a, b) => firstSeen.get(a) - firstSeen.get(b));
      }
    }
  }
  return ordered.length === indegree.size
    ? ordered
    : [...firstSeen.keys()];
}

const tileBg = (pct) => {
  const a = Math.min(0.65, Math.max(0.06, Math.abs(pct) / 8));
  return pct >= 0 ? `rgba(34, 197, 94, ${a})` : `rgba(239, 68, 68, ${a})`;
};

// ---------- Heatmap ----------
const Heatmap = ({ items, selectedTicker, onSelect, fmt, resolveHeatmapAsset }) => {
  const resolvedItems = items
    .map((item) => resolveHeatmapAsset ? resolveHeatmapAsset(item) : item)
    .filter(isTrustedMarketRow);
  if (resolvedItems.length === 0) {
    return <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center text-sm text-gray-500">No items.</div>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {resolvedItems.map((display) => {
        const c = display;
        const up = display.changePct >= 0;
        const sel = c.ticker === selectedTicker;
        return (
          <button
            key={c.ticker}
            onClick={() => onSelect(c.ticker)}
            aria-pressed={sel}
            aria-label={`Select ${c.ticker} — ${c.name}`}
            style={{ background: tileBg(display.changePct) }}
            className={`text-left rounded-lg p-3 border transition-all
              ${sel ? 'border-cyan-400 ring-1 ring-cyan-400/40' : 'border-gray-800 hover:border-gray-600'}`}
          >
            <div className="flex items-start justify-between">
              <div className="font-mono text-sm font-semibold text-gray-100">{c.ticker}</div>
              <div className={`text-[10px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>{c.category}</div>
            </div>
            <div className="text-[11px] text-gray-300 truncate mt-0.5">{c.name}</div>
            <div className="mt-2 flex items-end justify-between">
              <div className="font-mono text-sm text-gray-100">{fmt(display)}</div>
              <div className={`font-mono text-xs ${up ? 'text-green-300' : 'text-red-300'}`}>
                {fmtPctChange(display.changePct)}
              </div>
            </div>
            <div className="mt-2">
              <Sparkline data={c.history.map((h) => h.price)} color={up ? '#22c55e' : '#ef4444'} width={140} height={18} fill />
            </div>
          </button>
        );
      })}
    </div>
  );
};

// ---------- 52-week range bar ----------
const RangeBar = ({ low, high, current, fmt }) => {
  if (low == null || high == null || current == null || high <= low) return null;
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  return (
    <div>
      <div className="relative h-1.5 bg-gray-800 rounded-full">
        <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-cyan-400/30"
             style={{ left: `calc(${pct}% - 4px)` }} />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-gray-500 mt-1">
        <span>{fmt(low)}</span>
        <span className="text-gray-400">{pct.toFixed(0)}% of range</span>
        <span>{fmt(high)}</span>
      </div>
    </div>
  );
};

// ---------- Detail panel ----------
const DetailPanel = ({ c, formatAssetPrice }) => {
  if (!c) return null;
  const fmt = (v) => formatAssetPrice(c, v);
  const items = [
    ['Open',           c.open      != null ? fmt(c.open)      : '—'],
    ['Previous close', c.prevClose != null ? fmt(c.prevClose) : '—'],
    ['Day high',       fmt(c.high)],
    ['Day low',        fmt(c.low)],
    ['52w high',       c.fiftyTwoWeekHigh != null ? fmt(c.fiftyTwoWeekHigh) : '—'],
    ['52w low',        c.fiftyTwoWeekLow  != null ? fmt(c.fiftyTwoWeekLow)  : '—'],
    ['Volume',         c.volume == null ? '—'
                       : c.volume >= 1e9 ? `${(c.volume/1e9).toFixed(2)}B`
                       : c.volume >= 1e6 ? `${(c.volume/1e6).toFixed(2)}M`
                       : c.volume >= 1e3 ? `${(c.volume/1e3).toFixed(1)}K`
                       : String(c.volume)],
    ['Exchange',       c.exchange || '—'],
  ];
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5 space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-gray-500">Quote details</div>
        <div className="text-sm text-gray-100">{c.name} <span className="text-gray-500 font-mono">· {c.ticker}</span></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([label, val]) => (
          <div key={label} className="bg-gray-950/50 border border-gray-800 rounded-md px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
            <div className="font-mono text-xs text-gray-100 mt-0.5">{val}</div>
          </div>
        ))}
      </div>
      {c.fiftyTwoWeekLow != null && c.fiftyTwoWeekHigh != null && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">52-week range</div>
          <RangeBar low={c.fiftyTwoWeekLow} high={c.fiftyTwoWeekHigh} current={c.price} fmt={fmt} />
        </div>
      )}
    </div>
  );
};

// ---------- Asset news ----------
const AssetNews = ({ asset }) => {
  const assetKey = asset ? `${asset.ticker}:${asset.name}` : '';
  const [newsState, setNewsState] = useState({
    assetKey: '',
    items: [],
    loading: false,
    error: null,
  });
  const currentState = newsState.assetKey === assetKey
    ? newsState
    : { items: [], loading: Boolean(asset), error: null };
  const { items, loading, error: err } = currentState;

  useEffect(() => {
    if (!asset) {
      setNewsState({ assetKey: '', items: [], loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setNewsState({ assetKey, items: [], loading: true, error: null });
    fetch(`/api/asset-news?q=${encodeURIComponent(asset.name)}&limit=6`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))
      .then((j) => {
        if (!cancelled) {
          setNewsState({
            assetKey,
            items: j.ok && Array.isArray(j.items) ? j.items : [],
            loading: false,
            error: null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNewsState({ assetKey, items: [], loading: false, error: true });
        }
      });
    return () => { cancelled = true; };
  }, [assetKey]);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-100">News · {asset?.name || ''}</h3>
        {loading && <span className="text-[10px] text-gray-500">loading…</span>}
      </div>
      {err && <div className="text-xs text-red-400">Failed to load news.</div>}
      {!loading && !err && items.length === 0 && (
        <div className="text-xs text-gray-500">No recent items.</div>
      )}
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
        {items.map((it) => (
          <li key={it.id}>
            <a href={it.url} target="_blank" rel="noopener noreferrer"
               className="block hover:bg-gray-800/40 rounded px-2 py-1.5 -mx-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500">
                <span>{it.source}</span>
                <span className="ml-auto text-gray-600">{it.time}</span>
              </div>
              <div className="text-xs text-gray-100 mt-1 leading-snug line-clamp-2">{it.headline}</div>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------- Main ----------
export default function Prices({ initialTicker = null, onTickerChange } = {}) {
  const {
    commodities: rawCommodities, rankingCommodities, dataMode, pricesUpdatedAt, refresh,
    pricesLoading, newsLoading,
    formatAssetPrice, dashboardCurrency, resolveHeatmapAsset, resolveTablePrice,
    watchlistNames, activeWatchlist, activeWatchSet,
    setActiveList, createList, renameList, deleteList, toggleWatch,
  } = useLiveData();

  // FX excluded — they live behind the Currency tab/dropdown.
  const commodities = useMemo(
    () => rawCommodities.filter((c) => c.category !== 'FX'),
    [rawCommodities]
  );
  const rankingAssets = useMemo(
    () => rankingCommodities.filter((c) => c.category !== 'FX' && typeof c.changePct === 'number'),
    [rankingCommodities],
  );

  const [cat, setCat] = useState('ALL');
  const [view, setView] = useState('table');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => (
    initialTicker && commodities.some((asset) => asset.ticker === initialTicker)
      ? initialTicker
      : commodities[0]?.ticker
  ));
  const [range, setRange] = useState('30D');
  const [compare, setCompare] = useState(false);
  const [compareSet, setCompareSet] = useState(
    () => new Set(['NVDA', 'AAPL', 'BTC'].filter((t) => commodities.some((c) => c.ticker === t)))
  );
  const watchlist = activeWatchSet;

  const [historyCache, setHistoryCache] = useState({});
  const [historyIssues, setHistoryIssues] = useState({});
  const [historyRetryNonce, setHistoryRetryNonce] = useState(0);
  const [chartLoading, setChartLoading] = useState(false);
  const searchRef = useRef(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareErrorUrl, setShareErrorUrl] = useState(null);
  const [showRsi, setShowRsi] = useState(false);
  const [presets, setPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; }
  });
  const [notes, setNotesMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch { return {}; }
  });
  const [editingNote, setEditingNote] = useState(null); // ticker being edited
  const [watchlistError, setWatchlistError] = useState(null);
  const handledInitialTickerRef = useRef(null);

  const selectTicker = useCallback((ticker) => {
    if (!ticker || !commodities.some((asset) => asset.ticker === ticker)) return;
    setShareCopied(false);
    setShareErrorUrl(null);
    setSelected(ticker);
    onTickerChange?.(ticker);
  }, [commodities, onTickerChange]);

  // Keyboard shortcut: '/' focuses the search input. Esc clears it.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
      if (e.key === '/' && !isTyping) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // When the user navigates to Prices via "click on Overview", honour
  // the requested ticker: clear the search/filter so it's visible,
  // select it without echoing a stale local default back to the route.
  useEffect(() => {
    if (!initialTicker) return;
    if (!commodities.some((c) => c.ticker === initialTicker)) return;
    if (handledInitialTickerRef.current === initialTicker) return;
    handledInitialTickerRef.current = initialTicker;
    setQuery('');
    setCat('ALL');
    setSelected(initialTicker);
    // Scroll the page to the top so the chart panel is in view
    if (typeof window !== 'undefined' && !/jsdom/i.test(window.navigator?.userAgent || '')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [initialTicker, commodities]);

  const toggleCompare = (t) => setCompareSet((p) => {
    const n = new Set(p);
    if (n.has(t)) { if (n.size > 1) n.delete(t); }
    else if (n.size < 5) n.add(t);
    return n;
  });

  // Search overrides category filter when active.
  const filtered = useMemo(() => {
    if (query.trim()) {
      const q = query.toLowerCase();
      return commodities.filter((c) =>
        c.ticker.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q)
      );
    }
    if (cat === 'ALL') return commodities;
    if (cat === 'WATCHLIST') return commodities.filter((c) => watchlist.has(c.ticker));
    if (cat === 'TRENDING') {
      return [...rankingAssets]
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 24);
    }
    return commodities.filter((c) => c.category === cat);
  }, [cat, query, watchlist, commodities, rankingAssets]);

  const sel = useMemo(
    () => commodities.find((c) => c.ticker === selected) || commodities[0],
    [commodities, selected]
  );

  // Reassign selection when it falls outside the filtered set.
  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some((c) => c.ticker === selected)) {
      selectTicker(filtered[0].ticker);
    }
  }, [filtered, selectTicker, selected]);

  const neededTickers = useMemo(
    () => (compare ? [...compareSet].sort((a, b) => a.localeCompare(b)) : sel ? [sel.ticker] : []),
    [compare, compareSet, sel]
  );

  useEffect(() => {
    const missing = neededTickers.filter((t) => !historyCache[`${t}|${range}`]);
    if (missing.length === 0) {
      setChartLoading(false);
      return undefined;
    }
    let cancelled = false;
    setChartLoading(true);
    setHistoryIssues((previous) => {
      const next = { ...previous };
      for (const ticker of missing) delete next[`${ticker}|${range}`];
      return next;
    });
    Promise.all(
      missing.map((t) =>
        fetch(`/api/history?ticker=${encodeURIComponent(t)}&range=${API_RANGE[range]}`)
          .then((r) => r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)))
          .then((j) => {
            if (!j?.ok || !Array.isArray(j.points)) return [t, null, 'error'];
            return j.points.length ? [t, j.points, null] : [t, null, 'empty'];
          })
          .catch(() => [t, null, 'error'])
      )
    ).then((entries) => {
      if (cancelled) return;
      setHistoryCache((prev) => {
        const next = { ...prev };
        for (const [t, pts] of entries) if (pts) next[`${t}|${range}`] = pts;
        return next;
      });
      setHistoryIssues((previous) => {
        const next = { ...previous };
        for (const [ticker, points, issue] of entries) {
          const key = `${ticker}|${range}`;
          if (points) delete next[key];
          else next[key] = issue;
        }
        return next;
      });
      setChartLoading(false);
    });
    return () => { cancelled = true; };
  }, [neededTickers, range, historyRetryNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => {
    if (compare) {
      const tickers = neededTickers;
      const byTicker = new Map(tickers.map((ticker) => [
        ticker,
        new Map((historyCache[`${ticker}|${range}`] || []).map((point) => [point.date, point.price])),
      ]));
      const dates = orderedHistoryDates(tickers, byTicker);
      return dates.map((date) => {
        const row = { date };
        for (const ticker of tickers) {
          const series = byTicker.get(ticker);
          row[ticker] = series.has(date) ? series.get(date) : null;
        }
        return row;
      });
    }
    if (!sel) return [];
    const cached = historyCache[`${sel.ticker}|${range}`];
    if (cached && cached.length) return cached;
    if (range === '30D' && sel.history && sel.history.length) {
      return sel.history.map((h) => ({ date: h.date, price: h.price }));
    }
    return [];
  }, [compare, neededTickers, sel, range, historyCache]);

  const rsiData = useMemo(() => {
    if (!showRsi || compare || chartData.length === 0) return [];
    const prices = chartData.map((d) => d.price).filter((p) => p != null);
    const dates = chartData.map((d) => d.date);
    return computeRSI(prices, dates);
  }, [showRsi, compare, chartData]);

  const setNote = useCallback((ticker, note) => {
    setNotesMap((prev) => {
      const next = { ...prev };
      if (note?.trim()) next[ticker] = note.trim();
      else delete next[ticker];
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const savePreset = useCallback(() => {
    const name = window.prompt('Save current layout as:');
    if (!name?.trim()) return;
    setPresets((prev) => {
      const next = [...prev, { name: name.trim(), cat, view }];
      try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [cat, view]);

  const deletePreset = useCallback((i) => {
    setPresets((prev) => {
      const next = prev.filter((_, j) => j !== i);
      try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const exportRows = useMemo(() => filtered
    .map((asset) => resolveTablePrice(asset))
    .filter(isTrustedMarketRow)
    .map((display) => ({
      ticker: display.ticker, name: display.name, category: display.category, unit: display.unit,
      price_usd: display.price, changePct: display.changePct, changeAbs: display.changeAbs,
      open: display.open, high: display.high, low: display.low,
      prevClose: display.prevClose, volume: display.volume,
      fiftyTwoWeekHigh: display.fiftyTwoWeekHigh, fiftyTwoWeekLow: display.fiftyTwoWeekLow,
      source: display.source, asOf: display.asOf || '', stale: Boolean(display.stale),
    })), [filtered, resolveTablePrice]);

  const exportCsv = () => downloadCSV(`prices-${cat.toLowerCase()}.csv`, exportRows);

  const renameActiveWatchlist = () => {
    const requested = window.prompt('Rename watchlist:', activeWatchlist);
    if (requested == null) return;
    const name = requested.trim();
    if (!name || name === activeWatchlist) return;
    const duplicate = watchlistNames.find(
      (existing) => existing !== activeWatchlist
        && existing.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) {
      setWatchlistError(`${duplicate} already exists.`);
      return;
    }
    renameList(activeWatchlist, name);
    setWatchlistError(null);
  };

  const deleteActiveWatchlist = () => {
    if (watchlistNames.length <= 1) return;
    deleteList(activeWatchlist);
    setWatchlistError(null);
  };

  const compareTickers = neededTickers;
  const activeHistoryIssues = neededTickers
    .map((ticker) => ({ ticker, issue: historyIssues[`${ticker}|${range}`] }))
    .filter(({ issue }) => issue);
  const failedHistoryTickers = activeHistoryIssues
    .filter(({ issue }) => issue === 'error')
    .map(({ ticker }) => ticker);
  const emptyHistoryTickers = activeHistoryIssues
    .filter(({ issue }) => issue === 'empty')
    .map(({ ticker }) => ticker);
  const retryHistory = () => setHistoryRetryNonce((value) => value + 1);
  const chartKey = compare
    ? `cmp:${range}:${compareTickers.join(',')}`
    : `one:${range}:${sel?.ticker}`;

  // Currency-aware price formatter for any commodity row.
  const fmt = (c) => formatAssetPrice(c);
  const fmtTablePrice = (c) => formatAssetPrice(resolveTablePrice(c));
  const refreshBusy = Boolean(pricesLoading || newsLoading);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header + toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-br from-gray-50 to-gray-300 bg-clip-text text-transparent">
            Prices
          </h2>
          <div className="text-xs sm:text-sm text-gray-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="hidden sm:inline">{commodities.length} assets · displayed in {dashboardCurrency}</span>
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-gray-900/70 border border-gray-800 rounded-md p-1">
            {['table', 'heatmap'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-2.5 py-1 text-[11px] uppercase tracking-wider rounded transition-colors
                  ${view === v ? 'bg-gray-100 text-gray-950' : 'text-gray-300 hover:text-white'}`}
              >{v}</button>
            ))}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshBusy}
            aria-busy={refreshBusy}
            aria-label={refreshBusy ? 'Refreshing prices and news' : 'Refresh prices and news'}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            <span className="hidden sm:inline">{refreshBusy ? 'Refreshing…' : 'Refresh'}</span>
            <span className="sm:hidden">{refreshBusy ? '…' : '↻'}</span>
          </button>
          <button onClick={() => setCompare((v) => !v)} aria-pressed={compare}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border transition-colors
              ${compare ? 'bg-cyan-500 border-cyan-400 text-gray-950' : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white'}`}
          >{compare ? 'Comparing' : 'Compare'}</button>
          <button onClick={exportCsv}
            disabled={exportRows.length === 0}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
            <span className="hidden sm:inline">Export CSV</span><span className="sm:hidden">CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white"
            title="Print / Save as PDF"
          >
            <span className="hidden sm:inline">Print / PDF</span><span className="sm:hidden">PDF</span>
          </button>
        </div>
      </div>

      {/* Search bar with keyboard hint */}
      <div className="relative">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3-3" />
        </svg>
        <input
          ref={searchRef}
          type="search"
          aria-label="Search Prices"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by ticker or name (e.g. NVDA, Apple, Bitcoin)…"
          className="w-full bg-gray-900/70 border border-gray-800 text-sm text-gray-100 rounded-md pl-9 pr-20 py-2.5 focus:outline-none focus:border-cyan-500 placeholder:text-gray-500"
        />
        <kbd className="hidden sm:inline absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 font-mono px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900">
          {query ? 'esc' : '/'}
        </kbd>
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 sm:hidden text-gray-500 hover:text-gray-200 text-sm"
            aria-label="Clear price search"
          >×</button>
        )}
      </div>

      {/* Filter pills: primary always visible, then grouped sector pills.
          All hidden while searching. */}
      {!query.trim() && (
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 sm:mx-0 px-4 sm:px-0 pb-1 sm:flex-wrap">
            {PRIMARY_CATS.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                aria-pressed={cat === c}
                className={`shrink-0 px-3 py-1.5 text-xs uppercase tracking-wider rounded-md border transition-all
                  ${cat === c
                    ? 'bg-gradient-to-b from-cyan-300 to-cyan-500 text-gray-950 border-cyan-200 shadow'
                    : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-900'}`}
              >
                {c === 'WATCHLIST' ? `★ Watchlist (${watchlist.size})` : c === 'TRENDING' ? '🔥 Trending' : c}
              </button>
            ))}
          </div>
          {CATEGORY_GROUPS.map((g) => (
            <div key={g.label} className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-4 sm:mx-0 px-4 sm:px-0 pb-1 sm:flex-wrap">
              <span className="shrink-0 text-[10px] uppercase tracking-widest text-gray-500 w-20">{g.label}</span>
              {g.cats.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  aria-pressed={cat === c}
                  className={`shrink-0 px-2.5 py-1 text-[11px] uppercase tracking-wider rounded-md border transition-all
                    ${cat === c
                      ? 'bg-gradient-to-b from-gray-50 to-gray-200 text-gray-950 border-gray-100 shadow-sm'
                      : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-900'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Saved layout presets */}
      {(presets.length > 0 || true) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-gray-500">Layouts</span>
          {presets.map((p, i) => (
            <div key={i} className="flex items-center group">
              <button
                onClick={() => { setCat(p.cat); setView(p.view); }}
                className="px-2.5 py-1 text-[11px] uppercase tracking-wider rounded-l-md border border-gray-700 bg-gray-900/70 text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
              >
                {p.name}
              </button>
              <button
                onClick={() => deletePreset(i)}
                aria-label={`Delete ${p.name} layout`}
                className="px-1.5 py-1 text-[11px] rounded-r-md border border-l-0 border-gray-700 bg-gray-900/70 text-gray-600 hover:text-red-400 hover:border-gray-500 transition-colors"
                title="Delete preset"
              >×</button>
            </div>
          ))}
          <button
            onClick={savePreset}
            className="px-2.5 py-1 text-[11px] uppercase tracking-wider rounded-md border border-dashed border-gray-700 text-gray-400 hover:text-cyan-300 hover:border-cyan-700 transition-colors"
            title="Save current filter+view as layout"
          >+ save layout</button>
        </div>
      )}

      {/* Watchlist switcher (only visible when WATCHLIST filter is active) */}
      {cat === 'WATCHLIST' && !query.trim() && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
          <span className="text-[10px] uppercase tracking-widest text-gray-500">Lists</span>
          {watchlistNames.map((n) => (
            <button
              key={n}
              onClick={() => setActiveList(n)}
              aria-pressed={activeWatchlist === n}
              className={`px-2.5 py-1 text-[11px] uppercase tracking-wider rounded-md border transition-colors
                ${activeWatchlist === n
                  ? 'bg-yellow-400/20 border-yellow-400/60 text-yellow-200'
                  : 'bg-gray-900/70 border-gray-800 text-gray-300 hover:border-gray-600'}`}
            >★ {n}</button>
          ))}
          <div role="group" aria-label={`Manage ${activeWatchlist} watchlist`} className="flex items-center gap-1">
            <button
              type="button"
              onClick={renameActiveWatchlist}
              aria-label={`Rename ${activeWatchlist} watchlist`}
              className="rounded border border-gray-700 px-2 py-1 text-[10px] uppercase tracking-wider text-gray-400 hover:border-gray-500 hover:text-white"
            >rename</button>
            <button
              type="button"
              onClick={deleteActiveWatchlist}
              disabled={watchlistNames.length <= 1}
              aria-label={`Delete ${activeWatchlist} watchlist`}
              title={watchlistNames.length <= 1 ? 'Keep at least one watchlist' : `Delete ${activeWatchlist}`}
              className="rounded border border-red-800/50 px-2 py-1 text-[10px] uppercase tracking-wider text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >delete</button>
          </div>
          <button
            onClick={() => {
              const name = window.prompt('New watchlist name:');
              if (name) createList(name);
            }}
            className="ml-auto px-2.5 py-1 text-[11px] uppercase tracking-wider rounded-md border border-dashed border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
          >+ new list</button>
          {watchlistError && (
            <div role="alert" aria-label="Watchlist error" className="w-full text-[11px] text-amber-300">{watchlistError}</div>
          )}
        </div>
      )}

      {/* Two-column layout: chart sticky on right (lg+), list on left.
          On mobile/tablet the chart appears first so it's always visible. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-6">
        <div className="lg:col-span-7 lg:order-2 lg:sticky lg:top-28 lg:self-start space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                {compare ? (
                  <>
                    <div className="text-xs uppercase tracking-widest text-gray-500">Comparing {compareTickers.length} symbols</div>
                    <div className="text-lg sm:text-xl font-semibold text-gray-100">Multi-series overlay</div>
                  </>
                ) : sel ? (
                  <>
                    <div className="text-xs uppercase tracking-widest text-gray-500">{sel.ticker} • {sel.unit} • {sel.category}</div>
                    <div className="text-lg sm:text-xl font-semibold text-gray-100">{sel.name}</div>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {!compare && sel && (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end">
                      <div className="font-mono text-xl sm:text-2xl text-gray-100">{fmt(sel)}</div>
                      <div className={`font-mono text-[11px] ${sel.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtPctChange(sel.changePct)}
                      </div>
                    </div>
                    <AlertButton asset={sel} />
                    <button
                      onClick={async () => {
                        const url = `${location.origin}${location.pathname}?tab=Prices&t=${encodeURIComponent(sel.ticker)}`;
                        setShareErrorUrl(null);
                        try {
                          await navigator.clipboard.writeText(url);
                          setShareCopied(true);
                          setTimeout(() => setShareCopied(false), 1500);
                        } catch {
                          setShareCopied(false);
                          setShareErrorUrl(url);
                        }
                      }}
                      className="text-base leading-none text-gray-600 hover:text-cyan-300"
                      title="Copy share link"
                      aria-label={shareCopied ? `Share link for ${sel.ticker} copied` : `Share ${sel.ticker}`}
                    >{shareCopied ? '✓' : '🔗'}</button>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {RANGES.map((r) => (
                    <button key={r} onClick={() => setRange(r)}
                      aria-pressed={range === r}
                      className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded transition-colors
                        ${range === r ? 'bg-gray-100 text-gray-950' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                    >{r}</button>
                  ))}
                  {!compare && (
                    <button
                      onClick={() => setShowRsi((v) => !v)}
                      aria-pressed={showRsi}
                      className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded transition-colors
                        ${showRsi ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50' : 'bg-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-700'}`}
                      title="Toggle RSI indicator"
                    >RSI</button>
                  )}
                </div>
              </div>
            </div>
            {shareErrorUrl && (
              <div role="status" aria-label="Share link status" className="mb-4 rounded-md border border-amber-800/50 bg-amber-950/20 p-2 text-[10px] text-amber-200">
                <span>Unable to copy automatically. Select this link:</span>
                <input
                  type="text"
                  readOnly
                  aria-label="Share link"
                  value={shareErrorUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="mt-1 block w-full rounded border border-amber-800/40 bg-gray-950 px-2 py-1 font-mono text-gray-200"
                />
              </div>
            )}
            {shareCopied && (
              <div role="status" aria-label="Share link status" className="sr-only">Share link copied.</div>
            )}
            {activeHistoryIssues.length > 0 && (
              <div
                role={failedHistoryTickers.length ? 'alert' : 'status'}
                aria-label={failedHistoryTickers.length ? 'Price history unavailable' : 'Price history empty'}
                className={`mb-4 flex items-center justify-between gap-3 rounded-md border p-2 text-[11px]
                  ${failedHistoryTickers.length
                    ? 'border-red-800/50 bg-red-950/20 text-red-200'
                    : 'border-amber-800/50 bg-amber-950/20 text-amber-200'}`}
              >
                <span>
                  {failedHistoryTickers.length > 0
                    ? `Price history is unavailable for ${failedHistoryTickers.join(', ')}.`
                    : `No price history was returned for ${emptyHistoryTickers.join(', ')}.`}
                </span>
                <button
                  type="button"
                  onClick={retryHistory}
                  disabled={chartLoading}
                  aria-label="Retry price history"
                  className="shrink-0 rounded border border-current/40 px-2 py-1 uppercase tracking-wider hover:bg-white/5 disabled:cursor-wait disabled:opacity-50"
                >Retry</button>
              </div>
            )}
            <div className="h-64 sm:h-72 relative">
              {chartLoading && chartData.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                  Loading {range} history…
                </div>
              )}
              {chartData.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart key={chartKey} data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }} minTickGap={20} />
                    <YAxis stroke="#6b7280" domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: '#9ca3af' }} itemStyle={{ color: '#e5e7eb' }} />
                    {compare && <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />}
                    {compare ? (
                      compareTickers.map((t, i) => (
                        <Line key={t} type="monotone" dataKey={t}
                          stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]} strokeWidth={2} dot={false} />
                      ))
                    ) : (
                      <Line type="monotone" dataKey="price" stroke="#22d3ee" strokeWidth={2} dot={false} />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {!compare && showRsi && rsiData.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-gray-500">RSI · 14</div>
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  <span className="text-red-400">70 overbought</span>
                  <span className="text-emerald-400">30 oversold</span>
                  <span className="text-purple-300">{rsiData[rsiData.length - 1]?.rsi ?? '—'}</span>
                </div>
              </div>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rsiData} margin={{ top: 2, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 10 }} minTickGap={30} />
                    <YAxis stroke="#6b7280" domain={[0, 100]} ticks={[0, 30, 50, 70, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 11 }}
                      labelStyle={{ color: '#9ca3af' }} itemStyle={{ color: '#c4b5fd' }} />
                    <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 3" />
                    <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 3" />
                    <ReferenceLine y={50} stroke="#374151" />
                    <Line type="monotone" dataKey="rsi" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {!compare && <DetailPanel c={sel} formatAssetPrice={formatAssetPrice} />}
          {!compare && sel && <AnalysisPanel asset={sel} />}
        </div>

        {/* Left column: list */}
        <div className="lg:col-span-5 lg:order-1 mt-4 lg:mt-0">
          {view === 'table' ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest text-gray-500">
                  {filtered.length} {filtered.length === 1 ? 'asset' : 'assets'}
                  {query.trim() && <span className="text-cyan-400 normal-case"> · "{query}"</span>}
                </div>
                {compare && (
                  <div className="text-[10px] text-gray-500" aria-live="polite">
                    {compareSet.size >= 5 ? 'Maximum 5 symbols · ' : ''}{compareTickers.length}/5 selected
                  </div>
                )}
              </div>
              <div className="divide-y divide-gray-800 max-h-[80vh] lg:max-h-[calc(100vh-12rem)] overflow-y-auto">
                {filtered.length === 0 && (
                  <div className="p-6 text-center text-sm text-gray-500">
                    {query.trim() ? `No matches for "${query}".` :
                     cat === 'WATCHLIST' ? 'Watchlist is empty — tap ★ to add.' : 'No items.'}
                  </div>
                )}
                {filtered.map((c) => {
                  const display = resolveTablePrice(c);
                  const hasSessionChange = Number.isFinite(display.changePct);
                  const up = hasSessionChange ? display.changePct >= 0 : null;
                  const isSel = c.ticker === selected;
                  const watched = watchlist.has(c.ticker);
                  const inCompare = compareSet.has(c.ticker);
                  return (
                    <div
                      key={c.ticker}
                      role="group"
                      aria-label={`${c.ticker} asset controls`}
                      className={`flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 transition-colors
                        ${isSel ? 'bg-gray-800/60' : 'hover:bg-gray-800/30'}`}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleWatch(c.ticker); }}
                        className={`text-base leading-none ${watched ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-300'}`}
                        aria-label={`${watched ? 'Remove' : 'Add'} ${c.ticker} ${watched ? 'from' : 'to'} watchlist`}
                      >★</button>
                      <span onClick={(e) => e.stopPropagation()}>
                        <AlertButton asset={c} compact />
                      </span>
                      {compare && (
                        <input
                          type="checkbox"
                          checked={inCompare}
                          disabled={!inCompare && compareSet.size >= 5}
                          aria-label={`Compare ${c.ticker}`}
                          title={!inCompare && compareSet.size >= 5 ? 'Maximum 5 symbols selected' : `Compare ${c.ticker}`}
                          onChange={() => toggleCompare(c.ticker)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-cyan-400"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => selectTicker(c.ticker)}
                          aria-pressed={isSel}
                          aria-label={`Select ${c.ticker} — ${c.name}`}
                          className="block w-full rounded text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-sm text-gray-100">{c.ticker}</span>
                            <span className={`text-[9px] uppercase tracking-wider ${assetCategoryColor(c.category)}`}>
                              {c.category}
                            </span>
                            {notes[c.ticker] && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title={notes[c.ticker]} />
                            )}
                          </span>
                          {editingNote !== c.ticker && (
                            <span className="block text-[10px] text-gray-500 truncate">{notes[c.ticker] || c.name}</span>
                          )}
                        </button>
                        {editingNote === c.ticker && (
                          <input
                            autoFocus
                            type="text"
                            aria-label={`Note for ${c.ticker}`}
                            defaultValue={notes[c.ticker] || ''}
                            placeholder="Add note… (Enter to save)"
                            className="text-[10px] bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-gray-100 focus:outline-none focus:border-cyan-500 w-full mt-0.5"
                            onBlur={(e) => { setNote(c.ticker, e.target.value); setEditingNote(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { setNote(c.ticker, e.target.value); setEditingNote(null); }
                              if (e.key === 'Escape') setEditingNote(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingNote(editingNote === c.ticker ? null : c.ticker); }}
                        className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${notes[c.ticker] ? 'text-amber-400 hover:bg-amber-400/10' : 'text-gray-600 hover:text-gray-300 hover:bg-gray-700/50'}`}
                        title={notes[c.ticker] ? 'Edit note' : 'Add note'}
                        aria-label={`${notes[c.ticker] ? 'Edit' : 'Add'} note for ${c.ticker}`}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <Sparkline
                        data={c.history.map((h) => h.price)}
                        color={up === null ? '#9ca3af' : up ? '#22c55e' : '#ef4444'}
                        width={60} height={20}
                      />
                      <div className="text-right w-24">
                        <div className="font-mono text-xs text-gray-100">{fmtTablePrice(c)}</div>
                        <div
                          aria-label={`${c.ticker} session change`}
                          className={`font-mono text-[10px] ${up === null ? 'text-gray-400' : up ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {fmtPctChange(display.changePct)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <Heatmap
              items={filtered}
              selectedTicker={selected}
              onSelect={selectTicker}
              fmt={fmt}
              resolveHeatmapAsset={resolveHeatmapAsset}
            />
          )}
        </div>
      </div>

      {!compare && sel && <AssetNews asset={sel} />}
    </div>
  );
}
