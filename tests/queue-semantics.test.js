// What the QUEUE decides, as distinct from what the display says about it.
//
// The third file in this group, split off for the same reason as the second:
// `status-blocker.test.js` had started asking two questions under one name. It
// owns which row gets named; `status-blocker-render` owns what is said about it;
// this one owns the verdicts `decide` returns and the ordering it depends on —
// the transaction-critical half, where a test that cannot fail is worth least.
import assert from 'node:assert/strict';
import test from 'node:test';
import { tryAcquire } from '../scripts/lib/job-queue.mjs';
import { jobBySeq, rowsInState } from '../scripts/lib/job-record.mjs';
import { NEEDS_SQLITE, deadPid, insertSynthetic, stateDir, withStore } from './job-helpers.mjs';
import { HERE, THERE } from './blocker-helpers.mjs';

test('a row a newer plugin wrote is refused, and left exactly as it was', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Asked on the version-99 row's OWN behalf, with its own waiter pid. Asking on
  // a LATER row's behalf proves nothing: that caller reads `blocked` from the
  // seq comparison whether or not the version rule exists at all, which is how
  // the first version of this test passed against a `queuedRole` whose
  // `isKnownVersion` refusal had been deleted outright.
  const foreign = insertSynthetic(state, { id: 'newer', workspace: HERE, waiterPid: process.pid, version: 99 });

  withStore(state, (db) => {
    assert.equal(tryAcquire(db, foreign, process.pid), 'blocked', 'this build may not run a newer row');
    // `claimJob` carries no version guard of its own — its WHERE is seq + state +
    // waiter_pid — so without the refusal this row would be CLAIMED, not merely
    // mis-verdicted. Assert the row is untouched, which is the actual invariant:
    // a row this build cannot read is never mutated.
    const after = jobBySeq(db, foreign);
    assert.equal(after.state, 'queued', 'refusing to run it must not have started it');
    assert.equal(after.schema_version, 99);
    assert.equal(after.worker_pid, null);
  });

  // The control, in a store of its own so its `running` row cannot change any
  // other verdict: same shape, version this build knows, and it goes.
  const known = stateDir();
  const mine = insertSynthetic(known, { id: 'ours', workspace: HERE, waiterPid: process.pid });
  withStore(known, (db) => {
    assert.equal(tryAcquire(db, mine, process.pid), 'acquired', 'the version is the only difference');
  });
});

test('`gone` covers the pre-existing state guard and the rewritten empty-scan exit', { skip: NEEDS_SQLITE }, async () => {
  // Only the second of these is new. `decide`'s first line — the row is no longer
  // queued — is byte-identical to the baseline; the rewrite replaced the loop's
  // fall-through with `scanQueued` returning a null head. Both are pinned because
  // the plan claimed no verdict changed and nothing checked the claim.
  const state = stateDir();
  const finished = insertSynthetic(state, { id: 'over', state: 'completed', workspace: HERE });
  // A live queued row alongside it, or this proves nothing: with an EMPTY queue,
  // deleting the state guard still reaches `gone` through the null-head exit, and
  // the assertion cannot tell the two apart. With this row present, deleting the
  // guard reaches it instead and returns `blocked`.
  insertSynthetic(state, { id: 'waiting', workspace: HERE, waiterPid: process.pid });
  withStore(state, (db) => {
    assert.equal(tryAcquire(db, finished, process.pid), 'gone');
  });

  const empty = stateDir();
  const abandoned = insertSynthetic(empty, { id: 'ghost', workspace: HERE, waiterPid: await deadPid() });
  withStore(empty, (db) => {
    assert.equal(tryAcquire(db, abandoned, process.pid), 'gone');
    // The verdict is half of it. Skipping a row also RECONCILES it, and that side
    // effect belongs to the loop this change replaced — drop `onSkip` and the
    // verdict is still `gone` while the row stays queued forever.
    const after = jobBySeq(db, abandoned);
    assert.equal(after.state, 'failed');
    assert.equal(after.failure.reason, 'worker-died', 'the reason names which route collected it');
  });
});

test('queue order is seq order, whatever the timestamps say', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // `scanQueued` and `decide` both require ASCENDING seq, a guarantee that lives
  // in `rowsInState`'s SQL, in a third file.
  //
  // TWO mutations, and it takes both instruments to catch them. Inverted stamps
  // catch a rewrite to `ORDER BY created_at`. They do NOT catch deleting the
  // clause, because `seq` is AUTOINCREMENT and SQLite returns rowid order for a
  // bare scan — which is the same order. `reverse_unordered_selects` is what
  // closes that: it reverses exactly the ORDER-BY-less scans and leaves an
  // explicit `ORDER BY seq` alone, so the deletion fails deterministically.
  insertSynthetic(state, { id: 'first', workspace: HERE, waiterPid: process.pid, agedMs: 1000 });
  insertSynthetic(state, { id: 'done', state: 'completed', workspace: HERE, agedMs: 500 });
  insertSynthetic(state, { id: 'second', workspace: HERE, waiterPid: process.pid, agedMs: 900_000 });

  withStore(state, (db) => {
    // Connection-scoped, set on the same connection as the call it guards, and
    // gone when `withStore` closes it. Nothing else runs under it.
    db.exec('PRAGMA reverse_unordered_selects = ON');
    const queued = rowsInState(db, 'queued');
    assert.deepEqual(queued.map((row) => row.id), ['first', 'second'], 'seq order, not stamp order');
  });
});

test('a live foreign runner blocks a local job regardless of queue position', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The running loop makes no seq comparison, which is why `blockingSeqFor`'s
  // running rung makes none either. Insert the runner LAST so its seq is higher
  // than the local row's: a seq comparison would let this acquire.
  insertSynthetic(state, { id: 'mine', workspace: HERE, waiterPid: process.pid });
  insertSynthetic(state, { id: 'late-runner', state: 'running', workspace: THERE, workerPid: process.pid });
  const mine = withStore(state, (db) => rowsInState(db, 'queued')[0].seq);

  withStore(state, (db) => {
    assert.equal(tryAcquire(db, mine, process.pid), 'blocked');
  });
});
