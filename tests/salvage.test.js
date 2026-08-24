// Salvage: what happens to a review that hit --max-seconds mid-reasoning.
//
// Tier 1 (keep the partial answer instead of discarding it) and tier 2 (a bounded
// follow-up asking the model to conclude from it) both live in this one file
// because they share one fixture shape — a server that streams reasoning_content
// forever, the same class endless-stream fixture tests/deadline.test.js already
// uses for the cap itself, but with reasoning_content in place of content so the
// salvage trigger's "substantial reasoning, empty content" gate actually fires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepo, reviewScenario, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findingsFirst, schemaInstruction } from '../scripts/lib/structured.mjs';
import { estimateTokens } from '../scripts/lib/context-guard.mjs';

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
 * `attemptSalvage` ever sees a result to judge.
 */
function reasoningOnlyEmptyContentFrames(reasoningText) {
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
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
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

test('a deadline-timeout keeps the partial reasoning instead of discarding it', async () => {
  // No follow-up expected in THIS test's assertions — the fixture answers one
  // anyway (real findings, fast) since a real run would try tier 2. What the
  // assertions below actually check is the tier-2 success envelope; tier 1's
  // own guarantee is inferred from it rather than asserted directly — see the
  // comment at the assertions for why that inference holds.
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({ findings: [], summary: 'salvaged, nothing found' })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    const envelope = JSON.parse(result.stdout);
    // The run succeeded via salvage (tier 2) — covered on its own below — but
    // tier 1's own guarantee (attach `.answer` in stream-collect.mjs) is what
    // made tier 2 possible in the first place; a bare status:0 here already
    // proves reasoning was captured, not thrown away, at the point of failure.
    assert.equal(result.status, 0);
    assert.equal(envelope.salvaged, true);
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

test('salvage sends a genuine multi-turn follow-up and reports it as salvaged, never as an ordinary review', async () => {
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
    assert.equal(result.status, 0);
    const envelope = JSON.parse(result.stdout);

    // Reported honestly — this must never look like an ordinary complete review.
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.findings.length, 1);
    assert.equal(envelope.findings[0].summary, 'concluded from partial reasoning');

    // The follow-up's actual wire shape: original system+user, unchanged, then
    // an assistant turn carrying the partial reasoning, then a new user ask.
    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 2, 'exactly one salvage attempt, on top of the original');
    const followUp = chatRequests[1].body.messages;
    assert.equal(followUp.length, 4);
    assert.equal(followUp[0].role, 'system');
    assert.equal(followUp[1].role, 'user');
    assert.equal(followUp[2].role, 'assistant');
    assert.ok(followUp[2].content.includes(REASONING_CHUNK.trim()), 'the assistant turn must carry the real partial reasoning');
    assert.equal(followUp[3].role, 'user');
    // Same original system+user turns, byte for byte — reused rather than
    // rebuilt, so the server's own prefix cache (if any) can still apply.
    const original = chatRequests[0].body.messages;
    assert.equal(followUp[0].content, original[0].content);
    assert.equal(followUp[1].content, original[1].content);
    // The reason-keyed budget branch must leave a deadline-timeout
    // salvage untouched: the follow-up's own max_tokens stays the original
    // built.reserve, never dropped to the token-reserve-cutoff branch's
    // smaller flat reserve.
    assert.equal(chatRequests[1].body.max_tokens, chatRequests[0].body.max_tokens);
  } finally {
    stop();
    await server.close();
  }
});

