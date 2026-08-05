// Handing a task to a worker instead of waiting for it.
//
// Submission does everything the foreground path does *except* the model call:
// the same profile, the same `/v1/models` probe, the same context-window check,
// the same built `messages`. That is deliberate — a request that will not fit,
// or a server that is not there, still fails **in front of the user**, rather
// than turning into a job that fails quietly minutes later.
import { randomUUID } from 'node:crypto';
import { authPolicyFor } from './job-auth.mjs';
import { insertJob, markSpawned } from './job-record.mjs';
import { persistRequest } from './job-request.mjs';
import { sweep } from './job-retention.mjs';
import { spawnWorker } from './job-spawn.mjs';
import { isBusy, openStore } from './job-store.mjs';
import { prepareTask } from './task-execute.mjs';

/** An hour, unless the caller says otherwise. */
const DEFAULT_BACKGROUND_MAX_SECONDS = 3600;

/** Digests beside the snapshot: which files, and how much of each was captured. */
function digestsOf(files) {
  return files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content, 'utf8') }));
}

/**
 * Said out loud, because the alternative is a claim this plugin cannot make.
 *
 * `normalizeBaseUrl` keeps a base URL's query string verbatim, and the job row
 * stores it — so a `--base-url` carrying `?api_key=…` puts a real secret into
 * persisted state. "The credential is never persisted" is true of the profile's
 * key and false of this one. The row is `0600` and the directory `0700`, which
 * limits who can read it but does not make the sentence true, so the user is
 * told rather than reassured.
 */
function warnAboutQueryCredentials(profile) {
  if (!profile.query) return;
  process.stderr.write(
    `Note: the base URL's query string (${profile.query}) is stored with this job so the worker can reach the same endpoint. ` +
      'If it carries a key, that key is now on disk — readable only by you, but on disk.\n',
  );
}

function buildJob(prep) {
  return {
    id: randomUUID().slice(0, 8),
    kind: 'task',
    workspace: process.cwd(),
    // The EFFECTIVE endpoint, not an origin: an origin drops the `/v1` path, the
    // query parameters and an explicit `--base-url`, so a worker rebuilding from
    // the provider name alone would call somewhere submission never validated.
    transport: { name: prep.profile.name, baseUrl: prep.profile.baseUrl, query: prep.profile.query ?? '' },
    auth: authPolicyFor(prep.profile),
    model: prep.model,
    contextLength: prep.contextLength,
    request: persistRequest(prep),
    attachments: digestsOf(prep.files),
    createdAt: new Date().toISOString(),
    maxWaitMs: prep.numeric.maxWaitSeconds === undefined ? null : prep.numeric.maxWaitSeconds * 1000,
  };
}

/**
 * Housekeeping, and it must never cost the user the job they just submitted.
 *
 * A contended database is the failure expected here — another process holding
 * the write lock past the busy timeout — and the right answer is to leave the
 * sweep for the next submission, which is exactly as good since nothing depends
 * on it having happened. Anything else is a defect in the sweep and is raised
 * rather than swallowed: a blanket catch would turn a broken sweep into an
 * unbounded table nobody ever hears about.
 */
function sweepQuietly(db) {
  try {
    sweep(db);
  } catch (error) {
    if (!isBusy(error)) throw error;
  }
}

/**
 * Submit, spawn, and report the id — the whole foreground half of a background
 * job.
 */
export async function submitTask(args) {
  // A background run has nobody watching it, so it gets a wall-clock cap whether
  // or not one was asked for. An uncapped run that wedges holds the queue.
  const options = { ...args.options };
  if (options['max-seconds'] === undefined) options['max-seconds'] = String(DEFAULT_BACKGROUND_MAX_SECONDS);

  const prep = await prepareTask({ ...args, options });
  warnAboutQueryCredentials(prep.profile);

  const db = openStore();
  const job = buildJob(prep);
  const seq = insertJob(db, job);

  const pid = await spawnWorker(seq);
  // Stamped only once the child is known to exist, because it is what bounds how
  // long a job may sit with no worker registered before it is treated as one
  // that never started. Stamping it before the spawn would start that clock
  // against a process that does not exist yet.
  markSpawned(db, seq, new Date().toISOString());
  // Submission is the only place a row is ever created, so it is the only place
  // the table grows and the only place worth sweeping. Putting it in the readers
  // instead would make `/oai:status` delete history while someone was looking at
  // it, for no gain.
  sweepQuietly(db);
  return { id: job.id, seq, pid };
}
