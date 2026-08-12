ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug expressive-coalescing-quokka

# OAI-67 — a spawn failure must not hold the queue, and housekeeping must not sink a live submission

## Context

Two independent defects in `scripts/lib/task-submit.mjs`, both verified against the current tree this
session (Codex claim-check: 4 of 4 TRUE).

**(a) A REJECTED SPAWN stalls every later job.** `spawnAndStamp` awaits `spawnWorker(seq)` at
`task-submit.mjs:110-111` with **no `try`/`catch`**. On rejection the row inserted at `:189` stays
`queued` with `spawned_at` NULL and nothing marks it failed. `livenessOf` classifies that row
`starting`, `queuedRole` maps `starting` to `blocks`, and `decide` returns `blocked` to a *different,
later* job. The bound is `STARTUP_GRACE_MS = 120_000` at `job-liveness.mjs:20` — after two minutes the
row becomes `never-started` and is skipped. **So the harm is a two-minute stall of the whole queue —
not a permanent wedge.**

**Not "a job that will never run", which is what this section said before decision 4 was understood.**
Usually no child exists and the job indeed never runs. But a rejection can also arrive *after* a
child was created, and that child may be running perfectly well — in which case the row is stalling
the queue on behalf of a job that does not need rescuing, and if it registers, the block ends there
rather than running the full two minutes. Should it never register, the grace expires and the row is
marked `never-started`, which may be false about it. The stall is the defect in every case; the
certainty about *why*, and about how long, is not available here.

**(b) Housekeeping can sink a live submission.** `sweepQuietly` (`:94`) suppresses busy errors and
**rethrows everything else, by design** — its comment argues a silent retention failure would grow the
store unbounded. It is called at `:197`, *after* `spawnAndStamp` returned at `:191`. So a non-busy
sweep failure rejects `submitTask` when a detached worker has already been created and is expected to
call a paid model, and the id is never printed, so a reasonable retry CAN duplicate the spend.
*Expected* and *can*, because only creation is established — the worker may have died already, and
this process watched nothing after the `'spawn'` event.

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
2. **A rejected spawn terminalizes its own row IF that row is still nobody's**, then rethrows the
   spawn error. Re-decided knowingly rather than inherited from the unattended draft's Codex
   consensus. The conditional half is not a hedge: `abandonUnstarted` may correctly return `false`
   because a worker registered first, and on that path terminalizing would be the wrong thing to do,
   not a failure to do the right one.
3. **The test seam is an injectable `spawn`, defaulted** (option A). Codex and I both recommended it.
   Fabricating row shapes was rejected because nothing would prove `spawnAndStamp` produces them; an
   overridable worker path in `job-spawn.mjs` was rejected because it ships a runtime executable-path
   override the product does not need.

**Accepted caveat, stated rather than engineered around:** if the terminal write's busy retry
exhausts, the submission still rejects and **the row is left exactly as it was** — because the
database refused the write, not because the spawn outcome was unknown. Where that row is an
unregistered queued one, this degrades to today's behaviour and the grace terminalizes it, which is
the correct fallback. Where a worker registered first, the row was never ours to write and the job
is left to that worker's own lifecycle. The caveat is about the write being refused; it does not
license a claim about
which of those two the row is.

4. **A post-spawn cleanup failure is CONTAINED here, and fixed at the root as its own feature**
   (decided with the user, mid-build episode). `spawnWorker` awaits the `'spawn'` event and then runs
   `closeSync(log)` in a `finally`, so a throw there rejects after a detached child was created and may
   still be running. This
   plan makes that rejection harmless rather than repairing the spawn contract; changing
   `job-spawn.mjs` — the repo's only launcher of a process meant to outlive its parent, whose header
   says every line is load-bearing — is beyond what the finding requires and is a `widening`. It gets
   its own backlog item. **`job-spawn.mjs` therefore stays OUT of this plan's touched-file list.**
   Codex recommended fixing the root here; the user chose containment.

## Provenance of the mid-build changes

