import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';

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
  'institutional-strategy': Object.freeze({ cik: '1050446', legalEntity: 'Strategy Inc.' }),
  'institutional-tesla': Object.freeze({ cik: '1318605', legalEntity: 'Tesla, Inc.' }),
  'institutional-ibit': Object.freeze({ cik: '1980994', legalEntity: 'iShares Bitcoin Trust ETF' }),
  'institutional-fbtc': Object.freeze({ cik: '1852317', legalEntity: 'Fidelity Wise Origin Bitcoin Fund' }),
  'institutional-arkb': Object.freeze({ cik: '1869699', legalEntity: 'ARK 21Shares Bitcoin ETF' }),
  'institutional-bitb': Object.freeze({ cik: '1763415', legalEntity: 'Bitwise Bitcoin ETF Trust' }),
});
const INSTITUTIONAL_FILING_PROFILES = Object.freeze({
  'institutional-strategy': Object.freeze({
    cik: '1050446',
    quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits', quantityMeasure: 'mstr:Bitcoin',
    quantityScale: 0, valueConcept: 'us-gaap:CryptoAssetFairValue',
    valueMeasure: 'iso4217:USD', valueScale: 3,
    anchors: ['Bitcoin Activity and Holdings', 'Digital assets', 'Approximate Number of Bitcoins Held'],
    quantityAnchors: ['Bitcoin Activity and Holdings', 'Approximate Number of Bitcoins Held'],
    valueAnchors: ['Digital Asset Carrying Value'],
    structuralContainer: Object.freeze({
      tag: 'table',
      anchors: ['Approximate number of bitcoins held', 'Digital asset cost basis', 'Digital asset fair value'],
    }),
    dimension: null,
  }),
  'institutional-tesla': Object.freeze({
    cik: '1318605',
    quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits', quantityMeasure: 'tsla:unit',
    quantityScale: 0, valueConcept: null, valueMeasure: null, valueScale: null,
    anchors: ['majority of our digital assets were comprised of', 'Bitcoin'],
    quantityAnchors: ['majority of our digital assets were comprised of', 'Bitcoin'],
    structuralContainer: Object.freeze({
      tag: 'span', anchors: ['majority of our digital assets were comprised of', 'units of Bitcoin'],
    }),
    dimension: Object.freeze({
      kind: 'explicit', axis: 'srt:CryptoAssetAxis', value: 'tsla:BitcoinMember',
    }),
  }),
  'institutional-ibit': Object.freeze({
    cik: '1980994',
    quantityConcept: 'us-gaap:CryptoAssetNumberOfUnits', quantityMeasure: 'xbrli:pure',
    quantityScale: 0, valueConcept: 'us-gaap:CryptoAssetFairValue',
    valueMeasure: 'iso4217:USD', valueScale: 0,
    anchors: ['Schedules of Investments', 'Description Quantity Cost Fair Value', 'Bitcoin'],
    quantityAnchors: ['Description Quantity Cost Fair Value', 'Bitcoin'],
    valueAnchors: ['Description Quantity Cost Fair Value', 'Bitcoin'],
    structuralContainer: Object.freeze({
      tag: 'table', anchors: ['Description', 'Quantity', 'Cost', 'Fair Value', 'Total Investments'],
    }),
    valueStructuralContainer: Object.freeze({
      tag: 'table', anchors: ['Investment in bitcoin, at fair value', 'Total Assets', 'Total Liabilities'],
    }),
    dimension: null,
  }),
  'institutional-fbtc': Object.freeze({
    cik: '1852317',
    quantityConcept: 'us-gaap:InvestmentOwnedBalanceShares', quantityMeasure: 'xbrli:shares',
    quantityScale: 0, valueConcept: 'us-gaap:InvestmentOwnedAtFairValue',
    valueMeasure: 'iso4217:USD', valueScale: 3,
    anchors: ['Investment in bitcoin', 'Global Bitcoin', 'Fair Value'],
    quantityAnchors: ['Investment in bitcoin', 'Global Bitcoin'],
    valueAnchors: ['Investment in bitcoin', 'Global Bitcoin', 'Fair Value'],
    structuralContainer: Object.freeze({
      tag: 'table',
      anchors: ['Investments (a)', 'Quantity of Bitcoin', 'Percentage of Net Assets', 'Global Bitcoin'],
    }),
    dimension: Object.freeze({
      kind: 'typed', axis: 'us-gaap:InvestmentIdentifierAxis',
      value: 'Investment in bitcoin, Global Bitcoin',
    }),
  }),
  'institutional-arkb': Object.freeze({
    cik: '1869699',
    quantityConcept: 'us-gaap:InvestmentOwnedBalanceContracts', quantityMeasure: 'xbrli:pure',
    quantityScale: 0, quantityDecimals: 4,
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD', valueScale: 3,
    anchors: ['Schedules of Investment', 'Bitcoin', 'Fair Value'],
    quantityAnchors: ['Bitcoin'], valueAnchors: ['Bitcoin', 'Fair Value'],
    structuralContainer: Object.freeze({ tag: 'tr', anchors: ['Ending balance as of'] }),
    dimension: null,
  }),
  'institutional-bitb': Object.freeze({
    cik: '1763415',
    quantityConcept: 'bitb:InvestmentOwnedBalanceContractsQuantityOfBitcoin',
    quantityMeasure: 'bitb:Bitcoin', quantityScale: 0, quantityDecimals: 4,
    valueConcept: 'us-gaap:InvestmentOwnedAtFairValue', valueMeasure: 'iso4217:USD', valueScale: 3,
    anchors: ['Schedules of Investment', 'Bitcoin', 'Fair Value'],
    quantityAnchors: ['Bitcoin'], valueAnchors: ['Bitcoin', 'Fair Value'],
    structuralContainer: Object.freeze({ tag: 'tr', anchors: ['Ending balance as of'] }),
    dimension: null,
  }),
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

function institutionalError(providerId, code = 'schema_invalid') {
  return new ProviderError(code, providerId);
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

function exactInlineNumber(text, scale, providerId) {
  const normalized = String(text ?? '').replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || !Number.isInteger(scale)) {
    throw institutionalError(providerId);
  }
  const parsed = Number(normalized) * (10 ** scale);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    throw institutionalError(providerId);
  }
  return parsed;
}

function exactInstitutionalProfile(providerId) {
  const profile = INSTITUTIONAL_FILING_PROFILES[providerId];
  if (!profile) throw institutionalError(providerId, 'configuration_missing');
  return profile;
}

function normalizedDocumentText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function exactContextMatches($, contextId, profile, expectedReportDate) {
  if (typeof contextId !== 'string' || !/^[A-Za-z0-9_.-]{1,256}$/.test(contextId)) {
    return false;
  }
  const contexts = $('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'xbrli:context'
    && $(element).attr('id') === contextId
  ));
  if (contexts.length !== 1) return false;
  const context = contexts.first();
  const identifiers = context.find('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'xbrli:identifier'
  ));
  const instants = context.find('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'xbrli:instant'
  ));
  const instant = normalizedDocumentText(instants.text());
  if (identifiers.length !== 1 || instants.length !== 1
      || normalizedDocumentText(identifiers.text()) !== profile.cik.padStart(10, '0')
      || identifiers.first().attr('scheme') !== 'http://www.sec.gov/CIK'
      || !/^\d{4}-\d{2}-\d{2}$/.test(instant)
      || new Date(`${instant}T00:00:00.000Z`).toISOString().slice(0, 10) !== instant
      || instant !== expectedReportDate) return false;
  const explicitMembers = context.find('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'xbrldi:explicitmember'
  ));
  const typedMembers = context.find('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'xbrldi:typedmember'
  ));
  if (profile.dimension === null) {
    return explicitMembers.length === 0 && typedMembers.length === 0;
  }
  if (profile.dimension.kind === 'explicit') {
    return explicitMembers.length === 1 && typedMembers.length === 0
      && explicitMembers.first().attr('dimension') === profile.dimension.axis
      && normalizedDocumentText(explicitMembers.first().text()) === profile.dimension.value;
  }
  return profile.dimension.kind === 'typed'
    && explicitMembers.length === 0 && typedMembers.length === 1
    && typedMembers.first().attr('dimension') === profile.dimension.axis
    && normalizedDocumentText(typedMembers.first().text()) === profile.dimension.value;
}

