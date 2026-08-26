import { validateSmartMoneyPrivateSnapshot } from '../lib/smart-money/refresh.js';
import { readSmartMoneySnapshot } from '../lib/smart-money/store.js';

const UNAVAILABLE = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'smart_money_unavailable',
    message: 'Smart Money data is temporarily unavailable.',
  }),
});

function invalidQuery(query) {
  const keys = Object.keys(query || {});
  if (keys.length === 0) return false;
  return keys.length !== 1 || keys[0] !== 'refresh' || query.refresh !== '1';
}

function unavailable(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json(structuredClone(UNAVAILABLE));
}

export function createSmartMoneyHandler(deps = {}) {
  const readSnapshot = deps.readSnapshot || readSmartMoneySnapshot;
  return async function smartMoneyHandler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.setHeader('Cache-Control', 'no-store');
      res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
      return;
    }
    if (invalidQuery(req.query)) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ ok: false, error: { code: 'invalid_query_parameters', message: 'Invalid query parameters.' } });
      return;
    }
    try {
      const stored = await readSnapshot();
      if (stored === null) return unavailable(res);
      const accepted = validateSmartMoneyPrivateSnapshot(stored).publicSnapshot;
      res.setHeader('Cache-Control', req.query?.refresh === '1'
        ? 'no-store'
        : 's-maxage=60, stale-while-revalidate=300');
      res.status(200).json(accepted);
    } catch {
      unavailable(res);
    }
  };
}

export default createSmartMoneyHandler();
