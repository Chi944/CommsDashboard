import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
const SOURCE_EXTENSIONS = /\.(?:js|jsx|ts|tsx)$/;
const FORBIDDEN_SOURCE = Object.freeze([
  /\b(?:create|prepare|route|submit|place|execute|sign)(?:Real)?(?:Order|Trade|Allocation|Withdrawal|Deposit)\b/i,
  /["'`]\/(?:api\/)?(?:orders?|trades?|broker|exchange|wallet|withdraw|deposit)(?:\/|[?"'`])/i,
  /\b(?:orderPayload|timeInForce|targetAllocation|walletSignature|walletPrivateKey|exchangeApiKey|exchangeSecret|brokerToken)\b/i,
  /(?:from\s*|require\s*\()["'`](?:ethers|web3|wagmi|viem|ccxt|@alpacahq\/|coinbase|binance|ibkr)/i,
]);

async function javascriptFiles(root) {
  const rows = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) rows.push(...await javascriptFiles(absolute));
    else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) rows.push(absolute);
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
    path.resolve('server/smart-money'),
  ];
  const files = [
    path.resolve('api/smart-money.js'),
    ...(await Promise.all(roots.map(javascriptFiles))).flat(),
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

test('all production JS, JSX, TS, and TSX surfaces contain no execution path or trading SDK', async () => {
  const explicitFiles = [
    path.resolve('api/smart-money.js'),
    path.resolve('src/App.jsx'),
  ];
  const roots = [
    path.resolve('lib/smart-money'),
    path.resolve('api/smart-money'),
    path.resolve('server/smart-money'),
    path.resolve('src/state'),
    path.resolve('src/lib'),
    path.resolve('src/components/smart-money'),
  ];
  const files = [
    ...explicitFiles,
    ...(await Promise.all(roots.map(javascriptFiles))).flat(),
  ];
  assert.ok(files.some((file) => file.endsWith(`${path.sep}SmartMoney.jsx`)));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const forbidden of FORBIDDEN_SOURCE) {
      assert.doesNotMatch(source, forbidden, file);
    }
  }

  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  const dependencies = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }).join('\n');
  assert.doesNotMatch(dependencies, /^(?:ethers|web3|wagmi|viem|ccxt|@alpacahq\/|coinbase|binance|ibkr)$/im);
});

test('the built browser bundle contains no order endpoint, credential DTO, or trading SDK', async () => {
  let files;
  try {
    files = (await readdir(path.resolve('dist/assets'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.js$/.test(entry.name))
      .map((entry) => path.resolve('dist/assets', entry.name));
  } catch {
    assert.fail('dist/assets is required; run npm run build before the release bundle audit');
  }
  assert.ok(files.length > 0);
  const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  for (const forbidden of FORBIDDEN_SOURCE) assert.doesNotMatch(source, forbidden);
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
