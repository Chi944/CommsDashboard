import { load } from 'cheerio';
import { officialHumanEventUrl } from './event-url.js';

const CENTRAL_TIME_ZONE = 'America/Chicago';
const EASTERN_TIME_ZONE = 'America/New_York';
const MONTHS = Object.freeze({
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
});

function calendarError() {
  const error = new Error('calendar_invalid');
  error.code = 'calendar_invalid';
  return error;
}

function isoDate(value) {
  const match = String(value || '').trim().match(
    /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})$/i,
  );
  if (!match) throw calendarError();
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year
      || candidate.getUTCMonth() !== month - 1
      || candidate.getUTCDate() !== day) throw calendarError();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function datePartsAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function timeZoneOffsetMs(instant, timeZone) {
  const parts = datePartsAt(instant, timeZone);
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ) - instant.getTime();
}

function localDateTimeToInstant({ year, month, day, hour, minute }, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(wallClock - timeZoneOffsetMs(new Date(wallClock), timeZone));
  const corrected = wallClock - timeZoneOffsetMs(instant, timeZone);
  if (corrected !== instant.getTime()) instant = new Date(corrected);
  return instant;
}

function easternLabel(instant) {
  return `${new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant)} ET`;
}

function parsedTime(value, date) {
  const normalized = String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || /^N\/A$/i.test(normalized)) {
    return { startsAt: null, timeStatus: 'unspecified', timeLabel: 'Time not specified' };
  }
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s+(am|pm)$/i);
  if (!match) throw calendarError();
  const displayHour = Number(match[1]);
  const minute = Number(match[2]);
  if (displayHour < 1 || displayHour > 12 || minute < 0 || minute > 59) throw calendarError();
  const hour = (displayHour % 12) + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  const [year, month, day] = date.split('-').map(Number);
  const instant = localDateTimeToInstant({ year, month, day, hour, minute }, CENTRAL_TIME_ZONE);
  return {
    startsAt: instant.toISOString(),
    timeStatus: 'scheduled',
    timeLabel: easternLabel(instant),
  };
}

function safeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150);
}

export function parseFredCalendar(html, source) {
  const $ = load(String(html || ''));
  const pager = $('#release-dates-pager');
  if (pager.length !== 1) throw calendarError();
  const events = [];
  let currentDate = null;

  $('#release-dates-pager table tbody tr').each((_index, row) => {
    const dateText = $(row).find('td[colspan] span').first().text().replace(/\s+/g, ' ').trim();
    if (dateText) {
      try {
        currentDate = isoDate(dateText);
      } catch {
        currentDate = null;
      }
      return;
    }
    if (!currentDate) return;
    const cells = $(row).find('td');
    const link = cells.eq(1).find('a[href*="/release?rid="]').first();
    const title = link.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    try {
      const time = parsedTime(cells.eq(0).text(), currentDate);
      const idPart = safeId(title);
      if (!idPart) return;
      const eventUrl = officialHumanEventUrl(link.attr('href'), source.sourceUrl);
      events.push({
        id: `${source.id}:${currentDate}:${idPart}`,
        title,
        kind: source.kind,
        sourceId: source.id,
        sourceName: source.name,
        sourceShortName: source.shortName,
        sourceUrl: source.sourceUrl,
        ...(eventUrl ? { eventUrl } : {}),
        date: currentDate,
        endDate: currentDate,
        startsAt: time.startsAt,
        timeZone: CENTRAL_TIME_ZONE,
        timeStatus: time.timeStatus,
        timeLabel: time.timeLabel,
      });
    } catch {
      // Preserve valid release rows when one FRED calendar row is malformed.
    }
  });

  if (events.length === 0) {
    const pagerText = pager.text().replace(/\s+/g, ' ').trim();
    if (/^No release dates are available for the selected options\.?$/i.test(pagerText)) return [];
    throw calendarError();
  }
  return events;
}
