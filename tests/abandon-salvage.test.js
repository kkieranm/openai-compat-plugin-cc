// The completion-after-abandon race — the one this feature exists to make safe.
//
// `--force` on a live worker is allowed to end a row someone is still working
// on. The promise that makes that defensible is that the answer is not
// destroyed: when the worker finally calls `finish()` and its CAS matches
// nothing, it writes the outcome to its own log as `SALVAGED_OUTCOME` instead.
//
// That promise was written, reviewed six times, and never once executed. This
// drives it end to end across two real processes: a worker held mid-request, an
// abandon from the CLI, then the reply released.
//
// It is a different branch from `job-busy-placement.test.js`, which reaches the
// same salvage line by injecting a storage THROW in-process. This one reaches
// the `false`-return arm, which is the one `/oai:abandon` created.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { completion, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { isAlive } from '../scripts/lib/job-liveness.mjs';
import { NEEDS_SQLITE, readJob, stateDir, waitForState } from './job-helpers.mjs';

/**
 * A scenario of its own, gating the HTTP REPLY.
 *
 * The local-scenario pattern is not new — `job-auth.test.js` already keeps one,
 * and the name is deliberately not `heldScenario` because that one gates the
 * QUEUE (it releases by finishing a blocker row). Two different gates under one
 * name in one tree is how a reader greps their way to the wrong mechanism.
 *
 * Local rather than a `hold` option on the shared `queueScenario`: exactly one
 * test needs a worker held mid-request, and that option grew a helper every
 * other test pays to read, past its size budget.
 */
async function heldReplyScenario() {
  let held = null;
  const server = await startFakeServer((request, response) => {
    if (!request.url.includes('chat/completions')) {
      respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      return;
    }
    // A second chat request would otherwise overwrite `held`, orphan the first
    // socket, and wedge `server.close()` — which waits for open connections —
    // for the whole suite. Reachable if the abandon ever outran the client's
    // 30s timeout and the worker retried. Answered rather than thrown: an
    // uncaughtException in the test process is worse than the hang it replaces.
    if (held) { respondJson(response, { error: { message: 'unexpected second request' } }, 500); return; }
    held = response; // answered only by release()
    response.on('close', () => { if (held === response) held = null; });
  });
  const { path: configPath } = writeConfig({
    providers: { fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 30 } },
    defaultProvider: 'fake',
  });
  const state = stateDir();
  return {
    server,
    state,
    inFlight: () => held !== null,
    release: () => { const r = held; held = null; if (r) respondJson(r, completion('ok')); },
    run: (args) => runCompanion(args, { configPath, env: { OAI_PLUGIN_STATE: state } }),
    submit: () => runCompanion(['task', '--background', 'do it'], { configPath, env: { OAI_PLUGIN_STATE: state } }),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, { timeoutMs = 15_000, what }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

test('abandoning a live worker does not destroy the answer it was holding', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await heldReplyScenario();
  try {
    const submitted = await scenario.submit();
    assert.equal(submitted.status, 0, submitted.stderr);
    const id = submitted.stdout.trim().split(/\s+/).pop();

    await waitForState(scenario.state, id, ['running']);
    // The model call is genuinely in flight: the handler runs when the request
    // body ends, before any reply, so a held response means the worker is inside
    // its model call. Without this the abandon could land before the worker ever
    // reached the server, and the test would prove nothing.
    await until(() => scenario.inFlight(), { what: 'the chat request to reach the server' });
    // Captured while the row is still `running`: `finish` NULLs it, and the
    // discrimination below needs to know when the worker has actually exited.
    const workerPid = readJob(scenario.state, id).worker_pid;
    assert.ok(workerPid, 'the worker must have registered before this test means anything');

    // `--force` is required and is the honest scenario: a worker mid-request is
    // beating, so a plain abandon exits 1 `beating`, the row never goes terminal,
    // `finish()` succeeds, and no salvage ever happens.
    const abandoned = await scenario.run(['abandon', '--force', id]);
    assert.equal(abandoned.status, 0, abandoned.stderr);
    assert.match(abandoned.stdout, /written off as failed/, 'a silent refusal must not pass as setup');

    const row = readJob(scenario.state, id);
    assert.equal(row.state, 'failed');
    assert.equal(row.failure.reason, 'operator-abandoned');

    // Now let the model answer. The worker collects it, calls `finish()`, and its
    // CAS matches nothing — the row is already terminal.
    scenario.release();

    // Built by hand: `logPathFor` resolves OAI_PLUGIN_STATE at call time, so from
    // this process it would point at the developer's real state directory.
    const log = join(scenario.state, 'logs', `${row.seq}.log`);
    const salvaged = await until(
      () => { try { const t = readFileSync(log, 'utf8'); return t.includes('SALVAGED_OUTCOME') ? t : null; } catch { return null; } },
      { what: 'the worker to salvage its outcome to the job log' },
    );
    assert.match(salvaged, /"content":"ok"/, 'the answer itself must survive, not just the marker');

    // **Which arm wrote it.** `salvageOutcome` is reached two ways: the CAS
    // returning false (this feature's arm) and the completed write THROWING. Both
    // write the same marker, so the marker alone does not discriminate. The throw
    // arm rethrows, and a rethrow in a spawned worker takes exactly one path —
    // `oai-companion.mjs`'s top-level handler, which writes `Unexpected failure:`
    // to this same log and exits 2. `job-busy-placement.test.js` proves that arm
    // rethrows; this asserts that route was not taken.
    //
    // Waited on the worker's death first: on the throw arm the crash line lands
    // moments AFTER the salvage line, so reading the instant the marker appears
    // could pass on a snapshot taken mid-crash.
    await until(() => !isAlive(workerPid), { what: 'the worker process to exit' });
    const final = readFileSync(log, 'utf8');
    assert.doesNotMatch(final, /Unexpected failure:/, 'the completed write must not have thrown');
    assert.doesNotMatch(final, /could not be recorded/, 'and the failure path must not have run either');

    // And the row is STILL the operator's verdict — the completed write matched
    // nothing, so it neither overwrote the abandonment nor vanished silently.
    const after = readJob(scenario.state, id);
    assert.equal(after.state, 'failed');
    assert.equal(after.failure.reason, 'operator-abandoned');
  } finally {
    // Before `server.close()`: the held response is an open connection, and
    // closing the server against it wedges until the client timeout.
    scenario.release();
    await scenario.server.close();
  }
});
