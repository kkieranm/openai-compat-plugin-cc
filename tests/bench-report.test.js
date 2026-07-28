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

test('the control case is not reported as a recall failure', () => {
  const control = { ...CASE, id: 'clean', defects: [], control: true, dropped: [] };
  const report = renderReport([{ caseDef: control, runs: [goodRun()] }], {
    runsPerCase: 1, model: 'm', provider: 'p', diffOnly: false,
  });

  assert.match(report, /— \(control\)/, 'zero defects found out of zero is not 0%');
});
