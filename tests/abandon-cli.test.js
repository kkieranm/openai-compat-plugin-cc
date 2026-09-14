// `/oai:abandon` as an operator actually invokes it.
//
// Split from `abandon.test.js`, which owns the decision and the transaction.
// This file owns everything between the argv and the terminal: which invocation
// forms work, what is printed, and what the exit code is. That split is not
// tidiness — the module was fully tested and the COMMAND was not, and the first
// review of this feature found a flag that could not be passed at all through
// the invocation its own markdown documented. A unit test of the decision could
// never have caught it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { abandonDecision } from '../scripts/lib/job-abandon.mjs';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, readJob } from './job-helpers.mjs';
import { breakStamps } from './blocker-helpers.mjs';

const STALE = 90_000;
const FRESH = 1_000;

/** A running row held by this test process — alive, and provably not our worker. */
function wedge(state, overrides = {}) {
  return insertSynthetic(state, {
    id: 'wedged', state: 'running', workerPid: process.pid, startedAgoMs: 600_000, beatAgoMs: STALE, ...overrides,
  });
}

test('a stale row is written off, and the reply names the overlap it just allowed', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    wedge(scenario.state);

    const { status, stdout } = await scenario.run(['abandon', 'wedged']);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /written off as failed \(operator-abandoned\)/);
    assert.match(stdout, /Nothing was signalled/);
    // The mutual-exclusion cost, stated to the person who just incurred it. The
    // restraint alone ("nothing was signalled") tells them what the plugin did
    // not do and leaves them to infer what may now happen.
    assert.match(stdout, /may still have a model request in flight/);
    assert.match(stdout, /overlap/);
    assert.equal(readJob(scenario.state, 'wedged').state, 'failed');
  } finally {
    await scenario.server.close();
  }
});

test('a queued row is written off WITHOUT claiming an overlap that cannot happen', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'waiting', state: 'queued', waiterPid: process.pid, beatAgoMs: STALE,
    });

    const { status, stdout } = await scenario.run(['abandon', 'waiting']);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /no request was ever sent and none will be/);
    // `decide` moves a row to `running` before acquisition succeeds and the model
    // is called only after that, so a queued row provably has nothing in flight.
    assert.doesNotMatch(stdout, /overlap/);
    assert.doesNotMatch(stdout, /in flight/);
  } finally {
    await scenario.server.close();
  }
});

test('--force works BEFORE the id, and says so when it is put after', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    wedge(scenario.state, { beatAgoMs: FRESH });

    const refused = await scenario.run(['abandon', 'wedged']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /still checking in/);
    assert.match(refused.stderr, /--force/);
    assert.equal(readJob(scenario.state, 'wedged').state, 'running', 'a refusal must write nothing');

    // The form the markdown documents, and the one that must work.
    const forced = await scenario.run(['abandon', '--force', 'wedged']);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(readJob(scenario.state, 'wedged').state, 'failed');

    // The form an operator will type anyway. `parseArgs` stops reading flags at
    // the first positional, so this once produced `No job with id "wedged
    // --force"` — an error about the wrong thing, on the one invocation where
    // someone was deliberately overriding a refusal.
    wedge(scenario.state, { id: 'second', beatAgoMs: FRESH });
    const misplaced = await scenario.run(['abandon', 'second', '--force']);
    assert.equal(misplaced.status, 1);
    assert.match(misplaced.stderr, /--force" appears inside the prompt text/);
    assert.doesNotMatch(misplaced.stderr, /No job with id/, 'the flag must not be reported as part of the id');
  } finally {
    await scenario.server.close();
  }
});

test('a row a newer plugin wrote is refused with --force, and told --force will not help', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    wedge(scenario.state, { version: 99 });

    const { status, stderr } = await scenario.run(['abandon', '--force', 'wedged']);
    assert.equal(status, 1);
    assert.match(stderr, /newer version of the plugin/);
    assert.match(stderr, /--force will not change that/);
    const after = readJob(scenario.state, 'wedged');
    assert.equal(after.state, 'running', 'a row this build cannot read is never mutated');
    assert.equal(after.schema_version, 99);
  } finally {
    await scenario.server.close();
  }
});

