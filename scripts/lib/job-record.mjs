// Rows in, rows out. The shape of a job and the queries that move it between
// states — everything that knows what a column *means*.
//
// The split from `job-store.mjs` is real: that file owns opening the database and
// the two version numbers, this one owns the lifecycle.
import { ROW_SCHEMA_VERSION } from './job-store.mjs';

/**
 * The states a job can be in, and which of them are over.
 *
 * There is no `launching`. An earlier design had one and it broke mutual
 * exclusion: eligibility excluded only `running`, so a successor saw no running
 * job while its predecessor sat between `queued` and `running` and both started.
 * `queued → running` is a single atomic UPDATE, so no third state is needed and
 * adding one reopens that hole.
 */
export const TERMINAL_STATES = ['completed', 'failed', 'cancelled', 'queue-timeout'];

export function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

/**
 * The columns that hold JSON. Parsed on the way out and stringified on the way
 * in, in one place, so no caller has to remember which is which.
 */
const JSON_COLUMNS = ['transport', 'auth', 'request', 'attachments', 'outcome', 'failure'];

function decode(row) {
  if (!row) return null;
  const out = { ...row };
  for (const column of JSON_COLUMNS) {
    if (out[column] === null || out[column] === undefined) continue;
    try {
      out[column] = JSON.parse(out[column]);
    } catch {
      // A payload this build cannot parse is reported as unreadable rather than
      // guessed at. The lifecycle columns beside it are still trustworthy, which
      // is the whole point of keeping the envelope separate from the payload.
      out[column] = null;
      out.unreadable = [...(out.unreadable ?? []), column];
    }
  }
  return out;
}

/**
 * Whether this build understands a row's payload.
 *
 * A row from a newer plugin is never reinterpreted and never destroyed: an older
 * `/oai:status` erasing a newer version's completed job would be data loss, and
 * "I cannot read this" is not a licence to delete it.
 */
export function isKnownVersion(row) {
  return row?.schema_version !== undefined && row.schema_version <= ROW_SCHEMA_VERSION;
}

const INSERT = `
  INSERT INTO jobs (
    id, kind, state, schema_version, workspace, transport, auth, model, context_length,
    request, attachments, created_at, spawned_at, max_wait_ms
  ) VALUES (
    ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?
  )
`;

/**
 * Publish a job. One statement, so the row is complete or absent — there is no
 * moment at which a reader can see a half-written job, which is what the
 * filesystem design needed a temp file and a hard link to achieve.
 *
 * The sequence comes from `AUTOINCREMENT`, which does not reuse a value even
 * after the row is deleted. That is what makes queue position monotonic without
 * tombstones or a high-water marker.
 */
export function insertJob(db, job) {
  const info = db.prepare(INSERT).run(
    job.id,
    job.kind,
    ROW_SCHEMA_VERSION,
    job.workspace,
    JSON.stringify(job.transport),
    JSON.stringify(job.auth),
    job.model ?? null,
    job.contextLength ?? null,
    JSON.stringify(job.request),
    JSON.stringify(job.attachments ?? []),
    job.createdAt,
    job.maxWaitMs ?? null,
  );
  return Number(info.lastInsertRowid);
}

export function jobBySeq(db, seq) {
  return decode(db.prepare('SELECT * FROM jobs WHERE seq = ?').get(seq));
}

