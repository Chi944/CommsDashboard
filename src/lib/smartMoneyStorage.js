const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_FOLLOWED = 100;
const MAX_NOTIFIED = 500;

export const SMART_MONEY_STORAGE_KEYS = Object.freeze({
  preferences: 'comms.smartMoney.preferences.v1',
  notified: 'comms.smartMoney.notified.v1',
});

const EMPTY_IDS = Object.freeze([]);

export const DEFAULT_SMART_MONEY_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  followedEntityIds: EMPTY_IDS,
  browserNotificationsEnabled: false,
});

function storageOrDefault(storage) {
  return storage ?? globalThis.localStorage;
}

function exactPlainObject(value, fields) {
  if (value === null || typeof value !== 'object'
      || Object.getPrototypeOf(value) !== Object.prototype
      || Object.getOwnPropertySymbols(value).length !== 0) return false;
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !keys.includes(field))) return false;
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function canonicalIds(value, limit) {
  if (!Array.isArray(value) || value.length > Math.max(1_000, limit * 2)) return null;
  const ids = [];
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== 'string' || !STABLE_ID.test(id)) return null;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids.slice(-limit);
}

function normalizePreferences(value) {
  if (!exactPlainObject(value, [
    'schemaVersion', 'followedEntityIds', 'browserNotificationsEnabled',
  ]) || value.schemaVersion !== 1
      || typeof value.browserNotificationsEnabled !== 'boolean') return null;
  const followedEntityIds = canonicalIds(value.followedEntityIds, MAX_FOLLOWED);
  return followedEntityIds ? {
    schemaVersion: 1,
    followedEntityIds,
    browserNotificationsEnabled: value.browserNotificationsEnabled,
  } : null;
}

function defaultPreferences() {
  return {
    schemaVersion: 1,
    followedEntityIds: [],
    browserNotificationsEnabled: false,
  };
}

export function loadSmartMoneyPreferences(storage) {
  try {
    const raw = storageOrDefault(storage).getItem(SMART_MONEY_STORAGE_KEYS.preferences);
    if (raw === null) return defaultPreferences();
    return normalizePreferences(JSON.parse(raw)) ?? defaultPreferences();
  } catch {
    return defaultPreferences();
  }
}

export function saveSmartMoneyPreferences(storage, value) {
  const normalized = normalizePreferences(value);
  if (!normalized) return false;
  try {
    storageOrDefault(storage).setItem(
      SMART_MONEY_STORAGE_KEYS.preferences,
      JSON.stringify(normalized),
    );
    return true;
  } catch {
    return false;
  }
}

function normalizeNotified(value) {
  if (!exactPlainObject(value, ['schemaVersion', 'signalIds']) || value.schemaVersion !== 1) {
    return null;
  }
  const signalIds = canonicalIds(value.signalIds, MAX_NOTIFIED);
  return signalIds ? { schemaVersion: 1, signalIds } : null;
}

export function loadNotifiedSignalIds(storage) {
  try {
    const raw = storageOrDefault(storage).getItem(SMART_MONEY_STORAGE_KEYS.notified);
    if (raw === null) return [];
    return normalizeNotified(JSON.parse(raw))?.signalIds ?? [];
  } catch {
    return [];
  }
}

export function saveNotifiedSignalIds(storage, signalIds) {
  const normalizedIds = canonicalIds(signalIds, MAX_NOTIFIED);
  if (!normalizedIds) return false;
  try {
    storageOrDefault(storage).setItem(SMART_MONEY_STORAGE_KEYS.notified, JSON.stringify({
      schemaVersion: 1,
      signalIds: normalizedIds,
    }));
    return true;
  } catch {
    return false;
  }
}
