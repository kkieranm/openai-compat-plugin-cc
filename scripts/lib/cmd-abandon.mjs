// `/oai:abandon`: write off a background job's ROW when its worker cannot be
// proved gone.
//
// The sibling of `/oai:cancel` and deliberately a different verb. Cancel ASKS a
// worker to stop and terminalizes nothing; this ASSERTS that a row is finished
// and terminalizes it without the worker's agreement. They write different
// states for different reasons, and one flag on one command could not honestly
// mean both.
//
// It signals nothing either. What it costs instead is the queue's guarantee that
// one background job runs at a time — see `job-abandon.mjs` — which is why the
// stale-beat refusal exists and why lifting it takes a separate flag.
import { assertNoFlagsInPrompt, parseCommandLine } from './args.mjs';
import { UserError } from './errors.mjs';
import { abandonRow } from './job-abandon.mjs';
import { STARTUP_GRACE_MS, relevantPid } from './job-liveness.mjs';
import { excerptOf, relativeAge } from './job-render.mjs';
import { DatabaseTooNewError } from './job-store.mjs';
import { openJobs } from './job-view.mjs';

// Exported so `tests/plugin.test.js` covers this command's markdown like the
// others — that test asserts the command files and the specs are the same set,
// so a command added without an entry there fails the suite rather than escaping
// the flag-documentation guard.
export const ABANDON_SPEC = { booleanFlags: ['force'] };

const now = () => new Date().toISOString();

/**
 * The drainage sentence, defined once because two paths print it.
 *
 * A snapshot taken inside the write transaction, not a statement about the queue
 * as the reader sees it: anything may have started since. Retyping it at the
 * second call site is how the two recovery messages drifted apart once already.
 */
const DRAINED = 'At that moment nothing else was blocking the queue, so a waiting job may start.';

/**
 * How much of the startup grace is left, in words.
 *
 * Derived from `STARTUP_GRACE_MS` and the row's own timestamps rather than
 * written as a number in prose: the refusal used to say "try again in a minute"
 * against a two-minute grace, so an operator who obeyed it was refused again.
 * Anchored on `spawned_at ?? created_at`, mirroring `livenessOf`, so it measures
 * the same window the refusal is about. Computed here rather than taken as a
 * parameter because `REFUSALS` entries take the row alone.
 */
function graceLeft(job) {
  const since = Date.parse(job.spawned_at ?? job.created_at ?? '');
  const left = Number.isFinite(since) ? STARTUP_GRACE_MS - (Date.now() - since) : STARTUP_GRACE_MS;
  return `${Math.max(1, Math.ceil(left / 1000))}s`;
}

/**
 * Why a refusal happened, and whether `--force` is any use — said plainly, so
 * nobody retries with a flag that cannot help.
 *
 * `gone` is absent deliberately: it is intercepted before this table is reached,
 * because "no such job" is not a refusal to abandon. Every other reason
 * `abandonDecision` can return must appear here, which `tests/abandon-cli.test.js`
 * pins against the decision's own vocabulary — a reason added there without an
 * entry here would otherwise be a `TypeError` and exit 2 rather than a message.
 */
