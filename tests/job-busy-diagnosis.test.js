// What a failed TERMINAL WRITE must not cost: the reason the job failed.
//
// Separate from `job-busy-placement.test.js` because the subject is separate:
// placement is about which write happens, and these two are about which ERROR
// survives when a write does not happen at all.
import assert from 'node:assert/strict';
import test from 'node:test';

import { NEEDS_SQLITE, insertSynthetic, queueScenario, withStore } from './job-helpers.mjs';

/** The shape SQLite raises, as `isBusy` recognises it. */
function busyError() {
  const error = new Error('database is locked');
  error.errcode = 5;
  return error;
}

/** Point a synthetic job's transport at a live server so the chat is reached. */
function redirect(state, seq, baseUrl) {
  withStore(state, (db) =>
    db.prepare('UPDATE jobs SET transport = ? WHERE seq = ?')
      .run(JSON.stringify({ name: 'fake', baseUrl: `${baseUrl}/v1`, query: '' }), seq));
}

test('an exhausted FAILED write does not replace the diagnosis with the contention', { skip: NEEDS_SQLITE }, async () => {
  // A `throw` raised inside a `catch` block replaces the pending rethrow. So
  // `publishFailure` returns rather than throws when the retried `failed` write
  // exhausts its budget, and its caller's `throw error` still runs. The row
  // write is exactly what failed, so that rethrow is the only channel carrying
  // the model-failure diagnosis. Had the busy error escaped instead, the worker
  // log would say only "database is locked" about a job that died of a failed
  // model call.
  //
  // The budget is exhausted by advancing the clock rather than by holding a real
  // lock for thirty seconds.
  const scenario = await queueScenario({ failChats: true });
  const { DatabaseSync } = await import('node:sqlite');
  const originalPrepare = DatabaseSync.prototype.prepare;
  const originalNow = performance.now.bind(performance);
  const previous = process.env.OAI_PLUGIN_STATE;
  let injected = 0;
  let advancing = false;
  try {
    const seq = insertSynthetic(scenario.state, { id: 'diagnosis' });
    redirect(scenario.state, seq, scenario.server.baseUrl);
    process.env.OAI_PLUGIN_STATE = scenario.state;

    DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
      const statement = originalPrepare.call(this, sql, ...rest);
      if (!/completed_at\s*=\s*\?/.test(sql)) return statement;
      const run = statement.run.bind(statement);
      statement.run = (...params) => {
        // Only the `failed` write, and it never clears: this is the exhaustion
        // path, so the busy must outlast the whole budget.
        if (params[0] !== 'failed') return run(...params);
        injected += 1;
        advancing = true;
        throw busyError();
      };
      return statement;
    };
    let jumps = 0;
    performance.now = () => (advancing ? originalNow() + (jumps += 1) * 60_000 : originalNow());

    const { runTaskWorker } = await import('../plugins/oai/scripts/lib/cmd-task-worker.mjs');
    // The assertion is the REJECTION REASON, not that it rejected: a worker that
    // let the storage error escape would reject too; only the reason tells the
    // two apart.
    await assert.rejects(
      () => runTaskWorker(['--seq', String(seq)]),
      (error) => {
        assert.doesNotMatch(error.message, /database is locked/, 'the contention replaced the diagnosis it was supposed to accompany');
        assert.match(error.message, /on fire|500/i, 'the escaping error must be the one that actually killed the job');
        return true;
      },
    );
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    performance.now = originalNow;
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
    await scenario.server.close();
  }

  assert.ok(injected >= 1, 'the injection never fired: this witness is examining nothing');
});

test('a NON-BUSY failure of the failed write also leaves the diagnosis propagating', { skip: NEEDS_SQLITE }, async () => {
  // The sibling above, for a storage fault that is not contention.
  // `publishFailure` does not test `isBusy`: catching only the busy would let a
  // disk error, a corrupt file or a schema fault replace the model failure, and a
  // reader debugging the job would be told about SQLite instead of why the job
  // failed.
  //
  // No clock advance and no retry budget: a non-busy error is rethrown by
  // `withBusyRetry` on its first attempt, which is what makes this the cheap
  // half of the pair.
  const scenario = await queueScenario({ failChats: true });
  const { DatabaseSync } = await import('node:sqlite');
  const originalPrepare = DatabaseSync.prototype.prepare;
  const previous = process.env.OAI_PLUGIN_STATE;
  let injected = 0;
  try {
    const seq = insertSynthetic(scenario.state, { id: 'nonbusy' });
    redirect(scenario.state, seq, scenario.server.baseUrl);
    process.env.OAI_PLUGIN_STATE = scenario.state;

    DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
      const statement = originalPrepare.call(this, sql, ...rest);
      if (!/completed_at\s*=\s*\?/.test(sql)) return statement;
      const run = statement.run.bind(statement);
      statement.run = (...params) => {
        if (params[0] !== 'failed') return run(...params);
        injected += 1;
        const error = new Error('database disk image is malformed');
        error.errcode = 11;
        throw error;
      };
      return statement;
    };

    const { runTaskWorker } = await import('../plugins/oai/scripts/lib/cmd-task-worker.mjs');
    await assert.rejects(
      () => runTaskWorker(['--seq', String(seq)]),
      (error) => {
        assert.doesNotMatch(error.message, /disk image is malformed/, 'the storage fault replaced the diagnosis it was supposed to accompany');
        assert.match(error.message, /on fire|500/i, 'the escaping error must be the one that actually killed the job');
        return true;
      },
    );
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
    await scenario.server.close();
  }

  assert.equal(injected, 1, 'the injection never fired: this witness is examining nothing');
});
