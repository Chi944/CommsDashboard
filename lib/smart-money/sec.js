import { XMLParser } from 'fast-xml-parser';

import { fetchProviderJson, fetchProviderText } from './http.js';
import { ProviderError } from './errors.js';
import { listConfiguredAdapters } from './entities.js';

const SEC_DATA_ORIGIN = 'https://data.sec.gov';
const SEC_ARCHIVES_ORIGIN = 'https://www.sec.gov';
const SEC_REQUEST_INTERVAL_MS = 125;
// One submissions request plus four index/XML pairs stays within SEC's published
// ten-requests-per-second ceiling even when a cold snapshot is served immediately.
const DEFAULT_MAX_FILINGS = 4;
const SUPPORTED_FORMS = new Set(['13F-HR', '13F-HR/A', 'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A']);
const THIRTEEN_F_FORMS = new Set(['13F-HR', '13F-HR/A']);
const SEC_ADAPTER_IDENTITIES = Object.freeze({
  'sec-edgar': Object.freeze({ cik: '2045724', legalEntity: 'Situational Awareness LP' }),
  'strategy-disclosures': Object.freeze({ cik: '1050446', legalEntity: 'Strategy Inc.' }),
  'tesla-disclosures': Object.freeze({ cik: '1318605', legalEntity: 'Tesla, Inc.' }),
  'ibit-disclosures': Object.freeze({ cik: '1980994', legalEntity: 'iShares Bitcoin Trust ETF' }),
  'fbtc-disclosures': Object.freeze({ cik: '1852317', legalEntity: 'Fidelity Wise Origin Bitcoin Fund' }),
  'arkb-disclosures': Object.freeze({ cik: '1869699', legalEntity: 'ARK 21Shares Bitcoin ETF' }),
  'bitb-disclosures': Object.freeze({ cik: '1763415', legalEntity: 'Bitwise Bitcoin ETF Trust' }),
});
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
  htmlEntities: true,
  removeNSPrefix: true,
});

function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value !== 'object') return '';
  return textValue(value['#text'] ?? value['#cdata']);
}

function schemaError() {
  return new ProviderError('schema_invalid', 'sec-edgar');
}

function numberValue(value) {
  const text = textValue(value);
  if (!/^\d+$/.test(text)) throw schemaError();
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw schemaError();
  return parsed;
}

function normalizedCik(value) {
  const digits = String(value ?? '').replace(/^0+/, '');
  if (!/^\d{1,10}$/.test(digits)) throw new ProviderError('configuration_missing', 'sec-edgar');
  return digits;
}

function isoFilingDate(value) {
  const date = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date
    ? new Date(parsed).toISOString()
    : null;
}

function secProvider(config) {
  const providerId = config?.providerId || 'sec-edgar';
  const identity = SEC_ADAPTER_IDENTITIES[providerId];
  if (!identity || !listConfiguredAdapters().some((adapter) => adapter.id === providerId)) {
    throw new ProviderError('rights_gate_failed', providerId);
  }
  const requestedCik = normalizedCik(config?.cik ?? identity.cik);
  if (requestedCik !== identity.cik
      || (config?.legalEntity != null && config.legalEntity !== identity.legalEntity)) {
    throw new ProviderError('configuration_missing', providerId);
  }
  return { providerId, ...identity };
}

function filingIndexUrl(cik, accessionNumber) {
  return `${SEC_ARCHIVES_ORIGIN}/Archives/edgar/data/${cik}/${accessionNumber.replace(/-/g, '')}/index.json`;
}

function informationTableName(index) {
  const names = asArray(index?.directory?.item)
    .map((item) => textValue(item?.name))
    .filter((name) => /^[A-Za-z0-9._-]+\.xml$/i.test(name));
  return names.find((name) => /(?:information|info)[._-]?table/i.test(name)) || null;
}

function createSecRequestScheduler() {
  let tail = Promise.resolve();
  let nextStartAt = 0;
  return {
    schedule(task) {
      const run = async () => {
        const now = Date.now();
        const startAt = Math.max(now, nextStartAt);
        nextStartAt = startAt + SEC_REQUEST_INTERVAL_MS;
        if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now));
        return task();
      };
      const request = tail.then(run, run);
      tail = request.catch(() => {});
      return request;
    },
  };
}

const secRequestScheduler = createSecRequestScheduler();

