// Where background jobs live, and the only place this repo opens a database.
//
// SQLite rather than files, and the reason is recorded rather than assumed:
// fourteen review rounds went into building atomic publication, a never-reused
// queue position, and terminal immutability out of `wx` files and renames, and
// every round's fix produced the next round's defect. A transaction, an
// `AUTOINCREMENT` and a guarded `UPDATE` answer all three, and the OS releases
// the locks when a process dies — which is the one primitive node core does not
// otherwise offer.
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UserError } from './errors.mjs';
import { withBusyRetry } from './job-busy.mjs';

/**
 * `node:sqlite` is the one thing this plugin needs that a runtime it supports may
 * not have, and a *static* import of it fails at LINK time — before any command
 * dispatches, and so for every command, including the ones that never open a
 * database. Catching it here is what keeps `/oai:setup`, `/oai:review` and
 * foreground `/oai:task` working where background jobs cannot.
 *
 * Detected, never inferred from `process.version`, because the version does not
 * answer the question: the module landed in v22.5.0 but stayed behind
 * `--experimental-sqlite` until v22.13.0 (v23.4.0 on the 23.x line), so a version
 * comparison admits 22.5–22.12 where the import still throws — and a build
 * compiled without SQLite, or one merely started with `--no-experimental-sqlite`,
 * would be admitted at any version at all.
 *
 * The failure is CAPTURED here and classified at first use, never acted on at
 * module scope. Throwing here would take down every command that never opens a
 * database — which is precisely the defect this guard exists to remove, and
 * reintroducing it for a different cause is no better than leaving it.
 */
let DatabaseSync = null;
let importFailure = null;
try {
  const sqlite = await import('node:sqlite');
  // Asserted inside the `try`, not destructured out of it, so that "`DatabaseSync`
  // is falsy" ALWAYS implies "`importFailure` is set". Destructuring left a third
  // state — a module that resolved but exported nothing — in which the refusal
  // below did `throw null` and printed `Unexpected failure: null`. The invariant
  // now holds by construction rather than by a null check a later edit can drop.
  if (!sqlite.DatabaseSync) throw new Error('node:sqlite resolved without a DatabaseSync export');
  DatabaseSync = sqlite.DatabaseSync;
} catch (error) {
  importFailure = error;
}

/**
 * The database constructor, or a refusal the user can act on.
 *
 * Every opener goes through here, and each calls it *before* it touches the
 * filesystem or the network: `openStore` before it creates the state
 * directories, `openStoreForReading` before its existence check — because that
 * function returns `null` for "no database exists, nothing to report", and
 * rendering an unavailable runtime as `null` would report a missing capability as
 * an absence of jobs (the same `findings: null` versus `[]` confusion, one
 * subsystem over) — and `submitTask` before it probes the server.
 *
 * `ERR_UNKNOWN_BUILTIN_MODULE` is the ONLY shape that means "this runtime does
 * not offer it", and that is measured rather than assumed: the `node:` scheme
 * resolves against the builtin registry alone and never falls through to package
 * resolution, so an absent builtin, a flag-gated one and a build compiled without
 * it all raise that single code. An earlier draft of this guard also accepted
 * `ERR_MODULE_NOT_FOUND` whenever the message mentioned sqlite. Nothing can
 * produce it — and matching on message text is exactly what would relabel a
 * genuine loader fault as a stale Node, sending the user to fix the one thing
 * that is not wrong. Anything else is rethrown with its cause intact.
 */
