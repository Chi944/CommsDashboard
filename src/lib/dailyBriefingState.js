const MARKET_DATE = /^\d{4}-\d{2}-\d{2}$/;

function canonicalMarketDate(value) {
  if (typeof value !== 'string' || !MARKET_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function canonicalInstant(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function briefingStamp(envelope) {
  const marketDate = canonicalMarketDate(envelope?.briefing?.marketDate);
  const generatedAt = canonicalInstant(envelope?.briefing?.generatedAt);
  return marketDate && generatedAt ? { marketDate, generatedAt } : null;
}

export function isValidDailyBriefingEnvelope(value) {
  const stamp = briefingStamp(value);
  const paragraphs = value?.briefing?.paragraphs;
  if (!stamp || !Array.isArray(paragraphs) || paragraphs.length !== 3) return false;
  const suppliedEvidence = Array.isArray(value?.briefing?.evidence)
    ? value.briefing.evidence
    : (Array.isArray(value?.evidence) ? value.evidence : null);
  if (!suppliedEvidence || suppliedEvidence.length === 0) return false;
  const evidenceById = new Map();
  for (const record of suppliedEvidence) {
    if (!record || typeof record !== 'object'
        || typeof record.id !== 'string' || !record.id.trim()
        || evidenceById.has(record.id)) return false;
    evidenceById.set(record.id, record);
  }
  const ids = new Set();
  for (const paragraph of paragraphs) {
    if (!paragraph || typeof paragraph !== 'object'
        || typeof paragraph.id !== 'string' || !paragraph.id.trim()
        || ids.has(paragraph.id)
        || typeof paragraph.text !== 'string' || !paragraph.text.trim()
        || !Array.isArray(paragraph.evidenceIds)
        || paragraph.evidenceIds.length === 0
        || new Set(paragraph.evidenceIds).size !== paragraph.evidenceIds.length
        || paragraph.evidenceIds.some((evidenceId) => (
          typeof evidenceId !== 'string' || !evidenceId.trim()
          || !evidenceById.has(evidenceId)
        ))) return false;
    ids.add(paragraph.id);
  }
  return true;
}

function isNewer(current, candidate) {
  if (!isValidDailyBriefingEnvelope(candidate)) return false;
  if (!isValidDailyBriefingEnvelope(current)) return true;
  const currentStamp = briefingStamp(current);
  const candidateStamp = briefingStamp(candidate);
  return candidateStamp.marketDate > currentStamp.marketDate
    || (candidateStamp.marketDate === currentStamp.marketDate
      && candidateStamp.generatedAt > currentStamp.generatedAt);
}

export function createDailyBriefingState(accepted = null) {
  return {
    accepted: isValidDailyBriefingEnvelope(accepted) ? accepted : null,
    latestRequestId: 0,
    loading: false,
    error: null,
  };
}

function safeError(value) {
  const message = String(value?.message ?? value ?? 'Briefing refresh failed.')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return message || 'Briefing refresh failed.';
}

export function dailyBriefingReducer(state, action) {
  if (!state || typeof state !== 'object' || !action || typeof action !== 'object') {
    return createDailyBriefingState();
  }
  const requestId = Number(action.requestId);
  if (!Number.isSafeInteger(requestId) || requestId < 1) return state;
  if (action.type === 'request') {
    if (requestId <= state.latestRequestId) return state;
    return {
      ...state,
      latestRequestId: requestId,
      loading: true,
      error: null,
    };
  }
  if (requestId !== state.latestRequestId) return state;
  if (action.type === 'success') {
    return {
      ...state,
      accepted: isNewer(state.accepted, action.candidate)
        ? action.candidate
        : state.accepted,
      loading: false,
      error: isValidDailyBriefingEnvelope(action.candidate)
        ? null
        : 'Briefing response was invalid.',
    };
  }
  if (action.type === 'failure') {
    return {
      ...state,
      loading: false,
      error: safeError(action.error),
    };
  }
  return state;
}
