// Which bucket a benchmark run belongs to.
//
// This file decides *what happened to a run*; `report.mjs` decides how to say
// it. Scored, truncated, unreadable and failed runs must partition the runs
// exactly — a run in none of them shrinks a denominator invisibly, a run in two
// makes the row's arithmetic stop reconciling. The failed runs are the ones
// carrying `run.error`, which `case-rows.mjs` counts; the other three are defined
// together here, each excluding `run.error`, rather than as independent
// predicates that agree by inspection. Analysis-cut runs are not a fifth bucket:
// `case-rows.mjs` counts them only within the scored runs.

/**
 * Runs guillotined by the `analysis` cap: complete JSON, `finish_reason: stop`,
 * and reasoning that stopped mid-sentence.
 *
 * **These are scored.** The cut lands on `analysis`, which
 * the schema orders *first*; the model then emits `findings` normally, so a cut
 * run's findings are as checkable as any other's. What is not usable is its
 * silence: a defect it did not name may be one it never reached. Positives
 * count, absences are counted as `unresolved` — reported in their own column
 * rather than folded into either end of the recall figure.
 */
export function analysisCutRuns(runs) {
  return runs.filter((run) => !run.error && run.report?.analysisCut === true);
}

/**
 * Runs cut off by the token budget rather than by the grammar.
 *
 * Kept apart from `analysisCutRuns`: an analysis-cut reply is complete JSON
 * carrying real findings, while a truncated run is excluded from scoring — even
 * one that parsed, such as a multi-pass report one of whose passes finished at
 * the length limit while another parsed.
 */
export function truncatedRuns(runs) {
  return runs.filter((run) => !run.error && run.report?.finishReason === 'length');
}

/**
 * The runs that produced the case's ranked measurement (recall): scored, not a
 * transport failure, and not truncated. This is the single definition of the
 * scored population — `case-rows.mjs` `buckets()` reads it for the row, and
 * `compare-model.mjs` reads it so comparability is judged over the SAME runs
 * recall is, never the broader `measurable` set (which includes truncated and
 * unreadable runs and can conceal a real per-run difference).
 */
export function scoredRuns(runs) {
  const truncated = new Set(truncatedRuns(runs));
  return runs.filter((run) => run.score && !run.error && !truncated.has(run));
}

/**
 * Runs that answered, exited 0, and still produced nothing scoreable — a reply
 * that never parsed, without being truncated, is the usual one.
 *
 * Without this bucket such a run would be in none of the others: not `scored`
 * (no score), not `cut` (`analysisCut` is not `true`: a single-pass reply that
 * never parsed carries `null` for it, meaning "not determined", and a merged
 * multi-pass report `false`; only `=== true` counts as a cut), not `failed` (the
 * process succeeded) — while still counting toward the run total, so a row could
 * print "0 cut, 0 failed" over three runs whose recall was computed from two. It
 * is the expected outcome on the degraded rung, where the schema is only a
 * prompt instruction and a weaker model may answer in prose.
 *
 * **Defined as the remainder**: every run that is not an error, not scored and
 * not truncated, whatever produced it, so given the scored set its caller passes
 * the partition is exhaustive by construction instead of by an invariant living
 * in another file.
 */
export function unreadableRuns(runs, scored = new Set()) {
  return runs.filter((run) => !run.error && !scored.has(run) && !truncatedRuns([run]).length);
}
