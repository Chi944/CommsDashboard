// @vitest-environment jsdom

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Intel from '../src/components/Intel.jsx';
import Portfolio from '../src/components/Portfolio.jsx';
import SegmentedTabs from '../src/components/SegmentedTabs.jsx';
import EntityDirectory from '../src/components/smart-money/EntityDirectory.jsx';
import EntityProfile from '../src/components/smart-money/EntityProfile.jsx';
import ProviderHealthPanel from '../src/components/smart-money/ProviderHealthPanel.jsx';
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

it('describes the public Smart Money refresh as a snapshot update check', async () => {
  const user = userEvent.setup();
  installRoutes();
  render(
    <SmartMoneyProvider>
      <SmartMoneyView />
    </SmartMoneyProvider>,
  );

  const refresh = await screen.findByRole('button', { name: /check for updates/i });
  expect(screen.getByText(/accepted snapshot 2026-08-27/i)).toBeVisible();
  expect(screen.getByText(/providers update automatically/i)).toBeVisible();
  await user.click(refresh);
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/smart-money?refresh=1', expect.any(Object)));
});

it('moves an opened research profile into view and keyboard focus', async () => {
  const user = userEvent.setup();
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  installRoutes();

  try {
    render(
      <SmartMoneyProvider>
        <SmartMoneyView />
      </SmartMoneyProvider>,
    );
    await waitFor(() => expect(screen.getByText('Situational Awareness LP')).toBeVisible());

    await user.click(screen.getByRole('button', { name: /open situational awareness lp research profile/i }));

    const profile = screen.getByRole('region', { name: 'Situational Awareness LP' });
    await waitFor(() => expect(profile).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  } finally {
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      delete HTMLElement.prototype.scrollIntoView;
    }
  }
});

