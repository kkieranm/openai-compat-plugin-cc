// Helpers for tests that involve a job database and a detached worker.
//
// A separate file from `helpers.mjs` because that one is at its size ceiling,
// and because these are only useful to the background tests.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { databasePath, openStore } from '../scripts/lib/job-store.mjs';
import { jobById, listJobs } from '../scripts/lib/job-record.mjs';
import { COMPANION, respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

// `node:sqlite` is a capability, not a given: it is absent on Node 18.18–22.12,
// on builds compiled without SQLite, and under `--no-experimental-sqlite`. A
// STATIC import of it here would link before any module body or `skip` ran, so
// every one of the ten files importing this one died at link with
// `ERR_UNKNOWN_BUILTIN_MODULE` — no test run, no skip reported, nothing said.
// Detected once, with the caught dynamic import `job-secrets.test.js` uses.
let parentHasSqlite = true;
try {
  await import('node:sqlite');
} catch {
  parentHasSqlite = false;
}

/**
 * `false` when a job database can be opened here, otherwise the REASON to skip.
 *
 * A string rather than `true` on purpose: a bare boolean skip names nothing, and
 * a test matrix that shrinks without saying what went unrun is a check that has
 * stopped being able to fail.
 */
export const NEEDS_SQLITE = parentHasSqlite ? false : 'needs node:sqlite to open a job database';

const nodeRequire = createRequire(import.meta.url);

/** `node:sqlite`, or a failure naming the caller that should never have got here. */
function sqliteModule() {
  try {
    return nodeRequire('node:sqlite');
  } catch (cause) {
    throw new Error(
      'setUserVersion requires node:sqlite, which this runtime does not have; '
      + 'the calling test should have been skipped on NEEDS_SQLITE',
      { cause },
    );
  }
}

/** A state directory of its own, so no test ever touches the real one. */
export function stateDir() {
  return mkdtempSync(join(tmpdir(), 'oai-plugin-state-'));
}

/**
 * Read the store the way another process would: open it fresh every time.
 *
 * Holding one connection open across a worker's writes would test a cache, not
 * the database — and "a job launched in one session is visible from another" is
 * exactly the property under test.
 */
export function withStore(state, fn) {
  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = state;
  const db = openStore();
  try {
    return fn(db);
  } finally {
    // Closed, because `waitForState` calls this every 50ms: leaving them open
    // accumulates dozens of live connections inside the test process and turns
    // an ordinary poll into lock contention against the worker it is watching.
    db.close();
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
}

export function readJobs(state) {
  return withStore(state, (db) => listJobs(db));
}

export function readJob(state, id) {
  return withStore(state, (db) => jobById(db, id));
}

/**
 * A pid that is certainly not running: a child spawned only to be waited on.
 *
 * Reaped before it is returned, so the OS considers it free. A synthetic
 * out-of-range number would not do — `isAlive` would reject it on shape and the
 * test would pass without ever asking the OS anything.
 *
 * That avoided fixture is now a subject in its own right rather than a hazard:
 * since OAI-162 an unreadable pid is `malformed`, not `dead`, and
 * `tests/liveness-unreadable-pid.test.js` covers the shape case ON PURPOSE. This
 * helper is still what the `dead` verdict must be asked with — it is the only one
 * that reaches `ESRCH`.
 */
export async function deadPid() {
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  const pid = child.pid;
  await new Promise((resolve) => child.once('exit', resolve));
  return pid;
}

const SYNTHETIC = `
  INSERT INTO jobs (id, kind, state, schema_version, workspace, transport, auth, request, attachments,
                    created_at, spawned_at, started_at, last_beat_at, waiter_pid, worker_pid, model,
                    outcome, failure, cancel_requested_at)
  VALUES (?, 'task', ?, ?, ?, '{"name":"fake","baseUrl":"http://127.0.0.1:1/v1","query":""}', '{"mode":"none"}',
          ?, '[]', ?, ?, ?, ?, ?, ?, 'test-model', ?, ?, ?)
`;

const ago = (ms) => (ms === null ? null : new Date(Date.now() - ms).toISOString());

/**
 * A row no code path in this build produces — a foreign plugin's version, a
 * corrupt shape, or an abandoned submission — inserted directly so the queue's
 * behaviour against it can be observed rather than argued about.
 *
 * The timestamps are given as "how long ago", because every property they are
 * used for is relative to now: a grace period, a stale beat, a deadline.
 */
export function insertSynthetic(state, {
  id,
  state: jobState = 'queued',
  version = 1,
  agedMs = 0,
  waiterPid = null,
  workerPid = null,
  workspace = '/tmp',
  request = { messages: [{ role: 'user', content: 'synthetic' }] },
  startedAgoMs = null,
  beatAgoMs = null,
  cancelAgoMs = null,
  outcome = null,
  failure = null,
}) {
  const stamp = ago(agedMs);
  return withStore(state, (db) => {
    db.prepare(SYNTHETIC).run(
      id, jobState, version, workspace, JSON.stringify(request),
      stamp, stamp, ago(startedAgoMs), ago(beatAgoMs), waiterPid, workerPid,
      outcome && JSON.stringify(outcome), failure && JSON.stringify(failure), ago(cancelAgoMs),
    );
    return Number(db.prepare('SELECT seq FROM jobs WHERE id = ?').get(id).seq);
  });
}

/**
 * Claim the database for a plugin this build has never heard of.
 *
 * Written raw rather than through `openStore`, which is exactly the call that
 * must refuse afterwards — going through it would be asking the guard to install
 * the thing it guards against.
 */
export function setUserVersion(state, version) {
  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = state;
  try {
    // Resolved here rather than at module scope so this file still LINKS without
    // `node:sqlite`, and synchronously — through `require` rather than `import` —
    // because making this async would ripple into all ten calling files.
    const { DatabaseSync } = sqliteModule();
    const db = new DatabaseSync(databasePath());
    db.exec(`PRAGMA user_version = ${version}`);
    db.close();
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
}

/**
 * A server, a config and a state directory wired together for queue tests.
 *
 * `maxInFlight` is the assertion the whole queue exists to support, and it is
 * counted **on the server** rather than derived from timestamps: a row can say
 * two jobs did not overlap while the requests plainly did.
 */
export async function queueScenario({ delayMs = 0, failChats = false } = {}) {
  const tracker = { inFlight: 0, maxInFlight: 0 };
  const server = await startFakeServer((request, response) => {
    // Only the chat completion is slow. Matching on `/models` alone is not
    // enough: the provider probe also asks for `/props` and `/info`, and giving
    // *those* the delay makes every later submission block behind the running
    // job — which looks exactly like a queue that works and is not one.
    if (!request.url.includes('chat/completions')) {
      respondJson(response, { data: [{ id: 'test-model', object: 'model' }] });
      return;
    }
    tracker.inFlight += 1;
    tracker.maxInFlight = Math.max(tracker.maxInFlight, tracker.inFlight);
    const timer = setTimeout(() => {
      tracker.inFlight -= 1;
      // A server that answers with a refusal rather than a completion, so a test
      // can watch the whole failure path — worker, envelope, row — instead of
      // fabricating a `failed` row and asserting on its own fixture.
      if (failChats) respondJson(response, { error: { message: 'the model is on fire' } }, 500);
      else respondJson(response, { model: 'test-model', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    }, delayMs);
    // A client that goes away mid-request — which is exactly what cancelling a
    // running job produces — must not leave a long timer pending in the test
    // process, or every cancellation test pays the full delay in wall clock
    // after it has already finished asserting.
    response.on('close', () => {
      if (!response.writableEnded) tracker.inFlight -= 1;
      clearTimeout(timer);
    });
  });

  const { path: configPath } = writeConfig({
    providers: { fake: { baseUrl: server.baseUrl, defaultModel: 'test-model', contextLength: 8192, timeoutSeconds: 30 } },
    defaultProvider: 'fake',
  });
  const state = stateDir();

  return {
    server,
    tracker,
    state,
    chats: () => server.requests.filter((request) => request.url.includes('chat/completions')),
    // Any companion command against this scenario's config and state directory.
    // `cwd` is a parameter because the workspace a job records is the directory
    // it was submitted from, and a bare `/oai:status` filters on it — a test
    // that cannot vary the directory cannot exercise that at all.
    run: (args, { cwd } = {}) => runCompanion(args, { configPath, env: { OAI_PLUGIN_STATE: state }, cwd }),
    submit: (extra = [], { cwd } = {}) =>
      runCompanion(['task', '--background', ...extra, 'do it'], { configPath, env: { OAI_PLUGIN_STATE: state }, cwd }),
  };
}

/**
 * Wait for a job to reach one of `states`, polling because the worker is a
 * different process and there is nothing to await.
 *
 * Returns the row. Throws with the row's actual state on timeout, since "it
 * never got there" is far less useful than "it stopped at `failed`".
 */
export async function waitForState(state, id, states, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = readJob(state, id);
    if (last && states.includes(last.state)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} never reached ${states.join('|')}; last state was ${last?.state ?? '(no row)'}`);
}

/**
 * Run the companion with a deliberately SLOW stderr consumer — the one thing
 * `runCompanion` cannot do, since it drains as fast as the child writes and so
 * leaves nothing pending for `process.exit(2)` to discard. Discarding it is the
 * defect under test, so the slow reader is part of the fixture.
 * Resolves on `'close'`, so no descriptor outlives the test.
 */
export function submitWithSlowStderr(args, { configPath, state }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMPANION, ...args], {
      env: { ...process.env, OAI_PLUGIN_CONFIG: configPath, OAI_PLUGIN_STATE: state },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // A wedge must REJECT, never resolve. Resolving with what was collected would
    // turn the hang into a PASS: `close` reports a null status after a kill, which
    // satisfies the nonzero-exit assertion, and the notice may already have been
    // delivered before the wedge. So the backstop fails by name or not at all.
    // 30s because this is a hang backstop and not a functional assertion — a tight
    // timer under load would add a second flake source to the file that most needs
    // to be trustworthy (OAI-97).
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('the companion never exited: the slow-stderr fixture wedged'));
    }, 30_000);
    // Stated limit: this reject path is itself UNEXERCISED — nothing in the suite
    // wedges, so the backstop has never fired. It is a hang guard, not a tested
    // invariant, and saying so is cheaper than implying coverage it does not have.
    let stderr = '';
    child.stdout.resume();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      child.stderr.pause();
      // 30ms: long enough that the child outruns the reader, short enough not to pad the suite.
      setTimeout(() => child.stderr.resume(), 30);
    });
    // Mirrors `runCompanion`: a spawn failure is an unhandled 'error' event
    // otherwise, which crashes the runner instead of failing this test.
    child.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(deadline);
      resolve({ status, stderr });
    });
  });
}
