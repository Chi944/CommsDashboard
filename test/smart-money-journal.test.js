import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  appendJournal,
  listTrackedTickers,
  publishJournalGeneration,
  pruneJournal,
  readAcceptedSmartMoneySnapshot,
  readJournal,
  stageJournal,
} from '../lib/smart-money/journal.js';
import {
  buildSmartMoneyPrivateSnapshot,
  computeSmartMoneyPrivateStateDigest,
} from '../lib/smart-money/private-snapshot.js';
import { listEntities } from '../lib/smart-money/entities.js';
import { SIGNAL, memoryJournalAdapter } from './fixtures/smart-money/journal.js';
import { ACCEPTED_SNAPSHOT, createRefreshDeps } from './fixtures/smart-money/scenarios.js';

const MANIFEST = 'smart-money/v1/journal/manifest.json';
const PARTITION = 'smart-money/v1/journal/2026-08-26.json';
const PUBLICATIONS = 'smart-money/v1/journal/publications.json';
const GENERATION = '2026-08-27T00:00:00.000Z';

function acceptedPrivateSnapshot(generation = GENERATION, signals = []) {
  const { previous } = createRefreshDeps({ signals: [] });
  const activities = signals.map((signal) => ({
    ...structuredClone(ACCEPTED_SNAPSHOT.activities[0]),
    id: signal.activityId,
    entityId: signal.entityId,
    providerId: signal.providerId,
    kind: signal.kind,
    sourceStableId: `source:${signal.id}`,
    sourceUrl: signal.sourceUrl,
    sourceGrade: signal.sourceGrade,
    identityConfidence: signal.confidence,
    asset: structuredClone(signal.asset),
    direction: signal.direction,
    magnitude: structuredClone(signal.magnitude),
    effectiveAt: signal.effectiveAt,
    disclosedAt: signal.disclosedAt,
    observedAt: signal.observedAt,
    retrievedAt: signal.observedAt,
    delaySeconds: signal.delaySeconds,
    freshness: signal.freshness,
  }));
  return buildSmartMoneyPrivateSnapshot({
    refreshStartedAt: generation,
    publicSnapshot: {
      ...structuredClone(previous.publicSnapshot),
      fetchedAt: generation,
      entities: [...new Map([
        ...structuredClone(previous.publicSnapshot.entities),
        ...listEntities(),
      ].map((entity) => [entity.id, entity])).values()],
      activities,
      signals: structuredClone(signals),
    },
    adapterState: structuredClone(previous.adapterState),
  }, { now: new Date(generation) });
}

function acceptedPublicationRecord(snapshot, signalIds = snapshot.publicSnapshot.signals.map(({ id }) => id)) {
  return {
    schemaVersion: 2,
    staged: {},
    published: {
      [snapshot.refreshStartedAt]: {
        signalIds: [...signalIds].sort(),
        dailyMarkIds: [],
        snapshotDigest: snapshot.stateDigest,
      },
    },
    current: {
      refreshStartedAt: snapshot.refreshStartedAt,
      snapshotDigest: snapshot.stateDigest,
      snapshot,
    },
  };
}

function signalAt(id, observedAt, ticker = 'BTC') {
  const observedMs = Date.parse(observedAt);
  return {
    ...structuredClone(SIGNAL),
    id,
    activityId: `activity:${id}`,
    asset: {
      ...SIGNAL.asset,
      ticker,
      name: ticker,
      providerSymbol: ticker,
      assetClass: ticker === 'SPX' ? 'equity' : 'crypto',
    },
    effectiveAt: new Date(observedMs - 300_000).toISOString(),
    observedAt,
    referencePrice: {
      ...SIGNAL.referencePrice,
      ticker,
      asOf: observedAt,
      retrievedAt: new Date(observedMs + 1_000).toISOString(),
    },
  };
}

function dailyMark(date = '2026-08-26', ticker = 'BTC', asOf = `${date}T20:00:00.000Z`) {
  return {
    id: `${date}:${ticker}`,
    date,
    ticker,
    assetClass: ticker === 'SPX' ? 'equity' : 'crypto',
    kind: ['SPX', 'BTC'].includes(ticker) ? 'benchmark' : 'asset',
    price: ticker === 'BTC' ? 100_000 : 5_000,
    currency: 'USD',
    source: 'yahoo',
    asOf,
    retrievedAt: new Date(Date.parse(asOf) + 1_000).toISOString(),
  };
}

async function publishRows(adapter, { signals = [], dailyMarks = [], generation = GENERATION } = {}) {
  const now = new Date(generation);
  const staged = await stageJournal({ refreshStartedAt: generation, signals, dailyMarks }, { adapter, now });
  assert.equal(staged.durableWriteSucceeded, true);
  const published = await publishJournalGeneration({
    refreshStartedAt: generation,
    snapshot: acceptedPrivateSnapshot(generation, signals),
  }, { adapter, now });
  assert.equal(published.durableWriteSucceeded, true);
}

test('staged rows stay private until their exact snapshot generation is durably published', async () => {
  const adapter = memoryJournalAdapter();
  const mark = dailyMark();
  const staged = await stageJournal({
    refreshStartedAt: GENERATION,
    signals: [SIGNAL],
    dailyMarks: [mark],
  }, { adapter, now: new Date(GENERATION) });
  assert.equal(staged.durableWriteSucceeded, true);
  const beforePublication = await readJournal({
    since: SIGNAL.observedAt,
    limit: 200,
  }, { adapter, now: new Date(GENERATION) });
  assert.deepEqual(beforePublication.signals, []);
  assert.deepEqual(beforePublication.dailyMarks, []);

  const published = await publishJournalGeneration({
    refreshStartedAt: GENERATION,
    snapshot: acceptedPrivateSnapshot(GENERATION, [SIGNAL]),
  }, { adapter, now: new Date(GENERATION) });
  assert.deepEqual(published, { durableWriteSucceeded: true, skipped: false, error: null });
  const afterPublication = await readJournal({
    since: SIGNAL.observedAt,
    limit: 200,
  }, { adapter, now: new Date(GENERATION) });
  assert.deepEqual(afterPublication.signals, [SIGNAL]);
  assert.deepEqual(afterPublication.dailyMarks, [mark]);
  assert.deepEqual(
    await readAcceptedSmartMoneySnapshot({ adapter, now: new Date(GENERATION) }),
    acceptedPrivateSnapshot(GENERATION, [SIGNAL]),
  );
});

test('publication marker retry is idempotent for the same generation and exact IDs', async () => {
  const adapter = memoryJournalAdapter();
  await stageJournal({
    refreshStartedAt: GENERATION,
    signals: [SIGNAL],
    dailyMarks: [],
  }, { adapter, now: new Date(GENERATION) });
  const input = {
    refreshStartedAt: GENERATION,
    snapshot: acceptedPrivateSnapshot(GENERATION, [SIGNAL]),
  };
  assert.deepEqual(await publishJournalGeneration(input, { adapter, now: new Date(GENERATION) }), {
    durableWriteSucceeded: true, skipped: false, error: null,
  });
  assert.deepEqual(await publishJournalGeneration(input, { adapter, now: new Date(GENERATION) }), {
    durableWriteSucceeded: true, skipped: true, error: null,
  });
  assert.deepEqual(Object.keys(adapter.inspect(PUBLICATIONS).published), [GENERATION]);
  assert.deepEqual(Object.keys(adapter.inspect(PUBLICATIONS).staged), []);
  assert.deepEqual(adapter.inspect(MANIFEST).claims, {});
});

test('exact current publication retry is read-only across maintenance and claim-retirement cleanup', async () => {
  const maintenanceCases = [
    ['unexpired', '2026-08-27T00:01:00.000Z'],
    ['expired', '2026-08-27T00:20:00.000Z'],
  ];
  for (const [name, retryAt] of maintenanceCases) {
    const adapter = memoryJournalAdapter();
    await publishRows(adapter, { signals: [SIGNAL] });
    const manifest = adapter.inspect(MANIFEST);
    manifest.maintenance = {
      token: 'claim:00000000-0000-4000-8000-000000000010',
      claimedAt: '2026-08-27T00:00:00.000Z',
      leaseUntil: '2026-08-27T00:02:00.000Z',
    };
    adapter.seed(MANIFEST, manifest);

    assert.deepEqual(await publishJournalGeneration({
      refreshStartedAt: GENERATION,
      snapshot: acceptedPrivateSnapshot(GENERATION, [SIGNAL]),
    }, { adapter, now: new Date(retryAt) }), {
      durableWriteSucceeded: true, skipped: true, error: null,
    }, name);
  }

  const cleanupAdapter = memoryJournalAdapter();
  await publishRows(cleanupAdapter, { signals: [SIGNAL] });
  const publications = cleanupAdapter.inspect(PUBLICATIONS);
  publications.cleanup = {
    staged: {},
    claims: {
      [GENERATION]: {
        token: 'claim:00000000-0000-4000-8000-000000000011',
        state: 'writing',
        claimedAt: '2026-08-27T00:00:00.000Z',
        leaseUntil: '2026-08-27T00:02:00.000Z',
        signalIds: { [SIGNAL.id]: SIGNAL.observedAt.slice(0, 10) },
        dailyMarkIds: {},
      },
    },
    signalIds: {},
    dailyMarkIds: {},
  };
  cleanupAdapter.seed(PUBLICATIONS, publications);
  assert.deepEqual(await publishJournalGeneration({
    refreshStartedAt: GENERATION,
    snapshot: acceptedPrivateSnapshot(GENERATION, [SIGNAL]),
  }, { adapter: cleanupAdapter, now: new Date('2026-08-27T00:20:00.000Z') }), {
    durableWriteSucceeded: true, skipped: true, error: null,
  });

  const unpublishedAdapter = memoryJournalAdapter();
  const unpublishedGeneration = '2026-08-27T01:00:00.000Z';
  await stageJournal({
    refreshStartedAt: unpublishedGeneration, signals: [SIGNAL], dailyMarks: [],
  }, { adapter: unpublishedAdapter, now: new Date(unpublishedGeneration) });
  const unpublishedManifest = unpublishedAdapter.inspect(MANIFEST);
  unpublishedManifest.maintenance = {
    token: 'claim:00000000-0000-4000-8000-000000000012',
    claimedAt: '2026-08-27T01:00:00.000Z',
    leaseUntil: '2026-08-27T01:02:00.000Z',
  };
  unpublishedAdapter.seed(MANIFEST, unpublishedManifest);
  const unpublished = await publishJournalGeneration({
    refreshStartedAt: unpublishedGeneration,
    snapshot: acceptedPrivateSnapshot(unpublishedGeneration, [SIGNAL]),
  }, { adapter: unpublishedAdapter, now: new Date('2026-08-27T01:20:00.000Z') });
  assert.equal(unpublished.durableWriteSucceeded, false);
  assert.equal(unpublished.error, 'publication_rows_unavailable');
});

test('publication rejects accepted signal content that differs from its staged journal row', async () => {
  const variants = [
    {
      name: 'reference price',
      mutate(signal) {
        signal.referencePrice.price += 123;
      },
    },
    {
      name: 'source evidence',
      mutate(signal) {
        signal.sourceUrl = 'https://app.hyperliquid.xyz/explorer/address/0x0000000000000000000000000000000000000abc';
      },
    },
    {
      name: 'direction',
      mutate(signal) {
        signal.direction = 'short';
      },
    },
  ];
  for (const variant of variants) {
    const adapter = memoryJournalAdapter();
    await stageJournal({
      refreshStartedAt: GENERATION, signals: [SIGNAL], dailyMarks: [],
    }, { adapter, now: new Date(GENERATION) });
    const changed = structuredClone(SIGNAL);
    variant.mutate(changed);

    const published = await publishJournalGeneration({
      refreshStartedAt: GENERATION,
      snapshot: acceptedPrivateSnapshot(GENERATION, [changed]),
    }, { adapter, now: new Date(GENERATION) });

    assert.equal(published.durableWriteSucceeded, false, variant.name);
    assert.equal(published.error, 'publication_rows_unavailable', variant.name);
    assert.equal(await readAcceptedSmartMoneySnapshot({
      adapter, now: new Date(GENERATION),
    }), null, variant.name);
    assert.ok(adapter.inspect(PUBLICATIONS).staged[GENERATION], variant.name);
  }
});

test('publication binds staged signals by canonical ID while preserving idempotent retries', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt(
    'hyperliquid-account-details:publication-order-a', '2026-08-26T01:00:00.000Z',
  );
  const second = signalAt(
    'hyperliquid-account-details:publication-order-b', '2026-08-26T02:00:00.000Z',
  );
  const staged = await stageJournal({
    refreshStartedAt: GENERATION, signals: [second, first], dailyMarks: [],
  }, { adapter, now: new Date(GENERATION) });
  assert.equal(staged.durableWriteSucceeded, true);
  const snapshot = acceptedPrivateSnapshot(GENERATION, [first, second]);
  const input = { refreshStartedAt: GENERATION, snapshot };

  assert.deepEqual(await publishJournalGeneration(input, {
    adapter, now: new Date(GENERATION),
  }), { durableWriteSucceeded: true, skipped: false, error: null });
  assert.deepEqual(await publishJournalGeneration(input, {
    adapter, now: new Date(GENERATION),
  }), { durableWriteSucceeded: true, skipped: true, error: null });
  assert.deepEqual(
    (await readAcceptedSmartMoneySnapshot({ adapter, now: new Date(GENERATION) }))
      .publicSnapshot.signals.map((signal) => signal.id),
    [first.id, second.id],
  );
});

