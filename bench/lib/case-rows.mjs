// What each row of the benchmark table *is*, before anything decides how to
// print it.
//
// Split from `report.mjs` under the size ratchet, and the seam is the one that
// was already implicit there: this file turns runs into counts and samples,
// while that one turns counts and samples into cells and prose. The dependency
// runs one way only — `report.mjs` imports this, never the reverse — because the
// obvious half-move, leaving the sampling helpers behind and importing them back,
// is an import cycle waiting to happen.
import { tokensPerSecond } from '../../scripts/lib/throughput.mjs';
import { answeringAttempt } from './attempt-rows.mjs';
import { analysisCutRuns, truncatedRuns, unreadableRuns } from './run-buckets.mjs';

/**
 * Runs whose figures describe what this row claims to measure.
 *
 * `!run.error` as well as `run.report`, because a run can now carry both: a
 * substituted run parsed a perfectly good reply and was timed accurately — on
 * the WRONG MODEL. Gating on the report alone let its prefill, generation and
 * tok/s into a row whose failed cell disowned it, so the table could print
 * throughput for a model it also said had not run.
 */
function measurable(runs) {
  return runs.filter((run) => run.report && !run.error);
}

/**
 * The denominator the `N/M measured` suffix counts against: runs that COMPLETED,
 * which is a different question from runs that are usable.
 *
 * Excluding a substituted run from both would make the exclusion invisible —
 * `measured === completed` prints no suffix at all, so a range over one of two
 * completed runs would read as fully measured. Counting it here and dropping it
 * from the values instead renders `(1/2 measured)`, which is the true statement.
 *
 * A timed-out run is correctly absent from this count as well as from the
 * values: it has no report because it did not complete. Same predicate, and the
 * two cases differ in reality rather than in the bookkeeping.
 */
function completedRuns(runs) {
  return runs.filter((run) => run.report);
}

/**
 * The two halves of a run's wall clock, gathered separately because a
 * server-side prompt cache moves one of them and not the other.
 *
 * Measured: the same 56,805-token prompt reached its first token in 421.7s cold
 * and 11.5s warm, generating for ~3s in both. So a `seconds` range of `13–425`
 * across three runs of one case was never a spread in the reviewer — it was one
 * cold run and two cache hits, reported as if they were samples of one thing.
 *
 * `Number.isFinite` is the gate, not truthiness or `!= null`. A non-streamed
 * reply reports null for both because no first-token boundary was observed, and
 * `null` arithmetic silently yields a number: `durationMs - null` is
 * `durationMs`, which would relabel a whole run's wall clock as generation. The
 * count of what was measured is returned alongside the values so a cell can say
 * `2/3 measured` rather than quietly ranging over the runs that happened to
 * carry a figure.
 */
function timingSamples(runs, field, cold) {
  // A prefill served from cache is not a sample of prefill. Once a run can be
  // answered by a RETRY, the answering request may be a byte-identical repeat of
  // one the server already prefilled — so `--cold`'s promise that "every prefill
  // figure is independent" stops being true, silently. Generation is unaffected:
  // a prompt cache moves the first figure by ~37× and leaves the second alone,
  // which is why the two were separated in the first place.
  //
  // Excluded rather than flagged, because a mean over contaminated samples is
  // not a figure with a caveat — it is a different quantity.
  //
  // Only under `--cold`, though, where the report PROMISES independent prefills.
  // Without it every prefill is already cache-affected and the caveats say so,
  // and dropping just the retry-warmed ones would bias the sample they belong to.
  const exclude = cold && field === 'prefillMs';
  const eligible = exclude ? measurable(runs).filter((run) => !answeredWarm(run)) : measurable(runs);
  const values = eligible.map((run) => run.report[field]).filter((value) => Number.isFinite(value));
  return { values, measured: values.length, completed: completedRuns(runs).length };
}

/** Was this run's headline timing supplied by an attempt that could have been served warm? */
function answeredWarm(run) {
  return Boolean(answeringAttempt(run)?.warmEligible);
}

