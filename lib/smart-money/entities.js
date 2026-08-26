import { canUseSourceFor } from './rights.js';

const REVIEWED_AT = '2026-08-26T00:00:00.000Z';
const ENABLED_PURPOSES = Object.freeze([
  'fetch', 'cache', 'history', 'display', 'ranking', 'briefing', 'paper', 'attribute',
]);

const ENTITY_REGISTRY = Object.freeze([
  {
    id: 'leopold-aschenbrenner', displayName: 'Leopold Aschenbrenner', legalEntity: 'Leopold Aschenbrenner', actorType: 'person', directoryCategory: 'investors',
    strategyTags: ['AI', 'macro'], people: ['Leopold Aschenbrenner'], relatedEntityIds: ['situational-awareness-lp'], officialUrls: ['https://www.forourposterity.com/'],
    identity: { status: 'official', confidence: 'high', provider: 'official-site', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-profile-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'situational-awareness-lp', displayName: 'Situational Awareness LP', legalEntity: 'Situational Awareness LP', actorType: 'firm', directoryCategory: 'firms',
    strategyTags: ['AI', 'public-disclosures'], people: ['Leopold Aschenbrenner'], relatedEntityIds: ['leopold-aschenbrenner'], officialUrls: ['https://situational-awareness.ai/', 'https://www.sec.gov/edgar/browse/?CIK=2045724'],
    identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'sec-filings-and-official-links', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'warren-buffett', displayName: 'Warren Buffett', legalEntity: 'Warren Buffett', actorType: 'person', directoryCategory: 'investors',
    strategyTags: ['value', 'equities'], people: ['Warren Buffett'], relatedEntityIds: ['berkshire-hathaway'], officialUrls: ['https://www.berkshirehathaway.com/letters/letters.html'],
    identity: { status: 'official', confidence: 'high', provider: 'Berkshire Hathaway', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-letter-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'berkshire-hathaway', displayName: 'Berkshire Hathaway', legalEntity: 'Berkshire Hathaway Inc.', actorType: 'firm', directoryCategory: 'firms',
    strategyTags: ['value', 'equities'], people: ['Warren Buffett'], relatedEntityIds: ['warren-buffett'], officialUrls: ['https://www.berkshirehathaway.com/letters/letters.html'],
    identity: { status: 'official', confidence: 'high', provider: 'Berkshire Hathaway', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-letter-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'bill-ackman', displayName: 'Bill Ackman', legalEntity: 'William A. Ackman', actorType: 'person', directoryCategory: 'investors',
    strategyTags: ['activist', 'equities'], people: ['Bill Ackman'], relatedEntityIds: ['pershing-square'], officialUrls: ['https://pershingsquareholdings.com/performance/nav/'],
    identity: { status: 'official', confidence: 'high', provider: 'Pershing Square', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-performance-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'pershing-square', displayName: 'Pershing Square', legalEntity: 'Pershing Square Holdings, Ltd.', actorType: 'firm', directoryCategory: 'firms',
    strategyTags: ['activist', 'equities'], people: ['Bill Ackman'], relatedEntityIds: ['bill-ackman'], officialUrls: ['https://pershingsquareholdings.com/performance/nav/'],
    identity: { status: 'official', confidence: 'high', provider: 'Pershing Square', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-performance-link-only', performanceVerification: { status: 'official_reported' },
  },
  {
    id: 'terry-smith', displayName: 'Terry Smith', legalEntity: 'Terry Smith', actorType: 'person', directoryCategory: 'investors',
    strategyTags: ['quality', 'equities'], people: ['Terry Smith'], relatedEntityIds: ['fundsmith'], officialUrls: ['https://www.fundsmith.co.uk/documents'],
    identity: { status: 'official', confidence: 'high', provider: 'Fundsmith', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-document-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'fundsmith', displayName: 'Fundsmith', legalEntity: 'Fundsmith LLP', actorType: 'firm', directoryCategory: 'firms',
    strategyTags: ['quality', 'equities'], people: ['Terry Smith'], relatedEntityIds: ['terry-smith'], officialUrls: ['https://www.fundsmith.co.uk/documents'],
    identity: { status: 'official', confidence: 'high', provider: 'Fundsmith', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-document-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'howard-marks', displayName: 'Howard Marks', legalEntity: 'Howard Marks', actorType: 'person', directoryCategory: 'investors',
    strategyTags: ['credit', 'risk'], people: ['Howard Marks'], relatedEntityIds: ['oaktree-capital'], officialUrls: ['https://www.oaktreecapital.com/insights'],
    identity: { status: 'official', confidence: 'high', provider: 'Oaktree Capital', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-insights-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'oaktree-capital', displayName: 'Oaktree Capital', legalEntity: 'Oaktree Capital Management, L.P.', actorType: 'firm', directoryCategory: 'firms',
    strategyTags: ['credit', 'risk'], people: ['Howard Marks'], relatedEntityIds: ['howard-marks'], officialUrls: ['https://www.oaktreecapital.com/insights'],
    identity: { status: 'official', confidence: 'high', provider: 'Oaktree Capital', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-insights-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'cathie-wood', displayName: 'Cathie Wood', legalEntity: 'Cathie Wood', actorType: 'person', directoryCategory: 'investors',
    strategyTags: ['innovation', 'equities'], people: ['Cathie Wood'], relatedEntityIds: ['ark-invest'], officialUrls: ['https://www.ark-funds.com/ark-trade-notifications'],
    identity: { status: 'official', confidence: 'high', provider: 'ARK Invest', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-publication-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'ark-invest', displayName: 'ARK Invest', legalEntity: 'ARK Investment Management LLC', actorType: 'firm', directoryCategory: 'firms',
    strategyTags: ['innovation', 'equities'], people: ['Cathie Wood'], relatedEntityIds: ['cathie-wood'], officialUrls: ['https://www.ark-funds.com/ark-trade-notifications'],
    identity: { status: 'official', confidence: 'high', provider: 'ARK Invest', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'official-publication-link-only', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'strategy', displayName: 'Strategy', legalEntity: 'Strategy Inc.', actorType: 'firm', directoryCategory: 'institutional-flows',
    strategyTags: ['bitcoin-treasury'], people: [], relatedEntityIds: [], officialUrls: ['https://www.sec.gov/edgar/browse/?CIK=1050446'],
    identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'sec-filings', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'tesla', displayName: 'Tesla', legalEntity: 'Tesla, Inc.', actorType: 'firm', directoryCategory: 'institutional-flows',
    strategyTags: ['bitcoin-treasury'], people: [], relatedEntityIds: [], officialUrls: ['https://www.sec.gov/edgar/browse/?CIK=1318605'],
    identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'sec-filings', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'blackrock-ibit', displayName: 'iShares Bitcoin Trust', legalEntity: 'iShares Bitcoin Trust ETF', actorType: 'fund', directoryCategory: 'institutional-flows',
    strategyTags: ['bitcoin-etf'], people: [], relatedEntityIds: [], officialUrls: ['https://www.sec.gov/edgar/browse/?CIK=1980994'],
    identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'sec-filings', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'fidelity-fbtc', displayName: 'Fidelity Wise Origin Bitcoin Fund', legalEntity: 'Fidelity Wise Origin Bitcoin Fund', actorType: 'fund', directoryCategory: 'institutional-flows',
    strategyTags: ['bitcoin-etf'], people: [], relatedEntityIds: [], officialUrls: ['https://www.sec.gov/edgar/browse/?CIK=1852317'],
    identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'sec-filings', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'ark-21shares-arkb', displayName: 'ARK 21Shares Bitcoin ETF', legalEntity: 'ARK 21Shares Bitcoin ETF', actorType: 'fund', directoryCategory: 'institutional-flows',
    strategyTags: ['bitcoin-etf'], people: [], relatedEntityIds: [], officialUrls: ['https://www.sec.gov/edgar/browse/?CIK=1869699'],
    identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'sec-filings', performanceVerification: { status: 'not_publicly_verified' },
  },
  {
    id: 'bitwise-bitb', displayName: 'Bitwise Bitcoin ETF', legalEntity: 'Bitwise Bitcoin ETF Trust', actorType: 'fund', directoryCategory: 'institutional-flows',
    strategyTags: ['bitcoin-etf'], people: [], relatedEntityIds: [], officialUrls: ['https://www.sec.gov/edgar/browse/?CIK=1763415'],
    identity: { status: 'official', confidence: 'high', provider: 'SEC EDGAR', lastVerifiedAt: REVIEWED_AT }, evidenceCoverage: 'sec-filings', performanceVerification: { status: 'not_publicly_verified' },
  },
]);

const ADAPTER_CONFIGS = Object.freeze([
  { id: 'sec-edgar', rightsId: 'sec-edgar', requiredPurposes: ENABLED_PURPOSES },
  { id: 'strategy-disclosures', rightsId: 'strategy-disclosures', requiredPurposes: ENABLED_PURPOSES },
  { id: 'tesla-disclosures', rightsId: 'tesla-disclosures', requiredPurposes: ENABLED_PURPOSES },
  { id: 'ibit-disclosures', rightsId: 'ibit-disclosures', requiredPurposes: ENABLED_PURPOSES },
  { id: 'fbtc-disclosures', rightsId: 'fbtc-disclosures', requiredPurposes: ENABLED_PURPOSES },
  { id: 'arkb-disclosures', rightsId: 'arkb-disclosures', requiredPurposes: ENABLED_PURPOSES },
  { id: 'bitb-disclosures', rightsId: 'bitb-disclosures', requiredPurposes: ENABLED_PURPOSES },
]);

function copy(value) {
  return structuredClone(value);
}

export function listEntities() {
  return copy(ENTITY_REGISTRY);
}

export function getEntity(entityId) {
  const entity = ENTITY_REGISTRY.find((item) => item.id === entityId);
  return entity ? copy(entity) : undefined;
}

export function listConfiguredAdapters({ now = new Date() } = {}) {
  return ADAPTER_CONFIGS
    .filter((adapter) => adapter.requiredPurposes.every((purpose) => canUseSourceFor(adapter.rightsId, purpose, undefined, { now })))
    .map(copy);
}
