import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { commodities as mockCommodities, intel as mockIntel } from '../data/mockData.js';

const PRICE_INTERVAL_MS = 60_000;
const NEWS_INTERVAL_MS = 5 * 60_000;

const Ctx = createContext(null);
export const useLiveData = () => useContext(Ctx);

export function LiveDataProvider({ children }) {
  const [commodities, setCommodities] = useState(mockCommodities);
  const [intel, setIntel] = useState(mockIntel);
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
        // Preserve mock ordering and metadata; overlay live numerics + history.
        const merged = mockCommodities.map((m) =>
          liveByTicker[m.ticker] ? { ...m, ...liveByTicker[m.ticker] } : m
        );
        setCommodities(merged);
        setPricesUpdatedAt(j.fetchedAt);
        setPricesLive(true);
      }
    } catch {
      // keep prior state, mock fallback already in place
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
        setIntel(j.items);
        setNewsUpdatedAt(j.fetchedAt);
        setNewsLive(true);
      }
    } catch {
      // keep mock intel
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

  return (
    <Ctx.Provider
      value={{
        commodities,
        intel,
        pricesLive,
        newsLive,
        pricesUpdatedAt,
        newsUpdatedAt,
        pricesLoading,
        newsLoading,
        refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