test('more than the manifest claim limit of empty cron generations publish without claim accumulation', async () => {
  const adapter = memoryJournalAdapter();
  const baseMs = Date.parse('2026-08-27T00:00:00.000Z');
  const template = acceptedPrivateSnapshot(new Date(baseMs).toISOString(), []);
  for (let index = 0; index < 2_050; index += 1) {
    const generation = new Date(baseMs + index * 1_000).toISOString();
    const staged = await stageJournal({
      refreshStartedAt: generation, signals: [], dailyMarks: [],
    }, { adapter, now: new Date(generation) });
    assert.equal(staged.durableWriteSucceeded, true, `stage ${index}`);
    const published = await publishJournalGeneration({
      refreshStartedAt: generation,
      snapshot: buildSmartMoneyPrivateSnapshot({
        refreshStartedAt: generation,
        publicSnapshot: { ...template.publicSnapshot, fetchedAt: generation },
        adapterState: template.adapterState,
      }, { now: new Date(generation) }),
    }, { adapter, now: new Date(generation) });
    assert.equal(published.durableWriteSucceeded, true, `publish ${index}`);
    assert.equal(Object.keys(adapter.inspect(MANIFEST).claims).length, 0, `claims ${index}`);
    if (index % 64 === 63) {
      const pruned = await pruneJournal({ now: generation }, { adapter });
      assert.equal(pruned.durableWriteSucceeded, true, `prune ${index}`);
    }
  }
});

test('manifest claim count, per-claim IDs, and total claim IDs fail closed above their bounds', async () => {
  const claimedAt = '2026-08-27T00:00:00.000Z';
  const leaseUntil = '2026-08-27T00:02:00.000Z';
  function claim(signalIds = {}) {
    return {
      token: 'claim:00000000-0000-4000-8000-000000000000',
      state: 'writing',
      claimedAt,
      leaseUntil,
      signalIds,
      dailyMarkIds: {},
    };
  }
  const variants = [];
  variants.push(Object.fromEntries(Array.from({ length: 2_049 }, (_, index) => [
    new Date(Date.parse(claimedAt) + index * 1_000).toISOString(), claim(),
  ])));
  variants.push({
    [claimedAt]: claim(Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [
      `hyperliquid-account-details:per-claim-${index}`, '2026-08-26',
    ]))),
  });
  const totalClaims = {};
  let totalIndex = 0;
  for (let claimIndex = 0; claimIndex < 11; claimIndex += 1) {
    const count = claimIndex < 10 ? 10_000 : 1;
    const signalIds = {};
    for (let idIndex = 0; idIndex < count; idIndex += 1) {
      signalIds[`hyperliquid-account-details:total-${totalIndex}`] = '2026-08-26';
      totalIndex += 1;
    }
    totalClaims[new Date(Date.parse(claimedAt) + claimIndex * 1_000).toISOString()] = claim(signalIds);
  }
  variants.push(totalClaims);

  for (const claims of variants) {
    const adapter = memoryJournalAdapter();
    adapter.seed(MANIFEST, {
      schemaVersion: 2,
      partitions: [],
      signalIds: {},
      dailyMarkIds: {},
      claims,
      maintenance: null,
    });
    const pruned = await pruneJournal({ now: '2026-08-27T00:03:00.000Z' }, { adapter });
    assert.equal(pruned.durableWriteSucceeded, false);
    assert.equal(adapter.inspect(MANIFEST).maintenance, null);
  }
});

test('accepted publication stays durable when its claim retirement cleanup fails', async () => {
  const adapter = memoryJournalAdapter();
  await stageJournal({
    refreshStartedAt: GENERATION,
    signals: [SIGNAL],
    dailyMarks: [],
  }, { adapter, now: new Date(GENERATION) });
  adapter.failNext(MANIFEST);

  const published = await publishJournalGeneration({
    refreshStartedAt: GENERATION,
    snapshot: acceptedPrivateSnapshot(GENERATION, [SIGNAL]),
  }, { adapter, now: new Date(GENERATION) });

  assert.deepEqual(published, { durableWriteSucceeded: true, skipped: false, error: null });
  assert.deepEqual(
    await readAcceptedSmartMoneySnapshot({ adapter, now: new Date(GENERATION) }),
    acceptedPrivateSnapshot(GENERATION, [SIGNAL]),
  );
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).claims, GENERATION), true);

  const pruned = await pruneJournal({ now: new Date(GENERATION) }, { adapter });
  assert.equal(pruned.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).claims, GENERATION), false);
});

test('prune rejects cleanup and reconciliation mappings that overlap published IDs', async () => {
  for (const kind of ['cleanup', 'reconciliation']) {
    const adapter = memoryJournalAdapter();
    await publishRows(adapter, { signals: [SIGNAL] });
    const publications = adapter.inspect(PUBLICATIONS);
    if (kind === 'reconciliation') {
      publications.reconciliation = {
        signalIds: { [SIGNAL.id]: SIGNAL.observedAt.slice(0, 10) }, dailyMarkIds: {},
      };
    } else {
      const orphanGeneration = '2026-08-27T12:01:00.000Z';
      const ids = { signalIds: [SIGNAL.id], dailyMarkIds: [] };
      publications.staged[orphanGeneration] = ids;
      publications.cleanup = {
        staged: { [orphanGeneration]: ids },
        signalIds: { [SIGNAL.id]: SIGNAL.observedAt.slice(0, 10) },
        dailyMarkIds: {},
      };
    }
    adapter.seed(PUBLICATIONS, publications);

    const pruned = await pruneJournal({ now: new Date(GENERATION) }, { adapter });
    assert.equal(pruned.durableWriteSucceeded, false, kind);
    assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === SIGNAL.id), true, kind);
    assert.equal(adapter.inspect(MANIFEST).signalIds[SIGNAL.id], SIGNAL.observedAt.slice(0, 10), kind);
  }
});

test('final acceptance rejects forged and incomplete private envelopes', async () => {
  const adapter = memoryJournalAdapter();
  await stageJournal({
    refreshStartedAt: GENERATION, signals: [], dailyMarks: [],
  }, { adapter, now: new Date(GENERATION) });
  const valid = acceptedPrivateSnapshot(GENERATION, []);
  const forged = structuredClone(valid);
  forged.stateDigest = `sha256:${'f'.repeat(64)}`;
  await assert.rejects(
    publishJournalGeneration({ refreshStartedAt: GENERATION, snapshot: forged }, {
      adapter, now: new Date(GENERATION),
    }),
    /schema_invalid/,
  );
  await assert.rejects(
    publishJournalGeneration({
      refreshStartedAt: GENERATION,
      snapshot: {
        schemaVersion: 1,
        refreshStartedAt: GENERATION,
        publicSnapshot: { signals: [] },
        adapterState: {},
        stateDigest: `sha256:${'a'.repeat(64)}`,
      },
    }, { adapter, now: new Date(GENERATION) }),
    /schema_invalid/,
  );
  assert.equal(await readAcceptedSmartMoneySnapshot({ adapter, now: new Date(GENERATION) }), null);
});

test('accepted reads reject forged, incomplete, and internally swapped private state', async () => {
  const forgedAdapter = memoryJournalAdapter();
  const valid = acceptedPrivateSnapshot(GENERATION, []);
  const forged = structuredClone(valid);
  forged.stateDigest = `sha256:${'f'.repeat(64)}`;
  forgedAdapter.seed(PUBLICATIONS, acceptedPublicationRecord(forged));
  await assert.rejects(
    readAcceptedSmartMoneySnapshot({ adapter: forgedAdapter, now: new Date(GENERATION) }),
    /schema_invalid/,
  );

  const incompleteAdapter = memoryJournalAdapter();
  const incomplete = {
    schemaVersion: 1,
    refreshStartedAt: GENERATION,
    publicSnapshot: { signals: [] },
    adapterState: {},
    stateDigest: `sha256:${'a'.repeat(64)}`,
  };
  incompleteAdapter.seed(PUBLICATIONS, acceptedPublicationRecord(incomplete, []));
  await assert.rejects(
    readAcceptedSmartMoneySnapshot({ adapter: incompleteAdapter, now: new Date(GENERATION) }),
    /schema_invalid/,
  );

  const swappedAdapter = memoryJournalAdapter();
  const swapped = structuredClone(valid);
  [swapped.adapterState.adapters[1].status, swapped.adapterState.adapters[2].status]
    = [swapped.adapterState.adapters[2].status, swapped.adapterState.adapters[1].status];
  swapped.stateDigest = computeSmartMoneyPrivateStateDigest(swapped);
  swappedAdapter.seed(PUBLICATIONS, acceptedPublicationRecord(swapped));
  await assert.rejects(
    readAcceptedSmartMoneySnapshot({ adapter: swappedAdapter, now: new Date(GENERATION) }),
    /schema_invalid/,
  );
});

test('source ownership swaps cannot cross publication or accepted snapshot and history reads', async () => {
  const valid = acceptedPrivateSnapshot(GENERATION, []);
  const institutionalSwap = structuredClone(valid);
  [institutionalSwap.adapterState.adapters[1].source,
    institutionalSwap.adapterState.adapters[2].source] = [
    institutionalSwap.adapterState.adapters[2].source,
    institutionalSwap.adapterState.adapters[1].source,
  ];
  institutionalSwap.stateDigest = computeSmartMoneyPrivateStateDigest(institutionalSwap);
  const foreignSecCik = structuredClone(valid);
  foreignSecCik.adapterState.adapters[0].source.snapshot.filings[0].cik = '1050446';
  foreignSecCik.stateDigest = computeSmartMoneyPrivateStateDigest(foreignSecCik);

  for (const corrupt of [institutionalSwap, foreignSecCik]) {
    const publicationAdapter = memoryJournalAdapter();
    await stageJournal({
      refreshStartedAt: GENERATION, signals: [], dailyMarks: [],
    }, { adapter: publicationAdapter, now: new Date(GENERATION) });
    await assert.rejects(
      publishJournalGeneration({ refreshStartedAt: GENERATION, snapshot: corrupt }, {
        adapter: publicationAdapter, now: new Date(GENERATION),
      }),
      /schema_invalid/,
    );
    assert.equal(
      await readAcceptedSmartMoneySnapshot({
        adapter: publicationAdapter, now: new Date(GENERATION),
      }),
      null,
    );

    const readAdapter = memoryJournalAdapter();
    readAdapter.seed(PUBLICATIONS, acceptedPublicationRecord(corrupt));
    await assert.rejects(
      readAcceptedSmartMoneySnapshot({ adapter: readAdapter, now: new Date(GENERATION) }),
      /schema_invalid/,
    );
    await assert.rejects(
      readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 20 }, {
        adapter: readAdapter, now: new Date(GENERATION),
      }),
      /schema_invalid/,
    );
  }
});

test('a lost acceptance response is reread as durable without splitting snapshot and history', async () => {
  const underlying = memoryJournalAdapter();
  let loseAcceptanceResponse = true;
  const adapter = {
    ...underlying,
    async write(pathname, data, expectedEtag) {
      const result = await underlying.write(pathname, data, expectedEtag);
      if (pathname === PUBLICATIONS && data.current !== null && loseAcceptanceResponse) {
        loseAcceptanceResponse = false;
        throw new Error('simulated lost response containing secret=never-return');
      }
      return result;
    },
  };
  await stageJournal({
    refreshStartedAt: GENERATION, signals: [SIGNAL], dailyMarks: [],
  }, { adapter, now: new Date(GENERATION) });
  const snapshot = acceptedPrivateSnapshot(GENERATION, [SIGNAL]);
  assert.deepEqual(await publishJournalGeneration({
    refreshStartedAt: GENERATION, snapshot,
  }, { adapter, now: new Date(GENERATION) }), {
    durableWriteSucceeded: true, skipped: false, error: null,
  });
  assert.deepEqual(
    await readAcceptedSmartMoneySnapshot({ adapter, now: new Date(GENERATION) }),
    snapshot,
  );
  assert.deepEqual((await readJournal({ since: SIGNAL.observedAt, limit: 10 }, {
    adapter, now: new Date(GENERATION),
  })).signals, [SIGNAL]);
});

test('journal append returns the exact durable contract and rereads committed rows', async () => {
  const adapter = memoryJournalAdapter();
  const mark = dailyMark();
  const result = await appendJournal({ signals: [SIGNAL], dailyMarks: [mark] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(result.committedSignals, [SIGNAL]);
  assert.deepEqual(result.committedDailyMarks, [mark]);
  assert.deepEqual(adapter.paths(), [PARTITION, MANIFEST]);
});

test('journal retry preserves the original immutable signal and reference price', async () => {
  const adapter = memoryJournalAdapter();
  await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });
  const retry = await appendJournal({
    signals: [{
      ...SIGNAL,
      referencePrice: { ...SIGNAL.referencePrice, price: SIGNAL.referencePrice.price + 5_000 },
    }],
    dailyMarks: [],
  }, { adapter });
  await publishRows(adapter, { signals: [SIGNAL] });
  const result = await readJournal({
    since: SIGNAL.observedAt,
    limit: 200,
  }, { adapter, now: new Date('2026-08-27T00:00:00.000Z') });
  assert.deepEqual(result.signals.map((row) => row.id), [SIGNAL.id]);
  assert.equal(retry.committedSignals[0].referencePrice.price, SIGNAL.referencePrice.price);
});

test('stage claim identity is canonical across nonlexicographic input and reordered retry', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt(
    'hyperliquid-account-details:z-claim-order', '2026-08-26T10:00:00.000Z',
  );
  const second = signalAt(
    'hyperliquid-account-details:a-claim-order', '2026-08-26T11:00:00.000Z',
  );
  const initial = await stageJournal({
    refreshStartedAt: GENERATION, signals: [first, second], dailyMarks: [],
  }, { adapter, now: new Date(GENERATION) });
  assert.equal(initial.durableWriteSucceeded, true);

  const retried = await stageJournal({
    refreshStartedAt: GENERATION, signals: [second, first], dailyMarks: [],
  }, { adapter, now: new Date(GENERATION) });
  assert.equal(retried.durableWriteSucceeded, true);
  assert.deepEqual(retried.committedSignals, [second, first]);
  assert.deepEqual(Object.keys(adapter.inspect(MANIFEST).claims[GENERATION].signalIds), [
    second.id, first.id,
  ]);
  const input = {
    refreshStartedAt: GENERATION,
    snapshot: acceptedPrivateSnapshot(GENERATION, [first, second]),
  };
  assert.deepEqual(await publishJournalGeneration(input, {
    adapter, now: new Date(GENERATION),
  }), { durableWriteSucceeded: true, skipped: false, error: null });
  assert.deepEqual(await publishJournalGeneration(input, {
    adapter, now: new Date(GENERATION),
  }), { durableWriteSucceeded: true, skipped: true, error: null });
});

