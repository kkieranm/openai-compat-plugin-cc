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
  // A COMPLETE target, not a load-bearing field. An earlier version of this
  // comment described `changed` as read by an unsized-window derivation at the
  // render site — that derivation was deleted (the report now reads the ladder's
  // own `skipped`), so the comment outlived its mechanism. Deleting `changed`
  // here still leaves 3/3 passing: this file asserts nothing about the skip, and
  // `skippedUnsizedWindow` is covered by value in review-unsized-window.test.js.
  target: { label: 'a.js', unreadable: [], changed: [] },
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

test('a review report records whether the server CONFIRMED its model', () => {
  // The cross-run reproduction reader groups runs by observed model, and an echoed
  // requested id is not proof that model answered — so the fact must reach the
  // record. Silent server → false; named → true; positive control so `false` is
  // not simply hard-coded.
  const silent = jsonReport(null, context({ content: 'x', reasoning: '', modelReported: false }));
  assert.equal(silent.modelReported, false, 'the server named nothing, and the record must say so');
  const named = jsonReport(null, context({ content: 'x', reasoning: '', modelReported: true }));
  assert.equal(named.modelReported, true);
});

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
  // Without a grammar that channel is scratchpad, and printing it as
  // the model's reply would present a draft as an answer. The dual-channel fix
  // is gated on `structured` for that reason, not incidentally.
  assert.doesNotMatch(rawFor({ content: CONTENT, reasoning: REASONING }, false), /\[reasoning\]/);
});
