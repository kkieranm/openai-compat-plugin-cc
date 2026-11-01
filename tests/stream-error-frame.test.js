import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatRequests, deltaFrame, respondJson, respondStream, runCompanion, scriptOf, startFakeServer, writeConfig } from './helpers.mjs';
import { applyCompletion, applyFrame, emptyAnswer, errorFrame, finishAnswer, refusalIfStated } from '../plugins/oai/scripts/lib/completion.mjs';

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
  assert.equal(errorFrame({ error: { message: 'x' }, choices: [] }), 'x', 'choices does not hide a stated error');
  assert.equal(errorFrame({ error: { message: 'x' }, choices: [{ finish_reason: 'error' }] }), 'x');
  assert.equal(errorFrame({ error: {} }), null, 'an empty envelope names nothing');
  assert.equal(errorFrame({ error: true }), null, 'a boolean as the error itself is no signal');
  assert.equal(errorFrame({ error: 503 }), null, 'a number as the error itself is no signal');
  const beside = (error) => errorFrame({ error, choices: [] });
  assert.equal(beside('   '), null);
  assert.equal(beside({ message: '' }), null);
  assert.equal(beside({ message: null }), null);
  assert.equal(beside({ code: 0, message: '' }), null, 'zero values are a placeholder');
  assert.equal(beside({ code: null, type: null }), null);
  assert.equal(beside({ message: {} }), null);
  assert.equal(beside({ detail: { message: '', code: 0 } }), null, 'a nested blank says nothing');
  assert.equal(beside({ detail: { message: 'x' } }), '{"detail":{"message":"x"}}', 'nested content speaks, beside choices too');
  assert.equal(beside({ code: 7 }), '{"code":7}');
  assert.equal(beside({ message: '', code: 'insufficient_memory' }), '{"message":"","code":"insufficient_memory"}');
  assert.equal(errorFrame({ error: { detail: { message: 'x' } } }), '{"detail":{"message":"x"}}');
  assert.equal(errorFrame({ error: { message: '' } }), null, 'blank alone says nothing either');
  assert.equal(errorFrame({ error: '   ' }), null);
  assert.equal(errorFrame({ error: [1] }), '[1]');
  assert.equal(errorFrame({ error: [{ message: 'x' }] }), '[{"message":"x"}]');
  assert.equal(errorFrame({ error: [] }), null);
  let deep = { x: 'real' };
  for (let level = 0; level < 20; level += 1) deep = { inner: deep };
  assert.notEqual(errorFrame({ error: deep }), null, 'past the depth bound a real error is still read');
  assert.equal(errorFrame(Object.create({ error: { message: 'x' } })), null, 'an inherited error is not the frame\'s own');
  assert.equal(errorFrame([{ error: 'x' }]), null);
  assert.equal(errorFrame('error'), null);
  assert.equal(errorFrame(null), null);
  assert.equal(errorFrame(deltaFrame({ content: 'hi' })), null);
});

// MTPLX states a refusal beside `choices`, then finishes the stream normally. The
// message is a capture from MTPLX 2.12.2, its `detail` reduced to the retry field.
const MTPLX_ERROR =
  'insufficient memory: the other apps on this Mac leave 2.3 GiB free, and this prompt needs about 0.3 GiB more than that '
  + '(205 prompt tokens, 205 not cached). The engine gave back its own caches first. Held after reclamation: model weights '
  + '19.3 GiB; cached conversations 0.0 GiB; allocator pool 0.0 GiB; 1.1 GiB outside MLX. A retry can succeed once other apps '
  + 'give memory back: close some apps and try again, or shorten the prompt. The request was refused before prefill instead '
  + 'of pushing the Mac into swap, which can freeze the whole desktop; --allow-swap admits it anyway.';
