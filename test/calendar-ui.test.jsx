// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

function provider(id, shortName, status = 'live', overrides = {}) {
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
    ...overrides,
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
    // Catches making a provider-wide calendar subscription look like event details.
    globalThis.fetch = vi.fn(async () => response(payload()));

    render(<EconomicCalendar />);

    expect(await screen.findByRole('status', { name: /economic calendar status/i })).toHaveTextContent('LIVE');
    expect(screen.getByText('Consumer Price Index')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Consumer Price Index' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /U.S. Bureau of Labor Statistics calendar subscription/i })).toHaveAttribute(
      'href',
      'https://www.bls.gov/schedule/news_release/bls.ics',
    );
    expect(screen.getAllByText('8:30 AM ET')).toHaveLength(2);
    expect(screen.queryByRole('columnheader', { name: /forecast/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /prior/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /impact/i })).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/calendar', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('renders the OMB/OIRA fallback as date-only with its exact Census source', async () => {
    const sourceUrl = 'https://www.census.gov/economic-indicators/econcards/assets/pdf/censusreleaseglance_2026.pdf';
    globalThis.fetch = vi.fn(async () => response(payload({
      providers: [
        provider('bls', 'OMB/BLS', 'live', {
          name: 'BLS principal releases via OMB/OIRA',
          sourceUrl,
        }),
        provider('bea', 'BEA'),
        provider('federal-reserve', 'Fed'),
      ],
      events: [event({
        id: 'bls:2026-09-04:the-employment-situation',
        title: 'The Employment Situation',
        sourceName: 'BLS principal releases via OMB/OIRA',
        sourceShortName: 'OMB/BLS',
        sourceUrl,
        date: '2026-09-04',
        endDate: '2026-09-04',
        startsAt: null,
        timeZone: null,
        timeStatus: 'date-only',
        timeLabel: 'Date only',
      })],
    })));

    render(<EconomicCalendar />);

    const eventTitle = await screen.findByText('The Employment Situation');
    const eventRow = eventTitle.closest('tr');
    expect(screen.queryByRole('link', { name: 'The Employment Situation' })).not.toBeInTheDocument();
    expect(within(eventRow).getAllByText('Date only').length).toBeGreaterThan(0);
    expect(within(eventRow).getByText('OMB/BLS')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /BLS principal releases via OMB\/OIRA annual schedule PDF/i })).toHaveAttribute('href', sourceUrl);
    expect(screen.queryByText('8:30 AM ET')).not.toBeInTheDocument();
  });

  it('uses an official event-specific page when the provider supplies one', async () => {
    // Catches discarding an event detail URL and sending the title to a generic calendar instead.
    const eventUrl = 'https://fred.stlouisfed.org/release?rid=50';
    globalThis.fetch = vi.fn(async () => response(payload({
      providers: [
        provider('bls', 'FRED/BLS', 'live', {
          name: 'BLS releases via FRED',
          sourceUrl: 'https://fred.stlouisfed.org/releases/calendar',
        }),
        provider('bea', 'BEA'),
        provider('federal-reserve', 'Fed'),
      ],
      events: [event({
        id: 'bls:2026-09-04:employment-situation',
        title: 'Employment Situation',
        sourceName: 'BLS releases via FRED',
        sourceShortName: 'FRED/BLS',
        sourceUrl: 'https://fred.stlouisfed.org/releases/calendar?rid=50',
        eventUrl,
      })],
    })));

    render(<EconomicCalendar />);

    expect(await screen.findByRole('link', { name: 'Employment Situation' })).toHaveAttribute('href', eventUrl);
    expect(screen.getByRole('link', { name: /BLS releases via FRED release calendar/i })).toHaveAttribute(
      'href',
      'https://fred.stlouisfed.org/releases/calendar',
    );
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
    expect(screen.getByText('Consumer Price Index')).toBeInTheDocument();
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
