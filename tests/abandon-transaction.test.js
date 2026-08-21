// `abandonRow` — the transaction, and what it leaves behind.
//
// Split from `abandon.test.js` when that file reached its size budget, on the
// seam the module itself has: `abandonDecision` is a pure question about a row
// and needs no database, while everything here opens a store and asserts what
// the write transaction did. Keeping them together meant a reader had to hold
// both to change either.
import assert from 'node:assert/strict';
import test from 'node:test';
import { abandonRow } from '../scripts/lib/job-abandon.mjs';
import { tryAcquire } from '../scripts/lib/job-queue.mjs';
import { beat, jobById } from '../scripts/lib/job-record.mjs';
import { NEEDS_SQLITE, insertSynthetic, readJob, stateDir, withStore } from './job-helpers.mjs';

const STALE = 90_000; // past STALE_BEAT_MS (60s)
const FRESH = 1_000;
const at = () => new Date().toISOString();

/** A row whose pid is this process — alive, and provably not our worker. */
function wedged(state, overrides = {}) {
  return insertSynthetic(state, {
    id: 'wedged', state: 'running', workerPid: process.pid, startedAgoMs: 600_000, beatAgoMs: STALE, ...overrides,
  });
}

test('a row a newer plugin wrote is refused, and --force does NOT lift it', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  wedged(state, { version: 99 });

  for (const override of [false, true]) {
    const outcome = withStore(state, (db) => abandonRow(db, 'wedged', { override, at: at() }));
    assert.equal(outcome.outcome, 'refused', `--force=${override} must not reach a newer row`);
    assert.equal(outcome.reason, 'unknown-version');
  }

  // The invariant is the row, not the verdict: `finish` carries no schema
  // predicate, so without the guard in `abandonDecision` this row would have
  // been written, not merely mis-reported.
  const after = readJob(state, 'wedged');
  assert.equal(after.state, 'running');
  assert.equal(after.schema_version, 99);
  assert.equal(after.failure, null);
});

test('an abandoned row reads failed / operator-abandoned, never cancelled', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  wedged(state);

  const outcome = withStore(state, (db) => abandonRow(db, 'wedged', { at: at() }));
  assert.equal(outcome.outcome, 'abandoned');
  assert.equal(outcome.state, 'running', 'the returned state is the one FOUND, not the one written');

  const after = readJob(state, 'wedged');
  assert.equal(after.state, 'failed');
  assert.notEqual(after.state, 'cancelled', 'OAI-66: an unconfirmed stop must not read as a tidy cancellation');
  assert.equal(after.failure.reason, 'operator-abandoned');
});

test('the decision is re-evaluated on the row the transaction reads, not on an earlier one', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const seq = wedged(state);

  // Read the row while it is stale, then let it beat before asking. An
  // implementation that decided on the caller's read would abandon it.
  //
  // This test does NOT prove the decision happens inside BEGIN IMMEDIATE —
  // `node:sqlite` is synchronous, so the beat lands before `abandonRow` reads
  // anything at all. `tests/queue-guards.test.js` is what pins the placement.
  const outcome = withStore(state, (db) => {
    const before = jobById(db, 'wedged');
    assert.equal(before.state, 'running');
    beat(db, seq, at());
    return abandonRow(db, 'wedged', { at: at() });
  });

  assert.equal(outcome.outcome, 'refused');
  assert.equal(outcome.reason, 'beating');
  assert.equal(readJob(state, 'wedged').state, 'running');
});

test('abandoning the running blocker drains the queue, which is the exception being taken', { skip: NEEDS_SQLITE }, async () => {
  const state = stateDir();
  wedged(state);
  const waiter = insertSynthetic(state, {
    id: 'waiting', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH,
  });

  withStore(state, (db) => {
    assert.equal(tryAcquire(db, waiter, process.pid), 'blocked', 'the wedged row must block first');
    const outcome = abandonRow(db, 'wedged', { at: at() });
    assert.equal(outcome.outcome, 'abandoned');
    assert.equal(outcome.couldDrain, true);
    // Observed dispatch, not merely a terminal row: nothing dispatches
    // proactively, so the waiter's own next attempt is the acceptance criterion.
    assert.equal(tryAcquire(db, waiter, process.pid), 'acquired');
  });
});

