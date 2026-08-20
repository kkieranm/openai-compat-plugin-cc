// What counts as an answer. A reasoning model can finish a request with
// `content: ""` and everything in `reasoning_content`; that text is the model's
// scratchpad, so /oai:task must refuse rather than print it or print nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionFrames, deltaFrame, modelList, reasoningFrames, respondJson, respondStream, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

function route(chat) {
  return (request, response) => {
    if (request.url.endsWith('/models')) return respondJson(response, modelList('test-model'));
    if (request.url.endsWith('/chat/completions')) return respondStream(response, chat(request));
    return respondJson(response, { error: 'no such route' }, 404);
  };
}

async function runWith(chat, argv) {
  const server = await startFakeServer(route(chat));
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });
  const result = await runCompanion(argv, { configPath: path });
  await server.close();
  return result;
}

test('an answer that never left the reasoning channel is an error, not an empty success', async () => {
  // Reproduced live: at --max-tokens 300 the model spent 442 tokens thinking and
  // returned nothing. Printing that plus a footer reads as a successful run that
  // simply had nothing to say.
  const result = await runWith(
    () => reasoningFrames('First, let me consider the...', { finishReason: 'length' }),
    ['task', '--max-tokens', '300', 'explain this'],
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stopped at the token limit/);
  assert.match(result.stderr, /--max-tokens/);
  assert.doesNotMatch(result.stdout, /let me consider/i, 'reasoning is not an answer');
});

test('a finished reply with only reasoning names that, not the token limit', async () => {
  const result = await runWith(() => reasoningFrames('It is fine.'), ['task', 'explain this']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /only internal reasoning/);
  assert.doesNotMatch(result.stdout, /It is fine/);
});

test('a response carrying no message at all is still malformed', async () => {
  // A stream that finishes without a single delta touching either channel —
  // the streaming shape of a completion whose choice carries no message.
  const result = await runWith(
    () => [deltaFrame({}), { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }],
    ['task', 'explain this'],
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no message content/);
});

test('a marker-bearing finish_reason is shown in full, but never baked into .message', async () => {
  // OAI-185: finish_reason is read straight off the server's payload with no
  // validation (completion.mjs's applyFrame), so it can be as secret-shaped as
  // any other server-controlled value this feature guards. It travels on
  // .finishReason, composed into the foreground display by transportDetail —
  // this is `task` (interactive), so the marker should still be VISIBLE,
  // just not as part of the raw .message string a persisted record would keep.
  const marker = 'SECRET_MARKER_finishreason';
  const result = await runWith(
    () => [deltaFrame({}), { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: marker }] }],
    ['task', 'explain this'],
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(marker), 'the interactive operator still sees it');
  const messageLine = result.stderr.split('\n')[0];
  assert.doesNotMatch(messageLine, new RegExp(`content \\(.*${marker}`), 'the marker must not be fused into the raw message text');
});

test('a marker-bearing finish_reason on the blank-completion refusal is shown, but not fused into .message', async () => {
  // The third refuseUnusable shape (BLANK_COMPLETION): a channel was seen but
  // carried nothing. Same OAI-185 concern as the EMPTY_COMPLETION shape above,
  // pinned separately since it is a distinct throw site with its own
  // .finishReason assignment.
  const marker = 'SECRET_MARKER_blankcompletion';
  const result = await runWith(
    () => [
      deltaFrame({ role: 'assistant', content: '' }),
      { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: marker }] },
    ],
    ['task', 'explain this'],
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(marker), 'the interactive operator still sees it');
  const messageLine = result.stderr.split('\n')[0];
  assert.doesNotMatch(messageLine, new RegExp(`completion \\(.*${marker}`), 'the marker must not be fused into the raw message text');
});

test('a marker-bearing finish_reason on requireAnswer\'s empty-answer refusal is shown, not fused', async () => {
  // client.mjs's requireAnswer, not completion.mjs's finishAnswer: whitespace-
  // only content has length > 0 (finishAnswer's blank-completion guard passes
  // it through) but trims to empty, so requireAnswer's own final refusal
  // fires — a third, distinct .finishReason assignment (OAI-185).
  const marker = 'SECRET_MARKER_requireanswer';
  const result = await runWith(
    () => [
      deltaFrame({ role: 'assistant', content: ' ' }),
      { ...deltaFrame({}), choices: [{ index: 0, delta: {}, finish_reason: marker }] },
    ],
    ['task', 'explain this'],
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(marker), 'the interactive operator still sees it');
  const messageLine = result.stderr.split('\n')[0];
  assert.doesNotMatch(messageLine, new RegExp(`answer \\(.*${marker}`), 'the marker must not be fused into the raw message text');
});

test('the same guard holds on the non-streaming path, where the choice has no message', async () => {
  // The streaming and whole-JSON paths share one accumulator precisely so they
  // cannot disagree about what an answer is. Asserting the guard on only one of
  // them would leave the other free to drift — which is how this repo's
  // most-repeated defect class works, so both are pinned.
  const server = await startFakeServer((request, response) => {
    if (request.url.endsWith('/models')) return respondJson(response, modelList('test-model'));
    return respondJson(response, {
      id: 'chatcmpl-test',
      model: 'test-model',
      choices: [{ index: 0, finish_reason: 'stop' }],
    });
  });
  const { path } = writeConfig({ defaultProvider: 'local', providers: { local: { baseUrl: server.baseUrl } } });
  const result = await runCompanion(['task', 'explain this'], { configPath: path });
  await server.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no message content/);
});

test('an ordinary answer is unaffected by the guard', async () => {
  const result = await runWith(() => completionFrames('the answer'), ['task', 'explain this']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /the answer/);
});
