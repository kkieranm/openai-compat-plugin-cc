// The per-commit wall-clock cap's DEFAULT, which nothing could see change.
//
// Its own file because `review-sweep.test.js` sits at the size ratchet, and
// because this guards a different thing from the classification tests there: not
// what a reply means, but whether a constant this harness's coverage depends on
// actually reaches the process that enforces it.
//
// Raised 900 -> 1800 on 2026-08-10 (OAI-138) after the first sweep run
// to completion lost HALF its eligible corpus to the old value — 20 of 40
// commits, every one `deadline-timeout`. Nothing would have noticed it going
// back: every fixture in the sweep suite passes its own `maxSeconds`, so the
// whole suite stayed green against either value. That is the same shape as the
// `--abort-after` gap, which is why that test says what it says.
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
test('the per-commit cap default is 1800 and reaches the review command', () => {
  assert.equal(optionsFrom({ minutes: '10' }, 0).maxSeconds, 1800);
  assert.equal(optionsFrom({ minutes: '10', 'max-seconds': '42' }, 0).maxSeconds, 42);

  const seen = [];
  const options = { deadline: Infinity, maxAttempts: 3, abortAfter: 3, maxSeconds: optionsFrom({ minutes: '10' }, 0).maxSeconds };
  runSweep([{ sha: 'aaa', subject: 'a commit', eligible: true }], options, {
    execute: (args) => { seen.push(args); return ok(); },
    now: () => 0,
  });
  const at = seen[0].indexOf('--max-seconds');
  assert.notEqual(at, -1, 'the review command must carry --max-seconds');
  assert.equal(seen[0][at + 1], '1800');
});
