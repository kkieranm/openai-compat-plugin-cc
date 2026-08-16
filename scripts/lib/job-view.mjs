// What a reader sees, which is not what the table holds.
//
// Two things happen between the rows and the screen, and keeping them separate
// matters:
//
// 1. **Reconciliation writes.** Reading is when a dead worker is noticed, so
//    `/oai:status` is also the thing that collects one. That is deliberate —
//    there is no daemon here, so a job whose worker died sits `running` until
//    something looks, and forever if nothing ever does. It does not hold the
//    queue meanwhile: `job-queue.mjs` `decide` reconciles a dead running row and
//    carries on past it. A row that WEDGES a queue is instead one no reconciler
//    may touch — the live worker that has stopped beating is one such shape, and
//    the rest are whatever `queuedRole` refuses to skip. Named there rather than
//    listed here, because an enumeration copied into a comment goes stale the
//    moment that rule grows a case.
// 2. **`stalled` and `overdue` are derived, never stored.** They are statements
//    about *now* — a live pid that has stopped beating, a run past its own cap —
//    and a column holding one would be a cached answer to a question whose
//    answer changes while nobody is looking.
import { beatIsStale, livenessOf, relevantPid } from './job-liveness.mjs';
import { isTerminal, listJobs } from './job-record.mjs';
import { reconcile } from './job-reconcile.mjs';
import { scanQueued } from './job-queue.mjs';
import { USER_VERSION, openStore, openStoreForReading } from './job-store.mjs';

/**
 * Open the store for a reader, saying which kind of handle came back.
 *
 * The version is checked through a handle that cannot write *before* one that
 * can is ever created, so a database a newer plugin wrote is never opened
 * read-write at all — `openStore` would run `applySchema` against it on the way
 * past, and refusing after the fact is not refusing.
 *
 * `null` means no database exists: nothing has ever been submitted on this
 * machine, which is an answer rather than an error.
 */
export function openJobs() {
  const reading = openStoreForReading();
  if (!reading) return null;
  if (reading.version > USER_VERSION) return { db: reading.db, readOnly: true, version: reading.version };
  reading.db.close();
  return { db: openStore(), readOnly: false, version: reading.version };
}

/**
 * Bring every non-terminal row up to date with its process, and say which ones
 * that finished off.
 *
 * **Not filtered by workspace, while the display is.** A dead worker's row is
 * this machine's garbage wherever it was submitted from, and a reader scoped to
 * its own checkout would leave rows only some *other* directory's `/oai:status`
 * could ever collect — including the row a user in this directory is being told
 * about. (It is not that a dead row wedges the queue: `decide` reconciles one
 * and carries on. It is that nothing else ever collects it.)
 */
export function reconcileAll(db, { nowMs = Date.now(), at = new Date().toISOString() } = {}) {
  const collected = [];
  for (const row of listJobs(db)) {
    if (isTerminal(row.state)) continue;
    // Probed once and passed in: asking twice in one pass can get two different
    // answers, and a decision split across two answers is not one decision.
    const reason = reconcile(db, row, { nowMs, at, liveness: livenessOf(row, nowMs) });
    if (reason) collected.push({ id: row.id, reason });
  }
  return collected;
}

/** When this job's own run cap expires, or `null` if it has none or has not started. */
export function deadlineOf(row) {
  const maxMs = row.request?.maxMs;
  const started = Date.parse(row.started_at ?? '');
  if (!Number.isFinite(maxMs) || !Number.isFinite(started)) return null;
  return started + maxMs;
}

/**
 * The word to show, in precedence order.
 *
 * `dead` and `never-started` reach here only on a row reconciliation could not
 * touch — one a newer plugin wrote, which is never mutated. Showing it is the
 * whole remedy available: it is the row a user has to be told about, because
 * nothing in this build will ever clear it.
 *
 * `cancelling` comes *after* `overdue` and `stalled` and not before: a worker
 * that has stopped checking in is never going to see the cancellation, and
 * showing the request back to the user as though it had been received would hide
 * exactly the row they need to deal with by hand.
 */
