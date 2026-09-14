// `/oai:cancel`, which is the one command here that deliberately does not do
// what it says at the moment it is asked.
//
// Nothing is signalled and no verdict is written. The command records a request,
// the worker reads it at its own next check-in and exits, and a later reader
// turns the dead pid into a terminal state — `cancelled` when the worker
// announced its exit, `cancel-unconfirmed` when it did not.
//
// Wherever a test is ABOUT a worker exiting it drives a real second process and
// watches it go, because the mechanism is a process exiting and a test that never
// watched one would be testing a comment. Where the subject is instead what a
// reader makes of a row — the never-picked-up case below — the fixture is a
// synthetic row, there being no worker in that story to spawn.
//
// What a WORKER does on its way out, and what a later reader makes of it, are
// split: the second lives in `cancel-confirmation.test.js`, which is where the
// acknowledgement file and every verdict read out of its absence are tested.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readAck, waitForExit } from './cancel-helpers.mjs';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, readJob, setUserVersion, waitForState } from './job-helpers.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A row is `queued` the instant it is written; a worker registers a moment later. */
async function waitForWaiter(state, id, { timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = readJob(state, id);
    if (row?.waiter_pid) return row;
    await sleep(50);
  }
  throw new Error(`no worker ever registered as waiting for job ${id}`);
}

test('cancel records the request and terminalizes nothing', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // This test process's own pid, so the row's worker is genuinely alive for
    // the whole test: nothing can terminalize it behind the assertion, which is
    // what makes "cancel wrote no verdict" a statement about cancel.
    insertSynthetic(scenario.state, {
      id: 'inflight', state: 'running', workerPid: process.pid, startedAgoMs: 5000, beatAgoMs: 1000,
    });

    const cancel = await scenario.run(['cancel', 'inflight']);
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.match(cancel.stdout, /Cancelling job inflight/);

    const row = readJob(scenario.state, 'inflight');
    assert.equal(row.state, 'running', 'only an observed exit may produce a verdict');
    assert.ok(row.cancel_requested_at, 'the request is the one thing cancel writes');
    assert.equal(row.completed_at, null);

    // And a reader must see the pending request, or someone who has just
    // cancelled a job reads `running` and concludes it was lost.
    const status = await scenario.run(['status', 'inflight']);
    assert.match(status.stdout, /job inflight\s+cancelling/);
    assert.match(status.stdout, /stops at its next check-in/);
    // **Both outcomes, because an exit alone stopped deciding the verdict.** A
    // worker that crashes, or whose acknowledgement will
    // not write, exits and reads `cancel-unconfirmed`. Someone told the first and
    // shown the second would think their cancellation had been lost. Asserted on
    // the RENDERED line rather than the template, so the promise cannot come back
    // without this reddening.
    assert.match(status.stdout, /cancel-unconfirmed/, 'a cancelling note that names only the happy path is a promise this build cannot keep');
    assert.doesNotMatch(status.stdout, /reads cancelled once its worker has exited/);
  } finally {
    await scenario.server.close();
  }
});

test('a running worker exits at its next check-in, and the next read says cancelled', { skip: NEEDS_SQLITE }, async () => {
  // Long enough that the model call is unambiguously still in flight when the
  // cancellation lands: the worker is inside a request, with no signal handler
  // and nothing sent to it, so the only thing that can end it is the row it
  // reads at its own heartbeat.
  const scenario = await queueScenario({ delayMs: 20_000 });
  try {
    const submit = await scenario.submit();
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();
    const running = await waitForState(scenario.state, id, ['running']);

    const cancel = await scenario.run(['cancel', id]);
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.match(cancel.stdout, new RegExp(`Cancelling job ${id}, running since`));

    await waitForExit(running.worker_pid);
    assert.equal(readJob(scenario.state, id).state, 'running', 'the exiting worker writes no ROW itself');
    // What it DOES write, and the reason the verdict below is `cancelled` rather
    // than a death: a file beside the log, bearing this row's id. Read here
    // rather than asserted only through the verdict, so a mechanism that stopped
    // working would fail as itself instead of as a state machine.
    assert.equal(readAck(scenario.state, running.seq), id, 'the exit is announced, or it cannot be told from a crash');

    const status = await scenario.run(['status', id]);
    assert.match(status.stdout, new RegExp(`job ${id}\\s+cancelled`));
    const row = readJob(scenario.state, id);
    assert.equal(row.state, 'cancelled');
    assert.equal(row.outcome, null);
    assert.equal(row.failure, null, 'a cancellation is not a failure and must not be reported as one');
  } finally {
    await scenario.server.close();
  }
});