function exactUnitMeasure($, unitRef, expectedMeasure, providerId) {
  if (typeof unitRef !== 'string' || !/^[A-Za-z0-9_.-]{1,256}$/.test(unitRef)) {
    throw institutionalError(providerId);
  }
  const units = $('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'xbrli:unit'
    && $(element).attr('id') === unitRef
  ));
  if (units.length !== 1) throw institutionalError(providerId);
  const measures = units.first().find('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'xbrli:measure'
  ));
  if (measures.length !== 1 || normalizedDocumentText(measures.text()) !== expectedMeasure) {
    throw institutionalError(providerId);
  }
}

function ownFactText($, element) {
  const clone = $(element).clone();
  clone.find('*').filter((_index, descendant) => (
    String(descendant.tagName || descendant.name || '').toLowerCase() === 'ix:nonfraction'
  )).remove();
  const ownText = normalizedDocumentText(clone.text());
  // Inline-XBRL permits one fact to wrap an identical comparison-period fact so
  // the same rendered number represents both contexts (Tesla currently does).
  return ownText || $(element).text();
}

function factInStructuralContainer($, element, containerProfile) {
  const container = $(element).closest(containerProfile.tag);
  if (container.length !== 1) return false;
  const text = normalizedDocumentText(container.text()).toLocaleLowerCase('en-US');
  return containerProfile.anchors.every((anchor) => (
    text.includes(anchor.toLocaleLowerCase('en-US'))
  ));
}

