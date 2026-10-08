// Whether the benchmark's schema arm kept its schema in force.
//
// `--structured-output` is a REQUEST. An answer can end up unconstrained — the
// server rejects `response_format`, or a salvage follow-up (which never sends
// `response_format`) produces it — and the CLI reports that as `degraded`, the
// pair `cmd-review.mjs` documents as what distinguishes "asked for a schema and
// got an unstructured reply" from "never wanted a schema". The benchmark must
// read `degraded`, not only the flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../bench/lib/report.mjs';
import { CASE, goodRun } from './bench-report-fixtures.mjs';

const render = (runs, options = {}) =>
  renderReport([{ caseDef: CASE, runs }], { runsPerCase: runs.length, model: 'm', provider: 'p', diffOnly: false, ...options });

// Each gate on the note has a NEGATIVE TWIN, and the twins are the point: a note
// that appears whenever the flag is set is exactly the defect being fixed, so a
// test that only checks "the note appears" cannot tell the fix from the bug.
const degradedRun = (degraded) => ({
  ...goodRun(),
  report: { ...goodRun().report, degraded },
});

test('the schema arm says so when EVERY run degraded', () => {
  const report = render([degradedRun(true), degradedRun(true)], { 'structured-output': true, structuredOutput: true });
  assert.match(report, /NO ANSWERED RUN IN THIS ARM KEPT THE SCHEMA IN FORCE THROUGHOUT/, 'a wholly degraded arm must say so unmissably');
  assert.match(report, /2 of 2/, 'and quote the count it is claiming');
  assert.match(report, /do not isolate what keeping the schema in force changes/, 'and say what that does to the comparison');
});

test('a PARTLY degraded arm is distinguished from a wholly degraded one', () => {
  // Two runs per case — an under-tested configuration, and the one where a
  // per-run count differs from a boolean at all.
  const report = render([degradedRun(true), degradedRun(false)], { structuredOutput: true });
  assert.match(report, /Some answered runs in this arm did not keep the schema in force throughout/, 'a mixed arm is not the same claim as a dead one');
  assert.match(report, /1 of 2/);
  assert.match(report, /refused `response_format`, or a salvage follow-up/, 'both causes, not only a refusal');
  assert.match(report, /at least one answer was produced without it/, 'a run counts when any one of its answers did');
  assert.doesNotMatch(report, /NO ANSWERED RUN IN THIS ARM KEPT/, 'and must not overstate itself');
});

test('THE NEGATIVE TWIN: no degrade note when the schema was actually obtained', () => {
  // The assertion that makes the tests above mean something. If this ever fails,
  // the note is gated on the flag again and the whole fix is undone.
  const report = render([degradedRun(false), degradedRun(false)], { structuredOutput: true });
  assert.doesNotMatch(report, /KEPT THE SCHEMA IN FORCE|did not keep the schema in force/);
  assert.match(report, /--structured-output` was on/, 'while the ordinary schema caveat still prints');
});

test('THE SECOND NEGATIVE TWIN: a degraded run says nothing when no schema was asked for', () => {
  // `degraded` is defined as "asked for, and not obtained", so it cannot be true
  // without the flag — but the benchmark must not print a schema caveat for an
  // unconstrained arm even if a stale field said otherwise.
  const report = render([degradedRun(true), degradedRun(true)]);
  assert.doesNotMatch(report, /KEPT THE SCHEMA IN FORCE|did not keep the schema in force|--structured-output` was on/);
});
