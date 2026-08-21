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

/**
 * A better message for the same failure — carrying every classification the
 * transport already made.
 *
 * This function used to build bare `UserError`s, and that silently discarded
 * `reason`, `code` and `cause` for exactly the three codes it names below. The
 * consequence: a real `EAI_AGAIN` is classified retryable by `transportError`
 * and then arrived at
 * `answerWithRetry` with **no reason at all**, so it was never retried; and a
 * terminal `ENOTFOUND` or `ECONNREFUSED` was recorded in the attempt ledger as
 * `unclassified`, beside genuinely unrecognised failures, in the very table the
 * benchmark exists to read.
 *
 * Rewording a failure must never reclassify it. The message is this layer's to
 * improve — it is the only one that knows the provider's name and its start
 * hint — while the reason belongs to the layer that saw what happened.
 */
function reword(error, message, options) {
  const worded = new UserError(message, options);
  worded.reason = error?.reason;
  worded.code = error?.cause?.code ?? error?.code;
  worded.cause = error?.cause ?? error;
  // Only ever set, never cleared: `budgetError` and `transportError` leave it
  // absent rather than false, and cmd-setup reads truthiness.
  if (error?.serverResponded) worded.serverResponded = true;
  return worded;
}

/**
 * The endpoint a transport failure names, kept OFF `.message`.
 *
 * `.message` is what `errorReport()` persists into `jobs.db` and what an
 * uncaught worker error prints to its own job log — both longer-lived than
 * this process, and `baseUrl` can be secret-shaped (a credential embedded in
 * its path or query). Only a genuinely interactive command's own top-level
 * catch (`oai-companion.mjs`, gated on an explicit allowlist) may append this
 * field when printing to the operator's own terminal.
 */
function describeFailure(error, profile) {
  // The transport already names which budget elapsed and what had arrived, so
  // re-describing it here would replace a diagnosis with a guess — which is what
  // the old blanket "raise --timeout" hint did for a cause it never established.
  if (error instanceof UserError) {
    if (error.reason?.endsWith('-timeout') || error.reason === 'protocol' || error.reason === 'bad-json') return error;
  }
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ECONNREFUSED') {
    const worded = reword(error, `Cannot reach ${profile.name} — connection refused.`, {
      hint: START_HINTS[profile.name] ?? 'Check the server is running and the baseUrl in the config is right.',
    });
    worded.endpoint = profile.baseUrl;
    return worded;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    const worded = reword(error, `Cannot resolve the host for provider "${profile.name}".`);
    worded.endpoint = profile.baseUrl;
    return worded;
  }
  if (error instanceof UserError) return error;
  // Generic fallback: neither `profile.baseUrl` nor the underlying transport
  // error's own `.message` may appear here — a Node syscall error's `.message`
  // routinely carries the request URL itself, which is the same secret shape
  // one layer down.
  const worded = reword(
    error,
    `Request to ${profile.name} failed${code ? ` (${code})` : ''}.`,
  );
  worded.endpoint = profile.baseUrl;
  return worded;
}

/**
 * Non-2xx, kept here rather than in the transport: the message carries the
 * provider's name and HTTP status, and the first 400 characters of the body
 * go on `.responseBody` rather than `.message` — a server routinely
 * echoes the request path back in a 404/405 body, which can carry the same
 * secret-shaped `baseUrl` segment `describeFailure()` guards against.
 * `structured.mjs` pattern-matches that body via `.responseBody`, not
 * `.message`, to decide whether a schema was refused. `.status` stays
 * separate for the same reason it always was — a caller tests it without
 * pattern-matching prose. A redirect's `Location` is exactly as server-
 * controlled as a response body — it folds onto the same `.responseBody`
 * field rather than into `.message`, so the operator-only hint below stays
 * displayable through the same interactive-allowlist path the body uses,
 * instead of naming a URL that then has nowhere to show up. `statusText`
 * folds onto the same field for the same reason, rather than being dropped
 * outright: a server that signals a capability refusal purely through the
 * HTTP reason phrase, with an empty body, would otherwise have
 * `isFormatRejection`/`refusedField` lose that signal entirely — both read
 * `.responseBody`, so it must carry everything the old `.message` did, not
 * just the body half of it.
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
      ? `${profile.name} redirected ${path} (HTTP ${response.status}).`
      : `${profile.name} returned HTTP ${response.status} for ${path}.`,
    redirect ? { hint: 'Point baseUrl at the final URL — redirects are deliberately not followed.' } : undefined,
  );
  // The server answered, so it is up — it just does not serve this endpoint.
  // Callers use this to tell "server down" from "server lacks /v1/models".
  error.serverResponded = true;
  // Kept separate from the message so a caller can test the status without
  // pattern-matching prose (structured.mjs discriminates a 400 this way).
  error.status = response.status;
  if (redirect) {
    error.responseBody = response.headers.location ?? 'an unnamed location';
  } else {
    const combined = [response.statusText, detail.trim()].filter(Boolean).join(': ');
    if (combined) error.responseBody = combined;
  }
  throw error;
}

/**
 * The server/endpoint-controlled detail an error carries off `.message`
 * — `.endpoint`, `.responseBody`, `.bodyExcerpt`, `.finishReason`
 * (completion.mjs / client.mjs — unvalidated server payload, not transport
 * data, but the same discipline) — joined for a genuinely interactive
 * display. One definition: `oai-companion.mjs`'s top-level catch and
 * `cmd-setup.mjs`'s own error rendering both call this rather than each
 * re-composing the same field list, so a further field only needs naming
 * here.
 */
export function transportDetail(error) {
  return [error?.endpoint, error?.responseBody, error?.bodyExcerpt, error?.finishReason]
    .filter(Boolean)
    .join(' — ');
}

export async function request(profile, path, { method = 'GET', body, firstByteMs, totalMs, totalBudget, totalReportMs } = {}) {
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
      totalBudget,
      totalReportMs,
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
