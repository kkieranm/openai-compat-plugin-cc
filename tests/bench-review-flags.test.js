// The command line `bench` builds for one run.
//
// `bench/run.mjs` drives the real CLI, so what it does or does not put on that
// command line IS the experiment. `--structured-output` was absent from `SPEC`
// for as long as it was precisely because nothing could reach `reviewFlags`.
//
// `bench/run.mjs`'s `main()` only runs when invoked as the entry script (a
// `process.argv[1]` guard), so importing it from here does not itself trigger
// a benchmark run and write into `bench/results/`.
//
// Each assertion here has a NEGATIVE twin. A test that only checks a flag appears
// when asked for cannot distinguish "forwarded correctly" from "always on", which
// is the failure mode that would silently invalidate every unconstrained arm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reviewFlags } from '../bench/run.mjs';
import { MIN_REVIEW_RESERVE_TOKENS } from '../scripts/lib/review-schema.mjs';

test('importing bench/run.mjs does NOT run the benchmark', async () => {
  // THE GUARD THAT GUARDS THE GUARD (F4), SECOND ATTEMPT — the first one could not fail.
  //
  // It imported the module inside the test body and compared `bench/results/` before and after. But
  // this file already imports `run.mjs` at the top for `reviewFlags`, so the module had executed long
  // before the window opened: with the guard mutated to `if (true)`, the test still passed. An
  // absence assertion whose firing path never runs.
  //
  // A FRESH PROCESS is the only place the question exists. The discriminator is stdout, not artifacts:
  // an unguarded `main()` prints its per-case progress immediately but only persists a report at the
  // END of six cases, so waiting for files means waiting minutes for a signal that arrives in
  // milliseconds.
  // ASYNC spawn, never `spawnSync` — `tests/structure.test.js` forbids the sync forms outright and
  // caught this test's first draft. The ban is a confirmed defect class here: a sync spawn blocks the
  // event loop, so any test that also needs an in-process server deadlocks until the client timeout.
  //
  // THIRD ATTEMPT, and the second one could not fail EITHER — this is the level the defect recurred at.
  // A bare `doesNotMatch` on child output is satisfied by a child that never imported anything: pointing
  // it at `../bench/NOPE-does-not-exist.mjs` left the test GREEN, because a module-not-found error also
  // fails to match. The absence was real and meant nothing.
  //
  // So the child now emits a SENTINEL, and only after the import resolves AND the module is confirmed to
  // export what this file imports. Absence of the progress line is evidence only alongside presence of
  // the sentinel, exit code 0 and no signal. The dead `Reviewing commit` alternative is gone — it
  // appears nowhere in `bench/` and could never have matched.
  // `fileURLToPath`, not `.pathname` — a checkout under a path containing a space yields `%20` in
  // the pathname, `spawn` cannot enter that directory, and the test fails ENOENT **while the guard
  // it tests is correct**. A false red is this ladder's own class inverted: a check that fails for a
  // reason unrelated to what it checks. Latent in this checkout, which is why it took a reviewer.
  const child = spawn(process.execPath, [
    '-e',
    "import('../bench/run.mjs').then((m) => { if (typeof m.reviewFlags !== 'function') "
    + "throw new Error('reviewFlags missing'); console.log('IMPORTED-OK'); })",
  ], { cwd: fileURLToPath(new URL('.', import.meta.url)) });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const [code, signal] = await new Promise((resolve) => child.on('close', (c, s) => resolve([c, s])));
  clearTimeout(timer);
  const tail = `output was:\n${out.slice(0, 400)}`;
  assert.equal(signal, null, `child was killed (${signal}) — it proved nothing. ${tail}`);
  assert.equal(code, 0, `child exited ${code} — it proved nothing. ${tail}`);
  assert.match(out, /IMPORTED-OK/, `the import never completed — the absence below proves nothing. ${tail}`);
  assert.doesNotMatch(out, /run \d+\/\d+/, `main() ran on import — ${tail}`);
});

const CASE = { id: 'demo', mode: 'commit' };
const ARGS = ['--commit', 'abc123'];
const build = (options, extra = {}) => reviewFlags(ARGS, CASE, options, { diffOnly: false, runIndex: 0, ...extra });

test('--structured-output reaches the CLI when asked for', () => {
  assert.ok(build({ 'structured-output': true }).includes('--structured-output'));
});

test('--structured-output is ABSENT by default', () => {
  // The control. The unconstrained path is the deliberate default,
  // because a schema is a crash on this backend rather than a formatting choice.
  // If this ever passes vacuously, every arm in the corpus is a schema arm.
  assert.ok(!build({}).includes('--structured-output'));
  assert.ok(!build({ 'structured-output': false }).includes('--structured-output'));
});

test('--max-tokens is forwarded with its value when asked for, absent by default', () => {
  // OAI-215: bench could not set the one option that made a starved review complete.
  const flags = build({ 'max-tokens': '8192' });
  const at = flags.indexOf('--max-tokens');
  assert.ok(at !== -1, '--max-tokens must be forwarded');
  assert.equal(flags[at + 1], '8192', 'the value must ride the flag');
  assert.ok(!build({}).includes('--max-tokens'), 'absent when not asked for');
});

test('--temperature is forwarded, and 0 is not dropped', () => {
  const flags = build({ temperature: '0.2' });
  const at = flags.indexOf('--temperature');
  assert.ok(at !== -1 && flags[at + 1] === '0.2');
  // The negative twin AND the edge case: 0 is a legitimate deterministic setting a
  // truthy check would silently drop, so it must still be forwarded.
  const zero = build({ temperature: 0 });
  const zat = zero.indexOf('--temperature');
  assert.ok(zat !== -1 && String(zero[zat + 1]) === '0', 'temperature 0 must forward');
  assert.ok(!build({}).includes('--temperature'), 'absent when not asked for');
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

test('bench refuses --max-tokens below the review reserve floor BEFORE materializing (OAI-215)', async () => {
  // The whole point of validating up front (like the budgets): a value in
  // [1, MIN_REVIEW_RESERVE_TOKENS) passes /oai:review's parse but is refused by
  // every child's reserveFor, so without this floor a multi-case sweep would
  // materialize every repo and record predictable failures. The refusal must
  // name the floor and cost milliseconds, not repos.
  const runPath = fileURLToPath(new URL('../bench/run.mjs', import.meta.url));
  const child = spawn(process.execPath, [runPath, '--max-tokens', '100'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  });
  let err = '';
  child.stdout.on('data', (d) => { err += d; });
  child.stderr.on('data', (d) => { err += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const [code, signal] = await new Promise((resolve) => child.on('close', (c, s) => resolve([c, s])));
  clearTimeout(timer);
  assert.equal(signal, null, `child was killed (${signal}), proving nothing: ${err.slice(0, 300)}`);
  assert.notEqual(code, 0, `a below-floor --max-tokens must be refused: ${err.slice(0, 300)}`);
  assert.match(err, new RegExp(String(MIN_REVIEW_RESERVE_TOKENS)), 'the refusal must name the real floor');
  // No case was materialized: the refusal is a validation message, not a per-run failure record.
  assert.doesNotMatch(err, /run \d+\/\d+/, 'must refuse before running any case');
});
