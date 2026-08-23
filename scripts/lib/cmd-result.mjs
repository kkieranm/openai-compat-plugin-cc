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
import { artifactNote } from './task-artifact.mjs';
import { templateNotes } from './task-template.mjs';

// No flags. Exported anyway, so `tests/plugin.test.js` covers this command's
// markdown the same way it covers the others — a command absent from SPECS
// escapes the check entirely.
export const RESULT_SPEC = {};

/** `undefined`/`null` are absence, a real string is a real value — anything else is foreign. */
function isOptionalString(value) {
  return value === undefined || value === null || typeof value === 'string';
}

/**
 * `undefined`/`null` are absence — `estimatedTokens` is only ever persisted alongside a `template`
 * (`job-request.mjs`'s `persistRequest`) as a plain number, so unlike most fields here the legitimate
 * shape is a NUMBER, never a string; `isOptionalString` would be the wrong check for this field even
 * applied ad hoc.
 */
function isOptionalNumber(value) {
  return value === undefined || value === null || typeof value === 'number';
}

/** The only four states `task-artifact.mjs`'s `checkDiff` ever produces, and `artifactNote` branches on. */
const ARTIFACT_STATES = ['applies', 'rejected', 'unavailable', 'absent'];

/**
 * `undefined`/`null` are absence — `artifactFor` returns `null` for every non-`diff` template, the
 * ordinary case. Present means an object, never an array (`typeof [] === 'object'`, but `.detail`
 * would read `undefined` and reach `artifactNote`'s default branch, printing the literal string
 * "undefined"), whose `.state` is one of the four values `artifactNote` actually recognizes.
 *
 * `.detail` validation is STATE-DEPENDENT, not uniform: `artifactNote` (`task-artifact.mjs:83-88`)
 * unconditionally interpolates `detail` in every branch except `applies`, which never reads it — so
 * `applies` admits any `detail`, and every other state requires a REAL string, not merely
 * `isOptionalString`, since `undefined`/`null` there would print just as literally as a hostile
 * object would throw.
 */
function isOptionalArtifact(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value) || !ARTIFACT_STATES.includes(value.state)) return false;
  return value.state === 'applies' || typeof value.detail === 'string';
}

/**
 * Every field `writeAnswer`/`renderTaskFooter` reads off `job.outcome`/`job.request`/`job.transport`
 * that is not already required (`outcome.content`) or already defended by an existing
 * `Number.isFinite`-based graceful-omit path (`usage`, `durationMs`, `prefillMs`, `generationMs`,
 * `render.mjs`) — those stay outside this table on purpose; folding them in would change already-
 * accepted behavior this table has no mandate to touch. One entry, one place: the coverage this
 * table claims is exactly what `tests/result.test.js`'s structural test proves is enforced.
 */
export const RENDER_CONSUMED_FIELDS = [
  { path: 'outcome.model', get: (job) => job.outcome?.model, valid: isOptionalString },
  { path: 'outcome.requestedModel', get: (job) => job.outcome?.requestedModel, valid: isOptionalString },
  { path: 'outcome.finishReason', get: (job) => job.outcome?.finishReason, valid: isOptionalString },
  { path: 'outcome.artifact', get: (job) => job.outcome?.artifact, valid: isOptionalArtifact },
  { path: 'request.contextNote', get: (job) => job.request?.contextNote, valid: isOptionalString },
  { path: 'request.template', get: (job) => job.request?.template, valid: isOptionalString },
  { path: 'request.estimatedTokens', get: (job) => job.request?.estimatedTokens, valid: isOptionalNumber },
  { path: 'transport.name', get: (job) => job.transport?.name, valid: isOptionalString },
];

/**
 * Distinct from "no answer": a row this build's own version gate accepted can still carry an
 * `outcome` a NEWER build wrote in a shape this one has never seen — `outcome`, `request` and
 * `transport` are all JSON blob columns (`job-record.mjs`'s `JSON_COLUMNS`), and every field a
 * renderer downstream interpolates or coerces is asserted on here first, before `.trim()` — so a
 * renamed/absent field reports itself honestly instead of being read as "completed but said
 * nothing" — and before any interpolation, which would otherwise throw on a hostile value one or
 * more calls deeper.
 */
function validateOutcomeShape(job) {
  const outcome = job.outcome;
  if (!outcome || typeof outcome !== 'object' || typeof outcome.content !== 'string') return false;
  return RENDER_CONSUMED_FIELDS.every(({ get, valid }) => valid(get(job)));
}

/**
 * The answer, rendered exactly as the foreground path renders one.
 *
 * Same footer builder, so a figure shown after `/oai:task` cannot quietly go
 * missing after `/oai:result` — the reason `render.mjs` has one of these rather
 * than one per call site.
 *
 * Composed as one string and written once: every consumed field is validated above before this
 * runs, but a field this table somehow still missed now fails before any byte reaches stdout,
 * rather than after part of the answer is already visible — the fragments and their order here are
 * unchanged from the four separate `stdout.write` calls this restructuring replaces, so for any
 * given `job`, concatenating them into one write produces the identical bytes those four calls
 * already produced. Not a claim that output is unchanged from before this whole feature — `content`,
 * `contextNote` and the rest render exactly what they already rendered one commit ago.
 */
function writeAnswer(job) {
  if (!validateOutcomeShape(job)) {
    throw new UserError(`Job ${job.id} completed, but its recorded outcome is not a shape this build understands.`, {
      hint: `A newer plugin build likely wrote it. Its log is at ${logPathFor(job.seq)}.`,
    });
  }
  const outcome = job.outcome;
  if (!outcome.content.trim()) {
    throw new UserError(`Job ${job.id} completed but recorded no answer.`, { hint: `Its log is at ${logPathFor(job.seq)}.` });
  }

  const parts = [outcome.content.trim()];
  parts.push(
    `${renderTaskFooter({
      providerName: job.transport?.name,
      model: outcome.model,
      requestedModel: outcome.requestedModel,
      usage: outcome.usage,
      durationMs: outcome.durationMs,
      prefillMs: outcome.prefillMs,
      generationMs: outcome.generationMs,
      contextNote: job.request?.contextNote ?? null,
      finishReason: outcome.finishReason,
    })}\n`,
  );
  // From the frozen request, not the outcome: the template and the size it was
  // measured at are facts about what was ASKED, settled at submission — and so
  // is `contextNote` above, for the same reason. THESE NOTES come from the same
  // builder the foreground path uses, so they cannot appear on one rendering
  // and not the other.
  // The verdict the worker computed, so a backgrounded patch says whether it
  // applies exactly as a foreground one does.
  if (outcome.artifact) parts.push(`\n${artifactNote(outcome.artifact)}\n`);
  for (const note of templateNotes({ name: job.request?.template, estimatedTokens: job.request?.estimatedTokens })) {
    parts.push(`\n${note}\n`);
  }

  // Before the answer, as on the foreground path: the operator should learn
  // which model is speaking before reading what it said.
  const notice = substitutionNotice(outcome);
  if (notice) process.stderr.write(notice);
  process.stdout.write(parts.join(''));
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
      hint: `Run /oai:status --all to list what there is. The newest ${RETAIN} finished jobs are kept`
        + ' (a job written off by /oai:abandon after it started running is kept indefinitely).',
    });
  }
  if (job.state !== 'completed') refuse(job);
  writeAnswer(job);
}
