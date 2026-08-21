// `--json` is the machine-readable view of a review run, and the benchmark
// harness scores what it says. So the thing under test is not "is it JSON" but
// "does it carry every caveat the text report carries" — a caller reading only
// `findings` must not be able to mistake a guillotined run for a clean one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_FINDINGS, analysisCapFor } from '../scripts/lib/review-schema.mjs';
import {
  chatRequests,
  completionFrames,
  createRepo,
  reasoningFrames,
  respondStream,
  reviewScenario as scenario,
  runCompanion,
  sentAnalysisCap,
  startFakeServer,
  writeConfig,
} from './helpers.mjs';

const clean = JSON.stringify({
  analysis: 'read each changed file in full',
  findings: [{ file: 'seed.txt', line: 2, severity: 'high', summary: 'a defect', evidence: 'edited' }],
  summary: 'One defect found.',
});

// The content channel: with no grammar the reasoning channel is scratchpad and
// `requireAnswer` refuses it, and no grammar is what an ordinary review sends now.
const replies = (body, options) => (request, response) => respondStream(response, completionFrames(body, options));

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
  for (const key of [
    'dropped', 'atCap', 'analysisCut', 'hunksOnly', 'unreadable', 'usage', 'finishReason',
    // Added after a review found them missing: the text footer has always shown
    // whether the size guard actually ran, and --json did not, while both this
    // file's docstring and commands/review.md promised it carried every caveat.
    'contextChecked', 'contextNote',
    // The measurement behind analysisCut. Recording only the flag made the
    // ceiling unsizeable: 6 of 15 recorded runs were cut and nothing said how
    // close the other 9 came.
    'analysisLength', 'analysisCap',
    // A cause `hunksOnly` cannot carry: the whole-file rung was skipped because
    // nothing could size the window, not because the files were shed or not
    // asked for. tests/review-unsized-window.test.js owns the behaviour; this
    // pins the key's presence, which is what a harness reads.
    'skippedUnsizedWindow',
  ]) {
    assert.ok(key in report, `--json must report ${key}`);
  }
  assert.equal(report.contextChecked, true, 'this scenario configures a window, so the guard ran');
  assert.equal(report.contextNote, null, 'and there is nothing to warn about');
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
  // Bounding `analysis` makes a truncated review *valid* — complete JSON,
  // finish_reason stop, empty findings — and indistinguishable from a
  // genuinely clean pass without this.
  // Built from the schema the request actually carried, not from a constant.
  // The cap is derived per run now, so this run is cut only if the schema that
  // was sent is the same instance the parser compared the reply against — which
  // makes this the regression guard for that threading.
  const guillotined = (record) => JSON.stringify({
    analysis: 'x'.repeat(sentAnalysisCap(record)),
    findings: [],
    summary: '',
  });
  const { dir, server, configPath } = await scenario(
    (record, response) => respondStream(response, reasoningFrames(guillotined(record))),
    { contextLength: 131_072 },
  );

  const result = await runCompanion(['review', '--structured-output', '--json'], { configPath, cwd: dir });
  const cap = sentAnalysisCap(chatRequests(server)[0]);
  await server.close();

  const report = parseReport(result);
  assert.equal(report.parsed, true);
  assert.deepEqual(report.findings, [], 'the model genuinely reported none');
  assert.equal(report.analysisCut, true, 'but it never finished looking, and the JSON must say so');
  assert.equal(report.analysisLength, cap);
  assert.equal(report.analysisCap, cap);
  assert.equal(cap, analysisCapFor(chatRequests(server)[0].body.max_tokens),
    'the cap sent must be the one the budget on the wire pays for');
});

test('an uncut analysis reports how far short of the cap it stopped', async () => {
  // The other half, and the one the cap can actually be sized from. A run that
  // stopped 100 characters short and one that stopped 27,000 short are both
  // `analysisCut: false`, and choosing a ceiling from that boolean alone is
  // guesswork — which is how the current value came to sit mid-distribution.
  const roomy = JSON.stringify({ analysis: 'y'.repeat(1234), findings: [], summary: '' });
  const { dir, server, configPath } = await scenario(replies(roomy), { contextLength: 131_072 });

  const result = await runCompanion(['review', '--structured-output', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = parseReport(result);
  assert.equal(report.analysisCut, false);
  assert.equal(report.analysisLength, 1234, 'the distance from the ceiling is the measurement');
  assert.ok(report.analysisLength < report.analysisCap);
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

  const result = await runCompanion(['review', '--structured-output', '--json'], { configPath, cwd: dir });
  await server.close();

  const report = parseReport(result);
  assert.equal(report.atCap, true, 'there may be more, and a score must not assume otherwise');
  assert.equal(report.findings.length, MAX_FINDINGS);
});

test('an unarmed size check reaches the JSON, as it always has the text footer', async () => {
  // The caveat that went missing. With no contextLength the guard never runs,
  // so `estimatedTokens` is an unverified guess — and a caller reading only the
  // JSON had no way to tell it from a checked figure. That is the state in
  // which an oversized request goes out unrefused, so it is the worst one to
  // report as if nothing were unusual.
  const dir = await createRepo();
  writeFileSync(join(dir, 'seed.txt'), 'seed\nedited\n');
  const server = await startFakeServer(replies(clean));
  const { path: configPath } = writeConfig({
    defaultProvider: 'local',
    providers: { local: { baseUrl: server.baseUrl, defaultModel: 'test-model' } },
  });

  const json = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  const text = await runCompanion(['review'], { configPath, cwd: dir });
  await server.close();

  const report = parseReport(json);
  assert.equal(report.contextChecked, false, 'no window was configured, so nothing was checked');
  assert.match(report.contextNote, /Context window unknown/);
  assert.match(text.stdout, /Context window unknown/, 'and the text report says the same thing');
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
  // "length", not the helpers' default "stop": the budget ran out mid-object,
  // which is the whole point of the case.
  const truncated = replies('{"analysis": "half a th', { finishReason: 'length' });

  const { dir, server, configPath } = await scenario(truncated, { contextLength: 131_072 });
  const result = await runCompanion(['review', '--json'], { configPath, cwd: dir });
  await server.close();

  assert.equal(result.status, 1, 'a run that ran out of tokens is not a reportable result');
  assert.match(result.stderr, /ran out of tokens/);

  // Stdout is no longer empty here — `--json` is machine-readable on the
  // failure path too — so the invariant is asserted directly rather than via
  // emptiness: whatever is printed must be unmistakably *not* a report. A caller keying on
  // `findings` or `parsed` must find neither, so a budget failure can never be
  // read as a finished run that found nothing.
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.error, true);
  assert.equal('findings' in envelope, false);
  assert.equal('parsed' in envelope, false);
  assert.match(envelope.message, /ran out of tokens/);
});
