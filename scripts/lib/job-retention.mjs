// Keeping the record from growing without bound, which on this substrate is a
// `DELETE` and nothing else — the filesystem design needed tombstones, a
// high-water marker and a reclamation protocol to say the same thing.
//
// Three CLASSES of row are never touched, and the exemptions are not symmetrical:
//
// 1. **An active job is exempt however old it is.** Age is not evidence about a
//    job; a run that has been going for a day is still going.
// 2. **A row a newer plugin wrote is exempt, and is not counted either.** Never
//    deleted, because an older build erasing a newer one's completed job is data
//    loss dressed up as housekeeping. Never *counted* toward the ceiling either,
//    or a machine that had run a newer plugin would silently evict this build's
//    own history to make room for rows it cannot even read.
// 3. **A row an operator abandoned AFTER it started running is exempt, and is
//    not counted either.** `/oai:abandon` created the one thing this module was
//    built to assume away: a TERMINAL row whose worker may still be alive. That
//    worker's `finish()` misses its compare-and-set and writes the answer to its
//    job log as `SALVAGED_OUTCOME` instead — and `job-spawn.mjs` gave it that log
//    as its stdout descriptor, so pruning the row unlinks the file underneath a
//    live writer and the answer dies with the process.
//
//    **It reads no pid, deliberately.** Keying on whether the worker is still
//    alive would be cheaper and is wrong twice over: the exemption would end when
//    the process exits, which is exactly when the log stops being rewritable and
//    starts being the only copy; and a malformed pid reads as dead, which would
//    let the row prune anyway.
//
//    **Narrowed to `started_at`** because `claimJob` sets it atomically with
//    `running`, before the worker can reach the server — so a row abandoned while
//    still queued provably sent nothing and has no paid-for answer to protect.
//    The narrowing is pinned: `tests/retention.test.js` prunes a row abandoned
//    before it ever ran, against a ran-and-abandoned control that stays.
//
//    **Its growth is unbounded and that is accepted, not overlooked.** Nothing
//    clears an exempt row, so the kept set grows with every forced abandonment —
//    a rare, deliberate operator action on a one-job-at-a-time queue. A window or
//    a second cap would restore the loss further away rather than remove it.
import { readdirSync, unlinkSync } from 'node:fs';
import { cancelAckPathFor } from './cancel-ack.mjs';
import { OPERATOR_ABANDONED, TERMINAL_STATES } from './job-record.mjs';
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
 *
 * **Every exemption belongs in the inner `SELECT`, never the outer `DELETE`, and
 * that placement is what makes an exempt row UNCOUNTED as well as undeleted.**
 * Excluded here, it never enters the ordering, so it cannot consume one of the
 * kept places and evict an innocent row behind it. Moved to the `DELETE`, the
 * same clause would spare the row and still spend its slot — the abandonment
 * exemption would then quietly shorten this build's own history.
 *
 * Two things about the abandonment clause are load-bearing and neither is
 * obvious from reading it:
 *
 * - **`IS`, not `=`.** `json_extract` yields NULL for a row with no failure, and
 *   `NULL = 'operator-abandoned'` is NULL, not false — `NOT (1 AND NULL)` is NULL,
 *   a WHERE clause drops it, and every genuinely-run completed row would fall out
 *   of the candidate set and never be pruned again. `IS` is SQLite's null-safe
 *   comparison and answers false there.
 * - **The `CASE WHEN json_valid`.** `json_extract` THROWS on an unparseable
 *   payload, and `sweep()` runs in `task-submit.mjs` before anything is inserted
 *   or spawned — so one corrupt `failure` on this machine would sink every
 *   submission, not merely misfile a row. The guard turns it into a NULL.
 *
 * On this build both are reachable only when `started_at IS NOT NULL` — measured
 * against a control **not in the suite beside this file**: the same unguarded
 * query threw on a malformed payload whose row had a
 * `started_at` and did not on one without. The tests carry only the
 * `started_at`-present half, so do not go looking for that pair. **That is the
 * planner's evaluation order, not a guarantee SQLite documents**, so the `CASE` is
 * not conditional on it: if the order ever changed, the guard is what keeps a
 * corrupt payload from throwing here, and only the reachability note goes stale.
 *
 * Both are pinned by `tests/retention.test.js`, as is each exemption's placement.
 * Which fixture pins what is written there and not restated here.
 */
const PRUNE = `
  DELETE FROM jobs WHERE seq IN (
    SELECT seq FROM jobs
      WHERE state IN (${STATES}) AND schema_version <= ?
        AND NOT (started_at IS NOT NULL
                 AND (CASE WHEN json_valid(failure) THEN json_extract(failure, '$.reason') END) IS ?)
      ORDER BY seq DESC
      LIMIT -1 OFFSET ?
  )
  RETURNING seq
`;

function prune(db, retain) {
  return db
    .prepare(PRUNE)
    .all(...TERMINAL_STATES, ROW_SCHEMA_VERSION, OPERATOR_ABANDONED, retain)
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
 * only after its row exists. Read the rows first and a job submitted in the gap
 * looks like an orphan, and the sweep would unlink the log of a worker that is
 * still writing to it.
 *
 * **That precondition is not unconditional, and saying so is the point.** `seq` is
 * `AUTOINCREMENT` per database, so deleting `jobs.db` while `logs/` survives
 * restarts it: a sweep that listed a stale `2.cancel-ack` and read rows holding no
 * seq 2 can be overtaken by a submission that inserts seq 2 and opens its log, and
 * the unlink below then takes a LIVE job's files. The race predates this key — a
 * surviving `<seq>.log` could always start it — and the union widens which residues
 * can. Closing it needs the key bound to a store incarnation, which is a schema
 * change this feature does not make.
 *
 * **Names are matched, and a name is not a provenance.** The check says the file
 * is SHAPED like one this plugin writes and has no row to explain it; it cannot
 * say who wrote it. A user-created `77.cancel-ack` with no row 77 matches and is
 * deleted. Saying "a file this plugin did not write is not this plugin's to
 * delete" would describe a check that does not exist — what is true is that
 * anything NOT of that shape is left alone.
 *
 * **The key is the UNION of both names this plugin writes, not `<seq>.log`
 * alone.** Deletion below tolerates every failure, so a job whose log
 * unlinked while its acknowledgement did not would never be enumerated again if
 * the scan keyed on logs — leaking permanently in the one directory whose
 * survival past a database recreation is what `cancel-ack.mjs` names as its
 * accepted residual.
 *
 * **`readdirSync` is not caught here.** A `logs/` that cannot be
 * listed is not an empty one, and `sweepQuietly` is the one place this repo
 * decided what to do about a broken sweep: rethrow, unless the fault is
 * contention. That decision would be defeated by tolerating the fault a step
 * earlier.
 */
function orphanSeqs(db) {
  const names = readdirSync(logsPath());
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
    // None is a problem.
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
