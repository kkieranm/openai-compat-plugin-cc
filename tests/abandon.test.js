// Writing off a row whose worker cannot be proved gone.
//
// The interesting half is not that a row goes terminal — `finish` already did
// that — but WHICH rows may, and what the operator is told afterwards. Both are
// judgements this build makes on incomplete evidence, so each arm of each is
// driven here rather than argued about in a comment.
import assert from 'node:assert/strict';
import test from 'node:test';
import { abandonDecision } from '../scripts/lib/job-abandon.mjs';
import { NEEDS_SQLITE } from './job-helpers.mjs';

const STALE = 90_000; // past STALE_BEAT_MS (60s)
const FRESH = 1_000;
test('the decision admits queued and running by whitelist, and refuses the rest by name', { skip: NEEDS_SQLITE }, () => {
  const now = Date.now();
  // `worker_pid` is load-bearing, not decoration: a `running` row without one is
  // `malformed`, so these fixtures were reaching the malformed rung and asserting
  // about rungs below it that they never touched.
  const row = {
    state: 'running', schema_version: 1, worker_pid: process.pid,
    last_beat_at: new Date(now - STALE).toISOString(),
  };

  assert.deepEqual(abandonDecision(row, now), { allowed: true, reason: 'stale' });
  assert.deepEqual(
    abandonDecision({ ...row, state: 'queued', worker_pid: null, waiter_pid: process.pid }, now),
    { allowed: true, reason: 'stale' },
  );
  assert.equal(abandonDecision(null, now).reason, 'gone');
  assert.equal(abandonDecision({ ...row, state: 'completed' }, now).reason, 'not-abandonable');
  // The whole point of the whitelist: an unrecognised NON-terminal state must be
  // refused here, not passed to `finish` to produce an uninterpretable `false`.
  assert.equal(abandonDecision({ ...row, state: 'launching' }, now).reason, 'not-abandonable');
});

test('a fresh beat refuses, and --force is what lifts it', { skip: NEEDS_SQLITE }, () => {
  const now = Date.now();
  const beating = {
    state: 'running', schema_version: 1, worker_pid: process.pid,
    last_beat_at: new Date(now - FRESH).toISOString(),
  };

  assert.deepEqual(abandonDecision(beating, now), { allowed: false, reason: 'beating' });
  assert.deepEqual(abandonDecision(beating, now, { override: true }), { allowed: true, reason: 'forced' });
});

test('an UNREADABLE beat fails CLOSED, unlike the display predicate', { skip: NEEDS_SQLITE }, () => {
  const now = Date.now();
  // The only shape that reaches this rung. `registerWaiter` and `claimJob` each
  // write a pid and a beat in ONE statement and `finish` never nulls a beat, so
  // "a live pid with no beat at all" cannot be produced — a beat that will not
  // PARSE can. The previous fixture here had neither pid nor timestamps, which
  // made it `malformed`: the test named `no-beat` had never reached `no-beat`.
  const unreadable = {
    state: 'running', schema_version: 1, worker_pid: process.pid, last_beat_at: 'not-a-timestamp',
  };

  // `beatIsStale` answers `false` for this input so `/oai:status` does not flag
  // every job's first moments. Here the same input must refuse — the question is
  // whether to destroy a row, not what word to print.
  assert.deepEqual(abandonDecision(unreadable, now), { allowed: false, reason: 'no-beat' });
  assert.deepEqual(abandonDecision(unreadable, now, { override: true }), { allowed: true, reason: 'forced' });
});

test('a malformed row is refused by default and liftable by --force', { skip: NEEDS_SQLITE }, () => {
  const now = Date.now();
  // A `running` row with no pid: a shape this build will not guess at. Refusing
  // it outright would leave a corrupt row wedging the queue with no operator
  // escape at all, which is the defect this command exists to remove — so it is
  // refused by default and `--force` lifts it.
  const noPid = { state: 'running', schema_version: 1, worker_pid: null, last_beat_at: null };
  assert.deepEqual(abandonDecision(noPid, now), { allowed: false, reason: 'malformed' });
  assert.deepEqual(abandonDecision(noPid, now, { override: true }), { allowed: true, reason: 'forced-malformed' });

  // The second malformed shape: queued, no waiter, timestamps that will not parse.
  const noTime = { state: 'queued', schema_version: 1, waiter_pid: null, spawned_at: 'nonsense', created_at: 'nonsense' };
  assert.deepEqual(abandonDecision(noTime, now), { allowed: false, reason: 'malformed' });
});

test('a dead pid is a refusal, not an abandonment', { skip: NEEDS_SQLITE }, async () => {
  const now = Date.now();
  const { deadPid } = await import('./job-helpers.mjs');
  // Ordinary reconciliation owns this row. Recording `operator-abandoned` over a
  // worker that had simply died would attribute a death to the operator who
  // merely asked about it.
  const gone = {
    state: 'running', schema_version: 1, worker_pid: await deadPid(),
    last_beat_at: new Date(now - STALE).toISOString(),
  };
  assert.deepEqual(abandonDecision(gone, now), { allowed: false, reason: 'dead' });
  assert.deepEqual(abandonDecision(gone, now, { override: true }), { allowed: false, reason: 'dead' },
    '--force must not turn a death into an abandonment');
});

test('a pid that is recorded but unreadable is malformed, not a death', { skip: NEEDS_SQLITE }, () => {
  const now = Date.now();
  // Each of these reached `isAlive` and came back
  // `false`, which `livenessOf` read as `dead` — so the row was handed to
  // ordinary recovery and terminalized, and the operator was told its process
  // was already gone about a value that never denoted a process.
  for (const pid of [-1, 0, 1.5, 2 ** 40, 'garbage']) {
    const running = { state: 'running', schema_version: 1, worker_pid: pid, last_beat_at: null };
    assert.deepEqual(abandonDecision(running, now), { allowed: false, reason: 'malformed' },
      `running row holding ${JSON.stringify(pid)}`);
    assert.deepEqual(abandonDecision(running, now, { override: true }), { allowed: true, reason: 'forced-malformed' },
      `--force must be the exit for a running row holding ${JSON.stringify(pid)}`);

    // The queued arm matters more, not less: nothing can ever attach to it and
    // no automatic path collects it, so this lift is its ONLY exit.
    const queued = { state: 'queued', schema_version: 1, waiter_pid: pid, spawned_at: new Date(now - 600_000).toISOString() };
    assert.deepEqual(abandonDecision(queued, now), { allowed: false, reason: 'malformed' },
      `queued row holding ${JSON.stringify(pid)}`);
    assert.deepEqual(abandonDecision(queued, now, { override: true }), { allowed: true, reason: 'forced-malformed' },
      `--force must be the exit for a queued row holding ${JSON.stringify(pid)}`);
  }
});
