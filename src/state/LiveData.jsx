import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  commodities as fallbackCommodities,
  intel as fallbackIntel,
} from '../data/mockData.js';

const PRICE_INTERVAL_MS = 60_000;
const NEWS_INTERVAL_MS = 5 * 60_000;

// News-headline severity classifier for the alerts drawer.
const SEVERITY_RULES = [
  { tier: 'CRITICAL', keywords: ['attack', 'missile', 'strike', 'explosion', 'sink', 'casualty', 'killed', 'fire', 'crash'] },
  { tier: 'HIGH',     keywords: ['seized', 'seizure', 'detained', 'intercept', 'drone', 'blockade', 'closure', 'closed', 'plunge', 'crash'] },
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

  const fetchPrices = useCallback(async () => {
    try {
      setPricesLoading(true);
      const r = await fetch('/api/prices', { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();
      if (j?.ok && Array.isArray(j.commodities) && j.commodities.length) {
        const liveByTicker = Object.fromEntries(j.commodities.map((c) => [c.ticker, c]));
        // Preserve fallback ordering and metadata; overlay live numerics + history.
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
        // Pre-classify severity once so every consumer (Intel filter,
        // notifications drawer, severity dot) reads from the same field.
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

  // Notifications: latest non-LOW headlines, freshest first, capped to
  // the past 7 days so we never surface stale ("60d ago") items as
  // active alerts.
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
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
