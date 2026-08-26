import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  compare13FPeriods,
  fetchSecSnapshot,
  parseSecInformationTable,
  parseSecSubmissions,
  secHeaders,
  selectCanonical13FByPeriod,
} from '../lib/smart-money/sec.js';

const FIXTURES = new URL('./fixtures/smart-money/sec/', import.meta.url);
const INFORMATION_TABLE_XML = fs.readFileSync(new URL('information-table.xml', FIXTURES), 'utf8');
const SUBMISSIONS = JSON.parse(fs.readFileSync(new URL('submissions.json', FIXTURES), 'utf8'));
const FILING_INDEX = JSON.parse(fs.readFileSync(new URL('filing-index.json', FIXTURES), 'utf8'));

test('13F parser preserves period, filing, amendment, CUSIP, and research-only ticker', () => {
  const rows = parseSecInformationTable(INFORMATION_TABLE_XML, {
    accessionNumber: '0002045724-26-000001', periodEnd: '2026-06-30',
    filedAt: '2026-08-14T00:00:00.000Z', isAmendment: false,
  });
  assert.deepEqual(rows[0], {
    accessionNumber: '0002045724-26-000001', periodEnd: '2026-06-30',
    filedAt: '2026-08-14T00:00:00.000Z', isAmendment: false,
    amendmentChain: ['0002045724-26-000001'], issuer: 'NV&IDIA Corporation',
    securityClass: 'COM', cusip: '67066G104', ticker: null, reportedValue: 123456,
    shares: 1000, putCall: 'PUT', shareType: 'SH', paperEligible: false,
  });
});

test('SEC submission parser retains only supported forms and amendment semantics', () => {
  assert.deepEqual(parseSecSubmissions(SUBMISSIONS, { cik: '2045724' }).map((filing) => ({
    form: filing.form, periodEnd: filing.periodEnd, accessionNumber: filing.accessionNumber,
    isAmendment: filing.isAmendment,
  })), [
    { form: '13F-HR', periodEnd: '2026-06-30', accessionNumber: '0002045724-26-000001', isAmendment: false },
    { form: '13F-HR/A', periodEnd: '2026-06-30', accessionNumber: '0002045724-26-000002', isAmendment: true },
    { form: 'SC 13D', periodEnd: '2026-06-30', accessionNumber: '0002045724-26-000003', isAmendment: false },
  ]);
});

test('SEC submissions reject mismatched CIKs, malformed parallel arrays, and impossible calendar dates', () => {
  const cases = [
    (() => { const value = structuredClone(SUBMISSIONS); value.cik = '0001050446'; return value; })(),
    (() => { const value = structuredClone(SUBMISSIONS); value.cik = null; return value; })(),
    (() => { const value = structuredClone(SUBMISSIONS); value.filings.recent.form.pop(); return value; })(),
    (() => { const value = structuredClone(SUBMISSIONS); value.filings.recent.primaryDocument[0] = 42; return value; })(),
    (() => { const value = structuredClone(SUBMISSIONS); value.filings.recent.filingDate[0] = '2026-02-31'; return value; })(),
    (() => { const value = structuredClone(SUBMISSIONS); value.filings.recent.reportDate[0] = 'not-a-date'; return value; })(),
  ];
  for (const payload of cases) {
    assert.throws(() => parseSecSubmissions(payload, { cik: '2045724' }), { code: 'schema_invalid' });
  }
});

test('an amended filing replaces the original for the same period', () => {
  const selected = selectCanonical13FByPeriod([
    { periodEnd: '2026-06-30', filedAt: '2026-08-14', isAmendment: false },
    { periodEnd: '2026-06-30', filedAt: '2026-08-20', isAmendment: true },
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].isAmendment, true);
});

test('13F canonical selection excludes amendment-marked Schedule 13D and 13G filings', () => {
  const selected = selectCanonical13FByPeriod([
    { form: 'SC 13D/A', periodEnd: '2026-06-30', filedAt: '2026-08-21', isAmendment: true },
    { form: 'SC 13G/A', periodEnd: '2026-06-30', filedAt: '2026-08-22', isAmendment: true },
    { form: '13F-HR', periodEnd: '2026-06-30', filedAt: '2026-08-14', isAmendment: false },
  ]);
  assert.deepEqual(selected.map((filing) => filing.form), ['13F-HR']);
});

test('period comparison classifies new, increased, reduced, and exited holdings', () => {
  const changes = compare13FPeriods(
    [{ cusip: 'A', shares: 150 }, { cusip: 'B', shares: 20 }, { cusip: 'D', shares: 5 }],
    [{ cusip: 'A', shares: 100 }, { cusip: 'C', shares: 50 }, { cusip: 'D', shares: 10 }],
  );
  assert.deepEqual(changes.map((row) => row.classification).sort(), ['exited', 'increased', 'new', 'reduced']);
});

test('period comparison aggregates duplicate identities but preserves class and put/call variants', () => {
  const changes = compare13FPeriods(
    [
      { cusip: 'A', securityClass: 'COM', shares: 70 },
      { cusip: 'A', securityClass: 'COM', shares: 50 },
      { cusip: 'A', securityClass: 'COM', putCall: 'PUT', shares: 10 },
    ],
    [
      { cusip: 'A', securityClass: 'COM', shares: 100 },
      { cusip: 'A', securityClass: 'COM', putCall: 'PUT', shares: 10 },
      { cusip: 'A', securityClass: 'PREF', shares: 1 },
    ],
  );
  assert.deepEqual(changes.map((row) => [row.securityClass, row.putCall || null, row.shares, row.classification]).sort(), [
    ['COM', null, 120, 'increased'],
    ['PREF', null, 0, 'exited'],
  ]);
});

