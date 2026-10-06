// A reasoning model can spend its whole max_tokens pool reasoning and
// never write an answer. This is the live, per-frame watchdog that cuts the
// stream before the pool is exhausted (stream-collect.mjs), generalized into
// the existing salvage mechanism (review-request.mjs's trySalvage).
//
// Modeled on tests/salvage.test.js's fixture shape (a server that streams
// reasoning_content, a follow-up handler for the salvage attempt) since the two
// mechanisms share the same downstream machinery and only differ in trigger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo, reviewScenario, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectStream } from '../plugins/oai/scripts/lib/stream-collect.mjs';
import { estimateTokens } from '../plugins/oai/scripts/lib/context-guard.mjs';
import { findingsFirst, schemaInstruction } from '../plugins/oai/scripts/lib/structured.mjs';
import { reviewSchemaFor } from '../plugins/oai/scripts/lib/review-schema.mjs';

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
  // Throwing out of a for-await loop still runs IteratorClose on the
  // underlying async generator BEFORE this function's own catch executes, and
  // that cleanup can itself await — a real gap in which the still-armed idle
  // timer could fire and overwrite `expired`. Reproduced here with a
  // controlled fake response.stream whose iterator .return() is deliberately slow (20ms),
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
    assert.equal(envelope.retried, true, 'the original failed attempt plus the salvage follow-up are two physical requests');

    // The follow-up's actual wire shape: original system+user, unchanged, then
    // an assistant turn carrying the partial reasoning, then a new user ask.
    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 2, 'exactly one salvage attempt, on top of the original');
    const followUp = chatRequests[1].body.messages;
    assert.equal(followUp.length, 4);
    assert.equal(followUp[0].role, 'system');
    assert.equal(followUp[1].role, 'user');
    assert.equal(followUp[2].role, 'assistant');
    assert.ok(followUp[2].content.includes('still reasoning about this commit in great detail.'), 'the assistant turn must carry the real partial reasoning');
    assert.equal(followUp[3].role, 'user');
    // Same original system+user turns, byte for byte — reused rather than
    // rebuilt, so the server's own prefix cache (if any) can still apply.
    const original = chatRequests[0].body.messages;
    assert.equal(followUp[0].content, original[0].content);
    assert.equal(followUp[1].content, original[1].content);

    // The shape the original request named, rebuilt from the reserve it was
    // sent with — this window's half-window reserve (see the comment above
    // CHUNKS_PAST_THRESHOLD).
    const reserve = 4096;
    assert.equal(chatRequests[0].body.max_tokens, reserve);
    const expected = findingsFirst(reviewSchemaFor(reserve));

    // FULL equality on the entire turn: the override sentence immediately
    // followed by the findings-first shape, nothing inserted between them.
    // This turn is entirely static, unlike the assistant turn before it, so
    // nothing here is exempt from an exact match. Cause-neutral wording — this
    // trigger has nothing to do with a deadline.
    assert.equal(
      followUp[3].content,
      'Your previous response was cut off before it finished. Based only on your analysis above, state '
        + 'your findings now. Do not reason further — conclude from what you already have. '
        + 'Ignore any earlier instruction to work through "analysis" before "findings": there is no '
        + 'schema enforcing that order here, and this reply must carry its findings even if it runs '
        + 'out of room, so findings come FIRST. '
        + schemaInstruction(expected),
      'the follow-up turn must be exactly the override sentence immediately followed by ' +
        'findingsFirst() of the schema the original request named — no gap, no insertion, no drift',
    );
    // The order itself, read back off the wire rather than from the helper
    // that produced it.
    const asked = JSON.parse(followUp[3].content.slice(followUp[3].content.indexOf('exactly:\n') + 'exactly:\n'.length));
    assert.deepEqual(Object.keys(asked.properties), ['findings', 'analysis', 'summary']);
    assert.deepEqual(asked.required, ['findings', 'analysis', 'summary']);

    // The salvage follow-up's OWN budget is the small reserve, not the
    // original (much larger) built.reserve — otherwise appending the
    // consumed reasoning back in would very likely overrun the window.
    assert.equal(chatRequests[1].body.max_tokens, 2048);
  } finally {
    await server.close();
  }
});

test('a cutoff still fires even when the finish and [DONE] arrive in the SAME transport chunk as the crossing frame', async () => {
  // Setting `expired` and calling response.dispose() without throwing let the
  // loop keep draining whatever else `readSse` had already parsed from the
  // same physical chunk — a finish frame and [DONE] bundled with the crossing
  // frame meant the cutoff was silently discarded and the caller received an
  // ordinary success carrying the bundled (bogus) content. This writes all of
  // it in ONE response.write() call, deliberately, to reproduce that exact shape.
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
  // Under a response_format grammar the model can never emit the token that
  // closes its own think block, so
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
    // negative also passes on any other unrelated failure, which would prove
    // nothing about the exclusion specifically.
    assert.equal(result.status, 1);
    assert.equal(envelope.reason, 'idle-timeout', 'the exclusion must have kept the watchdog off under --structured-output');
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1, 'no cutoff means no salvage follow-up either');
  } finally {
    await server.close();
  }
});

// Sized so the trimmed salvage follow-up, measured the way attemptSalvage
// measures it, lands strictly between the review's own 4,096 reserve and the
// flat 2,048 one on the 8,192 window: it fits only because the follow-up
// re-reserves TOKEN_RESERVE_TOKENS rather than built.reserve.
const RESERVE_BAND_SEED = `seed\n${Array.from({ length: 70 }, (_, i) => `const line${String(i).padStart(2, '0')} = 'reviewed content for the band';\n`).join('')}`;

