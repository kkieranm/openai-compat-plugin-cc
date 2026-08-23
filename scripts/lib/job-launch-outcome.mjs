// What a SUBMITTER may record about a launch it could not confirm.
//
// Its own module because the constraint it embodies is not obvious from the call
// site: this code runs holding strictly less knowledge than it appears to. A
// rejected spawn does not establish that no child exists, so every claim here —
// the verb, the reason, the message, and what an exhausted retry leaves behind —
// is written to be true on both orderings. Keeping it beside the submission flow
// is what let five successive drafts assert "the spawn failed" without anyone
// noticing that the caller cannot know it.
import { writeSync } from 'node:fs';

import { abandonUnstarted } from './job-record.mjs';
import { withBusyRetry } from './job-busy.mjs';
import { errorReport } from './review-report.mjs';

/**
 * Where the storage fault is written. A defaulted parameter, for exactly the
 * reason `submitTask`'s `spawn` is one: there is otherwise NO WAY to drive the
 * failing-report path from a test. `writeSync` is an ESM named import, bound at
 * instantiation, so patching `node:fs` from a test does not reach it — measured,
 * not assumed. Without the seam the wrapper in `terminalizeSpawnFailure` is a
 * safeguard nothing can catch being deleted, which is the state a reviewer called
 * out and this parameter exists to end.
 *
 * Declared HERE, above the function's own docstring, because two doc blocks
 * written back to back both attach to whatever statement follows them: this one
 * used to sit between the function's docstring and the function, so a reader
 * resolving docs by position was shown the function's contract against a one-line
 * stderr writer, and the exported function carried none at all.
 */
const reportToStderr = (message) => writeSync(2, message);

/**
 * A launch this process could not complete or confirm, written down as such —
 * but only while the row is still nobody's.
 *
 * Without this, a row NO WORKER HAS REGISTERED AGAINST stays `queued` with `spawned_at`
 * NULL, which `livenessOf` classifies `starting` and `queuedRole` maps to
 * `blocks` — so every later job waits out the full startup grace. The harm is
 * not this job; it is the queue behind it. Conditional on the row staying
 * unregistered, because it need not: on the ordering described below a child may
 * register and run, and then nothing was ever stuck.
 *
 * **A REJECTION DOES NOT PROVE NO CHILD EXISTS, and nothing here may assume it
 * does.** `spawnWorker` awaits the `'spawn'` event and then closes its copy of
 * the log descriptor in a `finally`; a throw from that close rejects while a
 * detached worker EXISTED and may still be running. Every claim in
 * this function is therefore written to be true on both orderings — which is why
 * the reason is `worker-launch-unconfirmed` and not `spawn-failed`, and why the
 * message says the launch could not be completed or confirmed rather than that
 * it failed. `reason` is still diagnosed rather than null: a bare
 * `errorReport(error)` yields `reason: null`, which this repo reserves for
 * "nothing was determined", and something here IS determined. The remaining
 * uncertainty is named in the value instead of being papered over by it.
 * (`job-queue.mjs`'s `timeOut` is the precedent for a diagnosed terminal write;
 * removing the ambiguity at the source is a separate, larger fix.)
 *
 * **The verb is `abandonUnstarted`, never `finish`.** `finish` guards
 * `WHERE state IN ('queued','running')`, deliberately permissive so a worker can
 * publish a terminal verdict over its own live row — right for a worker, wrong
 * for a submitter guessing on its behalf. It would flip a RUNNING row to `failed`
 * and null `worker_pid`, after which terminal immutability stops the real worker
 * ever publishing: paid work MAY be lost, behind a row asserting a failure that did not
 * happen. `abandonUnstarted`'s `AND state = 'queued' AND waiter_pid IS NULL`
 * makes both orderings safe — the child registered first and this write matches
 * nothing, or this write lands first and the child finds a terminal row and stops
 * before spending.
 *
 * **Its return is ignored on purpose**, and the invariant is wider than it looks:
 * `false` means the row is no longer an unregistered queued row — it may have a
 * waiter, be running, be terminal already, or be gone. It does NOT mean "a worker
 * registered", which is merely the likeliest of those. In every one of them the
 * row is not ours to terminalize, so `false` is a correct outcome and not an
 * error to throw on.
 */
export function terminalizeSpawnFailure(db, seq, job, error, { report = reportToStderr } = {}) {
  const failure = errorReport({
    reason: 'worker-launch-unconfirmed',
    message: `Job ${job.id} could not complete or confirm the launch of a worker process: ${error.message}`,
    hint: 'Run /oai:status to see whether a worker registered anyway; if none did, check that node is on PATH and the plugin directory is readable, then submit again.',
  });
  try {
    withBusyRetry(() => abandonUnstarted(db, seq, { state: 'failed', failure, at: new Date().toISOString() }));
  } catch (storageError) {
    // NOT discarded, and not tested for `isBusy` either — both halves match the
    // settled policy for the structurally identical site, the worker's own
    // `failed` write. Which storage fault occurred does not change
    // what a reader needs, so the fault is reported by MESSAGE and the launch
    // error travels by propagating. Its first version caught the busy and
    // rethrew everything else, which left a disk error, a corrupt file or a
    // schema fault reproducing the identical loss through the identical line.
    //
    // `writeSync` rather than `process.stderr.write`: `oai-companion.mjs` now sets
    // `process.exitCode` and returns on the error rethrown below, letting Node
    // drain stdio naturally before it exits on its own — so an async write here
    // is no longer at risk of being discarded by a forced exit. `writeSync` stays
    // as defensive belt-and-braces rather than a strict correctness requirement:
    // it costs nothing here and removes any dependence on that drain behaviour
    // holding, including in a caller that still forcibly exits.
    //
    // Wrapped, because a throw raised inside a `catch` REPLACES the pending
    // rethrow. A failing report is the one thing here that is silently dropped:
    // at that point nothing can be told to anyone, and the launch error is still
    // the most useful fact available.
    //
    // What it does NOT say is that the row was left queued. The write failed, so
    // the row is exactly what it was: an unregistered queued row ages out through
    // the startup grace, while a row a worker has registered against is left to that
    // worker's own lifecycle — which this process neither controls nor observes.
    try {
      report(`Storage failure while recording job ${job.id}'s outcome: ${storageError.message}\n`);
    } catch {
      // Nothing left that can carry it. The launch error still propagates.
    }
  }
}
