export const RESEARCH_ONLY_CAPABILITY = Object.freeze({
  schemaVersion: 1,
  status: 'research_only',
  reason: 'no_rights_cleared_price_source',
  transactionsEnabled: false,
  enabledEntryPriceSources: Object.freeze([]),
  enabledDailyMarkSources: Object.freeze([]),
  effectiveAt: null,
});

export const SMART_MONEY_ENTITY = Object.freeze({
  id: 'situational-awareness-lp',
  displayName: 'Situational Awareness LP',
  legalEntity: 'Situational Awareness LP',
  actorType: 'firm',
  directoryCategory: 'firms',
  strategyTags: ['AI', 'public-disclosures'],
  people: ['Leopold Aschenbrenner'],
  relatedEntityIds: ['leopold-aschenbrenner'],
  officialUrls: ['https://situational-awareness.ai/', 'https://www.sec.gov/edgar/browse/?CIK=2045724'],
  identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: '2026-08-26T00:00:00.000Z' },
  evidenceCoverage: 'sec-filings-and-official-links',
  performanceVerification: { status: 'not_publicly_verified' },
});

const STATUS = Object.freeze({
  id: 'sec-edgar', group: 'sec', enabled: true, status: 'live',
  lastAttemptAt: '2026-08-27T00:00:00.000Z',
  lastSuccessAt: '2026-08-27T00:00:00.000Z',
  sourceAsOf: '2026-06-30T00:00:00.000Z',
  retrievedAt: '2026-08-27T00:00:00.000Z',
  freshnessBasis: 'retrieval_time', recordCount: 1, cacheAgeSeconds: 0, errorCode: null,
});

export const SMART_MONEY_RESPONSE = Object.freeze({
  schemaVersion: 1,
  ok: true,
  fetchedAt: '2026-08-27T00:00:00.000Z',
  partial: false,
  entities: [SMART_MONEY_ENTITY],
  activities: [],
  performances: [],
  signals: [],
  rankings: {
    investors: [SMART_MONEY_ENTITY],
    crypto: {
      polymarket: { month: [] },
      hyperliquid: { month: [], allTime: [] },
    },
  },
  providerStatuses: [STATUS],
  warnings: [],
  sourceLinks: [{
    providerId: 'sec-edgar', label: 'SEC EDGAR',
    url: 'https://data.sec.gov/submissions/CIK0002045724.json',
  }],
  simulationCapability: RESEARCH_ONLY_CAPABILITY,
});

export const SMART_MONEY_BRIEFING_RESPONSE = Object.freeze({
  schemaVersion: 1,
  ok: true,
  generatedAt: '2026-08-27T00:05:00.000Z',
  briefing: {
    marketDate: '2026-08-27',
    generatedAt: '2026-08-27T00:05:00.000Z',
    source: 'deterministic',
    paragraphs: [
      { id: 'market-regime', text: 'Current market evidence is reported independently from disclosure coverage.', evidenceIds: ['sec-edgar'] },
      { id: 'investor-disclosures', text: 'No material new investor or firm disclosure was found in the accepted snapshot.', evidenceIds: ['sec-edgar'] },
      { id: 'crypto-paper-risk', text: 'Simulation remains research-only; no transaction was prepared or executed.', evidenceIds: ['sec-edgar'] },
    ],
    text: 'Current market evidence is reported independently from disclosure coverage.\n\nNo material new investor or firm disclosure was found in the accepted snapshot.\n\nSimulation remains research-only; no transaction was prepared or executed.',
  },
  evidence: [{ id: 'sec-edgar', label: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/' }],
});

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
