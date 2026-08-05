// The detached worker: the process that outlives the session that asked for the
// job.
//
// Hidden rather than user-facing — it is dispatched by `oai-companion.mjs` but
// left out of the "Unknown command" list, because it is an implementation detail
// of `--background` and not something anyone should type.
//
// **Phase 1 skeleton.** It registers, marks the job finished and exits, without
// contacting a model. That is deliberate: the risky unknown in this feature is
// whether a detached process can be launched, observed and awaited from a test
// without deadlocking the suite, and that question is answered by plumbing
// alone. The model call arrives in phase 2, on top of a spike that has actually
// run.
import { parseCommandLine } from './args.mjs';
import { UserError } from './errors.mjs';
import { finish, jobBySeq, registerWaiter } from './job-record.mjs';
import { openStore } from './job-store.mjs';

export const TASK_WORKER_SPEC = {
  valueFlags: ['seq'],
};

export async function runTaskWorker(argv) {
  const { options } = parseCommandLine(argv, TASK_WORKER_SPEC);
  const seq = Number(options.seq);
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new UserError(`task-worker needs --seq <n>, got ${JSON.stringify(options.seq)}.`);
  }

  const db = openStore();
  const job = jobBySeq(db, seq);
  if (!job) throw new UserError(`No job with sequence ${seq}.`);

  const now = () => new Date().toISOString();
  // Says "a worker exists", which is a different fact from "a worker is running
  // this job" and is recorded far earlier. Without it a queued worker is
  // indistinguishable from one that never started.
  registerWaiter(db, seq, process.pid, now());

  process.stderr.write(`worker for job ${job.id} (seq ${seq}) started\n`);
  finish(db, seq, { state: 'completed', outcome: { skeleton: true }, at: now() });
  process.stderr.write(`worker for job ${job.id} finished\n`);
}
