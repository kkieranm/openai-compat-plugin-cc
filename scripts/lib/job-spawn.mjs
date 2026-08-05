// Starting a worker that outlives the command that started it.
//
// This is the one place in the repo that launches a process meant to survive its
// parent, and every line of it is load-bearing.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logPathFor } from './job-store.mjs';

const COMPANION = fileURLToPath(new URL('../oai-companion.mjs', import.meta.url));

/**
 * Launch the detached worker for a job, and do not return until we know it
 * actually started.
 *
 * **The stdio arrangement is the single biggest trap in this feature.**
 * `tests/helpers.mjs` `runCompanion` resolves on the child's `'close'` event,
 * which fires only once the process has ended *and every pipe it holds has
 * closed*. A detached grandchild that inherited the submitter's piped stdout
 * would keep those descriptors open for as long as it ran — so `--background`
 * would silently behave like a foreground run, and the suite would hang until a
 * client timeout rather than fail. `'ignore'` plus two regular-file descriptors
 * means the worker holds no pipe at all.
 *
 * **`unref()` comes after the outcome, not before.** A failed spawn usually
 * arrives as an asynchronous `'error'` event rather than a throw, and an
 * unresolved promise does not keep node alive: `oai-companion.mjs` has no
 * `process.exit(0)` on success, so un-referencing first lets the submitter exit
 * before it learns the child never started — losing exactly the case this
 * function exists to catch.
 */
export async function spawnWorker(seq) {
  const log = openSync(logPathFor(seq), 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [COMPANION, 'task-worker', '--seq', String(seq)], {
      detached: true,
      stdio: ['ignore', log, log],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  } finally {
    // The submitter's own copy of the descriptor is not the worker's; leaving it
    // open would hold the log file for the life of a process that no longer
    // needs it.
    closeSync(log);
  }
  child.unref();
  return child.pid;
}
