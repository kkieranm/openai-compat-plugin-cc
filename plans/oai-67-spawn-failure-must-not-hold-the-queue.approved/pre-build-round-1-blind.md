ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug expressive-coalescing-quokka

# OAI-67 — a spawn failure must not hold the queue, and housekeeping must not sink a live submission

## Context

Two independent defects in `scripts/lib/task-submit.mjs`, both verified against the current tree this
session (Codex claim-check: 4 of 4 TRUE).

**(a) A failed spawn stalls every later job.** `spawnAndStamp` awaits `spawnWorker(seq)` at
`task-submit.mjs:110-111` with **no `try`/`catch`**. On rejection the row inserted at `:189` stays
`queued` with `spawned_at` NULL and nothing marks it failed. `livenessOf` classifies that row
`starting`, `queuedRole` maps `starting` to `blocks`, and `decide` returns `blocked` to a *different,
later* job. The bound is `STARTUP_GRACE_MS = 120_000` at `job-liveness.mjs:20` — after two minutes the
row becomes `never-started` and is skipped. **So the harm is a two-minute stall of the whole queue
plus a two-minute lie about a job that will never run — not a permanent wedge.**

**(b) Housekeeping can sink a live submission.** `sweepQuietly` (`:94`) suppresses busy errors and
**rethrows everything else, by design** — its comment argues a silent retention failure would grow the
store unbounded. It is called at `:197`, *after* `spawnAndStamp` returned at `:191`. So a non-busy
sweep failure rejects `submitTask` when a detached worker already exists and is about to call a paid
model, and the id is never printed, so a reasonable retry duplicates the spend.

Its own docstring already promises the property it violates: *"Housekeeping, and it must never cost
the user the job they just submitted."* That is **false today** on the non-busy path. Moving the sweep
is what makes the code match a claim it has been making all along.

Half of (b) is **already closed**: `markSpawned` is wrapped in `withBusyRetry` and on exhaustion warns
and still returns the id. Only the `sweepQuietly` half is live.

**Provenance.** A draft exists at `plans/oai-67-a-spawn-failure-must-not-hold-the-queue.md`, written
unattended and labelled `NOT harness approved`. It is **input, not authorisation**: it was never read
cold (both its Codex rounds were threaded, and the contract alternates a blind re-ask), and its
verdict was read by eye rather than through the gate's parser. This plan supersedes it and goes
through the real gate.

## Decisions already made (this session, with the user)

1. **Keep `sweepQuietly`'s rethrow, and move it before `insertJob`.** Codex and I both recommended it.
   A broken sweep stays loud, but fails when no row and no worker exist. Dropping the rethrow was
   rejected because `OAI-108` records that stderr warnings are invisible to a `--json` caller, so
   retention could fail silently and indefinitely — and submission is the sweep's only trigger.
2. **A spawn failure terminalizes its own row**, then rethrows the spawn error. Re-decided knowingly
   rather than inherited from the unattended draft's Codex consensus.
3. **The test seam is an injectable `spawn`, defaulted** (option A). Codex and I both recommended it.
   Fabricating row shapes was rejected because nothing would prove `spawnAndStamp` produces them; an
   overridable worker path in `job-spawn.mjs` was rejected because it ships a runtime executable-path
   override the product does not need.

**Accepted caveat, stated rather than engineered around:** if the terminal write's busy retry
exhausts, the submission still rejects and the row may stay `queued` — because the database refused
the write, not because the spawn outcome was unknown. That degrades to today's behaviour (the grace
terminalizes it), which is the correct fallback.

## Change

**Phase 1 — the seam.** `submitTask` gains a second parameter: `{ spawn = spawnWorker } = {}`,
threaded to `spawnAndStamp`. Default preserves every existing caller; no call site changes.

**Phase 2 — a spawn failure terminalizes its own row.** Wrap the `await spawn(seq)` call. On
rejection, write the row terminal and rethrow **the spawn error**. `finish` (`job-record.mjs:243`) is
the right verb and needs no new SQL — it already guards `WHERE state IN ('queued','running')` and
nulls `worker_pid`.

The failure payload follows `job-queue.mjs`'s `timeOut` (`:123`), the existing precedent for a
*diagnosed* terminal write, rather than a bare `errorReport(error)` which yields `reason: null` — a
value this repo reserves for "nothing was determined". A spawn failure *is* determined:

```js
const failure = errorReport({
  reason: 'spawn-failed',
  message: 'Job ' + job.id + ' could not start a worker process: ' + error.message,
  hint: '<actionable text>',
});
```
(shown with concatenation rather than a template literal only so this file carries no shell
expansion; the build uses a template literal, matching the surrounding code.)

`errorReport` is imported from `./review-report.mjs`, as `job-queue.mjs:16` already does. **Confirmed
still exported at `review-report.mjs:200`** despite OAI-139 restructuring that file this morning.

