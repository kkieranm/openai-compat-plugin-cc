// A benchmark run whose reply named the provider's declared served id for the
// requested model. It is scored as the requested model — the declaration says
// the server reports that model under another id — and the report says which
// pairing it took on the operator's word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeFor } from '../bench/lib/outcome.mjs';
import { renderReport } from '../bench/lib/report.mjs';
import { caseRows } from '../bench/lib/case-rows.mjs';
import { CASE, goodRun } from './bench-report-fixtures.mjs';

const REQUESTED = 'lmstudio-community/Qwen3.8-27B-MLX-4bit';
const SERVED = 'Qwen3.8-27B-MLX-4bit';
const NOTE = /Accepted through a declared served id: `lmstudio-community\/Qwen3\.8-27B-MLX-4bit` answered as `Qwen3\.8-27B-MLX-4bit`/;

const reviewStdout = (declaredServedModel) =>
  JSON.stringify({ parsed: true, findings: [], requestedModel: REQUESTED, model: SERVED, declaredServedModel });

/** A scored run whose report carries the pair, and the declaration when given. */
function declaredRun(declaredServedModel) {
  const run = goodRun();
  return { ...run, report: { ...run.report, requestedModel: REQUESTED, model: SERVED, declaredServedModel } };
}

const render = (runs) =>
  renderReport([{ caseDef: CASE, runs }], { runsPerCase: runs.length, model: REQUESTED, provider: 'unsloth', diffOnly: false });

test('a run answered under the declared id is an outcome, not a substitution', () => {
  const outcome = outcomeFor(reviewStdout(SERVED), false);
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.reason, undefined);
  assert.equal(outcome.report.declaredServedModel, SERVED);
});

test('without the declaration the same run is excluded as model-substituted', () => {
  assert.equal(outcomeFor(reviewStdout(null), false).reason, 'model-substituted');
  assert.equal(outcomeFor(JSON.stringify({ parsed: true, requestedModel: REQUESTED, model: SERVED }), false).reason, 'model-substituted');
});

test('a declared id that does not match the reply does not rescue it', () => {
  assert.equal(outcomeFor(reviewStdout('some-other-id'), false).reason, 'model-substituted');
});

test('a scored run that relied on a declaration is scored, and the report names the pairing once', () => {
  const runs = [declaredRun(SERVED), declaredRun(SERVED)];
  const [row] = caseRows([{ caseDef: CASE, runs }]);
  assert.equal(row.scored, 2);

  const report = render(runs);
  assert.match(report, NOTE);
  assert.match(report, /operator assertion/);
  assert.equal(report.match(new RegExp(NOTE.source, 'g')).length, 1, 'one note, however many runs relied on it');
});

test('no note when no scored run relied on a declaration', () => {
  // An exact match carries the declaration but never needed it.
  const exact = goodRun();
  exact.report = { ...exact.report, requestedModel: SERVED, model: SERVED, declaredServedModel: SERVED };
  assert.doesNotMatch(render([exact]), /declared served id/);
  assert.doesNotMatch(render([goodRun()]), /declared served id/);
  // A run that relied on one but did not score is not credited to the row.
  const failed = { ...declaredRun(SERVED), error: 'cap', reason: 'deadline-timeout' };
  assert.doesNotMatch(render([goodRun(), failed]), /declared served id/);
});

test('a multi-pass union of an exact pass and a declared pass names the pairing in either order', () => {
  const exactPass = { requestedModel: REQUESTED, model: REQUESTED, declaredServedModel: SERVED };
  const declaredPass = { requestedModel: REQUESTED, model: SERVED, declaredServedModel: SERVED };
  for (const passes of [[exactPass, declaredPass], [declaredPass, exactPass]]) {
    // The top-level ids are the first readable pass's.
    const run = goodRun();
    run.report = { ...run.report, kind: 'multi-pass-review', ...passes[0], passes };
    assert.match(render([run]), NOTE, `pass order: ${passes.map((pass) => pass.model).join(', ')}`);
  }
});

test('an unreadable pass under the declared id is not named: no scored result relied on it', () => {
  const exactPass = { requestedModel: REQUESTED, model: REQUESTED, declaredServedModel: SERVED };
  const unreadable = { ok: false, requestedModel: REQUESTED, model: SERVED, declaredServedModel: SERVED };
  const run = goodRun();
  run.report = { ...run.report, kind: 'multi-pass-review', ...exactPass, passes: [exactPass, exactPass, unreadable] };
  assert.doesNotMatch(render([run]), NOTE);
});