function displayOf(row, liveness, nowMs) {
  if (isTerminal(row.state)) return row.state;
  if (liveness === 'malformed') return 'malformed';
  if (liveness === 'dead') return 'dead';
  if (liveness === 'never-started') return 'never-started';
  if (liveness !== 'live') return row.state;
  const deadline = deadlineOf(row);
  if (deadline !== null && nowMs > deadline) return 'overdue';
  if (beatIsStale(row, nowMs)) return 'stalled';
  if (row.cancel_requested_at) return 'cancelling';
  return row.state;
}

/** One row, plus everything about it that is true only at the moment of reading. */
export function viewOf(row, nowMs = Date.now()) {
  const liveness = livenessOf(row, nowMs);
  return {
    ...row,
    liveness,
    pid: relevantPid(row),
    deadline: deadlineOf(row),
    display: displayOf(row, liveness, nowMs),
  };
}

/**
 * The `seq` of the row this workspace's queued job is actually waiting on, or
 * `null`.
 *
 * **Blocking is DERIVED and RELATIONAL — it is not a state, and it is not a
 * property of a row.** The same queued row blocks one caller and not another,
 * so this asks "blocks whom?" and the answer needs both operands. Nothing here
 * may be reduced to a predicate over a single row: `queuedRole` returns `blocks`
 * only for the *pathological* rows, while an ordinary live known-version head
 * returns `head` and still blocks everyone behind it through `decide`'s `seq`
 * comparison. A filter on `queuedRole === 'blocks'` would ship, pass a test, and
 * hide the commonest blocker there is.
 *
 * **It also has TWO RUNGS, in `decide`'s order, because `decide` has two.** An
 * earlier revision consulted the queued rung alone and marked the queued head
 * while a live *running* row was what `tryAcquire` actually stopped at — naming
 * a row the user could clear without their job moving, which is this item's own
 * defect wearing new clothes. The rungs are: a non-dead running row, then the
 * queue's head. Only a FOREIGN blocker is named; a local one needs no
 * explanation, and falling through to the next rung instead of returning would
 * reinstate the mismatch.
 *
 * `scanQueued` is the queue's own head rule, imported rather than restated. The
 * liveness handed to it is the one `viewOf` already resolved, so no pid is
 * probed twice, and `onSkip` is a no-op: **reading must not reconcile here.**
 * `cmd-status.mjs` has already run `reconcileAll` where that was allowed, and
 * deliberately has not on a database a newer plugin wrote.
 *
 * The witness must be **uncancelled**: `decide` returns `cancelled` before it
 * ever scans the queue, so a local row with a pending cancellation is blocked by
 * nothing and cannot show that anyone is being starved. Reading that condition
 * as redundant is how it would get deleted.
 *
 * The witness must also carry **positive evidence that something is waiting on
 * its behalf** — `live`, or `starting`. `starting` is admitted for the ordinary
 * case: `registerWaiter` runs in the worker, so a normal submission reads
 * `starting` for its whole spawn window, and hiding the blocker from it would
 * miss the commonest case there is. It is **not** only that case — `livenessOf`
 * also answers `starting` for a submission whose parent died before spawning
 * anything, so this admits a false positive for up to `STARTUP_GRACE_MS`, after
 * which the row becomes `never-started` and reconciliation collects it.
 * Evidence, not proof: see the recycled-pid limit below.
 *
 * A `dead`, `never-started` or `malformed` local row is excluded, and the rule is
 * a **conservative evidence threshold**: the marker is a causal sentence the user
 * acts on — cancelling a job in another checkout, say — so it is printed only on
 * positive evidence that something here is waiting, and absence of evidence is
 * read as no. For a row that truly has no waiter the sentence is not vacuously
 * true but FALSE: that job cannot proceed whatever clears ahead of it.
 *
 * **What excluding these rows costs, and one exclusion that costs nothing —
 * none of it fixable here.** A `malformed` row with NO pid
 * recorded is not permanently caller-less — `registerWaiter` can still attach a
 * worker to it, after which it reads `live` — so excluding it hides the blocker
 * for that window: a transient false negative, accepted because the alternative
 * is a confident false accusation. By contrast, **a row holding an unreadable pid is excluded
 * PERMANENTLY, and correctly** (OAI-162): `registerWaiter`'s `AND waiter_pid IS
 * NULL` can never match it and `claimJob`'s `AND waiter_pid = ?` can never match
 * it either, so no path here takes it to `running` — which is the rule three
 * paragraphs up applying exactly as written, not an exception to it. Such a row
 * cannot proceed whatever clears ahead of it, so naming a blocker on its behalf
 * would be false. And `live` proves only that the pid NUMBER exists
 * (`job-liveness.mjs` `pidLiveness`, which is what `livenessOf` calls — `isAlive`
 * is a projection of it with no production caller), so a dead worker whose pid
 * was recycled passes
 * condition 5 and the marker can still blame a healthy foreign job. That is the
 * recycled-pid wedge this whole item exists downstream of, not something a
 * display predicate can close.
 *
 * An earlier revision instead argued the witness need not be viable at all,
 * because "`decide` blocks such a row too". That was withdrawn at review: it is
 * unfalsifiable for the rows it was about, since a row with no caller issues no
 * `tryAcquire` and so produces no verdict to disagree with.
 */
