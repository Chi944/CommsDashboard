import { readJournal } from '../../lib/smart-money/journal.js';

const DAY_MS = 86_400_000;

function canonicalInstant(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

function validCursor(value, since) {
  if (value === undefined) return true;
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_000
      || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(text, 'utf8').toString('base64url') !== value) return false;
    const row = JSON.parse(text);
    const keys = Object.keys(row || {});
    return keys.length === 2 && keys[0] === 'observedAt' && keys[1] === 'id'
      && canonicalInstant(row.observedAt) !== null && row.observedAt >= since
      && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 512;
  } catch {
    return false;
  }
}

function queryInput(query, now) {
  const keys = Object.keys(query || {});
  if (keys.some((key) => !['since', 'limit', 'cursor'].includes(key))
      || keys.some((key) => Array.isArray(query[key]))) return null;
  const since = canonicalInstant(query?.since);
  const limit = query?.limit === undefined ? 200 : Number(query.limit);
  if (!since || !/^\d+$/.test(String(query?.limit ?? '200'))
      || !Number.isInteger(limit) || limit < 1 || limit > 500
      || Date.parse(since) > now.getTime()
      || Date.parse(since) < now.getTime() - 400 * DAY_MS
      || !validCursor(query?.cursor, since)) return null;
  return { since, limit, ...(query?.cursor === undefined ? {} : { cursor: query.cursor }) };
}

export function createSmartMoneyHistoryHandler(deps = {}) {
  const read = deps.readJournal || readJournal;
  const nowFn = deps.now || (() => new Date());
  return async function smartMoneyHistoryHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.setHeader('Cache-Control', 'no-store');
      res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
      return;
    }
    const now = nowFn();
    const input = now instanceof Date && Number.isFinite(now.getTime()) ? queryInput(req.query, now) : null;
    if (!input) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ ok: false, error: { code: 'invalid_query_parameters', message: 'Invalid query parameters.' } });
      return;
    }
    try {
      const history = await read(input);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.status(200).json(history);
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({
        ok: false,
        error: { code: 'smart_money_history_unavailable', message: 'Smart Money history is temporarily unavailable.' },
      });
    }
  };
}

export default createSmartMoneyHistoryHandler();
