export const DASHBOARD_TABS = Object.freeze([
  'Overview', 'Prices', 'Currency', 'Portfolio', 'Intel',
]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SAFE_TICKER = /^[A-Z0-9.^=-]{1,24}$/;
const KNOWN_PARAMS = Object.freeze(['tab', 'view', 'record', 't']);

function searchParams(search) {
  try {
    return new URLSearchParams(String(search || '').replace(/^\?/, ''));
  } catch {
    return new URLSearchParams();
  }
}

function one(params, name) {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : null;
}

function safeTicker(value) {
  if (typeof value !== 'string') return null;
  const ticker = value.toUpperCase();
  return SAFE_TICKER.test(ticker) ? ticker : null;
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

function viewFor(tab, value) {
  if (tab === 'Intel') return value === 'smart-money' ? 'smart-money' : 'news';
  if (tab === 'Portfolio') {
    return ['paper-copy', 'simulation-readiness'].includes(value)
      ? 'simulation-readiness'
      : 'holdings';
  }
  return null;
}

export function parseDashboardSearch(search = '') {
  const params = searchParams(search);
  const requestedTab = one(params, 'tab');
  const tab = DASHBOARD_TABS.includes(requestedTab) ? requestedTab : 'Overview';
  const view = viewFor(tab, one(params, 'view'));
  const recordId = tab === 'Intel' && view === 'smart-money'
    ? safeId(one(params, 'record'))
    : null;
  return {
    tab,
    view,
    recordId,
    ticker: safeTicker(one(params, 't')),
  };
}

export function buildDashboardSearch(currentSearch = '', routeState = {}) {
  const params = searchParams(currentSearch);
  for (const name of KNOWN_PARAMS) params.delete(name);
  const tab = DASHBOARD_TABS.includes(routeState.tab) ? routeState.tab : 'Overview';
  const view = viewFor(tab, routeState.view);
  const recordId = tab === 'Intel' && view === 'smart-money'
    ? safeId(routeState.recordId)
    : null;
  const ticker = safeTicker(routeState.ticker);
  params.set('tab', tab);
  if (view) params.set('view', view);
  if (recordId) params.set('record', recordId);
  if (ticker) params.set('t', ticker);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}
