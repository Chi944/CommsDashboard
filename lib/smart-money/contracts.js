const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export const ACTIVITY_KINDS = Object.freeze([
  'filing', 'statement', 'holding_change', 'position_change', 'rank_change', 'transfer', 'performance',
]);
export const SIGNAL_ACTIONS = Object.freeze(['open', 'increase', 'reduce', 'close', 'reverse', 'observe']);
export const ASSET_CLASSES = Object.freeze(['equity', 'crypto', 'fund', 'prediction-market', 'other']);
export const DIRECTIONS = Object.freeze(['long', 'short']);
export const FRESHNESS_VALUES = Object.freeze(['fresh', 'stale']);
export const TRUSTED_REFERENCE_PRICE_SOURCES = Object.freeze(['yahoo', 'coingecko']);
export const INSTITUTIONAL_PROVIDER_ENTITY_IDS = Object.freeze({
  'institutional-strategy': 'strategy',
  'institutional-tesla': 'tesla',
  'institutional-ibit': 'blackrock-ibit',
  'institutional-fbtc': 'fidelity-fbtc',
  'institutional-arkb': 'ark-21shares-arkb',
  'institutional-bitb': 'bitwise-bitb',
});

export function schemaInvalid() {
  const error = new TypeError('schema_invalid');
  error.code = 'schema_invalid';
  return error;
}

export function assertSafePlainRecord(value, allowedFields, requiredFields = allowedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw schemaInvalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw schemaInvalid();
  if (Object.getOwnPropertySymbols(value).length > 0) throw schemaInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedFields.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw schemaInvalid();
    }
  }
  if (!requiredFields.every((field) => Object.hasOwn(descriptors, field))) throw schemaInvalid();
  return value;
}

export function assertSafeArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length > 0) throw schemaInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== value.length) throw schemaInvalid();
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || descriptor.writable !== true
        || descriptor.configurable !== true || !Object.hasOwn(descriptor, 'value')) throw schemaInvalid();
  }
  return value;
}

export function assertSafePlainDataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw schemaInvalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw schemaInvalid();
  if (Object.getOwnPropertySymbols(value).length > 0) throw schemaInvalid();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw schemaInvalid();
  }
  return value;
}

export function safeIdentifier(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512
      || /[\u0000-\u001f]/.test(value)
      || /(^|[:./-])(?:__proto__|prototype|constructor)(?:$|[:./-])/i.test(value)) {
    throw schemaInvalid();
  }
  return value;
}

export function finiteNumber(value, { nullable = false, nonnegative = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER
      || (nonnegative && value < 0)) throw schemaInvalid();
  return value;
}

export function canonicalTimestamp(value, { nullable = false, now = new Date() } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw schemaInvalid();
  const parsed = new Date(value);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(parsed.getTime()) || !Number.isFinite(nowDate.getTime())
      || parsed.getTime() > nowDate.getTime() + MAX_FUTURE_SKEW_MS) throw schemaInvalid();
  return parsed.toISOString();
}

export function enumValue(value, allowed, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!allowed.includes(value)) throw schemaInvalid();
  return value;
}

export function stringValue(value, { nullable = false, maxLength = 2_000 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || /\u0000/.test(value)) throw schemaInvalid();
  return value;
}

export function httpsUrl(value, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  let url;
  try { url = new URL(value); } catch { throw schemaInvalid(); }
  if (url.protocol !== 'https:' || url.username || url.password) throw schemaInvalid();
  return url.toString();
}

export function normalizeAsset(value) {
  assertSafePlainRecord(value, ['ticker', 'name', 'providerSymbol', 'assetClass', 'supported']);
  const ticker = value.ticker === null ? null : stringValue(value.ticker, { maxLength: 32 }).toUpperCase();
  const providerSymbol = value.providerSymbol === null
    ? null : stringValue(value.providerSymbol, { maxLength: 64 });
  if (typeof value.supported !== 'boolean' || (value.supported && ticker === null)) throw schemaInvalid();
  return {
    ticker,
    name: stringValue(value.name, { maxLength: 256 }),
    providerSymbol,
    assetClass: enumValue(value.assetClass, ASSET_CLASSES),
    supported: value.supported,
  };
}