test('journal retry preserves the original immutable completed daily mark', async () => {
  const adapter = memoryJournalAdapter();
  const original = dailyMark();
  await appendJournal({ signals: [], dailyMarks: [original] }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  const retry = await appendJournal({
    signals: [], dailyMarks: [{ ...original, price: original.price + 5_000 }],
  }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(retry.committedDailyMarks[0].price, original.price);
});

test('concurrent daily-mark writers return the first durable close to every contender', async () => {
  const original = dailyMark();
  const drifted = { ...original, price: original.price + 5_000 };
  let announceDrift;
  let releaseDrift;
  let blocked = false;
  const driftReached = new Promise((resolve) => { announceDrift = resolve; });
  const driftGate = new Promise((resolve) => { releaseDrift = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!blocked && pathname === PARTITION && data.dailyMarks[0]?.price === drifted.price) {
        blocked = true;
        announceDrift();
        await driftGate;
      }
    },
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const driftWrite = appendJournal({ signals: [], dailyMarks: [drifted] }, options);
  await driftReached;
  const firstCommit = await appendJournal({ signals: [], dailyMarks: [original] }, options);
  releaseDrift();
  const contender = await driftWrite;
  assert.equal(firstCommit.committedDailyMarks[0].price, original.price);
  assert.equal(contender.committedDailyMarks[0].price, original.price);
});

test('concurrent journal writers CAS-merge distinct rows in one partition and manifest', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt('hyperliquid-account-details:a', '2026-08-26T01:00:00.000Z');
  const second = signalAt('hyperliquid-account-details:b', '2026-08-26T01:00:00.000Z');
  const [left, right] = await Promise.all([
    appendJournal({ signals: [first], dailyMarks: [] }, { adapter }),
    appendJournal({ signals: [second], dailyMarks: [] }, { adapter }),
  ]);
  await publishRows(adapter, { signals: [first, second] });
  const history = await readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 200 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.equal(left.durableWriteSucceeded, true);
  assert.equal(right.durableWriteSucceeded, true);
  assert.deepEqual(history.signals.map((row) => row.id), [first.id, second.id]);
});

test('partition or manifest partial failures never report durable success or leak diagnostics', async () => {
  const partitionFailureAdapter = memoryJournalAdapter();
  partitionFailureAdapter.failNext(PARTITION);
  const partitionFailure = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, {
    adapter: partitionFailureAdapter,
  });
  assert.equal(partitionFailure.durableWriteSucceeded, false);
  assert.deepEqual(partitionFailure.committedSignals, []);
  assert.deepEqual(partitionFailure.committedDailyMarks, []);
  assert.equal(JSON.stringify(partitionFailure).includes('secret'), false);

  const manifestFailureAdapter = memoryJournalAdapter();
  manifestFailureAdapter.failNext(MANIFEST);
  const manifestFailure = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, {
    adapter: manifestFailureAdapter,
  });
  assert.equal(manifestFailure.durableWriteSucceeded, false);
  assert.equal(manifestFailureAdapter.inspect(PARTITION).signals.length, 1);
  assert.deepEqual(manifestFailure.committedSignals, []);
  assert.deepEqual(manifestFailure.committedDailyMarks, []);
  assert.equal(JSON.stringify(manifestFailure).includes('secret'), false);
});

test('journal reread failure returns no committed rows after partition and manifest writes', async () => {
  const memory = memoryJournalAdapter();
  let manifestReads = 0;
  const adapter = {
    ...memory,
    async read(pathname) {
      if (pathname === MANIFEST) {
        manifestReads += 1;
        if (manifestReads === 4) throw new Error('reread failed with secret=never-return');
      }
      return memory.read(pathname);
    },
  };
  const result = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });
  assert.equal(result.durableWriteSucceeded, false);
  assert.deepEqual(result.committedSignals, []);
  assert.deepEqual(result.committedDailyMarks, []);
  assert.equal(JSON.stringify(result).includes('never-return'), false);

  const corruptMemory = memoryJournalAdapter();
  let partitionReads = 0;
  const corruptRereadAdapter = {
    ...corruptMemory,
    async read(pathname) {
      if (pathname === PARTITION) {
        partitionReads += 1;
        if (partitionReads === 3) {
          return {
            data: { schemaVersion: 1, date: '2026-08-26', signals: 'private-corruption' },
            etag: 'corrupt',
          };
        }
      }
      return corruptMemory.read(pathname);
    },
  };
  const corruptResult = await appendJournal(
    { signals: [SIGNAL], dailyMarks: [] },
    { adapter: corruptRereadAdapter },
  );
  assert.equal(corruptResult.durableWriteSucceeded, false);
  assert.deepEqual(corruptResult.committedSignals, []);
  assert.deepEqual(corruptResult.committedDailyMarks, []);
  assert.equal(JSON.stringify(corruptResult).includes('private-corruption'), false);
});

test('concurrently corrupt manifest normalization returns the exact nondurable append envelope', async () => {
  let adapter;
  let corrupted = false;
  adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname }) => {
      if (!corrupted && pathname === MANIFEST) {
        corrupted = true;
        adapter.seed(MANIFEST, {
          schemaVersion: 1,
          partitions: ['2026-13-40'],
          signalIds: { 'private-secret-id': '2026-13-40' },
          dailyMarkIds: {},
        });
      }
    },
  });

  const result = await appendJournal({ signals: [SIGNAL], dailyMarks: [] }, { adapter });

  assert.deepEqual(Object.keys(result).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(result.durableWriteSucceeded, false);
  assert.deepEqual(result.committedSignals, []);
  assert.deepEqual(result.committedDailyMarks, []);
  assert.deepEqual(result.partitions, [{ date: '2026-08-26', ok: true, error: null }]);
  assert.deepEqual(result.manifest, { ok: false, error: 'manifest_write_failed' });
  assert.equal(adapter.inspect(PARTITION).signals[0].id, SIGNAL.id);
  assert.equal(JSON.stringify(result).includes('private-secret-id'), false);
});

test('concurrent same-ID signal and daily mark contention returns a nondurable loser envelope', async () => {
  const mark = dailyMark('2026-08-26', 'ETH');
  const contender = signalAt(mark.id, '2026-08-26T19:00:00.000Z', 'ETH');
  let announceContender;
  let releaseContender;
  let blocked = false;
  const contenderAtPartition = new Promise((resolve) => { announceContender = resolve; });
  const contenderGate = new Promise((resolve) => { releaseContender = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!blocked && pathname === PARTITION
          && data.signals.some((row) => row.id === contender.id)) {
        blocked = true;
        announceContender();
        await contenderGate;
      }
    },
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const contenderWrite = appendJournal({ signals: [contender], dailyMarks: [] }, options);
  await contenderAtPartition;
  const winner = await appendJournal({ signals: [], dailyMarks: [mark] }, options);
  releaseContender();
  const loser = await contenderWrite;

  assert.equal(winner.durableWriteSucceeded, true);
  assert.deepEqual(Object.keys(loser).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(loser.durableWriteSucceeded, false);
  assert.deepEqual(loser.committedSignals, []);
  assert.deepEqual(loser.committedDailyMarks, []);
  assert.deepEqual(loser.partitions, [
    { date: '2026-08-26', ok: false, error: 'partition_write_failed' },
  ]);
  assert.deepEqual(loser.manifest, { ok: false, error: 'manifest_write_failed' });
  assert.equal(JSON.stringify(loser).includes('private'), false);

  const retry = await appendJournal({ signals: [contender], dailyMarks: [] }, options);
  assert.equal(retry.durableWriteSucceeded, false);
  assert.deepEqual(retry.committedSignals, []);
  assert.deepEqual(retry.committedDailyMarks, []);

  await publishRows(adapter, { signals: [], dailyMarks: [mark] });

  const history = await readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 20 }, options);
  assert.deepEqual(history.signals, []);
  assert.deepEqual(history.dailyMarks.map((row) => row.id), [mark.id]);
});

test('a concurrent cross-date ID loser returns nondurable, cleans its orphan, and does not poison history', async () => {
  const winner = signalAt('hyperliquid-account-details:cross-date', '2026-08-25T23:59:59.000Z');
  const loser = signalAt('hyperliquid-account-details:cross-date', '2026-08-26T00:00:01.000Z');
  const loserCompanion = signalAt('hyperliquid-account-details:loser-companion', '2026-08-26T00:30:00.000Z');
  const later = signalAt('hyperliquid-account-details:later', '2026-08-26T01:00:00.000Z');
  let announceLoserManifest;
  let releaseLoserManifest;
  let blocked = false;
  const loserAtManifest = new Promise((resolve) => { announceLoserManifest = resolve; });
  const loserManifestGate = new Promise((resolve) => { releaseLoserManifest = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!blocked && pathname === MANIFEST
          && data.signalIds[loser.id] === '2026-08-26') {
        blocked = true;
        announceLoserManifest();
        await loserManifestGate;
      }
    },
  });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const loserWrite = appendJournal({ signals: [loser, loserCompanion], dailyMarks: [] }, options);
  await loserAtManifest;
  const winnerResult = await appendJournal({ signals: [winner], dailyMarks: [] }, options);
  releaseLoserManifest();
  const loserResult = await loserWrite;

  assert.equal(winnerResult.durableWriteSucceeded, true);
  assert.equal(loserResult.durableWriteSucceeded, false);
  assert.deepEqual(loserResult.committedSignals, []);
  assert.deepEqual(loserResult.committedDailyMarks, []);
  assert.equal(JSON.stringify(loserResult).includes('secret'), false);
  const rejectedPartition = adapter.inspect('smart-money/v1/journal/2026-08-26.json');
  assert.equal(rejectedPartition?.signals.some((row) => row.id === loser.id), false);
  assert.equal(rejectedPartition?.signals.some((row) => row.id === loserCompanion.id), true);

  const laterResult = await appendJournal({ signals: [later], dailyMarks: [] }, options);
  assert.equal(laterResult.durableWriteSucceeded, true);
  await publishRows(adapter, { signals: [winner, later] });
  const history = await readJournal({ since: winner.observedAt, limit: 20 }, options);
  assert.deepEqual(history.signals.map((row) => row.id), [winner.id, later.id]);
});

test('history ignores partition-only rows when the manifest maps only authoritative IDs', async () => {
  const adapter = memoryJournalAdapter();
  const authoritative = signalAt('hyperliquid-account-details:authoritative', '2026-08-26T01:00:00.000Z');
  const orphan = signalAt('hyperliquid-account-details:orphan', '2026-08-26T02:00:00.000Z');
  const accepted = acceptedPrivateSnapshot(GENERATION, [authoritative]);
  adapter.seed(MANIFEST, {
    schemaVersion: 1,
    partitions: ['2026-08-26'],
    signalIds: { [authoritative.id]: '2026-08-26' },
    dailyMarkIds: {},
  });
  adapter.seed(PARTITION, {
    schemaVersion: 1,
    date: '2026-08-26',
    signals: [authoritative, orphan],
    dailyMarks: [],
  });
  adapter.seed(PUBLICATIONS, {
    schemaVersion: 2,
    staged: {},
    published: {
      [GENERATION]: {
        signalIds: [authoritative.id], dailyMarkIds: [],
        snapshotDigest: accepted.stateDigest,
      },
    },
    current: {
      refreshStartedAt: GENERATION,
      snapshotDigest: accepted.stateDigest,
      snapshot: accepted,
    },
  });
  const history = await readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 20 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(history.signals.map((row) => row.id), [authoritative.id]);
});

test('prune compacts accepted and superseded metadata at or behind the current generation', async () => {
  const adapter = memoryJournalAdapter();
  const oldGeneration = '2025-07-20T00:00:00.000Z';
  const abandonedGeneration = '2025-07-21T00:00:00.000Z';
  const currentRetryGeneration = '2026-08-26T11:00:00.000Z';
  const current = acceptedPrivateSnapshot(GENERATION, []);
  adapter.seed(PUBLICATIONS, {
    schemaVersion: 2,
    staged: {
      [abandonedGeneration]: { signalIds: [], dailyMarkIds: [] },
      [currentRetryGeneration]: { signalIds: [], dailyMarkIds: [] },
    },
    published: {
      [oldGeneration]: {
        signalIds: ['hyperliquid-account-details:expired'], dailyMarkIds: [],
        snapshotDigest: `sha256:${'b'.repeat(64)}`,
      },
      [GENERATION]: {
        signalIds: [], dailyMarkIds: [], snapshotDigest: current.stateDigest,
      },
    },
    current: {
      refreshStartedAt: GENERATION,
      snapshotDigest: current.stateDigest,
      snapshot: current,
    },
  });

  const result = await pruneJournal({ now: new Date('2026-08-27T00:00:00.000Z') }, { adapter });
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(adapter.inspect(PUBLICATIONS), {
    schemaVersion: 2,
    staged: {},
    published: {
      [GENERATION]: {
        signalIds: [], dailyMarkIds: [], snapshotDigest: current.stateDigest,
      },
    },
    current: {
      refreshStartedAt: GENERATION,
      snapshotDigest: current.stateDigest,
      snapshot: current,
    },
  });
});