test('a trimmed follow-up that fits the window only under the flat 2,048 reserve is still salvaged', async () => {
  const handler = reasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'salvaged inside the band' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { seed: RESERVE_BAND_SEED });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.salvageTrim.applied, true, 'the trimmed follow-up is the one that must fit');
    assert.equal(envelope.findings[0].summary, 'salvaged inside the band');

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 2, 'the trimmed follow-up was sent, and answered, with no untrimmed resend');
    assert.equal(chatRequests[0].body.max_tokens, 4096, 'the review reserve the band is measured against');
    assert.equal(chatRequests[1].body.max_tokens, 2048);

    // The band itself, measured on the wire: above the review's own reserve
    // budget (8,192 - 4,096) and within the flat one's (8,192 - 2,048), so a
    // prompt edit that moves the follow-up out of the band fails here rather
    // than leaving this test unable to tell the two reserves apart.
    const followUpTokens = estimateTokens(chatRequests[1].body.messages.map((message) => message.content).join('\n'));
    assert.ok(followUpTokens > 8192 - 4096, `follow-up estimated at ${followUpTokens} tokens fits under the review reserve too`);
    assert.ok(followUpTokens <= 8192 - 2048, `follow-up estimated at ${followUpTokens} tokens does not fit under the flat reserve`);
  } finally {
    await server.close();
  }
});

test('a salvage attempt that itself fails falls back to reporting token-reserve-cutoff plainly', async () => {
  // Both the trimmed follow-up AND the untrimmed fallback fail identically here
  // (a trimmed attempt's failure gets one further, untrimmed attempt before
  // salvage gives up) — this fixture doesn't distinguish request 2 from request
  // 3, so both get the same malformed response.
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
    // Asserted HERE, on an envelope the watchdog actually minted, rather than
    // against a hand-built error: an absence assertion on a message nothing
    // produced passes for the wrong reason.
    //
    // The message states only what was observed — the model was reasoning, no
    // answer existed, the client stopped the stream. It makes no claim about
    // how much of the budget was spent, because the threshold is an estimate
    // that fires before the budget is gone, and at the smallest armed budget
    // it fires with half of it unspent.
    assert.doesNotMatch(envelope.message, /whole reply budget|budget was gone|ran out of tokens|neared exhaustion/i);
    assert.match(envelope.message, /reasoning cutoff/);
    assert.match(envelope.message, /had not written an answer/);
    // Tier 1's guarantee: the partial reasoning survives even when salvage fails.
    assert.ok(envelope.partial?.reasoning?.length >= 6144);
    // Original + the failed trimmed attempt + the failed untrimmed fallback attempt.
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 3);
  } finally {
    await server.close();
  }
});

// A salvage attempt that fails on a large window can produce a failure
// envelope, identical in shape to the test above, big enough to cross a pipe's
// OS buffer (64KB on darwin) — well short of MAX_RAW (256000) or any bound
// this harness controls. `cmd-review.mjs` writes that envelope with the ASYNC
// `process.stdout.write`, then rethrows; `oai-companion.mjs`'s catch sets
// `process.exitCode` rather than calling `process.exit()`, so Node drains the
// queued write before it exits on its own — the pipe's receiving end,
// `execFileSync` callers (`bench/review-sweep.mjs`) included, sees the whole
// write and never a partial one. Needs a wider window than the test above so
// the cutoff fires only once the reasoning it carries is itself big enough to
// push the whole envelope past 64KB.
const WIDE_CONTEXT_LENGTH = 51_200; // reserve 25600, cutoffChars (25600-2048)*3.0 = 70,656
const WIDE_CHUNKS_PAST_THRESHOLD = 1_450; // 1,450 * 51 = 73,950 chars, clears 70,656 with margin

function wideReasoningPastThresholdThenFollowUp(onFollowUp) {
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
    for (let i = 0; i < WIDE_CHUNKS_PAST_THRESHOLD; i += 1) response.write(reasoningFrame());
  };
}

test('a large failure envelope reaches stdout whole, not cut at a 64KB pipe boundary', async () => {
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end('not json');
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1, result.stderr);
    // The bug this reproduces: stdout cut mid-string at exactly 65536 bytes
    // (the OS pipe buffer), so a raw length assertion — not JSON.parse, which
    // would just throw either way — is what pins the specific mechanism.
    assert.ok(result.stdout.length > 65_536, `stdout was cut at the pipe boundary (${result.stdout.length} bytes)`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'token-reserve-cutoff');
    assert.ok(envelope.partial?.reasoning?.length >= 70_656);
  } finally {
    await server.close();
  }
});

test('content already underway permanently disarms the watchdog, however much reasoning follows', async () => {
  // The false-trigger guard: once any content has
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
  // must leave the watchdog off entirely. Streamed
  // reasoning well past what would trigger it on the default-window test
  // above must complete normally rather than dying on the very first delta.
  //
  // Deliberately NOT a round-number window like 4096 (built.reserve exactly
  // 2048, i.e. exactly TOKEN_RESERVE_TOKENS): at that boundary a broken arm
  // guard that always returns TOKEN_RESERVE_TOKENS produces cutoffChars of
  // exactly 0, which stream-collect.mjs's OWN defensive `cutoffChars > 0` check
  // also blocks — masking the very regression this test exists to catch (at
  // that boundary value this test would stay green even with `armedReserve`
  // mutated to always arm). 6000 keeps built.reserve (3000) strictly between
  // TOKEN_RESERVE_TOKENS and 2 * TOKEN_RESERVE_TOKENS, where a broken arm guard
  // and the correct one genuinely disagree.
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
    // negative also passes on any other unrelated failure, which would prove
    // nothing about the arm guard specifically.
    assert.equal(envelope.reason, 'idle-timeout', 'the arm guard must have kept the watchdog off on this small window');
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1, 'no cutoff means no salvage follow-up either');
  } finally {
    await server.close();
  }
});
