// Where background jobs live, and the only place this repo opens a database.
//
// SQLite rather than files, and the reason is recorded rather than assumed:
// fourteen review rounds went into building atomic publication, a never-reused
// queue position, and terminal immutability out of `wx` files and renames, and
// every round's fix produced the next round's defect. A transaction, an
// `AUTOINCREMENT` and a guarded `UPDATE` answer all three, and the OS releases
// the locks when a process dies — which is the one primitive node core does not
// otherwise offer. See ADR 014.
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { UserError } from './errors.mjs';

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
 * would be admitted at any version at all. See ADR 018.
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
 * an absence of jobs (the `findings: null` versus `[]` confusion ADR 003 exists
 * to prevent, one subsystem over) — and `submitTask` before it probes the server.
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

/** The payload version stamped on rows this build writes. */
export const ROW_SCHEMA_VERSION = 1;

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
  const Database = requireDatabaseSync();
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  mkdirSync(join(statePath(), 'logs'), { recursive: true, mode: 0o700 });

  const db = new Database(path);
  // FIRST, before anything that takes a lock. Setting the journal mode is
  // itself a locking operation, and with no timeout in force yet a second
  // process opening the store at the same moment fails outright with "database
  // is locked" — which is how two concurrent submissions killed each other
  // before either had a job. Every statement after this line waits instead.
  db.exec('PRAGMA busy_timeout = 10000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applySchema(db);
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
  if (!existsSync(path)) return null;
  const db = new Database(path, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 10000');
  return { db, version: db.prepare('PRAGMA user_version').get().user_version };
}
