import { readText } from './body.mjs';
import { START_HINTS } from './config.mjs';
import { UserError } from './errors.mjs';
import { send } from './http.mjs';

/**
 * One request to a provider: headers, the non-2xx contract, and the failure
 * descriptions callers depend on.
 *
 * Its own module so `client.mjs` and `chat.mjs` can both use it without a cycle
 * — the alternative was chat importing client while client imported chat, which
 * ESM tolerates only by accident.
 */

/**
 * How long an error body may stall mid-read. Short: the server has already
 * decided to fail, so this is prose, not generation.
 */
const ERROR_BODY_IDLE_MS = 10_000;

function buildHeaders(profile) {
  const headers = { 'content-type': 'application/json' };
  if (profile.apiKey) headers.authorization = `Bearer ${profile.apiKey}`;
  return headers;
}

function describeFailure(error, profile) {
  // The transport already names which budget elapsed and what had arrived, so
  // re-describing it here would replace a diagnosis with a guess — which is what
  // the old blanket "raise --timeout" hint did for a cause it never established.
  if (error instanceof UserError) {
    if (error.reason?.endsWith('-timeout') || error.reason === 'protocol' || error.reason === 'bad-json') return error;
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
  if (error instanceof UserError) return error;
  return new UserError(
    `Request to ${profile.name} at ${profile.baseUrl} failed: ${error?.message ?? error}${code ? ` (${code})` : ''}`,
  );
}

/**
 * Non-2xx, kept here rather than in the transport: the message carries the
 * provider's name and the first 400 characters of the body, and
 * `structured.mjs` pattern-matches that body to decide whether a schema was
 * refused. Moving this would lose `.status` silently.
 */
async function assertOk(profile, path, response) {
  if (response.status >= 200 && response.status < 300) return;

  // Redirects are refused rather than followed. `fetch` followed them silently,
  // and a proxy redirecting a POST to an HTML login page arrived as "invalid
  // JSON" — naming the wrong problem entirely.
  const redirect = response.status >= 300 && response.status < 400;
  // A size cap is not a time cap. A server that answers 400, writes one byte and
  // then holds the socket open would park this read forever — and on the chat
  // path there is no total deadline to catch it, so the degrade ladder that
  // depends on this error would never even start.
  response.setIdle(ERROR_BODY_IDLE_MS);
  const detail = redirect ? '' : await readText(response, { limit: 400 }).catch(() => '');
  if (redirect) response.dispose();

  const error = new UserError(
    redirect
      ? `${profile.name} redirected ${path} (HTTP ${response.status}) to ${response.headers.location ?? 'an unnamed location'}.`
      : `${profile.name} returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''} for ${path}` +
        `${detail.trim() ? `: ${detail.trim()}` : ''}`,
    redirect ? { hint: 'Point baseUrl at the final URL — redirects are deliberately not followed.' } : undefined,
  );
  // The server answered, so it is up — it just does not serve this endpoint.
  // Callers use this to tell "server down" from "server lacks /v1/models".
  error.serverResponded = true;
  // Kept separate from the message so a caller can test the status without
  // pattern-matching prose (structured.mjs discriminates a 400 this way).
  error.status = response.status;
  throw error;
}

export async function request(profile, path, { method = 'GET', body, firstByteMs, totalMs } = {}) {
  // The profile's query string belongs after the request path, not inside the
  // base URL (e.g. Azure-style "?api-version=").
  const url = `${profile.baseUrl}${path}${profile.query ?? ''}`;
  let response;
  try {
    response = await send(url, {
      method,
      headers: buildHeaders(profile),
      body: body === undefined ? undefined : JSON.stringify(body),
      firstByteMs,
      totalMs,
    });
  } catch (error) {
    throw describeFailure(error, profile);
  }
  await assertOk(profile, path, response);
  return response;
}

/** Auth headers for probing a provider's non-/v1 endpoints on the same host. */
export function authHeaders(profile) {
  return buildHeaders(profile);
}
