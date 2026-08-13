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
import { cancelAckMatches } from './cancel-ack.mjs';
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
 * **A pending cancellation is not by itself proof that the cancellation is what
 * happened.** Until OAI-66 it was treated as proof, so a worker that CRASHED
 * while a cancel happened to be pending was published as a tidy `cancelled` with
 * no failure and no note — the crash diagnosis existed and was thrown away. What
 * the dead pid establishes is that the process is gone, never why.
 *
 * So the two shapes are separated, and only one of them needs evidence:
 *
 * - **A `queued` row sent nothing, provably.** `job-queue.mjs` `decide` returns
 *   `cancelled` only while the row is still `queued`, and acquisition is what
 *   transitions it to `running` — so a worker cancelled at that point never
 *   reached a request. Nothing was spent, and `cancelled` needs no confirming.
 * - **A `running` row may have been mid-request**, and that is the ambiguous one.
 *   It reads `cancelled` only if the worker left the acknowledgement described in
 *   `cancel-ack.mjs`; otherwise the death is reported as `cancel-unconfirmed`,
 *   which says what is known — it stopped, and nothing recorded why.
 *
 * `/oai:cancel` still terminalizes nothing itself, so a verdict here always
 * follows an observed exit. What is new is that an observed exit alone no longer
 * decides which verdict.
 *
 * **A failure to open, stat or read that check reads as absent, and nothing here
 * throws** — a hard constraint rather than politeness. (A failed CLOSE is not in
 * that set: by then the bytes have been read and compared, so a match stays a
 * match. `cancel-ack.mjs` argues it there.) This runs inside `decide`'s
 * `BEGIN IMMEDIATE` (`job-queue.mjs`), where a throw rolls the transaction back,
 * escapes `tryAcquire` and `awaitTurn` — which `cmd-task-worker.mjs` awaits
 * outside any try — and kills a worker that is merely waiting its turn. The job
 * log is never read or parsed on any path.
 */
function terminalizeDead(db, row, at) {
  if (row.cancel_requested_at) {
    if (row.state !== 'running' || cancelAckMatches(row.seq, row.id)) {
      return finish(db, row.seq, { state: 'cancelled', at }) ? 'cancelled' : null;
    }
    const unconfirmed = report(
      'cancel-unconfirmed',
      `The worker for job ${row.id} exited after a cancellation was requested, but never confirmed that`
      + ' the cancellation is why it stopped — so it may instead have died.',
      'Anything it printed is in the job log — though a worker killed after the model answered and'
      + ' before it recorded anything held that answer only in memory.',
    );
    return finish(db, row.seq, { state: 'failed', failure: unconfirmed, at }) ? 'cancel-unconfirmed' : null;
  }
  const failure = report(
    'worker-died',
    `The worker for job ${row.id} exited without recording an outcome.`,
    'Its output, if it produced any, is in the job log.',
  );
  return finish(db, row.seq, { state: 'failed', failure, at }) ? 'worker-died' : null;
}

/**
 * A job nothing ever picked up, past the grace that bounds how long a spawn may
 * take.
 *
 * A cancellation asked for first wins here too, and needs no confirming for the
 * same reason a `queued` row does not: this branch only ever sees rows where no
 * worker registered, and registration precedes anything being sent
 * (`cmd-task-worker.mjs`). Calling that `failed` would report a granted request
 * as a fault.
 *
 * **The hint states what is known and stops there (OAI-66).** It used to say the
 * submitting process *"most likely died before the worker was spawned"* — a cause
 * it cannot establish. It consults no evidence at all, and `spawned_at` would not
 * supply any: OAI-67 made a NULL `spawned_at` possible while a real worker
 * exists, so conditioning on it would replace one false claim with another. What
 * is actually known is that no worker registered and this job will not run, which
 * is what the message already says.
 */
function terminalizeUnstarted(db, row, at) {
  if (row.cancel_requested_at) {
    return abandonUnstarted(db, row.seq, { state: 'cancelled', at }) ? 'cancelled' : null;
  }
  const failure = report(
    'worker-never-started',
    `No worker ever registered for job ${row.id}, so it will never run.`,
    'Nothing here establishes why, so submitting it again is reasonable once; if it happens repeatedly,'
    + ' something is stopping workers from starting rather than this job failing. Check the job log:'
    + ' a worker that started and died before registering may have printed its own reason there.',
  );
  return abandonUnstarted(db, row.seq, { state: 'failed', failure, at }) ? 'worker-never-started' : null;
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
  if (state === 'never-started') return terminalizeUnstarted(db, row, at);
  // live, starting, malformed: nothing has been established about this job.
  return null;
}
