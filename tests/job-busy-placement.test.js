// Three defects that a retry cannot fix, because they are about WHERE the retry
// sits and what happens when it runs out.
//
// `job-busy.test.js` proves each wrapped write survives a TRANSIENT busy. None
// of that says anything about the exhausted case, or about a write whose failure
// is handled by a catch that then publishes something false. Both were found by
// review of the fix, not of the original code.
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';

import { respondJson, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, readJob, stateDir, waitForState, withStore } from './job-helpers.mjs';
import { TASK_SPEC } from '../scripts/lib/cmd-task.mjs';
import { submitTask } from '../scripts/lib/task-submit.mjs';

/** The shape SQLite raises, as `isBusy` recognises it. */
function busyError() {
  const error = new Error('database is locked');
  error.errcode = 5;
  return error;
}

/** Point a synthetic job's transport at a live server so the chat succeeds. */
function redirect(state, seq, baseUrl) {
  withStore(state, (db) =>
    db.prepare('UPDATE jobs SET transport = ? WHERE seq = ?')
      .run(JSON.stringify({ name: 'fake', baseUrl: `${baseUrl}/v1`, query: '' }), seq));
}

test('a storage failure on the COMPLETED write is never republished as a task failure', { skip: NEEDS_SQLITE }, async () => {
  // The defect: the completed write used to sit inside the try whose catch
  // publishes `failed`. When it exhausted its retry budget the busy propagated
  // into that catch, which wrote `failed` — and by then contention had had
  // thirty seconds to clear, so that write very likely SUCCEEDED. An answer that
  // existed was published as a task failure.
  //
  // Driven with a NON-busy storage error rather than a thirty-second lock,
  // because the two reach the identical line by the identical route and only one
  // of them costs the suite half a minute. What is under test is the PLACEMENT:
  // whichever way the completed write fails, the `failed` write must not follow
  // it.
  const scenario = await queueScenario();
  const { DatabaseSync } = await import('node:sqlite');
  const originalPrepare = DatabaseSync.prototype.prepare;
  const originalWrite = process.stderr.write.bind(process.stderr);
  const previous = process.env.OAI_PLUGIN_STATE;
  let errors = '';
  let injected = 0;
  try {
    const seq = insertSynthetic(scenario.state, { id: 'placement' });
    redirect(scenario.state, seq, scenario.server.baseUrl);
    process.env.OAI_PLUGIN_STATE = scenario.state;
    // In a real worker this descriptor IS the job log; in-process it is the
    // suite's stderr, so it is captured rather than read back off disk.
    process.stderr.write = (chunk, ...rest) => {
      errors += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return originalWrite(chunk, ...rest);
    };

    DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
      const statement = originalPrepare.call(this, sql, ...rest);
      if (!/completed_at\s*=\s*\?/.test(sql)) return statement;
      const run = statement.run.bind(statement);
      statement.run = (...params) => {
        // params[0] is the state this write publishes: fail only `completed`, so
        // a `failed` write that should never happen is free to succeed and be
        // observed.
        if (params[0] === 'completed' && injected === 0) {
          injected += 1;
          const error = new Error('disk I/O error');
          error.errcode = 10;
          throw error;
        }
        return run(...params);
      };
      return statement;
    };

    const { runTaskWorker } = await import('../scripts/lib/cmd-task-worker.mjs');
    await assert.rejects(() => runTaskWorker(['--seq', String(seq)]), /disk I\/O error/);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    process.stderr.write = originalWrite;
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
    await scenario.server.close();
  }

  assert.equal(injected, 1, 'the injection never fired: this witness is examining nothing');
  const row = withStore(scenario.state, (db) => db.prepare("SELECT state FROM jobs WHERE id = 'placement'").get());
  assert.notEqual(row.state, 'failed', 'an answer that exists must never be published as a task failure');
  assert.equal(row.state, 'running', 'no ROW is written: it stays running for reconciliation to judge by pid');

  // The other half of the fix, and the half the verdict point demanded: not
  // publishing `failed` keeps the answer from being mislabelled, but only this
  // keeps it from being LOST. The row above is deliberately unhelpful, so the
  // log line is the entire remaining record of a reply that was paid for.
  const salvaged = errors.split('\n').find((line) => line.startsWith('SALVAGED_OUTCOME'));
  assert.ok(salvaged, `the outcome was never salvaged; stderr was: ${JSON.stringify(errors)}`);
  assert.match(salvaged, /"content":"ok"/, 'the salvaged line must carry the reply, not merely announce one');
  assert.ok(
    salvaged.startsWith('SALVAGED_OUTCOME '),
    'the prefix is what makes it findable in a log that also carries heartbeats and model output',
  );
});

