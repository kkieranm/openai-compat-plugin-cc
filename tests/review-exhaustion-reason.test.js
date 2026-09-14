// A run that spent its whole token budget reasoning and a run whose server
// broke are different facts, and a caller has to be able to tell them apart
// WITHOUT reading English.
//
// That caller is the overnight sweep (`bench/review-sweep.mjs`): it walks
// commits while nobody is watching and writes a coverage section saying what was
// and was not reviewed. Token exhaustion is the dominant failure here — the
// model spending the entire shared `max_tokens` pool on reasoning and emitting
// no findings — so a sweep that could not name it would report a night that
// measured nothing as a night that found nothing.
//
// The repo has hit this defect class before: a harness that could distinguish
// a wall-clock cap from a 500 only by pattern-matching prose. `bench/lib/outcome.mjs`
// states the rule its own readers keep — never regex a cause out of stderr. So
// the refusal carries a `reason` and this test is what stops it being dropped
// again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionFrames, respondStream, reviewScenario as scenario, runCompanion } from './helpers.mjs';

// Truncated on purpose: a reply cut off mid-object is exactly what a budget
// overrun leaves behind, and it is what sends `unparsedReply` down the branch
// under test. The `finish_reason` is the server's own word for it.
const guillotined = '{"analysis":"reading the changed files in full so that ';

const replies = (options) => (request, response) => respondStream(response, completionFrames(guillotined, options));

test('a token-exhausted review names its cause in a field, not only in prose', async () => {
  const { dir, server, configPath } = await scenario(replies({ finishReason: 'length' }));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });

    // Non-zero: this run produced no review, and `--json` is the failure
    // envelope rather than a report.
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.error, true);
    assert.equal(report.reason, 'token-exhaustion');
  } finally {
    await server.close();
  }
});

// This is a POST-HOC classification of an otherwise-successful transport
// interaction — the ledger already holds a closed, populated entry for the
// request that produced this refusal — so the failure envelope must carry it.
// Without this, `attempts` came back null for the dominant overnight-sweep
// failure mode, making the gate rule that a missing or self-inconsistent
// `attempts[]` invalidates the invocation structurally unpassable for any run
// that starved.
test('a token-exhausted review still carries the attempt that produced it', async () => {
  const { dir, server, configPath } = await scenario(replies({ finishReason: 'length' }));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    const report = JSON.parse(result.stdout);
    // Exact projection, not a truthy/non-null check — proves the record is a
    // real, internally consistent closed physical attempt, not a placeholder.
    assert.deepEqual(
      report.attempts.map(({ index, outcome, reason, serverResponded }) => ({ index, outcome, reason, serverResponded })),
      [{ index: 1, outcome: 'answered', reason: null, serverResponded: true }],
    );
  } finally {
    await server.close();
  }
});

// OAI-221's reasoning witness on the failure envelope was inert until the reply's
// usage was carried onto the error at the throw site: token-exhaustion is the
// mode it most wants to observe, since the model spent its whole budget reasoning.
// This reads the `error.usage` route through `unparsedReply`.
test('a token-exhausted reply carrying reasoning usage reads reasoning-observed on the failure envelope', async () => {
  const { dir, server, configPath } = await scenario(replies({ finishReason: 'length', reasoningTokens: 512 }));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    const report = JSON.parse(result.stdout);
    assert.equal(report.error, true);
    assert.equal(report.reason, 'token-exhaustion');
    assert.deepEqual(report.reasoning, { state: 'reasoning-observed', tokens: 512 });
  } finally {
    await server.close();
  }
});

// The reasoning-only route reaches the envelope by a different carrier —
// `error.answer.usage`, built in review-request.mjs's reasoningOnlyFailure —
// so it is pinned separately from the token-exhaustion route above.
test('a reasoning-only reply carrying reasoning usage reads reasoning-observed on the failure envelope', async () => {
  const { dir, server, configPath } = await scenario(
    (request, response) => respondStream(response, completionFrames('reasoned but never answered', { channel: 'reasoning', finishReason: 'stop', reasoningTokens: 300 })),
  );
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    const report = JSON.parse(result.stdout);
    assert.equal(report.error, true);
    assert.equal(report.reason, 'reasoning-only');
    assert.deepEqual(report.reasoning, { state: 'reasoning-observed', tokens: 300 });
  } finally {
    await server.close();
  }
});

