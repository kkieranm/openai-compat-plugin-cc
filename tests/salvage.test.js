// Salvage: what happens to a review whose reply held reasoning but no answer.
//
// Tier 1 (keep the partial answer instead of discarding it) and tier 2 (a bounded
// follow-up asking the model to conclude from it) both live in this one file
// because they share fixture shapes — servers that stream reasoning_content and
// never reach content. A review that hits --max-seconds mid-reasoning keeps tier
// 1 but never gets tier 2: a follow-up runs inside the review's deadline, and
// that deadline is spent. Tier 2 runs on a reasoning cutoff or a reasoning-only
// reply, and inside whatever the deadline has left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger } from '../plugins/oai/scripts/lib/attempt-ledger.mjs';
import { requestFindings } from '../plugins/oai/scripts/lib/review-request.mjs';
import {
  chatRequests as chatRequestsOf,
  completionFrames,
  createRepo,
  modelList,
  respondJson,
  respondStream,
  reviewScenario,
  runCompanion,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateTokens } from '../plugins/oai/scripts/lib/context-guard.mjs';
import { failedRun } from '../bench/run.mjs';
import { caseRows } from '../bench/lib/case-rows.mjs';
import { CASE } from './bench-report-fixtures.mjs';

const DRIP_MS = 40;
/** Comfortably over SALVAGE_MIN_REASONING_CHARS (500) before the cap fires. */
const REASONING_CHUNK = 'still reasoning about this commit in great detail. ';

function reasoningFrame() {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'test-model',
    choices: [{ index: 0, delta: { reasoning_content: REASONING_CHUNK }, finish_reason: null }],
  })}\n\n`;
}

function finishFrame(content) {
  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

/**
 * A clean stream that carries real `reasoning_content` and genuinely empty
 * `content` — the actual reasoning-only shape, distinct from `finishFrame('')`
 * (no reasoning at all), which never reaches this bug: with BOTH channels
 * empty, `finishAnswer` refuses it as `BLANK_COMPLETION` before
 * `attemptSalvage` ever sees a result to judge. `finishReason: 'length'`
 * turns the same stream into the exhaustion shape instead — reasoning spent
 * the whole budget and the answer never started.
 */
function reasoningOnlyEmptyContentFrames(reasoningText, { finishReason = 'stop' } = {}) {
  return [
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: { reasoning_content: reasoningText }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

/** A server whose FIRST request streams reasoning forever; every later request
 * gets `onFollowUp(record, response)` instead — the salvage attempt(s). */
function endlessReasoningThenFollowUp(onFollowUp) {
  const timers = new Set();
  let requestCount = 0;
  const handler = (record, response) => {
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
    const timer = setInterval(() => response.write(reasoningFrame()), DRIP_MS);
    timer.unref?.();
    timers.add(timer);
  };
  return { handler, stop: () => timers.forEach(clearInterval) };
}

test('a deadline-timeout keeps the partial reasoning instead of discarding it, and is not salvaged', async () => {
  // The fixture would answer a follow-up (real findings, fast), so a salvage
  // attempt would turn this run into a success — the failure below shows none
  // was made.
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({ findings: [], summary: 'salvaged, nothing found' })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined);
    // Tier 1: the reasoning was captured, not thrown away, at the point of failure.
    assert.ok(envelope.partial?.reasoning?.includes(REASONING_CHUNK.trim()));
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1);
  } finally {
    stop();
    await server.close();
  }
});

test('a deadline-timeout with no salvage attempted still reports the reason plainly (idle-timeout, not eligible)', async () => {
  // The negative control for the trigger gate: an idle-timeout (the server
  // stalled, not merely ran long) must NEVER attempt salvage — asking a server
  // that already stopped answering to continue is asking the wrong party.
  // `idleSeconds` has no CLI flag (only `--timeout`, the FIRST-token budget) —
  // set low via the provider config instead, the same way deadline.test.js's
  // own `maxSeconds`-via-config test does for the total budget.
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer((record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    // Comfortably over SALVAGE_MIN_REASONING_CHARS before going silent — this
    // must isolate the reason check from the length check. A version of this
    // test sending only one frame passed even with the reason check deleted,
    // for the wrong reason (the length gate alone was already blocking it).
    for (let i = 0; i < 12; i += 1) response.write(reasoningFrame());
    // Then silence — no more frames, no end(). The idle budget, not the
    // deadline, is what ends this one.
  });
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    providers: {
      local: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, idleSeconds: 1, maxSeconds: 60 },
    },
  });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'idle-timeout');
    // Only ONE request — no salvage follow-up was attempted for this reason.
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1);
  } finally {
    await server.close();
  }
});

test('a deadline-timeout sends no salvage follow-up, even to a server that would answer one', async () => {
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from partial reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined);

    // Nothing but the original on the wire, and nothing else in the record.
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1);
    assert.equal(envelope.attempts.length, 1);
    assert.equal(envelope.attempts[0].reason, 'deadline-timeout');
  } finally {
    stop();
    await server.close();
  }
});

test('--structured-output: a deadline-timeout is reported with its partial, not salvaged', async () => {
  // The schema-constrained request is a different branch of `requestFindings`
  // (the `first`/`prepareLadder` path, not `unconstrained`'s `built`). A
  // deadline-timeout there is not a rejected schema, so it propagates as the
  // failure it is, with no follow-up.
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      analysis: 'concluded from the salvaged reasoning',
      findings: [{
        file: 'seed.txt',
        line: 1,
        severity: 'low',
        summary: 'concluded under --structured-output',
        evidence: 'seed.txt:1',
      }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(
      ['review', '--json', '--structured-output', '--max-seconds', '1'],
      { configPath, cwd: dir },
    );
    assert.equal(result.status, 1, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined);
    assert.ok(envelope.partial?.reasoning?.includes(REASONING_CHUNK.trim()));
    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 1);
    assert.ok(chatRequests[0].body.response_format, 'the one request was the schema-constrained one');
  } finally {
    stop();
    await server.close();
  }
});

test('a deadline-timeout records one physical request — the deadline leaves no follow-up to make', async () => {
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({ findings: [], summary: 'salvaged, nothing found' })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined);
    assert.deepEqual(envelope.attempts.map((attempt) => [attempt.outcome, attempt.reason]), [['failed', 'deadline-timeout']]);
  } finally {
    stop();
    await server.close();
  }
});

test('a deadline-timeout is reported plainly, partial still attached, and the follow-up handler is never reached', async () => {
  let followUps = 0;
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    followUps += 1;
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end('not json');
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined, 'a failure envelope has no salvaged field at all — only a success does');
    // Tier 1's guarantee holds without tier 2.
    assert.ok(envelope.partial?.reasoning?.includes(REASONING_CHUNK.trim()));
    assert.equal(followUps, 0);
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1);
  } finally {
    stop();
    await server.close();
  }
});

test('a failure with no stream progress at all still reports an empty partial, without crashing', async () => {
  // The other end of tier 1's guarantee from the tests above: a failure before
  // any body byte ever arrived. `writeHead` alone never flushes to the client
  // — Node holds headers back until the first write — so this fixture never
  // even reaches `stream-collect.mjs`'s `collectStream`: `http-budgets.mjs`'s
  // OWN first-byte timer ends it first, one layer below where tier 1's
  // `failure.answer = answer` assignment lives, so `error.answer` is
  // `undefined` here, not an empty `emptyAnswer()`. What this proves is the
  // OTHER half of the same guarantee: `errorReport`'s `partial` gate
  // (`error?.answer?.reasoning?.trim() || ...`) must read that safely via
  // optional chaining rather than assuming `.answer` is always present, and
  // report `null` rather than throwing.
  const { dir, server, configPath } = await reviewScenario((record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    // Headers scheduled, never flushed, never a body byte, never end(). The
    // transport's own first-byte budget is what ends this one.
  });
  try {
    const result = await runCompanion(['review', '--json', '--timeout', '1'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'first-byte-timeout');
    assert.equal(envelope.partial, null, 'nothing streamed, so there is nothing to show');
    assert.equal(envelope.salvaged, undefined);
  } finally {
    await server.close();
  }
});

/**
 * CJK reasoning, so the two counts that matter here disagree on purpose: the
 * reserve watchdog counts characters (3 per token), while the window check
 * charges each of these characters its 3 UTF-8 bytes as 3 tokens. 130 frames
 * of 50 characters (6,500) clear the 6,144-character cutoff an 8,192-token
 * window sets, and even the trimmed 6,000 characters estimate at ~18,000
 * tokens — far past that window once appended to the follow-up.
 */
const CJK_CHUNK = '推理'.repeat(25);
const CJK_FRAMES = 130;

test('a salvage follow-up grown past the context window is refused, not sent unchecked', async () => {
  // Appending the partial reasoning back in as an assistant turn can push a
  // request that fit over the top. Every other gate passes here — a cutoff is
  // a salvage reason, the reasoning is far past the minimum, and no deadline
  // is set — so the window check is the only thing that can stop the
  // follow-up, trimmed or untrimmed.
  let requestCount = 0;
  const handler = (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    requestCount += 1;
    // A follow-up that did go out would be answered, turning the run into a
    // salvaged success the assertions below refuse.
    if (requestCount > 1) {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.end(finishFrame(JSON.stringify({ findings: [], summary: 'salvaged, nothing found' })));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    for (let i = 0; i < CJK_FRAMES; i += 1) {
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        model: 'test-model',
        choices: [{ index: 0, delta: { reasoning_content: CJK_CHUNK }, finish_reason: null }],
      })}\n\n`);
    }
    // No end() — the reserve watchdog is what stops this stream.
  };
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'token-reserve-cutoff');
    assert.equal(envelope.salvaged, undefined);
    // Tier 1 still preserved the original partial, even though tier 2
    // correctly declined to send an oversized follow-up.
    assert.ok(envelope.partial?.reasoning?.length >= 6_144);
    // Exactly one request — both follow-ups were refused BEFORE being sent.
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1);
    assert.equal(envelope.attempts.length, 1);
  } finally {
    await server.close();
  }
});

