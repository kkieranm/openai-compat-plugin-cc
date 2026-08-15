// Retention: the one operation here that destroys a user's record, so every
// test below is as much about what it leaves alone as about what it removes.
//
// Each exemption makes two promises: never deleted, and never counted. Only the
// second discriminates the clause's placement in the statement, and only from the
// NEWEST end — an exempt row below the cutoff displaces nothing, so the obvious
// arrangement returns the same answer whichever way the clause is placed.
//
// See also `retention-files.test.js`.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { RETAIN } from '../scripts/lib/job-retention.mjs';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, readJob, readJobs, stateDir, waitForState, withStore } from './job-helpers.mjs';
import { assertCorruptAndReachable, fillTerminal, logPath, runSweep, writeLog } from './retention-helpers.mjs';

test('sweep deletes finished jobs beyond the newest 50 and keeps the newest 50', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const seqs = fillTerminal(state, RETAIN + 5);

  const { deleted } = runSweep(state);

  assert.deepEqual(deleted.sort((a, b) => a - b), seqs.slice(0, 5), 'the five oldest, and only those');
  const left = readJobs(state).map((row) => Number(row.seq)).sort((a, b) => a - b);
  assert.deepEqual(left, seqs.slice(5), 'and what remains is exactly the newest 50');
});

test('a job that is still active is exempt however old it is', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const month = 30 * 24 * 60 * 60 * 1000;
  // Ancient enough that any rule reading age rather than state would take them,
  // and both flavours of active: one that never got its turn and one mid-run.
  const queued = insertSynthetic(state, { id: 'ancientq', state: 'queued', agedMs: month, waiterPid: process.pid });
  const running = insertSynthetic(state, {
    id: 'ancientr', state: 'running', workerPid: process.pid, agedMs: month, startedAgoMs: month - 1000,
  });
  fillTerminal(state, RETAIN + 5);

  const { deleted } = runSweep(state);

  assert.ok(!deleted.includes(queued), 'a queued job is not history');
  assert.ok(!deleted.includes(running), 'and neither is a running one');
  assert.equal(deleted.length, 5);
  assert.ok(readJob(state, 'ancientq'));
  assert.ok(readJob(state, 'ancientr'));
});

test('a row a newer plugin wrote is never deleted', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Two finished rows in the same position — the two oldest of all — differing
  // in nothing but the version stamped on them. That is what makes the two
  // verdicts attributable to the version rather than to age or to order.
  insertSynthetic(state, { id: 'foreign', state: 'completed', version: 99 });
  const ours = insertSynthetic(state, { id: 'ours', state: 'completed', version: 1 });
  fillTerminal(state, RETAIN);

  const { deleted } = runSweep(state);

  assert.deepEqual(deleted, [ours], 'the known-version row of the same age goes; the foreign one stays');
  assert.ok(readJob(state, 'foreign'), 'erasing a newer build\'s completed job is data loss, not housekeeping');
});

test('a row an operator abandoned after it ran is never deleted, and keeps its log', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Two `failed` rows in the same position — the two oldest of all — differing in
  // nothing but the reason recorded on them. That is what attributes the two
  // verdicts to the reason rather than to age or to order.
  //
  // `startedAgoMs` is what makes the abandoned row the shape under test: the
  // exemption is narrowed to rows that reached `running`, since `claimJob` sets
  // `started_at` atomically with the state before the worker can reach the
  // server. A row abandoned while queued sent nothing and has no answer to keep.
  const abandoned = insertSynthetic(state, {
    id: 'abandoned', state: 'failed', startedAgoMs: 60_000, failure: { reason: 'operator-abandoned' },
  });
  const control = insertSynthetic(state, {
    id: 'died', state: 'failed', startedAgoMs: 60_000, failure: { reason: 'worker-died' },
  });
  writeLog(state, abandoned);
  writeLog(state, control);
  fillTerminal(state, RETAIN);

  const { deleted } = runSweep(state);

  assert.deepEqual(deleted, [control], 'the reconciled row of the same age goes; the abandoned one stays');
  assert.ok(readJob(state, 'abandoned'), 'an abandoned row may still have a live worker writing to its log');
  // The point of the whole exemption. Deleting the row is not itself the harm —
  // unlinking the log is, because `job-spawn.mjs` handed that file to the worker
  // as its stdout descriptor, and a worker that later salvages its answer into an
  // unlinked inode loses it when the process exits (OAI-161).
  assert.equal(existsSync(logPath(state, abandoned)), true, 'the salvaged answer lives in this file');
  assert.equal(existsSync(logPath(state, control)), false, "and the control's log went with its row");
});

