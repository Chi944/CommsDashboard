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
      <output aria-label="natural gas source">{resolvedNaturalGas?.source}</output>
      <output aria-label="natural gas stale">{String(resolvedNaturalGas?.stale)}</output>
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

function SavedState() {
  const data = useLiveData();
  return <>
    <output aria-label="saved holdings">{JSON.stringify(data.positions)}</output>
    <output aria-label="saved alerts">{JSON.stringify(data.alerts)}</output>
    <output aria-label="triggered count">{data.triggeredAlerts.length}</output>
    <output aria-label="saved currency">{data.dashboardCurrency}</output>
    <button onClick={data.refreshMarketSnapshot}>Refresh prices</button>
  </>;
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
  it('pauses hidden supplemental polling while Yahoo alerts continue, then resumes on visibility', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const intervals = new Map();
    vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
      intervals.set(delay, callback);
      return delay;
    });
    localStorage.setItem('comms.alerts.v1', JSON.stringify([
      { id: 'crude-high', ticker: 'CL', op: '>', price: 83, name: 'Crude', enabled: true },
    ]));
    let price = 82;
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload(price));
      if (url === '/api/market/snapshot') return response(v2Payload());
      return response(newsPayload());
    });
    const callsTo = (path) => globalThis.fetch.mock.calls.filter(([url]) => url === path).length;
    const { unmount } = render(<LiveDataProvider><MarketState /><SavedState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByLabelText('market mode')).toHaveTextContent('LIVE'));

    hidden.mockReturnValue(true);
    price = 84;
    await act(async () => intervals.get(60_000)());
    expect(callsTo('/api/prices')).toBe(2);
    expect(callsTo('/api/market/snapshot')).toBe(1);
    expect(screen.getByLabelText('triggered count')).toHaveTextContent('1');

    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(callsTo('/api/market/snapshot')).toBe(2);
    await act(async () => intervals.get(60_000)());
    expect(callsTo('/api/market/snapshot')).toBe(3);
    expect(callsTo('/api/prices')).toBe(3);

    unmount();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callsTo('/api/market/snapshot')).toBe(3);
  });

  it('allows a manual supplemental refresh when the page starts hidden', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload());
      if (url === '/api/market/snapshot') return response(v2Payload());
      return response(newsPayload());
    });
    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByLabelText('market mode')).toHaveTextContent('LIVE'));
    expect(globalThis.fetch.mock.calls.filter(([url]) => url === '/api/market/snapshot')).toHaveLength(0);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /refresh market/i })));
    expect(globalThis.fetch.mock.calls.filter(([url]) => url === '/api/market/snapshot')).toHaveLength(1);
    expect(screen.getByLabelText('natural gas price')).toHaveTextContent('77');
  });

  it('uses fresh Yahoo after a hidden snapshot expires and its visibility refresh fails', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const intervals = new Map();
    vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
      intervals.set(delay, callback);
      return delay;
    });
    let failSnapshot = false;
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') {
        const payload = yahooPayload();
        payload.fetchedAt = new Date(Date.now()).toISOString();
        payload.commodities = payload.commodities.map((row) => ({
          ...row, asOf: payload.fetchedAt, ...(row.ticker === 'NG' ? { price: 99 } : {}),
        }));
        return response(payload);
      }
      if (url === '/api/market/snapshot') {
        if (failSnapshot) throw new Error('snapshot unavailable');
        return response(v2Payload());
      }
      return response(newsPayload());
    });
    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByLabelText('natural gas price')).toHaveTextContent('77'));

    hidden.mockReturnValue(true);
    clock.mockReturnValue(Date.now() + 31 * 60_000);
    act(() => intervals.get(1000)());
    await act(async () => intervals.get(60_000)());
    expect(globalThis.fetch.mock.calls.filter(([url]) => url === '/api/market/snapshot')).toHaveLength(1);
    expect(screen.getByLabelText('natural gas price')).toHaveTextContent('99');
    expect(screen.getByLabelText('natural gas source')).toHaveTextContent('yahoo');
    expect(screen.getByLabelText('natural gas stale')).toHaveTextContent('false');
    expect(screen.getByLabelText('market mode')).toHaveTextContent('LIVE');

    failSnapshot = true;
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(globalThis.fetch.mock.calls.filter(([url]) => url === '/api/market/snapshot')).toHaveLength(2);
    expect(screen.getByLabelText('natural gas price')).toHaveTextContent('99');
    expect(screen.getByLabelText('natural gas source')).toHaveTextContent('yahoo');
    expect(screen.getByLabelText('natural gas stale')).toHaveTextContent('false');
    expect(screen.getByLabelText('market mode')).toHaveTextContent('LIVE');
  });

  it('times out a stalled supplemental body and allows a later poll to recover', async () => {
    const deadlines = [];
    const intervals = new Map();
    const originalSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (delay === 45_000) {
        deadlines.push(callback);
        return 45_000 + deadlines.length;
      }
      return originalSetTimeout(callback, delay, ...args);
    });
    vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
      intervals.set(delay, callback);
      return delay;
    });
    let snapshotCalls = 0;
    let firstSignal;
    let finishOldBody;
    globalThis.fetch = vi.fn(async (url, options) => {
      if (url === '/api/prices') return response(yahooPayload());
      if (url === '/api/market/snapshot') {
        snapshotCalls += 1;
        if (snapshotCalls === 1) {
          firstSignal = options.signal;
          return { ok: true, json: () => new Promise((resolve) => { finishOldBody = resolve; }) };
        }
        return response(v2Payload(88));
      }
      return response(newsPayload());
    });
    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await act(async () => {});
    expect(snapshotCalls).toBe(1);
    await act(async () => deadlines[0]());
    expect(firstSignal.aborted).toBe(true);
    await act(async () => intervals.get(60_000)());
    expect(snapshotCalls).toBe(2);
    expect(screen.getByLabelText('natural gas price')).toHaveTextContent('88');

    await act(async () => finishOldBody(v2Payload(77)));
    expect(screen.getByLabelText('natural gas price')).toHaveTextContent('88');
  });

  it('retains failed supplemental last-good data as stale when Yahoo has no matching row', async () => {
    let failSnapshot = false;
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') {
        const payload = yahooPayload();
        payload.commodities = payload.commodities.filter((row) => row.ticker !== 'NG');
        payload.counts.received = payload.commodities.length;
        payload.partial = true;
        return response(payload);
      }
      if (url === '/api/market/snapshot') {
        if (failSnapshot) throw new Error('snapshot unavailable');
        return response(v2Payload());
      }
      return response(newsPayload());
    });
    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await waitFor(() => expect(screen.getByLabelText('natural gas price')).toHaveTextContent('77'));
    failSnapshot = true;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /refresh market/i })));
    expect(screen.getByLabelText('natural gas price')).toHaveTextContent('77');
    expect(screen.getByLabelText('natural gas source')).toHaveTextContent('eia');
    expect(screen.getByLabelText('natural gas stale')).toHaveTextContent('true');
    expect(screen.getByLabelText('market mode')).toHaveTextContent('DEGRADED');
  });

  it('shares an in-flight supplemental read between visibility, polling and manual refresh', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const intervals = new Map();
    vi.spyOn(window, 'setInterval').mockImplementation((callback, delay) => {
      intervals.set(delay, callback);
      return delay;
    });
    let release;
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload());
      if (url === '/api/market/snapshot') return new Promise((resolve) => {
        release = () => resolve(response(v2Payload()));
      });
      return response(newsPayload());
    });
    render(<LiveDataProvider><MarketState /></LiveDataProvider>);
    await act(async () => {});
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      intervals.get(60_000)();
      fireEvent.click(screen.getByRole('button', { name: /refresh market/i }));
    });
    expect(globalThis.fetch.mock.calls.filter(([url]) => url === '/api/market/snapshot')).toHaveLength(1);
    await act(async () => release());
    expect(screen.getByLabelText('natural gas price')).toHaveTextContent('77');
  });

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
    expect(screen.getByLabelText('natural gas source')).toHaveTextContent('yahoo');
    expect(screen.getByLabelText('natural gas stale')).toHaveTextContent('false');
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
  it('recovers malformed stored state and keeps valid holdings across remounts', async () => {
    localStorage.setItem('comms.watchlists.v1', 'null');
    localStorage.setItem('comms.positions.v1', JSON.stringify([
      null, { ticker: 'NVDA', qty: 3, avgCost: 100 }, { ticker: 'AMD', qty: -2, avgCost: 80 },
    ]));
    localStorage.setItem('comms.alerts.v1', '{}');
    localStorage.setItem('comms.alerts.triggered.v1', '[null]');
    localStorage.setItem('comms.displayCurrency', '__proto__');
    globalThis.fetch = vi.fn(async () => response({ ok: false }));

    const first = render(<LiveDataProvider><SavedState /><WatchlistState /></LiveDataProvider>);
    await act(async () => {});
    expect(screen.getByLabelText('watchlist names')).toHaveTextContent('Default');
    expect(screen.getByLabelText('saved holdings')).toHaveTextContent('[{"ticker":"NVDA","qty":3,"avgCost":100}]');
    expect(screen.getByLabelText('saved alerts')).toHaveTextContent('[]');
    expect(screen.getByLabelText('triggered count')).toHaveTextContent('0');
    expect(screen.getByLabelText('saved currency')).toHaveTextContent('USD');
    first.unmount();

    render(<LiveDataProvider><SavedState /></LiveDataProvider>);
    await act(async () => {});
    expect(screen.getByLabelText('saved holdings')).toHaveTextContent('[{"ticker":"NVDA","qty":3,"avgCost":100}]');
  });

  it('records one threshold crossing in StrictMode and retains it after restart', async () => {
    localStorage.setItem('comms.alerts.v1', JSON.stringify([
      { id: 'crude-high', ticker: 'CL', op: '>', price: 83, name: 'Crude', enabled: true },
    ]));
    let price = 82;
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/prices') return response(yahooPayload(price));
      if (url === '/api/market/snapshot') return response(v2Payload());
      return response({ ok: false });
    });
    const first = render(<React.StrictMode><LiveDataProvider><SavedState /><MarketState /></LiveDataProvider></React.StrictMode>);
    await waitFor(() => expect(screen.getByLabelText('market mode')).toHaveTextContent('LIVE'));
    price = 84;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' })));
    await waitFor(() => expect(screen.getByLabelText('triggered count')).toHaveTextContent('1'));
    first.unmount();

    render(<LiveDataProvider><SavedState /></LiveDataProvider>);
    await act(async () => {});
    expect(screen.getByLabelText('triggered count')).toHaveTextContent('1');
  });

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
