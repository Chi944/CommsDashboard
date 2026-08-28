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
  await expect(card.locator(
    'a[href*="bls.gov"], a[href*="bea.gov"], a[href*="federalreserve.gov"]',
  ).first()).toBeVisible();
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
  await expect(page.getByText(/transactions permanently disabled/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /buy|sell|trade|execute|connect wallet/i })).toHaveCount(0);
});
