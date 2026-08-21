// What a finished child process counts as.
//
// This file reads a completed run's stdout and decides what it *means*, while
// `run.mjs` owns spawning it and the temp repo it ran in. Neither knows
// anything about the corpus, the table, or the filesystem.
//
// Distinct from `run-buckets.mjs`, which classifies a run once it exists. This
// file is what produces the record that file then sorts.
import { substitution } from '../../scripts/lib/model-identity.mjs';

/**
 * Why a run failed, in the command's own vocabulary — or null when it did not say.
 *
 * Read from the `--json` error envelope on stdout. The alternative was matching
 * stderr for phrases like "timed out": a matcher that reads a
 * server's prose asserts a cause it only guessed. `reason` is what the transport
 * itself decided; the stderr blob beside it stays the record of what happened.
 *
 * `error: true` identifies the *document*, not just the field. A run can flush a
 * success report to stdout and then exit non-zero, and that report claims
 * nothing about why. Keying on the envelope marker is what keeps `reason`
 * meaning "the command said it failed, and named this cause" rather than "some
 * JSON on stdout had a field by that name" — the latter would be the same
 * guessing reappearing inside the fix meant to end it.
 *
 * Unparseable stdout is not a failure of this harness: the run simply did not
 * say why, and null is exactly that. It never throws, because the whole promise
 * of the path it sits on is that one case failing does not cancel the rest.
 */
export function reasonFrom(stdout) {
  return failureEnvelope(stdout)?.reason ?? null;
}

/**
 * The physical attempts a FAILED run made, off the same envelope.
 *
 * Read here rather than left to `errorReport` alone, because the harness's
 * failure path keeps only `reason` and the prose — so a record emitted by the
 * command would have been dropped on the floor by its own reader. A run whose
 * every attempt died is the run carrying the most reliability evidence, and this
 * is where it was being thrown away.
 */
export function attemptsFrom(stdout) {
  return failureEnvelope(stdout)?.attempts ?? null;
}

/** Which model a FAILED run asked for, where the command got far enough to know. */
export function requestedModelFrom(stdout) {
  return failureEnvelope(stdout)?.requestedModel ?? null;
}

/**
 * What a FAILED run had already reasoned, off the same envelope.
 * `null` unless `errorReport` found real reasoning text to attach —
 * most failures (a pre-stream refusal, an oversize refusal) carry nothing.
 */
export function partialFrom(stdout) {
  return failureEnvelope(stdout)?.partial ?? null;
}

function failureEnvelope(stdout) {
  try {
    const parsed = JSON.parse(String(stdout ?? ''));
    return parsed?.error === true ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A completed run, as one of two outcomes — and the second is not an error the
 * process reported.
 *
 * A run the server answered with a different model than the one asked for is not
 * a measurement of the model this sweep claims to test. It is recorded as
 * failed, and the record is KEPT so nothing is thrown away and it can be
 * re-read, but it is excluded from scoring and from every timing sample —
 * otherwise a case aggregate silently mixes two models, which is the one thing a
 * reader takes this table to rule out.
 *
 * Deliberately not the same call as a truncated run. A cut run is this model
 * measured incompletely, and those are scored anyway because discarding them
 * cost half the corpus. This one is a *different model* measured
 * correctly: the number is not uncertain, it is mislabelled, and no amount of
 * sampling fixes a wrong label.
 *
 * This decides what a completed run counts as, while `reviewOnce` owns the
 * subprocess and the temp repo.
 */
export function outcomeFor(stdout, diffOnly) {
  const report = JSON.parse(stdout);
  const swap = substitution(report?.requestedModel, report?.model);
  if (!swap) return { diffOnly, report };
  return {
    diffOnly,
    report,
    error: `Asked for "${swap.requested}" but ${swap.served} answered; the server substituted a model.`,
    reason: 'model-substituted',
  };
}