The pre-build approval covered a design that `codex-adversarial` found defects in, and that
successive mid-build gate rounds found more in. **The round-by-round history and the count live in
the ledger at `scratchpad/ledger-oai-67.md`, and deliberately NOT here.** A running total written into
this file was wrong twice — once caught by the gate, and once reproduced by the very edit that fixed
it, because a count restated in prose is stale the moment the next round lands. The claim is what was
wrong, not the number (`adr/066`). **They are folded
into the phases they change rather than kept as an amendment log**: the log was itself generating
findings — several were contradictions between an amendment and the phase it amended, which is a
defect of having the same instruction in two places. Each phase below now states one instruction
and the evidence for it. The ledger at `scratchpad/ledger-oai-67.md` keeps the round-by-round
history.

**The tracker item's own title — "a spawn failure must not hold the queue" — is left alone
deliberately.** It names the backlog item and the file, both of which predate the finding, and
renaming would orphan the harness-slug provenance and the `.approved/` archive beside it. It is not
an instruction to any code path, and every instruction below has been corrected.

**MOST OF THEM WERE ONE CLAIM, and it is the thing to hold while implementing: this change kept
asserting that no worker exists, on a path that cannot establish it.** It has been found in the verb
(`finish`), in the mandated safety argument for `job-busy.mjs`, in the persisted `reason` and message
(with the docstring and phase title that echoed them), in the too-narrow invariant claimed for the
ignored boolean, and in the exhaustion commentary's "the row stays queued". Each was fixed where it
was cited and the next round found it somewhere else — which is `adr/066` exactly: **before adding an
instance, grep for the claim.** The independent ones were the discarded storage fault, the report able
to replace its own rethrow, the divergent file lists, and a verification step that could not fail.

## Touched-file inventory

The one canonical list. Every other reference in this plan points HERE rather than restating it —
the ADR section and the scope handed to a reviewer disagreed about `adr/014`, and two lists is how
that happens.

- `scripts/lib/task-submit.mjs` — phases 1, 2, 4.
- `scripts/lib/job-busy.mjs` — phase 3 (count, and the seventh site's own safety argument).
- `adr/020-a-contended-database-must-not-kill-live-work.md` — phase 3. **No count is given, and that
  is deliberate: the bullets below ARE the list.** A count here was wrong the first time it was
  written and wrong again after the next edit — the same defect this feature spent nine gate rounds
  on, one level up. Claims this change makes stale: the
  greppable count sentence at `:13` (the only one the guard reads), the taxonomy paragraph at
  `:118-124` which restates the count in prose and omits the new site's exhaustion policy (it belongs
  to the **convert** group), the lettered enumeration at `:62`, the universal witness claim at `:266`
  which needs a new **evidence-table row** for the seventh site, and the "two sites on reasoning
  alone" count at `:322`.

  **Three more are PRE-EXISTING falsehoods, authorised deliberately by the user rather than absorbed
  silently** — `adr/056` calls an unauthorised enlargement a `widening` and sends it to the user, and
  each of these was made in response to a reviewer finding, which is precisely the push that rule
  exists to check. The spawn-stamp discussion at `:45` and `:155` said a detached worker "already
  exists and is about to make a billable call" and "is already running and spending money"; both were
  false before this feature, for the same reason its own text was — the `'spawn'` event establishes
  creation only. The overshoot limit at `:357` enumerated "the three terminal writes and the spawn
  stamp", which already omitted the registration (f) when it was written, so it is restated as a rule
  — every retried site except `openStore` — rather than as a list that would need extending again.
  Reverting them would have restored three sentences into an ADR this commit is already editing.

  Pre-existing and authorised on the same footing: the **"reddens exactly one named test"** claim in
  the Evidence preamble (`:266`). It was false of every `unwrap` row from the day the table was
  written, which this feature MEASURED rather than argued — unwrapping the existing site (f) reddens
  its own witness and the structural count guard, 800 pass / 2 fail, restored to 802 / 0. It is
  qualified once for all sites rather than excepted for the new one. Listed here because the
  inventory is canonical, and phase 3 naming it was not the same as this section authorising it.
