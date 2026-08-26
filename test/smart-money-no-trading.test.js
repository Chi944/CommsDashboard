import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  fetchHyperliquidAccountState,
  fetchHyperliquidLeaderboard,
  fetchHyperliquidPortfolio,
  fetchHyperliquidRecentFills,
  fetchHyperliquidSnapshot,
} from '../lib/smart-money/hyperliquid.js';
import { fetchProviderJson } from '../lib/smart-money/http.js';
import {
  fetchPolymarketClosedPositions,
  fetchPolymarketLeaderboard,
  fetchPolymarketPositions,
  fetchPolymarketSnapshot,
} from '../lib/smart-money/polymarket.js';

const FORBIDDEN_EXPORT = /(?:create|prepare|route|submit|place|execute|sign)(?:Real)?(?:Order|Trade|Allocation|Withdrawal|Deposit)|(?:Broker|Exchange|Wallet)(?:Credential|Secret|Token|PrivateKey)/i;
const FORBIDDEN_FIELD = /^(?:orderPayload|orderType|timeInForce|targetAllocation|walletSignature|walletPrivateKey|exchangeApiKey|exchangeSecret|brokerToken|depositAddress|withdrawalAddress)$/i;

async function javascriptFiles(root) {
  const rows = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) rows.push(...await javascriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) rows.push(absolute);
  }
  return rows.sort();
}

function inspectData(value, seen = new Set()) {
  if (value == null || typeof value === 'function' || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, FORBIDDEN_FIELD);
    inspectData(child, seen);
  }
}

test('every Smart Money library and API module exposes no trading or credential capability', async () => {
  const roots = [
    path.resolve('lib/smart-money'),
    path.resolve('api/smart-money'),
  ];
  const files = [
    ...await javascriptFiles(roots[0]),
    path.resolve('api/smart-money.js'),
    ...await javascriptFiles(roots[1]),
  ];
  assert.ok(files.some((file) => file.endsWith(`${path.sep}refresh.js`)));
  for (const file of files) {
    const module = await import(`${pathToFileURL(file).href}?no-trading-audit=1`);
    for (const [name, value] of Object.entries(module)) {
      assert.doesNotMatch(name, FORBIDDEN_EXPORT, `${file} export ${name}`);
      inspectData(value);
    }
  }
});

test('dormant Polymarket and Hyperliquid production entries make zero network calls', async () => {
  const captured = [];
  const deps = {
    fetchProviderJson: async (url, options) => {
      captured.push({ url, options });
      return [];
    },
  };
  const wallet = '0x0000000000000000000000000000000000000abc';
  await Promise.all([
    fetchPolymarketLeaderboard({}, deps),
    fetchPolymarketPositions(wallet, deps),
    fetchPolymarketClosedPositions(wallet, deps),
    fetchPolymarketSnapshot({}, deps),
    fetchHyperliquidLeaderboard(deps),
    fetchHyperliquidAccountState(wallet, deps),
    fetchHyperliquidPortfolio(wallet, deps),
    fetchHyperliquidRecentFills(wallet, { startTime: 1, endTime: 2 }, deps),
    fetchHyperliquidSnapshot({}, deps),
  ]);
  assert.deepEqual(captured, []);
});

test('captured enabled transport origins and payloads contain no trading or secret query data', async () => {
  const captured = [];
  await fetchProviderJson('https://data.sec.gov/test', {
    providerId: 'sec-edgar',
    allowedOrigins: ['https://data.sec.gov'],
    fetchImpl: async (url, options) => {
      captured.push({ url: String(url), options });
      const response = Response.json({ ok: true });
      Object.defineProperty(response, 'url', { value: String(url) });
      return response;
    },
  });
  assert.deepEqual(captured.map((request) => new URL(request.url).origin), ['https://data.sec.gov']);
  for (const request of captured) {
    const url = new URL(request.url);
    for (const key of url.searchParams.keys()) {
      assert.doesNotMatch(key, /secret|token|key|credential|signature/i);
    }
    assert.equal(request.options.redirect, 'manual');
    const body = request.options.body;
    if (body != null) inspectData(JSON.parse(body));
  }
});
