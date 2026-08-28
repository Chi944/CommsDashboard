import { test, expect } from '@playwright/test';

const ROUTES = [
  ['Overview', '/'],
  ['Prices', '/?tab=Prices&ticker=NVDA'],
  ['Currency', '/?tab=Currency'],
  ['Portfolio holdings', '/?tab=Portfolio&view=holdings'],
  ['Portfolio simulation boundary', '/?tab=Portfolio&view=simulation-readiness'],
  ['Intel news', '/?tab=Intel&view=news'],
  ['Intel Smart Money', '/?tab=Intel&view=smart-money'],
];

const VIEWPORTS = [
  ['mobile', { width: 390, height: 844 }],
  ['tablet', { width: 768, height: 1024 }],
  ['desktop', { width: 1440, height: 900 }],
];

function approvedCalendarUrl(value, { provider = false } = {}) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (url.origin === 'https://www.bls.gov') {
      return !url.search && (
        url.pathname === '/schedule/news_release/bls.ics'
        || /^\/schedule\/20\d{2}\/$/.test(url.pathname)
      );
    }
    if (url.origin === 'https://www.bea.gov') {
      return !url.search && url.pathname === '/news/schedule/ics/online-calendar-subscription.ics';
    }
    if (url.origin === 'https://www.federalreserve.gov') {
      return !url.search && url.pathname === '/monetarypolicy/fomccalendars.htm';
    }
    if (url.origin === 'https://fred.stlouisfed.org') {
      if (url.pathname !== '/releases/calendar') return false;
      if (provider) return !url.search;
      if (!url.search) return true;
      const keys = [...url.searchParams.keys()];
      return keys.length === 5
        && new Set(keys).size === 5
        && ['10', '11', '46', '47', '50', '188', '192'].includes(url.searchParams.get('rid'))
        && /^20\d{2}-\d{2}-\d{2}$/.test(url.searchParams.get('vs') || '')
        && /^20\d{2}-\d{2}-\d{2}$/.test(url.searchParams.get('ve') || '')
        && url.searchParams.get('ob') === 'rd'
        && url.searchParams.get('od') === 'asc';
    }
    if (url.origin === 'https://www.census.gov') {
      return !url.search
        && /^\/economic-indicators\/econcards\/assets\/pdf\/censusreleaseglance_20\d{2}\.pdf$/.test(url.pathname);
    }
    return provider
      && url.origin === 'https://www.whitehouse.gov'
      && !url.search
      && url.pathname === '/omb/information-resources/guidance/us-principal-federal-economic-indicators/';
  } catch {
    return false;
  }
}

async function visitSurface(page, path) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error) => pageErrors.push(error.message);
  const onRequestFailed = (request) => failedRequests.push(`${request.method()} ${request.url()}`);
  const onResponse = (response) => {
    const url = new URL(response.url());
    if (url.origin === new URL(page.url()).origin && response.status() >= 400) {
      badResponses.push(`${response.status()} ${url.pathname}`);
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page.locator('main')).toBeVisible();
  await page.waitForTimeout(250);

  expect(consoleErrors, `console errors at ${path}`).toEqual([]);
  expect(pageErrors, `page errors at ${path}`).toEqual([]);
  expect(failedRequests, `failed requests at ${path}`).toEqual([]);
  expect(badResponses, `bad same-origin responses at ${path}`).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, `document overflow at ${path}`).toBeLessThanOrEqual(dimensions.clientWidth);

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('requestfailed', onRequestFailed);
  page.off('response', onResponse);
}

for (const [viewportName, viewport] of VIEWPORTS) {
  for (const [surfaceName, path] of ROUTES) {
    test(`${viewportName} ${surfaceName} is usable without runtime or overflow failures`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await visitSurface(page, path);
    });
  }
}

test('live economic calendar exposes an official source instead of static estimates', async ({ page }) => {
  await page.goto('/?tab=Intel&view=news', { waitUntil: 'networkidle' });
  const heading = page.getByText('Economic Calendar', { exact: true });
  await expect(heading).toBeVisible();
  const card = heading.locator('xpath=ancestor::section[1]');
  const links = await card.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({
    href: anchor.href,
    provider: Boolean(anchor.closest('[aria-label="Economic calendar sources"]')),
  })));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(
      approvedCalendarUrl(link.href, { provider: link.provider }),
      `unapproved calendar source ${link.href}`,
    ).toBe(true);
  }
  if ((await card.textContent()).includes('OMB/BLS')) {
    expect(links.some(({ href, provider }) => !provider && new URL(href).origin === 'https://www.census.gov')).toBe(true);
    expect(links.some(({ href, provider }) => provider && [
      'https://www.census.gov',
      'https://www.whitehouse.gov',
    ].includes(new URL(href).origin))).toBe(true);
  }
  await expect(card).not.toContainText(/forecast|prior/i);
});

test('market heatmap never prefixes a negative change with plus', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main')).not.toContainText(/\+\-\d/);
});

test('live and research-only boundaries are explicit', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('LIVE', { exact: true }).first()).toBeVisible();
  await page.goto('/?tab=Intel&view=smart-money', { waitUntil: 'networkidle' });
  await expect(page.getByText(/7\/7 live/i).first()).toBeVisible();
  await page.goto('/?tab=Portfolio&view=simulation-readiness', { waitUntil: 'networkidle' });
  const simulationBoundary = page.getByRole('region', { name: 'Simulation readiness' });
  await expect(simulationBoundary).toContainText(/research only/i);
  await expect(simulationBoundary).toContainText(/transactions/i);
  await expect(simulationBoundary).toContainText(/permanently disabled by this capability/i);
  await expect(simulationBoundary).toContainText(/does not recommend, prepare, route, sign, or execute trades/i);
  await expect(page.getByRole('button', { name: /buy|sell|trade|execute|connect wallet/i })).toHaveCount(0);
});