test('abandoning a queued HEAD drains the queue too', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  insertSynthetic(state, { id: 'head', state: 'queued', waiterPid: process.pid, beatAgoMs: STALE });
  const behind = insertSynthetic(state, { id: 'behind', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH });

  withStore(state, (db) => {
    assert.equal(tryAcquire(db, behind, process.pid), 'blocked', 'the head must block it first');
    const outcome = abandonRow(db, 'head', { at: at() });
    assert.equal(outcome.outcome, 'abandoned');
    assert.equal(outcome.state, 'queued');
    assert.equal(outcome.couldDrain, true);
    assert.equal(tryAcquire(db, behind, process.pid), 'acquired');
  });
});

test('a queued head abandoned under a LIVE running row does not drain, and does not say it will', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Differs from the test above in exactly one thing: this running row exists.
  insertSynthetic(state, {
    id: 'busy', state: 'running', workerPid: process.pid, startedAgoMs: 1_000, beatAgoMs: FRESH,
  });
  insertSynthetic(state, { id: 'head', state: 'queued', waiterPid: process.pid, beatAgoMs: STALE });
  const behind = insertSynthetic(state, { id: 'behind', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH });

  withStore(state, (db) => {
    const outcome = abandonRow(db, 'head', { at: at() });
    assert.equal(outcome.outcome, 'abandoned', 'the head is still written off');
    // The running rung is consulted FIRST and refuses every caller before queue
    // order is reached. Reporting drainage here would be wrong: consulting the
    // queued rung alone misses a running row that still blocks everyone.
    assert.equal(outcome.couldDrain, false);
    assert.equal(tryAcquire(db, behind, process.pid), 'blocked');
  });
});

test('a queued head that cannot itself run is not reported as drainage', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  insertSynthetic(state, { id: 'target', state: 'queued', waiterPid: process.pid, beatAgoMs: STALE });
  // `scanQueued` yields this row as the head, but `decide` rejects it at its own
  // last rung — so "a waiting job may start" would be false.
  insertSynthetic(state, {
    id: 'unrunnable', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH, version: 99,
  });

  const outcome = withStore(state, (db) => abandonRow(db, 'target', { at: at() }));
  assert.equal(outcome.outcome, 'abandoned');
  assert.equal(outcome.couldDrain, false, 'a head whose role is `blocks` is not a runnable successor');
});

test('a cancel-pending head is not a runnable successor either', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  insertSynthetic(state, { id: 'target', state: 'queued', waiterPid: process.pid, beatAgoMs: STALE });
  insertSynthetic(state, {
    id: 'stopping', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH, cancelAgoMs: 1_000,
  });

  const outcome = withStore(state, (db) => abandonRow(db, 'target', { at: at() }));
  assert.equal(outcome.couldDrain, false, 'its own worker gets `cancelled`, so it never clears the way');
});

test('drainage is WITHHELD from a successor the queue would actually seat', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  wedged(state);
  // Live pid, stale beat: `decide` seats this row — it checks liveness and
  // version, never freshness — but `couldDrain` refuses to claim it. The
  // under-claim is deliberate, and this pins BOTH halves so the asymmetry cannot
  // be "tidied" into a false positive later.
  const behind = insertSynthetic(state, {
    id: 'sleepy', state: 'queued', waiterPid: process.pid, beatAgoMs: 90_000,
  });

  withStore(state, (db) => {
    const outcome = abandonRow(db, 'wedged', { at: at() });
    assert.equal(outcome.outcome, 'abandoned');
    assert.equal(outcome.couldDrain, false, 'a stale-beat successor is not claimed');
    assert.equal(tryAcquire(db, behind, process.pid), 'acquired', 'yet the queue seats it');
  });
});

