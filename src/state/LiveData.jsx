import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  commodities as fallbackCommodities,
  intel as fallbackIntel,
} from '../data/mockData.js';
import { CURRENCY_META, CURRENCY_NO_DECIMAL } from '../../lib/symbols.js';
import { useLocalStorage } from '../utils/useLocalStorage.js';
import {
  dataModeFromState,
  secondsAgo,
  resolveHeatmapAsset,
  resolveTablePrice,
  resolveTickerAsset,
} from '../lib/marketDisplay.js';

const USE_MARKET_V2 = import.meta.env.VITE_USE_LIVE_DATA === 'true';
const YAHOO_PRICES_URL = '/api/prices';
const MARKET_V2_URL = '/api/market/snapshot';
const PRICE_INTERVAL_MS = 60_000;
const NEWS_INTERVAL_MS = 5 * 60_000;
const CCY_KEY = 'comms.displayCurrency';

const SEVERITY_RULES = [
  { tier: 'CRITICAL', keywords: ['attack', 'missile', 'strike', 'explosion', 'sink', 'casualty', 'killed', 'fire', 'crash'] },
  { tier: 'HIGH',     keywords: ['seized', 'seizure', 'detained', 'intercept', 'drone', 'blockade', 'closure', 'closed', 'plunge'] },
  { tier: 'MODERATE', keywords: ['surge', 'congestion', 'delay', 'diversion', 'rerout', 'restriction', 'disrupt', 'rally', 'tumble', 'slump'] },
];

const classifySeverity = (text) => {
  const t = (text || '').toLowerCase();
  for (const rule of SEVERITY_RULES) {
    if (rule.keywords.some((k) => t.includes(k))) return rule.tier;
  }
  return 'LOW';
};

const Ctx = createContext(null);
export const useLiveData = () => useContext(Ctx);