/**
 * The prompt's size, **per run** — the one figure in this row that is a property
 * of the input rather than a count over the runs.
 *
 * It was a `reduce` summing every run's `prompt_tokens`, which is invisible at
 * N=1 (where sum equals per-run) and wrong by exactly a factor of `runs`
 * everywhere else — two quantities welded into one number, in a column a
 * reader has every reason to divide a generation figure by.
 *
 * A range rather than one number when runs disagree, because they can: `--cold`
 * prepends a per-run nonce, so the prompt genuinely differs run to run and a
 * single figure would have to pick one and call it the prompt.
 */
function promptSamples(runs) {
  // The same `{ values, measured, completed }` shape as its two neighbours, and
  // for the same reason they have it: a substituted run is dropped from the
  // values, and a bare array gives the cell no way to say so. Prompt tokens are
  // emphatically NOT model-independent — the count comes from the tokenizer of
  // the model that answered — so including them instead was not an option.
  const values = measurable(runs)
    .map((run) => run.report.usage?.prompt_tokens)
    .filter((value) => Number.isFinite(value));
  return { values, measured: values.length, completed: completedRuns(runs).length };
}

/**
 * How fast each run generated — **per run**, never pooled.
 *
 * The pooled form, `sum(tokens) / sum(ms)`, is the trap here and it is the same
 * shape as the `prompt tokens` defect fixed one commit ago: an aggregate that
 * looks right in the common case and quietly answers a different question. A
 * pooled figure is the corpus's average throughput weighted by run length, which
 * is a real quantity but not the one a cell reading `4.2–7.4` claims. Two runs at
 * 10 tok/s for 1s and 2 tok/s for 100s pool to 2.08 — a number neither run
 * produced, printed in a column whose endpoints promise observations.
 *
 * `tokensPerSecond` returns null unless both operands are real, so a run whose
 * server withheld `usage` (the `stream_options` degrade) or whose generation
 * rounded to 0ms drops out rather than contributing a fabricated rate.
 */
function rateSamples(runs) {
  const values = measurable(runs)
    .map((run) => tokensPerSecond(run.report.usage, run.report.generationMs))
    .filter((value) => value !== null);
  return { values, measured: values.length, completed: completedRuns(runs).length };
}

/**
 * How the failed runs failed, split only as far as the record actually says.
 *
 * A timeout and a model error were the same thing in this table until the CLI
 * started emitting a structured `reason` — both were a stderr blob in the
 * `failed` column, so "the harness gave up" and "the model could not do it" were
 * indistinguishable, and only the second is a result about the reviewer.
 *
 * Counted off `reason`, never off the message text. `reason` is `null` for a run
 * that failed before the envelope could be written, and such a run is counted as
 * failed and *not* as timed out — absent evidence is not evidence of the other
 * branch.
 */
function failureStats(runs) {
  const failed = runs.filter((run) => run.error);
  return {
    failed: failed.length,
    timedOut: failed.filter((run) => typeof run.reason === 'string' && run.reason.endsWith('-timeout')).length,
    // Specifically the wall-clock cap, tracked apart from the other timeouts
    // because the report has to be able to say a cap was in force *without
    // having been told*. A provider config may carry `maxSeconds`, in which case
    // every child run is capped and the harness never saw a flag — and a report
    // that then reads as uncapped invites exactly the comparison it must not:
    // a capped run set against an uncapped one as if they were like for like.
    capped: failed.filter((run) => run.reason === 'deadline-timeout').length,
    // A run the server answered with a model other than the one requested. It
    // is the only "failure" here that produced a complete, readable reply — the
    // failure is of attribution, not of the reviewer — so the cell has to name
    // it rather than let it read as a model that could not answer.
    substituted: failed.filter((run) => run.reason === 'model-substituted').length,
  };
}

/**
 * Which bucket every run of a case lands in, resolved once.
 *
 * Lifted out of `caseRows` at the function size budget, and the seam is the
 * right one: this decides *what each run counts as*, while the row literal
 * decides what gets printed. The `scoredSet` intersection is the part that has
 * to travel with it — see the comments below.
 */
