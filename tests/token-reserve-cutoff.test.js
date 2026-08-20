// OAI-115: a reasoning model can spend its whole max_tokens pool reasoning and
// never write an answer. This is the live, per-frame watchdog that cuts the
// stream before the pool is exhausted (stream-collect.mjs), generalized into
// OAI-138's existing salvage mechanism (review-request.mjs's trySalvage).
//
// Modeled on tests/salvage.test.js's fixture shape (a server that streams
// reasoning_content, a follow-up handler for the salvage attempt) since the two
// mechanisms share the same downstream machinery and only differ in trigger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo, reviewScenario, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectStream } from '../scripts/lib/stream-collect.mjs';

/** One reasoning delta frame, 51 characters. */
function reasoningFrame() {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'test-model',
    choices: [{ index: 0, delta: { reasoning_content: 'still reasoning about this commit in great detail. ' }, finish_reason: null }],
  })}\n\n`;
}

function contentDeltaFrame(content) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'test-model',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

function finishFrame(content) {
  return [
    contentDeltaFrame(content),
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

// The default reviewScenario contextLength (8192) gives reserveFor() a 4096
// reserve (half-window), which is exactly 2 * TOKEN_RESERVE_TOKENS (2048) —
// the arm guard's own boundary — so the watchdog is armed with a
// cutoffChars of (4096 - 2048) * 3.0 = 6144. 130 chunks of the 51-char
// reasoningFrame() (6630 chars) clears that with margin, written
// synchronously so the test has no timing dependency at all.
const CHUNKS_PAST_THRESHOLD = 130;

/** A server whose FIRST request streams reasoning synchronously past the
 * cutoff threshold; every later request gets `onFollowUp` instead. */
function reasoningPastThresholdThenFollowUp(onFollowUp) {
  let requestCount = 0;
  return (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    requestCount += 1;
    if (requestCount > 1) {
      onFollowUp(record, response);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    for (let i = 0; i < CHUNKS_PAST_THRESHOLD; i += 1) response.write(reasoningFrame());
    // No end() — a real starved model keeps generating; the client-side
    // watchdog must be what stops this, not the server finishing on its own.
  };
}

test('the idle timer cannot overwrite a cutoff that already fired, even when the async iterator teardown is slow', async () => {
  // review-ladder pass 1, codex-adversarial (round 2, re-checking its own
  // just-applied throw-immediately fix): throwing out of a for-await loop
  // still runs IteratorClose on the underlying async generator BEFORE this
  // function's own catch executes, and that cleanup can itself await — a
  // real gap in which the still-armed idle timer could fire and overwrite
  // `expired`. Reproduced here exactly the way it was found: a controlled
  // fake response.stream whose iterator .return() is deliberately slow (20ms),
  // paired with an idleMs (1ms) shorter than that delay — no real network or
  // CLI involved, since the race is a pure async-JS-semantics timing window
  // that a real HTTP fixture cannot reliably reproduce without flaking.
  const reasoningFrame100 = `data: ${JSON.stringify({
    id: 'x', object: 'chat.completion.chunk', model: 'test-model',
    choices: [{ index: 0, delta: { reasoning_content: 'x'.repeat(100) }, finish_reason: null }],
  })}\n\n`;
  let disposed = false;
  const response = {
    stream: {
      [Symbol.asyncIterator]() {
        let yielded = false;
        return {
          async next() {
            if (!yielded) {
              yielded = true;
              return { value: reasoningFrame100, done: false };
            }
            // Never reached: the watchdog must fire and close the iterator
            // after the first frame, in both the buggy and fixed versions.
            return { value: undefined, done: true };
          },
          async return(value) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { value, done: true };
          },
        };
      },
    },
    dispose() {
      disposed = true;
    },
  };

  await assert.rejects(
    collectStream(response, { name: 'test-model' }, {
      startedAt: performance.now(),
      firstTokenMs: 5000,
      idleMs: 1, // shorter than the 20ms teardown delay above, on purpose
      onProgress: () => {},
      maxTokens: 10,
      reasoningReserveTokens: 1, // cutoffChars = (10-1)*3 = 27, well under the 100-char frame
    }),
    (error) => {
      assert.equal(error.reason, 'token-reserve-cutoff', 'the idle timer must not have been able to overwrite this');
      return true;
    },
  );
  assert.ok(disposed);
});

test('a reasoning stream that crosses the reserve threshold is cut and salvaged, tagged salvaged: true', async () => {
  const handler = reasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from partial reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.findings.length, 1);
    assert.equal(envelope.findings[0].summary, 'concluded from partial reasoning');

    // Cause-neutral wording — this trigger has nothing to do with a deadline.
    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 2, 'exactly one salvage attempt, on top of the original');
    const ask = chatRequests[1].body.messages.at(-1);
    assert.match(ask.content, /^Your previous response was cut off before it finished\./);
    assert.doesNotMatch(ask.content, /ran out of time/, 'the deadline-specific wording must not leak into this trigger');

    // The salvage follow-up's OWN budget is the small reserve, not the
    // original (much larger) built.reserve — otherwise appending the
    // consumed reasoning back in would very likely overrun the window.
    assert.equal(chatRequests[1].body.max_tokens, 2048);
  } finally {
    await server.close();
  }
});

test('a cutoff still fires even when the finish and [DONE] arrive in the SAME transport chunk as the crossing frame', async () => {
  // review-ladder pass 1, codex-adversarial (reproduced directly): setting
  // `expired` and calling response.dispose() without throwing let the loop
  // keep draining whatever else `readSse` had already parsed from the same
  // physical chunk — a finish frame and [DONE] bundled with the crossing
  // frame meant the cutoff was silently discarded and the review returned as
  // an ordinary
  // success carrying the bundled (bogus) content. This writes all of it in
  // ONE response.write() call, deliberately, to reproduce that exact shape.
  const bundled = [
    ...Array.from({ length: CHUNKS_PAST_THRESHOLD }, () => reasoningFrame()),
    finishFrame(JSON.stringify({ findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'MUST NOT be used' }], summary: 'bogus' })),
  ].join('');
  let requestCount = 0;
  const handler = (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    requestCount += 1;
    if (requestCount > 1) {
      // The salvage follow-up, once the cutoff is correctly caught.
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.write(finishFrame(JSON.stringify({
        findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'genuinely salvaged' }],
        summary: 'salvaged',
      })));
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(bundled);
    response.end();
  };
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    // The bundled content must never win — a genuine second request (the
    // salvage follow-up) must have happened, and its OWN findings must be
    // what's reported.
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 2);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.findings.length, 1);
    assert.equal(envelope.findings[0].summary, 'genuinely salvaged');
  } finally {
    await server.close();
  }
});

test('--structured-output never arms the watchdog — the answer legitimately lives on the reasoning channel there', async () => {
  // review-ladder pass 1 (codex-adversarial): under a response_format grammar
  // the model can never emit the token that closes its own think block, so
  // the real findings JSON arrives via reasoning_content, never content — the
  // watchdog's content.length === 0 guard is therefore always true regardless
  // of how much real answer has been written. Streaming well past what would
  // trigger the cutoff on the unconstrained path (see the SSE-fixture test at line ~137) must
  // never cut this stream at all.
  const handler = reasoningPastThresholdThenFollowUp(() => {
    throw new Error('no salvage follow-up should ever be requested under --structured-output — the watchdog must never arm there');
  });
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer(handler);
  // No end() in the fixture (a real starved model keeps generating), so this
  // needs its own short idle bound rather than reviewScenario's 60s default —
  // unrelated to the mechanism under test, purely to end the fixture quickly.
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    // timeoutSeconds bounds a hung follow-up request too (a throwing handler
    // never writes a response at all), so a broken exclusion fails this test
    // fast instead of hanging on the default 600s first-token budget.
    providers: {
      local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, idleSeconds: 1, timeoutSeconds: 2 },
    },
  });
  try {
    const result = await runCompanion(['review', '--json', '--structured-output'], { configPath, cwd: dir });
    const envelope = JSON.parse(result.stdout);
    // Exact reason, not just notEqual('token-reserve-cutoff') — a bare
    // negative also passes on an unrelated failure (codex-plain, review-ladder
    // pass 1), which would prove nothing about the exclusion specifically.
    assert.equal(result.status, 1);
    assert.equal(envelope.reason, 'idle-timeout', 'the exclusion must have kept the watchdog off under --structured-output');
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1, 'no cutoff means no salvage follow-up either');
  } finally {
    await server.close();
  }
});

test('a salvage attempt that itself fails falls back to reporting token-reserve-cutoff plainly', async () => {
  const handler = reasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end('not json');
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'token-reserve-cutoff');
    assert.equal(envelope.salvaged, undefined);
    // Tier 1's guarantee: the partial reasoning survives even when salvage fails.
    assert.ok(envelope.partial?.reasoning?.length >= 6144);
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 2);
  } finally {
    await server.close();
  }
});

test('content already underway permanently disarms the watchdog, however much reasoning follows', async () => {
  // The false-trigger guard (OAI-115 decision 5): once any content has
  // appeared, the watchdog never fires again for that stream — order here is
  // deliberately unrealistic (content before more reasoning) precisely to
  // isolate the guard from real model behaviour and prove it holds regardless.
  const handler = (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(contentDeltaFrame('{"findings": [], "summary": "content led"}'));
    for (let i = 0; i < CHUNKS_PAST_THRESHOLD; i += 1) response.write(reasoningFrame());
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
  };
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    // A success envelope always carries `salvaged` (true or false) — only a
    // failure envelope omits the field entirely (see tests/salvage.test.js).
    assert.equal(envelope.salvaged, false, 'this must complete as an ordinary review, never a salvaged one');
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1, 'no cutoff, no salvage follow-up');
  } finally {
    await server.close();
  }
});

test('a small-window model where the reserve would exceed half the budget is never armed', async () => {
  // reserveFor()'s half-window branch on a 6000-token window gives a reserve
  // of 3000 — below 2 * TOKEN_RESERVE_TOKENS (4096), so the arm guard
  // (OAI-115 decision 4) must leave the watchdog off entirely. Streamed
  // reasoning well past what would trigger it on the default-window test
  // above must complete normally rather than dying on the very first delta.
  //
  // Deliberately NOT a round-number window like 4096 (built.reserve exactly
  // 2048, i.e. exactly TOKEN_RESERVE_TOKENS): at that boundary a broken arm
  // guard that always returns TOKEN_RESERVE_TOKENS produces cutoffChars of
  // exactly 0, which stream-collect.mjs's OWN defensive `cutoffChars > 0`
  // check also blocks — masking the very regression this test exists to
  // catch (proven by mutation: that boundary value left this test green
  // even with `armedReserve` mutated to always arm). 6000 keeps
  // built.reserve (3000) strictly between TOKEN_RESERVE_TOKENS and
  // 2 * TOKEN_RESERVE_TOKENS, where a broken arm guard and the correct one
  // genuinely disagree.
  const handler = reasoningPastThresholdThenFollowUp(() => {
    throw new Error('no salvage follow-up should ever be requested — the watchdog must never have armed');
  });
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer(handler);
  // The first request never finishes streaming in this fixture (no end()), so
  // this needs its own short idle bound rather than reviewScenario's default
  // (60s) — an unrelated cap this test uses only to end the fixture quickly.
  // What is under test is WHICH reason ends it: idle-timeout proves the
  // reserve watchdog never armed; token-reserve-cutoff would mean the arm
  // guard was broken and fired first.
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    // timeoutSeconds bounds a hung follow-up request too (a throwing handler
    // never writes a response at all), so a broken arm guard fails this test
    // fast instead of hanging on the default 600s first-token budget.
    providers: {
      local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 6000, idleSeconds: 1, timeoutSeconds: 2 },
    },
  });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    // Exact equality, not just notEqual('token-reserve-cutoff') — a bare
    // negative also passes on an unrelated failure (codex-plain, review-ladder
    // pass 1), which would prove nothing about the arm guard specifically.
    assert.equal(envelope.reason, 'idle-timeout', 'the arm guard must have kept the watchdog off on this small window');
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1, 'no cutoff means no salvage follow-up either');
  } finally {
    await server.close();
  }
});
