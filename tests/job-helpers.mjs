// Helpers for tests that involve a job database and a detached worker.
//
// A separate file from `helpers.mjs` because that one is at its size ceiling,
// and because these are only useful to the background tests.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../scripts/lib/job-store.mjs';
import { jobById, listJobs } from '../scripts/lib/job-record.mjs';
import { respondJson, runCompanion, startFakeServer, writeConfig } from './helpers.mjs';

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
 */
export async function deadPid() {
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  const pid = child.pid;
  await new Promise((resolve) => child.once('exit', resolve));
  return pid;
}

const SYNTHETIC = `
  INSERT INTO jobs (id, kind, state, schema_version, workspace, transport, auth, request, attachments,
                    created_at, spawned_at, waiter_pid, worker_pid)
  VALUES (?, 'task', ?, ?, '/tmp', '{}', '{"mode":"none"}', '{"messages":[]}', '[]', ?, ?, ?, ?)
`;

/**
 * A row no code path in this build produces — a foreign plugin's version, a
 * corrupt shape, or an abandoned submission — inserted directly so the queue's
 * behaviour against it can be observed rather than argued about.
 */
export function insertSynthetic(state, { id, state: jobState = 'queued', version = 1, agedMs = 0, waiterPid = null, workerPid = null }) {
  const stamp = new Date(Date.now() - agedMs).toISOString();
  return withStore(state, (db) => {
    db.prepare(SYNTHETIC).run(id, jobState, version, stamp, stamp, waiterPid, workerPid);
    return Number(db.prepare('SELECT seq FROM jobs WHERE id = ?').get(id).seq);
  });
}

/**
 * A server, a config and a state directory wired together for queue tests.
 *
 * `maxInFlight` is the assertion the whole queue exists to support, and it is
 * counted **on the server** rather than derived from timestamps: a row can say
 * two jobs did not overlap while the requests plainly did.
 */
export async function queueScenario({ delayMs = 0 } = {}) {
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
    setTimeout(() => {
      tracker.inFlight -= 1;
      respondJson(response, { model: 'test-model', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    }, delayMs);
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
    submit: (extra = []) =>
      runCompanion(['task', '--background', ...extra, 'do it'], { configPath, env: { OAI_PLUGIN_STATE: state } }),
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