- `tests/job-spawn-failure.test.js` — phase 5, the QUEUE-level witnesses: the no-child case, its
  pre-fix positive control, and the sweep ordering.
- `tests/job-launch-outcome.test.js` — **NEW**, phase 5, the ROW-level witnesses: the already-claimed
  row, its `finish` control, the transient busy, the throwing report, the failing terminal write, and
  the real-subprocess witness that the DEFAULT reporter reaches fd 2 — the last added mid-build to
  close a gap a reviewer measured rather than argued.
  Split when the original crossed the 300-line budget, along the subject rather than the line count —
  one file is about the queue not being held, the other about which verb may write the row and what
  happens when that write or its report fails.
- **`adr/014-async-jobs.md` — IN, for BOTH defaulted seams** (the injectable `spawn`, and the
  `report` the failing-report witness needs) **and for the submitter's half of the publication-versus-
  spawn boundary.** Confirmed as the right home by reading it: its section *"The one boundary SQLite
  does not cover: publication versus spawn"* already documents the same guarded `UPDATE`, so this
  change extends an argument that lives there rather than starting one.
- `scripts/lib/job-record.mjs` — **READ ONLY**, for `abandonUnstarted`. Listed so a reviewer's scope
  includes it; it is not edited.
- `scripts/lib/job-launch-outcome.mjs` — **NEW, and phase 2 lands HERE rather than in
  `task-submit.mjs`.** `terminalizeSpawnFailure` moved out when `task-submit.mjs` reached 307 lines
  against its 300-line budget. It is a real seam rather than a line-count dodge: the constraint that
  took this feature nine gate rounds to pin down — that this code holds strictly less knowledge than
  its call site suggests — is stated in the module header, where the next reader meets it before the
  code. `task-submit.mjs` keeps phases 1 and 4.
- **OUT: `scripts/lib/job-spawn.mjs`** — decision 4. The root fix is OAI-145.

## Change

**Phase 1 — the seam.** `submitTask` gains a second parameter: `{ spawn = spawnWorker } = {}`,
threaded to `spawnAndStamp`. Default preserves every existing caller; no call site changes.

**Phase 2 — an unconfirmed launch terminalizes its own row, if that row is still nobody's.** Wrap
the `await spawn(seq)` call. On rejection, write the row terminal and rethrow **the spawn error**.
(The phase was titled "a spawn failure terminalizes its own row" and that title asserted the same
unestablishable thing as the payload did.) The verb is **`abandonUnstarted`**
(`job-record.mjs:225`) and needs no new SQL — its `WHERE seq = ? AND state = 'queued' AND waiter_pid
IS NULL` is exactly the compare-and-set this path needs, and its docstring already argues this race:
*"without it, a reconciler that decided 'never started' a microsecond before the worker finally
registered would fail a job that is alive and about to run."*

**`finish` was the originally approved verb and is WRONG** — its `WHERE state IN ('queued','running')` is
deliberately permissive so a terminal verdict can land on a live job, which is right for a worker
publishing its own outcome and wrong for a submitter guessing that no worker exists. With
`abandonUnstarted` the two orderings are both safe and neither is a lie: if the child registered
first the write matches nothing and the row is left to that worker — which is not a promise that it
publishes, only that this process did not prevent it; if the write lands first the child
finds a terminal row and stops before spending. It does not null `worker_pid`, and does not need to —
a row it matches has none.

Its boolean return is **deliberately ignored**, and the comment must state the invariant at its real
width: `false` means **the row is no longer an unregistered queued row** — it may have a waiter, be
running, be terminal, or be gone. It does **not** mean "a worker registered", which is only the most
likely of those. In every one of them the row is not ours to terminalize, so `false` is a correct
outcome and not an error. Saying the narrow thing invites the next reader to "fix" it into a throw on
the cases it failed to name.

