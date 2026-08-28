import assert from 'node:assert/strict';
import test from 'node:test';

const BLS_ICS = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-TIMEZONE:US-Eastern
BEGIN:VEVENT
UID:bls-cpi-september
DTSTART;TZID=US-Eastern:20260911T083000
SUMMARY:Consumer Price Index
END:VEVENT
BEGIN:VEVENT
UID:bls-december
DTSTART;TZID=US-Eastern:20261210T083000
SUMMARY:Consumer Price Index
END:VEVENT
END:VCALENDAR`;

const BLS_HTML = `<!doctype html><html><body>
<h1>September 2026</h1>
<table class="release-list"><tbody>
<tr>
  <td class="date-cell"><p>Friday, September 4, 2026</p></td>
  <td class="time-cell"><p>08:30 AM</p></td>
  <td class="desc-cell"><p><strong>Employment Situation</strong> for August 2026</p></td>
</tr>
</tbody></table>
</body></html>`;

const FRED_BLS_HTML = `<!doctype html><html><body>
<div id="release-dates-pager"><table><tbody>
<tr class="odd"><td colspan="2"><span style="font-weight: bold;">Friday September 04, 2026</span></td></tr>
<tr><td>7:30 am</td><td><a href="/release?rid=50">Employment Situation</a></td></tr>
</tbody></table></div>
</body></html>`;

const FRED_EMPTY_HTML = `<!doctype html><html><body>
<div id="release-dates-pager">No release dates are available for the selected options.</div>
</body></html>`;

const FRED_2027_HTML = `<!doctype html><html><body>
<div id="release-dates-pager"><table><tbody>
<tr class="odd"><td colspan="2"><span style="font-weight: bold;">Friday January 08, 2027</span></td></tr>
<tr><td>7:30 am</td><td><a href="/release?rid=50">Employment Situation</a></td></tr>
</tbody></table></div>
</body></html>`;

const OMB_BLS_TEXT = `SCHEDULE OF RELEASE DATES FOR
PRINCIPAL FEDERAL ECONOMIC INDICATORS FOR 2026
DEPT AGENCY/INDICATORS JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC
LABOR
BUREAU OF LABOR STATISTICS
The Employment Situation
(Data are for previous month)
9 6 6 3 8 5 2 7 4 2 6 4
Producer Price Indexes
(Data are for previous month)
14 12 12 14 13 11 15 13 10 15 13 15
Consumer Price Index
(Data are for previous month)
13 11 11 10 12 10 14 12 11 14 10 10
Real Earnings
(Data are for previous month )
13 11 11 10 12 10 14 12 11 14 10 10
Productivity and Costs
(Preliminary and revised estimates are issued for each quarter)
-- 5
4Q'25
5
4Q'25
-- 7
1Q'26
4
1Q'26
-- 6
2Q'26
3
2Q'26
-- 5
3Q'26
8
3Q'26
Employment Cost Index
(Data are for previous month)
30 -- -- 30 -- -- 31 -- -- 30 -- --
U.S. Import and Export Price Indexes
(Data are for previous month)
15 18 17 15 14 16 17 18 16 16 17 17
DEPT AGENCY/INDICATORS JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC
FEDERAL RESERVE BOARD`;

function ombTextForYear(year) {
  const priorYear = String(year - 1).slice(-2);
  const currentYear = String(year).slice(-2);
  return OMB_BLS_TEXT
    .replace('FOR 2026', `FOR ${year}`)
    .replaceAll("4Q'25", `4Q'${priorYear}`)
    .replace(/([123])Q'26/g, `$1Q'${currentYear}`);
}

function escapePdfText(value) {
  return String(value).replace(/([\\()])/g, '\\$1');
}

function createOmbPdfFixture() {
  const pageText = OMB_BLS_TEXT.split('\n')
    .map((line, index) => (
      `BT /F1 8 Tf 1 0 0 1 30 ${2150 - (index * 12)} Tm (${escapePdfText(line)}) Tj ET\n`
    ))
    .join('');
  const streams = [
    'BT /F1 10 Tf 30 2150 Td (Cover) Tj ET\n',
    'BT /F1 10 Tf 30 2150 Td (Contents) Tj ET\n',
    'BT /F1 10 Tf 30 2150 Td (Commerce) Tj ET\n',
    pageText,
    'BT /F1 10 Tf 30 2150 Td (Federal Reserve Board) Tj ET\n',
  ];
  const objects = new Map([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>'],
    [8, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [39 /quotesingle] >> >>'],
  ]);
  for (let pageIndex = 0; pageIndex < streams.length; pageIndex += 1) {
    objects.set(3 + pageIndex, [
      '<< /Type /Page /Parent 2 0 R',
      '/MediaBox [0 0 612 2200]',
      '/Resources << /Font << /F1 8 0 R >> >>',
      `/Contents ${9 + pageIndex} 0 R >>`,
    ].join(' '));
    objects.set(9 + pageIndex, [
      `<< /Length ${Buffer.byteLength(streams[pageIndex], 'latin1')} >>`,
      'stream',
      streams[pageIndex],
      'endstream',
    ].join('\n'));
  }

  let pdf = '%PDF-1.7\n% deterministic unit-test fixture\n';
  const offsets = Array(14).fill(0);
  for (let objectNumber = 1; objectNumber <= 13; objectNumber += 1) {
    offsets[objectNumber] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${objectNumber} 0 obj\n${objects.get(objectNumber)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 14\n0000000000 65535 f \n';
  pdf += offsets.slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size 14 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf, 'latin1'));
}

const BEA_ICS = `BEGIN:VCALENDAR
VERSION:2.0
TZID:America/New_York
BEGIN:VEVENT
UID:bea-gdp-september
DTSTART;VALUE=DATE-TIME:20260930T123000Z
SUMMARY:GDP (Third Estimate)\, Industries\, Corporate Profits\, State GDP\,
 and State Personal Income\, 2nd Quarter 2026
END:VEVENT
END:VCALENDAR`;

const FED_HTML = `<!doctype html><html><body>
  <div class="panel panel-default">
    <div class="panel-heading"><h4><a id="2026">2026 FOMC Meetings</a></h4></div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>September</strong></div>
      <div class="fomc-meeting__date">15-16*</div>
    </div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>October</strong></div>
      <div class="fomc-meeting__date">27-28</div>
    </div>
  </div>
  <div class="panel panel-default">
    <div class="panel-heading"><h4><a id="2027">2027 FOMC Meetings</a></h4></div>
    <div class="row fomc-meeting">
      <div class="fomc-meeting__month"><strong>Jan/Feb</strong></div>
      <div class="fomc-meeting__date">31-1*</div>
    </div>
  </div>
</body></html>`;

async function calendarModule(path) {
  try {
    return await import(path);
  } catch {
    return {};
  }
}

async function blockedBytes() {
  throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test('BLS ICS parsing preserves the official Eastern time as an exact UTC instant', async () => {
  // Catches silently treating an Eastern release time as UTC.
  const { parseIcsCalendar } = await calendarModule('../lib/calendar/ics.js');
  assert.equal(typeof parseIcsCalendar, 'function');

  const events = parseIcsCalendar(BLS_ICS, {
    id: 'bls',
    name: 'U.S. Bureau of Labor Statistics',
    shortName: 'BLS',
    sourceUrl: 'https://www.bls.gov/schedule/news_release/bls.ics',
    kind: 'economic-release',
  });

  assert.deepEqual(events[0], {
    id: 'bls:bls-cpi-september',
    title: 'Consumer Price Index',
    kind: 'economic-release',
    sourceId: 'bls',
    sourceName: 'U.S. Bureau of Labor Statistics',
    sourceShortName: 'BLS',
    sourceUrl: 'https://www.bls.gov/schedule/news_release/bls.ics',
    date: '2026-09-11',
    endDate: '2026-09-11',
    startsAt: '2026-09-11T12:30:00.000Z',
    timeZone: 'America/New_York',
    timeStatus: 'scheduled',
    timeLabel: '8:30 AM ET',
  });
});

test('OMB principal-indicator parsing returns only supported BLS rows without inventing release times', async () => {
  const { parseOmbBlsText } = await calendarModule('../lib/calendar/omb.js');
  assert.equal(typeof parseOmbBlsText, 'function');
  const source = {
    id: 'bls',
    name: 'BLS principal releases via OMB/OIRA',
    shortName: 'OMB/BLS',
    sourceUrl: 'https://www.census.gov/economic-indicators/econcards/assets/pdf/censusreleaseglance_2026.pdf',
    kind: 'economic-release',
  };

  const events = parseOmbBlsText(OMB_BLS_TEXT, source, 2026);

  assert.equal(events.length, 72);
  assert.deepEqual(events[0], {
    id: 'bls:2026-01-09:the-employment-situation',
    title: 'The Employment Situation',
    kind: 'economic-release',
    sourceId: 'bls',
    sourceName: 'BLS principal releases via OMB/OIRA',
    sourceShortName: 'OMB/BLS',
    sourceUrl: source.sourceUrl,
    date: '2026-01-09',
    endDate: '2026-01-09',
    startsAt: null,
    timeZone: null,
    timeStatus: 'date-only',
    timeLabel: 'Date only',
  });
  assert.equal(events.filter(({ title }) => title === 'Employment Cost Index').length, 4);
  assert.equal(events.filter(({ title }) => title === 'Productivity and Costs').length, 8);
  assert.ok(events.every(({ startsAt, timeZone, timeStatus, timeLabel }) => (
    startsAt === null && timeZone === null && timeStatus === 'date-only' && timeLabel === 'Date only'
  )));
  assert.throws(
    () => parseOmbBlsText(OMB_BLS_TEXT.replace('FOR 2026', 'FOR 2025'), source, 2026),
    (error) => error?.code === 'calendar_invalid',
  );
  assert.throws(
    () => parseOmbBlsText(OMB_BLS_TEXT.replace('15 18 17 15 14 16 17 18 16 16 17 17', '15 18 17'), source, 2026),
    (error) => error?.code === 'calendar_invalid',
  );
  assert.throws(
    () => parseOmbBlsText(OMB_BLS_TEXT.replace('9 6 6 3 8 5 2 7 4 2 6 4', '-- -- -- -- -- -- -- -- -- -- -- --'), source, 2026),
    (error) => error?.code === 'calendar_invalid',
  );
  assert.throws(
    () => parseOmbBlsText(OMB_BLS_TEXT.replace('30 -- -- 30 -- -- 31 -- -- 30 -- --', '30 27 30 30 29 29 31 31 29 30 30 30'), source, 2026),
    (error) => error?.code === 'calendar_invalid',
  );
  assert.throws(
    () => parseOmbBlsText(OMB_BLS_TEXT.replace('DEPT AGENCY/INDICATORS JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC\nLABOR\n', ''), source, 2026),
    (error) => error?.code === 'calendar_invalid',
  );
  assert.throws(
    () => parseOmbBlsText(OMB_BLS_TEXT.replace('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC', 'DEC NOV OCT SEP AUG JUL JUN MAY APR MAR FEB JAN'), source, 2026),
    (error) => error?.code === 'calendar_invalid',
  );
});

test('OMB PDF parsing validates the document envelope before accepting one complete BLS page', async () => {
  const { parseOmbBlsPdf, SAFE_PDF_OPTIONS } = await calendarModule('../lib/calendar/omb.js');
  assert.equal(typeof parseOmbBlsPdf, 'function');
  assert.deepEqual(SAFE_PDF_OPTIONS, {
    isEvalSupported: false,
    maxImageSize: 4_000_000,
    stopAtErrors: true,
    verbosity: 0,
  });
  const source = {
    id: 'bls',
    name: 'BLS principal releases via OMB/OIRA',
    shortName: 'OMB/BLS',
    sourceUrl: 'https://www.census.gov/economic-indicators/econcards/assets/pdf/censusreleaseglance_2026.pdf',
    kind: 'economic-release',
  };
  const pdf = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
  const extractPdfPages = async () => ({ totalPages: 5, text: ['', '', '', OMB_BLS_TEXT, ''] });

  const events = await parseOmbBlsPdf(pdf, source, 2026, { extractPdfPages });

  assert.equal(events.length, 72);
  await assert.rejects(
    parseOmbBlsPdf(Uint8Array.of(0x3c, 0x68, 0x74, 0x6d), source, 2026, { extractPdfPages }),
    (error) => error?.code === 'calendar_invalid',
  );
  await assert.rejects(
    parseOmbBlsPdf(pdf, source, 2026, {
      extractPdfPages: async () => ({ totalPages: 11, text: Array(11).fill(OMB_BLS_TEXT) }),
    }),
    (error) => error?.code === 'calendar_invalid',
  );
});

test('OMB PDF parsing exercises the pinned real PDF.js extractor without network access', async () => {
  const { parseOmbBlsPdf } = await calendarModule('../lib/calendar/omb.js');
  assert.equal(typeof parseOmbBlsPdf, 'function');
  const source = {
    id: 'bls',
    name: 'BLS principal releases via OMB/OIRA',
    shortName: 'OMB/BLS',
    sourceUrl: 'https://www.census.gov/economic-indicators/econcards/assets/pdf/censusreleaseglance_2026.pdf',
    kind: 'economic-release',
  };

  const events = await parseOmbBlsPdf(createOmbPdfFixture(), source, 2026);

  assert.equal(events.length, 72);
  assert.equal(events[0].id, 'bls:2026-01-09:the-employment-situation');
  assert.ok(events.every(({ startsAt, timeZone, timeStatus }) => (
    startsAt === null && timeZone === null && timeStatus === 'date-only'
  )));
});

test('calendar keeps BLS live from its official annual schedule when the ICS endpoint is blocked', async () => {
  // Catches serverless-network rejection of the ICS file degrading an otherwise
  // available first-party BLS schedule.
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const annualUrl = 'https://www.bls.gov/schedule/2026/';
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    fetchBytes: blockedBytes,
    fetchText: async (url) => {
      if (url.endsWith('/bls.ics')) throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
      if (url === annualUrl) return { text: BLS_HTML, sourceLastModifiedAt: null };
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected source');
    },
  });

  assert.equal(snapshot.partial, false);
  assert.deepEqual(snapshot.providers.map(({ id, status }) => ({ id, status })), [
    { id: 'bls', status: 'live' },
    { id: 'bea', status: 'live' },
    { id: 'federal-reserve', status: 'live' },
  ]);
  const blsEvent = snapshot.events.find((event) => event.sourceId === 'bls');
  assert.deepEqual(blsEvent, {
    id: 'bls:2026-09-04:employment-situation-for-august-2026',
    title: 'Employment Situation for August 2026',
    kind: 'economic-release',
    sourceId: 'bls',
    sourceName: 'U.S. Bureau of Labor Statistics',
    sourceShortName: 'BLS',
    sourceUrl: annualUrl,
    date: '2026-09-04',
    endDate: '2026-09-04',
    startsAt: '2026-09-04T12:30:00.000Z',
    timeZone: 'America/New_York',
    timeStatus: 'scheduled',
    timeLabel: '8:30 AM ET',
  });
});

test('calendar keeps BLS live from the official OMB/Census schedule when BLS is blocked', async () => {
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const { parseOmbBlsText } = await calendarModule('../lib/calendar/omb.js');
  const sourceUrl = 'https://www.census.gov/economic-indicators/econcards/assets/pdf/censusreleaseglance_2026.pdf';
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    fetchText: async (url) => {
      if (url.includes('bls.gov') || url.includes('fred.stlouisfed.org')) {
        throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
      }
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected text source');
    },
    fetchBytes: async (url) => {
      assert.equal(url, sourceUrl);
      return { bytes: Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d), sourceLastModifiedAt: '2026-07-30T19:49:10.000Z' };
    },
    parseOmbPdf: async (_bytes, source, year) => parseOmbBlsText(OMB_BLS_TEXT, source, year),
  });

  assert.equal(snapshot.state, 'live');
  assert.equal(snapshot.partial, false);
  const provider = snapshot.providers.find(({ id }) => id === 'bls');
  assert.deepEqual(provider, {
    id: 'bls',
    name: 'BLS principal releases via OMB/OIRA',
    shortName: 'OMB/BLS',
    sourceUrl,
    status: 'live',
    eventCount: 18,
    fetchedAt: '2026-08-28T15:00:00.000Z',
    sourceLastModifiedAt: '2026-07-30T19:49:10.000Z',
  });
  const event = snapshot.events.find(({ id }) => id === 'bls:2026-09-04:the-employment-situation');
  assert.equal(event?.sourceUrl, sourceUrl);
  assert.equal(event?.startsAt, null);
  assert.equal(event?.timeLabel, 'Date only');
});

test('calendar requires and attributes every OMB schedule in a cross-year window', async () => {
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const { parseOmbBlsText } = await calendarModule('../lib/calendar/omb.js');
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-12-31T15:00:00.000Z'),
    fetchText: async (url) => {
      if (url.includes('bls.gov') || url.includes('fred.stlouisfed.org')) {
        throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
      }
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected text source');
    },
    fetchBytes: async (url) => ({
      bytes: Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d),
      sourceLastModifiedAt: url.includes('2027') ? '2026-09-30T12:00:00.000Z' : '2026-07-30T19:49:10.000Z',
    }),
    parseOmbPdf: async (_bytes, source, year) => parseOmbBlsText(ombTextForYear(year), source, year),
  });

  const provider = snapshot.providers.find(({ id }) => id === 'bls');
  assert.equal(snapshot.state, 'live');
  assert.equal(provider?.shortName, 'OMB/BLS');
  assert.equal(provider?.sourceUrl, 'https://www.whitehouse.gov/omb/information-resources/guidance/us-principal-federal-economic-indicators/');
  assert.equal(provider?.sourceLastModifiedAt, '2026-09-30T12:00:00.000Z');
  assert.equal(provider?.eventCount, 18);
  assert.ok(snapshot.events.filter(({ sourceId }) => sourceId === 'bls').every(({ sourceUrl }) => sourceUrl.includes('censusreleaseglance_2027.pdf')));
});

test('calendar transparently attributes FRED when the BLS network blocks every direct source', async () => {
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    fetchBytes: blockedBytes,
    fetchText: async (url) => {
      if (url.includes('bls.gov')) throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
      if (url.includes('fred.stlouisfed.org')) return { text: FRED_BLS_HTML, sourceLastModifiedAt: null };
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected source');
    },
  });

  assert.equal(snapshot.partial, false);
  const provider = snapshot.providers.find(({ id }) => id === 'bls');
  assert.deepEqual(provider, {
    id: 'bls',
    name: 'BLS releases via FRED',
    shortName: 'FRED/BLS',
    sourceUrl: 'https://fred.stlouisfed.org/releases/calendar',
    status: 'live',
    eventCount: 1,
    fetchedAt: '2026-08-28T15:00:00.000Z',
    sourceLastModifiedAt: null,
  });
  const event = snapshot.events.find(({ sourceId }) => sourceId === 'bls');
  assert.equal(event.sourceName, 'BLS releases via FRED');
  assert.equal(event.sourceShortName, 'FRED/BLS');
  assert.match(event.sourceUrl, /^https:\/\/fred\.stlouisfed\.org\/releases\/calendar\?/);
  assert.equal(event.startsAt, '2026-09-04T12:30:00.000Z');
  assert.equal(event.timeLabel, '8:30 AM ET');
});

test('an explicitly empty FRED release page does not disable other BLS release families', async () => {
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    fetchBytes: blockedBytes,
    fetchText: async (url) => {
      if (url.includes('bls.gov')) throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
      if (url.includes('fred.stlouisfed.org')) {
        return { text: url.includes('rid=11&') ? FRED_EMPTY_HTML : FRED_BLS_HTML, sourceLastModifiedAt: null };
      }
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected source');
    },
  });

  assert.equal(snapshot.state, 'live');
  assert.equal(snapshot.partial, false);
  assert.equal(snapshot.providers.find(({ id }) => id === 'bls')?.status, 'live');
  assert.ok(snapshot.events.some(({ sourceId }) => sourceId === 'bls'));
});

test('the BLS fallback chain is bounded below the browser request deadline', async () => {
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const startedAt = Date.now();
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    httpOptions: { timeoutMs: 15 },
    fetchBytes: blockedBytes,
    fetchText: async (url) => {
      if (url.includes('bls.gov')) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        throw Object.assign(new Error('blocked'), { code: 'upstream_timeout' });
      }
      if (url.includes('fred.stlouisfed.org')) return { text: FRED_BLS_HTML, sourceLastModifiedAt: null };
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected source');
    },
  });

  assert.equal(snapshot.state, 'live');
  assert.equal(snapshot.providers.find(({ id }) => id === 'bls')?.shortName, 'FRED/BLS');
  assert.ok(Date.now() - startedAt < 100, 'fallback should not await every slow direct BLS request');
});

test('a slower serverless FRED response still completes before the browser deadline', { timeout: 7_500 }, async () => {
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const startedAt = Date.now();
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    fetchBytes: blockedBytes,
    fetchText: async (url) => {
      if (url.includes('bls.gov')) return new Promise(() => {});
      if (url.includes('fred.stlouisfed.org')) {
        await new Promise((resolve) => setTimeout(resolve, 3_200));
        return { text: FRED_BLS_HTML, sourceLastModifiedAt: null };
      }
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected source');
    },
  });

  assert.equal(snapshot.state, 'live');
  assert.equal(snapshot.providers.find(({ id }) => id === 'bls')?.shortName, 'FRED/BLS');
  assert.ok(Date.now() - startedAt < 7_000, 'fallback must complete before the 8-second UI deadline');
});

test('an incomplete cross-year annual schedule yields to usable upcoming FRED releases', async () => {
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  const { parseOmbBlsText } = await calendarModule('../lib/calendar/omb.js');
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-12-31T15:00:00.000Z'),
    fetchBytes: async (url) => {
      if (url.includes('2027')) throw Object.assign(new Error('missing'), { code: 'upstream_unavailable' });
      return { bytes: Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d), sourceLastModifiedAt: null };
    },
    parseOmbPdf: async (_bytes, source, year) => parseOmbBlsText(ombTextForYear(year), source, year),
    fetchText: async (url) => {
      if (url.endsWith('/bls.ics')) throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
      if (url.endsWith('/schedule/2026/')) return { text: BLS_HTML, sourceLastModifiedAt: null };
      if (url.endsWith('/schedule/2027/')) throw Object.assign(new Error('blocked'), { code: 'upstream_unavailable' });
      if (url.includes('fred.stlouisfed.org')) return { text: FRED_2027_HTML, sourceLastModifiedAt: null };
      if (url.includes('bea.gov')) return { text: BEA_ICS, sourceLastModifiedAt: null };
      if (url.includes('federalreserve.gov')) return { text: FED_HTML, sourceLastModifiedAt: null };
      throw new Error('unexpected source');
    },
  });

  const provider = snapshot.providers.find(({ id }) => id === 'bls');
  assert.equal(snapshot.state, 'live');
  assert.equal(provider?.shortName, 'FRED/BLS');
  assert.equal(provider?.eventCount, 1);
  assert.equal(snapshot.events.find(({ sourceId }) => sourceId === 'bls')?.date, '2027-01-08');
});

test('BEA ICS parsing unfolds continuation lines and converts escaped punctuation', async () => {
  // Catches truncating folded official titles or displaying ICS escapes.
  const { parseIcsCalendar } = await calendarModule('../lib/calendar/ics.js');
  assert.equal(typeof parseIcsCalendar, 'function');

  const [event] = parseIcsCalendar(BEA_ICS, {
    id: 'bea',
    name: 'U.S. Bureau of Economic Analysis',
    shortName: 'BEA',
    sourceUrl: 'https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics',
    kind: 'economic-release',
  });

  assert.equal(event.title, 'GDP (Third Estimate), Industries, Corporate Profits, State GDP, and State Personal Income, 2nd Quarter 2026');
  assert.equal(event.startsAt, '2026-09-30T12:30:00.000Z');
  assert.equal(event.date, '2026-09-30');
  assert.equal(event.timeLabel, '8:30 AM ET');
});

test('Fed parsing returns official meeting ranges without inventing a release time', async () => {
  // Catches assigning a market-convention time that the source page does not publish.
  const { parseFedCalendar } = await calendarModule('../lib/calendar/fed.js');
  assert.equal(typeof parseFedCalendar, 'function');

  const events = parseFedCalendar(FED_HTML, {
    id: 'federal-reserve',
    name: 'Federal Reserve',
    shortName: 'Fed',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    kind: 'policy-meeting',
  });

  assert.deepEqual(events[0], {
    id: 'federal-reserve:2026-09-15:2026-09-16',
    title: 'FOMC meeting',
    kind: 'policy-meeting',
    sourceId: 'federal-reserve',
    sourceName: 'Federal Reserve',
    sourceShortName: 'Fed',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    date: '2026-09-15',
    endDate: '2026-09-16',
    startsAt: null,
    timeZone: 'America/New_York',
    timeStatus: 'unspecified',
    timeLabel: 'Time not specified',
  });
  assert.equal(events[2].date, '2027-01-31');
  assert.equal(events[2].endDate, '2027-02-01');
});

test('calendar snapshot keeps successful official providers when another provider is unavailable', async () => {
  // Catches turning a single provider failure into a blank calendar.
  const { buildCalendarSnapshot, CALENDAR_PROVIDERS } = await calendarModule('../lib/calendar/index.js');
  assert.equal(typeof buildCalendarSnapshot, 'function');
  assert.ok(Array.isArray(CALENDAR_PROVIDERS));

  const payloadById = {
    bls: { text: BLS_ICS, sourceLastModifiedAt: '2026-08-27T15:00:00.000Z' },
    bea: { text: BEA_ICS, sourceLastModifiedAt: '2026-08-28T12:00:00.000Z' },
  };
  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    fetchText: async (_url, provider) => {
      if (provider.id === 'federal-reserve') throw Object.assign(new Error('private upstream details'), { code: 'upstream_unavailable' });
      return payloadById[provider.id];
    },
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.degraded, true);
  assert.equal(snapshot.state, 'degraded');
  assert.deepEqual(snapshot.window, { from: '2026-08-28', through: '2026-11-26', days: 90 });
  assert.deepEqual(snapshot.events.map((event) => event.id), [
    'bls:bls-cpi-september',
    'bea:bea-gdp-september',
  ]);
  assert.deepEqual(snapshot.providers.map(({ id, status, eventCount }) => ({ id, status, eventCount })), [
    { id: 'bls', status: 'live', eventCount: 1 },
    { id: 'bea', status: 'live', eventCount: 1 },
    { id: 'federal-reserve', status: 'unavailable', eventCount: 0 },
  ]);
  assert.equal(JSON.stringify(snapshot).includes('private upstream details'), false);
  assert.equal(snapshot.fetchedAt, '2026-08-28T15:00:00.000Z');
  assert.equal(snapshot.asOf, '2026-08-28T15:00:00.000Z');
});

test('calendar snapshot reports unavailable only when every official provider fails', async () => {
  // Catches falsely labelling an empty all-failed response as live.
  const { buildCalendarSnapshot } = await calendarModule('../lib/calendar/index.js');
  assert.equal(typeof buildCalendarSnapshot, 'function');

  const snapshot = await buildCalendarSnapshot({
    now: new Date('2026-08-28T15:00:00.000Z'),
    fetchBytes: blockedBytes,
    fetchText: async () => { throw new Error('secret upstream response'); },
  });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.degraded, true);
  assert.equal(snapshot.state, 'unavailable');
  assert.deepEqual(snapshot.events, []);
  assert.equal(JSON.stringify(snapshot).includes('secret upstream response'), false);
});

test('official calendar requests reject on their configured deadline even when fetch ignores abort', async () => {
  // Catches serverless invocations hanging indefinitely on an upstream socket.
  const { fetchOfficialText } = await calendarModule('../lib/calendar/http.js');
  assert.equal(typeof fetchOfficialText, 'function');

  const never = () => new Promise(() => {});
  await assert.rejects(
    fetchOfficialText('https://example.gov/calendar', { fetchImpl: never, timeoutMs: 10 }),
    (error) => error?.code === 'upstream_timeout',
  );
});

test('official PDF requests accept only bounded PDF responses with a valid signature', async () => {
  const { fetchOfficialBytes } = await calendarModule('../lib/calendar/http.js');
  assert.equal(typeof fetchOfficialBytes, 'function');
  const pdf = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
  const headers = {
    'content-type': 'application/pdf',
    'content-length': String(pdf.byteLength),
    'last-modified': 'Thu, 30 Jul 2026 19:49:10 GMT',
  };

  const loaded = await fetchOfficialBytes('https://www.census.gov/schedule.pdf', {
    fetchImpl: async () => new Response(pdf, { status: 200, headers }),
  });

  assert.deepEqual([...loaded.bytes], [...pdf]);
  assert.equal(loaded.sourceLastModifiedAt, '2026-07-30T19:49:10.000Z');
  await assert.rejects(
    fetchOfficialBytes('https://www.census.gov/not-pdf', {
      fetchImpl: async () => new Response(pdf, { status: 200, headers: { ...headers, 'content-type': 'text/html' } }),
    }),
    (error) => error?.code === 'upstream_invalid',
  );
  await assert.rejects(
    fetchOfficialBytes('https://www.census.gov/bad-signature.pdf', {
      fetchImpl: async () => new Response('not a pdf', { status: 200, headers: { ...headers, 'content-length': '9' } }),
    }),
    (error) => error?.code === 'upstream_invalid',
  );
  await assert.rejects(
    fetchOfficialBytes('https://www.census.gov/oversized.pdf', {
      fetchImpl: async () => new Response(new Uint8Array(2_000_001), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    }),
    (error) => error?.code === 'upstream_invalid',
  );
});

test('official calendar request deadlines also bound stalled response bodies', async () => {
  const { fetchOfficialBytes, fetchOfficialText } = await calendarModule('../lib/calendar/http.js');
  const headers = { get: (name) => (name === 'content-type' ? 'application/pdf' : null) };
  await assert.rejects(
    fetchOfficialBytes('https://www.census.gov/stalled.pdf', {
      timeoutMs: 10,
      fetchImpl: async () => ({ ok: true, headers, arrayBuffer: () => new Promise(() => {}) }),
    }),
    (error) => error?.code === 'upstream_timeout',
  );
  await assert.rejects(
    fetchOfficialText('https://www.bls.gov/stalled.ics', {
      timeoutMs: 10,
      fetchImpl: async () => ({ ok: true, headers: { get: () => null }, arrayBuffer: () => new Promise(() => {}) }),
    }),
    (error) => error?.code === 'upstream_timeout',
  );
});

test('calendar API is GET-only, rejects query keys, and caches successful public schedules', async () => {
  // Catches unbounded route inputs or accidental mutation support.
  const { createCalendarHandler } = await calendarModule('../api/calendar.js');
  assert.equal(typeof createCalendarHandler, 'function');
  let builds = 0;
  const snapshot = {
    ok: true,
    partial: false,
    degraded: false,
    state: 'live',
    fetchedAt: '2026-08-28T15:00:00.000Z',
    asOf: '2026-08-28T15:00:00.000Z',
    window: { from: '2026-08-28', through: '2026-11-26', days: 90 },
    providers: [],
    events: [],
  };
  const handler = createCalendarHandler({
    buildSnapshot: async () => { builds += 1; return snapshot; },
  });

  const methodResponse = createResponse();
  await handler({ method: 'POST', query: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405);
  assert.equal(methodResponse.headers.Allow, 'GET');
  assert.equal(methodResponse.headers['Cache-Control'], 'no-store');

  const queryResponse = createResponse();
  await handler({ method: 'GET', query: { refresh: '1' } }, queryResponse);
  assert.equal(queryResponse.statusCode, 400);
  assert.equal(queryResponse.headers['Cache-Control'], 'no-store');

  const liveResponse = createResponse();
  await handler({ method: 'GET', query: {} }, liveResponse);
  assert.equal(liveResponse.statusCode, 200);
  assert.match(liveResponse.headers['Cache-Control'], /s-maxage=1800/);
  assert.deepEqual(liveResponse.body, snapshot);
  assert.equal(builds, 1);
});

test('calendar API returns a fixed safe 502 payload when all official providers are unavailable', async () => {
  // Catches exposing raw provider errors through the public route.
  const { createCalendarHandler } = await calendarModule('../api/calendar.js');
  assert.equal(typeof createCalendarHandler, 'function');
  const handler = createCalendarHandler({
    buildSnapshot: async () => ({
      ok: false,
      partial: true,
      degraded: true,
      state: 'unavailable',
      fetchedAt: '2026-08-28T15:00:00.000Z',
      asOf: '2026-08-28T15:00:00.000Z',
      window: { from: '2026-08-28', through: '2026-11-26', days: 90 },
      providers: [{ id: 'bls', status: 'unavailable', eventCount: 0 }],
      events: [],
    }),
  });
  const response = createResponse();

  await handler({ method: 'GET', query: {} }, response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body.error, {
    code: 'calendar_unavailable',
    message: 'Official economic calendars are temporarily unavailable.',
  });
  assert.equal(JSON.stringify(response.body).includes('secret'), false);
});