export function jobById(db, id) {
  return decode(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
}

/**
 * Every job, newest first. Filtering by workspace is the caller's business
 * because only a *bare* `/oai:status` is scoped to one repo — a job addressed by
 * id resolves from anywhere, or an id handed between sessions would stop working
 * the moment the user changed directory.
 */
export function listJobs(db) {
  return db.prepare('SELECT * FROM jobs ORDER BY seq DESC').all().map(decode);
}

/**
 * Every row in one state, oldest first — the two `SELECT`s the eligibility
 * transaction runs. Ascending, because queue order *is* `seq` order.
 */
export function rowsInState(db, state) {
  return db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY seq').all(state).map(decode);
}

/** Records that the child exists, which bounds how long it may go unregistered. */
export function markSpawned(db, seq, at) {
  db.prepare('UPDATE jobs SET spawned_at = ? WHERE seq = ?').run(at, seq);
}

/**
 * "A worker exists and is waiting" — written on worker start, long before it is
 * eligible to run.
 *
 * This is NOT the same fact as `worker_pid`, and collapsing the two broke
 * queuing outright in an earlier draft: with a pid recorded only at the moment a
 * job started running, every legitimately waiting worker presented
 * `state='queued', worker_pid IS NULL` — exactly the signature of a job whose
 * worker never started — so anything queued behind a run longer than the startup
 * grace was failed as abandoned. It also left a queued job uncancellable, since
 * no pid existed whose death a reader could observe.
 */
export function registerWaiter(db, seq, pid, at) {
  const info = db
    .prepare("UPDATE jobs SET waiter_pid = ?, last_beat_at = ? WHERE seq = ? AND state = 'queued' AND waiter_pid IS NULL")
    .run(pid, at, seq);
  return info.changes === 1;
}

/**
 * Take ownership and start running, in one statement.
 *
 * `state`, `worker_pid`, `started_at` and the first beat move together on
 * purpose. An earlier design set the state first and the pid afterwards, which
 * left a window where a row was `running` with no pid — invisible to the next
 * worker's blocker count, and so a second concurrent model call. There is no
 * window here because there is no second statement.
 *
 * `AND waiter_pid = ?` is the other half: it says *this* worker, not merely some
 * worker. It is what makes a late arrival safe — against a row already
 * reconciled away the `UPDATE` matches nothing, and the loser exits without
 * contacting the server.
 */
export function claimJob(db, seq, pid, at) {
  const info = db
    .prepare(
      `UPDATE jobs SET state = 'running', worker_pid = ?, started_at = ?, last_beat_at = ?
        WHERE seq = ? AND state = 'queued' AND waiter_pid = ?`,
    )
    .run(pid, at, at, seq, pid);
  return info.changes === 1;
}

/**
 * "Still here" — cheap, and the only thing a queued worker writes while it
 * waits.
 *
 * Guarded on a non-terminal state so a beat that lands after the verdict cannot
 * touch a finished row. The beat only ever *corroborates* liveness; the pid is
 * what decides it, because a worker's last act before dying is to beat.
 */
export function beat(db, seq, at) {
  db.prepare("UPDATE jobs SET last_beat_at = ? WHERE seq = ? AND state IN ('queued','running')").run(at, seq);
}

/**
 * Ask a job to stop. Writes one column and terminalizes nothing.
 *
 * That restraint is the whole cancellation design. Writing `cancelled` here
 * would say a job had stopped while its model call was still in flight, and the
 * only way to make it true would be to signal a pid recorded minutes ago —
 * which may by then belong to something else entirely. So this records the
 * *request*, the worker acts on it, and a later reader observes the exit.
 *
 * Guarded on a non-terminal state, so a cancel racing a verdict loses and the
 * caller learns it from re-reading the row. `cancel_requested_at IS NULL` keeps
 * a repeat cancel from overwriting when it was first asked for.
 */
export function requestCancel(db, seq, at) {
  const info = db
    .prepare(
      `UPDATE jobs SET cancel_requested_at = ?
        WHERE seq = ? AND state IN ('queued','running') AND cancel_requested_at IS NULL`,
    )
    .run(at, seq);
  return info.changes === 1;
}

/**
 * Has anyone asked this job to stop? The one question a worker asks about
 * itself, and it asks the database rather than a signal handler.
 */
export function cancelRequested(db, seq) {
  return Boolean(db.prepare('SELECT cancel_requested_at FROM jobs WHERE seq = ?').get(seq)?.cancel_requested_at);
}

/**
 * Terminalize a job whose worker never registered, bounded by the startup grace.
 *
 * `AND waiter_pid IS NULL` is load-bearing and `finish` cannot supply it: without
 * it, a reconciler that decided "never started" a microsecond before the worker
 * finally registered would fail a job that is alive and about to run. With it
 * the two writes are mutually exclusive — whichever lands first makes the other
 * match nothing.
 *
 * The state is a parameter because a job the user asked to cancel ends as
 * `cancelled` even when nothing ever picked it up: it will not run, which is
 * what was asked for, and reporting `failed` for a granted request is a wrong
 * answer that looks like a right one.
 */
export function abandonUnstarted(db, seq, { state, failure = null, at }) {
  const info = db
    .prepare(
      `UPDATE jobs SET state = ?, failure = ?, completed_at = ?
        WHERE seq = ? AND state = 'queued' AND waiter_pid IS NULL`,
    )
    .run(state, failure ? JSON.stringify(failure) : null, at, seq);
  return info.changes === 1;
}

/**
 * The terminal write, guarded so it can happen exactly once.
 *
 * `WHERE state IN ('queued','running')` is what makes terminal immutability a
 * property of the database rather than a promise in a comment: a second writer
 * matches no rows, `changes` is 0, and it learns it lost instead of overwriting
 * a verdict someone else already published.
 */
export function finish(db, seq, { state, outcome = null, failure = null, at }) {
  const info = db
    .prepare(
      `UPDATE jobs SET state = ?, outcome = ?, failure = ?, completed_at = ?, worker_pid = NULL
        WHERE seq = ? AND state IN ('queued','running')`,
    )
    .run(state, outcome ? JSON.stringify(outcome) : null, failure ? JSON.stringify(failure) : null, at, seq);
  return info.changes === 1;
}