function scheduledFetch(scheduler) {
  return (url, options) => scheduler.schedule(() => globalThis.fetch(url, options));
}

function transportOptions(providerId, origins, headers, scheduler) {
  return {
    providerId,
    allowedOrigins: origins,
    maxRetries: 1,
    fetchImpl: scheduledFetch(scheduler),
    requestOptions: { headers },
  };
}

function maxFilings(value) {
  return Number.isInteger(value) && value > 0
    ? Math.min(value, DEFAULT_MAX_FILINGS)
    : DEFAULT_MAX_FILINGS;
}

function holdingKey(holding) {
  return [holding?.cusip, holding?.securityClass || '', holding?.putCall || ''].join('\u0000');
}

export function secHeaders(userAgent = process.env.SEC_USER_AGENT) {
  const monitoredEmail = typeof userAgent === 'string'
    ? userAgent.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
    : null;
  if (!monitoredEmail || /@(example\.(com|org|net)|[^@]+\.(?:invalid|test|example))$/i.test(monitoredEmail)) {
    throw new ProviderError('configuration_missing', 'sec-edgar');
  }
  return {
    Accept: 'application/json, application/xml, text/xml',
    'User-Agent': userAgent,
  };
}

export function parseSecSubmissions(payload, config = {}) {
  const recent = payload?.filings?.recent;
  const expectedCik = normalizedCik(config.cik);
  const payloadCik = String(payload?.cik ?? '').replace(/^0+/, '');
  if (!recent || typeof recent !== 'object' || !/^\d{1,10}$/.test(payloadCik)
      || payloadCik !== expectedCik) throw schemaError();
  const columns = ['accessionNumber', 'filingDate', 'reportDate', 'form', 'primaryDocument'];
  if (!columns.every((column) => Array.isArray(recent[column]))) throw schemaError();
  const length = recent.form.length;
  if (!columns.every((column) => recent[column].length === length
      && recent[column].every((value) => typeof value === 'string'))) throw schemaError();
  const forms = recent.form;
  const filings = [];
  for (let index = 0; index < forms.length; index += 1) {
    const form = textValue(forms[index]);
    const accessionNumber = textValue(recent.accessionNumber?.[index]);
    const periodEnd = textValue(recent.reportDate[index]);
    const filedAt = isoFilingDate(recent.filingDate?.[index]);
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber) || !isoFilingDate(periodEnd) || !filedAt) {
      throw schemaError();
    }
    if (!SUPPORTED_FORMS.has(form)) continue;
    filings.push({
      cik: expectedCik,
      form,
      accessionNumber,
      periodEnd,
      filedAt,
      primaryDocument: textValue(recent.primaryDocument?.[index]) || null,
      isAmendment: /\/A$/.test(form),
    });
  }
  return filings;
}

export function parseSecInformationTable(xml, filing) {
  let document;
  try {
    document = xmlParser.parse(xml);
  } catch {
    throw new ProviderError('schema_invalid', 'sec-edgar');
  }
  const tables = asArray(document?.informationTable?.infoTable);
  if (!tables.length) throw new ProviderError('schema_invalid', 'sec-edgar');
  const amendmentChain = Array.isArray(filing?.amendmentChain) && filing.amendmentChain.length
    ? [...filing.amendmentChain]
    : [filing?.accessionNumber].filter(Boolean);
  return tables.map((table) => ({
    accessionNumber: filing?.accessionNumber || null,
    periodEnd: filing?.periodEnd || null,
    filedAt: filing?.filedAt || null,
    isAmendment: Boolean(filing?.isAmendment),
    amendmentChain,
    issuer: textValue(table?.nameOfIssuer) || null,
    securityClass: textValue(table?.titleOfClass) || null,
    cusip: textValue(table?.cusip) || null,
    ticker: null,
    reportedValue: numberValue(table?.value),
    shares: numberValue(table?.shrsOrPrnAmt?.sshPrnamt),
    putCall: textValue(table?.putCall).toUpperCase() || null,
    shareType: textValue(table?.shrsOrPrnAmt?.sshPrnamtType).toUpperCase() || null,
    paperEligible: false,
  }));
}

