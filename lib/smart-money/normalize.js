import {
  ACTIVITY_KINDS,
  ASSET_CLASSES,
  DIRECTIONS,
  INSTITUTIONAL_PROVIDER_ENTITY_IDS,
  assertSafeArray,
  assertSafePlainDataRecord,
  assertSafePlainRecord,
  assertKnownInstitutionalProvider,
  assertProviderEntity,
  canonicalTimestamp,
  enumValue,
  finiteNumber,
  httpsUrl,
  normalizeAsset,
  safeIdentifier,
  schemaInvalid,
  stringValue,
  validateSignal,
} from './contracts.js';

export const PROVIDER_FRESHNESS_POLICIES = Object.freeze({
  polymarket: Object.freeze({ cacheTtlMs: 10 * 60_000, staleAfterMs: 30 * 60_000 }),
  hyperliquid: Object.freeze({ cacheTtlMs: 60 * 60_000, staleAfterMs: 2 * 60 * 60_000 }),
  official: Object.freeze({ cacheTtlMs: 12 * 60 * 60_000, staleAfterMs: 36 * 60 * 60_000 }),
});

function nowFrom(options) {
  const value = options instanceof Date ? options
    : options && typeof options === 'object' ? (Object.hasOwn(options, 'now') ? options.now : new Date())
      : options == null ? new Date()
        : options;
  const now = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(now.getTime())) throw schemaInvalid();
  return now;
}

function safeStringArray(value, normalizer = (item) => stringValue(item, { maxLength: 1_000 })) {
  assertSafeArray(value);
  const normalized = value.map(normalizer);
  if (new Set(normalized).size !== normalized.length) throw schemaInvalid();
  return normalized;
}

const ENTITY_FIELDS = Object.freeze([
  'id', 'displayName', 'legalEntity', 'actorType', 'directoryCategory', 'strategyTags',
  'people', 'relatedEntityIds', 'officialUrls', 'identity', 'evidenceCoverage',
  'performanceVerification', 'lastCheckedAt', 'caveats',
]);
const LEGACY_ENTITY_OPTIONAL = Object.freeze(['lastCheckedAt', 'caveats']);

export function normalizeEntity(value, options = {}) {
  const now = nowFrom(options);
  assertSafePlainRecord(value, ENTITY_FIELDS, ENTITY_FIELDS.filter((field) => !LEGACY_ENTITY_OPTIONAL.includes(field)));
  const identityFields = ['status', 'confidence', 'provider', 'verifiedAt', 'lastVerifiedAt'];
  assertSafePlainRecord(value.identity, identityFields, ['status', 'confidence', 'provider']);
  const actorType = enumValue(value.actorType, ['person', 'firm', 'fund', 'anonymous_wallet', 'venue_account']);
  const directoryCategory = enumValue(value.directoryCategory, ['investors', 'firms', 'crypto-traders', 'institutional-flows']);
  if (actorType === 'venue_account' && directoryCategory !== 'crypto-traders') throw schemaInvalid();
  if (actorType === 'person' && directoryCategory !== 'investors') throw schemaInvalid();
  const rawVerifiedAt = value.identity.verifiedAt ?? value.identity.lastVerifiedAt;
  const verifiedAt = canonicalTimestamp(rawVerifiedAt, { now });
  const identityStatus = value.identity.status === 'official' ? 'verified' : value.identity.status;
  const evidenceCoverage = Array.isArray(value.evidenceCoverage)
    ? safeStringArray(value.evidenceCoverage)
    : [stringValue(value.evidenceCoverage, { maxLength: 1_000 })];
  assertSafePlainRecord(value.performanceVerification, ['status']);
  const result = {
    id: safeIdentifier(value.id),
    displayName: stringValue(value.displayName, { maxLength: 256 }),
    legalEntity: stringValue(value.legalEntity, { nullable: true, maxLength: 256 }),
    actorType,
    directoryCategory,
    strategyTags: safeStringArray(value.strategyTags, (item) => stringValue(item, { maxLength: 100 })),
    people: safeStringArray(value.people, (item) => stringValue(item, { maxLength: 256 })),
    relatedEntityIds: safeStringArray(value.relatedEntityIds, safeIdentifier),
    officialUrls: safeStringArray(value.officialUrls, httpsUrl),
    identity: {
      status: enumValue(identityStatus, ['verified', 'anonymous', 'unverified']),
      confidence: enumValue(value.identity.confidence, ['high', 'medium', 'low']),
      provider: stringValue(value.identity.provider, { maxLength: 256 }),
      verifiedAt,
    },
    evidenceCoverage,
    performanceVerification: {
      status: enumValue(value.performanceVerification.status, [
        'official_reported', 'audited', 'provider_reported', 'not_publicly_verified', 'unavailable',
      ]),
    },
    lastCheckedAt: canonicalTimestamp(value.lastCheckedAt ?? rawVerifiedAt, { now }),
    caveats: value.caveats == null ? [] : safeStringArray(value.caveats),
  };
  if (result.id.startsWith('hyperliquid:') || result.id.startsWith('polymarket:')) {
    if (result.actorType !== 'venue_account' || result.directoryCategory !== 'crypto-traders') throw schemaInvalid();
  }
  return result;
}

