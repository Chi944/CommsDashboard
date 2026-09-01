// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let LiveDataProvider;
let useLiveData;
let fallbackCommodities;
const originalFetch = globalThis.fetch;

const response = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
});

const freshIso = () => new Date().toISOString();

function yahooPayload(price = 82) {
  const asOf = freshIso();
  const commodities = fallbackCommodities.map((row) => ({
    ticker: row.ticker,
    price: row.ticker === 'CL' ? price : row.price,
    changePct: row.changePct,
    changeAbs: row.changeAbs,
    source: 'yahoo',
    asOf,
    stale: false,
  }));
  return {
    ok: true,
    fetchedAt: asOf,
    partial: false,
    counts: { received: commodities.length, stale: 0 },
    commodities,
  };
}

function v2Payload(price = 77) {
  const asOf = freshIso();
  return {
    ok: true,
    fetchedAt: asOf,
    partial: false,
    staleProviders: [],
    commodities: [{
      ticker: 'NG',
      price,
      changePct: 1,
      changeAbs: 1,
      source: 'eia',
      asOf,
      stale: false,
    }],
    marketVolumes: {},
  };
}

function degradedV2Payload() {
  const asOf = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    ok: true,
    fetchedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    partial: true,
    staleProviders: ['alphavantage'],
    commodities: [{
      ticker: 'CL',
      price: 74,
      changePct: -1,
      changeAbs: -1,
      source: 'alphavantage',
      asOf,
      stale: true,
    }],
    marketVolumes: {},
  };
}

function newsPayload({ publishedAt = Date.now() - 60 * 60 * 1000, isFresh = true } = {}) {
  const iso = new Date(publishedAt).toISOString();
  return {
    ok: true,
    fetchedAt: freshIso(),
    freshness: {
      isFresh,
      maxAgeHours: 168,
      ageMs: Math.max(0, Date.now() - publishedAt),
      newestPublishedAt: iso,
      oldestPublishedAt: iso,
    },
    items: [{
      id: 'news-1', category: 'Finance', source: 'Example Wire',
      time: '1 hr ago', headline: 'Fresh market headline', desc: 'Market details',
      url: 'https://publisher.example/story', ts: publishedAt,
    }],
  };
}

function MarketState() {
  const data = useLiveData();
  const crude = data.commodities.find((row) => row.ticker === 'CL');
  const naturalGas = data.commodities.find((row) => row.ticker === 'NG');
  const resolvedCrude = data.resolveTablePrice(crude);
  const resolvedNaturalGas = data.resolveTablePrice(naturalGas);
  return (
    <>
      <output aria-label="market mode">{data.dataMode}</output>
      <output aria-label="crude price">{resolvedCrude?.price}</output>
      <output aria-label="natural gas price">{resolvedNaturalGas?.price}</output>
      <output aria-label="market updated">{data.marketUpdatedLabel}</output>
      <button type="button" onClick={data.refreshMarketSnapshot}>Refresh market</button>
    </>
  );
}

function NewsState() {
  const data = useLiveData();
  return (
    <>
      <output aria-label="news live">{String(data.newsLive)}</output>
      <output aria-label="news headline">{data.intel[0]?.headline}</output>
      <button type="button" onClick={data.refresh}>Refresh all</button>
    </>
  );
}

function WatchlistState() {
  const data = useLiveData();
  return (
    <>
      <output aria-label="watchlist names">{data.watchlistNames.join('|')}</output>
      <output aria-label="active watchlist">{data.activeWatchlist}</output>
      <button type="button" onClick={() => data.renameList('Default', 'Macro')}>Rename into existing</button>
      <button type="button" onClick={() => data.deleteList(data.activeWatchlist)}>Delete active</button>
    </>
  );
}

