// One background job runs at a time, and this is where that is decided.
//
// The eligibility check, the choice of who goes next and the transition to
// `running` are ONE transaction. Splitting them apart is what a dozen rounds of
// filesystem protocol could not recover from: any gap between "nothing is
// running" and "I am running" is a gap in which a second worker reads the same
// answer, and two concurrent model calls is the one thing this queue exists to
// prevent — the machine's memory ceiling has room for one loaded model, not two.
//
// The invariant is honestly "one *background* job at a time": foreground
// `/oai:task` and `/oai:review` do not participate. A backlog item covers that.
import { livenessOf } from './job-liveness.mjs';
import { beat, claimJob, finish, isKnownVersion, jobBySeq, rowsInState } from './job-record.mjs';
import { reconcile } from './job-reconcile.mjs';
import { isBusy, withBusyRetry } from './job-busy.mjs';
import { errorReport } from './review-report.mjs';

/** How often a waiting worker asks whether its turn has come. */
const POLL_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `BEGIN IMMEDIATE` rather than a plain `BEGIN`: the write lock is taken at the
 * start, so the rows this transaction *reads* cannot change under it before it
 * writes. A deferred transaction upgrading to a writer mid-way is exactly the
 * two-workers-both-saw-nothing-running case.
 */
function inImmediateTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Already rolled back by whatever failed; the state is what matters, not
      // who undid it.
    }
    throw error;
  }
}

/**
 * Whether a `queued` row ahead of us holds the line: `head` (it is the next to
 * run), `blocks` (something real is behind it but we cannot have it), or `skip`
 * (it will never run, so it must not hold the line either).
 *
 * Skipping is not abandoning. An unknown-version row is left exactly as it is
 * for the newer plugin that wrote it; the queue simply moves past it. Applying
 * this classification to `running` rows alone left the identical wedge one state
 * over — a dead unknown-version queued row sitting at the head forever.
 */
function queuedRole(row, liveness) {
  if (liveness === 'live') return isKnownVersion(row) ? 'head' : 'blocks';
  // No worker yet but still inside the startup grace, or a row this build
  // refuses to interpret: either way something may still come of it.
  if (liveness === 'starting' || liveness === 'malformed') return 'blocks';
  return 'skip';
}

/**
 * The head of the queue: the first row `queuedRole` does not skip.
 *
 * **The one definition of who is at the front**, exported because `/oai:status`
 * has to name that row and a second copy of this rule in the view would drift
 * the moment `queuedRole` gains a case. `rows` must be ASCENDING by `seq`, which
 * is queue order — `rowsInState` gives that and `listJobs` does not.
 *
 * **`onSkip` is a callback and not a returned list, and that is load-bearing —
 * for `decide`.** Its `livenessAt` is `livenessOf`, which asks the OS about a pid
 * at the moment it is called, so a skipped row must be reconciled BEFORE the next
 * row is probed, exactly as the loop this replaced did. (A read-only caller can
 * pass a liveness already resolved elsewhere, and `/oai:status` does exactly that
 * — for it the ordering is moot, and it passes a no-op `onSkip` besides.) Collecting the skips and reconciling them afterwards would move
 * every probe ahead of every reconcile, and a process dying during that window
 * would turn a `tryAcquire` that makes progress into one that returns `blocked`.
 * Rare, and in the safe direction, but it is a verdict change.
 *
 * Rows after the head are never examined — which is why a row that `blocks` can
 * sit behind the head and hold up nobody.
 */
export function scanQueued(rows, livenessAt, onSkip) {
  for (const row of rows) {
    const liveness = livenessAt(row);
    const role = queuedRole(row, liveness);
    if (role !== 'skip') return { head: row, role };
    onSkip(row, liveness);
  }
  return { head: null, role: null };
}

/**
 * The decision itself, run inside the transaction. Returns `acquired`,
 * `blocked`, `cancelled` or `gone`.
 */