const ENVELOPE = {
  error: {
    message: MTPLX_ERROR,
    type: 'server_error',
    code: 'insufficient_memory',
    param: null,
    detail: { code: 'insufficient_memory', memory: { retry_can_succeed: true } },
  },
};
const finishChunk = (finishReason, extra = {}, delta = {}) => deltaFrame(delta, {
  choices: [{ index: 0, delta, finish_reason: finishReason }],
  ...extra,
});
const ROLE = deltaFrame({ role: 'assistant' });
const TEXT = deltaFrame({ content: 'partial ' });

const stream = (...frames) => (response) => respondStream(response, frames);
const whole = (content, finishReason, extra = {}) => (response) => respondJson(response, {
  model: 'test-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
  ...extra,
});

function assertStatedRefusal({ result, requests }, serverText = /insufficient memory/) {
  assert.equal(requests, 1, 'a stated refusal is never re-sent');
  assert.equal(result.status, 1, result.stdout.slice(0, 300));
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.reason, 'stream-error-frame');
  assert.equal(envelope.attempts[0].outcome, 'failed');
  assert.equal(envelope.attempts[0].serverResponded, true, 'a full HTTP response was obtained');
  assert.match(result.stderr, serverText);
}

function assertStatedFailure({ result, requests }, serverText = /insufficient memory/) {
  assert.equal(requests, 3, 'a failure after text is re-sent');
  assert.equal(result.status, 1, result.stdout.slice(0, 300));
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.reason, 'stream-unfinished');
  assert.match(envelope.partial.content, /partial/);
  assert.match(result.stderr, serverText);
}

function assertAnswered({ result, requests }) {
  assert.equal(requests, 1);
  assert.equal(result.status, 0, result.stderr.slice(-300));
  assert.match(result.stdout, /partial/);
}

for (const [name, script] of [
  ['the captured MTPLX stream, retry_can_succeed notwithstanding', stream(ROLE, finishChunk('error', ENVELOPE))],
  ['a stream envelope beside finish_reason stop', stream(ROLE, finishChunk('stop', ENVELOPE))],
  ['a stream envelope with no finish_reason', stream(ROLE, ENVELOPE, finishChunk('stop'))],
  ['an envelope before text, whatever follows', stream(ENVELOPE, TEXT, finishChunk('stop'))],
  ['a whole reply with no text, envelope and finish_reason error', whole(null, 'error', ENVELOPE)],
  ['a whole reply with no text, envelope and finish_reason stop', whole(null, 'stop', ENVELOPE)],
  ['a whole reply that is only an envelope', (response) => respondJson(response, ENVELOPE)],
]) {
  test(`no text and a stated error is a refusal: ${name}`, async () => {
    assertStatedRefusal(await taskAgainst(script));
  });
}

for (const [name, script] of [
  ['a stream', stream(ROLE, finishChunk('error'))],
  ['a whole reply', whole(null, 'error')],
]) {
  test(`finish_reason error with no envelope and no text is a refusal: ${name}`, async () => {
    assertStatedRefusal(await taskAgainst(script), /\(error\)|— error/);
  });
}

for (const [name, script] of [
  ['stream: finish_reason error with an envelope', stream(ROLE, TEXT, finishChunk('error', ENVELOPE))],
  ['stream: an envelope and no finish_reason, then [DONE]', stream(ROLE, TEXT, ENVELOPE)],
  ['stream: a finish, then an envelope', stream(ROLE, TEXT, finishChunk('stop'), ENVELOPE)],
  ['stream: text and the error in one frame', stream(ROLE, finishChunk('error', ENVELOPE, { content: 'partial ' }))],
  ['whole: finish_reason error with an envelope', whole('partial', 'error', ENVELOPE)],
  ['whole: an envelope and no finish_reason', whole('partial', null, ENVELOPE)],
]) {
  test(`a stated error after text is an unfinished answer — ${name}`, async () => {
    assertStatedFailure(await taskAgainst(script));
  });
}

for (const [name, script] of [
  ['stream', stream(ROLE, TEXT, finishChunk('error'))],
  ['whole', whole('partial', 'error')],
]) {
  test(`finish_reason error after text, with no envelope, is an unfinished answer — ${name}`, async () => {
    assertStatedFailure(await taskAgainst(script), /\(error\)|— error/);
  });
}

