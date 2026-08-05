// `/oai:status`: the half of the stage gate that says a job survives the session
// that made it, plus the states that exist only at the moment of reading.
//
// `stalled` and `overdue` get the same treatment as everything else here: driven
// against a real process (this one, which is certainly alive) rather than a
// mocked liveness answer, because "is that pid there" is the one question the
// whole design rests on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deadPid, insertSynthetic, queueScenario, readJob, setUserVersion, waitForState } from './job-helpers.mjs';

// Resolved, because a child's `process.cwd()` is: on macOS the temp directory is
// reached through a symlink, so the workspace a row records is the real path and
// never the one handed to `spawn`.
const workspace = (tag) => realpathSync(mkdtempSync(join(tmpdir(), `oai-ws-${tag}-`)));
const FIVE_MINUTES = 300_000;

test('a job submitted by one process is retrievable by another, from a different directory', async () => {
  const scenario = await queueScenario();
  try {
    const here = workspace('a');
    const elsewhere = workspace('b');

    const submit = await scenario.submit([], { cwd: here });
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['completed', 'failed']);

    // Two processes and two directories: the id is the whole address, which is
    // the gate. A status scoped to the submitting repo would mean an id handed
    // between sessions stopped working the moment someone changed directory.
    const status = await scenario.run(['status', id], { cwd: elsewhere });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, new RegExp(`job ${id}\\s+completed`));
    assert.match(status.stdout, new RegExp(`workspace\\s+${here}`));

    // No session identifier anywhere in the row — which is exactly what the
    // reference plugin's `SessionEnd` sweep keys on, and why its background jobs
    // do not outlive the session that asked for them.
    assert.doesNotMatch(JSON.stringify(readJob(scenario.state, id)), /session/i);
  } finally {
    await scenario.server.close();
  }
});

test('a job with attachments shows what was asked, not the first file it was given', async () => {
  const scenario = await queueScenario();
  try {
    // `buildMessages` puts file blocks *before* the prompt, so the naive "first
    // line of the last user message" reads `--- FILE: … ---` — a wrong answer
    // that looks like a right one, and one every attached-file job would show.
    const submit = await scenario.submit(['--file', 'scripts/lib/errors.mjs']);
    assert.equal(submit.status, 0, submit.stderr);
    const id = submit.stdout.trim();
    await waitForState(scenario.state, id, ['completed', 'failed']);

    const status = await scenario.run(['status', id]);
    assert.match(status.stdout, /request\s+do it/);
    assert.doesNotMatch(status.stdout, /request\s+--- FILE/);
    assert.match(status.stdout, /attachments\s+scripts\/lib\/errors\.mjs/);
  } finally {
    await scenario.server.close();
  }
});

test('reading is what collects a job whose worker died', async () => {
  const scenario = await queueScenario();
  try {
    // There is no daemon: if reading did not reconcile, this row would sit
    // `running` forever and block every job behind it.
    insertSynthetic(scenario.state, { id: 'orphaned', state: 'running', workerPid: await deadPid(), startedAgoMs: 5000 });

    const status = await scenario.run(['status', '--all']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /orphaned\s+failed/);

    const row = readJob(scenario.state, 'orphaned');
    assert.equal(row.state, 'failed');
    assert.equal(row.failure.reason, 'worker-died');
  } finally {
    await scenario.server.close();
  }
});

test('a live worker that has stopped beating reads stalled, and is not terminalized', async () => {
  const scenario = await queueScenario();
  try {
    // This test's own pid, so the liveness probe gets a real answer: alive.
    insertSynthetic(scenario.state, {
      id: 'suspended', state: 'running', workerPid: process.pid, startedAgoMs: FIVE_MINUTES, beatAgoMs: FIVE_MINUTES,
    });

    const status = await scenario.run(['status', 'suspended']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /job suspended\s+stalled/);
    assert.match(status.stdout, new RegExp(`pid ${process.pid} is alive but has not beaten`));

    // The trilemma's chosen corner: a stale beat is a reading, never a verdict.
    // Terminalizing here would deadlock cancellation, since a worker's last act
    // before exiting is to beat.
    assert.equal(readJob(scenario.state, 'suspended').state, 'running');
  } finally {
    await scenario.server.close();
  }
});

