// What the failure record SAYS about a row an operator wrote off.
//
// Split from `abandon-transaction.test.js` when that file reached its size
// budget, on the seam the module already has: `abandonRow` decides and writes,
// and `abandonFailure` decides what the stored payload claims. The second
// is not a detail of the first — a record that asserts something nobody had
// established is its own failure.
//
// Every assertion here is about a permanent artifact, and a sentence that is
// merely plausible is one somebody will one day debug against. `finish` clears
// `worker_pid`, so for a running row the unreadable value is gone entirely — the
// record does not quote it, a deliberate scope decision.
import assert from 'node:assert/strict';
import test from 'node:test';
import { abandonRow } from '../scripts/lib/job-abandon.mjs';
import { NEEDS_SQLITE, insertSynthetic, readJob, stateDir, withStore } from './job-helpers.mjs';

const STALE = 90_000; // past STALE_BEAT_MS (60s)
const at = () => new Date().toISOString();

test('a row with NO pid recorded keeps the wording that says so', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The arm a recorded-but-unreadable pid now SHARES, pinned so the wording that
  // is true of both is not quietly narrowed to one of them.
  insertSynthetic(state, { id: 'shapeless', state: 'running', workerPid: null, startedAgoMs: 600_000 });

  withStore(state, (db) => abandonRow(db, 'shapeless', { override: true, at: at() }));

  const after = readJob(state, 'shapeless');
  assert.equal(after.failure.reason, 'operator-abandoned');
  assert.match(after.failure.message, /no liveness judgement was possible/);
  assert.match(after.failure.hint, /no pid to attribute/);
});

test('a READABLE pid records that a probe answered — the control the absence assertions need', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The positive control for the `doesNotMatch(/answered a liveness probe/)` in
  // the malformed-arm test below.
  // Without it that assertion constrains a sentence no test ever asserts, so it
  // would pass unchanged if the sentence were deleted from the codebase.
  insertSynthetic(state, {
    id: 'probed', state: 'running', workerPid: process.pid, startedAgoMs: 600_000, beatAgoMs: STALE,
  });

  withStore(state, (db) => abandonRow(db, 'probed', { at: at() }));

  const after = readJob(state, 'probed');
  assert.match(after.failure.message, /answered a liveness probe/);
  assert.match(after.failure.message, new RegExp(`\\(${process.pid}\\)`));
});

test('a recorded-but-unreadable pid takes the malformed arm, and claims no probe', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The malformed arm shares the no-pid arm's wording
  // because the same thing is true of both: nothing was asked of the OS. What it
  // may NOT say is that a pid answered a probe.
  //
  // **The recorded value is not kept.** `finish` NULLs `worker_pid`, so it is
  // lost — a scope decision recorded with this item, not an oversight: keeping it
  // means interpolating an arbitrary-length column into a payload written inside
  // the queue's write transaction.
  insertSynthetic(state, { id: 'unreadable', state: 'running', workerPid: 'garbage', startedAgoMs: 600_000 });

  withStore(state, (db) => abandonRow(db, 'unreadable', { override: true, at: at() }));

  const after = readJob(state, 'unreadable');
  assert.equal(after.state, 'failed');
  assert.equal(after.failure.reason, 'operator-abandoned');
  assert.match(after.failure.message, /no liveness judgement was possible/);
  assert.doesNotMatch(after.failure.message, /answered a liveness probe/,
    'no probe happened, so the permanent record may not say one did');
});
