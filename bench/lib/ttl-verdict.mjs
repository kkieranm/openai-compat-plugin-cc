/**
 * The TTL challenge's decision rule. Pure, and separate from the driver on
 * purpose: what an episode MEANS is declared before the experiment runs and
 * unit-tested, so the reading of the result cannot be chosen once the numbers
 * are in. The driver beside it does I/O and nothing else. See ADR 013.
 *
 * THIS INSTRUMENT REFUTES; IT DOES NOT CONFIRM. There is no verdict asserting
 * that an observed unload was a TTL eviction, because sampling cannot establish
 * one: proving an unload happened after expiry requires observing the model
 * still resident after expiry, and a mechanism that fires AT expiry makes that
 * observation impossible. Four successive designs for a confirming branch each
 * failed on a different axis before the branch was withdrawn (OAI-34 plan,
 * decision C). An observed absence is recorded in full and attributed to
 * nothing.
 */

/**
 * How far a prefill must outlast the TTL before the episode counts as having
 * tested anything.
 *
 * This margin is also what makes refutation sound. Survival requires the request
 * to still be in prefill after TRUE expiry, and the driver's clock origin (child
 * spawn) is not the server's (request receipt). Writing P for the plugin's timing
 * origin, R = P + c for receipt and S for spawn, the condition
 * `firstToken > R + ttlMs` expands to `(S->P) + prefillMs > (S->P) + c + ttlMs`:
 * the spawn-to-request overhead appears on BOTH sides and cancels, leaving
 * `prefillMs > c + ttlMs`. So the residual is `c` — serialization, socket write
 * and server admission for one request — and the margin is the slack that covers
 * it. That is why `exposed` is computed from a MEASURED prefill and never from
 * the driver's wall clock, which carries the uncancelled term.
 */
export const EXPOSURE_MARGIN = 1.5;

// The wording for a voided calibration lives with the gate that decides it. The
// dependency is one-way at call time: that module reads EXPOSURE_MARGIN from
// here, and this one calls its formatter.
// eslint-disable-next-line import/first
import { calibrationSays } from './ttl-calibration.mjs';

/**
 * Every SWEEP outcome `summarize` can return. The exhaustiveness guard reads it,
 * and so does the done-condition below — the outcome table in ADR 013 has already
 * lost a row to drift once.
 */
export const SWEEP_VERDICTS = Object.freeze([
  'deterministic-form-refuted',
  'inconclusive-failure',
  'contradictory-evidence',
  'no-exposure',
  'instrument-failed',
]);

/**
 * The outcomes that mean the experiment RAN and produced a result.
 *
 * Everything else means the run must happen again: `no-exposure` says "lower the
 * TTL or pick a longer case and re-run", `contradictory-evidence` says "check the
 * sampler and the server log before re-running", and `instrument-failed` says
 * NOTHING about the server at all — which is not a re-run instruction, and the
 * distinction is why this list is enumerated rather than described. Treating "not
 * `instrument-failed`" as completion re-admits the first two, the same
 * whole-class-from-one-sub-population mistake the done-condition it replaced was
 * written to fix. Exported so the exit code and the tracker read ONE rule, and
 * `tests/ttl-verdict.test.js` pins the tracker's copy against it.
 */
export const CONCLUSIVE = Object.freeze(['deterministic-form-refuted', 'inconclusive-failure']);

/** Every episode verdict this module can return. The exhaustiveness guard reads it. */
export const EPISODE_VERDICTS = Object.freeze([
  'survived-past-expiry',
  'no-exposure',
  'failure-with-unload-observed',
  'failure-without-unload-observed',
  'survived-despite-unload',
  'not-dispatched',
  'instrument-invalid',
]);

/**
 * The instrument's own preconditions, checked before an episode is allowed to
 * say anything about the server.
 *
 * Returns the names that FAILED, so the manifest records which rather than only
 * that. Enforced in code, never left to the reader — ADR 013's "limits the
 * instrument MUST enforce in code" section is the requirement these discharge.
 */
