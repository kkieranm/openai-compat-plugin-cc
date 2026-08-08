# OAI-67 — a spawn failure must not hold the queue, and housekeeping must not sink a live submission

**STATE: `unattended-draft — NOT harness approved`.**

This is **not a plan** in the `/feature` sense and no code may be written from it. It was drafted
during unattended run `run-1786181658-201519007` with the user away. `adr/045` forbids entering plan
mode unattended, because `ExitPlanMode` prompts a user who is not there. The Codex challenge recorded
below is **pre-review, never authorisation**: on resumption an attended session enters plan mode for
real, uses this draft as *input*, and re-runs the Codex plan gate against whatever version it then
produces.

Provenance: no harness slug — this draft never entered plan mode. That is the defect it is labelled
with, not an omission to be tidied up later.

## The item

**OAI-67**, tier 1. Two independent defects in `scripts/lib/task-submit.mjs`.

**(a) A failed spawn blocks the whole queue.** `spawnAndStamp` calls `await spawnWorker(seq)` with no
`try`/`catch`. `spawnWorker` rejects on the child's `'error'` event, so the rejection leaves
`submitTask` with the row still `queued` and `spawned_at` NULL. Nothing marks it failed. In
`job-queue.mjs`, `livenessOf` classifies that row `starting` (it has no `waiter_pid` — only the worker
registers one, and this worker never ran), `queuedRole` maps `starting` to `blocks`, and `decide`
returns `blocked` to the *calling* job the moment it meets a blocking row ahead of it. So **every
successor waits**, not merely the job that failed to spawn.

**(b) Post-spawn housekeeping reports failure while the worker runs on** — half closed already.
`markSpawned` was wrapped in `withBusyRetry` and, on exhaustion, warns on stderr and still returns the
id; that half is done and is not reopened here. What remains is `sweepQuietly(db)`, which `submitTask`
calls **after** `spawnAndStamp` returns and which **rethrows anything non-busy by deliberate design**.
A non-busy sweep failure therefore rejects `submitTask` at a point where a detached worker already
exists and is about to call a paid model. `cmd-task.mjs` never prints the id, the user is told the
submission failed, and a reasonable retry duplicates the spend.

## What the probe established (do not re-derive)

Verified against disk this run, and independently checked by Codex (thread
`019fe0bc-4c7c-7d10-b63a-32afbf4b3425`), which returned TRUE on (a) and on the `sweepQuietly`
ordering, and two refinements rather than refutations:

- The queue block is **bounded at `STARTUP_GRACE_MS` = 120 s**, not permanent: after the grace,
  liveness becomes `never-started`, `queuedRole` maps it to `skip`, and `decide` reconciles it and
  moves on. The item already says this. **The harm is a 120-second stall of every successor plus a
  two-minute lie about a job that will never run — not a permanent wedge.**
- The `starting` classification depends on `waiter_pid` being NULL. It is: `registerWaiter` is called
  by the worker (`cmd-task-worker.mjs`), which in this scenario never started.

## The one design fork, and the consensus that settled it

The user was away, so this went to Codex for consensus rather than into a question queue
(thread `019fe0bd-5ef5-71b2-a196-be33d0142549`). **Both halves of the consensus are recorded here so
the attended session can accept or overturn them knowingly — not so it can skip re-deciding.**

**Fork: where the sweep goes.**

- **Option A (chosen) — and CORRECTED at round 1 of the pre-review**: move `sweepQuietly(db)` to sit
  **before `insertJob`**, not between `insertJob` and `spawnAndStamp` as first drafted. A broken sweep
  still fails loudly and still rejects the submission, but does so when **no row and no worker
  exist**.
  **Why the first draft was wrong, recorded because it is the same defect this item exists to
  remove:** placing the sweep after `insertJob` meant a non-busy sweep throw left a row `queued` with
  neither `spawned_at` nor `waiter_pid` — which `livenessOf` classifies `starting` and `queuedRole`
  maps to `blocks`. It would have **created a fresh 120-second queue blocker on exactly the path being
  fixed.** Sweeping before the insert has no such window: there is nothing to orphan.
  It still preserves the property the sweep's own comment claims — submission is the only place rows
  are created, so it is the only place worth sweeping. The sweep retains the newest finished jobs and
  the row about to be inserted is not finished, so nothing about *what* gets swept changes.
