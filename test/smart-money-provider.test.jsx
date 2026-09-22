// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SmartMoneyProvider } from '../src/state/SmartMoney.jsx';
import { SmartMoneyProbe } from './helpers/smart-money-ui.jsx';
import {
  SMART_MONEY_BRIEFING_RESPONSE,
  SMART_MONEY_RESPONSE,
  jsonResponse,
} from './fixtures/smart-money/client.js';

const originalFetch = globalThis.fetch;

function routeFetch(overrides = {}) {
  return vi.fn(async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('/api/smart-money/briefing')) {
      return overrides.briefing?.(target, options)
        ?? jsonResponse(SMART_MONEY_BRIEFING_RESPONSE);
    }
    if (target.startsWith('/api/smart-money')) {
      return overrides.snapshot?.(target, options)
        ?? jsonResponse(SMART_MONEY_RESPONSE);
    }
    throw new Error(`Unexpected fetch: ${target}`);
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  globalThis.fetch = originalFetch;
});

it('makes no automatic requests when mounted hidden and loads once on return', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-27T05:59:00Z'));
  let hidden = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  globalThis.fetch = routeFetch();
  render(<SmartMoneyProvider><SmartMoneyProbe /></SmartMoneyProvider>);

  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();

  await act(async () => {
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('entity-count')).toHaveTextContent('1');
});

it('pauses scheduled reads while hidden and preserves accepted data through a failed return', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-27T05:59:00Z'));
  let hidden = false;
  let failed = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  globalThis.fetch = routeFetch({
    snapshot: () => {
      if (failed) throw new Error('return refresh failed');
      return jsonResponse(SMART_MONEY_RESPONSE);
    },
  });
  await act(async () => {
    render(<SmartMoneyProvider><SmartMoneyProbe /></SmartMoneyProvider>);
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);

  await act(async () => {
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('entity-count')).toHaveTextContent('1');

  await act(async () => {
    failed = true;
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  expect(screen.getByTestId('entity-count')).toHaveTextContent('1');
  expect(screen.getByTestId('smart-error')).toHaveTextContent('return refresh failed');
});

it('retains scheduled visible refreshes and stops their timers after unmount', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-27T06:04:00Z'));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  globalThis.fetch = routeFetch();
  let view;
  await act(async () => {
    view = render(<SmartMoneyProvider><SmartMoneyProbe /></SmartMoneyProvider>);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
    '/api/smart-money', '/api/smart-money/briefing',
    '/api/smart-money?refresh=1', '/api/smart-money/briefing?refresh=1',
  ]);

  view.unmount();
  await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(globalThis.fetch).toHaveBeenCalledTimes(4);
});

it('loads snapshot and briefing independently using public GET requests', async () => {
  globalThis.fetch = routeFetch();
  render(<SmartMoneyProvider><SmartMoneyProbe /></SmartMoneyProvider>);

  await waitFor(() => expect(screen.getByTestId('entity-count')).toHaveTextContent('1'));
  await waitFor(() => expect(screen.getByTestId('briefing-date')).toHaveTextContent('2026-08-27'));
  expect(screen.getByTestId('simulation-status')).toHaveTextContent('research_only');
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  for (const [, options] of globalThis.fetch.mock.calls) {
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(options.credentials).toBe('omit');
    expect(options.headers).not.toHaveProperty('Authorization');
  }
});

it('keeps last-known-good data after a snapshot refresh failure', async () => {
  const user = userEvent.setup();
  let snapshotCalls = 0;
  globalThis.fetch = routeFetch({
    snapshot: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return jsonResponse(SMART_MONEY_RESPONSE);
      throw new Error('network down');
    },
  });
  render(<SmartMoneyProvider><SmartMoneyProbe /></SmartMoneyProvider>);
  await waitFor(() => expect(screen.getByTestId('entity-count')).toHaveTextContent('1'));

  await user.click(screen.getByRole('button', { name: /^refresh smart money$/i }));

  await waitFor(() => expect(screen.getByTestId('smart-error')).toHaveTextContent(/network down/i));
  expect(screen.getByTestId('entity-count')).toHaveTextContent('1');
  expect(globalThis.fetch.mock.calls.map(([url]) => String(url))).not.toContain('/api/smart-money/refresh');
});

it('does not let a slower earlier snapshot response overwrite a newer refresh', async () => {
  const user = userEvent.setup();
  let releaseFirst;
  const first = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const newer = {
    ...SMART_MONEY_RESPONSE,
    fetchedAt: '2026-08-27T01:00:00.000Z',
    entities: [SMART_MONEY_RESPONSE.entities[0], {
      ...SMART_MONEY_RESPONSE.entities[0], id: 'strategy', displayName: 'Strategy',
    }],
  };
  globalThis.fetch = routeFetch({
    snapshot: async () => {
      calls += 1;
      if (calls === 1) {
        await first;
        return jsonResponse(SMART_MONEY_RESPONSE);
      }
      return jsonResponse(newer);
    },
  });
  render(<SmartMoneyProvider><SmartMoneyProbe /></SmartMoneyProvider>);
  await user.click(screen.getByRole('button', { name: /^refresh smart money$/i }));
  await waitFor(() => expect(screen.getByTestId('entity-count')).toHaveTextContent('2'));
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByTestId('entity-count')).toHaveTextContent('2');
});

it('retains the accepted briefing when a later briefing has wrong Smart Money paragraph IDs', async () => {
  const user = userEvent.setup();
  let calls = 0;
  globalThis.fetch = routeFetch({
    briefing: () => {
      calls += 1;
      if (calls === 1) return jsonResponse(SMART_MONEY_BRIEFING_RESPONSE);
      const malformed = structuredClone(SMART_MONEY_BRIEFING_RESPONSE);
      malformed.briefing.paragraphs[0].id = 'untrusted-section';
      return jsonResponse(malformed);
    },
  });
  render(<SmartMoneyProvider><SmartMoneyProbe /></SmartMoneyProvider>);
  await waitFor(() => expect(screen.getByTestId('briefing-date')).toHaveTextContent('2026-08-27'));
  expect(screen.getByTestId('briefing-first-id')).toHaveTextContent('market-regime');
  await user.click(screen.getByRole('button', { name: /refresh smart money briefing/i }));
  expect(screen.getByTestId('briefing-date')).toHaveTextContent('2026-08-27');
  expect(screen.getByTestId('briefing-first-id')).toHaveTextContent('market-regime');
});
