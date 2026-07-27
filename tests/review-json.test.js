// `--json` is the machine-readable view of a review run, and the benchmark
// harness scores what it says. So the thing under test is not "is it JSON" but
// "does it carry every caveat the text report carries" — a caller reading only
// `findings` must not be able to mistake a guillotined run for a clean one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FINDINGS, REVIEW_SCHEMA } from '../scripts/lib/structured.mjs';
import { reasoningCompletion, respondJson, reviewScenario as scenario, runCompanion } from './helpers.mjs';

const clean = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' }],
  summary: 'One defect found.',
});

const replies = (body, extra) => (request, response) => respondJson(response, reasoningCompletion(body, extra));

/** The single JSON object `--json` promises on stdout. */
function parseReport(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('--json emits one object carrying the findings and every caveat field', async () => {
  const { dir, server, configPath } = await scenario(replies(clean), { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = parseReport(result);
  assert.equal(report.parsed, true);
  assert.deepEqual(report.findings, [
    { file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' },
  ]);
  assert.equal(report.summary, 'One defect found.');
  // Present, not merely truthy: the harness reads each of these, and a missing
  // key reads as `undefined`, which is falsy and therefore silently reassuring.
  for (const key of ['dropped', 'atCap', 'analysisCut', 'hunksOnly', 'unreadable', 'usage', 'finishReason']) {
    assert.ok(key in report, `--json must report ${key}`);
  }
  assert.equal(report.provider, 'local');
  assert.ok(report.estimatedTokens > 0, 'the input size actually sent');
  assert.ok(report.durationMs >= 0);
});

test('an unreadable reply is parsed:false with the raw text, never an empty findings list', async () => {
  // The distinction the whole flag rests on. `findings: []` would score as a
  // clean review; this run found nothing because nothing could be read.
  const { dir, server, configPath } = await scenario(replies('I could not comply.'), { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = parseReport(result);
  assert.equal(report.parsed, false);
  assert.equal(report.findings, null, 'null, not [] — an empty list is a clean review');
  assert.match(report.raw, /could not comply/);
  // Undetermined, not "did not happen": nobody counted a list, so nothing can
  // be said about whether it hit the cap.
  assert.equal(report.atCap, null);
  assert.equal(report.analysisCut, null);
});

test('a cut analysis reaches the JSON, so a guillotined run cannot score as clean', async () => {
  // Trap instance 14 in machine-readable form: bounding `analysis` makes a
  // truncated review *valid* — complete JSON, finish_reason stop, empty
  // findings — and indistinguishable from a genuinely clean pass without this.
  const guillotined = JSON.stringify({
    analysis: 'x'.repeat(REVIEW_SCHEMA.properties.analysis.maxLength),
    findings: [],
    summary: '',
  });
  const { dir, server, configPath } = await scenario(replies(guillotined), { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = parseReport(result);
  assert.equal(report.parsed, true);
  assert.deepEqual(report.findings, [], 'the model genuinely reported none');
  assert.equal(report.analysisCut, true, 'but it never finished looking, and the JSON must say so');
});

test('a findings list at the cap is flagged in the JSON too', async () => {
  const full = JSON.stringify({
    analysis: 'a',
    findings: Array.from({ length: MAX_FINDINGS }, (unused, index) => ({
      file: 'seed.txt',
      line: index + 1,
      severity: 'low',
      summary: `finding ${index}`,
      evidence: 'edited',
    })),
    summary: 'many',
  });
  const { dir, server, configPath } = await scenario(replies(full), { contextLength: 131_072 });

  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = parseReport(result);
  assert.equal(report.atCap, true, 'there may be more, and a score must not assume otherwise');
  assert.equal(report.findings.length, MAX_FINDINGS);
});

test('the JSON and the text report agree about the same run', async () => {
  // The reason both views live side by side in review-report.mjs. This is the
  // drift that would otherwise go unnoticed: the text caveat is reworded or
  // moved, and the JSON quietly keeps saying something else about the same run.
  const big = { contextLength: 16_000, seed: `seed\n${'x'.repeat(29_000)}\n` };

  const first = await scenario(replies(clean), big);
  const text = await runCompanion(['review'], { configPath: first.configPath, cwd: first.dir });
  await first.server.close();

  const second = await scenario(replies(clean), big);
  const json = await runCompanion(['review', '--json'], { configPath: second.configPath, cwd: second.dir });
  await second.server.close();

  const report = parseReport(json);
  assert.equal(report.hunksOnly, true, 'the whole files did not fit');
  assert.match(text.stdout, /only the diff hunks/, 'and the text report says the same thing');
});

test('--json refuses a truncated reply exactly as the text report does', async () => {
  // One set of rules for "is this run reportable at all". Emitting a cheerful
  // object for a reply we cut off mid-object would let the harness record a
  // budget failure as a finished run that found nothing.
  // The helpers default to finish_reason "stop", and "stop" is precisely what
  // this case is not, so the reply is built here.
  const truncated = (request, response) =>
    respondJson(response, {
      id: 'chatcmpl-test',
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '', reasoning_content: '{"analysis": "half a th' },
          finish_reason: 'length',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 16_384 },
    });

  const { dir, server, configPath } = await scenario(truncated, { contextLength: 131_072 });
  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1, 'a run that ran out of tokens is not a reportable result');
  assert.match(result.stderr, /ran out of tokens/);
  assert.equal(result.stdout.trim(), '', 'and nothing that looks like a report is printed');
});
