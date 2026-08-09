// Whether the benchmark's schema arm actually measured a schema (OAI-135 item 4).
//
// `--structured-output` is a REQUEST. `review-request.mjs` falls back to the
// unconstrained path when a server rejects `response_format`, and the CLI has
// always reported that as `degraded` — the pair `cmd-review.mjs` documents as
// what distinguishes "fell back after a refusal" from "never wanted a schema".
// The benchmark read only the flag, so an arm that degraded on every request was
// captioned as a schema arm and compared against an unconstrained one: the same
// measurement under two names, while the report's own text instructs the reader
// to read one against the other.
//
// Its own file rather than an addition to bench-report.test.js, which the size
// ratchet refused — correctly: that file was at its budget and this is a
// separable subject.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../bench/lib/report.mjs';
import { CASE, goodRun } from './bench-report-fixtures.mjs';

const render = (runs, options = {}) =>
  renderReport([{ caseDef: CASE, runs }], { runsPerCase: runs.length, model: 'm', provider: 'p', diffOnly: false, ...options });

// EVERY assertion here has a NEGATIVE TWIN, and the twins are the point: a note
// that appears whenever the flag is set is exactly the defect being fixed, so a
// test that only checks "the note appears" cannot tell the fix from the bug.
const degradedRun = (degraded) => ({
  ...goodRun(),
  report: { ...goodRun().report, degraded },
});

test('the schema arm says so when the server refused the schema on EVERY run', () => {
  const report = render([degradedRun(true), degradedRun(true)], { 'structured-output': true, structuredOutput: true });
  assert.match(report, /THIS ARM DID NOT MEASURE A SCHEMA/, 'a wholly degraded arm must say so unmissably');
  assert.match(report, /2 of 2/, 'and quote the count it is claiming');
  assert.match(report, /compares one measurement with itself/, 'and say what that does to the comparison');
});

test('a PARTLY degraded arm is distinguished from a wholly degraded one', () => {
  // Two runs per case — the configuration OAI-135 records as untested, and the
  // one where a per-run count differs from a boolean at all.
  const report = render([degradedRun(true), degradedRun(false)], { structuredOutput: true });
  assert.match(report, /only partly measured a schema/, 'a mixed arm is not the same claim as a dead one');
  assert.match(report, /1 of 2/);
  assert.doesNotMatch(report, /THIS ARM DID NOT MEASURE A SCHEMA/, 'and must not overstate itself');
});

test('THE NEGATIVE TWIN: no degrade note when the schema was actually obtained', () => {
  // The assertion that makes the three above mean something. If this ever fails,
  // the note is gated on the flag again and the whole fix is undone.
  const report = render([degradedRun(false), degradedRun(false)], { structuredOutput: true });
  assert.doesNotMatch(report, /DID NOT MEASURE A SCHEMA|partly measured a schema/);
  assert.match(report, /--structured-output` was on/, 'while the ordinary schema caveat still prints');
});

test('THE SECOND NEGATIVE TWIN: a degraded run says nothing when no schema was asked for', () => {
  // `degraded` is defined as "asked for, and not obtained", so it cannot be true
  // without the flag — but the benchmark must not print a schema caveat for an
  // unconstrained arm even if a stale field said otherwise.
  const report = render([degradedRun(true), degradedRun(true)]);
  assert.doesNotMatch(report, /DID NOT MEASURE A SCHEMA|partly measured a schema|--structured-output` was on/);
});