test('--structured-output does not bypass salvage on a deadline-timeout, and the follow-up states the shape itself', async () => {
  // The schema-constrained request is a different branch of `requestFindings`
  // (the `first`/`prepareLadder` path, not `unconstrained`'s `built`) — before
  // the fix, a deadline-timeout there threw straight through `isFormatRejection`
  // without ever calling `trySalvage`, because that check only ever guarded the
  // `response_format`-refusal retry, not a plain timeout. This is the live proof.
  //
  // A second, sharper gap surfaced on the very fix for the first: the
  // structured-output rung's original request states its shape only via the
  // `response_format` GRAMMAR, never in prose the model can see on a later
  // turn — unlike `unconstrained()`'s own rung, whose messages always carry a
  // prose schema instruction regardless of `--structured-output`. A follow-up
  // that assumed "the shape already asked for" was therefore FALSE for this
  // path specifically, and a fake server that answers correctly regardless of
  // prompt content (as the assertions above alone would allow) cannot catch
  // that — so this test also inspects the actual follow-up message and
  // requires it to state the shape itself.
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    // All fields the schema actually requires, per-finding and at the top
    // level (`analysis`, `findings[].evidence`) — a fixture missing them would
    // pass through the lenient prose parser regardless of what shape the
    // follow-up asked for, which is exactly how the first version of this test
    // failed to catch pass 3's bug. Reproducing the real shape closes that gap.
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
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.findings.length, 1);
    assert.equal(envelope.findings[0].summary, 'concluded under --structured-output');
    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    assert.equal(chatRequests.length, 2);

    // The ORIGINAL request's own schema, straight off the wire — the source of
    // truth the follow-up's restated shape must actually match, not just
    // resemble. A regex alone would accept the wrong rung, stale caps, or a
    // schema missing required fields.
    const sentSchema = chatRequests[0].body.response_format.json_schema.schema;
    const expected = findingsFirst(sentSchema);

    const followUp = chatRequests[1].body.messages;
    // Pinned before indexing from the end, not just implied by the shape below:
    // a stray extra turn appended after `ask` would silently become the new
    // "last message" and slip past every assertion that follows, which all
    // index relative to the end rather than an absolute position.
    assert.equal(followUp.length, 4);
    const ask = followUp[followUp.length - 1];
    assert.equal(ask.role, 'user');
    // FULL equality on the entire turn, not `.includes()` plus a separate
    // slice-from-first-'{' check — that combination still leaves a gap:
    // `.includes()` proves the override sentence is present
    // somewhere, but not that nothing else was inserted between it and the
    // schema instruction, since the schema check independently re-anchors on
    // the first '{' regardless of what precedes it. This turn is entirely
    // static (unlike the assistant turn before it, which carries the
    // non-deterministic streamed reasoning), so nothing here is exempt from an
    // exact match — reconstructed from the same production pieces so the
    // expectation cannot itself drift from what trySalvage actually sends.
    assert.equal(
      ask.content,
      'Your previous response was cut off before it finished. Based only on your analysis above, state '
        + 'your findings now. Do not reason further — conclude from what you already have. '
        + 'Ignore any earlier instruction to work through "analysis" before "findings": there is no '
        + 'schema enforcing that order here, and this reply must carry its findings even if it runs '
        + 'out of room, so findings come FIRST. '
        + schemaInstruction(expected),
      'the follow-up turn must be exactly the override sentence immediately followed by ' +
        'findingsFirst() of the schema actually sent on the wire — no gap, no insertion, no drift',
    );
  } finally {
    stop();
    await server.close();
  }
});

test('a successful salvage reports retried: true — it cost at least two physical requests', async () => {
  // `retried` used to read off the salvage call's OWN `requestCount`, which is
  // always 1 for a first-try salvage success (it never retries itself) — so a
  // review that failed once and then salvaged reported `retried: false` despite
  // the ledger holding two entries. This is the live proof, on the ledger the
  // whole review actually shares.
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    response.write(finishFrame(JSON.stringify({ findings: [], summary: 'salvaged, nothing found' })));
    response.end();
  });
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.retried, true, 'the original failed attempt plus the salvage follow-up are two physical requests');
  } finally {
    stop();
    await server.close();
  }
});

