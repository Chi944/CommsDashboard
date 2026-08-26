const UTC_REFRESH_MINUTES = Object.freeze([
  1,
  (6 * 60) + 5,
  (18 * 60) + 5,
]);

export function nextSmartMoneyRefreshAt(value = new Date()) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) throw new TypeError('A valid refresh time is required.');
  const startOfDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const nextToday = UTC_REFRESH_MINUTES
    .map((minutes) => startOfDay + (minutes * 60_000))
    .find((candidate) => candidate > now.getTime());
  return new Date(nextToday ?? (startOfDay + 86_400_000 + 60_000));
}
