import { XMLParser } from 'fast-xml-parser';
import { load } from 'cheerio';

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '#cdata',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
  htmlEntities: true,
});

function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textValue(value[0]);
  if (typeof value === 'object') {
    return ['#cdata', '#text'].map((key) => textValue(value[key])).filter(Boolean).join('')
      || Object.entries(value)
        .filter(([key]) => !key.startsWith('@_'))
        .map(([, nested]) => textValue(nested))
        .join('');
  }
  return '';
}

function stripHtml(value) {
  const $ = load(`<body>${textValue(value)}</body>`, { decodeEntities: true });
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function linkValue(value, { preferAlternate = false } = {}) {
  const links = asArray(value);
  const sorted = preferAlternate
    ? [...links].sort((a, b) => Number(textValue(b?.['@_rel']) === 'alternate') - Number(textValue(a?.['@_rel']) === 'alternate'))
    : links;
  for (const link of sorted) {
    const href = typeof link === 'object' ? textValue(link?.['@_href']) : textValue(link);
    if (href) return href.trim();
  }
  return '';
}

function parseCanonicalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(key)) parsed.searchParams.delete(key);
  }
  return parsed;
}

export function canonicalizeSourceUrl(url, allowedOrigins) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) return null;
  const parsed = parseCanonicalUrl(url);
  if (!parsed) return null;
  const origins = new Set(allowedOrigins.map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }).filter(Boolean));
  if (!origins.has(parsed.origin)) return null;
  return parsed.toString();
}

function normalizeEntry(entry, canonicalizeUrl, atom = false) {
  const title = stripHtml(entry?.title);
  const rawUrl = linkValue(entry?.link, { preferAlternate: atom });
  const url = canonicalizeUrl(rawUrl);
  if (!title || !url) return null;
  return {
    title,
    url,
    pubDate: textValue(atom ? (entry?.published || entry?.updated) : entry?.pubDate).trim(),
    description: stripHtml(atom ? (entry?.summary || entry?.content) : entry?.description),
    source: stripHtml(atom ? (entry?.source?.title || entry?.author?.name) : entry?.source),
  };
}

function parseEntries(xml, maxItems, canonicalizeUrl) {
  if (typeof xml !== 'string' || !Number.isInteger(maxItems) || maxItems < 1) return [];
  let document;
  try {
    document = parser.parse(xml);
  } catch {
    return [];
  }
  const rssItems = asArray(document?.rss?.channel).flatMap((channel) => asArray(channel?.item));
  const atomEntries = asArray(document?.feed?.entry);
  const items = rssItems.length
    ? rssItems.map((entry) => normalizeEntry(entry, canonicalizeUrl))
    : atomEntries.map((entry) => normalizeEntry(entry, canonicalizeUrl, true));
  return items.filter(Boolean).slice(0, maxItems);
}

export function parseFeed(xml, { maxItems = 20, allowedOrigins = [] } = {}) {
  return parseEntries(xml, maxItems, (url) => canonicalizeSourceUrl(url, allowedOrigins));
}

// Google News is a trusted discovery feed and may provide the publisher's
// canonical HTTPS URL instead of a news.google.com redirect. This compatibility
// wrapper is intentionally separate from strict provider `parseFeed()`.
export function parseGoogleNewsFeed(xml, { maxItems = 20 } = {}) {
  return parseEntries(xml, maxItems, (url) => parseCanonicalUrl(url)?.toString() || null);
}
