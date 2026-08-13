// Retention: the one operation here that destroys a user's record, so every
// test below is as much about what it leaves alone as about what it removes.
//
// The two exemptions are asserted with a positive control rather than on their
// own — a row that survives proves nothing unless an otherwise identical row in
// the same position went.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RETAIN, sweep } from '../scripts/lib/job-retention.mjs';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, readJob, readJobs, stateDir, waitForState, withStore } from './job-helpers.mjs';

// Stated independently of `logPathFor`, so a test cannot agree with the code
// about a layout they both got wrong.
const logPath = (state, seq) => join(state, 'logs', `${seq}.log`);
const ackPath = (state, seq) => join(state, 'logs', `${seq}.cancel-ack`);

function writeLog(state, seq) {
  writeFileSync(logPath(state, seq), `log for ${seq}\n`);
}

/** `n` finished jobs, oldest first, each with the log a real run would leave. */
function fillTerminal(state, n) {
  const seqs = [];
  for (let index = 0; index < n; index += 1) {
    const seq = insertSynthetic(state, { id: `done${index}`, state: 'completed', outcome: { content: 'ok' } });
    writeLog(state, seq);
    seqs.push(seq);
  }
  return seqs;
}

const runSweep = (state) => withStore(state, (db) => sweep(db));

test('sweep deletes finished jobs beyond the newest 50 and keeps the newest 50', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const seqs = fillTerminal(state, RETAIN + 5);

  const { deleted } = runSweep(state);

  assert.deepEqual(deleted.sort((a, b) => a - b), seqs.slice(0, 5), 'the five oldest, and only those');
  const left = readJobs(state).map((row) => Number(row.seq)).sort((a, b) => a - b);
  assert.deepEqual(left, seqs.slice(5), 'and what remains is exactly the newest 50');
});

test('a job that is still active is exempt however old it is, and is not counted either', { skip: NEEDS_SQLITE }, () => {
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
  assert.equal(deleted.length, 5, 'nor do they consume any of the 50 places kept for finished jobs');
  assert.ok(readJob(state, 'ancientq'));
  assert.ok(readJob(state, 'ancientr'));
});

test('a row a newer plugin wrote is never deleted, and is not counted toward the ceiling', { skip: NEEDS_SQLITE }, () => {
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

test("a deleted job's log goes with it, while a surviving job's log stays", { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const seqs = fillTerminal(state, RETAIN + 2);

  runSweep(state);

  for (const seq of seqs.slice(0, 2)) {
    assert.equal(existsSync(logPath(state, seq)), false, `log ${seq}.log outlived its row`);
  }
  for (const seq of seqs.slice(2)) {
    assert.equal(existsSync(logPath(state, seq)), true, `log ${seq}.log was taken from a job that was kept`);
  }
});

test('an orphaned log is swept, and anything else in the directory is left alone', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const live = insertSynthetic(state, { id: 'live', state: 'running', workerPid: process.pid });
  writeLog(state, live);
  // Exactly what a crash between the DELETE and the unlink leaves behind: a log
  // with no row to explain it. Written by hand because the only other way to
  // produce one is to kill a process at the one instruction in between.
  writeFileSync(logPath(state, 9999), 'orphan\n');
  writeFileSync(join(state, 'logs', 'notes.txt'), 'not ours\n');

  const { logs } = runSweep(state);

  assert.deepEqual(logs, [9999]);
  assert.equal(existsSync(logPath(state, 9999)), false);
  assert.equal(existsSync(logPath(state, live)), true, "a running job's log is not an orphan");
  assert.equal(
    existsSync(join(state, 'logs', 'notes.txt')),
    true,
    'a name that is not of the shape this plugin writes is left alone',
  );
});

test("a deleted job's cancellation acknowledgement goes with its log", { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const seqs = fillTerminal(state, RETAIN + 2);
  for (const seq of seqs.slice(0, 2)) writeFileSync(ackPath(state, seq), 'someid\n');
  writeFileSync(ackPath(state, seqs[seqs.length - 1]), 'someid\n');

  runSweep(state);

  for (const seq of seqs.slice(0, 2)) {
    assert.equal(existsSync(ackPath(state, seq)), false, `${seq}.cancel-ack outlived its row`);
  }
  assert.equal(
    existsSync(ackPath(state, seqs[seqs.length - 1])),
    true,
    'and one belonging to a job that was kept is not touched',
  );
});

test('an acknowledgement whose log is already gone is still enumerated and swept', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Also what creates the logs directory, so the fixture below writes somewhere
  // real rather than reporting its own absence as the sweep's answer.
  const live = insertSynthetic(state, { id: 'live', state: 'running', workerPid: process.pid });
  writeFileSync(ackPath(state, live), 'someid\n');
  // The leak this scan key exists to close: every unlink here tolerates failure,
  // so a job whose log went while its acknowledgement did not is exactly the
  // residue a `<seq>.log`-keyed scan can never see again. There is no log at all
  // for 8888 — if the sweep still finds it, it is not keying on one.
  writeFileSync(ackPath(state, 8888), 'someid\n');
  writeFileSync(join(state, 'logs', 'notes.txt'), 'not ours\n');

  const { logs } = runSweep(state);

  assert.deepEqual(logs, [8888], 'an orphan with no log is an orphan');
  assert.equal(existsSync(ackPath(state, 8888)), false);
  assert.equal(existsSync(ackPath(state, live)), true, "a running job's acknowledgement is not an orphan");
  assert.equal(existsSync(join(state, 'logs', 'notes.txt')), true, 'and the widened key took nothing extra');
});

