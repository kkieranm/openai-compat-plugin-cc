// Shared fixtures for the benchmark-report suites.
//
// Split out when `bench-report.test.js` crossed the size ratchet, and the seam
// it forced is a real one: one suite asks whether every run is accounted for in
// a bucket, the other asks whether the timing and prompt-size columns describe
// what their headers say. Both need the same minimal case and the same
// column-by-name reader, and a second hand-maintained copy of either would drift
// exactly as silently as the numbers these tests exist to guard.
//
// `bench-reliability.test.js` split the same way in OAI-31, at the same kind of
// seam: attempt ACCOUNTING (one logical run, N physical attempts) against the
// reason-code PROSE in `bench-reason-notes.test.js`. Only `failedAttempt`
// crosses that seam, so only it moved here — `answered` and `retriedRun` are
// used by the accounting suite alone and stay there rather than widening this
// module's surface for one caller.
import assert from 'node:assert/strict';

const CASE = {
  id: 'sample',
  label: 'a case',
  defects: [{ id: 'the-defect', file: 'x.mjs', lines: [1, 3], anchor: 'boom();' }],
  dropped: [],
};

/**
 * A row cell by its column *name*. Positional indexes silently shift when a
 * column is added — which is how a test can keep passing while asserting about
 * the wrong number.
 */
function cell(report, column) {
  const lines = report.split('\n');
  const header = lines.find((line) => line.startsWith('| case |')).split('|').map((part) => part.trim());
  const row = lines.find((line) => line.startsWith('| `sample`')).split('|').map((part) => part.trim());
  const index = header.indexOf(column);
  assert.ok(index > 0, `no such column: ${column}`);
  return row[index];
}

/** A run that parsed and scored the one defect. */
function goodRun() {
  return {
    diffOnly: false,
    report: { parsed: true, findings: [], analysisCut: false, finishReason: 'stop', usage: { prompt_tokens: 10 }, durationMs: 1000 },
    score: {
      matched: [{ id: 'the-defect', via: 'anchor' }],
      unmatched: [],
      byDefect: [{ id: 'the-defect', found: true, via: 'anchor' }],
      recall: { total: 1, found: 1, anchored: 1, ranged: 0 },
    },
  };
}

/** One physical attempt that died with `reason`, carrying no timings. */
const failedAttempt = (reason, extra = {}) => ({
  index: 1, cause: { answerAttempt: 1, degrade: null }, warmEligible: false, waitedMs: 0,
  outcome: 'failed', reason, prefillMs: null, generationMs: null, ...extra,
});

export { CASE, cell, failedAttempt, goodRun };
