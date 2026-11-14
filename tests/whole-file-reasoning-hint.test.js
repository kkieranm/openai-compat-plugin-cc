// What a review that sent the changed files whole tells the user when the model
// reasons and never answers: remedies that shrink the input or adjust the
// reasoning effort the request carried, not a higher --max-tokens. A review on
// the hunks rung keeps its own hint; a salvage the deadline ended is covered in
// tests/salvage.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeFileReasoningHint } from '../plugins/oai/scripts/lib/review-request.mjs';
import {
  chatRequests,
  deltaFrame,
  modelList,
  reasoningFrames,
  respondJson,
  respondStream,
  reviewScenario,
  runCompanion,
} from './helpers.mjs';

// Literal, not the helper's output, so a wording or gating change in the helper
// fails here rather than moving every expectation with it.
const WITHOUT_EFFORT = 'The model reasoned without answering while reading the changed files whole. Try '
  + '--diff-only, which omits whole-file context for the files the diff covers (less surrounding code, so it '
  + 'can miss defects), or review a smaller target.';
const WITH_EFFORT = 'The model reasoned without answering while reading the changed files whole. Try '
  + '--diff-only, which omits whole-file context for the files the diff covers (less surrounding code, so it '
  + 'can miss defects), or try changing or omitting --reasoning-effort, or review a smaller target.';

/** A clean stream that never left its reasoning channel, too short to salvage. */
function reasoningOnly(record, response) {
  if (!record.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
  return respondStream(response, reasoningFrames('thinking'));
}

async function failedReview(handler, args, options) {
  const { dir, server, configPath } = await reviewScenario(handler, options);
  try {
    const result = await runCompanion(['review', '--json', ...args], { configPath, cwd: dir });
    assert.equal(result.status, 1, result.stderr);
    return { envelope: JSON.parse(result.stdout), chats: chatRequests(server) };
  } finally {
    await server.close();
  }
}

test('the hint names --diff-only, a smaller target and --reasoning-effort only when it was sent', () => {
  assert.equal(wholeFileReasoningHint({ effortSent: true }), WITH_EFFORT);
  assert.equal(wholeFileReasoningHint({ effortSent: false }), WITHOUT_EFFORT);
  for (const hint of [WITH_EFFORT, WITHOUT_EFFORT]) {
    assert.match(hint, /--diff-only/);
    assert.match(hint, /can miss defects/);
    assert.match(hint, /smaller target/);
    assert.doesNotMatch(hint, /--max-tokens/);
  }
  assert.match(WITH_EFFORT, /changing or omitting --reasoning-effort/);
  assert.doesNotMatch(WITHOUT_EFFORT, /reasoning-effort/);
});

test('a whole-file review that ends reasoning-only with --reasoning-effort sent gets the whole-file hint', async () => {
  const { envelope, chats } = await failedReview(reasoningOnly, ['--reasoning-effort', 'low']);
  assert.equal(envelope.reason, 'reasoning-only');
  assert.equal(envelope.hunksOnly, false, 'the changed file went whole');
  assert.equal(chats[0].body.reasoning_effort, 'low');
  assert.equal(envelope.hint, WITH_EFFORT);
});

test('the whole-file hint reaches the text-mode stderr', async () => {
  const { dir, server, configPath } = await reviewScenario(reasoningOnly);
  try {
    const result = await runCompanion(['review', '--reasoning-effort', 'low'], { configPath, cwd: dir });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.split('\n').includes(WITH_EFFORT), result.stderr);
  } finally {
    await server.close();
  }
});

test('a whole-file review that ends reasoning-only without --reasoning-effort gets the hint without that clause', async () => {
  const { envelope, chats } = await failedReview(reasoningOnly, []);
  assert.equal(envelope.reason, 'reasoning-only');
  assert.equal(envelope.hunksOnly, false);
  assert.equal(Object.hasOwn(chats[0].body, 'reasoning_effort'), false);
  assert.equal(envelope.hint, WITHOUT_EFFORT);
});

test('a whole-file review that sent other sampling flags but no --reasoning-effort gets the hint without that clause', async () => {
  const { envelope, chats } = await failedReview(reasoningOnly, ['--top-p', '0.9']);
  assert.equal(envelope.reason, 'reasoning-only');
  assert.equal(chats[0].body.top_p, 0.9);
  assert.equal(Object.hasOwn(chats[0].body, 'reasoning_effort'), false);
  assert.equal(envelope.hint, WITHOUT_EFFORT);
});

test('a --diff-only review that ends reasoning-only keeps the reasoning-only hint', async () => {
  const { envelope } = await failedReview(reasoningOnly, ['--diff-only', '--reasoning-effort', 'low']);
  assert.equal(envelope.reason, 'reasoning-only');
  assert.match(envelope.hint, /Raise --max-tokens/);
  assert.doesNotMatch(envelope.hint, /--diff-only/);
});

/** Reasoning past the cutoff on the first chat; every salvage follow-up runs out of tokens. */
function cutoffThenExhaustedSalvage(record, response) {
  if (!record.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
  if (!record.body.messages.some((message) => message.role === 'assistant')) {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    for (let i = 0; i < 90; i += 1) {
      response.write(`data: ${JSON.stringify(deltaFrame({ reasoning_content: 'r'.repeat(1_000) }))}\n\n`);
    }
    return undefined; // No end() — the reserve watchdog is what stops this stream.
  }
  return respondStream(response, reasoningFrames('still thinking', { finishReason: 'length' }));
}

test('a whole-file review cut at the reasoning cutoff whose salvage also fails gets the whole-file hint', async () => {
  // reserve 30,848 on this window: the watchdog cuts at (30,848 - 2,048) * 3 = 86,400 characters.
  const { envelope, chats } = await failedReview(cutoffThenExhaustedSalvage, [], { contextLength: 61_696 });
  assert.equal(envelope.reason, 'token-reserve-cutoff');
  assert.equal(envelope.hunksOnly, false);
  assert.ok(chats.length >= 2, 'a salvage follow-up went out and failed');
  assert.equal(envelope.hint, WITHOUT_EFFORT);
});

test('a --diff-only review cut at the reasoning cutoff whose salvage also fails keeps the cutoff hint', async () => {
  const { envelope } = await failedReview(cutoffThenExhaustedSalvage, ['--diff-only'], { contextLength: 61_696 });
  assert.equal(envelope.reason, 'token-reserve-cutoff');
  assert.equal(envelope.hint, 'No answer could be concluded from the partial reasoning. Review a smaller target.');
});

test('a multi-pass whole-file review whose passes all end reasoning-only surfaces the whole-file hint', async () => {
  const { envelope, chats } = await failedReview(reasoningOnly, ['--lens', 'correctness,security']);
  assert.equal(chats.length, 2, 'one request per pass');
  assert.equal(envelope.reason, 'reasoning-only');
  assert.equal(envelope.hint, WITHOUT_EFFORT);
});
