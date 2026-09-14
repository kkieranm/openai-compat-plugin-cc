// A pid that cannot be read is not a process that has died.
//
// `isAlive` used to answer `false` to three different questions — "this is not a
// pid at all", "the OS says ESRCH", and "process.kill threw something we do not
// interpret" — and `livenessOf` turned every one of them into the verdict
// `dead`. Reconciliation then terminalized the row and `/oai:abandon` told the
// operator its process was already gone, about a number that never denoted one.
//
// The fixtures below are the shapes that make the difference observable, and the
// reason they are worth naming individually is that they reach the answer by
// three different roads: `-1` and `0` never touch the OS at all, `1.5` and
// `2 ** 40` throw a TypeError with no errno, and `'garbage'` is what a foreign
// writer leaves in a column SQLite does not type-check.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isAlive, livenessOf, pidLiveness } from '../scripts/lib/job-liveness.mjs';
import { deadPid } from './job-helpers.mjs';

/**
 * Values that are recorded but are not pids.
 *
 * `0` and `-1` are the two that must never reach `process.kill`: `kill(0, 0)`
 * signals this process's whole group and `kill(-1, 0)` every process the user
 * may signal, so both SUCCEED. A shape check placed after the probe would report
 * them `live`, which is worse than the defect being fixed.
 */
const UNREADABLE = [-1, 0, 1.5, 2 ** 40, 'garbage'];

test('an unreadable pid is `unreadable`, never `gone`', () => {
  for (const pid of UNREADABLE) {
    assert.equal(pidLiveness(pid), 'unreadable', `${JSON.stringify(pid)} must not read as a verdict`);
  }
  assert.equal(pidLiveness(process.pid), 'live');
});

test('only ESRCH reads as gone — a reaped pid, asked of the real OS', async () => {
  // The one fixture that must be a real reaped pid rather than a synthetic
  // number: a synthetic one would be rejected on shape and this assertion would
  // pass without the OS ever being asked. `tests/job-helpers.mjs` says the same
  // thing about `deadPid` and is why that helper exists.
  assert.equal(pidLiveness(await deadPid()), 'gone');
});

test('livenessOf reports an unreadable pid as malformed, in both states', () => {
  const now = Date.now();
  for (const pid of UNREADABLE) {
    assert.equal(
      livenessOf({ state: 'running', worker_pid: pid }, now), 'malformed',
      `a running row holding ${JSON.stringify(pid)} must not be collected as dead`,
    );
    assert.equal(
      livenessOf({ state: 'queued', waiter_pid: pid }, now), 'malformed',
      `a queued row holding ${JSON.stringify(pid)} must not be collected as dead`,
    );
  }
});

test('the verdicts a readable pid still produces are unchanged', async () => {
  const now = Date.now();
  assert.equal(livenessOf({ state: 'running', worker_pid: process.pid }, now), 'live');
  assert.equal(livenessOf({ state: 'running', worker_pid: await deadPid() }, now), 'dead');
  // The pre-existing malformed shape, asserted here so the new arm cannot be
  // shown to work by having swallowed the old one.
  assert.equal(livenessOf({ state: 'running', worker_pid: null }, now), 'malformed');
});

test('isAlive keeps the exact contract its two test-helper callers rely on', async () => {
  // `tests/cancel-helpers.mjs` and `tests/abandon-salvage.test.js` ask this of
  // real pids and would silently change meaning if the projection drifted. It
  // answers `false` for `gone` and `unreadable` alike — which is precisely why
  // nothing that DECIDES anything may call it.
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(await deadPid()), false);
  for (const pid of UNREADABLE) assert.equal(isAlive(pid), false, `isAlive(${JSON.stringify(pid)})`);
});
