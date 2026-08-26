// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Briefing from '../src/components/Briefing.jsx';

const originalFetch = globalThis.fetch;

function response(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function payload({
  marketDate = '2030-01-03',
  generatedAt = '2030-01-03T12:00:00.000Z',
  source = 'generated',
  label = 'Current',
  inputsAsOf = {
    market: '2030-01-03T11:58:00.000Z',
    marketFetchedAt: '2030-01-03T11:59:00.000Z',
    news: null,
    newsFetchedAt: null,
    sentiment: '2030-01-03T11:57:00.000Z',
  },
} = {}) {
  const evidence = [
    {
      id: 'market:gainer:NVDA',
      label: `${label} NVDA +2.50%`,
      source: 'Yahoo',
      sourceUrl: 'https://finance.yahoo.com/quote/NVDA',
      asOf: '2030-01-03T11:58:00.000Z',
    },
    {
      id: 'news:unsafe',
      label: `${label} unsafe news reference`,
      source: 'Unknown',
      sourceUrl: 'javascript:alert(1)',
      asOf: '2030-01-03T11:56:00.000Z',
    },
    {
      id: 'sentiment:fear-greed',
      label: `${label} sentiment 61`,
      source: 'Alternative.me',
      sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/',
      asOf: '2030-01-03T11:57:00.000Z',
    },
  ];
  const paragraphs = [
    {
      id: 'market-tone',
      text: `${label} market tone paragraph.`,
      evidenceIds: ['market:gainer:NVDA'],
    },
    {
      id: 'themes-catalysts',
      text: `${label} themes and catalysts paragraph.`,
      evidenceIds: ['news:unsafe'],
    },
    {
      id: 'watchpoints',
      text: `${label} watchpoints paragraph. Informational only — not financial advice.`,
      evidenceIds: ['sentiment:fear-greed'],
    },
  ];
  return {
    ok: true,
    generatedAt,
    marketDate,
    source,
    inputsAsOf,
    evidence,
    paragraphs,
    text: paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    aiAvailable: true,
    aiError: source === 'deterministic' ? 'provider internals must not be rendered' : null,
    aiStatus: source === 'generated'
      ? { state: 'ready', source: 'generated', retryable: false }
      : { state: 'degraded', source: 'deterministic', retryable: true },
    briefing: {
      source,
      marketDate,
      generatedAt,
      model: source === 'generated' ? 'openai/gpt-oss-120b' : undefined,
      inputsAsOf,
      evidence,
      paragraphs,
      text: paragraphs.map((paragraph) => paragraph.text).join('\n\n'),
    },
    signals: {
      gainers: [{ ticker: 'NVDA', name: 'NVIDIA', changePct: 2.5 }],
      losers: [{ ticker: 'TSLA', name: 'Tesla', changePct: -1.25 }],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe('daily market briefing UI', () => {
  it('renders the ordered structured contract, safe evidence, independent input states, and a GET-only request', async () => {
    globalThis.fetch = vi.fn(async () => response(payload()));

    const { container } = render(<Briefing />);

    expect(await screen.findByText('Current market tone paragraph.')).toBeInTheDocument();
    const paragraphs = [...container.querySelectorAll('[data-briefing-paragraph-id]')];
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map((node) => node.dataset.briefingParagraphId)).toEqual([
      'market-tone',
      'themes-catalysts',
      'watchpoints',
    ]);

    expect(screen.getByRole('status', { name: /briefing source/i })).toHaveTextContent('AI generated');
    expect(screen.getByText(/Market prices input/i).closest('li')).toHaveTextContent(/current/i);
    expect(screen.getByText(/Headlines input/i).closest('li')).toHaveTextContent(/unavailable/i);
    expect(screen.getByText(/Sentiment input/i).closest('li')).toHaveTextContent(/current/i);
    expect(screen.queryByText(/market feed (?:degraded|not live)/i)).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Current NVDA \+2\.50%/i }))
      .toHaveAttribute('href', 'https://finance.yahoo.com/quote/NVDA');
    expect(screen.getByRole('link', { name: /Current sentiment 61/i }))
      .toHaveAttribute('href', 'https://alternative.me/crypto/fear-and-greed-index/');
    expect(screen.queryByRole('link', { name: /unsafe news reference/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Current unsafe news reference/i).tagName).toBe('SPAN');

    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('TSLA')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/briefing', {
      method: 'GET',
      credentials: 'omit',
    });
    expect(globalThis.fetch.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('keeps last-known-good paragraphs visible through pending, null, older, and failed refreshes', async () => {
    const user = userEvent.setup();
    const pending = [];
    globalThis.fetch = vi.fn(async () => {
      if (pending.length === 0) return response(payload({ label: 'Accepted' }));
      return pending.at(-1).promise;
    });

    render(<Briefing />);
    expect(await screen.findByText('Accepted market tone paragraph.')).toBeInTheDocument();

    const nullRefresh = deferred();
    pending.push(nullRefresh);
    await user.click(screen.getByRole('button', { name: /refresh market briefing/i }));
    expect(screen.getByText('Accepted market tone paragraph.')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /refreshing market briefing/i })).toBeInTheDocument();
    await act(async () => { nullRefresh.resolve(response({ ok: true, briefing: null })); });
    await waitFor(() => expect(screen.getByRole('button', { name: /refresh market briefing/i })).toBeEnabled());
    expect(screen.getByText('Accepted market tone paragraph.')).toBeInTheDocument();

    const malformedRefresh = deferred();
    pending.push(malformedRefresh);
    await user.click(screen.getByRole('button', { name: /refresh market briefing/i }));
    const malformed = payload({ label: 'Malformed' });
    malformed.briefing.paragraphs = [
      malformed.briefing.paragraphs[1],
      malformed.briefing.paragraphs[0],
      malformed.briefing.paragraphs[2],
    ];
    await act(async () => { malformedRefresh.resolve(response(malformed)); });
    await waitFor(() => expect(screen.getByRole('button', { name: /refresh market briefing/i })).toBeEnabled());
    expect(screen.getByText('Accepted market tone paragraph.')).toBeInTheDocument();
    expect(screen.queryByText('Malformed market tone paragraph.')).not.toBeInTheDocument();

    const olderRefresh = deferred();
    pending.push(olderRefresh);
    await user.click(screen.getByRole('button', { name: /refresh market briefing/i }));
    await act(async () => {
      olderRefresh.resolve(response(payload({
        marketDate: '2030-01-02',
        generatedAt: '2030-01-03T13:00:00.000Z',
        label: 'Older',
      })));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /refresh market briefing/i })).toBeEnabled());
    expect(screen.getByText('Accepted market tone paragraph.')).toBeInTheDocument();
    expect(screen.queryByText('Older market tone paragraph.')).not.toBeInTheDocument();

    const failedRefresh = deferred();
    pending.push(failedRefresh);
    await user.click(screen.getByRole('button', { name: /refresh market briefing/i }));
    await act(async () => { failedRefresh.reject(new Error('sk-live-secret provider raw failure')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Briefing refresh failed');
    expect(screen.getByText('Accepted market tone paragraph.')).toBeInTheDocument();
    expect(screen.queryByText(/sk-live-secret|provider raw/i)).not.toBeInTheDocument();
  });

  it('does not let a late response from the prior UTC day replace the newer request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-02T23:59:30.000Z'));
    const first = deferred();
    const second = deferred();
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });

    render(<Briefing />);
    await act(async () => { await Promise.resolve(); });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2030-01-03T00:00:05.000Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(response(payload({ label: 'New day' })));
      await Promise.resolve();
    });
    expect(screen.getByText('New day market tone paragraph.')).toBeInTheDocument();

    await act(async () => {
      first.resolve(response(payload({
        marketDate: '2030-01-02',
        generatedAt: '2030-01-02T23:59:40.000Z',
        label: 'Late prior day',
      })));
      await Promise.resolve();
    });
    expect(screen.getByText('New day market tone paragraph.')).toBeInTheDocument();
    expect(screen.queryByText('Late prior day market tone paragraph.')).not.toBeInTheDocument();
  });

  it('labels deterministic content as an AI fallback without marking current market inputs non-live', async () => {
    const deterministic = payload({
      source: 'deterministic',
      inputsAsOf: {
        market: '2030-01-03T11:58:00.000Z',
        marketFetchedAt: '2030-01-03T11:59:00.000Z',
        news: '2030-01-03T11:56:00.000Z',
        newsFetchedAt: '2030-01-03T11:59:00.000Z',
        sentiment: '2030-01-03T11:57:00.000Z',
      },
    });
    globalThis.fetch = vi.fn(async () => response(deterministic));

    render(<Briefing />);

    expect(await screen.findByRole('status', { name: /briefing source/i }))
      .toHaveTextContent(/deterministic fallback/i);
    expect(screen.getByText(/Market prices input/i).closest('li')).toHaveTextContent(/current/i);
    expect(screen.getByText(/Headlines input/i).closest('li')).toHaveTextContent(/current/i);
    expect(screen.getByText(/Sentiment input/i).closest('li')).toHaveTextContent(/current/i);
    expect(screen.queryByText(/provider internals|market feed (?:degraded|not live)/i)).not.toBeInTheDocument();
  });
});
