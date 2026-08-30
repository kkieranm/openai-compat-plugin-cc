// What this plugin does on a runtime that does not offer `node:sqlite`.
//
// `package.json` declares `node: >=18.18`, but `node:sqlite` is served unflagged
// only from v22.13.0 (v23.4.0 on the 23.x line). Because the entry point imports
// every command module statically, a static `node:sqlite` import took the WHOLE
// plugin down on those runtimes — `/oai:setup` included, which never opens a
// database.
//
// Lives in its own file rather than in `plugin.test.js`: that file guards the
// markdown command surface, and this guards a runtime capability. They share no
// fixtures and would only share a size budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { completion, modelList, respondJson, startFakeServer, tempDir } from './helpers.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

// TWO instruments, and the difference is the point.
//
// The first is a REAL runtime without the module, and HOW we get one is itself
// decided by capability rather than by version — the same mistake this feature
// exists to correct, made once in its own harness. `--no-experimental-sqlite`
// only exists from Node 22.5, so hard-coding it made `npm test` die at
// `node: bad option:` on 18.18–22.4, which is precisely the range this feature
// restores: the change proving the plugin runs on old runtimes could not itself
// be run on one. So: ask whether THIS runtime has `node:sqlite`, and pass the
// flag only if it does. Where the parent already lacks it, no flag is needed —
// the child is a real runtime without the module for free.
//
// This is honest on both sides of the floor and covers different things on each,
// stated rather than glossed: below 22.13 these tests exercise a genuine absence
// and never the flag path; from 22.13 they exercise the flag.
//
// The ESM hook is kept for the one shape no real runtime produces on purpose — a
// failure this plugin does not recognise — and for nothing else. An earlier
// version of these tests used it to drive a second "unavailable" code as well,
// and a review proved no runtime can raise that code: the fixture had invented
// the evidence for the branch that consumed it. Both are gone.
let parentHasSqlite = true;
try {
  await import('node:sqlite');
} catch {
  parentHasSqlite = false;
}
const REAL_RUNTIME_WITHOUT_SQLITE = parentHasSqlite ? ['--no-experimental-sqlite'] : [];
const HOOKED = ['--import', join(ROOT, 'tests', 'no-sqlite-register.mjs')];

// `register` landed in 18.19 and 20.6, and this package declares `>=18.18`. On
// 18.18 exactly, and on 20.0–20.5, the fixture cannot link — so the test that
// needs it is skipped there WITH ITS REASON NAMED. Never a silent skip: this
// repo's zsh rule exists because a suite that quietly shrinks its matrix has
// stopped being able to fail, and the same applies to a runtime matrix.
const { register } = await import('node:module');
const REGISTER_SKIP =
  typeof register === 'function'
    ? false
    : `node:module register() is unavailable on ${process.version} (added in 18.19/20.6), so the ` +
      'unrecognised-import-failure path is NOT exercised on this runtime';

/**
 * The companion, spawned at its real path.
 *
 * Spawned rather than imported, because the defect this guards is a LINK-time
 * one: it happens before any of this build's code runs, so nothing that imports a
 * module can observe it. Async `execFile` only — a synchronous spawn deadlocks
 * against the in-process fake server the rest of this suite uses, and
 * `tests/structure.test.js` forbids it outright.
 */
function stateDir(prefix = 'oai-capability-') {
  return tempDir(prefix);
}

function companion(nodeFlags, args, env = {}) {
  const child = promisify(execFile)(
    process.execPath,
    [...nodeFlags, join(ROOT, 'scripts', 'oai-companion.mjs'), ...args],
    { env: { ...process.env, OAI_PLUGIN_STATE: stateDir(), ...env } },
  );
  child.child.stdin.end('');
  // A non-zero exit is the ordinary outcome here, and execFile rejects on it.
  return child.catch((error) => error).then((r) => ({ code: r.code ?? 0, stderr: r.stderr ?? '', stdout: r.stdout ?? '' }));
}

test('a runtime without node:sqlite loses background jobs and nothing else', async () => {
  // The dispatcher's own usage error is the witness that the module graph linked
  // and control reached dispatch. It needs no network and no state on disk, so it
  // cannot pass for an unrelated reason.
  const linked = await companion(REAL_RUNTIME_WITHOUT_SQLITE, ['bogus']);
  assert.match(linked.stderr, /Unknown command "bogus"/, 'the graph must link where no database is opened');

  const refused = await companion(REAL_RUNTIME_WITHOUT_SQLITE, ['status']);
  assert.equal(refused.code, 1, 'a runtime that cannot serve the request is a UserError, not a crash');
  assert.match(refused.stderr, /Background jobs need the `node:sqlite` module/, 'names what is missing');
  // The hint must stay true on a runtime that is ALREADY newer than the floor,
  // which is exactly the case this assertion runs on: telling someone on v26 to
  // upgrade to 22.13 is advice that cannot help them.
  assert.match(refused.stderr, /unflagged from 22\.13/, 'the hint names the floor');
  assert.match(refused.stderr, /built without SQLite or started with/, 'and stays true when the floor is already met');
});

