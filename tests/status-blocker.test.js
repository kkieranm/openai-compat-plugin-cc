// WHICH row `/oai:status` names as the thing starving this workspace — the
// question it was built to answer and could not, because its filter asked about
// a row's STATE and blocking is a relation between two rows.
//
// The assertion that carries this file is not "the row is visible". It is
// "the visible row is the one `tryAcquire` blocks on", made in the same run
// against the same database: a test that only checks visibility would pass
// against a filter that admits the wrong row, which is exactly the fix that
// looks plausible.
//
// What the display then SAYS about that row lives in `status-blocker-render`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { tryAcquire } from '../scripts/lib/job-queue.mjs';
import { registerWaiter } from '../scripts/lib/job-record.mjs';
import { renderList } from '../scripts/lib/job-render.mjs';
import { NEEDS_SQLITE, deadPid, insertSynthetic, stateDir, withStore } from './job-helpers.mjs';
import { HERE, TEN_MINUTES, THERE, breakStamps, myJob, theirHead, viewHere } from './blocker-helpers.mjs';

test('the off-workspace head is shown, marked, and is what tryAcquire blocks on', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Alive, but silent for ten minutes. Note this is an ORDINARY row —
  // `queuedRole` calls it `head`, not `blocks` — which is why admitting only
  // the pathological shapes would not have fixed it.
  theirHead(state, { beatAgoMs: TEN_MINUTES });
  const mine = myJob(state);

  viewHere(state, (view, db) => {
    const blocker = view.shown.find((row) => row.id === 'theirs');
    assert.ok(blocker, 'the row starving this workspace must be shown');
    assert.equal(view.blockingSeq, blocker.seq);

    const text = renderList(view, { cwd: HERE, all: false });
    assert.match(text, /must clear before this workspace's queued job can proceed/);
    // The explanation that used to be computed and then discarded one line later.
    assert.match(text, /is alive but has not beaten since/);

    // Visible AND the cause. Separately these prove nothing.
    assert.equal(tryAcquire(db, mine, process.pid), 'blocked');
  });
});

// Three routes to `blocks`, and a fix that admits one of them would pass a
// single-shape test. Each gets its own queue: only the lowest-seq non-skip row
// is ever the head, so three in one database would exercise one of them.
const PATHOLOGICAL = [
  ['no worker has registered yet', (state) => theirHead(state, { waiterPid: null, agedMs: 1000 })],
  ['a newer plugin wrote it', (state) => theirHead(state, { version: 99 })],
  ['its own timestamps will not parse', (state) => {
    theirHead(state, { waiterPid: null });
    breakStamps(state, 'theirs');
  }],
];

for (const [shape, build] of PATHOLOGICAL) {
  test(`a queued blocker is named when ${shape}`, { skip: NEEDS_SQLITE }, () => {
    const state = stateDir();
    build(state);
    const mine = myJob(state);

    viewHere(state, (view, db) => {
      assert.ok(view.shown.some((row) => row.id === 'theirs'), `${shape}: the blocker must be shown`);
      assert.match(renderList(view, { cwd: HERE, all: false }), /must clear before this workspace's queued job/);
      assert.equal(tryAcquire(db, mine, process.pid), 'blocked', `${shape}: it must really be blocking`);
    });
  });
}

test('a cancelled local job is not a witness that anyone is being starved', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  theirHead(state);
  // `decide` returns `cancelled` before it ever scans the queue, so this row is
  // blocked by nothing. Naming a blocker for it would be naming a cause that is
  // not one.
  const mine = myJob(state, { cancelAgoMs: 1000 });

  viewHere(state, (view, db) => {
    assert.equal(view.blockingSeq, null);
    assert.ok(!view.shown.some((row) => row.id === 'theirs'), 'nothing is starving this workspace');
    assert.equal(view.elsewhere, 1);

    // The view's reason for excluding this row lives in ANOTHER file: `decide`
    // checks cancellation before it scans. Nothing pins that ordering, so pin it
    // here — move the check below the queued scan and this row reads `blocked`,
    // the view keeps hiding the blocker, and every assertion above still passes.
    // Deliberately NOT asserting where the check sits relative to the *running*
    // loop: `blockingSeqFor` consults running rows on its own first rung, and
    // that rung is pinned by its own tests below.
    assert.equal(tryAcquire(db, mine, process.pid), 'cancelled');
  });
});

test('a local job with nothing waiting on it is not a witness either', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  theirHead(state);
  // Malformed: no waiter pid, and stamps that will not parse. `reconcileAll`
  // never collects this shape, so it reaches the display with no evidence that
  // anything is waiting on it — and the marker is a sentence the user acts on,
  // cancelling a job in another checkout say, so it is printed only on positive
  // evidence.
  // NOT because this row can never acquire: `registerWaiter` could still attach a
  // worker, after which it reads `live` and is admitted. Hiding the blocker for
  // that window is an accepted transient false negative.
  myJob(state, { waiterPid: null });
  breakStamps(state, 'mine');

  viewHere(state, (view) => {
    assert.equal(view.blockingSeq, null);
    assert.ok(!view.shown.some((row) => row.id === 'theirs'), 'no evidence yet that anything here is waiting');
    assert.equal(view.elsewhere, 1);
  });
});