test('an error after reasoning alone is an unfinished answer, not a refusal', async () => {
  const { result, requests } = await taskAgainst(
    stream(ROLE, deltaFrame({ reasoning_content: 'thinking' }), finishChunk('error', ENVELOPE)),
  );
  assert.equal(requests, 3);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, 'stream-unfinished');
});

for (const [name, script] of [
  ['stream, same frame', stream(ROLE, TEXT, finishChunk('stop', ENVELOPE))],
  ['stream, the finish coming after the envelope', stream(ROLE, TEXT, ENVELOPE, finishChunk('stop'))],
  ['whole reply', whole('partial', 'stop', ENVELOPE)],
]) {
  test(`a finish reason outranks a warning beside finished text — ${name}`, async () => {
    assertAnswered(await taskAgainst(script));
  });
}

const BLANK = { error: { code: 0, message: '', detail: { message: '' } } };
for (const [name, script] of [
  ['beside the first frame', stream({ ...ROLE, ...BLANK }, TEXT, finishChunk('stop'))],
  ['beside every frame', stream({ ...ROLE, ...BLANK }, { ...TEXT, ...BLANK }, finishChunk('stop', BLANK))],
  ['on a trailing frame', stream(ROLE, TEXT, finishChunk('stop'), { choices: [], ...BLANK })],
  ...['usage', 'object', 'id', 'model'].map((key) => [
    `on a trailing ${key} frame with no choices key`,
    stream(ROLE, TEXT, finishChunk('stop'), { [key]: key === 'usage' ? {} : 'x', ...BLANK }),
  ]),
  ['a whole reply', whole('partial', 'stop', BLANK)],
]) {
  test(`a blank envelope is no signal — ${name}`, async () => {
    assertAnswered(await taskAgainst(script));
  });
}

test('an envelope beside ordinary choices before text waits for the finished reply', async () => {
  assertAnswered(await taskAgainst(stream({ ...ROLE, ...ENVELOPE }, TEXT, finishChunk('stop'))));
});

test('a refusal with a stated cause ends the stream, whatever is buffered behind it', async () => {
  assertStatedRefusal(await taskAgainst(stream(ROLE, finishChunk('error', ENVELOPE), TEXT, finishChunk('stop'))));
});

test('a frame that states nothing does not end the stream after an earlier envelope', async () => {
  assertAnswered(await taskAgainst(stream({ ...ROLE, ...ENVELOPE }, { usage: {} }, TEXT, finishChunk('stop'))));
});

test('an envelope beside ordinary choices with no text is refused when the reply finishes', async () => {
  assertStatedRefusal(await taskAgainst(stream({ ...ROLE, ...ENVELOPE })));
});

test('a malformed finish_reason is no proof of finishing: text, then no terminator', async () => {
  const { result, requests } = await taskAgainst((response) => respondStream(response, [ROLE, TEXT, finishChunk({})], { done: false }));
  assert.equal(requests, 3);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, 'stream-unfinished');
});

test('a blank usage trailer does not hide the real envelope after it', async () => {
  assertStatedFailure(await taskAgainst(stream(ROLE, TEXT, { usage: {}, ...BLANK }, ENVELOPE)));
});

const NESTED = { error: { detail: { message: 'insufficient memory' } } };
const META = { id: 'x', model: 'test-model' };
for (const [name, script] of [
  ['with metadata and no choices', stream(ROLE, { ...META, ...NESTED })],
  ['as an array', stream(ROLE, { ...META, error: [{ message: 'insufficient memory' }] })],
  ['naming itself an error', stream(ROLE, { object: 'error', ...NESTED })],
  ['with text behind it', stream(ROLE, { ...META, ...NESTED }, TEXT, { ...META, ...NESTED })],
]) {
  test(`a nested-only error is a stated error — ${name}`, async () => {
    assertStatedRefusal(await taskAgainst(script));
  });
}

