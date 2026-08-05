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
import { beat, cancelRequested } from './job-record.mjs';

/** How often a running worker records that it is still there. */
export const BEAT_MS = 5_000;

/**
 * Stop, now, without recording a verdict.
 *
 * **`process.exit()` rather than `process.exitCode`, and the difference is the
 * whole mechanism.** Setting the code leaves the process alive — the open socket
 * to the model keeps the event loop running, so the request continues to
 * completion and "cancelled" means nothing. Exiting closes the socket, which is
 * what stops the server-side generation too (measured: LM Studio reports
 * "Client disconnected. Stopping generation" on the same second), and is what
 * lets this repo cancel without an `AbortController`.
 *
 * Nothing is written on the way out. The row stays `running` with a pid that no
 * longer exists, and the next reader turns that into terminal `cancelled` —
 * which is what makes the verdict an *observed* exit rather than an assumed one.
 */
function exitOnCancel() {
  process.stderr.write('Cancellation requested: exiting without recording an outcome.\n');
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
export function startHeartbeat(db, seq, { intervalMs = BEAT_MS, onCancel = exitOnCancel } = {}) {
  const timer = setInterval(() => {
    beat(db, seq, new Date().toISOString());
    if (cancelRequested(db, seq)) onCancel();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
