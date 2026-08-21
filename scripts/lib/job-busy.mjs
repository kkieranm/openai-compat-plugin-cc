/**
 * What a contended database means, and the one way to wait for it.
 *
 * Its own module rather than a corner of `job-store.mjs` because it is a fact
 * about SQLite that five unrelated lifecycle phases need — submission, worker
 * registration, queue acquisition, the heartbeat, and a worker's terminal write —
 * and because
 * putting it beside the store pushed that file past this repo's size budget,
 * which is the moment the repo's own rule says to extract rather than to raise
 * the ceiling.
 */

/**
 * A contended database has told the caller nothing about any job.
 *
 * Lives here rather than beside any one caller because it is a fact about
 * SQLite, not about queueing or retention: after `busy_timeout` expires, a
 * writer has learned only that someone else held the lock. Treating that as a
 * verdict would kill live work because two processes happened to write at once,
 * so every caller retries or defers instead.
 */
export function isBusy(error) {
  return error?.errcode === 5 || /database is locked|SQLITE_BUSY/i.test(error?.message ?? '');
}

/**
 * Retry `fn` while — and only while — it fails busy.
 *
 * **Policy-neutral on purpose.** A non-busy error is rethrown on the first
 * attempt, never retried and never delayed; the final busy error is rethrown
 * too. What contention *means* is the caller's to decide, and the callers here
 * genuinely disagree: `attempt` turns it into a `blocked` verdict, `sweepQuietly`
 * swallows it, the heartbeat skips a tick. The skip-only sites keep a plain
 * `isBusy` catch, because giving them retries would make them wait for something
 * they do not need.
 *
 * **What comes through here is an ENUMERATED SET, not "every important write".**
 * Seven sites: opening the store; the three writes that publish a job's terminal
 * state (`completed`, `failed`, `queue-timeout`); `markSpawned`, which runs after
 * a detached worker already exists; `registerWaiter`, whose caller has no catch,
 * so losing it costs a whole run; and the LAUNCH-OUTCOME terminal write in
 * `job-launch-outcome.mjs`, without which a row whose launch
 * could not be confirmed AND WHICH NO WORKER HAS REGISTERED AGAINST blocks every job behind it
 * for the whole startup grace. What they share is that work exists which is lost
 * if the call does not land — for the seventh, the work is the queue's ability to
 * move past such a row.
 *
 * **Both qualifications are load-bearing, not hedging.** A spawn rejection can
 * arrive after the child is alive, so that site records a launch it could not
 * CONFIRM rather than one it saw fail, and the row may be one a worker registers against a
 * moment later — in which case nothing was blocked and the write correctly
 * matches nothing.
 *
 * Counting them, outside this module: seven `withBusyRetry` call sites, and
 * five `isBusy` call sites. The two sets are now DISJOINT — every remaining
 * `isBusy` is a skip-only caller that never retries. They overlapped until
 * the spawn stamp's exhaustion guard — the one shared member — stopped asking
 * WHICH storage fault it had suffered. No total is stated even so, and neither number
 * appears without its noun. `tests/busy-site-count.test.js` counts both from
 * `scripts/lib` and reddens if either sentence here disagrees, because this count
 * drifted repeatedly when it was prose alone.
 *
 * **What is deliberately NOT wrapped, so nobody reads the list above as a
 * guarantee about the database as a whole:** `insertJob` (precedes the spawn — a
 * busy there is a clean failure with nothing running), `requestCancel` (a busy
 * surfaces to a user at a terminal who can simply run the command again), and
 * every write in `job-reconcile.mjs`, whose sweep re-runs on the next read and so
 * corrects itself. That last one is a judgement, not a proof asserted here.
 *
 * An earlier draft of this comment said "writing a job's terminal state" and
 * meant only two of the three: `timeOut`'s `queue-timeout` write was not wrapped,
 * and the sentence was what made that look deliberate. Enumerated now, because a
 * doc claiming a property the code does not have is the same defect this module
 * was written to remove.
 *
 * **The bound is elapsed time, not an attempt count.** Each attempt can itself
 * block inside SQLite for that handle's `busy_timeout`, so "five attempts" bounds
 * nothing a user can feel — five of them could be eighty seconds. It follows that
 * a caller wanting this budget to mean anything must keep its per-attempt
 * `busy_timeout` well under it; `openStore` does exactly that, and says why.
 *
 * Measured, because the two writers behave differently and reading cannot tell
 * them apart: under a held write lock, `PRAGMA journal_mode = WAL` fails in 0ms
 * whether the timeout is 10s or 250ms — SQLite does not consult the busy handler
 * for it at all — while `CREATE TABLE` honours it exactly, blocking 10755ms at
 * 10s and 330ms at 250ms.
 *
 * **`budgetMs` is a FLOOR on when giving up begins, not a ceiling on how long
 * this takes.** A synchronous SQLite call already in progress cannot be
 * interrupted, so the real elapsed time overshoots by up to one attempt plus one
 * delay. Said plainly here because the comment this file used to carry above the
 * WAL pragma made exactly the opposite mistake — it promised a guarantee the
 * code could not keep.
 *
 * The sleep is synchronous, and that is safe **only because of where these
 * callers sit**: each of the first six runs before this process's model call or
 * after it has settled, so none can freeze a request in flight. The seventh is
 * different and is argued separately below — on the post-`'spawn'` path another
 * PROCESS may have a request in flight, which is why its safety cannot come from
 * this sentence. During terminal persistence
 * it does delay the heartbeat and the cancellation read — but no generation
 * remains to cancel by then. **A further call site does not inherit that
 * argument** — it is a property of where these sit, not of this function, and a
 * caller added inside a live request would freeze it.
 *
 * **The seventh site's argument, made on its own terms as that warning demands.**
 * The first version of it claimed the site runs "after the child has failed to
 * launch, so no model call exists" — and that is FALSE, by this feature's own
 * design: a spawn rejection can arrive after a detached worker was created, and
 * that worker may still be running and may yet call a model. The true argument does not depend on the spawn outcome at all.
 * **The sleep blocks the SUBMITTER and nothing else.** Any worker that does exist
 * is a DETACHED process with its own event loop, reaching the database
 * independently; this process cannot suspend it by blocking itself. So a request
 * in flight in that worker is not one this sleep can REACH — it keeps running
 * while this process sits still.
 *
 * Note what that argument does NOT say, because an earlier version of it said
 * exactly this and it was false: it does not say there is no such request. There
 * may well be one — the paragraph above this says so outright — and this site is
 * safe because the sleep cannot touch it, never because it does not exist.
 * Unreachable is not nonexistent, and collapsing the two is the conflation
 * this argument exists to remove.
 *
 * Deliberately NOT argued from descriptors. An earlier version added that the
 * worker "holds no descriptor this process owns", which is false on exactly the
 * path in question: the rejection that brings us here can be a FAILING CLOSE of
 * the submitter's copy of the log descriptor, so what that copy is doing is the
 * one thing unresolved. The argument does not need it — process independence
 * carries it alone.
 */
export function withBusyRetry(fn, { budgetMs = 30_000, delayMs = 50 } = {}) {
  // `performance.now()` rather than `Date.now()`: the budget measures a duration,
  // and a wall clock can step — NTP correction, a manual change, DST on a system
  // that keeps local time — which would either abandon a retry immediately or
  // extend it by the size of the jump.
  const startedAt = performance.now();
  for (;;) {
    try {
      return fn();
    } catch (error) {
      if (!isBusy(error)) throw error;
      if (performance.now() - startedAt >= budgetMs) throw error;
      sleepSync(delayMs);
    }
  }
}

/**
 * Block this thread for `ms`. `Atomics.wait` rather than a spin loop: a spin
 * burns a core for the whole delay, and the point of waiting here is to leave
 * the machine free for whoever is holding the lock.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
