// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const liveData = vi.hoisted(() => ({ current: null }));

vi.mock('../src/state/LiveData.jsx', () => ({
  useLiveData: () => liveData.current,
}));

vi.mock('../src/state/SmartMoney.jsx', () => ({
  useSmartMoney: () => ({ simulationCapability: null }),
}));

import Portfolio from '../src/components/Portfolio.jsx';

const NVIDIA = {
  ticker: 'NVDA',
  name: 'NVIDIA',
  category: 'EQUITY',
  unit: '$',
  price: 120,
  changePct: 1,
  history: [{ price: 118 }, { price: 120 }],
};

function portfolioState(overrides = {}) {
  return {
    commodities: [
      NVIDIA,
      {
        ticker: 'NG',
        name: 'Natural Gas',
        category: 'ENERGY',
        unit: '$',
        price: 3,
        changePct: -1,
        history: [{ price: 3.1 }, { price: 3 }],
      },
    ],
    positions: [],
    upsertPosition: vi.fn(),
    removePosition: vi.fn(),
    formatAssetPrice: (_asset, value) => `$${Number(value ?? 0).toFixed(2)}`,
    dashboardCurrency: 'USD',
    convert: (value) => value,
    dataMode: 'LIVE',
    ...overrides,
  };
}

beforeEach(() => {
  liveData.current = portfolioState();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('labels every position field and exposes ticker suggestions as a combobox', async () => {
  const user = userEvent.setup();
  render(<Portfolio />);

  const ticker = screen.getByRole('combobox', { name: 'Ticker' });
  expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toBeVisible();
  expect(screen.getByRole('spinbutton', { name: 'Average cost ($)' })).toBeVisible();

  await user.type(ticker, 'nv');

  expect(ticker).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('listbox', { name: 'Ticker suggestions' })).toBeVisible();
  expect(screen.getByRole('option', { name: /NVDA NVIDIA EQUITY/i })).toBeVisible();
});

it('selects a ticker suggestion with ArrowDown and Enter', async () => {
  const user = userEvent.setup();
  render(<Portfolio />);

  const ticker = screen.getByRole('combobox', { name: 'Ticker' });
  await user.type(ticker, 'nv');
  await user.keyboard('{ArrowDown}');

  expect(screen.getByRole('option', { name: /NVDA NVIDIA EQUITY/i })).toHaveAttribute('aria-selected', 'true');

  await user.keyboard('{Enter}');

  expect(ticker).toHaveValue('NVDA');
  expect(ticker).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('listbox', { name: 'Ticker suggestions' })).not.toBeInTheDocument();
});

it('keeps Add disabled until the ticker, quantity, and average cost are valid', async () => {
  const user = userEvent.setup();
  render(<Portfolio />);

  const add = screen.getByRole('button', { name: 'Add' });
  const ticker = screen.getByRole('combobox', { name: 'Ticker' });
  const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
  const averageCost = screen.getByRole('spinbutton', { name: 'Average cost ($)' });

  expect(add).toBeDisabled();
  await user.type(ticker, 'NOPE');
  await user.type(quantity, '2');
  await user.type(averageCost, '100');
  expect(add).toBeDisabled();

  await user.clear(ticker);
  await user.type(ticker, 'NVDA');
  expect(add).toBeEnabled();

  await user.clear(quantity);
  await user.type(quantity, '0');
  expect(add).toBeDisabled();
});

it('names the position affected by each remove control', () => {
  liveData.current = portfolioState({
    positions: [{ ticker: 'NVDA', qty: 2, avgCost: 100 }],
  });

  render(<Portfolio />);

  expect(screen.getByRole('button', { name: 'Remove NVDA position' })).toBeVisible();
});

it('renders a loss with an unambiguous leading minus sign', () => {
  liveData.current = portfolioState({
    positions: [{ ticker: 'NVDA', qty: 2, avgCost: 150 }],
  });

  render(<Portfolio />);

  expect(screen.getAllByText('-$60.00')).toHaveLength(2);
});

it('names the position affected by remove even when catalogue data is unavailable', () => {
  liveData.current = portfolioState({
    positions: [{ ticker: 'MISSING', qty: 2, avgCost: 100 }],
  });

  render(<Portfolio />);

  expect(screen.getByRole('button', { name: 'Remove MISSING position' })).toBeVisible();
});
