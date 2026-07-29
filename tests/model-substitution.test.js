// When the server answers as a different model than the one requested.
//
// Measured against LM Studio, and the reason this file exists: a request naming
// a model it does not have returns HTTP 200 and a normal completion from
// whatever IS loaded, reporting that model's id. Nothing refuses, nothing warns,
// and every record of the run reads as clean — so a benchmark arm can spend its
// whole wall clock on a model it does not claim to test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { substitution, substitutionNotice } from "../scripts/lib/model-identity.mjs";
import {
  completion,
  completionFrames,
  modelList,
  respondJson,
  respondStream,
  runCompanion,
  startFakeServer,
  writeConfig,
} from "./helpers.mjs";

// A server that answers as `served` whatever it was asked for, exactly as
// LM Studio does. `contextLength` is set so no probe runs — this file is about
// the reply-time net, not the up-front refusal.
function substitutingServer(served, { stream = false } = {}) {
  return startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) {
      return stream
        ? respondStream(response, completionFrames('the answer', { model: served }))
        : respondJson(response, completion('the answer', { model: served }));
    }
    if (path.endsWith('/models')) return respondJson(response, modelList(served));
    return respondJson(response, { error: 'not found' }, 404);
  });
}

function pinned(baseUrl, model) {
  return writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl, defaultModel: model, contextLength: 8192 } },
  });
}

test('substitution() reports a difference only when both ids are known', () => {
  assert.deepEqual(substitution('asked', 'answered'), { requested: 'asked', served: 'answered' });
  assert.equal(substitution('same', 'same'), null);
  // Absent is "nothing was determined", never evidence of a swap — the rule
  // budgetError's serverResponded had to learn.
  assert.equal(substitution(undefined, 'answered'), null);
  assert.equal(substitution('asked', undefined), null);
  assert.equal(substitution('asked', ''), null);
});

test('a quantization suffix is a real difference, not a spelling of the same model', () => {
  // Measured: requesting `qwen/qwen3.6-27b@4bit` made LM Studio attempt to load
  // a DIFFERENT model and fail on system resources. `matchKey` strips that
  // suffix for the merge join; reusing it here would hide the swap between two
  // quantizations that contaminates an A/B arm most quietly.
  assert.deepEqual(
    substitution('qwen/qwen3.6-27b@4bit', 'qwen/qwen3.6-27b'),
    { requested: 'qwen/qwen3.6-27b@4bit', served: 'qwen/qwen3.6-27b' },
  );
});

test('the task footer names both models, and stderr warns', async () => {
  const server = await substitutingServer('actually-loaded');
  const { path } = pinned(server.baseUrl, 'asked-for-this');

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, 'the reply is real work and must not be discarded');
  assert.match(result.stdout, /model: actually-loaded \(requested asked-for-this\)/);
  assert.match(result.stderr, /asked for "asked-for-this" but actually-loaded answered/i);
});

test('a streamed reply is compared on the model the LAST frame reported', async () => {
  // applyFrame lets the last frame carrying a model win, and the trailing usage
  // frame carries one. A test that set the id on the text frames alone would be
  // silently overwritten and pass no matter what the code did.
  const server = await substitutingServer('actually-loaded', { stream: true });
  const { path } = pinned(server.baseUrl, 'asked-for-this');

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /model: actually-loaded \(requested asked-for-this\)/);
});

test('a matching model produces no warning and no parenthetical', async () => {
  const server = await substitutingServer('agreed');
  const { path } = pinned(server.baseUrl, 'agreed');

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /model: agreed/);
  assert.doesNotMatch(result.stdout, /requested/);
  assert.doesNotMatch(result.stderr, /substituted/i);
});

test('a server that never names a model is not reported as substituting', async () => {
  // finishAnswer falls back to the requested id, so requested === served. The
  // fallback is what makes this unfalsifiable rather than a false positive, and
  // it must stay that way.
  const server = await startFakeServer((request, response) => {
    const path = request.url.split('?')[0];
    if (path.endsWith('/chat/completions')) {
      const body = completion('the answer');
      delete body.model;
      return respondJson(response, body);
    }
    if (path.endsWith('/models')) return respondJson(response, modelList('quiet-model'));
    return respondJson(response, { error: 'not found' }, 404);
  });
  const { path } = pinned(server.baseUrl, 'quiet-model');

  const result = await runCompanion(['task', 'hello'], { configPath: path });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /requested/);
  assert.doesNotMatch(result.stderr, /substituted/i);
});

test('substitutionNotice is null unless there is something to say', () => {
  assert.equal(substitutionNotice({ requestedModel: 'a', model: 'a' }), null);
  assert.equal(substitutionNotice({ model: 'a' }), null);
  assert.match(substitutionNotice({ requestedModel: 'a', model: 'b' }), /asked for "a" but b answered/);
});

test('--json carries both ids, so a harness never has to infer the pair', async () => {
  const server = await substitutingServer('actually-loaded');
  const { path } = pinned(server.baseUrl, 'asked-for-this');

  const result = await runCompanion(['review', '--file', 'package.json', '--json', 'check this'], {
    configPath: path,
    cwd: process.cwd(),
  });
  await server.close();

  const report = JSON.parse(result.stdout);
  assert.equal(report.model, 'actually-loaded', 'the run belongs to the model that ran');
  assert.equal(report.requestedModel, 'asked-for-this', 'and the record must still say what was asked for');
});

test('the review findings block and its footer never name two different models', async () => {
  // The block heads the report and the footer closes it. Handing one the
  // requested id and the other the served id produces a single report naming two
  // models, which is worse than the silence it replaced.
  const server = await substitutingServer('actually-loaded');
  const { path } = pinned(server.baseUrl, 'asked-for-this');

  const result = await runCompanion(['review', '--file', 'package.json', 'check this'], {
    configPath: path,
    cwd: process.cwd(),
  });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /asked-for-this(?! *\))/, 'only the footer parenthetical may name the requested id');
  assert.match(result.stdout, /model: actually-loaded \(requested asked-for-this\)/);
});
