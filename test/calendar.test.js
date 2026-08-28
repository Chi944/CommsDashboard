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
