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
import { DatabaseSync } from 'node:sqlite';
import { UserError } from './errors.mjs';

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

export function logPathFor(seq) {
  return join(statePath(), 'logs', `${seq}.log`);
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
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  mkdirSync(join(statePath(), 'logs'), { recursive: true, mode: 0o700 });

  const db = new DatabaseSync(path);
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
  const path = databasePath();
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 10000');
  return { db, version: db.prepare('PRAGMA user_version').get().user_version };
}