const WINDOW_FIELDS = Object.freeze(['pnlUsd', 'roiPct', 'volumeUsd']);
function normalizeWindow(value) {
  if (value === null) return null;
  assertSafePlainRecord(value, WINDOW_FIELDS);
  return {
    pnlUsd: finiteNumber(value.pnlUsd, { nullable: true }),
    roiPct: finiteNumber(value.roiPct, { nullable: true }),
    volumeUsd: finiteNumber(value.volumeUsd, { nullable: true, nonnegative: true }),
  };
}

const PERFORMANCE_FIELDS = Object.freeze([
  'id', 'entityId', 'providerId', 'venue', 'scope', 'accountValueUsd', 'windows',
  'methodology', 'sourceAsOf', 'retrievedAt', 'freshnessBasis', 'notComparableAcrossProviders',
]);

export function normalizePerformance(value, options = {}) {
  const now = nowFrom(options);
  assertSafePlainRecord(value, PERFORMANCE_FIELDS);
  const providerId = safeIdentifier(value.providerId);
  const entityId = safeIdentifier(value.entityId);
  const venue = enumValue(value.venue, ['hyperliquid', 'polymarket', 'official']);
  if ((providerId.startsWith('hyperliquid-') && venue !== 'hyperliquid')
      || (providerId.startsWith('polymarket-') && venue !== 'polymarket')) throw schemaInvalid();
  assertProviderEntity(providerId, entityId);
  assertSafePlainRecord(value.windows, ['day', 'month', 'allTime']);
  if (typeof value.notComparableAcrossProviders !== 'boolean'
      || ((venue === 'hyperliquid' || venue === 'polymarket') && value.notComparableAcrossProviders !== true)) throw schemaInvalid();
  return {
    id: safeIdentifier(value.id), entityId, providerId, venue,
    scope: enumValue(value.scope, ['account', 'vehicle', 'fund', 'company']),
    accountValueUsd: finiteNumber(value.accountValueUsd, { nullable: true, nonnegative: true }),
    windows: {
      day: normalizeWindow(value.windows.day),
      month: normalizeWindow(value.windows.month),
      allTime: normalizeWindow(value.windows.allTime),
    },
    methodology: enumValue(value.methodology, ['official_reported', 'provider_reported']),
    sourceAsOf: canonicalTimestamp(value.sourceAsOf, { nullable: true, now }),
    retrievedAt: canonicalTimestamp(value.retrievedAt, { now }),
    freshnessBasis: enumValue(value.freshnessBasis, ['provider_time', 'retrieval_time']),
    notComparableAcrossProviders: value.notComparableAcrossProviders,
  };
}

const ACTIVITY_FIELDS = Object.freeze([
  'id', 'entityId', 'providerId', 'kind', 'sourceStableId', 'sourceUrl', 'publisher',
  'sourceGrade', 'identityConfidence', 'asset', 'direction', 'magnitude', 'effectiveAt',
  'disclosedAt', 'observedAt', 'retrievedAt', 'delaySeconds', 'timingBasis', 'summary',
  'caveats', 'freshness',
]);
const ACTIVITY_REQUIRED_FIELDS = Object.freeze(
  ACTIVITY_FIELDS.filter((field) => field !== 'timingBasis'),
);