test('a run that recorded no failure is still ordinary history and is pruned', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The `IS`-vs-`=` control, and it is the whole test. `json_extract` yields NULL
  // for a row with no failure, and `NULL = 'operator-abandoned'` is NULL rather
  // than false — `NOT (1 AND NULL)` is NULL, a WHERE clause drops it, and every
  // genuinely-run completed row would leave the candidate set and never be pruned
  // again. Silently: no throw, no log line, just a record that stops shrinking.
  //
  // Two rows in the same position — the two oldest of all — differing in nothing
  // but whether they ever reached `running`, which is why every other fixture in
  // this file is insensitive to the operator.
  const ran = insertSynthetic(state, { id: 'ran', state: 'completed', startedAgoMs: 60_000, outcome: { content: 'ok' } });
  const never = insertSynthetic(state, { id: 'never', state: 'completed', outcome: { content: 'ok' } });
  fillTerminal(state, RETAIN);

  const { deleted } = runSweep(state);

  assert.deepEqual(
    deleted.sort((a, b) => a - b),
    [ran, never].sort((a, b) => a - b),
    'both are ordinary finished jobs; a null-unsafe comparison keeps the one that ran',
  );
  assert.equal(readJob(state, 'ran'), null);
  assert.equal(readJob(state, 'never'), null, 'the control shows age and order were not what decided it');
});

test('a row whose failure payload is corrupt does not sink the sweep', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // `json_extract` THROWS on an unparseable payload, and `sweep()` runs in
  // `task-submit.mjs` BEFORE anything is inserted or spawned — so one corrupt
  // `failure` on this machine would sink every submission, not merely misfile a
  // row. The `CASE WHEN json_valid` guard turns it into a NULL.
  const victim = insertSynthetic(state, { id: 'victim', state: 'completed', outcome: { content: 'ok' } });
  // `startedAgoMs` is load-bearing rather than decorative: without it the test
  // cannot fail with the guard removed.
  const corrupt = insertSynthetic(state, {
    id: 'corrupt', state: 'failed', startedAgoMs: 60_000, failure: { reason: 'worker-died' },
  });
  // Corrupted by a raw UPDATE because the helper cannot express it: an ordinary
  // object is serialised, and the one value that would pass through — `''` — is a
  // shape no failure path writes. A truncated payload is how a row actually gets
  // this way.
  withStore(state, (db) => {
    db.prepare('UPDATE jobs SET failure = ? WHERE seq = ?').run('{"reason":"oper', corrupt);
    // Asserted, not assumed — and every gate, not just the corruption. A `seq`
    // that drifted would match no row and leave the payload valid; a row that
    // lost its `started_at`, went non-terminal or gained a foreign version would
    // let this test pass with the guard REMOVED, which is the one thing it exists
    // to notice. Read back through the same function the guard consumes rather than
    // by counting the write's own `changes`, which says a row was touched and
    // not what is in it.
    assertCorruptAndReachable(db, corrupt);
  });
  fillTerminal(state, RETAIN);

  // Reaching this line at all is half the assertion: without the guard the sweep
  // throws `malformed JSON` and every background submission on the machine fails.
  const { deleted } = runSweep(state);

  // Never the corrupt row's own fate, which differs between `IS` and `=` and
  // would make this test answer a second question badly.
  assert.ok(deleted.includes(victim), 'an ordinary over-cap row is still collected');
  assert.equal(readJob(state, 'victim'), null);
});

test('an abandoned row does not consume one of the places kept for ordinary history', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The other half of the exemption, and the half the fixture above cannot see.
  // Measured during OAI-161: with the exempt row as the OLDEST, the clause in the
  // inner `SELECT` and the same clause moved to the outer `DELETE` return an
  // identical `deleted` — a row below the cutoff can never displace anything. It
  // discriminates only from the other end, where sparing the row while still
  // spending its slot evicts the oldest ordinary one behind it.
  const kept = fillTerminal(state, RETAIN + 1);
  const abandoned = insertSynthetic(state, {
    id: 'abandoned', state: 'failed', startedAgoMs: 60_000, failure: { reason: 'operator-abandoned' },
  });

  assert.equal(readJobs(state).length, RETAIN + 2, 'all RETAIN + 2 fixture rows landed — a short fill and the arrangement stops discriminating');

  const { deleted } = runSweep(state);

  // ONE ordinary row over the ceiling, so the correct statement takes exactly it.
  // Asserting `deleted` is EMPTY would have been the obvious shape and is a check
  // that cannot fail: a `PRUNE` that deleted nothing at all satisfies it too.
  // Placement still discriminates — the exempt row counted would push a second
  // ordinary row out — and inertness no longer passes.
  assert.deepEqual(deleted, [kept[0]], 'an uncounted row costs the oldest ordinary row nothing but its own place');
  assert.ok(readJob(state, 'abandoned'));
  assert.equal(readJobs(state).length, RETAIN + 1, 'the 50 kept, none evicted to make room for the exempt one');
});

