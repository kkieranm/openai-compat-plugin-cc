// What a worker is allowed to send, decided when the job is submitted.
//
// The credential itself is never stored. What is stored is the *authorization
// decision* — which is a different thing, and the difference is the whole point.
import { randomBytes, createHash } from 'node:crypto';
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
 * The one hash used by both the writer (`task-submit.mjs`) and the verifier
 * below, so the two sides cannot drift. Not cryptographic in the sense of
 * hiding the query forever — the commitment is only ever compared for
 * equality, so any preimage-hiding function serves; the salt only makes each
 * row cost its own offline search instead of falling to one precomputed
 * table. `randomUUID` is the only other `node:crypto` use in this repo; this
 * establishes the first hashing convention rather than assuming one exists.
 */
export function querySalt() {
  return randomBytes(16).toString('hex');
}

export function queryCommitment(salt, query) {
  return createHash('sha256').update(salt + query).digest('hex');
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
 *
 * **Profile provenance and key authorization are two separate facts.** A
 * profile authenticated by query string alone has no `apiKey`, so it used to
 * take the `mode: 'none'` branch above and lose the provenance a worker needs
 * to re-resolve that query. Widening straight to `mode: 'profile'` would be a
 * privilege escalation instead: a query-only profile that *gains* an `apiKey`
 * while the job sits queued would then have that key sent, though none was
 * authorized at submission. So this records `apiKeyAuthorized` alongside
 * provenance rather than folding it into the mode, and the widening is keyed
 * on `!profile.adHoc && profile.query` — never on the query alone, which
 * would send an ad hoc `--base-url` row's synthetic `custom` profile through
 * `resolveProfile` and fail every ad hoc job carrying any query string at all.
 */
export function authPolicyFor(profile) {
  if (profile.apiKey || (!profile.adHoc && profile.query)) {
    return {
      mode: 'profile',
      profile: profile.name,
      authorizedOrigin: originOf(profile.baseUrl),
      apiKeyAuthorized: Boolean(profile.apiKey),
    };
  }
  return { mode: 'none' };
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
 *
 * **Resolves the profile exactly ONCE and returns `{apiKey, query}` together**
 * — never a bare string, and never two separate calls into `resolveProfile`.
 * A second call would risk a `providers.json` edit landing between the two,
 * letting a job send one snapshot's key with another snapshot's query; the
 * whole point of the frozen-endpoint binding is that the credential and the
 * query it travels with came from the same resolution.
 *
 * **Key authorization and profile provenance are checked separately, per
 * `authPolicyFor`.** `apiKeyAuthorized` is read with a legacy default —
 * `auth.apiKeyAuthorized ?? (schemaVersion === 1 && auth.mode === 'profile')`
 * — because every row written before this field existed encoded "a key was
 * authorized" in the mode alone: `authPolicyFor` wrote `mode: 'profile'`
 * only when `profile.apiKey` existed. Reading the field literally against
 * such a row would make `Boolean(undefined)` false and return no key AND
 * raise no refusal — an unauthenticated request sent where a key was
 * authorized, which is the exact harm the refusal below exists to prevent.
 * When no key was authorized at submission, a query-only profile that has
 * since gained one still returns `apiKey: undefined` with no refusal — the
 * escalation `authPolicyFor`'s docblock names.
 *
 * **The default is scoped to `schemaVersion === 1`, not to "the field is
 * missing", on purpose** — a v2 row can legitimately carry `mode: 'profile'`
 * with `apiKeyAuthorized: false` (a query-only credential), so treating any
 * *missing* field as legacy-safe would silently authorize a key on a
 * malformed, partially written or hand-edited v2 row, reproducing the exact
 * escalation this field exists to close, one layer down. The caller supplies
 * `schemaVersion` from the row it read; there is no route to it from `auth`
 * or `transport` alone.
 */
export function resolveCredential(auth, transport, schemaVersion) {
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

  // `queryHash` present is a positive discriminator no historical row shape
  // can carry, so it is tested for PRESENCE, not truthiness, and takes
  // priority on a hand-edited row that somehow carries both. Absent, this is
  // the unchanged raw compare — `transport.query` is always a string on a row
  // written by this build, but a row from before `transport` carried `query`
  // at all must not false-mismatch on `undefined !== ''`.
  const queryMatches = transport.queryHash !== undefined
    ? queryCommitment(transport.querySalt, current.query) === transport.queryHash
    : current.query === (transport.query ?? '');
  if (current.baseUrl !== transport.baseUrl || !queryMatches) {
    // Neither endpoint's raw value is echoed: some gateways embed a credential
    // in the PATH itself (not just the query), which normalizeBaseUrl does
    // nothing to forbid — the same "quote nothing raw" principle as the
    // config-resolution catch above, applied here for the same reason. The
    // operator can see both live values with /oai:setup on their own terminal.
    throw new UserError(
      `credential-unavailable: provider "${auth.profile}" now resolves to a different endpoint than this job was authorised for. Run /oai:setup to see why.`,
    );
  }
  const apiKeyAuthorized = auth.apiKeyAuthorized ?? (schemaVersion === 1 && auth.mode === 'profile');
  if (apiKeyAuthorized) {
    if (!current.apiKey) {
      throw new UserError(`credential-unavailable: provider "${auth.profile}" no longer supplies a credential.`);
    }
    return { apiKey: current.apiKey, query: current.query };
  }
  return { apiKey: undefined, query: current.query };
}
