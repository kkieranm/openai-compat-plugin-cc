// A background job's `baseUrl` can be secret-shaped, and a transport
// or protocol failure used to echo it verbatim into two persisted, longer-lived
// places: `jobs.db`'s `row.failure.message`, and the worker's own job log
// (`job-spawn.mjs`'s `stdio: ['ignore', log, log]` sends the worker's uncaught
// stderr there). Both sinks are checked here, through the real worker.
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
import { respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, readJob, stateDir, waitForState } from './job-helpers.mjs';

const MARKER = 'SECRET_MARKER_9f2e';

function readJobLog(state, seq) {
  return readFileSync(join(state, 'logs', `${seq}.log`), 'utf8');
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
    const server = await startFakeServer((request, response) => {
      if (request.url.includes('/models')) return respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      response.destroy();
    });
    const state = stateDir();
    const baseUrl = `${server.baseUrl}/${MARKER}`;
    const { path: configPath } = writeConfig({
      providers: { fake: { baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 } },
      defaultProvider: 'fake',
    });

    try {
      const submit = await runCompanion(['task', '--background', 'anything'], {
        configPath,
        env: { OAI_PLUGIN_STATE: state },
      });
      assert.equal(submit.status, 0, `submit failed: ${submit.stderr}`);
      const id = submit.stdout.trim();

      const row = await waitForState(state, id, ['completed', 'failed']);
      assert.equal(row.state, 'failed', 'the worker could not complete the chat request');
      const serializedFailure = JSON.stringify(row.failure);
      assert.doesNotMatch(serializedFailure, new RegExp(MARKER), 'jobs.db must not carry the marker');

      const log = readJobLog(state, row.seq);
      assert.doesNotMatch(log, new RegExp(MARKER), 'the job log must not carry the marker either');
    } finally {
      await server.close().catch(() => {});
    }
  },
);

test(
  'a marker-bearing echoed error body after a successful probe leaves the marker out of both sinks',
  { skip: NEEDS_SQLITE },
  async () => {
    const server = await startFakeServer((request, response) => {
      if (request.url.includes('/models')) return respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      // A server echoing the request path back in a 404 body — the assertOk
      // vector, distinct from the connection-failure one above.
      respondJson(response, { error: `Unexpected endpoint or method. (POST ${request.url})` }, 404);
    });
    const state = stateDir();
    const baseUrl = `${server.baseUrl}/${MARKER}`;
    const { path: configPath } = writeConfig({
      providers: { fake: { baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 } },
      defaultProvider: 'fake',
    });

    try {
      const submit = await runCompanion(['task', '--background', 'anything'], {
        configPath,
        env: { OAI_PLUGIN_STATE: state },
      });
      assert.equal(submit.status, 0, `submit failed: ${submit.stderr}`);
      const id = submit.stdout.trim();

      const row = await waitForState(state, id, ['completed', 'failed']);
      assert.equal(row.state, 'failed', 'the chat request was refused with a 404');
      const serializedFailure = JSON.stringify(row.failure);
      assert.doesNotMatch(serializedFailure, new RegExp(MARKER), 'jobs.db must not carry the echoed marker');

      const log = readJobLog(state, row.seq);
      assert.doesNotMatch(log, new RegExp(MARKER), 'the job log must not carry the echoed marker either');
    } finally {
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
