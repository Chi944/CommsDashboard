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
  const briefingParagraphs = briefing.briefing.text
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (briefingParagraphs.length !== 3) {
    throw new Error('/api/briefing did not return exactly three paragraphs');
  }
  const evidenceParagraphs = briefing?.briefing?.paragraphs;
  if (!Array.isArray(evidenceParagraphs)
    || evidenceParagraphs.length !== 3
    || evidenceParagraphs.some((paragraph, index) => (
      paragraph?.text !== briefingParagraphs[index]
      || !/^(gainer|loser)-\d+$/.test(paragraph?.marketEvidenceId || '')
      || !/^sentiment-(headlines|fear-greed)$/.test(paragraph?.sentimentEvidenceId || '')
    ))) {
    throw new Error('/api/briefing did not return per-paragraph market and sentiment evidence');
  }
  if (briefing?.aiStatus?.source !== 'generated') {
    throw new Error('/api/briefing aiStatus.source was not generated');
  }
  const headlineSentiment = briefing?.signals?.sentiment?.headline;
  const fearGreedSentiment = briefing?.signals?.sentiment?.cryptoFearGreed;
  const hasHeadlineSentiment = typeof headlineSentiment?.label === 'string'
    && headlineSentiment.label.trim()
    && Number.isFinite(headlineSentiment.sampleSize)
    && headlineSentiment.sampleSize > 0;
  const hasFearGreedSentiment = Number.isFinite(fearGreedSentiment?.value)
    && typeof fearGreedSentiment?.label === 'string'
    && fearGreedSentiment.label.trim();
  if (!hasHeadlineSentiment && !hasFearGreedSentiment) {
    throw new Error('/api/briefing did not return current briefing sentiment evidence');
  }
  const sentimentTimestamps = [
    hasHeadlineSentiment ? headlineSentiment.updatedAt : null,
    hasFearGreedSentiment ? fearGreedSentiment.updatedAt : null,
  ].map((value) => Date.parse(value)).filter(Number.isFinite);
  const hasFreshSentiment = sentimentTimestamps.some((timestamp) => {
    const ageMs = Date.now() - timestamp;
    return ageMs <= 72 * 60 * 60 * 1000 && ageMs >= -5 * 60 * 1000;
  });
  if (!hasFreshSentiment) {
    throw new Error('/api/briefing sentiment evidence is stale or invalid');
  }
  const currentMarketDate = new Date().toISOString().slice(0, 10);
  if (briefing?.briefing?.marketDate !== currentMarketDate) {
    throw new Error('/api/briefing market date is not current');
  }
  const marketObservedAt = Date.parse(briefing?.briefing?.inputsAsOf?.market);
  const marketObservationAgeMs = Date.now() - marketObservedAt;
  if (!Number.isFinite(marketObservedAt)
    || marketObservationAgeMs > 4 * 24 * 60 * 60 * 1000
    || marketObservationAgeMs < -5 * 60 * 1000) {
    throw new Error('/api/briefing market observation is stale or invalid');
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
