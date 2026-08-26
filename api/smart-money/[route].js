import briefingHandler, {
  createSmartMoneyBriefingHandler,
} from '../../server/smart-money/briefing.js';
import healthHandler, {
  createSmartMoneyHealthHandler,
} from '../../server/smart-money/health.js';
import historyHandler, {
  createSmartMoneyHistoryHandler,
} from '../../server/smart-money/history.js';
import refreshHandler, {
  createSmartMoneyRefreshHandler,
} from '../../server/smart-money/refresh.js';

const DEFAULT_HANDLERS = Object.freeze({
  briefing: briefingHandler,
  health: healthHandler,
  history: historyHandler,
  refresh: refreshHandler,
});

function routeRequest(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url, 'https://dashboard.invalid');
    const match = /^\/api\/smart-money\/([^/]+)\/?$/.exec(parsed.pathname);
    if (!match) return null;
    return {
      route: decodeURIComponent(match[1]),
    };
  } catch {
    return null;
  }
}

function pathError(res, status, code, message) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ ok: false, error: { code, message } });
}

function requestForChild(req, query) {
  const forwarded = Object.create(req && typeof req === 'object' ? req : null);
  Object.defineProperty(forwarded, 'query', {
    configurable: false,
    enumerable: true,
    value: Object.fromEntries(
      Object.entries(query).filter(([key]) => key !== 'route'),
    ),
    writable: false,
  });
  return forwarded;
}

export function createSmartMoneyRouteHandler(deps = {}) {
  const handlers = deps.handlers || DEFAULT_HANDLERS;
  return async function smartMoneyRouteHandler(req, res) {
    const query = req?.query && typeof req.query === 'object' && !Array.isArray(req.query)
      ? req.query
      : {};
    const request = routeRequest(req?.url);
    if (!request) {
      pathError(
        res,
        400,
        'invalid_route_parameter',
        'Invalid Smart Money route parameter.',
      );
      return;
    }
    const { route } = request;

    if (query.route !== route) {
      pathError(
        res,
        400,
        'invalid_route_parameter',
        'Invalid Smart Money route parameter.',
      );
      return;
    }
    if (!Object.hasOwn(handlers, route) || typeof handlers[route] !== 'function') {
      pathError(
        res,
        404,
        'smart_money_route_not_found',
        'Smart Money route not found.',
      );
      return;
    }

    await handlers[route](requestForChild(req, query), res);
  };
}

export {
  createSmartMoneyBriefingHandler,
  createSmartMoneyHealthHandler,
  createSmartMoneyHistoryHandler,
  createSmartMoneyRefreshHandler,
};

export default createSmartMoneyRouteHandler();
