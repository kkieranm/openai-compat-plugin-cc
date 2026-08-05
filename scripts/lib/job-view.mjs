// What a reader sees, which is not what the table holds.
//
// Two things happen between the rows and the screen, and keeping them separate
// matters:
//
// 1. **Reconciliation writes.** Reading is when a dead worker is noticed, so
//    `/oai:status` is also the thing that collects one. That is deliberate —
//    there is no daemon here, and a job whose worker died would otherwise sit
//    `running` forever, blocking every successor.
// 2. **`stalled` and `overdue` are derived, never stored.** They are statements
//    about *now* — a live pid that has stopped beating, a run past its own cap —
//    and a column holding one would be a cached answer to a question whose
//    answer changes while nobody is looking.
import { STALE_BEAT_MS, livenessOf, relevantPid } from './job-liveness.mjs';
import { isTerminal, listJobs } from './job-record.mjs';
import { reconcile } from './job-reconcile.mjs';
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
 * **Not filtered by workspace, while the display is.** A dead worker's row
 * blocks the *global* queue, so skipping it because the reader happened to be
 * in a different checkout would leave a queue wedged by something no `/oai:status`
 * run in that directory could ever collect.
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

function beatIsStale(row, nowMs) {
  const last = Date.parse(row.last_beat_at ?? '');
  // No beat has ever been recorded, yet the pid is alive: that is a worker still
  // getting started, not a stalled one. Inventing a stall here would flag every
  // job during its first moments.
  if (!Number.isFinite(last)) return false;
  return nowMs - last > STALE_BEAT_MS;
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
 * The rows a bare `/oai:status` shows: this workspace's, plus whatever is
 * running anywhere.
 *
 * That second half is not a convenience. A job running in another checkout is
 * precisely what the jobs here are queued behind, and a malformed row holding
 * the head of the queue is the one thing a user most needs to see — hiding
 * either because it belongs to a different directory would leave a stuck queue
 * with no visible cause.
 */
export function statusView(db, { cwd, all = false, nowMs = Date.now() } = {}) {
  const rows = listJobs(db).map((row) => viewOf(row, nowMs));
  if (all) return { shown: rows, elsewhere: 0 };
  const shown = rows.filter((row) => row.workspace === cwd || row.state === 'running');
  return { shown, elsewhere: rows.length - shown.length };
}
