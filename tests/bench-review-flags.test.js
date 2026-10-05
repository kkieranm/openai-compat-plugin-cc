// The command line `bench` builds for one run.
//
// `bench/run.mjs` drives the real CLI, so what it does or does not put on that
// command line IS the experiment.
//
// `bench/run.mjs`'s `main()` only runs when invoked as the entry script, so
// importing it from here does not itself trigger a benchmark run and write into
// `bench/results/`.
//
// Each assertion here has a NEGATIVE twin. A test that only checks a flag appears
// when asked for cannot distinguish "forwarded correctly" from "always on", which
// is the failure mode that would silently invalidate every unconstrained arm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reportFlags, reviewFlags } from '../bench/run.mjs';
import { MIN_REVIEW_RESERVE_TOKENS } from '../plugins/oai/scripts/lib/review-schema.mjs';
import { SAMPLING_FLAGS, parseSampling } from '../plugins/oai/scripts/lib/sampling.mjs';
import { parseCommandLine } from '../plugins/oai/scripts/lib/args.mjs';
import { PASSES_CEILING, parseNumber } from '../plugins/oai/scripts/lib/delegate.mjs';
import { REVIEW_SPEC } from '../plugins/oai/scripts/lib/cmd-review.mjs';

test('importing bench/run.mjs does NOT run the benchmark', async () => {
  // THE GUARD THAT GUARDS THE GUARD.
  //
  // A FRESH PROCESS asks the question. This file already imports `run.mjs`
  // at the top for `reviewFlags`, so an in-process import of that same URL
  // finds the module already executed and cannot observe the guard. The
  // discriminator is the child's output, not artifacts: an unguarded `main()`
  // prints its per-case progress immediately but only persists a report at the
  // END of the run, so waiting for files means waiting minutes for a signal
  // that arrives in milliseconds. ASYNC spawn, never `spawnSync` —
  // `tests/structure.test.js` forbids the sync forms outright: a sync spawn
  // blocks the event loop, so any test that also needs an in-process server
  // deadlocks until the client timeout.
  //
  // A bare `doesNotMatch` on child output is satisfied by a child that never imported anything — a
  // module-not-found error also fails to match. So the child emits a SENTINEL, and only after the
  // import resolves AND the module is confirmed to export what this file imports. Absence of the
  // progress line is evidence only alongside presence of the sentinel, exit code 0 and no signal.
  // `fileURLToPath`, not `.pathname` — a checkout under a path containing a space yields `%20` in
  // the pathname, `spawn` cannot enter that directory, and the test fails ENOENT **while the guard
  // it tests is correct**: a check that fails for a reason unrelated to what it checks.
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
  // `--max-tokens` is the option that lets a starved review complete, so bench must forward it.
  assert.ok(build({ 'max-tokens': '8192' }).includes('--max-tokens=8192'), 'the value must ride the flag');
  assert.ok(!build({}).some((arg) => arg.startsWith('--max-tokens')), 'absent when not asked for');
});