export function validityChecks({ appliedTtlMs, requestedTtlMs, competingModels, contradiction }) {
  const failed = [];
  // G6: the treatment this episode actually received, read back from the server
  // rather than inferred from `lms load` exiting 0. Classifying against the
  // requested constant is how an episode that silently ran under the default TTL
  // gets scored as though it had not.
  if (!(appliedTtlMs > 0) || appliedTtlMs !== requestedTtlMs) failed.push('ttl-confirmed');
  // G2: the protocol REQUIRES nothing else connected — another resident model can
  // trigger Auto-Evict and produce the same client-visible shape. A competing
  // model means the precondition was violated, which is an instrument failure and
  // not a finding about the server.
  if (competingModels?.length) failed.push('sole-tenancy');
  // G8: a record this module does not understand.
  if (contradiction) failed.push('record-self-consistent');
  return failed;
}

/**
 * One episode's verdict.
 *
 * `no-exposure` catches the wasted episode: a request that never outlasted
 * expiry by the margin did not test the mechanism, and counting it as a survival
 * would be the experiment marking its own homework.
 */
export function episodeVerdict({ ttlMs, prefillMs, failed, unloadObserved, obtainedResponse, invalid }) {
  // Before anything else: did a request obtain a RESPONSE? A refused
  // `--max-tokens`, an unreachable server, a materialization throw and a
  // validation refusal all exit non-zero having dispatched nothing, and reading
  // those as "the server failed it" is the experiment reporting on an instrument
  // that never ran. Not hypothetical — an accidental run of the withdrawn draft
  // produced exactly that, and rendered a verdict about the mechanism from it.
  if (!obtainedResponse) return 'not-dispatched';
  // Kept separate from `not-dispatched` rather than folded into it: a competing
  // model or an unconfirmed TTL did not fail to dispatch, and printing that word
  // for them would be a false string — the defect class this feature is about.
  if (invalid?.length) return 'instrument-invalid';

  if (!failed) {
    // A survival cannot stand alongside an observed absence. The episode did not
    // do the one thing a survival asserts — stay loaded and answer — and calling
    // it clean would hide the disagreement rather than report it.
    if (unloadObserved) return 'survived-despite-unload';
    // MEASURED prefill only. `durationMs` would reintroduce the uncancelled
    // spawn overhead the margin cannot see, and a request that timed out at
    // 1,800s would "clear" a 180s bar without the model ever emitting a token.
    return prefillMs > ttlMs * EXPOSURE_MARGIN ? 'survived-past-expiry' : 'no-exposure';
  }
  // Both failure verdicts are deliberately neutral about CAUSE. An absence is
  // evidence that the model stopped being resident during the window the child
  // was alive; it is not evidence of an eviction, of a TTL, or of an ordering
  // with respect to the failure. See the header.
  return unloadObserved ? 'failure-with-unload-observed' : 'failure-without-unload-observed';
}

/**
 * The states in which this sweep may say NOTHING about the server.
 *
 * The seam is real: below this line every branch is a finding, above it every
 * branch says the instrument did not run. Conflating those is the defect the
 * whole feature keeps producing — "inconclusive" still reads as a claim about
 * the server, so a broken instrument must not reach it.
 */
function disqualified(verdicts, calibrationCleared, calibrationFailures, causes) {
  // Ordered FIRST, and the ordering is load-bearing: an aborted calibration
  // writes its manifest with an EMPTY episode list, so a check for "no episodes"
  // placed above this would swallow the one state that must be reported.
  if (!calibrationCleared) {
    return { verdict: 'instrument-failed', says: calibrationSays(calibrationFailures, causes) };
  }
  if (verdicts.some((v) => v === 'not-dispatched')) {
    return {
      verdict: 'instrument-failed',
      says: 'At least one episode never obtained a response from the server, so this sweep says NOTHING'
        + ' about the server or the mechanism. Fix the client-side failure in the record and re-run.',
    };
  }
  if (verdicts.some((v) => v === 'instrument-invalid')) {
    return {
      verdict: 'instrument-failed',
      says: 'At least one episode ran without the conditions this experiment requires — an unconfirmed'
        + ' TTL, another model resident, or an attempt record that contradicts itself. The sweep says'
        + ' NOTHING about the server. See validityFailures in the record.',
    };
  }
  // An absence alongside a request that nonetheless SUCCEEDED is a disagreement
  // between the two instruments, and it outranks the survivals because it says
  // the residency reading and the request outcome cannot both be right.
  if (verdicts.some((v) => v === 'survived-despite-unload')) {
    return {
      verdict: 'contradictory-evidence',
      says: 'An episode completed successfully while residency sampling showed the model absent'
        + ' mid-run. Those cannot both be right, so this sweep refutes nothing — check the sampler'
        + ' and the server log before re-running.',
    };
  }
  return null;
}

