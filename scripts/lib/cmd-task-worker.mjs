// The detached worker: the process that outlives the session that asked for the
// job.
//
// Hidden rather than user-facing — it is dispatched by `oai-companion.mjs` but
// left out of the "Unknown command" list, because it is an implementation detail
// of `--background` and not something anyone should type.
//
// Its stdout and stderr are the job's log file, so the ordinary progress
// heartbeat and the "Checking … for available models" line land there with no
// plumbing at all. That is why `progress.mjs` needs no change to support this.
import { parseCommandLine } from './args.mjs';
import { createLedger } from './attempt-ledger.mjs';
import { chatCompletion, requireAnswer } from './client.mjs';
import { UserError } from './errors.mjs';
import { resolveCredential } from './job-auth.mjs';
import { startHeartbeat } from './job-heartbeat.mjs';
import { awaitTurn } from './job-queue.mjs';
import { withBusyRetry } from './job-busy.mjs';
import { finish, jobBySeq, registerWaiter } from './job-record.mjs';
import { reconstructRequest } from './job-request.mjs';
import { openStore } from './job-store.mjs';
import { errorReport } from './review-report.mjs';
import { artifactFor } from './task-artifact.mjs';

export const TASK_WORKER_SPEC = {
  valueFlags: ['seq'],
};

const now = () => new Date().toISOString();

/**
 * The profile to send with, rebuilt from what the job froze rather than from
 * whatever the config says today.
 *
 * The endpoint comes from the row: re-deriving it from a provider name would let
 * a profile edited after submission redirect a job that was already validated
 * against somewhere else. Only the secret is looked up fresh, and only when the
 * three-way origin check permits it.
 */
function transportProfile(job) {
  return {
    name: job.transport.name,
    baseUrl: job.transport.baseUrl,
    query: job.transport.query || '',
    apiKey: resolveCredential(job.auth, job.transport),
  };
}

/** What `/oai:result` will render. Enough to reconstruct the run, nothing live. */
function outcomeOf(result, durationMs, template) {
  return {
    // The same verdict the foreground computes, persisted so `/oai:result` can
    // report it. Without this the discipline line describes a check that never
    // ran on this path.
    artifact: artifactFor({ template, answer: result.content ?? '', cwd: process.cwd() }),
    content: result.content ?? '',
    reasoning: result.reasoning ?? '',
    model: result.model ?? null,
    requestedModel: result.requestedModel ?? null,
    usage: result.usage ?? null,
    finishReason: result.finishReason ?? null,
    prefillMs: result.prefillMs ?? null,
    generationMs: result.generationMs ?? null,
    requestCount: result.requestCount ?? 1,
    durationMs,
  };
}

/**
 * Run the model call and return what to persist — **it writes nothing**.
 *
 * The completed write used to live at the end of this function, inside the try
 * whose catch publishes `failed`. So when that write exhausted its retry budget
 * the busy error propagated into that catch, which then wrote `failed` — and by
 * then contention had had thirty seconds to clear, so that write very likely
 * SUCCEEDED. An answer that existed was published as a task failure, which is
 * the precise outcome the retry was added to prevent.
 *
 * Returning the outcome instead of writing it puts the completed write outside
 * that catch's scope, which makes the defect impossible rather than handled.
 */
async function runJob(db, seq, job) {
  const startedAt = Date.now();
  const ledger = createLedger();
  const profile = transportProfile(job);
  const request = reconstructRequest(job.request, { model: job.model, ledger });

  const result = await chatCompletion(profile, request);
  // Refused here rather than persisted: an empty answer stored as a success is a
  // run that looks like it worked and said nothing, which is the shape this repo
  // keeps having to unpick.
  requireAnswer(result, profile);
  return outcomeOf(result, Date.now() - startedAt, job.request?.template);
}