test('an unresolved staged generation newer than current survives a long outage and remains exactly recoverable', async () => {
  const adapter = memoryJournalAdapter();
  const acceptedGeneration = '2026-08-27T00:00:00.000Z';
  const unresolvedGeneration = '2026-08-28T00:00:00.000Z';
  const accepted = acceptedPrivateSnapshot(acceptedGeneration, []);
  const unresolved = acceptedPrivateSnapshot(unresolvedGeneration, []);
  await stageJournal({
    refreshStartedAt: acceptedGeneration, signals: [], dailyMarks: [],
  }, { adapter, now: new Date(acceptedGeneration) });
  await publishJournalGeneration({
    refreshStartedAt: acceptedGeneration, snapshot: accepted,
  }, { adapter, now: new Date(acceptedGeneration) });
  await stageJournal({
    refreshStartedAt: unresolvedGeneration, signals: [], dailyMarks: [],
  }, { adapter, now: new Date(unresolvedGeneration) });
  const unresolvedToken = adapter.inspect(MANIFEST).claims[unresolvedGeneration].token;

  const recoveryNow = new Date('2026-09-06T00:00:00.000Z');
  const pruned = await pruneJournal({ now: recoveryNow }, { adapter });
  assert.equal(pruned.durableWriteSucceeded, true);
  assert.deepEqual(adapter.inspect(PUBLICATIONS).staged, {
    [unresolvedGeneration]: { signalIds: [], dailyMarkIds: [] },
  });
  assert.equal(adapter.inspect(MANIFEST).claims[unresolvedGeneration].token, unresolvedToken);
  assert.deepEqual(await publishJournalGeneration({
    refreshStartedAt: unresolvedGeneration,
    snapshot: unresolved,
  }, { adapter, now: recoveryNow }), {
    durableWriteSucceeded: true, skipped: false, error: null,
  });
  assert.deepEqual(
    await readAcceptedSmartMoneySnapshot({ adapter, now: recoveryNow }),
    unresolved,
  );
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).claims, unresolvedGeneration), false);
});

test('proof-bound abandonment waits for claim grace then preserves accepted shared rows for the retry', async () => {
  const adapter = memoryJournalAdapter();
  const generationP = '2026-08-27T00:00:00.000Z';
  const generationG1 = '2026-08-27T01:00:00.000Z';
  const generationG2 = '2026-08-27T01:13:00.000Z';
  const abandonmentThrough = '2026-08-27T01:05:00.000Z';
  const acceptedP = signalAt(
    'hyperliquid-account-details:abandonment-accepted', '2026-08-26T09:00:00.000Z',
  );
  const failedG1 = signalAt(
    'hyperliquid-account-details:abandonment-retry', '2026-08-26T10:00:00.000Z',
  );
  await publishRows(adapter, { generation: generationP, signals: [acceptedP] });
  await stageJournal({
    refreshStartedAt: generationG1, signals: [failedG1], dailyMarks: [],
  }, { adapter, now: new Date(generationG1) });
  const current = adapter.inspect(PUBLICATIONS).current;
  const evidence = {
    candidateStatus: 'absent',
    current: {
      refreshStartedAt: current.refreshStartedAt,
      snapshotDigest: current.snapshotDigest,
    },
  };

  const pending = await pruneJournal({
    now: '2026-08-27T01:05:00.000Z',
    abandonment: { mode: 'expired', through: abandonmentThrough, evidence },
  }, { adapter });
  assert.equal(pending.durableWriteSucceeded, false);
  assert.deepEqual(pending.abandonment, {
    ok: false, pending: true, error: 'journal_generation_pending',
  });
  assert.ok(adapter.inspect(PUBLICATIONS).staged[generationG1]);

  const abandoned = await pruneJournal({
    now: '2026-08-27T01:12:00.001Z',
    abandonment: { mode: 'expired', through: abandonmentThrough, evidence },
  }, { adapter });
  assert.equal(abandoned.durableWriteSucceeded, true);
  assert.deepEqual(abandoned.abandonment, { ok: true, pending: false, error: null });
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).staged, generationG1), false);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === acceptedP.id), true);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === failedG1.id), false);

  const retried = await stageJournal({
    refreshStartedAt: generationG2, signals: [failedG1], dailyMarks: [],
  }, { adapter, now: new Date(generationG2) });
  assert.equal(retried.durableWriteSucceeded, true);
  await publishJournalGeneration({
    refreshStartedAt: generationG2,
    snapshot: acceptedPrivateSnapshot(generationG2, [failedG1]),
  }, { adapter, now: new Date(generationG2) });
  const history = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 20,
  }, { adapter, now: new Date(generationG2) });
  assert.equal(history.signals.filter((row) => row.id === failedG1.id).length, 1);
  assert.equal(history.signals.some((row) => row.id === acceptedP.id), true);
});

test('satisfied abandonment is independent from an unrelated expired partition delete failure', async () => {
  const adapter = memoryJournalAdapter();
  const generationP = '2026-08-27T00:00:00.000Z';
  const oldDate = '2025-07-20';
  const oldPath = `smart-money/v1/journal/${oldDate}.json`;
  await publishRows(adapter, { generation: generationP });
  const manifest = adapter.inspect(MANIFEST);
  manifest.partitions = [oldDate, ...manifest.partitions].sort();
  adapter.seed(MANIFEST, manifest);
  adapter.seed(oldPath, { schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [] });
  adapter.failNextDelete(oldPath);
  const current = adapter.inspect(PUBLICATIONS).current;

  const result = await pruneJournal({
    now: '2026-08-27T01:00:00.000Z',
    abandonment: {
      mode: 'expired',
      through: '2026-08-27T01:00:00.000Z',
      evidence: {
        candidateStatus: 'ready',
        current: {
          refreshStartedAt: current.refreshStartedAt,
          snapshotDigest: current.snapshotDigest,
        },
      },
    },
  }, { adapter });

  assert.equal(result.durableWriteSucceeded, false);
  assert.deepEqual(result.abandonment, { ok: true, pending: false, error: null });
  assert.ok(adapter.inspect(oldPath));
});

test('exact failed-generation abandonment is immediate but cannot target current publication', async () => {
  const adapter = memoryJournalAdapter();
  const generationP = '2026-08-27T00:00:00.000Z';
  const generationG1 = '2026-08-27T01:00:00.000Z';
  const failedG1 = signalAt(
    'hyperliquid-account-details:exact-abandonment', '2026-08-26T10:00:00.000Z',
  );
  await publishRows(adapter, { generation: generationP });
  await stageJournal({
    refreshStartedAt: generationG1, signals: [failedG1], dailyMarks: [],
  }, { adapter, now: new Date(generationG1) });
  const current = adapter.inspect(PUBLICATIONS).current;
  const evidence = {
    candidateStatus: 'ready',
    current: {
      refreshStartedAt: current.refreshStartedAt,
      snapshotDigest: current.snapshotDigest,
    },
  };

  const rejectedCurrent = await pruneJournal({
    now: '2026-08-27T01:01:00.000Z',
    abandonment: { mode: 'exact', generation: generationP, evidence },
  }, { adapter });
  assert.equal(rejectedCurrent.durableWriteSucceeded, false);
  assert.ok(adapter.inspect(PUBLICATIONS).published[generationP]);

  const abandoned = await pruneJournal({
    now: '2026-08-27T01:01:00.000Z',
    abandonment: { mode: 'exact', generation: generationG1, evidence },
  }, { adapter });
  assert.equal(abandoned.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).staged, generationG1), false);
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).claims, generationG1), false);
});

test('empty generation stage and publish lose to an exact cleanup generation fence', async () => {
  const base = memoryJournalAdapter();
  const generationP = '2026-08-27T00:00:00.000Z';
  const generationG1 = '2026-08-27T01:00:00.000Z';
  await publishRows(base, { generation: generationP });
  await stageJournal({
    refreshStartedAt: generationG1, signals: [], dailyMarks: [],
  }, { adapter: base, now: new Date(generationG1) });
  const originalToken = base.inspect(MANIFEST).claims[generationG1].token;
  const current = base.inspect(PUBLICATIONS).current;
  const evidence = {
    candidateStatus: 'ready',
    current: {
      refreshStartedAt: current.refreshStartedAt,
      snapshotDigest: current.snapshotDigest,
    },
  };
  let announcePublishPrecheck;
  let releasePublishPrecheck;
  let blockPublishPrecheck = true;
  const publishPrecheck = new Promise((resolve) => { announcePublishPrecheck = resolve; });
  const publishRelease = new Promise((resolve) => { releasePublishPrecheck = resolve; });
  const publishAdapter = {
    ...base,
    async read(pathname) {
      const record = await base.read(pathname);
      if (blockPublishPrecheck && pathname === MANIFEST) {
        blockPublishPrecheck = false;
        announcePublishPrecheck();
        await publishRelease;
      }
      return record;
    },
  };
  let announceCleanupFence;
  let releaseCleanupFence;
  let blockCleanupFence = true;
  const cleanupFence = new Promise((resolve) => { announceCleanupFence = resolve; });
  const cleanupRelease = new Promise((resolve) => { releaseCleanupFence = resolve; });
  const pruneAdapter = {
    ...base,
    async write(pathname, data, expectedEtag) {
      if (blockCleanupFence && pathname === MANIFEST
          && data.maintenance !== null
          && data.claims[generationG1]?.token !== originalToken) {
        blockCleanupFence = false;
        announceCleanupFence();
        await cleanupRelease;
      }
      return base.write(pathname, data, expectedEtag);
    },
  };
  const stalePublish = publishJournalGeneration({
    refreshStartedAt: generationG1,
    snapshot: acceptedPrivateSnapshot(generationG1, []),
  }, { adapter: publishAdapter, now: new Date('2026-08-27T01:01:00.000Z') });
  await publishPrecheck;
  const pruning = pruneJournal({
    now: '2026-08-27T01:01:00.000Z',
    abandonment: { mode: 'exact', generation: generationG1, evidence },
  }, { adapter: pruneAdapter });
  await cleanupFence;
  releasePublishPrecheck();

  const published = await stalePublish;
  const restaged = await stageJournal({
    refreshStartedAt: generationG1, signals: [], dailyMarks: [],
  }, { adapter: base, now: new Date('2026-08-27T01:01:00.000Z') });
  assert.equal(published.durableWriteSucceeded, false);
  assert.equal(restaged.durableWriteSucceeded, false);
  releaseCleanupFence();
  assert.equal((await pruning).durableWriteSucceeded, true);
});

test('an unrelated existing cleanup cannot report a requested exact abandonment satisfied', async () => {
  const adapter = memoryJournalAdapter();
  const generationA = '2026-08-27T00:00:00.000Z';
  const generationP = '2026-08-27T01:00:00.000Z';
  const generationG1 = '2026-08-27T02:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:prior-cleanup', '2026-08-26T09:00:00.000Z',
  );
  const failedG1 = signalAt(
    'hyperliquid-account-details:requested-cleanup', '2026-08-26T10:00:00.000Z',
  );
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter, now: new Date(generationA) });
  await publishRows(adapter, { generation: generationP });
  await stageJournal({
    refreshStartedAt: generationG1, signals: [failedG1], dailyMarks: [],
  }, { adapter, now: new Date(generationG1) });
  const publications = adapter.inspect(PUBLICATIONS);
  const current = publications.current;
  const fencedA = {
    ...adapter.inspect(MANIFEST).claims[generationA],
    token: 'claim:00000000-0000-4000-8000-000000000001',
    state: 'writing',
    claimedAt: '2026-08-27T02:01:00.000Z',
    leaseUntil: '2026-08-27T02:03:00.000Z',
  };
  publications.cleanup = {
    staged: { [generationA]: publications.staged[generationA] },
    claims: { [generationA]: fencedA },
    signalIds: { [orphanA.id]: '2026-08-26' },
    dailyMarkIds: {},
  };
  publications.reconciliation = {
    signalIds: { [orphanA.id]: '2026-08-26' }, dailyMarkIds: {},
  };
  adapter.seed(PUBLICATIONS, publications);
  const abandonment = {
    mode: 'exact',
    generation: generationG1,
    evidence: {
      candidateStatus: 'ready',
      current: {
        refreshStartedAt: current.refreshStartedAt,
        snapshotDigest: current.snapshotDigest,
      },
    },
  };

  const first = await pruneJournal({
    now: '2026-08-27T02:01:00.000Z', abandonment,
  }, { adapter });
  assert.equal(first.durableWriteSucceeded, false);
  assert.deepEqual(first.abandonment, {
    ok: false, pending: true, error: 'journal_generation_pending',
  });
  assert.ok(adapter.inspect(PUBLICATIONS).staged[generationG1]);

  const retry = await pruneJournal({
    now: '2026-08-27T02:01:00.000Z', abandonment,
  }, { adapter });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).staged, generationG1), false);
});

test('expired abandonment reconciles a manifest-staged claim missing its publication before changed-row retry', async () => {
  const adapter = memoryJournalAdapter();
  const generationG1 = '2026-08-27T01:00:00.000Z';
  const generationG2 = '2026-08-27T01:13:00.000Z';
  const failedG1 = signalAt(
    'hyperliquid-account-details:pre-publication-crash', '2026-08-26T10:00:00.000Z',
  );
  await stageJournal({
    refreshStartedAt: generationG1, signals: [failedG1], dailyMarks: [],
  }, { adapter, now: new Date(generationG1) });
  const publications = adapter.inspect(PUBLICATIONS);
  delete publications.staged[generationG1];
  adapter.seed(PUBLICATIONS, publications);
  const changedG2 = structuredClone(failedG1);
  changedG2.referencePrice.price += 1;

  const abandoned = await pruneJournal({
    now: '2026-08-27T01:12:00.001Z',
    abandonment: {
      mode: 'expired',
      through: generationG2,
      evidence: { candidateStatus: 'absent', current: null },
    },
  }, { adapter });
  assert.equal(abandoned.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).claims, generationG1), false);
  assert.equal(adapter.inspect(PARTITION), null);

  const retried = await stageJournal({
    refreshStartedAt: generationG2, signals: [changedG2], dailyMarks: [],
  }, { adapter, now: new Date(generationG2) });
  assert.equal(retried.durableWriteSucceeded, true);
  assert.deepEqual(retried.committedSignals, [changedG2]);
});