function buckets(runs) {
  // Three readings of a cut run, two of them wrong. Discarding it throws away
  // findings that are perfectly good — the cut lands on `analysis`, which the
  // schema orders first, so the model still emitted its findings normally.
  // Folding it in as an ordinary run counts every defect it never reached as a
  // confirmed miss. What is true is narrower than either: its findings are
  // observations and its silence is not, so the silence is counted once, as
  // `unresolved`, and reported beside the figure instead of inside it.
  const truncated = new Set(truncatedRuns(runs));
  // `!run.error` here, not only in `run.mjs`. The other three buckets each
  // begin with that filter (`run-buckets.mjs`), and this one used to hold the
  // partition together by relying on `run.mjs` declining to attach a score to a
  // failed run — an invariant living in a different file, which is exactly the
  // fragility `unreadableRuns` documents about itself: "the assumption holds
  // only while run.mjs attaches a score to every parsed reply, and nothing here
  // would notice if it stopped". A substituted run is the first that can carry
  // a report, a score-worthy reply and a failure at once, so the guard moves
  // here where the sum is computed.
  const scored = runs.filter((run) => run.score && !run.error && !truncated.has(run));
  // Intersected with `scored`, not merely collected — the whole table rests on
  // cut runs being a *subset* of the scored ones. A cut run that somehow
  // carried no score would otherwise report unresolved opportunities against a
  // denominator it never contributed to, so the caveat's stated upper bound
  // could exceed 100%. Enforced rather than assumed, because the assumption
  // holds only while `run.mjs` attaches a score to every parsed reply, and
  // nothing here would notice if it stopped.
  const scoredSet = new Set(scored);
  return { truncated, scored, scoredSet, cut: analysisCutRuns(runs).filter((run) => scoredSet.has(run)) };
}

/**
 * WHAT THE SERVER DID ABOUT THE SCHEMA, not what the operator asked for.
 *
 * `--structured-output` is a REQUEST. `review-request.mjs` falls back to the unconstrained path when a
 * server rejects `response_format`, and the CLI already reports that as `degraded` — "asked for, and
 * not obtained", the pair `cmd-review.mjs` emits precisely so a harness can tell "fell back after a
 * refusal" from "never wanted a schema". The benchmark read only the flag, so an arm that degraded on
 * every request was captioned as a schema arm and compared against an unconstrained one: two names for
 * the same measurement.
 *
 * Counted per RUN, not collapsed to a boolean — a case can degrade on some runs and not others, and a
 * boolean would replace one caption that cannot see the failure with another. `reported` is the
 * denominator (runs that came back with an envelope at all), so the count is read against what was
 * actually observed rather than against runs that never answered.
 *
 * 
 */
export function caseRows(results, { cold = false } = {}) {
  return results.map((result) => {
    const { caseDef, runs } = result;
    // `unresolved` is zero wherever nothing was cut, which is what keeps a row
    // comparable with every figure this table printed before.
    const { truncated, scored, scoredSet, cut } = buckets(runs);
    const listed = caseDef.defects.length;
    const found = scored.reduce((total, run) => total + run.score.recall.found, 0);
    const anchored = scored.reduce((total, run) => total + run.score.recall.anchored, 0);
    const unmatched = scored.reduce((total, run) => total + run.score.unmatched.length, 0);
    const unresolved = cut.reduce((total, run) => total + (listed - (run.score?.recall.found ?? 0)), 0);
    const { failed, timedOut, capped, substituted } = failureStats(runs);
    const prefill = timingSamples(runs, 'prefillMs', cold);
    const generation = timingSamples(runs, 'generationMs', cold);
    const rate = rateSamples(runs);
    return {
      id: caseDef.id,
      listed,
      dropped: caseDef.dropped.length,
      opportunities: listed * scored.length,
      found,
      unresolved,
      anchored,
      unmatched,
      failed,
      // A sub-count of `failed`, like `cut` is of `scored` — printed inside that
      // cell rather than beside it, so the row invariant below still accounts
      // for every run.
      timedOut,
      capped,
      substituted,
      truncated: truncated.size,
      // A sub-count of `scored`, not a bucket beside it — stated here because a
      // number that looks like a bucket and is not is exactly the ambiguity the
      // sum invariant below exists to prevent.
      cut: cut.length,
      unreadable: unreadableRuns(runs, scoredSet).length,
      scored: scored.length,
      runs: runs.length,
      diffOnly: runs.some((run) => run.diffOnly),
      // See `schemaDegrade` above. Per RUN, never a boolean.
      reported: runs.filter((run) => run.report).length,
      degraded: runs.filter((run) => run.report?.degraded).length,
      tokens: promptSamples(runs),
      prefill,
      generation,
      rate,
    };
  });
}
