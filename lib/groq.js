const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function getGroqModel() {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

export class GroqProviderError extends Error {
  constructor(code, { status = null, providerCode = null, requestId = null, retryAfter = null } = {}) {
    super(code);
    this.name = 'GroqProviderError';
    this.code = code;
    this.status = status;
    this.providerCode = providerCode;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

function providerErrorCode(status) {
  if ([400, 401, 403, 404].includes(status)) return 'provider_configuration_error';
  if (status === 429) return 'provider_rate_limited';
  return 'provider_unavailable';
}

function isGptOss(model) {
  return model === 'openai/gpt-oss-120b' || model === 'openai/gpt-oss-20b';
}

function reasoningEffort() {
  const configured = process.env.GROQ_REASONING_EFFORT?.trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(configured) ? configured : 'low';
}

function requestTimeoutMs() {
  const configured = Number(process.env.GROQ_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 15_000;
}

export async function requestGroqCompletion({ messages, temperature, maxCompletionTokens }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const model = getGroqModel();
  const body = {
    model,
    temperature,
    max_completion_tokens: maxCompletionTokens,
    messages,
  };
  if (isGptOss(model)) {
    body.reasoning_effort = reasoningEffort();
    body.include_reasoning = false;
  }

  let response;
  let responseText;
  let bodyError = null;
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new GroqProviderError('provider_unavailable'));
    }, requestTimeoutMs());
  });
  try {
    ({ response, responseText, bodyError } = await Promise.race([
      (async () => {
        const upstreamResponse = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        try {
          return {
            response: upstreamResponse,
            responseText: await upstreamResponse.text(),
            bodyError: null,
          };
        } catch (error) {
          return { response: upstreamResponse, responseText: null, bodyError: error };
        }
      })(),
      deadline,
    ]));
  } catch {
    throw new GroqProviderError('provider_unavailable');
  } finally {
    clearTimeout(timeout);
  }

  const requestId = response.headers.get('x-request-id');
  if (bodyError) {
    if (controller.signal.aborted || bodyError?.name === 'AbortError') {
      throw new GroqProviderError('provider_unavailable');
    }
    if (!response.ok) {
      throw new GroqProviderError(providerErrorCode(response.status), {
        status: response.status,
        requestId,
        retryAfter: response.headers.get('retry-after'),
      });
    }
    throw new GroqProviderError('provider_invalid_response', { status: response.status, requestId });
  }
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    if (!response.ok) {
      throw new GroqProviderError(providerErrorCode(response.status), {
        status: response.status,
        requestId,
        retryAfter: response.headers.get('retry-after'),
      });
    }
    throw new GroqProviderError('provider_invalid_response', { status: response.status, requestId });
  }

  if (!response.ok) {
    throw new GroqProviderError(providerErrorCode(response.status), {
      status: response.status,
      providerCode: payload?.error?.code || payload?.error?.type || null,
      requestId,
      retryAfter: response.headers.get('retry-after'),
    });
  }

  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new GroqProviderError('provider_invalid_response', { status: response.status, requestId });
  }

  return { text: text.trim(), model: `${model} (Groq)` };
}
