import { buildSmartMoneyHealth } from '../../lib/smart-money/health.js';
import { ENABLED_SMART_MONEY_ADAPTER_IDS } from '../../lib/smart-money/refresh.js';
import { SOURCE_RIGHTS, validateRightsMatrix } from '../../lib/smart-money/rights.js';
import { readSmartMoneySnapshot } from '../../lib/smart-money/store.js';

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (key === 'errorCode') {
      return child === null || (typeof child === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(child))
        ? [[key, child]]
        : [];
    }
    return /(?:error|secret|token|raw|body)/i.test(key) ? [] : [[key, sanitize(child)]];
  }));
}

export function createSmartMoneyHealthHandler(deps = {}) {
  const read = deps.readSnapshot || (() => readSmartMoneySnapshot({ withDiagnostics: true }));
  const build = deps.buildHealth || buildSmartMoneyHealth;
  return async function smartMoneyHealthHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
      return;
    }
    if (Object.keys(req.query || {}).length !== 0) {
      res.status(400).json({ ok: false, error: { code: 'invalid_query_parameters', message: 'Invalid query parameters.' } });
      return;
    }
    try {
      const readResult = await read();
      const snapshot = readResult && Object.hasOwn(readResult, 'snapshot')
        ? readResult.snapshot
        : readResult;
      const diagnostics = readResult && Object.hasOwn(readResult, 'diagnostics')
        ? readResult.diagnostics
        : {};
      const now = typeof deps.now === 'function' ? deps.now() : new Date();
      const rights = deps.rights || SOURCE_RIGHTS;
      const health = build({
        snapshot,
        adapters: deps.adapters || ENABLED_SMART_MONEY_ADAPTER_IDS.map((id) => ({ id })),
        rights,
        rightsValid: validateRightsMatrix(rights, { now }).ok,
        storageDiagnostics: diagnostics,
        deploymentCommit: deps.deploymentCommit ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
        deploymentEnvironment: deps.deploymentEnvironment ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
        groqConfigured: deps.groqConfigured ?? Boolean(process.env.GROQ_API_KEY),
        secUserAgent: deps.secUserAgent ?? process.env.SEC_USER_AGENT,
        now,
      });
      const publicHealth = sanitize(health);
      res.status(publicHealth.ok === true ? 200 : 503).json(publicHealth);
    } catch {
      res.status(503).json({
        ok: false,
        error: { code: 'smart_money_health_unavailable', message: 'Smart Money health is temporarily unavailable.' },
      });
    }
  };
}

export default createSmartMoneyHealthHandler();
