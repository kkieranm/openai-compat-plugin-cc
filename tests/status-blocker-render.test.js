// What `/oai:status` SAYS about the row it named — the marker, the notes, the
// count, and the whole chain through the real command.
//
// Split from `status-blocker.test.js`, which answers the other half of the
// question: which row gets named at all.
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderList } from '../scripts/lib/job-render.mjs';
import { statusView } from '../scripts/lib/job-view.mjs';
import { NEEDS_SQLITE, insertSynthetic, queueScenario, stateDir, waitForState, withStore } from './job-helpers.mjs';
import { ELSEWHERE, HERE, TEN_MINUTES, THERE, breakStamps, myJob, realWorkspace, theirHead, viewHere } from './blocker-helpers.mjs';

test('a malformed queued row is not described as running, and claims nothing about the queue', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  theirHead(state, { waiterPid: null });
  breakStamps(state, 'theirs');
  myJob(state);

  viewHere(state, (view) => {
    const text = renderList(view, { cwd: HERE, all: false });
    assert.match(text, /queued with a timestamp this build cannot read/);
    // Conditional, because `registerWaiter` can still supply a pid, after which
    // `livenessOf` answers from the pid and never reads the stamp at all.
    assert.match(text, /While it stays in this shape/);
    assert.doesNotMatch(text, /running with no worker pid recorded/);
    // A malformed QUEUED row holds the line only while it is the first row the
    // scan does not skip, which one row cannot know about itself.
    assert.doesNotMatch(text, /It blocks the queue/);
    // This fixture is the only thing in the suite that reaches `relativeAge`'s
    // unparseable-timestamp branch — `breakStamps` is what corrupts `created_at`,
    // and the age column is rendered from it. Reached and unasserted is a branch
    // that only looks covered.
    assert.match(text, /\s\?\s/, 'an unreadable stamp renders as ?, not as a crash or a wrong age');
  });

  // The positive control, in the same run: the wording the queued branch may not
  // use is still exactly what the RUNNING branch says, where it is true of every
  // caller that reaches the scans at all — `decide` returns `cancelled` first, so
  // a caller with a pending cancellation is blocked by neither shape. Without this
  // control, both assertions above would pass against a `noteFor` that had stopped
  // saying anything at all.
  const running = stateDir();
  insertSynthetic(running, { id: 'wedged', state: 'running', workerPid: null, workspace: HERE });
  withStore(running, (db) => {
    const text = renderList(statusView(db, { cwd: HERE }), { cwd: HERE, all: false });
    assert.match(text, /running with no worker pid recorded/);
    assert.match(text, /It blocks the queue/);
  });
});

test('--all marks the blocker too, and keeps its workspace line', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  const theirs = theirHead(state);
  myJob(state);
  // A third workspace, behind the head so it is never marked. Without it the
  // only other row is local — which never prints a workspace line under any
  // branch — so the fixture could not tell "the marked row keeps its line" from
  // "print the line for every foreign row".
  insertSynthetic(state, { id: 'bystander', workspace: ELSEWHERE, waiterPid: process.pid });

  withStore(state, (db) => {
    // `cwd` still matters under --all: `cmd-status.mjs` always supplies it, and
    // without one every row is foreign and nothing is ever marked.
    const view = statusView(db, { cwd: HERE, all: true });
    assert.equal(view.blockingSeq, theirs, 'the marker must name the same row --all shows');
    assert.equal(view.elsewhere, 0);
    assert.equal(view.shown.length, 3);

    const text = renderList(view, { cwd: HERE, all: true });
    assert.match(text, /must clear before this workspace's queued job can proceed/);
    // The marked row keeps its workspace line under --all…
    assert.match(text, new RegExp(THERE));
    // …and the unmarked foreign row does not. The match above is this absence
    // assertion's firing-path control: both rows go through the same line in
    // `renderList`, in the same run, so a renderer that had stopped printing
    // workspace lines altogether would fail the assertion above rather than pass
    // this one for the wrong reason.
    assert.doesNotMatch(text, new RegExp(ELSEWHERE));
  });
});

test('the blocker is shown OR counted elsewhere, never both', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  theirHead(state);
  myJob(state);
  // A second foreign row, inserted AFTER the head so it stays behind it and is
  // never itself the blocker. Without it `elsewhere` is 0 and the renderer's own
  // `> 0` guard makes any assertion about "more elsewhere" unable to fail — the
  // check would report success while proving nothing.
  insertSynthetic(state, { id: 'other', workspace: THERE, waiterPid: process.pid });

  viewHere(state, (view) => {
    assert.equal(view.elsewhere, 1, 'the blocker is shown, so only the unrelated foreign row is hidden');
    // Reaches the renderer, and discriminates: a blocker counted both shown and
    // hidden would read 2 here.
    assert.match(renderList(view, { cwd: HERE, all: false }), /\(1 more elsewhere/);
  });
});

