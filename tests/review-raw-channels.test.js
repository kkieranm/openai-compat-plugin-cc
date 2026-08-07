// What the reader is shown when a structured reply could not be read.
//
// This file exists because the fix it guards had NO witness at all. A reviewer
// proved that by restoring the pre-fix `return content || reasoning;` and running
// the whole suite at its real path: 671 tests, 0 failures. A fix nothing can
// catch being removed is a fix that has already half-reverted.
//
// The mutation these tests must fail against is exactly that line. So each one
// asserts BOTH labels and BOTH bodies: a test that only checks `[content]` and
// the content text still passes under `content || reasoning`, because that
// branch returns the content text too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonReport } from '../scripts/lib/review-report.mjs';

const CONTENT = 'I had a look and I am not sure.';
const REASONING = '{"analysis":"a","findings":[{"file":"a.js"}],"summary":"s"}';

const context = (result, structured = true) => ({
  result: { content: '', reasoning: '', model: 'test-model', requestedModel: 'test-model', ...result },
  profile: { name: 'test' },
  model: 'test-model',
  target: { label: 'a.js', unreadable: [] },
  hunksOnly: false,
  budget: { checked: true, note: null },
  estimatedTokens: null,
  durationMs: 1,
  structured,
  ledger: null,
});

// `raw` is what both renderings read: the human report prints it verbatim and
// `--json` carries it under this name. Pinning it here pins both.
const rawFor = (result, structured) => jsonReport(null, context(result, structured)).raw;

test('an unreadable structured reply shows BOTH channels, each labelled', () => {
  // The case the parser exists to refuse, and the case preferring `content` got
  // wrong: stray prose in one channel and the rejected payload in the other.
  // Whichever channel the renderer picked, it dropped the evidence — and the
  // comment above the fix claims refusing PRESERVES the evidence, which is only
  // true if the evidence is what gets printed.
  const raw = rawFor({ content: CONTENT, reasoning: REASONING });
  assert.match(raw, /\[content\]/, 'the content channel must be labelled');
  assert.match(raw, /\[reasoning\]/, 'the reasoning channel must be labelled');
  assert.ok(raw.includes(CONTENT), 'the content text must reach the reader');
  assert.ok(raw.includes(REASONING), 'the rejected payload must reach the reader — this is the evidence');
});

test('the labels appear only when there are two channels to tell apart', () => {
  // A label on a single channel would be noise, and the previous behaviour is
  // right here. Pinned so the fix above is not "widened" into every reply.
  assert.equal(rawFor({ content: CONTENT, reasoning: '' }), CONTENT);
  assert.equal(rawFor({ content: '', reasoning: REASONING }), REASONING);
});

test('without a schema the reasoning channel is still not shown', () => {
  // ADR 003: without a grammar that channel is scratchpad, and printing it as
  // the model's reply would present a draft as an answer. The dual-channel fix
  // is gated on `structured` for that reason, not incidentally.
  assert.doesNotMatch(rawFor({ content: CONTENT, reasoning: REASONING }, false), /\[reasoning\]/);
});
