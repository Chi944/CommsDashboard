import assert from 'node:assert/strict';
import test from 'node:test';

import { writeNewestBlobCache } from '../lib/market/store.js';
import { writeNewestSmartMoneyBlob } from '../lib/smart-money/store.js';
import { readPrivateBlobForCas } from '../lib/storage/blob-cas.js';

function jsonResult(data, etag) {
  return {
    statusCode: 200,
    stream: new Response(JSON.stringify(data)).body,
    blob: { etag },
  };
}

function snapshot(refreshStartedAt, label) {
  return { refreshStartedAt, label };
}

test('Blob CAS reads head before get and ignores the weak get ETag', async () => {
  const calls = [];
  const record = await readPrivateBlobForCas({
    pathname: 'smart-money/v1/journal/manifest.json',
    head: async () => {
      calls.push('head');
      return { etag: '"strong-etag"' };
    },
    get: async () => {
      calls.push('get');
      return jsonResult({ schemaVersion: 2 }, 'W/"strong-etag"');
    },
    isNotFound: () => false,
  });

  assert.deepEqual(calls, ['head', 'get']);
  assert.equal(record.etag, '"strong-etag"');
  assert.equal(record.result.blob.etag, 'W/"strong-etag"');
});

test('Blob CAS verifies a missing head with get before reporting an absent record', async () => {
  const notFound = Object.assign(new Error('missing'), { name: 'BlobNotFoundError' });
  const calls = [];
  const record = await readPrivateBlobForCas({
    pathname: 'smart-money/v1/snapshot.json',
    head: async () => {
      calls.push('head');
      throw notFound;
    },
    get: async () => {
      calls.push('get');
      return null;
    },
    isNotFound: (error) => error?.name === 'BlobNotFoundError',
  });

  assert.deepEqual(record, { result: null, etag: null });
  assert.deepEqual(calls, ['head', 'get']);
});

test('Blob CAS retries when a missing path appears before the verification get', async () => {
  const notFound = Object.assign(new Error('missing'), { name: 'BlobNotFoundError' });
  const calls = [];
  let exists = false;
  const record = await readPrivateBlobForCas({
    pathname: 'smart-money/v1/snapshot.json',
    head: async () => {
      calls.push('head');
      if (!exists) throw notFound;
      return { etag: '"created"' };
    },
    get: async () => {
      calls.push('get');
      exists = true;
      return jsonResult({ created: true }, 'W/"created"');
    },
    isNotFound: (error) => error?.name === 'BlobNotFoundError',
  });

  assert.equal(record.etag, '"created"');
  assert.deepEqual(calls, ['head', 'get', 'head', 'get']);
});

test('Blob CAS retries a concurrent winner between head and get before writing', async () => {
  let state = {
    data: snapshot('2026-08-26T01:00:00.000Z', 'initial'),
    etag: '"etag-1"',
  };
  let interleave = true;
  const calls = [];
  const writeEtags = [];
  const conflict = Object.assign(new Error('conflict'), { name: 'BlobPreconditionFailedError' });

  const adapter = {
    read: () => readPrivateBlobForCas({
      pathname: 'smart-money/v1/snapshot.json',
      head: async () => {
        calls.push(`head:${state.etag}`);
        return { etag: state.etag };
      },
      get: async () => {
        if (interleave) {
          interleave = false;
          state = {
            data: snapshot('2026-08-26T02:00:00.000Z', 'concurrent-winner'),
            etag: '"etag-2"',
          };
        }
        calls.push(`get:${state.etag}`);
        return jsonResult(state.data, `W/${state.etag}`);
      },
      isNotFound: () => false,
    }).then(async ({ result, etag }) => ({
      data: JSON.parse(await new Response(result.stream).text()),
      etag,
    })),
    async write(data, expectedEtag) {
      writeEtags.push(expectedEtag);
      if (expectedEtag !== state.etag) throw conflict;
      state = { data: structuredClone(data), etag: '"etag-3"' };
    },
    isConflict: (error) => error?.name === 'BlobPreconditionFailedError',
  };

  const incoming = snapshot('2026-08-26T03:00:00.000Z', 'incoming');
  const result = await writeNewestSmartMoneyBlob(incoming, adapter);

  assert.deepEqual(result, { ok: true, skipped: false, error: null });
  assert.deepEqual(calls, [
    'head:"etag-1"', 'get:"etag-2"',
    'head:"etag-2"', 'get:"etag-2"',
  ]);
  assert.deepEqual(writeEtags, ['"etag-2"']);
  assert.deepEqual(state.data, incoming);
});

test('market Blob overwrite uses the strong head ETag instead of the weak get ETag', async () => {
  let stored = { refreshedAt: '2026-08-26T01:00:00.000Z', marker: 'old' };
  let expectedWriteEtag = null;
  const adapter = {
    read: () => readPrivateBlobForCas({
      pathname: 'market/provider-cache.json',
      head: async () => ({ etag: '"market-etag"' }),
      get: async () => jsonResult(stored, 'W/"market-etag"'),
      isNotFound: () => false,
    }).then(async ({ result, etag }) => ({
      data: JSON.parse(await new Response(result.stream).text()),
      etag,
    })),
    async write(payload, expectedEtag) {
      expectedWriteEtag = expectedEtag;
      stored = structuredClone(payload);
    },
  };
  const incoming = { refreshedAt: '2026-08-26T02:00:00.000Z', marker: 'new' };

  assert.deepEqual(
    await writeNewestBlobCache(incoming, adapter),
    { ok: true, skipped: false, error: null },
  );
  assert.equal(expectedWriteEtag, '"market-etag"');
  assert.deepEqual(stored, incoming);
});

test('Blob CAS fails closed when head does not return a quoted strong validator', async () => {
  for (const etag of [
    'W/"weak-only"',
    'bare-etag',
    '"space invalid"',
    '"control\u0000invalid"',
    `"${'a'.repeat(4_095)}"`,
  ]) {
    await assert.rejects(
      readPrivateBlobForCas({
        pathname: 'smart-money/v1/snapshot.json',
        head: async () => ({ etag }),
        get: async () => jsonResult({}, etag),
        isNotFound: () => false,
      }),
      (error) => error?.code === 'blob_cas_read_failed',
    );
  }
});