test('a live worker past its own run cap reads overdue, and is not terminalized', async () => {
  const scenario = await queueScenario();
  try {
    insertSynthetic(scenario.state, {
      id: 'late',
      state: 'running',
      workerPid: process.pid,
      startedAgoMs: FIVE_MINUTES,
      beatAgoMs: 1000,
      request: { messages: [{ role: 'user', content: 'take your time' }], maxMs: 60_000 },
    });

    const status = await scenario.run(['status', 'late']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /job late\s+overdue/);
    assert.match(status.stdout, /past its own 60s cap/);
    assert.equal(readJob(scenario.state, 'late').state, 'running', 'nothing signals a pid it cannot verify');
  } finally {
    await scenario.server.close();
  }
});

test('a malformed blocker is named rather than guessed at', async () => {
  const scenario = await queueScenario();
  try {
    // Running with no pid: this build writes the two together, so the row is
    // legacy or corrupt. It holds the queue, and the only remedy available is
    // telling the user it is there.
    insertSynthetic(scenario.state, { id: 'malformed', state: 'running', workerPid: null });

    const status = await scenario.run(['status', '--all']);
    assert.match(status.stdout, /malformed\s+malformed/);
    assert.match(status.stdout, /blocks the queue/);
    assert.equal(readJob(scenario.state, 'malformed').state, 'running');
  } finally {
    await scenario.server.close();
  }
});

test('a bare status is scoped to this directory; --all is not', async () => {
  const scenario = await queueScenario();
  try {
    const here = workspace('here');
    const there = workspace('there');

    const mine = await scenario.submit([], { cwd: here });
    await waitForState(scenario.state, mine.stdout.trim(), ['completed', 'failed']);
    const theirs = await scenario.submit([], { cwd: there });
    await waitForState(scenario.state, theirs.stdout.trim(), ['completed', 'failed']);

    const scoped = await scenario.run(['status'], { cwd: here });
    assert.equal(scoped.status, 0, scoped.stderr);
    assert.match(scoped.stdout, new RegExp(mine.stdout.trim()));
    assert.doesNotMatch(scoped.stdout, new RegExp(theirs.stdout.trim()));
    // Filtered, never hidden: the count is what stops a user concluding a job
    // they submitted elsewhere was lost.
    assert.match(scoped.stdout, /1 more elsewhere/);

    const all = await scenario.run(['status', '--all'], { cwd: here });
    assert.match(all.stdout, new RegExp(mine.stdout.trim()));
    assert.match(all.stdout, new RegExp(theirs.stdout.trim()));
  } finally {
    await scenario.server.close();
  }
});

test('a database a newer plugin wrote is read, said so, and never written to', async () => {
  const scenario = await queueScenario();
  try {
    // A known-version row with a dead worker: against a database this build owns
    // it is collected on sight, so if anything is collected here it is because
    // the version guard failed rather than because there was nothing to do.
    insertSynthetic(scenario.state, { id: 'foreign', state: 'running', workerPid: await deadPid() });
    setUserVersion(scenario.state, 99);

    const status = await scenario.run(['status', '--all']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stderr, /newer version of the plugin \(schema 99\)/);
    assert.match(status.stdout, /foreign/, 'refusing to write is not a reason to refuse to look');

    // A submission, by contrast, is refused outright — and as a user error with
    // a remedy, not as a crash.
    const submit = await scenario.submit();
    assert.equal(submit.status, 1, submit.stderr);
    assert.match(submit.stderr, /newer version of the plugin/);

    setUserVersion(scenario.state, 1);
    assert.equal(readJob(scenario.state, 'foreign').state, 'running', 'nothing may be collected out of a foreign database');
  } finally {
    await scenario.server.close();
  }
});
