// The pre-submission estimate, and the silence that is its point.
//
// Prefill is the expensive silent half — 191–335s measured here on a dense model
// before a token appears, against ~67s on the MoE for the same input — and the
// choice between waiting and `--background` has to be made before any of it
// happens. An estimate is only worth printing if a reader can act on it, which
// means an invented one is worse than none.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_RATE_NOTE, estimateNote, estimateRun } from '../scripts/lib/eta.mjs';

const MEASURED = { prefillTokensPerSecond: 700, generationTokensPerSecond: 80 };

test('an unmeasured provider gets NO estimate, not a default one', async () => {
  // The load-bearing case. A number derived from someone else's hardware would
  // be acted on exactly as confidently as a real one.
  assert.equal(estimateRun({ estimatedTokens: 40_000, maxTokens: 2000, profile: {} }), null);
  assert.equal(estimateRun({ estimatedTokens: 40_000, maxTokens: 2000, profile: undefined }), null);
  assert.equal(estimateNote(null), null);
});

test('the two halves are estimated separately, never blended', async () => {
  // ADR 009 established that no arithmetic on a footer recovers generation from
  // duration. A single figure would hide the fact that makes --background the
  // right call: most of the wait happens before anything appears.
  const estimate = estimateRun({ estimatedTokens: 35_000, maxTokens: 1600, profile: MEASURED });
  assert.equal(Math.round(estimate.prefillSeconds), 50);
  assert.equal(Math.round(estimate.generationSeconds), 20);
});

test('a provider measured for only one half still gets that half', async () => {
  const prefillOnly = estimateRun({
    estimatedTokens: 14_000, maxTokens: 800, profile: { prefillTokensPerSecond: 700 },
  });
  assert.equal(Math.round(prefillOnly.prefillSeconds), 20);
  assert.equal(prefillOnly.generationSeconds, null);
  assert.match(estimateNote(prefillOnly), /reading the input/);
  assert.doesNotMatch(estimateNote(prefillOnly), /generating/);
});

test('no reply budget means no generation estimate, rather than a guessed one', async () => {
  // Without --max-tokens there is no token count to divide. Absent, not zero:
  // a zero would render as "~0s generating", which is a measurement nobody took.
  const estimate = estimateRun({ estimatedTokens: 7000, profile: MEASURED });
  assert.equal(estimate.generationSeconds, null);
  assert.ok(estimate.prefillSeconds > 0);
});

test('a nonsense rate is treated as no rate, not as an enormous number', async () => {
  for (const rate of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 'fast']) {
    const estimate = estimateRun({ estimatedTokens: 1000, maxTokens: 100, profile: { prefillTokensPerSecond: rate } });
    assert.equal(estimate, null, `rate ${rate} must not produce an estimate`);
  }
});

test('the note says it is an estimate and names where the rates came from', async () => {
  // A figure whose provenance a reader cannot check is the class this repo keeps
  // having to retract.
  const note = estimateNote(estimateRun({ estimatedTokens: 35_000, maxTokens: 1600, profile: MEASURED }));
  assert.match(note, /Estimated from this provider's configured rates/);
  assert.match(note, /An estimate, not a promise/);
});

test('long waits read in minutes, because seconds stop being actionable', async () => {
  const long = estimateNote(estimateRun({ estimatedTokens: 234_000, maxTokens: 100, profile: MEASURED }));
  assert.match(long, /~5m3\d?s? reading the input/);
});

test('the no-rate note names the exact config keys that would enable one', async () => {
  assert.match(NO_RATE_NOTE, /prefillTokensPerSecond/);
  assert.match(NO_RATE_NOTE, /generationTokensPerSecond/);
});
