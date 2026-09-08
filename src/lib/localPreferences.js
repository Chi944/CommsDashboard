const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const listName = (value) => text(value) && !Object.hasOwn(Object.prototype, value);
const ticker = (value) => text(value) && value.length <= 64;
const uniqueBy = (rows, key) => [...new Map(rows.map((row) => [row[key], row])).values()];

// A parseable localStorage value can still have an obsolete or damaged shape.
// Recover valid entries without letting one malformed row break the dashboard.
export function normalizeWatchlists(value) {
  const lists = Object.fromEntries(
    (record(value?.lists) ? Object.entries(value.lists) : [])
      .filter(([name, items]) => listName(name) && Array.isArray(items))
      .map(([name, items]) => [name, [...new Set(items.filter(ticker))]]),
  );
  if (!Object.keys(lists).length) lists.Default = [];
  const active = typeof value?.active === 'string' && Object.hasOwn(lists, value.active)
    ? value.active : Object.keys(lists)[0];
  return { active, lists };
}

export function normalizePositions(value) {
  return uniqueBy((Array.isArray(value) ? value : [])
    .filter((row) => record(row) && ticker(row.ticker) && positive(row.qty) && positive(row.avgCost))
    .map(({ ticker: symbol, qty, avgCost }) => ({ ticker: symbol, qty, avgCost })), 'ticker');
}

export function normalizeAlerts(value) {
  return uniqueBy((Array.isArray(value) ? value : [])
    .filter((row) => record(row) && text(row.id) && ticker(row.ticker)
      && ['>', '<'].includes(row.op) && positive(row.price))
    .map((row) => ({
      id: row.id, ticker: row.ticker, op: row.op, price: row.price,
      name: typeof row.name === 'string' ? row.name : row.ticker,
      enabled: row.enabled === true,
      lastTriggeredAt: positive(row.lastTriggeredAt) ? row.lastTriggeredAt : null,
    })), 'id');
}

export function normalizeTriggeredAlerts(value) {
  return uniqueBy((Array.isArray(value) ? value : [])
    .filter((row) => record(row) && text(row.id) && ticker(row.ticker)
      && ['>', '<'].includes(row.op) && positive(row.price) && positive(row.threshold) && positive(row.ts))
    .map((row) => ({
      id: row.id, ticker: row.ticker, op: row.op, price: row.price,
      threshold: row.threshold, ts: row.ts,
      name: typeof row.name === 'string' ? row.name : row.ticker,
    })), 'id').slice(0, 50);
}

export { listName as validWatchlistName };