beforeAll(async () => {
  vi.stubEnv('VITE_USE_LIVE_DATA', 'true');
  ({ LiveDataProvider, useLiveData } = await import('../src/state/LiveData.jsx'));
  ({ commodities: fallbackCommodities } = await import('../src/data/mockData.js'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('LiveData market fetch isolation', () => {
  it('reports LIVE when a complete fresh Yahoo feed covers a degraded supplemental quote', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload(82));
      if (url === '/api/market/snapshot') return response(degradedV2Payload());
      return response({ ok: true, items: [] });
    });

    render(<LiveDataProvider><MarketState /></LiveDataProvider>);

    await waitFor(() => expect(screen.getByRole('status', { name: /market mode/i })).toHaveTextContent('LIVE'));
    expect(screen.getByRole('status', { name: /crude price/i })).toHaveTextContent('82');
    expect(screen.getByRole('status', { name: /market updated/i })).toHaveTextContent(/updated [0-9]s ago/i);
  });

  it('keeps the healthy EIA natural-gas row without replacing Yahoo-authoritative oil when Yahoo fails', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (url === '/api/prices') return response({}, { ok: false, status: 503 });
      if (url === '/api/market/snapshot') return response(v2Payload(77));
      return response({ ok: false, items: [] });
    });

    render(<LiveDataProvider><MarketState /></LiveDataProvider>);

    await waitFor(() => expect(calls).toContain('/api/market/snapshot'));
    expect(screen.getByRole('status', { name: /market mode/i })).toHaveTextContent('DEGRADED');
    expect(screen.getByRole('status', { name: /crude price/i })).toHaveTextContent('80');
    expect(screen.getByRole('status', { name: /natural gas price/i })).toHaveTextContent('77');
  });

  it('manual refresh attempts both feeds and records a Yahoo-only failure', async () => {
    const user = userEvent.setup();
    let manual = false;
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (url === '/api/prices') {
        return manual
          ? response({}, { ok: false, status: 503 })
          : response(yahooPayload());
      }
      if (url === '/api/market/snapshot') return response(v2Payload(manual ? 78 : 77));
      return response({ ok: false, items: [] });
    });

    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByRole('status', { name: /market mode/i })).toHaveTextContent('LIVE'));
    manual = true;

    await user.click(screen.getByRole('button', { name: /refresh market/i }));

    await waitFor(() => expect(calls.filter((url) => url === '/api/prices')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('status', { name: /market mode/i })).toHaveTextContent('DEGRADED'));
    expect(calls.filter((url) => url === '/api/market/snapshot')).toHaveLength(2);
    expect(screen.getByRole('status', { name: /crude price/i })).toHaveTextContent('82');
    expect(screen.getByRole('status', { name: /natural gas price/i })).toHaveTextContent('78');
  });

  it('manual refresh stays LIVE when a V2-only failure is covered by fresh Yahoo rows', async () => {
    const user = userEvent.setup();
    let manual = false;
    const calls = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (url === '/api/prices') return response(yahooPayload(manual ? 84 : 82));
      if (url === '/api/market/snapshot') {
        return manual
          ? response({}, { ok: false, status: 503 })
          : response(v2Payload(77));
      }
      return response({ ok: false, items: [] });
    });

    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByRole('status', { name: /market mode/i })).toHaveTextContent('LIVE'));
    manual = true;

    await user.click(screen.getByRole('button', { name: /refresh market/i }));

    await waitFor(() => expect(calls.filter((url) => url === '/api/prices')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('status', { name: /market mode/i })).toHaveTextContent('LIVE'));
    expect(calls.filter((url) => url === '/api/market/snapshot')).toHaveLength(2);
  });

  it('coalesces rapid market refresh activations into one in-flight request set', async () => {
    let manual = false;
    const calls = [];
    const releases = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (!manual) {
        if (url === '/api/prices') return response(yahooPayload());
        if (url === '/api/market/snapshot') return response(v2Payload());
        return response(newsPayload());
      }
      return new Promise((resolve) => releases.push(() => resolve(
        url === '/api/prices' ? response(yahooPayload(83)) : response(v2Payload(78)),
      )));
    });

    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByRole('status', { name: /market mode/i })).toHaveTextContent('LIVE'));
    manual = true;

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /refresh market/i }));
      fireEvent.click(screen.getByRole('button', { name: /refresh market/i }));
    });

    try {
      expect(calls.filter((url) => url === '/api/prices')).toHaveLength(2);
      expect(calls.filter((url) => url === '/api/market/snapshot')).toHaveLength(2);
    } finally {
      await act(async () => releases.splice(0).forEach((release) => release()));
    }
  });
});