/**
 * Publish a diagnosed failure, and never at the diagnosis's expense.
 *
 * The failure envelope is the same one `/oai:review --json` produces, so a
 * reader learns the same things about a background failure as a foreground one —
 * reason, message, hint, attempts, requested model. Retried for the same reason
 * as the completed write: a contended database must not turn a diagnosed failure
 * into an undiagnosed one by losing the report.
 *
 * **This function returns rather than throws, and its caller rethrows.** A
 * `throw` raised inside a `catch` block REPLACES the pending rethrow, so a
 * storage failure here escaped as itself and the caller's `throw error` never
 * ran — erasing the model-failure diagnosis from the only channel still carrying
 * it, since the row write that would have carried it is exactly what failed. A
 * job that died of a bad credential was logged as contention.
 *
 * That claim is **guarded rather than asserted**: the report itself is a write to
 * a real file descriptor — this worker's stderr is its job log — and a write can
 * fail. Unguarded, an `EIO` there would reproduce the whole defect through the
 * reporting of it. Nothing observable is lost by swallowing that one: the
 * rethrown diagnosis travels to `oai-companion.mjs`, which writes it to the same
 * descriptor, so on the only path where this fires there is no channel left for
 * either error to arrive on.
 *
 * It does NOT test `isBusy`, and that is the second half of the same lesson: a
 * first version caught only the busy and rethrew everything else, which fixed
 * the exhausted lock and left a disk error, a corrupt file or a schema fault
 * reproducing the identical loss. Which storage fault it was does not change
 * what a reader needs — the reason the JOB failed — so both errors are kept:
 * this one by message on stderr, which is the job log, and the diagnosis by the
 * caller propagating it. `error.cause` is deliberately not used;
 * `oai-companion.mjs` prints `error.stack`, which does not render a cause, so it
 * would be preserved somewhere nobody reads.
 */
function publishFailure(db, seq, error) {
  try {
    withBusyRetry(() => finish(db, seq, { state: 'failed', failure: errorReport(error), at: now() }));
  } catch (storageError) {
    // The code as well as the message: `errcode` is what SQLite attaches and what
    // `isBusy` reads, `code` is Node's, and without one of them a reader cannot
    // tell an exhausted lock from a corrupt file. It does NOT carry a stack —
    // this line is the whole record of the storage fault.
    const code = storageError?.errcode ?? storageError?.code ?? 'no code';
    try {
      process.stderr.write(`This failure could not be recorded (${code}: ${storageError?.message}). The diagnosis follows.\n`);
    } catch {
      // Deliberately empty, and it is the narrowest empty catch in this repo:
      // stderr IS the job log, so a write that fails here has no fallback to
      // escalate to. Rethrowing would replace the diagnosis with a report about
      // the failure to report — the exact defect this function exists to prevent.
    }
  }
}

/**
 * The last place an answer can go when its row will not take it.
 *
 * **Its durability is bounded by the row's, and since `/oai:abandon` that bound
 * is reachable.** An abandoned row is terminal while this worker may still be
 * running, so once 50 newer terminal rows exist the retention sweep prunes it and
 * unlinks the log this process still holds open — the salvaged line then lives
 * only in an unlinked inode and goes when the process exits. Narrow (it needs 50
 * subsequent completions on a one-at-a-time queue) but real: **OAI-161**.
 *
 * **Not durable persistence, and deliberately not.** It opens nothing, defines
 * no schema and adds no reader: it writes to the descriptor this worker was
 * spawned with — `job-spawn.mjs` opens the job log once and passes it as both
 * stdout and stderr — which is a channel the process already owns. A real
 * fallback store would need a lifecycle, retention and something that reads it,
 * and none of that was in this feature's plan.
 *
 * The prefix is the whole point. This log also carries the progress heartbeat
 * and the model's own chatter, so an unmarked JSON dump would be recoverable in
 * principle and not in practice — the loss would have moved rather than gone.
 * `SALVAGED_OUTCOME` is fixed, greppable, and named in `adr/020` and in the
 * `worker-died` discussion above, so a reader told the worker died has one
 * string to search for.
 *
 * Serialisation can itself throw — `outcome` holds only what `outcomeOf` built,
 * but a future field could be circular — and a throw here would replace the
 * storage error the caller is about to rethrow, which is the same defect
 * `publishFailure` exists to prevent. So it is guarded, and a failure to
 * serialise is reported as a line rather than raised.
 */
function salvageOutcome(seq, outcome) {
  try {
    process.stderr.write(`SALVAGED_OUTCOME ${seq} ${JSON.stringify(outcome)}\n`);
  } catch (writeError) {
    try {
      process.stderr.write(`SALVAGED_OUTCOME ${seq} could not be written (${writeError?.message}).\n`);
    } catch {
      // Same argument as `publishFailure`'s innermost catch, and for the same
      // descriptor: if this write fails there is no channel left to escalate to,
      // and raising would discard the storage error the caller is rethrowing.
    }
  }
}

/**
 * Beat, run, and publish exactly one terminal verdict — the whole guarded stretch.
 *
 * Extracted from `runTaskWorker` when the placement fix pushed it past this
 * repo's function-size budget: the terminal-write discipline below is one
 * cohesive stage and reads better named than inlined among argument parsing and
 * queue acquisition.
 */