test('prune removes recent superseded orphan rows but preserves current and newest unresolved work', async () => {
  const adapter = memoryJournalAdapter();
  const generationA = '2026-08-25T12:00:00.000Z';
  const generationB = '2026-08-26T12:00:00.000Z';
  const generationC = '2026-08-27T12:00:00.000Z';
  const orphanA = signalAt('hyperliquid-account-details:orphan-a', '2026-08-25T11:00:00.000Z');
  const acceptedB = signalAt('hyperliquid-account-details:accepted-b', '2026-08-26T11:00:00.000Z');
  const unresolvedC = signalAt('hyperliquid-account-details:unresolved-c', '2026-08-27T11:00:00.000Z');

  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter, now: new Date(generationA) });
  await stageJournal({
    refreshStartedAt: generationB, signals: [acceptedB], dailyMarks: [],
  }, { adapter, now: new Date(generationB) });
  await publishJournalGeneration({
    refreshStartedAt: generationB,
    snapshot: acceptedPrivateSnapshot(generationB, [acceptedB]),
  }, { adapter, now: new Date(generationB) });
  await stageJournal({
    refreshStartedAt: generationC, signals: [unresolvedC], dailyMarks: [],
  }, { adapter, now: new Date(generationC) });

  const result = await pruneJournal({ now: new Date('2026-08-28T00:00:00.000Z') }, { adapter });
  const publications = adapter.inspect(PUBLICATIONS);
  const manifest = adapter.inspect(MANIFEST);
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(Object.keys(publications.staged), [generationC]);
  assert.equal(Object.hasOwn(manifest.signalIds, orphanA.id), false);
  assert.equal(Object.hasOwn(manifest.signalIds, acceptedB.id), true);
  assert.equal(Object.hasOwn(manifest.signalIds, unresolvedC.id), true);
  assert.equal(adapter.inspect('smart-money/v1/journal/2026-08-25.json'), null);

  const recovered = await publishJournalGeneration({
    refreshStartedAt: generationC,
    snapshot: acceptedPrivateSnapshot(generationC, [unresolvedC]),
  }, { adapter, now: new Date('2026-08-28T00:00:00.000Z') });
  assert.equal(recovered.durableWriteSucceeded, true);
  const history = await readJournal({
    since: '2026-08-25T00:00:00.000Z', limit: 10,
  }, { adapter, now: new Date('2026-08-28T00:00:00.000Z') });
  assert.deepEqual(history.signals.map((row) => row.id), [acceptedB.id, unresolvedC.id]);
});

test('prune commits manifest removal before deletion and performs zero deletes on manifest failure', async () => {
  const oldDate = '2025-07-21';
  const oldPath = `smart-money/v1/journal/${oldDate}.json`;
  let deletes = 0;
  const adapter = memoryJournalAdapter({ beforeDelete: async () => { deletes += 1; } });
  const old = signalAt('hyperliquid-account-details:old-prune-failure', `${oldDate}T12:00:00.000Z`);
  await appendJournal({ signals: [old], dailyMarks: [] }, {
    adapter,
    now: new Date('2025-07-22T00:00:00.000Z'),
  });
  adapter.failNext(MANIFEST);
  const result = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') }, { adapter });
  assert.equal(result.durableWriteSucceeded, false);
  assert.equal(deletes, 0);
  assert.ok(adapter.inspect(oldPath));
  assert.deepEqual(adapter.inspect(MANIFEST).partitions, [oldDate]);
});

test('a stale pruner cannot mutate mappings after its maintenance token is rotated', async () => {
  const oldDate = '2025-07-21';
  const oldPath = `smart-money/v1/journal/${oldDate}.json`;
  const base = memoryJournalAdapter();
  const old = signalAt(
    'hyperliquid-account-details:stale-maintenance', `${oldDate}T12:00:00.000Z`,
  );
  await appendJournal({ signals: [old], dailyMarks: [] }, {
    adapter: base,
    now: new Date('2025-07-22T00:00:00.000Z'),
  });
  let announceRemoval;
  let releaseRemoval;
  let blockRemoval = true;
  let staleDeletes = 0;
  const removalReached = new Promise((resolve) => { announceRemoval = resolve; });
  const removalRelease = new Promise((resolve) => { releaseRemoval = resolve; });
  const staleAdapter = {
    ...base,
    async write(pathname, data, expectedEtag) {
      if (blockRemoval && pathname === MANIFEST && data.maintenance !== null
          && !data.partitions.includes(oldDate)) {
        blockRemoval = false;
        announceRemoval();
        await removalRelease;
      }
      return base.write(pathname, data, expectedEtag);
    },
    async delete(pathname, expectedEtag) {
      staleDeletes += 1;
      return base.delete(pathname, expectedEtag);
    },
  };
  const stalePrune = pruneJournal({
    now: new Date('2026-08-26T12:00:00.000Z'),
  }, { adapter: staleAdapter });
  await removalReached;

  const replacement = await pruneJournal({
    now: new Date('2026-08-26T12:12:00.001Z'),
  }, { adapter: base });
  assert.equal(replacement.durableWriteSucceeded, true);
  releaseRemoval();
  const stale = await stalePrune;

  assert.equal(stale.durableWriteSucceeded, false);
  assert.equal(staleDeletes, 0);
  assert.equal(base.inspect(oldPath), null);
  assert.equal(Object.hasOwn(base.inspect(MANIFEST).signalIds, old.id), false);
});

test('prune removes old orphan blobs, tolerates missing partitions, and preserves cutoff/newer paths', async () => {
  const adapter = memoryJournalAdapter();
  const missingDate = '2025-07-20';
  const oldDate = '2025-07-21';
  const cutoffDate = '2025-07-22';
  const newerDate = '2026-08-26';
  const oldPath = `smart-money/v1/journal/${oldDate}.json`;
  const cutoffPath = `smart-money/v1/journal/${cutoffDate}.json`;
  const newerPath = `smart-money/v1/journal/${newerDate}.json`;
  const invalidDatePath = 'smart-money/v1/journal/2025-13-40.json';
  adapter.seed(MANIFEST, {
    schemaVersion: 1,
    partitions: [missingDate],
    signalIds: { 'hyperliquid-account-details:missing-old': missingDate },
    dailyMarkIds: {},
  });
  adapter.seed(oldPath, {
    schemaVersion: 1, date: oldDate,
    signals: [signalAt('hyperliquid-account-details:orphan-old', `${oldDate}T12:00:00.000Z`)],
    dailyMarks: [],
  });
  adapter.seed(cutoffPath, { schemaVersion: 1, date: cutoffDate, signals: [], dailyMarks: [] });
  adapter.seed(newerPath, { schemaVersion: 1, date: newerDate, signals: [], dailyMarks: [] });
  adapter.seed(invalidDatePath, { private: 'unrecognized-shape' });

  const result = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') }, { adapter });
  assert.equal(result.durableWriteSucceeded, true);
  assert.equal(adapter.inspect(oldPath), null);
  assert.ok(adapter.inspect(cutoffPath));
  assert.ok(adapter.inspect(newerPath));
  assert.ok(adapter.inspect(invalidDatePath));
  assert.deepEqual(adapter.inspect(MANIFEST).partitions, []);
});

test('prune reports delete and stale-ETag failures after authoritative manifest removal', async () => {
  const oldDate = '2025-07-21';
  const deleteFailurePath = `smart-money/v1/journal/${oldDate}.json`;
  const deleteFailureAdapter = memoryJournalAdapter();
  deleteFailureAdapter.seed(deleteFailurePath, {
    schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [],
  });
  deleteFailureAdapter.failNextDelete(deleteFailurePath);
  const deleteFailure = await pruneJournal(
    { now: new Date('2026-08-26T12:00:00.000Z') },
    { adapter: deleteFailureAdapter },
  );
  assert.equal(deleteFailure.durableWriteSucceeded, false);
  assert.deepEqual(deleteFailureAdapter.inspect(MANIFEST).partitions, []);
  assert.ok(deleteFailureAdapter.inspect(deleteFailurePath));

  let staleAdapter;
  let mutated = false;
  staleAdapter = memoryJournalAdapter({
    beforeDelete: async ({ pathname }) => {
      if (!mutated) {
        mutated = true;
        staleAdapter.seed(pathname, {
          schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [],
        });
      }
    },
  });
  staleAdapter.seed(deleteFailurePath, {
    schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [],
  });
  const stale = await pruneJournal(
    { now: new Date('2026-08-26T12:00:00.000Z') },
    { adapter: staleAdapter },
  );
  assert.equal(stale.durableWriteSucceeded, false);
  assert.ok(staleAdapter.inspect(deleteFailurePath));
});