function factValues(
  $, profile, providerId, concept, measure, scale, decimals, expectedReportDate, containerProfile,
) {
  const facts = $('*').filter((_index, element) => (
    String(element.tagName || element.name || '').toLowerCase() === 'ix:nonfraction'
    && $(element).attr('name') === concept
    && exactContextMatches($, $(element).attr('contextref'), profile, expectedReportDate)
    && factInStructuralContainer($, element, containerProfile)
  ));
  if (facts.length < 1) throw institutionalError(providerId);
  const values = [];
  facts.each((_index, element) => {
    const fact = $(element);
    const actualScale = fact.attr('scale') ?? '0';
    if (fact.attr('xsi:nil') === 'true' || fact.attr('nil') === 'true'
        || actualScale !== String(scale)
        || fact.attr('sign') != null
        || (decimals != null && fact.attr('decimals') !== String(decimals))) {
      throw institutionalError(providerId);
    }
    exactUnitMeasure($, fact.attr('unitref'), measure, providerId);
    values.push(exactInlineNumber(ownFactText($, element), scale, providerId));
  });
  if (new Set(values.map(String)).size !== 1) throw institutionalError(providerId);
  return { value: values[0], reportDate: expectedReportDate };
}

export function parseSecInstitutionalDisclosureDocument(document, providerId, options = {}) {
  const profile = exactInstitutionalProfile(providerId);
  const reportDate = typeof options.reportDate === 'string' && isoFilingDate(options.reportDate)
    ? options.reportDate
    : null;
  if (typeof document !== 'string' || document.length < 1 || document.length > 10_000_000) {
    throw institutionalError(providerId);
  }
  if (reportDate === null) throw institutionalError(providerId);
  let $;
  try {
    $ = load(document);
  } catch {
    throw institutionalError(providerId);
  }
  const documentText = normalizedDocumentText($.root().text());
  const foldedDocumentText = documentText.toLocaleLowerCase('en-US');
  if (!profile.anchors.every((anchor) => foldedDocumentText.includes(anchor.toLocaleLowerCase('en-US')))) {
    throw institutionalError(providerId);
  }
  const quantity = factValues(
    $, profile, providerId, profile.quantityConcept, profile.quantityMeasure,
    profile.quantityScale, profile.quantityDecimals, reportDate,
    profile.quantityStructuralContainer ?? profile.structuralContainer,
  );
  const value = profile.valueConcept === null
    ? { value: null, reportDate: quantity.reportDate }
    : factValues(
      $, profile, providerId, profile.valueConcept, profile.valueMeasure,
      profile.valueScale, null, reportDate,
      profile.valueStructuralContainer ?? profile.structuralContainer,
    );
  if (quantity.reportDate !== value.reportDate) throw institutionalError(providerId);
  return { btcAmount: quantity.value, reportedValueUsd: value.value };
}