export function normalizeActivity(value, options = {}) {
  const now = nowFrom(options);
  assertSafePlainRecord(value, ACTIVITY_FIELDS, ACTIVITY_REQUIRED_FIELDS);
  const providerId = safeIdentifier(value.providerId);
  const entityId = safeIdentifier(value.entityId);
  assertProviderEntity(providerId, entityId);
  let magnitude = null;
  if (value.magnitude !== null) {
    assertSafePlainRecord(value.magnitude, ['value', 'unit']);
    magnitude = { value: finiteNumber(value.magnitude.value), unit: stringValue(value.magnitude.unit, { maxLength: 64 }) };
  }
  const effectiveAt = canonicalTimestamp(value.effectiveAt, { now });
  const disclosedAt = canonicalTimestamp(value.disclosedAt, { nullable: true, now });
  const observedAt = canonicalTimestamp(value.observedAt, { now });
  const retrievedAt = canonicalTimestamp(value.retrievedAt, { now });
  const delaySeconds = finiteNumber(value.delaySeconds, { nonnegative: true });
  const delayAt = ['filing', 'holding_change'].includes(value.kind) && disclosedAt !== null ? disclosedAt : observedAt;
  const timingBasis = Object.hasOwn(value, 'timingBasis')
    ? enumValue(value.timingBasis, ['filing_date'])
    : null;
  if (Date.parse(observedAt) < Date.parse(delayAt) || Date.parse(retrievedAt) < Date.parse(observedAt)
      || (Date.parse(delayAt) - Date.parse(effectiveAt)) / 1_000 !== delaySeconds) throw schemaInvalid();
  if (timingBasis !== null && (value.kind !== 'filing' || disclosedAt === null
      || effectiveAt !== disclosedAt)) throw schemaInvalid();
  return {
    id: safeIdentifier(value.id), entityId, providerId,
    kind: enumValue(value.kind, ACTIVITY_KINDS),
    sourceStableId: safeIdentifier(value.sourceStableId),
    sourceUrl: httpsUrl(value.sourceUrl),
    publisher: stringValue(value.publisher, { maxLength: 256 }),
    sourceGrade: stringValue(value.sourceGrade, { maxLength: 100 }),
    identityConfidence: enumValue(value.identityConfidence, ['high', 'medium', 'low']),
    asset: value.asset === null ? null : normalizeAsset(value.asset),
    direction: enumValue(value.direction, DIRECTIONS, { nullable: true }),
    magnitude,
    effectiveAt,
    disclosedAt,
    observedAt,
    retrievedAt,
    delaySeconds,
    ...(timingBasis === null ? {} : { timingBasis }),
    summary: stringValue(value.summary, { maxLength: 600 }),
    caveats: safeStringArray(value.caveats),
    freshness: enumValue(value.freshness, ['fresh', 'stale']),
  };
}

const STATUS_FIELDS = Object.freeze([
  'id', 'group', 'enabled', 'status', 'lastAttemptAt', 'lastSuccessAt', 'sourceAsOf',
  'retrievedAt', 'freshnessBasis', 'recordCount', 'cacheAgeSeconds', 'errorCode',
]);

export function getProviderFreshnessPolicy(providerId) {
  if (typeof providerId !== 'string') return null;
  if (providerId.startsWith('polymarket-')) return PROVIDER_FRESHNESS_POLICIES.polymarket;
  if (providerId.startsWith('hyperliquid-')) return PROVIDER_FRESHNESS_POLICIES.hyperliquid;
  if (providerId.startsWith('institutional-')
      && !Object.hasOwn(INSTITUTIONAL_PROVIDER_ENTITY_IDS, providerId)) return null;
  if (providerId === 'sec-edgar' || Object.hasOwn(INSTITUTIONAL_PROVIDER_ENTITY_IDS, providerId)
      || providerId.startsWith('official-') || providerId.includes('publication')
      || ['leopold-official', 'berkshire-letters', 'pershing-performance', 'fundsmith-documents', 'oaktree-insights', 'ark-publications'].includes(providerId)) {
    return PROVIDER_FRESHNESS_POLICIES.official;
  }
  return null;
}

function elapsedSince(status, field, now) {
  const timestamp = canonicalTimestamp(status?.[field], { now });
  return Math.max(0, now.getTime() - Date.parse(timestamp));
}

export function isProviderRefreshDue(status, policy, nowValue = new Date()) {
  const now = nowFrom(nowValue);
  if (!policy || !Number.isFinite(policy.cacheTtlMs) || policy.cacheTtlMs < 0) throw schemaInvalid();
  if (!status?.lastSuccessAt || status?.status === 'unavailable') return true;
  return elapsedSince(status, 'lastSuccessAt', now) >= policy.cacheTtlMs;
}

export function classifyProviderFreshness(status, policy, nowValue = new Date()) {
  const now = nowFrom(nowValue);
  if (!policy || !Number.isFinite(policy.staleAfterMs) || policy.staleAfterMs < 0) throw schemaInvalid();
  if (!status || status.enabled === false || status.status === 'unavailable' || !status.lastSuccessAt) return 'unavailable';
  return elapsedSince(status, 'lastSuccessAt', now) >= policy.staleAfterMs ? 'stale' : 'live';
}

