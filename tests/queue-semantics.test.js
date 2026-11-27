// What the QUEUE decides, as distinct from what the display says about it.
//
// The verdicts `decide` returns and the ordering it depends on — the
// transaction-critical half of the queue's behaviour, where a test that cannot
// fail is worth least. Which row `/oai:status` names as the blocker is
// `status-blocker.test.js`; what it says about that row is
// `status-blocker-render.test.js`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { tryAcquire } from '../plugins/oai/scripts/lib/job-queue.mjs';
import { STARTUP_GRACE_MS } from '../plugins/oai/scripts/lib/job-liveness.mjs';
import { jobBySeq, rowsInState } from '../plugins/oai/scripts/lib/job-record.mjs';
import { NEEDS_SQLITE, deadPid, insertSynthetic, stateDir, withLockWait, withStore } from './job-helpers.mjs';
import { HERE, THERE } from './blocker-helpers.mjs';

test('a row a newer plugin wrote is refused, and left exactly as it was', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Asked on the version-99 row's OWN behalf, with its own waiter pid. Asking on
  // a LATER row's behalf proves nothing: that caller reads `blocked` from the
  // seq comparison whether or not the version rule exists at all, so it passes
  // against a `queuedRole` whose `isKnownVersion` refusal has been deleted outright.
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

test('`gone` covers both the state guard and the empty-scan exit', { skip: NEEDS_SQLITE }, async () => {
  // Two routes reach `gone`: `decide`'s state guard — the row is no longer queued —
  // and `scanQueued` returning a null head. Both are pinned.
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
    // The verdict is half of it. Skipping a row also RECONCILES it through
    // `onSkip` — drop `onSkip` and the verdict is still `gone` while the row stays
    // queued forever.
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

test('the queue judges and stamps with the clock read once the write lock is held', { skip: NEEDS_SQLITE }, async (t) => {
  const state = stateDir();
  // `ahead` is inside the startup grace by 5s, so it holds the line as
  // `starting` on a clock read before the lock and is written off as
  // `never-started` on one read after a 10s wait for it. `crashed` is a running
  // row whose worker is gone, written off by the running rung.
  const crashed = insertSynthetic(state, { id: 'crashed', state: 'running', workspace: HERE, workerPid: await deadPid(), startedAgoMs: 600_000 });
  const ahead = insertSynthetic(state, { id: 'ahead', workspace: HERE, agedMs: STARTUP_GRACE_MS - 5_000 });
  const mine = insertSynthetic(state, { id: 'mine', workspace: HERE, waiterPid: process.pid });

  withStore(state, (db) => {
    const { result: verdict, inLock } = withLockWait(t, db, 10_000, (handle) => tryAcquire(handle, mine, process.pid));

    assert.equal(verdict, 'acquired', 'liveness was judged on a clock read before the lock was held');
    const claimed = jobBySeq(db, mine);
    assert.equal(claimed.started_at, inLock, 'the claim was not stamped with the reading taken as the lock was acquired');
    assert.equal(claimed.last_beat_at, inLock);
    const writtenOff = jobBySeq(db, ahead);
    assert.notEqual(writtenOff.state, 'queued', 'the row ahead was not written off');
    assert.equal(writtenOff.completed_at, inLock, 'the write-off was not stamped with the reading taken as the lock was acquired');
    const reconciled = jobBySeq(db, crashed);
    assert.notEqual(reconciled.state, 'running', 'the crashed runner was not written off');
    assert.equal(reconciled.completed_at, inLock, 'the running rung did not stamp with the reading taken as the lock was acquired');
  });
});
