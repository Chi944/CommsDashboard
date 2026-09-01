import { test, expect } from '@playwright/test';

const ROUTES = [
  ['Overview', '/'],
  ['Prices', '/?tab=Prices&t=NVDA'],
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
      if (url.search) return false;
      if (url.pathname === '/schedule/news_release/bls.ics') return provider;
      return provider ? /^\/schedule\/20\d{2}\/$/.test(url.pathname) : !/\.(?:ics|pdf)$/i.test(url.pathname);
    }
    if (url.origin === 'https://www.bea.gov') {
      return provider && !url.search && url.pathname === '/news/schedule/ics/online-calendar-subscription.ics';
    }
    if (url.origin === 'https://www.federalreserve.gov') {
      return !url.search && url.pathname === '/monetarypolicy/fomccalendars.htm';
    }
    if (url.origin === 'https://fred.stlouisfed.org') {
      if (url.pathname === '/release') {
        const keys = [...url.searchParams.keys()];
        return !provider
          && keys.length === 1
          && keys[0] === 'rid'
          && ['10', '11', '46', '47', '50', '188', '192'].includes(url.searchParams.get('rid'));
      }
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
      return provider && !url.search
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

test('mobile navigation exposes working currency and command controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const currency = page.getByRole('combobox', { name: 'Display currency' });
  await expect(currency).toBeVisible();
  await currency.selectOption('SGD');
  await expect(currency).toHaveValue('SGD');
  await expect(page.getByRole('button', { name: /open command palette/i })).toBeVisible();
});

test('price alerts are a keyboard-complete dialog', async ({ page }) => {
  await page.goto('/?tab=Prices&t=NVDA', { waitUntil: 'networkidle' });
  const trigger = page.getByRole('button', { name: /price alerts for nvda/i }).first();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: /price alerts for nvidia/i });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: /price threshold/i })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('portfolio form validates and adds a local-only holding with the keyboard', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/?tab=Portfolio&view=holdings', { waitUntil: 'networkidle' });

  const ticker = page.getByRole('combobox', { name: 'Ticker' });
  const add = page.getByRole('button', { name: 'Add' });
  await expect(add).toBeDisabled();
  await ticker.fill('NV');
  await ticker.press('ArrowDown');
  await ticker.press('Enter');
  await page.getByRole('spinbutton', { name: 'Quantity' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Average cost ($)' }).fill('100');
  await expect(add).toBeEnabled();
  await add.click();

  await expect(page.getByRole('button', { name: 'Remove NVDA position' })).toBeVisible();
});

test('Smart Money following, profiles, and SEC evidence links are usable', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/?tab=Intel&view=smart-money', { waitUntil: 'networkidle' });

  const follow = page.getByRole('button', { name: 'Follow ARK 21Shares Bitcoin ETF' });
  await follow.click();
  await expect(page.getByRole('button', { name: 'Unfollow ARK 21Shares Bitcoin ETF' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /following \(1\)/i }).click();
  await expect(page.getByRole('button', { name: /open ark 21shares bitcoin etf research profile/i })).toBeVisible();
  await page.getByRole('button', { name: /open ark 21shares bitcoin etf research profile/i }).click();
  await expect(page.getByRole('region', { name: 'ARK 21Shares Bitcoin ETF' })).toBeFocused();

  await expect(page.locator('a[href*="data.sec.gov"], a[href$="/index.json"]')).toHaveCount(0);
});

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

test('a shared Prices ticker remains stable without an API request loop', async ({ page }) => {
  const assetRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(page.url()).origin
        && ['/api/analysis', '/api/asset-news', '/api/history'].includes(url.pathname)) {
      assetRequests.push(`${url.pathname}${url.search}`);
    }
  });

  await page.goto('/?tab=Prices&t=NVDA', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('NVIDIA', { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(2_000);

  expect(new URL(page.url()).searchParams.get('t')).toBe('NVDA');
  expect(assetRequests.length, `asset requests: ${assetRequests.join(', ')}`).toBeLessThanOrEqual(6);
  expect(assetRequests.some((value) => /ticker=CL|q=WTI/i.test(value))).toBe(false);
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
