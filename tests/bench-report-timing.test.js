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
  // wrong by a factor of `runs` everywhere else. The benchmark record quotes
  // `config-origin` at 1,575 prompt tokens from an N=1 sweep; the first N=3
  // report printed 4,725 for the same case, in the column a reader divides a
  // generation figure by.
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

/** A run that reported both a generation time and a token count. */
function ratedRun(completionTokens, generationMs) {
  const run = goodRun();
  return {
    ...run,
    report: {
      ...run.report,
      generationMs,
      usage: { ...run.report.usage, completion_tokens: completionTokens },
    },
  };
}

test('the rate column is each run\'s own rate, never the pooled quotient', async () => {
  // The trap this column exists inside. `sum(tokens) / sum(ms)` is a real
  // quantity — the corpus's length-weighted average — but not the one a cell
  // showing endpoints claims, and it is the same shape as the `prompt tokens`
  // sum fixed one commit earlier in this file.
  //
  // The numbers are chosen so the two answers cannot coincide: 10 tok/s for one
  // second and 2 tok/s for a hundred pool to 2.08, which is neither endpoint and
  // is not even inside the interval a reader would infer from one.
  const report = renderReport(
    [{ caseDef: CASE, runs: [ratedRun(10, 1_000), ratedRun(200, 100_000)] }],
    { runsPerCase: 2, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'gen tok/s'), '2.0–10.0');
});

test('a run whose server withheld token counts contributes no rate', async () => {
  // `usage` is null outright whenever a server refused `stream_options`, and
  // `completion_tokens` is optional even when `usage` is present. Either way the
  // run drops out of the numerator rather than entering it as a zero — and the
  // cell says how much of the case it actually covers, so a one-run rate cannot
  // read as if it described all three.
  const withoutUsage = { ...goodRun(), report: { ...goodRun().report, generationMs: 1_000, usage: null } };
  const report = renderReport(
    [{ caseDef: CASE, runs: [ratedRun(50, 1_000), withoutUsage] }],
    { runsPerCase: 2, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'gen tok/s'), '50.0 (1/2 measured)');
});

test('a generation that rounded to zero milliseconds reports no rate, not an infinite one', async () => {
  // `timings()` rounds to whole milliseconds, so a genuinely fast generation can
  // land on 0 — and 0 as a divisor yields Infinity, which would render as a
  // throughput figure nobody measured.
  const report = renderReport(
    [{ caseDef: CASE, runs: [ratedRun(7, 0)] }],
    { runsPerCase: 1, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'gen tok/s'), '—');
});

test('a run the wall-clock cap killed is counted inside failed, and named there', async () => {
  // Two facts in one cell on purpose. A capped run *is* a failed run, so the row
  // invariant `scored + truncated + unreadable + failed = runs` still holds —
  // but a harness limit and a model that could not answer are different things,
  // and only the second is a result about the reviewer.
  const report = renderReport(
    [{
      caseDef: CASE,
      runs: [
        { diffOnly: false, error: 'local did not finish within the 60s cap.', reason: 'deadline-timeout' },
        { diffOnly: false, error: 'local returned HTTP 500', reason: null },
      ],
    }],
    { runsPerCase: 2, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'failed'), '2 (1 timed out)');
});

test('a failure that never said why is not counted as a timeout', async () => {
  // Absent evidence is not evidence of the other branch. A run that died before
  // the envelope could be written has `reason: null`, and guessing "probably a
  // timeout" from the message text is the class this whole field replaced.
  const report = renderReport(
    [{ caseDef: CASE, runs: [{ diffOnly: false, error: 'lmstudio timed out, probably', reason: null }] }],
    { runsPerCase: 1, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'failed'), '1');
});

test('a generation window too short to have been measured reports no rate', async () => {
  // `> 0` was not a sufficient guard. `timings()` rounds to whole milliseconds,
  // so a server that buffers its SSE output and flushes the reply in one write
  // produces a 1ms window — ±50% quantisation — and the quotient renders as a
  // five-digit measurement, arriving in the bench as the *upper endpoint* of the
  // range with no coverage suffix to warn anyone. Found by the code review.
  const report = renderReport(
    [{ caseDef: CASE, runs: [ratedRun(7, 1)] }],
    { runsPerCase: 1, provider: 'local', model: 'test-model' },
  );

  assert.equal(cell(report, 'gen tok/s'), '—');
});
