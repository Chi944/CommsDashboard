// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const liveData = vi.hoisted(() => ({ current: {} }));

vi.mock('../src/state/LiveData.jsx', () => ({
  useLiveData: () => liveData.current,
}));

import Currency from '../src/components/Currency.jsx';
import NotificationsDrawer from '../src/components/NotificationsDrawer.jsx';

afterEach(() => cleanup());

function dashboardState(overrides = {}) {
  return {
    availableCurrencies: ['USD', 'SGD'],
    getRate: (from, to) => (from === to ? 1 : 1.25),
    dataMode: 'LIVE',
    dashboardCurrency: 'USD',
    intel: [],
    newsLive: false,
    newsLoading: false,
    pricesUpdatedAt: null,
    pricesLoading: false,
    refresh: vi.fn(),
    notifications: [],
    triggeredAlerts: [],
    clearTriggered: vi.fn(),
    newsUpdatedAt: null,
    requestNotificationPermission: vi.fn(),
    ...overrides,
  };
}

function renderNewsSurfaces(overrides) {
  liveData.current = dashboardState(overrides);
  const currency = render(<Currency />);
  const currencyHeading = within(currency.container).getByRole('heading', {
    name: 'Currency & Markets News',
  });
  const currencyHeader = currencyHeading.parentElement;
  render(<NotificationsDrawer open onClose={() => {}} />);
  return {
    currency,
    currencyHeader,
    drawer: screen.getByRole('dialog', { name: 'Alerts & notifications' }),
  };
}

describe('news availability copy', () => {
  it('says fetching only while the news request is in flight', () => {
    const { currencyHeader, drawer } = renderNewsSurfaces({
      newsLive: false,
      newsLoading: true,
    });

    expect(within(currencyHeader).getByText('fetching')).toBeInTheDocument();
    expect(within(drawer).getByText('fetching')).toBeInTheDocument();
  });

  it('says unavailable after a failed news load completes', () => {
    const { currency, currencyHeader, drawer } = renderNewsSurfaces({
      newsLive: false,
      newsLoading: false,
    });

    expect(within(currencyHeader).getByText('unavailable')).toBeInTheDocument();
    expect(within(drawer).getByText('news unavailable · price alerts remain active')).toBeInTheDocument();
    expect(currency.container).not.toHaveTextContent(/feed loading/i);
    expect(within(drawer).queryByText('fetching')).not.toBeInTheDocument();
  });

  it('keeps both statuses live when fresh news is available', () => {
    const { currencyHeader, drawer } = renderNewsSurfaces({
      newsLive: true,
      newsLoading: false,
    });

    expect(within(currencyHeader).getByText('live')).toBeInTheDocument();
    expect(within(drawer).getByText('live news + price alerts')).toBeInTheDocument();
  });
});
