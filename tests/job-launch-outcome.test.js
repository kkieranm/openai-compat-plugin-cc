// Witnesses for `job-launch-outcome.mjs` — what a submitter may write about a
// launch it could not confirm.
//
// Split from `job-spawn-failure.test.js` when that file crossed its size budget,
// and the seam is the subject rather than the line count: that file is about the
// QUEUE not being held, this one is about the row-level decision underneath it —
// which verb, which claims, and what happens when the write or the report fails.
//
// The constraint every test here turns on: a rejected spawn does NOT establish
// that no child exists, because `spawnWorker` closes its copy of the log
// descriptor after the `'spawn'` event has already fired.
import assert from 'node:assert/strict';
import test from 'node:test';

import { respondJson, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, insertSynthetic, readJobs, stateDir, withStore } from './job-helpers.mjs';
import { TASK_SPEC } from '../scripts/lib/cmd-task.mjs';
import { submitTask } from '../scripts/lib/task-submit.mjs';
import { finish, registerWaiter } from '../scripts/lib/job-record.mjs';

/** Answers the probe, then one non-streaming completion. */
function modelsAndChat(id = 'test-model') {
  return (request, response) => {
    if (request.url.includes('/models')) {
      respondJson(response, { data: [{ id, object: 'model' }] });
      return;
    }
    respondJson(response, {
      model: id,
      choices: [{ message: { content: 'the answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    });
  };
}

/** A submission driven in-process, with the environment restored afterwards. */
async function withSubmission(fn) {
  // Captured above the listen so the `finally` can always restore from it; see
  // the twin of this helper in `job-spawn-failure.test.js` for why.
  const previous = { config: process.env.OAI_PLUGIN_CONFIG, state: process.env.OAI_PLUGIN_STATE };
  const server = await startFakeServer(modelsAndChat());
  // Everything after the listen is inside the `try`, so no setup throw can strand
  // a listening handle and hang the suite.
  let state;
  try {
    state = stateDir();
    const { path: configPath } = writeConfig({
      providers: {
        fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 },
      },
      defaultProvider: 'fake',
    });
    process.env.OAI_PLUGIN_CONFIG = configPath;
    process.env.OAI_PLUGIN_STATE = state;
    return await fn({ state });
  } finally {
    if (previous.config === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous.config;
    if (previous.state === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous.state;
    await server.close();
  }
}

const submission = { spec: TASK_SPEC, options: { background: true }, inlinePrompt: 'summarise this', terminated: [] };

// The ordering the containment design ADMITS, and the one every test above is
// blind to: `spawnWorker` awaits the `'spawn'` event and only then closes its
// copy of the log descriptor, so a throw from that close rejects after a
// detached worker was created and may still be running. The queue-level tests in
// `job-spawn-failure.test.js` all reject without ever creating a child, so none
// of them can see a REGISTERED row being terminalized.
//
// WHAT THIS TEST IS, EXACTLY: a state-machine witness, not a live child. No
// second process exists here — the fixture registers THIS process as the waiter
// and then rejects, which reproduces the only thing the production code can
// observe about that ordering, namely a row already REGISTERED at the moment the
// rejection is handled. A real detached child racing a real failing `closeSync`
// is not something a test can schedule; the row shape is, and the row shape is
// what the CAS reads.
//
// "REGISTERED", never "claimed": `claimJob` is ACQUISITION (`state = 'running'`);
// this row is `queued` with a `waiter_pid`, a worker announcing itself.
test('a rejection against an already-REGISTERED row must not terminalize it', { skip: NEEDS_SQLITE }, async () => {
  await withSubmission(async ({ state }) => {
    const spawn = (seq) => {
      withStore(state, (db) => registerWaiter(db, seq, process.pid, new Date().toISOString()));
      return Promise.reject(new Error('EIO: i/o error closing the log'));
    };

    await assert.rejects(submitTask(submission, { spawn }), /EIO/, 'the launch error still reaches the caller');

    const [row] = readJobs(state);
      // `queued` exactly, never "not failed" — which `cancelled` or `completed`
    // would also satisfy while violating the invariant.
    assert.equal(row.state, 'queued', 'a row a worker has REGISTERED against is not the submitter\'s to write off — it is left exactly as it was, and `queued` is what registration leaves');
    assert.equal(row.completed_at, null, 'and no completion time was written for something that has not completed');
    assert.ok(row.waiter_pid, 'and the REGISTRATION survives — the fact the CAS reads, and the only one this establishes; ownership arrives with the transition to running');
  });
});

test('POSITIVE CONTROL: the same row shape under `finish` IS destroyed', { skip: NEEDS_SQLITE }, async () => {
  // What this control does and does NOT establish, stated because the first
  // version of this comment claimed the larger thing.
  //
  // It establishes that the row shape above is REACHABLE and destructible: that
  // `not failed` is a real property of the verb rather than an artifact of a
  // fixture nothing could ever have written to. Without it, the test above would
  // also pass against a row no write could match.
  //
  // It does NOT establish that production attempted a guarded write at all — a
  // build that simply stopped calling `terminalizeSpawnFailure` would leave both
  // tests green. That mutation is caught by the no-child test above, which
  // requires the row to BE `failed`. The two together bracket it: one says the
  // write happens, the other says it is guarded.
  await withSubmission(async ({ state }) => {
    const seq = insertSynthetic(state, { id: 'live-worker' });
    const flipped = withStore(state, (db) => {
      registerWaiter(db, seq, process.pid, new Date().toISOString());
      return finish(db, seq, { state: 'failed', failure: { reason: 'x' }, at: new Date().toISOString() });
    });
    assert.equal(flipped, true, 'finish matches a row a worker has REGISTERED against — which is why it is not the verb here');
    // The boolean alone would pass against a `finish` that matched and wrote
    // nothing; this control's whole claim is that the row is DESTRUCTIBLE.
    const [row] = readJobs(state);
    assert.equal(row.state, 'failed', 'and the row really was written — the return value is a report, not the evidence');
  });
});

// EVERY guarded site is claimed to have a witness driving a path where a
// busy error is really raised. The seventh site is guarded, so it needs one, and
// every other fault injected in these files is NON-busy. Without this the retry
// is wrapped on an argument no test can contradict.
test('a TRANSIENT busy on the launch-outcome write is retried, not lost', { skip: NEEDS_SQLITE }, async () => {
  await withSubmission(async ({ state }) => {
    const { DatabaseSync } = await import('node:sqlite');
    const original = DatabaseSync.prototype.prepare;
    let busiesLeft = 2;
    DatabaseSync.prototype.prepare = function inject(sql) {
      if (/UPDATE\s+jobs\s+SET\s+state/i.test(sql) && busiesLeft > 0) {
        busiesLeft -= 1;
        const error = new Error('database is locked');
        error.errcode = 5;
        throw error;
      }
      return original.call(this, sql);
    };

    try {
      await assert.rejects(
        submitTask(submission, { spawn: () => Promise.reject(new Error('EACCES: permission denied')) }),
        /EACCES/,
        'the launch error is still what reaches the caller',
      );
      assert.equal(busiesLeft, 0, 'the busies were actually raised — otherwise this test proves nothing');
      assert.equal(readJobs(state)[0].state, 'failed', 'and the retry got the write through');
    } finally {
      DatabaseSync.prototype.prepare = original;
    }
  });
});

// The wrapper around the REPORT. A throw raised inside a `catch` replaces the
// pending rethrow — that defect cost a whole diagnosis once
// already. No other test here ASSERTS what the report produced: most never reach
// the reporting path because their storage write succeeds, and the integrated
// failing-write witness below does reach it — through the real `writeSync` —
// but deliberately does not capture fd 2. Either way, deleting the wrapper
// leaves them all green. That is what made it a safeguard with no witness, and it is
// why this test calls the helper directly rather than through a submission —
// the reporting path needs a failing write AND a failing report, and building a
// server, a config and a spawn around one `catch` would test everything except
// the thing in question.
test('a report that throws does not replace the launch error it accompanies', async () => {
  const { terminalizeSpawnFailure } = await import('../scripts/lib/job-launch-outcome.mjs');
  const launchError = new Error('EACCES: permission denied');
  const db = { prepare() { throw new Error('SQLITE_CORRUPT: malformed database schema'); } };

  // Must not throw: the caller rethrows the launch error itself, and anything
  // escaping here would arrive in its place.
  assert.doesNotThrow(
    () => terminalizeSpawnFailure(db, 1, { id: 'abc123' }, launchError, {
      report: () => { throw new Error('EPIPE: broken pipe'); },
    }),
    'a failing report is the one thing dropped here — it must not become the error the user sees',
  );

  // The control: with a working report the storage fault IS named, so the test
  // above is not passing merely because nothing was ever reported.
  const said = [];
  terminalizeSpawnFailure(db, 1, { id: 'abc123' }, launchError, { report: (m) => said.push(m) });
  assert.match(said.join(''), /Storage failure while recording job abc123/, 'the fault reaches a reader by message');
  assert.match(said.join(''), /SQLITE_CORRUPT/, 'and names itself, rather than being relabelled contention');
});

// The INTEGRATED half of the terminal-write-failure witness, which the modular
// test above cannot cover. That one proves the helper reports and does not throw;
// this one proves the whole submission behaves when the write really fails
// underneath it — the launch error is what the caller gets, and the row is not
// left asserting something the failed write never managed to record.
//
// The stderr half is deliberately NOT asserted here and is not missing: the
// report goes out through `writeSync(2, …)`, which an in-process test cannot
// capture without a subprocess, and the modular test above owns that assertion
// by injecting `report`. Split because each half is checkable somewhere, rather
// than left as one witness that would have to fake the part it cannot see.
test('a failing terminal write leaves the launch error intact and the row unwritten', { skip: NEEDS_SQLITE }, async () => {
  await withSubmission(async ({ state }) => {
    const { DatabaseSync } = await import('node:sqlite');
    const original = DatabaseSync.prototype.prepare;
    let refused = 0;
    DatabaseSync.prototype.prepare = function inject(sql) {
      // Only the launch-outcome write. An indiscriminate throw would take out
      // `insertJob` too, and the test would pass for the wrong reason.
      if (/UPDATE\s+jobs\s+SET\s+state/i.test(sql)) {
        refused += 1;
        throw new Error('SQLITE_CORRUPT: malformed database schema');
      }
      return original.call(this, sql);
    };

    try {
      await assert.rejects(
        submitTask(submission, { spawn: () => Promise.reject(new Error('EACCES: permission denied')) }),
        /EACCES/,
        'the LAUNCH error propagates — never the storage error raised while recording it',
      );
      assert.ok(refused > 0, 'the write was actually attempted and actually refused');
      assert.equal(readJobs(state)[0].state, 'queued', 'the row is untouched — `queued` exactly, not merely "not failed", which `cancelled` or `completed` would also satisfy');
    } finally {
      DatabaseSync.prototype.prepare = original;
    }
  });
});

// The PRODUCTION report path, which every test above bypasses.
//
// The seam that makes the throwing-report case testable also hides the default:
// injecting `report` never runs `reportToStderr`, and the integrated witness runs
// it but cannot capture fd 2 in-process. So replacing the default with a no-op —
// or with an async `process.stderr.write` — left every other assertion green.
// A subprocess removes THAT limit — which is the limit about the default being
// used at all, not the one about drainage. See below.
//
// What it does NOT establish, measured rather than assumed: it is not a drainage
// witness. Swapping `writeSync` for an async `process.stderr.write` leaves this
// test GREEN — the write happened to survive the exit on this run, which is
// precisely the timing-dependence that makes `writeSync` the right call and makes
// the race untestable by observation. This test pins that the DEFAULT is used and
// that its content reaches fd 2; the choice of a synchronous write rests on the
// credential-notice design, not on this assertion.
//
// Async `spawn`, never `spawnSync` — a sync spawn in this suite deadlocks anything
// sharing the event loop (repo footgun), and there is no reason to risk it.
test('the DEFAULT report reaches fd 2 of a real process', async () => {
  const { spawn } = await import('node:child_process');
  const module = new URL('../scripts/lib/job-launch-outcome.mjs', import.meta.url).href;
  // No `report` option: this is the production call. The db throws SQLITE_CORRUPT,
  // which is NOT a busy error — so `withBusyRetry` rethrows it on the first attempt
  // rather than exhausting a budget, and the reporting path is reached immediately.
  // (Said precisely because "the retry exhausts" would describe the busy case,
  // which this test deliberately does not use: a 30-second budget in a subprocess
  // is not something a test should wait out.)
  const script = `
    const { terminalizeSpawnFailure } = await import(${JSON.stringify(module)});
    const db = { prepare() { throw new Error('SQLITE_CORRUPT: forced'); } };
    terminalizeSpawnFailure(db, 1, { id: 'prod123' }, new Error('EACCES'));
    process.exit(2);
  `;
  // The environment is NOT inherited. An inherited `NODE_OPTIONS` can preload a
  // module that alters resolution, writes to stderr itself, or hangs before this
  // script runs at all — so the witness would be reporting on the machine's
  // environment rather than on this code. PATH is passed because the child
  // resolves nothing from it but a scrubbed env is easier to reason about than a
  // filtered one, and the module below is addressed by absolute URL.
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: process.env.PATH },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  // A deadline and an `error` listener, because neither failure has a natural end:
  // a child that hangs would leave the promise pending for the whole suite, and a
  // spawn-level failure with no listener surfaces as an uncaught EventEmitter
  // error rather than as this test failing.
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the child never exited')); }, 30_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (status) => { clearTimeout(timer); resolve(status); });
  });

  // Kept at exactly 2, never relaxed to "nonzero": 2 is the code this script
  // chooses after the reporting path, so it distinguishes a child that ran the
  // code from one that died on its way there. The two content matches below are
  // what stop a silent exit 2 passing.
  assert.equal(code, 2, 'the child ran to its exit, so the write was made by a real process on a real pipe');
  assert.match(stderr, /Storage failure while recording job prod123/, 'the default report reached fd 2');
  assert.match(stderr, /SQLITE_CORRUPT/, 'naming the fault itself, not a relabelled contention error');
});