const REFUSALS = {
  beating: (job) =>
    `Job ${job.id} is still checking in (last beat ${relativeAge(job.last_beat_at)}), so its process is`
    + ' running its event loop and may be working. Pass --force to write the row off anyway.',
  'no-beat': (job) =>
    `Job ${job.id} has a last check-in that cannot be read, so there is no evidence either way about`
    + ' its process. Pass --force to write the row off anyway.',
  malformed: (job) =>
    `Job ${job.id} is a shape this build will not guess at — its pid or its timestamps cannot be read,`
    + ' so no liveness judgement is possible for it. Pass --force to write the row off anyway.'
    // NOT "nothing else will ever clear it". True of a running row with no pid;
    // FALSE of a queued one with unreadable timestamps, because `registerWaiter`
    // never inspects them — a late worker can still attach and run the job. The
    // absolute version of this sentence advised writing off work that was starting.
    + (job.state === 'queued'
      ? ' Note it is queued: a worker that has not registered yet can still attach and run it, so'
        + ' forcing may write off work that was about to start.'
      : ' Nothing else will clear a running row in this shape.'),
  'unknown-version': (job) =>
    `Job ${job.id} was written by a newer version of the plugin. This build will not modify it, and`
    + ' --force will not change that — an older build guessing at a newer one\'s columns is how state'
    + ' gets corrupted. Update the plugin, or use the newer one for background jobs.',
  starting: (job) =>
    `Job ${job.id} was submitted moments ago and its worker has not registered yet. --force will not`
    + ' change that: the startup grace exists for exactly this window, and a job that is still starting'
    + ` is indistinguishable from one that never will until it expires — about ${graceLeft(job)} from now.`
    + ' /oai:cancel can be recorded against it meanwhile: a worker that does register will honour it at'
    + ' once, and if none ever does, the row is collected as never-started when the grace expires.',
  'not-abandonable': (job) =>
    `Job ${job.id} is already ${job.state} — there is nothing to write off, and --force will not`
    + ' change that. Whether the queue is moving, /oai:status will say.',
};

/**
 * What was written, what was NOT done, and what may now happen — the third of
 * which is keyed on the state the transaction found rather than on anything the
 * caller read earlier.
 *
 * The overlap warning belongs to the `running` arm alone and is not conditional
 * on drainage: the danger is the abandoned process, not its successor. A queued
 * row provably has nothing in flight — `decide` moves a row to `running` before
 * acquisition succeeds and the model is called only after that — so claiming
 * overlap there would be false.
 */
function report({ state, couldDrain, reason }, job) {
  const lines = [`Job ${job.id} written off as failed (operator-abandoned). Nothing was signalled.`];
  if (state === 'running') {
    lines.push(
      // Two mutually exclusive arms. `finish` does not clear `cancel_requested_at`
      // and the heartbeat's read of it is not state-guarded, so an abandoned but
      // still-live worker WILL see that request at its next tick and exit — which
      // is the operator's best available news and was being contradicted by a
      // flat "never asked to stop".
      (reason === 'forced-malformed'
        // The stored record says no liveness judgement was possible, so the
        // printed text may not imply one. The risk is UNKNOWN rather than absent —
        // dropping the warning would be the opposite error.
        ? 'Nothing could be judged about its process — its pid or timestamps could not be read — so'
          + ' whether anything is in flight is unknowable and an overlap cannot be ruled out.'
        : (job.cancel_requested_at
          // Bounded by the row's own lifetime, and saying so costs one clause:
          // once retention prunes this row, `cancelRequested` reads false and a
          // worker that wakes later never sees the request (OAI-161).
          ? 'A cancellation was already pending, and it still stands while this row lasts: if its'
            + ' process is alive it will see that at its next check-in and exit.'
          : 'Its process was never asked to stop')
          + ' and it may still have a model request in flight. If another job'
          + ' starts, the two will overlap on this machine\'s memory.')
      // Only where the beat is what permitted this. On a forced row the beat was
      // FRESH — the operator overrode a worker that was checking in — and
      // explaining why silence can be misleading there is a non-sequitur that
      // dilutes the sentence above it.
      + (reason === 'stale'
        ? ' A beat also looks stale after the machine slept, and the worker may simply resume.'
        : ''),
    );
  } else {
    lines.push('It had not started, so no request was ever sent and none will be.');
  }
  // A snapshot taken inside the write transaction, not a statement about the
  // queue as the reader sees it: anything may have started since.
  if (couldDrain) lines.push(DRAINED);
  return lines.join('\n');
}

/**
 * The row the transaction read, printed unmodified. THIS function decides
 * nothing — the decision was made on these same bytes, under the lock, before
 * the write landed.
 */