export function LiveDataProvider({ children }) {
  const [commodities, setCommodities] = useState(fallbackCommodities);
  const [intel, setIntel] = useState(fallbackIntel);

  const [pricesLive, setPricesLive] = useState(false);
  const [v2ByTicker, setV2ByTicker] = useState({});
  const [marketVolumes, setMarketVolumes] = useState({});
  const [v2FetchedAt, setV2FetchedAt] = useState(null);
  const [v2StaleProviders, setV2StaleProviders] = useState([]);
  const [marketRefreshing, setMarketRefreshing] = useState(false);
  const [clockTick, setClockTick] = useState(0);
  const [newsLive, setNewsLive] = useState(false);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState(null);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState(null);
  const [pricesLoading, setPricesLoading] = useState(true);
  const [newsLoading, setNewsLoading] = useState(true);

  const [dashboardCurrency, _setDashboardCurrency] = useState(() => {
    try { return localStorage.getItem(CCY_KEY) || 'USD'; } catch { return 'USD'; }
  });
  const setDashboardCurrency = useCallback((c) => {
    _setDashboardCurrency(c);
    try { localStorage.setItem(CCY_KEY, c); } catch {}
  }, []);

  // ---------- Multi-watchlist ----------
  // Shape: { active: 'Default', lists: { Default: ['NVDA', ...], ... } }
  const [watchState, setWatchState] = useLocalStorage('comms.watchlists.v1', {
    active: 'Default',
    lists: { Default: [] },
  });

  const watchlistNames = Object.keys(watchState.lists);
  const activeList = watchState.lists[watchState.active] || [];
  const activeWatchSet = useMemo(() => new Set(activeList), [activeList]);

  const setActiveList = useCallback((name) => {
    setWatchState((p) => p.lists[name] ? { ...p, active: name } : p);
  }, [setWatchState]);

  const createList = useCallback((name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    setWatchState((p) => ({
      active: trimmed,
      lists: { ...p.lists, [trimmed]: p.lists[trimmed] || [] },
    }));
  }, [setWatchState]);

  const renameList = useCallback((oldName, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed || trimmed === oldName) return;
    setWatchState((p) => {
      if (!p.lists[oldName]) return p;
      const { [oldName]: items, ...rest } = p.lists;
      return {
        active: p.active === oldName ? trimmed : p.active,
        lists: { ...rest, [trimmed]: items },
      };
    });
  }, [setWatchState]);

  const deleteList = useCallback((name) => {
    setWatchState((p) => {
      if (Object.keys(p.lists).length <= 1) return p; // keep at least one
      const { [name]: _drop, ...rest } = p.lists;
      const nextActive = p.active === name ? Object.keys(rest)[0] : p.active;
      return { active: nextActive, lists: rest };
    });
  }, [setWatchState]);

  const toggleWatch = useCallback((ticker) => {
    setWatchState((p) => {
      const cur = new Set(p.lists[p.active] || []);
      cur.has(ticker) ? cur.delete(ticker) : cur.add(ticker);
      return { ...p, lists: { ...p.lists, [p.active]: [...cur] } };
    });
  }, [setWatchState]);

  // ---------- Price alerts ----------
  // [{ id, ticker, op: '>'|'<', price, name, enabled, lastTriggeredAt }]
  const [alerts, setAlerts] = useLocalStorage('comms.alerts.v1', []);
  const [triggeredAlerts, setTriggeredAlerts] = useLocalStorage('comms.alerts.triggered.v1', []);
  const lastPriceRef = useRef({});

  const addAlert = useCallback(({ ticker, op, price, name }) => {
    const id = `${ticker}-${op}-${price}-${Date.now()}`;
    setAlerts((p) => [...p, { id, ticker, op, price: Number(price), name, enabled: true, lastTriggeredAt: null }]);
  }, [setAlerts]);

  const removeAlert = useCallback((id) => {
    setAlerts((p) => p.filter((a) => a.id !== id));
  }, [setAlerts]);

  const toggleAlert = useCallback((id) => {
    setAlerts((p) => p.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a));
  }, [setAlerts]);

  const clearTriggered = useCallback(() => setTriggeredAlerts([]), [setTriggeredAlerts]);

  const requestNotificationPermission = useCallback(async () => {
    try {
      if (!('Notification' in window)) return 'unsupported';
      if (Notification.permission === 'granted') return 'granted';
      const r = await Notification.requestPermission();
      return r;
    } catch { return 'error'; }
  }, []);

  const applyYahooPrices = useCallback((j) => {
    if (!j?.ok || !Array.isArray(j.commodities) || !j.commodities.length) return null;
    const liveByTicker = Object.fromEntries(j.commodities.map((c) => [c.ticker, c]));
    const merged = fallbackCommodities.map((m) =>
      liveByTicker[m.ticker] ? { ...m, ...liveByTicker[m.ticker] } : m
    );
    setCommodities(merged);
    setPricesUpdatedAt(j.fetchedAt);
    setPricesLive(true);
    return merged;
  }, []);

  const runAlertEvaluation = useCallback((merged) => {
    const prev = lastPriceRef.current;
    const next = {};
    const newlyTriggered = [];
    for (const c of merged) next[c.ticker] = c.price;

    setAlerts((curAlerts) => {
      const updated = [];
      for (const a of curAlerts) {
        const cur = next[a.ticker];
        const was = prev[a.ticker];
        if (!a.enabled || cur == null) { updated.push(a); continue; }
        const crossed =
          (a.op === '>' && was != null && was < a.price && cur >= a.price) ||
          (a.op === '<' && was != null && was > a.price && cur <= a.price);
        if (crossed) {
          const ts = Date.now();
          newlyTriggered.push({
            id: `t-${a.id}-${ts}`,
            ticker: a.ticker,
            name: a.name,
            op: a.op,
            threshold: a.price,
            price: cur,
            ts,
          });
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(`${a.ticker} ${a.op} ${a.price}`, {
                body: `${a.name}: now ${cur}`,
                tag: `alert-${a.id}`,
              });
            } catch {}
          }
          updated.push({ ...a, lastTriggeredAt: ts });
        } else {
          updated.push(a);
        }
      }
      return updated;
    });

    if (newlyTriggered.length) {
      setTriggeredAlerts((p) => [...newlyTriggered, ...p].slice(0, 50));
    }
    lastPriceRef.current = next;
  }, [setAlerts, setTriggeredAlerts]);

  const fetchV2Snapshot = useCallback(async () => {
    const r = await fetch(MARKET_V2_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    const j = await r.json();
    if (!j?.ok) throw new Error('snapshot not ok');
    const rows = (j.commodities || []).filter((c) => c.source);
    setV2ByTicker(Object.fromEntries(rows.map((c) => [c.ticker, c])));
    setV2FetchedAt(j.fetchedAt);
    setV2StaleProviders(j.staleProviders || []);
    if (j.marketVolumes && typeof j.marketVolumes === 'object') {
      setMarketVolumes(j.marketVolumes);
    }
    return j;
  }, []);

  const fetchYahooPrices = useCallback(async () => {
    const r = await fetch(YAHOO_PRICES_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`yahoo ${r.status}`);
    const j = await r.json();
    const merged = applyYahooPrices(j);
    if (merged) runAlertEvaluation(merged);
    return j;
  }, [applyYahooPrices, runAlertEvaluation]);

  const fetchPrices = useCallback(async () => {
    try {
      setPricesLoading(true);
      if (USE_MARKET_V2) {
        await fetchYahooPrices();
        try {
          await fetchV2Snapshot();
        } catch {
          /* keep prior v2 snapshot */
        }
      } else {
        await fetchYahooPrices();
      }
    } catch {
      /* keep last good state */
    } finally {
      setPricesLoading(false);
    }
  }, [fetchYahooPrices, fetchV2Snapshot]);

  const refreshMarketSnapshot = useCallback(async () => {
    if (!USE_MARKET_V2) {
      await fetchYahooPrices();
      return;
    }
    try {
      setMarketRefreshing(true);
      await fetchV2Snapshot();
    } catch {
      /* keep prior v2 snapshot */
    } finally {
      setMarketRefreshing(false);
    }
  }, [fetchV2Snapshot, fetchYahooPrices]);

  const fetchNews = useCallback(async () => {
    try {
      setNewsLoading(true);
      const r = await fetch('/api/news', { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();
      if (j?.ok && Array.isArray(j.items) && j.items.length) {
        const items = j.items.map((it) => ({
          ...it,
          severity: classifySeverity(`${it.headline} ${it.desc}`),
        }));
        setIntel(items);
        setNewsUpdatedAt(j.fetchedAt);
        setNewsLive(true);
      }
    } catch {
      /* keep last good state */
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    fetchNews();
    const a = setInterval(fetchPrices, PRICE_INTERVAL_MS);
    const b = setInterval(fetchNews, NEWS_INTERVAL_MS);
    const c = setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [fetchPrices, fetchNews]);

  const refresh = useCallback(() => { fetchPrices(); fetchNews(); }, [fetchPrices, fetchNews]);

  const dataMode = useMemo(
    () => dataModeFromState({
      useV2: USE_MARKET_V2,
      fetchedAt: USE_MARKET_V2 ? v2FetchedAt : pricesUpdatedAt,
      loading: pricesLoading,
    }),
    [v2FetchedAt, pricesLoading, pricesUpdatedAt],
  );

  const marketUpdatedLabel = useMemo(() => {
    const iso = USE_MARKET_V2 ? v2FetchedAt : pricesUpdatedAt;
    const s = secondsAgo(iso);
    if (s == null) return null;
    return `updated ${s}s ago`;
  }, [v2FetchedAt, pricesUpdatedAt, clockTick]);

  const resolveTickerAssetFn = useCallback(
    (asset) => resolveTickerAsset(asset, v2ByTicker, USE_MARKET_V2),
    [v2ByTicker],
  );
  const resolveHeatmapAssetFn = useCallback(
    (asset) => resolveHeatmapAsset(asset, v2ByTicker, USE_MARKET_V2),
    [v2ByTicker],
  );
  const resolveTablePriceFn = useCallback(
    (asset) => resolveTablePrice(asset, v2ByTicker, USE_MARKET_V2),
    [v2ByTicker],
  );

  // ---------- Portfolio (positions) ----------
  // [{ ticker, qty, avgCost }]
  const [positions, setPositions] = useLocalStorage('comms.positions.v1', []);

  const upsertPosition = useCallback(({ ticker, qty, avgCost }) => {
    if (!ticker) return;
    setPositions((p) => {
      const existing = p.find((x) => x.ticker === ticker);
      if (existing) {
        return p.map((x) => x.ticker === ticker ? { ...x, qty: Number(qty), avgCost: Number(avgCost) } : x);
      }
      return [...p, { ticker, qty: Number(qty), avgCost: Number(avgCost) }];
    });
  }, [setPositions]);

  const removePosition = useCallback((ticker) => {
    setPositions((p) => p.filter((x) => x.ticker !== ticker));
  }, [setPositions]);

  // Notifications: latest non-LOW headlines, freshest first, capped to past 7 days.
  const notifications = useMemo(() => {
    if (!newsLive || intel.length === 0) return [];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return intel
      .filter((it) => it.severity !== 'LOW' && (it.ts || 0) >= cutoff)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 12)
      .map((it) => ({
        id: `live-${it.id}`,
        severity: it.severity,
        title: it.headline,
        body: it.desc || it.source || '',
        time: it.time,
        url: it.url,
        category: it.category,
      }));
  }, [intel, newsLive]);

  // ---------- Currency conversion ----------
  const fxIndex = useMemo(() => {
    const m = {};
    for (const c of commodities) {
      if (c.category === 'FX' && c.base && c.quote && c.price) {
        m[`${c.base}->${c.quote}`] = c.price;
        m[`${c.quote}->${c.base}`] = 1 / c.price;
      }
    }
    return m;
  }, [commodities]);

  const getRate = useCallback((from, to) => {
    if (from === to) return 1;
    if (fxIndex[`${from}->${to}`]) return fxIndex[`${from}->${to}`];
    const fromUsd = from === 'USD' ? 1 : fxIndex[`${from}->USD`];
    const toUsd = to === 'USD' ? 1 : fxIndex[`USD->${to}`];
    if (fromUsd && toUsd) return fromUsd * toUsd;
    return null;
  }, [fxIndex]);

  const convertible = useCallback((c) => {
    if (!c) return false;
    if (c.category === 'MACRO' || c.category === 'FX') return false;
    return typeof c.unit === 'string' && c.unit.startsWith('$');
  }, []);

  const convert = useCallback((amount, fromCcy = 'USD') => {
    if (amount == null || !isFinite(amount)) return amount;
    if (fromCcy === dashboardCurrency) return amount;
    const r = getRate(fromCcy, dashboardCurrency);
    return r != null ? amount * r : amount;
  }, [getRate, dashboardCurrency]);

  const formatAssetPrice = useCallback((asset, raw = null) => {
    const value = raw != null ? raw : asset?.price;
    if (value == null || !isFinite(value)) return '—';
    if (!convertible(asset)) {
      if (Math.abs(value) < 1) return value.toFixed(4);
      if (Math.abs(value) >= 1000) return value.toLocaleString();
      return value.toFixed(2);
    }
    const conv = convert(value, 'USD');
    const meta = CURRENCY_META[dashboardCurrency] || { sym: dashboardCurrency + ' ' };
    const noDec = CURRENCY_NO_DECIMAL.has(dashboardCurrency);
    const digits = noDec ? 0 : (Math.abs(conv) < 1 ? 4 : 2);
    const num = conv.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return `${meta.sym}${num}`;
  }, [convert, convertible, dashboardCurrency]);

  const availableCurrencies = useMemo(() => {
    const set = new Set(['USD']);
    for (const c of commodities) {
      if (c.category !== 'FX') continue;
      if (c.base) set.add(c.base);
      if (c.quote) set.add(c.quote);
    }
    return [...set]
      .filter((cc) => CURRENCY_META[cc])
      .sort((a, b) => (CURRENCY_META[a]?.name || a).localeCompare(CURRENCY_META[b]?.name || b));
  }, [commodities]);

  const activityScore = useCallback((c) => {
    if (!c) return 0;
    if (typeof c.volume === 'number' && c.volume > 0) return c.volume;
    const cgVol = marketVolumes?.[c.ticker];
    if (typeof cgVol === 'number' && cgVol > 0) return cgVol;
    return Math.abs(c.changePct || 0) * (c.price || 1);
  }, [marketVolumes]);

  const value = {
    commodities,
    intel,
    notifications,
    pricesLive,
    dataMode,
    marketUpdatedLabel,
    marketRefreshing,
    refreshMarketSnapshot,
    resolveTickerAsset: resolveTickerAssetFn,
    resolveHeatmapAsset: resolveHeatmapAssetFn,
    resolveTablePrice: resolveTablePriceFn,
    marketVolumes,
    activityScore,
    useMarketV2: USE_MARKET_V2,
    newsLive,
    pricesUpdatedAt,
    newsUpdatedAt,
    pricesLoading,
    newsLoading,
    refresh,
    // currency
    dashboardCurrency,
    setDashboardCurrency,
    availableCurrencies,
    getRate,
    convert,
    convertible,
    formatAssetPrice,
    // watchlists
    watchlistNames,
    activeWatchlist: watchState.active,
    activeWatchSet,
    setActiveList,
    createList,
    renameList,
    deleteList,
    toggleWatch,
    // alerts
    alerts,
    addAlert,
    removeAlert,
    toggleAlert,
    triggeredAlerts,
    clearTriggered,
    requestNotificationPermission,
    // portfolio
    positions,
    upsertPosition,
    removePosition,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