// --- the salvage reasoning trim ------------------------------------------
//
// A salvage follow-up gets the smaller flat TOKEN_RESERVE_TOKENS reserve AND a
// head+tail trim of the reasoning fed back into it; a `deadline-timeout` gets
// no follow-up at all, and its partial reasoning is reported whole.
//
// A WIDE context window (matching tests/token-reserve-cutoff.test.js's own
// WIDE_CONTEXT_LENGTH/cutoffChars derivation) is needed for all three
// fixtures below, not just the token-reserve-cutoff one: without it, any
// reasoning stream over ~6,144 chars on the DEFAULT 8192-token window would
// get cut and reclassified as token-reserve-cutoff before it could exhibit
// the OTHER two reasons these fixtures cover. The fixture generator is
// copied locally rather than imported from tests/token-reserve-cutoff.test.js
// — importing that file as a module would re-register its own tests a
// second time under node's test runner.
const WIDE_CONTEXT_LENGTH = 51_200; // reserve 25600, cutoffChars (25600-2048)*3.0 = 70,656
const WIDE_CHUNKS_PAST_THRESHOLD = 1_450; // 1,450 * 51 = 73,950 chars, clears 70,656 with margin —
  // a safety margin on what's SENT, not what's actually captured: the watchdog stops the stream
  // as soon as it crosses the threshold, not at a round chunk boundary.

const INDEXED_CHUNK_WIDTH = 51; // same width as REASONING_CHUNK, so the chunk-count arithmetic
  // below (WIDE_CHUNKS_PAST_THRESHOLD, REASONING_ONLY_CHUNKS, cutoffChars) needs no change.

/**
 * A non-repeating stand-in for REASONING_CHUNK: every chunk embeds its own index, so no two windows
 * of the streamed reasoning are ever identical the way REASONING_CHUNK's
 * fixed 51-char period is — a periodic fixture can't tell a correctly-sliced
 * head/tail from one shifted by exactly the period (or any multiple of it),
 * which the old head/tail slice-plus-substring assertions could not catch.
 * No whitespace at either end, so accumulating many of these and calling
 * `.trim()` on the result (as `trySalvage` itself does) is a no-op — the
 * reconstruction below can rely on exact multiples of this width. Used only
 * by the two trim tests below, which assert the ENTIRE captured message
 * against an exact reconstruction rather than slice-plus-substring checks.
 */
function indexedChunk(i) {
  return `chunk${String(i).padStart(6, '0')}`.padEnd(INDEXED_CHUNK_WIDTH, '_');
}

