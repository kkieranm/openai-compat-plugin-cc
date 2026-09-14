import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatRequests, deltaFrame, runCompanion, scriptOf, startFakeServer, writeConfig } from './helpers.mjs';
import { errorFrame } from '../scripts/lib/completion.mjs';

// A refusal the server puts INSIDE an HTTP 200 stream. LM Studio delivers a
// context overflow or a rejected sampling value this way: one `event: error`
// frame, no `[DONE]`, no `choices` anywhere. The bytes below are the ones it
// sends, verbatim. Read as a completion, the frame folds in as nothing, the
// run reads as `empty-completion`, and the refusal is re-sent three times with
// its message discarded — which is what the first two cases refuse to let
// happen and the third case keeps for a failure that came after text.
const REFUSAL =
  'The number of tokens to keep from the initial prompt is greater than the context length. ' +
  'Try to load the model with a larger context length, or provide a shorter input';
const ERROR_EVENT = `event: error\ndata: ${JSON.stringify({ error: { message: REFUSAL }, message: REFUSAL })}\n\n`;

/** A stream that sends `deltas` as chunks, then the error frame, then closes. */
const streamThen = (...deltas) => (response) => {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  for (const delta of deltas) response.write(`data: ${JSON.stringify(deltaFrame(delta))}\n\n`);
  response.end(ERROR_EVENT);
};

/** One `/oai:task` run against `script`, with the DEFAULT retry budget. */
async function taskAgainst(script) {
  const server = await startFakeServer(scriptOf([script]));
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, retrySeconds: 0 } },
  });
  let result;
  try {
    result = await runCompanion(['task', '--json', 'say hi'], { configPath: path });
  } finally {
    await server.close();
  }
  return { result, requests: chatRequests(server).length };
}

function assertRefused({ result, requests }) {
  assert.equal(requests, 1, 'a refusal before generation is never re-sent');
  assert.equal(result.status, 1, result.stdout.slice(0, 300));
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.reason, 'stream-error-frame');
  assert.equal(envelope.attempts.length, 1);
  assert.equal(envelope.attempts[0].outcome, 'failed');
  assert.equal(envelope.attempts[0].serverResponded, true, 'a full HTTP response was obtained');
  // The server's text is server-controlled: displayed, never persisted.
  assert.doesNotMatch(envelope.message, /context length/);
  assert.doesNotMatch(envelope.hint ?? '', /context length/);
  assert.match(result.stderr, /greater than the context length/, 'the refusal reaches the operator via transportDetail');
}

test('the observed LM Studio refusal frame is one request, named as a refusal, text preserved', async () => {
  assertRefused(await taskAgainst(streamThen()));
});

test('a role-only delta before the error frame is still a refusal — no text had streamed', async () => {
  assertRefused(await taskAgainst(streamThen({ role: 'assistant', content: null })));
});

test('an error frame AFTER text keeps the retryable stream-unfinished classification', async () => {
  const { result, requests } = await taskAgainst(streamThen({ content: 'partial ' }));
  assert.equal(requests, 3, 'a mid-generation failure is still re-sent');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, 'stream-unfinished');
});

test('errorFrame reads the shape and only the shape', () => {
  assert.equal(errorFrame({ error: { message: 'x' } }), 'x');
  assert.equal(errorFrame({ error: 'x' }), 'x');
  assert.equal(errorFrame({ error: { code: 7 } }), '{"code":7}', 'an envelope without a message string is kept whole');
  assert.equal(errorFrame({ error: { message: 'x' }, choices: [] }), null, 'choices makes it a completion chunk');
  assert.equal(errorFrame({ error: null }), null);
  assert.equal(errorFrame({ error: '' }), null);
  assert.equal(errorFrame({ error: 5 }), null);
  assert.equal(errorFrame(Object.create({ error: { message: 'x' } })), null, 'an inherited error is not the frame\'s own');
  assert.equal(errorFrame([{ error: 'x' }]), null);
  assert.equal(errorFrame('error'), null);
  assert.equal(errorFrame(null), null);
  assert.equal(errorFrame(deltaFrame({ content: 'hi' })), null);
});
