import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFindings } from '../plugins/oai/scripts/lib/review.mjs';
import { completion, modelList, respondJson, reviewScenario, runCompanion } from './helpers.mjs';

// A multi-pass union ORs the caveat flags across passes whose requests can differ,
// so on a union the salvaged, cut-off, findings-limit and hunks-only caveats state
// only what held in at least one pass. Single-pass wording is the reference the
// union variants are measured against.

const render = (flags) =>
  renderFindings({ findings: [], ...flags }, { label: 'working tree', profile: { name: 'local' }, model: 'test-model' });

const CAVEATS = {
  salvaged: {
    single: /WARNING: this review was SALVAGED\. The model's reply held reasoning but no answer; these findings/,
    union: /WARNING: at least one pass of this review was SALVAGED: its reply held reasoning but no answer, so its findings/,
    severity: /Treat this result as less reliable than an ordinary review\./,
  },
  analysisCut: {
    single: /WARNING: the model was still reasoning when it hit its length limit, so it never finished looking\./,
    union: /WARNING: in at least one pass the model was still reasoning when it hit its length limit, so that pass never finished looking\./,
    severity: /Treat this result as incomplete — especially an empty one\./,
  },
  atCap: {
    single: /\(The findings list hit its limit of \d+, so there may be more\./,
    union: /\(In at least one pass the findings list hit its limit of \d+, so there may be more\./,
  },
  hunksOnly: {
    single: /NOTE: the model saw only the diff hunks for the diff-covered changed files/,
    union: /NOTE: in at least one pass, the model saw only the diff hunks for the diff-covered changed files/,
  },
};

test('on a multi-pass union the salvaged, cut-off, findings-limit and hunks-only caveats claim only at least one pass, keeping their severity', () => {
  for (const [flag, wording] of Object.entries(CAVEATS)) {
    const text = render({ [flag]: true, multiPass: true });
    assert.match(text, wording.union, flag);
    assert.doesNotMatch(text, wording.single, `${flag}: the categorical single-pass sentence is gone`);
    if (wording.severity) assert.match(text, wording.severity, `${flag}: the severity stays categorical`);
  }
});

test('a single pass keeps the categorical wording of each caveat', () => {
  for (const [flag, wording] of Object.entries(CAVEATS)) {
    const text = render({ [flag]: true });
    assert.match(text, wording.single, flag);
    assert.doesNotMatch(text, wording.union, flag);
    if (wording.severity) assert.match(text, wording.severity, flag);
  }
});

test('a salvaged result says the reserve cut was the review request\'s, without claiming the answer\'s room', () => {
  const salvaged = render({ salvaged: true, conservativeReserveCut: true });
  assert.match(salvaged, /NOTE: the review request's reply budget was reduced/);
  assert.doesNotMatch(salvaged, /less room to reason and answer/);
  const union = render({ salvaged: true, conservativeReserveCut: true, multiPass: true });
  assert.match(union, /NOTE: in at least one pass, the review request's reply budget was reduced/);
  const ordinary = render({ conservativeReserveCut: true });
  assert.match(ordinary, /NOTE: the reply budget was reduced .* less room to reason and answer\./s);
});

test('a reply that could not be parsed still says the model saw only the diff hunks', async () => {
  const { dir, server, configPath } = await reviewScenario((request, response) => {
    if (request.url.includes('/models')) return respondJson(response, modelList('test-model'));
    return respondJson(response, completion('I had a look and I am not sure.'));
  });
  const result = await runCompanion(['review', '--diff-only'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /did not return findings in the requested shape/);
  assert.match(result.stdout, CAVEATS.hunksOnly.single);
});
