// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SegmentedTabs from '../src/components/SegmentedTabs.jsx';
import SimulationReadiness from '../src/components/smart-money/SimulationReadiness.jsx';
import SmartMoneyView from '../src/components/smart-money/SmartMoneyView.jsx';
import { SmartMoneyProvider } from '../src/state/SmartMoney.jsx';
import {
  RESEARCH_ONLY_CAPABILITY,
  SMART_MONEY_BRIEFING_RESPONSE,
  SMART_MONEY_RESPONSE,
  jsonResponse,
} from './fixtures/smart-money/client.js';

const originalFetch = globalThis.fetch;

function installRoutes(snapshot = SMART_MONEY_RESPONSE) {
  globalThis.fetch = vi.fn(async (url) => (
    String(url).startsWith('/api/smart-money/briefing')
      ? jsonResponse(SMART_MONEY_BRIEFING_RESPONSE)
      : jsonResponse(snapshot)
  ));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  globalThis.fetch = originalFetch;
});

it('renders accessible controlled research tabs', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<SegmentedTabs
    label="Intel view"
    value="news"
    onChange={onChange}
    tabs={[{ id: 'news', label: 'News Feed' }, { id: 'smart-money', label: 'Smart Money' }]}
  />);
  expect(screen.getByRole('tab', { name: 'News Feed' })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('tab', { name: 'Smart Money' }));
  expect(onChange).toHaveBeenCalledWith('smart-money');
  await user.keyboard('{ArrowLeft}');
  expect(onChange).toHaveBeenLastCalledWith('news');
  expect(screen.getByRole('tab', { name: 'News Feed' })).toHaveFocus();
});

it('integrates Leopold and firms without claiming unverified performance', async () => {
  const user = userEvent.setup();
  installRoutes();
  render(
    <SmartMoneyProvider>
      <SmartMoneyView />
    </SmartMoneyProvider>,
  );

  await waitFor(() => expect(screen.getByText('Situational Awareness LP')).toBeVisible());
  expect(screen.getByText('Leopold Aschenbrenner')).toBeVisible();
  expect(screen.getByText(/performance not publicly verified/i)).toBeVisible();
  expect(screen.getByText(/research intelligence only/i)).toBeVisible();
  expect(screen.getByText(/no rights-cleared free crypto-whale leaderboard/i)).toBeVisible();

  await user.click(screen.getByRole('button', { name: /follow situational awareness lp/i }));
  expect(screen.getByRole('button', { name: /unfollow situational awareness lp/i })).toBeVisible();
});

it('opens an evidence profile and links only to public sources', async () => {
  const user = userEvent.setup();
  const onRecordChange = vi.fn();
  installRoutes();
  render(
    <SmartMoneyProvider>
      <SmartMoneyView onRecordChange={onRecordChange} />
    </SmartMoneyProvider>,
  );
  await waitFor(() => expect(screen.getByText('Situational Awareness LP')).toBeVisible());
  await user.click(screen.getByRole('button', { name: /open situational awareness lp research profile/i }));
  expect(onRecordChange).toHaveBeenCalledWith('situational-awareness-lp');
  const source = screen.getByRole('link', { name: /sec edgar/i });
  expect(source).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
  expect(source).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

it('shows exact fail-closed simulation readiness with no activation controls', () => {
  const { container } = render(<SimulationReadiness capability={RESEARCH_ONLY_CAPABILITY} />);
  expect(screen.getByText(
    'No rights-cleared free market-price source is currently enabled. Signals remain research-only; no simulated transaction was created.',
  )).toBeVisible();
  expect(screen.getByText(/does not recommend, prepare, route, sign, or execute trades/i)).toBeVisible();
  expect(within(container).queryByRole('button')).not.toBeInTheDocument();
  expect(within(container).queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/starting balance|cash|equity|performance return/i);
});