it('opens SEC filing evidence in a readable filing page instead of raw JSON', () => {
  render(
    <EntityProfile
      entity={SMART_MONEY_RESPONSE.entities[0]}
      activities={[{
        id: 'activity:sec-edgar:0000919574-26-004796',
        entityId: 'situational-awareness-lp',
        providerId: 'sec-edgar',
        sourceStableId: '0000919574-26-004796',
        sourceUrl: 'https://www.sec.gov/Archives/edgar/data/2045724/000091957426004796/index.json',
        summary: 'Newest accepted filing.',
        effectiveAt: '2026-08-04T00:00:00.000Z',
        disclosedAt: '2026-08-04T00:00:00.000Z',
        observedAt: '2026-08-27T00:00:00.000Z',
      }]}
      signals={[]}
      onClose={vi.fn()}
    />,
  );

  const filing = screen.getByRole('link', { name: /view sec filing/i });
  expect(filing).toHaveAttribute(
    'href',
    'https://www.sec.gov/Archives/edgar/data/2045724/000091957426004796/0000919574-26-004796-index.html',
  );
  expect(filing.getAttribute('href')).not.toMatch(/\.json(?:$|[?#])/i);
});

it('opens provider coverage in the human SEC filings browser instead of the submissions API', () => {
  render(
    <ProviderHealthPanel
      statuses={SMART_MONEY_RESPONSE.providerStatuses}
      sourceLinks={SMART_MONEY_RESPONSE.sourceLinks}
    />,
  );

  const source = screen.getByRole('link', { name: /browse sec filings/i });
  expect(source).toHaveAttribute('href', 'https://www.sec.gov/edgar/browse/?CIK=2045724');
  expect(source.getAttribute('href')).not.toMatch(/data\.sec\.gov|\.json(?:$|[?#])/i);
});

it('shows the newest disclosed finding first when retrieval timestamps tie', () => {
  const shared = {
    entityId: 'situational-awareness-lp',
    providerId: 'sec-edgar',
    effectiveAt: '2026-08-01T00:00:00.000Z',
    observedAt: '2026-08-31T18:56:07.300Z',
  };
  render(
    <EntityProfile
      entity={SMART_MONEY_RESPONSE.entities[0]}
      activities={[
        {
          ...shared,
          id: 'older',
          sourceStableId: '0000919574-26-004796',
          sourceUrl: 'https://www.sec.gov/older.htm',
          summary: 'Older filing',
          disclosedAt: '2026-08-04T00:00:00.000Z',
        },
        {
          ...shared,
          id: 'newer',
          sourceStableId: '0000935836-26-000468',
          sourceUrl: 'https://www.sec.gov/newer.htm',
          summary: 'Newest filing',
          disclosedAt: '2026-08-28T00:00:00.000Z',
        },
      ]}
      signals={[]}
      onClose={vi.fn()}
    />,
  );

  const findings = screen.getAllByRole('listitem');
  expect(findings[0]).toHaveTextContent('Newest filing');
  expect(findings[1]).toHaveTextContent('Older filing');
});

it('turns local following into a usable followed-only shortlist', async () => {
  const user = userEvent.setup();
  const base = SMART_MONEY_RESPONSE.entities[0];
  const entities = [
    { ...base, id: 'alpha-investor', displayName: 'Alpha Investor', legalEntity: 'Alpha Investor', directoryCategory: 'investors', people: [] },
    { ...base, id: 'zeta-fund', displayName: 'Zeta Fund', legalEntity: 'Zeta Fund', directoryCategory: 'institutional-flows', people: [] },
  ];
  function DirectoryHarness() {
    const [followed, setFollowed] = React.useState([]);
    return (
      <EntityDirectory
        entities={entities}
        followedEntityIds={followed}
        onFollow={(id) => setFollowed((current) => [...current, id])}
        onUnfollow={(id) => setFollowed((current) => current.filter((value) => value !== id))}
        onOpen={vi.fn()}
      />
    );
  }
  render(<DirectoryHarness />);

  await user.click(screen.getByRole('button', { name: /follow zeta fund/i }));
  await user.click(screen.getByRole('button', { name: /following \(1\)/i }));
  expect(screen.getByText('Zeta Fund')).toBeVisible();
  expect(screen.queryByText('Alpha Investor')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /unfollow zeta fund/i }));
  expect(screen.getByText(/no followed research subjects yet/i)).toBeVisible();
});

it('keeps category order stable when a subject is followed', async () => {
  const user = userEvent.setup();
  const base = SMART_MONEY_RESPONSE.entities[0];
  const entities = [
    { ...base, id: 'alpha-investor', displayName: 'Alpha Investor', legalEntity: 'Alpha Investor', directoryCategory: 'investors', people: [] },
    { ...base, id: 'zeta-fund', displayName: 'Zeta Fund', legalEntity: 'Zeta Fund', directoryCategory: 'institutional-flows', people: [] },
  ];
  function DirectoryHarness() {
    const [followed, setFollowed] = React.useState([]);
    return (
      <EntityDirectory
        entities={entities}
        followedEntityIds={followed}
        onFollow={(id) => setFollowed([id])}
        onUnfollow={() => setFollowed([])}
        onOpen={vi.fn()}
      />
    );
  }
  render(<DirectoryHarness />);

  await user.click(screen.getByRole('button', { name: /follow zeta fund/i }));
  const investors = screen.getByText('Investors');
  const institutional = screen.getByText('Institutional crypto flows');
  expect(investors.compareDocumentPosition(institutional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('shows a clear empty result when directory search has no matches', async () => {
  const user = userEvent.setup();
  render(
    <EntityDirectory
      entities={SMART_MONEY_RESPONSE.entities}
      followedEntityIds={[]}
      onFollow={vi.fn()}
      onUnfollow={vi.fn()}
      onOpen={vi.fn()}
    />,
  );

  await user.type(screen.getByRole('searchbox', { name: /search directory/i }), 'no-such-subject');
  expect(screen.getByText(/no research subjects match/i)).toBeVisible();
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

it('clearly identifies source-only profiles without implying a monitored feed', () => {
  const sourceOnly = {
    ...SMART_MONEY_RESPONSE.entities[0],
    id: 'pershing-square',
    displayName: 'Pershing Square',
    evidenceCoverage: 'official-performance-link-only',
    performanceVerification: { status: 'official_reported' },
    officialUrls: ['https://pershingsquareholdings.com/performance/nav/'],
  };
  render(
    <EntityProfile
      entity={sourceOnly}
      activities={[]}
      signals={[]}
      onClose={vi.fn()}
    />,
  );

  expect(screen.getByText(/source-only profile/i)).toBeVisible();
  expect(screen.getByText(/no monitored activity feed/i)).toBeVisible();
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
