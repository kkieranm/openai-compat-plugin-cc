// Handing a task to a worker instead of waiting for it.
//
// Submission does everything the foreground path does *except* the model call:
// the same profile, the same `/v1/models` probe, the same context-window check,
// the same built `messages`. That is deliberate — a request that will not fit,
// or a server that is not there, still fails **in front of the user**, rather
// than turning into a job that fails quietly minutes later.
import { randomUUID } from 'node:crypto';
import { NO_RATE_NOTE, estimateNote, estimateRun } from './eta.mjs';
import { authPolicyFor } from './job-auth.mjs';
import { insertJob, markSpawned } from './job-record.mjs';
import { persistRequest } from './job-request.mjs';
import { sweep } from './job-retention.mjs';
import { spawnWorker } from './job-spawn.mjs';
import { isBusy, openStore, requireDatabaseSync } from './job-store.mjs';
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
 * `buildJob` persists the EFFECTIVE endpoint, so a `--base-url` carrying a
 * credential — `?api_key=…`, or a token sitting in the path, which
 * `normalizeBaseUrl` keeps in `baseUrl` — puts a real secret into persisted
 * state. Three things about this notice are deliberate, and each replaces a
 * wording an execution path falsified (`adr/019`):
 *
 * It takes **no argument**, because a function handed the URL is a function
 * that will eventually interpolate it: the version this replaces printed the
 * query string into its own warning about that query string, on stderr, which
 * reaches terminals, CI logs and the delegate agent's captured output.
 *
 * It is **unconditional**, because gating needs the code to know which part of
 * a URL is a secret and it cannot: `?SUPERSECRET123` parses as a parameter
 * NAME, and a credential in the path is persisted with the same consequence and
 * matches no query test at all.
 *
 * It is **conditional in what it says** rather than in when it fires. "If this
 * submission creates a job record" survives a failure before `insertJob`, and
 * the worker-start clause is true precisely because `spawnWorker` runs after
 * it. It promises nothing about who can read the file: that guarantee belongs
 * to hardening this tree does not yet have (OAI-95).
 *
 * The sentence is NOT exported, and `tests/credential-notice.test.js` writes it
 * out again rather than importing it. That duplication is deliberate: an
 * imported expectation moves with the code, so adding an equivalent assurance
 * here would change both sides at once and the test would pass. The second copy
 * is what makes a wording change fail.
 */
function noteEndpointPersistence() {
  process.stderr.write(
    'Note: if this submission creates a job record, its full endpoint — including any query string — ' +
      'will be written to jobs.db; a later worker-start failure does not remove it.\n',
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
  // FIRST, before the server is probed and before anything is written. A runtime
  // that cannot open the store can never accept this job, and everything below
  // costs something the user does not get back: `prepareTask` makes real requests
  // to the provider, which a submission that can never be accepted should not
  // spend.
  requireDatabaseSync();

  // A background run has nobody watching it, so it gets a wall-clock cap whether
  // or not one was asked for. An uncapped run that wedges holds the queue.
  const options = { ...args.options };
  if (options['max-seconds'] === undefined) options['max-seconds'] = String(DEFAULT_BACKGROUND_MAX_SECONDS);

  noteEndpointPersistence();
  const prep = await prepareTask({ ...args, options });

  // The estimate belongs here MORE than on the foreground path, not less: "shown
  // before submission" is what the plan asked for, and this is submission. It is
  // also the moment a caller decides whether the wait is worth a `--max-wait`.
  const estimate = estimateRun({ estimatedTokens: prep.estimatedTokens, maxTokens: prep.numeric.maxTokens, profile: prep.profile });
  process.stderr.write(`${estimate ? estimateNote(estimate) : NO_RATE_NOTE}\n`);

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
