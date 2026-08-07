// The heartbeat's half of "a contended database must not kill live work".
//
// Split from `job-busy.test.js` on the shape of the witness rather than to fit a
// budget: every test here runs in a CHILD PROCESS, because the defect under test
// is process death and `node:test` cannot let an in-process uncaught exception
// report as a pass.
//
// No `NEEDS_SQLITE` skip, and that is a property rather than an omission: every
// witness here drives `startHeartbeat` against a hand-written `db` object, so
// nothing in this file imports `node:sqlite` at any depth and it runs on a
// runtime that does not have it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const HEARTBEAT = fileURLToPath(new URL('../scripts/lib/job-heartbeat.mjs', import.meta.url));
const run = promisify(execFile);

/**
 * Run a heartbeat scenario in a CHILD process and report how it ended.
 *
 * A child rather than an assertion in this process, because the defect under
 * test IS process death: a throw inside a `setInterval` callback is an uncaught
 * exception with nowhere to go. `node:test` intercepts uncaught exceptions and
 * fails the test that raised them, so asserting in-process would report the
 * expected outcome as a failure — the check would be unable to pass for the
 * right reason.
 */
async function heartbeatChild(body) {
  const source = `
    import { startHeartbeat } from ${JSON.stringify(HEARTBEAT)};
    const busy = () => { const e = new Error('database is locked'); e.errcode = 5; throw e; };
    ${body}
    const hold = setInterval(() => {}, 5);
    setTimeout(() => { stop(); clearInterval(hold); console.log('SURVIVED'); }, 120);
  `;
  try {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', source]);
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}


test('a busy beat skips the tick instead of killing the worker', async () => {
  // The original defect, inverted. Before the fix this exact scenario exited 1
  // and never printed SURVIVED — the worker died mid-model-call and the request
  // in flight was discarded.
  const result = await heartbeatChild(`
    const db = { prepare: busy };
    let cancels = 0;
    const stop = startHeartbeat(db, 1, { intervalMs: 5, onCancel: () => { cancels += 1; } });
    process.on('exit', () => { if (cancels !== 0) { console.log('CANCELLED'); } });
  `);
  assert.equal(result.code, 0, `a contended database killed the worker: ${result.stderr}`);
  assert.match(result.stdout, /SURVIVED/);
  assert.doesNotMatch(result.stdout, /CANCELLED/, 'a skipped tick must never be read as a cancellation');
});

// The two catches are controlled SEPARATELY, and the reason is a measurement:
// with one shared control that threw on every statement, widening EITHER catch
// left the test green — the other one still rethrew and still killed the process.
// A single control cannot pin two catches, so it was a check that could not fail
// for the thing it was named after. One per catch, each throwing on its own
// statement and leaving the other working.
for (const [what, match] of [['BEAT', 'last_beat_at'], ['CANCELLATION READ', 'cancel_requested_at']]) {
  test(`a NON-busy error from the ${what} is not swallowed`, async () => {
    // Without these, the fix above is satisfied by a blanket catch — which would
    // bury a real defect inside a timer nobody is watching, forever.
    const result = await heartbeatChild(`
      const db = { prepare(sql) {
        if (String(sql).includes(${JSON.stringify(match)})) throw new Error('boom');
        return { run() {}, get: () => ({}) };
      } };
      const stop = startHeartbeat(db, 1, { intervalMs: 5 });
    `);
    assert.notEqual(result.code, 0, 'a non-busy error must still kill the worker: it is a defect, not contention');
    assert.match(result.stderr, /boom/);
  });
}

test('a throw from onCancel is not swallowed by the busy catch', async () => {
  // `onCancel` is invoked OUTSIDE the catch on purpose: a cancellation lost in
  // silence is worse than a callback defect made visible.
  const result = await heartbeatChild(`
    const db = { prepare: () => ({ run() {}, get: () => ({ cancel_requested_at: '2026-01-01T00:00:00.000Z' }) }) };
    const stop = startHeartbeat(db, 1, { intervalMs: 5, onCancel() { throw new Error('cancel-callback-defect'); } });
  `);
  assert.notEqual(result.code, 0, 'a defective onCancel must not be hidden by the busy catch');
  assert.match(result.stderr, /cancel-callback-defect/);
});

test('a busy BEAT does not suppress the cancellation read', async () => {
  // The two operations are independent, and in WAL mode a reader does not block
  // behind a writer — so a contended beat must not cost the tick its only chance
  // to notice a cancellation. Shared one try block until this test existed.
  const result = await heartbeatChild(`
    const db = { prepare(sql) {
      if (String(sql).includes('last_beat_at')) return busy();
      return { run() {}, get: () => ({ cancel_requested_at: '2026-01-01T00:00:00.000Z' }) };
    } };
    let cancels = 0;
    const stop = startHeartbeat(db, 1, { intervalMs: 5, onCancel: () => { cancels += 1; } });
    process.on('exit', () => { if (cancels > 0) { console.log('CANCELLED'); } });
  `);
  assert.equal(result.code, 0, `the worker died: ${result.stderr}`);
  assert.match(result.stdout, /CANCELLED/, 'a busy beat must not hide a cancellation the read could see');
});

test('a busy cancellation READ is not reported as "no cancel"', async () => {
  // The control for the test above. Splitting the catches must not turn a read
  // that FAILED into a confident "nobody cancelled": the tick simply does not
  // know, and says so by leaving `cancelled` false — while the worker survives to
  // ask again five seconds later.
  const result = await heartbeatChild(`
    const db = { prepare(sql) {
      if (String(sql).includes('last_beat_at')) return { run() {} };
      return busy();
    } };
    let cancels = 0;
    const stop = startHeartbeat(db, 1, { intervalMs: 5, onCancel: () => { cancels += 1; } });
    process.on('exit', () => { if (cancels > 0) { console.log('CANCELLED'); } });
  `);
  assert.equal(result.code, 0, `a contended cancellation read killed the worker: ${result.stderr}`);
  assert.match(result.stdout, /SURVIVED/);
  assert.doesNotMatch(result.stdout, /CANCELLED/, 'a read that failed must never be acted on as a cancellation');
});