test('a salvage attempt that itself fails falls back to the ordinary deadline-timeout report, partial still attached', async () => {
  const { handler, stop } = endlessReasoningThenFollowUp((record, response) => {
    // The follow-up itself fails fast (a malformed body) rather than a real
    // timeout, which would cost the full salvage budget for no test value —
    // this exercises the identical fallback branch either way.
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
    // Tier 1's guarantee held even though tier 2 was tried and failed.
    assert.ok(envelope.partial?.reasoning?.includes(REASONING_CHUNK.trim()));
    // Exactly two requests: the original, and the one failed salvage attempt —
    // never a third. `trySalvage` does not retry itself and does not recurse.
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 2);
  } finally {
    stop();
    await server.close();
  }
});

function contentFrame() {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'test-model',
    choices: [{ index: 0, delta: { content: '{"findings": [' }, finish_reason: null }],
  })}\n\n`;
}

test('a deadline-timeout with content already underway is not eligible for salvage, even with substantial reasoning too', async () => {
  // The rarer shape this repo deliberately does not attempt: findings JSON
  // already underway when the cap fired. Salvage must not fire here at all —
  // and this must be true even when reasoning ALONE would have been enough to
  // trigger it, so both frame kinds are sent, well over
  // SALVAGE_MIN_REASONING_CHARS, to isolate this gate from the reasoning-length
  // one (a version of this test sending only content passed even with the
  // content check deleted, for the wrong reason — the length gate alone was
  // already blocking it, since no reasoning had streamed at all).
  const timers = new Set();
  let chatRequestCount = 0;
  const handler = (record, response) => {
    if (!record.url.includes('/chat/completions')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }
    chatRequestCount += 1;
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    for (let i = 0; i < 12; i += 1) response.write(reasoningFrame());
    response.write(contentFrame());
    const timer = setInterval(() => response.write(contentFrame()), DRIP_MS);
    timer.unref?.();
    timers.add(timer);
  };
  const { dir, server, configPath } = await reviewScenario(handler);
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '1'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined);
    // Only the original request — no salvage follow-up for a content-in-progress failure.
    assert.equal(chatRequestCount, 1);
    // Tier 1 still captured BOTH fields, even though tier 2 correctly declined it.
    assert.ok(envelope.partial?.content?.length > 0);
    assert.ok(envelope.partial?.reasoning?.length >= 500);
  } finally {
    timers.forEach(clearInterval);
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

test('a salvage follow-up grown past the context window is refused, not sent unchecked', async () => {
  // Appending the partial reasoning back in as an assistant turn can push an
  // already-near-window request over the top — exactly the class of review
  // most likely to have hit the deadline in the first place. A tiny
  // contextLength here is what forces this: the ORIGINAL request (a small
  // file plus a modest instruction) fits comfortably, but the reasoning
  // alone — well over SALVAGE_MIN_REASONING_CHARS, per the trigger gate —
  // does not fit alongside it once appended.
  const { handler, stop } = endlessReasoningThenFollowUp(() => {
    throw new Error('the follow-up must never be sent when the grown prompt does not fit the window');
  });
  // 2000: comfortably fits the original request (a small seed file plus the
  // review system prompt, ~350-470 tokens against a 1000-token budget here),
  // but not the ~1300+ tokens the grown follow-up reaches once 2s of streamed
  // reasoning is appended back in as an assistant turn.
  const { dir, server, configPath } = await reviewScenario(handler, { contextLength: 2000 });
  try {
    const result = await runCompanion(['review', '--json', '--max-seconds', '2'], { configPath, cwd: dir });
    assert.equal(result.status, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.reason, 'deadline-timeout');
    assert.equal(envelope.salvaged, undefined);
    // Tier 1 still preserved the original partial, even though tier 2
    // correctly declined to send an oversized follow-up.
    assert.ok(envelope.partial?.reasoning?.length >= 500);
    // Exactly one request — the follow-up was refused BEFORE it was sent, per
    // the assertion inside the handler above (which would have failed this
    // test with a different error if reached).
    assert.equal(server.requests.filter((r) => r.url.includes('/chat/completions')).length, 1);
  } finally {
    stop();
    await server.close();
  }
});

// --- OAI-204: the salvage reasoning trim ---------------------------------
//
// `token-reserve-cutoff` and `reasoning-only` get the smaller flat
// TOKEN_RESERVE_TOKENS reserve AND (as of OAI-204) a head+tail trim of the
// reasoning fed back into the follow-up; `deadline-timeout` keeps both its
// full reserve and its full untouched reasoning, unchanged by this trial.
//
// A WIDE context window (matching tests/token-reserve-cutoff.test.js's own
// WIDE_CONTEXT_LENGTH/cutoffChars derivation) is needed for all three
// fixtures below, not just the token-reserve-cutoff one: without it, any
// reasoning stream over ~6,144 chars on the DEFAULT 8192-token window would
// get cut and reclassified as token-reserve-cutoff before it could exhibit
// the OTHER two reasons this trial cares about. The fixture generator is
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
 * A non-repeating stand-in for REASONING_CHUNK (Finding 3, OAI-204 amendment,
 * `codex-adversarial`): every chunk embeds its own index, so no two windows
 * of the streamed reasoning are ever identical the way REASONING_CHUNK's
 * fixed 51-char period is — a periodic fixture can't tell a correctly-sliced
 * head/tail from one shifted by exactly the period (or any multiple of it),
 * which the old head/tail slice-plus-substring assertions could not catch.
 * No whitespace at either end, so accumulating many of these and calling
 * `.trim()` on the result (as `trySalvage` itself does) is a no-op — the
 * reconstruction below can rely on exact multiples of this width. Used only
 * by the two trim tests below, which assert the ENTIRE captured message
 * against an exact reconstruction rather than slice-plus-substring checks
 * (also Finding 3).
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

test('a long deadline-timeout reasoning is fed back to the salvage follow-up untouched', async () => {
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
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.salvaged, true);
    assert.equal(envelope.salvageTrim.applied, false);
    assert.equal(envelope.salvageTrim.originalChars, envelope.salvageTrim.retainedChars);
    assert.ok(envelope.salvageTrim.originalChars > 6_000, 'must actually exceed the trim budget to be a real test of "not trimmed"');

    const chatRequests = server.requests.filter((r) => r.url.includes('/chat/completions'));
    const sent = chatRequests[1].body.messages[2].content;
    assert.equal(sent.length, envelope.salvageTrim.originalChars);
    assert.ok(!sent.includes('characters of reasoning omitted'));
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

// --- OAI-204 amendment (review-ladder pass 1, `codex-adversarial` and
// `codex-plain`): the untrimmed fallback (Finding 1), the trim's expansion
// guard (Finding 4), and its surrogate-pair safety (Finding 5). -----------

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
    assert.equal(envelope.salvageTrim.retainedChars, 6_000, 'unchanged from the pre-amendment behavior');
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
      // The actual bug shape (Codex, OAI-204 review-ladder pass, mid-fix
      // review): a clean stream that answers with real reasoning_content and
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

    // The full ledger sequence — the bug this fixture was rewritten to
    // reproduce (Codex, OAI-204 review-ladder): the losing trimmed attempt
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

    // The field-attribution fix the amendment's round-2 review required: the
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

const NEAR_THRESHOLD_REASONING = 'x'.repeat(6_020); // Finding 4: inside the expansion-prone range
  // (6,001-6,045 chars) where the omitted-count marker text is longer than what a trim in that
  // range actually removes — trimReasoning must refuse to "trim" into something longer than the
  // original rather than pretend a net-negative trim helped.

/** A server whose FIRST request streams a single burst of reasoning, then
 * finishes CLEANLY with empty content (reasoning-only) — no watchdog, no
 * deadline, just a reasoning length chosen to land inside Finding 4's
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

test('reasoning just past the trim threshold is left untouched when trimming would expand it (Finding 4)', async () => {
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
 * (index `length - 4500 - 1` / `length - 4500`). Finding 5 (`codex-plain`):
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

test('a surrogate pair straddling either trim boundary is never split in the sent follow-up (Finding 5)', async () => {
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

    // (a) Finding 5's real hazard: a strict OpenAI-compatible server's own
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