test('production Blob pruning forwards the just-read partition ETag to conditional delete', () => {
  const journalModuleUrl = new URL('../lib/smart-money/journal.js', import.meta.url).href;
  const probe = String.raw`
    import { mock } from 'node:test';

    const manifestPath = 'smart-money/v1/journal/manifest.json';
    const oldDate = '2025-07-21';
    const oldPath = 'smart-money/v1/journal/2025-07-21.json';
    let nextEtag = 1;
    const deleteAttempts = [];
    let deleteCalls = 0;
    let replaceStaleRead = false;
    const records = new Map([
      [manifestPath, {
        data: {
          schemaVersion: 1,
          partitions: [oldDate],
          signalIds: {},
          dailyMarkIds: {},
        },
        etag: 'manifest-etag',
      }],
      [oldPath, {
        data: { schemaVersion: 1, date: oldDate, signals: [], dailyMarks: [] },
        etag: 'partition-etag',
      }],
    ]);
    class BlobNotFoundError extends Error {}
    class BlobPreconditionFailedError extends Error {}
    function blobResult(record) {
      return {
        stream: new Blob([JSON.stringify(record.data)]).stream(),
        blob: { etag: record.etag },
      };
    }
    await mock.module('@vercel/blob', {
      namedExports: {
        BlobNotFoundError,
        BlobPreconditionFailedError,
        async get(pathname) {
          const record = records.get(pathname);
          if (!record) throw new BlobNotFoundError('missing');
          const result = blobResult(record);
          if (replaceStaleRead && pathname === 'smart-money/v1/journal/2025-07-18.json') {
            replaceStaleRead = false;
            records.set(pathname, { ...record, etag: 'stale-replacement-etag' });
          }
          return result;
        },
        async put(pathname, body, options) {
          const current = records.get(pathname);
          if (current?.etag !== options.ifMatch) {
            throw new BlobPreconditionFailedError('private stale manifest secret');
          }
          records.set(pathname, {
            data: JSON.parse(body),
            etag: 'manifest-next-' + nextEtag++,
          });
        },
        async del(pathname, options) {
          deleteCalls += 1;
          deleteAttempts.push({ pathname, options });
          const current = records.get(pathname);
          if (!current || options?.ifMatch !== current.etag) {
            throw new BlobPreconditionFailedError('private stale delete secret');
          }
          records.delete(pathname);
        },
        async list() {
          return {
            blobs: [...records.keys()].map((pathname) => ({ pathname })),
            hasMore: false,
            cursor: null,
          };
        },
      },
    });
    const { pruneJournal } = await import(process.env.JOURNAL_MODULE_URL);
    const result = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    const stalePath = 'smart-money/v1/journal/2025-07-18.json';
    records.set(stalePath, {
      data: { schemaVersion: 1, date: '2025-07-18', signals: [], dailyMarks: [] },
      etag: 'stale-read-etag',
    });
    replaceStaleRead = true;
    const staleResult = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    const stalePartitionExists = records.has(stalePath);
    records.delete(stalePath);
    const missingEtagPath = 'smart-money/v1/journal/2025-07-20.json';
    records.set(missingEtagPath, {
      data: { schemaVersion: 1, date: '2025-07-20', signals: [], dailyMarks: [] },
      etag: null,
    });
    const missingEtagResult = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    const missingEtagPartitionExists = records.has(missingEtagPath);
    records.delete(missingEtagPath);
    const invalidEtagPath = 'smart-money/v1/journal/2025-07-19.json';
    records.set(invalidEtagPath, {
      data: { schemaVersion: 1, date: '2025-07-19', signals: [], dailyMarks: [] },
      etag: 42,
    });
    const invalidEtagResult = await pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') });
    process.stdout.write(JSON.stringify({
      result,
      deleteAttempts,
      deleteCalls,
      oldPartitionExists: records.has(oldPath),
      staleResult,
      stalePartitionExists,
      missingEtagResult,
      missingEtagPartitionExists,
      invalidEtagResult,
      invalidEtagPartitionExists: records.has(invalidEtagPath),
    }));
  `;
  const child = spawnSync(process.execPath, [
    '--experimental-test-module-mocks',
    '--input-type=module',
    '--eval',
    probe,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      BLOB_READ_WRITE_TOKEN: 'private-test-token',
      JOURNAL_MODULE_URL: journalModuleUrl,
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.result.durableWriteSucceeded, true);
  assert.deepEqual(observed.deleteAttempts, [
    {
      pathname: 'smart-money/v1/journal/2025-07-21.json',
      options: { access: 'private', ifMatch: 'partition-etag' },
    },
    {
      pathname: 'smart-money/v1/journal/2025-07-18.json',
      options: { access: 'private', ifMatch: 'stale-read-etag' },
    },
  ]);
  assert.equal(observed.deleteCalls, 2);
  assert.equal(observed.oldPartitionExists, false);
  assert.equal(observed.staleResult.durableWriteSucceeded, false);
  assert.deepEqual(observed.staleResult.partitions, [
    { date: '2025-07-18', ok: false, error: 'partition_delete_failed' },
  ]);
  assert.equal(observed.stalePartitionExists, true);
  assert.equal(observed.missingEtagResult.durableWriteSucceeded, false);
  assert.equal(observed.missingEtagPartitionExists, true);
  assert.equal(observed.invalidEtagResult.durableWriteSucceeded, false);
  assert.equal(observed.invalidEtagPartitionExists, true);
  assert.equal(JSON.stringify(observed.result).includes('private'), false);
  assert.equal(JSON.stringify(observed.staleResult).includes('private'), false);
  assert.equal(JSON.stringify(observed.missingEtagResult).includes('private'), false);
  assert.equal(JSON.stringify(observed.invalidEtagResult).includes('private'), false);
});

test('journal append returns its exact sanitized failure contract when storage is unavailable', async () => {
  const unavailableAdapter = {
    async read() { throw new Error('https://blob.test/?token=raw-secret'); },
    async write() { throw new Error('must not write'); },
    isConflict() { return false; },
  };
  const unavailable = await appendJournal({ signals: [], dailyMarks: [] }, {
    adapter: unavailableAdapter,
  });
  assert.deepEqual(Object.keys(unavailable).sort(), [
    'committedDailyMarks', 'committedSignals', 'durableWriteSucceeded', 'manifest', 'partitions',
  ]);
  assert.equal(unavailable.durableWriteSucceeded, false);
  assert.equal(JSON.stringify(unavailable).includes('raw-secret'), false);

  const env = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    COMMS_DASHBOARD_READ_WRITE_TOKEN: process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN,
    BLOB_STORE_ID: process.env.BLOB_STORE_ID,
  };
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.COMMS_DASHBOARD_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;
  try {
    const unconfigured = await appendJournal({ signals: [], dailyMarks: [] });
    assert.equal(unconfigured.durableWriteSucceeded, false);
    assert.equal(unconfigured.manifest.error, 'journal_configuration_invalid');
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('journal rejects unsafe shapes, duplicate and type-colliding IDs, and cross-day marks', async () => {
  const adapter = memoryJournalAdapter();
  const unsafe = {};
  Object.defineProperty(unsafe, 'signals', { enumerable: true, get: () => { throw new Error('getter ran'); } });
  Object.defineProperty(unsafe, 'dailyMarks', { enumerable: true, value: [] });
  await assert.rejects(appendJournal(unsafe, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({ signals: [SIGNAL, SIGNAL], dailyMarks: [] }, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [], dailyMarks: [{ ...dailyMark(), id: '2026-08-25:BTC' }],
  }, { adapter }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [{ ...SIGNAL, id: '2026-08-26:BTC' }], dailyMarks: [dailyMark()],
  }, { adapter }), /schema_invalid/);
});

test('journal rejects future signals and marks from an incomplete UTC day', async () => {
  const adapter = memoryJournalAdapter();
  const now = new Date('2026-08-26T00:00:00.000Z');
  await assert.rejects(appendJournal({
    signals: [signalAt('hyperliquid-account-details:future', '2026-08-26T01:00:00.000Z')],
    dailyMarks: [],
  }, { adapter, now }), /schema_invalid/);
  await assert.rejects(appendJournal({
    signals: [],
    dailyMarks: [dailyMark('2026-08-26', 'BTC')],
  }, { adapter, now: new Date('2026-08-26T23:59:59.999Z') }), /schema_invalid/);
});

test('journal rejects stored rows placed in the wrong UTC-day partition', async () => {
  const adapter = memoryJournalAdapter();
  const accepted = acceptedPrivateSnapshot(GENERATION, [SIGNAL]);
  adapter.seed(MANIFEST, {
    schemaVersion: 1,
    partitions: ['2026-08-26'],
    signalIds: { [SIGNAL.id]: '2026-08-26' },
    dailyMarkIds: {},
  });
  adapter.seed(PARTITION, {
    schemaVersion: 1,
    date: '2026-08-26',
    signals: [signalAt('hyperliquid-account-details:wrong-day', '2026-08-25T23:59:59.000Z')],
    dailyMarks: [],
  });
  adapter.seed(PUBLICATIONS, acceptedPublicationRecord(accepted));
  await assert.rejects(readJournal({ since: '2026-08-26T00:00:00.000Z', limit: 10 }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  }), /schema_invalid/);
});

test('history is inclusive, bounded, exact, and pages equal timestamps by stable ID', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt('hyperliquid-account-details:a', '2026-08-26T01:00:00.000Z');
  const second = signalAt('hyperliquid-account-details:b', '2026-08-26T01:00:00.000Z');
  await publishRows(adapter, { signals: [second, first], dailyMarks: [dailyMark()] });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };
  const pageOne = await readJournal({ since: first.observedAt, limit: 1 }, options);
  assert.deepEqual(Object.keys(pageOne), [
    'schemaVersion', 'ok', 'fetchedAt', 'partial', 'since', 'through', 'entities', 'signals',
    'dailyMarks', 'nextCursor', 'providerStatuses', 'warnings', 'sourceLinks',
  ]);
  assert.deepEqual(pageOne.signals.map((row) => row.id), [first.id]);
  assert.deepEqual(pageOne.dailyMarks, []);
  assert.equal(typeof pageOne.nextCursor, 'string');
  const pageTwo = await readJournal({ since: first.observedAt, limit: 1, cursor: pageOne.nextCursor }, options);
  assert.deepEqual(pageTwo.signals.map((row) => row.id), [second.id]);
  assert.deepEqual(pageTwo.dailyMarks, []);
  assert.equal(typeof pageTwo.nextCursor, 'string');
  const pageThree = await readJournal({ since: first.observedAt, limit: 1, cursor: pageTwo.nextCursor }, options);
  assert.deepEqual(pageThree.signals, []);
  assert.deepEqual(pageThree.dailyMarks.map((row) => row.id), ['2026-08-26:BTC']);
  assert.equal(pageThree.nextCursor, null);

  for (const query of [
    { since: first.observedAt, limit: 0 },
    { since: first.observedAt, limit: 501 },
    { since: '2025-07-22T23:59:59.999Z', limit: 1 },
    { since: first.observedAt, limit: 1, cursor: 'not-an-opaque-cursor' },
  ]) {
    await assert.rejects(readJournal(query, options), /schema_invalid/);
  }
});

test('history selects the exact manifest date range before partition reads', async () => {
  const base = memoryJournalAdapter();
  const date = '2026-08-26';
  const mark = dailyMark(date, 'BTC');
  const generation = '2026-08-27T00:00:00.000Z';
  await publishRows(base, { dailyMarks: [mark], generation });
  const partitions = [];
  for (let offset = 398; offset >= 0; offset -= 1) {
    const partitionDate = new Date(Date.parse(`${date}T00:00:00.000Z`) - offset * 86_400_000)
      .toISOString().slice(0, 10);
    partitions.push(partitionDate);
    if (partitionDate !== date) {
      base.seed(`smart-money/v1/journal/${partitionDate}.json`, {
        schemaVersion: 1, date: partitionDate, signals: [], dailyMarks: [],
      });
    }
  }
  base.seed(MANIFEST, {
    schemaVersion: 1,
    partitions,
    signalIds: {},
    dailyMarkIds: { [mark.id]: date },
  });
  const reads = [];
  const adapter = {
    ...base,
    async read(pathname) {
      reads.push(pathname);
      return base.read(pathname);
    },
  };

  const history = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 10,
  }, { adapter, now: new Date('2026-08-27T00:00:00.000Z') });

  assert.deepEqual(history.dailyMarks.map((row) => row.id), [mark.id]);
  assert.deepEqual(reads.filter((pathname) => pathname.startsWith('smart-money/v1/journal/202')),
    [PARTITION]);
});

test('history limit bounds one combined stream even with one thousand daily marks', async () => {
  const adapter = memoryJournalAdapter();
  const marks = Array.from({ length: 1_000 }, (_, index) => (
    dailyMark('2026-08-26', `T${String(index).padStart(4, '0')}`)
  ));
  await publishRows(adapter, { dailyMarks: marks });
  const options = { adapter, now: new Date('2026-08-27T00:00:00.000Z') };

  const first = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 1,
  }, options);
  assert.equal(first.signals.length + first.dailyMarks.length, 1);
  assert.equal(typeof first.nextCursor, 'string');
  const second = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 1, cursor: first.nextCursor,
  }, options);
  assert.equal(second.signals.length + second.dailyMarks.length, 1);
  assert.notEqual(second.dailyMarks[0].id, first.dailyMarks[0].id);
});

test('history compares daily marks against the exact inclusive since instant', async () => {
  const adapter = memoryJournalAdapter();
  const early = dailyMark('2026-08-26', 'ETH', '2026-08-26T20:00:00.000Z');
  const late = dailyMark('2026-08-26', 'SOL', '2026-08-26T23:30:00.000Z');
  await publishRows(adapter, { dailyMarks: [early, late] });

  const history = await readJournal({
    since: '2026-08-26T23:00:00.000Z', limit: 10,
  }, { adapter, now: new Date('2026-08-27T00:00:00.000Z') });

  assert.deepEqual(history.dailyMarks.map((row) => row.id), [late.id]);
});

test('history cursor freezes through and excludes concurrent later observations', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt('hyperliquid-account-details:through-a', '2026-08-26T10:00:00.000Z');
  const second = signalAt('hyperliquid-account-details:through-b', '2026-08-26T11:00:00.000Z');
  await publishRows(adapter, {
    signals: [first, second], generation: '2026-08-26T11:30:00.000Z',
  });
  const pageOne = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 1,
  }, { adapter, now: new Date('2026-08-26T12:00:00.000Z') });
  assert.equal(pageOne.through, '2026-08-26T12:00:00.000Z');

  const concurrent = signalAt(
    'hyperliquid-account-details:through-c', '2026-08-26T12:30:00.000Z',
  );
  await publishRows(adapter, {
    signals: [concurrent], generation: '2026-08-26T13:00:00.000Z',
  });
  const pageTwo = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 10, cursor: pageOne.nextCursor,
  }, { adapter, now: new Date('2026-08-26T14:00:00.000Z') });

  assert.equal(pageTwo.through, pageOne.through);
  assert.deepEqual(pageTwo.signals.map((row) => row.id), [second.id]);
  assert.equal(pageTwo.signals.some((row) => row.id === concurrent.id), false);
  assert.equal(pageTwo.nextCursor, null);
});

test('history cursor freezes the accepted publication generation against later backdated rows', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt(
    'hyperliquid-account-details:generation-a', '2026-08-26T10:00:00.000Z',
  );
  const second = signalAt(
    'hyperliquid-account-details:generation-b', '2026-08-26T11:00:00.000Z',
  );
  await publishRows(adapter, {
    signals: [first, second], generation: '2026-08-26T11:30:00.000Z',
  });
  const pageOne = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 1,
  }, { adapter, now: new Date('2026-08-26T12:00:00.000Z') });
  assert.deepEqual(pageOne.signals.map((row) => row.id), [first.id]);

  const backdated = signalAt(
    'hyperliquid-account-details:generation-c', '2026-08-26T10:30:00.000Z',
  );
  await publishRows(adapter, {
    signals: [backdated], generation: '2026-08-26T13:00:00.000Z',
  });
  const pageTwo = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 10, cursor: pageOne.nextCursor,
  }, { adapter, now: new Date('2026-08-26T14:00:00.000Z') });

  assert.equal(pageTwo.through, pageOne.through);
  assert.deepEqual(pageTwo.signals.map((row) => row.id), [second.id]);
  assert.equal(pageTwo.signals.some((row) => row.id === backdated.id), false);
});

test('history rejects a cursor publication watermark newer than the accepted generation', async () => {
  const adapter = memoryJournalAdapter();
  const first = signalAt(
    'hyperliquid-account-details:watermark-bound-a', '2026-08-26T10:00:00.000Z',
  );
  const second = signalAt(
    'hyperliquid-account-details:watermark-bound-b', '2026-08-26T11:00:00.000Z',
  );
  await publishRows(adapter, {
    signals: [first, second], generation: '2026-08-26T11:30:00.000Z',
  });
  const pageOne = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 1,
  }, { adapter, now: new Date('2026-08-26T12:00:00.000Z') });
  const payload = JSON.parse(Buffer.from(pageOne.nextCursor, 'base64url').toString('utf8'));
  payload.publicationThrough = '2026-08-26T11:45:00.000Z';
  const cursor = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

  await assert.rejects(readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 10, cursor,
  }, { adapter, now: new Date('2026-08-26T12:00:00.000Z') }), /schema_invalid/);
});

test('history cursor survives compaction of its empty accepted-generation watermark', async () => {
  const adapter = memoryJournalAdapter();
  const generationOne = '2026-08-27T10:00:00.000Z';
  const generationTwo = '2026-08-27T11:00:00.000Z';
  const generationThree = '2026-08-27T12:00:00.000Z';
  const first = signalAt(
    'hyperliquid-account-details:watermark-a', '2026-08-26T08:00:00.000Z',
  );
  const second = signalAt(
    'hyperliquid-account-details:watermark-b', '2026-08-26T09:00:00.000Z',
  );
  await publishRows(adapter, { signals: [first, second], generation: generationOne });
  await publishRows(adapter, { generation: generationTwo });
  const pageOne = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 1,
  }, { adapter, now: new Date('2026-08-27T11:30:00.000Z') });
  assert.deepEqual(pageOne.signals.map((row) => row.id), [first.id]);

  await publishRows(adapter, { generation: generationThree });
  const pruned = await pruneJournal({
    now: new Date('2026-08-27T13:00:00.000Z'),
  }, { adapter });
  assert.equal(pruned.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).published, generationTwo), false);

  const pageTwo = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 10, cursor: pageOne.nextCursor,
  }, { adapter, now: new Date('2026-08-27T14:00:00.000Z') });

  assert.deepEqual(pageTwo.signals.map((row) => row.id), [second.id]);
  assert.equal(pageTwo.nextCursor, null);
});