test('a nested-only error after a finish reopens it', async () => {
  assertStatedFailure(await taskAgainst(stream(ROLE, TEXT, finishChunk('stop'), { ...META, ...NESTED })));
});

test('a real envelope on a chunk with no choices key still ends the stream', async () => {
  const meta = { id: 'x', object: 'chat.completion.chunk', model: 'test-model', ...ENVELOPE };
  assertStatedRefusal(await taskAgainst(stream(ROLE, meta, TEXT, finishChunk('stop'))));
});

test('with text, a later finish outranks finish_reason error, as the last signal decides', async () => {
  assertAnswered(await taskAgainst(stream(ROLE, TEXT, finishChunk('error', ENVELOPE), finishChunk('stop'))));
});

const WARNING = { error: { message: 'warning: optional telemetry unavailable' } };
for (const [name, frames] of [
  ['before text', [{ ...ROLE, ...WARNING }, ENVELOPE]],
  ['after text', [ROLE, TEXT, { choices: [], ...WARNING }, ENVELOPE]],
]) {
  test(`the latest stated error is the one reported — ${name}`, async () => {
    const { result } = await taskAgainst(stream(...frames));
    assert.match(result.stderr, /insufficient memory/);
    assert.doesNotMatch(result.stderr, /telemetry/);
  });
}

test('a warning after finish_reason error does not replace the cause', async () => {
  const { result } = await taskAgainst(stream(ROLE, TEXT, finishChunk('error', ENVELOPE), { choices: [], usage: {}, ...WARNING }));
  assert.match(result.stderr, /insufficient memory/);
  assert.doesNotMatch(result.stderr, /telemetry/);
});

test('a warning before finish_reason error with its envelope does not replace the cause', async () => {
  const { result } = await taskAgainst(stream(ROLE, TEXT, { choices: [], ...WARNING }, finishChunk('error', ENVELOPE)));
  assert.match(result.stderr, /insufficient memory/);
  assert.doesNotMatch(result.stderr, /telemetry/);
});

test('a held warning does not turn a bare finish_reason error into the end of the stream', async () => {
  assertAnswered(await taskAgainst(stream(ROLE, { ...finishChunk(null), ...WARNING }, finishChunk('error'), TEXT, finishChunk('stop'))));
});

for (const [name, frames] of [
  ['with no text', [{ ...ROLE, ...WARNING }, finishChunk('error'), ENVELOPE]],
  ['after text', [ROLE, TEXT, { choices: [], ...WARNING }, finishChunk('error'), ENVELOPE]],
]) {
  test(`an error after a bare finish_reason error replaces an earlier warning — ${name}`, async () => {
    const { result } = await taskAgainst(stream(...frames));
    assert.match(result.stderr, /insufficient memory/);
    assert.doesNotMatch(result.stderr, /telemetry/);
  });
}

test('the first error at or after finish_reason error is the cause, whichever it is', async () => {
  const { result } = await taskAgainst(stream(ROLE, TEXT, finishChunk('error'), { choices: [], ...WARNING }, ENVELOPE));
  assert.match(result.stderr, /telemetry/);
  assert.doesNotMatch(result.stderr, /insufficient memory/);
});

test('a later finish clears a settled cause, so a later error replaces it', async () => {
  const { result } = await taskAgainst(stream(ROLE, TEXT, finishChunk('error', WARNING), finishChunk('stop'), ENVELOPE));
  assert.match(result.stderr, /insufficient memory/);
});

for (const [name, warning] of [
  ['beside choices', { ...finishChunk(null), ...WARNING }],
  ['on a trailer', { choices: [], ...WARNING }],
]) {
  test(`a warning ${name} after a bare finish_reason error waits for the finished reply`, async () => {
    assertAnswered(await taskAgainst(stream(ROLE, finishChunk('error'), warning, TEXT, finishChunk('stop'))));
  });
}