export function requireDatabaseSync() {
  if (DatabaseSync) return DatabaseSync;
  if (importFailure?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw importFailure;
  throw new UserError(
    `Background jobs need the \`node:sqlite\` module, which this Node.js (${process.version}) does not provide.`,
    {
      hint: 'Node.js serves it unflagged from 22.13 (23.4 on the 23.x line). If this runtime is already newer, it was built without SQLite or started with --no-experimental-sqlite. /oai:setup, /oai:review and foreground /oai:task work either way.',
      reason: 'no-sqlite',
    },
  );
}

/**
 * The schema this build understands.
 *
 * Two different versions live in this file and conflating them is a defect:
 * `USER_VERSION` describes the *table shape* and is checked before anything is
 * written, while a row's own `schema_version` describes its *payload*. A newer
 * plugin can add a column — which an older build must refuse outright — or write
 * a row whose `request` shape it does not recognise, which an older build may
 * safely leave alone. One number cannot mean both.
 */
export const USER_VERSION = 1;

/**
 * The payload version stamped on rows this build writes.
 *
 * Bumped to 2: a `transport` may now carry `queryHash`/`querySalt`
 * instead of a raw `query`, and an `auth` blob may now carry
 * `apiKeyAuthorized`. No table change accompanies this — `USER_VERSION` stays
 * 1, because `transport`/`auth` are JSON blob columns and this is a payload
 * version, not a schema one. The justification is a better failure report,
 * not a new safety property: an older build refusing a v2 row already refused
 * it correctly under v1's own checks (`current.query !== ''` on the raw
 * compare, or the missing key on the query-only case) — this bump just makes
 * that refusal name the actual reason instead of reporting "no longer
 * supplies a credential".
 *
 * Bumped to 3: an `auth` blob whose key was authorized may now
 * carry `credentialSource` (`{kind:'env', name}` or `{kind:'inline'}`),
 * pinning which credential SOURCE `resolveCredential` may use — closing a gap
 * where a `providers.json` `apiKeyEnv` repoint, with the endpoint unchanged,
 * could send a different secret to a job's authorized endpoint. Same posture
 * as the 1→2 bump: no table change, no `USER_VERSION` change, no migration
 * code (none exists in this repo; old rows stay readable via
 * `isKnownVersion`'s `<=` and a read-time default scoped to the literal old
 * version numbers). Downgrade posture is narrow, not blanket: an older build
 * refuses to *abandon* a v3 row (`job-abandon.mjs`'s `isKnownVersion` gate),
 * to *reconcile* one (`job-reconcile.mjs`), and treats it as `blocks` rather
 * than `head` in the queue (`job-queue.mjs`) — those three are the only sites
 * where `isKnownVersion` gates a MUTATION or a QUEUE decision. It does
 * **not** refuse every mutation: that predicate does not gate
 * `registerWaiter`, `markSpawned` or `finish`. Two further sites read it for
 * DISPLAY, not enforcement — `job-render.mjs`'s foreign-version label and its
 * `/oai:abandon` remedy line — and a foreign-version row is separately never
 * pruned, via `job-retention.mjs`'s own `schema_version <= ?` clause rather
 * than this predicate.
 */
export const ROW_SCHEMA_VERSION = 3;

/**
 * Mirrors the shape of `configPath()` rather than sharing it: state is not
 * config, and a user who moves one has not asked to move the other. The env
 * override exists for the same reason `OAI_PLUGIN_CONFIG` does — it is how the
 * tests point at a temp directory without touching the real one.
 *
 * `CLAUDE_PLUGIN_DATA` is deliberately NOT consulted. It is set only when the
 * plugin harness runs the script, so a job submitted through `/oai:task` would
 * land somewhere a plain shell invocation could not see — the same state in two
 * places depending on how it was started.
 */
export function statePath() {
  if (process.env.OAI_PLUGIN_STATE) return process.env.OAI_PLUGIN_STATE;
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'oai-plugin');
}

export function databasePath() {
  return join(statePath(), 'jobs.db');
}

export function logsPath() {
  return join(statePath(), 'logs');
}

export function logPathFor(seq) {
  return join(logsPath(), `${seq}.log`);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    id             TEXT NOT NULL UNIQUE,
    kind           TEXT NOT NULL,
    state          TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    workspace      TEXT NOT NULL,
    transport      TEXT NOT NULL,
    auth           TEXT NOT NULL,
    model          TEXT,
    context_length INTEGER,
    request        TEXT NOT NULL,
    attachments    TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    spawned_at     TEXT,
    started_at     TEXT,
    completed_at   TEXT,
    max_wait_ms    INTEGER,
    last_beat_at   TEXT,
    cancel_requested_at TEXT,
    waiter_pid     INTEGER,
    worker_pid     INTEGER,
    outcome        TEXT,
    failure        TEXT
  );