function decide(db, seq, pid, nowMs, at) {
  const mine = jobBySeq(db, seq);
  if (!mine || mine.state !== 'queued') return 'gone';
  // Inside the transaction, and before the claim rather than beside it. Read
  // outside, a cancellation landing between the read and the CAS would leave the
  // job dispatched anyway, and a queued job's cancel then costs a whole model
  // call — the one thing it exists to avoid. Read here, the write lock means the
  // two orders are the only two: cancel first and it never runs, claim first and
  // the heartbeat catches it.
  if (mine.cancel_requested_at) return 'cancelled';

  // EVERY running row is a blocker unless it is provably dead. Qualifying this
  // with `AND worker_pid IS NOT NULL` would be a two-concurrent-calls bug, and a
  // NULL pid here is a malformed row that fails closed.
  for (const row of rowsInState(db, 'running')) {
    const liveness = livenessOf(row, nowMs);
    if (liveness !== 'dead') return 'blocked';
    reconcile(db, row, { nowMs, at, liveness });
  }

  const { head, role } = scanQueued(
    rowsInState(db, 'queued'),
    (row) => livenessOf(row, nowMs),
    (row, liveness) => reconcile(db, row, { nowMs, at, liveness }),
  );
  // Every queued row skipped, so there is no queue left to be at the head of.
  if (!head) return 'gone';
  if (role === 'blocks') return 'blocked';
  if (head.seq !== seq) return 'blocked';
  return claimJob(db, seq, pid, at) ? 'acquired' : 'blocked';
}

/** One attempt at the head of the queue. */
export function tryAcquire(db, seq, pid, { nowMs = Date.now(), at = new Date().toISOString() } = {}) {
  return inImmediateTransaction(db, () => decide(db, seq, pid, nowMs, at));
}

function attempt(db, seq, pid) {
  try {
    return tryAcquire(db, seq, pid);
  } catch (error) {
    if (isBusy(error)) return 'blocked';
    throw error;
  }
}

/**
 * Give up waiting, without ever having sent a chat completion.
 *
 * Scoped to the *expensive* request rather than to "no traffic": submission has
 * already probed `/v1/models`, in the foreground, before this job existed.
 */
function timeOut(db, job, at) {
  const failure = errorReport({
    reason: 'queue-timeout',
    message: `Job ${job.id} waited ${Math.round(job.max_wait_ms / 1000)}s for its turn and gave up.`,
    hint: 'Another background job was still running. Raise --max-wait, or run it again when the queue is clear.',
  });
  // The THIRD terminal write, and the one most likely to meet contention: this
  // path is reached only when another background job is still running, so a
  // competing worker is beating every BEAT_MS at the exact moment of this write.
  // Unwrapped, a busy here escaped `awaitTurn` — which `cmd-task-worker.mjs`
  // awaits OUTSIDE the try that guards `runJob` — killing the worker, losing the
  // diagnosed `queue-timeout` and its actionable hint, and leaving reconciliation
  // to report `worker-died` for a job that timed out for a reason it could name.
  return withBusyRetry(() => finish(db, job.seq, { state: 'queue-timeout', failure, at }));
}

/**
 * Wait for this job's turn. Returns `acquired`, `cancelled`, `queue-timeout`, or
 * `gone` — and only `acquired` means a model may be called.
 *
 * `cancelled` is a verdict about the *wait*, not about the job: the worker
 * returns and exits, leaving the row queued with a pid that is about to stop
 * existing, and a later reader is what writes the terminal state.
 *
 * The wait clock starts at submission, not at worker start: `--max-wait` answers
 * "how stale may this answer be", which is a question about when the user asked.
 */
export async function awaitTurn(db, job, pid, { pollMs = POLL_MS } = {}) {
  const deadline = job.max_wait_ms === null ? null : Date.parse(job.created_at) + job.max_wait_ms;
  const expired = () => deadline !== null && Date.now() >= deadline;

  // The first attempt is free: no waiting has happened yet, so an already-clear
  // queue is taken even by a job whose cap elapsed during submission.
  let verdict = attempt(db, job.seq, pid);
  while (verdict === 'blocked') {
    await sleep(pollMs);
    // Skipped rather than retried on a contended database: this loop IS the
    // retry, with its own deadline below, and an unguarded throw here escapes
    // `awaitTurn` and kills a worker that is merely waiting its turn — the same
    // defect the heartbeat carried one phase later in the lifecycle.
    try {
      beat(db, job.seq, new Date().toISOString());
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
    // Immediately before each subsequent attempt, and NOT after it. Checking
    // afterwards let a job that had waited well past its cap run anyway,
    // whenever the attempt itself was slow — a contended database can stall one
    // for the whole `busy_timeout`. The cap governs waiting, so it is read at
    // the last moment before the thing it authorises.
    if (expired()) return timeOut(db, job, new Date().toISOString()) ? 'queue-timeout' : 'gone';
    verdict = attempt(db, job.seq, pid);
  }
  return verdict;
}
