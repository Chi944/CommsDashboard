import { AI_SMOKE_WINDOW_GAP_MS, runForcedAiSmokeRequests } from '../lib/ai/smoke-schedule.js';

const baseUrl = (process.env.AI_SMOKE_BASE_URL || process.argv[2] || 'https://comms-dashboard-navy.vercel.app').replace(/\/$/, '');
const ticker = (process.env.AI_SMOKE_TICKER || process.argv[3] || 'NVDA').trim().toUpperCase();
const smokeSecret = process.env.AI_SMOKE_SECRET;
const expectedCommitSha = process.env.AI_SMOKE_EXPECTED_COMMIT_SHA?.trim() || null;
const expectedDeploymentEnvironment = expectedCommitSha
  ? (process.env.AI_SMOKE_EXPECTED_DEPLOYMENT_ENVIRONMENT?.trim() || 'production')
  : null;
const configuredTimeout = Number(process.env.AI_SMOKE_TIMEOUT_MS);
const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 10_000;
const configuredTestGap = Number(process.env.AI_SMOKE_TEST_WINDOW_GAP_MS);
const windowGapMs = process.env.NODE_ENV === 'test'
  && Number.isFinite(configuredTestGap) && configuredTestGap >= 0
  ? configuredTestGap
  : AI_SMOKE_WINDOW_GAP_MS;
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

  const { briefing, analysis, smartMoneyBriefing, smartMoneyHealth } = await runForcedAiSmokeRequests({
    requestBriefing: () => fetchJson(`/api/briefing?aiSmoke=${encodeURIComponent(smokeNonce)}`),
    requestAnalysis: () => fetchJson(`/api/analysis?ticker=${encodeURIComponent(ticker)}&aiSmoke=${encodeURIComponent(smokeNonce)}`),
    requestSmartMoneyBriefing: () => fetchJson('/api/smart-money/briefing?aiSmoke=1'),
    requestSmartMoneyHealth: () => fetchJson('/api/smart-money/health'),
    windowGapMs,
  });

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
  const briefingEvidence = Array.isArray(briefing?.briefing?.evidence)
    ? briefing.briefing.evidence
    : briefing?.evidence;
  const briefingEvidenceById = new Map((Array.isArray(briefingEvidence) ? briefingEvidence : [])
    .map((record) => [record?.id, record]));
  const expectedBriefingIds = ['market-tone', 'themes-catalysts', 'watchpoints'];
  if (!Array.isArray(evidenceParagraphs)
    || evidenceParagraphs.length !== 3
    || evidenceParagraphs.some((paragraph, index) => (
      paragraph?.text !== briefingParagraphs[index]
      || paragraph?.id !== expectedBriefingIds[index]
      || !Array.isArray(paragraph?.evidenceIds)
      || paragraph.evidenceIds.length === 0
      || paragraph.evidenceIds.some((id) => !briefingEvidenceById.has(id))
    ))) {
    throw new Error('/api/briefing did not return resolved per-paragraph evidence');
  }
  const marketEvidenceTypes = evidenceParagraphs.map((paragraph) => (
    paragraph.evidenceIds.map((id) => briefingEvidenceById.get(id)?.type)
  ));
  if (marketEvidenceTypes[0].some((type) => !['top_gainer', 'top_loser'].includes(type))
      || marketEvidenceTypes[1].some((type) => ![
        'headline', 'headline_sentiment', 'crypto_fear_greed',
      ].includes(type))
      || !evidenceParagraphs[2].evidenceIds.includes('input:coverage')) {
    throw new Error('/api/briefing evidence was assigned to the wrong paragraph');
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

  const smartParagraphs = smartMoneyBriefing?.briefing?.paragraphs;
  const smartEvidence = Array.isArray(smartMoneyBriefing?.briefing?.evidence)
    ? smartMoneyBriefing.briefing.evidence
    : smartMoneyBriefing?.evidence;
  const smartEvidenceById = new Map((Array.isArray(smartEvidence) ? smartEvidence : [])
    .map((record) => [record?.id, record]));
  const expectedSmartIds = ['market-regime', 'investor-disclosures', 'crypto-paper-risk'];
  if (!Array.isArray(smartParagraphs) || smartParagraphs.length !== 3
      || smartParagraphs.some((paragraph, index) => (
        paragraph?.id !== expectedSmartIds[index]
        || typeof paragraph?.text !== 'string' || !paragraph.text.trim()
        || !Array.isArray(paragraph?.evidenceIds) || paragraph.evidenceIds.length === 0
        || paragraph.evidenceIds.some((id) => !smartEvidenceById.has(id))
      ))) {
    throw new Error('/api/smart-money/briefing did not return three resolved evidence paragraphs');
  }
  const smartTypes = smartParagraphs.map((paragraph) => (
    paragraph.evidenceIds.map((id) => smartEvidenceById.get(id)?.type)
  ));
  if (smartTypes[0].some((type) => !(type === 'snapshot_coverage' || type?.startsWith('market_')))
      || smartTypes[1].some((type) => ![
        'investor_activity', 'snapshot_coverage', 'provider_sec', 'provider_institutional',
        'entity_investors', 'entity_firms',
      ].includes(type))
      || !smartParagraphs[2].evidenceIds.includes('capability:simulation')
      || smartTypes[2].some((type) => ![
        'simulation_capability', 'snapshot_coverage', 'crypto_activity', 'crypto_signal',
        'provider_institutional', 'entity_institutional-flows',
      ].includes(type))) {
    throw new Error('/api/smart-money/briefing evidence was assigned to the wrong paragraph');
  }
  if (smartMoneyBriefing?.briefing?.source !== 'generated'
      || smartMoneyBriefing?.aiStatus?.source !== 'generated') {
    throw new Error('/api/smart-money/briefing source was not generated');
  }
  if (smartMoneyBriefing.briefing.marketDate !== currentMarketDate) {
    throw new Error('/api/smart-money/briefing market date is not current');
  }
  if (!/research-only/i.test(smartParagraphs[2].text)
      || !/no transaction was prepared or executed/i.test(smartParagraphs[2].text)) {
    throw new Error('/api/smart-money/briefing did not preserve the research-only transaction boundary');
  }

  const expectedProviderIds = [
    'sec-edgar', 'institutional-strategy', 'institutional-tesla',
    'institutional-ibit', 'institutional-fbtc', 'institutional-arkb',
    'institutional-bitb',
  ];
  const actualProviderIds = Array.isArray(smartMoneyHealth?.providerStatuses)
    ? smartMoneyHealth.providerStatuses.map((status) => status?.id)
    : [];
  if (smartMoneyHealth?.ok !== true
      || JSON.stringify(actualProviderIds) !== JSON.stringify(expectedProviderIds)
      || smartMoneyHealth.providerStatuses.some((status) => status?.state !== 'fresh')) {
    throw new Error('/api/smart-money/health did not report all seven enabled providers fresh');
  }

  if (expectedCommitSha) {
    const deploymentCommitSha = smartMoneyHealth?.deployment?.commitSha;
    const deploymentEnvironment = smartMoneyHealth?.deployment?.environment;
    if (typeof deploymentCommitSha !== 'string' || !deploymentCommitSha
        || typeof deploymentEnvironment !== 'string' || !deploymentEnvironment) {
      throw new Error('/api/smart-money/health did not report deployment commit and environment');
    }
    if (deploymentCommitSha !== expectedCommitSha) {
      throw new Error(`/api/smart-money/health deployment commit ${deploymentCommitSha} did not match expected ${expectedCommitSha}`);
    }
    if (deploymentEnvironment !== expectedDeploymentEnvironment) {
      throw new Error(`/api/smart-money/health deployment environment ${deploymentEnvironment} did not match expected ${expectedDeploymentEnvironment}`);
    }
  }

  const deploymentSummary = expectedCommitSha
    ? `; deployment ${expectedCommitSha} (${expectedDeploymentEnvironment})`
    : '';
  console.log(`AI and Smart Money smoke check passed for ${baseUrl} (${ticker}; 7/7 providers fresh${deploymentSummary})`);
} catch (error) {
  console.error(`AI smoke check failed: ${error?.message || 'unknown error'}`);
  process.exitCode = 1;
}
