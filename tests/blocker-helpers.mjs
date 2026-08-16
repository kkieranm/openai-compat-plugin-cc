// Fixtures shared by the two blocker suites.
//
// Extracted when `status-blocker.test.js` outgrew the 300-line budget: the file
// had become two questions wearing one name — WHICH row the display names, and
// WHAT it says about it. They are split rather than allowlisted, so neither
// suite has to be read whole to change the other.
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statusView } from '../scripts/lib/job-view.mjs';
import { insertSynthetic, withStore } from './job-helpers.mjs';

export const HERE = '/tmp/oai-ws-here';
export const THERE = '/tmp/oai-ws-there';
// A third path that is not a substring of either other workspace, so a
// `doesNotMatch` on it cannot pass merely because the string never appears.
export const ELSEWHERE = '/tmp/oai-ws-third-party';
export const TEN_MINUTES = 600_000;

// Resolved, because a child's `process.cwd()` is: on macOS the temp directory is
// reached through a symlink, so the workspace a row records is the real path and
// never the one handed to `spawn`.
export const realWorkspace = (tag) => realpathSync(mkdtempSync(join(tmpdir(), `oai-ws-${tag}-`)));

/**
 * The two stamps `livenessOf` reads, corrupted.
 *
 * Raw SQL because `insertSynthetic` builds every timestamp through `ago()`,
 * which always yields a parseable ISO string — so the TIMESTAMP shape that
 * reaches `malformed` through the *queued* branch cannot be inserted by the
 * helper at all. Both columns, since `livenessOf` reads `spawned_at ?? created_at`.
 *
 * **It is no longer the only queued malformed shape.** Since OAI-162 a queued row
 * holding an unreadable `waiter_pid` is malformed too, and that one IS reachable
 * through `insertSynthetic` — `waiterPid: 'garbage'` binds straight through a
 * prepared statement into a non-`STRICT` column. The two are not
 * interchangeable fixtures: this one can still have a worker attach to it, and
 * that one never can.
 */
export function breakStamps(state, id) {
  withStore(state, (db) =>
    db.prepare("UPDATE jobs SET created_at = 'not-a-date', spawned_at = 'not-a-date' WHERE id = ?").run(id));
}

/** A live queued row somebody else owns, at the head of the queue. */
export const theirHead = (state, extra = {}) =>
  insertSynthetic(state, { id: 'theirs', workspace: THERE, waiterPid: process.pid, ...extra });

/** This workspace's job, behind whatever went in before it. */
export const myJob = (state, extra = {}) =>
  insertSynthetic(state, { id: 'mine', workspace: HERE, waiterPid: process.pid, ...extra });

/** A bare `/oai:status` read from `HERE`, with the open database beside it. */
export const viewHere = (state, fn) => withStore(state, (db) => fn(statusView(db, { cwd: HERE }), db));
