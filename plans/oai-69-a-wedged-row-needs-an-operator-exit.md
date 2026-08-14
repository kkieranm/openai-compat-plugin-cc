provenance: harness slug oai-69-a-wedged-row-needs-an-operator-exit

# OAI-69 — a wedged row needs an operator exit

## The defect, as verified this session

`isAlive` (`scripts/lib/job-liveness.mjs:45`) probes with `process.kill(pid, 0)`. That establishes
that *some* process holds the pid **number**, never that it is our worker — it returns `true` on
success and on `EPERM`, and `false` on every other error. So a row whose recorded pid has been
**recycled** reads `live`.

`decide` (`scripts/lib/job-queue.mjs:113`) blocks on every `running` row that is not provably `dead`,
and `queuedRole` makes a live known-version `queued` row the queue **head**, which blocks everyone
behind it. `finish` and `abandonUnstarted` (`job-record.mjs:243`, `:225`) are the only two terminal
writers in the subsystem, and neither is reachable for such a row: `reconcile` calls `terminalizeDead`
only for `liveness === 'dead'`, and `abandonUnstarted`'s own SQL requires `state='queued' AND
waiter_pid IS NULL`, which a row with a recycled waiter does not satisfy.

There is **no operator escape hatch**. `/oai:cancel` writes `cancel_requested_at` and nothing else,
which only a cooperating worker reads. Recovery today is deleting the database by hand.

Three corrections to OAI-69's own text, carried forward as recorded facts:

1. **"reads `live` forever" is overstated.** If the unrelated process exits, a later probe sees the
   pid absent and reconciliation releases the row. The wedge is **unbounded**, not eternal.
2. **`finish`'s SQL already permits terminalizing a running row** (`WHERE state IN
   ('queued','running')`). Only the call flow prevents it. This plan therefore adds **no new SQL**.
3. **OAI-69's gating condition cites `adr/014:147-152`**, a corpus deleted in `d1ad2aa` (OAI-159), so
   the condition's original text is **unrecoverable**. The discharge is taken from OAI-64's close-out
   in `BACKLOG_DONE.md` instead, which states it directly.

## Scope

**Recovery only.** Detection — making liveness verify process *identity* — is explicitly out, and is
filed as residue. Codex was asked directly whether a cheap portable discriminator exists and answered
that it does not: Node's portable probe exposes existence, not identity; start-time comparison is
OS-specific; challenge-response would need a new per-worker protocol. The heartbeat is the only
discriminator available in the current design.

## Decisions taken with the user (settled — not open for re-litigation as preferences)

| Fork | Decision |
| --- | --- |
| Scope | Recovery only; detection filed as residue |
| Surface | A new `/oai:abandon <id>`, distinct from `/oai:cancel` |
| Row states | `running` **and** `queued` — both pids recycle |
| Guard | Refuse unless the beat is stale; an explicit flag overrides the refusal |
| Foreign rows | Allowed under the same rule, and the row's workspace is printed before acting |
| Beat rule | **Narrowed, not reversed** — the beat still never causes an automatic transition |
| Result | `failed` / `operator-abandoned`, via the existing `finish`. Never `cancelled` |
| Lost answer | Fixed in this change, not filed |

Codex agreed with each of these. It supplied the deciding reason for the row-states fork (a recycled
`waiter_pid` classifies as a live head that reconciliation never touches) and the mechanism that rules
out automatic terminalization (machine sleep advances wall-clock time without letting the heartbeat
timer run, as do `SIGSTOP` and a blocked event loop — so a live worker mid-answer can look stale, and
sleep is precisely when pids are recycled).

## What this feature costs: abandonment is an authorized exception to mutual exclusion

**This must be stated, not discovered.** One background job runs at a time, and that is not a
convenience — `job-heartbeat.mjs:29-34` calls two model calls in flight at once *"the one thing the
queue exists to prevent"*, and it is the stated reason the cancellation exit **writes no row**: a
terminal row would clear the job as a `running` blocker, and the queue could dispatch the next worker
in the window before the old process actually exits.

`/oai:abandon` does exactly what that comment refuses to do — **for a `running` row**. Terminalizing one
removes it from `decide`'s blocker scan (`job-queue.mjs:110-117`), so an eligible waiter may dispatch —
and if the operator was wrong, or was right about the row but wrong about the process, **the abandoned
process may still have a model request in flight**. **A `queued` row carries none of this**: `decide`
moves a row to `running` before acquisition succeeds (`job-queue.mjs:128`) and the model is called only
after that (`cmd-task-worker.mjs:269`), so a queued waiter provably has nothing in flight, and one
behind the head was holding nobody up. This whole section is about the running case, and the operator
message says so per row rather than warning uniformly. The queue-drain test in Phase 6 makes this guaranteed
behaviour rather than a hypothetical race: draining the queue is the feature.

This does not reverse any settled decision. It names what the settled decisions imply, and three things
follow from naming it:

1. **The exception is authorized, and it is authorized by the operator, per invocation.** That is what
   the stale-beat precondition buys: a stale beat is the best available evidence that the process is
   not running its event loop, and therefore the best available evidence there is no call in flight.
   `--force` is the operator taking the exception knowingly, which is why it exists as a separate flag
   rather than a default.
2. **Every place that states the invariant unqualified stops being true, and there are FOUR of them.**
   Amending one and leaving three is how a codebase ends up asserting a guarantee it no longer makes;
   this is the repo's own "when a field's meaning changes, grep the aggregates" rule applied to a
   comment. Each becomes: no *automatic* path writes a terminal row for a live process, and the one
   path that can is an explicit operator command that says what it is doing.
   - `job-heartbeat.mjs:29-34` — *"two model calls in flight at once, which is the one thing the queue
     exists to prevent"*, given as the reason the cancellation exit writes no row.
   - `job-queue.mjs:1-8` — the module header: *"One background job runs at a time, and this is where
     that is decided… two concurrent model calls is the one thing this queue exists to prevent — the
     machine's memory ceiling has room for one loaded model, not two."* It already carves out one
     exception at `:10-11` (foreground `/oai:task` and `/oai:review` do not participate), so it has the
     shape for a second; the memory-ceiling sentence is what the operator warning is paraphrasing.
   - `job-liveness.mjs:16-17` — *"A worker that HAS registered is never abandoned, however long it
     waits."* This one is falsified by the feature's **name**, not merely its behaviour.
   - `commands/status.md:48` — *"One background job runs at a time"*, told to the operator with no
     qualification, in the same file that will now document `/oai:abandon`.
3. **`job-reconcile.mjs:5-10` is where the change is best expressed, because it already frames the
   trilemma.** It says finite recovery from a stale worker, zero overlap of model calls, and never
   signalling a process cannot all hold at once, and records which corner this repo gave up. That is
   exactly what this feature changes: `/oai:abandon` buys finite recovery by spending zero-overlap,
   under explicit operator authorization, while never-signalling stays absolute. The amendment states
   that the automatic paths still give up recovery and only an operator may trade it back.
   **While amending it, fix the error it already contains:** it says the repo *"keeps the first two by
   paying in recovery"*, but paying in recovery means giving up the FIRST of the three it lists — the
   two it keeps are zero overlap and never signalling, i.e. the last two. The clause immediately after
   it (*"a suspended or recycled-pid worker wedges the head of the queue"*) is the proof, and it is
   this item's own defect described accurately. Pre-existing and unrelated to this change in origin,
   but it sits in the sentence being rewritten and would otherwise be re-blessed by the rewrite.
4. **The operator warning must name the consequence, not just the restraint — and it is state-specific,
   because the consequence is.** "Nothing was signalled" is true and insufficient: it tells the
   operator what the plugin did not do and leaves them to infer what may now happen. **For a `running`
   row** the message must say that if the process is in fact alive it may still be talking to the
   model, that an eligible waiter **may** now start, and that the two can overlap; local inference
   servers are the deployment target, so the concrete cost is two concurrent model calls on one
   machine's memory. **For a `queued` row it must claim no in-flight request and no overlap** — that
   much is provable for every queued row, and it is the whole of what this section's concern does not
   apply to. **Drainage is a different question, is not part of this consequence, and is not a property
   of the row's state at all**: abandoning a queued head can unwedge the queue — the queued half of the
   wedge this item exists to fix — but only when no live `running` row is also blocking, since that
   rung is checked first. Phase 3's `couldDrain` is the whole of that judgement, for both arms; nothing
   here may be reduced to "queued means no drainage" or "queued head means drainage". This consequence
   is the reason the running arm's *overlap* warning exists, not a licence to warn uniformly.

**Considered and rejected: requiring the operator to confirm the process is stopped first.** It would
restore the invariant, and it cannot be implemented — verifying that a pid is *our* stopped worker is
exactly the identity question this whole item exists because the platform cannot cheaply answer, and
demanding the operator assert it by hand is the same unverified assertion `--force` already is, with
an extra step. Stating the exception is the honest option; concealing it behind a confirmation prompt
that proves nothing would be worse.

## Phases

### Phase 1 — the beat becomes evidence, in one place

`scripts/lib/job-liveness.mjs`:

- Move `beatIsStale` here from `job-view.mjs:76-83`, unchanged in behaviour, and **export** it. It
  belongs beside `STALE_BEAT_MS`, and this change gives it a second caller — the repo's "one
  definition, or one guard" rule.
- Amend the `STALE_BEAT_MS` doc comment (`:32-34`). It currently says `stalled` "is never terminal and
  never a verdict about the job. The pid decides death; the beat only corroborates." Narrow it: the
  beat still never causes a state transition on its own and no automatic path consults it, but it now
  gates the **refusal** of an explicit operator request. State the reason it may not be promoted
  further — sleep, `SIGSTOP` and a blocked event loop each make a live worker look stale.
- `job-view.mjs` imports `beatIsStale` rather than defining it. `displayOf` is unchanged.
- Amend `job-heartbeat.mjs:29-34` in the same pass, per the mutual-exclusion section above: it states
  as an unqualified invariant a rule that now has exactly one exception, and leaving it would make the
  file assert something the code beside it no longer guarantees.

**Acceptance:** `beatIsStale` has exactly one definition in the repo; `/oai:status` still shows
`stalled` for a fresh-pid stale-beat row; the amended `STALE_BEAT_MS` comment names the refusal it
gates; and **all five invariant sites enumerated in the mutual-exclusion section are amended in this
phase** — `job-heartbeat.mjs:29-34`, `job-queue.mjs:1-8`, `job-liveness.mjs:16-17`,
`job-reconcile.mjs:5-10` and `commands/status.md:48`. Listed here as well as there because a
normative sentence in a discussion section is not an acceptance criterion, and four of the five would
otherwise be checked by nothing.

### Phase 2 — the decision, separate from the write, and both inside one transaction

New `scripts/lib/job-abandon.mjs`. The decision is a pure function over a row so it is testable without
a database; the **authoritative** evaluation of it happens inside the write transaction, never outside.

`abandonDecision(row, nowMs, { override = false })` → `{ allowed, reason }`. It **admits only
`queued` and `running` by whitelist**, never by rejecting terminal states — an unrecognised
non-terminal state must not fall through to the write, because `finish`'s SQL matches only those two
and the resulting `false` would be indistinguishable from a lost race. Refusal reasons, in order:

- `gone` — no row.
- `unknown-version` — `isKnownVersion(row)` is false. Refused, **and `--force` does not lift it**.
  `job-reconcile.mjs:121` already refuses to mutate a row a newer plugin wrote, and `finish` carries no
  schema predicate of its own, so this guard has to live here or the invariant is broken by this
  command alone. A newer-version *database* is refused earlier by `readOnly` (Phase 3); this is the
  row-level guard, and the two are different facts — a writable database may hold a newer row.
- `not-abandonable` — the state is neither `queued` nor `running` (terminal, or anything unrecognised).
  Not liftable by `--force`: terminal immutability is a property of the database, not a policy this
  command may waive.
- `beating` — the beat is fresh. Refused unless `override`.
- `no-beat` — no parseable `last_beat_at`. Refused unless `override`, failing **closed**. A queued row
  that has registered a waiter (`registerWaiter`) and a running row (`claimJob`) both carry a beat; a
  row with none is one this command cannot reason about. **`insertJob` writes no beat**, so a
  freshly-submitted pre-registration row legitimately has none — it is handled correctly by refusing
  (it is either inside its startup grace or collected as `never-started` by the reconcile-first step),
  and the code comment must say that rather than claim every row carries a beat.
- Otherwise `allowed`, reason `stale`.

This differs deliberately from `beatIsStale`, which returns `false` for an unparseable beat so that
`/oai:status` does not flag every job's first moments. Both callers read the same helper and decide
differently, which is why the helper stays a plain staleness predicate and the policy lives here.

`abandonRow(db, id, { override, nowMs, at })` performs **one `BEGIN IMMEDIATE` transaction** that
reads the row, evaluates `abandonDecision` on the bytes it just read, and only then calls `finish`.
**All three statements are inside the transaction**, and the read is as load-bearing as the other two:
reading the row outside and closing over it leaves the TOCTOU untouched — the stale bytes would simply
be decided on inside a transaction that cannot save them. A row read before the lock is taken is not
an authoritative read. Nothing may be read or decided outside it. Without this the guard has a TOCTOU hole: `beat()`
(`job-record.mjs:176`) can refresh `last_beat_at` between an outside decision and the write, so a
worker resuming from sleep or `SIGSTOP` — the exact false positive the guard exists to prevent — would
be abandoned without `--force`. `finish` compares only state and would not catch it.

`inImmediateTransaction` is currently module-private in `job-queue.mjs:29`. **Export it** and import it
here rather than writing a second one — one definition, per the repo rule.

The write is `finish(db, seq, { state: 'failed', failure, at })` where `failure` is `errorReport`'s
envelope with `reason: 'operator-abandoned'`, built exactly as `job-reconcile.mjs`'s `report` helper
builds `worker-died`. **Not `cancelled`**, per OAI-66: an unconfirmed stop must never read as a tidy
cancellation. The message says what is known — the operator declared the row abandoned, the process was
never signalled, and if it is in fact alive it may still be running.

`abandonRow` returns a **discriminated outcome**, not a boolean: `{ outcome: 'abandoned' | 'refused' |
'lost', reason, state }`, where **`state` is the row's state as the transaction read it, before the
write** — not the state it wrote, which is always `failed` and carries no information. The caller needs
the pre-write state because what abandoning a row *means* differs by it, and only the transaction ever
saw it authoritatively. On a lost CAS it **re-reads the row inside the same transaction and reports
the state it actually found**, never asserting a cause — `false` from `finish` can mean the row was
terminalized underneath us *or* that it is gone entirely, and those are different things to tell an
operator.

**The `lost` arm is unreachable as specified, and its comment must say so** rather than leave a reader
to work out whether it is live. With the read, the decision and `finish` all inside one
`BEGIN IMMEDIATE`, nothing can terminalize the row between them, and the decision's whitelist is
exactly `finish`'s `WHERE` set — so the arm exists because a future edit could separate them, not
because anything reaches it today. `job-view.mjs:213-215`'s `!head` arm is the house precedent for
defensive-and-labelled.

**Acceptance:** every branch of `abandonDecision` has a test, including `unknown-version` with
`--force` still refusing; the decision is re-evaluated inside the transaction — **proved by Phase 6's
structural guard, not by the beat-refresh test**, which cannot distinguish the two placements and says
so there;
`abandonRow` writes `failed` and never `cancelled`; the reason string is `operator-abandoned`.

### Phase 3 — the command

New `scripts/lib/cmd-abandon.mjs`, modelled on `cmd-cancel.mjs`:

- `ABANDON_SPEC = { booleanFlags: ['force'] }`. `--force` is the override.
- Refuses a read-only (newer-version) database, exactly as cancel does — abandoning is a write.
- Runs `reconcileAll(db)` **first**, so a row whose worker is genuinely gone is terminalized by the
  ordinary path and the operator is told that is what happened, rather than this command taking credit
  for it.
- **Prints the row before acting**: id, state, workspace, pid, how long since its last beat, and what
  it was asked to do. Foreign rows are the common case — the operator must see whose work they are
  ending. **That read is for display only and is never an input to the decision** — it happens in
  `cmd-abandon.mjs`, outside the transaction and outside the module the structural guard covers, and
  the outcome reported afterwards comes from what the transaction did, not from what was printed
  before it. The two can legitimately disagree, and when they do the transaction is what happened.
- On refusal: a `UserError` naming the refusal reason. For `beating` and `no-beat` it names the beat's
  age and says `--force` overrides it; for `unknown-version` and `not-abandonable` it says plainly that
  `--force` will not, so an operator does not retry with a flag that cannot help. Exit 1.
- On success: names the state written, that **nothing was signalled**, and **what may now happen**.
  That last part is **state-aware, keyed on the pre-write state the transaction returned**, because the
  overlap warning is simply false for a queued row:
  - **`running`** — the process, if it exists, may still have a model request in flight, and if a
    waiter starts the two can overlap on one machine's memory. This is the case the mutual-exclusion
    section is about. Whether a waiter **may** now start is `couldDrain`, below — the overlap warning
    stands on its own and is not conditional on it, because the danger is the abandoned process, not
    the successor.
  - **`queued`** — the waiter was not signalled and **will not send a request**: `decide` moves a row
    to `running` before acquisition succeeds (`job-queue.mjs:128`) and `cmd-task-worker.mjs:269` calls
    the model only after that, so a queued row provably has nothing in flight. **Claim no overlap —
    that is the durable guarantee for every queued row.** Drainage is a *separate* question with a
    different answer, and conflating the two would be false in both directions: a queued row that was
    the **head** is the queued half of this item's own wedge, and abandoning it is exactly what lets
    the waiter behind it acquire on its next poll (`head.seq !== seq`, `job-queue.mjs:119-128`). So the
    queued arm says drainage **only when `couldDrain`**, defined below.

  **Whether anything can now start is computed inside the transaction, not hedged in prose — and it is
  NOT "was this row the queued head".** `abandonRow` returns `couldDrain`, evaluated under the lock
  against the state left *after* this write, by walking **both** of `decide`'s rungs in `decide`'s own
  order (`job-queue.mjs:110-128`):

  1. Does any **other** non-dead `running` row remain? If so, `couldDrain` is false whatever else is
     true — the running rung is checked first and rejects every caller before queue order is consulted.
  2. Otherwise, excluding the target, does `scanQueued` yield a head? If so, `couldDrain` is true.

  **The queued rung alone is the wrong answer, and this repo has already shipped that exact bug**: it
  is finding 2 of OAI-64's close-out, where the first implementation consulted one rung and marked a
  queued row that clearing would not help while the row actually holding the queue sat unmarked below
  it. `job-view.mjs:188-219` `blockingSeqFor` is the corrected form and the rule to reuse — walking
  `decide`'s two rungs read-only — and `job-view.mjs:216` is the precedent for a read-only `scanQueued`
  with a no-op `onSkip`. `job-view.mjs:145` already says why the rule is imported rather than restated.

  **"May start", never "will start"**, wherever starting another job is mentioned — in either arm, and
  only when `couldDrain`: nothing dispatches proactively, so even then it is a waiter's next poll that
  decides. Per the mutual-exclusion section, the restraint alone is not the warning — but neither is a
  warning that describes a risk this particular row never carried, nor a promise of drainage the queue
  will not deliver.
- On `lost`: reports the state the transaction actually found, and does not claim to have written
  anything.

Wire `abandon: runAbandon` into `COMMANDS` in `scripts/oai-companion.mjs`, add `commands/abandon.md`
with `allowed-tools: Bash(node:*)`, and add `'abandon.md': ABANDON_SPEC` to `SPECS` in
`tests/plugin.test.js` — that test asserts the command-file set and the spec set are equal, so a new
command that skips it fails the suite rather than escaping the flag-documentation guard.

**Acceptance:** `/oai:abandon` refuses a fresh-beat row and succeeds with `--force`; refuses a terminal
row with or without `--force`; works on a foreign row and prints its workspace; the markdown documents
`--force`.

### Phase 4 — the remedy is named where the wedge is seen

- `job-render.mjs`: the `! must clear before this workspace's queued job can proceed.` line
  (`:114`, `:139`) gains a second line naming `/oai:abandon <id>` under the conditions in which the
  command would actually succeed. Naming it unconditionally would advertise a command that will refuse.
  **A stale beat alone is not that condition** — three facts have to hold, and two of them are not
  properties of the row: the beat is stale, the row's `schema_version` is known, and **the database is
  writable**. `/oai:status` may read a database a newer plugin wrote, where every abandon refuses.
  `cmd-status.mjs` already has `readOnly` from `openJobs`, so thread it into `renderList` as an option
  rather than leaving the renderer to guess; `job-render.mjs` receives no writability today, and that
  absence is why the first draft of this phase was wrong.