test('--temperature is forwarded, and 0 is not dropped', () => {
  assert.ok(build({ temperature: '0.2' }).includes('--temperature=0.2'));
  // The negative twin AND the edge case: 0 is a legitimate deterministic setting a
  // truthy check would silently drop, so it must still be forwarded.
  assert.ok(build({ temperature: 0 }).includes('--temperature=0'), 'temperature 0 must forward');
  assert.ok(!build({}).some((arg) => arg.startsWith('--temperature')), 'absent when not asked for');
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

// A bench that gets past validation would run the whole corpus and write a record
// into this checkout, so the child is killed at its first case and the test learns
// that a case started rather than waiting for one.
const spawnBench = async (args) => {
  const runPath = fileURLToPath(new URL('../bench/run.mjs', import.meta.url));
  const child = spawn(process.execPath, [runPath, ...args], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  let out = '';
  let startedCase = false;
  const read = (d) => {
    out += d;
    if (!startedCase && /run \d+\/\d+/.test(out)) {
      startedCase = true;
      child.kill('SIGKILL');
    }
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const [code, signal] = await new Promise((resolve) => child.on('close', (c, s) => resolve([c, s])));
  clearTimeout(timer);
  return { code, signal, out, startedCase };
};

test('bench refuses --max-tokens below the review reserve floor BEFORE materializing', async () => {
  // The whole point of validating up front (like the budgets): a value in
  // [1, MIN_REVIEW_RESERVE_TOKENS) passes /oai:review's parse but is refused by
  // every child's reserveFor, so without this floor a multi-case sweep would
  // materialize every repo and record predictable failures. The refusal must
  // name the floor and cost milliseconds, not repos.
  const { code, signal, out, startedCase } = await spawnBench(['--max-tokens', '100']);
  assert.equal(startedCase, false, `validation let --max-tokens 100 through and a case started: ${out.slice(0, 300)}`);
  assert.equal(signal, null, `child was killed (${signal}) without starting a case: ${out.slice(0, 300)}`);
  assert.notEqual(code, 0, `a below-floor --max-tokens must be refused: ${out.slice(0, 300)}`);
  assert.match(out, new RegExp(String(MIN_REVIEW_RESERVE_TOKENS)), 'the refusal must name the real floor');
});

// ---------------------------------------------------------------------------
// LENSES / pass strategy. The load-bearing property is no double-forward:
// `--passes` and `--lens` are mutually exclusive at the review CLI, so a lens run
// must forward `--lens` and NOT a synthesised `--passes`, or every case is refused.

test('--lens is forwarded with its value, and --passes is NOT synthesised for a lens run', () => {
  const flags = build({ lens: 'correctness,security' });
  const at = flags.indexOf('--lens');
  assert.ok(at !== -1 && flags[at + 1] === 'correctness,security', '--lens rides with its verbatim value');
  // The negative twin: a lens run forwarding --passes too would make the review CLI
  // refuse the mutual-exclusion and fail every case. compare-model derives the
  // effective pass count from --lens, so no --passes is needed on the wire.
  assert.ok(!flags.includes('--passes'), 'a lens run must NOT also forward --passes');
});

test('--passes is forwarded for a plain multi-pass run, and --lens is not', () => {
  const flags = build({ passes: '3' });
  const at = flags.indexOf('--passes');
  assert.ok(at !== -1 && flags[at + 1] === '3');
  assert.ok(!flags.includes('--lens'));
});

test('neither --passes nor --lens by default', () => {
  const flags = build({});
  assert.ok(!flags.includes('--passes'));
  assert.ok(!flags.includes('--lens'));
});


test('bench refuses --lens + --passes together BEFORE materializing any case', async () => {
  const { code, signal, out } = await spawnBench(['--lens', 'security', '--passes', '2']);
  assert.equal(signal, null, out.slice(0, 300));
  assert.notEqual(code, 0, `the collision must be refused up front: ${out.slice(0, 300)}`);
  assert.match(out, /--lens and --passes cannot be combined/);
  assert.doesNotMatch(out, /run \d+\/\d+/, 'refused before running any case');
});

test('bench refuses an unknown --lens BEFORE materializing any case', async () => {
  const { code, signal, out } = await spawnBench(['--lens', 'bogus']);
  assert.equal(signal, null, out.slice(0, 300));
  assert.notEqual(code, 0, out.slice(0, 300));
  assert.match(out, /Unknown --lens "bogus"/);
  assert.doesNotMatch(out, /run \d+\/\d+/, 'refused before running any case');
});

test('bench refuses an over-ceiling --passes BEFORE materializing any case', async () => {
  const { code, signal, out } = await spawnBench(['--passes', '99']);
  assert.equal(signal, null, out.slice(0, 300));
  assert.notEqual(code, 0, out.slice(0, 300));
  assert.doesNotMatch(out, /run \d+\/\d+/, 'refused before running any case');
});

// ---------------------------------------------------------------------------
// SAMPLING. Every knob in the review's own registry is forwarded when set, so a
// cross-server arm can pin what each server would otherwise choose for itself.

test('every sampling flag in the review registry is forwarded with its value, and absent by default', () => {
  const values = { 'reasoning-effort': 'medium', 'top-p': '0.9', 'top-k': '20', 'min-p': '0', 'presence-penalty': '-0.5', 'enable-thinking': 'false' };
  assert.deepEqual(Object.keys(values).sort(), [...SAMPLING_FLAGS].sort(), 'the test covers the whole registry');
  for (const [flag, value] of Object.entries(values)) {
    assert.ok(build({ [flag]: value }).includes(`--${flag}=${value}`), `--${flag} carries its value`);
    assert.ok(!build({}).some((arg) => arg.startsWith(`--${flag}`)), `--${flag} is absent when not asked for`);
  }
  // Zero and negative values are settings, not absence.
  assert.ok(build({ 'min-p': 0 }).includes('--min-p=0'));
});

test('forwarded values reach the review as the bench validated them, empty ones included', () => {
  // Through the review's own parser: a value forwarded as a separate, empty
  // argument is dropped there, and the review then refuses the flag or reads the
  // next one as its value.
  const asReviewed = (options) => parseCommandLine(build(options).slice(1), REVIEW_SPEC).options;
  for (const options of [
    { 'min-p': '' }, { 'top-p': ' ' }, { 'presence-penalty': '-0.5' }, { 'reasoning-effort': 'a=b' }, { 'top-k': 20 },
    { 'enable-thinking': ' FALSE ' },
  ]) {
    assert.deepEqual(parseSampling(asReviewed(options)), parseSampling(options), JSON.stringify(options));
  }
  assert.equal(parseNumber(asReviewed({ temperature: '' }).temperature, 'temperature', { min: 0, max: 2 }), 0);
  assert.equal(asReviewed({ 'max-tokens': '8192' })['max-tokens'], '8192');
});

test('bench refuses an out-of-range sampling value BEFORE materializing any case', async () => {
  const { code, signal, out, startedCase } = await spawnBench(['--top-p', '7']);
  assert.equal(startedCase, false, `validation let --top-p 7 through and a case started: ${out.slice(0, 300)}`);
  assert.equal(signal, null, `child was killed (${signal}) without starting a case: ${out.slice(0, 300)}`);
  assert.notEqual(code, 0, `an out-of-range --top-p must be refused: ${out.slice(0, 300)}`);
  assert.match(out, /top-p/);
});

test('the report is told which sampling flags were set, and only those', () => {
  assert.deepEqual(reportFlags({ 'top-p': '0.9', 'reasoning-effort': ' high ' }).sampling, { 'top-p': 0.9, 'reasoning-effort': 'high' });
  assert.deepEqual(reportFlags({}).sampling, {});
});

test('bench accepts a valid sampling flag on its command line', async () => {
  // Refused for --passes, which is checked after the sampling flags are validated:
  // reaching that refusal proves --top-p was both parsed and accepted. The match is
  // on the refusal's own sentence — an unknown-flag hint also names --passes.
  const { code, signal, out, startedCase } = await spawnBench(['--top-p', '0.9', '--passes', '99']);
  assert.equal(startedCase, false, out.slice(0, 300));
  assert.equal(signal, null, `child was killed (${signal}) without starting a case: ${out.slice(0, 300)}`);
  assert.notEqual(code, 0);
  assert.match(out, new RegExp(`--passes must be an integer between 1 and ${PASSES_CEILING}`), `--top-p must be accepted: ${out.slice(0, 300)}`);
});
