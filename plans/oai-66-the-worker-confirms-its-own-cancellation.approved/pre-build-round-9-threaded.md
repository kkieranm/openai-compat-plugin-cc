ARCHIVE — not the current spec; the plan beside it is
# OAI-66 — a crash must not be published as a clean cancellation

## Context

When a background worker dies, `job-reconcile.mjs` decides its verdict. If a cancellation was pending
it publishes `cancelled` and **returns before the `worker-died` branch**, writing `state='cancelled'`
with `failure=null` and `outcome=null` — and `job-render.mjs` `noteFor` has no `cancelled` case, so
that row reaches the user with no note at all. A worker that **crashed** while a cancel happened to be
pending is therefore reported as a tidy cancellation, and the crash diagnosis is discarded. The verdict
is decided purely by whether a cancel was in flight, never by why the process died.

The root cause is that **the worker records no fact on its way out** — both cancel exits write only a
prose line to stderr — so the reconciler's inference is the only thing that produces `cancelled`.

**The sibling defect (b), shipping here too.** `terminalizeUnstarted` (`job-reconcile.mjs:54-58`) tells
the user *"The process that submitted it most likely died before the worker was spawned. Submit it
again."* — a cause it cannot establish. It never consults `spawned_at`, and OAI-67 (shipped
2026-08-12) made `spawned_at` NULL possible **while a real worker exists**, so the unattended draft's
fix of conditioning the hint on `spawned_at` would produce a new false claim rather than remove one.

## Probe findings that shaped the design

Verified against disk this session; several contradict the unattended draft
(`plans/oai-66-a-crash-must-not-be-published-as-a-clean-cancellation.md`, six Codex rounds, final
`CHANGES-REQUIRED`, no `.approved` sibling — input only).

