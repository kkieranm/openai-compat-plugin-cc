// The one place the plugin decides which vendor sampling/reasoning parameters a
// request may carry, and the only place a caller-supplied value becomes a body
// field.
//
// A single table drives four sites — flag parsing, the outgoing body, and both
// ends of the background-job DTO — so a parameter cannot be admitted in one and
// silently dropped in another. `applySampling` writes only the wire names this
// table lists, which is what keeps the request body a closed set: `messages`,
// `stream` and the rest are structurally unreachable from a caller's sampling,
// never a merge that could overwrite them.
//
// `parseNumber` comes from its own leaf module rather than `delegate.mjs` so
// that `client.mjs` (which imports `applySampling`) does not close a cycle back
// through `delegate.mjs`'s own `client.mjs` import.
import { UserError } from './errors.mjs';
import { parseNumber } from './parse-number.mjs';

/**
 * A reasoning-effort value is server-owned, not repo-owned: the server decides
 * which words it honours, and an allowlist here would re-create the very defect
 * this module exists to fix — refusing a vendor value (`xhigh` is already
 * outside OpenAI's own set) the server would have accepted. So the check is
 * shape only: trim surrounding whitespace, then reject an empty result or one
 * with internal whitespace (which is never a single token), and pass the rest
 * through verbatim for the server to accept or refuse.
 */
function validateReasoningEffort(raw, flag) {
  const value = String(raw).trim();
  if (!value || /\s/.test(value)) {
    throw new UserError(`--${flag} must be a single non-empty token, got "${raw}".`, {
      hint: 'Pass one word like low, medium, high or xhigh — whatever the server accepts.',
    });
  }
  return value;
}

/**
 * The admitted parameters, one row each. `flag` is the CLI flag (minus `--`) and
 * the key `options` is stored under; `key` is the camelCase field carried
 * through the code and the DTO; `wire` is the OpenAI body field; `validate`
 * turns the raw flag value into the coerced value or throws a `UserError`.
 *
 * Deliberately does NOT include `temperature`/`max_tokens`: those predate this
 * registry, are validated and threaded separately, and the closed-body property
 * holds regardless of where they live. This table is the home for parameters
 * added from here on.
 */
export const SAMPLING_PARAMS = [
  { flag: 'reasoning-effort', key: 'reasoningEffort', wire: 'reasoning_effort', validate: validateReasoningEffort },
  { flag: 'top-p', key: 'topP', wire: 'top_p', validate: (raw, flag) => parseNumber(raw, flag, { min: 0, max: 1 }) },
  { flag: 'top-k', key: 'topK', wire: 'top_k', validate: (raw, flag) => parseNumber(raw, flag, { integer: true, min: 1 }) },
  { flag: 'min-p', key: 'minP', wire: 'min_p', validate: (raw, flag) => parseNumber(raw, flag, { min: 0, max: 1 }) },
  { flag: 'presence-penalty', key: 'presencePenalty', wire: 'presence_penalty', validate: (raw, flag) => parseNumber(raw, flag, { min: -2, max: 2 }) },
];

/**
 * The flag names, derived from the table so a command's flag spec cannot list a
 * parameter the parser and body do not also know.
 */
export const SAMPLING_FLAGS = SAMPLING_PARAMS.map((param) => param.flag);

/**
 * Validate whichever sampling flags were passed, before any network work.
 *
 * Returns a camelCase map of only the parameters that were set, or `undefined`
 * when none were — so the field is absent from the DTO (`withoutUndefined`) and
 * from the body (`applySampling`'s `!== undefined` guard) rather than a `null`
 * that would go on the wire.
 */
export function parseSampling(options) {
  const sampling = {};
  for (const { flag, key, validate } of SAMPLING_PARAMS) {
    if (options[flag] !== undefined) sampling[key] = validate(options[flag], flag);
  }
  return Object.keys(sampling).length ? sampling : undefined;
}

/**
 * Copy each set sampling value onto the request body under its wire name.
 *
 * Iterates the table, never the caller's object, so a key not in
 * `SAMPLING_PARAMS` can never reach the body — this is the closed admission
 * boundary that keeps `messages`/`stream` unreachable from caller sampling.
 */
export function applySampling(body, sampling) {
  for (const { key, wire } of SAMPLING_PARAMS) {
    if (sampling?.[key] !== undefined) body[wire] = sampling[key];
  }
  return body;
}

/**
 * Record the run's sampling settings on a thrown error, so the `--json` failure
 * envelope (`errorReport`) can report the sampling the run was REQUESTED with —
 * the settings that matter most on the failure this feature exists to fix, the
 * reasoning runaway refused *after* the model call returns.
 *
 * Attached at the command-level catch, the one point every foreground failure
 * funnels through — which is why the honest word is "requested", not "sent":
 * this is present whenever the flags parsed, so a pre-dispatch failure (a
 * missing prompt, an oversized input) carries it too, before any request went
 * out, and earlier than `requestedModel`, which needs the model resolved first.
 * `??=` so a site nearer the throw that set a more specific value wins; the
 * `typeof` guard so a bare-primitive throw does not turn attaching context into
 * a `TypeError` that would replace the real error; and `undefined` sampling (a
 * parse failure, before any valid settings existed) attaches nothing, which is
 * honest.
 */
export function attachSampling(error, sampling) {
  if (sampling !== undefined && error && typeof error === 'object') error.sampling ??= sampling;
  return error;
}
