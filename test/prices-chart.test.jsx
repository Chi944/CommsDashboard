// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const liveData = vi.hoisted(() => ({ current: null }));

vi.mock('../src/state/LiveData.jsx', () => ({
  useLiveData: () => liveData.current,
}));

vi.mock('recharts', async () => {
  const ReactModule = await import('react');
  const empty = () => null;
  return {
    ResponsiveContainer: ({ children }) => ReactModule.createElement('div', null, children),
    LineChart: ({ data, children }) => ReactModule.createElement(
      'div',
      { 'data-testid': 'price-line-chart', 'data-chart': JSON.stringify(data) },
      children,
    ),
    Line: ({ dataKey }) => ReactModule.createElement('span', {
      'data-testid': 'price-chart-line',
      'data-key': dataKey,
    }),
    XAxis: empty,
    YAxis: empty,
    Tooltip: empty,
    CartesianGrid: empty,
    Legend: empty,
    ReferenceLine: ({ label }) => label?.value === 'ERN'
      ? ReactModule.createElement('span', { 'data-testid': 'earnings-marker' })
      : null,
  };
});

import Prices from '../src/components/Prices.jsx';

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

function row(ticker) {
  return {
    ticker,
    name: `${ticker} asset`,
    symbol: ticker,
    unit: '$',
    category: 'TECH',
    price: 100,
    changePct: 1,
    changeAbs: 1,
    source: 'yahoo',
    stale: false,
    isLive: true,
    history: [{ date: '08-31', price: 99 }, { date: '09-01', price: 100 }],
  };
}

function pricesState(rows) {
  return {
    commodities: rows,
    rankingCommodities: rows,
    dataMode: 'LIVE',
    pricesUpdatedAt: '2026-09-01T12:00:00.000Z',
    pricesLoading: false,
    newsLoading: false,
    refresh: vi.fn(),
    formatAssetPrice: (asset, raw = null) => String(raw ?? asset?.price ?? '—'),
    dashboardCurrency: 'USD',
    resolveHeatmapAsset: (asset) => asset,
    resolveTablePrice: (asset) => asset,
    watchlistNames: ['Default'],
    activeWatchlist: 'Default',
    activeWatchSet: new Set(),
    setActiveList: vi.fn(),
    createList: vi.fn(),
    toggleWatch: vi.fn(),
    alerts: [],
    addAlert: vi.fn(),
    removeAlert: vi.fn(),
    toggleAlert: vi.fn(),
    requestNotificationPermission: vi.fn(),
  };
}

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

function requestUrl(value) {
  return new URL(String(value), 'https://dashboard.test');
}

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
  else delete globalThis.ResizeObserver;
});

it('aligns comparison values by their actual date keys with deterministic series order and null gaps', async () => {
  const user = userEvent.setup();
  const rows = ['NVDA', 'AAPL', 'BTC'].map(row);
  const histories = {
    NVDA: [
      { date: '09-01', price: 100 },
      { date: '09-02', price: 101 },
    ],
    AAPL: [
      { date: '09-01', price: 200 },
      { date: '09-03', price: 203 },
    ],
    BTC: [
      { date: '09-01', price: 300 },
      { date: '09-02', price: 302 },
      { date: '09-03', price: 303 },
    ],
  };
  liveData.current = pricesState(rows);
  globalThis.fetch = vi.fn(async (value) => {
    const url = requestUrl(value);
    if (url.pathname === '/api/history') {
      const ticker = url.searchParams.get('ticker');
      return response({ ok: true, points: histories[ticker] });
    }
    return response({ ok: true, items: [] });
  });

  render(<Prices />);
  await user.click(screen.getByRole('button', { name: /^compare$/i }));

  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('price-line-chart').dataset.chart)).toEqual([
      { date: '09-01', AAPL: 200, BTC: 300, NVDA: 100 },
      { date: '09-02', AAPL: null, BTC: 302, NVDA: 101 },
      { date: '09-03', AAPL: 203, BTC: 303, NVDA: null },
    ]);
  });
  expect(screen.getAllByTestId('price-chart-line').map((line) => line.dataset.key)).toEqual([
    'AAPL',
    'BTC',
    'NVDA',
  ]);
});

