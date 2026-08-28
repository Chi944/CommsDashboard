import { load } from 'cheerio';

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
    /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})$/i,
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

function parsedTime(value, date) {
  const normalized = String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { startsAt: null, timeStatus: 'date-only', timeLabel: 'Date only' };
  }
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) throw calendarError();
  const displayHour = Number(match[1]);
  const minute = Number(match[2]);
  if (displayHour < 1 || displayHour > 12 || minute < 0 || minute > 59) throw calendarError();
  const meridiem = match[3].toUpperCase();
  const hour = (displayHour % 12) + (meridiem === 'PM' ? 12 : 0);
  const [year, month, day] = date.split('-').map(Number);
  const instant = localDateTimeToInstant({ year, month, day, hour, minute }, EASTERN_TIME_ZONE);
  return {
    startsAt: instant.toISOString(),
    timeStatus: 'scheduled',
    timeLabel: `${displayHour}:${String(minute).padStart(2, '0')} ${meridiem} ET`,
  };
}

function safeId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150);
}

function scriptedRemovals(html) {
  const block = String(html || '').match(
    /\$\('\.release-list tr'\)\.each\([\s\S]*?Object\.entries\(\{([\s\S]*?)\}\)/,
  )?.[1];
  const removals = new Set();
  if (!block) return removals;
  const pairs = block.matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g);
  for (const pair of pairs) removals.add(`${pair[1]}\u0000${pair[2]}`);
  return removals;
}

export function parseBlsCalendar(html, source) {
  const sourceText = String(html || '');
  const $ = load(sourceText);
  const removals = scriptedRemovals(sourceText);
  const events = [];

  $('table.release-list tbody tr').each((_index, row) => {
    const dateText = $(row).find('td.date-cell').first().text().replace(/\s+/g, ' ').trim();
    const timeText = $(row).find('td.time-cell').first().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const descriptionCell = $(row).find('td.desc-cell').first();
    const shortTitle = descriptionCell.find('strong').first().text().replace(/\s+/g, ' ').trim();
    const title = descriptionCell.text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!dateText || !shortTitle || !title || removals.has(`${dateText}\u0000${shortTitle}`)) return;
    try {
      const date = isoDate(dateText);
      const time = parsedTime(timeText, date);
      const idPart = safeId(title);
      if (!idPart) return;
      events.push({
        id: `${source.id}:${date}:${idPart}`,
        title,
        kind: source.kind,
        sourceId: source.id,
        sourceName: source.name,
        sourceShortName: source.shortName,
        sourceUrl: source.sourceUrl,
        date,
        endDate: date,
        startsAt: time.startsAt,
        timeZone: EASTERN_TIME_ZONE,
        timeStatus: time.timeStatus,
        timeLabel: time.timeLabel,
      });
    } catch {
      // Preserve valid official rows when BLS publishes one malformed entry.
    }
  });

  if (events.length === 0) throw calendarError();
  return events;
}
