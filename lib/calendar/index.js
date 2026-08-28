import { parseBlsCalendar } from './bls.js';
import { parseFedCalendar } from './fed.js';
import { fetchOfficialText } from './http.js';
import { parseFredCalendar } from './fred.js';
import { parseIcsCalendar } from './ics.js';

const FRED_CALENDAR_URL = 'https://fred.stlouisfed.org/releases/calendar';
const FRED_BLS_RELEASE_IDS = Object.freeze([50, 10, 46, 192, 11, 188, 47]);
const BLS_PRIMARY_TIMEOUT_MS = 1_500;
const BLS_ANNUAL_TIMEOUT_MS = 1_500;
const BLS_FRED_TIMEOUT_MS = 3_000;
const OTHER_PROVIDER_TIMEOUT_MS = 6_000;

export const CALENDAR_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'bls', name: 'U.S. Bureau of Labor Statistics', shortName: 'BLS', sourceUrl: 'https://www.bls.gov/schedule/news_release/bls.ics', kind: 'economic-release', format: 'ics' }),
  Object.freeze({ id: 'bea', name: 'U.S. Bureau of Economic Analysis', shortName: 'BEA', sourceUrl: 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics', kind: 'economic-release', format: 'ics' }),
  Object.freeze({ id: 'federal-reserve', name: 'Federal Reserve', shortName: 'Fed', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', kind: 'policy-meeting', format: 'fed-html' }),
]);

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseProvider(text, provider) {
  if (provider.format === 'fed-html') return parseFedCalendar(text, provider);
  if (provider.format === 'bls-html') return parseBlsCalendar(text, provider);
  if (provider.format === 'fred-html') return parseFredCalendar(text, provider);
  return parseIcsCalendar(text, provider);
}

function normalizeSourceResult(value) {
  return typeof value === 'string'
    ? { text: value, sourceLastModifiedAt: null }
    : { text: value?.text, sourceLastModifiedAt: value?.sourceLastModifiedAt || null };
}

function inWindow(event, from, through) {
  return event.endDate >= from && event.date <= through;
}

function uniqueSorted(events) {
  const byId = new Map();
  for (const event of events) if (!byId.has(event.id)) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => (
    a.date.localeCompare(b.date)
      || String(a.startsAt || '').localeCompare(String(b.startsAt || ''))
      || a.title.localeCompare(b.title)
  ));
}

function yearsInWindow(from, through) {
  const first = Number(from.slice(0, 4));
  const last = Number(through.slice(0, 4));
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function newestTimestamp(values) {
  const timestamps = values
    .map((value) => Date.parse(value || ''))
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function boundedTimeout(configured, maximum) {
  const value = Number(configured);
  return Number.isFinite(value) && value > 0 ? Math.min(value, maximum) : maximum;
}

function timeoutError() {
  const error = new Error('upstream_timeout');
  error.code = 'upstream_timeout';
  return error;
}

async function fetchWithin(fetchText, provider, maximumTimeoutMs, configuredTimeoutMs) {
  const timeoutMs = boundedTimeout(configuredTimeoutMs, maximumTimeoutMs);
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => fetchText(provider.sourceUrl, { ...provider, timeoutMs })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadProvider(provider, fetchText, from, through, configuredTimeoutMs) {
  try {
    const primaryTimeoutMs = provider.id === 'bls' ? BLS_PRIMARY_TIMEOUT_MS : OTHER_PROVIDER_TIMEOUT_MS;
    const source = normalizeSourceResult(await fetchWithin(fetchText, provider, primaryTimeoutMs, configuredTimeoutMs));
    return {
      name: provider.name,
      shortName: provider.shortName,
      sourceUrl: provider.sourceUrl,
      sourceLastModifiedAt: source.sourceLastModifiedAt,
      events: parseProvider(source.text, provider),
    };
  } catch (primaryError) {
    if (provider.id !== 'bls') throw primaryError;
    try {
      const fallbacks = yearsInWindow(from, through).map((year) => ({
        ...provider,
        format: 'bls-html',
        sourceUrl: `https://www.bls.gov/schedule/${year}/`,
      }));
      const settled = await Promise.allSettled(fallbacks.map(async (fallback) => {
        const source = normalizeSourceResult(await fetchWithin(
          fetchText,
          fallback,
          BLS_ANNUAL_TIMEOUT_MS,
          configuredTimeoutMs,
        ));
        return {
          sourceUrl: fallback.sourceUrl,
          sourceLastModifiedAt: source.sourceLastModifiedAt,
          events: parseProvider(source.text, fallback),
        };
      }));
      const loaded = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
      if (loaded.length === 0) throw primaryError;
      return {
        name: provider.name,
        shortName: provider.shortName,
        sourceUrl: loaded[0].sourceUrl,
        sourceLastModifiedAt: newestTimestamp(loaded.map((result) => result.sourceLastModifiedAt)),
        events: uniqueSorted(loaded.flatMap((result) => result.events)),
      };
    } catch {
      const fredSources = FRED_BLS_RELEASE_IDS.map((releaseId) => {
        const query = new URLSearchParams({
          rid: String(releaseId),
          vs: from,
          ve: through,
          ob: 'rd',
          od: 'asc',
        });
        return {
          ...provider,
          name: 'BLS releases via FRED',
          shortName: 'FRED/BLS',
          format: 'fred-html',
          sourceUrl: `${FRED_CALENDAR_URL}?${query}`,
        };
      });
      const loaded = await Promise.all(fredSources.map(async (fallback) => {
        const source = normalizeSourceResult(await fetchWithin(
          fetchText,
          fallback,
          BLS_FRED_TIMEOUT_MS,
          configuredTimeoutMs,
        ));
        return {
          sourceLastModifiedAt: source.sourceLastModifiedAt,
          events: parseProvider(source.text, fallback),
        };
      }));
      const events = uniqueSorted(loaded.flatMap((result) => result.events));
      if (events.length === 0) throw primaryError;
      return {
        name: 'BLS releases via FRED',
        shortName: 'FRED/BLS',
        sourceUrl: FRED_CALENDAR_URL,
        sourceLastModifiedAt: newestTimestamp(loaded.map((result) => result.sourceLastModifiedAt)),
        events,
      };
    }
  }
}

export async function buildCalendarSnapshot(options = {}) {
  const captured = options.now instanceof Date ? new Date(options.now) : new Date();
  if (!Number.isFinite(captured.getTime())) throw new Error('invalid calendar clock');
  const fetchedAt = captured.toISOString();
  const from = isoDay(captured);
  const through = isoDay(addUtcDays(captured, 90));
  const configuredTimeoutMs = options.httpOptions?.timeoutMs;
  const fetchText = options.fetchText || ((url, provider) => fetchOfficialText(url, {
    ...options.httpOptions,
    timeoutMs: provider?.timeoutMs,
  }));
  const results = await Promise.all(CALENDAR_PROVIDERS.map(async (provider) => {
    try {
      const loaded = await loadProvider(provider, fetchText, from, through, configuredTimeoutMs);
      const events = loaded.events.filter((event) => inWindow(event, from, through));
      return {
        provider: { id: provider.id, name: loaded.name, shortName: loaded.shortName, sourceUrl: loaded.sourceUrl, status: 'live', eventCount: events.length, fetchedAt, sourceLastModifiedAt: loaded.sourceLastModifiedAt },
        events,
      };
    } catch {
      return {
        provider: { id: provider.id, name: provider.name, shortName: provider.shortName, sourceUrl: provider.sourceUrl, status: 'unavailable', eventCount: 0, fetchedAt: null, sourceLastModifiedAt: null },
        events: [],
      };
    }
  }));
  const liveCount = results.filter((result) => result.provider.status === 'live').length;
  const ok = liveCount > 0;
  const partial = liveCount < CALENDAR_PROVIDERS.length;
  return {
    ok,
    partial,
    degraded: partial,
    state: !ok ? 'unavailable' : partial ? 'degraded' : 'live',
    fetchedAt,
    asOf: fetchedAt,
    window: { from, through, days: 90 },
    providers: results.map((result) => result.provider),
    events: uniqueSorted(results.flatMap((result) => result.events)),
  };
}