**The busy-exhaustion catch must not add an `isBusy` site.** Wrap the `withBusyRetry(() => finish(…))`
in a bare `try`/`catch` that discards the busy error and proceeds to rethrow the spawn error — so the
user learns why the spawn failed, not why the database was locked. A blanket discard is correct **only
here** and must say so: the row stays `queued` and degrades to the grace, which is the accepted caveat
above.

**Phase 3 — the site count is design work, not paperwork.** This becomes a **seventh `withBusyRetry`
site**; `isBusy` stays at six.

`tests/busy-site-count.test.js` counts `\bwithBusyRetry\(` and `\bisBusy\(` across `scripts/lib/*.mjs`
(flat, comments stripped, excluding `job-busy.mjs`) and requires the **literal** sentences
``<spelled-number> `withBusyRetry` call sites`` and ``<spelled-number> `isBusy` call sites`` in **two**
documents: `adr/020-…md` (`:13`) and `scripts/lib/job-busy.mjs` (`:44-45`). It also fails if any
*wrong* spelled variant survives anywhere in either file. So: `six` → `seven` for `withBusyRetry` in
both documents, `six` unchanged for `isBusy`, and no stale variant left behind. `job-busy.mjs:41`'s
`"Six sites:"` prose is **not** matched by the guard but would be wrong — fix it and extend its
enumeration.

`job-busy.mjs:85-91` warns that *"A SEVENTH call site does not inherit that argument — it is a property
of where these six sit, not of this function."* **The new site's safety must be argued on its own
terms, in that comment**: it runs in the submitter, after the child has failed to launch, so no model
call exists and no request is in flight — the synchronous sleep can delay only this submission's own
failure report. **If that argument cannot be made honestly the phase fails and the design changes.**

**Phase 4 — move the sweep.** Relocate `sweepQuietly(db)` to before `insertJob`. Amend both its
docstring and `submitTask`'s inline justification at `:193-196`, which currently argue the *old*
position; the reasoning survives the move and the sentences must say so rather than point at an
ordering that no longer holds. `job-busy.mjs:52-58` and `task-submit.mjs:120-122` both state that
`insertJob` is *deliberately* not busy-wrapped because it precedes the spawn — **that stays true** and
must not be disturbed.

**Phase 5 — tests.**

1. **A spawn failure marks its own row `failed` and does not block a successor.** Drive `submitTask`
   in-process with a rejecting `spawn` (the pattern `tests/job-busy-spawn.test.js` already uses).
   Assert the row is `failed` with a non-null failure, and that a *second* queued job acquires rather
   than blocks. **Positive control in the same run**: the pre-fix shape — a `queued` row with
   `waiter_pid` NULL inside the grace, via `insertSynthetic` (`tests/job-helpers.mjs:119-143`) — must
   return `blocked` under the same assertion. Without it the test cannot fail.
2. **A non-busy sweep failure rejects before anything exists.** Assert `submitTask` rejects, **no
   worker was spawned**, and **no row was left `queued`** — then that a successor acquires. The orphan
   half is the assertion that would have caught the unattended draft's own first-draft defect;
   asserting only the rejection would pass against the pre-fix code too.
3. **`tests/busy-site-count.test.js` must go red after phase 2 and green after phase 3.** Check that
   ordering explicitly — it is free evidence the guard is not inert.

**No test asserts `task-submit.mjs`'s ordering today**, so the move breaks nothing.
`tests/credential-notice.test.js` re-writes the notice text by hand, so it reddens on a *wording*
change but not on this move — do not change that notice text.

## Verification

1. `npm test` green. Currently 799.
2. The repo `verify` skill: tests, real plugin load, delegation round trip. Steps 3–4 need a live
   server; LM Studio is available.
3. **Mutation, two of them**, each proved landed before running the suite and restored by `diff`:
   - Revert the `try`/`catch` around the spawn → test 1 must redden.
   - Revert the sweep to its old position → test 2's orphan assertion must redden.
4. Ordering check from phase 5.3, recorded as a result rather than asserted.

**Size note:** `tests/structure.test.js` is at **299 of 300** — one line of headroom, not zero. (The
unattended draft said "exactly 300 of 300"; that number has drifted and the conclusion still holds: a
new guard does not fit. Raising the ceiling is a separate, deliberate commit.)

## Entry tier for review

**Full**, not light: an executable branch on a concurrency path, a production signature change, and a
seventh entry in an enumerated safety set whose own comment says the set's argument does not extend.
Trigger evaluation is the ladder's call, but my honest read: `lean-wide` does **not** fire — this
touches no vendor dialect or wire format — and `security-review` is arguable on the process-spawn
surface. State both at the ladder rather than assuming.

## ADR

Amend **`adr/020`** for the counts (mandatory — the guard reads it). The **injectable-spawn seam** is a
design decision with a rejected alternative and belongs where submission's design lives, most likely
**`adr/014`**; confirm the right home by reading both before writing, and record why an environment
variable overriding the worker path was rejected.
