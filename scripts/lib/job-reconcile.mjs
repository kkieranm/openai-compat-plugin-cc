// Bringing a row up to date with what its owner process is actually doing.
//
// Two rules constrain everything here, and both are refusals:
//
// 1. **No reconciler terminalizes a job whose pid is alive.** Finite recovery
//    from a stale worker, zero overlap of model calls, and never signalling a
//    process cannot all hold at once; this repo keeps the first two by paying in
//    recovery — a suspended or recycled-pid worker wedges the head of the queue
//    and is named in `/oai:status` for a human to act on. This does not stop a
//    worker ending its *own* run on cancel or `--max-wait`.
// 2. **A row a newer plugin wrote is never mutated and never deleted.** It is
//    skipped instead. Reinterpreting columns that merely look familiar is how an
//    older build corrupts a newer one's state while believing it is helping.
import { livenessOf } from './job-liveness.mjs';
import { abandonUnstarted, finish, isKnownVersion, isTerminal } from './job-record.mjs';
import { errorReport } from './review-report.mjs';

function report(reason, message, hint) {
  return errorReport({ reason, message, hint });
}

/**
 * A worker that registered, took the job (or was still waiting for it) and then
 * disappeared without recording anything.
 *
 * If a cancellation was asked for first, this *is* the cancellation completing:
 * `/oai:cancel` never terminalizes anything itself, precisely so that only an
 * observed exit produces `cancelled`.
 */
function terminalizeDead(db, row, at) {
  if (row.cancel_requested_at) {
    return finish(db, row.seq, { state: 'cancelled', at }) ? 'cancelled' : null;
  }
  const failure = report(
    'worker-died',
    `The worker for job ${row.id} exited without recording an outcome.`,
    'Its output, if it produced any, is in the job log.',
  );
  return finish(db, row.seq, { state: 'failed', failure, at }) ? 'worker-died' : null;
}

/**
 * Reconcile one row. Returns the reason it was terminalized, or `null` if it was
 * left exactly as it was found.
 *
 * `liveness` may be passed in by a caller that has already probed it, so a row
 * is never asked about twice in one pass — the answer could differ between the
 * two calls, and a decision split across two answers is not one decision.
 */
export function reconcile(db, row, { nowMs = Date.now(), at = new Date().toISOString(), liveness } = {}) {
  if (!row || isTerminal(row.state)) return null;
  if (!isKnownVersion(row)) return null;

  const state = liveness ?? livenessOf(row, nowMs);
  if (state === 'dead') return terminalizeDead(db, row, at);
  if (state === 'never-started') {
    const failure = report(
      'worker-never-started',
      `No worker ever registered for job ${row.id}, so it will never run.`,
      'The process that submitted it most likely died before the worker was spawned. Submit it again.',
    );
    return abandonUnstarted(db, row.seq, failure, at) ? 'worker-never-started' : null;
  }
  // live, starting, malformed: nothing has been established about this job.
  return null;
}
