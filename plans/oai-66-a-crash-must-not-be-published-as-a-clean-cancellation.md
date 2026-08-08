# OAI-66 — a crash must not be published as a clean cancellation

**STATE: `unattended-draft — NOT harness approved`.**

Not a plan in the `/feature` sense; no code may be written from it. Drafted during unattended run
`run-1786181658-201519007` with the user away, under `adr/045` (plan mode must not be entered when
`ExitPlanMode` would prompt a user who is not there). The Codex verdict recorded at the end is
**pre-review, never authorisation**. No harness slug, because this never entered plan mode.

**This draft is the one in the run's queue that most needs an attended decision**, and the reason is
in "What this draft cannot settle" — it proposes a **new terminal state**, which is a published
contract, not an internal detail.

## The item

**OAI-66**, tier 1. Two reconciler diagnoses that contradict the row they are written from.

**(a) A crashed worker is published as a clean `cancelled`.** `job-reconcile.mjs` `terminalizeDead`
tests `row.cancel_requested_at` **first** and returns `finish(… state:'cancelled' …)` with
`failure: null` and `outcome: null`, so it never reaches the `worker-died` branch below it. And
`job-render.mjs` `noteFor` renders **no note at all** for a terminal `cancelled` — the last branch
before the `null` return handles `failed`, not `cancelled`. So the crash is invisible twice over.
Proved with a positive control: the identical abrupt death (a real child SIGKILLed while `running`)
reconciles to `worker-died`/`failed` with no cancel pending, and to `cancelled`/`failure=null` with
one. **The control fires, so the check can distinguish — the verdict is simply decided by the wrong
variable.** It pairs with OAI-62(a), which supplied a very reachable crash.

**(b) `terminalizeUnstarted` blames the submitter for a crash the row disproves.** It writes
*"The process that submitted it most likely died before the worker was spawned. Submit it again."*
**unconditionally** — but `job-spawn.mjs` awaits the OS `'spawn'` event before returning and
`task-submit.mjs` stamps `spawned_at` only after it, so **a non-null `spawned_at` is proof the
submitter survived process creation**. `job-liveness.mjs`'s `spawned_at ?? created_at` collapses the
two windows `adr/014` explicitly distinguishes. Reachable via any throw in the worker's
pre-registration window. *"Submit it again"* then reproduces a systemic failure identically. Note the
sibling `terminalizeDead` names the log; this one does not.

## Why the reconciler cannot be fixed alone

`exitOnCancel` (`job-heartbeat.mjs`) writes `Cancellation requested: exiting without recording an
outcome.` to stderr and calls `process.exit(0)`. **Nothing is recorded**, so no row-level fact
distinguishes a cooperative exit from a SIGKILL. That absence is *why* the inference exists. Removing
the inference without supplying the missing evidence would flip every legitimate cancellation to
`failed`, and `tests/cancel.test.js` asserts the current behaviour.

## The fork, and the consensus that settled it

User away → Codex consensus (thread `019fe0c4-ee5e-7a22-b2bb-afea98dddf90`). Recorded so the attended
session can overturn it knowingly.

**Chosen: Option 1 — the worker terminalizes itself — plus a distinct `cancel-unconfirmed` outcome
for the fallback.** On observing the cancellation the worker calls
`finish(db, seq, { state: 'cancelled', at })` and only then `process.exit(0)`. A clean cancellation
becomes one the worker **acknowledged and recorded**; no schema migration and no compatibility story.

**The reconciler must NOT keep its "pending cancel ⇒ cancelled" fallback.** For a dead, non-terminal
row carrying `cancel_requested_at`, it publishes **`cancel-unconfirmed`** — *cancellation was
requested, but the worker disappeared before acknowledging it*. Without this, a SIGKILL landing before
the self-write still produces the same false clean cancellation, and the fix would be cosmetic.

Rejected:
- **Option 2 (a new `cancel_acked_at` / `exit_reason` column)** does supply the acknowledgement, but
  splits one atomic terminal write into an ack plus a later reconciliation, buys a
  `PRAGMA user_version` bump, a migration story and an older-rows story — **and still leaves an
  ack-to-exit interruption window.** Defensible only if "only reconciliation terminalizes" is a hard
  invariant. It is not: see the invariant note below.