- `commands/cancel.md:36-37` currently says a stalled worker "needs dealing with by hand; the status
  output names the pid." That is the prose this feature makes false. Rewrite it to point at
  `/oai:abandon`, keeping the distinction: cancel asks the worker, abandon writes off the row.
- `commands/status.md:50-53` says of a `stalled` job: *"Nothing here will terminate it… The job id and
  pid are shown for you to deal with by hand."* The first clause stays true — nothing terminates the
  **process** — but the second stops being the whole remedy, so it gains the row-level exit. The
  `overdue` bullet at `:54` says "Same caveat" and inherits the change; the `cancelling` bullet's
  closing sentence at `:57-58`, *"A job showing `stalled` instead will never see the request"*, is the
  exact place a reader now needs pointing at `/oai:abandon`. Line 41's *"the states below say which
  ones need dealing with by hand"* is the summary that has to move with them.

**Acceptance:** the blocker line names the remedy only when all three conditions hold, proved by a test
that suppresses it on a read-only database and on an unknown-version row; no markdown still says a
stalled job can only be dealt with by hand.

### Phase 5 — the answer cannot be lost silently

`cmd-task-worker.mjs:226-231`. `withBusyRetry(() => finish(...))` returns `finish`'s boolean and it is
**discarded**. A `false` is not an exception, so the existing `catch` never runs: if the row was
terminalized underneath a live worker, the answer is written nowhere — not the row, not the log. This
feature is the first thing that makes that race operator-reachable, which is why it is fixed here.