function normalizeEligibility(value, kind) {
  assertSafePlainRecord(value, ['eligible', 'reason']);
  if (typeof value.eligible !== 'boolean') throw schemaInvalid();
  const reason = stringValue(value.reason, { maxLength: 100 });
  const reasons = kind === 'paper'
    ? ['supported_reference_price', 'unsupported_asset', 'research_only', 'missing_position_change', 'provider_research_only', 'missing_reference_price', 'stale_source']
    : ['material_confirmed_change', 'material_change', 'new_evidence', 'stale_source'];
  if (!reasons.includes(reason)) throw schemaInvalid();
  if (kind === 'notification' && value.eligible !== (reason !== 'stale_source')) throw schemaInvalid();
  if (kind === 'paper' && value.eligible !== (reason === 'supported_reference_price')) throw schemaInvalid();
  return { eligible: value.eligible, reason };
}

export function normalizeReferencePrice(value, asset, now) {
  if (value === null) return null;
  assertSafePlainRecord(value, ['ticker', 'price', 'currency', 'source', 'asOf', 'retrievedAt']);
  const ticker = stringValue(value.ticker, { maxLength: 32 }).toUpperCase();
  if (ticker !== asset.ticker) throw schemaInvalid();
  const price = finiteNumber(value.price, { nonnegative: true });
  const currency = stringValue(value.currency, { maxLength: 12 }).toUpperCase();
  const source = stringValue(value.source, { maxLength: 100 });
  const asOf = canonicalTimestamp(value.asOf, { now });
  const retrievedAt = canonicalTimestamp(value.retrievedAt, { now });
  if (price <= 0 || currency !== 'USD' || !TRUSTED_REFERENCE_PRICE_SOURCES.includes(source)
      || Date.parse(retrievedAt) < Date.parse(asOf)) throw schemaInvalid();
  return {
    ticker,
    price,
    currency,
    source,
    asOf,
    retrievedAt,
  };
}

function normalizePositionChange(value) {
  if (value === null) return null;
  assertSafePlainRecord(value, ['previousNotionalUsd', 'currentNotionalUsd', 'deltaNotionalUsd']);
  const previousNotionalUsd = finiteNumber(value.previousNotionalUsd);
  const currentNotionalUsd = finiteNumber(value.currentNotionalUsd);
  const deltaNotionalUsd = finiteNumber(value.deltaNotionalUsd);
  if (currentNotionalUsd - previousNotionalUsd !== deltaNotionalUsd) throw schemaInvalid();
  return { previousNotionalUsd, currentNotionalUsd, deltaNotionalUsd };
}

export function assertKnownInstitutionalProvider(providerId) {
  if (typeof providerId === 'string' && providerId.startsWith('institutional-')
      && !Object.hasOwn(INSTITUTIONAL_PROVIDER_ENTITY_IDS, providerId)) throw schemaInvalid();
  return providerId;
}

export function assertProviderEntity(providerId, entityId) {
  assertKnownInstitutionalProvider(providerId);
  if (Object.hasOwn(INSTITUTIONAL_PROVIDER_ENTITY_IDS, providerId)
      && INSTITUTIONAL_PROVIDER_ENTITY_IDS[providerId] !== entityId) throw schemaInvalid();
  if (providerId.startsWith('hyperliquid-') && !entityId.startsWith('hyperliquid:')) throw schemaInvalid();
  if (providerId.startsWith('polymarket-') && !entityId.startsWith('polymarket:')) throw schemaInvalid();
  if (providerId === 'sec-edgar' && entityId !== 'situational-awareness-lp') throw schemaInvalid();
}

const SIGNAL_FIELDS = Object.freeze([
  'id', 'entityId', 'activityId', 'kind', 'action', 'asset', 'direction', 'magnitude',
  'positionChange', 'effectiveAt', 'disclosedAt', 'observedAt', 'delaySeconds', 'providerId',
  'sourceUrl', 'sourceGrade', 'identityStatus', 'confidence', 'thresholdVersion',
  'notificationEligibility', 'paperEligibility', 'referencePrice', 'freshness',
]);