- **Option B (rejected)** — keep the sweep where it is and make it non-fatal once a child exists
  (catch everything, warn on stderr, return the id anyway), mirroring `markSpawned`. Rejected because
  it converts "a non-busy sweep defect is raised" into a best-effort stderr line. **A `--json` caller
  receives the ordinary success envelope and never sees it**, so retention could fail silently and
  indefinitely — which is the exact harm `sweepQuietly`'s comment exists to prevent.

**Second question: terminalize on spawn failure — yes.** When `spawnWorker` rejects, write the
already-inserted row to `failed` with a failure report and then propagate the submission failure.
Leaving it `queued` falsely suggests it may still start and delays a definitive answer by the full
grace. Codex named the residual caveat, and it is accepted rather than engineered around: **if the
terminal write's busy retry exhausts, the submission still rejects and the row may stay `queued` —
because the database could not be updated, not because the spawn outcome was unknown.** That case
degrades to today's behaviour (the grace terminalizes it), which is the correct fallback.

## Proposed phases

**Phase 1 — a spawn failure terminalizes its own row.**
In `task-submit.mjs`, wrap the `await spawnWorker(seq)` call in `spawnAndStamp`. On rejection, write
the row terminal and then rethrow the original error. `finish` already guards
`WHERE state IN ('queued','running')` and nulls `worker_pid`, so it is the right verb and needs no new
SQL.

**The failure payload is specified here rather than left to the build** — the first draft said
`errorReport(error)`, and while that is a legal call (`review-report.mjs` `errorReport` falls back to
`String(error)` for the message), it yields `reason: null`, which the repo reserves for "nothing was
determined". A spawn failure *is* determined. So follow `job-queue.mjs`'s `timeOut`, which is the
existing precedent for a **diagnosed** terminal write:

```js
const failure = errorReport({
  reason: 'spawn-failed',
  message: `Job ${job.id} could not start a worker process: ${error.message}`,
  hint: '<actionable text>',
});
withBusyRetry(() => finish(db, seq, { state: 'failed', failure, at: new Date().toISOString() }));
```

`errorReport` is imported from `./review-report.mjs`, as `job-queue.mjs` already does.

The `withBusyRetry` wrapper is required by `adr/020`'s enumerated-sites rule — **this becomes a
seventh `withBusyRetry` call site, and that has consequences the next phase owns.**
The busy-exhaustion path must not replace the spawn error: catch it, and rethrow the spawn error, so
the user learns why the spawn failed rather than why the database was locked. **Structure that catch
so it does not silently add an eighth `isBusy` call site** — or if it does, count it deliberately in
phase 2 rather than discovering it when the guard reddens.

**Phase 2 — the site count and the enumeration are part of the change, not paperwork.**
`job-busy.mjs`'s header comment **enumerates its call sites and states their number**, and
`tests/busy-site-count.test.js` counts both from `scripts/lib` and reddens when the prose disagrees.
Adding a site therefore requires amending that enumeration in the same commit.

**TWO documents, not one, and BOTH counts, not one.** `busy-site-count.test.js` reads
`documents = ['adr/020-a-contended-database-must-not-kill-live-work.md', 'scripts/lib/job-busy.mjs']`
— so **`adr/020` states the numbers too and must be amended alongside**; the first draft's file list
omitted it. And the guard counts **`withBusyRetry` sites and `isBusy` sites separately**, so
reconciling only "seven `withBusyRetry` call sites" leaves it red if the busy-exhaustion catch in
phase 1 adds an `isBusy` site. Both numbers, in both documents. More importantly, that
comment carries an explicit warning: *"A SEVENTH call site does not inherit that argument — it is a
property of where these six sit, not of this function, and a caller added inside a live request would
freeze it."* **This phase must argue the new site's safety on its own terms, in that comment**: the
new call sits in the submitter, before any model call exists and after the child has failed to
launch, so the synchronous sleep cannot freeze a request in flight. If that argument cannot be made
honestly, the phase fails and the design changes — it is not a comment to update mechanically.

**Phase 3 — move the sweep.**
Relocate `sweepQuietly(db)` to **before `insertJob`** (see the corrected fork above — *not* between
`insertJob` and `spawnAndStamp`, which would open a fresh 120s blocker). Amend both its own comment and
`submitTask`'s inline comment, which currently justify the *old* position ("submission is the only
place a row is ever created … putting it in the readers instead would make `/oai:status` delete
history"). The justification survives the move; the sentence must say so rather than being left
pointing at an ordering that no longer holds.

