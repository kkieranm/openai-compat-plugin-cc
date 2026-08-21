// The sweep CLI's ARGUMENT SURFACE, driven through the real parser and the real
// spec.
//
// Split out of `review-sweep.test.js` when that file reached the repo's size
// ratchet. It is a coherent subject on its own: everything here answers "does
// what I typed reach the run", which is the question two flags failed silently
// for — documented in the plan, and unpassable.
//
// **These invoke `parseArgs` with the exported `SPEC`.** The versions they
// replace built the parsed object by hand and called `optionsFrom`, so removing
// a flag from SPEC would have broken the real command while the tests went on
// passing — a check named for the parser that never ran it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SPEC, optionsFrom } from '../bench/review-sweep.mjs';
import { parseArgs } from '../scripts/lib/args.mjs';

const TOOL_ROOT = '/tool/root';
const from = (argv, root = TOOL_ROOT) => optionsFrom(parseArgs(argv, SPEC).options, 0, root);

// --abort-after was documented in the plan and could not be
// passed. **This now runs the REAL argv through the REAL parser**: the earlier
// version handed `optionsFrom` an object it built itself, so dropping the flag
// from SPEC would have made the CLI reject `--abort-after` while this test went
// on passing — a check named for the parser that never invoked it.
test('--abort-after survives the whole path from argv to options', () => {
  assert.equal(from(['--minutes', '10', '--abort-after', '7']).abortAfter, 7);
  assert.equal(from(['--minutes', '10']).abortAfter, 3);
  assert.throws(() => from(['--minutes', '10', '--abort-after', 'x']), /--abort-after/);
  // The negative control: SPEC must actually declare it. An undeclared flag is
  // refused by parseArgs, which is the failure the old test could not see.
  assert.throws(() => parseArgs(['--not-a-flag', '1'], SPEC), /Unknown option/);
});
test('--from survives the whole path from argv to options', () => {
  assert.equal(from(['--minutes', '10', '--from', 'deadbeef']).from, 'deadbeef');
  assert.equal(from(['--minutes', '10']).from, 'HEAD');
});
// A mistyped flag used to cost the whole night: parseArgs stops at the first
// non-`--` token and pushes the REST into positionals, so `--minutes 10 typo
// --model wanted` ran on the DEFAULT model, unattended, for eight hours, in
// silence. `main` discarding positionals is what made it silent.
test('a stray token strands every flag after it, which is why main refuses one', () => {
  const { options, positionals } = parseArgs(['--minutes', '10', 'typo', '--model', 'wanted'], SPEC);
  assert.equal(options.model, undefined, 'the flag after the stray token never reached options');
  assert.deepEqual(positionals, ['typo', '--model', 'wanted']);
  // Which is exactly the signal `main` refuses on, and the whole reason it must
  // read `positionals` rather than discard them.
  assert.equal(positionals.length > 0, true);
});

test('with no --repo, options.repo is this tool and DEFAULTS.include still applies', () => {
  const options = from(['--minutes', '10']);
  assert.equal(options.repo, TOOL_ROOT);
  assert.deepEqual(options.include, ['scripts', 'bench', 'tests']);
});

// The default `include` is THIS repo's own layout. Silently inheriting it for
// a foreign repo would reject almost every commit and read as a quiet night
// rather than a misconfigured one — so a foreign --repo with no --include is
// refused loudly instead.
test('--repo without --include is refused loudly rather than silently reviewing almost nothing', () => {
  assert.throws(() => from(['--minutes', '10', '--repo', '/other/repo']), /--include must be given explicitly/);
});

test('--repo with --include resolves and runs rooted at the foreign path', () => {
  const options = from(['--minutes', '10', '--repo', '/other/repo', '--include', 'src']);
  assert.equal(options.repo, resolve('/other/repo'));
  assert.deepEqual(options.include, ['src']);
  // The report artifact stays under THIS tool's own bench/results by default —
  // relocating it into the target repo was explicitly deferred.
  assert.equal(options.outDir, `${TOOL_ROOT}/bench/results`);
});

