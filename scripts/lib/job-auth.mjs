// What a worker is allowed to send, decided when the job is submitted.
//
// The credential itself is never stored. What is stored is the *authorization
// decision* — which is a different thing, and the difference is the whole point.
import { loadConfig, resolveProfile } from './config.mjs';
import { UserError } from './errors.mjs';

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Turn a resolved profile into a policy a worker can act on later.
 *
 * `mode: 'none'` covers both an open server and the case where `resolveProfile`
 * deliberately withheld a credential because `--base-url` moved the request to
 * a different endpoint. It also covers a bare `--base-url`, whose synthetic `custom`
 * profile will not be in `providers.json` when the worker looks — recording
 * `mode: 'profile'` there would turn a perfectly valid invocation into a
 * failure.
 */
export function authPolicyFor(profile) {
  if (!profile.apiKey) return { mode: 'none' };
  return { mode: 'profile', profile: profile.name, authorizedOrigin: originOf(profile.baseUrl) };
}

/**
 * The credential to use now, or a refusal — never a silent fallback either way.
 *
 * **The origin check below is tautological, and that's fine — it isn't the
 * gate.** The persisted `authorizedOrigin` and the persisted transport both
 * came from submission, so checking one against the other passes by
 * construction. It still catches a hand-edited or corrupt row, which is the
 * only thing it is for.
 *
 * **The real gate binds the freshly resolved credential to the frozen
 * ENDPOINT, not the origin (OAI-63).** `originOf` drops the path and query, so
 * on a path-multiplexed gateway (LiteLLM, Azure APIM, Cloudflare AI Gateway) a
 * profile repointed to a *different tenant at the same origin* between
 * submission and execution would pass an origin-only check and hand that
 * tenant's key to this job's endpoint. Comparing against `transport` directly
 * — the same frozen `baseUrl`/`query` the request is actually about to use —
 * needs no new persisted field: `transport` is already stored on every job for
 * an unrelated reason (making the request at all), so this closes the leak
 * without a schema change.
 */
export function resolveCredential(auth, transport) {
  if (!auth || auth.mode === 'none') return undefined;

  const target = originOf(transport?.baseUrl);
  if (auth.authorizedOrigin !== target) {
    throw new UserError(
      `credential-unavailable: this job was authorised for ${auth.authorizedOrigin} but targets ${target}.`,
    );
  }

  let current;
  try {
    current = resolveProfile(loadConfig().config, { provider: auth.profile });
  } catch {
    // Never forward the underlying error's own message here: it is UNVETTED
    // raw config content — a malformed baseUrl (normalizeBaseUrl quotes it
    // verbatim, credentials and all), or even a JSON-parse error that can quote
    // a snippet of the config FILE around the syntax error, secrets included.
    // Regex-scrubbing that content was tried and repeatedly defeated by a
    // narrower shape each round; the only fix that closes the whole class is
    // to quote nothing raw. The provider name is a config KEY, already shown
    // unredacted everywhere (e.g. `/oai:setup`'s provider table), so it is
    // safe; the underlying reason is not, and is only ever useful on the
    // operator's own terminal, where /oai:setup surfaces it directly.
    throw new UserError(
      `credential-unavailable: provider "${auth.profile}" could not be resolved from the current config. Run /oai:setup to see why.`,
    );
  }

  // `transport.query` is always a string on a row written by this build, but a
  // row from before `transport` carried `query` at all must not false-mismatch
  // on `undefined !== ''`.
  const transportQuery = transport.query ?? '';
  if (current.baseUrl !== transport.baseUrl || current.query !== transportQuery) {
    // Neither endpoint's raw value is echoed: some gateways embed a credential
    // in the PATH itself (not just the query), which normalizeBaseUrl does
    // nothing to forbid — the same "quote nothing raw" principle as the
    // config-resolution catch above, applied here for the same reason. The
    // operator can see both live values with /oai:setup on their own terminal.
    throw new UserError(
      `credential-unavailable: provider "${auth.profile}" now resolves to a different endpoint than this job was authorised for. Run /oai:setup to see why.`,
    );
  }
  if (!current.apiKey) {
    throw new UserError(`credential-unavailable: provider "${auth.profile}" no longer supplies a credential.`);
  }
  return current.apiKey;
}
