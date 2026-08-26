import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  compare13FPeriods,
  fetchSecInstitutionalDisclosure,
  fetchSecSnapshot,
  parseSecInstitutionalDisclosureDocument,
  parseSecInformationTable,
  parseSecSubmissions,
  secHeaders,
  selectCanonical13FByPeriod,
} from '../lib/smart-money/sec.js';
import {
  institutionalFiling,
  institutionalInlineXbrl,
} from './fixtures/smart-money/sec/institutional-inline-xbrl.js';

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
    providerId: 'institutional-strategy', cik: '2045724', userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
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

test('fixed institutional SEC profiles extract exact inline-XBRL facts and normalize scale', () => {
  const cases = [
    ['institutional-strategy', 846_000, 49_672_080_000],
    ['institutional-tesla', 11_509, null],
    ['institutional-ibit', 734_261, 43_395_920_710],
    ['institutional-fbtc', 174_383, 10_306_297_000],
    ['institutional-arkb', 32_178.2280, 1_889_314_000],
    ['institutional-bitb', 36_207.6919, 2_125_990_000],
  ];
  for (const [providerId, btcAmount, reportedValueUsd] of cases) {
    const result = parseSecInstitutionalDisclosureDocument(
      institutionalInlineXbrl(providerId),
      providerId,
      { reportDate: '2026-06-30' },
    );
    assert.deepEqual(result, { btcAmount, reportedValueUsd });
  }
  assert.deepEqual(
    parseSecInstitutionalDisclosureDocument(
      institutionalInlineXbrl('institutional-ibit', { duplicateQuantity: '734,261' }),
      'institutional-ibit',
      { reportDate: '2026-06-30' },
    ),
    { btcAmount: 734_261, reportedValueUsd: 43_395_920_710 },
  );
});

test('institutional SEC profiles reject missing, conflicting, nil, negative, and context drift', () => {
  for (const document of [
    institutionalInlineXbrl('institutional-ibit', { omitValue: true }),
    institutionalInlineXbrl('institutional-ibit', { duplicateQuantity: '734,262' }),
    institutionalInlineXbrl('institutional-ibit', { nilQuantity: true }),
    institutionalInlineXbrl('institutional-ibit', { quantity: '-734,261' }),
    institutionalInlineXbrl('institutional-ibit', { reportDate: '2026-03-31' }),
    institutionalInlineXbrl('institutional-ibit', {
      dimension: { kind: 'explicit', axis: 'us-gaap:InvestmentIdentifierAxis', value: 'fake:OtherInvestmentMember' },
    }),
  ]) {
    assert.throws(
      () => parseSecInstitutionalDisclosureDocument(document, 'institutional-ibit', {
        reportDate: '2026-06-30',
      }),
      { code: 'schema_invalid' },
    );
  }
  assert.throws(
    () => parseSecInstitutionalDisclosureDocument(
      institutionalInlineXbrl('institutional-ibit'),
      'institutional-fake',
    ),
    { code: 'configuration_missing' },
  );
});

test('institutional profiles ignore comparison periods and wrong-dimension target facts after exact context selection', () => {
  assert.deepEqual(parseSecInstitutionalDisclosureDocument(
    institutionalInlineXbrl('institutional-strategy', { comparisonQuantity: '1' }),
    'institutional-strategy',
    { reportDate: '2026-06-30' },
  ), { btcAmount: 846_000, reportedValueUsd: 49_672_080_000 });
  assert.deepEqual(parseSecInstitutionalDisclosureDocument(
    institutionalInlineXbrl('institutional-fbtc'),
    'institutional-fbtc',
    { reportDate: '2026-06-30' },
  ), { btcAmount: 174_383, reportedValueUsd: 10_306_297_000 });
  assert.deepEqual(parseSecInstitutionalDisclosureDocument(
    institutionalInlineXbrl('institutional-bitb'),
    'institutional-bitb',
    { reportDate: '2026-06-30' },
  ), { btcAmount: 36_207.6919, reportedValueUsd: 2_125_990_000 });
});

test('institutional profiles accept identical exact-target duplicates but reject ambiguous target candidates', () => {
  assert.deepEqual(parseSecInstitutionalDisclosureDocument(
    institutionalInlineXbrl('institutional-ibit', { duplicateQuantity: '734,261' }),
    'institutional-ibit',
    { reportDate: '2026-06-30' },
  ), { btcAmount: 734_261, reportedValueUsd: 43_395_920_710 });
  assert.throws(() => parseSecInstitutionalDisclosureDocument(
    institutionalInlineXbrl('institutional-ibit', { ambiguousTargetQuantity: '734,262' }),
    'institutional-ibit',
    { reportDate: '2026-06-30' },
  ), { code: 'schema_invalid' });
});

test('institutional excerpts retain exact official SEC archive attribution', () => {
  for (const providerId of [
    'institutional-strategy', 'institutional-tesla', 'institutional-ibit',
    'institutional-fbtc', 'institutional-arkb', 'institutional-bitb',
  ]) {
    const filing = institutionalFiling(providerId);
    assert.match(institutionalInlineXbrl(providerId), new RegExp(
      `https://www\\.sec\\.gov/Archives/edgar/data/${filing.cik}/${filing.accessionNumber.replace(/-/g, '')}/${filing.primaryDocument.replace('.', '\\.')}`,
    ));
  }
});

