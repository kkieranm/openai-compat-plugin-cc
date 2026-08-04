/**
 * Evidence read from the plugin's own attempt record — the `attempts` array the
 * `/oai:review --json` envelope carries on BOTH the success and the failure path
 * (`review-report.mjs` `jsonReport`/`errorReport`).
 *
 * The peer module to `ttl-residency.mjs`. Neither decides anything; the rule
 * lives in `ttl-verdict.mjs`. See ADR 013.
 */

/**
 * Did any attempt in this episode obtain an HTTP RESPONSE?
 *
 * Named for what it establishes and nothing more. It is deliberately NOT called
 * `reachedServer`: ADR 013 records that `serverResponded` settles whether a
 * response was obtained, while reachability is a separate axis that stays
 * unsettled — `ENOTFOUND`, `ECONNREFUSED` and a TLS rejection differ in how far
 * they got and all record `false`. It is also not called `dispatched`, which
 * already means something else in the ledger.
 *
 * A non-empty `attempts` array is NOT evidence: `ledger.begin` mints an entry
 * before the socket is opened, so a run against a server that is simply down
 * produces attempts. That is the exact state an accidental run of the withdrawn
 * driver was in, and an earlier draft rendered a verdict about the mechanism
 * from it.
 *
 * One witness, not four. OAI-35 made `serverResponded` the serialized contract:
 * `attempt-ledger.mjs` mints it `false`, the success closers set it directly,
 * and the failure closer sets it from `obtainedResponse(error, { prefillMs })`,
 * which already weighs the transport flag, an HTTP status, a completion shape
 * and a measured prefill. The withdrawn draft re-derived those here as a
 * disjunction, and had already drifted — its `prefillMs != null` arm was looser
 * than the production rule.
 */
export function obtainedAnyResponse(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return false;
  return attempts.some((attempt) => attempt.serverResponded === true);
}

/**
 * Outcomes that cannot coexist with `serverResponded: false`.
 *
 * `attempt-outcome.mjs`'s closers set the flag directly for both, so either
 * pairing is a record this instrument does not understand.
 */
const RESPONSE_IMPLYING = new Set(['answered', 'refused']);

/**
 * An attempt entry that contradicts itself, or null.
 *
 * Separate from `obtainedAnyResponse`, and it must be: capability degradation
 * can produce several physical attempts, so an earlier `serverResponded: true`
 * satisfies `some(...)` while a later contradictory entry still stands. Folding
 * the two would let the contradiction pass unnoticed in exactly the multi-attempt
 * case where it is most likely.
 *
 * A contradiction means the record is not what this instrument thinks it is
 * reading, so it voids the sweep as an instrument failure rather than becoming a
 * finding about the server.
 */
export function recordContradiction(attempts) {
  if (!Array.isArray(attempts)) return null;
  const bad = attempts.find((attempt) => RESPONSE_IMPLYING.has(attempt.outcome)
    && attempt.serverResponded !== true);
  return bad ? `attempt outcome "${bad.outcome}" with serverResponded ${bad.serverResponded}` : null;
}

/**
 * The prefill this episode measured, from the ATTEMPT that answered.
 *
 * Read here rather than from a top-level `report.prefillMs`, which the failure
 * envelope does not carry — `review-report.mjs`'s `runTimings` is spread onto the
 * success path only. The withdrawn draft read the top-level field, so
 * `firstTokenMs` was null on every FAILED episode: precisely the episodes this
 * experiment is about, and it silently disabled two of pass 1's own fixes.
 *
 * The answering attempt first, else the last attempt, else null — stated rather
 * than left to `--max-attempts 1` making the question moot, so it does not break
 * quietly if that flag ever moves.
 */
export function prefillFromAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return null;
  const answered = attempts.find((attempt) => attempt.outcome === 'answered');
  const chosen = answered ?? attempts[attempts.length - 1];
  return typeof chosen?.prefillMs === 'number' ? chosen.prefillMs : null;
}

/**
 * Did this episode fail because a CLIENT budget expired rather than because the
 * server did something?
 *
 * `http-errors.mjs` sets `error.reason` to `` `${budget}-timeout` `` for every
 * budget, and `failure-shape.mjs`'s RETRYABLE whitelist deliberately excludes
 * them all. Recorded as observation quality: a failure the client caused says
 * nothing about residency, and a reader comparing an absence against it should
 * be able to see which came first.
 */
export function clientBudgetReason(attempts) {
  if (!Array.isArray(attempts)) return null;
  const timed = attempts.find((attempt) => typeof attempt.reason === 'string'
    && attempt.reason.endsWith('-timeout'));
  return timed ? timed.reason : null;
}
