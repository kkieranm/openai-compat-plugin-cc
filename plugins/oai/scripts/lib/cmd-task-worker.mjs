// The detached worker: the process that outlives the session that asked for the
// job.
//
// Hidden rather than user-facing — it is dispatched by `oai-companion.mjs` but
// left out of the "Unknown command" list, because it is an implementation detail
// of `--background` and not something anyone should type.
//
// Its stdout and stderr are the job's log file, so whatever the worker itself
// writes — retry notices, a cancellation exit, an unrecordable failure, a
// salvaged answer, an uncaught error — lands there with no plumbing at all.
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
 * against somewhere else. The API key is looked up fresh — and on the
 * commitment path so is the query, verified against the frozen commitment —
 * and only when the
 * frozen endpoint still matches what the profile resolves to now.
 *
 * **On the commitment path the query itself comes from the resolver, not from
 * the row** — `job.transport.query` does not exist there; the row carries only
 * `queryHash`/`querySalt`. `resolveCredential` re-resolves the live query as
 * part of its one config resolution, and this is where that re-resolved value
 * finally reaches the request.
 *
 * **Fails closed if the resolved query comes back falsy on that path.** This
 * is unambiguous rather than a guess: an empty query never takes the
 * commitment path in the first place (`task-submit.mjs`'s `transportFor`
 * keeps it raw), so `queryHash` present but a falsy resolved query always
 * means a real failure — including the hand-edited row that carries
 * `queryHash` under `auth.mode === 'none'`, where `resolveCredential` returns
 * early and this is the only check left: without it `resolved.query` would
 * throw a `TypeError` instead of this refusal, and an optional-chained read
 * there would send the request unauthenticated.
 */
