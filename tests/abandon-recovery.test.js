// What `/oai:abandon` says about a row it did NOT simply write off.
//
// Split from `abandon-messages.test.js` at its size budget, on the seam the
// command itself has: that file covers what is said about an ordinary write-off,
// this one covers the refusals and the two recovery paths — the cases where the
// operator's verb did not apply as asked, and the reply has to explain why
// without crediting or blaming the wrong actor.
import assert from 'node:assert/strict';
import test from 'node:test';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, readJob } from './job-helpers.mjs';

const STALE = 90_000;
const FRESH = 1_000;

/** A running row held by this test process — alive, and provably not our worker. */
function wedge(state, overrides = {}) {
  return insertSynthetic(state, {
    id: 'wedged', state: 'running', workerPid: process.pid, startedAgoMs: 600_000, beatAgoMs: STALE, ...overrides,
  });
}

test('a never-started row is not described as a process that was already gone', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Queued, no waiter ever registered, PAST the grace. Nothing was ever
    // spawned, so "its process was already gone" would be false — the sentence
    // that shape inherited when both recoveries shared one message.
    insertSynthetic(scenario.state, {
      id: 'nevers', state: 'queued', waiterPid: null, agedMs: 200_000, beatAgoMs: null,
    });

    const { status, stdout } = await scenario.run(['abandon', 'nevers']);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /never had a worker register against it/);
    assert.match(stdout, /worker-never-started/);
    // The dead-process wording must not appear for a row that never had one.
    assert.doesNotMatch(stdout, /process was already gone/);
    assert.equal(readJob(scenario.state, 'nevers').state, 'failed');
  } finally {
    await scenario.server.close();
  }
});

test('a forced malformed row claims no knowledge the record denies', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Running with no worker pid: nothing can be judged about its process.
    insertSynthetic(scenario.state, {
      id: 'shapeless', state: 'running', workerPid: null, startedAgoMs: 600_000, beatAgoMs: STALE,
    });

    const refused = await scenario.run(['abandon', 'shapeless']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /will not guess at/);

    const forced = await scenario.run(['abandon', '--force', 'shapeless']);
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /whether anything is in flight is unknowable/);
    // The stored record says no liveness judgement was possible; the printed text
    // may not imply one either.
    assert.doesNotMatch(forced.stdout, /never asked to stop/);
    assert.match(readJob(scenario.state, 'shapeless').failure.message, /no liveness judgement was possible/);
  } finally {
    await scenario.server.close();
  }
});

test('a row already settled by recovery is reported, not refused', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // What a CONCURRENT reconcile leaves behind. Before this, the operator whose
    // queue had just been freed got exit 1 and "--force will not change that".
    insertSynthetic(scenario.state, {
      id: 'settled', state: 'failed', workerPid: null, startedAgoMs: 600_000,
      failure: { error: true, reason: 'worker-died', message: 'gone', hint: null },
    });

    const { status, stdout, stderr } = await scenario.run(['abandon', 'settled']);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /already settled by ordinary recovery/);
    assert.match(stdout, /worker-died/);
    assert.doesNotMatch(stderr, /--force will not change that/);
  } finally {
    await scenario.server.close();
  }
});

test('a row failed by the MODEL is still an ordinary refusal', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The negative twin of the test above, differing in exactly the failure
    // reason: recovery did not write this one, so it is not a recovery to report.
    insertSynthetic(scenario.state, {
      id: 'modelfail', state: 'failed', workerPid: null, startedAgoMs: 600_000,
      failure: { error: true, reason: 'token-exhaustion', message: 'ran out', hint: null },
    });

    const { status, stderr } = await scenario.run(['abandon', 'modelfail']);
    assert.equal(status, 1);
    assert.match(stderr, /already failed/);
    assert.doesNotMatch(stderr, /settled by ordinary recovery/);
  } finally {
    await scenario.server.close();
  }
});

test('a recovered blocker reports drainage when a job really can start', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const { deadPid } = await import('./job-helpers.mjs');
    // The positive twin of the empty-queue negative in `abandon-cli.test.js`.
    // Recovery terminalizes this blocker inside the transaction, so the successor
    // becomes runnable and the sentence is earned — the path used to stay silent
    // on the grounds that it did not compute drainage, which was circular.
    insertSynthetic(scenario.state, {
      id: 'reaped', state: 'running', workerPid: await deadPid(), startedAgoMs: 600_000, beatAgoMs: STALE,
    });
    insertSynthetic(scenario.state, {
      id: 'waiting', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH,
    });

    const { status, stdout } = await scenario.run(['abandon', 'reaped']);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /needed no writing off/);
    // The positive twin for the never-started test's `doesNotMatch` on this
    // phrase: this row DID have a process, and it was gone.
    assert.match(stdout, /process was already gone/);
    assert.match(stdout, /may start/);
    // Byte-identical to the abandoned path's sentence — one definition, two callers.
    assert.match(stdout, /At that moment/);
  } finally {
    await scenario.server.close();
  }
});

test('a row settled BEFORE the command ran claims no drainage', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // `already-recovered` is deliberately asymmetric with `recovered`: this row
    // was terminal before the command ran, so nothing it did unblocked anything.
    // Pinned so the asymmetry is a decision rather than an omission.
    insertSynthetic(scenario.state, {
      id: 'settled', state: 'failed', workerPid: null, startedAgoMs: 600_000,
      failure: { error: true, reason: 'worker-died', message: 'gone', hint: null },
    });
    insertSynthetic(scenario.state, {
      id: 'waiting', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH,
    });

    const { status, stdout } = await scenario.run(['abandon', 'settled']);
    assert.equal(status, 0);
    assert.match(stdout, /already settled by ordinary recovery/);
    assert.doesNotMatch(stdout, /may start/);
  } finally {
    await scenario.server.close();
  }
});

