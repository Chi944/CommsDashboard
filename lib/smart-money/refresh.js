import { SYMBOLS } from '../symbols.js';
import { createHash } from 'node:crypto';
import {
  assertSafeArray,
  assertSafePlainRecord,
  canonicalTimestamp,
  schemaInvalid,
} from './contracts.js';
import {
  INSTITUTIONAL_DISCLOSURE_CONFIGS,
  compareInstitutionalHoldings,
  fetchInstitutionalDisclosure,
} from './disclosures.js';
import { listConfiguredAdapters, listEntities } from './entities.js';
import { sanitizeProviderError } from './errors.js';
import {
  listTrackedTickers,
  publishJournalGeneration,
  readAcceptedSmartMoneySnapshot,
  stageJournal,
} from './journal.js';
import { withRefreshLock } from './lock.js';
import {
  getProviderFreshnessPolicy,
  isProviderRefreshDue,
  normalizeActivity,
  normalizeAdapterSnapshot,
  normalizeEntity,
  normalizeProviderStatus,
  validateAcceptedSnapshot,
} from './normalize.js';
import { rankCryptoAccounts, rankInvestors } from './rank.js';
import { resolveDailyMarks } from './reference-prices.js';
import { SOURCE_RIGHTS, assertAdapterRights } from './rights.js';
import { compare13FPeriods, fetchSecSnapshot } from './sec.js';
import { attachReferencePrice, deriveSignals } from './signals.js';
import {
  readDurableSmartMoneyCandidate,
  writeSmartMoneySnapshot,
} from './store.js';

export const ENABLED_SMART_MONEY_ADAPTER_IDS = Object.freeze([
  'sec-edgar',
  'institutional-strategy',
  'institutional-tesla',
  'institutional-ibit',
  'institutional-fbtc',
  'institutional-arkb',
  'institutional-bitb',
]);

const RETENTION_MS = 400 * 86_400_000;
const SEC_HOLDING_FIELDS = Object.freeze([
  'accessionNumber', 'periodEnd', 'filedAt', 'isAmendment', 'amendmentChain',
  'issuer', 'securityClass', 'cusip', 'ticker', 'reportedValue', 'shares',
  'putCall', 'shareType', 'paperEligible',
]);

function exactNow(value) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) throw schemaInvalid();
  return now;
}

function exactAdapterIds(adapters) {
  assertSafeArray(adapters);
  if (adapters.length !== ENABLED_SMART_MONEY_ADAPTER_IDS.length
      || adapters.some((adapter, index) => adapter?.id !== ENABLED_SMART_MONEY_ADAPTER_IDS[index])) {
    throw schemaInvalid();
  }
}

function compactInstitutionalStatus(status, id, retrievedAt) {
  return {
    id,
    group: 'institutional',
    status: status?.status ?? 'unavailable',
    recordCount: status?.recordCount ?? 0,
    ...(status?.status === 'live' ? {} : { errorCode: status?.errorCode ?? 'empty_dataset' }),
    retrievedAt: status?.retrievedAt ?? retrievedAt,
  };
}

function validateSecHolding(holding, now) {
  assertSafePlainRecord(holding, SEC_HOLDING_FIELDS);
  assertSafeArray(holding.amendmentChain);
  if (typeof holding.accessionNumber !== 'string'
      || !/^\d{10}-\d{2}-\d{6}$/.test(holding.accessionNumber)
      || typeof holding.periodEnd !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(holding.periodEnd)
      || new Date(`${holding.periodEnd}T00:00:00.000Z`).toISOString().slice(0, 10) !== holding.periodEnd
      || canonicalTimestamp(holding.filedAt, { now }) !== holding.filedAt
      || typeof holding.isAmendment !== 'boolean'
      || holding.amendmentChain.length < 1
      || !holding.amendmentChain.every((accession) => (
        typeof accession === 'string' && /^\d{10}-\d{2}-\d{6}$/.test(accession)
      ))
      || (holding.issuer !== null && (typeof holding.issuer !== 'string' || holding.issuer.length > 512))
      || (holding.securityClass !== null && (typeof holding.securityClass !== 'string' || holding.securityClass.length > 128))
      || typeof holding.cusip !== 'string' || !/^[0-9A-Z]{9}$/.test(holding.cusip)
      || holding.ticker !== null
      || !Number.isSafeInteger(holding.reportedValue) || holding.reportedValue < 0
      || !Number.isSafeInteger(holding.shares) || holding.shares < 0
      || (holding.putCall !== null && !['PUT', 'CALL'].includes(holding.putCall))
      || (holding.shareType !== null && (typeof holding.shareType !== 'string' || holding.shareType.length > 32))
      || holding.paperEligible !== false) {
    throw schemaInvalid();
  }
}

