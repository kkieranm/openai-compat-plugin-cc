// The spike: can a detached worker be launched, survive its parent, and be
// observed from a different process — without hanging the suite?
//
// This is the risky unknown in the whole feature and it is proved before
// anything real is built on it. Everything else here is mechanical; this is not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { readJob, stateDir, waitForState } from './job-helpers.mjs';

/** Answers the model probe and nothing else — phase 1's worker never chats. */
function modelsOnly(id = 'test-model') {
  return (request, response) => {
    if (request.url.includes('/models')) {
      respondJson(response, { data: [{ id, object: 'model' }] });
      return;
    }
    respondJson(response, { error: 'phase 1 worker should not chat' }, 500);
  };
}

test('a background job outlives the command that submitted it', async () => {
  const server = await startFakeServer(modelsOnly());
  const state = stateDir();
  const { path: configPath } = writeConfig({
    providers: {
      // Tiny budgets: a failing case must not drag retries through the suite.
      fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 },
    },
    defaultProvider: 'fake',
  });

  try {
    const submit = await runCompanion(['task', '--background', 'summarise this'], {
      configPath,
      env: { OAI_PLUGIN_STATE: state },
    });

    // If this ever hangs rather than fails, the worker inherited a pipe: see the
    // stdio comment in job-spawn.mjs. `runCompanion` resolves on 'close', which
    // waits for every descriptor the child holds.
    assert.equal(submit.status, 0, `submit failed: ${submit.stderr}`);

    const id = submit.stdout.trim();
    assert.match(id, /^[0-9a-f]{8}$/, `expected a job id on stdout, got ${JSON.stringify(submit.stdout)}`);

    // The submitting process is gone. A *different* process now finds the job.
    const row = await waitForState(state, id, ['completed', 'failed']);
    assert.equal(row.state, 'completed', `worker did not complete: ${JSON.stringify(row.failure)}`);
    assert.equal(row.seq, 1);
    assert.ok(row.worker_pid === null, 'a finished job holds no worker');
  } finally {
    await server.close();
  }
});

test('submission fails in the foreground rather than becoming a broken job', async () => {
  // A server that refuses the probe: the user finds out now, at the prompt, not
  // in a job record they have to go looking for later.
  const server = await startFakeServer((_request, response) => respondJson(response, { error: 'nope' }, 500));
  const state = stateDir();
  const { path: configPath } = writeConfig({
    providers: { fake: { baseUrl: server.baseUrl, timeoutSeconds: 5 } },
    defaultProvider: 'fake',
  });

  try {
    const submit = await runCompanion(['task', '--background', 'anything'], {
      configPath,
      env: { OAI_PLUGIN_STATE: state },
    });
    assert.notEqual(submit.status, 0, 'an unusable provider must not produce a job');
    assert.equal(readJob(state, submit.stdout.trim()), null, 'nothing should have been persisted');
  } finally {
    await server.close();
  }
});

test('the worker command is dispatched but never advertised', async () => {
  const { path: configPath } = writeConfig({ providers: {}, defaultProvider: 'none' });
  const bogus = await runCompanion(['definitely-not-a-command'], { configPath });

  assert.notEqual(bogus.status, 0);
  assert.match(bogus.stderr, /Expected one of: setup, task, review/);
  assert.doesNotMatch(
    bogus.stderr,
    /task-worker/,
    'the internal worker must not be suggested to someone who mistyped a command',
  );
});
