export const SIGNAL = Object.freeze({
  id: 'hyperliquid-account-details:position-1',
  entityId: 'hyperliquid:0x0000000000000000000000000000000000000def',
  activityId: 'activity:hyperliquid-position-1',
  kind: 'position_change',
  action: 'open',
  asset: {
    ticker: 'BTC',
    name: 'Bitcoin',
    providerSymbol: 'BTC',
    assetClass: 'crypto',
    supported: true,
  },
  direction: 'long',
  magnitude: { value: 100_000, unit: 'usd_notional' },
  positionChange: {
    previousNotionalUsd: 0,
    currentNotionalUsd: 100_000,
    deltaNotionalUsd: 100_000,
  },
  effectiveAt: '2026-08-26T00:00:00.000Z',
  disclosedAt: null,
  observedAt: '2026-08-26T00:05:00.000Z',
  delaySeconds: 300,
  providerId: 'hyperliquid-account-details',
  sourceUrl: 'https://app.hyperliquid.xyz/explorer/address/0x0000000000000000000000000000000000000def',
  sourceGrade: 'provider_reported',
  identityStatus: 'anonymous',
  confidence: 'high',
  thresholdVersion: 'smart-money-v1',
  notificationEligibility: { eligible: true, reason: 'material_confirmed_change' },
  paperEligibility: { eligible: true, reason: 'supported_reference_price' },
  referencePrice: {
    ticker: 'BTC',
    price: 100_000,
    currency: 'USD',
    source: 'yahoo',
    asOf: '2026-08-26T00:05:00.000Z',
    retrievedAt: '2026-08-26T00:05:01.000Z',
  },
  freshness: 'fresh',
});

export const DAILY_MARK_DEPS = Object.freeze({
  now: () => new Date('2026-08-28T00:00:00.000Z'),
  fetchDailyCloses: async () => [
    {
      ticker: 'ETH', assetClass: 'crypto', close: 4_800, currency: 'USD', source: 'yahoo',
      date: '2026-08-27', asOf: '2026-08-27T20:00:00.000Z', retrievedAt: '2026-08-27T20:00:02.000Z',
      status: 'closed',
    },
    {
      ticker: 'SPX', assetClass: 'equity', close: 6_800, currency: 'USD', source: 'yahoo',
      date: '2026-08-27', asOf: '2026-08-27T20:00:00.000Z', retrievedAt: '2026-08-27T20:00:02.000Z',
      status: 'closed',
    },
    {
      ticker: 'BTC', assetClass: 'crypto', close: 101_000, currency: 'USD', source: 'coingecko',
      date: '2026-08-27', asOf: '2026-08-27T23:59:59.000Z', retrievedAt: '2026-08-27T23:59:59.500Z',
      status: 'closed',
    },
  ],
});

function conflict() {
  const error = new Error('simulated stale ETag containing private adapter details');
  error.name = 'BlobPreconditionFailedError';
  return error;
}

export function memoryJournalAdapter(options = {}) {
  const blobs = new Map();
  const failedWrites = new Map();
  const failedDeletes = new Map();
  let nextEtag = 1;

  return {
    async read(pathname) {
      const row = blobs.get(pathname);
      return row
        ? { data: structuredClone(row.data), etag: row.etag }
        : { data: null, etag: null };
    },
    async write(pathname, data, expectedEtag) {
      await options.beforeWrite?.({ pathname, data: structuredClone(data), expectedEtag });
      const failures = failedWrites.get(pathname) || 0;
      if (failures > 0) {
        failedWrites.set(pathname, failures - 1);
        throw new Error('simulated write failure with secret=never-return');
      }
      const current = blobs.get(pathname);
      if ((current?.etag ?? null) !== expectedEtag) throw conflict();
      const etag = String(nextEtag++);
      blobs.set(pathname, { data: structuredClone(data), etag });
      return { etag };
    },
    async delete(pathname, expectedEtag) {
      await options.beforeDelete?.({ pathname, expectedEtag });
      const failures = failedDeletes.get(pathname) || 0;
      if (failures > 0) {
        failedDeletes.set(pathname, failures - 1);
        throw new Error('simulated delete failure with secret=never-return');
      }
      const current = blobs.get(pathname);
      if (!current) return false;
      if (expectedEtag != null && current.etag !== expectedEtag) throw conflict();
      blobs.delete(pathname);
      return true;
    },
    async list(prefix) {
      return [...blobs.keys()].filter((pathname) => pathname.startsWith(prefix)).sort();
    },
    isConflict(error) {
      return error?.name === 'BlobPreconditionFailedError';
    },
    failNext(pathname, count = 1) {
      failedWrites.set(pathname, count);
    },
    failNextDelete(pathname, count = 1) {
      failedDeletes.set(pathname, count);
    },
    seed(pathname, data) {
      const etag = String(nextEtag++);
      blobs.set(pathname, { data: structuredClone(data), etag });
      return etag;
    },
    inspect(pathname) {
      const row = blobs.get(pathname);
      return row ? structuredClone(row.data) : null;
    },
    paths() {
      return [...blobs.keys()].sort();
    },
  };
}
