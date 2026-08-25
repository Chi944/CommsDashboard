// @vitest-environment jsdom

import React, { useState } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const liveData = vi.hoisted(() => ({ current: null }));

vi.mock('../src/state/LiveData.jsx', () => ({
  useLiveData: () => liveData.current,
}));

import AnalysisPanel from '../src/components/AnalysisPanel.jsx';
import Briefing from '../src/components/Briefing.jsx';
import CommandPalette from '../src/components/CommandPalette.jsx';
import Currency from '../src/components/Currency.jsx';
import NotificationsDrawer from '../src/components/NotificationsDrawer.jsx';
import Prices, { fmtPctChange } from '../src/components/Prices.jsx';
import Ticker from '../src/components/Ticker.jsx';

const originalFetch = globalThis.fetch;
const originalResizeObserver = globalThis.ResizeObserver;

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
  globalThis.fetch = originalFetch;
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
  else delete globalThis.ResizeObserver;
});

describe('AI refresh controls', () => {
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

  it('refreshes the briefing without adding a cache-busting query parameter', async () => {
    const user = userEvent.setup();
    const { fake, calls } = jsonFetch({ ok: true, aiAvailable: false });
    globalThis.fetch = fake;
    render(<Briefing />);

    await waitFor(() => expect(calls).toEqual(['/api/briefing']));
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual(['/api/briefing', '/api/briefing']);
  });

  it('refreshes asset analysis without adding a cache-busting query parameter', async () => {
    const user = userEvent.setup();
    const { fake, calls } = jsonFetch({ ok: true, signals: [] });
    globalThis.fetch = fake;
    render(<AnalysisPanel asset={{ ticker: 'NVDA', name: 'NVIDIA' }} />);

    await waitFor(() => expect(calls).toEqual(['/api/analysis?ticker=NVDA']));
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      '/api/analysis?ticker=NVDA',
      '/api/analysis?ticker=NVDA',
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

  it('renders the structured AI quota message while keeping briefing signals visible', async () => {
    globalThis.fetch = jsonErrorFetch({
      ok: false,
      aiAvailable: true,
      aiStatus: { state: 'rate_limited', message: 'AI generation limit reached. Try again shortly.' },
      error: { message: 'AI generation limit reached. Try again shortly.' },
      signals: {
        gainers: [{ ticker: 'NVDA', name: 'NVIDIA', changePct: 2 }],
        losers: [],
      },
    });

    render(<Briefing />);

    expect(await screen.findByText(/AI generation limit reached\. Try again shortly\./i)).toBeInTheDocument();
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
});