- Capture the boolean. On `false`, call `salvageOutcome(seq, outcome)` — the existing mechanism,
  unchanged — and **do not throw**: nothing failed, the row was simply claimed by someone else.
- The comment above that block currently reasons only about the thrown-storage-error case. Extend it to
  name both ways the write can fail to land, and that they differ in whether anything went wrong.
- Out of scope, stated: the identical discarded return on `publishFailure`'s path. That one loses an
  error envelope, not a paid-for answer, and the row's own state remains OAI-106's subject.

**Acceptance:** a worker whose row is abandoned mid-run writes `SALVAGED_OUTCOME` to its log and exits
0.

### Phase 6 — tests

Against the existing fake-server/in-process helpers; no network, and `runCompanion` is `await`ed
(never `spawnSync`, per the repo's footgun list).

- `tests/abandon.test.js` — the decision table, the two writes, the refusals, `--force`, a foreign row,
  a terminal row, and the id-not-found path.
- Extend `tests/queue-guards.test.js`'s existing structural guard coverage: assert the new module adds
  no `process.kill` call at all. The guard already fails any second argument other than literal `0`;
  this feature must not introduce even a probe.
- A test that the success message **names the overlap** for a **`running`** row, not only the
  restraint — the mutual-exclusion consequence is the one thing an operator cannot recover from being
  unaware of, and prose that is not asserted is prose that drifts. Its pair asserts the **`queued`**
  message does **not** claim overlap, which is the half a single happy-path test would miss.
- **Message tests keyed on `couldDrain`, including the case that made the previous design wrong**: a
  queued head **with a live running row still present** must NOT say a waiter may start, because it may
  not — the running rung rejects every caller first. Its pair, a queued head with no running row, must
  say it. A third covers a queued non-head. **This trio is the guard against re-committing OAI-64's
  finding 2**, and the first of them is the one a single-rung implementation passes only by accident.
- **Two** drain tests, one per wedge shape, because both are this feature's stated targets: abandoning
  the **running** blocker, and abandoning a **queued head** with no running row. In each, the acceptance
  criterion is observed dispatch, not merely that the row went terminal. Note what the running one is
  simultaneously proving: that the exception to mutual exclusion is real and reachable. Nothing
  dispatches proactively: every waiting worker polls `tryAcquire` every 300ms, so each test drives a
  real waiter and asserts it acquires.
- A **negative** drain test: abandon a queued head while a live running row remains, and assert the
  waiter does **not** acquire. Asserting an absence needs one route to it, so this fixture must differ
  from its positive twin in exactly the running row's presence.
- A **race** test for the TOCTOU hole: read the row, `beat()` it fresh, then run `abandonRow` without
  `--force` and assert it refuses. **This test alone does not pin the mechanism, and saying it did
  would be false** — `node:sqlite` is synchronous, so the fresh beat lands before `abandonRow` reads
  anything, and an implementation that decided *outside* `BEGIN IMMEDIATE` would pass it too. What it
  does prove is that no caller's earlier read is cached into the decision, which is worth keeping.
- The mechanism itself is pinned **structurally**, in `tests/queue-guards.test.js`, beside the
  existing `process.kill` guard and in the same shape. It covers **all three** statements —
  the authoritative row read (`jobById`, or any `SELECT`), `abandonDecision`, and `finish` — each of
  which must appear only inside the `inImmediateTransaction` callback body in `job-abandon.mjs`.
  **The row read is the one that must not be omitted**: a guard naming only the decision and the write
  still passes an implementation that reads the row outside and closes over it, which leaves the
  original TOCTOU exactly as it was — the stale bytes are simply decided on inside a transaction that
  cannot save them. A textual guard is the honest instrument here: the property is "these three
  statements are inside that call", which is a fact about the source, and this repo's rule is that a
  recurring defect class graduates from a reviewer's prompt to a structural test.
  Two **positive controls**, because the guard has two ways to pass vacuously: it asserts it found at
  least one `inImmediateTransaction` call (so deleting the transaction fails rather than passing), and
  it asserts it found at least one occurrence of each of the three statements it is placing (so
  renaming one out from under the guard fails rather than passing). Each control is proved by mutation
  at step 5, not asserted.
  **Stated limit, rather than left to be discovered:** the guard covers `job-abandon.mjs` only, so a
  future caller elsewhere invoking `abandonDecision` outside a transaction would not trip it. That is
  acceptable because `abandonRow` is the only sanctioned entry point and `cmd-abandon.mjs`'s own read
  is display-only by design — but the guard's scope is a fact about it, not a property of the system,
  and the test says so in a comment.
- An `unknown-version` row: abandon refuses it **with and without** `--force`, and the row is
  unchanged afterwards.
- `tests/plugin.test.js` gains the new command through `SPECS` (Phase 3).

**Size:** `job-store.mjs` is at 297/300 and is not touched. `tests/structure.test.js` is at 299 lines
with a 300 ceiling and **no allowlist entry is added** — the new guards live in `abandon.test.js` and
`queue-guards.test.js`, so OAI-28's ratchet split is not a prerequisite for this change.

## Mutation check (step 5 of `/feature`)

Key invariant: **a fresh beat refuses**. Invert the comparison in `abandonDecision` so a fresh beat
reads stale, prove the mutation landed with `mutation-landed.py`, and name the test that fails.
Second, if the first is ambiguous: delete the `isKnownVersion` refusal and assert the unknown-version
test fires — that one guards an invariant the rest of the subsystem already holds, so a silent loss of
it is the costliest single-edit regression this change could ship.

## What this deliberately does not do

- Does not signal any process. `tests/queue-guards.test.js` forbids it and the decision stands.
- Does not make liveness identity-aware. Filed as residue.
- Does not terminalize a stale row automatically. Ruled out on the mechanism above.
- Does not change `TERMINAL_STATES`. `operator-abandoned` is a `failure.reason`, and nothing in
  `scripts/` switches on that field — verified — so no reader needs a new arm.
