// A contended database must not destroy work that has already been paid for.
//
// Every witness here drives a path where a `SQLITE_BUSY` really is raised, not
// one where the code merely could have handled one. That distinction is the
// whole file: a test that composes the retry helper itself would stay green if
// every call site's wrapping were deleted, which is the one thing these are for.
// The heartbeat's witnesses live in `job-busy-heartbeat.test.js`, which needs a
// child process to observe what it observes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync } from 'node:fs';

import { NEEDS_SQLITE, insertSynthetic, queueScenario, stateDir, withStore } from './job-helpers.mjs';

/** The shape SQLite raises, as `isBusy` recognises it. */
function busyError() {
  const error = new Error('database is locked');
  error.errcode = 5;
  return error;
}

test('openStore does not re-set WAL on a database that is already WAL', { skip: NEEDS_SQLITE }, async () => {
  // The actual fix for the third defect, not its symptom. `PRAGMA journal_mode
  // = WAL` takes an EXCLUSIVE lock and has thrown "database is locked" three
  // times in the wild — at the line whose comment claimed the preceding
  // busy_timeout made every later statement wait. The mode persists in the
  // file, so the statement is needed on the first open and on no other; the
  // common path now stops taking the lock rather than waiting on it.
  const state = stateDir();
  const { DatabaseSync } = await import('node:sqlite');
  try {
    withStore(state, () => {}); // first open ever: this one legitimately sets WAL

    const statements = [];
    const original = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function record(sql) {
      statements.push(sql);
      return original.call(this, sql);
    };
    try {
      withStore(state, () => {});
    } finally {
      // Restored in a `finally`, or a failing assertion leaves every later test
      // in this process running against an instrumented driver.
      DatabaseSync.prototype.exec = original;
    }

    assert.ok(statements.length > 0, 'the instrumentation caught nothing: this guard is examining nothing');
    assert.deepEqual(
      statements.filter((sql) => /journal_mode\s*=/i.test(sql)),
      [],
      'a second open must not re-execute the exclusive-lock WAL pragma',
    );

    // The open's budget is only a bound if no single attempt can outlast it.
    // Measured: at the handle's 10s timeout, one contended `CREATE TABLE` blocks
    // 10755ms — past the 5s budget — so `withBusyRetry` gives up having never
    // retried once. A short timeout during the open is what makes the retry loop
    // govern; the long one is restored before the handle is returned, because a
    // caller's own statements have no retry around them.
    const timeouts = statements.filter((sql) => /busy_timeout/i.test(sql));
    assert.equal(timeouts.length, 2, 'the open must set a busy_timeout twice: short to open, long to hand over');
    assert.match(timeouts[0], /busy_timeout\s*=\s*250\b/, 'the FIRST must be short, or one attempt can outlast the whole budget');
    assert.match(timeouts[1], /busy_timeout\s*=\s*10000\b/, 'the LAST must be long: it is what every caller statement inherits');
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('the FAILED terminal write survives a transient busy', { skip: NEEDS_SQLITE }, async () => {
  // Driven through `runTaskWorker` — the worker's own entry point — rather than
  // by composing `withBusyRetry` here. A witness that wraps the call itself
  // proves only that the helper works, which the three tests above already
  // prove, and it would stay green if the wrapping at the call site were
  // deleted. That is the single thing this is for.
  //
  // The job's transport is unreachable by construction, so the model call fails
  // and the worker takes its FAILED terminal write — the same `finish` call
  // site, reached without a server.
  const state = stateDir();
  const previous = process.env.OAI_PLUGIN_STATE;
  const { DatabaseSync } = await import('node:sqlite');
  const original = DatabaseSync.prototype.prepare;
  let injected = 0;
  try {
    // Queued with no waiter, so `registerWaiter` accepts this process and the
    // worker really runs; a row already `running` makes it bail before `finish`.
    const seq = insertSynthetic(state, { id: 'busy-terminal' });
    process.env.OAI_PLUGIN_STATE = state;

    // Only the terminal write, and only once. `completed_at = ?` appears in no
    // other statement in this repo, so the beat, the queue and the schema are
    // untouched — a blanket injection would prove nothing about which call site
    // recovered.
    DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
      if (injected === 0 && /completed_at\s*=\s*\?/.test(sql)) {
        injected += 1;
        throw busyError();
      }
      return original.call(this, sql, ...rest);
    };

    const { runTaskWorker } = await import('../scripts/lib/cmd-task-worker.mjs');
    // It rethrows the model failure after recording it; the recording is what is
    // under test, so the throw is expected and swallowed here.
    await assert.rejects(() => runTaskWorker(['--seq', String(seq)]));
  } finally {
    DatabaseSync.prototype.prepare = original;
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }

  assert.equal(injected, 1, 'the busy was never injected: this guard is examining nothing');
  const row = withStore(state, (db) => db.prepare("SELECT state FROM jobs WHERE id = 'busy-terminal'").get());
  assert.equal(row.state, 'failed', 'a transient busy must not lose a terminal verdict');
  rmSync(state, { recursive: true, force: true });
});

test('the COMPLETED terminal write survives a transient busy', { skip: NEEDS_SQLITE }, async () => {
  // The headline case, and the only witness that reaches it: the model has
  // ALREADY ANSWERED when the lock is hit. The failed-path witness above cannot
  // stand in for it — reverting the wrapping around the *completed* write leaves
  // that one green, so without this the defect's whole reason for existing has no
  // guard. A real server is therefore part of the fixture: an unreachable
  // transport can only ever produce the failure path.
  const scenario = await queueScenario();
  const { DatabaseSync } = await import('node:sqlite');
  const original = DatabaseSync.prototype.prepare;
  const previous = process.env.OAI_PLUGIN_STATE;
  let injected = 0;
  try {
    const seq = insertSynthetic(scenario.state, { id: 'busy-completed' });
    // The synthetic row's transport points at a closed port by construction.
    // Redirected to the live fake server so the chat succeeds and the worker
    // reaches its completed write.
    withStore(scenario.state, (db) =>
      db.prepare('UPDATE jobs SET transport = ? WHERE seq = ?')
        .run(JSON.stringify({ name: 'fake', baseUrl: `${scenario.server.baseUrl}/v1`, query: '' }), seq));
    process.env.OAI_PLUGIN_STATE = scenario.state;

    DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
      if (injected === 0 && /completed_at\s*=\s*\?/.test(sql)) {
        injected += 1;
        throw busyError();
      }
      return original.call(this, sql, ...rest);
    };

    const { runTaskWorker } = await import('../scripts/lib/cmd-task-worker.mjs');
    await runTaskWorker(['--seq', String(seq)]);
  } finally {
    DatabaseSync.prototype.prepare = original;
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
    await scenario.server.close();
  }

  assert.equal(injected, 1, 'the busy was never injected: this guard is examining nothing');
  const row = withStore(scenario.state, (db) => db.prepare("SELECT state, outcome FROM jobs WHERE id = 'busy-completed'").get());
  assert.equal(row.state, 'completed', 'a transient busy discarded an answer the model had already produced');
  assert.match(row.outcome, /"content"\s*:\s*"ok"/, 'the answer itself must survive, not merely the state');
});

test('a busy beat in the QUEUE wait loop does not kill a waiting worker', { skip: NEEDS_SQLITE }, async () => {
  // The fourth site. A worker waiting its turn has sent nothing, so the cost of
  // losing it is smaller than the other three — but it is still a job that
  // silently never runs, and the loop is its own retry, so the tick is skipped
  // exactly as the heartbeat's is.
  const state = stateDir();
  const { DatabaseSync } = await import('node:sqlite');
  const original = DatabaseSync.prototype.prepare;
  const previous = process.env.OAI_PLUGIN_STATE;
  let injected = 0;
  try {
    // A live holder — this process's own pid, so the liveness check really finds
    // it — and the waiter behind it, which is the job under test.
    insertSynthetic(state, { id: 'holder', state: 'running', workerPid: process.pid, waiterPid: process.pid, beatAgoMs: 0 });
    const seq = insertSynthetic(state, { id: 'waiter' });
    process.env.OAI_PLUGIN_STATE = state;
    const { openStore } = await import('../scripts/lib/job-store.mjs');
    const { awaitTurn } = await import('../scripts/lib/job-queue.mjs');
    const { jobBySeq, registerWaiter } = await import('../scripts/lib/job-record.mjs');
    const db = openStore();
    try {
      registerWaiter(db, seq, process.pid, new Date().toISOString());
      // `SET last_beat_at = ?` is the beat and nothing else — `registerWaiter`
      // and the acquire both write it alongside a pid, so neither matches.
      DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
        if (injected === 0 && /SET last_beat_at = \?/.test(sql)) {
          injected += 1;
          // Released as the tick is skipped, so the very next attempt acquires
          // and the loop is bounded by the mechanism under test rather than by a
          // timeout.
          original.call(this, "UPDATE jobs SET state = 'completed' WHERE id = 'holder'", ...rest).run();
          throw busyError();
        }
        return original.call(this, sql, ...rest);
      };
      const verdict = await awaitTurn(db, jobBySeq(db, seq), process.pid, { pollMs: 5 });
      assert.equal(verdict, 'acquired', 'a contended beat must not stop a waiting worker taking its turn');
    } finally {
      DatabaseSync.prototype.prepare = original;
      db.close();
    }
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }

  assert.equal(injected, 1, 'the busy was never injected: this guard is examining nothing');
  rmSync(state, { recursive: true, force: true });
});

