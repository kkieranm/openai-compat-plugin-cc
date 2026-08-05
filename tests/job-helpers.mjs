// Helpers for tests that involve a job database and a detached worker.
//
// A separate file from `helpers.mjs` because that one is at its size ceiling,
// and because these are only useful to the background tests.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../scripts/lib/job-store.mjs';
import { jobById, listJobs } from '../scripts/lib/job-record.mjs';

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
export function readJobs(state) {
  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = state;
  try {
    return listJobs(openStore());
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
}

export function readJob(state, id) {
  const previous = process.env.OAI_PLUGIN_STATE;
  process.env.OAI_PLUGIN_STATE = state;
  try {
    return jobById(openStore(), id);
  } finally {
    if (previous === undefined) delete process.env.OAI_PLUGIN_STATE;
    else process.env.OAI_PLUGIN_STATE = previous;
  }
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
