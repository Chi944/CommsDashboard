const baseUrl = (
  process.env.PRODUCTION_SMOKE_BASE_URL
  || process.argv[2]
  || 'https://comms-dashboard-navy.vercel.app'
).replace(/\/$/, '');
const expectedCommitSha = process.env.PRODUCTION_SMOKE_EXPECTED_COMMIT_SHA?.trim() || null;
const expectedEnvironment = expectedCommitSha
  ? (process.env.PRODUCTION_SMOKE_EXPECTED_DEPLOYMENT_ENVIRONMENT?.trim() || 'production')
  : null;
const configuredTimeout = Number(process.env.PRODUCTION_SMOKE_TIMEOUT_MS);
const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 10_000;

async function fetchJson(path) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    const body = await response.json().catch(() => null);
    if (!body || body.ok !== true) throw new Error(`${path} did not return ok:true`);
    return body;
  } catch (error) {
    if (timedOut) throw new Error(`${path} timed out`);
    if (error?.message?.startsWith(path)) throw error;
    throw new Error(`${path} request failed`);
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const paths = [
    '/api/prices',
    '/api/market/snapshot',
    '/api/news',
    '/api/fear-greed',
    '/api/calendar',
    '/api/history?ticker=NVDA&range=1mo',
    '/api/asset-news?q=Nvidia&limit=6',
    '/api/smart-money',
    `/api/smart-money/history?since=${encodeURIComponent(since)}&limit=20`,
    '/api/smart-money/health',
  ];
  const results = await Promise.all(paths.map(fetchJson));
  const [prices, snapshot, news, fearGreed, calendar, history, assetNews, smartMoney, smartHistory, health] = results;

  if (prices?.partial !== false
      || prices?.counts?.requested < 268
      || prices.counts.received !== prices.counts.requested
      || prices.counts.failed !== 0
      || prices.counts.stale !== 0) {
    throw new Error('/api/prices did not report complete fresh coverage');
  }

  if (snapshot?.partial !== false
      || !Array.isArray(snapshot?.commodities) || snapshot.commodities.length === 0
      || snapshot.commodities.some((row) => !row?.source || row.stale === true)
      || snapshot?.counts?.fallback !== 0
      || snapshot?.counts?.live !== snapshot?.liveSymbolCount
      || snapshot.counts.live !== snapshot.commodities.length
      || !Array.isArray(snapshot?.staleProviders) || snapshot.staleProviders.length !== 0) {
    throw new Error('/api/market/snapshot did not return only complete live supplemental coverage');
  }

  if (!Array.isArray(news?.items) || news.items.length === 0
      || news.items.some((item) => {
        const timestamp = Number(item?.ts);
        const ageMs = Date.now() - timestamp;
        return !Number.isFinite(timestamp)
          || ageMs > 7 * 86_400_000
          || ageMs < -5 * 60_000;
      })) {
    throw new Error('/api/news returned stale or invalid content');
  }

  const fearGreedAgeMs = Date.now() - Date.parse(fearGreed?.updatedAt);
  if (!Number.isInteger(fearGreed?.value)
      || fearGreed.value < 0 || fearGreed.value > 100
      || !Number.isFinite(fearGreedAgeMs)
      || fearGreedAgeMs > 48 * 60 * 60_000
      || fearGreedAgeMs < -5 * 60_000) {
    throw new Error('/api/fear-greed returned a stale or invalid observation');
  }

  const calendarProviders = Array.isArray(calendar?.providers)
    ? calendar.providers
    : calendar?.providerStatuses;
  const expectedCalendarProviderIds = new Set(['bls', 'bea', 'federal-reserve']);
  const reportedCalendarProviderIds = new Set(
    Array.isArray(calendarProviders) ? calendarProviders.map((provider) => provider?.id) : [],
  );
  const calendarHasAllLiveSources = Array.isArray(calendarProviders)
    && calendarProviders.length === expectedCalendarProviderIds.size
    && reportedCalendarProviderIds.size === expectedCalendarProviderIds.size
    && calendarProviders.every((provider) => (
      expectedCalendarProviderIds.has(provider?.id)
      && (provider?.status || provider?.state) === 'live'
    ));
  if (calendar?.partial !== false
      || calendar?.state !== 'live'
      || !calendarHasAllLiveSources
      || !Array.isArray(calendar?.events) || calendar.events.length === 0
      || calendar.events.some((event) => (
        !Number.isFinite(Date.parse(event?.startsAt || `${event?.date}T00:00:00.000Z`))
        || !/^https:\/\/(?:www\.)?(?:bls\.gov|bea\.gov|federalreserve\.gov)\//i.test(event?.sourceUrl || '')
      ))) {
    throw new Error('/api/calendar did not return a live official-source schedule');
  }

  if (!Array.isArray(history?.points) || history.points.length === 0) {
    throw new Error('/api/history did not return price points');
  }

  if (!Array.isArray(assetNews?.items) || assetNews.items.length === 0
      || assetNews.items.some((item) => {
        const timestamp = Number(item?.ts);
        const ageMs = Date.now() - timestamp;
        return !Number.isFinite(timestamp)
          || ageMs > 7 * 86_400_000
          || ageMs < -5 * 60_000;
      })) {
    throw new Error('/api/asset-news returned stale or invalid content');
  }

  if (smartMoney?.partial !== false
      || !Array.isArray(smartMoney?.providerStatuses)
      || smartMoney.providerStatuses.length !== 7
      || smartMoney.providerStatuses.some((provider) => provider?.status !== 'live')) {
    throw new Error('/api/smart-money did not report all seven providers live');
  }

  if (smartHistory?.partial !== false || !Array.isArray(smartHistory?.signals)) {
    throw new Error('/api/smart-money/history did not return a complete journal response');
  }

  if (!Array.isArray(health?.providerStatuses)
      || health.providerStatuses.length !== 7
      || health.providerStatuses.some((provider) => provider?.state !== 'fresh')) {
    throw new Error('/api/smart-money/health did not report all seven providers fresh');
  }

  if (expectedCommitSha) {
    if (health?.deployment?.commitSha !== expectedCommitSha) {
      throw new Error(`/api/smart-money/health deployment commit ${health?.deployment?.commitSha || 'missing'} did not match expected ${expectedCommitSha}`);
    }
    if (health?.deployment?.environment !== expectedEnvironment) {
      throw new Error(`/api/smart-money/health deployment environment ${health?.deployment?.environment || 'missing'} did not match expected ${expectedEnvironment}`);
    }
  }

  const deploymentSummary = expectedCommitSha
    ? `; deployment ${expectedCommitSha} (${expectedEnvironment})`
    : '';
  console.log(`Production surface smoke passed for ${baseUrl}${deploymentSummary}`);
} catch (error) {
  console.error(`Production surface smoke failed: ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
}