test('a name the unlink could not address again is not swept, and takes nothing with it', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const live = insertSynthetic(state, { id: 'live', state: 'running', workerPid: process.pid });
  writeLog(state, live);
  const named = (name) => join(state, 'logs', name);
  // Three shapes, because the regex alone closes only the first. Each is a name
  // whose `Number` conversion does NOT round-trip, so the path the unlink builds is
  // a different string from the file that was listed.
  writeFileSync(named('0002.cancel-ack'), 'leading zero\n');
  writeFileSync(named('9007199254740993.log'), 'past MAX_SAFE_INTEGER\n');
  writeFileSync(named('1000000000000000000000.cancel-ack'), 'becomes 1e+21\n');
  // The bystander, and the sharpest half of this witness: `Number` turns the name
  // above into `1e+21`, so a sweep that keyed on the number would unlink THIS —
  // deleting an unrelated file rather than merely leaking the listed one.
  writeFileSync(named('1e+21.log'), 'not addressed by any sequence\n');
  // A SECOND bystander, because without it the fixture above it is inert: on its own
  // `9007199254740993.log` rounds to a path that does not exist, both unlinks fail,
  // and every assertion passes with the check removed. This is the file that rounding
  // would take. A fixture that cannot fail inside a witness that can is the same
  // defect one layer down.
  writeFileSync(named('9007199254740992.log'), 'what the rounding would hit\n');
  // Past SQLite's maximum sequence, so no row can ever own it — and it DOES survive
  // the round trip, which is why the round trip is not the whole check.
  writeFileSync(named('9223372036854776000.log'), 'beyond any legal sequence\n');

  const { logs } = runSweep(state);

  assert.deepEqual(logs, [], 'a name that does not survive the conversion is not this sweep\'s to collect');
  const survivors = [
    '0002.cancel-ack', '9007199254740993.log', '1000000000000000000000.cancel-ack',
    '1e+21.log', '9007199254740992.log', '9223372036854776000.log',
  ];
  for (const name of survivors) {
    assert.equal(existsSync(named(name)), true, `${name} was taken by a sweep that could not address it`);
  }
  assert.equal(existsSync(logPath(state, live)), true);
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
