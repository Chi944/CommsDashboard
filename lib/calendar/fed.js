import { load } from 'cheerio';

const MONTHS = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
});

function calendarError() {
  const error = new Error('calendar_invalid');
  error.code = 'calendar_invalid';
  return error;
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw calendarError();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function meetingRange(year, monthText, dayText) {
  const monthNames = String(monthText || '').trim().toLowerCase().split('/').map((value) => value.trim());
  let startMonth = MONTHS[monthNames[0]];
  let endMonth = MONTHS[monthNames[1] || monthNames[0]];
  const days = String(dayText || '').replace(/\*/g, '').match(/(\d{1,2})(?:\s*-\s*(\d{1,2}))?/);
  if (!startMonth || !endMonth || !days) throw calendarError();
  const startDay = Number(days[1]);
  const endDay = Number(days[2] || days[1]);
  let endYear = year;
  if (endMonth < startMonth) endYear += 1;
  if (endMonth === startMonth && endDay < startDay) {
    endMonth += 1;
    if (endMonth === 13) {
      endMonth = 1;
      endYear += 1;
    }
  }
  return { date: isoDate(year, startMonth, startDay), endDate: isoDate(endYear, endMonth, endDay) };
}

export function parseFedCalendar(html, source) {
  const $ = load(String(html || ''));
  const events = [];
  $('.panel').each((_panelIndex, panel) => {
    const heading = $(panel).find('.panel-heading').first().text().replace(/\s+/g, ' ').trim();
    const yearMatch = heading.match(/\b(20\d{2})\s+FOMC Meetings\b/i);
    if (!yearMatch) return;
    const year = Number(yearMatch[1]);
    $(panel).find('.fomc-meeting').each((_meetingIndex, meeting) => {
      const month = $(meeting).find('.fomc-meeting__month').first().text().replace(/\s+/g, ' ').trim();
      const days = $(meeting).find('.fomc-meeting__date').first().text().replace(/\s+/g, ' ').trim();
      try {
        const range = meetingRange(year, month, days);
        events.push({
          id: `${source.id}:${range.date}:${range.endDate}`,
          title: 'FOMC meeting',
          kind: source.kind,
          sourceId: source.id,
          sourceName: source.name,
          sourceShortName: source.shortName,
          sourceUrl: source.sourceUrl,
          date: range.date,
          endDate: range.endDate,
          startsAt: null,
          timeZone: 'America/New_York',
          timeStatus: 'unspecified',
          timeLabel: 'Time not specified',
        });
      } catch {
        // Skip a malformed row while preserving other official meetings.
      }
    });
  });
  if (events.length === 0) throw calendarError();
  return events;
}
