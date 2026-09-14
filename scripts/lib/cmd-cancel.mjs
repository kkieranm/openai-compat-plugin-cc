// `/oai:cancel`: ask a background job to stop.
//
// It writes one column and reads the row back. It never terminalizes anything,
// and it never signals anything — the two restraints are the same restraint.
// A pid recorded when a job started may belong to an unrelated process by the
// time this command reads it, so the plugin asks the worker to stop rather than
// making it stop, and only an *observed* exit becomes terminal `cancelled`.
//
// What that costs is honesty about latency: this command reports `cancelling`,
// not `cancelled`. The reference plugin took the other option — it reports
// success while the work carries on — and that is the failure this shape avoids.
import { parseCommandLine } from './args.mjs';
import { UserError } from './errors.mjs';
import { BEAT_MS } from './job-heartbeat.mjs';
import { isTerminal, jobById, requestCancel } from './job-record.mjs';
import { relativeAge } from './job-render.mjs';
import { DatabaseTooNewError } from './job-store.mjs';
import { openJobs, reconcileAll } from './job-view.mjs';

// No flags: a cancellation is a job id and nothing else. Exported so
// `tests/plugin.test.js` covers this command's markdown like the others.
export const CANCEL_SPEC = {};

const now = () => new Date().toISOString();

/**
 * What to say, read off the row *after* the write rather than assumed from
 * before it.
 *
 * The re-read is the point. Between deciding to cancel and writing the column, a
 * job can finish — and telling someone their completed job is "cancelling" would
 * send them back to `/oai:status` to find out it was never true.
 */
function report(job) {
  if (job.state === 'completed') {
    return `Job ${job.id} had already completed — nothing was cancelled. Its answer: /oai:result ${job.id}`;
  }
  if (isTerminal(job.state)) return `Job ${job.id} was already ${job.state} — nothing was cancelled.`;

  const seen = `Its worker checks every ${Math.round(BEAT_MS / 1000)}s.`;
  if (job.state === 'queued') {
    return `Cancelling job ${job.id}: it was still queued, so no request will be sent. ${seen}`;
  }
  return `Cancelling job ${job.id}, running since ${relativeAge(job.started_at)}. ${seen}`;
}

export async function runCancel(argv) {
  const { prompt } = parseCommandLine(argv, CANCEL_SPEC);
  const id = prompt.trim();
  if (!id) throw new UserError('/oai:cancel needs a job id.', { hint: 'Run /oai:status to list them.' });

  const opened = openJobs();
  if (!opened) throw new UserError(`No job with id "${id}": no background job has ever been submitted on this machine.`);

  const { db, readOnly, version } = opened;
  // Cancelling is a write, so a database this build does not understand refuses
  // it outright — unlike `/oai:status`, which may still look.
  if (readOnly) throw new DatabaseTooNewError(version);

  // First, so a job whose worker is already gone is reported as what it is
  // rather than accepting a cancellation that nothing will ever act on.
  reconcileAll(db);

  const existing = jobById(db, id);
  if (!existing) throw new UserError(`No job with id "${id}".`, { hint: 'Run /oai:status to list what there is.' });

  requestCancel(db, existing.seq, now());
  process.stdout.write(`${report(jobById(db, id))}\n`);
}