test('cancelling a queued job stops it before it reaches the model at all', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario({ delayMs: 6000 });
  try {
    const first = await scenario.submit();
    const firstId = first.stdout.trim();
    await waitForState(scenario.state, firstId, ['running']);

    const second = await scenario.submit();
    const secondId = second.stdout.trim();
    // Its waiter pid is what makes a queued job cancellable at all: without a
    // pid whose death can be observed there is nothing to turn into a verdict.
    const queued = await waitForWaiter(scenario.state, secondId);

    const cancel = await scenario.run(['cancel', secondId]);
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.match(cancel.stdout, /still queued, so no request will be sent/);

    await waitForExit(queued.waiter_pid);
    await scenario.run(['status', '--all']);
    assert.equal(readJob(scenario.state, secondId).state, 'cancelled');
    // The witness that the reconciler did not over-reach: a queued row is
    // provably request-free — acquisition is what makes it `running` — so its
    // verdict is reached with NO acknowledgement to consult, and none was left.
    assert.equal(readAck(scenario.state, queued.seq), null, 'a queued exit needs no evidence and produces none');

    await waitForState(scenario.state, firstId, ['completed']);
    // The assertion the queued case exists for, counted on the server rather
    // than inferred from the row: a job cancelled before its turn costs no model
    // call, which on this machine is the difference between seconds and minutes.
    assert.equal(scenario.chats().length, 1, 'the cancelled job must never have reached the model');
  } finally {
    await scenario.server.close();
  }
});

test('a job that already finished is reported rather than cancelled', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'donealready', state: 'completed', startedAgoMs: 9000, outcome: { content: 'the answer' },
    });

    const cancel = await scenario.run(['cancel', 'donealready']);
    assert.equal(cancel.status, 0, 'a job that finished first is not an error — the user got what they wanted');
    assert.match(cancel.stdout, /had already completed/);
    assert.match(cancel.stdout, /\/oai:result donealready/);

    // The guard on the write is what makes the re-read honest: a terminal row is
    // not touched, so no later reader can mistake a completed job for one that
    // was on its way to being cancelled.
    assert.equal(readJob(scenario.state, 'donealready').cancel_requested_at, null);
  } finally {
    await scenario.server.close();
  }
});

test('a cancelled job nothing ever picked up reads cancelled, not failed', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Two rows identical but for the cancellation, so the difference between the
    // two verdicts is attributable to the one field. Both are jobs whose
    // submitter died between committing the row and spawning a worker, long
    // enough ago to be past the startup grace.
    insertSynthetic(scenario.state, { id: 'neverran', state: 'queued', agedMs: 300_000, cancelAgoMs: 1000 });
    insertSynthetic(scenario.state, { id: 'alsoneverran', state: 'queued', agedMs: 300_000 });

    await scenario.run(['status', '--all']);

    const cancelled = readJob(scenario.state, 'neverran');
    assert.equal(cancelled.state, 'cancelled', 'a granted request is not a fault');
    assert.equal(cancelled.failure, null);

    const abandoned = readJob(scenario.state, 'alsoneverran');
    assert.equal(abandoned.state, 'failed', 'without the cancellation the same row is an abandoned job');
    assert.equal(abandoned.failure.reason, 'worker-never-started');
    // The hint consults no evidence at all, so it may not name a cause. It used
    // to say the submitting process "most likely died", which this row cannot
    // establish: `spawned_at` can be NULL while a real worker exists.
    assert.doesNotMatch(abandoned.failure.hint, /submitted it/, 'a hint that consults nothing may not name a cause');
    // It may not assert an ABSENCE either: a worker that started and died before
    // registering can have printed its own reason to the log this row's grace then
    // terminalizes past. So the hint scopes the ignorance to itself and points there.
    assert.match(abandoned.failure.hint, /Nothing here establishes why/);
    assert.match(abandoned.failure.hint, /may have printed its own reason/);
  } finally {
    await scenario.server.close();
  }
});

test('cancel refuses an unknown id, a missing id, and a database it may not write to', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Creates the database, so the unknown-id refusal below is the one about a
    // missing job rather than the one about a machine that has never run any.
    insertSynthetic(scenario.state, { id: 'foreign', state: 'running', workerPid: process.pid });

    const unknown = await scenario.run(['cancel', 'nosuchjob']);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /No job with id "nosuchjob"/);
    assert.equal(unknown.stdout, '');

    const bare = await scenario.run(['cancel']);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /needs a job id/);

    setUserVersion(scenario.state, 99);
    const foreign = await scenario.run(['cancel', 'foreign']);
    assert.equal(foreign.status, 1, 'cancelling is a write, and this build may not write to a newer schema');
    assert.match(foreign.stderr, /newer version of the plugin/);

    setUserVersion(scenario.state, 1);
    assert.equal(readJob(scenario.state, 'foreign').cancel_requested_at, null, 'and it wrote nothing on the way to refusing');
  } finally {
    await scenario.server.close();
  }
});