export function selectCanonical13FByPeriod(filings) {
  const byPeriod = new Map();
  for (const filing of Array.isArray(filings) ? filings : []) {
    if (typeof filing?.form === 'string' && !THIRTEEN_F_FORMS.has(filing.form)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filing?.periodEnd || '')) continue;
    const existing = byPeriod.get(filing.periodEnd) || [];
    existing.push(filing);
    byPeriod.set(filing.periodEnd, existing);
  }
  return [...byPeriod.values()].map((periodFilings) => {
    const amendments = periodFilings.filter((filing) => filing.isAmendment);
    const candidates = amendments.length ? amendments : periodFilings;
    const canonical = [...candidates].sort((a, b) => String(b.filedAt).localeCompare(String(a.filedAt)))[0];
    return {
      ...canonical,
      amendmentChain: [...periodFilings]
        .sort((a, b) => String(a.filedAt).localeCompare(String(b.filedAt)))
        .map((filing) => filing.accessionNumber)
        .filter(Boolean),
    };
  }).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export function compare13FPeriods(current, previous) {
  const aggregate = (holdings) => {
    const byIdentity = new Map();
    for (const holding of Array.isArray(holdings) ? holdings : []) {
      if (!holding?.cusip) continue;
      const shares = numberValue(holding.shares);
      const reportedValue = holding.reportedValue == null ? null : numberValue(holding.reportedValue);
      const key = holdingKey(holding);
      const existing = byIdentity.get(key);
      if (!existing) {
        byIdentity.set(key, { ...holding, shares, reportedValue });
        continue;
      }
      const combinedShares = existing.shares + shares;
      const combinedValue = existing.reportedValue == null || reportedValue == null
        ? null
        : existing.reportedValue + reportedValue;
      if (!Number.isSafeInteger(combinedShares)
          || (combinedValue != null && !Number.isSafeInteger(combinedValue))) throw schemaError();
      existing.shares = combinedShares;
      existing.reportedValue = combinedValue;
    }
    return byIdentity;
  };
  const currentByCusip = aggregate(current);
  const previousByCusip = aggregate(previous);
  const changes = [];
  for (const key of new Set([...currentByCusip.keys(), ...previousByCusip.keys()])) {
    const currentHolding = currentByCusip.get(key);
    const previousHolding = previousByCusip.get(key);
    const currentShares = currentHolding?.shares ?? 0;
    const previousShares = previousHolding?.shares ?? 0;
    if (currentHolding && !previousHolding) changes.push({ ...currentHolding, classification: 'new', previousShares: null });
    else if (!currentHolding && previousHolding) changes.push({ ...previousHolding, shares: 0, classification: 'exited', previousShares });
    else if (currentShares > previousShares) changes.push({ ...currentHolding, classification: 'increased', previousShares });
    else if (currentShares < previousShares) changes.push({ ...currentHolding, classification: 'reduced', previousShares });
  }
  return changes;
}

export async function fetchSecSnapshot(config = {}, deps = {}) {
  const headers = secHeaders(config.userAgent);
  const { providerId, cik } = secProvider(config);
  const scheduler = deps.scheduler || secRequestScheduler;
  if (!scheduler || typeof scheduler.schedule !== 'function') throw new ProviderError('configuration_missing', providerId);
  const getJson = deps.fetchProviderJson || fetchProviderJson;
  const getText = deps.fetchProviderText || fetchProviderText;
  const dataOptions = transportOptions(providerId, [SEC_DATA_ORIGIN], headers, scheduler);
  const archiveOptions = transportOptions(providerId, [SEC_ARCHIVES_ORIGIN], headers, scheduler);
  const submissions = await getJson(`${SEC_DATA_ORIGIN}/submissions/CIK${cik.padStart(10, '0')}.json`, dataOptions);
  const supportedFilings = parseSecSubmissions(submissions, { cik });
  const filings = selectCanonical13FByPeriod(supportedFilings).slice(0, maxFilings(config.maxFilings));
  const holdings = [];
  for (const filing of filings) {
    const index = await getJson(filingIndexUrl(cik, filing.accessionNumber), archiveOptions);
    const filename = informationTableName(index);
    if (!filename) continue;
    const xml = await getText(`${filingIndexUrl(cik, filing.accessionNumber).replace(/index\.json$/, '')}${encodeURIComponent(filename)}`, archiveOptions);
    holdings.push(...parseSecInformationTable(xml, filing));
  }
  return {
    filings,
    disclosures: supportedFilings.filter((filing) => !THIRTEEN_F_FORMS.has(filing.form)),
    holdings,
  };
}
