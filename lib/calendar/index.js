import { parseBlsCalendar } from './bls.js';
import { parseFedCalendar } from './fed.js';
import { fetchOfficialBytes, fetchOfficialText } from './http.js';
import { parseFredCalendar } from './fred.js';
import { parseIcsCalendar } from './ics.js';
import { parseOmbBlsPdf } from './omb.js';

const FRED_CALENDAR_URL = 'https://fred.stlouisfed.org/releases/calendar';
const FRED_BLS_RELEASE_IDS = Object.freeze([50, 10, 46, 192, 11, 188, 47]);
const OMB_SCHEDULE_URL = 'https://www.whitehouse.gov/omb/information-resources/guidance/us-principal-federal-economic-indicators/';
const BLS_PRIMARY_TIMEOUT_MS = 750;
const BLS_ANNUAL_TIMEOUT_MS = 750;
const BLS_OMB_TIMEOUT_MS = 5_000;
const BLS_FRED_TIMEOUT_MS = 5_500;
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

function normalizeBinaryResult(value) {
  return value instanceof Uint8Array
    ? { bytes: value, sourceLastModifiedAt: null }
    : { bytes: value?.bytes, sourceLastModifiedAt: value?.sourceLastModifiedAt || null };
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

async function loadProvider(provider, fetchText, fetchBytes, parseOmbPdf, from, through, configuredTimeoutMs) {
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
    // Once the preferred ICS source fails, overlap the direct annual schedule,
    // OMB/OIRA's Census-hosted PFEI schedule, and FRED. The worst tier budget is
    // 750 + max(750, 5,000, 5,500) = 6,250ms, leaving headroom beneath the
    // browser's 8-second request deadline.
    const years = yearsInWindow(from, through);
    const ombSources = years.map((year) => ({
      ...provider,
      year,
      name: 'BLS principal releases via OMB/OIRA',
      shortName: 'OMB/BLS',
      sourceUrl: `https://www.census.gov/economic-indicators/econcards/assets/pdf/censusreleaseglance_${year}.pdf`,
    }));
    const ombAttempt = Promise.all(ombSources.map(async (fallback) => fetchWithin(
      async (url, requestProvider) => {
        const source = normalizeBinaryResult(await fetchBytes(url, requestProvider));
        return {
          sourceUrl: fallback.sourceUrl,
          sourceLastModifiedAt: source.sourceLastModifiedAt,
          events: await parseOmbPdf(source.bytes, fallback, fallback.year),
        };
      },
      fallback,
      BLS_OMB_TIMEOUT_MS,
      configuredTimeoutMs,
    ))).then((loaded) => {
      const events = uniqueSorted(loaded.flatMap((result) => result.events));
      if (loaded.length !== ombSources.length || !events.some((event) => inWindow(event, from, through))) {
        throw primaryError;
      }
      return {
        name: 'BLS principal releases via OMB/OIRA',
        shortName: 'OMB/BLS',
        sourceUrl: loaded.length === 1 ? loaded[0].sourceUrl : OMB_SCHEDULE_URL,
        sourceLastModifiedAt: newestTimestamp(loaded.map((result) => result.sourceLastModifiedAt)),
        events,
      };
    });
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
    const fredAttempt = Promise.all(fredSources.map(async (fallback) => {
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
    })).then((loaded) => {
      const events = uniqueSorted(loaded.flatMap((result) => result.events));
      if (events.length === 0) throw primaryError;
      return {
        name: 'BLS releases via FRED',
        shortName: 'FRED/BLS',
        sourceUrl: FRED_CALENDAR_URL,
        sourceLastModifiedAt: newestTimestamp(loaded.map((result) => result.sourceLastModifiedAt)),
        events,
      };
    });
    // The annual page remains preferred when both fallbacks work. Attach a
    // rejection handler now because that branch may return without awaiting the
    // concurrently running OMB or FRED attempts.
    ombAttempt.catch(() => {});
    fredAttempt.catch(() => {});
    try {
      const fallbacks = years.map((year) => ({
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
      const events = uniqueSorted(loaded.flatMap((result) => result.events));
      if (loaded.length !== fallbacks.length || !events.some((event) => inWindow(event, from, through))) {
        throw primaryError;
      }
      return {
        name: provider.name,
        shortName: provider.shortName,
        sourceUrl: loaded[0].sourceUrl,
        sourceLastModifiedAt: newestTimestamp(loaded.map((result) => result.sourceLastModifiedAt)),
        events,
      };
    } catch {
      try {
        return await ombAttempt;
      } catch {
        return await fredAttempt;
      }
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
  const fetchBytes = options.fetchBytes || ((url, provider) => fetchOfficialBytes(url, {
    ...options.httpOptions,
    timeoutMs: provider?.timeoutMs,
  }));
  const parseOmbPdf = options.parseOmbPdf || parseOmbBlsPdf;
  const results = await Promise.all(CALENDAR_PROVIDERS.map(async (provider) => {
    try {
      const loaded = await loadProvider(provider, fetchText, fetchBytes, parseOmbPdf, from, through, configuredTimeoutMs);
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
