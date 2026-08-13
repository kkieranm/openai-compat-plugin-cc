// "Still here" while the model is thinking.
//
// The queue's wait loop beats every time round, so a *queued* worker has always
// been visible. A *running* one had nothing at all: it acquired its turn and
// then went silent for the whole model call — minutes on a local model, and the
// prefill alone can be several. Any reader deriving `stalled` from the beat
// would therefore have called every healthy running job stalled, which is why
// this lives here rather than waiting for the reader that needs it.
//
// It is also the only moment a running worker looks up from its request, so it
// is where cancellation is noticed: there is no signal to catch, by design.
import { writeCancelAck } from './cancel-ack.mjs';
import { isBusy } from './job-busy.mjs';
import { beat, cancelRequested } from './job-record.mjs';

/** How often a running worker records that it is still there. */
export const BEAT_MS = 5_000;

/**
 * Say that this exit was the cancellation, then stop.
 *
 * **`process.exit()` rather than `process.exitCode`, and the difference is the
 * whole mechanism.** Setting the code leaves the process alive — the open socket
 * to the model keeps the event loop running, so the request continues to
 * completion and "cancelled" means nothing. Exiting closes the socket, which is
 * what stops the server-side generation too (measured: LM Studio reports
 * "Client disconnected. Stopping generation" on the same second), and is what
 * lets this repo cancel without an `AbortController`.
 *
 * **NO ROW IS WRITTEN, and that is a correctness requirement rather than a
 * leftover.** A terminal row would clear this job as a `running` blocker, so the
 * queue could dispatch the next worker in the window between that commit and
 * this process actually reaching `process.exit()` — two model calls in flight at
 * once, which is the one thing the queue exists to prevent. The row therefore
 * stays `running` until the pid is observed dead, exactly as before.
 *
 * What IS new (OAI-66) is a file beside the job log saying the exit was asked
 * for. Without it a later reader cannot tell this exit from a crash, and it
 * published both as a clean `cancelled` — discarding a real crash diagnosis.
 *
 * **A write that fails is not WAITED ON — which is a claim about the code's
 * control flow and not about latency.** Its outcome is discarded rather than
 * retried or escalated, and that is the whole of the promise, because a
 * synchronous call cannot make a wider one: `openSync` may itself block for a long
 * time and then fail, and the exit is no earlier for the failure. The user asked for
 * the request to stop; generation costs money that cannot be recovered, while a
 * row that reads `cancel-unconfirmed` instead of `cancelled` costs precision that
 * can be recovered from the log. Waiting for a contended filesystem would invert
 * that, and would repeat the defect this module already documents: contention
 * keeping an expensive request alive after the user asked for it to stop.
 *
 * **A write that HANGS still delays it**, and nothing here prevents that: the open,
 * the write and the close are all synchronous, so a wedged NFS or FUSE mount keeps
 * the paid request alive and the queue blocked exactly as before. That residual is
 * the same one `cancel-ack.mjs` records on the read side, reached from the other
 * direction, and it is stated rather than argued away.
 */
function exitOnCancel(ack) {
  process.stderr.write('Cancellation requested: exiting without recording an outcome.\n');
  // Its return is ignored on purpose: nothing is retried or escalated on it — and
  // the call itself is synchronous, so "not waited on" is about what happens to the
  // RESULT, never a promise that the call is quick. A caller
  // that supplied no id writes nothing rather than an `undefined`-id file. A
  // failure means the next reader says `cancel-unconfirmed`, which is the honest
  // answer when nothing recorded why this process stopped.
  writeCancelAck(ack?.seq, ack?.jobId);
  process.exit(0);
}

/**
 * Start beating, and return the function that stops.
 *
 * **`unref()` is not an optimisation.** `oai-companion.mjs` has no
 * `process.exit(0)` on success, so a referenced interval would keep the worker
 * alive forever after its job finished — a detached process nobody can see,
 * holding a database handle and beating on a terminal row. Un-referenced, the
 * timer fires only while something real keeps the loop running, which during a
 * job is the open socket. That is exactly the fact the beat is meant to report.
 *
 * The `finally` that calls the returned function is still required: an unref'd
 * timer stops the process lingering, it does not stop a beat landing after the
 * verdict. `beat` guards on a non-terminal state for that, and this is the belt
 * to its braces.
 *
 * The beat lands *before* the cancellation check on purpose: a worker's last act
 * before exiting is to beat, which is precisely why a fresh beat may never be
 * read as proof of life. The pid decides that; this only corroborates.
 */
export function startHeartbeat(db, seq, { intervalMs = BEAT_MS, onCancel = exitOnCancel, jobId } = {}) {
  const timer = setInterval(() => {
    // A throw from inside a timer callback has nowhere to go: it is an uncaught
    // exception and it KILLS THE WORKER, mid-model-call, discarding a request
    // already in flight. Proved by execution — a handle whose `prepare()` throws
    // errcode 5 exits this process 1.
    //
    // So a contended database skips the tick. The next beat is five seconds
    // away and the stale-beat → `stalled` path already represents a missed
    // update correctly, which makes skipping the cheapest correct answer.
    //
    // The catch is narrowed to `isBusy` on purpose: any other error is a defect,
    // not contention, and a blanket catch here would hide it forever inside a
    // timer nobody is watching.
    //
    // TWO catches, not one. Sharing a try block let a busy *write* skip the
    // cancellation *read* — and in WAL mode a reader does not block behind a
    // writer, so that read would very often have succeeded. Since sustained
    // write contention is exactly when a beat keeps failing, one try block made
    // contention able to keep an expensive model request alive indefinitely
    // after the user asked for it to stop. They are independent operations and
    // are now attempted independently.
    try {
      beat(db, seq, new Date().toISOString());
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
    let cancelled = false;
    try {
      cancelled = cancelRequested(db, seq);
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
    // OUTSIDE both catches, and not by accident: a cancellation silently
    // swallowed is worse than a callback defect made visible. `cancelled` stays
    // false when the read itself was skipped, so a contended read never reads as
    // "no cancel" — it reads as "not known this tick", and the next tick asks
    // again.
    // The id travels through the options bag rather than a positional argument:
    // this path may touch no database, so it cannot look the id up, and two test
    // files already call `startHeartbeat(db, seq, opts)`.
    if (cancelled) onCancel({ seq, jobId });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
