// What the queue does with rows it did not write: a foreign plugin's version, a
// shape this build cannot produce, and a submission whose worker never came.
//
// Every case here is a wedge if it is decided the other way — a row that blocks
// forever, or a live job destroyed by a build that could not read it. They are
// driven through the real worker against synthetic rows rather than argued
// about, because the two failures look identical from the outside until one of
// them eats a job.
import assert from 'node:assert/strict';
import test from 'node:test';
import { NEEDS_SQLITE, deadPid, insertSynthetic, queueScenario, readJob, waitForState } from './job-helpers.mjs';

const THREE_MINUTES = 180_000;

/** Submit one background job and wait for wherever it ends up. */
async function submitAndSettle(scenario, extra = []) {
  const submit = await scenario.submit(extra);
  assert.equal(submit.status, 0, submit.stderr);
  return waitForState(scenario.state, submit.stdout.trim(), ['completed', 'failed', 'queue-timeout']);
}

test('a running row with no pid blocks the queue rather than being guessed at', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // This build writes state and pid in one statement, so only a legacy or
    // corrupt writer produces this. It fails closed: something may be running.
    insertSynthetic(scenario.state, { id: 'malformed', state: 'running', workerPid: null });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout');
    assert.equal(scenario.chats().length, 0, 'nothing may run past a blocker this build cannot interpret');
    assert.equal(readJob(scenario.state, 'malformed').state, 'running', 'the malformed row must be left alone');
  } finally {
    await scenario.server.close();
  }
});

test('a dead running row from a newer plugin neither blocks nor gets written to', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The self-contradiction that would wedge the queue permanently: it counts
    // as a blocker, and the versioning rule forbids reconciling it away.
    const pid = await deadPid();
    insertSynthetic(scenario.state, { id: 'foreign', state: 'running', version: 99, workerPid: pid });

    const settled = await submitAndSettle(scenario);
    assert.equal(settled.state, 'completed', JSON.stringify(settled.failure));

    const foreign = readJob(scenario.state, 'foreign');
    assert.equal(foreign.state, 'running', 'a newer version’s row must not be terminalized');
    assert.equal(foreign.worker_pid, pid);
    assert.equal(foreign.completed_at, null);
  } finally {
    await scenario.server.close();
  }
});

test('a queued row from a newer plugin blocks while its waiter lives', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // A real worker is waiting on it; we simply cannot read its payload. Going
    // around it would run two jobs at once as soon as its turn came.
    insertSynthetic(scenario.state, { id: 'foreign-live', version: 99, waiterPid: process.pid });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout');
    assert.equal(scenario.chats().length, 0);
    assert.equal(readJob(scenario.state, 'foreign-live').state, 'queued');
  } finally {
    await scenario.server.close();
  }
});

test('a queued row from a newer plugin is skipped, untouched, once its waiter is gone', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const pid = await deadPid();
    insertSynthetic(scenario.state, { id: 'foreign-dead', version: 99, waiterPid: pid });

    const settled = await submitAndSettle(scenario);
    assert.equal(settled.state, 'completed', JSON.stringify(settled.failure));

    // Skipped is not abandoned: the queue moved past it and changed nothing.
    const foreign = readJob(scenario.state, 'foreign-dead');
    assert.equal(foreign.state, 'queued');
    assert.equal(foreign.waiter_pid, pid);
  } finally {
    await scenario.server.close();
  }
});

test('a submission whose worker never arrived is failed once the grace has passed', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The submitter died between committing the row and spawning the child.
    insertSynthetic(scenario.state, { id: 'orphan', agedMs: THREE_MINUTES, waiterPid: null });

    const settled = await submitAndSettle(scenario);
    assert.equal(settled.state, 'completed', 'an orphan must not hold the queue forever');

    const orphan = readJob(scenario.state, 'orphan');
    assert.equal(orphan.state, 'failed');
    assert.equal(orphan.failure.reason, 'worker-never-started');
  } finally {
    await scenario.server.close();
  }
});

test('a worker that registered is never abandoned, however long it waits', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Three minutes past a two-minute grace, and still legitimate: the grace
    // bounds publication-to-registration, nothing else. Reading it as a
    // deadline on waiting would fail every job queued behind a long run, which
    // is the feature this queue exists for.
    insertSynthetic(scenario.state, { id: 'patient', agedMs: THREE_MINUTES, waiterPid: process.pid });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout', 'a registered waiter still holds the head of the queue');

    const patient = readJob(scenario.state, 'patient');
    assert.equal(patient.state, 'queued', 'a registered worker past the grace must not be collected');
    assert.equal(patient.waiter_pid, process.pid);
  } finally {
    await scenario.server.close();
  }
});
