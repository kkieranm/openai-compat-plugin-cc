// A run that spent its whole token budget reasoning and a run whose server
// broke are different facts, and a caller has to be able to tell them apart
// WITHOUT reading English.
//
// That caller is the overnight sweep (`bench/review-sweep.mjs`): it walks
// commits while nobody is watching and writes a coverage section saying what was
// and was not reviewed. Token exhaustion is the dominant failure here — OAI-115
// measures the model spending the entire shared `max_tokens` pool on reasoning
// and emitting no findings — so a sweep that could not name it would report a
// night that measured nothing as a night that found nothing.
//
// The repo already has this defect class on file twice over (OAI-13 items 1 and
// 2: a harness that could distinguish a wall-clock cap from a 500 only by
// pattern-matching prose), and `bench/lib/outcome.mjs` states the rule its own
// readers keep — never regex a cause out of stderr. So the refusal carries a
// `reason` and this test is what stops it being dropped again.
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
