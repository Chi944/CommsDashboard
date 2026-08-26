const DEFAULT_READ_ATTEMPTS = 4;
const STRONG_ETAG_PATTERN = /^"[\x21\x23-\x7E\u0080-\u00FF]*"$/;

function blobCasReadError() {
  const error = new Error('blob_cas_read_failed');
  error.code = 'blob_cas_read_failed';
  return error;
}

function opaqueEtag(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) return null;
  const opaque = value.startsWith('W/') ? value.slice(2) : value;
  return STRONG_ETAG_PATTERN.test(opaque) ? opaque : null;
}

function strongEtag(value) {
  return typeof value === 'string'
    && value.length >= 2
    && value.length <= 4_096
    && STRONG_ETAG_PATTERN.test(value);
}

async function discard(result) {
  try {
    await result?.stream?.cancel?.();
  } catch {
    // A retry or fixed failure remains authoritative.
  }
}

export async function readPrivateBlobForCas({
  pathname,
  head,
  get,
  isNotFound,
  headOptions = {},
  getOptions = { access: 'private', useCache: false },
  attempts = DEFAULT_READ_ATTEMPTS,
}) {
  if (typeof pathname !== 'string' || pathname.length < 1
      || typeof head !== 'function' || typeof get !== 'function'
      || typeof isNotFound !== 'function') throw blobCasReadError();
  const boundedAttempts = Number.isInteger(attempts) && attempts > 0
    ? Math.min(attempts, 20)
    : DEFAULT_READ_ATTEMPTS;

  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    let metadata;
    try {
      metadata = await head(pathname, headOptions);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      try {
        const appeared = await get(pathname, getOptions);
        if (appeared?.stream) {
          await discard(appeared);
          continue;
        }
        if (appeared === null) return { result: null, etag: null };
        throw blobCasReadError();
      } catch (readError) {
        if (isNotFound(readError)) return { result: null, etag: null };
        throw readError;
      }
    }

    if (!strongEtag(metadata?.etag)) throw blobCasReadError();

    // Capture the strong validator before the body. A concurrent update makes
    // the opaque tags differ and retries the read pair, so no newer value can
    // be overwritten using a validator captured after an older body.
    let result;
    try {
      result = await get(pathname, getOptions);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    if (!result?.stream) continue;
    if (opaqueEtag(result.blob?.etag) !== metadata.etag) {
      await discard(result);
      continue;
    }
    return { result, etag: metadata.etag };
  }

  throw blobCasReadError();
}
