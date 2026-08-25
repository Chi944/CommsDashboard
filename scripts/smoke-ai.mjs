const baseUrl = (process.env.AI_SMOKE_BASE_URL || process.argv[2] || 'https://comms-dashboard-navy.vercel.app').replace(/\/$/, '');
const ticker = (process.env.AI_SMOKE_TICKER || process.argv[3] || 'NVDA').trim().toUpperCase();
const smokeSecret = process.env.AI_SMOKE_SECRET;
const configuredTimeout = Number(process.env.AI_SMOKE_TIMEOUT_MS);
const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 10_000;
const smokeNonce = `${Date.now().toString(36)}-${process.pid}`;

async function fetchJson(path) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        'x-ai-smoke-secret': smokeSecret,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error(`${path} returned invalid JSON`);
    }
  } catch (error) {
    if (timedOut) throw new Error(`${path} timed out`);
    if (error?.message?.startsWith(path)) throw error;
    throw new Error(`${path} request failed`);
  } finally {
    clearTimeout(timeout);
  }
}

try {
  if (!smokeSecret) throw new Error('AI_SMOKE_SECRET is required');

  const [briefing, analysis] = await Promise.all([
    fetchJson(`/api/briefing?aiSmoke=${encodeURIComponent(smokeNonce)}`),
    fetchJson(`/api/analysis?ticker=${encodeURIComponent(ticker)}&aiSmoke=${encodeURIComponent(smokeNonce)}`),
  ]);

  if (typeof briefing?.briefing?.text !== 'string' || !briefing.briefing.text.trim()) {
    throw new Error('/api/briefing did not return briefing.text');
  }
  if (briefing?.aiStatus?.source !== 'generated') {
    throw new Error('/api/briefing aiStatus.source was not generated');
  }
  if (!['trend', 'catalysts', 'risks', 'outlook'].every((field) => (
    typeof analysis?.ai?.[field] === 'string' && analysis.ai[field].trim()
  ))) {
    throw new Error(`/api/analysis?ticker=${ticker} did not return all four non-empty analysis sections`);
  }
  if (analysis?.aiStatus?.source !== 'generated') {
    throw new Error(`/api/analysis?ticker=${ticker} aiStatus.source was not generated`);
  }

  console.log(`AI smoke check passed for ${baseUrl} (${ticker})`);
} catch (error) {
  console.error(`AI smoke check failed: ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
}