test('an UNREADABLE failure payload fails closed to the ordinary refusal', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  insertSynthetic(state, { id: 'corrupt', state: 'failed', workerPid: null, startedAgoMs: 600_000 });
  // Raw SQL, because `insertSynthetic` JSON.stringifies whatever it is given —
  // so any fixture routed through it lands as VALID json, `decode`'s catch never
  // runs, and the test would pass via `failure?.reason === undefined`: a
  // different route entirely, asserting nothing about the one it names.
  withStore(state, (db) => db.prepare('UPDATE jobs SET failure = ? WHERE id = ?').run('{not json', 'corrupt'));

  withStore(state, (db) => {
    // The positive control: prove `decode` actually nulled the payload, so the
    // verdict below is about the unreadable route and not about an absent one.
    const row = jobById(db, 'corrupt');
    assert.equal(row.failure, null);
    assert.ok(row.unreadable?.includes('failure'), 'decode must have marked the column unreadable');

    const outcome = abandonRow(db, 'corrupt', { at: at() });
    // Fail CLOSED. A fail-OPEN classifier would answer `already-recovered` here,
    // inferring "recovery settled this" from bytes it could not read — the
    // fabrication class this module has been bitten by twice.
    assert.equal(outcome.outcome, 'refused');
    assert.equal(outcome.reason, 'not-abandonable');
  });
});

test('a successor whose beat cannot be READ earns no drainage claim', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  wedged(state);
  const behind = insertSynthetic(state, {
    id: 'garbled', state: 'queued', waiterPid: process.pid, beatAgoMs: 1_000,
  });
  // Raw SQL: `insertSynthetic` builds every timestamp through `ago()`, which
  // always yields a parseable ISO string, so the one shape this guard exists for
  // cannot be inserted through the helper.
  withStore(state, (db) => db.prepare('UPDATE jobs SET last_beat_at = ? WHERE id = ?').run('not-a-time', 'garbled'));

  withStore(state, (db) => {
    const outcome = abandonRow(db, 'wedged', { at: at() });
    assert.equal(outcome.outcome, 'abandoned');
    // The parse check is LOAD-BEARING, not defensive: `beatIsStale` answers
    // `false` for an unreadable beat, so without it this successor would read as
    // "not stale" and the sentence would be claimed on no evidence at all.
    // Deleting that one line left the whole suite green until this test existed.
    assert.equal(outcome.couldDrain, false);
    // And the control: the row IS otherwise a live known-version head, so the
    // absence above is caused by the unreadable beat and nothing else.
    assert.equal(tryAcquire(db, behind, process.pid), 'acquired');
  });
});

test('a successor already past its wait cap earns no drainage claim', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  wedged(state);
  insertSynthetic(state, { id: 'expiring', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH });
  // Raw SQL: `insertSynthetic` cannot set `max_wait_ms`. One minute cap on a row
  // created ten minutes ago — expired, while still holding a live pid and a fresh
  // beat, because `awaitTurn` beats before it checks the cap.
  withStore(state, (db) => db.prepare('UPDATE jobs SET max_wait_ms = ?, created_at = ? WHERE id = ?')
    .run(60_000, new Date(Date.now() - 600_000).toISOString(), 'expiring'));

  withStore(state, (db) => {
    const outcome = abandonRow(db, 'wedged', { at: at() });
    assert.equal(outcome.outcome, 'abandoned');
    // Past its cap, so the queue will time it out rather than seat it — "a
    // waiting job may start"
    // would be false. The MC/DC twin is the drainage-positive test above, whose
    // successor is identical but for a NULL `max_wait_ms`; do not add a
    // `tryAcquire` control here, because `decide` checks no deadline and would
    // answer `acquired`, framing this as an under-claim when it is not.
    assert.equal(outcome.couldDrain, false);
  });
});

test('a successor with a cap it has NOT yet reached still earns the claim', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  wedged(state);
  insertSynthetic(state, { id: 'roomy', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH });
  // The MC/DC twin of the expired test above: copied fixture, and the ONLY
  // difference is where the deadline sits — ten minutes out instead of nine
  // minutes past. Without this the guard `deadline === null` survives, because
  // every other drainage positive has a NULL cap and so exercises a different
  // operand entirely.
  withStore(state, (db) => db.prepare('UPDATE jobs SET max_wait_ms = ?, created_at = ? WHERE id = ?')
    .run(600_000, new Date(Date.now() - 60_000).toISOString(), 'roomy'));

  withStore(state, (db) => {
    const outcome = abandonRow(db, 'wedged', { at: at() });
    assert.equal(outcome.outcome, 'abandoned');
    assert.equal(outcome.couldDrain, true, 'a cap in the future must not withhold the claim');
  });
});
