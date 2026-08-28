// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Intel from '../src/components/Intel.jsx';
import Portfolio from '../src/components/Portfolio.jsx';
import SegmentedTabs from '../src/components/SegmentedTabs.jsx';
import EntityProfile from '../src/components/smart-money/EntityProfile.jsx';
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
    idPrefix="intel-view"
    label="Intel view"
    value="news"
    onChange={onChange}
    tabs={[{ id: 'news', label: 'News Feed' }, { id: 'smart-money', label: 'Smart Money' }]}
  />);
  const newsTab = screen.getByRole('tab', { name: 'News Feed' });
  expect(newsTab).toHaveAttribute('aria-selected', 'true');
  expect(newsTab).toHaveAttribute('id', 'intel-view-tab-news');
  expect(newsTab).toHaveAttribute('aria-controls', 'intel-view-panel-news');
  await user.click(screen.getByRole('tab', { name: 'Smart Money' }));
  expect(onChange).toHaveBeenCalledWith('smart-money');
  await user.keyboard('{ArrowLeft}');
  expect(onChange).toHaveBeenLastCalledWith('news');
  expect(screen.getByRole('tab', { name: 'News Feed' })).toHaveFocus();
});

it('associates the active Intel view with its selected tab', () => {
  installRoutes();
  render(
    <SmartMoneyProvider>
      <Intel view="smart-money" />
    </SmartMoneyProvider>,
  );

  const tab = screen.getByRole('tab', { name: 'Smart Money' });
  const panel = screen.getByRole('tabpanel');
  expect(tab).toHaveAttribute('id', 'intel-view-tab-smart-money');
  expect(tab).toHaveAttribute('aria-controls', 'intel-view-panel-smart-money');
  expect(panel).toHaveAttribute('id', 'intel-view-panel-smart-money');
  expect(panel).toHaveAttribute('aria-labelledby', 'intel-view-tab-smart-money');
});

it('associates the active Portfolio view with its selected tab', () => {
  installRoutes();
  render(
    <SmartMoneyProvider>
      <Portfolio view="simulation-readiness" />
    </SmartMoneyProvider>,
  );

  const tab = screen.getByRole('tab', { name: 'Simulation readiness' });
  const panel = screen.getByRole('tabpanel');
  expect(tab).toHaveAttribute('id', 'portfolio-view-tab-simulation-readiness');
  expect(tab).toHaveAttribute('aria-controls', 'portfolio-view-panel-simulation-readiness');
  expect(panel).toHaveAttribute('id', 'portfolio-view-panel-simulation-readiness');
  expect(panel).toHaveAttribute('aria-labelledby', 'portfolio-view-tab-simulation-readiness');
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
  const profile = screen.getByRole('region', { name: 'Situational Awareness LP' });
  const source = within(profile).getByRole('link', { name: 'SEC EDGAR' });
  expect(source).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
  expect(source).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

it('labels an SEC profile source as SEC EDGAR instead of an official site', () => {
  const entity = {
    ...SMART_MONEY_RESPONSE.entities[0],
    officialUrls: ['https://www.sec.gov/edgar/browse/?CIK=1050446'],
  };
  render(
    <EntityProfile
      entity={entity}
      activities={[]}
      signals={[]}
      onClose={vi.fn()}
    />,
  );

  const source = screen.getByRole('link', { name: 'SEC EDGAR' });
  expect(source).toHaveAttribute('href', 'https://www.sec.gov/edgar/browse/?CIK=1050446');
  expect(screen.queryByRole('link', { name: 'Official site' })).not.toBeInTheDocument();
});

it('shows exact fail-closed simulation readiness with no activation controls', () => {
  const { container } = render(<SimulationReadiness capability={RESEARCH_ONLY_CAPABILITY} />);
  expect(screen.getByText(
    'No rights-cleared free market-price source is currently enabled for simulation entry or daily marking. Dashboard market data remains display-only; signals are research-only, and no simulated transaction was created.',
  )).toBeVisible();
  expect(screen.getByText(/does not recommend, prepare, route, sign, or execute trades/i)).toBeVisible();
  expect(within(container).queryByRole('button')).not.toBeInTheDocument();
  expect(within(container).queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/starting balance|cash|equity|performance return/i);
});
