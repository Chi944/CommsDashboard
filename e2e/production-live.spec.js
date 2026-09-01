import { test, expect } from '@playwright/test';

const ROUTES = [
  ['Overview', '/'],
  ['Prices', '/?tab=Prices&t=NVDA'],
  ['Currency', '/?tab=Currency'],
  ['Portfolio holdings', '/?tab=Portfolio&view=holdings'],
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

test('command palette navigation and currency conversion work end to end', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  const search = palette.getByRole('combobox', { name: /search commands and assets/i });
  await search.fill('Currency');
  await search.press('Enter');

  await expect(page.getByRole('heading', { name: 'Currency', exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('Currency');
  const amount = page.getByRole('spinbutton', { name: /amount to convert/i });
  const from = page.getByRole('combobox', { name: /from currency/i });
  const to = page.getByRole('combobox', { name: /to currency/i });
  const output = page.getByRole('status', { name: /converted amount/i });
  await amount.fill('100');
  await from.selectOption('USD');
  await to.selectOption('SGD');
  await expect(output).not.toHaveText('—');
  const converted = await output.textContent();
  await page.getByRole('button', { name: /swap currencies/i }).click();
  await expect(from).toHaveValue('SGD');
  await expect(to).toHaveValue('USD');
  await expect(output).not.toHaveText(converted || '');
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

test('portfolio holdings persist locally, export, navigate, and can be removed', async ({ page }) => {
  await page.goto('/?tab=Portfolio&view=holdings', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('comms.positions.v1'));
  await page.reload({ waitUntil: 'networkidle' });

  const ticker = page.getByRole('combobox', { name: 'Ticker' });
  await ticker.fill('NVDA');
  await page.getByRole('spinbutton', { name: 'Quantity' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Average cost ($)' }).fill('100');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('button', { name: 'Remove NVDA position' })).toBeVisible();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Remove NVDA position' })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export csv/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('portfolio.csv');

  await page.getByRole('button', { name: /nvda.*nvidia/i }).click();
  await expect(page.getByRole('heading', { name: 'Prices' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('t')).toBe('NVDA');
  await page.goto('/?tab=Portfolio&view=holdings', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Remove NVDA position' }).click();
  await expect(page.getByText(/no holdings yet/i)).toBeVisible();
});

test('price alerts can be added, paused, enabled, removed, and inspected in the drawer', async ({ page }) => {
  await page.goto('/?tab=Prices&t=NVDA', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('comms.alerts.v1');
    localStorage.removeItem('comms.alerts.triggered.v1');
  });
  await page.reload({ waitUntil: 'networkidle' });

  await page.getByRole('button', { name: /price alerts for nvda/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /price alerts for nvidia/i });
  await dialog.getByRole('spinbutton', { name: /price threshold/i }).fill('999');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText(/when > 999/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'pause', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'enable', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'enable', exact: true }).click();
  await dialog.getByRole('button', { name: 'remove', exact: true }).click();
  await expect(dialog.getByText(/when > 999/i)).toHaveCount(0);
  await dialog.getByRole('button', { name: /close price alert dialog/i }).click();

  await page.getByRole('button', { name: /open alerts/i }).click();
  const drawer = page.getByRole('dialog', { name: /alerts & notifications/i });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(/dashboard is open/i);
  await drawer.getByRole('button', { name: /close notifications/i }).click();
  await expect(drawer).toBeHidden();
});

test('Prices watchlists, notes, layouts, and trusted CSV export complete their lifecycle', async ({ page }) => {
  await page.goto('/?tab=Prices&t=NVDA', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('comms.watchlists.v1');
    localStorage.removeItem('comms.notes.v1');
    localStorage.removeItem('comms.presets.v1');
  });
  await page.reload({ waitUntil: 'networkidle' });

  await page.getByRole('button', { name: /watchlist \(0\)/i }).click();
  page.once('dialog', (dialog) => dialog.accept('Research'));
  await page.getByRole('button', { name: /new list/i }).click();
  await expect(page.getByRole('button', { name: '★ Research', exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept('Macro Research'));
  await page.getByRole('button', { name: /rename research watchlist/i }).click();
  await expect(page.getByRole('button', { name: '★ Macro Research', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /delete macro research watchlist/i }).click();
  await expect(page.getByRole('button', { name: '★ Macro Research', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'ALL', exact: true }).click();
  await page.getByRole('button', { name: /add note for NVDA/i }).click();
  const note = page.getByRole('textbox', { name: /note for NVDA/i });
  await note.fill('saved note');
  await note.press('Enter');
  await page.getByRole('button', { name: /edit note for NVDA/i }).click();
  const draft = page.getByRole('textbox', { name: /note for NVDA/i });
  await draft.fill('discarded draft');
  await draft.press('Escape');
  await page.getByRole('button', { name: /edit note for NVDA/i }).click();
  await expect(page.getByRole('textbox', { name: /note for NVDA/i })).toHaveValue('saved note');
  await page.keyboard.press('Escape');

  page.once('dialog', (dialog) => dialog.accept('Core'));
  await page.getByRole('button', { name: /save layout/i }).click();
  await expect(page.getByRole('button', { name: 'Core', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /delete core layout/i }).click();
  await expect(page.getByRole('button', { name: 'Core', exact: true })).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export csv/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('prices-all.csv');
});

test('Prices ranges, comparison, RSI, and heatmap controls are functional', async ({ page }) => {
  await page.goto('/?tab=Prices&t=NVDA', { waitUntil: 'networkidle' });

  for (const range of ['1D', '7D', '30D', '90D', 'YTD']) {
    const control = page.getByRole('button', { name: range, exact: true });
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'true');
  }

  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Comparing', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/comparing 3 symbols/i)).toBeVisible();
  await page.getByRole('button', { name: 'Comparing', exact: true }).click();

  const rsi = page.getByRole('button', { name: 'RSI', exact: true });
  await rsi.click();
  await expect(rsi).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/RSI · 14/i)).toBeVisible();

  await page.getByRole('button', { name: 'heatmap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'heatmap', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const aapl = page.getByRole('button', { name: /select AAPL — Apple/i });
  await aapl.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('t')).toBe('AAPL');
  await page.getByRole('button', { name: 'table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'table', exact: true })).toHaveAttribute('aria-pressed', 'true');
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

test('a source-only person profile provides official reading and related monitored evidence', async ({ page }) => {
  await page.goto('/?tab=Intel&view=smart-money&record=leopold-aschenbrenner', { waitUntil: 'networkidle' });

  const profile = page.getByRole('region', { name: 'Leopold Aschenbrenner' });
  await expect(profile).toBeFocused();
  await expect(profile.getByText('Accepted activity')).toHaveCount(0);
  await expect(profile.getByText('Research signals')).toHaveCount(0);
  await expect(profile.getByText(/official-source profile/i)).toBeVisible();
  await expect(profile.getByRole('link', { name: /read situational awareness: the decade ahead/i })).toBeVisible();
  await expect(profile.getByRole('link', { name: /open for our posterity/i })).toBeVisible();

  const related = profile.getByRole('button', { name: /view situational awareness lp research profile/i });
  await expect(related).toContainText(/accepted public filings?/i);
  await related.click();
  const firmProfile = page.getByRole('region', { name: 'Situational Awareness LP' });
  await expect(firmProfile).toBeFocused();
  expect(new URL(page.url()).searchParams.get('record')).toBe('situational-awareness-lp');
  await firmProfile.getByRole('button', { name: /close profile/i }).click();
  await expect(page.getByRole('button', { name: /open situational awareness lp research profile/i })).toBeFocused();
  expect(new URL(page.url()).searchParams.has('record')).toBe(false);
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
  const selectedAsset = page.getByRole('button', { name: /select nvda — nvidia/i });
  await expect(selectedAsset).toBeVisible();
  await expect(selectedAsset).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(2_000);

  expect(new URL(page.url()).searchParams.get('t')).toBe('NVDA');
  expect(assetRequests.length, `asset requests: ${assetRequests.join(', ')}`).toBeLessThanOrEqual(6);
  expect(assetRequests.some((value) => /ticker=CL|q=WTI/i.test(value))).toBe(false);
});

test('public data APIs reject unsupported methods and cache-busting query parameters', async ({ request }) => {
  const routes = [
    ['/api/news', ''],
    ['/api/fear-greed', ''],
    ['/api/history', '?ticker=NVDA&range=1mo'],
    ['/api/asset-news', '?q=Nvidia&limit=6'],
  ];
  for (const [path, query] of routes) {
    const methodResponse = await request.fetch(`${path}${query}`, { method: 'POST' });
    expect(methodResponse.status(), `POST ${path}`).toBe(405);
    expect(methodResponse.headers().allow, `Allow ${path}`).toBe('GET');

    const joiner = query ? '&' : '?';
    const queryResponse = await request.get(`${path}${query}${joiner}cacheBust=1`);
    expect(queryResponse.status(), `unknown query ${path}`).toBe(400);
  }
  const malformedLimit = await request.get('/api/asset-news?q=Nvidia&limit=abc');
  expect(malformedLimit.status()).toBe(400);
});

test('live and research-only boundaries are explicit while legacy simulation links stay useful', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('LIVE', { exact: true }).first()).toBeVisible();
  await page.goto('/?tab=Intel&view=smart-money', { waitUntil: 'networkidle' });
  await expect(page.getByText(/7\/7 live/i).first()).toBeVisible();
  await expect(page.getByRole('note', { name: /research-only boundary/i })).toContainText(/never recommends or executes trades/i);
  await expect(page.getByRole('region', { name: 'Simulation readiness' })).toHaveCount(0);
  await page.goto('/?tab=Portfolio&view=simulation-readiness', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Ticker' })).toBeVisible();
  await expect(page.getByText(/no brokerage connection or trade execution/i)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Simulation readiness' })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('holdings');
  await expect(page.getByRole('button', { name: /buy|sell|trade|execute|connect wallet/i })).toHaveCount(0);
});
