// The write that runs when a worker ALREADY EXISTS.
//
// `markSpawned` is the one write in submission that happens after `spawnWorker`
// — so a busy escaping it rejects `submitTask` while a detached process is
// already running and about to make a real, billable model call. The id never
// reaches stdout, and the user is left with a job they cannot name, poll or
// cancel. This drives `submitTask` in-process, because injecting a busy into the
// child `runCompanion` spawns is not possible from here.
import assert from 'node:assert/strict';
import test from 'node:test';

import { respondJson, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, readJob, stateDir, waitForState } from './job-helpers.mjs';
import { TASK_SPEC } from '../scripts/lib/cmd-task.mjs';
import { submitTask } from '../scripts/lib/task-submit.mjs';

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

/** Make the first execution of a statement matching `pattern` fail busy. */
function failOnceOn(DatabaseSync, pattern) {
  const original = DatabaseSync.prototype.prepare;
  const state = { injected: 0, restore: () => { DatabaseSync.prototype.prepare = original; } };
  DatabaseSync.prototype.prepare = function inject(sql) {
    const statement = original.call(this, sql);
    if (!pattern.test(sql)) return statement;
    const run = statement.run.bind(statement);
    statement.run = (...params) => {
      if (state.injected === 0) {
        state.injected += 1;
        const error = new Error('database is locked');
        error.errcode = 5;
        throw error;
      }
      return run(...params);
    };
    return statement;
  };
  return state;
}

test('a busy on the SPAWNED stamp does not lose an id whose worker is already running', { skip: NEEDS_SQLITE }, async () => {
  const server = await startFakeServer(modelsAndChat());
  const state = stateDir();
  const { path: configPath } = writeConfig({
    providers: {
      fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 },
    },
    defaultProvider: 'fake',
  });
  const { DatabaseSync } = await import('node:sqlite');
  const injection = failOnceOn(DatabaseSync, /spawned_at\s*=/i);
  const previous = { config: process.env.OAI_PLUGIN_CONFIG, state: process.env.OAI_PLUGIN_STATE };
  process.env.OAI_PLUGIN_CONFIG = configPath;
  process.env.OAI_PLUGIN_STATE = state;

  try {
    // Unwrapped, this throws and `cmd-task.mjs` never prints the id.
    const { id, seq } = await submitTask({
      spec: TASK_SPEC,
      options: { background: true },
      inlinePrompt: 'summarise this',
      terminated: [],
    });

    assert.equal(injection.injected, 1, 'the injection never fired: this witness is examining nothing');
    assert.match(id, /^[0-9a-f]{8}$/, 'the id must survive a contended spawn stamp — a worker is already running');

    // Asserting the id alone would stay green if the retry were replaced by a
    // swallowed error, which loses the very fact the stamp records.
    const row = readJob(state, id);
    assert.ok(row.spawned_at, 'the retried write must actually land: an unstamped row has no start clock');
    assert.equal(row.seq, seq);

    // Leave nothing running behind this test.
    await waitForState(state, id, ['completed', 'failed']);
  } finally {
    injection.restore();
    if (previous.config === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous.config;
    if (previous.state === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous.state;
    await server.close();
  }
});
