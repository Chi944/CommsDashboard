// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EconomicCalendar from '../src/components/EconomicCalendar.jsx';

const originalFetch = globalThis.fetch;

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

function provider(id, shortName, status = 'live') {
  const metadata = {
    bls: ['U.S. Bureau of Labor Statistics', 'https://www.bls.gov/schedule/news_release/bls.ics'],
    bea: ['U.S. Bureau of Economic Analysis', 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics'],
    'federal-reserve': ['Federal Reserve', 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'],
  }[id];
  return {
    id,
    name: metadata[0],
    shortName,
    sourceUrl: metadata[1],
    status,
    eventCount: status === 'live' ? 1 : 0,
    fetchedAt: status === 'live' ? '2026-08-28T15:00:00.000Z' : null,
    sourceLastModifiedAt: null,
  };
}

function event(overrides = {}) {
  return {
    id: 'bls:bls-cpi-september',
    title: 'Consumer Price Index',
    kind: 'economic-release',
    sourceId: 'bls',
    sourceName: 'U.S. Bureau of Labor Statistics',
    sourceShortName: 'BLS',
    sourceUrl: 'https://www.bls.gov/schedule/news_release/bls.ics',
    date: '2026-09-11',
    endDate: '2026-09-11',
    startsAt: '2026-09-11T12:30:00.000Z',
    timeZone: 'America/New_York',
    timeStatus: 'scheduled',
    timeLabel: '8:30 AM ET',
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    ok: true,
    partial: false,
    degraded: false,
    state: 'live',
    fetchedAt: '2026-08-28T15:00:00.000Z',
    asOf: '2026-08-28T15:00:00.000Z',
    window: { from: '2026-08-28', through: '2026-11-26', days: 90 },
    providers: [provider('bls', 'BLS'), provider('bea', 'BEA'), provider('federal-reserve', 'Fed')],
    events: [event()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-28T15:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe('official economic calendar', () => {
  it('shows a live official event with exact source attribution and no invented market estimates', async () => {
    // Catches reintroducing unsourced forecast/prior values or search-engine links.
    globalThis.fetch = vi.fn(async () => response(payload()));

    render(<EconomicCalendar />);

    expect(await screen.findByRole('status', { name: /economic calendar status/i })).toHaveTextContent('LIVE');
    expect(screen.getByRole('link', { name: 'Consumer Price Index' })).toHaveAttribute(
      'href',
      'https://www.bls.gov/schedule/news_release/bls.ics',
    );
    expect(screen.getByText('8:30 AM ET')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /U.S. Bureau of Labor Statistics/i })).toHaveAttribute(
      'href',
      'https://www.bls.gov/schedule/news_release/bls.ics',
    );
    expect(screen.queryByRole('columnheader', { name: /forecast/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /prior/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /impact/i })).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/calendar', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('keeps available events visible and names a failed provider in degraded mode', async () => {
    // Catches hiding healthy provider data when one official schedule is unavailable.
    globalThis.fetch = vi.fn(async () => response(payload({
      partial: true,
      degraded: true,
      state: 'degraded',
      providers: [provider('bls', 'BLS'), provider('bea', 'BEA'), provider('federal-reserve', 'Fed', 'unavailable')],
    })));

    render(<EconomicCalendar />);

    expect(await screen.findByRole('status', { name: /economic calendar status/i })).toHaveTextContent('DEGRADED');
    expect(screen.getByRole('alert')).toHaveTextContent(/Federal Reserve is temporarily unavailable/i);
    expect(screen.getByRole('link', { name: 'Consumer Price Index' })).toBeInTheDocument();
  });

  it('shows an honest unavailable state and retries the public route', async () => {
    // Catches falling back to stale hard-coded events after every official source fails.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response({
        ...payload({ ok: false, partial: true, degraded: true, state: 'unavailable', events: [] }),
        error: { code: 'calendar_unavailable', message: 'Official economic calendars are temporarily unavailable.' },
      }, { ok: false, status: 502 }))
      .mockResolvedValueOnce(response(payload()));

    render(<EconomicCalendar />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Economic calendar unavailable/i);
    await user.click(screen.getByRole('button', { name: /retry economic calendar/i }));

    await waitFor(() => expect(screen.getByRole('status', { name: /economic calendar status/i })).toHaveTextContent('LIVE'));
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('reports loading while the bounded browser request is pending', () => {
    // Catches presenting cached-looking rows before a source response exists.
    globalThis.fetch = vi.fn(() => new Promise(() => {}));

    render(<EconomicCalendar />);

    expect(screen.getByRole('status', { name: /economic calendar status/i })).toHaveTextContent('LOADING');
    expect(screen.queryByRole('link', { name: 'Consumer Price Index' })).not.toBeInTheDocument();
  });
});
