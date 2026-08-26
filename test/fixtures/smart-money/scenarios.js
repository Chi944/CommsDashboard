import { buildSmartMoneyPrivateSnapshot } from '../../../lib/smart-money/refresh.js';

const FIRST_OBSERVED_AT = '2026-08-26T10:00:00.000Z';
const SECOND_OBSERVED_AT = '2026-08-26T11:00:00.000Z';

function hyperliquidChange(id, observedAt, overrides = {}) {
  return {
    id,
    sourceStableId: id,
    providerId: 'hyperliquid-account-details',
    entityId: 'hyperliquid:0x0000000000000000000000000000000000000def',
    activityId: `activity:${id}`,
    kind: 'position_change',
    sourceUrl: 'https://app.hyperliquid.xyz/explorer/address/0x0000000000000000000000000000000000000def',
    sourceGrade: 'provider_reported',
    identityStatus: 'anonymous',
    confidence: 'high',
    asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true },
    previousNotionalUsd: 200_000,
    currentNotionalUsd: 350_000,
    previousDirection: 'long',
    currentDirection: 'long',
    accountValueUsd: 1_500_000,
    effectiveAt: observedAt,
    disclosedAt: null,
    observedAt,
    retrievedAt: observedAt,
    acceptedSnapshotId: `snapshot:${observedAt}`,
    freshness: 'fresh',
    lastKnownGood: false,
    referencePrice: {
      ticker: 'BTC', price: 100_000, currency: 'USD', source: 'yahoo',
      asOf: observedAt, retrievedAt: observedAt,
    },
    ...overrides,
  };
}

export const FIRST_CHANGE = Object.freeze({
  scenarioAvailability: 'future_permitted_output',
  changes: [hyperliquidChange('hyperliquid-observation-1', FIRST_OBSERVED_AT)],
  pendingConfirmations: [],
  nowMs: Date.parse(FIRST_OBSERVED_AT),
});

export const SECOND_CHANGE = Object.freeze({
  scenarioAvailability: 'future_permitted_output',
  changes: [hyperliquidChange('hyperliquid-observation-2', SECOND_OBSERVED_AT)],
  pendingConfirmations: [],
  nowMs: Date.parse(SECOND_OBSERVED_AT),
});

export const UNMAPPED_13F_CHANGE = Object.freeze({
  changes: [{
    id: 'sec:0002045724-26-000001:67066G104:increase',
    sourceStableId: '0002045724-26-000001:67066G104',
    providerId: 'sec-edgar',
    entityId: 'situational-awareness-lp',
    activityId: 'activity:sec:0002045724-26-000001:67066G104',
    kind: 'holding_change',
    classification: 'increased',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/2045724/000204572426000001/infotable.xml',
    sourceGrade: 'official_filing',
    identityStatus: 'verified',
    confidence: 'high',
    asset: { ticker: null, name: 'NVIDIA Corporation', providerSymbol: '67066G104', assetClass: 'equity', supported: false },
    cusip: '67066G104',
    previousShares: 1_000,
    currentShares: 1_200,
    reportedValueUsd: 1_500_000,
    effectiveAt: '2026-06-30T00:00:00.000Z',
    disclosedAt: '2026-08-14T00:00:00.000Z',
    observedAt: '2026-08-26T09:00:00.000Z',
    retrievedAt: '2026-08-26T09:00:00.000Z',
    freshness: 'fresh',
    lastKnownGood: false,
    referencePrice: null,
  }],
  pendingConfirmations: [],
  nowMs: Date.parse('2026-08-26T09:00:00.000Z'),
});

