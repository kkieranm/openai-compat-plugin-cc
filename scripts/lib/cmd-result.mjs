// `/oai:result`: the answer a background job produced.
//
// Only a `completed` job has one. Every other state exits 1 with what actually
// happened, because "no output, exit 0" is indistinguishable from a model that
// had nothing to say — the same failure `requireAnswer` exists to refuse on the
// foreground path.
import { parseCommandLine } from './args.mjs';
import { UserError } from './errors.mjs';
import { substitutionNotice } from './model-identity.mjs';
import { isTerminal, jobById } from './job-record.mjs';
import { relativeAge } from './job-render.mjs';
import { RETAIN } from './job-retention.mjs';
import { logPathFor } from './job-store.mjs';
import { openJobs, reconcileAll } from './job-view.mjs';
import { renderTaskFooter } from './render.mjs';
import { templateNotes } from './task-template.mjs';

// No flags. Exported anyway, so `tests/plugin.test.js` covers this command's
// markdown the same way it covers the others — a command absent from SPECS
// escapes the check entirely.
export const RESULT_SPEC = {};

/**
 * The answer, rendered exactly as the foreground path renders one.
 *
 * Same footer builder, so a figure shown after `/oai:task` cannot quietly go
 * missing after `/oai:result` — the reason `render.mjs` has one of these rather
 * than one per call site.
 */
function writeAnswer(job) {
  const outcome = job.outcome;
  if (!outcome?.content?.trim()) {
    throw new UserError(`Job ${job.id} completed but recorded no answer.`, { hint: `Its log is at ${logPathFor(job.seq)}.` });
  }

  // Before the answer, as on the foreground path: the operator should learn
  // which model is speaking before reading what it said.
  const notice = substitutionNotice(outcome);
  if (notice) process.stderr.write(notice);

  process.stdout.write(outcome.content.trim());
  process.stdout.write(
    `${renderTaskFooter({
      providerName: job.transport?.name,
      model: outcome.model,
      requestedModel: outcome.requestedModel,
      usage: outcome.usage,
      durationMs: outcome.durationMs,
      prefillMs: outcome.prefillMs,
      generationMs: outcome.generationMs,
      contextNote: null,
      finishReason: outcome.finishReason,
    })}\n`,
  );

  // From the frozen request, not the outcome: the template and the size it was
  // measured at are facts about what was ASKED, settled at submission, and the
  // worker never needs to know either. THESE NOTES come from the same builder
  // the foreground path uses, so they cannot appear on one rendering and not the
  // other — a claim scoped to `templateNotes` deliberately, since the footer
  // above it does still diverge (`contextNote` is null here and populated
  // there), which is a pre-existing gap this change did not introduce.
  for (const note of templateNotes({ name: job.request?.template, estimatedTokens: job.request?.estimatedTokens })) {
    process.stdout.write(`\n${note}\n`);
  }
}

/** Why there is no answer to show, in the job's own words where it has any. */
function refuse(job) {
  const log = `Its log is at ${logPathFor(job.seq)}.`;
  if (!isTerminal(job.state)) {
    throw new UserError(`Job ${job.id} is ${job.state} — it has not finished, so there is no result yet.`, {
      hint: `Submitted ${relativeAge(job.created_at)}. Run /oai:status ${job.id} to see what it is doing.`,
    });
  }
  if (job.state === 'failed') {
    throw new UserError(`Job ${job.id} failed: ${job.failure?.message ?? 'no message was recorded'}`, {
      hint: [job.failure?.hint, log].filter(Boolean).join(' '),
    });
  }
  throw new UserError(`Job ${job.id} is ${job.state}, so it produced no answer.`, { hint: log });
}

export async function runResult(argv) {
  const { prompt } = parseCommandLine(argv, RESULT_SPEC);
  const id = prompt.trim();
  if (!id) throw new UserError('/oai:result needs a job id.', { hint: 'Run /oai:status to list them.' });

  const opened = openJobs();
  if (!opened) throw new UserError(`No job with id "${id}": no background job has ever been submitted on this machine.`);

  const { db, readOnly } = opened;
  // A worker that died holding this job is noticed here too, so asking for a
  // result is never what leaves a job stuck. Skipped against a database a newer
  // plugin wrote, where this build may not write at all.
  if (!readOnly) reconcileAll(db);

  const job = jobById(db, id);
  // Retention is named here and nowhere else in the failure messages, because
  // this is the command where it is felt: an id that printed an answer
  // yesterday can stop resolving, and without the sentence that reads like the
  // job was lost rather than aged out.
  if (!job) {
    throw new UserError(`No job with id "${id}".`, {
      hint: `Run /oai:status --all to list what there is. Only the newest ${RETAIN} finished jobs are kept.`,
    });
  }
  if (job.state !== 'completed') refuse(job);
  writeAnswer(job);
}