function blockingSeqFor(views, cwd) {
  const queued = views.filter((view) => view.state === 'queued').sort((a, b) => a.seq - b.seq);
  // Sorted ascending on purpose: `listJobs` is `seq DESC`, and "ahead of me"
  // read off that order is inverted — it would name a wrong row, plausibly.
  const eligible = (view) => view.workspace === cwd
    && !view.cancel_requested_at
    && (view.liveness === 'live' || view.liveness === 'starting');
  if (!queued.some(eligible)) return null;

  // Rung one, and it must come first because `decide` does: the running loop
  // returns `blocked` before queue order is ever consulted, so whenever a
  // non-dead running row exists it is what every local job is actually waiting
  // on. Marking the queued head here instead named a row that clearing would not
  // help — the defect this feature exists to remove, in a new place.
  // NO seq comparison: `decide`'s running loop makes none, and a malformed
  // running row's seq is arbitrary by definition.
  const running = views
    .filter((view) => view.state === 'running')
    .sort((a, b) => a.seq - b.seq)
    .find((view) => view.liveness !== 'dead');
  // A local blocker explains itself — and falling through to the queued head
  // here would re-create exactly the mismatch this rung was added to fix.
  if (running) return running.workspace === cwd ? null : running.seq;

  // Rung two: nothing is running, so the queue's own head is the blocker.
  // The `!head` arm is defensive and currently unreachable — an eligible witness
  // is `live` or `starting`, neither of which `queuedRole` skips, so the scan
  // always finds one. Said here so a reader does not go hunting for its case.
  const { head } = scanQueued(queued, (view) => view.liveness, () => {});
  if (!head || head.workspace === cwd) return null;
  return queued.some((view) => eligible(view) && view.seq > head.seq) ? head.seq : null;
}

/**
 * The rows a bare `/oai:status` shows: this workspace's, whatever is running
 * anywhere, and — when the row the queue currently stops at is a queued one from
 * elsewhere — that row too. Note "currently stops at", not "is stuck behind":
 * this workspace may be behind several foreign rows, and exactly one is shown.
 *
 * None of those three is a convenience. A job running in another checkout is
 * precisely what the jobs here are queued behind, and a malformed row holding
 * the head of the queue is the one thing a user most needs to see — hiding
 * either because it belongs to a different directory would leave a stuck queue
 * with no visible cause. The third clause is the one that makes that true rather
 * than merely intended: an ordinary queued job ahead of yours in another checkout
 * is `queued`, not `running`, and belongs to a different directory — so the first
 * two clauses drop exactly the row you most need to see.
 */
export function statusView(db, { cwd, all = false, nowMs = Date.now() } = {}) {
  const rows = listJobs(db).map((row) => viewOf(row, nowMs));
  // Computed on both paths, so `--all` can mark the blocker too and the renderer
  // never meets a result whose shape depends on which branch produced it.
  const blockingSeq = blockingSeqFor(rows, cwd);
  if (all) return { shown: rows, elsewhere: 0, blockingSeq };
  // A third disjunct rather than an append: a blocker that already satisfies one
  // of the first two would otherwise be listed twice.
  const shown = rows.filter(
    (row) => row.workspace === cwd || row.state === 'running' || row.seq === blockingSeq,
  );
  return { shown, elsewhere: rows.length - shown.length, blockingSeq };
}