**Phase 4 — tests.**
Two behavioural tests, plus one structural check:
1. **A spawn failure marks its own row `failed` and does not block a successor.** Inject a spawn
   rejection, then assert the row's state is `failed` with a non-null failure, and that
   `tryAcquire` for a *second* queued job returns `acquired` rather than `blocked` — with a
   **positive control in the same run** proving the same assertion returns `blocked` against the
   pre-fix behaviour (an un-terminalized `queued` row with `spawned_at` NULL inside the grace).
   Without that control the test cannot fail, which is this repo's signature defect and has now been
   recorded ten times.
2. **A non-busy sweep failure rejects before any child exists AND leaves no queued orphan.** Assert
   that when `sweep` throws a non-busy error, `submitTask` rejects, **no worker was spawned**, and
   **no row was left `queued`** — then assert a subsequent `tryAcquire` returns `acquired` rather than
   `blocked`. The orphan half is not optional bookkeeping: it is the assertion that would have caught
   the first draft's own defect, and asserting only the rejection would pass against the pre-fix code
   too.
3. `tests/busy-site-count.test.js` must go red on phase 1 alone and green after phase 2. **Check that
   ordering explicitly**: it is free evidence that the guard is not inert.

**Size note:** `tests/structure.test.js` is the ratchet and OAI-28 records it at **exactly 300 of
300** — it cannot accept another guard without a deliberate ceiling raise. Nothing here plans to add
one; if a phase turns out to want one, that is a separate decision and a separate commit, not a
silent raise.

## What this draft does NOT decide

- Whether `sweepQuietly` should keep rethrowing non-busy errors **at all**. Option A keeps that
  property and merely moves where it lands. An attended session may reasonably ask whether the sweep
  should ever be able to reject a submission; this draft does not.
- Anything about **OAI-108** (the stderr-only warning being invisible to `--json`). Option A was
  chosen partly because it avoids *adding* to that gap, but it does not close it.
- Anything about the reconciler's writes (**OAI-105**) or `salvageOutcome` (**OAI-106**), which are
  adjacent contention items and are out of scope.

## Codex pre-review of this draft

**A verdict here attaches to the exact bytes challenged and expires the moment the attended session
amends them.**

| Round | Form | Digest challenged | Thread | Verdict |
| --- | --- | --- | --- | --- |
| Probe | claim check (4 claims) | — | `019fe0bc-4c7c-7d10-b63a-32afbf4b3425` | 2 TRUE, 2 refinements |
| Fork | design consensus | — | `019fe0bd-5ef5-71b2-a196-be33d0142549` | Option A + terminalize: yes |
| 1 | threaded, whole plan | `a3b786a3578b` | `019fe0bf-7004-74b0-ba73-0244d900a33e` | **CHANGES-REQUIRED** (3 findings) |
| 2 | threaded, whole plan | `4951873328aa` | `019fe0c1-d642-7301-8110-d17231bc7a76` | **APPROVE** |

Round 2 verbatim: *"The amendments address all three prior findings. The move before `insertJob`
removes the orphan window; `finish` and `errorReport` support the spawn-failure path; and Phase 2
correctly covers both dynamic counts and documents. The settled caveats are coherent, not defects.
Implementable as written."*

**No `plans/oai-67-…approved/` archive was written, deliberately.** `check-plan-gate.sh --approved`
writes an archive that records an approval *crossing the step-3 gate*, and this approval did not: the
draft never entered plan mode and carries no harness slug. Writing one would let a later session read
the gate as closed. **Two consequences the resuming session must own:**

1. **The alternation owed at round 3 was never run.** The contract alternates a **blind** re-ask —
   same plan text, no thread, no verdict history — because the thread proves a finding was addressed
   while blindness is what finds the *next* one. Both rounds here were threaded. So this draft has
   **never been read cold**, and its approval is correspondingly weaker than a step-3 approval.
2. **The round-2 verdict was read from `.rawOutput` by eye rather than piped through the gate's
   reference parser.** The final line was bare and unambiguous, so the fail-closed shapes the parser
   exists to catch (emphasised, fenced, mid-prose) do not apply — but it is a stated gap, not a
   clean parse, and the resuming session's real gate run supersedes it.