export function normalizeProviderStatus(value, policy, options = {}) {
  const now = nowFrom(options);
  assertSafePlainRecord(value, STATUS_FIELDS);
  assertKnownInstitutionalProvider(value.id);
  const enabled = value.enabled;
  if (typeof enabled !== 'boolean') throw schemaInvalid();
  enumValue(value.status, ['live', 'stale', 'unavailable']);
  const lastAttemptAt = canonicalTimestamp(value.lastAttemptAt, { nullable: true, now });
  const lastSuccessAt = canonicalTimestamp(value.lastSuccessAt, { nullable: true, now });
  const retrievedAt = canonicalTimestamp(value.retrievedAt, { now });
  const status = classifyProviderFreshness({ ...value, enabled, lastSuccessAt }, policy, now);
  const recordCount = finiteNumber(value.recordCount, { nonnegative: true });
  if (!Number.isInteger(recordCount) || (status === 'live' && recordCount < 1)) throw schemaInvalid();
  const errorCode = value.errorCode === null ? null : safeIdentifier(value.errorCode);
  if (status === 'unavailable' && errorCode === null) throw schemaInvalid();
  return {
    id: safeIdentifier(value.id),
    group: enumValue(value.group, ['polymarket', 'hyperliquid', 'official', 'sec', 'publications', 'institutional']),
    enabled,
    status,
    lastAttemptAt,
    lastSuccessAt,
    sourceAsOf: canonicalTimestamp(value.sourceAsOf, { nullable: true, now }),
    retrievedAt,
    freshnessBasis: enumValue(value.freshnessBasis, ['provider_time', 'retrieval_time']),
    recordCount,
    cacheAgeSeconds: lastSuccessAt === null ? 0 : Math.floor(Math.max(0, now.getTime() - Date.parse(lastSuccessAt)) / 1000),
    errorCode,
  };
}

export function dedupeByStableId(records) {
  assertSafeArray(records);
  const seen = new Set();
  return records.map((record) => {
    assertSafePlainDataRecord(record);
    const id = safeIdentifier(record.id);
    if (seen.has(id)) {
      const error = new TypeError('duplicate_id');
      error.code = 'duplicate_id';
      throw error;
    }
    seen.add(id);
    return record;
  });
}

function normalizeCanonicalAggregate(input, context) {
  assertSafePlainRecord(input, ['entities', 'activities', 'performances', 'providerStatuses']);
  for (const key of ['entities', 'activities', 'performances', 'providerStatuses']) assertSafeArray(input[key]);
  return {
    entities: dedupeByStableId(input.entities.map((value) => normalizeEntity(value, context))),
    activities: dedupeByStableId(input.activities.map((value) => normalizeActivity(value, context))),
    performances: dedupeByStableId(input.performances.map((value) => normalizePerformance(value, context))),
    providerStatuses: dedupeByStableId(input.providerStatuses.map((value) => {
      const policy = getProviderFreshnessPolicy(value?.id);
      if (!policy) throw schemaInvalid();
      return normalizeProviderStatus(value, policy, context);
    })),
  };
}

const ADAPTER_PERFORMANCE_FIELDS = Object.freeze([
  ...PERFORMANCE_FIELDS, 'wallet', 'displayName', 'rank', 'category',
]);

function projectAdapterPerformance(value, context) {
  assertSafePlainRecord(value, ADAPTER_PERFORMANCE_FIELDS, PERFORMANCE_FIELDS);
  const projected = Object.fromEntries(PERFORMANCE_FIELDS.map((field) => [field, value[field]]));
  return normalizePerformance(projected, context);
}

function contextEntities(context) {
  const entities = context?.entities ?? [];
  assertSafeArray(entities);
  return entities;
}

function contextRetrievedAt(context) {
  const now = nowFrom(context);
  return canonicalTimestamp(context?.retrievedAt ?? now.toISOString(), { now });
}

function selectedEntity(entityId, context) {
  const entity = contextEntities(context).find((candidate) => candidate?.id === entityId);
  if (!entity) throw schemaInvalid();
  return normalizeEntity(entity, context);
}

function providerGroup(providerId) {
  if (providerId.startsWith('hyperliquid-')) return 'hyperliquid';
  if (providerId.startsWith('polymarket-')) return 'polymarket';
  if (providerId.startsWith('institutional-')) return 'institutional';
  if (providerId === 'sec-edgar') return 'sec';
  return 'publications';
}

function synthesizedStatus(providerId, retrievedAt, recordCount, context, { linkOnly = false, sourceAsOf = null } = {}) {
  const policy = getProviderFreshnessPolicy(providerId);
  if (!policy) throw schemaInvalid();
  const live = !linkOnly && recordCount > 0;
  return normalizeProviderStatus({
    id: providerId,
    group: providerGroup(providerId),
    enabled: true,
    status: live ? 'live' : 'unavailable',
    lastAttemptAt: retrievedAt,
    lastSuccessAt: live ? retrievedAt : null,
    sourceAsOf,
    retrievedAt,
    freshnessBasis: sourceAsOf === null ? 'retrieval_time' : 'provider_time',
    recordCount,
    cacheAgeSeconds: 0,
    errorCode: live ? null : linkOnly ? 'rights_gate_failed' : 'empty_dataset',
  }, policy, context);
}

