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