const ACCEPTED_ENTITY = {
  id: 'hyperliquid:0x0000000000000000000000000000000000000def',
  displayName: '0x0000…0def', legalEntity: null, actorType: 'venue_account',
  directoryCategory: 'crypto-traders', strategyTags: ['crypto'], people: [], relatedEntityIds: [],
  officialUrls: ['https://app.hyperliquid.xyz/explorer/address/0x0000000000000000000000000000000000000def'],
  identity: { status: 'anonymous', confidence: 'high', provider: 'hyperliquid', verifiedAt: SECOND_OBSERVED_AT },
  evidenceCoverage: ['hyperliquid-leaderboard', 'hyperliquid-account-details'],
  performanceVerification: { status: 'provider_reported' },
  lastCheckedAt: SECOND_OBSERVED_AT,
  caveats: ['Anonymous provider-scoped account; performance is not comparable across providers.'],
};

const ACCEPTED_PERFORMANCE = {
  id: 'hyperliquid:0x0000000000000000000000000000000000000def:month:2026-08-26',
  entityId: ACCEPTED_ENTITY.id, providerId: 'hyperliquid-leaderboard', venue: 'hyperliquid', scope: 'account',
  accountValueUsd: 1_500_000,
  windows: {
    day: null,
    month: { pnlUsd: 20_000, roiPct: 4, volumeUsd: 6_000_000 },
    allTime: { pnlUsd: 100_000, roiPct: 20, volumeUsd: 20_000_000 },
  },
  methodology: 'provider_reported', sourceAsOf: null, retrievedAt: SECOND_OBSERVED_AT,
  freshnessBasis: 'retrieval_time', notComparableAcrossProviders: true,
};

const ACCEPTED_ACTIVITY = {
  id: 'activity:hyperliquid-observation-2', entityId: ACCEPTED_ENTITY.id,
  providerId: 'hyperliquid-account-details', kind: 'position_change',
  sourceStableId: 'hyperliquid-observation-2', sourceUrl: ACCEPTED_ENTITY.officialUrls[0],
  publisher: 'Hyperliquid', sourceGrade: 'provider_reported', identityConfidence: 'high',
  asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true },
  direction: 'long', magnitude: { value: 150_000, unit: 'usd_notional' },
  effectiveAt: SECOND_OBSERVED_AT, disclosedAt: null, observedAt: SECOND_OBSERVED_AT,
  retrievedAt: SECOND_OBSERVED_AT, delaySeconds: 0,
  summary: 'A material BTC position increase was confirmed in two consecutive accepted snapshots.',
  caveats: ['Provider-reported position data.'], freshness: 'fresh',
};

const ACCEPTED_SIGNAL = {
  id: 'hyperliquid-account-details:hyperliquid-observation-2', entityId: ACCEPTED_ENTITY.id,
  activityId: ACCEPTED_ACTIVITY.id, kind: 'position_change', action: 'increase',
  asset: { ticker: 'BTC', name: 'Bitcoin', providerSymbol: 'BTC', assetClass: 'crypto', supported: true },
  direction: 'long', magnitude: { value: 150_000, unit: 'usd_notional' },
  positionChange: { previousNotionalUsd: 200_000, currentNotionalUsd: 350_000, deltaNotionalUsd: 150_000 },
  effectiveAt: SECOND_OBSERVED_AT, disclosedAt: null, observedAt: SECOND_OBSERVED_AT,
  delaySeconds: 0, providerId: 'hyperliquid-account-details', sourceUrl: ACCEPTED_ENTITY.officialUrls[0],
  sourceGrade: 'provider_reported', identityStatus: 'anonymous', confidence: 'high',
  thresholdVersion: 'smart-money-v1',
  notificationEligibility: { eligible: true, reason: 'material_confirmed_change' },
  paperEligibility: { eligible: true, reason: 'supported_reference_price' },
  referencePrice: { ticker: 'BTC', price: 100_000, currency: 'USD', source: 'yahoo', asOf: SECOND_OBSERVED_AT, retrievedAt: SECOND_OBSERVED_AT },
  freshness: 'fresh',
};

