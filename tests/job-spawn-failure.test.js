// What happens to the QUEUE when a worker never starts.
//
// The defect this guards is not about the job that failed — it is about every
// job behind it. A rejected spawn used to leave the row `queued` with
// `spawned_at` NULL, which `livenessOf` calls `starting` and `queuedRole` maps to
// `blocks`, so a successor waited out the whole 120s startup grace for a worker
// that, in the usual case, was never coming.
//
// "In the usual case" is not softening. A rejection does not prove no child
// exists — `spawnWorker` can reject while a detached worker is alive — which is
// why the fix uses a compare-and-set. The cases split by ROW SHAPE rather than by
// what any process is doing: this file covers the row no worker REGISTERED against, and
// `job-launch-outcome.test.js` covers the row a waiter already holds. Neither
// case has a second process, and neither needs one — the shape is what the
// compare-and-set reads.
//
// `submitTask` takes an injectable `spawn` for exactly this test. There is no
// other way in: `spawnWorker` is a static import called unparameterised, and the
// existing busy tests only manage injection by monkey-patching a SQLite method,
// which cannot reach a process spawn. Without the seam the central fix has no
// witness at all — and this repo treats a fix nothing can catch reverting as a
// fix that has already half-reverted.
import assert from 'node:assert/strict';
import test from 'node:test';

import { respondJson, startFakeServer, writeConfig } from './helpers.mjs';
import { NEEDS_SQLITE, insertSynthetic, readJobs, stateDir, withStore } from './job-helpers.mjs';
import { TASK_SPEC } from '../scripts/lib/cmd-task.mjs';
import { submitTask } from '../scripts/lib/task-submit.mjs';
import { tryAcquire } from '../scripts/lib/job-queue.mjs';
import { registerWaiter } from '../scripts/lib/job-record.mjs';

