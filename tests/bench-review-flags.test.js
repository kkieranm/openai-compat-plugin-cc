// The command line `bench` builds for one run (OAI-117).
//
// `bench/run.mjs` drives the real CLI, so what it does or does not put on that
// command line IS the experiment. `--structured-output` was absent from `SPEC`
// for as long as it was precisely because nothing could reach `reviewFlags`.
//
// Writing this file found a second defect and it is worth recording where the
// evidence is: `main()` was called UNCONDITIONALLY at module scope, so the first
// import of this module from `tests/` ran a whole six-case benchmark and wrote a
// report and a record into `bench/results/`. It was fixed with the
// `process.argv[1]` guard `review-sweep.mjs:291` already had. The claim that the
// guard existed was one I made before checking — the check is what disproved it.
//
// Each assertion here has a NEGATIVE twin. A test that only checks a flag appears
// when asked for cannot distinguish "forwarded correctly" from "always on", which
// is the failure mode that would silently invalidate every unconstrained arm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewFlags } from '../bench/run.mjs';

const CASE = { id: 'demo', mode: 'commit' };
const ARGS = ['--commit', 'abc123'];
const build = (options, extra = {}) => reviewFlags(ARGS, CASE, options, { diffOnly: false, runIndex: 0, ...extra });

test('--structured-output reaches the CLI when asked for', () => {
  assert.ok(build({ 'structured-output': true }).includes('--structured-output'));
});

test('--structured-output is ABSENT by default', () => {
  // The control. ADR 003: the unconstrained path is the deliberate default,
  // because a schema is a crash on this backend rather than a formatting choice.
  // If this ever passes vacuously, every arm in the corpus is a schema arm.
  assert.ok(!build({}).includes('--structured-output'));
  assert.ok(!build({ 'structured-output': false }).includes('--structured-output'));
});

test('the review subcommand and --json envelope are always present', () => {
  // Guards the seam itself: a refactor that reorders or drops these turns every
  // run into an unparseable one, and the benchmark reads results from --json.
  const flags = build({});
  assert.equal(flags[0], 'review');
  assert.ok(flags.includes('--json'));
  for (const arg of ARGS) assert.ok(flags.includes(arg));
});

test('--diff-only is forwarded from the caller, not from options', () => {
  // diffOnly is decided upstream (a `file` case has no diff to reduce), so it
  // arrives as a parameter rather than a flag — the negative twin proves this
  // test would notice if the two were wired together by mistake.
  assert.ok(build({}, { diffOnly: true }).includes('--diff-only'));
  assert.ok(!build({ 'diff-only': true }).includes('--diff-only'));
});

test('--cold mints a cache-buster unique to the case and run', () => {
  const first = build({ cold: true }, { runIndex: 0 });
  const second = build({ cold: true }, { runIndex: 1 });
  const busterOf = (flags) => flags[flags.indexOf('--cache-buster') + 1];
  assert.ok(first.includes('--cache-buster'));
  assert.notEqual(busterOf(first), busterOf(second));
  assert.ok(!build({}).includes('--cache-buster'));
});
