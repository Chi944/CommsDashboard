// @vitest-environment jsdom

import React, { useState } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const liveData = vi.hoisted(() => ({ current: null }));

vi.mock('../src/state/LiveData.jsx', () => ({
  useLiveData: () => liveData.current,
}));

import AnalysisPanel from '../src/components/AnalysisPanel.jsx';
import AlertButton from '../src/components/AlertButton.jsx';
import Briefing from '../src/components/Briefing.jsx';
import CommandPalette from '../src/components/CommandPalette.jsx';
import Currency from '../src/components/Currency.jsx';
import Nav from '../src/components/Nav.jsx';
import NotificationsDrawer from '../src/components/NotificationsDrawer.jsx';
import Prices, { fmtPctChange } from '../src/components/Prices.jsx';
import SectorHeatmap from '../src/components/SectorHeatmap.jsx';
import Ticker from '../src/components/Ticker.jsx';

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;
const originalNotification = globalThis.Notification;

function jsonFetch(payload) {
  const calls = [];
  const fake = vi.fn(async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => payload,
    };
  });
  return { fake, calls };
}

function jsonErrorFetch(payload, status = 429) {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => payload,
  }));
}

function fetchResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

function marketBriefingPayload({
  marketDate,
  generatedAt = `${marketDate}T12:00:00.000Z`,
  label = `Briefing for ${marketDate}`,
  aiStatus = { state: 'ready', retryable: false },
  signals,
} = {}) {
  const evidence = [
    { id: 'test:tone', label: `${label} tone evidence`, sourceUrl: 'https://example.com/tone' },
    { id: 'test:themes', label: `${label} themes evidence`, sourceUrl: 'https://example.com/themes' },
    { id: 'test:watch', label: `${label} watch evidence`, sourceUrl: 'https://example.com/watch' },
  ];
  const paragraphs = [
    { id: 'market-tone', text: label, evidenceIds: ['test:tone'] },
    { id: 'themes-catalysts', text: `${label} themes`, evidenceIds: ['test:themes'] },
    { id: 'watchpoints', text: `${label} watchpoints`, evidenceIds: ['test:watch'] },
  ];
  return {
    ok: true,
    aiAvailable: true,
    aiStatus,
    briefing: {
      source: aiStatus.state === 'ready' ? 'generated' : 'deterministic',
      marketDate,
      generatedAt,
      paragraphs,
      evidence,
      inputsAsOf: {},
      text: paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    },
    signals,
  };
}

function defaultLiveData() {
  return {
    commodities: [
      { ticker: 'NVDA', name: 'NVIDIA', symbol: 'NVDA', category: 'EQUITY' },
    ],
    notifications: [
      {
        id: 'news-1',
        severity: 'HIGH',
        title: 'Port disruption',
        body: 'A material shipping delay.',
        time: '2m',
        url: 'https://example.com/news',
      },
    ],
    triggeredAlerts: [],
    clearTriggered: vi.fn(),
    newsLive: true,
    newsUpdatedAt: '2026-08-25T06:00:00.000Z',
    requestNotificationPermission: vi.fn(async () => 'granted'),
  };
}

function pricesLiveData(commodities, resolveHeatmapAsset = (asset) => asset) {
  return {
    ...defaultLiveData(),
    commodities,
    rankingCommodities: commodities.filter((row) => row.source === 'yahoo' && !row.stale),
    dataMode: 'DEGRADED',
    pricesUpdatedAt: null,
    pricesLoading: false,
    newsLoading: false,
    refresh: vi.fn(),
    formatAssetPrice: (asset) => String(asset?.price ?? '—'),
    dashboardCurrency: 'USD',
    resolveHeatmapAsset,
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
  };
}

function priceRow(ticker, source, stale) {
  return {
    ticker,
    name: `${ticker} asset`,
    symbol: ticker,
    category: 'TECH',
    price: 100,
    changePct: 1,
    changeAbs: 1,
    source,
    stale,
    isLive: source !== 'mock',
    history: [{ price: 99 }, { price: 100 }],
  };
}

beforeEach(() => {
  liveData.current = defaultLiveData();
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
  else delete globalThis.ResizeObserver;
  if (originalNotification) globalThis.Notification = originalNotification;
  else delete globalThis.Notification;
});

