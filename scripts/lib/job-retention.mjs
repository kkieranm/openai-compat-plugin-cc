// Keeping the record from growing without bound, which on this substrate is a
// `DELETE` and nothing else — the filesystem design needed tombstones, a
// high-water marker and a reclamation protocol to say the same thing.
//
// Two rows are never touched, and the exemptions are not symmetrical:
//
// 1. **An active job is exempt however old it is.** Age is not evidence about a
//    job; a run that has been going for a day is still going.
// 2. **A row a newer plugin wrote is exempt, and is not counted either.** Never
//    deleted, because an older build erasing a newer one's completed job is data
//    loss dressed up as housekeeping. Never *counted* toward the ceiling either,
//    or a machine that had run a newer plugin would silently evict this build's
//    own history to make room for rows it cannot even read.
import { readdirSync, unlinkSync } from 'node:fs';
import { TERMINAL_STATES } from './job-record.mjs';
import { ROW_SCHEMA_VERSION, logPathFor, logsPath } from './job-store.mjs';

/** How many finished jobs are kept. Enough to look back over a day's work. */
export const RETAIN = 50;

const STATES = TERMINAL_STATES.map(() => '?').join(',');

/**
 * The choosing and the deleting are one statement, so nothing can happen
 * between them — a separate `SELECT` would name rows that a concurrent worker
 * could still be finishing into, and the `DELETE` would then act on a list that
 * was true a moment ago.
 *
 * `LIMIT -1 OFFSET ?` is SQLite's "all but the first N": order the deletable
 * rows newest first, skip the ones being kept, and delete the tail.
 */
const PRUNE = `
  DELETE FROM jobs WHERE seq IN (
    SELECT seq FROM jobs
      WHERE state IN (${STATES}) AND schema_version <= ?
      ORDER BY seq DESC
      LIMIT -1 OFFSET ?
  )
  RETURNING seq
`;

function prune(db, retain) {
  return db
    .prepare(PRUNE)
    .all(...TERMINAL_STATES, ROW_SCHEMA_VERSION, retain)
    .map((row) => Number(row.seq));
}

const LOG_NAME = /^(\d+)\.log$/;

/**
 * Log files with no row left to explain them.
 *
 * **The directory is listed BEFORE the rows are read, and that order is the
 * whole safety argument.** A log is created only after its row exists, so
 * anything in this listing already had a row when the listing was taken — and a
 * row set read *afterwards* is therefore guaranteed to contain it. Read the rows
 * first and a job submitted in the gap looks like an orphan, and the sweep would
 * unlink the log of a worker that is still writing to it.
 *
 * Names are matched rather than assumed: anything in this directory that is not
 * `<seq>.log` was not put there by this plugin and is not this plugin's to
 * delete.
 */
function orphanLogs(db) {
  let names;
  try {
    names = readdirSync(logsPath());
  } catch {
    // No logs directory: nothing has ever been spawned here, which is an answer
    // rather than a failure.
    return [];
  }
  const known = new Set(db.prepare('SELECT seq FROM jobs').all().map((row) => Number(row.seq)));
  return names
    .map((name) => LOG_NAME.exec(name))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]))
    .filter((seq) => !known.has(seq));
}

function removeLog(seq) {
  try {
    unlinkSync(logPathFor(seq));
    return true;
  } catch {
    // Already gone, or never written: a job abandoned before its worker was
    // spawned has no log at all, and a concurrent sweep may have reached this
    // one first. Neither is a problem — the file is absent either way.
    return false;
  }
}

/**
 * Delete the excess, then delete the logs nothing owns any more.
 *
 * **The row goes first and its log second, because the two cannot be one
 * transaction and only one of the two orders is recoverable.** A crash in
 * between leaves a log whose row is gone — which is exactly what the orphan
 * sweep collects. The other order leaves a live row pointing at a log that no
 * longer exists, and nothing in this repo would ever notice.
 *
 * That is also why the pruned rows' logs are not unlinked by name here: once
 * their rows are deleted they *are* orphans, so the same sweep collects them.
 * The crash-recovery path therefore runs on every submission rather than only
 * after a crash, which is what keeps it from rotting unexercised.
 */
export function sweep(db, { retain = RETAIN } = {}) {
  const deleted = prune(db, retain);
  const logs = orphanLogs(db).filter((seq) => removeLog(seq));
  return { deleted, logs };
}