test('the QUEUE-TIMEOUT terminal write survives a transient busy', { skip: NEEDS_SQLITE }, async () => {
  // The third terminal write, and the one contention is likeliest to meet: it is
  // reached only while another job is running, so a competing worker is beating
  // throughout. Unwrapped, the busy escaped `awaitTurn` — which the worker awaits
  // OUTSIDE its try — so the diagnosed verdict and its hint were lost and
  // reconciliation later reported `worker-died` instead.
  const state = stateDir();
  const { DatabaseSync } = await import('node:sqlite');
  const original = DatabaseSync.prototype.prepare;
  const previous = process.env.OAI_PLUGIN_STATE;
  let injected = 0;
  try {
    insertSynthetic(state, { id: 'holder', state: 'running', workerPid: process.pid, waiterPid: process.pid, beatAgoMs: 0 });
    const seq = insertSynthetic(state, { id: 'timing-out', agedMs: 60_000 });
    // A cap already elapsed at submission, so the first blocked poll expires it.
    withStore(state, (db) => db.prepare('UPDATE jobs SET max_wait_ms = 1 WHERE seq = ?').run(seq));
    process.env.OAI_PLUGIN_STATE = state;

    const { openStore } = await import('../scripts/lib/job-store.mjs');
    const { awaitTurn } = await import('../scripts/lib/job-queue.mjs');
    const { jobBySeq, registerWaiter } = await import('../scripts/lib/job-record.mjs');
    const db = openStore();
    try {
      registerWaiter(db, seq, process.pid, new Date().toISOString());
      DatabaseSync.prototype.prepare = function inject(sql, ...rest) {
        if (injected === 0 && /completed_at\s*=\s*\?/.test(sql)) {
          injected += 1;
          throw busyError();
        }
        return original.call(this, sql, ...rest);
      };
      const verdict = await awaitTurn(db, jobBySeq(db, seq), process.pid, { pollMs: 5 });
      assert.equal(verdict, 'queue-timeout', 'a transient busy must not cost the job its diagnosed verdict');
    } finally {
      DatabaseSync.prototype.prepare = original;
      db.close();
    }
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }

  assert.equal(injected, 1, 'the busy was never injected: this guard is examining nothing');
  const row = withStore(state, (db) => db.prepare("SELECT state, failure FROM jobs WHERE id = 'timing-out'").get());
  assert.equal(row.state, 'queue-timeout');
  assert.match(row.failure, /queue-timeout/, 'the actionable hint must survive too, not just the state');
  rmSync(state, { recursive: true, force: true });
});