function indexedReasoningFrame(i) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'test-model',
    choices: [{ index: 0, delta: { reasoning_content: indexedChunk(i) }, finish_reason: null }],
  })}\n\n`;
}

/**
 * Reconstructs the exact reasoning text a fixture built from
 * `indexedReasoningFrame` produced, given the exact captured length reported
 * back as `salvageTrim.originalChars` — every complete chunk is exactly
 * INDEXED_CHUNK_WIDTH chars and SSE frames are parsed whole, never split
 * mid-delta, so `originalChars` is always an exact multiple of that width.
 */
function reconstructIndexedReasoning(originalChars) {
  const chunkCount = originalChars / INDEXED_CHUNK_WIDTH;
  assert.equal(Number.isInteger(chunkCount), true, 'captured reasoning must be a whole number of indexed chunks');
  return Array.from({ length: chunkCount }, (_, i) => indexedChunk(i)).join('');
}

/** A server whose FIRST request streams reasoning synchronously past the
 * token-reserve-cutoff threshold on a WIDE_CONTEXT_LENGTH window; every later
 * request gets `onFollowUp` instead — the salvage attempt. */
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
    for (let i = 0; i < WIDE_CHUNKS_PAST_THRESHOLD; i += 1) response.write(indexedReasoningFrame(i));
    // No end() — the reserve watchdog is what stops this stream, not the server.
  };
}

test('a long token-reserve-cutoff reasoning is trimmed to head+tail before the salvage follow-up', async () => {
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from trimmed reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.salvageTrim.applied, true);
    assert.equal(envelope.salvageTrim.retainedChars, 6_000);
    // Bound check, not exact — the watchdog cuts at threshold-crossing, not a
    // round chunk boundary.
    assert.ok(envelope.salvageTrim.originalChars >= 70_656);

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    const sent = chatRequests[1].body.messages[2].content;
    const full = reconstructIndexedReasoning(envelope.salvageTrim.originalChars);
    const marker = `\n\n[...${envelope.salvageTrim.originalChars - 6_000} characters of reasoning omitted...]\n\n`;
    assert.equal(sent, `${full.slice(0, 1_500)}${marker}${full.slice(-4_500)}`);
  } finally {
    await server.close();
  }
});

const REASONING_ONLY_CHUNKS = 400; // 400 * 51 = 20,400 chars: well over the 6,000-char trim budget,
  // and well under WIDE_CONTEXT_LENGTH's 70,656 reserve-cutoff threshold, so the stream finishes
  // cleanly — reclassified as token-reserve-cutoff is exactly what this fixture must avoid.

/** A server whose FIRST request streams reasoning past the trim budget, then
 * ends the stream CLEANLY (finish_reason: 'stop') with empty content — a
 * reasoning-only failure, never a cutoff. Every later request gets
 * `onFollowUp` instead — the salvage attempt. */
function reasoningOnlyThenFollowUp(onFollowUp) {
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
    for (let i = 0; i < REASONING_ONLY_CHUNKS; i += 1) response.write(indexedReasoningFrame(i));
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
  };
}

test('a long reasoning-only reasoning is trimmed to head+tail before the salvage follow-up', async () => {
  const handler = reasoningOnlyThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from trimmed reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.salvageTrim.applied, true);
    assert.equal(envelope.salvageTrim.retainedChars, 6_000);
    assert.ok(envelope.salvageTrim.originalChars >= 6_000);

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    const sent = chatRequests[1].body.messages[2].content;
    const full = reconstructIndexedReasoning(envelope.salvageTrim.originalChars);
    const marker = `\n\n[...${envelope.salvageTrim.originalChars - 6_000} characters of reasoning omitted...]\n\n`;
    assert.equal(sent, `${full.slice(0, 1_500)}${marker}${full.slice(-4_500)}`);
  } finally {
    await server.close();
  }
});

/** review-request.mjs's SALVAGE_MIN_REASONING_CHARS: the shortest reasoning a follow-up is sent for. */
const SALVAGE_MIN_REASONING_CHARS = 500;

/** A first request that ends reasoning-only with `reasoningText`; every later request gets `followUp`. */
function reasoningOnlyThen(reasoningText, followUp) {
  let requestCount = 0;
  return (record, response) => {
    if (!record.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
    requestCount += 1;
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.end(requestCount === 1 ? reasoningOnlyEmptyContentFrames(reasoningText) : followUp);
  };
}

/** A first request that ends reasoning-only with exactly `reasoningText`; every later request answers. */
function exactReasoningOnlyThenAnswer(reasoningText) {
  return reasoningOnlyThen(reasoningText, finishFrame(JSON.stringify({
    findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from minimal reasoning' }],
    summary: 'salvaged',
  })));
}

test('reasoning exactly SALVAGE_MIN_REASONING_CHARS long is salvaged', async () => {
  const reasoning = 'x'.repeat(SALVAGE_MIN_REASONING_CHARS);
  const { dir, server, configPath } = await reviewScenario(exactReasoningOnlyThenAnswer(reasoning));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.findings[0].summary, 'concluded from minimal reasoning');
    const chats = chatRequestsOf(server);
    assert.equal(chats.length, 2, 'the original plus one follow-up');
    assert.equal(chats[1].body.messages[2].content, reasoning, 'the follow-up carries the reasoning whole');
  } finally {
    await server.close();
  }
});

// --- the SALVAGED warning's wording ----------------------------------------
//
// Salvage follows a reasoning cutoff or a reasoning-only reply, never a spent
// deadline or token budget, so the warning must not say the model ran out of
// either.
const SALVAGE_WARNING_FORBIDDEN = /ran out of|out of time|out of tokens|budget|deadline/i;

/** The text report of a review salvaged by a follow-up answering `followUpContent`. */
async function salvagedTextReport(followUpContent) {
  const { dir, server, configPath } = await reviewScenario(
    reasoningOnlyThen('x'.repeat(SALVAGE_MIN_REASONING_CHARS), finishFrame(followUpContent)),
  );
  try {
    const result = await runCompanion(['review'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(chatRequestsOf(server).length, 2, 'the original plus one follow-up');
    return result.stdout;
  } finally {
    await server.close();
  }
}

test('a salvaged review with findings warns it was salvaged, without saying the model ran out of time or budget', async () => {
  const stdout = await salvagedTextReport(JSON.stringify({
    findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from minimal reasoning' }],
    summary: 'salvaged',
  }));
  const warning = stdout.split('\n\n').find((paragraph) => paragraph.startsWith('WARNING: this review was SALVAGED.'));
  assert.ok(warning, stdout);
  assert.doesNotMatch(warning, SALVAGE_WARNING_FORBIDDEN);
});

test('a salvaged review whose reply was prose warns it was salvaged, without saying the model ran out of time or budget', async () => {
  const stdout = await salvagedTextReport('Nothing stands out in this change.');
  assert.match(stdout, /did not return findings in the requested shape/);
  const warning = stdout.split('\n\n').find((paragraph) => paragraph.startsWith('WARNING: this reply came from a SALVAGE follow-up'));
  assert.ok(warning, stdout);
  assert.doesNotMatch(warning, SALVAGE_WARNING_FORBIDDEN);
});

test('reasoning one character short of SALVAGE_MIN_REASONING_CHARS is not salvaged', async () => {
  const { dir, server, configPath } = await reviewScenario(exactReasoningOnlyThenAnswer('x'.repeat(SALVAGE_MIN_REASONING_CHARS - 1)));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'reasoning-only');
    assert.equal(envelope.salvaged, undefined);
    assert.equal(envelope.partial?.reasoning, 'x'.repeat(SALVAGE_MIN_REASONING_CHARS - 1));
    assert.equal(chatRequestsOf(server).length, 1, 'no follow-up is sent');
  } finally {
    await server.close();
  }
});

// --- the follow-up itself ----------------------------------------------------
//
// One follow-up, sent once, carrying the reasoning with its surrounding
// whitespace stripped — which is also what the minimum length is judged on.

test('a salvage follow-up is sent once, never retried', async () => {
  // Content, then the stream closes with no finish_reason and no [DONE]: a
  // retryable shape, so with the review allowed two attempts only the
  // follow-up's own single-attempt limit stops a second follow-up. 600
  // characters stay under the trim budget, so no untrimmed fallback follows
  // either.
  const unfinished = `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'test-model',
    choices: [{ index: 0, delta: { content: '{"findings": [' }, finish_reason: null }],
  })}\n\n`;
  const { dir, server, configPath } = await reviewScenario(reasoningOnlyThen('x'.repeat(600), unfinished));
  try {
    const result = await runCompanion(['review', '--json', '--max-attempts', '2'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).reason, 'reasoning-only');
    const chats = chatRequestsOf(server);
    assert.equal(chats.length, 2, 'the original plus exactly one follow-up');
    assert.equal(chats[1].body.messages[2].content, 'x'.repeat(600), 'the second request is the follow-up');
  } finally {
    await server.close();
  }
});

test('whitespace around the reasoning does not count toward the salvage minimum', async () => {
  const short = await reviewScenario(exactReasoningOnlyThenAnswer(`${'x'.repeat(SALVAGE_MIN_REASONING_CHARS - 1)}\n\n\n\n\n`));
  try {
    const result = await runCompanion(['review', '--json'], { configPath: short.configPath, cwd: short.dir });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).reason, 'reasoning-only');
    assert.equal(chatRequestsOf(short.server).length, 1, 'no follow-up is sent');
  } finally {
    await short.server.close();
  }

  const reasoning = 'x'.repeat(SALVAGE_MIN_REASONING_CHARS);
  const padded = await reviewScenario(exactReasoningOnlyThenAnswer(`\n\n${reasoning}\n\n`));
  try {
    const result = await runCompanion(['review', '--json'], { configPath: padded.configPath, cwd: padded.dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).salvaged, true);
    const chats = chatRequestsOf(padded.server);
    assert.equal(chats.length, 2, 'the original plus one follow-up');
    assert.equal(chats[1].body.messages[2].content, reasoning, 'the follow-up carries the reasoning with the surrounding whitespace stripped');
  } finally {
    await padded.server.close();
  }
});

const DEADLINE_BURST_CHUNKS = 200; // 200 * 51 = 10,200 chars, written SYNCHRONOUSLY (no interval, no
  // await) so it all accumulates well before a 1-second --max-seconds deadline fires. Comfortably
  // over the 6,000-char trim budget, and comfortably under WIDE_CONTEXT_LENGTH's 70,656
  // reserve-cutoff threshold, so this reliably classifies as deadline-timeout, never
  // token-reserve-cutoff — the DRIP_MS-interval fixture above only manages ~1,300 chars in 1s,
  // nowhere near enough to exercise "not trimmed" on a real >6,000-char transcript.
function deadlineBurstThenFollowUp(onFollowUp) {
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
    for (let i = 0; i < DEADLINE_BURST_CHUNKS; i += 1) response.write(reasoningFrame());
    // No end() — the --max-seconds deadline is what stops this stream.
  };
}

test('a long deadline-timeout reasoning is reported whole as the partial, with no follow-up', async () => {
  const handler = deadlineBurstThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from untrimmed reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    assert.equal(result.status, 1, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined);
    // The cap's own error, word for word — never rewritten as a salvage the
    // deadline ended, which this reason never reaches.
    const host = new URL(server.baseUrl).host.replaceAll('.', '\\.');
    assert.match(envelope.message, new RegExp(`^${host} did not finish within the 1\\.0s cap, after \\d+ bytes\\.$`));
    assert.equal(
      envelope.hint,
      'The stream was still open when the cap fired. Bytes on the wire are not evidence the model was '
        + 'generating — a keepalive moves that counter — so this says the run was cut, not that it was '
        + 'productive. Raise --max-seconds, or send a smaller request.',
    );
    assert.ok(envelope.partial?.reasoning?.length > 6_000, 'past the trim budget, and still reported whole');
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1);
  } finally {
    await server.close();
  }
});

test('salvageTrim is null on an ordinary non-salvaged run', async () => {
  const { dir, server, configPath } = await reviewScenario((record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({ findings: [], summary: 'nothing found' })));
    response.end();
  });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, false);
    assert.equal(envelope.salvageTrim, null);
  } finally {
    await server.close();
  }
});

// --- the untrimmed fallback, the trim's expansion guard, and its
// surrogate-pair safety. --------------------------------------------------

test('a trimmed salvage attempt that succeeds directly never fires the untrimmed fallback', async () => {
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from trimmed reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.salvageTrim.applied, true);
    assert.equal(envelope.salvageTrim.retainedChars, 6_000, 'the trimmed retention size is 6,000 characters');
    assert.equal(
      server.requests.filter((r) => r.url.includes('/chat/completions')).length,
      2,
      'the trimmed attempt answered — no untrimmed fallback attempt should ever fire',
    );
  } finally {
    await server.close();
  }
});

test('a trimmed salvage attempt that lands empty falls back to one untrimmed attempt, and the envelope says so', async () => {
  // Request 2 (the trimmed follow-up) lands empty-handed — a salvage FAILURE
  // per `attemptSalvage`'s own contract (`chatCompletion` succeeding only
  // means the transport worked, not that the model answered). Request 3 (the
  // untrimmed fallback) answers for real.
  let followUpCount = 0;
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    followUpCount += 1;
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    if (followUpCount === 1) {
      // The actual bug shape: a clean stream that answers with real reasoning_content and
      // genuinely empty content — never `finishFrame('')`, which carries no
      // reasoning either and so never reaches `attemptSalvage`'s content
      // check at all (`finishAnswer` refuses a reply with BOTH channels
      // empty as BLANK_COMPLETION before chatCompletion even returns).
      response.write(reasoningOnlyEmptyContentFrames('reasoning but no answer on this attempt'));
      response.end();
      return;
    }
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from the untrimmed fallback' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.findings[0].summary, 'concluded from the untrimmed fallback');

    // The full ledger sequence — the bug this fixture reproduces: the losing trimmed attempt
    // must NOT keep the `answered` outcome `settle()` gave it before its
    // empty content was judged unusable, or `bench/lib/attempt-rows.mjs`'s
    // `answeringAttempt()` (first `outcome === 'answered'` match) would pick
    // the loser instead of the untrimmed fallback that actually answered.
    assert.equal(envelope.attempts.length, 3, 'original + the failed trimmed attempt + the untrimmed fallback attempt');
    assert.equal(
      envelope.attempts.filter((a) => a.outcome === 'answered').length,
      1,
      'exactly one attempt answers — the invariant answeringAttempt() depends on',
    );
    assert.equal(envelope.attempts[0].outcome, 'failed');
    assert.equal(envelope.attempts[0].reason, 'token-reserve-cutoff');
    assert.equal(envelope.attempts[1].outcome, 'failed', 'the losing trimmed salvage attempt');
    assert.equal(envelope.attempts[1].reason, 'reasoning-only');
    assert.equal(envelope.attempts[2].outcome, 'answered', 'the winning untrimmed fallback attempt');
    assert.equal(envelope.attempts[2].reason, null);

    // The field-attribution rule: the
    // FALLBACK, not the trim, is what actually answered — the envelope must
    // say so, never the stale trimmed-attempt numbers. This is the mutation
    // target for that fix: mutate `salvageTrim` back to always reading
    // `trim.retainedChars` regardless of which attempt succeeded, and this
    // assertion catches it (`retainedChars` would read 6,000 instead of the
    // full length).
    assert.equal(envelope.salvageTrim.applied, false);
    assert.equal(envelope.salvageTrim.retainedChars, envelope.salvageTrim.originalChars);

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 3, 'original + the failed trimmed attempt + the untrimmed fallback attempt');
    const full = reconstructIndexedReasoning(envelope.salvageTrim.originalChars);
    assert.equal(
      chatRequests[2].body.messages[2].content,
      full,
      'the fallback attempt must carry the reasoning back FULL and untrimmed',
    );

    // `estimatedTokens` must be the THIRD request's own — a stale
    // trimmed-attempt figure would otherwise pass every other assertion here
    // undetected.
    const thirdMessages = chatRequests[2].body.messages;
    const expectedEstimatedTokens = estimateTokens(thirdMessages.map((m) => m.content).join('\n'));
    assert.equal(envelope.estimatedTokens, expectedEstimatedTokens);
  } finally {
    await server.close();
  }
});

test('a salvage that fails on both the trimmed AND the untrimmed fallback attempts falls back to the ordinary failure report', async () => {
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    // Both follow-up attempts fail fast (a malformed body) rather than a real
    // timeout, which would cost the full salvage budget twice for no test
    // value — this exercises the identical fallback-exhausted branch either way.
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end('not json');
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'token-reserve-cutoff');
    assert.equal(envelope.salvaged, undefined, 'a failure envelope has no salvaged field at all — only a success does');
    assert.equal(
      server.requests.filter((r) => r.url.includes('/chat/completions')).length,
      3,
      'original + the failed trimmed attempt + the failed untrimmed fallback attempt, never a fourth',
    );
  } finally {
    await server.close();
  }
});

test('a salvage that fails on both the trimmed AND the untrimmed fallback attempts with empty content marks BOTH ledger entries failed, never answered', async () => {
  // Distinct from the malformed-body test above: both follow-ups here fail
  // the same way the fallback test's trimmed attempt does — a clean stream,
  // real reasoning_content, genuinely empty content — so this exercises
  // `markUnanswered` firing twice in one run, on top of the original
  // failure, rather than once.
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(reasoningOnlyEmptyContentFrames('still no answer on this attempt either'));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    // The ORIGINAL failure is what propagates once both salvage attempts
    // fail — never the reasoning-only reason either salvage attempt itself
    // carried.
    assert.equal(envelope.reason, 'token-reserve-cutoff');
    assert.equal(envelope.salvaged, undefined, 'a failure envelope has no salvaged field at all — only a success does');

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 3, 'original + the failed trimmed attempt + the failed untrimmed fallback attempt');

    assert.equal(envelope.attempts.length, 3);
    assert.equal(
      envelope.attempts.filter((a) => a.outcome === 'answered').length,
      0,
      'no attempt answers — every physical request in this run failed',
    );
    assert.equal(envelope.attempts[0].outcome, 'failed');
    assert.equal(envelope.attempts[0].reason, 'token-reserve-cutoff');
    assert.equal(envelope.attempts[1].outcome, 'failed', 'the trimmed salvage attempt');
    assert.equal(envelope.attempts[1].reason, 'reasoning-only');
    assert.equal(envelope.attempts[2].outcome, 'failed', 'the untrimmed fallback attempt');
    assert.equal(envelope.attempts[2].reason, 'reasoning-only');
  } finally {
    await server.close();
  }
});

test('a salvage follow-up that runs out of tokens is recorded token-exhaustion, never reasoning-only', async () => {
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    // Non-empty reasoning is load-bearing: with both channels at 0 chars,
    // `refuseUnusable` rejects the reply as `blank-completion` before
    // `attemptSalvage`'s own content check ever sees it.
    response.write(reasoningOnlyEmptyContentFrames('spent the whole follow-up budget reasoning', { finishReason: 'length' }));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'token-reserve-cutoff', 'the ORIGINAL failure still propagates');

    assert.equal(envelope.attempts.length, 3, 'original + the trimmed attempt + the untrimmed fallback');
    assert.equal(envelope.attempts[0].reason, 'token-reserve-cutoff');
    assert.equal(envelope.attempts[1].outcome, 'failed', 'the trimmed salvage attempt');
    assert.equal(envelope.attempts[1].reason, 'token-exhaustion');
    assert.equal(envelope.attempts[2].outcome, 'failed', 'the untrimmed fallback attempt');
    assert.equal(envelope.attempts[2].reason, 'token-exhaustion');
  } finally {
    await server.close();
  }
});

test('a salvage follow-up answering only whitespace is recorded empty-answer, never reasoning-only', async () => {
  // `finishFrame(' ')` is the one route to the empty-answer arm: whitespace
  // content passes `refuseUnusable`'s `.length` check (its own comment —
  // whitespace has answered), trims empty at `attemptSalvage`'s gate, and
  // carries no reasoning, so calling it `reasoning-only` would be false twice
  // over. A literally empty reply never gets this far — `blank-completion`.
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(' '));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'token-reserve-cutoff', 'the ORIGINAL failure still propagates');

    assert.equal(envelope.attempts.length, 3, 'original + the trimmed attempt + the untrimmed fallback');
    assert.equal(envelope.attempts[1].outcome, 'failed', 'the trimmed salvage attempt');
    assert.equal(envelope.attempts[1].reason, 'empty-answer', 'a positively-identified whitespace-only answer');
    assert.equal(envelope.attempts[2].outcome, 'failed', 'the untrimmed fallback attempt');
    assert.equal(envelope.attempts[2].reason, 'empty-answer');
  } finally {
    await server.close();
  }
});

const NEAR_THRESHOLD_REASONING = 'x'.repeat(6_020); // Inside the expansion-prone range
  // (6,001-6,045 chars) where the omitted-count marker text is longer than what a trim in that
  // range actually removes — trimReasoning must refuse to "trim" into something longer than the
  // original rather than pretend a net-negative trim helped.

/** A server whose FIRST request streams a single burst of reasoning, then
 * finishes CLEANLY with empty content (reasoning-only) — no watchdog, no
 * deadline, just a reasoning length chosen to land inside the
 * expansion-prone range. Every later request gets `onFollowUp` instead. */
function nearThresholdReasoningThenFollowUp(onFollowUp) {
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
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: { reasoning_content: NEAR_THRESHOLD_REASONING }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
  };
}

test('reasoning just past the trim threshold is left untouched when trimming would expand it', async () => {
  const handler = nearThresholdReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from near-threshold reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.salvageTrim.originalChars, 6_020);
    assert.equal(envelope.salvageTrim.applied, false);
    assert.equal(envelope.salvageTrim.retainedChars, envelope.salvageTrim.originalChars);

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    const sent = chatRequests[1].body.messages[2].content;
    assert.equal(sent, NEAR_THRESHOLD_REASONING, 'the untouched reasoning, not an "expanded" trim');
  } finally {
    await server.close();
  }
});

/**
 * A 10,000-char reasoning transcript with a real (correctly paired) UTF-16
 * surrogate pair — an emoji — placed to straddle each trim boundary exactly:
 * one across the head cut (index 1499/1500) and one across the tail cut
 * (index `length - 4500 - 1` / `length - 4500`).
 * slice() at either boundary would otherwise split one of these pairs,
 * leaving an unpaired surrogate in the wire payload.
 */
function surrogateReasoning(length) {
  const units = new Array(length).fill('x');
  const emoji = '\u{1F600}'; // a real supplementary-plane character = one high + one low surrogate
  units[1_499] = emoji[0];
  units[1_500] = emoji[1];
  const tailBoundary = length - 4_500;
  units[tailBoundary - 1] = emoji[0];
  units[tailBoundary] = emoji[1];
  return units.join('');
}

const SURROGATE_REASONING = surrogateReasoning(10_000);

function surrogateReasoningThenFollowUp(onFollowUp) {
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
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: { reasoning_content: SURROGATE_REASONING }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
  };
}

test('a surrogate pair straddling either trim boundary is never split in the sent follow-up', async () => {
  const handler = surrogateReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({
      findings: [{ file: 'seed.txt', line: 1, severity: 'low', summary: 'concluded from trimmed reasoning' }],
      summary: 'salvaged',
    })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.salvageTrim.applied, true);
    assert.equal(envelope.salvageTrim.originalChars, 10_000);

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    const sent = chatRequests[1].body.messages[2].content;

    // (a) The real hazard: a strict OpenAI-compatible server's own
    // JSON parser rejecting an unpaired surrogate in the wire payload.
    // Checked by a direct scan, never a JSON.stringify/parse round-trip —
    // that round-trips a lone surrogate successfully in JavaScript and would
    // pass even on the unfixed code.
    const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    assert.equal(UNPAIRED_SURROGATE.test(sent), false);

    // (b)/(c): the reported metadata must describe what was ACTUALLY sent,
    // never the nominal, unadjusted 1,500/4,500/6,000 constants — measured
    // directly off the real message (which boundary a fix shifts, and in
    // which direction, is an implementation choice this test must not
    // assume) rather than hand-derived from the constants.
    const markerMatch = sent.match(/\n\n\[\.\.\.(\d+) characters of reasoning omitted\.\.\.\]\n\n/);
    assert.ok(markerMatch, 'sent message must contain the omitted-count marker');
    const head = sent.slice(0, markerMatch.index);
    const tail = sent.slice(markerMatch.index + markerMatch[0].length);
    assert.equal(
      envelope.salvageTrim.retainedChars,
      head.length + tail.length,
      'retainedChars must reflect the ACTUAL adjusted head+tail length actually sent, not the unadjusted 6,000',
    );
    assert.equal(
      Number(markerMatch[1]),
      envelope.salvageTrim.originalChars - envelope.salvageTrim.retainedChars,
      "the marker's own printed count must be exact and independently correct, not merely consistent with retainedChars",
    );
  } finally {
    await server.close();
  }
});

// --- a follow-up refused as too large -----------------------------------

test('a trimmed follow-up refused as request-too-large ends salvage: no untrimmed resend, the original failure reported', async () => {
  const handler = wideReasoningPastThresholdThenFollowUp((record, response) => {
    response.writeHead(413, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'prompt is too large for this server' } }));
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    // The ORIGINAL failure, with its tier-1 partial — never the follow-up's refusal.
    assert.equal(envelope.reason, 'token-reserve-cutoff');
    assert.equal(envelope.salvaged, undefined);
    assert.ok(envelope.partial?.reasoning?.length >= 70_656);

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    // The follow-up really was trimmed, so an untrimmed resend was due had the
    // refusal not ended salvage.
    const sent = chatRequests[1].body.messages[2].content;
    const marker = sent.match(/\n\n\[\.\.\.(\d+) characters of reasoning omitted\.\.\.\]\n\n/);
    assert.ok(marker, 'the follow-up carried the trimmed reasoning');
    assert.equal(sent.length - marker[0].length, 6_000);
    assert.equal(chatRequests.length, 2, 'the original and the one trimmed follow-up — no untrimmed resend');

    assert.deepEqual(
      envelope.attempts.map((attempt) => [attempt.outcome, attempt.reason]),
      [['failed', 'token-reserve-cutoff'], ['failed', 'request-too-large']],
    );
  } finally {
    await server.close();
  }
});

// --- salvage inside the review's deadline --------------------------------
//
// In-process, where the clock can be moved at the instant the original request
// is served. `capBudgets` and `requestFindings` read the bare
// `performance.now()`, while the stream's own timers run on the real clock, so
// moving it spends the review's deadline without cutting the original stream.

async function withClock(body) {
  const real = globalThis.performance;
  let offset = 0;
  globalThis.performance = { now: () => real.now() + offset };
  try {
    return await body((ms) => {
      offset += ms;
    });
  } finally {
    globalThis.performance = real;
  }
}

const caught = (promise) => promise.then(() => assert.fail('expected a rejection'), (error) => error);

/** reserve 30,848 on this window: the watchdog cuts at (30,848 - 2,048) * 3 = 86,400 characters. */
const DEADLINE_WINDOW = 61_696;
const DEADLINE_RESERVE = 30_848;

function deadlinePlan(ledger, maxMs) {
  return {
    model: 'test-model',
    contextLength: DEADLINE_WINDOW,
    reserve: DEADLINE_RESERVE,
    target: { label: 'the edit', diff: 'diff --git a/seed.txt b/seed.txt\n+edited\n', files: [], changed: [], unreadable: [] },
    timeoutMs: 5_000,
    idleMs: 5_000,
    maxMs,
    maxAttempts: 1,
    retryDelayMs: 0,
    structuredOutput: false,
    ledger,
  };
}

/** Streams reasoning past the cutoff, after `beforeStream` has run; never ends. */
function cutoffStream(response, beforeStream) {
  beforeStream();
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
  for (let i = 0; i < 90; i += 1) {
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      model: 'test-model',
      choices: [{ index: 0, delta: { reasoning_content: 'r'.repeat(1_000) }, finish_reason: null }],
    })}\n\n`);
  }
}