// The positive control that makes the two tests above capable of failing: a
// witness hardcoded to `reasoning-observed`, or one reading a constant, would
// pass them. This reply is byte-identical to the first token-exhaustion fixture
// but its usage frame carries NO `completion_tokens_details`, so the honest
// reading is `unknown` — proving the witness tracks the frame, not the code.
test('a token-exhausted reply with no reasoning detail reads unknown on the failure envelope', async () => {
  const { dir, server, configPath } = await scenario(replies({ finishReason: 'length' }));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    const report = JSON.parse(result.stdout);
    assert.equal(report.error, true);
    assert.equal(report.reason, 'token-exhaustion');
    assert.deepEqual(report.reasoning, { state: 'unknown', tokens: null });
  } finally {
    await server.close();
  }
});

test('the prose still says what happened, so a human loses nothing to the field', async () => {
  const { dir, server, configPath } = await scenario(replies({ finishReason: 'length' }));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });

    const report = JSON.parse(result.stdout);
    assert.match(report.message, /ran out of tokens/);
  } finally {
    await server.close();
  }
});

// A reasoning-only reply (content empty, reasoning non-empty, so it is NOT
// the wholly-blank shape the retry layer already catches as
// 'blank-completion') is now intercepted inside review-request.mjs's
// unconstrained(), before it ever reaches requireAnswer on this path — see
// scripts/lib/client.mjs's isReasoningOnly. This fixture's reasoning (28
// chars) is well under SALVAGE_MIN_REASONING_CHARS, so trySalvage declines
// without ever sending a follow-up request, and the original error still
// rethrows via the same ledger-carrying path — this test is what pins that
// `attempts` isn't dropped along the way.
test('a reasoning-only reply intercepted before requireAnswer still carries the attempt that produced it', async () => {
  const { dir, server, configPath } = await scenario(
    (request, response) => respondStream(response, completionFrames('reasoned but never answered', { channel: 'reasoning', finishReason: 'stop' })),
  );
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.error, true);
    assert.equal(report.reason, 'reasoning-only');
    // `outcome: 'failed'` / `reason: 'reasoning-only'`, not `'answered'` /
    // `null`: the ledger closes every physical attempt `answered` on
    // transport success (`settle()` runs before this rejection is ever
    // judged), and `unconstrained()`'s own reasoning-only check reclassifies
    // it via `result.markUnanswered()` before the failure propagates — the
    // fix this test now pins rather than the pre-fix bug it used to pin
    // (an `answered` entry for a request whose content this same envelope's
    // `reason` field says was never usable).
    assert.deepEqual(
      report.attempts.map(({ index, outcome, reason, serverResponded }) => ({ index, outcome, reason, serverResponded })),
      [{ index: 1, outcome: 'failed', reason: 'reasoning-only', serverResponded: true }],
    );
  } finally {
    await server.close();
  }
});

// The control, and it is what makes the first test capable of failing: a
// `reason` hardcoded on every refusal would satisfy that test, and so would a
// reader returning 'token-exhaustion' for anything it could not parse. The body
// here is byte-identical and equally unparseable — ONLY the server's
// `finish_reason` differs — so what is pinned is that the field tracks the
// CAUSE rather than the symptom.
//
// It also records a distinction the sweep depends on and which is easy to guess
// wrong: an unreadable reply that finished normally is NOT an error envelope.
// The command exits 0 and reports `parsed: false`, because "the model said
// something I could not read" is a completed run with no findings recovered,
// while "the budget ran out" is a refusal. Two different exits, two different
// coverage rows.
test('an unparseable reply that did NOT run out of tokens is a parsed:false run, not an exhausted one', async () => {
  const { dir, server, configPath } = await scenario(replies({ finishReason: 'stop' }));
  try {
    const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.parsed, false);
    assert.notEqual(report.reason, 'token-exhaustion');
    // Not a failure envelope at all: `error` is the marker `reasonFrom` gates on.
    assert.notEqual(report.error, true);
  } finally {
    await server.close();
  }
});
