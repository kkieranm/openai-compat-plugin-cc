// Whether a worker said its exit WAS the cancellation.
//
// Without this fact, a reader finding a dead worker with a cancellation pending
// cannot tell a cooperative exit from a crash — and this repo published both as a
// clean `cancelled`, discarding a real crash diagnosis and rendering no note at
// all. The worker now leaves a file saying so; its absence is what makes a death
// `cancel-unconfirmed` rather than a tidy cancellation.
//
// **A FILE BESIDE THE LOG, never a line in it.** `job-spawn.mjs` opens the job log
// once for both stdout and stderr, and `salvageOutcome` writes a model answer onto
// it, so bytes in that file may be content this plugin did not author. A verdict
// that SUPPRESSES a crash diagnosis must not rest on them. Nothing the model
// produces can create a file, which is the whole reason this is a path.
//
// That is narrower than "authenticated", and the narrowing is deliberate: another
// process running as this user could write here, and a reader cannot tell such a
// file from a worker's. The residual is accepted on the footing that anything able
// to write this directory can already write `jobs.db`. **That footing needs the
// whole permission chain, and "a state directory looser than 0700" is not it.**
// It fails exactly when an attacker can TRAVERSE the state directory, WRITE
// `logs/`, and NOT write `jobs.db` — state `0755`, logs `0777`, database `0600`.
// Neither end generalises: state `0755` with a plugin-created `logs/` at `0700` is
// safe, and state `0777` lets the attacker replace `logs/` and `jobs.db` alike, so
// the distinction disappears rather than worsening. `job-store.mjs` requests `0700`
// at creation only and never repairs an inherited directory, which is what makes
// the middle case reachable.
//
// **Nothing here throws.** The read runs inside the queue's `BEGIN IMMEDIATE`
// (`job-queue.mjs` `decide`), where a throw rolls back the transaction, escapes
// `tryAcquire` and `awaitTurn` — which `cmd-task-worker.mjs` awaits outside any
// try — and kills a worker that is merely waiting its turn. A failure of open, stat
// or read therefore reads as "no acknowledgement", which is the same answer as a
// worker that never wrote one. **A failed CLOSE is not in that set**: by then the
// bytes have been read and compared, so the answer already exists and the failure
// changes nothing about it — a match stays a match. Saying "every failure" would
// describe a discard that does not happen.
import { closeSync, constants, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { logsPath } from './job-store.mjs';

/**
 * Big enough for the two short lines written below, small enough that a file
 * planted here cannot make the reader do real work while it holds the write lock.
 */
const MAX_ACK_BYTES = 4096;

export function cancelAckPathFor(seq) {
  return join(logsPath(), `${seq}.cancel-ack`);
}

/**
 * Record that this worker is exiting because it was asked to.
 *
 * `O_EXCL` so an existing file is never overwritten. **That constrains the WRITER
 * and says nothing about the reader**: `cancelAckMatches` tests no provenance and
 * no freshness, so a file pre-created with a matching id IS authoritative and will
 * turn a later unconfirmed death into `cancelled`. Calling a pre-existing file
 * "suspicious" would describe a check that does not exist — the residual is the
 * one the header records, and this flag does not narrow it.
 * `O_NOFOLLOW` for symmetry with the reader
 * and NOT because it is load-bearing here: `O_EXCL` already fails `EEXIST` on a
 * symlinked path, whichever way the link points.
 *
 * Returns whether it landed, and the caller is expected to exit either way — a
 * cancelled request costs money for as long as it runs, while an unrecorded
 * cancellation costs only the precision of the word the reader publishes.
 */
export function writeCancelAck(seq, jobId) {
  if (seq === undefined || seq === null || !jobId) return false;
  let fd;
  try {
    fd = openSync(
      cancelAckPathFor(seq),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeSync(fd, `${jobId}\n${new Date().toISOString()}\n`);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Nothing left to do about it, and the caller is exiting.
      }
    }
  }
}

/**
 * Did the worker for this row say it was cancelled?
 *
 * **`O_NONBLOCK` is not defensive tidiness.** The regular-file check can only run
 * once the descriptor exists, and opening a FIFO blocks until a writer appears —
 * indefinitely, here, while holding the queue's write lock. `O_NOFOLLOW` does not
 * prevent that; only opening non-blockingly does. It is inert on a regular file —
 * which is also the limit of the claim: this does not block **on a FIFO**, and it
 * is not "never blocks". `open`, `fstat` and `read` on a regular file are
 * synchronous, so a wedged NFS or FUSE mount can still stall any of them while the
 * write lock is held. Nothing short of moving the read out of the transaction
 * addresses that, and it is out of scope here.
 *
 * **`O_NOFOLLOW`** because a symlink planted at this path could otherwise aim the
 * read at the job log, which is exactly the model-reachable channel this file
 * exists to avoid.
 *
 * The id must match the row being judged. `seq` is `AUTOINCREMENT` and never
 * reused within one database, but a database deleted and recreated beside a
 * surviving `logs/` restarts the counter — so a stale acknowledgement would
 * otherwise confirm a job that never wrote it. Matching the id makes that need a
 * reused `seq` AND a repeated 8-hex-character id: a reduction, not an
 * impossibility.
 */
export function cancelAckMatches(seq, jobId) {
  if (!jobId) return false;
  let fd;
  try {
    fd = openSync(cancelAckPathFor(seq), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_ACK_BYTES) return false;
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_ACK_BYTES));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString('utf8').split('\n')[0].trim() === jobId;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // A close that fails changes nothing about what was read.
      }
    }
  }
}