test('a cancelled row is recovery-owned even with no failure payload', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The arm a mutation proved untested: `cancelled` carries NO failure payload —
    // `job-reconcile.mjs` writes it with none — so a reason-only classifier would
    // miss it entirely. That is the whole reason the classifier reads state AND
    // reason, and deleting this arm left the suite green.
    insertSynthetic(scenario.state, {
      id: 'quiet', state: 'cancelled', workerPid: null, startedAgoMs: 600_000,
    });

    const { status, stdout } = await scenario.run(['abandon', 'quiet']);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /already settled by ordinary recovery/);
    assert.match(stdout, /cancelled/);
    assert.equal(readJob(scenario.state, 'quiet').state, 'cancelled', 'the row is left exactly as it was');
  } finally {
    await scenario.server.close();
  }
});

test('a submitter-diagnosed launch failure is an ordinary refusal, deliberately', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // `worker-launch-unconfirmed` is the SUBMITTER's verdict, not recovery's. It
    // is excluded on provenance, not on epistemics — the exit-0 message claims
    // the row was "settled by ordinary recovery", which this was not. Pinned so
    // the exclusion reads as a decision rather than an oversight.
    insertSynthetic(scenario.state, {
      id: 'unconfirmed', state: 'failed', workerPid: null, startedAgoMs: 600_000,
      failure: { error: true, reason: 'worker-launch-unconfirmed', message: 'launch unconfirmed', hint: null },
    });

    const { status, stderr } = await scenario.run(['abandon', 'unconfirmed']);
    assert.equal(status, 1);
    assert.match(stderr, /already failed/);
    assert.doesNotMatch(stderr, /settled by ordinary recovery/);
  } finally {
    await scenario.server.close();
  }
});

test('a pending cancellation is reported as still standing, and bounded', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // MC/DC twin of the plain stale wedge above: identical but for
    // `cancel_requested_at`. `finish` does not clear that column and the
    // heartbeat's read of it is not state-guarded, so an abandoned-but-alive
    // worker still sees the request and exits — the operator's best news, and it
    // was being contradicted by a flat "never asked to stop".
    wedge(scenario.state, { cancelAgoMs: 1_000 });

    const { status, stdout } = await scenario.run(['abandon', 'wedged']);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /cancellation was already pending/);
    // Bounded, because retention can prune the row out from under the promise.
    assert.match(stdout, /while this row lasts/);
    assert.doesNotMatch(stdout, /never asked to stop/);
  } finally {
    await scenario.server.close();
  }
});

test('the sleep caveat rides on a STALE beat, not on --force', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    wedge(scenario.state); // stale beat
    const stale = await scenario.run(['abandon', 'wedged']);
    assert.equal(stale.status, 0, stale.stderr);
    assert.match(stale.stdout, /may simply resume/);
    // The positive control for the two `doesNotMatch` on this phrase in this same
    // file: a plain wedge with no cancellation pending prints the default arm.
    // It lived here before a file split carried it away from the branch it
    // proved, and its absence is invisible to a green run.
    assert.match(stale.stdout, /never asked to stop/);

    // The twin differs in exactly one predicate: beat freshness. `--force` is
    // only what makes the fresh arm reachable at all — a forced STALE row still
    // resolves `stale` and would still print the caveat, so the discriminator is
    // the beat, not the flag.
    wedge(scenario.state, { id: 'fresh', beatAgoMs: FRESH });
    const forced = await scenario.run(['abandon', '--force', 'fresh']);
    assert.equal(forced.status, 0, forced.stderr);
    assert.doesNotMatch(forced.stdout, /may simply resume/);
  } finally {
    await scenario.server.close();
  }
});

test('the pid shown is the one the row STATE makes relevant', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Both columns populated: a running row carrying a stale `waiter_pid` from
    // before it was claimed. Printing "whichever is populated" put two different
    // pids in one invocation — the descriptor's and the stored record's.
    insertSynthetic(scenario.state, {
      id: 'twopids', state: 'running', workerPid: process.pid, waiterPid: 999_999,
      startedAgoMs: 600_000, beatAgoMs: STALE,
    });

    const { stdout } = await scenario.run(['abandon', 'twopids']);
    assert.match(stdout, new RegExp(`pid ${process.pid}\\b`));
    assert.doesNotMatch(stdout, /999999/);
  } finally {
    await scenario.server.close();
  }
});

test('a database a newer plugin wrote refuses at the DATABASE level', { skip: NEEDS_SQLITE }, async () => {
  const { setUserVersion } = await import('./job-helpers.mjs');
  const scenario = await queueScenario();
  try {
    // Row stays at schema_version 1, so only the database gate can refuse — and
    // the phrase asserted is the DB-level one, which the row-level refusal does
    // not contain.
    wedge(scenario.state);
    setUserVersion(scenario.state, 99);

    const { status, stderr } = await scenario.run(['abandon', 'wedged']);
    assert.equal(status, 1);
    assert.match(stderr, /this build understands/);
    // No `readJob` here, and the reason is the point: the test helper opens the
    // store the same way the command does, so it refuses the too-new database
    // too. That the row cannot be read back through the ordinary path IS the
    // guarantee — a build that would not read it will not have written it.
  } finally {
    await scenario.server.close();
  }
});