describe('LiveData watchlist lifecycle', () => {
  it('rejects a duplicate rename and never deletes the last remaining watchlist', async () => {
    const user = userEvent.setup();
    localStorage.setItem('comms.watchlists.v1', JSON.stringify({
      active: 'Default',
      lists: { Default: ['NVDA'], Macro: ['AAPL'] },
    }));
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload());
      if (url === '/api/market/snapshot') return response(v2Payload());
      if (url === '/api/news') return response(newsPayload());
      throw new Error(`unexpected request ${url}`);
    });

    const { unmount } = render(<LiveDataProvider><WatchlistState /></LiveDataProvider>);
    await user.click(screen.getByRole('button', { name: /rename into existing/i }));
    expect(screen.getByLabelText('watchlist names')).toHaveTextContent('Default|Macro');
    expect(screen.getByLabelText('active watchlist')).toHaveTextContent('Default');
    unmount();

    localStorage.setItem('comms.watchlists.v1', JSON.stringify({
      active: 'Default',
      lists: { Default: ['NVDA'] },
    }));
    render(<LiveDataProvider><WatchlistState /></LiveDataProvider>);
    await user.click(screen.getByRole('button', { name: /delete active/i }));
    expect(screen.getByLabelText('watchlist names')).toHaveTextContent('Default');
    expect(screen.getByLabelText('active watchlist')).toHaveTextContent('Default');
  });
});

describe('LiveData news freshness', () => {
  it('clears LIVE after a failed refresh while retaining the last good headline', async () => {
    const user = userEvent.setup();
    let manual = false;
    const newsCalls = [];
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload());
      if (url === '/api/market/snapshot') return response(v2Payload());
      if (url === '/api/news') {
        newsCalls.push(url);
        return manual
          ? response({}, { ok: false, status: 502 })
          : response(newsPayload());
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<LiveDataProvider><NewsState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByRole('status', { name: /news live/i })).toHaveTextContent('true'));
    manual = true;

    await user.click(screen.getByRole('button', { name: /refresh all/i }));

    await waitFor(() => expect(newsCalls).toHaveLength(2));
    expect(screen.getByRole('status', { name: /news live/i })).toHaveTextContent('false');
    expect(screen.getByRole('status', { name: /news headline/i })).toHaveTextContent('Fresh market headline');
  });

  it('does not mark a freshly fetched payload LIVE when its newest article is expired', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload());
      if (url === '/api/market/snapshot') return response(v2Payload());
      if (url === '/api/news') {
        return response(newsPayload({
          publishedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
          isFresh: false,
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<LiveDataProvider><NewsState /></LiveDataProvider>);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/news', { cache: 'no-store' }));
    expect(screen.getByRole('status', { name: /news live/i })).toHaveTextContent('false');
  });

  it('coalesces rapid page refresh activations into one price and news request set', async () => {
    let manual = false;
    const calls = [];
    const releases = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (!manual) {
        if (url === '/api/prices') return response(yahooPayload());
        if (url === '/api/market/snapshot') return response(v2Payload());
        if (url === '/api/news') return response(newsPayload());
      }
      return new Promise((resolve) => releases.push(() => resolve(
        url === '/api/prices'
          ? response(yahooPayload(83))
          : url === '/api/market/snapshot'
            ? response(v2Payload(78))
            : response(newsPayload()),
      )));
    });

    render(<LiveDataProvider><NewsState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByRole('status', { name: /news live/i })).toHaveTextContent('true'));
    manual = true;

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /refresh all/i }));
      fireEvent.click(screen.getByRole('button', { name: /refresh all/i }));
    });

    try {
      expect(calls.filter((url) => url === '/api/prices')).toHaveLength(2);
      expect(calls.filter((url) => url === '/api/market/snapshot')).toHaveLength(2);
      expect(calls.filter((url) => url === '/api/news')).toHaveLength(2);
    } finally {
      await act(async () => releases.splice(0).forEach((release) => release()));
    }
  });

  it('expires LIVE when the newest article crosses the seven-day boundary', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-28T12:00:00.000Z');
    vi.setSystemTime(now);
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload());
      if (url === '/api/market/snapshot') return response(v2Payload());
      if (url === '/api/news') {
        return response(newsPayload({
          publishedAt: now - 7 * 24 * 60 * 60 * 1000 + 1_000,
          isFresh: true,
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    try {
      render(<LiveDataProvider><NewsState /></LiveDataProvider>);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole('status', { name: /news live/i })).toHaveTextContent('true');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(screen.getByRole('status', { name: /news live/i })).toHaveTextContent('false');
    } finally {
      vi.useRealTimers();
    }
  });
});