it('keeps display currency available at mobile widths and updates it', async () => {
  const user = userEvent.setup();
  const setDashboardCurrency = vi.fn();
  liveData.current = {
    ...defaultLiveData(),
    pricesLive: true,
    dashboardCurrency: 'USD',
    setDashboardCurrency,
    availableCurrencies: ['USD', 'SGD'],
    dataMode: 'LIVE',
    marketUpdatedLabel: 'updated 2s ago',
    marketRefreshing: false,
    refreshMarketSnapshot: vi.fn(),
    useMarketV2: true,
  };

  render(<Nav active="Overview" setActive={vi.fn()} onOpenAlerts={vi.fn()} onOpenPalette={vi.fn()} />);
  const currency = screen.getByRole('combobox', { name: /display currency/i });
  expect(currency.closest('label').className).not.toMatch(/\bhidden\b/);
  expect(screen.getByRole('button', { name: /open command palette/i }).className).not.toMatch(/\bhidden\b/);
  await user.selectOptions(currency, 'SGD');
  expect(setDashboardCurrency).toHaveBeenCalledWith('SGD');
});

describe('AI refresh controls', () => {
  it('does not present an empty briefing object as a generated briefing', async () => {
    const { fake } = jsonFetch({
      ok: true,
      generatedAt: '2026-08-25T15:32:11.000Z',
      aiAvailable: true,
      aiError: null,
      aiStatus: {
        state: 'ready',
        code: null,
        message: null,
        retryable: false,
        source: 'cache',
      },
      briefing: {
        text: '',
        model: 'openai/gpt-oss-120b (Groq)',
      },
      signals: {
        gainers: [{ ticker: 'NVDA', name: 'NVIDIA', changePct: 2.5 }],
        losers: [],
        newsHeadlines: [],
      },
    });
    globalThis.fetch = fake;

    render(<Briefing />);

    const unavailable = await screen.findByText(/Briefing refresh failed/i);
    expect(unavailable).toHaveAttribute('role', 'alert');
    expect(screen.queryByText(/Today's market in three paragraphs/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Generated by/i)).not.toBeInTheDocument();
    expect(screen.queryByText('NVDA')).not.toBeInTheDocument();
  });

  it('keeps the briefing disclosure and refresh controls as separate labelled buttons', async () => {
    const { fake } = jsonFetch({ ok: true, aiAvailable: false });
    globalThis.fetch = fake;

    const { container } = render(<Briefing />);

    await waitFor(() => expect(fake).toHaveBeenCalledTimes(1));
    const disclosure = screen.getByRole('button', { name: /collapse market briefing/i });
    const refresh = screen.getByRole('button', { name: /refresh market briefing/i });

    expect(container.querySelector('button button')).not.toBeInTheDocument();
    expect(disclosure).not.toContainElement(refresh);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(disclosure).toHaveAttribute('aria-controls');
  });

  it('uses the stable no-store refresh route for the latest shared briefing', async () => {
    const user = userEvent.setup();
    const { fake, calls } = jsonFetch({ ok: true, aiAvailable: false });
    globalThis.fetch = fake;
    render(<Briefing />);

    await waitFor(() => expect(calls).toEqual(['/api/briefing']));
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual(['/api/briefing', '/api/briefing?refresh=1']);
  });

  it('checks for a new daily briefing when a long-lived tab regains focus after UTC midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-02T23:59:30.000Z'));
    const { fake, calls } = jsonFetch({ ok: true, aiAvailable: false });
    globalThis.fetch = fake;
    render(<Briefing />);
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual(['/api/briefing']);

    vi.setSystemTime(new Date('2030-01-03T00:00:05.000Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });

    expect(calls).toEqual(['/api/briefing', '/api/briefing?refresh=1']);
  });

  it('retries when the first post-midnight response still contains yesterday\'s briefing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-02T23:59:30.000Z'));
    const calls = [];
    let responseIndex = 0;
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      responseIndex += 1;
      const marketDate = responseIndex < 3 ? '2030-01-02' : '2030-01-03';
      return fetchResponse(marketBriefingPayload({ marketDate }));
    });

    render(<Briefing />);
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual(['/api/briefing']);

    vi.setSystemTime(new Date('2030-01-03T00:00:05.000Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual(['/api/briefing', '/api/briefing?refresh=1']);

    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(calls).toEqual([
      '/api/briefing',
      '/api/briefing?refresh=1',
      '/api/briefing?refresh=1',
    ]);

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });
    expect(calls).toHaveLength(3);
  });

  it('retries a transient daily briefing failure and stops after recovery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-03T12:00:00.000Z'));
    const calls = [];
    let responseIndex = 0;
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      responseIndex += 1;
      if (responseIndex === 1) {
        return fetchResponse({
          ok: true,
          aiAvailable: true,
          briefing: null,
          aiStatus: { state: 'degraded', retryable: true },
        });
      }
      return fetchResponse(marketBriefingPayload({
        marketDate: '2030-01-03',
        label: 'Recovered current briefing',
      }));
    });

    render(<Briefing />);
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual(['/api/briefing']);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toEqual(['/api/briefing', '/api/briefing?refresh=1']);

    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(calls).toHaveLength(2);
  });

  it('recovers when a same-day manual refresh transiently loses a valid briefing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-03T12:00:00.000Z'));
    const calls = [];
    let responseIndex = 0;
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      responseIndex += 1;
      if (responseIndex === 2) {
        return fetchResponse({
          ok: true,
          aiAvailable: true,
          briefing: null,
          aiStatus: { state: 'degraded', retryable: true },
        });
      }
      return fetchResponse(marketBriefingPayload({
        marketDate: '2030-01-03',
        generatedAt: `2030-01-03T12:00:0${responseIndex}.000Z`,
        label: `Current briefing ${responseIndex}`,
      }));
    });

    render(<Briefing />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Current briefing 1')).toBeInTheDocument();

    await act(async () => { screen.getByRole('button', { name: /refresh market briefing/i }).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(calls).toEqual(['/api/briefing', '/api/briefing?refresh=1']);
    expect(screen.getByText(/Briefing refresh failed/i)).toBeInTheDocument();
    expect(screen.getByText('Current briefing 1')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toEqual([
      '/api/briefing',
      '/api/briefing?refresh=1',
      '/api/briefing?refresh=1',
    ]);
    expect(screen.getByText('Current briefing 3')).toBeInTheDocument();
  });

  it('refreshes asset analysis through the stable no-store refresh route', async () => {
    const user = userEvent.setup();
    const { fake, calls } = jsonFetch({ ok: true, signals: [] });
    globalThis.fetch = fake;
    render(<AnalysisPanel asset={{ ticker: 'NVDA', name: 'NVIDIA' }} />);

    await waitFor(() => expect(calls).toEqual(['/api/analysis?ticker=NVDA']));
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      '/api/analysis?ticker=NVDA',
      '/api/analysis?ticker=NVDA&refresh=1',
    ]);
  });

  it('clears the previous asset analysis when switching tickers and the next request fails', async () => {
    let rejectAapl;
    globalThis.fetch = vi.fn((url) => {
      if (String(url).includes('ticker=NVDA')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            signals: [{ tier: 'positive', text: 'NVDA-specific signal' }],
            technicals: { return_1m: 1, return_3m: 2, rsi14: 50, vol_annual: 20 },
            aiAvailable: true,
            ai: {
              trend: 'NVDA-specific trend',
              catalysts: 'NVDA catalysts',
              risks: 'NVDA risks',
              outlook: 'NVDA outlook',
              model: 'test/model',
            },
          }),
        });
      }
      return new Promise((resolve, reject) => {
        rejectAapl = reject;
      });
    });

    const { rerender } = render(
      <AnalysisPanel asset={{ ticker: 'NVDA', name: 'NVIDIA' }} />,
    );
    expect(await screen.findByText('NVDA-specific trend')).toBeInTheDocument();

    rerender(<AnalysisPanel asset={{ ticker: 'AAPL', name: 'Apple' }} />);

    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.queryByText('NVDA-specific trend')).not.toBeInTheDocument();
    expect(screen.queryByText('NVDA-specific signal')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /loading asset analysis/i })).toBeInTheDocument();

    rejectAapl(new Error('upstream unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load analysis/i);
    expect(screen.queryByText('NVDA-specific trend')).not.toBeInTheDocument();
  });

  it('renders the deterministic quota fallback while keeping briefing signals visible', async () => {
    globalThis.fetch = jsonErrorFetch(marketBriefingPayload({
      marketDate: '2030-01-03',
      aiStatus: { state: 'rate_limited', retryable: true },
      signals: {
        gainers: [{ ticker: 'NVDA', name: 'NVIDIA', changePct: 2 }],
        losers: [],
      },
    }));

    render(<Briefing />);

    expect(await screen.findByRole('status', { name: /briefing source/i }))
      .toHaveTextContent(/deterministic fallback/i);
    expect(screen.getByText('NVDA')).toBeInTheDocument();
  });

  it('renders the structured AI quota message while keeping technical analysis visible', async () => {
    globalThis.fetch = jsonErrorFetch({
      ok: false,
      aiAvailable: true,
      aiStatus: { state: 'rate_limited', message: 'AI generation limit reached. Try again shortly.' },
      error: { message: 'AI generation limit reached. Try again shortly.' },
      signals: [{ tier: 'neutral', text: 'RSI is neutral' }],
      technicals: { return_1m: 1, return_3m: 2, rsi14: 50, vol_annual: 20 },
    });

    render(<AnalysisPanel asset={{ ticker: 'NVDA', name: 'NVIDIA' }} />);

    expect(await screen.findByText(/AI generation limit reached\. Try again shortly\./i)).toBeInTheDocument();
    expect(screen.getByText('RSI is neutral')).toBeInTheDocument();
  });
});

