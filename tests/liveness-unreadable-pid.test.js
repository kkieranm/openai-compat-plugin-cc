// A pid that cannot be read is not a process that has died.
//
// `pidLiveness` separates three answers — live, gone (the OS says ESRCH), and
// unreadable ("this is not a pid at all", or `process.kill` threw something we
// do not interpret) — and `livenessOf` maps `unreadable` to `malformed`, never
// `dead`. Were it mapped to `dead`, reconciliation would terminalize the row and
// `/oai:abandon` would tell the operator its process was already gone, about a
// number that never denoted one.
//
// The fixtures below are the shapes that make the difference observable. None
// of them reaches a syscall, and they are refused in two places: `-1`, `0`,
// `1.5` and `'garbage'` fail `pidLiveness`'s own shape check, which must run
// before the probe because `kill(0, 0)` and `kill(-1, 0)` would succeed and read
// `live`; `2 ** 40` passes that check and is rejected by Node's argument
// validator with a TypeError carrying no errno. `'garbage'` is what a foreign
// writer leaves in a column SQLite does not type-check.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isAlive, livenessOf, pidLiveness } from '../plugins/oai/scripts/lib/job-liveness.mjs';
import { deadPid } from './job-helpers.mjs';

/**
 * Values that are recorded but are not pids.
 *
 * `0` and `-1` are the two that must never reach `process.kill`: `kill(0, 0)`
 * signals this process's whole group and `kill(-1, 0)` every process the user
 * may signal, so both SUCCEED. A shape check placed after the probe would report
 * them `live`.
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
  // number: one that is not a positive integer reads `unreadable`, not `gone`,
  // and a guessed positive one may name a live process. `tests/job-helpers.mjs`
  // says the same thing about `deadPid` and is why that helper exists.
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

test('a readable pid reads live or dead, and a null pid stays malformed', async () => {
  const now = Date.now();
  assert.equal(livenessOf({ state: 'running', worker_pid: process.pid }, now), 'live');
  assert.equal(livenessOf({ state: 'running', worker_pid: await deadPid() }, now), 'dead');
  // Asserted so the unreadable arm cannot pass by swallowing the null case.
  assert.equal(livenessOf({ state: 'running', worker_pid: null }, now), 'malformed');
});

test('isAlive keeps the exact contract its test-helper caller relies on', async () => {
  // `waitForExit` in `tests/cancel-helpers.mjs` asks this of real pids, live or
  // gone, and would silently change meaning if that half drifted. It refuses an
  // unreadable pid before asking, so the `false` for `unreadable` is the
  // projection's own contract rather than its caller's — and answering `false`
  // for `gone` and `unreadable` alike is precisely why nothing that DECIDES
  // anything may call it.
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(await deadPid()), false);
  for (const pid of UNREADABLE) assert.equal(isAlive(pid), false, `isAlive(${JSON.stringify(pid)})`);
});
