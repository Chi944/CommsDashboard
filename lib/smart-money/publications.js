import { createHash } from 'node:crypto';

import { canonicalizeSourceUrl, parseFeed } from '../feeds.js';
import { fetchProviderText } from './http.js';
import { canUseSourceFor } from './rights.js';

const MAX_DASHBOARD_SUMMARY_LENGTH = 600;
const OFFICIAL_PUBLICATION_RIGHTS_IDS = new Set([
  'leopold-official',
  'berkshire-letters',
  'pershing-performance',
  'fundsmith-documents',
  'oaktree-insights',
  'ark-publications',
]);

function metadataHash({ title, canonicalUrl, officialPublisher, publishedAt }) {
  return createHash('sha256')
    .update(JSON.stringify({ title, canonicalUrl, officialPublisher, publishedAt }))
    .digest('hex');
}

function publishedAt(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function dashboardSummary({ title, officialPublisher, publishedAt }) {
  return `Official publication from ${officialPublisher} on ${publishedAt.slice(0, 10)}: ${title}`
    .slice(0, MAX_DASHBOARD_SUMMARY_LENGTH);
}

function cachePermitted(rightsId) {
  return OFFICIAL_PUBLICATION_RIGHTS_IDS.has(rightsId) && ['fetch', 'cache', 'history', 'display', 'attribute']
    .every((purpose) => canUseSourceFor(rightsId, purpose));
}

export function publicationStableId({ canonicalUrl, contentHash }) {
  return `publication:${createHash('sha256')
    .update(`${String(canonicalUrl)}\n${String(contentHash)}`)
    .digest('hex')
    .slice(0, 24)}`;
}

export function normalizePublicationEntry(entry, config = {}) {
  if (!cachePermitted(config.rightsId)) return null;
  const canonicalUrl = canonicalizeSourceUrl(entry?.canonicalUrl || entry?.url, config.allowedOrigins);
  const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
  const officialPublisher = typeof config.officialPublisher === 'string' ? config.officialPublisher.trim() : '';
  const normalizedPublishedAt = publishedAt(entry?.publishedAt || entry?.pubDate);
  if (!canonicalUrl || !title || !officialPublisher || !normalizedPublishedAt) return null;
  const contentHash = metadataHash({
    title, canonicalUrl, officialPublisher, publishedAt: normalizedPublishedAt,
  });
  return {
    id: publicationStableId({ canonicalUrl, contentHash }),
    title,
    canonicalUrl,
    officialPublisher,
    publishedAt: normalizedPublishedAt,
    metadataHash: contentHash,
    dashboardSummary: dashboardSummary({ title, officialPublisher, publishedAt: normalizedPublishedAt }),
  };
}

export async function fetchPublicationSnapshot(config = {}, deps = {}) {
  if (!cachePermitted(config.rightsId)) return { publications: [], linkOnly: true };
  const fetchText = deps.fetchProviderText || fetchProviderText;
  const xml = await fetchText(config.feedUrl, {
    providerId: config.providerId,
    allowedOrigins: config.allowedOrigins,
    maxRetries: 1,
  });
  const publications = parseFeed(xml, {
    allowedOrigins: config.allowedOrigins,
    maxItems: Number.isInteger(config.maxItems) ? config.maxItems : 20,
  }).map((entry) => normalizePublicationEntry(entry, config)).filter(Boolean);
  return { publications, linkOnly: false };
}