// The guard used to fire on --repo being SYNTACTICALLY given, not on the
// resolved path being foreign — so naming this tool's own root back at it
// refused for no reason, on a false message ("points at a different
// repository" when it did not). Fixed to compare resolved identity instead.
test('--repo naming this tool itself is a no-op — defaults still apply, no --include required', () => {
  const options = from(['--minutes', '10', '--repo', TOOL_ROOT]);
  assert.equal(options.repo, TOOL_ROOT);
  assert.deepEqual(options.include, ['scripts', 'bench', 'tests']);
});

// `--repo` given an empty value used to be silently read as "not given"
// (empty string is falsy) and fell back to
// self-review with no --include required — a mistyped `--repo=` reviewing
// this tool instead of the intended target, and saying nothing about it.
test('--repo given an empty value is refused, not silently read as omitted', () => {
  assert.throws(() => from(['--minutes', '10', '--repo', '']), /--repo was given an empty value/);
});

// `--include src/` and `--include ./src` both parsed and passed the
// non-empty check, then matched NOTHING against a git-relative path list —
// the same silent hollow-sweep failure the --repo empty-value check exists
// to prevent, one flag over. Normalized rather than left to fail quietly.
test('--include is normalized: a trailing slash and a leading ./ are stripped', () => {
  assert.deepEqual(from(['--minutes', '10', '--repo', '/x', '--include', 'src/']).include, ['src']);
  assert.deepEqual(from(['--minutes', '10', '--repo', '/x', '--include', './src']).include, ['src']);
});

test('--include normalizing to empty is refused, not silently matching every path', () => {
  assert.throws(() => from(['--minutes', '10', '--repo', '/x', '--include', '']), /--include was given.*empty/);
  assert.throws(() => from(['--minutes', '10', '--repo', '/x', '--include', '/']), /--include was given.*empty/);
});

// Stripping only the ONE leading "./" left the class open — each of these
// parses, is non-empty, and still matches no real git path. `--include .` in
// particular is the most plausible way to type "review everything in the
// target repo" and silently reviewed nothing.
test('--include shapes that can never match a git-relative path are refused, not silently accepted', () => {
  for (const value of ['.', '/src', '../src', '..', 'src/./x', 'src//sub']) {
    assert.throws(() => from(['--minutes', '10', '--repo', '/x', '--include', value]), /--include was given/, `expected "${value}" to be refused`);
  }
});

// Validation used to check a TRIMMED copy but return the UNTRIMMED entry, so
// surrounding whitespace slipped through and matched nothing — the same
// failure class one character over.
test('--include surrounding whitespace is trimmed, not silently returned untrimmed', () => {
  assert.deepEqual(from(['--minutes', '10', '--repo', '/x', '--include', ' src']).include, ['src']);
  assert.deepEqual(from(['--minutes', '10', '--repo', '/x', '--include', 'src ']).include, ['src']);
});

// `startsWith('..')` refused a legitimate name like `..config`, which is not
// path traversal — only an exact `..` or a `../` prefix is.
test('--include names that merely start with two dots, but are not traversal, are accepted', () => {
  assert.deepEqual(from(['--minutes', '10', '--repo', '/x', '--include', '..config']).include, ['..config']);
});

// The same whitespace bug --include had — a trimmed copy validated, the
// untrimmed original used — existed for --repo too: the empty-value check
// trimmed, but resolve() ran on the raw value.
test('--repo surrounding whitespace is trimmed before both the empty check and resolve()', () => {
  assert.throws(() => from(['--minutes', '10', '--repo', '   ']), /--repo was given an empty value/);
  const options = from(['--minutes', '10', '--repo', '  /other/repo  ', '--include', 'src']);
  assert.equal(options.repo, resolve('/other/repo'));
});