test('a job whose process is genuinely gone is reported as recovered, not refused', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // The commonest reason anyone reaches for this command. Reconciliation
    // handles it before `abandonRow` is asked, and the reply has to be the good
    // news it is rather than a `not-abandonable` refusal at exit 1.
    const { deadPid } = await import('./job-helpers.mjs');
    insertSynthetic(scenario.state, {
      id: 'reaped', state: 'running', workerPid: await deadPid(), startedAgoMs: 600_000, beatAgoMs: STALE,
    });

    const { status, stdout, stderr } = await scenario.run(['abandon', 'reaped']);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /needed no writing off/);
    assert.doesNotMatch(stderr, /--force will not change that/);
    // Recovered with NOTHING WAITING claims no drainage. The justification used
    // to be "there is no such computation on this path" — which was circular, and
    // the computation now exists. So this is a real negative about an empty
    // queue, and its positive twin lives in `abandon-messages.test.js`; without
    // that twin this assertion could never fail again.
    assert.doesNotMatch(stdout, /may start/);
    assert.doesNotMatch(stdout, /blocking the queue/);
    assert.equal(readJob(scenario.state, 'reaped').state, 'failed');
  } finally {
    await scenario.server.close();
  }
});

test('an unknown id is an error about the id, and a missing one asks for it', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    const unknown = await scenario.run(['abandon', 'nope']);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /No job with id "nope"/);

    const missing = await scenario.run(['abandon']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /needs a job id/);
  } finally {
    await scenario.server.close();
  }
});

test('the pid survives the write that NULLs its column', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    wedge(scenario.state);

    await scenario.run(['abandon', 'wedged']);

    // `finish` sets `worker_pid = NULL`. The number is kept as EVIDENCE — what
    // was recorded, and what the probe answered about it — not as something the
    // operator is told to go and act on. This build cannot prove it still belongs
    // to this job, which is the premise of the whole command.
    const after = readJob(scenario.state, 'wedged');
    assert.equal(after.worker_pid, null, 'the column really is cleared');
    assert.match(after.failure.message, new RegExp(`\\(${process.pid}\\)`));
    assert.match(after.failure.hint, /evidence, not as a target/);
  } finally {
    await scenario.server.close();
  }
});

test('every refusal the decision can return has something to say', { skip: NEEDS_SQLITE }, () => {
  // `REFUSALS` is a lookup, so a reason added to `abandonDecision` without an
  // entry beside it is a TypeError and exit 2 rather than a message. Pinned
  // against the decision's own vocabulary rather than a hand-copied list.
  const source = readFileSync(new URL('../scripts/lib/job-abandon.mjs', import.meta.url), 'utf8');
  const reasons = new Set([...source.matchAll(/reason: '([a-z-]+)'/g)].map((match) => match[1]));
  reasons.delete('operator-abandoned'); // the failure envelope's reason, not a refusal
  reasons.delete('forced');
  reasons.delete('forced-malformed'); // an allowed outcome, not a refusal
  // `dead` is a ROUTING value, not a refusal anyone sees: `abandonRow` intercepts
  // it and hands the row to recovery, so it never reaches the REFUSALS table. The
  // literal stays in the module as the routing key; only its message is gone.
  reasons.delete('dead');
  reasons.delete('stale');
  // An EXACT set, not a floor. `>= 4` was written when there were five reasons
  // and survived a sixth being added — a control that no longer tracks what it
  // guards. Adding a reason must now edit this line, which is the point.
  assert.deepEqual(
    [...reasons].sort(),
    ['beating', 'gone', 'malformed', 'no-beat', 'not-abandonable', 'starting', 'unknown-version'],
    'the refusal vocabulary changed: add the new reason here and to REFUSALS',
  );

  const table = readFileSync(new URL('../scripts/lib/cmd-abandon.mjs', import.meta.url), 'utf8');
  const covered = new Set([...table.matchAll(/^ {2}'?([a-z-]+)'?: \(job\)/gm)].map((match) => match[1]));
  covered.add('gone'); // intercepted before the table: "no such job" is not a refusal to abandon
  assert.deepEqual([...reasons].filter((reason) => !covered.has(reason)), []);
});

