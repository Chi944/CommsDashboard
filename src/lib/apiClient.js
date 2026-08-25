function responseMessage(payload, status) {
  if (typeof payload?.error === 'string') return payload.error;
  return payload?.error?.message
    || payload?.aiError
    || payload?.aiStatus?.message
    || `status ${status}`;
}

/** Parse an API response while preserving useful data returned with a handled AI degradation. */
export async function readDashboardJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`status ${response.status}`);
  }

  const handledAiState = ['degraded', 'rate_limited'].includes(payload?.aiStatus?.state);
  if ((!response.ok || payload?.ok === false) && !handledAiState) {
    throw new Error(responseMessage(payload, response.status));
  }
  return payload;
}