test('an active job does not consume one of those places either', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The third exemption, and it had the same blind spot as the other two: the
  // test above asserts `deleted.length === 5` with the active rows OLDEST, which
  // holds identically whether `state IN (…)` sits in the inner `SELECT` or the
  // outer `DELETE`. Every exemption in `PRUNE` now has a witness at the end where
  // placement decides something, so the module's "EVERY exemption belongs in the
  // inner SELECT" is pinned rather than asserted.
  const kept = fillTerminal(state, RETAIN + 1);
  insertSynthetic(state, { id: 'live', state: 'running', workerPid: process.pid, startedAgoMs: 1000 });

  assert.equal(readJobs(state).length, RETAIN + 2, 'all RETAIN + 2 fixture rows landed — a short fill and the arrangement stops discriminating');

  const { deleted } = runSweep(state);

  assert.deepEqual(deleted, [kept[0]], 'a job still running does not evict a second finished one to make room');
  assert.ok(readJob(state, 'live'));
});

test('a row a newer plugin wrote does not consume one of those places either', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The same blind spot, in the exemption that predates this one: the test above
  // it asserts only that a foreign row is never DELETED, and holds identically
  // whether its clause sits in the inner `SELECT` or the outer `DELETE`. Added
  // beside that test rather than replacing it, so the two halves of the promise
  // have separate witnesses and separate mutations.
  const kept = fillTerminal(state, RETAIN + 1);
  insertSynthetic(state, { id: 'foreign', state: 'completed', version: 99 });

  assert.equal(readJobs(state).length, RETAIN + 2, 'all RETAIN + 2 fixture rows landed — a short fill and the arrangement stops discriminating');

  const { deleted } = runSweep(state);

  assert.deepEqual(deleted, [kept[0]], 'a machine that ran a newer plugin does not silently shorten this build\'s history');
  assert.ok(readJob(state, 'foreign'));
});

test('a row abandoned before it ever ran is pruned like any other', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The narrowing the exemption was given: `claimJob` sets `started_at` atomically
  // with `running`, before the worker can reach the server, so a row abandoned
  // while still queued provably sent nothing and has no paid-for answer to keep.
  // Exempting it would grow the kept set for no gain.
  //
  // Two rows in the same position, differing in nothing but `started_at`.
  const neverRan = insertSynthetic(state, {
    id: 'neverran', state: 'failed', failure: { reason: 'operator-abandoned' },
  });
  const ranAndAbandoned = insertSynthetic(state, {
    id: 'ranthen', state: 'failed', startedAgoMs: 60_000, failure: { reason: 'operator-abandoned' },
  });
  writeLog(state, neverRan);
  writeLog(state, ranAndAbandoned);
  fillTerminal(state, RETAIN);

  const { deleted } = runSweep(state);

  assert.deepEqual(deleted, [neverRan], 'the queued one goes');
  assert.equal(readJob(state, 'neverran'), null);
  assert.ok(readJob(state, 'ranthen'));
  assert.equal(existsSync(logPath(state, neverRan)), false, 'and its log with it — there is no answer in there');
  assert.equal(existsSync(logPath(state, ranAndAbandoned)), true);
});

test('a deleted sequence is never reused, so a later job cannot sort ahead of an earlier one', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const seqs = fillTerminal(state, RETAIN + 3);
  const highest = Math.max(...seqs);

  const { deleted } = runSweep(state);
  assert.equal(deleted.length, 3);

  // The property the whole queue rests on: `seq` is position, and a `DELETE`
  // that freed one would let a job submitted afterwards jump ahead of jobs
  // already waiting.
  const next = insertSynthetic(state, { id: 'afterwards', state: 'queued' });
  assert.ok(next > highest, `a job published after the sweep got seq ${next}, at or below the ${highest} already used`);
  assert.ok(!deleted.includes(next));
});

test('submitting a background job is what runs the sweep', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const seqs = fillTerminal(scenario.state, RETAIN + 1);
    writeFileSync(logPath(scenario.state, 424242), 'orphan\n');

    const submit = await scenario.submit();
    assert.equal(submit.status, 0, submit.stderr);
    await waitForState(scenario.state, submit.stdout.trim(), ['completed', 'failed']);

    assert.equal(readJob(scenario.state, 'done0'), null, 'the oldest finished job is gone');
    assert.equal(existsSync(logPath(scenario.state, seqs[0])), false, 'and so is its log');
    assert.equal(existsSync(logPath(scenario.state, 424242)), false, 'the orphan sweep ran with it');
  } finally {
    await scenario.server.close();
  }
});