/** Answers the probe, then one non-streaming completion. */
function modelsAndChat(id = 'test-model') {
  return (request, response) => {
    if (request.url.includes('/models')) {
      respondJson(response, { data: [{ id, object: 'model' }] });
      return;
    }
    respondJson(response, {
      model: id,
      choices: [{ message: { content: 'the answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    });
  };
}

/** A submission driven in-process, with the environment restored afterwards. */
async function withSubmission(fn) {
  // The env capture sits ABOVE the server start on purpose: the `finally` below
  // restores from it, so it must be in scope no matter where inside the `try` a
  // throw lands. Moving it inside with the rest of the setup would leave the
  // restore reaching for a binding that may not exist.
  const previous = { config: process.env.OAI_PLUGIN_CONFIG, state: process.env.OAI_PLUGIN_STATE };
  const server = await startFakeServer(modelsAndChat());
  // EVERYTHING after the listen is inside the `try`. A throw in `stateDir()` or
  // `writeConfig()` used to escape before `server.close()` could run, leaving a
  // listening handle that keeps the event loop alive — this suite has already
  // lost 204 seconds to that exact class once.
  let state;
  try {
    state = stateDir();
    const { path: configPath } = writeConfig({
      providers: {
        fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 5 },
      },
      defaultProvider: 'fake',
    });
    process.env.OAI_PLUGIN_CONFIG = configPath;
    process.env.OAI_PLUGIN_STATE = state;
    return await fn({ state });
  } finally {
    if (previous.config === undefined) delete process.env.OAI_PLUGIN_CONFIG;
    else process.env.OAI_PLUGIN_CONFIG = previous.config;
    if (previous.state === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous.state;
    await server.close();
  }
}

const submission = { spec: TASK_SPEC, options: { background: true }, inlinePrompt: 'summarise this', terminated: [] };

/**
 * Whether a job queued behind everything else may start.
 *
 * The waiter registration is not ceremony: a queued row with no `waiter_pid` is
 * classified `starting` and BLOCKS ITSELF, so a successor without one reads
 * `blocked` no matter what is ahead of it — and this file would then be
 * measuring its own fixture instead of the fix.
 */
function successorVerdict(state) {
  const seq = insertSynthetic(state, { id: 'successor' });
  return withStore(state, (db) => {
    registerWaiter(db, seq, process.pid, new Date().toISOString());
    return tryAcquire(db, seq, process.pid);
  });
}

test('an unconfirmed launch terminalizes its own UNREGISTERED row and lets the queue move', { skip: NEEDS_SQLITE }, async () => {
  await withSubmission(async ({ state }) => {
    await assert.rejects(
      submitTask(submission, { spawn: () => Promise.reject(new Error('EACCES: permission denied')) }),
      /EACCES/,
      'the spawn error is what reaches the caller, not a storage error raised while recording it',
    );

    const rows = readJobs(state);
    assert.equal(rows.length, 1, 'the row is inserted before the spawn, so it exists to be terminalized');
    assert.equal(rows[0].state, 'failed', 'a worker that never started is not a job that may still start');
    assert.match(JSON.stringify(rows[0]), /worker-launch-unconfirmed/,
      'the reason is DIAGNOSED, never the null this repo reserves for "nothing was determined" — and it claims only what a rejection establishes');
    assert.doesNotMatch(JSON.stringify(rows[0]), /spawn-failed|could not start a worker/,
      'and never asserts the spawn FAILED: a rejection can arrive after the child is alive');

    // The point of the whole item: the job behind it is not held.
    assert.equal(successorVerdict(state), 'acquired', 'a failed spawn must not hold the queue');
  });
});

test('POSITIVE CONTROL: the pre-fix row shape does block a successor', { skip: NEEDS_SQLITE }, async () => {
  // What this control does and does not establish. It does NOT make the test above
  // capable of failing — that test reddens on its own when `terminalizeSpawnFailure`
  // is removed, because the row stays `queued` and its `failed` assertion fails
  // directly. Measured, not assumed.
  //
  // What it establishes is the meaning of the SUCCESSOR assertion, which is the
  // weaker half: `acquired` is also what an empty queue, a broken fixture, or a fix
  // that DELETED the row would return. Only showing the same call return `blocked`
  // against the shape the defect actually left — queued, no waiter, no spawn stamp,
  // inside the grace — makes `acquired` mean the queue moved rather than that
  // nothing was there to hold it.
  await withSubmission(async ({ state }) => {
    insertSynthetic(state, { id: 'never-spawned', state: 'queued', waiterPid: null, agedMs: 0 });
    assert.equal(successorVerdict(state), 'blocked', 'this is the behaviour the fix removes — if this ever reads "acquired", the test above proves nothing');
  });
});

test('a non-busy sweep failure rejects before a row or a worker exists', { skip: NEEDS_SQLITE }, async () => {
  // The sweep still rethrows — that is deliberate, because a --json caller cannot
  // see a stderr warning (OAI-108) and retention would fail silently forever.
  // What changed is WHERE it lands: before anything is created, so a broken
  // sweep costs a retry rather than a job whose worker may already be spending.
  await withSubmission(async ({ state }) => {
    const { DatabaseSync } = await import('node:sqlite');
    const original = DatabaseSync.prototype.prepare;
    let spawned = 0;
    DatabaseSync.prototype.prepare = function inject(sql) {
      if (/DELETE\s+FROM\s+jobs/i.test(sql)) throw new Error('SQLITE_CORRUPT: malformed database schema');
      return original.call(this, sql);
    };

    try {
      await assert.rejects(
        submitTask(submission, { spawn: () => { spawned += 1; return Promise.resolve(1234); } }),
        /SQLITE_CORRUPT/,
        'a defect in the sweep is still raised, never swallowed',
      );
      assert.equal(spawned, 0, 'nothing was spawned: the sweep now runs before the worker exists');
      // The half that would have caught the first draft of this fix, which put the
      // sweep between the insert and the spawn: asserting only the rejection passes
      // against the pre-fix code too.
      assert.deepEqual(readJobs(state), [], 'and no queued orphan was left to block the queue');
      // The plan's final assertion for this case, and not a restatement of the
      // line above: an empty table is consistent with a queue that refuses
      // everyone for some unrelated reason, so the property worth having is that
      // the next job can actually start.
      const seq = insertSynthetic(state, { id: 'successor-after-sweep' });
      const verdict = withStore(state, (db) => {
        registerWaiter(db, seq, process.pid, new Date().toISOString());
        return tryAcquire(db, seq, process.pid);
      });
      assert.equal(verdict, 'acquired', 'a submission that failed before creating anything holds nothing back');
    } finally {
      DatabaseSync.prototype.prepare = original;
    }
  });
});

// The stamp is the LAST thing submission does, and in PRODUCTION it is past the
// point of no return: the `'spawn'` event has fired, so a child was created and
// may already be calling a paid model. So the only question there is whether the
// caller still learns the id.
//
// WHAT THIS FIXTURE ESTABLISHES, which is less. The injected `spawn` resolves a
// number and creates no process, so nothing here witnesses a child being created,
// registering, acquiring or publishing — it witnesses that a resolved spawn
// contract plus a failing stamp still yields the id and the pid to the caller.
// That is the half this test is for; the production ordering above is the reason
// the half matters, not something this asserts.
//
// One thing it does NOT cover, and the gap is recorded rather than papered over:
// deleting the stderr warning in `spawnAndStamp` leaves this test green, so the
// "reported by message" half of the new behaviour has no witness here.
//
// This pairs with the busy case already settled elsewhere. The distinction that
// used to live at this line — busy is survivable, anything else is fatal — was
// wrong in the one direction that costs money: a corrupt database is no more
// recoverable for the user than a locked one, and both leave the same worker
// running with the same id unprinted (OAI-67, review pass 3).
test('a NON-BUSY fault stamping the row still returns the id', { skip: NEEDS_SQLITE }, async () => {
  await withSubmission(async ({ state }) => {
    const { DatabaseSync } = await import('node:sqlite');
    const original = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function inject(sql) {
      // The stamp alone. Injecting on every statement would break the insert too,
      // and the row must exist for this to be the case it claims to be.
      if (/UPDATE\s+jobs\s+SET\s+spawned_at/i.test(sql)) throw new Error('SQLITE_CORRUPT: malformed database schema');
      return original.call(this, sql);
    };

    let returned;
    try {
      const result = await submitTask(submission, { spawn: () => Promise.resolve(4321) });
      returned = result.id;
      assert.ok(result.id, 'the submission RESOLVED rather than rejecting — which is the whole change: in production a child would exist by now, and the id is what the user must not lose');
      assert.equal(result.pid, 4321, 'and the spawn result is carried through rather than discarded — pid plumbing, not evidence of a live process');
    } finally {
      DatabaseSync.prototype.prepare = original;
    }

    // The row is still there and still queued: the stamp failed, nothing else did.
    // Without this, the test above would also pass against an implementation that
    // swallowed the fault by abandoning the job.
    const [row] = readJobs(state);
    assert.equal(row.state, 'queued', 'the job was not written off because its start time could not be recorded');
    assert.equal(row.spawned_at, null, 'and the stamp really did fail — otherwise this test proves nothing');
    // The id must be the ROW's id, not merely truthy: a fabricated handle would
    // satisfy `ok()` while leaving the user nothing to poll.
    assert.equal(returned, row.id, 'and the handle returned is the one that was persisted');
  });
});

// The guard on the WARNING, not on the write it reports.
//
// `spawnAndStamp` reports a failed stamp on stderr and then returns the id. If
// that report can throw — a closed or destroyed pipe is enough — it stops the
// function returning, and the id is lost: exactly the harm the catch exists to
// prevent, delivered by the reporting of it. Unwrapping the guard leaves every
// other test in this file green, which is why this one exists.
test('a stderr that throws does not cost the caller its id', { skip: NEEDS_SQLITE }, async () => {
  await withSubmission(async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const originalPrepare = DatabaseSync.prototype.prepare;
    const originalWrite = process.stderr.write;
    DatabaseSync.prototype.prepare = function inject(sql) {
      if (/UPDATE\s+jobs\s+SET\s+spawned_at/i.test(sql)) throw new Error('SQLITE_CORRUPT: malformed database schema');
      return originalPrepare.call(this, sql);
    };
    // Only THIS message throws. `submitTask` writes the endpoint notice and the
    // ETA to stderr before it ever spawns, so a stderr that throws for everything
    // fails the submission earlier and the test would pass for the wrong reason —
    // it did exactly that on the first attempt. Restored in a `finally` that
    // cannot be skipped: a stderr left throwing takes the whole run with it.
    process.stderr.write = function guarded(chunk, ...rest) {
      if (typeof chunk === 'string' && chunk.includes('start time could not be recorded')) {
        throw new Error('EPIPE: broken pipe');
      }
      return originalWrite.call(this, chunk, ...rest);
    };
    try {
      const result = await submitTask(submission, { spawn: () => Promise.resolve(4321) });
      assert.ok(result.id, 'the id survived a report that could not be delivered');
    } finally {
      process.stderr.write = originalWrite;
      DatabaseSync.prototype.prepare = originalPrepare;
    }
  });
});