export function validateSignal(value, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  assertSafePlainRecord(value, SIGNAL_FIELDS);
  const asset = normalizeAsset(value.asset);
  const action = enumValue(value.action, SIGNAL_ACTIONS);
  const positionChange = normalizePositionChange(value.positionChange);
  assertSafePlainRecord(value.magnitude, ['value', 'unit']);
  const magnitude = {
    value: finiteNumber(value.magnitude.value, { nonnegative: true }),
    unit: stringValue(value.magnitude.unit, { maxLength: 64 }),
  };
  const notificationEligibility = normalizeEligibility(value.notificationEligibility, 'notification');
  const paperEligibility = normalizeEligibility(value.paperEligibility, 'paper');
  const referencePrice = normalizeReferencePrice(value.referencePrice, asset, now);
  const freshness = enumValue(value.freshness, FRESHNESS_VALUES);
  if (positionChange !== null) {
    const previous = positionChange.previousNotionalUsd;
    const current = positionChange.currentNotionalUsd;
    const expectedAction = previous === 0 && current !== 0 ? 'open'
      : previous !== 0 && current === 0 ? 'close'
        : Math.sign(previous) !== Math.sign(current) ? 'reverse'
          : Math.abs(current) > Math.abs(previous) ? 'increase'
            : Math.abs(current) < Math.abs(previous) ? 'reduce' : null;
    if (expectedAction === null || action !== expectedAction
        || magnitude.unit !== 'usd_notional'
        || magnitude.value !== Math.abs(positionChange.deltaNotionalUsd)
        || !DIRECTIONS.includes(value.direction)) throw schemaInvalid();
  }
  if (paperEligibility.eligible && (action === 'observe' || positionChange === null
      || !asset.supported || referencePrice === null)) throw schemaInvalid();
  if (action === 'observe' && (positionChange !== null
      || (freshness === 'fresh' && !['research_only', 'unsupported_asset'].includes(paperEligibility.reason)))) throw schemaInvalid();
  if (freshness === 'fresh' && !asset.supported && paperEligibility.reason !== 'unsupported_asset') throw schemaInvalid();
  const providerId = safeIdentifier(value.providerId);
  const entityId = safeIdentifier(value.entityId);
  assertProviderEntity(providerId, entityId);
  const effectiveAt = canonicalTimestamp(value.effectiveAt, { now });
  const disclosedAt = canonicalTimestamp(value.disclosedAt, { nullable: true, now });
  const observedAt = canonicalTimestamp(value.observedAt, { now });
  const delaySeconds = finiteNumber(value.delaySeconds, { nonnegative: true });
  const delayAt = ['filing', 'holding_change'].includes(value.kind) && disclosedAt !== null ? disclosedAt : observedAt;
  if (Date.parse(observedAt) < Date.parse(delayAt)
      || (Date.parse(delayAt) - Date.parse(effectiveAt)) / 1000 !== delaySeconds) throw schemaInvalid();
  if (freshness === 'stale' && (notificationEligibility.eligible || paperEligibility.eligible
      || notificationEligibility.reason !== 'stale_source' || paperEligibility.reason !== 'stale_source')) throw schemaInvalid();
  if (freshness === 'fresh' && (notificationEligibility.reason === 'stale_source'
      || paperEligibility.reason === 'stale_source')) throw schemaInvalid();
  if (paperEligibility.eligible && Date.parse(referencePrice.asOf) < Date.parse(observedAt)) throw schemaInvalid();
  return {
    id: safeIdentifier(value.id),
    entityId,
    activityId: safeIdentifier(value.activityId),
    kind: enumValue(value.kind, ACTIVITY_KINDS),
    action,
    asset,
    direction: enumValue(value.direction, DIRECTIONS, { nullable: true }),
    magnitude,
    positionChange,
    effectiveAt,
    disclosedAt,
    observedAt,
    delaySeconds,
    providerId,
    sourceUrl: httpsUrl(value.sourceUrl),
    sourceGrade: stringValue(value.sourceGrade, { maxLength: 100 }),
    identityStatus: enumValue(value.identityStatus, ['verified', 'anonymous', 'unverified']),
    confidence: enumValue(value.confidence, ['high', 'medium', 'low']),
    thresholdVersion: value.thresholdVersion === 'smart-money-v1' ? value.thresholdVersion : (() => { throw schemaInvalid(); })(),
    notificationEligibility,
    paperEligibility,
    referencePrice,
    freshness,
  };
}
