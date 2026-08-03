/**
 * Reliability, counted over **physical requests** rather than logical runs.
 *
 * The two denominators are separate on purpose. A run whose first two attempts
 * died and whose third answered is one scored run — correctly, because the
 * reviewer did get its chance and a failed attempt is missing data, not an
 * observed miss. But that same run is three requests, two of which the server
 * dropped, and a report showing only the first number says a sick server is
 * healthy. Recall reads logical runs; this reads every request that went on the
 * wire. See ADR 012 and BACKLOG.md OAI-20.
 */

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

/** Count by a key, returned as sorted `[key, count]` pairs so the table is stable. */
function tally(items, keyOf) {
  const counts = new Map();
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