- **Option 3 (corroborate the inference)** cannot prove causation from row data at all. A cancel
  timestamp, a fresh heartbeat and a stderr line can all coexist with a SIGKILL a millisecond later.
  It makes an unsound classification look more sophisticated.

**The `SQLITE_BUSY` edge is material and is part of the design, not an afterthought.** The self-write
uses a bounded retry, and **must not `process.exit()` after an unsuccessful write** — a failed write
means the cancellation was never confirmed, and exiting anyway deliberately manufactures the
unconfirmed path. The cost is extra cancellation latency and, under sustained contention, extra model
work; that is the right trade against publishing a false success. The write also sits **inside a timer
callback**, where per OAI-62 an uncaught throw kills the worker — so it inherits that file's
narrowed-to-busy discipline rather than introducing a bare call.

## FOUR comments this change makes false, and must rewrite

Each states the *old* protocol, and leaving any is the "a doc claims a property the code does not
have" defect `adr/020` exists to remove. The draft said two; the blind round found the other two.

- `job-heartbeat.mjs`: cancellation exits *"without recording an outcome"* — it will now record one.
- `job-reconcile.mjs`: *"`/oai:cancel` never terminalizes anything itself, precisely so that only an
  observed exit produces `cancelled`."* **The invariant survives, restated:** `/oai:cancel` still
  terminalizes nothing. The **worker** terminalizes, after observing the request — which is the most
  direct form of "an observed exit" available, not an exception to it. Reconciliation now handles only
  *absent* confirmation.
- `job-queue.mjs` (above `awaitTurn`): *"`cancelled` is a verdict about the wait, not about the job:
  the worker returns and exits, leaving the row queued with a pid that is about to stop existing, and
  **a later reader is what writes the terminal state**."* Under 1b the worker writes it. This comment
  is the clearest statement of the protocol being replaced, and it is in the file 1b changes.
- `job-record.mjs` (above `requestCancel`): *"this records the request, the worker acts on it, and **a
  later reader observes the exit**."* The first two clauses survive; the third does not.

**And the four are code comments only — `tests/cancel.test.js` carries the same replaced protocol in
prose**, including its file header and the running-worker assertion's comment. Rewrite those in the
same commit. A test file that *passes* while explaining the wrong protocol is the more durable defect
of the two: the next reader trusts it precisely because it is green. **Do not treat this list as
closed** — it has grown from two to four to "four plus the test prose" across three review rounds, so
grep the whole declared file set for the old protocol rather than fixing the named instances.

**1b's placement note above also becomes a comment obligation**: whichever of `awaitTurn` or the
worker's call site takes the write, the *other* one's comment must stop implying it does.

## Proposed phases

**Phase 1 — the worker records its own cancellation, on BOTH of its exit paths.**

**1a, the running worker.** `exitOnCancel` takes the `db` and `seq` that `startHeartbeat` already
holds, writes `finish(db, seq, { state: 'cancelled', at })` under a bounded retry, and exits **only on
a successful write**. On exhaustion it does not exit — the job continues and the next check-in
retries.

**That retry must NOT be `withBusyRetry`, and this is a hard constraint, not a style note.**
`withBusyRetry` sleeps **synchronously** (`Atomics.wait`), so it blocks the event loop for up to its
whole budget. 1a's write happens **inside the heartbeat timer callback while a model request is
live** — and `job-busy.mjs`'s own header excludes exactly this: *"A SEVENTH call site does not inherit
that argument — it is a property of where these six sit, not of this function, and a caller added
inside a live request would freeze it."* Every one of the existing six runs before the model call or
after it has settled. This one would not. Using it here would **freeze the very request the user asked
to stop**, making cancellation slower the more contended the database is — the opposite of the
intent, and a self-inflicted instance of the class OAI-62 exists to close.

So 1a needs a **non-blocking, serialized** retry: attempt the write, and on busy re-attempt on a later
timer tick rather than sleeping inside this one. Serialized because two overlapping ticks must not
both be retrying the same write, and with its failures caught — an uncaught throw in a timer callback
kills the worker (`job-heartbeat.mjs`'s existing narrowed-to-busy discipline exists for that reason and
must be extended over this write, not bypassed). **If a non-blocking retry proves awkward, that is a
design signal, not a licence to fall back to the synchronous one.**

