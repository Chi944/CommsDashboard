import { secHeaders } from './sec.js';
import { getProviderFreshnessPolicy, normalizeProviderStatus } from './normalize.js';
import {
  ENABLED_SMART_MONEY_ADAPTER_IDS,
  validateSmartMoneyPrivateSnapshot,
} from './refresh.js';
import { SOURCE_RIGHTS, validateRightsMatrix } from './rights.js';
import { sanitizeProviderError } from './errors.js';

const STATE_PRIORITY = Object.freeze({ fresh: 0, 'never-run': 1, stale: 2, unavailable: 3 });

function exactAdapters(adapters) {
  if (!Array.isArray(adapters)
      || adapters.length !== ENABLED_SMART_MONEY_ADAPTER_IDS.length
      || adapters.some((adapter, index) => adapter?.id !== ENABLED_SMART_MONEY_ADAPTER_IDS[index])) {
    throw new TypeError('schema_invalid');
  }
}

function healthState(status) {
  if (!status) return 'never-run';
  if (status.status === 'live') return 'fresh';
  if (status.status === 'stale') return 'stale';
  return 'unavailable';
}

function childStatus(id, status) {
  return {
    id,
    group: id === 'sec-edgar' ? 'sec' : 'institutional',
    enabled: status?.enabled ?? true,
    state: healthState(status),
    lastAttemptAt: status?.lastAttemptAt ?? null,
    lastSuccessAt: status?.lastSuccessAt ?? null,
    sourceAsOf: status?.sourceAsOf ?? null,
    retrievedAt: status?.retrievedAt ?? null,
    freshnessBasis: status?.freshnessBasis ?? null,
    recordCount: status?.recordCount ?? 0,
    cacheAgeSeconds: status?.cacheAgeSeconds ?? null,
    errorCode: status?.errorCode == null ? null : sanitizeProviderError({ code: status.errorCode }),
  };
}

function rollup(id, children) {
  const state = children.reduce((worst, child) => (
    STATE_PRIORITY[child.state] > STATE_PRIORITY[worst] ? child.state : worst
  ), 'fresh');
  return {
    id,
    state: children.length === 0 ? 'never-run' : state,
    children: children.map((child) => child.id),
  };
}

function secConfiguration(userAgent) {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return 'missing';
  try {
    secHeaders(userAgent);
    return 'configured';
  } catch {
    return 'invalid';
  }
}

function durableStoreState(diagnostics, source, accepted) {
  if (diagnostics?.[source] !== true) return 'missing';
  if (diagnostics?.[`${source}Error`] != null) return 'unavailable';
  if (diagnostics?.[`${source}Hit`] !== true) return 'empty';
  if (!accepted
      || diagnostics?.[`${source}Generation`] !== accepted.refreshStartedAt
      || diagnostics?.[`${source}Digest`] !== accepted.stateDigest) return 'mismatch';
  return 'ready';
}

function storageConfiguration(diagnostics, accepted) {
  const blobState = durableStoreState(diagnostics, 'blob', accepted);
  const redisState = durableStoreState(diagnostics, 'redis', accepted);
  return {
    state: diagnostics?.configurationError == null
      && blobState === 'ready'
      && redisState === 'ready'
      ? 'ready'
      : 'unavailable',
    blobState,
    redisState,
  };
}

export function buildSmartMoneyHealth(input = {}) {
  const now = input.now instanceof Date ? new Date(input.now) : new Date(input.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new TypeError('schema_invalid');
  exactAdapters(input.adapters);
  let rawStatuses = [];
  let acceptedSnapshot = null;
  if (input.snapshot !== null && input.snapshot !== undefined) {
    acceptedSnapshot = validateSmartMoneyPrivateSnapshot(input.snapshot, { now });
    rawStatuses = acceptedSnapshot.publicSnapshot.providerStatuses.map((status) => normalizeProviderStatus(
      status,
      getProviderFreshnessPolicy(status.id),
      { now },
    ));
  }
  const byId = new Map(rawStatuses.map((status) => [status.id, status]));
  const providerStatuses = ENABLED_SMART_MONEY_ADAPTER_IDS.map((id) => childStatus(id, byId.get(id)));
  const secChildren = providerStatuses.filter((status) => status.group === 'sec');
  const institutionalChildren = providerStatuses.filter((status) => status.group === 'institutional');
  const providerRollups = [
    rollup('sec', secChildren),
    rollup('institutional', institutionalChildren),
    rollup('all-enabled', providerStatuses),
  ];
  const matrix = input.rights ?? SOURCE_RIGHTS;
  const rightsConfigured = input.rightsValid === true
    && validateRightsMatrix(matrix, { now }).ok;
  const storage = storageConfiguration(input.storageDiagnostics, acceptedSnapshot);
  const secUserAgent = secConfiguration(input.secUserAgent);
  const configuration = {
    rights: rightsConfigured ? 'configured' : 'invalid',
    storage: storage.state,
    secUserAgent,
    groq: input.groqConfigured === true ? 'configured' : 'missing_optional',
  };
  const degradedProviders = providerStatuses.some((status) => status.state !== 'fresh');
  return {
    schemaVersion: 1,
    ok: rightsConfigured && storage.state === 'ready' && secUserAgent === 'configured' && !degradedProviders,
    checkedAt: now.toISOString(),
    deployment: {
      commitSha: typeof input.deploymentCommit === 'string' && input.deploymentCommit.length > 0
        ? input.deploymentCommit
        : null,
      environment: typeof input.deploymentEnvironment === 'string' && input.deploymentEnvironment.length > 0
        ? input.deploymentEnvironment
        : null,
    },
    configuration,
    storage: {
      blob: input.storageDiagnostics?.blob === true ? 'configured' : 'missing',
      redis: input.storageDiagnostics?.redis === true ? 'configured' : 'missing',
      selectedSource: ['blob', 'redis', 'memory'].includes(input.storageDiagnostics?.selectedSource)
        ? input.storageDiagnostics.selectedSource
        : null,
      blobState: storage.blobState,
      redisState: storage.redisState,
    },
    rights: {
      status: configuration.rights,
      policyRecords: matrix.map((record) => ({
        id: record.id,
        provider: record.provider,
        decision: record.decision,
        checkedAt: record.checkedAt,
        reviewDueAt: record.reviewDueAt,
      })),
    },
    providerStatuses,
    providerRollups,
  };
}
