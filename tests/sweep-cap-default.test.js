// The per-commit wall-clock cap's DEFAULT, which nothing could see change.
//
// This guards a different thing from the classification tests in
// `review-sweep.test.js`: not what a reply means, but whether a constant this
// harness's coverage depends on actually reaches the process that enforces it.
//
// The default is 3600 seconds because both shorter caps lost commits to the
// per-commit cap itself: a sweep run to completion at 900 lost HALF its eligible
// corpus — 20 of 40 commits, every one `deadline-timeout` — and a night at 1800
// still lost 15 of 34 attempted to `deadline-timeout`. Nothing else would
// notice a lower default: every fixture in the sweep suite passes its own
// `maxSeconds`, so the whole suite stays green against any value. That is the
// same shape as the `--abort-after` gap in `sweep-args.test.js`, which is why
// that test says what it says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionsFrom, runSweep } from '../bench/review-sweep.mjs';

const ok = () => ({
  status: 0,
  stdout: JSON.stringify({ parsed: true, findings: [], model: 'm', requestedModel: 'm' }),
});

// Two assertions because they fail differently: the parser reading the wrong
// constant, and the selected value never reaching the child that enforces it.
// A test that only checked `optionsFrom` would pass with the forwarding broken.
test('the per-commit cap default is 3600 and reaches the review command', () => {
  assert.equal(optionsFrom({ minutes: '10' }, 0).maxSeconds, 3600);
  assert.equal(optionsFrom({ minutes: '10', 'max-seconds': '42' }, 0).maxSeconds, 42);

  const seen = [];
  const options = { deadline: Infinity, maxAttempts: 3, abortAfter: 3, maxSeconds: optionsFrom({ minutes: '10' }, 0).maxSeconds };
  runSweep([{ sha: 'aaa', subject: 'a commit', eligible: true }], options, {
    execute: (args) => { seen.push(args); return ok(); },
    now: () => 0,
  });
  const at = seen[0].indexOf('--max-seconds');
  assert.notEqual(at, -1, 'the review command must carry --max-seconds');
  assert.equal(seen[0][at + 1], '3600');
});

// The same shape for the attempt ceiling: a default nothing observes, whose
// fixtures all pass their own value.
test('the attempt default is 2 and reaches the review command', () => {
  assert.equal(optionsFrom({ minutes: '10' }, 0).maxAttempts, 2);
  assert.equal(optionsFrom({ minutes: '10', 'max-attempts': '5' }, 0).maxAttempts, 5);

  const seen = [];
  const options = { deadline: Infinity, maxSeconds: 1800, abortAfter: 3, maxAttempts: optionsFrom({ minutes: '10' }, 0).maxAttempts };
  runSweep([{ sha: 'aaa', subject: 'a commit', eligible: true }], options, {
    execute: (args) => { seen.push(args); return ok(); },
    now: () => 0,
  });
  const at = seen[0].indexOf('--max-attempts');
  assert.notEqual(at, -1, 'the review command must carry --max-attempts');
  assert.equal(seen[0][at + 1], '2');
});
