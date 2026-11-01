// A server states an error on a frame that does not end generation, then the
// stream drops: the drop stays the failure, and the server's words still reach
// the operator.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerWithRetry } from '../plugins/oai/scripts/lib/answer-attempts.mjs';
import { isFormatRejection } from '../plugins/oai/scripts/lib/structured.mjs';
import { transportDetail } from '../plugins/oai/scripts/lib/provider.mjs';
import { chatRequests, deltaFrame, respondJson, runCompanion, scriptOf, startFakeServer, writeConfig } from './helpers.mjs';

const TEXT = 'the model ran out of memory';
const beside = (message = TEXT) => ({ choices: [{ delta: {} }], error: { message } });
const finishedInError = { choices: [{ delta: {}, finish_reason: 'error' }] };

const writeFrames = (response, frames) => {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`);
};
const reset = (...frames) => (response) => {
  writeFrames(response, frames);
  setTimeout(() => response.socket?.destroy(), 20);
};
const truncated = (...frames) => (response) => {
  writeFrames(response, frames);
  response.end('data: {"choices"\n\n');
};
const answered = (response) => {
  writeFrames(response, [deltaFrame({ content: 'ok' })]);
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
  response.end('data: [DONE]\n\n');
};

async function task(scripts, args = []) {
  const server = await startFakeServer(scriptOf(scripts));
  const { path } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, retrySeconds: 0 } },
  });
  try {
    const result = await runCompanion(['task', ...args, 'say hi'], { configPath: path });
    return { result, requests: chatRequests(server).length };
  } finally {
    await server.close();
  }
}

async function answer(scripts, options) {
  const server = await startFakeServer(scriptOf(scripts));
  try {
    return await answerWithRetry(
      { name: 'local', baseUrl: server.baseUrl },
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: true },
      { firstTokenMs: 5000, idleMs: 5000, retryDelayMs: 0, ...options },
    ).catch((error) => error);
  } finally {
    await server.close();
  }
}

for (const [name, script, reason, requests] of [
  ['a finish in error, an error beside choices, then a reset', reset(finishedInError, beside()), 'transport', 3],
  ['an error beside choices, then a reset', reset(beside()), 'transport', 3],
  ['a finish in error, an error beside choices, then a truncated frame', truncated(finishedInError, beside()), 'protocol', 1],
]) {
  test(`${name}: the reason and the retries stand, and the text is shown`, async () => {
    const shown = await task([script]);
    assert.equal(shown.result.status, 1);
    assert.equal(shown.requests, requests);
    assert.match(shown.result.stderr, new RegExp(TEXT));

    const json = await task([script], ['--json']);
    assert.equal(JSON.parse(json.result.stdout).reason, reason);
    assert.doesNotMatch(json.result.stdout, new RegExp(TEXT), 'server text is displayed, never persisted');
  });
}

test('a drop with nothing stated shows no held text', async () => {
  const failure = await answer([reset()]);
  assert.equal(failure.reason, 'transport');
  assert.equal(failure.heldServerError, undefined);
});

test('the text survives later attempts that stated nothing', async () => {
  const { result, requests } = await task([reset(beside()), reset()]);
  assert.equal(requests, 3);
  assert.match(result.stderr, new RegExp(TEXT));
});

test('the latest held text is the one shown', async () => {
  const failure = await answer([reset(beside('first')), reset(beside('second')), reset()]);
  assert.equal(transportDetail(failure), 'second');
});

test('an attempt that answers leaves no trace of the held text', async () => {
  const { result, requests } = await task([reset(beside()), answered]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests, 2);
  assert.doesNotMatch(result.stderr, new RegExp(TEXT));
});

test('the cap falling due during the retry wait keeps the text', async () => {
  const failure = await answer([reset(beside())], {
    retryDelayMs: 60_000,
    expiresAt: performance.now() + 500,
    maxMs: 500,
  });
  assert.equal(failure.heldServerError, TEXT);
  assert.notEqual(failure.reason, 'transport');
});

test('the cap already due when the attempt fails keeps the text', async (t) => {
  const real = performance.now.bind(performance);
  let shift = 0;
  t.mock.method(performance, 'now', () => real() + shift);
  const failure = await answer([(response) => {
    writeFrames(response, [beside()]);
    setTimeout(() => {
      shift = 3_600_000;
      response.socket?.destroy();
    }, 20);
  }], { expiresAt: real() + 60_000, maxMs: 60_000 });
  assert.equal(failure.heldServerError, TEXT);
  assert.notEqual(failure.reason, 'transport');
});

test('a refusal in one attempt carries its text on responseBody alone', async () => {
  const failure = await answer([(response) => {
    writeFrames(response, [{ error: { message: TEXT } }]);
    response.end();
  }]);
  assert.equal(failure.reason, 'stream-error-frame');
  assert.equal(failure.responseBody, TEXT);
  assert.equal(failure.heldServerError, undefined);
});

test('an error a finish outranked is not held', async () => {
  const failure = await answer([reset(deltaFrame({ content: 'ok' }), beside(), { choices: [{ delta: {}, finish_reason: 'stop' }] })]);
  assert.equal(failure.reason, 'transport');
  assert.equal(failure.heldServerError, undefined);
});

test('with no text a finish outranks nothing, so the error is still held', async () => {
  const stop = { choices: [{ delta: {}, finish_reason: 'stop' }] };
  for (const frames of [[beside(), stop], [{ ...beside(), choices: stop.choices }]]) {
    const failure = await answer([reset(...frames)]);
    assert.equal(failure.reason, 'transport');
    assert.equal(transportDetail(failure), TEXT);
  }
});

for (const thrown of [null, undefined, 0, '']) {
  test(`a thrown ${JSON.stringify(thrown)} is rethrown as it was`, async () => {
    const failure = await answer([answered], {
      onProgress: () => {
        throw thrown;
      },
    });
    assert.equal(failure, thrown);
  });
}

test('held text never reads as a format rejection on a later 400', async () => {
  const failure = await answer([
    reset(beside('response_format is not supported')),
    (response) => respondJson(response, { error: { message: 'bad request' } }, 400),
  ]);
  assert.equal(failure.status, 400);
  assert.equal(isFormatRejection(failure), false);
  assert.equal(failure.heldServerError, 'response_format is not supported');
});
