import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeSourceUrl, parseFeed } from '../lib/feeds.js';

test('shared feed parser keeps only allowlisted canonical links', () => {
  const xml = '<rss><channel><item><title>A</title><link>https://example.com/a?utm_source=x</link><pubDate>Wed, 26 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>';
  const rows = parseFeed(xml, { maxItems: 5, allowedOrigins: ['https://example.com'] });
  assert.deepEqual(rows.map((row) => row.url), ['https://example.com/a']);
});

test('shared feed parser preserves legacy RSS fields and rejects off-allowlist links', () => {
  const xml = '<rss><channel><item><title><![CDATA[Title &amp; More]]></title><link>https://news.google.com/article/one?gclid=x</link><pubDate>Wed, 26 Aug 2026 00:00:00 GMT</pubDate><description><![CDATA[<b>Summary</b>]]></description><source>Wire</source></item><item><title>Blocked</title><link>https://evil.example/story</link></item></channel></rss>';
  const rows = parseFeed(xml, { maxItems: 5, allowedOrigins: ['https://news.google.com'] });
  assert.deepEqual(rows, [{
    title: 'Title & More',
    url: 'https://news.google.com/article/one',
    pubDate: 'Wed, 26 Aug 2026 00:00:00 GMT',
    description: 'Summary',
    source: 'Wire',
  }]);
});

test('shared feed parser normalizes Atom alternate links', () => {
  const xml = '<feed><entry><title>Atom item</title><link rel="self" href="https://example.com/feed"/><link rel="alternate" href="https://example.com/item?fbclid=x"/><updated>2026-08-26T00:00:00Z</updated><summary>Details</summary><author><name>Example</name></author></entry></feed>';
  const rows = parseFeed(xml, { maxItems: 5, allowedOrigins: ['https://example.com'] });
  assert.deepEqual(rows, [{
    title: 'Atom item',
    url: 'https://example.com/item',
    pubDate: '2026-08-26T00:00:00Z',
    description: 'Details',
    source: 'Example',
  }]);
});

test('canonicalizeSourceUrl strips tracking parameters and enforces exact origins', () => {
  assert.equal(
    canonicalizeSourceUrl('https://example.com/a?utm_source=x&keep=1&fbclid=y', ['https://example.com']),
    'https://example.com/a?keep=1',
  );
  assert.equal(canonicalizeSourceUrl('https://example.com.evil/a', ['https://example.com']), null);
});