test('history resumes partition reads from the cursor UTC date', async () => {
  const base = memoryJournalAdapter();
  const first = signalAt(
    'hyperliquid-account-details:range-a', '2026-08-24T10:00:00.000Z',
  );
  const second = signalAt(
    'hyperliquid-account-details:range-b', '2026-08-25T10:00:00.000Z',
  );
  const third = signalAt(
    'hyperliquid-account-details:range-c', '2026-08-26T10:00:00.000Z',
  );
  await publishRows(base, {
    signals: [first, second, third], generation: '2026-08-26T11:00:00.000Z',
  });
  let rejectOldPartition = false;
  const adapter = {
    ...base,
    async read(pathname) {
      if (rejectOldPartition && pathname === 'smart-money/v1/journal/2026-08-24.json') {
        throw new Error('cursor page reread an already-consumed partition');
      }
      return base.read(pathname);
    },
  };
  const pageOne = await readJournal({
    since: '2026-08-24T00:00:00.000Z', limit: 2,
  }, { adapter, now: new Date('2026-08-27T00:00:00.000Z') });
  assert.deepEqual(pageOne.signals.map((row) => row.id), [first.id, second.id]);
  rejectOldPartition = true;

  const pageTwo = await readJournal({
    since: '2026-08-24T00:00:00.000Z', limit: 2, cursor: pageOne.nextCursor,
  }, { adapter, now: new Date('2026-08-27T00:00:00.000Z') });

  assert.deepEqual(pageTwo.signals.map((row) => row.id), [third.id]);
});

test('history ignores a missing partition referenced only by an unpublished stage', async () => {
  const base = memoryJournalAdapter();
  const accepted = signalAt(
    'hyperliquid-account-details:accepted-partition', '2026-08-26T10:00:00.000Z',
  );
  await publishRows(base, {
    signals: [accepted], generation: '2026-08-27T00:00:00.000Z',
  });
  const unresolved = signalAt(
    'hyperliquid-account-details:unpublished-partition', '2026-08-25T10:00:00.000Z',
  );
  const staged = await stageJournal({
    refreshStartedAt: '2026-08-27T01:00:00.000Z', signals: [unresolved], dailyMarks: [],
  }, { adapter: base, now: new Date('2026-08-27T01:00:00.000Z') });
  assert.equal(staged.durableWriteSucceeded, true);
  const adapter = {
    ...base,
    async read(pathname) {
      if (pathname === 'smart-money/v1/journal/2026-08-25.json') {
        return { data: null, etag: null };
      }
      return base.read(pathname);
    },
  };

  const history = await readJournal({
    since: '2026-08-25T00:00:00.000Z', limit: 10,
  }, { adapter, now: new Date('2026-08-27T02:00:00.000Z') });

  assert.deepEqual(history.signals.map((row) => row.id), [accepted.id]);
});

test('tracked tickers use retained supported assets and exclude unsupported research rows', async () => {
  const adapter = memoryJournalAdapter();
  const eth = signalAt('hyperliquid-account-details:eth', '2026-08-26T02:00:00.000Z', 'ETH');
  const unsupported = {
    ...signalAt('sec-edgar:research', '2026-08-26T03:00:00.000Z', 'ABC'),
    providerId: 'sec-edgar',
    entityId: 'situational-awareness-lp',
    kind: 'holding_change',
    action: 'observe',
    asset: { ticker: null, name: 'Research only', providerSymbol: 'ABC', assetClass: 'equity', supported: false },
    direction: null,
    magnitude: { value: 1_000_000, unit: 'reported_value_usd' },
    positionChange: null,
    disclosedAt: '2026-08-26T03:00:00.000Z',
    effectiveAt: '2026-08-25T03:00:00.000Z',
    delaySeconds: 86_400,
    paperEligibility: { eligible: false, reason: 'unsupported_asset' },
    referencePrice: null,
  };
  await publishRows(adapter, { signals: [eth, unsupported], dailyMarks: [] });
  const tickers = await listTrackedTickers({ since: '2026-08-26T00:00:00.000Z' }, {
    adapter,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });
  assert.deepEqual(tickers, ['ETH']);
});

test('prune removes only expired partitions and a stale manifest ETag cannot erase a concurrent newer date', async () => {
  let armPrune = false;
  let blocked = false;
  let announceBlocked;
  let releasePrune;
  const pruneBlocked = new Promise((resolve) => { announceBlocked = resolve; });
  const pruneRelease = new Promise((resolve) => { releasePrune = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (armPrune && !blocked && pathname === MANIFEST && data.maintenance !== null) {
        blocked = true;
        announceBlocked();
        await pruneRelease;
      }
    },
  });
  const old = signalAt('hyperliquid-account-details:old', '2025-07-21T12:00:00.000Z');
  await appendJournal({ signals: [old], dailyMarks: [] }, {
    adapter,
    now: new Date('2025-07-23T00:00:00.000Z'),
  });
  armPrune = true;
  const pruning = pruneJournal({ now: new Date('2026-08-26T12:00:00.000Z') }, { adapter });
  await pruneBlocked;
  const recent = signalAt('hyperliquid-account-details:recent', '2026-08-26T10:00:00.000Z');
  const appended = await appendJournal({ signals: [recent], dailyMarks: [] }, {
    adapter,
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  assert.equal(appended.durableWriteSucceeded, true);
  releasePrune();
  const result = await pruning;
  const manifest = adapter.inspect(MANIFEST);
  assert.equal(result.durableWriteSucceeded, true);
  assert.deepEqual(manifest.partitions, ['2026-08-26']);
  assert.equal(manifest.signalIds[recent.id], '2026-08-26');
  assert.equal(adapter.inspect('smart-money/v1/journal/2025-07-21.json'), null);
});

test('legacy append cannot add a manifest mapping while prune owns maintenance', async () => {
  const base = memoryJournalAdapter();
  const generationA = '2026-08-27T01:00:00.000Z';
  const generationB = '2026-08-27T02:00:00.000Z';
  const orphan = signalAt(
    'hyperliquid-account-details:legacy-maintenance-orphan', '2026-08-26T10:00:00.000Z',
  );
  const contender = signalAt(
    'hyperliquid-account-details:legacy-maintenance-contender', '2026-08-26T11:00:00.000Z',
  );
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphan], dailyMarks: [],
  }, { adapter: base, now: new Date(generationA) });
  await stageJournal({
    refreshStartedAt: generationB, signals: [], dailyMarks: [],
  }, { adapter: base, now: new Date(generationB) });
  await publishJournalGeneration({
    refreshStartedAt: generationB,
    snapshot: acceptedPrivateSnapshot(generationB, []),
  }, { adapter: base, now: new Date(generationB) });

  let blocked = false;
  let announceBlocked;
  let releasePrune;
  const pruneBlocked = new Promise((resolve) => { announceBlocked = resolve; });
  const pruneRelease = new Promise((resolve) => { releasePrune = resolve; });
  const adapter = {
    ...base,
    async read(pathname) {
      const manifest = base.inspect(MANIFEST);
      if (!blocked && pathname === PARTITION && manifest?.maintenance !== null
          && !Object.hasOwn(manifest.signalIds, orphan.id)) {
        blocked = true;
        announceBlocked();
        await pruneRelease;
      }
      return base.read(pathname);
    },
  };

  const pruning = pruneJournal({ now: '2026-08-27T04:00:00.000Z' }, { adapter });
  await pruneBlocked;
  const appended = await appendJournal({ signals: [contender], dailyMarks: [] }, {
    adapter,
    now: new Date('2026-08-27T04:00:00.000Z'),
  });
  assert.equal(appended.durableWriteSucceeded, false);
  assert.equal(appended.manifest.error, 'manifest_collision');
  releasePrune();

  const pruned = await pruning;
  assert.equal(pruned.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(base.inspect(MANIFEST).signalIds, contender.id), false);
  assert.equal(base.inspect(PARTITION), null);
});

test('prune cannot erase a daily mark reused by a concurrently staged newer generation', async () => {
  const mark = dailyMark();
  const generationA = '2026-08-27T01:00:00.000Z';
  const generationB = '2026-08-27T02:00:00.000Z';
  const generationC = '2026-08-27T03:00:00.000Z';
  let armPrune = false;
  let blocked = false;
  let announceBlocked;
  let releasePrune;
  const pruneBlocked = new Promise((resolve) => { announceBlocked = resolve; });
  const pruneRelease = new Promise((resolve) => { releasePrune = resolve; });
  const adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (armPrune && !blocked && pathname === MANIFEST
          && !Object.hasOwn(data.dailyMarkIds, mark.id)) {
        blocked = true;
        announceBlocked();
        await pruneRelease;
      }
    },
  });
  await stageJournal({
    refreshStartedAt: generationA, signals: [], dailyMarks: [mark],
  }, { adapter, now: new Date(generationA) });
  await stageJournal({
    refreshStartedAt: generationB, signals: [], dailyMarks: [],
  }, { adapter, now: new Date(generationB) });
  await publishJournalGeneration({
    refreshStartedAt: generationB,
    snapshot: acceptedPrivateSnapshot(generationB, []),
  }, { adapter, now: new Date(generationB) });

  armPrune = true;
  const pruning = pruneJournal({ now: new Date('2026-08-27T04:00:00.000Z') }, { adapter });
  await pruneBlocked;
  const stagedC = await stageJournal({
    refreshStartedAt: generationC, signals: [], dailyMarks: [mark],
  }, { adapter, now: new Date(generationC) });
  assert.equal(stagedC.durableWriteSucceeded, false);
  releasePrune();
  const pruned = await pruning;
  assert.equal(pruned.durableWriteSucceeded, true);

  const retriedC = await stageJournal({
    refreshStartedAt: generationC, signals: [], dailyMarks: [mark],
  }, { adapter, now: new Date(generationC) });
  assert.equal(retriedC.durableWriteSucceeded, true);

  const publishedC = await publishJournalGeneration({
    refreshStartedAt: generationC,
    snapshot: acceptedPrivateSnapshot(generationC, []),
  }, { adapter, now: new Date('2026-08-27T04:00:00.000Z') });
  assert.equal(publishedC.durableWriteSucceeded, true);
  const history = await readJournal({
    since: '2026-08-26T00:00:00.000Z', limit: 10,
  }, { adapter, now: new Date('2026-08-27T04:00:00.000Z') });
  assert.deepEqual(history.dailyMarks.map((row) => row.id), [mark.id]);
});

test('a stale-generation restage cannot recreate an orphan after cleanup passes its fence', async () => {
  const base = memoryJournalAdapter();
  const generationP = '2026-08-28T00:00:00.000Z';
  const generationA = '2026-08-28T01:00:00.000Z';
  const generationB = '2026-08-28T02:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:stale-restage', '2026-08-26T10:00:00.000Z',
  );
  const movedA = signalAt(orphanA.id, '2026-08-27T10:00:00.000Z');
  await publishRows(base, { generation: generationP });
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter: base, now: new Date(generationA) });

  let announceRetryRead;
  let releaseRetryRead;
  let blockRetry = true;
  const retryRead = new Promise((resolve) => { announceRetryRead = resolve; });
  const retryRelease = new Promise((resolve) => { releaseRetryRead = resolve; });
  const adapter = {
    ...base,
    async read(pathname) {
      const record = await base.read(pathname);
      if (blockRetry && pathname === PUBLICATIONS) {
        blockRetry = false;
        announceRetryRead();
        await retryRelease;
      }
      return record;
    },
  };
  const retrying = stageJournal({
    refreshStartedAt: generationA, signals: [movedA], dailyMarks: [],
  }, { adapter, now: new Date('2026-08-28T03:00:00.000Z') });
  await retryRead;

  await publishRows(base, { generation: generationB });
  const pruned = await pruneJournal({
    now: new Date('2026-08-28T03:00:00.000Z'),
  }, { adapter: base });
  assert.equal(pruned.durableWriteSucceeded, true);
  releaseRetryRead();
  const retried = await retrying;

  assert.equal(retried.durableWriteSucceeded, false);
  assert.equal(Object.hasOwn(base.inspect(MANIFEST).signalIds, orphanA.id), false);
  assert.equal(base.inspect('smart-money/v1/journal/2026-08-27.json'), null);
  assert.equal(Object.hasOwn(base.inspect(PUBLICATIONS).staged, generationA), false);
  assert.equal(Object.hasOwn(base.inspect(PUBLICATIONS), 'cleanup'), false);
});

test('same-generation row reread rechecks manifest and publication authority after cleanup', async () => {
  const base = memoryJournalAdapter();
  const generationP = '2026-08-28T00:00:00.000Z';
  const generationA = '2026-08-28T01:00:00.000Z';
  const generationB = '2026-08-28T02:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:reread-authority', '2026-08-26T10:00:00.000Z',
  );
  await publishRows(base, { generation: generationP });
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter: base, now: new Date(generationA) });

  let announceRowRead;
  let releaseRowRead;
  let blockRowRead = true;
  const rowRead = new Promise((resolve) => { announceRowRead = resolve; });
  const rowRelease = new Promise((resolve) => { releaseRowRead = resolve; });
  const adapter = {
    ...base,
    async read(pathname) {
      const record = await base.read(pathname);
      if (blockRowRead && pathname === PARTITION) {
        blockRowRead = false;
        announceRowRead();
        await rowRelease;
      }
      return record;
    },
  };
  const rereading = stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter, now: new Date('2026-08-28T03:00:00.000Z') });
  await rowRead;

  await publishRows(base, { generation: generationB });
  const pruned = await pruneJournal({
    now: new Date('2026-08-28T03:00:00.000Z'),
  }, { adapter: base });
  assert.equal(pruned.durableWriteSucceeded, true);
  releaseRowRead();
  const reread = await rereading;

  assert.equal(reread.durableWriteSucceeded, false);
  assert.equal(Object.hasOwn(base.inspect(MANIFEST).signalIds, orphanA.id), false);
  assert.equal(Object.hasOwn(base.inspect(PUBLICATIONS).staged, generationA), false);
});

