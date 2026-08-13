// The question OAI-140 asked and the 2026-08-09 run could not answer: was the
// server healthy, or failing intermittently with the streak reset each time?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayStreak, serverHealth } from '../bench/lib/sweep-health.mjs';
import { runSweep } from '../bench/review-sweep.mjs';

const at = (n) => `2026-08-13T0${n}:00:00.000Z`;
const outage = (sha, n) => ({ sha, outcome: 'failed', reason: 'transport', startedAt: at(n), endedAt: at(n) });
const slow = (sha, n) => ({ sha, outcome: 'failed', reason: 'deadline-timeout', startedAt: at(n), endedAt: at(n) });
const clean = (sha, n) => ({ sha, outcome: 'clean', startedAt: at(n), endedAt: at(n) });

test('a skipped commit is not replayed, because the loop never counted it', () => {
  // The three skip branches return before the counter, so a skip between two
  // outages must NOT break the streak. Selecting on `startedAt` is what keeps
  // this in step with the loop.
  const entries = [outage('a', 1), { sha: 'b', outcome: 'skipped-no-code' }, outage('c', 2)];
  assert.equal(replayStreak(entries).longest, 2);
  assert.equal(replayStreak(entries).resets, 0);
});

test('the interleaved failure OAI-140 describes is counted and named', () => {
  // outage, slow, outage, slow, outage — a dying server whose streak never
  // reaches 3, which is exactly the night that reads as coverage today.
  const entries = [outage('a', 1), slow('b', 2), outage('c', 3), slow('d', 4), outage('e', 5)];
  const replay = replayStreak(entries);
  assert.equal(replay.outages.length, 3);
  assert.equal(replay.longest, 1);
  assert.equal(replay.resets, 2);

  const text = serverHealth(entries, 3).join('\n');
  assert.match(text, /5 commits attempted · 3 judged a server outage/);
  assert.match(text, /Longest consecutive streak reached: 1/);
  assert.match(text, /reset a live streak \*\*2\*\* time\(s\)/);
  assert.match(text, /may have done so against a server that was failing intermittently/);
});

test('a reset from zero is not a reset', () => {
  // Every healthy commit would otherwise be counted, reporting a reset number
  // the size of the run and burying the signal the reader came for.
  assert.equal(replayStreak([clean('a', 1), clean('b', 2), clean('c', 3)], 3).resets, 0);
});

test('an aborted run has nothing to replay past the threshold, by construction', () => {
  // The real loop sets `aborted` and every later commit becomes `skipped-abort`
  // with no `startedAt`, so a COMPLETE record cannot hold an attempted entry
  // after the threshold. That is why the replay needs no break of its own.
  const entries = [outage('a', 1), outage('b', 2), outage('c', 3), { sha: 'd', outcome: 'skipped-abort' }];
  const replay = replayStreak(entries);
  assert.equal(replay.longest, 3);
  assert.equal(replay.attempted, 3);
  assert.equal(replay.resets, 0);
});

test('a hole must not make the replay abandon the outages that survived it', () => {
  // Outage, MISSING, outage, then a fourth outage. A replay that broke at the
  // threshold would treat the first two as consecutive, stop, and report two
  // outages while the header said three commits were attempted — every one of
  // which is an outage.
  const entries = [outage('a', 1), outage('c', 3), outage('d', 4)];
  const replay = replayStreak(entries);
  assert.equal(replay.attempted, 3);
  assert.equal(replay.outages.length, 3);
  const text = serverHealth(entries, 3, false).join('\n');
  assert.match(text, /3 commits attempted · 3 judged a server outage/);
});

test('a night with no outage says so WITHOUT claiming the fail-fast was tested', () => {
  const text = serverHealth([clean('a', 1), clean('b', 2)], 3).join('\n');
  assert.match(text, /No outage was recorded/);
  assert.match(text, /different from it holding/);
});

test('a run that attempted nothing renders no health section at all', () => {
  // "0 outages" over a night that asked the server nothing reads as a clean
  // bill of health for a run that never took its temperature.
  assert.deepEqual(serverHealth([{ sha: 'a', outcome: 'skipped-deadline' }], 3), []);
});

test('a recovered timeline is labelled a partial reading, not the run it experienced', () => {
  const text = serverHealth([outage('a', 1), outage('b', 2)], 3, false).join('\n');
  assert.match(text, /Derived from an INCOMPLETE timeline/);
  assert.match(text, /appear consecutive when a healthy commit sat between/);
  // And a complete one carries no such warning.
  assert.doesNotMatch(serverHealth([outage('a', 1)], 3).join('\n'), /INCOMPLETE timeline/);
});

test('the threshold is stated, and its absence is stated rather than defaulted', () => {
  assert.match(serverHealth([clean('a', 1)], undefined).join('\n'), /abort threshold \(not recorded\)/);
});

test('an outage time carries its zone, because a bare one reads as a wrong time', () => {
  // Every sibling timestamp in the report is ISO/UTC with a `Z`. This is the one
  // line whose whole purpose is "the server went bad at 02:30", and rendered
  // bare beside a run the reader remembers starting at 14:18 BST, `13:18:38`
  // reads as an hour out rather than as a different zone.
  assert.match(serverHealth([outage('a', 1)], 3).join('\n'), /`a` 01:00:00Z/);
});

test('the abort the run TOOK and the streak the report DERIVES are one number', () => {
  // Two statements of one fact in one document: `runSweep` writes the count into
  // `stoppedBecause` while `serverHealth` recomputes it from the entries. Nothing
  // held them equal, so a change to either could have made the report contradict
  // itself — the header saying the run stopped at 3 while the health section
  // reported a longest streak of 2.
  const commits = ['a', 'b', 'c', 'd', 'e'].map((sha) => ({ sha, subject: `subject ${sha}`, eligible: true }));
  let clock = 0;
  const { entries, stoppedBecause } = runSweep(commits, { deadline: Infinity, maxSeconds: 900, maxAttempts: 3, abortAfter: 3 }, {
    execute: () => ({ status: 1, stdout: JSON.stringify({ error: true, reason: 'transport', message: 'it went wrong' }) }),
    now: () => (clock += 1000),
  });
  const declared = /^(\d+) consecutive server failures/.exec(stoppedBecause);
  assert.ok(declared, `the run did not abort: ${stoppedBecause}`);
  assert.equal(replayStreak(entries).longest, Number(declared[1]));
  assert.match(serverHealth(entries, 3).join('\n'), new RegExp(`Longest consecutive streak reached: ${declared[1]}`));
});
