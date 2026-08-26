import sourceRights from '../../config/smart-money-source-rights.json' with { type: 'json' };

const PURPOSE_PERMISSION = Object.freeze({
  fetch: 'serverRetrieval',
  cache: 'temporaryCaching',
  history: 'durableHistoricalCaching',
  display: 'publicDisplay',
  ranking: 'derivedMetrics',
  briefing: 'derivedMetrics',
  paper: 'derivedMetrics',
  attribute: 'attribution',
});

const REQUIRED_PERMISSION_KEYS = Object.freeze([
  'serverRetrieval',
  'temporaryCaching',
  'durableHistoricalCaching',
  'publicDisplay',
  'derivedMetrics',
  'attribution',
]);
const PERMISSION_VALUES = new Set(['allowed', 'prohibited', 'unclear']);
const DECISIONS = new Set(['enable', 'link-only', 'exclude']);
const UNUSABLE_METADATA_VALUES = new Set(['unclear', 'unknown', 'unspecified', 'n/a', 'na', 'none', 'tbd']);
const REQUIRED_RIGHTS_FIELDS = Object.freeze([
  'id', 'provider', 'endpoint', 'fieldsUsed', 'termsUrl', 'evidenceUrls',
  'attribution', 'retention', 'checkedAt', 'reviewDueAt', 'decision', 'cost',
]);
const SEC_ENDPOINT_TEMPLATES = Object.freeze([
  'https://data.sec.gov/submissions/CIK{cik10}.json',
  'https://www.sec.gov/Archives/edgar/data/{registrantCik}/{accessionNoDashes}/index.json',
  'https://www.sec.gov/Archives/edgar/data/{registrantCik}/{accessionNoDashes}/{informationTableDocument}',
]);
const SEC_FIELDS_USED = Object.freeze([
  'submissions.cik', 'submissions.accessionNumber', 'submissions.filingDate',
  'submissions.reportDate', 'submissions.form', 'submissions.primaryDocument',
  'archiveIndex.directory.item.name',
  'informationTable.nameOfIssuer', 'informationTable.titleOfClass',
  'informationTable.cusip', 'informationTable.value',
  'informationTable.shrsOrPrnAmt.sshPrnamt',
  'informationTable.shrsOrPrnAmt.sshPrnamtType', 'informationTable.putCall',
  'filing.cik', 'filing.form', 'filing.accessionNumber', 'filing.periodEnd',
  'filing.filedAt', 'filing.isAmendment', 'filing.amendmentChain',
  'filing.primaryDocument', 'filing.timingBasis',
  'holding.accessionNumber', 'holding.periodEnd', 'holding.filedAt',
  'holding.isAmendment', 'holding.amendmentChain', 'holding.issuer',
  'holding.securityClass', 'holding.cusip', 'holding.ticker',
  'holding.reportedValue', 'holding.shares', 'holding.putCall',
  'holding.shareType', 'holding.paperEligible',
]);
const SEC_SUBMISSIONS_ENDPOINT = 'https://data.sec.gov/submissions/CIK0002045724.json';
const HYPERLIQUID_LEADERBOARD_ENDPOINT = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

export const SOURCE_RIGHTS = Object.freeze(sourceRights.map((record) => Object.freeze(record)));

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function hasMeaningfulMetadata(value) {
  return hasText(value) && !UNUSABLE_METADATA_VALUES.has(value.trim().toLowerCase());
}