// Refusing late is not refusing. `submitTask` used to probe the provider before
// the store was opened, spending real round trips on a submission that was always
// going to be refused.
//
// A REACHABLE server, and that is the whole design of this test. An earlier
// version pointed at port 9, the discard port, so that a probe would surface as a
// connection error — but that conflates "refused before probing" with "could not
// connect", and it made the assertion the test exists for unfalsifiable: the
// refusal-message assertion above it fails FIRST in the regressed build, so
// nothing downstream is ever evaluated. Proved by positive control, not by
// reading it.
//
// Against a server that answers, the sqlite refusal appears either way — the gate
// only changes WHEN. So the server's own request log is the one witness that
// discriminates, and it testifies directly rather than by proxy through stderr.
test('--background refuses before it probes the server', async () => {
  const server = await startFakeServer((record, response) => respondJson(response, modelList('test-model')));
  try {
    const refused = await companion(
      REAL_RUNTIME_WITHOUT_SQLITE,
      ['task', '--background', '--base-url', server.baseUrl, 'summarise this'],
    );
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /Background jobs need the `node:sqlite` module/, 'the runtime gap is what it refuses on');
    assert.deepEqual(server.requests, [], 'the provider must never be contacted for a submission that cannot be accepted');
  } finally {
    await server.close();
  }
});

// The guard lives at THREE call sites and this one had no test. `openStore()` is
// reached directly by the background worker, which never goes through
// `submitTask`'s own earlier call — so the check inside `openStore` is not the
// redundancy it looks like beside that one. Without this, deleting it as
// duplication would turn the worker's clean refusal into
// `TypeError: Database is not a constructor` at exit 2, and nothing would go red.
test('the worker reaches the guard through openStore, not through submitTask', async () => {
  const refused = await companion(REAL_RUNTIME_WITHOUT_SQLITE, ['task-worker', '--seq', '1']);
  assert.equal(refused.code, 1, 'a UserError, not a crash');
  assert.match(refused.stderr, /Background jobs need the `node:sqlite` module/, 'openStore must refuse in its own right');
});

// The other half of the same decision. A failure this plugin does not recognise
// keeps its cause and stays an unexpected failure — and because it is captured at
// module scope rather than thrown there, it still does not reach the commands
// that never open a database. Getting this wrong reintroduces the original defect
// under a different cause.
test('an unrecognised import failure is never relabelled, and never spreads', { skip: REGISTER_SKIP }, async () => {
  const env = { OAI_TEST_SQLITE_FAILURE: 'ERR_INVALID_MODULE_SPECIFIER' };

  const unrelated = await companion(HOOKED, ['bogus'], env);
  assert.match(unrelated.stderr, /Unknown command "bogus"/, 'an unrecognised fault must not reach unrelated commands');

  const opened = await companion(HOOKED, ['status'], env);
  assert.equal(opened.code, 2, 'an unrecognised fault is a bug, and bugs exit 2');
  assert.match(opened.stderr, /a fault this plugin has no opinion about/, 'the original cause must survive');
  assert.doesNotMatch(opened.stderr, /Background jobs need/, 'never relabelled as a stale Node');
});

// The claim four documents and the refusal hint all make, EXECUTED rather than
// inferred from the import graph.
//
// Each assertion carries a POSITIVE witness that the command actually ran. A
// first version of this test invoked `--help`, which none of these commands
// accept: all three exited at the argument parser, and the "must not see the
// runtime gap" assertions passed because nothing had run. That is the same
// cannot-fail class this feature deleted twice elsewhere, written minutes after
// deleting them — so each case now proves it reached the command's own logic
// before it proves what it did not see.
test('the commands that never open a database work on a runtime without node:sqlite', async () => {
  const setup = await companion(REAL_RUNTIME_WITHOUT_SQLITE, ['setup', '--json']);
  assert.equal(setup.code, 0, 'setup succeeds outright');

  // `review` and foreground `task` reach the provider probe, which is far past
  // load — the banner is the witness that dispatch got into the command.
  // `--file`, NOT `--diff-only`. This case runs the companion with no `cwd`, so it
  // inherits whatever directory the suite was invoked from, and `--diff-only` asks
  // that directory for uncommitted changes. The whole suite therefore passed only
  // while this repo was dirty, and the commit gate's own commit is what makes it
  // clean: measured at 630/2 in a copy with this feature committed, failing here
  // with `Nothing to review: uncommitted changes is empty`. A check that holds only
  // until the action it gates is performed is not a gate. `--file` reaches the same
  // provider probe — the banner below is the actual witness — while depending on
  // nothing outside the repo's own tracked contents.
  for (const argv of [
    ['review', '--file', 'package.json', '--base-url', 'http://127.0.0.1:9/v1'],
    ['task', '--base-url', 'http://127.0.0.1:9/v1', 'summarise this'],
  ]) {
    const run = await companion(REAL_RUNTIME_WITHOUT_SQLITE, argv);
    assert.match(run.stderr, /Checking .* for available models/, `${argv[0]} must reach the provider probe`);
    assert.doesNotMatch(run.stderr, /Background jobs need/, `${argv[0]} must not see the runtime gap`);
    assert.doesNotMatch(run.stderr, /Unexpected failure:/, `${argv[0]} must not crash`);
  }
});