const salvagedFindings = JSON.stringify({ findings: [], summary: 'salvaged, nothing found' });

/**
 * A review whose deadline ended salvage: a `deadline-timeout` worded from the
 * review's own cap, naming the original reason, with the original partial
 * answer and the attempt record attached.
 */
function assertDeadlineEndedSalvage(error, { ledger, cap, originalReason }) {
  assert.equal(error.reason, 'deadline-timeout');
  assert.equal(
    error.message,
    `p did not finish within the ${cap / 1000}s cap: its reply held reasoning but no answer (${originalReason}), `
      + 'and the cap ran out before a follow-up asking it to conclude from that reasoning could answer.',
  );
  assert.equal(error.hint, 'Raise --max-seconds (or maxSeconds in the provider config) to leave the follow-up time to answer.');
  assert.deepEqual(error.attemptRecords, ledger.entries());
}

test('the follow-up to a cutoff runs inside the review deadline, not on a fresh 300s, and the deadline ending it fails the review', async () => {
  // 300ms of a 10s cap remain when the follow-up goes out, and the follow-up
  // takes 1.5s to answer: it must be cut off at the review's deadline, and
  // the review then fails on that deadline. A follow-up armed with its own
  // fresh budget would answer, and the review would come back salvaged.
  const cap = 10_000;
  await withClock(async (advance) => {
    let chats = 0;
    const server = await startFakeServer((request, response) => {
      if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
      chats += 1;
      if (chats === 1) return cutoffStream(response, () => advance(cap - 300));
      return setTimeout(() => respondStream(response, completionFrames(salvagedFindings)), 1_500);
    });
    try {
      const ledger = createLedger();
      const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, deadlinePlan(ledger, cap)));

      assertDeadlineEndedSalvage(error, { ledger, cap, originalReason: 'token-reserve-cutoff' });
      assert.ok(error.answer?.reasoning?.length >= 86_400, 'with the original partial reasoning');
      // The trimmed follow-up was dispatched with time remaining; the review's
      // deadline ended it, so no untrimmed fallback was attempted.
      assert.equal(chatRequestsOf(server).length, 2, 'the follow-up was dispatched');
      assert.equal(chatRequestsOf(server)[1].body.max_tokens, 2048);
      assert.deepEqual(
        ledger.entries().map((entry) => [entry.outcome, entry.reason]),
        [['failed', 'token-reserve-cutoff'], ['failed', 'deadline-timeout']],
      );
    } finally {
      await server.close();
    }
  });
});

