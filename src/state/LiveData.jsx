import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  commodities as fallbackCommodities,
  intel as fallbackIntel,
} from '../data/mockData.js';
import { CURRENCY_META, CURRENCY_NO_DECIMAL } from '../../lib/symbols.js';

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

  const fetchPrices = useCallback(async () => {
    try {
      setPricesLoading(true);
      const r = await fetch('/api/prices', { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();
      if (j?.ok && Array.isArray(j.commodities) && j.commodities.length) {
        const liveByTicker = Object.fromEntries(j.commodities.map((c) => [c.ticker, c]));
        const merged = fallbackCommodities.map((m) =>
          liveByTicker[m.ticker] ? { ...m, ...liveByTicker[m.ticker] } : m
        );
        setCommodities(merged);
        setPricesUpdatedAt(j.fetchedAt);
        setPricesLive(true);
      }
    } catch {
      /* keep last good state */
    } finally {
      setPricesLoading(false);
    }
  }, []);

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
    return () => { clearInterval(a); clearInterval(b); };
  }, [fetchPrices, fetchNews]);

  const refresh = useCallback(() => {
    fetchPrices();
    fetchNews();
  }, [fetchPrices, fetchNews]);

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

  // ----- Currency conversion -----
  // Build a fast {pair: rate} index from FX rows.
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
    // Cross via USD
    const fromUsd = from === 'USD' ? 1 : fxIndex[`${from}->USD`];
    const toUsd = to === 'USD' ? 1 : fxIndex[`USD->${to}`];
    if (fromUsd && toUsd) return fromUsd * toUsd;
    return null;
  }, [fxIndex]);

  // Determine whether an asset's price is convertible by display ccy.
  // Stocks/crypto/futures priced in $ → convert. Macro indices/yields,
  // agri (¢/bu), and FX rates themselves don't convert.
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

  // Currency-aware price formatter for an asset row.
  // Returns the displayable string with appropriate symbol prefix.
  const formatAssetPrice = useCallback((asset, raw = null) => {
    const value = raw != null ? raw : asset?.price;
    if (value == null || !isFinite(value)) return '—';
    if (!convertible(asset)) {
      // Show in original unit (no ccy prefix); just numeric formatting.
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

  // List of currencies the user can pick as the dashboard currency.
  // Anything we have a USD pair (direct or inverse) for.
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

  const value = {
    commodities,
    intel,
    notifications,
    pricesLive,
    newsLive,
    pricesUpdatedAt,
    newsUpdatedAt,
    pricesLoading,
    newsLoading,
    refresh,
    // currency switching
    dashboardCurrency,
    setDashboardCurrency,
    availableCurrencies,
    getRate,
    convert,
    convertible,
    formatAssetPrice,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
