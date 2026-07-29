// What the benchmark's summary table claims about its own runs.
//
// These exist because a review found a run that fell out of every bucket at
// once — not scored, not cut, not failed — while still counting toward the run
// total, so a row asserted full accounting over runs it had silently dropped.
// The repo's signature class, in the artifact whose whole job is to be quoted
// as evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../bench/lib/report.mjs';
import { caseRows } from '../bench/lib/case-rows.mjs';
import { CASE, cell, goodRun } from './bench-report-fixtures.mjs';

/**
 * A reply that arrived, exited 0, and never parsed — the degraded rung's
 * expected failure, where the schema is only a prompt instruction. `parsed` is
 * false and the parse-derived flags are null, which is what `jsonReport`
 * genuinely emits: "not determined", not "did not happen".
 */
function unreadableRun() {
  return {
    diffOnly: false,
    report: {
      parsed: false,
      findings: null,
      raw: 'I could not comply.',
      analysisCut: null,
      atCap: null,
      finishReason: 'stop',
      usage: { prompt_tokens: 10 },
      durationMs: 1000,
    },
  };
}

const render = (runs, options = {}) =>
  renderReport([{ caseDef: CASE, runs }], { runsPerCase: runs.length, model: 'm', provider: 'p', diffOnly: false, ...options });

test('a run that answered unreadably is counted, not silently dropped', () => {
  const report = render([goodRun(), unreadableRun()]);

  // The row must not read as two clean runs. Before this, `scored` was invisible
  // and the row printed "cut 0/2, failed 0" for a recall computed over one run.
  assert.match(report, /1\/2/, 'the row must show how many runs were actually scored');
  assert.match(report, /answered but could not be read/, 'and the caveat must name the gap');
});

test('a cut run\'s findings count, and its silence is reported beside them', () => {
  // A guillotined reply parses — complete JSON, empty findings — so it arrives
  // with a score attached. Two wrong readings of it, and this pins the third:
  // counting the empty findings as "found nothing" charges the reviewer for a
  // run the cap stopped, while discarding the run outright throws away the
  // findings it did emit (17 of 41 recorded runs, and two real matches). The
  // positives count; the absences are unknown and become the gap.
  const cut = {
    diffOnly: false,
    report: { parsed: true, findings: [], analysisCut: true, finishReason: 'stop', usage: {}, durationMs: 1 },
    score: { matched: [], unmatched: [], byDefect: [{ id: 'the-defect', found: false, via: null }], recall: { total: 1, found: 0, anchored: 0, ranged: 0 } },
  };
  const report = render([cut]);

  assert.equal(cell(report, 'defects found'), '0/1 (0%)', 'the found column reports only what was observed');
  assert.equal(cell(report, 'unresolved'), '1', 'and the silence is carried beside it, not inside it');
  assert.match(report, /their findings ARE counted above/, 'the caveat must say which reading applies');
  assert.match(report, /between 0% and 100%/, 'and must state the bound rather than printing it as a result');
  assert.doesNotMatch(report, /0–1\/1/, 'an unobserved figure must never appear under "defects found"');
});

test('with nothing censored, the row is identical to what it always printed', () => {
  // The band is not a new metric — it is the old one when `unresolved` is zero.
  // A change that quietly turned every row into a range would make every past
  // figure in this repo incomparable.
  const report = render([goodRun()]);
  assert.equal(cell(report, 'defects found'), '1/1 (100%)', 'unchanged where nothing was cut');
  assert.equal(cell(report, 'unresolved'), '0');
});

