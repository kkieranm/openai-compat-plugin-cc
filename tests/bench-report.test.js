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

test('a cut run is excluded from recall, not entered into it as a zero', () => {
  // A guillotined reply parses — complete JSON, empty findings — so it arrives
  // with a score attached. Counting that as "found nothing" charges the
  // reviewer for a run the token budget stopped. The fixture therefore carries
  // a score, exactly as bench/run.mjs would attach one.
  const cut = {
    diffOnly: false,
    report: { parsed: true, findings: [], analysisCut: true, finishReason: 'stop', usage: {}, durationMs: 1 },
    score: { matched: [], unmatched: [], byDefect: [{ id: 'the-defect', found: false, via: null }], recall: { total: 1, found: 0, anchored: 0, ranged: 0 } },
  };
  const report = render([cut]);

  assert.match(report, /0\/0 \(n\/a\)/, 'nothing was scoreable, which is not the same as nothing found');
  assert.doesNotMatch(report, /0\/1 \(0%\)/, 'a cut run must not appear as a defect the reviewer missed');
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
  const [scored, total] = cells[5].split('/').map(Number);
  const [cutCount, unreadable, failedCount] = [Number(cells[6]), Number(cells[7]), Number(cells[8])];
  assert.equal(total, runs.length);
  assert.equal(scored + cutCount + unreadable + failedCount, total, `buckets must sum to runs: ${row}`);
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