test('a local job whose worker is still booting IS a witness', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  theirHead(state);
  // `registerWaiter` runs in the worker, so an ordinary submission has no waiter
  // pid until the child boots — `starting`, inside the grace. This is the COMMON
  // case, and a witness rule keyed on "could be claimed right now" would hide the
  // blocker from it for the whole spawn window.
  const mine = myJob(state, { waiterPid: null, agedMs: 1000 });

  viewHere(state, (view, db) => {
    assert.ok(view.shown.some((row) => row.id === 'theirs'), 'a booting local job is still starved');
    assert.match(renderList(view, { cwd: HERE, all: false }), /must clear before this workspace's queued job/);
    // A `starting` row can never acquire — `queuedRole` calls it `blocks` and
    // `claimJob` matches on `waiter_pid` — so asserting `blocked` here proves
    // nothing about the foreign head. Register a waiter first, and the verdict
    // becomes attributable to the head rather than to this row's own shape.
    registerWaiter(db, mine, process.pid, new Date().toISOString());
    assert.equal(tryAcquire(db, mine, process.pid), 'blocked');
  });

  // The control that makes the assertion above discriminating: same registered
  // row, no foreign head, and it acquires.
  const alone = stateDir();
  const solo = myJob(alone, { waiterPid: null, agedMs: 1000 });
  withStore(alone, (db) => {
    registerWaiter(db, solo, process.pid, new Date().toISOString());
    assert.equal(tryAcquire(db, solo, process.pid), 'acquired', 'without the head it must go');
  });
});

test('nothing extra is admitted when the head is this workspace\'s own job', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  myJob(state);
  theirHead(state);
  // A SECOND local job, behind the local head. Without it this fixture cannot
  // fail: delete the `head.workspace === cwd` guard and the final witness check
  // still returns null, because no eligible local row sits after the head. With
  // it, deleting that guard marks the local head — which is the defect the guard
  // exists to prevent.
  insertSynthetic(state, { id: 'mine-too', workspace: HERE, waiterPid: process.pid });

  viewHere(state, (view) => {
    assert.equal(view.blockingSeq, null, 'your own job at the head is never the marked row');
    assert.ok(!view.shown.some((row) => row.id === 'theirs'), 'a row behind mine is not blocking me');
    assert.equal(view.elsewhere, 1);
  });
});

test('nothing is marked when this workspace has nothing queued', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  theirHead(state);
  // A LIVE foreign runner, or this fixture cannot fail: delete the eligible-
  // witness gate at the top and, with no running row, the queued rung returns
  // null on its own. With a runner present, deleting that gate makes rung one
  // mark it — telling a workspace with no queued work what is blocking it.
  // The runner is shown either way (it is running, and that clause predates this
  // change); what must not appear is the marker.
  insertSynthetic(state, { id: 'runner', state: 'running', workspace: THERE, workerPid: process.pid });

  viewHere(state, (view) => {
    assert.equal(view.blockingSeq, null, 'nothing here is waiting, so nothing is being blocked');
    assert.equal(view.shown.length, 1, 'the runner is shown; the queued head is not');
    assert.ok(!view.shown.some((row) => row.id === 'theirs'));
    assert.equal(view.elsewhere, 1);
    assert.doesNotMatch(renderList(view, { cwd: HERE, all: false }), /must clear before/);
  });
});

test('the blocker is the RUNNING row when one is running, not the queued head', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // `decide` returns `blocked` from its running loop before queue order is ever
  // consulted, so this is what a local job is really waiting on. Marking the
  // queued head instead named a row the user could clear with no effect.
  const running = insertSynthetic(state, { id: 'runner', state: 'running', workspace: THERE, workerPid: process.pid });
  const head = theirHead(state);
  myJob(state);

  viewHere(state, (view) => {
    assert.equal(view.blockingSeq, running, 'the running row is the immediate blocker');
    assert.notEqual(view.blockingSeq, head, 'the queued head is NOT what this job is waiting on');
  });
});

test('a DEAD running row does not take the marker from the queued head', { skip: NEEDS_SQLITE }, async () => {
  const state = stateDir();
  // Positive control for the rung above: `decide` reconciles a dead running row
  // and carries on, so it must not shadow the real blocker.
  insertSynthetic(state, { id: 'corpse', state: 'running', workspace: THERE, workerPid: await deadPid() });
  const head = theirHead(state);
  myJob(state);

  viewHere(state, (view) => {
    assert.equal(view.blockingSeq, head, 'a dead running row blocks nobody, so the head is still it');
  });
});

test('a local running job takes the marker off entirely', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  insertSynthetic(state, { id: 'mine-run', state: 'running', workspace: HERE, workerPid: process.pid });
  theirHead(state);
  myJob(state);

  viewHere(state, (view) => {
    // Your own running job needs no explaining, and falling through to the queued
    // head would re-create the very mismatch the running rung was added to fix.
    assert.equal(view.blockingSeq, null);
    assert.doesNotMatch(renderList(view, { cwd: HERE, all: false }), /must clear before/);
  });
});

