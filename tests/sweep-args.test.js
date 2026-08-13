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
import { SPEC, optionsFrom } from '../bench/review-sweep.mjs';
import { parseArgs } from '../scripts/lib/args.mjs';

const from = (argv) => optionsFrom(parseArgs(argv, SPEC).options, 0);

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