describe('CommandPalette', () => {
  it('exposes a labelled modal combobox with a selected listbox option', async () => {
    render(
      <CommandPalette open onClose={() => {}} onSelectAsset={() => {}} onSwitchTab={() => {}} />,
    );

    const dialog = screen.getByRole('dialog', { name: /command palette/i });
    const combobox = screen.getByRole('combobox', { name: /search commands and assets/i });
    const listbox = screen.getByRole('listbox', { name: /commands and assets/i });
    const firstOption = screen.getByRole('option', { name: /go to overview/i });

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(combobox).toHaveAttribute('aria-controls', listbox.id);
    expect(combobox).toHaveAttribute('aria-activedescendant', firstOption.id);
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(combobox).toHaveFocus());
  });

  it('updates the active option with arrow keys and selects it with Enter', async () => {
    const user = userEvent.setup();
    const onSwitchTab = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette open onClose={onClose} onSelectAsset={() => {}} onSwitchTab={onSwitchTab} />,
    );

    const combobox = screen.getByRole('combobox', { name: /search commands and assets/i });
    await waitFor(() => expect(combobox).toHaveFocus());
    await user.keyboard('{ArrowDown}');

    const pricesOption = screen.getByRole('option', { name: /go to prices/i });
    expect(combobox).toHaveAttribute('aria-activedescendant', pricesOption.id);
    expect(pricesOption).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(onSwitchTab).toHaveBeenCalledWith('Prices');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('scrolls the arrow-selected option into view using the nearest edge', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette open onClose={() => {}} onSelectAsset={() => {}} onSwitchTab={() => {}} />,
    );

    const combobox = screen.getByRole('combobox', { name: /search commands and assets/i });
    const pricesOption = screen.getByRole('option', { name: /go to prices/i });
    const scrollIntoView = vi.fn();
    Object.defineProperty(pricesOption, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    await waitFor(() => expect(combobox).toHaveFocus());

    await user.keyboard('{ArrowDown}');

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }));
  });

  it('cycles Tab focus within the palette', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open palette</button>
          <button type="button">Outside</button>
          <CommandPalette open={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /open palette/i }));
    const combobox = screen.getByRole('combobox', { name: /search commands and assets/i });
    const close = screen.getByRole('button', { name: /close command palette/i });
    await waitFor(() => expect(combobox).toHaveFocus());

    close.focus();
    await user.tab();
    expect(combobox).toHaveFocus();

    combobox.focus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it('closes on Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open palette</button>
          <CommandPalette open={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: /open palette/i });
    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe('Prices heatmap', () => {
  it('renders an absent Yahoo session change as unavailable', () => {
    expect(fmtPctChange(null)).toBe('—');
  });

  it('renders a V2-only table spot with a neutral unavailable session change', () => {
    const base = {
      ...priceRow('CL', 'mock', true),
      category: 'ENERGY',
      isLive: false,
    };
    liveData.current = {
      ...pricesLiveData([base]),
      resolveTablePrice: () => ({
        ...base,
        price: 71,
        changePct: null,
        changeAbs: null,
        source: 'eia',
        asOf: '2026-08-25T12:00:00.000Z',
        isLive: false,
        marketSource: 'eia',
        marketStale: false,
      }),
    };
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;

    render(<Prices />);

    const change = screen.getByLabelText('CL session change');
    expect(change).toHaveTextContent('—');
    expect(change).toHaveClass('text-gray-400');
  });

  it('excludes mock and stale rows after resolving heatmap data', async () => {
    const user = userEvent.setup();
    const rows = [
      priceRow('TRUST', 'yahoo', false),
      priceRow('MOCK', 'yahoo', false),
      priceRow('STALE', 'yahoo', false),
    ];
    liveData.current = pricesLiveData(rows, (asset) => {
      if (asset.ticker === 'MOCK') return { ...asset, source: 'mock', stale: true, isLive: false };
      if (asset.ticker === 'STALE') return { ...asset, source: 'eia', stale: true };
      return asset;
    });
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;

    render(<Prices />);
    await user.click(screen.getByRole('button', { name: /^heatmap$/i }));

    expect(screen.getByText('TRUST')).toBeInTheDocument();
    expect(screen.queryByText('MOCK')).not.toBeInTheDocument();
    expect(screen.queryByText('STALE')).not.toBeInTheDocument();
  });

  it('shows the heatmap empty state when every resolved row is untrusted', async () => {
    const user = userEvent.setup();
    const rows = [
      priceRow('MOCK', 'yahoo', false),
      priceRow('STALE', 'yahoo', false),
    ];
    liveData.current = pricesLiveData(rows, (asset) => ({
      ...asset,
      source: asset.ticker === 'MOCK' ? 'mock' : 'eia',
      stale: true,
      isLive: asset.ticker !== 'MOCK',
    }));
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;

    render(<Prices />);
    await user.click(screen.getByRole('button', { name: /^heatmap$/i }));

    expect(screen.getByText('No items.')).toBeInTheDocument();
  });

  it('names the Prices search and makes table asset selection keyboard-operable', async () => {
    const user = userEvent.setup();
    const rows = [priceRow('CL', 'yahoo', false), priceRow('NVDA', 'yahoo', false)];
    liveData.current = pricesLiveData(rows);
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;
    const onTickerChange = vi.fn();

    render(<Prices onTickerChange={onTickerChange} />);

    expect(screen.getByRole('searchbox', { name: /search prices/i })).toBeInTheDocument();
    const nvda = screen.getByRole('button', { name: /select nvda/i });
    expect(nvda.tagName).toBe('BUTTON');
    expect(nvda.querySelector('button, input, select, textarea, a[href]')).toBeNull();
    nvda.focus();
    await user.keyboard('{Enter}');
    expect(onTickerChange).toHaveBeenCalledWith('NVDA');
  });

  it('names comparison choices and disables unchecked symbols at the five-symbol cap', async () => {
    const user = userEvent.setup();
    const rows = ['NVDA', 'AAPL', 'BTC', 'MSFT', 'GOOG', 'AMZN'].map((ticker) => priceRow(ticker, 'yahoo', false));
    liveData.current = pricesLiveData(rows);
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;

    render(<Prices />);
    await user.click(screen.getByRole('button', { name: /^compare$/i }));
    await user.click(screen.getByRole('checkbox', { name: /compare msft/i }));
    await user.click(screen.getByRole('checkbox', { name: /compare goog/i }));

    expect(screen.getByRole('checkbox', { name: /compare amzn/i })).toBeDisabled();
    expect(screen.getByText(/maximum 5 symbols/i)).toBeVisible();
  });

  it('offers a selectable share link when clipboard access is denied', async () => {
    const user = userEvent.setup();
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError'); }) },
    });
    liveData.current = pricesLiveData([priceRow('NVDA', 'yahoo', false)]);
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;

    try {
      render(<Prices />);
      await user.click(screen.getByRole('button', { name: /share nvda/i }));

      expect(await screen.findByRole('status', { name: /share link status/i })).toHaveTextContent(/unable to copy/i);
      expect(screen.getByRole('textbox', { name: /share link/i }).value).toMatch(/\?tab=Prices&t=NVDA$/);
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    }
  });

  it('never renders prior-asset headlines under a newly selected asset', async () => {
    const user = userEvent.setup();
    const rows = [
      { ...priceRow('CL', 'yahoo', false), name: 'WTI Crude', symbol: 'CL=F', category: 'ENERGY' },
      { ...priceRow('NVDA', 'yahoo', false), name: 'NVIDIA', symbol: 'NVDA', category: 'TECH' },
    ];
    liveData.current = pricesLiveData(rows);
    let resolveNvdaNews;
    globalThis.fetch = vi.fn((url) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith('/api/history')) {
        return Promise.resolve(fetchResponse({ ok: false, points: [] }));
      }
      if (requestUrl.includes('/api/asset-news?q=WTI%20Crude')) {
        return Promise.resolve(fetchResponse({
          ok: true,
          items: [{
            id: 'wti-1',
            source: 'Reuters',
            time: '1m',
            url: 'https://example.com/wti',
            headline: 'WTI-specific headline',
          }],
        }));
      }
      if (requestUrl.includes('/api/asset-news?q=NVIDIA')) {
        return new Promise((resolve) => { resolveNvdaNews = resolve; });
      }
      return Promise.resolve(fetchResponse({ ok: false, items: [] }));
    });

    render(<Prices />);
    expect(await screen.findByText('WTI-specific headline')).toBeInTheDocument();

    await user.click(screen.getByText('NVDA'));
    await waitFor(() => expect(resolveNvdaNews).toEqual(expect.any(Function)));

    expect(screen.getByRole('heading', { name: /news · nvidia/i })).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('WTI-specific headline')).not.toBeInTheDocument();

    resolveNvdaNews(fetchResponse({
      ok: true,
      items: [{
        id: 'nvda-1',
        source: 'Reuters',
        time: 'now',
        url: 'https://example.com/nvda',
        headline: 'NVIDIA-specific headline',
      }],
    }));
    expect(await screen.findByText('NVIDIA-specific headline')).toBeInTheDocument();
  });

  it('exposes and enforces the Prices refresh busy state', async () => {
    const user = userEvent.setup();
    const row = priceRow('NVDA', 'yahoo', false);
    const refresh = vi.fn();
    liveData.current = { ...pricesLiveData([row]), refresh };
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;

    const { rerender } = render(<Prices />);
    const readyButton = screen.getByRole('button', { name: /refresh prices and news/i });
    expect(readyButton).toBeEnabled();
    expect(readyButton).toHaveAttribute('aria-busy', 'false');

    await user.click(readyButton);
    expect(refresh).toHaveBeenCalledTimes(1);

    liveData.current = {
      ...pricesLiveData([row]),
      refresh,
      pricesLoading: true,
    };
    rerender(<Prices />);

    const busyButton = screen.getByRole('button', { name: /refreshing prices and news/i });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('aria-busy', 'true');
    await user.click(busyButton);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('Overview sector heatmap', () => {
  it('does not prefix a negative top performer with a plus sign', () => {
    const rows = [
      { ...priceRow('LEAST-DOWN', 'yahoo', false), changePct: -0.8 },
      { ...priceRow('MOST-DOWN', 'yahoo', false), changePct: -1.2 },
    ];
    liveData.current = pricesLiveData(rows);

    render(<SectorHeatmap />);

    expect(screen.getByText('-0.8%')).toBeInTheDocument();
    expect(screen.queryByText('+-0.8%')).not.toBeInTheDocument();
  });

  it('honors a requested ticker without echoing the stale default ticker to its parent', async () => {
    const rows = [
      { ...priceRow('CL', 'yahoo', false), name: 'WTI Crude', symbol: 'CL=F', category: 'ENERGY' },
      { ...priceRow('NVDA', 'yahoo', false), name: 'NVIDIA', symbol: 'NVDA', category: 'TECH' },
    ];
    liveData.current = pricesLiveData(rows);
    globalThis.fetch = jsonFetch({ ok: false, items: [] }).fake;
    const onTickerChange = vi.fn();

    render(<Prices initialTicker="NVDA" onTickerChange={onTickerChange} />);

    await waitFor(() => expect(screen.getAllByText('NVIDIA').length).toBeGreaterThan(0));
    expect(onTickerChange).not.toHaveBeenCalledWith('CL');
  });
});

describe('Ticker V2-only state', () => {
  it('shows a neutral change and no live dot without a trusted Yahoo baseline', () => {
    const base = {
      ticker: 'BTC', name: 'Bitcoin', symbol: 'BTC', category: 'CRYPTO',
      price: 60_000, changePct: 0, source: 'mock', asOf: null,
      stale: true, isLive: false, history: [],
    };
    const v2Only = {
      ...base,
      price: 68_000,
      changePct: null,
      changeAbs: null,
      source: 'coingecko',
      asOf: '2026-08-25T12:00:00.000Z',
      stale: false,
      isLive: false,
      marketSource: 'coingecko',
      marketStale: false,
    };
    liveData.current = {
      commodities: [base],
      formatAssetPrice: (asset) => String(asset.price),
      resolveTickerAsset: () => v2Only,
      useMarketV2: true,
    };

    render(<Ticker />);

    const changes = screen.getAllByLabelText('BTC session change');
    expect(changes).toHaveLength(2);
    expect(changes.every((change) => change.textContent === '—')).toBe(true);
    expect(screen.queryByText('●')).not.toBeInTheDocument();
  });
});

describe('Currency converter', () => {
  it('exposes a disabled busy refresh control while a route refresh is running', () => {
    liveData.current = {
      ...defaultLiveData(),
      availableCurrencies: ['USD', 'SGD'],
      getRate: (from, to) => (from === to ? 1 : 1.28),
      dashboardCurrency: 'USD',
      dataMode: 'LIVE',
      pricesUpdatedAt: null,
      pricesLoading: true,
      newsLoading: false,
      refresh: vi.fn(),
      intel: [],
    };

    render(<Currency />);

    const refresh = screen.getByRole('button', { name: /refreshing currency data/i });
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('aria-busy', 'true');
  });

  it('gives every converter control and result an accessible name', () => {
    liveData.current = {
      ...defaultLiveData(),
      availableCurrencies: ['USD', 'SGD'],
      getRate: (from, to) => (from === to ? 1 : 1.28),
      dashboardCurrency: 'USD',
      dataMode: 'LIVE',
      pricesUpdatedAt: null,
      refresh: vi.fn(),
      intel: [],
    };

    render(<Currency />);

    expect(screen.getByRole('spinbutton', { name: /amount to convert/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /from currency/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /to currency/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /swap currencies/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /converted amount/i })).toBeInTheDocument();
  });

  it('labels fallback FX rates as stale instead of live', () => {
    liveData.current = {
      ...defaultLiveData(),
      availableCurrencies: ['USD', 'SGD'],
      getRate: (from, to) => (from === to ? 1 : 1.28),
      dashboardCurrency: 'USD',
      dataMode: 'STALE',
      pricesUpdatedAt: null,
      refresh: vi.fn(),
      intel: [],
    };

    render(<Currency />);

    expect(screen.getByText('Fallback converter')).toBeInTheDocument();
    expect(screen.getByText('Fallback rates · conversions may be outdated.')).toBeInTheDocument();
    expect(screen.queryByText('Live Converter')).not.toBeInTheDocument();
    expect(screen.queryByText(/Live rates · convert any/i)).not.toBeInTheDocument();
  });
});

describe('NotificationsDrawer', () => {
  it('does not leave drawer content in the DOM while closed', () => {
    const { container } = render(<NotificationsDrawer open={false} onClose={() => {}} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes a labelled modal dialog and labelled close control while open', async () => {
    render(<NotificationsDrawer open onClose={() => {}} />);

    const dialog = screen.getByRole('dialog', { name: /alerts & notifications/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: /close notifications/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /close notifications/i })).toHaveFocus());
  });

  it('cycles Tab focus within the notifications dialog', async () => {
    const user = userEvent.setup();
    render(<NotificationsDrawer open onClose={() => {}} />);

    const close = screen.getByRole('button', { name: /close notifications/i });
    const story = screen.getByRole('link', { name: /port disruption/i });
    await waitFor(() => expect(close).toHaveFocus());

    close.focus();
    await user.tab({ shift: true });
    expect(story).toHaveFocus();

    story.focus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it('closes on Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open notifications</button>
          <NotificationsDrawer open={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: /open notifications/i });
    await user.click(opener);
    await waitFor(() => expect(screen.getByRole('button', { name: /close notifications/i })).toHaveFocus());

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: /alerts & notifications/i })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('describes browser alerts as available only while the dashboard is open', () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'default' },
    });

    render(<NotificationsDrawer open onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /enable browser alerts/i })).toBeInTheDocument();
    expect(screen.getByText(/alerts operate only while this dashboard is open/i)).toBeInTheDocument();
    expect(screen.queryByText(/push/i)).not.toBeInTheDocument();
  });
});