function hasUrl(value) {
  try {
    return hasText(value) && ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isValidReviewDate(value) {
  if (!hasText(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function exactStringArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

export function validateRightsMatrix(matrix, { now = new Date() } = {}) {
  const errors = [];
  const ids = new Set();
  if (!Array.isArray(matrix)) return { ok: false, errors: ['invalid_matrix'] };

  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) return { ok: false, errors: ['invalid_now'] };

  for (const record of matrix) {
    const id = String(record?.id);
    if (!record || typeof record !== 'object' || !hasText(record.id) || ids.has(record.id)) {
      errors.push('duplicate_or_missing_id');
    }
    ids.add(record?.id);
    for (const field of REQUIRED_RIGHTS_FIELDS) {
      if (record?.[field] == null || record[field] === '') errors.push(`${id}:missing_${field}`);
    }
    for (const field of ['provider', 'attribution', 'retention']) {
      if (!hasMeaningfulMetadata(record?.[field])) errors.push(`${id}:invalid_${field}`);
    }
    if (!Array.isArray(record?.fieldsUsed) || record.fieldsUsed.length === 0
        || !record.fieldsUsed.every(hasText)
        || !Array.isArray(record?.evidenceUrls) || record.evidenceUrls.length === 0
        || !record.evidenceUrls.every(hasUrl)) {
      errors.push(`${id}:missing_review_evidence`);
    }
    if (!hasUrl(record?.endpoint)) errors.push(`${id}:invalid_endpoint`);
    if (!hasUrl(record?.termsUrl)) errors.push(`${id}:invalid_terms_url`);
    if (record?.id === 'sec-edgar') {
      if (record.endpoint !== SEC_SUBMISSIONS_ENDPOINT) errors.push(`${id}:invalid_endpoint`);
      if (!exactStringArray(record.endpointTemplates, SEC_ENDPOINT_TEMPLATES)) {
        errors.push(`${id}:invalid_endpoint_templates`);
      }
      if (!exactStringArray(record.fieldsUsed, SEC_FIELDS_USED)) {
        errors.push(`${id}:invalid_fields_used`);
      }
    }
    if (record?.id === 'hyperliquid-stats-api'
        && record.endpoint !== HYPERLIQUID_LEADERBOARD_ENDPOINT) {
      errors.push(`${id}:invalid_endpoint`);
    }

    const checkedAt = isValidReviewDate(record?.checkedAt)
      ? Date.parse(`${record.checkedAt}T00:00:00.000Z`)
      : Number.NaN;
    const reviewDueAt = isValidReviewDate(record?.reviewDueAt)
      ? Date.parse(`${record.reviewDueAt}T00:00:00.000Z`)
      : Number.NaN;
    if (!Number.isFinite(checkedAt) || !Number.isFinite(reviewDueAt) || reviewDueAt < checkedAt) {
      errors.push(`${id}:invalid_review_dates`);
    } else if (reviewDueAt < nowMs) {
      errors.push(`${id}:review_expired`);
    }
    if (!DECISIONS.has(record?.decision)) errors.push(`${id}:invalid_decision`);
    for (const key of REQUIRED_PERMISSION_KEYS) {
      if (!Object.hasOwn(record?.permissions || {}, key)
          || !PERMISSION_VALUES.has(record.permissions[key])) {
        errors.push(`${id}:invalid_or_missing_${key}`);
      }
    }
    if (!record?.cost || !['free', 'paid', 'unknown'].includes(record.cost.tier)
        || typeof record.cost.paidCredentialRequired !== 'boolean'
        || !hasUrl(record.cost.evidenceUrl)) {
      errors.push(`${id}:invalid_cost_evidence`);
    }
    if (record?.decision === 'enable') {
      if (record.cost?.tier !== 'free'
          || record.cost?.paidCredentialRequired !== false
          || !hasUrl(record.cost?.evidenceUrl)) {
        errors.push(`${id}:not_verified_free`);
      }
      for (const name of REQUIRED_PERMISSION_KEYS) {
        if (record.permissions?.[name] !== 'allowed') errors.push(`${id}:${name}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function getSourceRight(rightsId, matrix = SOURCE_RIGHTS) {
  return Array.isArray(matrix) ? matrix.find((record) => record?.id === rightsId) : undefined;
}

export function canUseSourceFor(
  sourceId,
  purpose,
  matrix = SOURCE_RIGHTS,
  { now = new Date() } = {},
) {
  const record = getSourceRight(sourceId, matrix);
  const permission = PURPOSE_PERMISSION[purpose];
  return Boolean(
    record
    && validateRightsMatrix([record], { now }).ok
    && record.decision === 'enable'
    && permission
    && record.permissions?.[permission] === 'allowed',
  );
}

export function assertAdapterRights(
  adapterConfigs,
  matrix = SOURCE_RIGHTS,
  { now = new Date() } = {},
) {
  const validation = validateRightsMatrix(matrix, { now });
  if (!validation.ok || !Array.isArray(adapterConfigs)) throw new Error('smart_money_rights_invalid');
  for (const adapter of adapterConfigs) {
    if (!hasText(adapter?.id) || !hasText(adapter?.rightsId)
        || !Array.isArray(adapter.requiredPurposes) || adapter.requiredPurposes.length === 0) {
      throw new Error('smart_money_rights_invalid');
    }
    for (const purpose of adapter.requiredPurposes) {
      if (!canUseSourceFor(adapter.rightsId, purpose, matrix, { now })) {
        throw new Error(`smart_money_source_not_permitted:${adapter.id}`);
      }
    }
  }
}