function dynamicVenueEntity(raw, performance, context) {
  const wallet = stringValue(raw.wallet, { maxLength: 64 }).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || performance.entityId !== `${performance.venue}:${wallet}`) throw schemaInvalid();
  const sourceUrl = performance.venue === 'hyperliquid'
    ? `https://app.hyperliquid.xyz/explorer/address/${wallet}`
    : `https://polymarket.com/profile/${wallet}`;
  return normalizeEntity({
    id: performance.entityId,
    displayName: stringValue(raw.displayName, { maxLength: 256 }),
    legalEntity: null,
    actorType: 'venue_account',
    directoryCategory: 'crypto-traders',
    strategyTags: ['crypto'],
    people: [],
    relatedEntityIds: [],
    officialUrls: [sourceUrl],
    identity: {
      status: 'anonymous', confidence: 'high', provider: performance.venue,
      verifiedAt: performance.retrievedAt,
    },
    evidenceCoverage: [performance.providerId],
    performanceVerification: { status: 'provider_reported' },
    lastCheckedAt: performance.retrievedAt,
    caveats: ['Anonymous provider-scoped account; performance is not comparable across providers.'],
  }, context);
}

function normalizeVenueEnvelope(input, context) {
  assertSafePlainDataRecord(input);
  const hyperliquid = input.providerId?.startsWith('hyperliquid-');
  const allowed = hyperliquid
    ? ['providerId', 'performances', 'accounts', 'portfolios', 'fills', 'linkOnly']
    : ['providerId', 'performances', 'positions', 'closedPositions', 'linkOnly'];
  assertSafePlainRecord(input, allowed);
  for (const field of allowed.filter((field) => !['providerId', 'linkOnly'].includes(field))) assertSafeArray(input[field]);
  if (typeof input.linkOnly !== 'boolean') throw schemaInvalid();
  const expectedVenue = input.providerId === 'hyperliquid-leaderboard' ? 'hyperliquid'
    : input.providerId === 'polymarket-leaderboard' ? 'polymarket' : null;
  if (expectedVenue === null) throw schemaInvalid();
  for (const performance of input.performances) {
    assertSafePlainRecord(performance, ADAPTER_PERFORMANCE_FIELDS, PERFORMANCE_FIELDS);
    if (performance.providerId !== input.providerId || performance.venue !== expectedVenue
        || performance?.scope !== 'account') throw schemaInvalid();
    if (expectedVenue === 'polymarket' && performance.category != null
        && (typeof performance.category !== 'string'
          || performance.category.toLowerCase() !== 'crypto')) throw schemaInvalid();
  }
  const performances = dedupeByStableId(input.performances.map((performance) => projectAdapterPerformance(performance, context)));
  const byEntity = new Map();
  input.performances.forEach((raw, index) => {
    const entity = dynamicVenueEntity(raw, performances[index], context);
    if (!byEntity.has(entity.id)) byEntity.set(entity.id, entity);
  });
  const retrievedAt = performances[0]?.retrievedAt
    ?? contextRetrievedAt(context);
  return {
    entities: [...byEntity.values()],
    activities: [],
    performances,
    providerStatuses: [synthesizedStatus(input.providerId, retrievedAt, performances.length, context, { linkOnly: input.linkOnly })],
  };
}

const DISCLOSURE_FIELDS = Object.freeze([
  'id', 'providerId', 'entityId', 'vehicle', 'reportingDate', 'filedAt', 'btcAmount',
  'reportedValueUsd', 'sourceUrl', 'methodology', 'sourceAsOf', 'retrievedAt',
  'freshnessBasis', 'paperEligible',
]);

function institutionalActivity(record, context) {
  assertSafePlainRecord(record, DISCLOSURE_FIELDS);
  if (record.paperEligible !== false || record.methodology !== 'sec_filing_reported'
      || record.freshnessBasis !== 'reporting_date') throw schemaInvalid();
  const effectiveAt = canonicalTimestamp(record.sourceAsOf, { now: nowFrom(context) });
  const disclosedAt = canonicalTimestamp(record.filedAt, { now: nowFrom(context) });
  const observedAt = canonicalTimestamp(record.retrievedAt, { now: nowFrom(context) });
  return normalizeActivity({
    id: `activity:${record.id}`,
    entityId: record.entityId,
    providerId: record.providerId,
    kind: 'filing',
    sourceStableId: record.id,
    sourceUrl: record.sourceUrl,
    publisher: 'SEC EDGAR',
    sourceGrade: 'official_filing',
    identityConfidence: 'high',
    asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true },
    direction: null,
    magnitude: record.reportedValueUsd === null
      ? null
      : { value: record.reportedValueUsd, unit: 'reported_value_usd' },
    effectiveAt,
    disclosedAt,
    observedAt,
    retrievedAt: observedAt,
    delaySeconds: Math.max(0, (Date.parse(disclosedAt) - Date.parse(effectiveAt)) / 1_000),
    summary: record.reportedValueUsd === null
      ? `Official disclosure reports a BTC balance of ${record.btcAmount} for the stated period; no BTC-specific USD value was disclosed.`
      : `Official disclosure reports a BTC balance of ${record.btcAmount} for the stated period.`,
    caveats: record.reportedValueUsd === null
      ? ['No BTC-specific USD value was disclosed; aggregate digital-asset values are not substituted.', 'A disclosed balance change is not evidence of a trade.']
      : ['A disclosed balance change is not evidence of a trade.'],
    freshness: 'fresh',
  }, context);
}

