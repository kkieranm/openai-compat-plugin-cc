// What `/oai:abandon` SAYS — the operator-facing half.
//
// Split from `abandon-cli.test.js` when that file outgrew the 300-line budget,
// and the seam is a real one rather than a cut: that file owns which invocations
// work and what the exit code is, this one owns what the operator is told. Nearly
// every finding this feature's review found late was a sentence, not a branch —
// a message claiming drainage it had not earned, a wait that was wrong by 2x, a
// pid presented as a target. So the assertions live together where they can be
// read as one contract.
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

test('the drainage sentence is printed only when a job really can start', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // A stale running blocker with a live waiter behind it: writing it off does
    // free the queue, so the sentence is earned.
    wedge(scenario.state);
    insertSynthetic(scenario.state, {
      id: 'waiting', state: 'queued', waiterPid: process.pid, beatAgoMs: FRESH,
    });

    const drained = await scenario.run(['abandon', 'wedged']);
    assert.equal(drained.status, 0, drained.stderr);
    assert.match(drained.stdout, /a waiting job may start/);
    // Phrased as the snapshot it is — taken inside the write transaction, not a
    // claim about the queue as the reader sees it.
    assert.match(drained.stdout, /At that moment/);
  } finally {
    await scenario.server.close();
  }
});

test('with nothing waiting, no drainage is claimed', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Differs from the test above in exactly one thing: no queued row exists.
    wedge(scenario.state);

    const { status, stdout } = await scenario.run(['abandon', 'wedged']);
    assert.equal(status, 0);
    assert.match(stdout, /written off as failed/, 'the row is still written off');
    assert.doesNotMatch(stdout, /may start/);
  } finally {
    await scenario.server.close();
  }
});

test('a foreign row names its workspace and what it was asked to do', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    wedge(scenario.state, { workspace: '/tmp/somewhere-else', request: { messages: [{ role: 'user', content: 'summarise the release notes' }] } });

    const { status, stdout } = await scenario.run(['abandon', 'wedged']);
    // Foreign rows are the common case, and ending someone's work without being
    // shown whose or what is the disclosure gap this line closes.
    assert.equal(status, 0);
    assert.match(stdout, /submitted from \/tmp\/somewhere-else/);
    assert.match(stdout, /summarise the release notes/);
    assert.equal(readJob(scenario.state, 'wedged').state, 'failed', 'the row must actually be written off');
  } finally {
    await scenario.server.close();
  }
});

test('a row in this workspace is not labelled as coming from elsewhere', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The negative twin: same fixture, workspace set to the cwd the command runs
    // in. Without it, `submitted from` could never fire and the test above would
    // still pass.
    wedge(scenario.state, { workspace: process.cwd() });

    const { stdout } = await scenario.run(['abandon', 'wedged'], { cwd: process.cwd() });
    assert.match(stdout, /written off as failed/);
    assert.doesNotMatch(stdout, /submitted from/);
  } finally {
    await scenario.server.close();
  }
});

test('a job still inside its startup grace is refused, and --force will not lift it', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Queued, no waiter registered yet, submitted seconds ago: a worker that is
    // about to arrive. The grace period exists for exactly this row.
    insertSynthetic(scenario.state, {
      id: 'juststarted', state: 'queued', waiterPid: null, agedMs: 2_000, beatAgoMs: null,
    });

    for (const args of [['abandon', 'juststarted'], ['abandon', '--force', 'juststarted']]) {
      const { status, stderr } = await scenario.run(args);
      assert.equal(status, 1, `${args.join(' ')} must be refused`);
      assert.match(stderr, /startup grace/);
    }
    assert.equal(readJob(scenario.state, 'juststarted').state, 'queued', 'nothing may be written');
  } finally {
    await scenario.server.close();
  }
});