/**
 * The refutation sentence, split out at the function size budget.
 *
 * The bound is COMPUTED from the episode count, never hardcoded. It read "0
 * events in 3 is ~63%" for every sweep until a one-episode run printed exactly
 * that — a false statistic, in the sentence whose whole job is to stop "3/3
 * survived" being read as "the failure rate is low". Found by running the real
 * driver with `--episodes 1`, not by review.
 */
function refutedSays(count, minSlackMs) {
  // One-sided 95% upper bound on zero events in n trials: 1 - 0.05^(1/n).
  const bound = Math.round((1 - 0.05 ** (1 / count)) * 100);
  // The condition is stated, not buried. `c` — serialization, socket write and
  // server admission — was never measured, so refutation holds provided it fell
  // inside the slack the episodes actually achieved. The MINIMUM is quoted: a
  // sweep is only as sound as its weakest episode, and a mean would let a
  // marginal one ride on its siblings.
  const slack = typeof minSlackMs === 'number'
    ? ` The narrowest episode cleared expiry by ${Math.round(minSlackMs / 1000)}s, and this holds`
      + ' provided request serialization and server admission took less than that.'
    : '';
  return `${count} cold request(s) remained in prefill well past a deliberately shortened TTL`
    + ' without unloading or failing, refuting the DETERMINISTIC form of the mechanism. It does not'
    + ` show the failure rate is low: the one-sided 95% upper bound on 0 events in ${count} is`
    + ` ~${bound}%.${slack}`;
}

/**
 * What the sweep as a whole licenses. This wording is what OAI-19 may quote, and
 * NO outcome licenses naming JIT-TTL as the cause of the 37.5%.
 */
export function summarize(verdicts, {
  calibrationCleared = true, calibrationFailures = [], causes = [], minSlackMs = null,
} = {}) {
  const blocked = disqualified(verdicts, calibrationCleared, calibrationFailures, causes);
  if (blocked) return blocked;
  // `[].every(...)` is TRUE, so without this an empty list renders
  // `deterministic-form-refuted` from zero episodes — the vacuous-truth shape
  // this repo keeps finding. `--episodes` is validated positive at parse time and
  // the aborted-calibration path is caught above, so this is unreachable in
  // production; it is here because "unreachable" is a claim, and a wrong one
  // costs the strongest sentence the instrument can print.
  if (verdicts.length === 0) {
    return {
      verdict: 'instrument-failed',
      says: 'No episodes ran, so this sweep says NOTHING about the server.',
    };
  }
  if (verdicts.some((v) => v.startsWith('failure'))) {
    return {
      verdict: 'inconclusive-failure',
      says: 'An episode failed. Residency sampling is recorded alongside it and is NOT attributed:'
        + ' this instrument cannot establish that any observed absence was a TTL eviction, or that it'
        + ' preceded the failure. Inconclusive — JIT-TTL may not be named.',
    };
  }
  if (verdicts.every((v) => v === 'survived-past-expiry')) {
    return { verdict: 'deterministic-form-refuted', says: refutedSays(verdicts.length, minSlackMs) };
  }
  // Some episodes were exposures and some were not. Counted rather than asserted,
  // so the sentence is true in every state it can print in — the first draft said
  // "No episode stayed in flight past expiry" for a sweep in which one had.
  const exposed = verdicts.filter((v) => v === 'survived-past-expiry').length;
  return {
    verdict: 'no-exposure',
    says: `${exposed} of ${verdicts.length} episode(s) stayed in flight past expiry by a safe margin,`
      + ' which is too few to refute anything: the deterministic form is contradicted only by a sweep'
      + ' whose episodes ALL cleared it. Lower the TTL or pick a longer case and re-run.',
  };
}
