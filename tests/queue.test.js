// One background job at a time — proved with real processes, a real database
// and a server that counts overlap for itself.
//
// The property is not "the rows look sequential". It is that the server never
// has two chat completions open at once, because two loaded models is what this
// machine's memory ceiling cannot take.
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { finish } from '../plugins/oai/scripts/lib/job-record.mjs';
import { waitForExit } from './cancel-helpers.mjs';
import { NEEDS_SQLITE, deadPid, insertSynthetic, pollUntil, queueScenario, readJob, stateDir, waitForState, waitForWaiter, withStore } from './job-helpers.mjs';

test('two jobs submitted at once run one after the other, never together', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario({ delayMs: 400 });
  try {
    // Submitted concurrently on purpose: both workers race for the head of the
    // queue, which is the case the eligibility transaction exists for.
    const [first, second] = await Promise.all([scenario.submit(), scenario.submit()]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);

    const a = await waitForState(scenario.state, first.stdout.trim(), ['completed', 'failed']);
    const b = await waitForState(scenario.state, second.stdout.trim(), ['completed', 'failed']);
    assert.equal(a.state, 'completed', JSON.stringify(a.failure));
    assert.equal(b.state, 'completed', JSON.stringify(b.failure));

    assert.equal(scenario.tracker.maxInFlight, 1, 'two chat completions were open at the same time');
    assert.equal(scenario.chats().length, 2);

    // And they ran in queue order, which is what `seq` promises.
    const [earlier, later] = a.seq < b.seq ? [a, b] : [b, a];
    assert.ok(
      later.started_at >= earlier.completed_at,
      `job ${later.seq} started at ${later.started_at}, before job ${earlier.seq} finished at ${earlier.completed_at}`,
    );
  } finally {
    await scenario.server.close();
  }
});

test('--max-wait gives up while still queued, without sending a chat completion', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario({ hold: true });
  try {
    const first = await scenario.submit();
    assert.equal(first.status, 0, first.stderr);
    // Wait until it genuinely holds the queue, so the second job is refused a
    // turn rather than racing for one.
    await waitForState(scenario.state, first.stdout.trim(), ['running']);

    const second = await scenario.submit(['--max-wait', '1']);
    assert.equal(second.status, 0, second.stderr);
    const timed = await waitForState(scenario.state, second.stdout.trim(), ['queue-timeout', 'completed', 'failed']);

    assert.equal(timed.state, 'queue-timeout', `expected a timeout, got ${timed.state}`);
    assert.equal(timed.failure.reason, 'queue-timeout');

    scenario.release();
    const held = await waitForState(scenario.state, first.stdout.trim(), ['completed', 'failed']);
    assert.equal(held.state, 'completed', 'the running job must be unaffected by a successor giving up');
    // The loser's exit, so a dispatch it made after writing its timeout is counted.
    await waitForExit(timed.waiter_pid);
    // Counted once the first job is done: `running` proves it owns the queue, not
    // that its chat has reached the server yet. The guarantee is scoped to the
    // expensive request: submission already probed /v1/models in the foreground,
    // and that probe is expected.
    assert.equal(scenario.chats().length, 1, 'the job that timed out must never have reached the model');
  } finally {
    scenario.release();
    await scenario.server.close();
  }
});

test('a worker whose job goes terminal before its turn contacts nothing', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario({ hold: true });
  try {
    const first = await scenario.submit();
    await waitForState(scenario.state, first.stdout.trim(), ['running']);

    const second = await scenario.submit();
    // Waited for, not sampled: the row exists the moment it is inserted, and a
    // worker that has not registered yet is not the loser this test is about.
    const queued = await waitForWaiter(scenario.state, second.stdout.trim());

    // Something else terminalizes it while it waits: exactly what cancel does.
    withStore(scenario.state, (db) => {
      assert.ok(finish(db, queued.seq, { state: 'cancelled', at: new Date().toISOString() }));
    });

    scenario.release();
    await waitForState(scenario.state, first.stdout.trim(), ['completed', 'failed']);
    // The loser's exit, not a sleep: once it has gone it can no longer dispatch.
    await waitForExit(queued.waiter_pid);

    assert.equal(readJob(scenario.state, second.stdout.trim()).state, 'cancelled');
    assert.equal(scenario.chats().length, 1, 'the losing worker must not have sent a request');
  } finally {
    scenario.release();
    await scenario.server.close();
  }
});

test('a held queueScenario answers a chat that arrives after release', async () => {
  const scenario = await queueScenario({ hold: true });
  try {
    scenario.release();
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(`${scenario.server.baseUrl}/chat/completions`, { method: 'POST' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.setTimeout(60_000, () => req.destroy(new Error('the chat was held after release')));
      req.end('{}');
    });
    assert.equal(status, 200);
    assert.equal(scenario.tracker.inFlight, 0);
  } finally {
    scenario.release();
    await scenario.server.close();
  }
});

test('a wait whose deadline has passed reads once more, and then gives up', { skip: NEEDS_SQLITE }, async () => {
  // A zero budget is the starved poll in its limit: the deadline is gone before
  // the first look. A condition that already holds is still seen; one that does
  // not is reported rather than waited on forever.
  assert.equal(await pollUntil(() => 'seen', { timeoutMs: 0, describe: () => 'unused' }), 'seen');
  await assert.rejects(pollUntil(() => null, { timeoutMs: 0, describe: () => 'never held' }), /never held/);

  const state = stateDir();
  insertSynthetic(state, { id: 'done', state: 'completed' });
  insertSynthetic(state, { id: 'waiting', waiterPid: process.pid });
  insertSynthetic(state, { id: 'unclaimed' });
  assert.equal((await waitForState(state, 'done', ['completed'], { timeoutMs: 0 })).state, 'completed');
  await assert.rejects(waitForState(state, 'done', ['running'], { timeoutMs: 0 }), /never reached running; last state was completed/);
  assert.equal((await waitForWaiter(state, 'waiting', { timeoutMs: 0 })).waiter_pid, process.pid);
  await assert.rejects(waitForWaiter(state, 'unclaimed', { timeoutMs: 0 }), /no worker registered as waiting for job unclaimed; its state is queued/);
  await waitForExit(await deadPid(), { timeoutMs: 0 });
  await assert.rejects(waitForExit(process.pid, { timeoutMs: 0 }), /still alive at the deadline/);
  // A pid the OS cannot be asked about is refused, not read as gone.
  await assert.rejects(waitForExit(undefined, { timeoutMs: 0 }), /needs a pid the OS can be asked about/);
  await assert.rejects(waitForExit(2 ** 31, { timeoutMs: 0 }), /needs a pid the OS can be asked about/);
});
