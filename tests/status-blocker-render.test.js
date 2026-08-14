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