const ACCEPTED_STATUS = {
  id: 'hyperliquid-leaderboard', group: 'hyperliquid', enabled: false, status: 'unavailable',
  lastAttemptAt: SECOND_OBSERVED_AT, lastSuccessAt: SECOND_OBSERVED_AT, sourceAsOf: null,
  retrievedAt: SECOND_OBSERVED_AT, freshnessBasis: 'retrieval_time', recordCount: 1,
  cacheAgeSeconds: 0, errorCode: 'rights_gate_failed',
};

export const ACCEPTED_SNAPSHOT = Object.freeze({
  schemaVersion: 1,
  ok: true,
  fetchedAt: '2026-08-26T11:00:00.000Z',
  partial: true,
  entities: [ACCEPTED_ENTITY],
  activities: [ACCEPTED_ACTIVITY],
  performances: [ACCEPTED_PERFORMANCE],
  signals: [ACCEPTED_SIGNAL],
  rankings: {
    investors: [],
    crypto: {
      polymarket: { month: [] },
      hyperliquid: { month: [ACCEPTED_PERFORMANCE], allTime: [ACCEPTED_PERFORMANCE] },
    },
  },
  providerStatuses: [ACCEPTED_STATUS],
  warnings: ['Fixture-only future-permitted Hyperliquid output; not current live source data.'],
  sourceLinks: [{ providerId: 'hyperliquid-leaderboard', label: 'Hyperliquid leaderboard', url: 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard' }],
});

const INSTITUTIONAL_FIXTURES = Object.freeze({
  strategy: { entityId: 'strategy', cik: '1050446', vehicle: 'corporate_bitcoin_treasury' },
  tesla: { entityId: 'tesla', cik: '1318605', vehicle: 'corporate_bitcoin_treasury' },
  ibit: { entityId: 'blackrock-ibit', cik: '1980994', vehicle: 'spot_bitcoin_etf' },
  fbtc: { entityId: 'fidelity-fbtc', cik: '1852317', vehicle: 'spot_bitcoin_etf' },
  arkb: { entityId: 'ark-21shares-arkb', cik: '1869699', vehicle: 'spot_bitcoin_etf' },
  bitb: { entityId: 'bitwise-bitb', cik: '1763415', vehicle: 'spot_bitcoin_etf' },
});

function institutionalFixtureRecord(suffix) {
  const config = INSTITUTIONAL_FIXTURES[suffix];
  const providerId = `institutional-${suffix}`;
  const accessionNumber = `${config.cik.padStart(10, '0')}-26-000001`;
  return {
    id: `${providerId}:${accessionNumber}:2026-06-30`, providerId, entityId: config.entityId,
    vehicle: config.vehicle, reportingDate: '2026-06-30', filedAt: '2026-08-05T00:00:00.000Z',
    btcAmount: 1, reportedValueUsd: 1_000_000,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${config.cik}/${accessionNumber.replace(/-/g, '')}/${suffix}-20260630.htm`,
    methodology: 'sec_filing_reported', sourceAsOf: '2026-06-30T00:00:00.000Z',
    retrievedAt: SECOND_OBSERVED_AT, freshnessBasis: 'reporting_date', paperEligible: false,
  };
}

function secFixtureSnapshot() {
  return {
    filings: [{
      cik: '2045724', form: '13F-HR', accessionNumber: '0002045724-26-000001',
      periodEnd: '2026-06-30', filedAt: '2026-08-14T00:00:00.000Z',
      isAmendment: false, amendmentChain: ['0002045724-26-000001'],
      primaryDocument: 'primary.xml',
    }],
    disclosures: [],
    holdings: [{
      accessionNumber: '0002045724-26-000001', periodEnd: '2026-06-30',
      filedAt: '2026-08-14T00:00:00.000Z', isAmendment: false,
      amendmentChain: ['0002045724-26-000001'], issuer: 'NVIDIA Corporation',
      securityClass: 'COM', cusip: '67066G104', ticker: null,
      reportedValue: 123456, shares: 1000, putCall: null, shareType: 'SH',
      paperEligible: false,
    }],
  };
}

export const DEPS_WITH_ONE_TIMEOUT = Object.freeze({
  adapters: Object.freeze(Object.keys(INSTITUTIONAL_FIXTURES).map((suffix) => Object.freeze({
    id: `institutional-${suffix}`,
    fetch: async () => {
      if (suffix === 'fbtc') throw Object.assign(new Error('fixture timeout'), { code: 'timeout' });
      return {
        providerId: `institutional-${suffix}`,
        records: [institutionalFixtureRecord(suffix)],
        retrievedAt: SECOND_OBSERVED_AT,
      };
    },
  }))),
});

export const ACCEPTED_HISTORY = Object.freeze({
  schemaVersion: 1,
  ok: true,
  fetchedAt: '2026-08-28T12:00:00.000Z',
  partial: false,
  since: '2026-08-25T00:00:00.000Z',
  through: '2026-08-28T12:00:00.000Z',
  entities: [],
  signals: [ACCEPTED_SIGNAL],
  dailyMarks: [{
    id: '2026-08-27:BTC', date: '2026-08-27', ticker: 'BTC',
    assetClass: 'crypto', kind: 'benchmark', price: 101_000, currency: 'USD',
    source: 'coingecko', asOf: '2026-08-27T23:59:59.000Z',
    retrievedAt: '2026-08-27T23:59:59.500Z',
  }],
  nextCursor: null,
  providerStatuses: [],
  warnings: [],
  sourceLinks: [],
});

export const ENABLED_ADAPTER_IDS = Object.freeze([
  'sec-edgar',
  'institutional-strategy',
  'institutional-tesla',
  'institutional-ibit',
  'institutional-fbtc',
  'institutional-arkb',
  'institutional-bitb',
]);

function rightsIdFor(id) {
  return id === 'sec-edgar' ? id : `${id.slice('institutional-'.length)}-disclosures`;
}

function fixtureStatus(id, status = 'live', recordCount = 1) {
  return {
    id,
    group: id === 'sec-edgar' ? 'sec' : 'institutional',
    enabled: true,
    status,
    lastAttemptAt: SECOND_OBSERVED_AT,
    lastSuccessAt: status === 'unavailable' ? SECOND_OBSERVED_AT : SECOND_OBSERVED_AT,
    sourceAsOf: null,
    retrievedAt: SECOND_OBSERVED_AT,
    freshnessBasis: 'retrieval_time',
    recordCount,
    cacheAgeSeconds: 0,
    errorCode: status === 'unavailable' ? 'timeout' : null,
  };
}

export function canonicalAdapterState(overrides = {}) {
  const sources = overrides.sources ?? {};
  const statuses = overrides.statuses ?? {};
  return {
    schemaVersion: 1,
    adapters: ENABLED_ADAPTER_IDS.map((id) => ({
      id,
      source: sources[id] ?? null,
      status: statuses[id] ?? null,
    })),
    pendingConfirmations: structuredClone(overrides.pendingConfirmations ?? []),
  };
}

export const ACCEPTED_PENDING_CONFIRMATION = Object.freeze({
  id: 'pending:hyperliquid-account-details:hyperliquid:0x0000000000000000000000000000000000000def:BTC',
  entityId: 'hyperliquid:0x0000000000000000000000000000000000000def',
  providerId: 'hyperliquid-account-details',
  assetTicker: 'BTC',
  providerSymbol: 'BTC',
  baselineNotionalUsd: 200_000,
  candidateNotionalUsd: 350_000,
  baselineDirection: 'long',
  candidateDirection: 'long',
  signedBaselineNotionalUsd: 200_000,
  signedCandidateNotionalUsd: 350_000,
  observationId: 'hyperliquid-observation-1',
  acceptedSnapshotId: `snapshot:${FIRST_OBSERVED_AT}`,
  observedAt: FIRST_OBSERVED_AT,
});

export function createRefreshDeps(overrides = {}) {
  const calls = {
    events: [],
    fetchByAdapter: Object.fromEntries(ENABLED_ADAPTER_IDS.map((id) => [id, 0])),
    appendJournal: 0,
    publishJournal: 0,
    writeSnapshot: 0,
  };
  const captured = {
    dailyMarkTickers: [],
    dailyMarkDate: null,
    deriveInput: null,
    normalizeInput: null,
    snapshotSignals: null,
    retainedSince: null,
    writtenSnapshot: null,
    journalInput: null,
    publicationInput: null,
  };
  const now = new Date(overrides.now ?? '2026-08-28T12:00:00.000Z');
  const dueIds = new Set(overrides.dueIds ?? ENABLED_ADAPTER_IDS);
  const timeoutId = overrides.timeoutId ?? null;
  const previousState = canonicalAdapterState({
      sources: Object.fromEntries(ENABLED_ADAPTER_IDS.map((id) => [id,
        id === 'sec-edgar'
          ? { kind: 'sec', snapshot: secFixtureSnapshot() }
          : { kind: 'institutional', records: [institutionalFixtureRecord(id.slice('institutional-'.length))] },
      ])),
      statuses: Object.fromEntries(ENABLED_ADAPTER_IDS.map((id) => [id, fixtureStatus(id)])),
    });
  const previous = overrides.previous ?? buildSmartMoneyPrivateSnapshot({
    refreshStartedAt: '2026-08-26T10:59:00.000Z',
    publicSnapshot: {
      ...structuredClone(ACCEPTED_SNAPSHOT),
      providerStatuses: previousState.adapters.map((row) => structuredClone(row.status)),
    },
    adapterState: previousState,
  }, { now: new Date('2026-08-26T11:00:00.000Z') });
  const adapters = ENABLED_ADAPTER_IDS.map((id) => ({
    id,
    rightsId: rightsIdFor(id),
    requiredPurposes: ['fetch', 'cache', 'history', 'display', 'ranking', 'briefing', 'paper', 'attribute'],
    async fetch() {
      calls.events.push(`fetch:${id}`);
      calls.fetchByAdapter[id] += 1;
      if (id === timeoutId) throw Object.assign(new Error('https://provider.invalid/?token=raw-secret'), { code: 'timeout' });
      return { providerId: id, records: [{ id: `${id}:fresh`, providerId: id }], retrievedAt: now.toISOString() };
    },
  }));
  const normalized = overrides.normalized ?? {
    entities: structuredClone(ACCEPTED_SNAPSHOT.entities),
    activities: structuredClone(ACCEPTED_SNAPSHOT.activities),
    performances: structuredClone(ACCEPTED_SNAPSHOT.performances),
    providerStatuses: ENABLED_ADAPTER_IDS.map((id) => fixtureStatus(id, id === timeoutId ? 'unavailable' : 'live')),
    changes: [],
    adapterState: canonicalAdapterState({
      sources: Object.fromEntries(previousState.adapters.map((row) => [row.id, structuredClone(row.source)])),
      statuses: Object.fromEntries(ENABLED_ADAPTER_IDS.map((id) => [
        id, fixtureStatus(id, id === timeoutId ? 'unavailable' : 'live'),
      ])),
    }),
    warnings: timeoutId ? [`${timeoutId}:timeout`] : [],
    sourceLinks: [],
    partial: Boolean(timeoutId),
  };
  const derivedSignals = overrides.signals ?? [structuredClone(ACCEPTED_SIGNAL)];
  const committedSignals = overrides.committedSignals ?? derivedSignals;

  const deps = {
    adapters,
    rights: [{ fixture: true }],
    now: () => new Date(now),
    async withRefreshLock(action) {
      calls.events.push('lock');
      return action();
    },
    assertAdapterRights(assertedAdapters, rights, options) {
      calls.events.push('rights');
      if (overrides.rightsError) throw new Error('smart_money_rights_invalid');
      if (assertedAdapters !== adapters || rights !== deps.rights || options.now.getTime() !== now.getTime()) {
        throw new Error('unexpected_rights_arguments');
      }
    },
    async readSnapshot() {
      calls.events.push('readSnapshot');
      return structuredClone(previous);
    },
    isAdapterDue(adapter) {
      return dueIds.has(adapter.id);
    },
    normalizeSettled(input) {
      calls.events.push('normalize');
      captured.normalizeInput = input;
      return structuredClone(normalized);
    },
    deriveSignals(input) {
      calls.events.push('derive');
      captured.deriveInput = input;
      return {
        signals: structuredClone(derivedSignals),
        pendingConfirmations: [],
      };
    },
    async resolveReferencePrice(signal) {
      calls.events.push(`price:${signal.id}`);
      return structuredClone(signal.referencePrice ?? { skipped: true, reason: 'missing_reference_price' });
    },
    async listTrackedTickers({ since }) {
      calls.events.push('trackedTickers');
      captured.retainedSince = since;
      return [...(overrides.trackedTickers ?? [])];
    },
    async resolveDailyMarks({ tickers, date }) {
      calls.events.push('dailyMarks');
      captured.dailyMarkTickers = [...tickers];
      captured.dailyMarkDate = date;
      return [];
    },
    async appendJournal(input) {
      calls.events.push('journal');
      calls.appendJournal += 1;
      captured.journalInput = structuredClone(input);
      return {
        durableWriteSucceeded: overrides.journalDurable !== false,
        partitions: [],
        manifest: { ok: overrides.journalDurable !== false, error: overrides.journalDurable === false ? 'manifest_write_failed' : null },
        committedSignals: overrides.journalDurable === false
          ? []
          : structuredClone(overrides.echoJournalSignals ? input.signals : committedSignals),
        committedDailyMarks: overrides.journalDurable === false ? [] : structuredClone(input.dailyMarks),
      };
    },
    async publishJournalGeneration(input) {
      calls.events.push('publication');
      calls.publishJournal += 1;
      captured.publicationInput = structuredClone(input);
      return {
        durableWriteSucceeded: overrides.publicationDurable !== false,
        skipped: false,
        error: overrides.publicationDurable === false ? 'publication_write_failed' : null,
      };
    },
    buildSnapshot({ normalized: current, committedSignals: acceptedSignals, now: publicationNow = now }) {
      calls.events.push('buildSnapshot');
      captured.snapshotSignals = structuredClone(acceptedSignals);
      const signalByActivity = new Map(acceptedSignals.map((signal) => [signal.activityId, signal]));
      return {
        ...structuredClone(ACCEPTED_SNAPSHOT),
        fetchedAt: publicationNow.toISOString(),
        partial: current.partial,
        providerStatuses: structuredClone(current.providerStatuses),
        activities: structuredClone(ACCEPTED_SNAPSHOT.activities).map((activity) => {
          const signal = signalByActivity.get(activity.id);
          return signal ? {
            ...activity,
            providerId: signal.providerId,
            entityId: signal.entityId,
            kind: signal.kind,
            asset: structuredClone(signal.asset),
            effectiveAt: signal.effectiveAt,
            disclosedAt: signal.disclosedAt,
            observedAt: signal.observedAt,
          } : activity;
        }),
        signals: structuredClone(acceptedSignals),
      };
    },
    async writeSnapshot(snapshot) {
      calls.events.push('snapshot');
      calls.writeSnapshot += 1;
      captured.writtenSnapshot = structuredClone(snapshot);
      return overrides.snapshotWriteResult ?? {
        snapshot: overrides.snapshotDurable === false ? null : snapshot,
        durableWriteSucceeded: overrides.snapshotDurable !== false,
      };
    },
  };
  return { deps, calls, captured, previous };
}
