// One background job at a time — proved with real processes, a real database
// and a server that counts overlap for itself.
//
// The property is not "the rows look sequential". It is that the server never
// has two chat completions open at once, because two loaded models is what this
// machine's memory ceiling cannot take.
import assert from 'node:assert/strict';
import test from 'node:test';
import { finish } from '../scripts/lib/job-record.mjs';
import { queueScenario, readJob, waitForState, withStore } from './job-helpers.mjs';

/** A queued job whose worker has registered — "waiting", not merely "recorded". */
async function waitForWaiter(state, id, { timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = readJob(state, id);
    if (row?.waiter_pid) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} never had a worker register`);
}

test('two jobs submitted at once run one after the other, never together', async () => {
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

test('--max-wait gives up while still queued, without sending a chat completion', async () => {
  const scenario = await queueScenario({ delayMs: 2500 });
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
    // The guarantee is scoped to the expensive request: submission already
    // probed /v1/models in the foreground, and that probe is expected.
    assert.equal(scenario.chats().length, 1, 'the job that timed out must never have reached the model');

    const held = await waitForState(scenario.state, first.stdout.trim(), ['completed', 'failed']);
    assert.equal(held.state, 'completed', 'the running job must be unaffected by a successor giving up');
  } finally {
    await scenario.server.close();
  }
});

test('a worker whose job goes terminal before its turn contacts nothing', async () => {
  const scenario = await queueScenario({ delayMs: 1500 });
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

    await waitForState(scenario.state, first.stdout.trim(), ['completed', 'failed']);
    // Give the loser its next poll after the queue cleared: if it were going to
    // dispatch, this is when.
    await new Promise((resolve) => setTimeout(resolve, 600));

    assert.equal(readJob(scenario.state, second.stdout.trim()).state, 'cancelled');
    assert.equal(scenario.chats().length, 1, 'the losing worker must not have sent a request');
  } finally {
    await scenario.server.close();
  }
});
