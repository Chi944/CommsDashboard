// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';

vi.mock('../src/lib/stockResearch.js', async (importOriginal) => ({
  ...await importOriginal(), fetchStockResearchRun: vi.fn(),
}));
import { fetchStockResearchRun } from '../src/lib/stockResearch.js';
import StockResearchSummary from '../src/components/StockResearchSummary.jsx';

const fixture = () => ({
  schema_version: '2.0.0', run_id: 'run_2026-09-04', stale_after_days: 8, passed: 1,
  candidates: [{ ticker: 'NVDA', excluded: false }, { ticker: 'AMD', excluded: true }],
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it('retains the dated weekly summary after a failed refresh and allows recovery', async () => {
  fetchStockResearchRun.mockResolvedValueOnce(fixture()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fixture());
  render(<StockResearchSummary />);
  expect(await screen.findByText('1 passed of 2 screened')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh weekly stock research' }));
  await screen.findByText(/Refresh unavailable; showing last snapshot/);
  expect(screen.getByText('1 passed of 2 screened')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh weekly stock research' }));
  await waitFor(() => expect(screen.queryByText(/Refresh unavailable/)).not.toBeInTheDocument());
});

it('a long-open summary becomes stale when its UTC as-of age reaches eight days', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-11T23:59:30Z'));
  fetchStockResearchRun.mockResolvedValue(fixture());
  render(<StockResearchSummary />);
  await act(async () => {});
  expect(screen.getByRole('status')).not.toHaveTextContent('Stale snapshot');
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByRole('status')).toHaveTextContent('Stale snapshot');
});

it('aborts a stalled optional request and leaves a retryable unavailable state', async () => {
  vi.useFakeTimers();
  fetchStockResearchRun.mockImplementation((signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  render(<StockResearchSummary />);
  await act(async () => vi.advanceTimersByTimeAsync(8_000));
  expect(screen.getByRole('status')).toHaveTextContent('Snapshot unavailable');
  expect(screen.getByRole('button', { name: 'Refresh weekly stock research' })).toBeEnabled();
});
