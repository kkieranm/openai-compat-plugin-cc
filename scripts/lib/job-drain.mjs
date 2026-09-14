// What the QUEUE will do next — a different question from whether a row may be
// written off, and split from `job-abandon.mjs` when that file reached its size
// budget. The seam is real: this asks `decide`'s question, that one asks the
// operator's.
import { beatIsStale, livenessOf } from './job-liveness.mjs';
import { scanQueued } from './job-queue.mjs';
import { rowsInState } from './job-record.mjs';

/**
 * Can anything actually start now — `decide`'s question, asked in `decide`'s
 * order, about the state this write leaves behind.
 *
 * **Both rungs, and the running one first.** Consulting the queued rung alone is
 * a defect this repo has already shipped once: a queued row
 * can be the head while a live `running` row refuses every caller before queue
 * order is ever consulted, and reporting drainage there is simply false.
 *
 * The queued rung needs `role === 'head'` rather than merely a head, because
 * `scanQueued` also yields `blocks` — for a `starting` row, a live row of
 * unknown version, a malformed one — which `decide` rejects at its own last
 * rung. A head with a cancellation pending is excluded for the same reason: its
 * own worker gets `cancelled`, so it never acquires and never clears the way.
 *
 * **Precondition on this export, not an observation:** the row the caller has
 * just disposed of must already be TERMINAL, so it drops out of both scans
 * without being excluded by name. Not "already `failed`" — the recovery path
 * reaches here after `reconcile`, which writes `cancelled` on two of its arms.
 */
export function couldDrain(db, nowMs) {
  for (const row of rowsInState(db, 'running')) {
    if (livenessOf(row, nowMs) !== 'dead') return false;
  }
  const { head, role } = scanQueued(rowsInState(db, 'queued'), (row) => livenessOf(row, nowMs), () => {});
  if (!head || role !== 'head' || head.cancel_requested_at) return false;

  // **`live` is not evidence a successor will run, and taking it as such would
  // reproduce inside this command the exact defect it exists to fix.** `role ===
  // 'head'` needs only `livenessOf === live`, which proves a pid NUMBER is
  // occupied — so a successor that is itself a dead waiter holding a recycled pid
  // would make this true while everyone behind it stayed blocked.
  //
  // A fresh beat is the only evidence this design has that an event loop is
  // actually running, and it is the same bar the stale-beat refusal itself stands
  // on. `beatIsStale` ALONE is not enough: it answers `false` for an unparseable
  // beat, so the parse check below is load-bearing rather than defensive.
  //
  // Bounded residual, stated rather than left to be found: a pid recycled while
  // its old beat is still fresh passes for up to `STALE_BEAT_MS`. Narrowed from
  // unbounded to a minute, not closed.
  //
  // **And the other direction, which the first draft of this comment omitted:
  // this bar is STRICTER than `decide`'s own eligibility.** `decide` seats a head
  // on a live pid and a known version, never on beat freshness — so a genuinely
  // live successor whose beat has gone stale (machine sleep, or a `beat` write
  // swallowed by `SQLITE_BUSY`) IS acquirable while this returns false and the
  // sentence is withheld. Under-claiming is the direction to fail in: a missing
  // sentence costs a reader nothing, and the alternative is the recycled-pid
  // false positive above.
  if (!Number.isFinite(Date.parse(head.last_beat_at ?? ''))) return false;
  if (beatIsStale(head, nowMs)) return false;

  // **A live, freshly-beating successor can still be about to give up.**
  // `awaitTurn` beats BEFORE it checks the wait cap, so a row past its
  // `--max-wait` presents exactly the evidence above while the queue is about to
  // time it out rather than seat it. Not "its very next act is `timeOut`" — a
  // successor that has registered but not yet made `awaitTurn`'s deliberately
  // FREE first attempt would call `tryAcquire`, and could win it. Withholding
  // the sentence there is an under-claim, the direction this module chooses.
  //
  // The arithmetic mirrors `awaitTurn`'s deliberately — same anchor, same
  // comparison — so the two cannot disagree about when a wait has expired. A
  // `created_at` that will not parse yields NaN and falls through on both sides,
  // consistently with a worker that never expires.
  const deadline = head.max_wait_ms === null ? null : Date.parse(head.created_at) + head.max_wait_ms;
  return deadline === null || !(deadline <= nowMs);
}
