import { fetchWithTimeout } from '../market/fetch.js';

const TRUSTED_MOVER_SOURCES = new Set(['yahoo', 'coingecko', 'alphavantage', 'eia']);
const MAX_HEADLINE_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_FEAR_GREED_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const POSITIVE_HEADLINE_TERMS = new Set([
  'beat', 'beats', 'easing', 'gain', 'gains', 'growth', 'optimism', 'rallied',
  'rallies', 'rally', 'rebound', 'rebounds', 'record', 'rise', 'rises', 'strong',
  'surge', 'surges', 'upgrade',
]);
const NEGATIVE_HEADLINE_TERMS = new Set([
  'attack', 'attacks', 'crash', 'crashes', 'disruption', 'downgrade', 'drop',
  'drops', 'fall', 'falls', 'fear', 'fears', 'inflation', 'loss', 'losses',
  'miss', 'misses', 'plunge', 'plunges', 'risk', 'risks', 'selloff', 'slump',
  'slumps', 'tariff', 'tariffs', 'war',
]);

function boundedText(value, maxLength) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function providerTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshTimestamp(timestampMs, referenceMs, maxAgeMs) {
  return Number.isFinite(timestampMs)
    && timestampMs <= referenceMs + MAX_FUTURE_SKEW_MS
    && referenceMs - timestampMs <= maxAgeMs;
}

function latestIso(...values) {
  const timestamps = values.map(providerTimestampMs).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function safeSourceUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function summarizeHeadlineSentiment(headlines) {
  const counts = { positive: 0, negative: 0, neutral: 0 };
  for (const item of headlines) {
    const words = new Set(boundedText(item.headline, 280).toLowerCase().match(/[a-z]+/g) || []);
    let positiveHits = 0;
    let negativeHits = 0;
    for (const word of words) {
      if (POSITIVE_HEADLINE_TERMS.has(word)) positiveHits += 1;
      if (NEGATIVE_HEADLINE_TERMS.has(word)) negativeHits += 1;
    }
    if (positiveHits > negativeHits) counts.positive += 1;
    else if (negativeHits > positiveHits) counts.negative += 1;
    else counts.neutral += 1;
  }
  const sampleSize = counts.positive + counts.negative + counts.neutral;
  const score = sampleSize
    ? Number(((counts.positive - counts.negative) / sampleSize).toFixed(2))
    : 0;
  return {
    label: sampleSize === 0 ? 'unavailable' : score >= 0.2 ? 'positive' : score <= -0.2 ? 'negative' : 'mixed',
    score,
    ...counts,
    sampleSize,
    updatedAt: latestIso(...headlines.map((headline) => headline.publishedAt)),
  };
}

function normalizeFearGreed(payload, referenceMs) {
  const value = Number(payload?.value);
  const updatedAtMs = providerTimestampMs(payload?.updatedAt);
  if (payload?.ok !== true || !Number.isFinite(value) || value < 0 || value > 100
      || !isFreshTimestamp(updatedAtMs, referenceMs, MAX_FEAR_GREED_AGE_MS)) return null;
  return {
    value: Math.round(value),
    label: boundedText(payload.label, 48) || 'Unknown',
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}

function normalizeHeadline(item, referenceMs, index) {
  const publishedAtMs = providerTimestampMs(item?.ts ?? item?.publishedAt ?? item?.pubDate);
  const headline = boundedText(item?.headline, 280);
  if (!headline || !isFreshTimestamp(publishedAtMs, referenceMs, MAX_HEADLINE_AGE_MS)) return null;
  const stableId = boundedText(item?.id, 96).replace(/[^A-Za-z0-9._:-]+/g, '-');
  return {
    id: stableId || `headline-${index + 1}`,
    headline,
    source: boundedText(item?.source, 80),
    category: boundedText(item?.category, 64),
    publishedAt: new Date(publishedAtMs).toISOString(),
    sourceUrl: safeSourceUrl(item?.url),
  };
}

function normalizeMover(row) {
  return {
    ticker: boundedText(row.ticker, 24).toUpperCase(),
    name: boundedText(row.name, 96),
    category: boundedText(row.category, 64),
    changePct: Number(Number(row.changePct).toFixed(2)),
    source: boundedText(row.source, 32).toLowerCase(),
    stale: false,
  };
}

export function isTrustedMarketMover(row) {
  if (!row || !Number.isFinite(row.changePct) || row.stale !== false) return false;
  const source = String(row.source || '').trim().toLowerCase();
  if (!TRUSTED_MOVER_SOURCES.has(source)) return false;
  if (row.mock === true || row.isMock === true || row.synthetic === true
      || row.fallback === true || row.isFallback === true || row.untrusted === true
      || row.trusted === false) return false;
  const quality = String(row.dataQuality || row.quality || '').trim().toLowerCase();
  return !['stale', 'mock', 'fallback', 'synthetic', 'untrusted'].includes(quality);
}

export function currentUtcMarketDate(now = new Date()) {
  const value = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(value.getTime())) throw new TypeError('invalid_market_clock');
  return value.toISOString().slice(0, 10);
}

function buildEvidence({ gainers, losers, headlines, sentiment, marketAsOf }) {
  const moverEvidence = (kind, rows) => rows.map((row) => ({
    id: `market:${kind}:${row.ticker}`,
    type: kind === 'gainer' ? 'top_gainer' : 'top_loser',
    label: `${row.ticker} ${row.changePct >= 0 ? '+' : ''}${row.changePct.toFixed(2)}%`,
    asOf: marketAsOf,
    source: row.source,
    sourceUrl: null,
    causalEligible: false,
  }));
  return [
    ...moverEvidence('gainer', gainers),
    ...moverEvidence('loser', losers),
    ...headlines.map((row) => ({
      id: `news:${row.id}`,
      type: 'headline',
      label: row.headline,
      asOf: row.publishedAt,
      source: row.source || 'News source',
      sourceUrl: row.sourceUrl,
      causalEligible: false,
    })),
    ...(sentiment.headline.sampleSize > 0 ? [{
      id: 'sentiment:headlines',
      type: 'headline_sentiment',
      label: `${sentiment.headline.label} headline tone (${sentiment.headline.sampleSize} items)`,
      asOf: sentiment.headline.updatedAt,
      source: 'Dashboard headline sample',
      sourceUrl: null,
      causalEligible: false,
    }] : []),
    ...(sentiment.cryptoFearGreed ? [{
      id: 'sentiment:fear-greed',
      type: 'crypto_fear_greed',
      label: `${sentiment.cryptoFearGreed.value} · ${sentiment.cryptoFearGreed.label}`,
      asOf: sentiment.cryptoFearGreed.updatedAt,
      source: 'Alternative.me Fear & Greed',
      sourceUrl: 'https://alternative.me/crypto/fear-and-greed-index/',
      causalEligible: false,
    }] : []),
  ];
}

export function buildValidatedMarketContext({ prices, news, fearGreed, now = new Date() }) {
  const trustedNow = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const marketDate = currentUtcMarketDate(trustedNow);
  const referenceMs = trustedNow.getTime();
  const pricesReady = prices?.ok === true && Array.isArray(prices.commodities);
  const newsReady = news?.ok === true && Array.isArray(news.items);
  const tradable = (pricesReady ? prices.commodities : [])
    .filter((row) => row?.category !== 'FX' && isTrustedMarketMover(row))
    .map(normalizeMover);
  const gainers = [...tradable].sort((a, b) => b.changePct - a.changePct || a.ticker.localeCompare(b.ticker)).slice(0, 5);
  const losers = [...tradable].sort((a, b) => a.changePct - b.changePct || a.ticker.localeCompare(b.ticker)).slice(0, 5);
  const headlines = (newsReady ? news.items : [])
    .map((item, index) => normalizeHeadline(item, referenceMs, index))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, 8);
  const sentiment = {
    headline: summarizeHeadlineSentiment(headlines),
    cryptoFearGreed: normalizeFearGreed(fearGreed, referenceMs),
  };
  const inputsAsOf = {
    market: typeof prices?.asOf === 'string' ? prices.asOf : null,
    marketFetchedAt: typeof prices?.fetchedAt === 'string' ? prices.fetchedAt : null,
    news: sentiment.headline.updatedAt,
    newsFetchedAt: typeof news?.fetchedAt === 'string' ? news.fetchedAt : null,
    sentiment: latestIso(sentiment.headline.updatedAt, sentiment.cryptoFearGreed?.updatedAt),
  };
  return {
    marketDate,
    signals: {
      gainers,
      losers,
      headlines,
      sentiment,
      asOf: {
        market: inputsAsOf.market,
        marketFetchedAt: inputsAsOf.marketFetchedAt,
        news: inputsAsOf.news,
        newsFetchedAt: inputsAsOf.newsFetchedAt,
        sentiment: inputsAsOf.sentiment,
      },
    },
    evidence: buildEvidence({
      gainers, losers, headlines, sentiment, marketAsOf: inputsAsOf.market,
    }),
    inputsAsOf,
    upstream: {
      pricesReady,
      newsReady,
      trustedMoversReady: tradable.length > 0,
      sentimentReady: sentiment.headline.sampleSize > 0 || Boolean(sentiment.cryptoFearGreed),
    },
  };
}

