// The vendor sampling/reasoning parameters: that each is validated, that the one
// place they become body fields cannot reach anything else, that they survive the
// background-job DTO, and that a run's settings reach the --json envelope on the
// failure path — the one that matters most, since the runaway this feature exists
// to fix fails after the model call has already returned.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLING_PARAMS, applySampling, parseSampling } from '../scripts/lib/sampling.mjs';
import { persistRequest, reconstructRequest } from '../scripts/lib/job-request.mjs';
import { errorReport } from '../scripts/lib/review-report.mjs';
import {
  chatRequests, completionFrames, modelList, reasoningFrames, respondJson, respondStream, runCompanion,
  startFakeServer, writeConfig,
} from './helpers.mjs';

test('each validator accepts a good value and rejects a bad one', () => {
  // reasoning-effort: shape only, so any single token passes and the server
  // decides — including xhigh, which is outside OpenAI's own set and is exactly
  // the value a client-side allowlist would have wrongly refused.
  assert.deepEqual(parseSampling({ 'reasoning-effort': ' low ' }), { reasoningEffort: 'low' });
  assert.deepEqual(parseSampling({ 'reasoning-effort': 'xhigh' }), { reasoningEffort: 'xhigh' });
  assert.throws(() => parseSampling({ 'reasoning-effort': '' }), /reasoning-effort/);
  assert.throws(() => parseSampling({ 'reasoning-effort': '   ' }), /reasoning-effort/);
  assert.throws(() => parseSampling({ 'reasoning-effort': 'a b' }), /reasoning-effort/);

  assert.deepEqual(parseSampling({ 'top-p': '0.9' }), { topP: 0.9 });
  assert.throws(() => parseSampling({ 'top-p': '1.5' }), /top-p/);
  assert.throws(() => parseSampling({ 'min-p': '-0.1' }), /min-p/);
  assert.throws(() => parseSampling({ 'top-k': '2.5' }), /top-k/);
  assert.throws(() => parseSampling({ 'top-k': '0' }), /top-k/);
  assert.throws(() => parseSampling({ 'presence-penalty': '3' }), /presence-penalty/);
  assert.deepEqual(parseSampling({ 'presence-penalty': '-2' }), { presencePenalty: -2 });
});

test('parseSampling returns undefined when no flag is set, and only the set keys otherwise', () => {
  assert.equal(parseSampling({}), undefined);
  assert.equal(parseSampling({ temperature: '0.5', model: 'x' }), undefined);
  assert.deepEqual(parseSampling({ 'top-p': '0.8', 'top-k': '40' }), { topP: 0.8, topK: 40 });
});

test('applySampling sets only wire fields from the table — a hostile unlisted key never reaches the body', () => {
  // The closed admission boundary. The sampling object is spread from a caller,
  // and this proves that even a caller who plants `messages`/`stream`/`model` on
  // it cannot overwrite the body's own fields: applySampling iterates the table,
  // not the caller's keys.
  const body = { model: 'real', messages: [{ role: 'user', content: 'hi' }], stream: true };
  applySampling(body, { reasoningEffort: 'low', messages: 'HACK', stream: false, model: 'evil', notAParam: 1 });

  assert.equal(body.model, 'real');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(body.stream, true);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal('notAParam' in body, false);
  assert.equal('HACK' in body, false);
});

test('no admitted wire field collides with a reserved body key', () => {
  const reserved = new Set(['model', 'messages', 'stream', 'stream_options', 'temperature', 'max_tokens', 'response_format']);
  for (const { wire } of SAMPLING_PARAMS) {
    assert.equal(reserved.has(wire), false, `${wire} must not shadow a reserved body key`);
  }
});

test('sampling round-trips through the background-job DTO, and is absent when unset', () => {
  const base = { profile: {}, numeric: {}, messages: [], budget: { checked: true } };

  const dto = persistRequest({ ...base, sampling: { topP: 0.8, reasoningEffort: 'low' } });
  const request = reconstructRequest(dto, { model: 'm', ledger: {} });
  assert.deepEqual(request.sampling, { topP: 0.8, reasoningEffort: 'low' });

  // No flags → absent, never null: withoutUndefined strips it, so the wire body
  // omits the field entirely rather than sending `"sampling": null`.
  const emptyDto = persistRequest({ ...base, sampling: undefined });
  assert.equal('sampling' in emptyDto, false);
  const emptyRequest = reconstructRequest(emptyDto, { model: 'm', ledger: {} });
  assert.equal('sampling' in emptyRequest, false);
});