test('the blocker reaches the screen through the real command', { skip: NEEDS_SQLITE }, async () => {
  const scenario = await queueScenario();
  try {
    // Through the CLI, because everything else tests the two functions and
    // nothing tests that `cmd-status.mjs` carries the new field between them.
    const here = realWorkspace('cli');
    insertSynthetic(scenario.state, { id: 'theirs', workspace: THERE, waiterPid: process.pid, beatAgoMs: TEN_MINUTES });
    insertSynthetic(scenario.state, { id: 'mine', workspace: here, waiterPid: process.pid });

    const status = await scenario.run(['status'], { cwd: here });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /theirs/);
    assert.match(status.stdout, /must clear before this workspace's queued job can proceed/);
    assert.match(status.stdout, new RegExp(THERE));
    // Reconciliation ran and left both live rows alone.
    await waitForState(scenario.state, 'mine', ['queued']);
  } finally {
    await scenario.server.close();
  }
});

test('the way out is named on the blocker only when taking it would work', { skip: NEEDS_SQLITE }, () => {
  // Three conditions, and two are not properties of the row: the beat is stale,
  // the row's version is one this build knows, and the database is writable.
  // `/oai:status` reads a database `/oai:abandon` would refuse outright, so
  // naming the command unconditionally is advice a reader can only discover is
  // wrong by taking it.
  const stale = stateDir();
  theirHead(stale, { beatAgoMs: 90_000 });
  myJob(stale, { beatAgoMs: 1_000 });
  viewHere(stale, (view) => {
    assert.match(renderList(view, { cwd: HERE, all: false }), /\/oai:abandon theirs/);
  });

  // Same fixture, read from a database a newer plugin wrote: every write refuses
  // there, so the line must not appear.
  viewHere(stale, (view) => {
    const text = renderList(view, { cwd: HERE, all: false, readOnly: true });
    assert.match(text, /must clear before/, 'the blocker is still named');
    assert.doesNotMatch(text, /oai:abandon/);
  });

  // Same fixture but the beat is fresh — abandon would refuse without --force,
  // and the display does not advertise a command that will say no.
  const beating = stateDir();
  theirHead(beating, { beatAgoMs: 1_000 });
  myJob(beating, { beatAgoMs: 1_000 });
  viewHere(beating, (view) => {
    const text = renderList(view, { cwd: HERE, all: false });
    assert.match(text, /must clear before/);
    assert.doesNotMatch(text, /oai:abandon/);
  });

  // And a row this build may not touch at all, where --force would not help
  // either. Differs from the first fixture in exactly the schema version.
  const foreign = stateDir();
  theirHead(foreign, { beatAgoMs: 90_000, version: 99 });
  myJob(foreign, { beatAgoMs: 1_000 });
  viewHere(foreign, (view) => {
    const text = renderList(view, { cwd: HERE, all: false });
    // The control its two siblings have. An unknown-version live head is still
    // the row `blockingSeqFor` names, so the marker DOES render here and only
    // `remedyFor` suppresses the pointer — without asserting that, this block
    // would pass just as well if foreign-version rows stopped being marked at all.
    assert.match(text, /must clear before/);
    assert.doesNotMatch(text, /oai:abandon/);
  });
});

test('a malformed blocker with NO pid recorded is named, and gets no command at all', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // A running row with no worker pid and a stale, PARSEABLE beat. `theirHead`
  // cannot build it — that helper sets a live waiter pid on a queued row — and a
  // `starting` row would not discriminate, because it has no beat at all so
  // `beatIsStale` already suppresses the remedy. This is the only shape that
  // reaches the liveness gate as the single deciding predicate.
  //
  // **The universe here is malformed rows with NO PID RECORDED, not every
  // malformed row** — the title used to claim the latter while the fixture only
  // ever covered the former. A recorded-but-unreadable pid gets a different
  // SENTENCE, covered by the two tests below, but the same silence about
  // commands: `remedyFor` returns null for any row that is not `live`, so no
  // malformed row of any shape is offered one.
  insertSynthetic(state, {
    id: 'theirs', state: 'running', workerPid: null, workspace: THERE,
    startedAgoMs: 600_000, beatAgoMs: 90_000,
  });
  myJob(state, { beatAgoMs: 1_000 });

  viewHere(state, (view) => {
    const text = renderList(view, { cwd: HERE, all: false });
    // The positive control. `blockingSeqFor`'s running rung names any row that is
    // not provably dead, malformed included — so without this assertion the test
    // would pass vacuously the day such rows stopped being marked at all.
    assert.match(text, /must clear before/);
    // And the gate itself: `/oai:abandon` refuses a malformed row without
    // --force, so naming the plain form here would advertise a refusal. Deleting
    // that one condition left the whole suite green until this test existed.
    assert.doesNotMatch(text, /oai:abandon/);
  });
});