test('the decision vocabulary this file pins is the one the module exports', { skip: NEEDS_SQLITE }, () => {
  // The control for the guard above: if `abandonDecision` stopped producing these
  // reasons, the regex scrape would still "pass" against a stale list.
  const now = Date.now();
  const base = {
    state: 'running', schema_version: 1, worker_pid: process.pid,
    last_beat_at: new Date(now - FRESH).toISOString(),
  };
  assert.equal(abandonDecision(null, now).reason, 'gone');
  assert.equal(abandonDecision({ ...base, schema_version: 99 }, now).reason, 'unknown-version');
  assert.equal(abandonDecision({ ...base, state: 'completed' }, now).reason, 'not-abandonable');
  assert.equal(abandonDecision(base, now).reason, 'beating');
  assert.equal(abandonDecision({ ...base, last_beat_at: 'garbage' }, now).reason, 'no-beat');
  assert.equal(abandonDecision({ ...base, worker_pid: null, last_beat_at: null }, now).reason, 'malformed');
  // `spawned_at` must be present and parseable, or `livenessOf` returns
  // `malformed`, the rung falls through, and this would assert `no-beat` while
  // appearing to test the grace.
  const starting = {
    state: 'queued', schema_version: 1, waiter_pid: null, last_beat_at: null,
    spawned_at: new Date(now - 2_000).toISOString(),
  };
  assert.equal(abandonDecision(starting, now).reason, 'starting');
  assert.equal(abandonDecision(starting, now, { override: true }).reason, 'starting', '--force must not lift it');
});

test('the malformed refusal tells a queued operator the truth about THIS row, both branches', { skip: NEEDS_SQLITE }, async () => {
  // Both branches of the ternary matter and they say opposite
  // things, so each is the other's positive control: an assertion on one alone
  // would pass against a `REFUSALS.malformed` that had stopped emitting the
  // suffix entirely.
  const scenario = await queueScenario();
  try {
    // Branch one — a pid IS recorded and cannot be read. `registerWaiter` carries
    // `AND waiter_pid IS NULL`, so nothing can ever attach to this row.
    insertSynthetic(scenario.state, { id: 'held', state: 'queued', waiterPid: 'garbage' });
    const held = await scenario.run(['abandon', 'held']);
    assert.equal(held.status, 1, 'a refusal exits 1');
    // The refusal is a `UserError`, so it lands on stderr AFTER the row
    // descriptor has gone to stdout — matching stdout alone finds nothing.
    assert.match(held.stderr, /Ordinary recovery will not collect a row in this shape/);
    assert.doesNotMatch(held.stderr, /can still attach and run it/,
      'this row takes no new registration, so the reassuring sentence would misdescribe it');

    // Branch two — no pid recorded, timestamps unreadable. A late worker CAN
    // still attach here, which is why the reassurance is correct for it.
    insertSynthetic(scenario.state, { id: 'stamps', state: 'queued', waiterPid: null });
    breakStamps(scenario.state, 'stamps');
    const stamps = await scenario.run(['abandon', 'stamps']);
    assert.equal(stamps.status, 1);
    assert.match(stamps.stderr, /can still attach and run it/);
    assert.doesNotMatch(stamps.stderr, /Ordinary recovery will not collect a row in this shape/);
  } finally {
    await scenario.server.close();
  }
});