test('a cutoff whose review deadline is already spent dispatches no follow-up', async () => {
  const cap = 10_000;
  await withClock(async (advance) => {
    const server = await startFakeServer((request, response) => {
      if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
      if (chatRequestsOf(server).length === 1) return cutoffStream(response, () => advance(cap * 2));
      // Answered if it ever went out, so a dispatched follow-up salvages the review.
      return respondStream(response, completionFrames(salvagedFindings));
    });
    try {
      const ledger = createLedger();
      const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, deadlinePlan(ledger, cap)));

      assertDeadlineEndedSalvage(error, { ledger, cap, originalReason: 'token-reserve-cutoff' });
      assert.ok(error.answer?.reasoning?.length >= 86_400, 'with the original partial reasoning');
      assert.equal(chatRequestsOf(server).length, 1);
      assert.deepEqual(ledger.entries().map((entry) => [entry.outcome, entry.reason]), [['failed', 'token-reserve-cutoff']]);
    } finally {
      await server.close();
    }
  });
});

test('a trimmed follow-up the review deadline ends sends no untrimmed resend, even if the clock has not caught up', async () => {
  // The follow-up's timer runs on the real clock and can fire a hair before
  // `performance.now()` reaches the deadline; moving the clock back 50ms while
  // the trimmed follow-up is in flight reproduces that every time. An
  // untrimmed resend would then be admitted with what little remains, and
  // answered at once.
  const cap = 10_000;
  await withClock(async (advance) => {
    let chats = 0;
    const server = await startFakeServer((request, response) => {
      if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
      chats += 1;
      if (chats === 1) return cutoffStream(response, () => advance(cap - 300));
      if (chats === 2) {
        advance(-50);
        return setTimeout(() => respondStream(response, completionFrames(salvagedFindings)), 1_500);
      }
      return respondStream(response, completionFrames(salvagedFindings));
    });
    try {
      const ledger = createLedger();
      const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, deadlinePlan(ledger, cap)));

      assertDeadlineEndedSalvage(error, { ledger, cap, originalReason: 'token-reserve-cutoff' });
      assert.ok(error.answer?.reasoning?.length >= 86_400, 'with the original partial reasoning');
      const chatRequests = chatRequestsOf(server);
      // The follow-up really was trimmed, so an untrimmed resend was due had
      // the deadline not ended salvage.
      const sent = chatRequests[1].body.messages[2].content;
      const marker = sent.match(/\n\n\[\.\.\.(\d+) characters of reasoning omitted\.\.\.\]\n\n/);
      assert.ok(marker, 'the follow-up carried the trimmed reasoning');
      assert.equal(sent.length - marker[0].length, 6_000);
      assert.equal(chatRequests.length, 2, 'the original and the one trimmed follow-up — no untrimmed resend');
      assert.deepEqual(
        ledger.entries().map((entry) => [entry.outcome, entry.reason]),
        [['failed', 'token-reserve-cutoff'], ['failed', 'deadline-timeout']],
      );
    } finally {
      await server.close();
    }
  });
});

