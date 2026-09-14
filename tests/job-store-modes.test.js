// The state directory and `logs/` get their mode `0700` at creation
// (`mkdirSync(..., {mode: 0o700})`), but that argument is a no-op on a
// directory that already exists — Node's own documented behaviour. A directory
// left over from an older build, or widened by anything else, stayed loose on
// every subsequent `openStore()` forever: a state dir at `0755` with `logs/`
// at `0777` lets another local principal plant a forged `<seq>.cancel-ack`
// without ever touching `jobs.db`.
//
// `jobs.db` itself is already unconditionally `chmodSync`'d to `0600` on every
// open, but that alone isn't enough: the WAL/SHM sidecars SQLite creates
// under WAL mode live directly in this directory and inherit ITS mode, not
// the database file's. This file pins the directory repair that closes both.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NEEDS_SQLITE, stateDir, withStore } from './job-helpers.mjs';
import { databasePath, logsPath, openStore, openStoreForReading, refuseSymlink, statePath } from '../scripts/lib/job-store.mjs';

function modeOf(path) {
  return statSync(path).mode & 0o777;
}

test('the OAI-150 discriminating fixture: state 0755 / logs 0777 must both repair to 0700', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // `logs/` must exist before it can be loosened — `withStore`'s `openStore()`
  // call creates it, but only AFTER this test needs it already there.
  mkdirSync(`${state}/logs`, { recursive: true });
  chmodSync(state, 0o755);
  chmodSync(`${state}/logs`, 0o777);

  withStore(state, () => {
    assert.equal(modeOf(statePath()), 0o700, 'the state directory must be repaired');
    assert.equal(modeOf(logsPath()), 0o700, 'logs/ must be repaired');
    assert.equal(modeOf(databasePath()), 0o600, 'jobs.db is unaffected by this fix and stays 0600');
  });
});

// A MORE restrictive starting mode than the target, not one already equal to
// it — an already-0700 fixture would pass identically against a broken
// implementation that never touches the mode at all, proving nothing about
// repair actually running. 0500 (no write bit) forces the assertion to fail
// unless chmodSync genuinely widened it back to 0700.
test('a stricter-than-0700 state dir and logs/ are widened back to exactly 0700', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  mkdirSync(`${state}/logs`, { recursive: true });
  chmodSync(state, 0o500);
  chmodSync(`${state}/logs`, 0o500);

  withStore(state, () => {
    assert.equal(modeOf(statePath()), 0o700);
    assert.equal(modeOf(logsPath()), 0o700);
  });
});

// A `logs/` at 0700 is not enough on its own: the WAL/SHM sidecars live
// directly in the STATE directory (not logs/), so the state directory itself
// must also be repaired unconditionally, even when logs/ is already safe.
test('state 0755 / logs 0700 is now ALSO repaired, superseding OAI-150s original "leave it alone" case', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  mkdirSync(`${state}/logs`, { recursive: true });
  chmodSync(state, 0o755);
  chmodSync(`${state}/logs`, 0o700);

  withStore(state, () => {
    assert.equal(modeOf(statePath()), 0o700, 'the state dir is repaired even though logs/ alone was already safe');
    assert.equal(modeOf(logsPath()), 0o700);
  });
});