**The persisted payload must not assert more than this path can establish.** It follows
`job-queue.mjs`'s `timeOut` (`:123`), the existing precedent for a *diagnosed* terminal write, rather
than a bare `errorReport(error)` which yields `reason: null` — a value this repo reserves for "nothing
was determined". Something here *is* determined. But **`spawn-failed` and "could not start a worker
process" are not it**: in the very ordering this design admits — a post-`'spawn'` cleanup throw, with
the CAS winning the race — a worker process **did** start, and the row would carry a false diagnosis.
That is the same untrue claim the verb and the safety argument carried, persisted to the database
where it outlives the session and is what `/oai:status` shows a user.

What is true on **every** path reaching here is that the submitter could not complete or confirm the
launch. The payload says exactly that and no more:

```js
const failure = errorReport({
  reason: 'worker-launch-unconfirmed',
  message: 'Job ' + job.id + ' could not complete or confirm the launch of a worker process: ' + error.message,
  hint: '<actionable text>',
});
```
(shown with concatenation rather than a template literal only so this file carries no shell
expansion; the build uses a template literal, matching the surrounding code.)

The umbrella is honest rather than vague: it covers both the common case (no child was created) and
the admitted rare one (a child exists and the CAS beat it), and the underlying `error.message` still
names what actually went wrong. **The surrounding commentary changes with it** — the docstring
currently opens *"A spawn that never happened, written down as such"*, which asserts precisely the
thing that cannot be established, and the `hint` must not tell a user to check that node is on PATH
as though the launch certainly failed. `adr/012`'s distinction is the one to follow: name the shape
observed, never the cause inferred.

`errorReport` is imported from `./review-report.mjs`, as `job-queue.mjs:16` already does. **Confirmed
still exported at `review-report.mjs:200`** despite OAI-139 restructuring that file this morning.

**The exhaustion catch must not add an `isBusy` site, and must not DISCARD.** Wrap the
`withBusyRetry(() => abandonUnstarted(…))` in a bare `try`/`catch` so the spawn error stays the one
that propagates — the user learns why the launch could not be completed or confirmed, not why the
database was locked. It still
does not test `isBusy`: which storage fault occurred does not change what a reader needs, which is
the reason `adr/020` gives for the identical decision at the worker's `failed` write.