test('errorReport carries sampling off the error, and null when there is none', () => {
  const withSampling = errorReport(Object.assign(new Error('boom'), { sampling: { reasoningEffort: 'low' } }));
  assert.deepEqual(withSampling.sampling, { reasoningEffort: 'low' });
  assert.equal(errorReport(new Error('boom')).sampling, null);
});

async function serverStreaming(frames) {
  return startFakeServer((request, response) => {
    if (request.url.includes('/chat/completions')) return respondStream(response, frames);
    if (request.url.includes('/models')) return respondJson(response, modelList('small'));
    return respondJson(response, {}, 404);
  });
}

function configFor(server) {
  return writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: `http://127.0.0.1:${server.port}/v1`, defaultModel: 'small', contextLength: 8192 } },
  }).path;
}

test('--reasoning-effort reaches the wire and the --json success envelope', async () => {
  const server = await serverStreaming(completionFrames('the answer', { model: 'small' }));
  try {
    const result = await runCompanion(
      ['task', '--json', '--reasoning-effort', 'low', '--top-p', '0.9', 'a question'],
      { configPath: configFor(server) },
    );
    assert.equal(result.status, 0, result.stderr);

    const chat = chatRequests(server)[0];
    assert.equal(chat.body.reasoning_effort, 'low');
    assert.equal(chat.body.top_p, 0.9);

    const envelope = JSON.parse(result.stdout);
    assert.deepEqual(envelope.sampling, { reasoningEffort: 'low', topP: 0.9 });
  } finally {
    await server.close();
  }
});

test('a post-dispatch runaway still records sampling in the --json failure envelope', async () => {
  // The motivating shape: the stream finishes cleanly with content empty and the
  // whole reply on the reasoning channel, so `requireAnswer` throws in the report
  // stage AFTER chatCompletion returned. Attaching sampling anywhere narrower
  // than the command catch would emit `sampling: null` here — on exactly the
  // failure whose settings need recording.
  const server = await serverStreaming(reasoningFrames('thinking, thinking, and never an answer'));
  try {
    const result = await runCompanion(
      ['task', '--json', '--reasoning-effort', 'low', 'a question'],
      { configPath: configFor(server) },
    );
    assert.notEqual(result.status, 0, 'a reasoning-only reply must fail, not pass');

    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error, true);
    assert.deepEqual(envelope.sampling, { reasoningEffort: 'low' });
  } finally {
    await server.close();
  }
});

// A config that resolves a profile without any server: the failures below are
// refused before a request is ever sent, so no fake server is needed.
function offlineConfig() {
  return writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'small', contextLength: 8192 } },
  }).path;
}

test('a PRE-dispatch task failure records the REQUESTED sampling — no request was sent', async () => {
  // No prompt: `resolvePrompt` throws before `resolveTarget` does any network
  // work, so nothing reached the wire. The envelope still reports the sampling
  // the run was requested with — the "requested, not sent" contract.
  const result = await runCompanion(['task', '--json', '--reasoning-effort', 'low'], { configPath: offlineConfig() });
  assert.notEqual(result.status, 0, result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error, true);
  assert.deepEqual(envelope.sampling, { reasoningEffort: 'low' });
});

test('a PRE-dispatch review failure records the REQUESTED sampling — no request was sent', async () => {
  // `--diff-only` with `--file` is refused by `assertAskable`, the first line of
  // the flow, before any git walk or provider contact. The --json error
  // envelope still carries the requested sampling.
  const result = await runCompanion(
    ['review', '--json', '--diff-only', '--file', 'nonexistent.mjs', '--reasoning-effort', 'low'],
    { configPath: offlineConfig() },
  );
  assert.notEqual(result.status, 0, result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error, true);
  assert.deepEqual(envelope.sampling, { reasoningEffort: 'low' });
});
