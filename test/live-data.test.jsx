// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