export function createMarketContextLoader(deps = {}) {
  if (typeof deps.getPrices !== 'function' || typeof deps.getNews !== 'function'
      || typeof deps.getFearGreed !== 'function') {
    throw new TypeError('market_context_dependencies_invalid');
  }
  return async function loadMarketContext() {
    const now = deps.now ? deps.now() : new Date();
    const settled = await Promise.allSettled([
      deps.getPrices(), deps.getNews(), deps.getFearGreed(),
    ]);
    return buildValidatedMarketContext({
      prices: settled[0].status === 'fulfilled' ? settled[0].value : null,
      news: settled[1].status === 'fulfilled' ? settled[1].value : null,
      fearGreed: settled[2].status === 'fulfilled' ? settled[2].value : null,
      now,
    });
  };
}

function trustedInternalOrigin() {
  const candidates = process.env.VERCEL_ENV === 'production'
    ? [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL]
    : [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL];
  for (const configured of candidates) {
    if (!configured) continue;
    try {
      const parsed = new URL(configured.includes('://') ? configured : `https://${configured}`);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.origin;
    } catch {
      // Continue to the constrained loopback origin.
    }
  }
  const configuredPort = Number(process.env.PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : 3000;
  return `http://127.0.0.1:${port}`;
}

async function getJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CommsDashboard/1.0)' },
  });
  if (!response.ok) throw new Error('market_context_upstream_unavailable');
  return response.json();
}

export function createProductionMarketContextLoader(options = {}) {
  const base = options.origin ?? trustedInternalOrigin();
  return createMarketContextLoader({
    getPrices: () => getJson(`${base}/api/prices`),
    getNews: () => getJson(`${base}/api/news`),
    getFearGreed: () => getJson(`${base}/api/fear-greed`),
    now: options.now ?? (() => new Date(Date.now())),
  });
}
