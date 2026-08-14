// Is the process a job row names still there?
//
// The only place in this repo that asks anything about another process, and it
// asks with signal 0 — a probe that delivers nothing. Cancel is cooperative for
// exactly this reason: a pid can be recycled between the moment it is recorded
// and the moment it is read, so a real signal could land on something that has
// nothing to do with this plugin. `tests/queue-guards.test.js` guards that no
// source file ever passes a signal other than 0.

/**
 * How long a job may sit with no worker registered before it is treated as one
 * whose worker never started.
 *
 * It bounds exactly one window — the row is committed and the child is spawned
 * in two steps, and a submitter that dies between them leaves a row nothing will
 * ever pick up. **A worker that HAS registered is never abandoned, however long
 * it waits**, which is what lets an indefinite `--max-wait` coexist with a
 * two-minute grace.
 */
export const STARTUP_GRACE_MS = 120_000;

/**
 * How long a live process may go without saying anything before a reader calls
 * it `stalled`.
 *
 * Twelve missed beats at `job-heartbeat.mjs`'s interval. Generous on purpose:
 * the beat is a timer, and a worker deep in a model call still fires it — even
 * during prefill, which produces no bytes for minutes but leaves the event loop
 * idle. A gap this wide therefore means the process is not running its loop at
 * all: suspended, or wedged.
 *
 * **`stalled` is never terminal and never a verdict about the job.** The pid
 * decides death; the beat only corroborates. Reading a stale beat as death would
 * deadlock cancellation, since a worker's last act before exiting is to beat.
 */
export const STALE_BEAT_MS = 60_000;

/**
 * Alive, as far as the OS will say.
 *
 * `EPERM` means the process exists and belongs to someone else, which is still
 * alive — reading it as dead would let one user's plugin terminalize another's
 * running job. Only `ESRCH` means gone.
 */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Whichever pid the row's state makes relevant: a queued job is held by its
 * waiter, a running one by its worker.
 *
 * Asking about the wrong one is how a queued worker's death became unobservable
 * in an earlier design — and an unobservable death is an uncancellable job.
 */
export function relevantPid(row) {
  if (row.state === 'queued') return row.waiter_pid ?? null;
  if (row.state === 'running') return row.worker_pid ?? null;
  return null;
}

/**
 * What the row's owner is doing: `live`, `dead`, `starting`, `never-started` or
 * `malformed`.
 *
 * `malformed` covers two shapes this build cannot produce and will not guess at:
 * a `running` row with no pid (state and pid are written in one statement here,
 * so it is legacy or corrupt), and a timestamp that will not parse. Both are
 * surfaced rather than reconciled — failing closed costs a stuck queue the user
 * is told about, where guessing costs someone's live run.
 *
 * **What they block is not the same, and saying "both block the queue" was
 * wrong.** Neither blocks a caller that never reaches the scans: `job-queue.mjs`
 * `decide` returns `cancelled` first. Of the callers that do reach them, the
 * RUNNING shape blocks every one — the running loop rejects any row that is not
 * provably dead, before queue order is consulted. The QUEUED shape blocks only
 * the callers behind it, and only while it is the first row `scanQueued` does
 * not skip: with an ordinary head at seq 1, this shape at seq 2 and a caller at
 * seq 3, the scan stops at seq 1 and never looks at seq 2 at all.
 */
export function livenessOf(row, nowMs) {
  const pid = relevantPid(row);
  if (pid !== null) return isAlive(pid) ? 'live' : 'dead';
  if (row.state === 'running') return 'malformed';

  // Queued, and no worker has ever registered. `spawned_at` when the child was
  // seen to exist, `created_at` when the submitter died before spawning at all.
  const since = Date.parse(row.spawned_at ?? row.created_at);
  if (!Number.isFinite(since)) return 'malformed';
  return nowMs - since < STARTUP_GRACE_MS ? 'starting' : 'never-started';
}