test('recall can never print above 100%, even if a cut run arrives without a score', () => {
  // The high estimate adds a cut run's unreported defects to the numerator, so
  // it stays sound only while every cut run is also a scored one. bench/run.mjs
  // guarantees that today by attaching a score to every parsed reply — this
  // pins the guarantee where the arithmetic depends on it, rather than where it
  // happens to be produced.
  const scoreless = {
    diffOnly: false,
    report: { parsed: true, findings: [], analysisCut: true, finishReason: 'stop', usage: {}, durationMs: 1 },
  };
  const report = render([scoreless]);
  const found = cell(report, 'defects found');
  assert.doesNotMatch(found, /1\/0|[2-9]\d\d%/, `a scoreless run must not inflate recall: ${found}`);
  assert.equal(cell(report, 'unresolved'), '0', 'nor contribute unresolved opportunities it has no denominator for');

  // And it must still land in a bucket. Testing `parsed !== true` described one
  // known way to produce nothing scoreable, so this run — parsed, unscored —
  // belonged to none of them while counting toward the run total.
  const [scored, total] = cell(report, 'scored').split(/[/(]/).map((part) => Number(part.trim()));
  const bucket = (name) => Number(cell(report, name));
  assert.equal(
    scored + bucket('truncated') + bucket('unreadable') + bucket('failed'),
    total,
    'a run that fits no bucket is how a denominator silently shrinks',
  );
});

test('every run lands in exactly one bucket, so the row accounts for itself', () => {
  const cut = {
    diffOnly: false,
    report: { parsed: true, findings: [], analysisCut: true, finishReason: 'stop', usage: {}, durationMs: 1 },
    score: { matched: [], unmatched: [], byDefect: [], recall: { total: 1, found: 0, anchored: 0, ranged: 0 } },
  };
  const failed = { diffOnly: false, error: 'the server refused' };
  const runs = [goodRun(), unreadableRun(), cut, failed];
  const report = render(runs);

  // Pull the row's own numbers back out and check they reconcile. A table whose
  // buckets do not sum to its run count is the defect this guards.
  const row = report.split('\n').find((line) => line.startsWith('| `sample`'));
  assert.ok(row, 'the case row must be rendered');
  const cells = row.split('|').map((cell) => cell.trim());
  // `scored` now carries its cut sub-count in parentheses — those runs ARE
  // scored, so they must not also occupy a bucket of their own. The exclusive
  // partition is scored / truncated / unreadable / failed.
  const [scored, total] = cell(report, 'scored').split(/[/(]/).map((part) => Number(part.trim()));
  const bucket = (name) => Number(cell(report, name));
  assert.equal(total, runs.length);
  assert.equal(
    scored + bucket('truncated') + bucket('unreadable') + bucket('failed'),
    total,
    `buckets must sum to runs: ${row}`,
  );
  assert.match(cell(report, 'scored'), /\(1 cut\)/, 'and the cut count rides inside the scored cell');
});

test('a failed run reports what happened, not the advice that followed it', () => {
  // The companion writes a UserError's message and its hint as separate stderr
  // lines. Recording only the last one showed "Raise --max-tokens" as the reason
  // a run failed while "ran out of tokens" — the actual fact — was discarded.
  const stderr = 'Reviewing commit HEAD with m on p...\nran out of tokens before it finished\nRaise --max-tokens, or review a smaller target';
  const report = render([{ diffOnly: false, error: stderr }]);

  assert.match(report, /ran out of tokens before it finished/, 'the cause must survive into the report');
  assert.match(report, /Raise --max-tokens/, 'the remedy may be shown too — but not instead');
});

/** A run that answered, parsed and scored — with its two timing halves reported. */
function measuredRun() {
  const run = goodRun();
  return { ...run, report: { ...run.report, prefillMs: 4_000, generationMs: 2_000, usage: { prompt_tokens: 10, completion_tokens: 20 } } };
}

/**
 * The run that carries a complete report AND a failure at once — the first that
 * can. It parsed, it scored, it was timed accurately, on the WRONG MODEL.
 *
 * Its figures are deliberately unmistakable, and it keeps the score `goodRun`
 * gave it on purpose: `bench/run.mjs` declines to score a substituted run, but
 * `case-rows.mjs` re-imposes the same exclusion rather than trusting that, and a
 * fixture built to run.mjs's output alone would exercise neither guard.
 */
function substitutedRun() {
  const run = goodRun();
  return {
    ...run,
    report: {
      ...run.report,
      requestedModel: 'asked-for',
      model: 'answered-instead',
      prefillMs: 999_999,
      generationMs: 888_888,
      usage: { prompt_tokens: 777_777, completion_tokens: 555_555 },
    },
    error: 'Asked for "asked-for" but answered-instead answered; the server substituted a model.',
    reason: 'model-substituted',
  };
}

test('a substituted run is named inside the failed cell, beside any other reason', () => {
  assert.equal(cell(render([measuredRun(), substitutedRun()]), 'failed'), '1 (1 substituted)');

  // Both kinds in one case: a cell that could name only one would silently drop
  // the other from view while still counting it in `failed`.
  const both = render([
    { diffOnly: false, error: 'local did not finish within the 60s cap.', reason: 'deadline-timeout' },
    substitutedRun(),
  ]);
  assert.equal(cell(both, 'failed'), '2 (1 timed out, 1 substituted)');
});

test('a substituted run contributes no timing, rate or prompt-size sample', () => {
  // The assumption the `{ report, error }` combination broke. Gating on the
  // report alone let a perfectly good measurement of a DIFFERENT model into a
  // row whose failed cell disowned it — throughput printed for a model the same
  // row said had not run.
  const report = render([measuredRun(), substitutedRun()]);

  // Asserted as the exact cell, not as the absence of the raw figures: the
  // timing cells divide by 1000 and round, so `999999` never appears as a string
  // whether it leaked or not, and a doesNotMatch on it would pass either way.
  // A leak shows up as a second endpoint, and a leak into the denominator alone
  // shows up as a `(1/2 measured)` suffix — both caught here.
  // The `(1/2 measured)` suffix is the point, not noise. A substituted run
  // COMPLETED — it answered and was timed — so it counts in the coverage
  // denominator even though its value is excluded. Dropping it from both would
  // make `measured === completed`, print no suffix at all, and let a range over
  // one of two completed runs read as fully measured. Raised at 0.94 confidence
  // by the adversarial review, and it was right.
  assert.equal(cell(report, 'prefill s'), '4–4 (1/2 measured)');
  assert.equal(cell(report, 'generate s'), '2–2 (1/2 measured)');
  assert.equal(cell(report, 'gen tok/s'), '10.0 (1/2 measured)');
  // `tokenCell` prints its values unformatted, so here the raw check is real —
  // and it carries the same coverage suffix as its neighbours, for the same
  // reason: a prompt size is counted by the tokenizer of the model that
  // answered, so it is emphatically not model-independent.
  assert.equal(cell(report, 'prompt tokens'), '10 (1/2 measured)');
  assert.doesNotMatch(report, /777777/, "the substituted run's prompt is not this row's prompt");
});

test('a substituted run still lands in exactly one bucket', () => {
  // It carries a score, so it is the one run that could be counted twice —
  // once as scored and once as failed — which would break the row's arithmetic
  // in the direction that looks like more evidence than there was.
  const runs = [measuredRun(), substitutedRun()];
  const [row] = caseRows([{ caseDef: CASE, runs }]);

  assert.equal(row.scored, 1, 'a reply from another model is not a scored run of this one');
  assert.equal(row.substituted, 1);
  assert.equal(row.scored + row.truncated + row.unreadable + row.failed, row.runs, `buckets must sum to runs: ${JSON.stringify(row)}`);
});

test('a substituted run is filed as answered by another model, not as one that did not complete', () => {
  const report = render([measuredRun(), substitutedRun()]);

  assert.doesNotMatch(report, /Runs that did not complete/, 'it completed — what failed was the attribution');
  assert.match(report, /## Runs answered by a different model/);
  assert.match(report, /asked for `asked-for`, `answered-instead` answered/, 'both ids, or the section names no model at all');
});

test('the control case is not reported as a recall failure', () => {
  const control = { ...CASE, id: 'clean', defects: [], control: true, dropped: [] };
  const report = renderReport([{ caseDef: control, runs: [goodRun()] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false,
  });

  assert.match(report, /— \(control\)/, 'zero defects found out of zero is not 0%');
});

