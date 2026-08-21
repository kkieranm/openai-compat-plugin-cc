// What the queue does with rows it did not write: a foreign plugin's version, a
// shape this build cannot produce, and a submission whose worker never came.
//
// Every case here is a wedge if it is decided the other way — a row that blocks
// forever, or a live job destroyed by a build that could not read it. They are
// driven through the real worker against synthetic rows rather than argued
// about, because the two failures look identical from the outside until one of
// them eats a job.
import assert from 'node:assert/strict';
import test from 'node:test';
import { abandonDecision } from '../scripts/lib/job-abandon.mjs';
import { livenessOf } from '../scripts/lib/job-liveness.mjs';
import { renderList } from '../scripts/lib/job-render.mjs';
import { registerWaiter } from '../scripts/lib/job-record.mjs';
import { statusView } from '../scripts/lib/job-view.mjs';
import { NEEDS_SQLITE, deadPid, insertSynthetic, queueScenario, readJob, stateDir, waitForState, withStore } from './job-helpers.mjs';
import { STARTUP_GRACE_MS } from '../scripts/lib/job-liveness.mjs';

const THREE_MINUTES = 180_000;

/** Submit one background job and wait for wherever it ends up. */
async function submitAndSettle(scenario, extra = []) {
  const submit = await scenario.submit(extra);
  assert.equal(submit.status, 0, submit.stderr);
  return waitForState(scenario.state, submit.stdout.trim(), ['completed', 'failed', 'queue-timeout']);
}

test('a running row with no pid blocks the queue rather than being guessed at', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // This build writes state and pid in one statement, so only a legacy or
    // corrupt writer produces this. It fails closed: something may be running.
    insertSynthetic(scenario.state, { id: 'malformed', state: 'running', workerPid: null });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout');
    assert.equal(scenario.chats().length, 0, 'nothing may run past a blocker this build cannot interpret');
    assert.equal(readJob(scenario.state, 'malformed').state, 'running', 'the malformed row must be left alone');
  } finally {
    await scenario.server.close();
  }
});

test('a dead running row from a newer plugin neither blocks nor gets written to', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The self-contradiction that would wedge the queue permanently: it counts
    // as a blocker, and the versioning rule forbids reconciling it away.
    const pid = await deadPid();
    insertSynthetic(scenario.state, { id: 'foreign', state: 'running', version: 99, workerPid: pid });

    const settled = await submitAndSettle(scenario);
    assert.equal(settled.state, 'completed', JSON.stringify(settled.failure));

    const foreign = readJob(scenario.state, 'foreign');
    assert.equal(foreign.state, 'running', 'a newer version’s row must not be terminalized');
    assert.equal(foreign.worker_pid, pid);
    assert.equal(foreign.completed_at, null);
  } finally {
    await scenario.server.close();
  }
});

test('a queued row from a newer plugin blocks while its waiter lives', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // A real worker is waiting on it; we simply cannot read its payload. Going
    // around it would run two jobs at once as soon as its turn came.
    insertSynthetic(scenario.state, { id: 'foreign-live', version: 99, waiterPid: process.pid });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout');
    assert.equal(scenario.chats().length, 0);
    assert.equal(readJob(scenario.state, 'foreign-live').state, 'queued');
  } finally {
    await scenario.server.close();
  }
});

test('a queued row from a newer plugin is skipped, untouched, once its waiter is gone', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const pid = await deadPid();
    insertSynthetic(scenario.state, { id: 'foreign-dead', version: 99, waiterPid: pid });

    const settled = await submitAndSettle(scenario);
    assert.equal(settled.state, 'completed', JSON.stringify(settled.failure));

    // Skipped is not abandoned: the queue moved past it and changed nothing.
    const foreign = readJob(scenario.state, 'foreign-dead');
    assert.equal(foreign.state, 'queued');
    assert.equal(foreign.waiter_pid, pid);
  } finally {
    await scenario.server.close();
  }
});

test('a submission whose worker never arrived is failed once the grace has passed', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The submitter died between committing the row and spawning the child.
    insertSynthetic(scenario.state, { id: 'orphan', agedMs: THREE_MINUTES, waiterPid: null });

    const settled = await submitAndSettle(scenario);
    assert.equal(settled.state, 'completed', 'an orphan must not hold the queue forever');

    const orphan = readJob(scenario.state, 'orphan');
    assert.equal(orphan.state, 'failed');
    assert.equal(orphan.failure.reason, 'worker-never-started');
  } finally {
    await scenario.server.close();
  }
});

