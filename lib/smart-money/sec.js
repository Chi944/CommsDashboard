import { XMLParser } from 'fast-xml-parser';

import { fetchProviderJson, fetchProviderText } from './http.js';
import { ProviderError } from './errors.js';
import { listConfiguredAdapters } from './entities.js';

const SEC_DATA_ORIGIN = 'https://data.sec.gov';
const SEC_ARCHIVES_ORIGIN = 'https://www.sec.gov';
// One submissions request plus four index/XML pairs stays within SEC's published
// ten-requests-per-second ceiling even when a cold snapshot is served immediately.
const DEFAULT_MAX_FILINGS = 4;
const SUPPORTED_FORMS = new Set(['13F-HR', '13F-HR/A', 'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A']);
const THIRTEEN_F_FORMS = new Set(['13F-HR', '13F-HR/A']);
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

function numberValue(value) {
  const parsed = Number(String(textValue(value)).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedCik(value) {
  const digits = String(value ?? '').replace(/^0+/, '');
  if (!/^\d{1,10}$/.test(digits)) throw new ProviderError('configuration_missing', 'sec-edgar');
  return digits;
}

function isoFilingDate(value) {
  const parsed = Date.parse(`${String(value ?? '')}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function secProviderId(config) {
  const providerId = config?.providerId || 'sec-edgar';
  if (!listConfiguredAdapters().some((adapter) => adapter.id === providerId)) {
    throw new ProviderError('rights_gate_failed', providerId);
  }
  return providerId;
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

function transportOptions(providerId, origins, headers) {
  return {
    providerId,
    allowedOrigins: origins,
    maxRetries: 1,
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
  if (!monitoredEmail || /@(example\.(com|org|net)|[^@]+\.invalid)$/i.test(monitoredEmail)) {
    throw new ProviderError('configuration_missing', 'sec-edgar');
  }
  return {
    Accept: 'application/json, application/xml, text/xml',
    'User-Agent': userAgent,
  };
}

export function parseSecSubmissions(payload, config = {}) {
  const recent = payload?.filings?.recent;
  if (!recent || typeof recent !== 'object') return [];
  const forms = asArray(recent.form);
  const filings = [];
  for (let index = 0; index < forms.length; index += 1) {
    const form = textValue(forms[index]);
    const accessionNumber = textValue(recent.accessionNumber?.[index]);
    const periodEnd = textValue(recent.reportDate?.[index]);
    const filedAt = isoFilingDate(recent.filingDate?.[index]);
    if (!SUPPORTED_FORMS.has(form) || !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)
        || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !filedAt) continue;
    filings.push({
      cik: normalizedCik(config.cik ?? payload.cik),
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
    if (!THIRTEEN_F_FORMS.has(filing?.form) && !Object.hasOwn(filing || {}, 'isAmendment')) continue;
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
  const currentByCusip = new Map((Array.isArray(current) ? current : [])
    .filter((holding) => holding?.cusip)
    .map((holding) => [holdingKey(holding), holding]));
  const previousByCusip = new Map((Array.isArray(previous) ? previous : [])
    .filter((holding) => holding?.cusip)
    .map((holding) => [holdingKey(holding), holding]));
  const changes = [];
  for (const key of new Set([...currentByCusip.keys(), ...previousByCusip.keys()])) {
    const currentHolding = currentByCusip.get(key);
    const previousHolding = previousByCusip.get(key);
    const currentShares = numberValue(currentHolding?.shares) ?? 0;
    const previousShares = numberValue(previousHolding?.shares) ?? 0;
    if (currentHolding && !previousHolding) changes.push({ ...currentHolding, classification: 'new', previousShares: null });
    else if (!currentHolding && previousHolding) changes.push({ ...previousHolding, shares: 0, classification: 'exited', previousShares });
    else if (currentShares > previousShares) changes.push({ ...currentHolding, classification: 'increased', previousShares });
    else if (currentShares < previousShares) changes.push({ ...currentHolding, classification: 'reduced', previousShares });
  }
  return changes;
}

export async function fetchSecSnapshot(config = {}, deps = {}) {
  const headers = secHeaders(config.userAgent);
  const providerId = secProviderId(config);
  const cik = normalizedCik(config.cik);
  const getJson = deps.fetchProviderJson || fetchProviderJson;
  const getText = deps.fetchProviderText || fetchProviderText;
  const dataOptions = transportOptions(providerId, [SEC_DATA_ORIGIN], headers);
  const archiveOptions = transportOptions(providerId, [SEC_ARCHIVES_ORIGIN], headers);
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
