// The server configuration a run resolved — the effective context window it
// acted on and its provenance, and which server-owned sampling/reasoning knobs
// were left at a default this repo could not observe. Recorded on every `--json`
// review/task envelope so a benchmark record can say what decided its result,
// rather than reading as complete while the deciding variable is absent.
//
// A leaf: it imports nothing, so it can be pulled into `client.mjs`'s callers and
// `errorReport` alike without closing a cycle. The one place a run-context field
// is validated before persistence — `errorReport` — lives in `review-report.mjs`,
// which pairs `model-info.mjs`'s `CONTEXT_SOURCES` (the sources a window can carry)
// and `positiveInteger` with this module's `reconstructServerConfig`.

const REQUESTED = 'requested';
const UNOBSERVED = 'server-default-unobserved';

/**
 * Per-knob status: `'requested'` when the run's request carried the knob, else
 * `'server-default-unobserved'` (the server's own default was in effect, and no
 * OpenAI-compatible endpoint exposes it). `'requested'` records only THAT the knob
 * was set: `reasoning_effort`'s value is recoverable from the `sampling` echo and
 * `temperature`'s from the operator's own command — neither value is re-echoed here.
 *
 * Request-conditional, deliberately not a constant `'unknown'` stamp: once bench
 * forwards `--reasoning-effort` (OAI-215) a run that set it reads `'requested'`
 * rather than falsely claiming the default was unobserved.
 */
export function serverConfigFrom({ sampling, temperature } = {}) {
  return {
    reasoningEffort: sampling?.reasoningEffort !== undefined ? REQUESTED : UNOBSERVED,
    temperature: temperature !== undefined ? REQUESTED : UNOBSERVED,
    thinking: UNOBSERVED,
  };
}

/**
 * The run-context object both flows carry — the four fields the `--json` envelope
 * records, built in one place from a `resolveTarget` result and the request's
 * sampling/temperature. One builder so the review and task flows cannot construct
 * it two subtly different ways.
 */
export function buildRunContext({ contextLength, contextSource, detectedWindow }, { sampling, temperature }) {
  return {
    contextWindow: contextLength,
    contextSource,
    detectedWindow,
    serverConfig: serverConfigFrom({ sampling, temperature }),
  };
}

/**
 * Overwrite the run-context fields on a thrown error from the trusted resolved
 * context, so a failure thrown after resolution — a reasoning-only runaway, a
 * transport drop, an oversize refusal — carries what decided the run into the
 * `--json` failure envelope.
 *
 * OVERWRITE, not `??=`: there is one resolution per run, so no nearer throw holds
 * a more-specific window, and a foreign pre-existing property must not survive
 * into `errorReport`'s persisted output. The `typeof` guard so a bare-primitive
 * throw does not turn attaching context into a `TypeError` that replaces the real
 * error. `ctx` absent (a failure before resolution) attaches nothing, so the
 * fields stay absent and the envelope reads them as `null` — "failure preceded
 * resolution", distinct from "not captured".
 */
export function attachRunContext(error, ctx) {
  if (ctx && error && typeof error === 'object') {
    error.contextWindow = ctx.contextWindow ?? null;
    error.contextSource = ctx.contextSource ?? null;
    error.detectedWindow = ctx.detectedWindow ?? null;
    error.serverConfig = ctx.serverConfig ?? null;
  }
  return error;
}

/**
 * Rebuild a `serverConfig` value as a fresh three-knob status map, admitting a
 * knob's value only when it is one of the two status strings. Reconstruction,
 * not pass-through: a foreign object carrying a custom prototype or `toJSON`, an
 * array, or extra keys can otherwise alter the JSON `errorReport` persists into
 * `jobs.db`, since only this newly built object — never the foreign one — is
 * serialized. A non-plain input, or one missing a knob, yields `null` for that
 * knob (or the whole map when nothing is a plain object).
 */
export function reconstructServerConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // Read each knob ONCE and validate that snapshot — never a second read: a getter
  // could pass the equality check and then hand a different, foreign value to the
  // serializer, which is what the reconstruction exists to prevent.
  const knob = (name) => {
    const status = value[name];
    return status === REQUESTED || status === UNOBSERVED ? status : null;
  };
  return {
    reasoningEffort: knob('reasoningEffort'),
    temperature: knob('temperature'),
    thinking: knob('thinking'),
  };
}
