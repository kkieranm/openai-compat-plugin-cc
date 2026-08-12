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
import { terminalizeSpawnFailure } from './job-launch-outcome.mjs';
import { persistRequest } from './job-request.mjs';
import { sweep } from './job-retention.mjs';
import { spawnWorker } from './job-spawn.mjs';
import { isBusy, withBusyRetry } from './job-busy.mjs';
import { openStore, requireDatabaseSync } from './job-store.mjs';
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
 *
 * **That first sentence was FALSE until 2026-08-12 (OAI-67), and the fix was
 * position rather than wording.** This ran AFTER the spawn, so a non-busy throw
 * rejected `submitTask` with a detached worker already created and expected to be
 * calling a paid model, and the id never printed — costing the user their handle
 * on the job they had just submitted, plus a retry that CAN duplicate the spend. Not "precisely
 * that job" and not "duplicates": only creation is established here, so what is
 * lost for certain is the id, and the double spend is a consequence that follows
 * when the worker did in fact survive to call. It now runs before anything
 * is created, where the sentence is simply true: there is no job yet to cost.
 * The rethrow is deliberately KEPT — dropping it would make retention
 * best-effort, and a `--json` caller cannot see the stderr warning that would
 * replace it (OAI-108), so the store could grow unbounded with no signal.
 */
function sweepQuietly(db) {
  try {
    sweep(db);
  } catch (error) {
    if (!isBusy(error)) throw error;
  }
}

/**
 * Launch the worker and record that it exists — the half of submission where a
 * live process may already have been created, and may already be spending.
 *
 * Extracted from `submitTask` when the exhaustion handling pushed it past this
 * repo's function-size budget; it is also the only part of submission whose
 * behaviour turns on how the spawn SETTLED — not on whether a process exists,
 * which the rejection branch cannot determine: "no child" and "live child after a
 * failed cleanup" arrive down the same path.
 *
 * **Its two branches know different amounts, and the difference is the whole
 * feature.** Past the `await`, the `'spawn'` event has fired and a child
 * demonstrably existed — the stamp path below can say so. The REJECTION branch
 * cannot: `spawnWorker` closes its copy of the log descriptor after that event,
 * so a rejection may mean no child was ever created, or a child that is alive.
 * `terminalizeSpawnFailure` is written for both, which is why it uses a
 * compare-and-set instead of a terminal write.
 *
 * Stamped only once the child is known to exist, because it is what bounds how
 * long a job may sit with no worker registered before it is treated as one
 * that never started. Stamping it before the spawn would start that clock
 * against a process that does not exist yet.
 *
 * Retried, for the reason just given: by here the `'spawn'` event has
 * fired, so a DETACHED WORKER EXISTED and is expected to make a real model
 * call. (Expected, not guaranteed — it may already have died, which the
 * warning in the catch below is careful not to claim either way. What is established
 * is that one was created, and that is what makes the id worth keeping.) A busy that escapes this
 * write rejects `submitTask`, so `cmd-task.mjs` never prints the id — leaving
 * the user liable for a job they cannot name, poll or cancel. `insertJob`,
 * which runs before this, is deliberately NOT wrapped: a busy there
 * means no row and no worker, which is a clean failure with nothing running.
 *
 * And the retry NARROWS that window without closing it, so exhausting the
 * budget must not reject the submission either. The id is the more valuable
 * of the two facts by a wide margin: without the stamp `livenessOf` falls back
 * to `created_at`, which only shortens a startup grace window, and once the
 * worker registers itself the stamp stops being consulted at all — whereas
 * without the id there is no way to poll or cancel a job that may be spending
 * money. Reported rather than swallowed, on stderr, where the submitting
 * session can see it.
 *
 * What that report may SAY is narrower than what this function knows. A spawn
 * happened — that is observed, and it is why the id is worth printing. Whether
 * the worker is still alive thirty seconds later is not: the retry only
 * exhausts after a budget long enough for the child to have registered, run,
 * failed, or died, and this process watched none of it. So the warning states
 * the spawn, states that the submitter cannot see what followed, and points at
 * `/oai:status`, which reads the row rather than guessing. Claiming "the job is
 * running" here turned a submission that may have failed into apparent success.
 *
 * Reported on stderr and NOWHERE ELSE, which is a known gap rather than an
 * oversight: a machine caller reads `--json`, whose background envelope is the
 * same `{id, background: true}` a recorded start produces, so nothing in that
 * channel distinguishes them. A field carrying it was built during review and
 * reverted — it changed a published contract this feature's plan never
 * approved — and the gap is filed as **OAI-108** instead.
 */
async function spawnAndStamp(db, seq, job, spawn) {
  let pid;
  try {
    pid = await spawn(seq);
  } catch (error) {
    terminalizeSpawnFailure(db, seq, job, error);
    throw error;
  }
  // ANY storage fault, never `isBusy` alone — `adr/020`'s converting group, argued
  // there. Rethrowing all but a busy lost the id the same way (OAI-67, pass 3).
  try {
    withBusyRetry(() => markSpawned(db, seq, new Date().toISOString()));
  } catch (error) {
    // Guarded, and NOT for the sibling's reason. `terminalizeSpawnFailure` wraps
    // its report because a throw inside a catch replaces a pending rethrow; here
    // nothing is pending, and the damage is different: an escaping write would
    // stop this function RETURNING, so the id would be lost — the exact harm the
    // catch exists to prevent, delivered by the reporting of it. A closed stderr
    // pipe is enough. Swallowing means the caller keeps a valid id and gets no
    // notice at all, which is the lesser loss and the deliberate one.
    try {
      process.stderr.write(
        `Warning: job ${job.id} was spawned, but its start time could not be recorded: ${error.message}. `
        + 'The id below is valid; this session cannot see what the worker did next. '
        + 'Check it with /oai:status.\n',
      );
    } catch {
      // Nothing can carry the notice. The id still can.
    }
  }
  return pid;
}

/**
 * Submit, spawn, and report the id — the whole foreground half of a background
 * job.
 */
export async function submitTask(args, { spawn = spawnWorker } = {}) {
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

  // BEFORE the row and the worker exist, not after. Submission is still the only
  // place a row is ever created, so it is still the only place the table grows
  // and the only place worth sweeping — putting it in the readers would make
  // `/oai:status` delete history while someone was looking at it, for no gain.
  // That reasoning is unchanged by the move; what changed is that a sweep defect
  // can no longer sink a submission whose worker may already be spending. The
  // row about to be inserted is not finished, so nothing about WHAT gets swept
  // changes either.
  //
  // WHEN it gets swept does change, and in one way worth stating rather than
  // leaving a reader to infer from the line above. A submission that FAILS —
  // because the insert throws, or the spawn is unconfirmed — has now already run
  // the sweep, where before the failure path skipped it entirely. So an
  // unsuccessful submission carries a destructive side effect it did not carry
  // before. That is accepted rather than overlooked: the rows it deletes are
  // exactly the retention-eligible ones it would have deleted on the success
  // path, so nothing is destroyed that a successful run would have kept, and
  // sweeping is not owed to the submission that triggered it.
  sweepQuietly(db);

  const job = buildJob(prep);
  const seq = insertJob(db, job);

  const pid = await spawnAndStamp(db, seq, job, spawn);

  return { id: job.id, seq, pid };
}