test('a durable pre-append claim prevents prune from deleting a concurrent new generation', async () => {
  let announcePrunePartitionRead;
  let releasePrunePartitionRead;
  let blockPrunePartitionRead = true;
  const prunePartitionRead = new Promise((resolve) => { announcePrunePartitionRead = resolve; });
  const prunePartitionRelease = new Promise((resolve) => { releasePrunePartitionRead = resolve; });
  const base = memoryJournalAdapter();
  const generationA = '2026-08-27T01:00:00.000Z';
  const generationB = '2026-08-27T02:00:00.000Z';
  const generationC = '2026-08-27T03:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:claim-race-a', '2026-08-26T10:00:00.000Z',
  );
  const concurrentC = signalAt(
    'hyperliquid-account-details:claim-race-c', '2026-08-26T11:00:00.000Z',
  );
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter: base, now: new Date(generationA) });
  await publishRows(base, { generation: generationB });

  let announceInitialPublicationRead;
  let releaseInitialPublicationRead;
  let blockInitialPublicationRead = true;
  const initialPublicationRead = new Promise((resolve) => { announceInitialPublicationRead = resolve; });
  const initialPublicationRelease = new Promise((resolve) => { releaseInitialPublicationRead = resolve; });
  const stageAdapter = {
    ...base,
    async read(pathname) {
      if (blockInitialPublicationRead && pathname === PUBLICATIONS) {
        blockInitialPublicationRead = false;
        const record = await base.read(pathname);
        announceInitialPublicationRead();
        await initialPublicationRelease;
        return record;
      }
      return base.read(pathname);
    },
  };
  const pruneAdapter = {
    ...base,
    async read(pathname) {
      if (blockPrunePartitionRead && pathname === PARTITION) {
        blockPrunePartitionRead = false;
        announcePrunePartitionRead();
        await prunePartitionRelease;
      }
      return base.read(pathname);
    },
  };
  const stagingC = stageJournal({
    refreshStartedAt: generationC, signals: [concurrentC], dailyMarks: [],
  }, { adapter: stageAdapter, now: new Date(generationC) });
  await initialPublicationRead;
  const pruning = pruneJournal({
    now: new Date('2026-08-27T04:00:00.000Z'),
  }, { adapter: pruneAdapter });
  await prunePartitionRead;
  releaseInitialPublicationRead();
  const stagedC = await stagingC;
  releasePrunePartitionRead();
  const pruned = await pruning;
  assert.equal(pruned.durableWriteSucceeded, true);

  assert.equal(stagedC.durableWriteSucceeded, false);
  assert.equal(Object.hasOwn(base.inspect(MANIFEST).signalIds, concurrentC.id), false);
  assert.equal(Object.hasOwn(base.inspect(PUBLICATIONS).staged, generationC), false);
  assert.equal(base.inspect(PARTITION), null);
});

test('an expired writing claim is reclaimed and the exact event can stage in the next generation', async () => {
  const adapter = memoryJournalAdapter();
  const generation = '2026-08-27T01:00:00.000Z';
  const retryGeneration = '2026-08-27T01:12:00.000Z';
  const row = signalAt(
    'hyperliquid-account-details:claim-crash-retry', '2026-08-26T10:00:00.000Z',
  );
  adapter.failNext(PARTITION);
  const crashed = await stageJournal({
    refreshStartedAt: generation, signals: [row], dailyMarks: [],
  }, { adapter, now: new Date(generation) });
  assert.equal(crashed.durableWriteSucceeded, false);
  assert.equal(adapter.inspect(MANIFEST).claims[generation].state, 'writing');

  const recoveryNow = new Date('2026-08-27T01:12:00.001Z');
  const pruned = await pruneJournal({ now: recoveryNow }, { adapter });
  assert.equal(pruned.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).claims, generation), false);
  assert.equal(adapter.inspect(PUBLICATIONS).reconciliation.signalIds[row.id], '2026-08-26');

  const retried = await stageJournal({
    refreshStartedAt: retryGeneration, signals: [row], dailyMarks: [],
  }, { adapter, now: recoveryNow });
  assert.equal(retried.durableWriteSucceeded, true);
  assert.equal(adapter.inspect(MANIFEST).signalIds[row.id], '2026-08-26');
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS), 'reconciliation'), false);
});

test('a later prune reconciles a stale post-fence row on a recent shared partition', async () => {
  const adapter = memoryJournalAdapter();
  const generationA = '2026-08-27T01:00:00.000Z';
  const generationB = '2026-08-27T02:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:late-fenced-write', '2026-08-26T10:00:00.000Z',
  );
  const acceptedB = signalAt(
    'hyperliquid-account-details:late-fenced-accepted', '2026-08-26T11:00:00.000Z',
  );
  adapter.failNext(PARTITION);
  const crashed = await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter, now: new Date(generationA) });
  assert.equal(crashed.durableWriteSucceeded, false);
  const reclaimed = await pruneJournal({
    now: new Date('2026-08-27T01:12:00.001Z'),
  }, { adapter });
  assert.equal(reclaimed.durableWriteSucceeded, true);

  await publishRows(adapter, { signals: [acceptedB], generation: generationB });
  const partition = adapter.inspect(PARTITION);
  adapter.seed(PARTITION, {
    ...partition,
    signals: [...partition.signals, orphanA].sort((left, right) => (
      left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id)
    )),
  });
  const reconciled = await pruneJournal({
    now: new Date('2026-08-27T03:00:00.000Z'),
  }, { adapter });

  assert.equal(reconciled.durableWriteSucceeded, true);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === orphanA.id), false);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === acceptedB.id), true);
});

test('publication fails closed when a staged ID is no longer manifest-and-partition durable', async () => {
  const adapter = memoryJournalAdapter();
  const mark = dailyMark();
  await stageJournal({
    refreshStartedAt: GENERATION, signals: [], dailyMarks: [mark],
  }, { adapter, now: new Date(GENERATION) });
  adapter.seed(MANIFEST, {
    schemaVersion: 1, partitions: [], signalIds: {}, dailyMarkIds: {},
  });

  const result = await publishJournalGeneration({
    refreshStartedAt: GENERATION,
    snapshot: acceptedPrivateSnapshot(GENERATION, []),
  }, { adapter, now: new Date(GENERATION) });

  assert.deepEqual(result, {
    durableWriteSucceeded: false, skipped: false, error: 'publication_rows_unavailable',
  });
  assert.equal(await readAcceptedSmartMoneySnapshot({ adapter, now: new Date(GENERATION) }), null);
});

test('failed recent row cleanup restores manifest retry metadata before compacting its stage', async () => {
  const adapter = memoryJournalAdapter();
  const generationA = '2026-08-27T01:00:00.000Z';
  const generationB = '2026-08-27T02:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:recent-cleanup-retry', '2026-08-26T10:00:00.000Z',
  );
  const acceptedB = signalAt(
    'hyperliquid-account-details:recent-cleanup-accepted', '2026-08-26T11:00:00.000Z',
  );
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter, now: new Date(generationA) });
  await stageJournal({
    refreshStartedAt: generationB, signals: [acceptedB], dailyMarks: [],
  }, { adapter, now: new Date(generationB) });
  await publishJournalGeneration({
    refreshStartedAt: generationB,
    snapshot: acceptedPrivateSnapshot(generationB, [acceptedB]),
  }, { adapter, now: new Date(generationB) });
  adapter.failNext(PARTITION);

  const first = await pruneJournal({
    now: new Date('2026-08-27T04:00:00.000Z'),
  }, { adapter });
  assert.equal(first.durableWriteSucceeded, false);
  assert.equal(adapter.inspect(MANIFEST).signalIds[orphanA.id], '2026-08-26');
  assert.deepEqual(adapter.inspect(PUBLICATIONS).staged[generationA], {
    signalIds: [orphanA.id], dailyMarkIds: [],
  });
  const cleanup = adapter.inspect(PUBLICATIONS).cleanup;
  assert.deepEqual(cleanup.staged, {
    [generationA]: { signalIds: [orphanA.id], dailyMarkIds: [] },
  });
  assert.deepEqual(cleanup.signalIds, { [orphanA.id]: '2026-08-26' });
  assert.deepEqual(cleanup.dailyMarkIds, {});
  assert.deepEqual(cleanup.claims[generationA].signalIds, { [orphanA.id]: '2026-08-26' });
  assert.equal(cleanup.claims[generationA].state, 'writing');
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === orphanA.id), true);

  const retry = await pruneJournal({
    now: new Date('2026-08-27T04:00:00.000Z'),
  }, { adapter });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).signalIds, orphanA.id), false);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).staged, generationA), false);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === orphanA.id), false);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === acceptedB.id), true);
});

test('durable cleanup ID-to-date metadata survives both row and manifest-restore failures', async () => {
  const generationA = '2026-08-27T01:00:00.000Z';
  const generationB = '2026-08-27T02:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:double-cleanup-failure', '2026-08-26T10:00:00.000Z',
  );
  const acceptedB = signalAt(
    'hyperliquid-account-details:double-cleanup-accepted', '2026-08-26T11:00:00.000Z',
  );
  let adapter;
  let armedRestoreFailure = false;
  adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (!armedRestoreFailure && pathname === PARTITION
          && !data.signals.some((row) => row.id === orphanA.id)) {
        armedRestoreFailure = true;
        adapter.failNext(MANIFEST);
      }
    },
  });
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter, now: new Date(generationA) });
  await stageJournal({
    refreshStartedAt: generationB, signals: [acceptedB], dailyMarks: [],
  }, { adapter, now: new Date(generationB) });
  await publishJournalGeneration({
    refreshStartedAt: generationB,
    snapshot: acceptedPrivateSnapshot(generationB, [acceptedB]),
  }, { adapter, now: new Date(generationB) });
  adapter.failNext(PARTITION);

  const first = await pruneJournal({
    now: new Date('2026-08-27T04:00:00.000Z'),
  }, { adapter });
  assert.equal(first.durableWriteSucceeded, false);
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).signalIds, orphanA.id), false);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === orphanA.id), true);
  assert.deepEqual(adapter.inspect(PUBLICATIONS).cleanup.signalIds, {
    [orphanA.id]: '2026-08-26',
  });

  const retry = await pruneJournal({
    now: new Date('2026-08-27T04:00:00.000Z'),
  }, { adapter });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(adapter.inspect(PARTITION).signals.some((row) => row.id === orphanA.id), false);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).staged, generationA), false);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS), 'cleanup'), false);
});

test('cleanup retries publication compaction after its fenced manifest claim is already gone', async () => {
  const generationA = '2026-08-27T01:00:00.000Z';
  const generationB = '2026-08-27T02:00:00.000Z';
  const orphanA = signalAt(
    'hyperliquid-account-details:claim-compaction-retry', '2026-08-26T10:00:00.000Z',
  );
  let armFailure = false;
  let failureArmed = false;
  let adapter;
  adapter = memoryJournalAdapter({
    beforeWrite: async ({ pathname, data }) => {
      if (armFailure && !failureArmed && pathname === MANIFEST && data.maintenance !== null
          && !Object.hasOwn(data.claims, generationA)
          && !Object.hasOwn(data.signalIds, orphanA.id)) {
        failureArmed = true;
        adapter.failNext(PUBLICATIONS);
      }
    },
  });
  await stageJournal({
    refreshStartedAt: generationA, signals: [orphanA], dailyMarks: [],
  }, { adapter, now: new Date(generationA) });
  await publishRows(adapter, { generation: generationB });
  armFailure = true;

  const first = await pruneJournal({
    now: new Date('2026-08-27T04:00:00.000Z'),
  }, { adapter });
  assert.equal(first.durableWriteSucceeded, false);
  assert.equal(Object.hasOwn(adapter.inspect(MANIFEST).claims, generationA), false);
  assert.ok(adapter.inspect(PUBLICATIONS).cleanup);
  assert.ok(adapter.inspect(PUBLICATIONS).staged[generationA]);

  const retry = await pruneJournal({
    now: new Date('2026-08-27T04:00:00.000Z'),
  }, { adapter });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS), 'cleanup'), false);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).staged, generationA), false);
});

test('failed expired cleanup retains stage retry metadata until the physical delete succeeds', async () => {
  const adapter = memoryJournalAdapter();
  const oldDate = '2025-07-20';
  const oldGeneration = '2025-07-20T21:00:00.000Z';
  const currentGeneration = '2026-08-26T22:00:00.000Z';
  const oldSignal = signalAt(
    'hyperliquid-account-details:cleanup-retry', `${oldDate}T20:00:00.000Z`,
  );
  const oldPath = `smart-money/v1/journal/${oldDate}.json`;
  await stageJournal({
    refreshStartedAt: oldGeneration, signals: [oldSignal], dailyMarks: [],
  }, { adapter, now: new Date(oldGeneration) });
  await stageJournal({
    refreshStartedAt: currentGeneration, signals: [], dailyMarks: [],
  }, { adapter, now: new Date(currentGeneration) });
  await publishJournalGeneration({
    refreshStartedAt: currentGeneration,
    snapshot: acceptedPrivateSnapshot(currentGeneration, []),
  }, { adapter, now: new Date(currentGeneration) });
  adapter.failNextDelete(oldPath);

  const first = await pruneJournal({
    now: new Date('2026-08-26T23:00:00.000Z'),
  }, { adapter });
  assert.equal(first.durableWriteSucceeded, false);
  assert.deepEqual(adapter.inspect(PUBLICATIONS).staged[oldGeneration], {
    signalIds: [oldSignal.id], dailyMarkIds: [],
  });
  const cleanup = adapter.inspect(PUBLICATIONS).cleanup;
  assert.deepEqual(cleanup.staged, {
    [oldGeneration]: { signalIds: [oldSignal.id], dailyMarkIds: [] },
  });
  assert.deepEqual(cleanup.signalIds, { [oldSignal.id]: oldDate });
  assert.deepEqual(cleanup.dailyMarkIds, {});
  assert.deepEqual(cleanup.claims[oldGeneration].signalIds, { [oldSignal.id]: oldDate });
  assert.equal(cleanup.claims[oldGeneration].state, 'writing');
  assert.ok(adapter.inspect(oldPath));

  const retry = await pruneJournal({
    now: new Date('2026-08-26T23:00:00.000Z'),
  }, { adapter });
  assert.equal(retry.durableWriteSucceeded, true);
  assert.equal(Object.hasOwn(adapter.inspect(PUBLICATIONS).staged, oldGeneration), false);
  assert.equal(adapter.inspect(oldPath), null);
});
