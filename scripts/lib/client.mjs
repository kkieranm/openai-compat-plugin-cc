import { START_HINTS } from './config.mjs';
import { UserError } from './errors.mjs';

export const DEFAULT_TIMEOUT_MS = 300_000;

function buildHeaders(profile) {
  const headers = { 'content-type': 'application/json' };
  if (profile.apiKey) headers.authorization = `Bearer ${profile.apiKey}`;
  return headers;
}

function describeFailure(error, profile, timeoutMs) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new UserError(
      `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${profile.name} at ${profile.baseUrl}.`,
      { hint: 'Local models can be slow to first token — raise --timeout, or timeoutSeconds in the config.' },
    );
  }
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ECONNREFUSED') {
    return new UserError(`Cannot reach ${profile.name} at ${profile.baseUrl} — connection refused.`, {
      hint: START_HINTS[profile.name] ?? 'Check the server is running and the baseUrl in the config is right.',
    });
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new UserError(`Cannot resolve the host in ${profile.baseUrl} (provider "${profile.name}").`);
  }
  return new UserError(
    `Request to ${profile.name} at ${profile.baseUrl} failed: ${error?.message ?? error}${code ? ` (${code})` : ''}`,
  );
}

async function request(profile, path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let response;
  try {
    // The profile's query string belongs after the request path, not inside the
    // base URL (e.g. Azure-style "?api-version=").
    response = await fetch(`${profile.baseUrl}${path}${profile.query ?? ''}`, {
      method,
      headers: buildHeaders(profile),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw describeFailure(error, profile, timeoutMs);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const trimmed = detail.trim().slice(0, 400);
    const error = new UserError(
      `${profile.name} returned HTTP ${response.status} ${response.statusText} for ${path}${trimmed ? `: ${trimmed}` : ''}`,
    );
    // The server answered, so it is up — it just does not serve this endpoint.
    // Callers use this to tell "server down" from "server lacks /v1/models".
    error.serverResponded = true;
    throw error;
  }

  try {
    return await response.json();
  } catch (error) {
    throw new UserError(`${profile.name} returned a non-JSON response for ${path}: ${error.message}`);
  }
}

/**
 * The raw /v1/models payload. Returned whole rather than as ids, because vLLM
 * carries the served context length on the same objects (see model-info.mjs).
 */
export async function fetchModels(profile, { timeoutMs = 10_000 } = {}) {
  return request(profile, '/models', { timeoutMs });
}

/** Auth headers for probing a provider's non-/v1 endpoints on the same host. */
export function authHeaders(profile) {
  return buildHeaders(profile);
}

/** One non-streaming chat completion. Returns the text plus whatever usage the server reported. */
export async function chatCompletion(profile, { model, messages, timeoutMs, temperature, maxTokens }) {
  const body = { model, messages, stream: false };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  const payload = await request(profile, '/chat/completions', { method: 'POST', body, timeoutMs });
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') {
    throw new UserError(
      `${profile.name} returned a completion with no message content (finish_reason: ${choice?.finish_reason ?? 'unknown'}).`,
    );
  }
  return {
    content,
    model: payload.model ?? model,
    usage: payload.usage ?? null,
    finishReason: choice.finish_reason ?? null,
  };
}