test('a busy while REGISTERING as the waiter does not silently lose the job', { skip: NEEDS_SQLITE }, async () => {
  // `registerWaiter`'s caller handles the false RETURN and has no catch at all,
  // so a busy killed the worker before it had sent anything and the job it was
  // spawned for simply never ran. The exclusion list in `job-busy.mjs` claimed
  // this caller "treats a throw as the answer"; it did not.
  const scenario = await queueScenario();
  const { DatabaseSync } = await import('node:sqlite');
  const originalPrepare = DatabaseSync.prototype.prepare;
  const previous = process.env.OAI_PLUGIN_STATE;
  let injected = 0;
  try {
    const seq = insertSynthetic(scenario.state, { id: 'waiter-busy' });
    redirect(scenario.state, seq, scenario.server.baseUrl);
    process.env.OAI_PLUGIN_STATE = scenario.state;

    DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
      if (injected === 0 && /waiter_pid\s*=\s*\?/.test(sql)) {
        injected += 1;
        throw busyError();
      }
      return originalPrepare.call(this, sql, ...rest);
    };

    const { runTaskWorker } = await import('../scripts/lib/cmd-task-worker.mjs');
    await runTaskWorker(['--seq', String(seq)]);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
    await scenario.server.close();
  }

  assert.equal(injected, 1, 'the injection never fired: this witness is examining nothing');
  const row = withStore(scenario.state, (db) => db.prepare("SELECT state FROM jobs WHERE id = 'waiter-busy'").get());
  assert.equal(row.state, 'completed', 'a contended registration must not cost the job its whole run');
});

test('an EXHAUSTED spawn-stamp retry still reports the id', { skip: NEEDS_SQLITE }, async () => {
  // The retry narrows the lost-id window; it does not close it. When the budget
  // runs out a detached worker has already been spawned and may be spending
  // money, so the id is the fact worth keeping — the stamp only shortens a
  // startup grace window, and stops being consulted once the worker registers
  // itself.
  //
  // The warning is asserted as well as the id, and specifically for what it must
  // NOT say: by the time a thirty-second budget is exhausted this process has
  // observed nothing about the worker since the spawn, so a warning asserting
  // that the job is running turns a submission that may have failed into
  // apparent success.
  //
  // The budget is exhausted by advancing the clock `withBusyRetry` reads rather
  // than by waiting thirty seconds for it. That is also the only way to reach
  // this path at all: a busy that clears is the case the OTHER witness covers.
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/models')) {
      respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      return;
    }
    respondJson(response, {
      model: 'test-model',
      choices: [{ message: { content: 'the answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    });
  });
  const state = stateDir();
  const { path: configPath } = writeConfig({
    providers: { fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 } },
    defaultProvider: 'fake',
  });
  const { DatabaseSync } = await import('node:sqlite');
  const originalPrepare = DatabaseSync.prototype.prepare;
  const originalNow = performance.now.bind(performance);
  const originalWrite = process.stderr.write.bind(process.stderr);
  let errors = '';
  const previous = { config: process.env.OAI_PLUGIN_CONFIG, state: process.env.OAI_PLUGIN_STATE };
  process.env.OAI_PLUGIN_CONFIG = configPath;
  process.env.OAI_PLUGIN_STATE = state;
  let injected = 0;
  let advancing = false;

  try {
    DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
      const statement = originalPrepare.call(this, sql, ...rest);
      if (!/spawned_at\s*=/i.test(sql)) return statement;
      const run = statement.run.bind(statement);
      statement.run = () => {
        // Never clears: this is the exhaustion path, not the transient one.
        injected += 1;
        advancing = true;
        throw busyError();
      };
      return statement;
    };
    // Each reading after the first busy jumps a minute, so the 30s budget is
    // spent on the first check rather than after six hundred real attempts.
    let jumps = 0;
    performance.now = () => (advancing ? originalNow() + (jumps += 1) * 60_000 : originalNow());
    process.stderr.write = (chunk, ...rest) => {
      errors += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return originalWrite(chunk, ...rest);
    };

    const { id } = await submitTask({
      spec: TASK_SPEC,
      options: { background: true },
      inlinePrompt: 'summarise this',
      terminated: [],
    });

    assert.ok(injected >= 1, 'the injection never fired: this witness is examining nothing');
    assert.match(id, /^[0-9a-f]{8}$/, 'an exhausted stamp retry must not cost the caller the id of a running job');
    const row = readJob(state, id);
    assert.equal(row.spawned_at, null, 'the stamp genuinely did not land — otherwise this tests the transient path');

    const warning = errors.split('\n').find((line) => line.startsWith('Warning:'));
    assert.ok(warning, `the exhaustion warning never printed; stderr was: ${JSON.stringify(errors)}`);
    assert.ok(warning.includes(id), 'the warning must carry the id, which is the fact worth keeping');
    assert.doesNotMatch(
      warning,
      /\b(is|still) running\b|\bis alive\b/,
      'the warning asserts a liveness this process has not observed since the spawn',
    );

    await waitForState(state, id, ['completed', 'failed']);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    performance.now = originalNow;
    process.stderr.write = originalWrite;
    if (previous.config === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous.config;
    if (previous.state === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous.state;
    await server.close();
    rmSync(state, { recursive: true, force: true });
  }
});
