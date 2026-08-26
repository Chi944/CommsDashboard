import { refreshSmartMoney } from '../../lib/smart-money/refresh.js';

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

export function createSmartMoneyRefreshHandler(deps = {}) {
  const cronSecret = Object.hasOwn(deps, 'cronSecret') ? deps.cronSecret : process.env.CRON_SECRET;
  const refresh = deps.refreshSmartMoney || refreshSmartMoney;
  return async function smartMoneyRefreshHandler(req, res) {
    noStore(res);
    if (typeof cronSecret !== 'string' || cronSecret.length < 1) {
      res.status(503).json({ ok: false, error: { code: 'refresh_configuration_invalid', message: 'Refresh is not configured.' } });
      return;
    }
    if (req.headers?.authorization !== `Bearer ${cronSecret}`) {
      res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Unauthorized.' } });
      return;
    }
    if (Object.keys(req.query || {}).length !== 0) {
      res.status(400).json({ ok: false, error: { code: 'invalid_query_parameters', message: 'Invalid query parameters.' } });
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
      return;
    }
    try {
      const result = await refresh({ trigger: 'protected-route' });
      res.status(result.persisted === true ? 200 : 503).json({
        ok: result.persisted === true,
        persisted: result.persisted === true,
        partial: Boolean(result.partial),
        providerStatuses: Array.isArray(result.providerStatuses) ? result.providerStatuses : [],
        signalsAccepted: result.persisted === true && Array.isArray(result.signalsAccepted)
          ? result.signalsAccepted
          : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
        errorCode: result.errorCode ?? null,
      });
    } catch {
      res.status(503).json({
        ok: false,
        error: { code: 'refresh_failed', message: 'Smart Money refresh failed.' },
      });
    }
  };
}

export default createSmartMoneyRefreshHandler();
