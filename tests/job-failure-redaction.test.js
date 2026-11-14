// A background job's `baseUrl` can be secret-shaped, and a transport or
// protocol failure must not echo it into either persisted, longer-lived place:
// `jobs.db`'s `row.failure.message`, or the worker's own job log
// (`job-spawn.mjs`'s `stdio: ['ignore', log, log]` sends the worker's uncaught
// stderr there). Both sinks are checked here, through the real worker. The log
// is read only once the worker has exited, since its last stderr is written
// after the row is finished.
//
// Submission-time preparation (`task-execute.mjs`'s `prepareTask` ->
// `resolveTarget`) makes a live `/v1/models` probe BEFORE the job row exists —
// so a simply-unreachable `baseUrl` fails at submission, never reaching the
// worker at all. Both variants below let the probe succeed and fail only the
// worker's own request.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { waitForExit } from './cancel-helpers.mjs';
import { respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, pollUntil, readJob, stateDir, waitForState } from './job-helpers.mjs';

const MARKER = 'SECRET_MARKER_9f2e';

function readJobLog(state, seq) {
  return readFileSync(join(state, 'logs', `${seq}.log`), 'utf8');
}

/** A gate the fake server parks chat requests on, counting the chat requests that reached it. */
function chatGate() {
  return { ...Promise.withResolvers(), arrived: 0 };
}

/**
 * The running worker's pid, read once its chat request is parked on `gate`: the
 * row cannot leave `running` while that request is held, short of the profile's
 * 120s first-byte budget expiring. Then the gate opens and the request fails.
 */
async function runningWorker(state, id, gate) {
  await pollUntil(() => gate.arrived > 0, { describe: () => `no chat request from job ${id} reached the gate` });
  const running = await waitForState(state, id, ['running']);
  assert.ok(running.worker_pid, 'a running row names its worker');
  gate.resolve();
  return running.worker_pid;
}

/**
 * The row read once more after the worker exits: its failure must be the one the
 * test first read as terminal. A rewrite before that first read is left to the
 * reason and 404 assertions.
 */
function assertUnchangedAfterExit(state, id, row) {
  const final = readJob(state, id);
  assert.equal(final.state, 'failed');
  assert.deepEqual(final.failure, row.failure, 'the failure was rewritten after the test first read it as terminal');
}

test(
  'a mid-flight connection break after a successful probe leaves the marker out of jobs.db and the job log',
  { skip: NEEDS_SQLITE },
  async () => {
    // Deterministic, not raced: the handler itself destroys the chat
    // connection rather than this test closing the whole server after
    // submission — the worker is a detached process by the time `submit`
    // resolves, so a later `server.close()` races the worker's own dispatch
    // and can land on ECONNRESET instead of the intended failure. This shape
    // reaches `describeFailure`'s generic-fallback branch rather than its
    // ECONNREFUSED one — that branch is separately and deterministically
    // covered in transport-classification.test.js; this test's job is only
    // to prove the two persistence sinks stay clean for a REAL worker
    // failure, which holds for either branch.
    const gate = chatGate();
    const server = await startFakeServer(async (request, response) => {
      if (request.url.includes('/models')) return respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      if (request.url.includes('chat/completions')) {
        gate.arrived += 1;
        await gate.promise;
      }
      response.destroy();
    });
    const state = stateDir();
    const baseUrl = `${server.baseUrl}/${MARKER}`;
    const { path: configPath } = writeConfig({
      providers: { fake: { baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 120 } },
      defaultProvider: 'fake',
    });

    try {
      const submit = await runCompanion(['task', '--background', 'anything'], {
        configPath,
        env: { OAI_PLUGIN_STATE: state },
      });
      assert.equal(submit.status, 0, `submit failed: ${submit.stderr}`);
      const id = submit.stdout.trim();
      const pid = await runningWorker(state, id, gate);

      const row = await waitForState(state, id, ['completed', 'failed']);
      assert.equal(row.state, 'failed', 'the worker could not complete the chat request');
      assert.equal(row.failure.reason, 'transport', `expected the connection break, got ${JSON.stringify(row.failure)}`);
      const serializedFailure = JSON.stringify(row.failure);
      assert.doesNotMatch(serializedFailure, new RegExp(MARKER), 'jobs.db must not carry the marker');

      await waitForExit(pid);
      assertUnchangedAfterExit(state, id, row);
      const log = readJobLog(state, row.seq);
      assert.doesNotMatch(log, new RegExp(MARKER), 'the job log must not carry the marker either');
    } finally {
      gate.resolve();
      await server.close().catch(() => {});
    }
  },
);

test(
  'a marker-bearing echoed error body after a successful probe leaves the marker out of both sinks',
  { skip: NEEDS_SQLITE },
  async () => {
    const gate = chatGate();
    const server = await startFakeServer(async (request, response) => {
      if (request.url.includes('/models')) return respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      if (request.url.includes('chat/completions')) {
        gate.arrived += 1;
        await gate.promise;
      }
      // A server echoing the request path back in a 404 body — the assertOk
      // vector, distinct from the connection-failure one above.
      respondJson(response, { error: `Unexpected endpoint or method. (POST ${request.url})` }, 404);
    });
    const state = stateDir();
    const baseUrl = `${server.baseUrl}/${MARKER}`;
    const { path: configPath } = writeConfig({
      providers: { fake: { baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 120 } },
      defaultProvider: 'fake',
    });

    try {
      const submit = await runCompanion(['task', '--background', 'anything'], {
        configPath,
        env: { OAI_PLUGIN_STATE: state },
      });
      assert.equal(submit.status, 0, `submit failed: ${submit.stderr}`);
      const id = submit.stdout.trim();
      const pid = await runningWorker(state, id, gate);

      const row = await waitForState(state, id, ['completed', 'failed']);
      assert.equal(row.state, 'failed', 'the chat request was refused with a 404');
      assert.match(row.failure.message, /HTTP 404/, `expected the 404, got ${JSON.stringify(row.failure)}`);
      const serializedFailure = JSON.stringify(row.failure);
      assert.doesNotMatch(serializedFailure, new RegExp(MARKER), 'jobs.db must not carry the echoed marker');

      await waitForExit(pid);
      assertUnchangedAfterExit(state, id, row);
      const log = readJobLog(state, row.seq);
      assert.doesNotMatch(log, new RegExp(MARKER), 'the job log must not carry the echoed marker either');
    } finally {
      gate.resolve();
      await server.close();
    }
  },
);

test('a genuinely interactive command still names the endpoint in full on stderr', async () => {
  const marker = 'SECRET_MARKER_9f2e';
  const baseUrl = `http://127.0.0.1:1/${marker}`;
  const { path: configPath } = writeConfig({
    providers: { fake: { baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 } },
    defaultProvider: 'fake',
  });

  // Foreground, not --background: the allowlist in oai-companion.mjs's
  // main().catch is what still appends `error.endpoint` here — the same
  // failure that must stay generic once persisted from the worker path.
  const result = await runCompanion(['task', 'anything'], { configPath });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(marker), 'an operator reading their own terminal still sees the endpoint');
});
