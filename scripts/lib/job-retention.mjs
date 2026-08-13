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
import { cancelAckPathFor } from './cancel-ack.mjs';
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

const OWNED_NAME = /^([1-9]\d*)\.(?:log|cancel-ack)$/;

/**
 * The sequence a listed name denotes, or `null` if the unlink could not address
 * it again.
 *
 * **It accepts exactly the names whose sequence THIS PROCESS CAN ADDRESS**, which
 * is narrower than "a well-formed name" and is the only property the unlink below
 * actually needs. Three ways a name can fail it, all measured:
 * `0002.cancel-ack` parses to `2`, so the unlink addresses a different file and
 * leaves the listed one behind; `9007199254740993.log` parses to `…992` the same
 * way; and `1000000000000000000000.cancel-ack` becomes `1e+21`, which does not
 * merely leak — it sends the unlink at an unrelated `1e+21.log` and DELETES IT.
 * The regex closes the first; the test below closes the rest.
 *
 * **`Number.isSafeInteger` is the whole test.** A round trip
 * (`String(seq) === capture`) was written beside it and then removed, on this
 * measured relation — an IMPLICATION, not an equivalence, and the direction
 * matters:
 *
 *   within `[1-9]\d*`, `isSafeInteger(n)` **implies** `String(n) === capture`;
 *   the converse is FALSE — `9007199254740992` and `9223372036854776000` both
 *   print back identically and neither is safe.
 *
 * So as a CONJUNCT the round trip could never decide anything: wherever the safe
 * test passes it passes too, and the conjunction is just the safe test. A term
 * that cannot change an answer is a check that cannot fail, which is the one thing
 * this repo will not ship, so only the deciding term is kept.
 *
 * That asymmetry is also why the round trip could not have been kept INSTEAD:
 * `9223372036854776000.log` survives it and is `2^63`, past SQLite's maximum
 * sequence, so no row could ever own it and the unlink would take an unrelated
 * file.
 *
 * **This is a stated NARROWING, not a complete characterisation.** The accepted
 * range stops at `2^53` while a legal `AUTOINCREMENT` sequence runs to `2^63 - 1`,
 * so a name in between is refused rather than swept. Reaching one needs about nine
 * quadrillion insertions or a hand-edited `sqlite_sequence`, and refusing to delete
 * is the safe side of that trade.
 */
function ownedSeq(name) {
  const match = OWNED_NAME.exec(name);
  if (match === null) return null;
  const seq = Number(match[1]);
  return Number.isSafeInteger(seq) ? seq : null;
}

/**
 * Files with no row left to explain them.
 *
 * **The directory is listed BEFORE the rows are read, and that order is the
 * whole safety argument — WHILE SEQUENCES CANNOT BE REUSED.** A log is created
 * only after its row exists, so anything in this listing already had a row when
 * the listing was taken, and a row set read *afterwards* is guaranteed to contain
 * it. Read the rows first and a job submitted in the gap looks like an orphan, and
 * the sweep would unlink the log of a worker that is still writing to it.
 *
 * **That precondition is not unconditional, and saying so is the point.** `seq` is
 * `AUTOINCREMENT` per database, so deleting `jobs.db` while `logs/` survives
 * restarts it: a sweep that listed a stale `2.cancel-ack` and read rows holding no
 * seq 2 can be overtaken by a submission that inserts seq 2 and opens its log, and
 * the unlink below then takes a LIVE job's files. The race predates this key — a
 * surviving `<seq>.log` could always start it — and the union widens which residues
 * can. Closing it needs the key bound to a store incarnation, which is a schema
 * change this feature's grill declined: **OAI-149**.
 *
 * **Names are matched, and a name is not a provenance.** The check says the file
 * is SHAPED like one this plugin writes and has no row to explain it; it cannot
 * say who wrote it. A user-created `77.cancel-ack` with no row 77 matches and is
 * deleted. Saying "a file this plugin did not write is not this plugin's to
 * delete" would describe a check that does not exist — what is true is that
 * anything NOT of that shape is left alone.
 *
 * **The key is the UNION of both names this plugin writes, not `<seq>.log`
 * alone (OAI-66).** Deletion below tolerates every failure, so a job whose log
 * unlinked while its acknowledgement did not would never be enumerated again if
 * the scan keyed on logs — leaking permanently in the one directory whose
 * survival past a database recreation is what `cancel-ack.mjs` names as its
 * accepted residual.
 */
function orphanSeqs(db) {
  let names;
  try {
    names = readdirSync(logsPath());
  } catch {
    // No logs directory: nothing has ever been spawned here, which is an answer
    // rather than a failure.
    return [];
  }
  const known = new Set(db.prepare('SELECT seq FROM jobs').all().map((row) => Number(row.seq)));
  const found = new Set(names.map(ownedSeq).filter((seq) => seq !== null));
  return [...found].filter((seq) => !known.has(seq));
}

function unlinkQuietly(path) {
  try {
    unlinkSync(path);
    return true;
  } catch {
    // Already gone, or never written: a job abandoned before its worker was
    // spawned has no log at all, one that was never cancelled has no
    // acknowledgement, and a concurrent sweep may have reached this one first.
    // None is a problem — the file is absent either way.
    return false;
  }
}

/**
 * Both files a job owns. Reported as removed if EITHER went, because the count
 * says what the sweep collected and a job may legitimately have only one.
 */
function removeFiles(seq) {
  const log = unlinkQuietly(logPathFor(seq));
  const ack = unlinkQuietly(cancelAckPathFor(seq));
  return log || ack;
}

/**
 * Delete the excess, then delete the files nothing owns any more.
 *
 * **The row goes first and its log second, because the two cannot be one
 * transaction and only one of the two orders is recoverable.** A crash in
 * between leaves a log whose row is gone — which is exactly what the orphan
 * sweep collects. The other order leaves a live row pointing at a log that no
 * longer exists, and nothing in this repo would ever notice.
 *
 * That is also why the pruned rows' files are not unlinked by name here: once
 * their rows are deleted they *are* orphans, so the same sweep collects them.
 * The crash-recovery path therefore runs on every submission rather than only
 * after a crash, which is what keeps it from rotting unexercised.
 */
export function sweep(db, { retain = RETAIN } = {}) {
  const deleted = prune(db, retain);
  const logs = orphanSeqs(db).filter((seq) => removeFiles(seq));
  return { deleted, logs };
}