function transportProfile(job) {
  const resolved = resolveCredential(job.auth, job.transport, job.schema_version);
  const onHashPath = job.transport.queryHash !== undefined;
  if (onHashPath && !resolved?.query) {
    throw new UserError(
      `credential-unavailable: job ${job.id} needs its query re-resolved but none came back. Run /oai:setup to see why.`,
    );
  }
  return {
    name: job.transport.name,
    baseUrl: job.transport.baseUrl,
    query: onHashPath ? resolved.query : job.transport.query || '',
    apiKey: resolved?.apiKey,
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
    declaredServedModel: result.declaredServedModel ?? null,
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
 * Returning the outcome instead of writing it keeps the completed write out of
 * `runAndPublish`'s `failed` catch; the comment at that write says why.
 */
async function runJob(job) {
  const startedAt = Date.now();
  const ledger = createLedger();
  // The declaration frozen at submission, so `finishAnswer` reads it off the
  // profile exactly as the foreground path does.
  const profile = { ...transportProfile(job), servedModelIds: job.request?.servedModelIds };
  const request = reconstructRequest(job.request, { model: job.model, ledger });

  const result = await chatCompletion(profile, request);
  // Refused here rather than persisted: an empty answer stored as a success is a
  // run that looks like it worked and said nothing.
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
 * storage failure thrown here would escape as itself and the caller's `throw
 * error` would never run — erasing the model-failure diagnosis from the only
 * channel still carrying it, since the row write that would have carried it is
 * exactly what failed.
 *
 * That claim is **guarded rather than asserted**: the report itself is a write to
 * a real file descriptor — this worker's stderr is its job log — and a write can
 * fail. Unguarded, an `EIO` there would reproduce the whole defect through the
 * reporting of it. Swallowing that one loses only the storage-fault line: the
 * rethrown diagnosis still travels to `oai-companion.mjs`, which writes it to
 * the same descriptor.
 *
 * It does NOT test `isBusy`: catching only the busy and rethrowing everything
 * else would leave a disk error, a corrupt file or a schema fault reproducing
 * the identical loss. Which storage fault it was does not change
 * what a reader needs — the reason the JOB failed — so both errors are kept:
 * this one by message on stderr, which is the job log, and the diagnosis by the
 * caller propagating it. `error.cause` is deliberately not used:
 * `oai-companion.mjs` prints a `UserError`'s message and hint, and `error.stack`
 * for anything else, and neither renders a cause, so it would be preserved
 * somewhere nobody reads.
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
      // Deliberately empty: stderr IS the job log, so a write that fails here has no fallback to
      // escalate to. Rethrowing would replace the diagnosis with a report about
      // the failure to report — the exact defect this function exists to prevent.
    }
  }
}

/**
 * The last place an answer can go when its row will not take it.
 *
 * **Its durability is bounded by the row's, and how long the row lasts depends
 * on how it ended.** When the `completed` write matched no row because an
 * operator abandoned it, the row is `operator-abandoned` after reaching
 * `running`, which `job-retention.mjs` exempts from pruning entirely — so this
 * line cannot be unlinked underneath a worker still writing it, and it lasts as
 * long as that row, which is kept indefinitely. When the write THREW, the row is
 * later reconciled as a dead worker, an ordinary terminal row: once it falls
 * outside the retained window it is pruned, and the sweep unlinks this log with
 * it.
 *
 * What that does NOT buy: this is not a store. Nothing indexes the line,
 * and the only reader is a person following the log path `/oai:result` prints.
 *
 * **Not durable persistence, and deliberately not.** It opens nothing, defines
 * no schema and adds no reader: it writes to the descriptor this worker was
 * spawned with — `job-spawn.mjs` opens the job log once and passes it as both
 * stdout and stderr — which is a channel the process already owns. A real
 * fallback store would need a lifecycle, retention and something that reads it.
 *
 * The prefix is the whole point. This log also carries retry notices and any
 * error the worker prints, so an unmarked JSON dump would be recoverable in
 * principle and not in practice — the loss would have moved rather than gone.
 * `SALVAGED_OUTCOME` is fixed and greppable, and the `worker-died` discussion in
 * `runAndPublish` below points a reader of the source at `salvageOutcome`, so
 * once found there the salvaged answer is one fixed string to search the job
 * log for. Neither the `worker-died` hint nor `/oai:abandon`'s names the prefix;
 * both point only at the log.
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
 * Beat, run, and publish at most one terminal verdict — the whole guarded stretch.
 */
async function runAndPublish(db, seq, job) {
  // Only now: a queued worker is already visible through the wait loop's beat,
  // and this is the stretch that would otherwise be silent.
  // `job.id` goes with it because the cancellation exit records that id beside
  // the log, and that path may touch no database to look it up.
  const stopBeating = startHeartbeat(db, seq, { jobId: job.id });
  try {
    let outcome;
    try {
      outcome = await runJob(job);
    } catch (error) {
      publishFailure(db, seq, error);
      throw error;
    }

    // OUTSIDE the catch above. By this line the model has already answered, so a
    // lock held past the busy timeout does not cost a retry — it discards work
    // paid for in full. Retried for that; kept out of the `failed` catch so that
    // exhausting the retry cannot publish an answer that exists as a task
    // failure. If this throws, no ROW is written: the row stays `running` with
    // this worker's pid recorded; the rethrow ends the process, and once that pid
    // is observed dead reconciliation terminalizes it as a dead worker —
    // `worker-died`, or a cancellation outcome if one was pending.
    //
    // **That report is a misdiagnosis — the worker answered and then SQLite
    // refused the write — but it is not an immediate LOSS.** `salvageOutcome`
    // writes the answer to the job log before the error is rethrown, so the
    // reconciled row is wrong about the cause while the answer itself remains
    // readable until retention prunes that row (see `salvageOutcome`). The
    // row's own state stays wrong.
    //
    // TWO ways this write fails to land, and they differ in whether anything
    // went wrong. A THROW is storage refusing us, and is rethrown. A `false` is
    // the CAS matching no rows because the row is no longer `queued`/`running` —
    // nothing failed, someone else's terminal write simply got there first, and
    // that someone may be an operator running `/oai:abandon` rather than a race.
    //
    // Salvaging the `false` case costs one line — see `salvageOutcome` for what
    // that does and does not guarantee.
    try {
      if (!withBusyRetry(() => finish(db, seq, { state: 'completed', outcome, at: now() }))) {
        salvageOutcome(seq, outcome);
      }
    } catch (error) {
      salvageOutcome(seq, outcome);
      throw error;
    }
  } finally {
    // Stopped only after whichever terminal write this run makes, so the interval
    // is never cleared while one is still being retried. That is all this buys:
    // the retry sleeps synchronously, so no beat actually fires during a
    // contended write — see `job-busy.mjs`, where the sleep is defined and says
    // so. Counted from the start of the terminal write, the silence can run past
    // `withBusyRetry`'s budget, a floor, by about one in-flight attempt waiting
    // out the store's busy timeout plus one delay; counted from the last beat
    // that landed, add up to one `BEAT_MS` — and since a beat's timestamp is
    // taken before its own write waits on the busy timeout, measured against the
    // recorded `last_beat_at` add up to one more busy timeout. Beat ticks are
    // also skipped on busy before the write, so under sustained contention the
    // silence can approach or exceed `STALE_BEAT_MS`. A stale beat changes no
    // state on its own, but it lifts `/oai:abandon`'s need for `--force`
    // (`job-abandon.mjs`); with `--force` an operator can abandon a live worker
    // at any time. Either way, a `completed` write that loses to the abandon
    // matches no row and the answer is salvaged.
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
  // all: an unretried busy here would kill the worker before it had sent
  // anything, and the job it was spawned for would simply never run.
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
