// What the benchmark's timing and prompt-size columns claim.
//
// Split from `bench-report.test.js` at the size ratchet. The seam: that file
// asks whether every run lands in exactly one bucket, this one asks whether the
// figures beside those buckets describe what their headers say. Both defects
// this file guards were the same shape — two quantities welded into one number,
// printed under a name that promises one of them: `seconds` was prefill plus
// generation, and `prompt tokens` was one prompt times the run count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../bench/lib/report.mjs';
import { CASE, cell, goodRun } from './bench-report-fixtures.mjs';

/** A run with the two halves of its wall clock reported separately. */
function timedRun(prefillMs, generationMs) {
  const run = goodRun();
  return { ...run, report: { ...run.report, prefillMs, generationMs } };
}

test('prefill and generation are separate columns, never one number', async () => {
  // The whole point of the change: a cache moves prefill by tens of times and
  // leaves generation alone, so a single `seconds` range across these three runs
  // would print `3–425` and describe nothing.
  const report = renderReport(
    [{ caseDef: CASE, runs: [timedRun(421_660, 2_955), timedRun(11_457, 2_701), timedRun(10_257, 2_722)] }],
    { runsPerCase: 3, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'prefill s'), '10–422');
  assert.equal(cell(report, 'generate s'), '3–3');
  assert.ok(!report.includes('| seconds |'), 'the welded column must be gone, not merely joined by two more');
});

test('the prompt-token column is the prompt, not the sum of every run\'s prompt', async () => {
  // It was a sum, which is invisible at N=1 — where sum equals per-run — and
  // wrong by a factor of `runs` everywhere else. ADR 006 quotes `config-origin`
  // at 1,575 prompt tokens from an N=1 sweep; the first N=3 report printed 4,725
  // for the same case, in the column a reader divides a generation figure by.
  const report = renderReport(
    [{ caseDef: CASE, runs: [goodRun(), goodRun(), goodRun()] }],
    { runsPerCase: 3, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'prompt tokens'), '10');
});

test('when the prompt genuinely differs run to run, the column says so', async () => {
  // `--cold` prepends a per-run nonce, so the runs really do send different
  // prompts and no single figure is *the* prompt size. Only a test reaches this
  // branch: a live --cold run's nonces are all the same length, so its three
  // runs agree to the token.
  const cold = (tokens) => {
    const run = goodRun();
    return { ...run, report: { ...run.report, usage: { prompt_tokens: tokens } } };
  };
  const report = renderReport(
    [{ caseDef: CASE, runs: [cold(1613), cold(1614), cold(1613)] }],
    { runsPerCase: 3, provider: 'local', model: 'test-model', cold: true },
  );

  assert.equal(cell(report, 'prompt tokens'), '1613–1614');
});

test('a case whose runs all failed reports no prompt size, rather than zero', async () => {
  const report = renderReport(
    [{ caseDef: CASE, runs: [{ diffOnly: false, error: 'exit 1', stderr: 'boom' }] }],
    { runsPerCase: 1, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'prompt tokens'), '—', 'a zero-token prompt is a measurement nobody made');
});

test('a run that reported no timing is counted, not quietly excluded from the range', async () => {
  // A non-streamed reply carries nulls. Ranging over the two that did report
  // would print a complete-looking cell for a case where one run never
  // contributed — the same defect as a recall denominator over two runs while
  // the row says three.
  const report = renderReport(
    [{ caseDef: CASE, runs: [timedRun(400, 200), timedRun(500, 250), timedRun(null, null)] }],
    { runsPerCase: 3, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'prefill s'), '0–1 (2/3 measured)');
});

test('a null timing never becomes a zero, which arithmetic would have done silently', async () => {
  const report = renderReport(
    [{ caseDef: CASE, runs: [timedRun(null, null)] }],
    { runsPerCase: 1, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'prefill s'), '—');
  assert.equal(cell(report, 'generate s'), '—');
});

test('the cache caveat quotes a ratio it computed, and hedges the mechanism', async () => {
  const report = renderReport(
    [{ caseDef: CASE, runs: [timedRun(421_660, 2_955), timedRun(11_457, 2_701)] }],
    { runsPerCase: 2, provider: 'local', model: 'test-model' },
  );

  // 421660 / 11457 = 36.8. Asserted as the computed value, so a hard-coded
  // number copied from one day's measurement would fail here.
  assert.match(report, /varied 37× within a case/);
  // And no claim about what generation did — a draft asserted it 'did not' vary
  // and the first live run that printed the sentence disproved it in the same row.
  assert.doesNotMatch(report, /generation — which a cache does not touch — did not/);
  // "may reuse", not "does": this harness cannot see the server's cache, and
  // LM Studio publishes no field that would tell it.
  assert.match(report, /may reuse a server-side prompt cache/);
});

test('one run cannot establish variation, so no ratio is claimed', async () => {
  const report = renderReport(
    [{ caseDef: CASE, runs: [timedRun(421_660, 2_955)] }],
    { runsPerCase: 1, provider: 'local', model: 'test-model' },
  );

  assert.doesNotMatch(report, /varied/, 'a single measurement is not a spread');
});

test('a zero prefill never produces an Infinity× caveat', async () => {
  // A caveat that is itself a defect is worse than no caveat. A cached reply
  // measured at 0ms is entirely possible on a fast local server.
  const report = renderReport(
    [{ caseDef: CASE, runs: [timedRun(0, 100), timedRun(500, 100)] }],
    { runsPerCase: 2, provider: 'local', model: 'test-model' },
  );

  assert.doesNotMatch(report, /Infinity/);
  assert.doesNotMatch(report, /NaN/);
});

test('--cold says so, because it changes what the timings mean', async () => {
  const report = renderReport(
    [{ caseDef: CASE, runs: [timedRun(400, 200)] }],
    { runsPerCase: 1, provider: 'local', model: 'test-model', cold: true },
  );

  assert.match(report, /`--cold` was on/);
  assert.match(report, /not a byte-identical repeat/);
});
