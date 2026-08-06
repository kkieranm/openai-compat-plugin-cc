// The spike: can a detached worker be launched, survive its parent, and be
// observed from a different process — without hanging the suite?
//
// This is the risky unknown in the whole feature and it is proved before
// anything real is built on it. Everything else here is mechanical; this is not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, readJob, stateDir, waitForState } from './job-helpers.mjs';

/** Answers the probe, then one non-streaming completion. */
function modelsAndChat(answer = 'the answer', id = 'test-model') {
  return (request, response) => {
    if (request.url.includes('/models')) {
      respondJson(response, { data: [{ id, object: 'model' }] });
      return;
    }
    respondJson(response, {
      model: id,
      choices: [{ message: { content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    });
  };
}

test('a background job outlives the command that submitted it', { skip: NEEDS_SQLITE }, async () => {
  const server = await startFakeServer(modelsAndChat());
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

    // The worker really called the model — not merely reached a terminal state,
    // which a skeleton that does nothing would also manage.
    assert.equal(row.outcome.content, 'the answer');
    assert.equal(row.outcome.finishReason, 'stop');
    const chats = server.requests.filter((r) => r.url.includes('chat/completions'));
    assert.equal(chats.length, 1, 'exactly one chat completion should have been sent');
  } finally {
    await server.close();
  }
});

test('submission fails in the foreground rather than becoming a broken job', { skip: NEEDS_SQLITE }, async () => {
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


test('what the model sees is frozen at submission, not read when the worker runs', { skip: NEEDS_SQLITE }, async () => {
  // The barrier is already in the code: attachments are read before the model
  // probe, so a handler that edits the file while answering /models is
  // guaranteed to run after the snapshot and before the chat request. No
  // sleeping, no racing — the ordering is a property of the command.
  const state = stateDir();
  const dir = mkdtempSync(join(tmpdir(), 'oai-plugin-src-'));
  const file = join(dir, 'subject.txt');
  writeFileSync(file, 'ORIGINAL CONTENT');

  let mutated = false;
  const server = await startFakeServer((request, response) => {
    if (request.url.includes('/models')) {
      if (!mutated) {
        writeFileSync(file, 'REPLACED AFTER SUBMISSION');
        mutated = true;
      }
      respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      return;
    }
    respondJson(response, {
      model: 'test-model',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    });
  });

  const { path: configPath } = writeConfig({
    providers: { fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 } },
    defaultProvider: 'fake',
  });

  try {
    const submit = await runCompanion(['task', '--background', '--file', file, 'summarise'], {
      configPath,
      env: { OAI_PLUGIN_STATE: state },
    });
    assert.equal(submit.status, 0, submit.stderr);
    assert.ok(mutated, 'the barrier never fired, so this test proves nothing');

    await waitForState(state, submit.stdout.trim(), ['completed', 'failed']);

    const chat = server.requests.find((r) => r.url.includes('chat/completions'));
    const sent = JSON.stringify(chat.body.messages);
    assert.match(sent, /ORIGINAL CONTENT/, 'the worker must send what was captured at submission');
    assert.doesNotMatch(sent, /REPLACED AFTER SUBMISSION/, 'the worker must not re-read the file from disk');
  } finally {
    await server.close();
  }
});

test('an optional field left unset is omitted from the wire, never sent as null', { skip: NEEDS_SQLITE }, async () => {
  const state = stateDir();
  const server = await startFakeServer(modelsAndChat());
  const { path: configPath } = writeConfig({
    providers: { fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 } },
    defaultProvider: 'fake',
  });

  try {
    const submit = await runCompanion(['task', '--background', 'no temperature given'], {
      configPath,
      env: { OAI_PLUGIN_STATE: state },
    });
    assert.equal(submit.status, 0, submit.stderr);
    await waitForState(state, submit.stdout.trim(), ['completed', 'failed']);

    // Asserted on the body the server received, not on the DTO: the DTO could be
    // right while the reconstruction put a null on the wire.
    const chat = server.requests.find((r) => r.url.includes('chat/completions'));
    assert.ok(!('temperature' in chat.body), `temperature should be absent, got ${JSON.stringify(chat.body.temperature)}`);
  } finally {
    await server.close();
  }
});
