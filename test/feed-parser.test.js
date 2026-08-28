import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeSourceUrl, parseFeed } from '../lib/feeds.js';
import newsHandler from '../api/news.js';
import assetNewsHandler from '../api/asset-news.js';

function responseRecorder() {
  return {
    body: null,
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

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

test('strict parseFeed has no external-link bypass while Google News handlers preserve response shape', async () => {
  const xml = '<rss><channel><item><title>News</title><link>https://publisher.example/story?utm_source=x</link><pubDate>Wed, 26 Aug 2026 00:00:00 GMT</pubDate><description><![CDATA[<b>Details</b>]]></description><source>Publisher</source></item></channel></rss>';
  assert.deepEqual(parseFeed(xml, { allowedOrigins: ['https://news.google.com'] }), []);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(xml, { headers: { 'content-type': 'application/rss+xml' } });
  try {
    const news = responseRecorder();
    const asset = responseRecorder();
    await newsHandler({}, news);
    await assetNewsHandler({ query: { q: 'Nvidia', limit: '1' } }, asset);

    assert.equal(news.statusCode, 200);
    assert.deepEqual(Object.keys(news.body).sort(), ['fetchedAt', 'freshness', 'items', 'ok']);
    assert.equal(news.body.freshness.isFresh, true);
    assert.equal(news.body.freshness.maxAgeHours, 168);
    assert.deepEqual(Object.keys(news.body.items[0]).sort(), ['category', 'desc', 'headline', 'id', 'source', 'time', 'ts', 'url']);
    assert.equal(news.body.items[0].url, 'https://publisher.example/story');
    assert.equal(asset.statusCode, 200);
    assert.deepEqual(Object.keys(asset.body).sort(), ['asOf', 'fetchedAt', 'freshness', 'items', 'ok', 'query']);
    assert.equal(asset.body.freshness.isFresh, true);
    assert.equal(asset.body.freshness.maxAgeHours, 168);
    assert.deepEqual(Object.keys(asset.body.items[0]).sort(), ['desc', 'headline', 'id', 'source', 'time', 'ts', 'url']);
    assert.equal(asset.body.items[0].url, 'https://publisher.example/story');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
