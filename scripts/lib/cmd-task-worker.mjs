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
import { finish, jobBySeq, registerWaiter } from './job-record.mjs';
import { reconstructRequest } from './job-request.mjs';
import { openStore } from './job-store.mjs';
import { errorReport } from './review-report.mjs';

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
function outcomeOf(result, durationMs) {
  return {
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
  finish(db, seq, { state: 'completed', outcome: outcomeOf(result, Date.now() - startedAt), at: now() });
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
  registerWaiter(db, seq, process.pid, now());

  try {
    await runJob(db, seq, job);
  } catch (error) {
    // The failure envelope is the same one `/oai:review --json` produces, so a
    // reader learns the same things about a background failure as a foreground
    // one — reason, message, hint, attempts, requested model.
    finish(db, seq, { state: 'failed', failure: errorReport(error), at: now() });
    throw error;
  }
}
