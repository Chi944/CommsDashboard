const EASTERN_TIME_ZONE = 'America/New_York';

function calendarError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizedTimeZone(value) {
  return ['US-Eastern', 'US/Eastern', 'EST5EDT', 'America/New_York'].includes(value)
    ? EASTERN_TIME_ZONE
    : (value || EASTERN_TIME_ZONE);
}

function validParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    && candidate.getUTCHours() === hour
    && candidate.getUTCMinutes() === minute
    && candidate.getUTCSeconds() === second;
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
  const represented = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return represented - instant.getTime();
}

function localDateTimeToInstant({ year, month, day, hour, minute, second }, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(wallClock - timeZoneOffsetMs(new Date(wallClock), timeZone));
  const corrected = wallClock - timeZoneOffsetMs(instant, timeZone);
  if (corrected !== instant.getTime()) instant = new Date(corrected);
  return instant;
}

function dateInTimeZone(instant, timeZone) {
  const parts = datePartsAt(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timeInEastern(instant) {
  return `${new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant)} ET`;
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r?\n[ \t]/g, '');
}

function unescapeIcs(value) {
  return String(value || '')
    .replace(/\\[nN]/g, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .replace(/,([A-Za-z])/g, ', $1')
    .replace(/\s+/g, ' ')
    .trim();
}

function property(line) {
  const colon = line.indexOf(':');
  if (colon < 1) return null;
  const descriptor = line.slice(0, colon).split(';');
  const name = descriptor.shift().toUpperCase();
  const parameters = {};
  for (const item of descriptor) {
    const equals = item.indexOf('=');
    if (equals > 0) parameters[item.slice(0, equals).toUpperCase()] = item.slice(equals + 1);
  }
  return { name, parameters, value: line.slice(colon + 1) };
}

function parsedStart(entry, sourceTimeZone = EASTERN_TIME_ZONE) {
  const raw = String(entry?.value || '').trim();
  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    if (!validParts(year, month, day)) throw calendarError('calendar_invalid');
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return {
      date,
      startsAt: null,
      timeZone: normalizedTimeZone(entry?.parameters?.TZID || sourceTimeZone),
      timeStatus: 'date-only',
      timeLabel: 'Date only',
    };
  }

  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) throw calendarError('calendar_invalid');
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, utcMarker] = match;
  const values = [yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw].map(Number);
  if (!validParts(...values)) throw calendarError('calendar_invalid');
  const [year, month, day, hour, minute, second] = values;
  const sourceZone = normalizedTimeZone(entry?.parameters?.TZID || sourceTimeZone);
  const instant = utcMarker
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : localDateTimeToInstant({ year, month, day, hour, minute, second }, sourceZone);
  return {
    date: dateInTimeZone(instant, sourceZone),
    startsAt: instant.toISOString(),
    timeZone: sourceZone,
    timeStatus: 'scheduled',
    timeLabel: timeInEastern(instant),
  };
}

function safeId(value) {
  return String(value || '')
    .trim()
    .slice(0, 180)
    .replace(/[^a-zA-Z0-9._@-]+/g, '-');
}

export function parseIcsCalendar(text, source) {
  const unfolded = unfoldIcs(text);
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  if (blocks.length === 0) throw calendarError('calendar_invalid');

  const events = [];
  for (const block of blocks) {
    const properties = block
      .split(/\r?\n/)
      .map(property)
      .filter(Boolean);
    const first = (name) => properties.find((item) => item.name === name);
    const title = unescapeIcs(first('SUMMARY')?.value);
    const startProperty = first('DTSTART');
    if (!title || !startProperty) continue;
    try {
      const start = parsedStart(startProperty, EASTERN_TIME_ZONE);
      const uid = safeId(unescapeIcs(first('UID')?.value)) || safeId(`${start.date}-${title}`);
      events.push({
        id: `${source.id}:${uid}`,
        title,
        kind: source.kind,
        sourceId: source.id,
        sourceName: source.name,
        sourceShortName: source.shortName,
        sourceUrl: source.sourceUrl,
        date: start.date,
        endDate: start.date,
        startsAt: start.startsAt,
        timeZone: start.timeZone,
        timeStatus: start.timeStatus,
        timeLabel: start.timeLabel,
      });
    } catch {
      // One malformed event must not discard the rest of an official feed.
    }
  }
  if (events.length === 0) throw calendarError('calendar_invalid');
  return events;
}