1. **A row cancelled while `queued` provably never sent a request.** `job-queue.mjs:70,77`: `decide`
   returns `cancelled` only while `mine.state === 'queued'`, and acquisition (`state → running`)
   precedes any request — stated at `:75-76` (*"cancel first and it never runs, claim first and the
   heartbeat catches it"*) and at `cmd-task-worker.mjs:269` (*"no request was sent"*).
   **Only a `running` row is ambiguous.** This deletes the draft's phase 1b: the queued exit needs no
   change at all, and with it goes the question of whether that write may use `withBusyRetry` (an
   eighth site, with the count ripple through `adr/020`, `job-busy.mjs` and `CLAUDE.md`).
2. **`terminalizeUnstarted`'s cancel branch is already correct and stays untouched** — it only sees
   rows where no worker registered, and registration (`cmd-task-worker.mjs:260`) precedes anything
   being sent.
3. **`noteFor` needs no new branch.** `job-render.mjs:80` already returns `view.failure.message` for a
   `failed` row.
4. **The hint only appears in `/oai:result`**, never in `/oai:status` (which renders `.message` only),
   and `cmd-result.mjs:74,82` already appends *"Its log is at …"*. So (b) must not copy the sibling's
   "in the job log" wording — it would duplicate what the command prints.
5. **Decision P is repo precedent.** `job-heartbeat.mjs:72-78` already rejected the alternative:
   *"one try block made contention able to keep an expensive model request alive indefinitely after the
   user asked for it to stop."*
6. **A worker ending its own run is explicitly sanctioned** (`job-reconcile.mjs:10`).
7. **The draft's "exactly one existing assertion changes" is false** — `insertSynthetic`
   (`tests/job-helpers.mjs:138`) stamps `created_at` and `spawned_at` from the same value, so its
   `spawned_at` split would flip three.
8. **The log is a real file and `process.stderr.write` to a file is synchronous** (`job-spawn.mjs:33`
   `openSync`), so a marker written immediately before `process.exit()` lands. This is *not* the
   async-to-pipes hazard that bit OAI-67.
9. **The log is not a model-free channel, but the exposure is narrower than round 2 assumed.**
   `job-spawn.mjs` sends stdout and stderr both to the log, and the worker's own writes are all
   diagnostics — it returns and persists the answer rather than printing it. The ONE exception is
   `cmd-task-worker.mjs:175`, `SALVAGED_OUTCOME ${seq} ${JSON.stringify(outcome)}`, which puts the
   model's answer on the log when a completed write exhausts its retry. So marker-shaped bytes CAN
   reach the log, JSON-encoded and mid-line. The acknowledgement is a separate path anyway: a verdict
   that suppresses a crash diagnosis should not rest on the exposure staying narrow, and nothing the
   model produces can reach a path outside fd 1 and 2.

## Decisions made with the user (this session)

1. **The worker confirms its own exit**; the reconciler stops inferring. Codex and I independently both
   chose it.
2. **The unconfirmed case is the existing `failed` state carrying `reason: 'cancel-unconfirmed'`**, not
   a new terminal state — following `terminalizeSpawnFailure` (`job-launch-outcome.mjs:51-56`, shipped
   2026-08-12) and avoiding a cross-version hazard plus edits to a shipped agent's `awk` poll loop,
   `tests/plugin.test.js` and `CLAUDE.md:154`.
3. **If the confirmation write fails, the worker exits anyway** and the row degrades to unconfirmed.
   Contradicts the draft, which required the worker not to exit until its write landed.
4. **(b) ships here**, with evidence-safe wording rather than the draft's unsound `spawned_at` split.
5. **The confirmation is a FILE the worker writes, not a row write and not a line in the job log.**
   Codex and I independently both chose a filesystem fact over a new column, and the user confirmed
   that; round 2 then established that it must be a SEPARATE path rather than a line in the shared log,
   which strengthens the same choice on the axis the user was told was its cost.

## What round 1 of the plan gate changed, and why

Round 1 had the worker write its own terminal `cancelled` row and then exit. **Codex refused it, and was
right:** committing that row **releases the queue while the cancelled request is still generating**.
`finish()` clears the `running` blocker, so another worker can acquire and send before the first
process is next scheduled to reach `process.exit()` — violating the no-overlapping-model-calls
invariant that `job-reconcile.mjs:5-8` and `job-queue.mjs:82-86` both rest on. An unref'd timer does
not prevent cross-process scheduling between the commit and the exit.

**So the confirmation must be a fact that does NOT make the row terminal.** Four candidates were
weighed; a filesystem fact was chosen over a new column (`user_version` 1→2, and `job-store.mjs:89-91`
requires an older build to *refuse outright*, costing every older build background jobs entirely), over
overloading an existing column, and over giving the heartbeat an abort handle (which adds the very
lifecycle `job-heartbeat.mjs:21-27` was designed to avoid).

**Round 2 then refused the first version of that fact** — a marker line in the job log — because the
log carries model output and the prompt is user-supplied, so the marker was forgeable by the very
content it would be read alongside, and a forged one turns a crash back into a clean cancellation. The
acknowledgement is therefore a separate path — one model output cannot create, whatever it says.

**A consequence worth stating: this design falsifies LESS existing documentation than round 1 did.**
Because the worker still writes no row, `job-queue.mjs:142-144` (*"a later reader is what writes the
terminal state"*) and `job-record.mjs:187` (*"a later reader observes the exit"*) both stay true.

## Change

**Phase 1 — the running worker confirms, without touching the row.** `job-heartbeat.mjs`,
`exitOnCancel`:

- Write a **sidecar acknowledgement file** beside the job log — `<seq>.cancel-ack` in `logsPath()` —
  immediately before exiting. It carries the row's **`id`**, and the reconciler accepts it only when
  that id matches the row it is judging.
- **The READ is the load-bearing half, and it must not block.** It opens with
  `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, `fstat`s the descriptor, requires a regular file, and refuses
  anything above a small size bound before parsing. Every failure of open, stat, read or close degrades
  to absent.
  `O_NOFOLLOW` because a symlink planted there could aim the read at `<seq>.log`, reopening the
  model-output forgery the sidecar exists to close. **`O_NONBLOCK` because the regular-file check
  happens AFTER the open**: a planted FIFO at that path blocks `openSync` indefinitely, and this read
  runs inside `decide`'s `BEGIN IMMEDIATE` — so a blocking open wedges the queue and every other
  writer, which is worse than the forgery it sits beside. `O_NOFOLLOW` does not prevent it.
- **What the sidecar does and does not authenticate — stated narrowly, because the earlier wording
  overclaimed.** It closes the vector this design is about: **model-controlled output cannot create
  files in the state directory**, only reach the shared log. It is NOT general authentication against
  another process running as the same user — `O_EXCL` makes the WORKER refuse a pre-existing file, but
  the reconciler cannot tell a worker-written acknowledgement from one pre-seeded with the current
  row's id. That is the same limit the accepted-residual witness already documents, reached by a
  different route, and it is accepted on the same footing: anything able to write that directory can
  already write `jobs.db`.
  The write uses `O_CREAT | O_EXCL` so an existing file is never overwritten. `O_NOFOLLOW` is added
  there for symmetry and is **not** claimed to be load-bearing: `O_EXCL` already fails `EEXIST` on a
  symlinked path by POSIX, whichever way the link points.
- **The default `onCancel` writes nothing when it was given no id**, so a future test driving the
  default cannot put an `undefined`-id acknowledgement into a real state directory.
- **The id binding is not decoration, and its guarantee is stated narrowly rather than overclaimed.**
  `seq` is `AUTOINCREMENT` and never reused *within a database*, but if `jobs.db` is deleted, restored
  or recreated while `logs/` survives, the counter restarts and a surviving `<seq>.cancel-ack` would be
  read as the new job's confirmation — this item's own defect, reintroduced. Retention cannot close it:
  its unlink path deliberately tolerates every deletion failure (`job-retention.mjs:82`). The id makes
  misattribution require BOTH a reused `seq` AND a repeated id; `id` is `randomUUID().slice(0, 8)`
  (`task-submit.mjs`), so that second condition is a 32-bit collision. **This is a reduction, not an
  impossibility proof**, and the plan claims no more: binding to a store incarnation would close it
  completely and costs a schema change the user declined. A mismatched id is treated exactly as an
  absent one.
- **Being outside the log is what puts it beyond the model's reach — a narrower claim than
  authentication, and the narrowing is deliberate (see the trust boundary below).** This is the round-2
  fix: a marker line in the log is forgeable, because `job-spawn.mjs` sends **stdout and stderr both** to that file and the
  task prompt is user-supplied, so model output containing the marker form would turn a crash back into
  a clean cancellation — reintroducing this very defect through its own fix. Nothing the model emits
  can reach a path outside fd 1 and 2. `SALVAGED_OUTCOME` is *not* precedent for the log-line version:
  it is a human recovery aid, never evidence used to suppress a diagnosis.
- **No row write, no database access at all**, so the queue stays blocked until the pid is observed
  dead. This is the round-1 fix.
- **Decision P**: if the marker write throws, exit anyway; the row degrades to unconfirmed. Exit code
  stays 0 and `process.exit()` (not `process.exitCode`) is unchanged — its docstring's reasoning about
  closing the socket is untouched.
- **`job.id` must be plumbed in, not looked up.** The acknowledgement carries the row's textual `id`,
  and this path may touch no database — so `startHeartbeat`, which today receives only `db` and `seq`,
  takes the id **through its options bag**, from the one PRODUCTION call site,
  `cmd-task-worker.mjs:198`, where `job` is already in scope. The options bag rather than a positional
  argument because two test files also call `startHeartbeat(db, seq, opts)`; a positional would churn
  them for nothing. `onCancel` stays an injectable seam, which is how the tests drive this.

**Phase 2 — the reconciler stops inferring, but only where it must.** `job-reconcile.mjs`
`terminalizeDead` splits on the row's own state:

- `row.state === 'running'` + cancel pending → look for that job's acknowledgement file:
  - present → `cancelled`, exactly as today.
  - **absent, or unreadable for any reason** → `failed`, `reason: 'cancel-unconfirmed'`, message saying
    the worker exited without confirming and may have died, hint pointing at the log. Every failure of
    the check degrades this way; nothing throws. The job log is never read or parsed.
  - **"Nothing throws" is a hard constraint, not politeness, and the reason goes beside the code.**
    `terminalizeDead` runs inside `decide`'s `BEGIN IMMEDIATE` (`job-queue.mjs:85`). A throw there rolls
    the transaction back, escapes `tryAcquire`, is rethrown by `attempt()` as non-busy, escapes
    `awaitTurn` — which `cmd-task-worker.mjs` awaits **outside any try** — and kills a worker that is
    merely waiting its turn. That is the same shape `job-queue.mjs:160-166` already documents.
- otherwise (a `queued` row: waiting, never acquired) → `cancelled`, unchanged, because finding 1 makes
  it provable without any log.
- The docstring at `:22-28` is rewritten: a confirmed cancellation is one the worker announced; an
  unconfirmed one is a death that cannot be distinguished from a cooperative exit.

**Phase 3 — (b), the hint that blames the submitter.** Same file, `terminalizeUnstarted`. The message
stays (it is true). The hint drops the causal claim, states the epistemic limit, and gives the one
honest action: resubmitting once is reasonable, a recurrence is systemic. It must **not** repeat the
log path, which `cmd-result.mjs:82` already appends.

**Phase 3b — retention learns about the new file.** `job-retention.mjs` deletes a job's log when its
row goes (`removeLog`, `:84`); it must delete the acknowledgement beside it, tolerating absence.
**The orphan SCAN key must widen too, not just the unlink** — `orphanLogs` derives seqs from `<seq>.log`
names and `removeLog` swallows every failure, so an acknowledgement whose log was already unlinked
while its own unlink failed would never be enumerated again, leaking permanently in the one directory
whose survival past a database recreation is this design's stated residual. The scan takes the UNION of
`<seq>.log` and `<seq>.cancel-ack` seqs. Its comment claims *"anything in this directory that is not
`<seq>.log` was not put there by this plugin and is not this plugin's to delete"* — which this change
falsifies, so the sweep and that sentence are both updated. `job-store.mjs` gains the path helper
beside `logPathFor`, so no caller builds the name itself.

**Phase 4 — docs.** Amend `adr/014-async-jobs.md` where cooperative cancellation is argued: the
inference→confirmation change, the `queued`/`running` asymmetry and why it is provable, decision P with
its precedent, and why the shared job log is unsuitable as evidence — `SALVAGED_OUTCOME`
(`cmd-task-worker.mjs:175`) is the demonstration, not the licence: it puts the model's own answer on
that log, which is exactly why a verdict may not be read from it. Update
`CLAUDE.md:108-109`'s *"cancel is therefore cooperative"* clause to one line naming the new fact.
Correct `job-heartbeat.mjs:29-31` (*"Nothing is written on the way out"*, now false) and the
`tests/cancel.test.js` header (a later reader still writes the verdict, but it is now confirmed or
unconfirmed). Docs precede review, so they enter the reviewed diff.

## Verification

1. `npm test` green (810 before this change).
2. The repo `verify` skill: tests, real plugin load, and a live `--background` round trip. LM Studio was
   up this session on `:1234` with `qwen/qwen3.6-27b`, so step 4 (live) is preferred over the stub.
3. **Witnesses**, in `tests/cancel.test.js`, all driving a real second process as that file already does:
   - a cancelled **running** worker leaves the acknowledgement and reconciles to `cancelled`. The
     existing assertion at `:90` (*"the exiting worker records nothing itself"*) stays TRUE of the row
     and is kept — the worker still writes no row; what is new is the sidecar.
   - a running worker **SIGKILLed** with a cancel pending — no marker — reconciles to `failed` /
     `cancel-unconfirmed` with the death named. **Positive control in the same run**: the identical
     death with **no** cancel pending still reconciles to `worker-died`, so the branch is shown to be
     decided by the evidence and not by the fixture.
   - a cancelled **queued** worker still reads `cancelled` (`:122` unchanged), and **no log is read** —
     the witness that phase 2 did not over-reach.
   - **decision P**: with the acknowledgement write forced to throw, the worker still exits and the row
     reads `cancel-unconfirmed`. Claimed narrowly: an unguarded throw would also end the process, so
     this cannot by itself separate P from an uncaught error — what it does redden on is the failure
     mode that matters, a write the worker would otherwise wait on.
   - a **missing acknowledgement** on a running row with a pending cancel degrades to
     `cancel-unconfirmed` rather than throwing.
   - **FORGERY**: with marker-shaped bytes seeded directly into `<seq>.log`, a killed worker with a
     pending cancel still reconciles to `cancel-unconfirmed`. Stated as what it actually establishes —
     the reconciler never reads the log — rather than claiming a provenance the fixture cannot produce:
     the fake server returns content, and the worker persists rather than prints it, so no test can
     drive genuine model output onto the log except through the salvage path.
   - **STALE ACKNOWLEDGEMENT**: an acknowledgement bearing a DIFFERENT job's id is ignored and the row
     reconciles to `cancel-unconfirmed` — the recreated-database case as it will actually occur.
   - **FIFO**: with a FIFO planted at the acknowledgement path, reconciliation COMPLETES, publishing
     `cancel-unconfirmed` rather than blocking. The witness that the read cannot wedge the queue; the
     symlink witness cannot reach it. **It must be given an explicit time bound that REJECTS BY NAME**,
     following `tests/job-helpers.mjs` `submitWithSlowStderr` (*"a wedge must REJECT, never resolve"*):
     without `O_NONBLOCK` the open blocks forever WHILE HOLDING THE WRITE LOCK, so the rest of the
     fixture blocks behind it, and `node --test` has no default timeout — so the unbounded version's
     failure mode is an indefinitely wedged suite rather than a named failure, which is not a witness.
   - **THE ACCEPTED RESIDUAL, written as a test rather than a caveat**: a reused `seq` whose
     acknowledgement carries a MATCHING id IS accepted. This documents the limit of the binding where a
     reader will meet it, instead of leaving it as prose nobody executes.
   - **SYMLINK, scoped to the READ side and built so it can actually fail.** **Truncate** `<seq>.log`
     to a genuine, **id-matching** acknowledgement payload — truncate rather than append, or the read's
     own size and shape gate rejects it and the no-`O_NOFOLLOW` variant degrades for the wrong reason,
     leaving the witness vacuous by a second route. The worker is dead by then, so truncating is safe
     and wholly in the fixture's control. Then aim a symlink at the acknowledgement path at that log. A read lacking `O_NOFOLLOW` publishes `cancelled`; the read as specified degrades to
     `cancel-unconfirmed`. Written this way deliberately: the obvious version — an empty log and a
     symlink — reddens for nobody, because the bytes fail the id check regardless and `O_EXCL` refuses
     the write path whichever way the link points. A witness that cannot fail is worse than none.
   - retention deletes the acknowledgement with the row, and leaves a file it did not write.
   - (b): the hint no longer asserts the submitter died.
4. **Mutation, on the key invariant** — the `running`/`queued` split in `terminalizeDead`. Remove the
   state test so every pending cancel consults the log; the queued witness must redden. Prove it landed
   with `~/Code/dotfiles/tests/mutation-landed.py`, name the failing test, restore, prove the restore by
   `diff`. Second mutation: make the marker read always succeed, and the SIGKILL witness must redden.

**Size note:** `job-reconcile.mjs` is 79 lines and `job-heartbeat.mjs` 99, against a 300-line budget —
no extraction expected, though the log read may warrant its own small module if it grows past a few
lines. `tests/cancel.test.js` must be checked against the budget once the witnesses land.

## Entry tier for review

**Full.** An executable change on the cancellation path, a published-state change a user acts on, a
reconciler branch, and new filesystem I/O in a decision path. `lean-wide` does not fire (no vendor
dialect or wire format). `security-review` is structurally unreachable in this repo — its lens folds
into `codex-adversarial`, so every pass completes with a coverage gap, which also means `adr/032`'s
confirmation pass can never trigger here; the exit is the ordinary verdict point.
