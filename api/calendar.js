import { buildCalendarSnapshot } from '../lib/calendar/index.js';

const UNAVAILABLE_ERROR = Object.freeze({ code: 'calendar_unavailable', message: 'Official economic calendars are temporarily unavailable.' });

export function createCalendarHandler(dependencies = {}) {
  const buildSnapshot = dependencies.buildSnapshot || buildCalendarSnapshot;
  return async function calendarHandler(req, res) {
    if (String(req?.method || 'GET').toUpperCase() !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.setHeader('Cache-Control', 'no-store');
      res.status(405).json({ ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed. Use GET.' } });
      return;
    }
    if (Object.keys(req?.query || {}).length > 0) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).json({ ok: false, error: { code: 'invalid_query_parameters', message: 'Query parameters are not supported.' } });
      return;
    }
    try {
      const snapshot = await buildSnapshot();
      if (!snapshot?.ok) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(502).json({ ...snapshot, error: UNAVAILABLE_ERROR });
        return;
      }
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=21600');
      res.status(200).json(snapshot);
    } catch {
      const fetchedAt = new Date().toISOString();
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({ ok: false, partial: true, degraded: true, state: 'unavailable', fetchedAt, asOf: fetchedAt, window: null, providers: [], events: [], error: UNAVAILABLE_ERROR });
    }
  };
}

export default createCalendarHandler();
