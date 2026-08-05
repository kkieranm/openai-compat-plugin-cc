// Handing a task to a worker instead of waiting for it.
//
// Submission does everything the foreground path does *except* the model call:
// the same profile, the same `/v1/models` probe, the same context-window check,
// the same built `messages`. That is deliberate — a request that will not fit,
// or a server that is not there, still fails **in front of the user**, rather
// than turning into a job that fails quietly minutes later.
import { randomUUID } from 'node:crypto';
import { insertJob, markSpawned } from './job-record.mjs';
import { spawnWorker } from './job-spawn.mjs';
import { openStore } from './job-store.mjs';
import { prepareTask } from './task-execute.mjs';

/**
 * What the model will be sent, frozen at the moment of submission.
 *
 * `messages` is the whole point and is why the stage gate is met by
 * construction rather than by discipline: it already contains the full text of
 * every attached file, so the worker never reads the filesystem for input and
 * **no later edit can reach the model**. There is no code path by which it
 * could.
 */
function persistRequest(prep) {
  const { numeric, messages } = prep;
  const request = { messages, maxMs: numeric.maxSeconds ? numeric.maxSeconds * 1000 : undefined };
  // Absent, never null. `client.mjs` builds its body with `!== undefined`, so a
  // field that round-trips through JSON as null would go on the wire where the
  // foreground path omits it entirely — a different request wearing the same
  // name.
  for (const [key, value] of Object.entries({
    temperature: numeric.temperature,
    maxTokens: numeric.maxTokens,
    maxAttempts: numeric.maxAttempts,
    timeoutSeconds: numeric.timeoutSeconds,
  })) {
    if (value !== undefined) request[key] = value;
  }
  return request;
}

/** Digests beside the snapshot: which files, and whether they have since moved. */
function digestsOf(files) {
  return files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content, 'utf8') }));
}

/**
 * Submit, spawn, and report the id — the whole foreground half of a background
 * job.
 */
export async function submitTask(args) {
  const prep = await prepareTask(args);
  const db = openStore();

  const job = {
    id: randomUUID().slice(0, 8),
    kind: 'task',
    workspace: process.cwd(),
    transport: { name: prep.profile.name, baseUrl: prep.profile.baseUrl, query: prep.profile.query ?? '' },
    // Phase 1 records the shape; phase 2 decides it properly, including the
    // three-way origin check that keeps a credential from following a moved
    // profile to an endpoint it was never authorised for.
    auth: { mode: 'none' },
    model: prep.model,
    contextLength: prep.contextLength,
    request: persistRequest(prep),
    attachments: digestsOf(prep.files),
    createdAt: new Date().toISOString(),
    maxWaitMs: null,
  };

  const seq = insertJob(db, job);
  const pid = await spawnWorker(seq);
  // Stamped only once the child is known to exist, because it is what bounds how
  // long a job may sit with no worker registered before it is treated as one
  // that never started. Stamping it before the spawn would start that clock
  // against a process that does not exist yet.
  markSpawned(db, seq, new Date().toISOString());
  return { id: job.id, seq, pid };
}
