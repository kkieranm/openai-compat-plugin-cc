// `/oai:result`: the answer, or a straight account of why there isn't one.
//
// The rule under every case here is the one `requireAnswer` enforces on the
// foreground path: nothing exits 0 with no output. "No answer, success" and "an
// answer that happened to be empty" are indistinguishable to a caller, and this
// command is read by a caller far more often than by a person.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, waitForState } from './job-helpers.mjs';

const workspace = (tag) => mkdtempSync(join(tmpdir(), `oai-res-${tag}-`));

test('a completed job hands back its answer and footer, from another directory', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const submit = await scenario.submit([], { cwd: workspace('a') });
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['completed', 'failed']);

    const result = await scenario.run(['result', id], { cwd: workspace('b') });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^ok/);
    // The same footer builder the foreground path uses, so a figure shown after
    // `/oai:task` cannot quietly go missing after `/oai:result`.
    assert.match(result.stdout, /provider: fake/);
    assert.match(result.stdout, /model: test-model/);
  } finally {
    await scenario.server.close();
  }
});

test('a job that has not finished is refused, naming the state', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario({ delayMs: 2000 });
  try {
    const submit = await scenario.submit();
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['running']);

    const result = await scenario.run(['result', id]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Job ${id} is running`));
    assert.match(result.stderr, /\/oai:status/);
    assert.equal(result.stdout, '', 'a job with no answer must produce no output at all');

    await waitForState(scenario.state, id, ['completed', 'failed']);
  } finally {
    await scenario.server.close();
  }
});

test('a failed job reports what went wrong and where its log is', { skip: NEEDS_SQLITE }, async () => {
  // Driven through a server that refuses, so the envelope under test is the one
  // the worker actually wrote rather than a fixture asserting on itself.
  const scenario = await queueScenario({ failChats: true });
  try {
    const submit = await scenario.submit(['--max-attempts', '1']);
    const id = submit.stdout.trim();
    const row = await waitForState(scenario.state, id, ['failed', 'completed']);
    assert.equal(row.state, 'failed', 'a 500 from the server is not a completed job');

    const result = await scenario.run(['result', id]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Job ${id} failed`));
    assert.match(result.stderr, new RegExp(`logs/${row.seq}\\.log`));
    assert.equal(result.stdout, '');
  } finally {
    await scenario.server.close();
  }
});

test('a job that completed with nothing to say is refused rather than printed as success', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'hollow',
      state: 'completed',
      outcome: { content: '   ', model: 'test-model', requestedModel: 'test-model' },
    });

    const result = await scenario.run(['result', 'hollow']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /recorded no answer/);
    assert.equal(result.stdout, '');
  } finally {
    await scenario.server.close();
  }
});

test('an id nobody has, and no id at all, are both refused', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const missing = await scenario.run(['result', 'nosuchid']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No job with id "nosuchid"/);

    const bare = await scenario.run(['result']);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /needs a job id/);
  } finally {
    await scenario.server.close();
  }
});
