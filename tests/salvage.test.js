// OAI-138 salvage: what happens to a review that hit --max-seconds mid-reasoning.
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
  // anyway (real findings, fast) since a real run would try tier 2, but what is
  // asserted here is specifically tier 1: the ORIGINAL failure's partial field.
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
  // `response_format`-refusal retry, not a plain timeout. Codex pass 2 caught
  // this by inspection; this is the live proof.
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
    // schema missing required fields (Codex pass 4 flagged exactly this gap).
    const sentSchema = chatRequests[0].body.response_format.json_schema.schema;
    const expected = findingsFirst(sentSchema);

    const followUp = chatRequests[1].body.messages;
    // Pinned before indexing from the end, not just implied by the shape below
    // — pass 7's own acceptance audit found the sibling test (further down in
    // this file) already asserts this and this one didn't, so a stray extra
    // turn appended after `ask` would silently become the new "last message"
    // and slip past every assertion that follows, which all index relative to
    // the end rather than an absolute position.
    assert.equal(followUp.length, 4);
    const ask = followUp[followUp.length - 1];
    assert.equal(ask.role, 'user');
    // FULL equality on the entire turn, not `.includes()` plus a separate
    // slice-from-first-'{' check — Codex pass 6 found that combination still
    // leaves a gap: `.includes()` proves the override sentence is present
    // somewhere, but not that nothing else was inserted between it and the
    // schema instruction, since the schema check independently re-anchors on
    // the first '{' regardless of what precedes it. This turn is entirely
    // static (unlike the assistant turn before it, which carries the
    // non-deterministic streamed reasoning), so nothing here is exempt from an
    // exact match — reconstructed from the same production pieces so the
    // expectation cannot itself drift from what trySalvage actually sends.
    assert.equal(
      ask.content,
      'You ran out of time before finishing. Based only on your analysis above, state '
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
  // the ledger holding two entries. Codex pass 2 caught this by inspection;
  // this is the live proof, on the ledger the whole review actually shares.
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
