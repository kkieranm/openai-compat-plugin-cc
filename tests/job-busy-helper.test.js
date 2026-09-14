// The retry helper's own contract, apart from the call-site witnesses.
//
// These are the only tests in the set allowed to call `withBusyRetry` directly:
// they establish what the helper promises. A CALL SITE proved this way would be
// worthless — it would stay green with every wrapping deleted — so those live in
// `job-busy.test.js` and drive the real entry points instead.
import assert from 'node:assert/strict';
import test from 'node:test';

import { isBusy, withBusyRetry } from '../scripts/lib/job-busy.mjs';

/** The shape SQLite raises, as `isBusy` recognises it. */
function busyError() {
  const error = new Error('database is locked');
  error.errcode = 5;
  return error;
}

test('withBusyRetry rethrows a non-busy error on the first attempt', () => {
  let calls = 0;
  assert.throws(
    () =>
      withBusyRetry(() => {
        calls += 1;
        throw new Error('not contention');
      }),
    /not contention/,
  );
  // The count is the point: a retried non-busy error would waste the budget
  // waiting for something that will never clear.
  assert.equal(calls, 1, 'a non-busy error must not be retried');
});

test('withBusyRetry gives up on the elapsed budget and rethrows the busy error', () => {
  let calls = 0;
  const started = Date.now();
  assert.throws(
    () =>
      withBusyRetry(
        () => {
          calls += 1;
          throw busyError();
        },
        { budgetMs: 30, delayMs: 5 },
      ),
    (error) => isBusy(error),
  );
  assert.ok(calls > 1, 'it must have retried at least once before giving up');
  // A floor, never a ceiling — the helper's own doc comment says so, and an
  // assertion on an upper bound would be asserting the guarantee it disclaims.
  assert.ok(Date.now() - started >= 30, 'it must not give up before the budget elapses');
});

test('withBusyRetry returns the value once a transient busy clears', () => {
  let calls = 0;
  const value = withBusyRetry(
    () => {
      calls += 1;
      if (calls < 3) throw busyError();
      return 'answered';
    },
    { budgetMs: 5_000, delayMs: 1 },
  );
  assert.equal(value, 'answered');
  assert.equal(calls, 3);
});
