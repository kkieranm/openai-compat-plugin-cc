// The acknowledgement file, as a test sees it.
//
// Both paths are stated independently of the code that builds them, so a test
// cannot agree with the implementation about a layout they both got wrong. They
// live here rather than in `job-helpers.mjs` because only the two cancellation
// files need them, and shared here rather than duplicated because a fixture that
// disagreed with its sibling about the path would pass while testing nothing.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAlive, pidLiveness } from '../plugins/oai/scripts/lib/job-liveness.mjs';
import { insertSynthetic, pollUntil } from './job-helpers.mjs';

/**
 * Wait for a pid to stop existing.
 *
 * The same observation the plugin makes, made the same way: a worker that should
 * have exited shows up here as a process that is still there, which is a far more
 * useful failure than a row that never changed state. A pid the OS cannot be asked
 * about is refused rather than waited on: `isAlive` reads it as not alive, which
 * would pass at once.
 */
export async function waitForExit(pid, { timeoutMs } = {}) {
  if (pidLiveness(pid) === 'unreadable') throw new Error(`waitForExit needs a pid the OS can be asked about, got ${pid}`);
  await pollUntil(() => !isAlive(pid), {
    timeoutMs,
    describe: () => `pid ${pid} was still alive at the deadline`,
  });
}

export const ackPath = (state, seq) => join(state, 'logs', `${seq}.cancel-ack`);
export const logPath = (state, seq) => join(state, 'logs', `${seq}.log`);

/** What a worker writes on its way out, as the reader expects to find it. */
export const ackPayload = (id) => `${id}\n2026-08-13T00:00:00.000Z\n`;

/** The id a worker announced, or `null` when it announced nothing. */
export function readAck(state, seq) {
  try {
    return readFileSync(ackPath(state, seq), 'utf8').split('\n')[0].trim();
  } catch {
    return null;
  }
}

/**
 * A pid that has genuinely exited.
 *
 * A pid that never existed and one that has died read identically to `isAlive`,
 * but only the second is a state this repo can actually reach — and spawning it
 * is what makes these fixtures a real process's death rather than a number
 * chosen to look like one. Async on purpose: `spawnSync` blocks the loop the
 * scenario's own server runs on.
 */
export function exitedPid() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', '']);
    child.on('error', reject);
    child.on('exit', () => resolve(child.pid));
  });
}

/**
 * A row whose worker is dead, optionally with a cancellation pending — the state
 * every verdict in `cancel-confirmation.test.js` is read out of.
 */
export async function deadRunning(state, id, { cancelled = true } = {}) {
  return insertSynthetic(state, {
    id,
    state: 'running',
    workerPid: await exitedPid(),
    startedAgoMs: 5000,
    beatAgoMs: 1000,
    ...(cancelled ? { cancelAgoMs: 1000 } : {}),
  });
}

/** `mkfifo`, without a synchronous spawn — the suite bans those, and rightly. */
export function makeFifo(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('mkfifo', [path]);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mkfifo exited ${code}`))));
  });
}