/** Open the store and clean up the env var, whether or not it throws. */
function tryOpen(state) {
  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = state;
  try {
    return openStore();
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
}

// `mkdirSync(..., {recursive: true})` treats a path that RESOLVES to a
// directory as already satisfied — it never checks whether the path itself is
// a symlink — and `chmodSync` sets the mode of whatever the link resolves to,
// not the link. A symlink planted at the state directory ahead of a first run
// would otherwise have both calls silently "succeed" against a directory an
// attacker controls, and every file this code writes (jobs.db, its WAL/SHM
// sidecars, every job log) would land there instead.
test('a symlinked state directory is refused, not followed and "repaired"', { skip: NEEDS_SQLITE }, () => {
  const container = stateDir();
  const attackerDir = `${container}/attacker-owned`;
  mkdirSync(attackerDir, { recursive: true, mode: 0o777 });
  // `mkdirSync`'s `mode` is masked by the process umask exactly like a real
  // `mkdir(2)`, so the actual mode after creation may not be 0o777 — capture
  // what it really is rather than assume.
  const attackerModeBefore = modeOf(attackerDir);
  const linkedState = `${container}/state-link`;
  symlinkSync(attackerDir, linkedState);

  assert.throws(
    () => tryOpen(linkedState),
    (error) => {
      assert.match(error.message, /is a symlink/);
      return true;
    },
  );
  // The attacker's directory must be untouched — not silently chmod'ed to
  // 0700 as if it were now this plugin's own.
  assert.equal(modeOf(attackerDir), attackerModeBefore, 'a symlink target must never be treated as the state directory');
  // A mode check alone can't tell "refused before touching it" from "a later
  // guard wrote through the symlink, then threw anyway" — nothing this code
  // path would create (jobs.db, logs/) may exist inside the attacker's
  // directory either.
  assert.deepEqual(readdirSync(attackerDir), [], 'refusal must happen before anything is written through the symlink');
});

// `openStoreForReading()` is a SECOND opener, distinct from `openStore()` —
// `job-view.mjs`'s `openJobs()` calls it first, unconditionally, on every
// `/oai:status`, before the hardened opener above ever runs. It had no
// symlink guard at all until this test: a symlink planted at `statePath()`
// pointing at an attacker directory that itself contains a `jobs.db` (so
// `existsSync` sees something there) would otherwise be opened read-only
// straight through, unrefused.
test('openStoreForReading refuses a symlinked state directory, matching openStore', { skip: NEEDS_SQLITE }, () => {
  const container = stateDir();
  const attackerDir = `${container}/attacker-owned`;
  mkdirSync(attackerDir, { recursive: true, mode: 0o777 });
  const attackerModeBefore = modeOf(attackerDir);
  // Any bytes at all — `existsSync` is a plain stat, it never opens the file,
  // so this only needs to make the path exist, not be a valid database.
  writeFileSync(`${attackerDir}/jobs.db`, 'not a real database\n');
  const linkedState = `${container}/state-link`;
  symlinkSync(attackerDir, linkedState);

  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = linkedState;
  try {
    assert.throws(
      () => openStoreForReading(),
      (error) => {
        assert.match(error.message, /is a symlink/);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
  assert.equal(modeOf(attackerDir), attackerModeBefore, 'the attacker directory must be untouched');
});

// The guard runs BEFORE `existsSync`, not after: an earlier version checked
// existence first, so an attacker directory with no `jobs.db` inside it would
// make the function return `null` — quietly, no throw — before the symlink
// guard ever ran at all. This is the discriminating case the test above
// can't cover, since it deliberately plants a `jobs.db` behind the symlink to
// even reach that far.
test('openStoreForReading refuses a symlinked state directory with no jobs.db behind it', { skip: NEEDS_SQLITE }, () => {
  const container = stateDir();
  const attackerDir = `${container}/attacker-owned-empty`;
  mkdirSync(attackerDir, { recursive: true, mode: 0o777 });
  const linkedState = `${container}/state-link-empty`;
  symlinkSync(attackerDir, linkedState);

  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = linkedState;
  try {
    assert.throws(
      () => openStoreForReading(),
      (error) => {
        assert.match(error.message, /is a symlink/);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
});

test('a symlinked logs/ directory is refused, not followed and "repaired"', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const attackerDir = `${state}/attacker-owned-logs`;
  mkdirSync(attackerDir, { recursive: true, mode: 0o777 });
  const attackerModeBefore = modeOf(attackerDir);
  symlinkSync(attackerDir, `${state}/logs`);

  assert.throws(
    () => tryOpen(state),
    (error) => {
      assert.match(error.message, /is a symlink/);
      return true;
    },
  );
  assert.equal(modeOf(attackerDir), attackerModeBefore, 'a symlinked logs/ must never be treated as this plugin\'s own logs directory');
  assert.deepEqual(readdirSync(attackerDir), [], 'refusal must happen before anything is written through the symlink');
});

// refuseSymlink must treat ONLY ENOENT as "not there yet" — any other lstat
// failure (EACCES, EIO, a parent segment that isn't a directory) is a real
// problem the guard exists to surface, not something to swallow as absence.
// Called DIRECTLY rather than through openStore(): the same underlying
// condition that makes lstatSync fail here (a missing/blocked ancestor) would
// also make the mkdirSync inside openOnce() fail identically, so an
// end-to-end test can't tell "refuseSymlink rethrew" from "refuseSymlink
// swallowed it and mkdirSync failed anyway" — see refuseSymlink's own
// docblock. A regular file standing where a directory component is expected
// produces a genuine ENOTDIR from lstatSync, no mocking needed (and ESM's
// named `fs` imports can't be monkey-patched from a test in any case).
// A symlink swap of `state` itself, between the repair call on `state`
// completing and `state` being used again (`logs`/`path` are string joins on
// it computed up front, so what they resolve to depends on what `state`
// points at when each is actually USED, not on when the string was built),
// is not something any deterministic test can drive: it needs a second
// process (or a syscall interleaving) racing synchronous code with no
// event-loop yield, which the ESM-mocking failure noted just above (named
// fs imports can't be monkey-patched from a test) already ruled out
// simulating in-process. Pinned structurally instead, the same way
// tests/queue-guards.test.js pins abandonRow's inside-the-lock property:
// read the source and assert the re-check calls are textually present in
// the right ORDER relative to each subsequent use of `state` — not that
// nothing else runs between a check and its use, which no string search can
// prove — so a future edit that drops or reorders one goes red here even
// though no behavioural test could ever have caught it.
test('openOnce re-checks state, in order, before repairDir(logs) and before opening the database', () => {
  const source = readFileSync(fileURLToPath(new URL('../scripts/lib/job-store.mjs', import.meta.url)), 'utf8');
  const withComments = source.slice(source.indexOf('function openOnce('), source.indexOf('\n}\n', source.indexOf('function openOnce(')));
  // Strip `//` line comments before searching — an occurrence of the exact
  // call syntax inside PROSE (documenting what the code below it does, say)
  // would otherwise satisfy indexOf identically to the real call, so a future
  // edit that moves or deletes the real call while leaving the comment behind
  // would pass this test having lost the thing it exists to pin.
  const body = withComments.replace(/\/\/.*$/gm, '');

  const repairState = body.indexOf('repairDir(state)');
  const firstRecheck = body.indexOf('refuseSymlink(state)');
  const repairLogs = body.indexOf('repairDir(logs)');
  const secondRecheck = body.indexOf('refuseSymlink(state)', firstRecheck + 1);
  const newDatabase = body.indexOf('new Database(path)');

  assert.ok(repairState >= 0 && repairLogs >= 0 && newDatabase >= 0, 'openOnce no longer contains the calls this test pins');
  assert.ok(
    repairState < firstRecheck && firstRecheck < repairLogs,
    'state must be re-checked between repairDir(state) and repairDir(logs)',
  );
  assert.ok(
    repairLogs < secondRecheck && secondRecheck < newDatabase,
    'state must be re-checked again between repairDir(logs) and opening the database',
  );
});

// Same untestable-by-behavior class as the pin above, for openStoreForReading's
// own re-check across its existsSync call.
test('openStoreForReading re-checks state, in order, before existsSync and before opening the database', () => {
  const source = readFileSync(fileURLToPath(new URL('../scripts/lib/job-store.mjs', import.meta.url)), 'utf8');
  const withComments = source.slice(source.indexOf('function openStoreForReading('), source.indexOf('\n}\n', source.indexOf('function openStoreForReading(')));
  const body = withComments.replace(/\/\/.*$/gm, '');

  const firstRecheck = body.indexOf('refuseSymlink(statePath())');
  const existsCheck = body.indexOf('existsSync(path)');
  const secondRecheck = body.indexOf('refuseSymlink(statePath())', firstRecheck + 1);
  const newDatabase = body.indexOf('new Database(path');

  assert.ok(
    firstRecheck >= 0 && existsCheck >= 0 && secondRecheck >= 0 && newDatabase >= 0,
    'openStoreForReading no longer contains the calls this test pins',
  );
  assert.ok(
    firstRecheck < existsCheck && existsCheck < secondRecheck && secondRecheck < newDatabase,
    'state must be checked before existsSync and re-checked again before opening the database',
  );
});

test('refuseSymlink propagates a non-ENOENT lstat failure rather than treating it as absence', () => {
  const container = stateDir();
  const blocker = `${container}/blocker`;
  writeFileSync(blocker, 'not a directory');
  const badPath = `${blocker}/nested`;

  assert.throws(
    () => refuseSymlink(badPath),
    (error) => {
      assert.equal(error.code, 'ENOTDIR', `expected the ENOTDIR to propagate, got: ${error.message}`);
      return true;
    },
  );
});