function describe(job, cwd) {
  // `relevantPid`, not "whichever column is populated": a running row can carry a
  // stale `waiter_pid` from before it was claimed, and printing that number while
  // the stored message says the pid was unknown put two different pids in one
  // invocation. A terminal row has no relevant pid and now prints none.
  const lines = [`${job.id}  ${job.state}  pid ${relevantPid(job) ?? '—'}  last beat ${relativeAge(job.last_beat_at)}`];
  if (job.workspace && job.workspace !== cwd) lines.push(`  submitted from ${job.workspace}`);
  // What it was asked to do — the field that says whose work this is, which is
  // the whole point of showing a foreign row. `excerptOf` rather than reading
  // `request` directly, so an unreadable payload renders as `/oai:status` does.
  lines.push(`  ${excerptOf(job)}`);
  return lines.join('\n');
}

/**
 * The one place a recovery is reported — genuinely one now. It was not: a
 * second, inline template rendered `already-recovered` elsewhere in this file,
 * under a docblock claiming there was only this. Both arms live here.
 *
 * `/oai:abandon` used to reconcile machine-wide BEFORE its transaction and treat
 * the result as a separate exit. That gave one fact two formats, and let a
 * `never-started` row inherit a sentence written for a dead process. The
 * transaction owns it now, and this renders whichever kind it resolved.
 */
function reportRecovery(id, { outcome, recoveryKind, reason, couldDrain }) {
  if (outcome === 'already-recovered') {
    // No drainage sentence, and that IS the asymmetry: this row was terminal
    // before the command ran, so nothing it did unblocked anything.
    return `Job ${id} was already settled by ordinary recovery: recorded as ${reason}.`
      + ' Nothing needed writing off.\n';
  }
  const observed = recoveryKind === 'never-started'
    // Not "nothing was spawned": a child can be spawned and die before it
    // registers, and `spawned_at` is set in that case. What is known is that no
    // worker ever registered against this row.
    ? `Job ${id} never had a worker register against it, so there was nothing to write off`
    : `Job ${id}'s process was already gone, so it needed no writing off`;
  const lines = [`${observed}: recorded as ${reason}.`];
  if (couldDrain) lines.push(DRAINED);
  return `${lines.join('\n')}\n`;
}

export async function runAbandon(argv) {
  const { prompt, options } = parseCommandLine(argv, ABANDON_SPEC);
  const id = prompt.trim();
  if (!id) throw new UserError('/oai:abandon needs a job id.', { hint: 'Run /oai:status to list them.' });
  // `parseArgs` stops reading flags at the first positional, so `abandon <id>
  // --force` swallows the flag into the id. Without this the operator gets
  // `No job with id "<id> --force"` — an error about the wrong thing entirely,
  // on the one invocation where they were deliberately overriding a refusal.
  assertNoFlagsInPrompt(id, ABANDON_SPEC);

  const opened = openJobs();
  if (!opened) throw new UserError(`No job with id "${id}": no background job has ever been submitted on this machine.`);

  const { db, readOnly, version } = opened;
  // Writing off a row is a write, so a database this build does not understand
  // refuses it outright — as `/oai:cancel` does, and unlike `/oai:status`.
  if (readOnly) throw new DatabaseTooNewError(version);

  const outcome = abandonRow(db, id, { override: Boolean(options.force), at: now() });
  if (outcome.reason === 'gone' || !outcome.row) {
    throw new UserError(`No job with id "${id}".`, { hint: 'Run /oai:status to list what there is.' });
  }

  // Recovery returns BEFORE the descriptor, deliberately rather than by
  // omission: the operator destroyed nothing, and the row they would be shown is
  // the pre-reconcile one, which no longer exists by the time it would print.
  if (outcome.outcome === 'recovered' || outcome.outcome === 'already-recovered') {
    process.stdout.write(reportRecovery(id, outcome));
    return;
  }

  // Printed AFTER the transaction and built from the row the transaction itself
  // read. There is deliberately no second, earlier read to display: a row shown
  // before the lock could differ from the one acted on, and printing one while
  // acting on the other is how an operator ends up sure they abandoned something
  // else.
  process.stdout.write(`${describe(outcome.row, process.cwd())}\n`);

  if (outcome.outcome === 'refused') {
    throw new UserError(REFUSALS[outcome.reason](outcome.row));
  }
  process.stdout.write(`${report(outcome, outcome.row)}\n`);
}