test('13F XML rejects blank and unsafe numeric values instead of coercing them', () => {
  assert.throws(
    () => parseSecInformationTable(INFORMATION_TABLE_XML.replace('<value>123456</value>', '<value> </value>'), {}),
    { code: 'schema_invalid' },
  );
  assert.throws(
    () => parseSecInformationTable(INFORMATION_TABLE_XML.replace('<sshPrnamt>1000</sshPrnamt>', '<sshPrnamt>9007199254740992</sshPrnamt>'), {}),
    { code: 'schema_invalid' },
  );
});

test('SEC requests require a real monitored contact and never begin without one', async () => {
  assert.throws(() => secHeaders('CommsDashboard/1.0 contact@example.com'), { code: 'configuration_missing' });
  assert.throws(() => secHeaders('CommsDashboard/1.0 contact@your-domain.invalid'), { code: 'configuration_missing' });
  assert.throws(() => secHeaders('CommsDashboard/1.0 contact@company.test'), { code: 'configuration_missing' });
  assert.throws(() => secHeaders('CommsDashboard/1.0 contact@company.example'), { code: 'configuration_missing' });
  const headers = secHeaders('CommsDashboard/1.0 compliance@monitored-contact.co');
  assert.equal(headers['User-Agent'], 'CommsDashboard/1.0 compliance@monitored-contact.co');

  let requests = 0;
  await assert.rejects(fetchSecSnapshot({ cik: '2045724', userAgent: 'invalid@example.com' }, {
    fetchProviderJson: async () => { requests += 1; return {}; },
  }), { code: 'configuration_missing' });
  assert.equal(requests, 0);
});

test('SEC snapshot uses bounded transport with an identified user agent and information table only', async () => {
  const jsonCalls = [];
  const textCalls = [];
  const snapshot = await fetchSecSnapshot({ cik: '2045724', userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co' }, {
    fetchProviderJson: async (url, options) => {
      jsonCalls.push({ url, options });
      return url.includes('/submissions/') ? SUBMISSIONS : FILING_INDEX;
    },
    fetchProviderText: async (url, options) => { textCalls.push({ url, options }); return INFORMATION_TABLE_XML; },
  });
  assert.equal(jsonCalls.length, 2);
  assert.equal(textCalls.length, 1);
  assert.equal(snapshot.filings.length, 1);
  assert.equal(snapshot.holdings[0].ticker, null);
  assert.equal(jsonCalls[0].options.requestOptions.headers['User-Agent'], 'CommsDashboard/1.0 compliance@monitored-contact.co');
  assert.match(textCalls[0].url, /infotable\.xml$/);
});

test('SEC snapshots bound the number of filing index and XML requests', async () => {
  const submissions = structuredClone(SUBMISSIONS);
  submissions.filings.recent.accessionNumber.push('0002045724-26-000005');
  submissions.filings.recent.filingDate.push('2026-08-25');
  submissions.filings.recent.reportDate.push('2026-09-30');
  submissions.filings.recent.form.push('13F-HR');
  submissions.filings.recent.primaryDocument.push('primary.xml');
  let jsonRequests = 0;
  let textRequests = 0;
  const snapshot = await fetchSecSnapshot({
    cik: '2045724', maxFilings: 1, userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
  }, {
    fetchProviderJson: async (url) => {
      jsonRequests += 1;
      return url.includes('/submissions/') ? submissions : FILING_INDEX;
    },
    fetchProviderText: async () => { textRequests += 1; return INFORMATION_TABLE_XML; },
  });
  assert.equal(snapshot.filings.length, 1);
  assert.equal(jsonRequests, 2);
  assert.equal(textRequests, 1);
});

test('SEC adapter identity rejects a CIK mismatch before transport', async () => {
  let requests = 0;
  await assert.rejects(fetchSecSnapshot({
    providerId: 'strategy-disclosures', cik: '2045724', userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
  }, {
    fetchProviderJson: async () => { requests += 1; return SUBMISSIONS; },
  }), { code: 'configuration_missing' });
  assert.equal(requests, 0);
});

test('concurrent SEC snapshots schedule every physical transport attempt, including retries', async () => {
  let active = 0;
  let maxActive = 0;
  let physicalRequests = 0;
  let queue = Promise.resolve();
  const scheduler = {
    schedule(task) {
      const run = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try { return await task(); } finally { active -= 1; }
      };
      const request = queue.then(run, run);
      queue = request.catch(() => {});
      return request;
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    physicalRequests += 1;
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  const transport = async (url, options) => {
    await options.fetchImpl(url, {});
    if (url.includes('/submissions/')) await options.fetchImpl(url, {});
    return url.includes('/submissions/') ? SUBMISSIONS : FILING_INDEX;
  };
  try {
    await Promise.all([1, 2].map(() => fetchSecSnapshot({
      cik: '2045724', userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
    }, {
      scheduler, fetchProviderJson: transport,
      fetchProviderText: async (_url, options) => { await options.fetchImpl('https://www.sec.gov/test', {}); return INFORMATION_TABLE_XML; },
    })));
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(physicalRequests, 8);
  assert.equal(maxActive, 1);
});