function validateSource(source, id, status, now, entities) {
  if (source === null) return null;
  if (id === 'sec-edgar') {
    assertSafePlainRecord(source, ['kind', 'snapshot']);
    if (source.kind !== 'sec') throw schemaInvalid();
    assertSafePlainRecord(source.snapshot, ['filings', 'disclosures', 'holdings']);
    for (const field of ['filings', 'disclosures', 'holdings']) assertSafeArray(source.snapshot[field]);
    for (const holding of source.snapshot.holdings) {
      validateSecHolding(holding, now);
    }
    normalizeAdapterSnapshot(source.snapshot, {
      now,
      retrievedAt: status?.retrievedAt ?? now.toISOString(),
      providerId: 'sec-edgar',
      entityId: 'situational-awareness-lp',
      entities,
    });
    return structuredClone(source);
  }
  assertSafePlainRecord(source, ['kind', 'records']);
  if (source.kind !== 'institutional') throw schemaInvalid();
  assertSafeArray(source.records);
  normalizeAdapterSnapshot({
    records: source.records,
    statuses: [compactInstitutionalStatus(status, id, status?.retrievedAt ?? now.toISOString())],
  }, { now, entities });
  return structuredClone(source);
}

export function validateSmartMoneyAdapterState(value, options = {}) {
  const now = exactNow(options.now ?? new Date());
  assertSafePlainRecord(value, ['schemaVersion', 'adapters', 'pendingConfirmations']);
  if (value.schemaVersion !== 1) throw schemaInvalid();
  exactAdapterIds(value.adapters);
  const entities = listEntities();
  const adapters = value.adapters.map((row, index) => {
    assertSafePlainRecord(row, ['id', 'source', 'status']);
    const id = ENABLED_SMART_MONEY_ADAPTER_IDS[index];
    if (row.id !== id) throw schemaInvalid();
    const status = row.status === null
      ? null
      : normalizeProviderStatus(row.status, getProviderFreshnessPolicy(id), { now });
    return {
      id,
      source: validateSource(row.source, id, status, now, entities),
      status,
    };
  });
  assertSafeArray(value.pendingConfirmations);
  const pendingConfirmations = deriveSignals({
    changes: [],
    pendingConfirmations: value.pendingConfirmations,
    nowMs: now.getTime(),
  }).pendingConfirmations;
  return { schemaVersion: 1, adapters, pendingConfirmations };
}