describe('Price alert dialog', () => {
  it('exposes a named modal, focuses the price threshold, and describes every control', async () => {
    const user = userEvent.setup();
    liveData.current = {
      ...defaultLiveData(),
      alerts: [],
      addAlert: vi.fn(),
      removeAlert: vi.fn(),
      toggleAlert: vi.fn(),
    };

    render(<AlertButton asset={{ ticker: 'WTI', name: 'WTI Crude', price: 80 }} />);
    await user.click(screen.getByRole('button', { name: /price alerts/i }));

    const dialog = screen.getByRole('dialog', { name: /price alerts for wti crude/i });
    const priceInput = screen.getByRole('spinbutton', { name: /price threshold/i });
    const above = screen.getByRole('button', { name: /price is above/i });
    const below = screen.getByRole('button', { name: /price is below/i });

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(priceInput).toHaveFocus();
    expect(screen.getByRole('button', { name: /close price alert dialog/i })).toBeInTheDocument();
    expect(above).toHaveAttribute('aria-pressed', 'true');
    expect(below).toHaveAttribute('aria-pressed', 'false');

    await user.click(below);
    expect(above).toHaveAttribute('aria-pressed', 'false');
    expect(below).toHaveAttribute('aria-pressed', 'true');
  });

  it('contains keyboard focus, closes on Escape, and restores focus to its trigger', async () => {
    const user = userEvent.setup();
    liveData.current = {
      ...defaultLiveData(),
      alerts: [],
      addAlert: vi.fn(),
      removeAlert: vi.fn(),
      toggleAlert: vi.fn(),
    };

    render(<AlertButton asset={{ ticker: 'WTI', name: 'WTI Crude', price: 80 }} />);
    const trigger = screen.getByRole('button', { name: /price alerts/i });
    await user.click(trigger);

    const close = screen.getByRole('button', { name: /close price alert dialog/i });
    const priceInput = screen.getByRole('spinbutton', { name: /price threshold/i });
    close.focus();
    await user.tab({ shift: true });
    expect(priceInput).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /price alerts for wti crude/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps add, pause, enable, and remove alert actions usable', async () => {
    const user = userEvent.setup();
    const addAlert = vi.fn();
    const toggleAlert = vi.fn();
    const removeAlert = vi.fn();
    const requestNotificationPermission = vi.fn(async () => 'granted');
    liveData.current = {
      ...defaultLiveData(),
      alerts: [
        { id: 'active-alert', ticker: 'WTI', op: '>', price: 90, enabled: true },
        { id: 'paused-alert', ticker: 'WTI', op: '<', price: 70, enabled: false },
      ],
      addAlert,
      removeAlert,
      toggleAlert,
      requestNotificationPermission,
    };
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission: 'default' },
    });

    render(<AlertButton asset={{ ticker: 'WTI', name: 'WTI Crude', price: 80 }} />);
    await user.click(screen.getByRole('button', { name: /price alerts/i }));
    await user.click(screen.getByRole('button', { name: /price is below/i }));
    await user.type(screen.getByRole('spinbutton', { name: /price threshold/i }), '75');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(requestNotificationPermission).toHaveBeenCalledOnce();
    expect(addAlert).toHaveBeenCalledWith({ ticker: 'WTI', op: '<', price: 75, name: 'WTI Crude' });

    await user.click(screen.getByRole('button', { name: /^pause$/i }));
    await user.click(screen.getByRole('button', { name: /^enable$/i }));
    const removeButtons = screen.getAllByRole('button', { name: /^remove$/i });
    await user.click(removeButtons[0]);

    expect(toggleAlert).toHaveBeenNthCalledWith(1, 'active-alert');
    expect(toggleAlert).toHaveBeenNthCalledWith(2, 'paused-alert');
    expect(removeAlert).toHaveBeenCalledWith('active-alert');
  });

  it('states that threshold checks and browser alerts require the dashboard to remain open', async () => {
    const user = userEvent.setup();
    liveData.current = {
      ...defaultLiveData(),
      alerts: [],
      addAlert: vi.fn(),
      removeAlert: vi.fn(),
      toggleAlert: vi.fn(),
    };

    render(<AlertButton asset={{ ticker: 'WTI', name: 'WTI Crude', price: 80 }} />);
    await user.click(screen.getByRole('button', { name: /price alerts/i }));

    expect(screen.getByText(/threshold checks and browser alerts operate only while this dashboard is open/i)).toBeInTheDocument();
  });
});
