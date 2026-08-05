// "Still here" while the model is thinking.
//
// The queue's wait loop beats every time round, so a *queued* worker has always
// been visible. A *running* one had nothing at all: it acquired its turn and
// then went silent for the whole model call — minutes on a local model, and the
// prefill alone can be several. Any reader deriving `stalled` from the beat
// would therefore have called every healthy running job stalled, which is why
// this lives here rather than waiting for the reader that needs it.
import { beat } from './job-record.mjs';

/** How often a running worker records that it is still there. */
export const BEAT_MS = 5_000;

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
 */
export function startHeartbeat(db, seq, { intervalMs = BEAT_MS } = {}) {
  const timer = setInterval(() => beat(db, seq, new Date().toISOString()), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
