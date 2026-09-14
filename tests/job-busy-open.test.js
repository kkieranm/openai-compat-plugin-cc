// The two things about `openStore` that no witness could previously fail on.
//
// `job-busy.test.js` already pins the SHAPE of the open — that the WAL pragma is
// conditional, and that the busy_timeout is short then long. That inspection
// runs across two clean opens, so it never raises a busy at all: removing
// `withBusyRetry` from `openStore`, or deleting the `db.close()` that runs when
// an attempt throws, left the whole suite green. Both are proved here by
// injecting a real busy into the open and observing what the code does with it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';

import { NEEDS_SQLITE, stateDir, withStore } from './job-helpers.mjs';

/** The shape SQLite raises, as `isBusy` recognises it. */
function busyError() {
  const error = new Error('database is locked');
  error.errcode = 5;
  return error;
}

/**
 * Make the first `n` executions of the exclusive-lock WAL pragma fail busy.
 *
 * That statement is chosen because it is the one that threw in the wild, and
 * because it runs on a first open — so each retried attempt reaches it again,
 * which is what makes the injection count equal the attempt count.
 */
function failWalTimes(DatabaseSync, n) {
  const original = DatabaseSync.prototype.exec;
  const state = { injected: 0, restore: () => { DatabaseSync.prototype.exec = original; } };
  DatabaseSync.prototype.exec = function inject(sql) {
    if (/journal_mode\s*=/i.test(sql) && state.injected < n) {
      state.injected += 1;
      throw busyError();
    }
    return original.call(this, sql);
  };
  return state;
}

test('a busy during the open is RETRIED, not reported', { skip: NEEDS_SQLITE }, async () => {
  // The mutation this exists for: replacing `withBusyRetry(openOnce, …)` with a
  // bare `openOnce()` in `openStore`. Without this witness that edit left 651
  // tests green.
  const state = stateDir();
  const { DatabaseSync } = await import('node:sqlite');
  const injection = failWalTimes(DatabaseSync, 1);
  try {
    // If the retry is gone the busy escapes here and the test fails on the throw
    // — which is the point. The assertion below is about the handle being real.
    const rows = withStore(state, (db) => db.prepare('SELECT COUNT(*) AS n FROM jobs').get());
    assert.equal(injection.injected, 1, 'the injection never fired: this witness is examining nothing');
    assert.equal(rows.n, 0, 'the retried open must hand back a usable, schema-applied handle');
  } finally {
    injection.restore();
    rmSync(state, { recursive: true, force: true });
  }
});

test('each FAILED open attempt closes its handle before retrying', { skip: NEEDS_SQLITE }, async () => {
  // The second surviving mutation: deleting the `try { db.close(); } catch {}`
  // in `openOnce`'s catch. Nothing observed the leak, because a leaked handle
  // still lets every later assertion pass — so this counts instead. Two injected
  // busies mean two attempts that throw, and each owes exactly one close.
  const state = stateDir();
  const { DatabaseSync } = await import('node:sqlite');
  const injection = failWalTimes(DatabaseSync, 2);
  const originalClose = DatabaseSync.prototype.close;
  let closes = 0;
  DatabaseSync.prototype.close = function count() {
    closes += 1;
    return originalClose.call(this);
  };
  try {
    withStore(state, (db) => {
      assert.equal(injection.injected, 2, 'the injection never fired twice: this witness is examining nothing');
      // Read inside the callback, before `withStore`'s own close runs: after it
      // returns the count includes the successful handle's close and can no
      // longer distinguish a leak from a tidy exit.
      assert.equal(closes, 2, 'each attempt that throws must close its handle, or a retried open leaks one per attempt');
      return db;
    });
  } finally {
    DatabaseSync.prototype.close = originalClose;
    injection.restore();
    rmSync(state, { recursive: true, force: true });
  }
});