function institutionalRecentTuple(payload, profile, providerId) {
  const recent = payload?.filings?.recent;
  const payloadCik = String(payload?.cik ?? '').replace(/^0+/, '');
  const columns = ['accessionNumber', 'filingDate', 'reportDate', 'form', 'primaryDocument'];
  if (!recent || typeof recent !== 'object' || payloadCik !== profile.cik
      || !columns.every((column) => Array.isArray(recent[column]))) {
    throw institutionalError(providerId);
  }
  const length = recent.form.length;
  if (!columns.every((column) => recent[column].length === length
      && recent[column].every((value) => typeof value === 'string'))) {
    throw institutionalError(providerId);
  }
  const applicable = recent.form.flatMap((form, index) => {
    if (!['10-Q', '10-K'].includes(form)) return [];
    if (isoFilingDate(recent.filingDate[index]) === null
        || isoFilingDate(recent.reportDate[index]) === null
        || recent.filingDate[index] < recent.reportDate[index]) {
      throw institutionalError(providerId);
    }
    return [{ index, filingDate: recent.filingDate[index], reportDate: recent.reportDate[index] }];
  }).sort((left, right) => (
    right.reportDate.localeCompare(left.reportDate)
    || right.filingDate.localeCompare(left.filingDate)
    || right.index - left.index
  ));
  if (applicable.length < 1) throw institutionalError(providerId);
  const latestIndex = applicable[0].index;
  const latest = {
    accessionNumber: recent.accessionNumber[latestIndex],
    filingDate: recent.filingDate[latestIndex],
    reportingDate: recent.reportDate[latestIndex],
    form: recent.form[latestIndex],
    primaryDocument: recent.primaryDocument[latestIndex],
  };
  if (!/^\d{10}-\d{2}-\d{6}$/.test(latest.accessionNumber)
      || isoFilingDate(latest.filingDate) === null
      || isoFilingDate(latest.reportingDate) === null
      || !/^[A-Za-z0-9._-]+\.html?$/i.test(latest.primaryDocument)) {
    throw institutionalError(providerId);
  }
  return latest;
}

export async function fetchSecInstitutionalDisclosure(config = {}, deps = {}) {
  const providerId = config?.providerId;
  const profile = exactInstitutionalProfile(providerId);
  const identity = secProvider(config);
  if (identity.providerId !== providerId || identity.cik !== profile.cik) {
    throw institutionalError(providerId, 'configuration_missing');
  }
  const headers = secHeaders(config.userAgent);
  const scheduler = deps.scheduler || secRequestScheduler;
  if (!scheduler || typeof scheduler.schedule !== 'function') {
    throw institutionalError(providerId, 'configuration_missing');
  }
  const getJson = deps.fetchProviderJson || fetchProviderJson;
  const getText = deps.fetchProviderText || fetchProviderText;
  const dataOptions = transportOptions(providerId, [SEC_DATA_ORIGIN], headers, scheduler);
  const archiveOptions = {
    ...transportOptions(providerId, [SEC_ARCHIVES_ORIGIN], {
      ...headers,
      Accept: 'text/html, application/xhtml+xml',
    }, scheduler),
    acceptedContentTypes: ['text/html', 'application/xhtml+xml'],
    maxBytes: 5_000_000,
  };
  const submissions = await getJson(
    `${SEC_DATA_ORIGIN}/submissions/CIK${profile.cik.padStart(10, '0')}.json`,
    dataOptions,
  );
  const filing = institutionalRecentTuple(submissions, profile, providerId);
  const sourceUrl = `${SEC_ARCHIVES_ORIGIN}/Archives/edgar/data/${profile.cik}/${filing.accessionNumber.replace(/-/g, '')}/${filing.primaryDocument}`;
  const document = await getText(sourceUrl, archiveOptions);
  return {
    accessionNumber: filing.accessionNumber,
    reportingDate: filing.reportingDate,
    filingDate: filing.filingDate,
    ...parseSecInstitutionalDisclosureDocument(document, providerId, {
      reportDate: filing.reportingDate,
    }),
    sourceUrl,
  };
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