test('the remedy reaches the real CLI, and a too-new database withholds it', { skip: NEEDS_SQLITE }, async () => {
  const { queueScenario, setUserVersion } = await import('./job-helpers.mjs');
  const scenario = await queueScenario();
  const mine = realWorkspace('here');
  try {
    // A stale live foreign blocker plus a local witness waiting behind it.
    insertSynthetic(scenario.state, {
      id: 'theirs', state: 'running', workerPid: process.pid, workspace: THERE,
      startedAgoMs: 600_000, beatAgoMs: 90_000,
    });
    insertSynthetic(scenario.state, {
      id: 'mine', state: 'queued', waiterPid: process.pid, workspace: mine, beatAgoMs: 1_000,
    });

    // The POSITIVE half, and it is new coverage in its own right: nothing before
    // this drove the remedy line through the actual command.
    const writable = await scenario.run(['status'], { cwd: mine });
    assert.match(writable.stdout, /must clear before/);
    assert.match(writable.stdout, /oai:abandon theirs/);

    // One predicate different: the database is now one this build may not write.
    // `reconcileAll` is skipped under readOnly, so the blocker survives to be
    // named — but the remedy names a command that would refuse outright.
    setUserVersion(scenario.state, 99);
    const readOnly = await scenario.run(['status'], { cwd: mine });
    assert.match(readOnly.stdout, /must clear before/, 'the blocker is still named');
    assert.doesNotMatch(readOnly.stdout, /oai:abandon/);
  } finally {
    await scenario.server.close();
  }
});

test('a queued row with an unreadable pid is told the truth about its future, not the timestamp shape\'s', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  // The two queued malformed shapes have opposite futures, and before OAI-162
  // they shared one sentence. `registerWaiter` carries `AND waiter_pid IS NULL`,
  // so a row already holding a value can never be attached by anything —
  // telling the operator a worker might still pick it up argues them out of the
  // only action that clears it.
  theirHead(state, { waiterPid: 'garbage' });
  myJob(state);

  viewHere(state, (view) => {
    const text = renderList(view, { cwd: HERE, all: false });
    assert.match(text, /cannot be read as a pid/);
    assert.match(text, /No NEW worker can register against it/);
    // No command is named from a note: `remedyFor` is the one place this file
    // advises an action, and it is gated on conditions a note cannot see.
    assert.doesNotMatch(text, /oai:abandon/);
    // The sentence that belongs to the OTHER queued shape, and is false here.
    assert.doesNotMatch(text, /a timestamp this build cannot read/);
    assert.doesNotMatch(text, /While it stays in this shape/);
  });

  // The positive control, in the same run: the sentence this row may not carry
  // is exactly what the timestamp shape still says. Without it, both
  // `doesNotMatch` assertions above would pass against a `noteFor` that had
  // stopped producing any queued note at all.
  const stamps = stateDir();
  theirHead(stamps, { waiterPid: null });
  breakStamps(stamps, 'theirs');
  myJob(stamps);
  viewHere(stamps, (view) => {
    const text = renderList(view, { cwd: HERE, all: false });
    assert.match(text, /a timestamp this build cannot read/);
    assert.match(text, /While it stays in this shape/);
    assert.doesNotMatch(text, /cannot be read as a pid/);
  });
});

test('a RUNNING row with an unreadable pid says so without quoting the value', { skip: NEEDS_SQLITE }, () => {
  const state = stateDir();
  insertSynthetic(state, { id: 'theirs', state: 'running', workspace: THERE, workerPid: 2 ** 40 });
  myJob(state);

  viewHere(state, (view) => {
    const text = renderList(view, { cwd: HERE, all: false });
    assert.match(text, /cannot be read as a pid/);
    assert.match(text, /It blocks the queue/, 'a running row DOES hold every caller, unlike a queued one');
    // The no-pid wording, which is false of a row that recorded one.
    assert.doesNotMatch(text, /running with no worker pid recorded/);
  });
});