function institutionalStatus(value, context) {
  assertSafePlainRecord(value, ['id', 'group', 'status', 'recordCount', 'errorCode', 'retrievedAt'],
    ['id', 'group', 'status', 'recordCount', 'retrievedAt']);
  if (value.group !== 'institutional') throw schemaInvalid();
  const live = value.status === 'live';
  return normalizeProviderStatus({
    id: value.id, group: 'institutional', enabled: true, status: value.status,
    lastAttemptAt: value.retrievedAt, lastSuccessAt: live ? value.retrievedAt : null,
    sourceAsOf: null, retrievedAt: value.retrievedAt, freshnessBasis: 'retrieval_time',
    recordCount: value.recordCount, cacheAgeSeconds: 0,
    errorCode: live ? null : value.errorCode,
  }, getProviderFreshnessPolicy(value.id), context);
}

function normalizeInstitutionalEnvelope(input, context) {
  assertSafePlainRecord(input, ['records', 'statuses']);
  assertSafeArray(input.records);
  assertSafeArray(input.statuses);
  const activities = dedupeByStableId(input.records.map((record) => institutionalActivity(record, context)));
  const entityIds = [...new Set(input.records.map((record) => safeIdentifier(record.entityId)))];
  return {
    entities: entityIds.map((entityId) => selectedEntity(entityId, context)),
    activities,
    performances: [],
    providerStatuses: dedupeByStableId(input.statuses.map((status) => institutionalStatus(status, context))),
  };
}

const SEC_FILING_FIELDS = Object.freeze([
  'cik', 'form', 'accessionNumber', 'periodEnd', 'filedAt', 'isAmendment', 'amendmentChain',
  'primaryDocument', 'timingBasis',
]);
const SEC_FILING_REQUIRED_FIELDS = Object.freeze(
  SEC_FILING_FIELDS.filter((field) => field !== 'timingBasis'),
);

