import { parseFedCalendar } from './fed.js';
import { fetchOfficialText } from './http.js';
import { parseIcsCalendar } from './ics.js';

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
  return provider.format === 'fed-html' ? parseFedCalendar(text, provider) : parseIcsCalendar(text, provider);
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

export async function buildCalendarSnapshot(options = {}) {
  const captured = options.now instanceof Date ? new Date(options.now) : new Date();
  if (!Number.isFinite(captured.getTime())) throw new Error('invalid calendar clock');
  const fetchedAt = captured.toISOString();
  const from = isoDay(captured);
  const through = isoDay(addUtcDays(captured, 90));
  const fetchText = options.fetchText || ((url) => fetchOfficialText(url, options.httpOptions));
  const results = await Promise.all(CALENDAR_PROVIDERS.map(async (provider) => {
    try {
      const source = normalizeSourceResult(await fetchText(provider.sourceUrl, provider));
      const events = parseProvider(source.text, provider).filter((event) => inWindow(event, from, through));
      return {
        provider: { id: provider.id, name: provider.name, shortName: provider.shortName, sourceUrl: provider.sourceUrl, status: 'live', eventCount: events.length, fetchedAt, sourceLastModifiedAt: source.sourceLastModifiedAt },
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