test('a reasoning-only reply too short to trim, whose one follow-up the review deadline ends, fails on that deadline', async () => {
  // Under the trim threshold, so the single follow-up carries the reasoning
  // whole and no untrimmed fallback could follow it either way.
  const cap = 10_000;
  const reasoning = 'x'.repeat(2_000);
  await withClock(async (advance) => {
    let chats = 0;
    const server = await startFakeServer((request, response) => {
      if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
      chats += 1;
      if (chats === 1) {
        advance(cap - 300);
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        return response.end(reasoningOnlyEmptyContentFrames(reasoning));
      }
      return setTimeout(() => respondStream(response, completionFrames(salvagedFindings)), 1_500);
    });
    try {
      const ledger = createLedger();
      const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, deadlinePlan(ledger, cap)));

      assertDeadlineEndedSalvage(error, { ledger, cap, originalReason: 'reasoning-only' });
      assert.equal(error.answer?.reasoning, reasoning, 'with the original partial reasoning');
      const chatRequests = chatRequestsOf(server);
      assert.equal(chatRequests.length, 2, 'the original and the one follow-up');
      assert.equal(chatRequests[1].body.messages[2].content, reasoning, 'the follow-up carried the reasoning untrimmed');
      assert.deepEqual(
        ledger.entries().map((entry) => [entry.outcome, entry.reason]),
        [['failed', 'reasoning-only'], ['failed', 'deadline-timeout']],
      );
    } finally {
      await server.close();
    }
  });
});