**1b, the QUEUED worker — added at round 1 of the pre-review, and phase 1 was wrong without it.** A
worker cancelled while still waiting **never reaches the heartbeat's cancel path at all**. It exits
through `awaitTurn`: `decide` returns `'cancelled'` on seeing `cancel_requested_at`, `awaitTurn`
propagates it, and `cmd-task-worker.mjs` prints `Job … never ran (cancelled); no request was sent.`
and **returns, recording nothing**. That row has a `waiter_pid` (the worker registered before
waiting), so once the pid dies reconciliation takes `terminalizeDead`, **not**
`terminalizeUnstarted` — which means under phase 2 a perfectly cooperative queued cancellation would
be published as `cancel-unconfirmed`. That is a **regression**, and it also falsifies phase 5's
"exactly one existing assertion changes": the existing queued-cancel test expects `cancelled`.

So the queued path must record `cancelled` itself, with the **same** busy-retry and
do-not-exit-on-an-unsuccessful-write discipline. `finish` guards `state IN ('queued','running')`, so
it is the correct verb for a still-queued row and needs no new SQL. **A queued worker killed before
that acknowledgement is `cancel-unconfirmed`, exactly like the running one** — the two paths differ in
where the write lives, never in what a missing write means.

**But "the same discipline" is not the same code, and round 2 caught why.** 1a can afford to simply
not exit on an exhausted write, because the running worker has a **next check-in**: the heartbeat
fires again in `BEAT_MS` and retries. **The queued worker has no next check-in** — `awaitTurn` has
already returned, and the wait loop it was retrying inside is over. So "do not exit on an unsuccessful
write" is, for 1b alone, insufficient: returning or throwing there lands the row in exactly the
`cancel-unconfirmed` state the acknowledgement exists to avoid. **1b therefore needs its own explicit
retry loop** — catch exhausted busy contention, stay alive, and re-attempt the `finish(… cancelled …)`
write. Bound it (it must not become an unbounded hold on a process the user asked to stop), and state
what happens when the bound is reached: that, and only that, is a legitimate `cancel-unconfirmed`.