test('institutional raw fetch binds adapter and CIK to submissions and one archive primary document', async () => {
  const filing = institutionalFiling('institutional-ibit');
  const submissions = {
    cik: '1980994',
    filings: { recent: {
      accessionNumber: [filing.accessionNumber, '0001437749-26-010000'],
      filingDate: [filing.filingDate, '2026-05-05'],
      reportDate: ['2026-06-30', '2026-03-31'],
      form: ['10-Q', '10-Q'],
      primaryDocument: [filing.primaryDocument, 'bit20260331c_10q.htm'],
    } },
  };
  const jsonCalls = [];
  const textCalls = [];
  const raw = await fetchSecInstitutionalDisclosure({
    providerId: 'institutional-ibit', cik: '1980994',
    userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
  }, {
    fetchProviderJson: async (url, options) => { jsonCalls.push({ url, options }); return submissions; },
    fetchProviderText: async (url, options) => {
      textCalls.push({ url, options });
      return institutionalInlineXbrl('institutional-ibit');
    },
  });
  assert.deepEqual(raw, {
    accessionNumber: filing.accessionNumber,
    reportingDate: '2026-06-30',
    filingDate: filing.filingDate,
    btcAmount: 734_261,
    reportedValueUsd: 43_395_920_710,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/1980994/${filing.accessionNumber.replace(/-/g, '')}/${filing.primaryDocument}`,
  });
  assert.equal(jsonCalls.length, 1);
  assert.equal(textCalls.length, 1);
  assert.equal(new URL(jsonCalls[0].url).origin, 'https://data.sec.gov');
  assert.equal(new URL(textCalls[0].url).origin, 'https://www.sec.gov');
  assert.equal(jsonCalls[0].options.providerId, 'institutional-ibit');
  assert.equal(textCalls[0].options.providerId, 'institutional-ibit');
  assert.equal(textCalls[0].options.maxBytes, 5_000_000);
  assert.deepEqual(textCalls[0].options.acceptedContentTypes, ['text/html', 'application/xhtml+xml']);
  assert.equal(textCalls[0].options.requestOptions.headers.Accept, 'text/html, application/xhtml+xml');
});

test('institutional archive uses the real bounded transport for official HTML responses', async () => {
  const filing = institutionalFiling('institutional-ibit');
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(institutionalInlineXbrl('institutional-ibit'), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
  try {
    const raw = await fetchSecInstitutionalDisclosure({
      providerId: 'institutional-ibit', cik: filing.cik,
      userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
    }, {
      scheduler: { schedule: (task) => task() },
      fetchProviderJson: async () => ({
        cik: filing.cik,
        filings: { recent: {
          accessionNumber: [filing.accessionNumber], filingDate: [filing.filingDate],
          reportDate: [filing.reportDate], form: ['10-Q'], primaryDocument: [filing.primaryDocument],
        } },
      }),
    });
    assert.equal(raw.btcAmount, 734_261);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers.Accept, 'text/html, application/xhtml+xml');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('institutional filing selection fails closed when the newest applicable tuple is malformed', async () => {
  const filing = institutionalFiling('institutional-ibit');
  let archiveCalls = 0;
  await assert.rejects(fetchSecInstitutionalDisclosure({
    providerId: 'institutional-ibit', cik: filing.cik,
    userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
  }, {
    fetchProviderJson: async () => ({
      cik: filing.cik,
      filings: { recent: {
        accessionNumber: ['malformed-newest', filing.accessionNumber],
        filingDate: ['2026-08-20', filing.filingDate],
        reportDate: ['2026-09-30', filing.reportDate],
        form: ['10-Q', '10-Q'],
        primaryDocument: ['latest.txt', filing.primaryDocument],
      } },
    }),
    fetchProviderText: async () => { archiveCalls += 1; return institutionalInlineXbrl('institutional-ibit'); },
  }), { code: 'schema_invalid' });
  assert.equal(archiveCalls, 0);
});

test('institutional raw fetch accepts filing-agent accession prefixes but binds the registrant archive directory', async () => {
  for (const providerId of [
    'institutional-tesla', 'institutional-ibit', 'institutional-fbtc',
    'institutional-arkb', 'institutional-bitb',
  ]) {
    const filing = institutionalFiling(providerId);
    const raw = await fetchSecInstitutionalDisclosure({
      providerId, cik: filing.cik,
      userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
    }, {
      fetchProviderJson: async () => ({
        cik: filing.cik,
        filings: { recent: {
          accessionNumber: [filing.accessionNumber], filingDate: [filing.filingDate],
          reportDate: [filing.reportDate], form: ['10-Q'],
          primaryDocument: [filing.primaryDocument],
        } },
      }),
      fetchProviderText: async () => institutionalInlineXbrl(providerId),
    });
    assert.match(raw.sourceUrl, new RegExp(`/Archives/edgar/data/${filing.cik}/${filing.accessionNumber.replace(/-/g, '')}/`));
  }
});

test('institutional raw fetch fails before transport on mismatched identity or SEC contact', async () => {
  let calls = 0;
  const deps = {
    fetchProviderJson: async () => { calls += 1; return {}; },
    fetchProviderText: async () => { calls += 1; return ''; },
  };
  await assert.rejects(fetchSecInstitutionalDisclosure({
    providerId: 'institutional-ibit', cik: '1852317',
    userAgent: 'CommsDashboard/1.0 compliance@monitored-contact.co',
  }, deps), { code: 'configuration_missing' });
  await assert.rejects(fetchSecInstitutionalDisclosure({
    providerId: 'institutional-ibit', cik: '1980994', userAgent: 'placeholder@example.com',
  }, deps), { code: 'configuration_missing' });
  assert.equal(calls, 0);
});
