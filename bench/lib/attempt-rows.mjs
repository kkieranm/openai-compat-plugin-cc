/**
 * Reliability, counted over **physical requests** rather than logical runs.
 *
 * The two denominators are separate on purpose. A run whose first two attempts
 * died and whose third answered is one scored run — correctly, because the
 * reviewer did get its chance and a failed attempt is missing data, not an
 * observed miss. But that same run is three requests, two of which the server
 * dropped, and a report showing only the first number says a sick server is
 * healthy. Recall reads logical runs; this reads every request that went on the
 * wire.
 */

/**
 * The three categories that PARTITION a failed attempt's response evidence.
 *
 * Named because they are seeded into their tally and asserted by tests, and a
 * string typed twice is a row that silently splits in two.
 */
const RESPONSE_OBTAINED = 'HTTP response obtained';
const NO_RESPONSE = 'no HTTP response obtained';
const NOT_RECORDED = 'not recorded';

/**
 * The partition, seeded so every one of them prints even at zero.
 *
 * Exported because `reliability-report.mjs` has to recognise a key that is NOT
 * one of these — the malformed-value row — to know whether its completeness
 * sentence still holds. Transcribing the three names there would be a second
 * copy to drift, and the drift would be silent: a renamed bucket would simply
 * stop being recognised and the sentence would go quietly wrong.
 */
export const RESPONSE_BUCKETS = [RESPONSE_OBTAINED, NO_RESPONSE, NOT_RECORDED];

/**
 * Which response bucket one failed attempt belongs in.
 *
 * The third category is the point. An older attempt record carries no such
 * field, and folding those into `false` would convert missing
 * instrumentation into an observation that nothing answered — the same defect
 * `byFirstText` avoids with its `== null`, arriving here by the opposite route.
 * That split has two buckets and needs a loose check to keep old records out of
 * the positive one; this has a bucket of its own for them, so the checks are
 * STRICT.
 *
 * The three are seeded into the tally because they PARTITION every failed
 * attempt, which makes `not recorded: 0` the statement that the other two counts
 * are complete. Suppressed, that statement is unavailable, and a reader cannot
 * tell "no legacy records here" from "this report has no such row".
 *
 * The fourth key is deliberately NOT seeded and not part of the partition — it is
 * a bug report. `undefined` alone means the field is absent; anything else
 * present was written by something, just not as a boolean, and filing that as
 * "not recorded" would launder a malformed record into benign legacy data and let
 * a writer defect read as an old file. It prints only when it happens.
 */
function responseBucket(attempt) {
  if (attempt.serverResponded === true) return RESPONSE_OBTAINED;
  if (attempt.serverResponded === false) return NO_RESPONSE;
  if (attempt.serverResponded === undefined) return NOT_RECORDED;
  return 'recorded as a non-boolean';
}

/** Every physical attempt across the sweep, tagged with the case it belonged to. */
function everyAttempt(results) {
  return results.flatMap(({ caseDef, runs }) =>
    runs.flatMap((run) =>
      // `run.attempts` on the failure path, `run.report.attempts` on the success
      // one — the two envelopes differ and only one of them has a report.
      (run.report?.attempts ?? run.attempts ?? []).map((attempt) => ({
        caseId: caseDef.id,
        // `run.requestedModel` is the failure path's copy: a run with no report
        // still knows which model was asked for, and without it every
        // outright-failed run lands in an "unknown" bucket.
        requested: run.report?.requestedModel ?? run.requestedModel ?? null,
        attempt,
      })),
    ),
  );
}

/**
 * Count by a key, returned as sorted `[key, count]` pairs so the table is stable.
 *
 * `seed` names keys that must appear even at zero. Most splits want the default —
 * a reason code nobody produced has nothing to say — but a split whose categories
 * PARTITION the failures is different: there, a zero is a measurement. "No attempt
 * lacked the field" is what makes the other counts readable as observations rather
 * than as a sample of unknown coverage, and a suppressed row leaves the reader
 * unable to tell that from a report which never had the row at all.
 */
function tally(items, keyOf, seed = []) {
  const counts = new Map(seed.map((key) => [key, 0]));
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

/**
 * The reliability picture, or `null` when no attempt record exists at all.
 *
 * Null rather than a row of zeroes: a sweep run before this record existed, or
 * one whose every run failed before reaching the transport, has *not observed* a
 * 0% failure rate — and printing one would be the report asserting a measurement
 * nobody took, which is the class this repo keeps finding.
 */
export function attemptRows(results) {
  const all = everyAttempt(results);
  if (all.length === 0) return null;

  const failed = all.filter(({ attempt }) => attempt.outcome === 'failed');
  return {
    total: all.length,
    failed: failed.length,
    answered: all.filter(({ attempt }) => attempt.outcome === 'answered').length,
    // Counted in `total` because it was a real request, and kept out of `failed`
    // because it was not a fault: a server refusing `stream_options` refuses it
    // every time, and the plugin's next request succeeds. Folding these into the
    // failure rate would report a server answering every shaped request as
    // failing half of them.
    refused: all.filter(({ attempt }) => attempt.outcome === 'refused').length,
    // Never resolved, either — an attempt whose handle was never closed is a bug
    // in the ledger plumbing, and it is worth being able to see one.
    unresolved: all.filter(({ attempt }) => attempt.outcome === null).length,
    warmEligible: all.filter(({ attempt }) => attempt.warmEligible).length,
    byReason: tally(failed, ({ attempt }) => attempt.reason ?? 'unclassified'),
    byCase: tally(failed, ({ caseId }) => caseId),
    byModel: tally(failed, ({ requested }) => requested ?? 'unknown'),
    // Reads the timings the ledger already keeps on a FAILED attempt, which
    // `attempt-outcome.mjs` retains for exactly this — "whether failures cluster
    // before or after the first token" is the sentence in its own comment. The
    // record was being kept and never read.
    //
    // The split is evidential, not causal, and the paragraph beside it is worded
    // to match: a measured prefill means the attempt reached first model text,
    // so whatever ended it happened after that boundary. Null is the absence of
    // that evidence — a request that died before first token, or one whose
    // failure carried no timings at all — and never evidence of a cause.
    // `== null` deliberately, not `=== null`: an attempt recorded before this
    // field existed carries `undefined`, and a strict check would file it as
    // text-observed — asserting a measurement that record never held.
    byFirstText: tally(failed, ({ attempt }) => (
      attempt.prefillMs == null ? 'no first model text observed' : 'first model text observed'
    )),
    // The narrower question, and the only one this record settles about the other
    // end: did headers arrive. NOT whether a peer was reached — `ECONNREFUSED`
    // draws an active refusal whose origin the code alone does not identify and
    // lands in the second bucket, a TLS rejection reaches a peer and lands
    // there too.
    //
    // Seeded, so all three categories print even at zero — see `responseBucket`.
    byServerResponded: tally(failed, ({ attempt }) => responseBucket(attempt), RESPONSE_BUCKETS),
  };
}

/**
 * The attempt that supplied a run's headline timings, or null.
 *
 * Exactly one attempt per logical run ends `answered` — the loop returns as soon
 * as one does — so this is unambiguous. It exists because `warmEligible` on
 * *that* attempt is what decides whether the run's prefill may be quoted as a
 * cold measurement.
 */
export function answeringAttempt(run) {
  return (run.report?.attempts ?? []).find((attempt) => attempt.outcome === 'answered') ?? null;
}