test('a worker that registered is never abandoned, however long it waits', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Three minutes past a two-minute grace, and still legitimate: the grace
    // bounds publication-to-registration, nothing else. Reading it as a
    // deadline on waiting would fail every job queued behind a long run, which
    // is the feature this queue exists for.
    insertSynthetic(scenario.state, { id: 'patient', agedMs: THREE_MINUTES, waiterPid: process.pid });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout', 'a registered waiter still holds the head of the queue');

    const patient = readJob(scenario.state, 'patient');
    assert.equal(patient.state, 'queued', 'a registered worker past the grace must not be collected');
    assert.equal(patient.waiter_pid, process.pid);
  } finally {
    await scenario.server.close();
  }
});

test('a running row with an UNREADABLE pid blocks the queue rather than being collected', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The shape OAI-162 was filed about. `'garbage'` reaches the column because
    // the jobs table is not STRICT, so INTEGER is an affinity rather than a
    // constraint and a foreign writer's TEXT value lands verbatim. Before the
    // fix this read as `dead` — no OS probe was even attempted — and
    // reconciliation terminalized the row on that.
    insertSynthetic(scenario.state, { id: 'unreadable', state: 'running', workerPid: 'garbage' });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout');
    assert.equal(scenario.chats().length, 0, 'nothing may run past a pid this build cannot read');

    const row = readJob(scenario.state, 'unreadable');
    assert.equal(row.state, 'running', 'a row whose owner could not be established must be left alone');
    assert.equal(row.worker_pid, 'garbage', 'the recorded value is evidence and must survive');
    assert.equal(row.completed_at, null);
  } finally {
    await scenario.server.close();
  }
});

test('a queued row with an UNREADABLE waiter pid is not skipped, and takes no new registration', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // `2 ** 40` is
    // a plausible-looking positive integer no OS will ever hand out, so before
    // the fix this row was skipped and reconciled away.
    const seq = insertSynthetic(scenario.state, { id: 'unreadable-queued', waiterPid: 2 ** 40 });

    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout');
    assert.equal(readJob(scenario.state, 'unreadable-queued').state, 'queued', 'it must not be collected');

    // The permanence claim, executed rather than asserted in prose. Every message
    // about this shape rests on it: `registerWaiter` carries `AND waiter_pid IS
    // NULL`, so no worker can ever take this row — and no automatic path collects
    // it either, which leaves `/oai:abandon --force` as the operator's way out
    // rather than the only thing that can end it: a worker that registered before
    // the corruption can still time the row out.
    const attached = withStore(scenario.state, (db) => registerWaiter(db, seq, process.pid, new Date().toISOString()));
    assert.equal(attached, false, 'no worker may attach to a row that already holds an unreadable pid');
  } finally {
    await scenario.server.close();
  }
});

test('a newer plugin\'s row with an UNREADABLE pid wedges this build, and names the schema it carries', { skip: NEEDS_SQLITE }, async () => {
  // **This pins an exception, not a guarantee, and it sits beside the rule it
  // contradicts on purpose.** The rule above is that a newer plugin's row neither
  // blocks nor gets written to. That holds while its pid is READABLE — a dead one
  // is skipped. An unreadable pid makes it `malformed` instead, which blocks; and
  // `abandonDecision` refuses an unknown `schema_version` at its FIRST rung,
  // above liveness, which no flag lifts. So this build can neither run past the
  // row nor write it off.
  //
  // That combination already existed for a newer row with no pid at all; OAI-162
  // extends it to this input, and removing it is queue-core work filed separately.
  // What ships here is that the row SAYS which schema it carries, because the
  // note that used to carry that number is no longer the one it reaches. It does
  // not say which build can clear it — see the last assertion for why.
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, { id: 'skewed', state: 'running', version: 99, workerPid: 'garbage' });

    // (1) the verdict, and (2) that it blocks, end to end.
    assert.equal(withStore(scenario.state, (db) => livenessOf(readJob(scenario.state, 'skewed'), Date.now())), 'malformed');
    const settled = await submitAndSettle(scenario, ['--max-wait', '1']);
    assert.equal(settled.state, 'queue-timeout');
    assert.equal(scenario.chats().length, 0, 'nothing may run past a row this build cannot interpret');

    // (3) and no flag lifts it.
    const now = Date.now();
    const row = readJob(scenario.state, 'skewed');
    assert.deepEqual(abandonDecision(row, now, { override: true }), { allowed: false, reason: 'unknown-version' });

    // (4) THE POSITIVE CONTROL, same run: the identical row at a version this
    // build knows IS liftable. Without it, (3) passes against a build that
    // refuses everything, since `unknown-version` is tested before liveness.
    assert.deepEqual(
      abandonDecision({ ...row, schema_version: 1 }, now, { override: true }),
      { allowed: true, reason: 'forced-malformed' },
    );

    // (6) and the row names the build that can clear it.
    const note = withStore(scenario.state, (db) => renderList(statusView(db, { cwd: '/tmp/nowhere', all: true }), { cwd: '/tmp/nowhere', all: true }));
    assert.match(note, /cannot be read as a pid/);
    assert.match(note, /row schema is 99/);
    assert.match(note, /neither collect nor write off this row/);
    // It names the schema and stops. Promising that some other build can clear it
    // would be unsatisfiable when the schema column itself holds a non-number,
    // which the same foreign writer can produce.
    assert.doesNotMatch(note, /use that one|is what can/);
  } finally {
    await scenario.server.close();
  }
});

