// The completion-after-abandon race — the one this feature exists to make safe.
//
// `--force` on a live worker is allowed to end a row someone is still working
// on. The promise that makes that defensible is that the answer is not
// destroyed: when the worker finally calls `finish()` and its CAS matches
// nothing, it writes the outcome to its own log as `SALVAGED_OUTCOME` instead.
//
// That promise was written and never once executed. This drives it end to end
// across two real processes: a worker held mid-request, an abandon from the
// CLI, then the reply released.
//
// It is a different branch from `job-busy-placement.test.js`, which reaches the
// same salvage line by injecting a storage THROW in-process. This one reaches
// the `false`-return arm, which is the one `/oai:abandon` created.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { completion, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { withBusyRetry } from '../scripts/lib/job-busy.mjs';
import { isAlive } from '../scripts/lib/job-liveness.mjs';
import { sweep } from '../scripts/lib/job-retention.mjs';
import { NEEDS_SQLITE, insertSynthetic, readJob, stateDir, waitForState, withStore } from './job-helpers.mjs';

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

    // The positive control for the sweep below, inserted HERE rather than beside
    // it: `insertSynthetic` writes through `withStore` with no busy retry, and
    // this is the quieter window — after the worker has registered, before the
    // abandon. A `completed` row with no pids is invisible to `decide`'s two
    // rungs, so it cannot disturb the one-job-at-a-time queue this test drives.
    const controlSeq = insertSynthetic(scenario.state, {
      id: 'ordinary', state: 'completed', outcome: { content: 'ok' },
    });
    writeFileSync(join(scenario.state, 'logs', `${controlSeq}.log`), 'ordinary history\n');

    // `--force` is required and is the honest scenario: a worker mid-request is
    // beating, so a plain abandon exits 1 `beating`, the row never goes terminal,
    // `finish()` succeeds, and no salvage ever happens.
    const abandoned = await scenario.run(['abandon', '--force', id]);
    assert.equal(abandoned.status, 0, abandoned.stderr);
    assert.match(abandoned.stdout, /written off as failed/, 'a silent refusal must not pass as setup');

    const row = readJob(scenario.state, id);
    assert.equal(row.state, 'failed');
    assert.equal(row.failure.reason, 'operator-abandoned');

    // Built by hand: `logPathFor` resolves OAI_PLUGIN_STATE at call time, so from
    // this process it would point at the developer's real state directory.
    const log = join(scenario.state, 'logs', `${row.seq}.log`);

    // Retention, run against the real row while its worker is still holding the
    // model call — the exact window this exemption exists to close, and the only
    // place it is exercised end to end. `tests/retention.test.js` proves the exemption on
    // synthetic rows; this proves the file the live worker was handed as its
    // stdout descriptor survives a real sweep of the row it belongs to.
    //
    // `retain: 0` is maximally hostile: every non-exempt terminal row goes. On
    // its own that is not enough to conclude anything — a `PRUNE` that deleted
    // NOTHING would satisfy "the row survived" identically — so the ordinary row
    // above is asserted GONE in the same breath. That is what makes this a
    // measurement of the exemption rather than of the sweep having run at all.
    //
    // Through `withStore` because `sweep()` resolves the logs directory from
    // ambient OAI_PLUGIN_STATE rather than from the handle it is given — called
    // bare from this process it would sweep the developer's own state directory.
    // `withBusyRetry` because the worker beats every few seconds and a beat is a
    // write: this `DELETE … RETURNING` can collide with one. Production's own
    // caller tolerates `SQLITE_BUSY` by skipping the sweep entirely
    // (`task-submit.mjs` `sweepQuietly`), which is not available here — skipping
    // would turn the witness into a no-op that reports success.
    //
    // **Both numbers are set, because the budget alone does not bound the wait.**
    // `budgetMs` is a floor on when giving up begins, not a ceiling on how long
    // it takes, and `openStore` hands back a handle carrying
    // `PRAGMA busy_timeout = 10000` — so ONE attempt can sit in SQLite for ten
    // seconds before the budget is consulted at all. Left at its 30s default that
    // is ~40s of blocked event loop in the process that also HOSTS the fake
    // server, against a worker whose own 30s first-byte clock is running in
    // another process: it would time out, retry, and hit the deliberate
    // `unexpected second request` above. 250ms attempts under a 2s budget bound
    // the whole thing to ~2.25s, far inside that headroom.
    //
    // It covers the sweep statement; the `openStore` ahead of it is bounded by
    // its own budget rather than by this wrapper.
    const swept = withStore(scenario.state, (db) => {
      db.exec('PRAGMA busy_timeout = 250');
      return withBusyRetry(() => sweep(db, { retain: 0 }), { budgetMs: 2_000 });
    });
    // One assertion carrying both facts: the sweep was LIVE, and the abandoned
    // row was not in what it took.
    assert.deepEqual(swept.deleted, [controlSeq], 'the ordinary row went; the abandoned one did not');
    assert.ok(readJob(scenario.state, id), 'the row survived a sweep that took everything else');
    assert.equal(existsSync(log), true, 'and so did the file the worker is about to write its answer into');
    // The file half, which is the actual harm the exemption guards against. Without the control here,
    // "the abandoned log survived" is indistinguishable from "`orphanSeqs`
    // collected nothing at all".
    assert.ok(swept.logs.includes(controlSeq), 'the orphan sweep ran and collected the control');
    assert.equal(
      existsSync(join(scenario.state, 'logs', `${controlSeq}.log`)),
      false,
      "the control's log went with its row, so unlinking was reachable in this run",
    );

    // Now let the model answer. The worker collects it, calls `finish()`, and its
    // CAS matches nothing — the row is already terminal.
    scenario.release();
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
