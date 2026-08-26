const PUBLIC_PROVIDER_ERROR_CODES = new Set([
  'rights_gate_failed',
  'configuration_missing',
  'origin_not_allowed',
  'timeout',
  'rate_limited',
  'invalid_content_type',
  'response_too_large',
  'invalid_json',
  'schema_invalid',
  'empty_dataset',
]);

export class ProviderError extends Error {
  constructor(code, providerId, retryAfterMs = null) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
  }
}

export function sanitizeProviderError(error) {
  return PUBLIC_PROVIDER_ERROR_CODES.has(error?.code)
    ? error.code
    : 'provider_unavailable';
}