`;

/**
 * A database written by a newer plugin is refused for everything that writes.
 *
 * Refusing is coherent; silently migrating is not, and neither is reading
 * columns that merely look familiar. A newer build may have added a NOT NULL
 * column or changed what a state means, and this one would corrupt it while
 * believing it was being helpful.
 */
export class DatabaseTooNewError extends UserError {
  constructor(found) {
    super(
      `This job database was written by a newer version of the plugin (schema ${found}, this build understands ${USER_VERSION}).`,
      { reason: 'database-too-new', hint: 'Update the plugin, or use the newer one for background jobs.' },
    );
    this.name = 'DatabaseTooNewError';
    this.found = found;
  }
}

function applySchema(db) {
  const found = db.prepare('PRAGMA user_version').get().user_version;
  if (found > USER_VERSION) throw new DatabaseTooNewError(found);
  db.exec(SCHEMA);
  if (found < USER_VERSION) db.exec(`PRAGMA user_version = ${USER_VERSION}`);
}

/**
 * How long ONE open attempt may sit inside SQLite waiting for a lock.
 *
 * Deliberately far below `OPEN_BUDGET_MS`, and that is what makes the budget a
 * real bound rather than a wish. Measured: with the handle's `busy_timeout` left
 * at the 10s the returned handle wants, a first-creation `CREATE TABLE` under a
 * held write lock blocks 10755ms — after which `withBusyRetry` finds five
 * seconds already spent and rethrows WITHOUT EVER RETRYING. At 250ms the same
 * statement fails in 330ms, so the retry loop governs and the budget means what
 * it says. (`PRAGMA journal_mode = WAL` consults no busy handler at any value,
 * which is why the retry loop, not this number, is what covers it.)
 */
const OPEN_ATTEMPT_TIMEOUT_MS = 250;

/** The wall-clock budget for opening, retries included. */
const OPEN_BUDGET_MS = 5_000;

/**
 * Open the store, creating it if this is the first background job ever run.
 *
 * WAL because readers must not block on the one writer — `/oai:status` is run
 * while a job is mid-flight by definition. `busy_timeout` because two processes
 * genuinely do contend here, and the alternative to waiting is an immediate
 * SQLITE_BUSY that a caller would have to treat as a job failure when it is
 * nothing of the sort.
 *
 * `0700` on the directory and `0600` on the file: these rows hold the prompt and
 * the full text of every attached file, which is the user's source code.
 */
export function openStore() {
  // Five seconds, not the helper's thirty. The race this covers is two processes
  // CREATING the database at the same moment, which the loser resolves in
  // milliseconds — and every command opens the store, so an over-generous budget
  // turns a rare race into a long unexplained pause on an ordinary `/oai:status`.
  // Failing fast after five seconds of genuine contention is the better report.
  return withBusyRetry(openOnce, { budgetMs: OPEN_BUDGET_MS });
}

/**
 * Refuse a symlink at exactly this path, rather than follow it.
 *
 * `mkdirSync(..., {recursive: true})` treats a path that RESOLVES to a
 * directory as already satisfied — it never checks whether the path itself is
 * a symlink — and `chmodSync` sets the mode of whatever the link resolves to,
 * not the link. So a symlink planted at the state directory or `logs/` ahead
 * of a first run would have both calls silently "succeed" against a directory
 * an attacker controls, while every guarantee this file makes (0700/0600,
 * repaired on every open) gets applied to THEIR directory, not a check on
 * whether this process should be writing there at all. `lstatSync` is the one
 * call that inspects the link itself rather than its target.
 *
 * **Residual race, narrowed rather than eliminated.** Called again immediately
 * before each `chmodSync` below (see `repairDir`), not just once up front, and
 * `openOnce` re-checks `state` itself again before `repairDir(logs)` and again
 * before the database is opened — `logsPath()`/`databasePath()` are both
 * subpaths of `state`, so a symlink swap of `state` alone (its own contents
 * never touched) would otherwise make `refuseSymlink(logs)` inspect an
 * entirely attacker-owned tree without ever seeing a symlink itself. What's
 * left is a per-operation check-to-use gap: an attacker with write access to
 * `state`'s PARENT can still win a race between one of these checks and the
 * syscall right after it. This does not need precise kernel-level timing to
 * exploit — an attacker need not win any single attempt, only retry across
 * repeated invocations of this plugin until one lands inside a window, which
 * is why a world-writable parent (e.g. `OAI_PLUGIN_STATE` pointed at `/tmp`)
 * is a realistic condition, not a theoretical one. Closing it fully needs
 * file-descriptor-based directory operations (`O_DIRECTORY|O_NOFOLLOW` plus
 * `fchmodSync`, and `mkdirat`/`openat`/`fchmodat` equivalents Node's
 * synchronous `fs` API does not expose), not attempted here. Accepted on the
 * same terms as this repo's other documented narrow local races.
 *
 * Exported for testing only — `openOnce` and `openStoreForReading` are the
 * real callers. A non-ENOENT
 * lstat failure (EACCES, ENOTDIR: not "missing" but genuinely unreadable or
 * blocked) can't be witnessed through `openStore()` itself: the same
 * underlying condition also blocks the `mkdirSync` that follows just as
 * surely, so an end-to-end test can't tell "this function rethrew" from "this
 * function swallowed it and the next call failed anyway" — this needs to be
 * called directly. (ENOENT is the one case that does NOT transfer this way:
 * `mkdirSync(..., {recursive: true})` creates a missing ancestor rather than
 * failing on it, so a missing path is not a stand-in for a blocked one.)
 */
export function refuseSymlink(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    // Only ENOENT means "not there yet, nothing to refuse" — anything else
    // (EACCES, EIO, ENOTDIR: a parent segment is itself not a directory) is a
    // real problem this guard exists to surface, not swallow. Silently
    // treating every failure as absence would let exactly the kind of fault
    // this function is for pass through unexamined.
    if (error.code !== 'ENOENT') throw error;
    return;
  }
  if (stat.isSymbolicLink()) {
    throw new UserError(
      `${path} is a symlink, and this plugin will not follow it for its state directory.`,
      { hint: 'Remove the symlink, or point OAI_PLUGIN_STATE somewhere else, then retry.' },
    );
  }
}

/**
 * Create (if needed) and unconditionally repair one directory's mode, with
 * the symlink guard immediately adjacent to both operations that trust the
 * path — not a single check shared across a longer sequence. See
 * `refuseSymlink`'s docblock for what this narrows and what it still accepts.
 */
function repairDir(dir) {
  refuseSymlink(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  refuseSymlink(dir);
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best effort, same reasoning as the database's chmod below: a
    // filesystem that does not carry Unix modes is not a reason to refuse
    // to run.
  }
}

function openOnce() {
  const Database = requireDatabaseSync();
  const path = databasePath();
  const state = statePath();
  const logs = logsPath();
  // `mkdirSync`'s `mode` is a no-op on a directory that already exists (Node's
  // own documented behaviour), so a pre-existing state dir or `logs/` looser
  // than `0700` — from an older build, or widened by anything else — stayed
  // that way on every subsequent run before this fix. Repaired unconditionally
  // by `repairDir`, the same way `jobs.db` itself is repaired below: the
  // WAL/SHM sidecars SQLite creates under WAL mode live directly in this
  // directory and hold the same prompt/source data `jobs.db` does, so a loose
  // directory defeats the file-level chmod regardless of it. A state dir at
  // `0755` with `logs/` at `0777` let another local principal plant a forged
  // `<seq>.cancel-ack` without ever touching `jobs.db`.
  repairDir(state);
  // `logs` and `path` are both subpaths of `state` — string joins computed
  // once above, not filesystem lookups — so what they resolve to depends on
  // what `state` points at when each is actually used, not on when the
  // string was built. The repair call just above confirmed `state` itself a
  // moment ago, but confirms nothing about what it still points at NOW.
  // Re-checked immediately before each subsequent use, not assumed to still
  // hold: see the symlink guard's own docblock for what this narrows and
  // what it still accepts.
  refuseSymlink(state);
  repairDir(logs);

  refuseSymlink(state);
  const db = new Database(path);
  try {
    // FIRST, before anything that takes a lock — but SHORT, because this whole
    // function is one attempt inside `openStore`'s retry loop.
    //
    // It does NOT make waiting universal, and the comment that used to stand
    // here said it did. Converting the journal takes an exclusive lock, and the
    // busy handler is not consulted for it AT ALL — measured: under a held write
    // lock the pragma fails in 0ms at a 10s timeout and at a 250ms one alike.
    // This line threw "database is locked" three times in the wild, at exactly
    // the statement whose safety it was asserting.
    //
    // So the WAL set is now CONDITIONAL. The journal mode persists in the file,
    // which means it is needed on the first open of a database and on no other
    // — and reading the current mode is an ordinary read that takes no
    // exclusive lock. The common path therefore stops taking the lock rather
    // than waiting on it, and `openStore`'s retry covers the one case left: two
    // processes genuinely creating the database at the same moment.
    db.exec(`PRAGMA busy_timeout = ${OPEN_ATTEMPT_TIMEOUT_MS}`);
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'wal') {
      db.exec('PRAGMA journal_mode = WAL');
    }
    db.exec('PRAGMA foreign_keys = ON');
    applySchema(db);
    // Raised only once the open has succeeded. Everything above is retried by
    // `openStore`, so a short wait there costs nothing and keeps the budget
    // honest; everything BELOW this line is a caller's own statement, which has
    // no retry loop around it and wants the long wait.
    db.exec('PRAGMA busy_timeout = 10000');
  } catch (error) {
    // Close before the error escapes, or a retried open leaks a handle per
    // attempt. Guarded so that a throw from `close()` cannot REPLACE the busy
    // error `withBusyRetry` is waiting to recognise — a cleanup failure masking
    // the cause would silently defeat the retry this exists to enable.
    try {
      db.close();
    } catch {
      // The original error is the one that matters.
    }
    throw error;
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort: on a filesystem that does not carry modes this is not a
    // reason to refuse to run, and the directory above is already restricted.
  }
  return db;
}

/**
 * A handle that cannot write, for the one case where reading is still allowed
 * and writing is not: a database a newer plugin wrote.
 *
 * `readOnly: true` rather than a promise not to write. The rule — no migration,
 * no reconciliation, no retention against a database this build does not
 * understand — is then enforced by SQLite rather than by every future caller
 * remembering it; an ordinary handle plus discipline is what lets the next edit
 * quietly reintroduce the write. Verified: a write through this handle fails
 * with "attempt to write a readonly database", and it reads across a live WAL.
 *
 * Returns `null` when no database exists at all, because a machine that has
 * never run a background job has nothing to report and should not have state
 * created for it by a command that only meant to look.
 */
export function openStoreForReading() {
  const Database = requireDatabaseSync();
  const path = databasePath();
  // `job-view.mjs`'s `openJobs()` calls this FIRST, unconditionally, on every
  // `/oai:status` — the most frequently run command this plugin has — before
  // the hardened `openOnce()` (with its own `refuseSymlink` checks) ever runs.
  // Without this, a symlink planted at `statePath()` would be followed here
  // silently: the same attack `openOnce()` exists to refuse, on a path hit far
  // more often. Checked BEFORE `existsSync`, not after: `existsSync` itself
  // follows the symlink, and an attacker directory with no `jobs.db` inside it
  // would otherwise make this function return `null` — quietly, no throw —
  // without the guard ever running at all. Guards `state`, not `path` (the
  // database file itself) — that narrower gap is a separate, pre-existing
  // condition this fix does not fold in.
  // `existsSync` is itself a syscall a state-directory swap can land inside,
  // exactly like the gap `repairDir`'s own two checks (before `mkdirSync` and
  // again before `chmodSync`) exist to narrow — so this re-checks the same
  // way, immediately before the database open, rather than trusting the one
  // check above across `existsSync` too.
  refuseSymlink(statePath());
  if (!existsSync(path)) return null;
  refuseSymlink(statePath());
  const db = new Database(path, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 10000');
  return { db, version: db.prepare('PRAGMA user_version').get().user_version };
}