But the caught error is **reported, not dropped** — one line on stderr naming it as a storage failure
that prevented **this attempt to record the outcome**, following that same precedent ("the storage one
by message, the diagnosis by propagating"). Not "prevented the row being marked failed": if a worker
registered first, the CAS would not have marked it anyway, so that wording credits the storage fault
with blocking something that was never going to happen.

**The report itself must not be able to escape.** A throw raised inside a `catch` **replaces the
pending rethrow** — the precise defect `adr/020:135-139` records at the worker's `failed` write, where
an exhausted busy escaped as `database is locked` and the `throw error` beneath it never ran. A
failing write (EPIPE, EBADF) would reproduce it exactly here, substituting a write error for the spawn
error the whole path exists to deliver. So the report is itself wrapped, and a failure to report is
the one thing that IS silently dropped: at that point nothing can be told to anyone, and the spawn
error is still the most useful fact available.

**And it is written with `writeSync(2, …)`, not `process.stderr.write`.** This is a drainage
requirement, not a style choice. The rethrown spawn error reaches `oai-companion.mjs:30-37`, which
writes and then calls `process.exit(2)` — and `adr/019` already records for this repo that
**`process.exit(2)` discards undrained stderr**, which is why `noteEndpointPersistence()` is placed
where nothing can crowd it out. On **darwin**, which is where this runs, `process.stderr` to a **pipe
is asynchronous**, and a pipe is exactly what `runCompanion` and any capturing caller — a pipeline, a
subagent harness, `$(…)` — give it. **Not every redirect**: `2>file` is a regular file, which is
synchronous on POSIX, so the loss is specific to captured stderr rather than universal. That is the
configuration the tests and the delegation path actually use. So the
report line would be queued and then thrown away by the exit — a fix with no observable effect, on the
one path it exists for. `writeSync` removes the question by construction rather than asserting the
race goes the right way.

**Two limits were claimed here as one; ONE has since been closed and the other cannot be, and they must
not be described together.**

**Closed:** that injecting `report` never exercises the production default. A reviewer showed the gap
was real by measuring it — replacing `reportToStderr` with a no-op left every assertion green. A sixth
witness now spawns a REAL child process with stderr on a PIPE, calls `terminalizeSpawnFailure` with NO
`report` option and a throwing `db`, and asserts the message reaches fd 2. The no-op mutation reddens
it.

**NOT closed, and not closable by observation:** that the write survives `process.exit(2)`. Swapping
`writeSync` for an async `process.stderr.write` leaves that subprocess test GREEN — measured — because
the write happens to survive on that run. That is precisely the timing-dependence which makes
`writeSync` the right call and makes the race unobservable. **So the synchronous write rests on
`adr/019` and on Node's guarantee, never on a test**, and neither the test's name, nor its assertion
messages, nor this plan may claim it survives the exit (`adr/019`'s own shape: say what the check does
not establish).

**What the discard would have cost, stated without the false half.** The approved plan's blanket
discard would erase a corrupt database, a schema mismatch or a disk-full condition — leaving no
evidence anywhere of why the outcome was not recorded. It would *also* often leave a queue-blocking
row, but not always, and the evidence loss is the part that is true on every path: whatever the row
turns out to be, the operator is left with a submission that failed for one reason and a storage
layer that failed for another, and only the first is visible. **`error.cause` is not the channel** —
`oai-companion.mjs` prints `error.stack`, which does not render a cause, so it would preserve the
fault somewhere nobody reads.

**What an exhausted write leaves behind is a row UNTOUCHED, which is not the same as a row left
`queued`** — saying the latter is another appearance of the recurring claim the provenance section
warns about. The write failed, so whatever the row was, it still is. If it was
an unregistered queued row, it ages out through the startup grace, which is the accepted caveat above
and the correct fallback. But on the admitted live-child path the child may register and run perfectly
well once this write has failed, and the row may equally be terminal already or gone. The commentary
in `terminalizeSpawnFailure` states the untouched-row fact and lets the outcomes follow from it,
rather than asserting one of them. Unchanged by the reporting rule above, which is about the evidence,
not the fallback.

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

**`adr/020` carries three MORE exhaustive claims that this change makes stale, and the greppable
count sentence is only the one the guard reads.** Found at gate round 6, and it is the same class as
the taxonomy paragraph: a claim restated where nothing holds it to the code.

- **`:62`** — *"Retry, at the three terminal writes (b), the spawn stamp (e) and the registration
  (f)"* enumerates the retried sites by their lettered labels and omits the new one. Extend the
  enumeration with the next label, in the same style, and say what work it exists to avoid losing:
  not a reply and not a process, but **the record of an outcome nobody else will write** — the
  submitter is the only party that knows this launch could not be confirmed.
- **`:266`** — *"Each guarded site has a witness that drives a path where a busy error is really
  raised"* is a **universal** claim, and the tests specified in phase 5 inject only NON-busy failures
  (`SQLITE_CORRUPT`, EPIPE). Adding a seventh retried site with no busy-path witness would falsify
  the table's own stated property, which is precisely the shape this ADR exists to remove. **So the
  witness is added rather than the claim weakened** — see phase 5.
- **`:266` again, and this one is a PRE-EXISTING FALSEHOOD this change merely exposes.** The same
  sentence claims each site "was proved load-bearing by a mutation that reddens **exactly one** named
  test", with one stated exception (the diagnosis pair). That is **already untrue of every `unwrap`
  row in the table**, because removing any `withBusyRetry(` occurrence also drops the count the
  structural guard reads. **Measured, not argued** (2026-08-12): unwrapping the existing site (f)
  `registerWaiter` reddens *two* tests — its own witness `a busy while REGISTERING as the waiter does
  not silently lose the job`, and `every stated count of contention sites matches the code` — 800
  pass / 2 fail, restored to 802/802 on revert. So the seventh site must NOT be given an exception of
  its own: that would repeat the mistake of fixing the instance. **The claim is qualified once, for
  all sites** — the exactly-one property is about the *behavioural* witnesses, and the structural
  count guard reddens for every site by construction, being a guard on the enumeration rather than on
  any one site's behaviour. `busy-site-count.test.js` and `adr/020` landed in the same commit
  (`77c1eab`), so this has been true since the table was written.
- **`:322`** — *"Two of the retried sites were wrapped on reasoning alone"* becomes **three**, and the
  new site is named there with its reasoning: it is wrapped because of what its failure costs (an
  unrecorded outcome, and a queue stalled behind an unregistered row), not because contention was
  observed. `adr/020` is careful to say *"No production instance of either throw has been seen"*, and
  that stays true of this one too — the sentence must keep saying so rather than quietly implying
  evidence this site does not have.

`job-busy.mjs:85-91` warns that *"A SEVENTH call site does not inherit that argument — it is a property
of where these six sit, not of this function."* **The new site's safety must be argued on its own
terms, in that comment.**

**The argument this plan originally mandated is FALSE, and is replaced.** It read: *"it runs in
the submitter, after the child has failed to launch, so no model call exists and no request is in
flight."* The `abandonUnstarted` change exists precisely because a rejection does **not** establish that the child failed to
launch — a post-`'spawn'` cleanup throw rejects after a detached worker was created and may still be
real model call. The old argument and decision 4 contradict each other, and the plan's own clause —
*if that argument cannot be made honestly the phase fails* — is what forces this rather than a
re-wording.

The honest argument, which does not depend on whether a child exists: **the synchronous sleep blocks
the SUBMITTER and nothing else.** Any worker that does exist is a DETACHED process with its own event
loop, reaching the database independently, and this process cannot suspend it by blocking itself. So
the sleep can delay only this submission's own failure report — never a request in flight, because
the only in-flight request possible here belongs to a process this one has no way to reach. That is a
property of **where this site sits**, argued without assuming the spawn outcome, which is what
`job-busy.mjs:85-91` demands.

**It must NOT be argued from descriptors.** An earlier draft added that the worker "holds no
descriptor this process owns", citing `['ignore', log, log]`. That is false on precisely the path in
question: the rejection that reaches this site can BE a failing close of the submitter's own copy of
the log descriptor, so the state of that copy is the one thing unresolved. Process independence
carries the argument alone, and the extra clause only reintroduced the assumption the argument exists
to avoid.

**Phase 4 — move the sweep.** Relocate `sweepQuietly(db)` to before `insertJob`. Amend both its
docstring and `submitTask`'s inline justification at `:193-196`, which currently argue the *old*
position; the reasoning survives the move and the sentences must say so rather than point at an
ordering that no longer holds. `job-busy.mjs:52-58` and `task-submit.mjs:120-122` both state that
`insertJob` is *deliberately* not busy-wrapped because it precedes the spawn — **that stays true** and
must not be disturbed.

**Phase 5 — tests.**

**Tests the originally approved plan lacked — the bullets below are the list, and no count is given
here for the reason this plan has already learned twice. The first two defects existed because its tests could not see the
defects: every one of them rejects without a child ever existing, and none exercises a failing
terminal write. A fix whose witness is the same blind fixture is not witnessed.**

- **A rejection against an ALREADY-CLAIMED ROW must not terminalize it.** This is a state-machine
  witness and the plan says so, because the built test has no second process and could not have one:
  a real detached child racing a real failing `closeSync` is not schedulable, while the row shape it
  leaves behind is, and the row shape is what the compare-and-set reads. The injected
  `spawn` registers a waiter for the row (`registerWaiter`, as `successorVerdict` already does) and
  *then* rejects, which is the observable shape of a post-`'spawn'` `closeSync` throw. Assert the row
  is **not** `failed` and its `waiter_pid` survives, and that the spawn error still reaches the
  caller. **Positive control in the same run**: a row of the same shape, under `finish`, must go
  `failed`.

  **What that control does and does not establish, stated here because an earlier version of this
  bullet claimed the larger thing and was corrected only in the test comment.** It establishes that
  the row shape is REACHABLE and destructible — that `not failed` is a property of the verb rather
  than an artifact of a fixture no write could ever have matched. It does **not** make the test above
  capable of failing against a build that simply stopped calling `terminalizeSpawnFailure`: the
  control inserts a synthetic row and calls `finish` directly rather than driving `submitTask`, so
  both would stay green. **Measured, not reasoned**: with `terminalizeSpawnFailure` never called, this
  test and its control both remain green while other tests in the file redden. That mutation is caught
  by the no-child test instead, which requires the row to BE `failed` — the two bracket it, one saying
  the write happens and the other saying it is guarded.

  Folded back into the phase rather than left in the test comment alone, which is what this plan's own
  provenance discipline requires and what the first correction failed to do.
- **A non-busy terminal-write failure is reported, not erased.** Inject a failing
  `abandonUnstarted` (a `prepare` throwing `SQLITE_CORRUPT`, the pattern test 2 below already uses)
  under a rejecting spawn. Assert the **spawn** error is what rejects, and that the storage fault is
  named on stderr. The stderr half is the whole point: asserting only the rejection passes against
  the blanket discard the approved plan specified.
- **A BUSY THAT THE RETRY SURVIVES — the seventh site's busy-path witness**, required by
  `adr/020:266`'s universal claim and by the point of wrapping the call at all. Inject a **transient**
  busy on the terminal write: raise `SQLITE_BUSY` on the first attempt or two and then let it succeed,
  under a rejecting spawn. Assert the row **IS** marked terminal — the retry did its job — and that
  the spawn error still rejects. **Mutation, proving it load-bearing and giving the evidence row its
  "reddens exactly one named test" property:** remove the `withBusyRetry` wrapper (leaving the bare
  call) and this test must redden. **Two tests will redden, not one** — this witness and the
  structural count guard — which is the corrected exactly-one property above, not an exception
  carved for this site. Without this the seventh site is wrapped on an argument no
  test can contradict, which is what `adr/020:322`'s "on reasoning alone" is confessing about the
  other two — and confessing it is only honest while the table's universal witness claim still holds.
- **A REPORT THAT THROWS must not replace the error it was reporting alongside.** The "must not
  escape" wrapper is otherwise unevidenced. No other test **asserts what the report produced**: most
  never reach the reporting path because their storage write succeeds, and the integrated
  failing-write witness does reach it but deliberately does not capture fd 2. Either way, deleting the
  wrapper leaves them all green, which makes it a safeguard with no witness. Make the
  report itself throw (stub `writeSync` to raise EPIPE) under a failing terminal write and a
  rejecting spawn, and assert the **launch-path error** is still what rejects. This is the shape
  `adr/020:135-139` records going wrong once already: a throw raised inside a `catch` replaces the
  pending rethrow, and the diagnosis ends up in no channel at all.

  **The mechanism this plan first specified — "stub `writeSync` to raise EPIPE" — is IMPOSSIBLE, and
  was found so by building it.** `writeSync` is an ESM *named import*, bound at instantiation, so
  patching `node:fs` from a test does not reach the binding the module calls. Measured rather than
  reasoned: a probe patched `require('node:fs').writeSync`, called the real function, and the stub was
  never entered while the genuine write went out. So the witness takes **the seam this plan already
  blesses for exactly this problem** — a defaulted parameter, as `submitTask`'s `spawn` is —
  `terminalizeSpawnFailure(db, seq, job, error, { report = reportToStderr } = {})`. Production callers
  pass nothing and are unchanged.

  **The witness is therefore MODULAR, not end-to-end, and the plan says so rather than leaving the
  built test to differ from it.** It calls `terminalizeSpawnFailure` directly with a `db` whose
  `prepare` throws and a `report` that throws, and asserts the call **does not throw** — since the
  caller is what rethrows the launch error, anything escaping here arrives in its place. Driving it
  through a rejecting `submitTask` would add a server, a config and a spawn to a test about one
  `catch`. It is paired with a control in the same test: with a working `report`, the storage fault
  IS named, so the no-throw assertion cannot pass merely because nothing was ever reported. Without it the wrapper is a safeguard nothing can catch being
  deleted, which is the state a reviewer called out and this witness exists to end.

1. **A rejected spawn with no child marks its own row `failed` and does not block a successor.** This
   is the COMMON case, named as such rather than as the only one. Drive `submitTask`
   in-process with a rejecting `spawn` (the pattern `tests/job-busy-spawn.test.js` already uses).
   Assert the row is `failed` with a non-null failure, and that a *second* queued job acquires rather
   than blocks. **Positive control in the same run**: the pre-fix shape — a `queued` row with
   `waiter_pid` NULL inside the grace, via `insertSynthetic` (`tests/job-helpers.mjs:119-143`) — must
   return `blocked` under the same assertion.

   **Not because the test cannot otherwise fail** — it can, and does: removing
   `terminalizeSpawnFailure` reddens it directly on the `failed` assertion, measured. The control
   carries the weaker half, the SUCCESSOR assertion, where `acquired` is equally what an empty queue
   or a deleted row returns. Stated exactly, because the first version of this bullet claimed the
   stronger thing and an independent reviewer disproved it by experiment.
2. **A non-busy sweep failure rejects before anything exists.** Assert `submitTask` rejects, **no
   worker was spawned**, and **no row was left `queued`** — then that a successor acquires. The orphan
   half is the assertion that would have caught the unattended draft's own first-draft defect;
   asserting only the rejection would pass against the pre-fix code too.
3. **`tests/busy-site-count.test.js`'s red/green ordering is NO LONGER AVAILABLE, and pretending
   otherwise would be a check that cannot fail.** The originally approved plan asked for it as free
   evidence the guard is not inert, and that was sound *then*: the build had not yet added the
   seventh call site. It has. The amended phase 2 only swaps `finish` for `abandonUnstarted`, which
   does not change any call-site count, so the guard is green before phase 2, between phases 2 and 3,
   and after — it cannot go red at any point in this plan's execution, and "observing" it green would
   be recording a control that never fired. **The historical red/green is recorded as predating this
   amended plan, not re-claimed.**

   Replaced by a MUTATION, which is the same evidence obtained where it can still be obtained: delete
   the new `withBusyRetry(` call in **`job-launch-outcome.mjs`** — where it lives after the extraction,
   NOT `task-submit.mjs`, which no longer holds it — prove the deletion landed, and require
   `busy-site-count.test.js` to go **red**; restore and require green. That is a positive control on
   the live tree, and it tests the property the ordering check was a proxy for — that the guard is
   coupled to the code and not merely to the two sentences.

**No test asserts `task-submit.mjs`'s ordering today**, so the move breaks nothing.
`tests/credential-notice.test.js` re-writes the notice text by hand, so it reddens on a *wording*
change but not on this move — do not change that notice text.

## Verification

1. `npm test` green — **every test, no failures**. No baseline number is written here: the figure in
   the originally approved plan (799) was already stale by the time of the mid-build episode, which
   measured 802, and a number in this position is a claim that goes wrong silently. Green is the
   requirement; the count is an observation to record in the run, not a target to match.
2. The repo `verify` skill: tests, real plugin load, delegation round trip. Steps 3–4 need a live
   server; LM Studio is available.
3. **Mutation, two of them**, each proved landed before running the suite and restored by `diff`:
   - Revert the `try`/`catch` around the spawn → test 1 must redden.
   - Revert the sweep to its old position → test 2's orphan assertion must redden.
4. The phase 5.3 MUTATION (delete the new `withBusyRetry(` call; `busy-site-count.test.js` must
   redden; restore; green), recorded as a result rather than asserted. It replaces an ordering
   check that this amended plan can no longer make fail.

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

**`adr/014` is therefore IN the change inventory**, not merely referenced — noted after the blind gate
observed it was named in this section but missing from the touched-file list. If reading it shows the
seam belongs elsewhere, the inventory changes with the decision rather than the file being edited
silently.

**That reconciliation is now structural rather than a sentence.** The mid-build gate found the
same divergence a second time, in the scope handed to the reviewer, which repeated the fix at the
cited place and left the claim alive elsewhere — `adr/066`'s class exactly. There is now ONE
canonical list, the touched-file inventory above; this paragraph and every other mention defer to it
instead of restating membership.
