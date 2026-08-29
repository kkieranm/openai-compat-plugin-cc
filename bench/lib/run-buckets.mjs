// Which bucket a benchmark run belongs to.
//
// Split from `report.mjs` at the size budget, and the seam is real: this file
// decides *what happened to a run*, the other decides how to say it. The four
// buckets must partition the runs exactly — a run in none of them shrinks a
// denominator invisibly, a run in two makes the row's arithmetic stop
// reconciling — so they are defined together, in one place, rather than as four
// independent predicates that agree by inspection.

/**
 * Runs guillotined by the `analysis` cap: complete JSON, `finish_reason: stop`,
 * and reasoning that stopped mid-sentence.
 *
 * **These are scored, and that is a correction.** They used to be discarded
 * wholesale, which cost half the corpus — 17 of 41 runs ever recorded — and with
 * it the two anchored matches they produced. The cut lands on `analysis`, which
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
 * Split from the above once cut runs became scoreable, because the two stopped
 * being interchangeable at that moment: an analysis-cut reply is complete JSON
 * carrying real findings, while this one never parsed and has nothing to score.
 * They were safely conflated only while both were excluded.
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
 * that never parsed, without being truncated.
 *
 * Counted because they used to fall out of *every* bucket at once: not `scored`
 * (no findings), not `cut` (`analysisCut` is null and the finish reason is
 * "stop"), not `failed` (the process succeeded) — while still counting toward
 * the run total, so a row could print "0 cut, 0 failed" over three runs whose
 * recall was computed from two. This is the reachable failure of the degraded
 * rung, where the schema is only a prompt instruction and a weaker model
 * answering in prose is the expected outcome, not a contrived one.
 *
 * Note the `=== true`: `jsonReport` deliberately emits `null` for these flags
 * when nothing could be parsed, meaning "not determined", and reading that null
 * as false is how the run disappeared in the first place.
 *
 * **Defined as the remainder, not as its own shape** — the second time this
 * bucket has had to be widened for the same reason. Testing `parsed !== true`
 * described one known way to produce nothing scoreable, so a run that parsed and
 * still carried no score belonged to no bucket at all: not scored, not
 * truncated, not failed, not unreadable, while still counting toward the run
 * total. `bench/run.mjs` attaches a score to every parsed reply today, so that
 * was unreachable — but "unreachable" is what this bucket was created for after
 * it happened once. Taking everything left over makes the partition exhaustive
 * by construction instead of by an invariant living in another file.
 */
export function unreadableRuns(runs, scored = new Set()) {
  return runs.filter((run) => !run.error && !scored.has(run) && !truncatedRuns([run]).length);
}
