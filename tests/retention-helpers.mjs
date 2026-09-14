// Shared by the two halves of the retention suite: `retention.test.js` for which
// rows the `DELETE` takes, `retention-files.test.js` for which files the sweep
// collects afterwards. Split when the two together outgrew the size ratchet.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweep } from '../scripts/lib/job-retention.mjs';
import { insertSynthetic, withStore } from './job-helpers.mjs';

// Stated independently of `logPathFor`, so a test cannot agree with the code
// about a layout they both got wrong.
export const logPath = (state, seq) => join(state, 'logs', `${seq}.log`);
export const ackPath = (state, seq) => join(state, 'logs', `${seq}.cancel-ack`);

export function writeLog(state, seq) {
  writeFileSync(logPath(state, seq), `log for ${seq}\n`);
}

/** `n` finished jobs, oldest first, each with the log a real run would leave. */
export function fillTerminal(state, n) {
  const seqs = [];
  for (let index = 0; index < n; index += 1) {
    const seq = insertSynthetic(state, { id: `done${index}`, state: 'completed', outcome: { content: 'ok' } });
    writeLog(state, seq);
    seqs.push(seq);
  }
  return seqs;
}

export const runSweep = (state) => withStore(state, (db) => sweep(db));

/**
 * **It guards DRIFT, and does not prove reachability** — the distinction matters
 * enough to state, because the assertions read as though they did. SQLite does
 * not guarantee `AND` evaluation order, so nothing here establishes that
 * `json_extract` runs; the executable witness for that is the mutation that
 * removes the `CASE WHEN json_valid` and makes the sweep throw. What these pin is
 * that the fixture still SATISFIES the gates — a row that quietly lost its
 * `started_at`, went non-terminal, or gained a foreign version would let that
 * mutation pass.
 */
export function assertCorruptAndReachable(db, seq) {
  const row = db
    .prepare('SELECT json_valid(failure) AS ok, started_at, state, schema_version FROM jobs WHERE seq = ?')
    .get(seq);
  assert.ok(row, `no row at seq ${seq} — the fixture never landed`);
  assert.equal(Number(row.ok), 0, 'the payload must actually be corrupt or the guard is not exercised');
  assert.ok(row.started_at, 'without it the row is no longer the shape the guard is evaluated for');
  assert.equal(row.state, 'failed', 'a non-terminal row is not a prune candidate at all');
  // Deliberately stricter than production's `<= ROW_SCHEMA_VERSION`: it mirrors
  // `insertSynthetic`'s own default, which is the drift being guarded. Reusing the
  // production predicate here would make the check agree with whatever it broke into.
  assert.equal(Number(row.schema_version), 1, 'a foreign version would exempt the row for an unrelated reason');
}