function secFilingActivity(filing, context) {
  assertSafePlainRecord(filing, SEC_FILING_FIELDS, SEC_FILING_REQUIRED_FIELDS);
  assertSafeArray(filing.amendmentChain);
  const providerId = context.providerId;
  const entityId = context.entityId;
  const retrievedAt = contextRetrievedAt(context);
  const disclosedAt = canonicalTimestamp(filing.filedAt, { now: nowFrom(context) });
  const accession = safeIdentifier(filing.accessionNumber);
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !['13F-HR', '13F-HR/A', 'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A'].includes(filing.form)) throw schemaInvalid();
  const schedule = filing.form.startsWith('SC 13');
  if (typeof filing.isAmendment !== 'boolean'
      || filing.isAmendment !== filing.form.endsWith('/A')
      || filing.amendmentChain.length < 1
      || !filing.amendmentChain.every((row) => /^\d{10}-\d{2}-\d{6}$/.test(safeIdentifier(row)))
      || typeof filing.primaryDocument !== 'string' || filing.primaryDocument.length < 1
      || filing.primaryDocument.length > 512) throw schemaInvalid();
  if (schedule ? (filing.periodEnd !== null || filing.timingBasis !== 'filing_date')
    : (typeof filing.periodEnd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(filing.periodEnd)
      || Object.hasOwn(filing, 'timingBasis'))) throw schemaInvalid();
  const effectiveAt = schedule
    ? disclosedAt
    : canonicalTimestamp(`${filing.periodEnd}T00:00:00.000Z`, { now: nowFrom(context) });
  const archive = accession.replace(/-/g, '');
  return normalizeActivity({
    id: `activity:${providerId}:${accession}`,
    entityId,
    providerId,
    kind: 'filing',
    sourceStableId: accession,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${archive}/index.json`,
    publisher: 'SEC EDGAR', sourceGrade: 'official_filing', identityConfidence: 'high',
    asset: schedule ? {
      ticker: null,
      name: 'Beneficial ownership filing',
      providerSymbol: null,
      assetClass: 'other',
      supported: false,
    } : null,
    direction: null, magnitude: null,
    effectiveAt, disclosedAt, observedAt: retrievedAt, retrievedAt,
    delaySeconds: Math.max(0, (Date.parse(disclosedAt) - Date.parse(effectiveAt)) / 1_000),
    ...(schedule ? { timingBasis: 'filing_date' } : {}),
    summary: schedule
      ? `Official ${filing.form} beneficial-ownership filing received by the SEC.`
      : `Official ${filing.form} filing for the period ending ${filing.periodEnd}.`,
    caveats: schedule
      ? [
        'The beneficial-ownership effective date was not extracted.',
        'This metadata-only filing event does not infer a holding, ticker, or position.',
      ]
      : ['Filing data is delayed disclosure and is not live position data.'],
    freshness: 'fresh',
  }, context);
}

function normalizeSecEnvelope(input, context) {
  assertSafePlainRecord(input, ['filings', 'disclosures', 'holdings']);
  for (const field of ['filings', 'disclosures', 'holdings']) assertSafeArray(input[field]);
  const allFilings = [...input.filings, ...input.disclosures];
  const activities = dedupeByStableId(allFilings.map((filing) => secFilingActivity(filing, context)));
  const retrievedAt = contextRetrievedAt(context);
  return {
    entities: [selectedEntity(context.entityId, context)], activities, performances: [],
    providerStatuses: [synthesizedStatus(context.providerId, retrievedAt, activities.length, context)],
  };
}

const PUBLICATION_FIELDS = Object.freeze([
  'id', 'title', 'canonicalUrl', 'officialPublisher', 'publishedAt', 'metadataHash', 'dashboardSummary',
]);

function publicationActivity(publication, context) {
  assertSafePlainRecord(publication, PUBLICATION_FIELDS);
  const publishedAt = canonicalTimestamp(publication.publishedAt, { now: nowFrom(context) });
  const retrievedAt = contextRetrievedAt(context);
  return normalizeActivity({
    id: `activity:${publication.id}`, entityId: context.entityId, providerId: context.providerId,
    kind: 'statement', sourceStableId: publication.id, sourceUrl: publication.canonicalUrl,
    publisher: publication.officialPublisher, sourceGrade: 'official_publication', identityConfidence: 'high',
    asset: null, direction: null, magnitude: null, effectiveAt: publishedAt, disclosedAt: publishedAt,
    observedAt: retrievedAt, retrievedAt,
    delaySeconds: Math.max(0, (Date.parse(retrievedAt) - Date.parse(publishedAt)) / 1_000),
    summary: publication.dashboardSummary, caveats: [], freshness: 'fresh',
  }, context);
}

function normalizePublicationEnvelope(input, context) {
  assertSafePlainRecord(input, ['publications', 'linkOnly']);
  assertSafeArray(input.publications);
  if (typeof input.linkOnly !== 'boolean') throw schemaInvalid();
  const activities = dedupeByStableId(input.publications.map((publication) => publicationActivity(publication, context)));
  const retrievedAt = contextRetrievedAt(context);
  return {
    entities: [selectedEntity(context.entityId, context)], activities, performances: [],
    providerStatuses: [synthesizedStatus(context.providerId, retrievedAt, activities.length, context, { linkOnly: input.linkOnly })],
  };
}

export function normalizeAdapterSnapshot(input, context = {}) {
  if (!input || typeof input !== 'object') throw schemaInvalid();
  if (Object.hasOwn(input, 'entities')) return normalizeCanonicalAggregate(input, context);
  if (Object.hasOwn(input, 'performances') && Object.hasOwn(input, 'providerId')) return normalizeVenueEnvelope(input, context);
  if (Object.hasOwn(input, 'records') && Object.hasOwn(input, 'statuses')) return normalizeInstitutionalEnvelope(input, context);
  if (Object.hasOwn(input, 'filings') && Object.hasOwn(input, 'holdings')) return normalizeSecEnvelope(input, context);
  if (Object.hasOwn(input, 'publications')) return normalizePublicationEnvelope(input, context);
  throw schemaInvalid();
}

export function validateRankings(value, context = {}) {
  assertSafePlainRecord(value, ['investors', 'crypto']);
  assertSafeArray(value.investors);
  assertSafePlainRecord(value.crypto, ['polymarket', 'hyperliquid']);
  assertSafePlainRecord(value.crypto.polymarket, ['month']);
  assertSafePlainRecord(value.crypto.hyperliquid, ['month', 'allTime']);
  for (const rows of [
    value.crypto.polymarket.month,
    value.crypto.hyperliquid.month,
    value.crypto.hyperliquid.allTime,
  ]) assertSafeArray(rows);
  const investors = dedupeByStableId(value.investors.map((entity) => normalizeEntity(entity, context)));
  const normalizeBucket = (rows, providerId, venue, window) => {
    const normalized = dedupeByStableId(rows.map((performance) => normalizePerformance(performance, context)));
    if (normalized.some((performance) => performance.providerId !== providerId
        || performance.venue !== venue || performance.scope !== 'account'
        || performance.windows[window] === null)) throw schemaInvalid();
    const topPerformances = context.topPerformances;
    if (topPerformances !== undefined) {
      assertSafeArray(topPerformances);
      const byId = new Map(topPerformances.map((performance) => [performance.id, performance]));
      if (normalized.some((performance) => {
        const top = byId.get(performance.id);
        return !top || JSON.stringify(top) !== JSON.stringify(performance);
      })) throw schemaInvalid();
    }
    return normalized;
  };
  return {
    investors,
    crypto: {
      polymarket: {
        month: normalizeBucket(value.crypto.polymarket.month, 'polymarket-leaderboard', 'polymarket', 'month'),
      },
      hyperliquid: {
        month: normalizeBucket(value.crypto.hyperliquid.month, 'hyperliquid-leaderboard', 'hyperliquid', 'month'),
        allTime: normalizeBucket(value.crypto.hyperliquid.allTime, 'hyperliquid-leaderboard', 'hyperliquid', 'allTime'),
      },
    },
  };
}

const SNAPSHOT_FIELDS = Object.freeze([
  'schemaVersion', 'ok', 'fetchedAt', 'partial', 'entities', 'activities', 'performances',
  'signals', 'rankings', 'providerStatuses', 'warnings', 'sourceLinks',
]);

export function validateAcceptedSnapshot(value, context = {}) {
  const now = nowFrom(context);
  assertSafePlainRecord(value, SNAPSHOT_FIELDS);
  if (value.schemaVersion !== 1 || value.ok !== true || typeof value.partial !== 'boolean') throw schemaInvalid();
  const fetchedAt = canonicalTimestamp(value.fetchedAt, { now });
  const snapshotNow = new Date(fetchedAt);
  for (const field of ['entities', 'activities', 'performances', 'signals', 'providerStatuses', 'warnings', 'sourceLinks']) {
    assertSafeArray(value[field]);
  }
  const sourceLinks = value.sourceLinks.map((link) => {
    assertSafePlainRecord(link, ['providerId', 'label', 'url']);
    return {
      providerId: safeIdentifier(link.providerId),
      label: stringValue(link.label, { maxLength: 256 }),
      url: httpsUrl(link.url),
    };
  });
  const entities = dedupeByStableId(value.entities.map((entity) => normalizeEntity(entity, { now })));
  const activities = dedupeByStableId(value.activities.map((activity) => normalizeActivity(activity, { now })));
  const performances = dedupeByStableId(value.performances.map((performance) => normalizePerformance(performance, { now })));
  const signals = dedupeByStableId(value.signals.map((signal) => validateSignal(signal, { now })));
  const entityIds = new Set(entities.map((entity) => entity.id));
  if (activities.some((activity) => !entityIds.has(activity.entityId))
      || performances.some((performance) => !entityIds.has(performance.entityId))
      || signals.some((signal) => !entityIds.has(signal.entityId))) throw schemaInvalid();
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  if (signals.some((signal) => {
    const activity = activityById.get(signal.activityId);
    return !activity || activity.entityId !== signal.entityId
      || activity.providerId !== signal.providerId || activity.kind !== signal.kind
      || activity.asset === null
      || activity.asset.ticker !== signal.asset.ticker
      || activity.asset.providerSymbol !== signal.asset.providerSymbol
      || activity.asset.assetClass !== signal.asset.assetClass
      || activity.effectiveAt !== signal.effectiveAt
      || activity.disclosedAt !== signal.disclosedAt
      || activity.observedAt !== signal.observedAt;
  })) throw schemaInvalid();
  return {
    schemaVersion: 1,
    ok: true,
    fetchedAt,
    partial: value.partial,
    entities,
    activities,
    performances,
    signals,
    rankings: validateRankings(value.rankings, { now, topPerformances: performances }),
    providerStatuses: dedupeByStableId(value.providerStatuses.map((status) => {
      assertSafePlainDataRecord(status);
      const policy = getProviderFreshnessPolicy(status?.id);
      if (!policy) throw schemaInvalid();
      return normalizeProviderStatus(status, policy, { now: snapshotNow });
    })),
    warnings: safeStringArray(value.warnings),
    sourceLinks,
  };
}