export function validateSmartMoneyPrivateSnapshot(value, options = {}) {
  const now = exactNow(options.now ?? new Date());
  assertSafePlainRecord(value, [
    'schemaVersion', 'refreshStartedAt', 'publicSnapshot', 'adapterState', 'stateDigest',
  ]);
  if (value.schemaVersion !== 1) throw schemaInvalid();
  const refreshStartedAt = canonicalTimestamp(value.refreshStartedAt, { now });
  const publicSnapshot = validateAcceptedSnapshot(value.publicSnapshot, { now });
  if (Date.parse(refreshStartedAt) > Date.parse(publicSnapshot.fetchedAt)) throw schemaInvalid();
  const adapterState = validateSmartMoneyAdapterState(value.adapterState, {
    now: new Date(publicSnapshot.fetchedAt),
  });
  assertPrivateSnapshotCoherence(publicSnapshot, adapterState);
  const stateDigest = privateStateDigest({
    schemaVersion: 1, refreshStartedAt, publicSnapshot, adapterState,
  });
  if (value.stateDigest !== stateDigest) throw schemaInvalid();
  return { schemaVersion: 1, refreshStartedAt, publicSnapshot, adapterState, stateDigest };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sourceRecordCount(id, source) {
  if (source === null) return 0;
  return id === 'sec-edgar'
    ? source.snapshot.filings.length + source.snapshot.disclosures.length
    : source.records.length;
}

function assertPrivateSnapshotCoherence(publicSnapshot, adapterState) {
  if (publicSnapshot.providerStatuses.length !== ENABLED_SMART_MONEY_ADAPTER_IDS.length) {
    throw schemaInvalid();
  }
  adapterState.adapters.forEach((row, index) => {
    const id = ENABLED_SMART_MONEY_ADAPTER_IDS[index];
    const status = publicSnapshot.providerStatuses[index];
    if (row.id !== id || row.status === null || status.id !== id
        || status.group !== (id === 'sec-edgar' ? 'sec' : 'institutional')
        || status.enabled !== true
        || status.recordCount !== sourceRecordCount(id, row.source)
        || stableJson(status) !== stableJson(row.status)) {
      throw schemaInvalid();
    }
  });
}

function privateStateDigest(envelope) {
  return `sha256:${createHash('sha256').update(stableJson(envelope)).digest('hex')}`;
}

export function buildSmartMoneyPrivateSnapshot(value, options = {}) {
  const now = exactNow(options.now ?? new Date());
  assertSafePlainRecord(value, ['refreshStartedAt', 'publicSnapshot', 'adapterState']);
  const refreshStartedAt = canonicalTimestamp(value.refreshStartedAt, { now });
  const publicSnapshot = validateAcceptedSnapshot(value.publicSnapshot, { now });
  if (Date.parse(refreshStartedAt) > Date.parse(publicSnapshot.fetchedAt)) throw schemaInvalid();
  const adapterState = validateSmartMoneyAdapterState(value.adapterState, {
    now: new Date(publicSnapshot.fetchedAt),
  });
  assertPrivateSnapshotCoherence(publicSnapshot, adapterState);
  return {
    schemaVersion: 1,
    refreshStartedAt,
    publicSnapshot,
    adapterState,
    stateDigest: privateStateDigest({
      schemaVersion: 1, refreshStartedAt, publicSnapshot, adapterState,
    }),
  };
}

function emptyAdapterState() {
  return {
    schemaVersion: 1,
    adapters: ENABLED_SMART_MONEY_ADAPTER_IDS.map((id) => ({ id, source: null, status: null })),
    pendingConfirmations: [],
  };
}

function publicStatus({
  id, status, now, previous = null, recordCount = 0, errorCode = null, sourceAsOf = null,
}) {
  const live = status === 'live';
  return normalizeProviderStatus({
    id,
    group: id === 'sec-edgar' ? 'sec' : 'institutional',
    enabled: true,
    status,
    lastAttemptAt: now.toISOString(),
    lastSuccessAt: live ? now.toISOString() : previous?.lastSuccessAt ?? null,
    sourceAsOf,
    retrievedAt: now.toISOString(),
    freshnessBasis: 'retrieval_time',
    recordCount,
    cacheAgeSeconds: 0,
    errorCode: live ? null : errorCode ?? 'provider_unavailable',
  }, getProviderFreshnessPolicy(id), { now });
}

function latestInstitutional(records) {
  return [...(records || [])].sort((left, right) => (
    String(right.reportingDate).localeCompare(String(left.reportingDate))
    || String(right.filedAt).localeCompare(String(left.filedAt))
    || String(right.id).localeCompare(String(left.id))
  ))[0] ?? null;
}

function latestSecSourceAsOf(snapshot) {
  const periods = (snapshot?.filings || [])
    .filter((filing) => ['13F-HR', '13F-HR/A'].includes(filing.form))
    .map((filing) => filing.periodEnd)
    .filter((periodEnd) => typeof periodEnd === 'string')
    .sort((left, right) => right.localeCompare(left));
  return periods.length === 0 ? null : `${periods[0]}T00:00:00.000Z`;
}

export function buildSecHoldingChanges(currentSource, previousSource, nowValue) {
  const now = exactNow(nowValue);
  const currentHoldings = currentSource?.snapshot?.holdings ?? [];
  const previousHoldings = previousSource?.snapshot?.holdings ?? [];
  const newestPeriod = [...new Set(currentHoldings.map((row) => row.periodEnd))].sort().at(-1);
  if (!newestPeriod) return [];
  const current = currentHoldings.filter((row) => row.periodEnd === newestPeriod);
  const previousPeriods = [...new Set(previousHoldings.map((row) => row.periodEnd))].sort();
  const comparisonPeriod = previousPeriods.includes(newestPeriod)
    ? newestPeriod
    : previousPeriods.at(-1);
  const previous = comparisonPeriod
    ? previousHoldings.filter((row) => row.periodEnd === comparisonPeriod)
    : [];
  return compare13FPeriods(current, previous).map((change) => {
    const accessionNumber = change.accessionNumber;
    const stable = `${accessionNumber}:${change.cusip}:${change.securityClass || 'unknown'}:${change.putCall || 'none'}:${change.classification}`;
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/2045724/${String(accessionNumber).replace(/-/g, '')}/index.json`;
    const reportedValueUsd = change.reportedValue == null ? 0 : change.reportedValue * 1_000;
    return {
      id: `sec:${stable}`,
      sourceStableId: stable,
      providerId: 'sec-edgar',
      entityId: 'situational-awareness-lp',
      activityId: `activity:sec:${stable}`,
      kind: 'holding_change',
      sourceUrl,
      sourceGrade: 'official_filing',
      identityStatus: 'verified',
      confidence: 'high',
      asset: {
        ticker: null,
        name: change.issuer || 'Reported security',
        providerSymbol: change.cusip,
        assetClass: 'equity',
        supported: false,
      },
      cusip: change.cusip,
      classification: change.classification,
      previousShares: change.previousShares,
      currentShares: change.shares,
      reportedValueUsd,
      effectiveAt: `${change.periodEnd}T00:00:00.000Z`,
      disclosedAt: change.filedAt,
      observedAt: now.toISOString(),
      retrievedAt: now.toISOString(),
      freshness: 'fresh',
      lastKnownGood: false,
      referencePrice: null,
    };
  });
}

function institutionalHoldingChanges(id, currentSource, previousSource, now) {
  const current = latestInstitutional(currentSource?.records);
  const previous = latestInstitutional(previousSource?.records);
  const comparison = compareInstitutionalHoldings(previous, current);
  if (comparison.classification === 'unchanged') return [];
  const evidence = current ?? previous;
  if (!evidence) return [];
  const stable = `${evidence.id}:${comparison.classification}`;
  const change = {
    id: `${id}:${stable}`,
    sourceStableId: stable,
    providerId: id,
    entityId: evidence.entityId,
    activityId: `activity:${id}:${stable}`,
    kind: 'holding_change',
    sourceUrl: evidence.sourceUrl,
    sourceGrade: 'official_filing',
    identityStatus: 'verified',
    confidence: evidence.reportedValueUsd === null ? 'medium' : 'high',
    asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true },
    classification: comparison.classification,
    effectiveAt: evidence.sourceAsOf,
    disclosedAt: evidence.filedAt,
    observedAt: now.toISOString(),
    retrievedAt: now.toISOString(),
    freshness: 'fresh',
    lastKnownGood: false,
    referencePrice: null,
  };
  if (typeof previous?.reportedValueUsd === 'number') change.previousValueUsd = previous.reportedValueUsd;
  if (typeof current?.reportedValueUsd === 'number') {
    change.currentValueUsd = current.reportedValueUsd;
    change.reportedValueUsd = current.reportedValueUsd;
  }
  return [change];
}

function changeActivity(change, now) {
  const valuationMissing = change.providerId.startsWith('institutional-')
    && !Object.hasOwn(change, 'reportedValueUsd');
  return normalizeActivity({
    id: change.activityId,
    entityId: change.entityId,
    providerId: change.providerId,
    kind: 'holding_change',
    sourceStableId: change.sourceStableId,
    sourceUrl: change.sourceUrl,
    publisher: 'SEC EDGAR',
    sourceGrade: 'official_filing',
    identityConfidence: change.confidence,
    asset: change.asset,
    direction: null,
    magnitude: valuationMissing ? null : {
      value: change.reportedValueUsd ?? 0,
      unit: 'reported_value_usd',
    },
    effectiveAt: change.effectiveAt,
    disclosedAt: change.disclosedAt,
    observedAt: change.observedAt,
    retrievedAt: change.retrievedAt,
    delaySeconds: Math.max(0, (Date.parse(change.disclosedAt) - Date.parse(change.effectiveAt)) / 1_000),
    summary: valuationMissing
      ? 'A BTC balance changed, but the filing did not disclose a BTC-specific USD value.'
      : `An official filing reported a ${change.classification} holding.`,
    caveats: valuationMissing
      ? ['No material signal is derived without a BTC-specific USD value.', 'A disclosed balance change is not evidence of a trade.']
      : ['A disclosed holding change is not evidence of a trade.'],
    freshness: 'fresh',
  }, { now });
}

function mergeRows(groups) {
  const byId = new Map();
  for (const rows of groups) for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeSmartMoneySettledState(input) {
  const { adapters, settled, previous, dueAdapters, now } = input;
  const previousById = new Map(previous.adapterState.adapters.map((row) => [row.id, row]));
  const settledById = new Map(settled.map((row) => [row.adapter.id, row.result]));
  const dueIds = new Set(dueAdapters.map((adapter) => adapter.id));
  const stateRows = [];
  const aggregateRows = [];
  const changes = [];
  const warnings = [];
  const entities = listEntities();
  for (const adapter of adapters) {
    const prior = previousById.get(adapter.id);
    const result = settledById.get(adapter.id);
    let source = prior?.source ?? null;
    let status = prior?.status ?? null;
    if (dueIds.has(adapter.id) && result?.status === 'fulfilled') {
      try {
        let candidate;
        let count;
        let sourceAsOf = null;
        if (adapter.id === 'sec-edgar') {
          assertSafePlainRecord(result.value, ['filings', 'disclosures', 'holdings']);
          for (const field of ['filings', 'disclosures', 'holdings']) assertSafeArray(result.value[field]);
          count = result.value.filings.length + result.value.disclosures.length;
          candidate = { kind: 'sec', snapshot: structuredClone(result.value) };
          sourceAsOf = latestSecSourceAsOf(candidate.snapshot);
        } else {
          assertSafePlainRecord(result.value, ['providerId', 'records', 'retrievedAt']);
          assertSafeArray(result.value.records);
          if (result.value.providerId !== adapter.id
              || canonicalTimestamp(result.value.retrievedAt, { now }) !== result.value.retrievedAt) {
            throw schemaInvalid();
          }
          count = result.value.records.length;
          candidate = { kind: 'institutional', records: structuredClone(result.value.records) };
          sourceAsOf = latestInstitutional(candidate.records)?.sourceAsOf ?? null;
        }
        if (count === 0) {
          status = publicStatus({
            id: adapter.id, status: 'unavailable', now, previous: prior?.status,
            recordCount: prior?.status?.recordCount ?? sourceRecordCount(adapter.id, source),
            errorCode: 'empty_dataset', sourceAsOf: prior?.status?.sourceAsOf ?? null,
          });
          warnings.push(`${adapter.id}:empty_dataset`);
        } else {
          const candidateStatus = publicStatus({
            id: adapter.id, status: 'live', now, previous: prior?.status,
            recordCount: count, sourceAsOf,
          });
          source = validateSource(candidate, adapter.id, candidateStatus, now, entities);
          status = candidateStatus;
          changes.push(...(adapter.id === 'sec-edgar'
            ? buildSecHoldingChanges(source, prior?.source, now)
            : institutionalHoldingChanges(adapter.id, source, prior?.source, now)));
        }
      } catch (error) {
        const errorCode = sanitizeProviderError(error);
        source = prior?.source ?? null;
        status = publicStatus({
          id: adapter.id, status: 'unavailable', now, previous: prior?.status,
          recordCount: prior?.status?.recordCount ?? sourceRecordCount(adapter.id, source),
          errorCode, sourceAsOf: prior?.status?.sourceAsOf ?? null,
        });
        warnings.push(`${adapter.id}:${errorCode}`);
      }
    } else if (dueIds.has(adapter.id)) {
      const errorCode = sanitizeProviderError(result?.reason);
      status = publicStatus({
        id: adapter.id, status: 'unavailable', now, previous: prior?.status,
        recordCount: prior?.status?.recordCount ?? 0, errorCode,
        sourceAsOf: prior?.status?.sourceAsOf ?? null,
      });
      warnings.push(`${adapter.id}:${errorCode}`);
    } else if (status !== null) {
      status = normalizeProviderStatus(status, getProviderFreshnessPolicy(adapter.id), { now });
    }
    stateRows.push({ id: adapter.id, source, status });
    if (source !== null) {
      const normalized = adapter.id === 'sec-edgar'
        ? normalizeAdapterSnapshot(source.snapshot, {
          now, retrievedAt: status?.retrievedAt ?? now.toISOString(),
          providerId: 'sec-edgar', entityId: 'situational-awareness-lp', entities,
        })
        : normalizeAdapterSnapshot({
          records: source.records,
          statuses: [compactInstitutionalStatus(status, adapter.id, now.toISOString())],
        }, { now, entities });
      const stale = status?.status !== 'live';
      aggregateRows.push({
        ...normalized,
        activities: normalized.activities.map((activity) => stale
          ? normalizeActivity({ ...activity, freshness: 'stale' }, { now })
          : activity),
      });
    }
  }
  const changeActivities = changes.map((change) => changeActivity(change, now));
  const providerStatuses = stateRows.map((row) => row.status).filter(Boolean);
  return {
    entities: mergeRows(aggregateRows.map((row) => row.entities)),
    activities: mergeRows([...aggregateRows.map((row) => row.activities), changeActivities]),
    performances: mergeRows(aggregateRows.map((row) => row.performances)),
    providerStatuses,
    changes,
    adapterState: { schemaVersion: 1, adapters: stateRows, pendingConfirmations: [] },
    warnings,
    sourceLinks: adapters.map((adapter) => {
      const right = SOURCE_RIGHTS.find((row) => row.id === adapter.rightsId);
      return { providerId: adapter.id, label: right.provider, url: right.endpoint };
    }),
    partial: providerStatuses.length !== adapters.length
      || providerStatuses.some((status) => status.status !== 'live'),
  };
}

function yahooSymbol(ticker) {
  return SYMBOLS.find((row) => row.ticker === ticker) ?? null;
}

function yahooPoints(response) {
  const timestamps = response?.timestamp;
  const closes = response?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) return [];
  const points = timestamps.flatMap((timestamp, index) => {
    const seconds = Number(timestamp);
    const price = Number(closes[index]);
    if (!Number.isFinite(seconds) || !Number.isFinite(price) || price <= 0) return [];
    return [{ asOf: new Date(seconds * 1_000).toISOString(), price }];
  });
  const marketTime = Number(response?.meta?.regularMarketTime);
  const marketPrice = Number(response?.meta?.regularMarketPrice);
  if (Number.isFinite(marketTime) && Number.isFinite(marketPrice) && marketPrice > 0) {
    points.push({ asOf: new Date(marketTime * 1_000).toISOString(), price: marketPrice });
  }
  return points.sort((left, right) => left.asOf.localeCompare(right.asOf));
}

function yahooEvidenceBridge(fetchBatches, completionNow) {
  async function fetchRows(tickers) {
    const mappings = tickers.map(yahooSymbol).filter(Boolean);
    if (mappings.length === 0) return { mappings, bySymbol: new Map() };
    const result = await fetchBatches([...new Set(mappings.map((row) => row.yahoo))]);
    return { mappings, bySymbol: result?.bySymbol instanceof Map ? result.bySymbol : new Map() };
  }
  return {
    async quote(signal) {
      const ticker = signal.asset?.ticker;
      const { mappings, bySymbol } = await fetchRows([ticker]);
      const retrievedAt = exactNow(completionNow()).toISOString();
      const mapping = mappings[0];
      const points = mapping ? yahooPoints(bySymbol.get(mapping.yahoo.toUpperCase())) : [];
      const point = points.find((row) => row.asOf >= signal.observedAt && row.asOf <= retrievedAt);
      return point ? {
        ticker, price: point.price, currency: 'USD', source: 'yahoo',
        asOf: point.asOf, retrievedAt,
      } : { skipped: true, reason: 'missing_reference_price' };
    },
    async closes({ date, tickers }) {
      const { mappings, bySymbol } = await fetchRows(tickers);
      const retrievedAt = exactNow(completionNow()).toISOString();
      return mappings.flatMap((mapping) => {
        const point = yahooPoints(bySymbol.get(mapping.yahoo.toUpperCase()))
          .filter((row) => row.asOf.slice(0, 10) === date).at(-1);
        if (!point) return [];
        return [{
          date,
          ticker: mapping.ticker,
          assetClass: mapping.category === 'CRYPTO' ? 'crypto' : 'equity',
          close: point.price,
          currency: 'USD',
          source: 'yahoo',
          status: 'closed',
          asOf: point.asOf,
          retrievedAt,
        }];
      });
    },
  };
}

function buildProductionSnapshot({ normalized, committedSignals, now }) {
  const entities = mergeRows([normalized.entities, listEntities().map((entity) => normalizeEntity(entity, { now }))]);
  const performances = normalized.performances;
  const snapshot = {
    schemaVersion: 1,
    ok: true,
    fetchedAt: now.toISOString(),
    partial: normalized.partial,
    entities,
    activities: normalized.activities,
    performances,
    signals: committedSignals,
    rankings: {
      investors: rankInvestors(entities, normalized.activities),
      crypto: {
        polymarket: { month: rankCryptoAccounts(performances, { venue: 'polymarket', window: 'month' }) },
        hyperliquid: {
          month: rankCryptoAccounts(performances, { venue: 'hyperliquid', window: 'month' }),
          allTime: rankCryptoAccounts(performances, { venue: 'hyperliquid', window: 'allTime' }),
        },
      },
    },
    providerStatuses: normalized.providerStatuses,
    warnings: normalized.warnings,
    sourceLinks: normalized.sourceLinks,
  };
  return validateAcceptedSnapshot(snapshot, { now });
}

function productionAdapters(now) {
  const configs = listConfiguredAdapters({ now });
  exactAdapterIds(configs);
  const institutional = new Map(INSTITUTIONAL_DISCLOSURE_CONFIGS.map((config) => [config.id, config]));
  return configs.map((adapter) => ({
    ...adapter,
    fetch: adapter.id === 'sec-edgar'
      ? () => fetchSecSnapshot({
        providerId: 'sec-edgar', cik: '2045724', userAgent: process.env.SEC_USER_AGENT,
      })
      : () => fetchInstitutionalDisclosure(institutional.get(adapter.id), {
        userAgent: process.env.SEC_USER_AGENT,
      }),
  }));
}

export function createProductionSmartMoneyDependencies(nowValue = new Date()) {
  const now = exactNow(nowValue);
  const completionNow = () => new Date();
  return {
    adapters: productionAdapters(now),
    rights: SOURCE_RIGHTS,
    now: () => new Date(now),
    completionNow,
    withRefreshLock,
    assertAdapterRights,
    readSnapshot: readAcceptedSmartMoneySnapshot,
    readCandidateSnapshot: readDurableSmartMoneyCandidate,
    isAdapterDue: (adapter, status, policy, current) => isProviderRefreshDue(status, policy, current),
    normalizeSettled: normalizeSmartMoneySettledState,
    deriveSignals,
    resolveReferencePrice: async () => ({ skipped: true, reason: 'source_not_permitted' }),
    listTrackedTickers,
    resolveDailyMarks: async () => [],
    appendJournal: (input) => stageJournal(input, { now: exactNow(completionNow()) }),
    publishJournalGeneration: (input) => publishJournalGeneration(input, {
      now: exactNow(completionNow()),
    }),
    buildSnapshot: buildProductionSnapshot,
    writeSnapshot: (snapshot) => writeSmartMoneySnapshot(snapshot, {
      nowMs: exactNow(completionNow()).getTime(),
    }),
  };
}

function safeRefreshResult({ normalized, signalsAccepted, persisted, errorCode = null }) {
  return {
    persisted,
    partial: Boolean(normalized.partial),
    providerStatuses: structuredClone(normalized.providerStatuses),
    signalsAccepted: structuredClone(signalsAccepted),
    warnings: [...normalized.warnings],
    errorCode,
  };
}

export function createSmartMoneyRefresher(givenDependencies = null) {
  return async function refreshSmartMoney(_input = {}) {
    const lock = givenDependencies?.withRefreshLock || withRefreshLock;
    return lock(async () => {
      const invocationNow = exactNow(
        typeof givenDependencies?.now === 'function' ? givenDependencies.now() : new Date(),
      );
      const deps = givenDependencies ?? createProductionSmartMoneyDependencies(invocationNow);
      const completionNow = typeof deps.completionNow === 'function'
        ? deps.completionNow
        : () => new Date(invocationNow);
      const fallbackYahoo = typeof deps.fetchYahooSparkBatches === 'function'
        ? yahooEvidenceBridge(deps.fetchYahooSparkBatches, completionNow)
        : null;
      exactAdapterIds(deps.adapters);
      deps.assertAdapterRights(deps.adapters, deps.rights, { now: invocationNow });
      const stored = await deps.readSnapshot();
      const previous = stored === null
        ? {
          schemaVersion: 1,
          refreshStartedAt: invocationNow.toISOString(),
          publicSnapshot: null,
          adapterState: emptyAdapterState(),
        }
        : validateSmartMoneyPrivateSnapshot(stored, { now: invocationNow });
      if (typeof deps.readCandidateSnapshot === 'function') {
        const storedCandidate = await deps.readCandidateSnapshot();
        if (storedCandidate !== null) {
          const candidate = validateSmartMoneyPrivateSnapshot(storedCandidate, {
            now: exactNow(completionNow()),
          });
          if (stored === null || candidate.refreshStartedAt > previous.refreshStartedAt) {
            const recovered = await deps.publishJournalGeneration({
              refreshStartedAt: candidate.refreshStartedAt,
              snapshot: candidate,
            });
            if (recovered.durableWriteSucceeded !== true) {
              return {
                persisted: false,
                partial: candidate.publicSnapshot.partial,
                providerStatuses: structuredClone(candidate.publicSnapshot.providerStatuses),
                signalsAccepted: [],
                warnings: [...candidate.publicSnapshot.warnings],
                errorCode: 'journal_publication_failed',
              };
            }
            return {
              persisted: true,
              partial: candidate.publicSnapshot.partial,
              providerStatuses: structuredClone(candidate.publicSnapshot.providerStatuses),
              signalsAccepted: structuredClone(candidate.publicSnapshot.signals),
              warnings: [...candidate.publicSnapshot.warnings],
              errorCode: null,
            };
          }
        }
      }
      const previousById = new Map(previous.adapterState.adapters.map((row) => [row.id, row]));
      const dueAdapters = deps.adapters.filter((adapter) => deps.isAdapterDue(
        adapter,
        previousById.get(adapter.id)?.status ?? null,
        getProviderFreshnessPolicy(adapter.id),
        invocationNow,
      ));
      const results = await Promise.allSettled(dueAdapters.map((adapter) => (
        Promise.resolve().then(() => adapter.fetch())
      )));
      const normalizedAt = exactNow(completionNow());
      const settled = dueAdapters.map((adapter, index) => ({ adapter, result: results[index] }));
      const normalizeSettled = deps.normalizeSettled || normalizeSmartMoneySettledState;
      const normalized = normalizeSettled({
        adapters: deps.adapters,
        settled,
        dueAdapters,
        previous,
        now: normalizedAt,
      });
      const canonicalState = validateSmartMoneyAdapterState(normalized.adapterState, {
        now: normalizedAt,
      });
      const derived = deps.deriveSignals({
        changes: normalized.changes,
        pendingConfirmations: previous.adapterState.pendingConfirmations,
        nowMs: normalizedAt.getTime(),
      });
      const pricedSignals = [];
      for (const signal of derived.signals) {
        const quote = typeof deps.resolveReferencePrice === 'function'
          ? await deps.resolveReferencePrice(signal)
          : fallbackYahoo
            ? await fallbackYahoo.quote(signal)
            : { skipped: true, reason: 'source_not_permitted' };
        const priceCompletedAt = exactNow(completionNow());
        pricedSignals.push(quote?.skipped ? signal : attachReferencePrice(signal, quote, { now: priceCompletedAt }));
      }
      const since = new Date(invocationNow.getTime() - RETENTION_MS).toISOString();
      const retainedTickers = await deps.listTrackedTickers({ since });
      const tickers = [...new Set([
        ...retainedTickers,
        ...pricedSignals.flatMap((signal) => signal.asset?.ticker ? [signal.asset.ticker] : []),
        'SPX',
        'BTC',
      ])].sort();
      const completedDate = new Date(Date.UTC(
        invocationNow.getUTCFullYear(), invocationNow.getUTCMonth(), invocationNow.getUTCDate() - 1,
      )).toISOString().slice(0, 10);
      let dailyMarks;
      if (typeof deps.resolveDailyMarks === 'function') {
        dailyMarks = await deps.resolveDailyMarks({ tickers, date: completedDate });
      } else if (fallbackYahoo) {
        const rows = await fallbackYahoo.closes({ tickers, date: completedDate });
        const marksCompletedAt = exactNow(completionNow());
        dailyMarks = await resolveDailyMarks({ tickers, date: completedDate }, {
          now: () => new Date(marksCompletedAt),
          fetchDailyCloses: async () => rows,
        });
      } else {
        dailyMarks = [];
      }
      const journal = await deps.appendJournal({
        refreshStartedAt: invocationNow.toISOString(),
        signals: pricedSignals,
        dailyMarks,
      });
      if (journal.durableWriteSucceeded !== true) {
        return safeRefreshResult({
          normalized, signalsAccepted: [], persisted: false,
          errorCode: 'journal_persistence_failed',
        });
      }
      const publicationNow = exactNow(completionNow());
      const publicSnapshot = validateAcceptedSnapshot(deps.buildSnapshot({
        normalized,
        committedSignals: journal.committedSignals,
        committedDailyMarks: journal.committedDailyMarks,
        now: publicationNow,
      }), { now: publicationNow });
      const privateSnapshot = buildSmartMoneyPrivateSnapshot({
        refreshStartedAt: invocationNow.toISOString(),
        publicSnapshot,
        adapterState: {
          ...canonicalState,
          pendingConfirmations: structuredClone(derived.pendingConfirmations),
        },
      }, { now: publicationNow });
      const written = await deps.writeSnapshot(privateSnapshot);
      if (written.durableWriteSucceeded !== true) {
        return safeRefreshResult({
          normalized, signalsAccepted: [], persisted: false,
          errorCode: 'snapshot_persistence_failed',
        });
      }
      const publication = await deps.publishJournalGeneration({
        refreshStartedAt: invocationNow.toISOString(),
        snapshot: privateSnapshot,
      });
      if (publication.durableWriteSucceeded !== true) {
        return safeRefreshResult({
          normalized, signalsAccepted: [], persisted: false,
          errorCode: 'journal_publication_failed',
        });
      }
      return safeRefreshResult({
        normalized,
        signalsAccepted: journal.committedSignals,
        persisted: true,
      });
    });
  };
}

export const refreshSmartMoney = createSmartMoneyRefresher();