test('an untrimmed fallback the review deadline ends fails on that deadline', async () => {
  // The trimmed follow-up answers empty with time to spare, so the untrimmed
  // one goes out — with 300ms of the 10s cap left, against a 1.5s reply.
  const cap = 10_000;
  await withClock(async (advance) => {
    let chats = 0;
    const server = await startFakeServer((request, response) => {
      if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
      chats += 1;
      if (chats === 1) return cutoffStream(response, () => {});
      if (chats === 2) {
        advance(cap - 300);
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        return response.end(reasoningOnlyEmptyContentFrames('nothing to conclude'));
      }
      return setTimeout(() => respondStream(response, completionFrames(salvagedFindings)), 1_500);
    });
    try {
      const ledger = createLedger();
      const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, deadlinePlan(ledger, cap)));

      assertDeadlineEndedSalvage(error, { ledger, cap, originalReason: 'token-reserve-cutoff' });
      assert.ok(error.answer?.reasoning?.length >= 86_400, 'with the original partial reasoning');
      const chatRequests = chatRequestsOf(server);
      assert.equal(chatRequests.length, 3, 'the original, the trimmed follow-up and the untrimmed one');
      assert.match(chatRequests[1].body.messages[2].content, /characters of reasoning omitted/);
      assert.equal(chatRequests[2].body.messages[2].content, error.answer.reasoning, 'the fallback carried it whole');
      assert.deepEqual(
        ledger.entries().map((entry) => [entry.outcome, entry.reason]),
        [['failed', 'token-reserve-cutoff'], ['failed', 'reasoning-only'], ['failed', 'deadline-timeout']],
      );
    } finally {
      await server.close();
    }
  });
});