async function runAndPublish(db, seq, job) {
  // Only now: a queued worker is already visible through the wait loop's beat,
  // and this is the stretch that would otherwise be silent.
  // `job.id` goes with it because the cancellation exit records that id beside
  // the log, and that path may touch no database to look it up (OAI-66).
  const stopBeating = startHeartbeat(db, seq, { jobId: job.id });
  try {
    let outcome;
    try {
      outcome = await runJob(db, seq, job);
    } catch (error) {
      publishFailure(db, seq, error);
      throw error;
    }

    // OUTSIDE the catch above, and the placement IS the fix. By this line the
    // model has already answered, so a lock held past the busy timeout does not
    // cost a retry — it discards work paid for in full. Retried for that; kept
    // out of the `failed` catch so that exhausting the retry cannot publish an
    // answer that exists as a task failure. If this throws, no ROW is written:
    // the row stays `running` with a live pid, and reconciliation later reports
    // the worker's death.
    //
    // **That report is still a misdiagnosis — the worker answered and then
    // SQLite refused the write — but it is no longer a LOSS.** The answer used
    // to exist only in a process about to exit; `salvageOutcome` now writes it
    // to the job log first, so `worker-died` names a row that is wrong about the
    // cause while the answer itself remains readable. Publishing it as `failed`
    // instead was worse (a paid-for answer reported as a model failure, on a
    // path where contention had by then cleared), which is why this line is
    // where it is. The residual — the row's own state — is **OAI-106**.
    // TWO ways this write fails to land, and they differ in whether anything
    // went wrong. A THROW is storage refusing us, and is rethrown. A `false` is
    // the CAS matching no rows because the row is no longer `queued`/`running` —
    // nothing failed, someone else's terminal write simply got there first, and
    // since `/oai:abandon` that someone may be an operator rather than a race.
    //
    // The `false` case used to be discarded entirely: `finish`'s return went
    // nowhere, no exception was raised, and a paid-for answer was written to
    // neither the row nor the log. Salvaging it costs one line — see
    // `salvageOutcome` for what that does and does not guarantee.
    try {
      if (!withBusyRetry(() => finish(db, seq, { state: 'completed', outcome, at: now() }))) {
        salvageOutcome(seq, outcome);
      }
    } catch (error) {
      salvageOutcome(seq, outcome);
      throw error;
    }
  } finally {
    // Stopped only after BOTH terminal writes, so the interval is never cleared
    // while one is still being retried. That is all this buys: the retry sleeps
    // synchronously, so no beat actually fires during a contended write — see
    // `job-busy.mjs`, where the sleep is defined and says so. The silence is
    // bounded well under `STALE_BEAT_MS`, and `stalled` is not a verdict anyway.
    stopBeating();
  }
}

export async function runTaskWorker(argv) {
  const { options } = parseCommandLine(argv, TASK_WORKER_SPEC);
  const seq = Number(options.seq);
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new UserError(`task-worker needs --seq <n>, got ${JSON.stringify(options.seq)}.`);
  }

  const db = openStore();
  const job = jobBySeq(db, seq);
  if (!job) throw new UserError(`No job with sequence ${seq}.`);

  // Says "a worker exists", which is a different fact from "a worker is running
  // this job" and is recorded far earlier. Without it a queued worker is
  // indistinguishable from one that never started, and anything queued behind a
  // long run would be collected as abandoned.
  // Retried, because this caller handles the false RETURN and has no catch at
  // all: a busy here killed the worker before it had sent anything, and the job
  // it was spawned for simply never ran. An earlier draft of the exclusion list
  // in `job-busy.mjs` claimed this caller "treats a throw as the answer" — it
  // does not, and review caught the claim rather than the code.
  if (!withBusyRetry(() => registerWaiter(db, seq, process.pid, now()))) {
    // Arrived too late: the row was reconciled away, or another worker holds it.
    // Exiting here is the point — nothing has been sent, and nothing will be.
    process.stderr.write(`Job ${job.id} is no longer waiting for a worker (state: ${jobBySeq(db, seq)?.state}).\n`);
    return;
  }

  const turn = await awaitTurn(db, job, process.pid);
  if (turn !== 'acquired') {
    process.stderr.write(`Job ${job.id} never ran (${turn}); no request was sent.\n`);
    return;
  }

  await runAndPublish(db, seq, job);
}
