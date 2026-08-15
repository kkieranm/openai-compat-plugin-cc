// The other half of retention: which FILES the sweep collects once the rows are
// gone. `retention.test.js` holds which rows the `DELETE` takes; the two split
// when they together outgrew the size ratchet.
//
// The unlink tolerates every failure, so most of what is asserted here is what
// the sweep LEAVES ALONE: a running job's log, a name of a shape this plugin does
// not write, and a name whose sequence the unlink could not address again.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RETAIN } from '../scripts/lib/job-retention.mjs';
import { NEEDS_SQLITE, insertSynthetic, stateDir } from './job-helpers.mjs';
import { ackPath, fillTerminal, logPath, runSweep, writeLog } from './retention-helpers.mjs';

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
  // The positive control, and without it the whole witness is inert: an
  // `orphanSeqs` that returned nothing at all satisfies an empty `logs` and every
  // survivor assertion below. This is one orphan the sweep MUST take, so the six
  // it leaves are six it declined rather than six it never looked at.
  writeFileSync(named('7777.log'), 'an addressable orphan\n');

  const { logs } = runSweep(state);

  assert.deepEqual(logs, [7777], 'the collectible orphan went, and no unaddressable name went with it');
  assert.equal(existsSync(named('7777.log')), false, 'the control proves collection was reachable in this run');
  const survivors = [
    '0002.cancel-ack', '9007199254740993.log', '1000000000000000000000.cancel-ack',
    '1e+21.log', '9007199254740992.log', '9223372036854776000.log',
  ];
  for (const name of survivors) {
    assert.equal(existsSync(named(name)), true, `${name} was taken by a sweep that could not address it`);
  }
  assert.equal(existsSync(logPath(state, live)), true);
});