it('preserves the source chronology when a comparison range crosses the year boundary', async () => {
  const user = userEvent.setup();
  const rows = ['NVDA', 'AAPL', 'BTC'].map(row);
  const histories = {
    NVDA: [
      { date: '12-30', price: 100 },
      { date: '12-31', price: 101 },
      { date: '01-02', price: 102 },
    ],
    AAPL: [
      { date: '12-30', price: 200 },
      { date: '01-02', price: 202 },
    ],
    BTC: [
      { date: '12-30', price: 300 },
      { date: '12-31', price: 301 },
      { date: '01-01', price: 302 },
      { date: '01-02', price: 303 },
    ],
  };
  liveData.current = pricesState(rows);
  globalThis.fetch = vi.fn(async (value) => {
    const url = requestUrl(value);
    if (url.pathname === '/api/history') {
      return response({ ok: true, points: histories[url.searchParams.get('ticker')] });
    }
    return response({ ok: true, items: [] });
  });

  render(<Prices />);
  await user.click(screen.getByRole('button', { name: /^compare$/i }));

  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('price-line-chart').dataset.chart).map(({ date }) => date)).toEqual([
      '12-30',
      '12-31',
      '01-01',
      '01-02',
    ]);
  });
});

it('does not render approximate hard-coded earnings markers as market events', async () => {
  liveData.current = pricesState([row('NVDA')]);
  globalThis.fetch = vi.fn(async (value) => {
    const url = requestUrl(value);
    if (url.pathname === '/api/history') {
      return response({
        ok: true,
        points: [
          { date: '08-19', price: 100 },
          { date: '08-20', price: 101 },
          { date: '08-21', price: 102 },
        ],
      });
    }
    return response({ ok: true, items: [] });
  });

  render(<Prices />);
  await waitFor(() => {
    expect(JSON.parse(screen.getByTestId('price-line-chart').dataset.chart)).toHaveLength(3);
  });

  expect(screen.queryByTestId('earnings-marker')).not.toBeInTheDocument();
});

it('shows an accessible history error and retries the failed range', async () => {
  const user = userEvent.setup();
  liveData.current = pricesState([row('NVDA')]);
  let attempts = 0;
  globalThis.fetch = vi.fn(async (value) => {
    const url = requestUrl(value);
    if (url.pathname !== '/api/history') return response({ ok: true, items: [] });
    if (url.searchParams.get('range') !== '3mo') {
      return response({ ok: true, points: [{ date: '09-01', price: 100 }] });
    }
    attempts += 1;
    if (attempts === 1) return response({ ok: false }, { ok: false, status: 502 });
    return response({ ok: true, points: [{ date: '09-01', price: 100 }] });
  });

  render(<Prices />);
  await user.click(screen.getByRole('button', { name: '90D' }));

  const alert = await screen.findByRole('alert', { name: /price history unavailable/i });
  expect(alert).toHaveTextContent(/NVDA/i);
  await user.click(screen.getByRole('button', { name: /retry price history/i }));

  await waitFor(() => {
    expect(screen.queryByRole('alert', { name: /price history unavailable/i })).not.toBeInTheDocument();
  });
  expect(attempts).toBe(2);
});

it('distinguishes an empty history response from loading and offers retry', async () => {
  const user = userEvent.setup();
  liveData.current = pricesState([row('NVDA')]);
  globalThis.fetch = vi.fn(async (value) => {
    const url = requestUrl(value);
    if (url.pathname === '/api/history') return response({ ok: true, points: [] });
    return response({ ok: true, items: [] });
  });

  render(<Prices />);
  await user.click(screen.getByRole('button', { name: '90D' }));

  const status = await screen.findByRole('status', { name: /price history empty/i });
  expect(status).toHaveTextContent(/No price history was returned for NVDA/i);
  expect(screen.getByRole('button', { name: /retry price history/i })).toBeVisible();
});