test('a run whose follow-up the review deadline ends is counted capped by the bench', async () => {
  // End to end: the companion's own --json envelope, read the way the bench
  // reads a failed run. Counted as a model failure, it would set a harness
  // limit beside the reviewer's results.
  const handler = wideReasoningPastThresholdThenFollowUp(() => {
    // Never answered: the review's 2s deadline ends the follow-up.
  });
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: WIDE_CONTEXT_LENGTH });
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '2'], { configPath, cwd: dir });
    assert.equal(result.status, 1, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(
      envelope.message,
      'local did not finish within the 2.0s cap: its reply held reasoning but no answer (token-reserve-cutoff), '
        + 'and the cap ran out before a follow-up asking it to conclude from that reasoning could answer.',
    );
    assert.ok(envelope.partial?.reasoning?.length >= 70_656, 'with the original partial reasoning');
    assert.deepEqual(
      envelope.attempts.map((attempt) => [attempt.outcome, attempt.reason]),
      [['failed', 'token-reserve-cutoff'], ['failed', 'deadline-timeout']],
    );

    const run = failedRun({ stdout: result.stdout, stderr: result.stderr, message: 'exit 1' }, CASE, {}, false);
    const [row] = caseRows([{ caseDef: CASE, runs: [run] }]);
    assert.equal(row.failed, 1);
    assert.equal(row.capped, 1);
  } finally {
    await server.close();
  }
});

/**
 * A trimmed follow-up that runs out its own 300s cap, under the review deadline
 * `maxMs` (or none), must still get the untrimmed resend. Timers of 200s to
 * 300s — only the follow-ups' own 300s caps here — fire after 300ms instead; the
 * 5s first-token and idle budgets and a review's longer total budget are left
 * alone.
 */
async function assertOwnCapStillResends(maxMs) {
  const realSetTimeout = globalThis.setTimeout;
  let chats = 0;
  const server = await startFakeServer((request, response) => {
    if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
    chats += 1;
    if (chats === 1) return cutoffStream(response, () => {});
    if (chats === 2) return realSetTimeout(() => respondStream(response, completionFrames(salvagedFindings)), 1_500);
    return respondStream(response, completionFrames(salvagedFindings));
  });
  try {
    globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 200_000 && ms <= 300_000 ? 300 : ms, ...rest);
    const ledger = createLedger();
    const result = await requestFindings({ name: 'p', baseUrl: server.baseUrl }, deadlinePlan(ledger, maxMs));

    assert.equal(result.salvaged, true);
    // The untrimmed resend answered: it carried the whole cut reasoning.
    const { originalChars } = result.salvageTrim;
    assert.ok(originalChars >= 86_400);
    assert.deepEqual(result.salvageTrim, { applied: false, originalChars, retainedChars: originalChars });
    const chatRequests = chatRequestsOf(server);
    assert.equal(chatRequests.length, 3, 'the original, the trimmed follow-up and the untrimmed resend');
    assert.match(chatRequests[1].body.messages[2].content, /characters of reasoning omitted/);
    assert.equal(chatRequests[2].body.messages[2].content.length, originalChars);
    assert.deepEqual(
      ledger.entries().map((entry) => [entry.outcome, entry.reason]),
      [['failed', 'token-reserve-cutoff'], ['failed', 'deadline-timeout'], ['answered', null]],
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    await server.close();
  }
}

test('a trimmed follow-up that runs out its own 300s cap, with no review deadline, still gets the untrimmed resend', async () => {
  // The follow-up's own cap is reported as `deadline-timeout` too, but no
  // review deadline was spent, so the untrimmed resend is still due.
  await assertOwnCapStillResends(undefined);
});

test('a trimmed follow-up that runs out its own 300s cap, under a longer review deadline, still gets the untrimmed resend', async () => {
  // With an hour of review deadline left, the follow-up's own 300s cap is the
  // one that binds; the review's deadline is not spent, so the resend is due.
  await assertOwnCapStillResends(3_600_000);
});

/**
 * Both follow-ups run out their own 300s cap (shortened as above), under the
 * review deadline `maxMs` (or none): no review deadline ended salvage, so the
 * review reports its original failure.
 */
async function assertOwnCapKeepsOriginalReason(maxMs) {
  const realSetTimeout = globalThis.setTimeout;
  let chats = 0;
  const server = await startFakeServer((request, response) => {
    if (!request.url.includes('/chat/completions')) return respondJson(response, modelList('test-model'));
    chats += 1;
    if (chats === 1) return cutoffStream(response, () => {});
    return realSetTimeout(() => respondStream(response, completionFrames(salvagedFindings)), 1_500);
  });
  try {
    globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 200_000 && ms <= 300_000 ? 300 : ms, ...rest);
    const ledger = createLedger();
    const error = await caught(requestFindings({ name: 'p', baseUrl: server.baseUrl }, deadlinePlan(ledger, maxMs)));

    assert.equal(error.reason, 'token-reserve-cutoff', 'the original failure is reported');
    assert.ok(error.answer?.reasoning?.length >= 86_400);
    assert.equal(chatRequestsOf(server).length, 3, 'the original, the trimmed follow-up and the untrimmed resend');
    assert.deepEqual(
      ledger.entries().map((entry) => [entry.outcome, entry.reason]),
      [['failed', 'token-reserve-cutoff'], ['failed', 'deadline-timeout'], ['failed', 'deadline-timeout']],
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    await server.close();
  }
}

test('both follow-ups running out their own 300s cap, with no review deadline, leave the original reason', async () => {
  await assertOwnCapKeepsOriginalReason(undefined);
});

test('both follow-ups running out their own 300s cap, under a longer review deadline, leave the original reason', async () => {
  await assertOwnCapKeepsOriginalReason(3_600_000);
});