test('a newer plugin\'s row with a READABLE dead pid still skips, and says nothing about schemas twice', { skip: NEEDS_SQLITE }, async () => {
  // (5) The NEGATIVE control for the test above: the same foreign version, with a
  // pid the OS can answer for, must still be skipped rather than wedge — that is
  // the invariant the exception is an exception TO, and asserting the exception
  // without it would not show they are different rows.
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, { id: 'skewed-dead', version: 99, waiterPid: await deadPid() });

    const settled = await submitAndSettle(scenario);
    assert.equal(settled.state, 'completed', JSON.stringify(settled.failure));
    assert.equal(readJob(scenario.state, 'skewed-dead').state, 'queued', 'a newer version\'s row is never written to');
  } finally {
    await scenario.server.close();
  }
});

test('a row THIS build understands is not told a newer plugin wrote it', { skip: NEEDS_SQLITE }, () => {
  // The negative control for the version clause above, and it lives here rather
  // than in the render suite because this is the only file with a version-99
  // fixture to control against. Without it the `isKnownVersion` guard is unpinned:
  // deleting it would make every malformed row claim a schema it does not have,
  // and nothing in the suite would go red.
  //
  // Both arms are asserted, because the guard could also break one-sided — the
  // clause is appended in two places, once per state.
  const state = stateDir();
  insertSynthetic(state, { id: 'ours-running', state: 'running', workerPid: 'garbage' });
  insertSynthetic(state, { id: 'ours-queued', waiterPid: 'garbage' });
  insertSynthetic(state, { id: 'theirs-running', state: 'running', version: 99, workerPid: 'garbage' });

  const text = withStore(state, (db) => renderList(statusView(db, { cwd: '/tmp/nowhere', all: true }), { cwd: '/tmp/nowhere', all: true }));
  const lineFor = (id) => text.split('\n').find((line, i, all) => all[i - 1]?.startsWith(id) && line.includes('malformed:'));

  assert.doesNotMatch(lineFor('ours-running'), /row schema/, 'this build wrote schema 1');
  assert.doesNotMatch(lineFor('ours-queued'), /row schema/, 'and the queued arm appends the clause too');
  // The positive control, same render: the foreign row DOES carry it.
  assert.match(lineFor('theirs-running'), /row schema is 99/);
});

/**
 * OAI-160 case B, made deterministic: `reconcileAll` and `viewOf` each probe
 * liveness separately, so a row can be fine at the first probe and dead by the
 * second — a real timing race this repo's black-box CLI harness has no seam to
 * force. Calling `renderList`/`statusView` directly, on a row seeded straight
 * into the store, skips `reconcileAll` entirely — which is exactly what a row
 * that died AFTER reconciliation observed it alive would look like by render
 * time, without needing to land the actual race.
 */
test('a known-schema dead row on a writable database is not blamed on a version or a worker it does not have', { skip: NEEDS_SQLITE }, async () => {
  const state = stateDir();
  insertSynthetic(state, { id: 'raced-dead', state: 'running', workerPid: await deadPid() });

  const text = withStore(state, (db) => renderList(statusView(db, { cwd: '/tmp', all: true }), { cwd: '/tmp', all: true, readOnly: false }));

  assert.doesNotMatch(text, /written by a newer plugin/, 'the row is not foreign');
  assert.doesNotMatch(text, /database itself was written by a newer version/, 'the database is writable, not too new');
  assert.match(text, /schema \(1\) is understood/);
});

test('a known-schema never-started row on a writable database is not blamed on a worker that never existed', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // Queued, no pid ever registered, aged past STARTUP_GRACE_MS: livenessOf
  // reads this as 'never-started' with no worker to have changed state at all.
  insertSynthetic(state, { id: 'raced-never-started', agedMs: STARTUP_GRACE_MS + 1000 });

  const text = withStore(state, (db) => renderList(statusView(db, { cwd: '/tmp', all: true }), { cwd: '/tmp', all: true, readOnly: false }));

  assert.doesNotMatch(text, /written by a newer plugin/, 'the row is not foreign');
  assert.doesNotMatch(text, /database itself was written by a newer version/, 'the database is writable, not too new');
  assert.doesNotMatch(text, /worker likely changed state/, 'a never-started row has no worker to have changed state');
  assert.match(text, /schema \(1\) is understood/);
});
