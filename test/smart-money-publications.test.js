import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {
  fetchPublicationSnapshot,
  normalizePublicationEntry,
  publicationStableId,
} from '../lib/smart-money/publications.js';
import { parseFeed } from '../lib/feeds.js';

const FEED_XML = fs.readFileSync(new URL('./fixtures/smart-money/publications/feed.xml', import.meta.url), 'utf8');
const ENTRY = parseFeed(FEED_XML, { allowedOrigins: ['https://publisher.example'] })[0];

test('publication normalization persists metadata and dashboard summary but never provider body', () => {
  const publication = normalizePublicationEntry(ENTRY, {
    officialPublisher: 'Official Publisher', rightsId: 'metadata-source',
    allowedOrigins: ['https://publisher.example'], dashboardSummary: 'A dashboard-authored summary.',
    contentHash: 'metadata-hash',
  });
  assert.deepEqual(publication, {
    id: publicationStableId({ canonicalUrl: 'https://publisher.example/insights/update', contentHash: 'metadata-hash' }),
    title: 'Official & Practical Update', canonicalUrl: 'https://publisher.example/insights/update',
    officialPublisher: 'Official Publisher', publishedAt: '2026-08-26T00:00:00.000Z',
    metadataHash: 'metadata-hash', dashboardSummary: 'A dashboard-authored summary.',
  });
  assert.equal(JSON.stringify(publication).includes('Provider-supplied content'), false);
});

test('publication stable ID is deterministic over canonical URL and metadata hash', () => {
  const contentHash = createHash('sha256').update('metadata').digest('hex');
  assert.equal(publicationStableId({ canonicalUrl: 'https://publisher.example/a', contentHash }), publicationStableId({ canonicalUrl: 'https://publisher.example/a', contentHash }));
});

test('link-only publications do not fetch feeds or document bodies', async () => {
  let requests = 0;
  const result = await fetchPublicationSnapshot({
    providerId: 'oaktree-insights', rightsId: 'oaktree-insights', feedUrl: 'https://www.oaktreecapital.com/feed.xml',
    allowedOrigins: ['https://www.oaktreecapital.com'], officialPublisher: 'Oaktree Capital',
  }, {
    fetchProviderText: async () => { requests += 1; return FEED_XML; },
  });
  assert.deepEqual(result, { publications: [], linkOnly: true });
  assert.equal(requests, 0);
});