test('a warning after a bare finish_reason error still refuses a reply with no text', async () => {
  assertStatedRefusal(await taskAgainst(stream(ROLE, finishChunk('error'), { ...finishChunk(null), ...WARNING })), /telemetry/);
});

test('a warning before text fails a reply that gave no finish reason, though it ends on text', async () => {
  assertStatedFailure(await taskAgainst(stream({ ...ROLE, ...WARNING }, TEXT)), /telemetry/);
});

test('a blank envelope does not hide the real one after it', async () => {
  assertStatedFailure(await taskAgainst(stream(ROLE, TEXT, { choices: [], ...BLANK }, ENVELOPE)));
});

for (const malformed of [{}, [], true, 1, '   ']) {
  for (const [name, script] of [
    ['same frame', stream(ROLE, TEXT, finishChunk(malformed, ENVELOPE))],
    ['after the envelope', stream(ROLE, TEXT, ENVELOPE, finishChunk(malformed))],
    ['after finish_reason error', stream(ROLE, TEXT, finishChunk('error', ENVELOPE), finishChunk(malformed))],
    ['whole reply', whole('partial', malformed, ENVELOPE)],
  ]) {
    test(`a malformed finish_reason ${JSON.stringify(malformed)} does not outrank a stated error — ${name}`, async () => {
      assertStatedFailure(await taskAgainst(script));
    });
  }
}

test('an envelope in the frame after a bare finish_reason error keeps the server\'s text', async () => {
  assertStatedRefusal(await taskAgainst(stream(ROLE, finishChunk('error'), ENVELOPE)));
});

test('text after a bare finish_reason error is an unfinished answer, not a refusal', async () => {
  const { result, requests } = await taskAgainst(stream(ROLE, finishChunk('error'), TEXT));
  assert.equal(requests, 3);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, 'stream-unfinished');
});

test('with no text, a later finish outranks a bare finish_reason error', async () => {
  const { result, requests } = await taskAgainst(stream(ROLE, finishChunk('error'), finishChunk('stop')));
  assert.equal(requests, 3);
  assert.equal(JSON.parse(result.stdout).reason, 'empty-completion');
});

test('the failures carry the server\'s text and finish reason off the message', () => {
  const stated = emptyAnswer();
  applyFrame(stated, finishChunk('error', ENVELOPE));
  const refusal = refusalIfStated(stated, 'local');
  assert.equal(refusal.responseBody, MTPLX_ERROR.slice(0, 400));
  assert.ok(MTPLX_ERROR.length > 400, 'the capture exercises the cap');
  assert.equal(refusal.finishReason, 'error');
  assert.equal(refusal.serverResponded, true);
  assert.doesNotMatch(refusal.message, /insufficient/);

  const bare = emptyAnswer();
  applyCompletion(bare, { choices: [{ message: { content: null }, finish_reason: 'error' }] });
  const unstated = refusalIfStated(bare, 'local');
  assert.equal(unstated.responseBody, undefined, 'no server text is invented');
  assert.equal(unstated.finishReason, 'error');

  const long = emptyAnswer();
  applyFrame(long, { error: { message: 'x'.repeat(900) } });
  assert.equal(refusalIfStated(long, 'local').responseBody.length, 400);
});

test('an unfinished answer carries the finish reason and the partial, and invents no server text', () => {
  const answer = emptyAnswer();
  applyFrame(answer, finishChunk('error', {}, { content: 'hi' }));
  assert.throws(
    () => finishAnswer(answer, { profile: { name: 'local' }, requestedModel: 'm', sawDone: true, streamed: true }),
    (failure) => {
      assert.equal(failure.reason, 'stream-unfinished');
      assert.equal(failure.finishReason, 'error');
      assert.equal(failure.responseBody, undefined);
      assert.equal(failure.answer.content, 'hi');
      return true;
    },
  );
});

test('with text there is no refusal to raise', () => {
  const answer = emptyAnswer();
  applyFrame(answer, finishChunk('error', ENVELOPE, { content: 'hi' }));
  assert.equal(refusalIfStated(answer, 'local'), null);
});