**This extends the file list beyond what phase 4 declared** — the queue wait path
(`scripts/lib/job-queue.mjs` and/or `cmd-task-worker.mjs`'s handling of a non-`acquired` verdict) is
now in scope. Whether the write belongs in `awaitTurn` (which knows the verdict first) or at the
worker's call site (which owns exiting) is a real placement choice this draft does not force; the
worker's call site is the weaker coupling and is the suggested default.

**Phase 2 — the reconciler stops guessing, on BOTH of its branches.** `terminalizeDead`'s cancel
branch becomes `cancel-unconfirmed` with a failure report naming what is and is not known, and
`noteFor` gains a branch so the state is never silent.

**`terminalizeUnstarted`'s cancel branch must be conditional too — this reverses a decision this draft
carried as settled for four rounds, on correctness grounds rather than preference.** The draft said
"with no waiter registered, cancellation genuinely prevents any future execution, so that case is not
an unexplained worker death". That is true for *part* of the branch and false for the rest.
`terminalizeUnstarted` covers rows with `waiter_pid IS NULL`, and that set **includes the
pre-registration crash window phase 3 itself identifies**: `spawned_at` non-null proves a worker
process *was* created, and it can then die before `registerWaiter`. If a cancellation was requested in
that window, **no acknowledgement exists** — so publishing a clean `cancelled` there is OAI-66(a)'s
false inference wearing a different function's name.

So:

- **`spawned_at === null`** — keep `cancelled`. **But see the open problem below: this branch's
  justification does not hold as stated, and round 6 refuted it.**
- **`spawned_at !== null`** — publish the chosen `cancel-unconfirmed` representation, with a report
  distinguishing a **pre-registration disappearance** from an acknowledged cancellation. These are
  different facts and the row can tell them apart.

The asymmetry that remains (`spawned_at === null` staying `cancelled`) is deliberate and must be
stated in the code, or a later reader will "consistency"-fix it back.

**Phase 3 — (b), the misattributed hint.** Make `terminalizeUnstarted`'s hint conditional on
`spawned_at`: non-null ⇒ the submitter survived process creation and the worker died in its
pre-registration window, so name the job log as `terminalizeDead` does; null ⇒ the existing text is
correct. **Independent of phases 1–2 and shippable alone** if the new state is refused.

**Phase 4 — the new state's full surface.** `cancel-unconfirmed` is **not** a local addition:
`TERMINAL_STATES` (`job-record.mjs:17`) feeds `isTerminal`, `job-retention.mjs`'s delete predicate,
and `tests/plugin.test.js`, which pins the delegate's polled status line against that array **and by
running the agent's own `awk` expression**. `agents/oai-delegate.md` must be checked against it. Adding
a member without walking all four is how the delegate silently stops recognising a terminal job and
polls forever.

**`scripts/lib/job-view.mjs` belongs in that list and was missing** — it is the *producer* of the
`view.display` value `job-render.mjs`'s `noteFor` branches on, and the value `tests/plugin.test.js`
constructs via `viewOf`. Checked against disk, the news is good and should be stated rather than
assumed: `displayOf` opens with `if (isTerminal(row.state)) return row.state;`, so **a state added to
`TERMINAL_STATES` passes straight through to `display` unchanged**, and phase 2's note branch is
reachable. Under the envelope alternative it is *not* reachable the same way — display would be
`failed`, and the note must key on the failure's `reason` instead. **The two branches of the open fork
need different render code**, which is one more reason the fork cannot be left to the build.

**Phase 5 — tests, each with a control.** Cancel then SIGKILL the real child *before* its
cancellation write, reconcile, assert `cancel-unconfirmed` **and a rendered note** — with a positive
control proving the same scenario yields `cancelled` when the worker *is* allowed to write. Assert the
busy-exhaustion path does **not** exit. **Run the paired control on the queued path too** (1b): a
queued worker that acknowledges → `cancelled`; a queued worker killed before it can → 
`cancel-unconfirmed`. Without that pair, 1b's regression is exactly the kind a suite passes over.

**Exactly one existing assertion in `tests/cancel.test.js` changes** — the running-worker test's
post-exit row becomes `cancelled` rather than `running`. The queued test already expects `cancelled`
and still gets it; what changes is **which mechanism supplies it**. That is a test that would pass
either way, so it proves nothing as written: **move or duplicate its observation to before
reconciliation runs**, so it witnesses the worker's own write rather than the reconciler's inference.
(This draft said "two assertions change" for one round; that was wrong — the queued expectation is
unchanged, and the work there is making an already-passing assertion capable of failing.)
**If a second existing expectation needs changing, that is a signal the design drifted — stop and
re-challenge**, rather than editing tests until they pass.

**Plus the pre-registration pair required by phase 2's second branch:** request a cancellation while
the row has `spawned_at` non-null and `waiter_pid` still NULL, kill the worker before it registers,
reconcile, and assert the `cancel-unconfirmed` representation with a report naming pre-registration
disappearance — **with the existing never-spawned cancellation test as its control**, which stays
valid unchanged and is what proves the new branch is conditional rather than blanket.

## What this draft cannot settle, and why an attended session is genuinely required

**A new terminal state is a published contract.** `--json` consumers, `/oai:status`, `/oai:result` and
the delegate agent all read it, and **an older build reading `cancel-unconfirmed` does not have it in
`TERMINAL_STATES`, so `isTerminal` returns false and that build may try to reconcile a row that is
already finished** — the exact cross-version hazard the two-version design exists to prevent, arriving
through the *state* column rather than through `user_version` or `schema_version`. This draft does
**not** decide whether that warrants a `user_version` bump, and it should not: it is precisely the
"migration story for persisted state" fork the repo's own grilling checklist reserves for the user.

**Round 3 sharpened this from a deferred preference into a blocker, and the draft accepts that
reading.** The row stays a *known version*, so an older build reaches `reconcile()` on it, fails
`isTerminal`, and **may overwrite a terminal row** — which is a correctness defect, not a matter of
taste in output. So the fork has exactly three admissible resolutions and **the build may not start
until one is chosen**:

1. **The envelope** — `cancel-unconfirmed` as a `reason` inside the existing `failed` state. No new
   member, no fence, no cross-version hazard. `noteFor` keys on the reason. Simplest, and Codex has
   twice called it the materially simpler contract.
2. **The state plus a `user_version` bump** — the fence the two-version design already provides,
   paid for with a migration story.
3. **The state plus an explicitly specified fence** other than a bump — permissible only if what
   stops an older build mutating the row is written down and tested, not argued.

**"Leave it to the attended session" is the right call for *which*; it is not a licence to build
before one is picked.**

Codex's own fallback is on the record and is the cheaper branch if that hazard is judged too
expensive: **carry `cancel-unconfirmed` as a `reason` inside the existing `failed` envelope** rather
than as a new state. It is less clear in status output and it is strictly less invasive. **Neither
branch may be chosen unattended.**

Also out of scope: OAI-64 (the blocker `/oai:status` cannot show), OAI-69 (recycled pids), and
OAI-105 (the reconciler's writes having no contention answer) — the last is adjacent enough that
phase 1's bounded retry should be checked against it, but it is not closed here.

## THE OPEN PROBLEM this draft ends on — unresolved, and named rather than papered over

**Round 6 refuted the `spawned_at` split it had just accepted at round 5, and the refutation is
sound.** Two facts, both checkable against the declared file set:

1. **`spawned_at === null` does not prove no worker was spawned.** The OS spawn completes (the
   `'spawn'` event) *before* `markSpawned` writes the stamp. A child can therefore be created, die
   before registering, and leave **both `spawned_at` and `waiter_pid` NULL** — indistinguishable, in
   the row, from a job whose worker never existed. Publishing a clean `cancelled` there retains
   exactly the false inference OAI-66 exists to remove. **OAI-67 widens this window rather than
   narrowing it**: its `markSpawned` busy-exhaustion path deliberately returns the id and warns,
   leaving `spawned_at` NULL while a worker is genuinely running.
2. **`spawned_at !== null` does not prove the worker died, either.** No pre-registration pid is
   recorded anywhere in these interfaces, so `terminalizeUnstarted` can prove only *"spawned, and
   never registered by the grace deadline"* — not that anything disappeared. Its report and its test
   must state that **bounded** fact and no more.

**This draft does not resolve it, and inventing a resolution here would be the same overreach the
item is about.** The shape of the answer is one of: record a pre-registration signal (which is
Option 2 returning through the back door, with its migration cost); accept a deliberately weaker,
honestly-worded outcome for the whole pre-stamp window; or narrow the window structurally so the
ambiguity cannot arise. **Each is a design decision with a cost, and none is available unattended.**

**Consequence for the resuming session: this plan is NOT implementable as it stands.** The state /
envelope fork was already a build blocker; this is a second, independent one. Both must be answered
before any code.

## Codex pre-review of this draft

**A verdict attaches to the exact bytes challenged and expires on amendment.**

| Round | Form | Digest | Thread | Verdict |
| --- | --- | --- | --- | --- |
| Fork | design consensus | — | `019fe0c4-ee5e-7a22-b2bb-afea98dddf90` | Option 1 + `cancel-unconfirmed` |
| 1 | threaded | `96613fab1ae4` | `019fe0c8-3901-7a70-9db1-8001477f0449` | CHANGES-REQUIRED |
| 2 | threaded | `1727ef7d386e` | `019fe0ca-df00-7903-b5ed-4a011a5cac15` | CHANGES-REQUIRED |
| 3 | **blind** | `b8045494bdfc` | `019fe0cd-2bb5-70b0-86e2-4e7584ec2890` | CHANGES-REQUIRED |
| 4 | threaded | `68c3126a294e` | `019fe0d0-0062-7eb2-961f-aa720fedf838` | CHANGES-REQUIRED |
| 5 | threaded | `a7b7c3904b10` | `019fe0d1-c9d6-75f1-bae6-ff928cbc5669` | CHANGES-REQUIRED |
| 6 | threaded | `63d65dfc6866` | `019fe0d4-23e8-7ed0-8a16-486abaf3e525` | **CHANGES-REQUIRED** |

**Final state: NOT approved, and that is the honest outcome rather than a failure of the run.** Six
rounds, a real defect at every one, and the episode was stopped at the round-6 cost-warning point
rather than at the ten-round cap — because the item is blocked on the absent owner either way, so
further rounds would buy polish on a draft nobody may build from.

**Round 6's finding is folded in as an open problem, not as an amendment**, so no round-7 verdict is
owed: the draft's closing claim is now *"here is what remains undecided"*, which is what it can
support. The blind round (3) found more than either threaded round adjacent to it — worth knowing
when the attended session budgets its own gate.

**Two things this draft got wrong and later fixed, recorded because both are this repo's signature
defect:** it carried "terminalizeUnstarted keeps `cancelled`" as *settled* for four rounds when it was
a correctness bug; and phase 1a specified `withBusyRetry` inside a live request **after this same run
had quoted that helper's own prohibition against exactly that in the OAI-67 draft**.
