# ADR 020 — a contended database must not kill live work

Status: accepted (2026-08-07)

## The defect

`job-store.mjs` set `PRAGMA busy_timeout = 10000` on every open, under a comment asserting that
"every statement after this line waits instead" of failing. That claim was false in two directions,
and every call site below was written trusting it.

**Every count here is greppable, and a test asserts it against the code** — because this document's
site count drifted three times in three review passes, wrong each time it was written. There are
seven `withBusyRetry` call sites and five `isBusy` call sites outside the module that defines them.
Those are the only two quantities stated, they always carry their noun, and
`tests/busy-site-count.test.js` counts both from `scripts/lib` and reddens if either sentence
disagrees. A derived total is deliberately absent, and the reason CHANGED in OAI-67's third review
pass without the absence changing. The two sets used to OVERLAP — one `isBusy` call was the exhaustion
guard *at* a retried site, the spawn stamp — and that member went when the stamp stopped asking which
storage fault it had suffered. **The sets are now disjoint.** A total is still not stated, now for the
plainer reason that a third number nothing counts is exactly what drifted, four times. The guard has already earned itself: a later fix added a seventh `isBusy` and then removed
it again, and on both moves it was the test that reddened rather than a reader who noticed.

SQLite's busy handler is not consulted for every contended operation. It is not honoured when a
transaction needs to upgrade a lock it already holds, and `PRAGMA journal_mode = WAL` — which takes
an **exclusive** lock to convert the journal — threw `database is locked` three times in the wild at
exactly the statement whose safety the comment was asserting.

So a `SQLITE_BUSY` really does reach the callers. Where it reached them, it destroyed work:

- **(a) The heartbeat.** `startHeartbeat`'s `setInterval` callback called `beat` unguarded. A throw
  inside a timer callback has nowhere to go: it is an uncaught exception, and it **killed the worker
  mid-model-call**, discarding a request already in flight. Proved by execution — a handle whose
  `prepare()` throws errcode 5 exits the process 1.
- **(b) The terminal writes — all THREE of them.** `cmd-task-worker.mjs` wrote the outcome after
  `requireAnswer`, so by that line **the model had already answered**. A lock held past the busy
  timeout there did not cost a retry; it discarded an answer paid for in full and reported it as a
  task failure. The `failed` write beside it loses a *diagnosed* failure the same way. The third —
  `job-queue.mjs`'s `timeOut`, publishing `queue-timeout` — was missed by the first draft of this
  change and found by review; it is the one contention is **likeliest** to meet, because it is
  reached only while another job is running, so a competing worker is beating throughout. Worse, the
  worker awaits `awaitTurn` **outside** the try that guards `runJob`, so a busy there killed the
  process outright and left reconciliation to report `worker-died` for a job that had timed out for a
  reason it could name.
- **(c) The open itself.** The WAL pragma, above.
- **(d) The queue's wait loop.** `awaitTurn`'s per-iteration `beat` was unguarded, so a worker that
  had sent nothing and was merely waiting its turn could die silently and never run.
- **(e) The spawn stamp.** `task-submit.mjs` writes `spawned_at` **after** `spawnWorker` returns, so
  at that line a detached worker has been created and is expected to make a real, billable model call
  — expected rather than established, since nothing watches it after the `'spawn'` event. A
  busy escaping it rejects `submitTask`, and `cmd-task.mjs` never prints the id — leaving a job the
  user cannot name, poll or cancel, and which may well be running. Found by review, in the pass after this ADR was first
  written.
- **(f) The worker's registration.** `cmd-task-worker.mjs` handles `registerWaiter`'s false *return*
  and has no catch at all, so a busy there killed the worker before it had sent anything and the job
  it was spawned for simply never ran. Found by review of *this ADR's own exclusion list*, which had
  claimed the caller "treats a throw as the answer" — it does not, and the claim was the defect.

## The decision

One helper, `scripts/lib/job-busy.mjs`, holding `isBusy` and `withBusyRetry`, and **three different
answers** to contention — because the right response is not uniform, and pretending it is was how the
original comment came to be believed. (A fourth answer, at one site, governs what happens when a retry
runs OUT rather than what happens when contention arrives.)

**Retry, at the three terminal writes (b), the spawn stamp (e), the registration (f) and the
launch-outcome write (g).** Work already exists that will be lost otherwise.
`withBusyRetry` re-runs the call until it succeeds or a budget elapses, then rethrows the busy error
so the existing outer catch reports it exactly as it does today. All three terminal writes are wrapped — completed,
failed and queue-timeout — because a contended database must not turn a *diagnosed* failure into an
undiagnosed one either. The spawn stamp joins them for the same reason read the other way: the work
it must not lose is not a *reply* but a *process* — one already spawned, whose id is the only handle
anyone has on it. The registration joins them because its caller has no catch: losing it costs the
whole run of a job nobody is watching. The launch-outcome write (g) joins them on the same reading
taken a third time: what it must not lose is neither a reply nor a process but the *record of an
outcome nobody else will write* — the submitter is the only party that knows this launch could not be
completed or confirmed, and the row it is writing about may be one no worker ever registers against. While such a
row stays unregistered and queued, `livenessOf` reads it as `starting`, so every job behind it waits
out the full startup grace. The harm is not this job; it is the queue behind it.

### Where the retry sits matters as much as that it is there

The completed write originally lived at the end of `runJob`, **inside** the try whose catch publishes
`failed`. So when it exhausted its budget the busy propagated into that catch, which wrote `failed` —
and by then contention had had thirty seconds to clear, so that write very likely **succeeded**. An
answer that existed was published as a task failure: the exact outcome the retry was added to prevent,
reached through the retry's own failure.

`runJob` therefore writes nothing and returns the outcome, and the completed write sits outside that
catch. This makes the defect impossible rather than handled. If it now throws, no *row* is written:
the row stays `running` with a live pid, and reconciliation reports the worker's death rather than
inventing a verdict for it.

**Placement alone was not enough, and the review that ended this feature is what established it.**
The first version of this section stopped at the paragraph above and filed the consequence — an
answer paid for in full, existing only in a process about to exit, reported as `worker-died` — as
future work. Both approvers at the verdict point rejected that: the ask this ADR answers is that
contention must not kill live work, and discarding a completed answer *is* that failure, so
deferring it deferred the feature. Not publishing `failed` was the right half of the fix; the other
half is that the answer has to go somewhere.

`salvageOutcome` is that half, and it is deliberately **not** a durable store. It writes one line to
the descriptor the worker was already spawned with — `job-spawn.mjs` opens the job log once and
passes it as both stdout and stderr — under the fixed, greppable prefix `SALVAGED_OUTCOME`, then
lets the storage error propagate unchanged. It defines no schema, opens no file, adds no reader and
alters no published contract, which is why it could land inside a review pass where a fallback store
with a lifecycle and a retention policy could not. The prefix is load-bearing rather than
decorative: that log also carries the progress heartbeat and the model's own output, so an unmarked
dump would have moved the loss instead of removing it.

What is left is the row, not the data. Reconciliation still publishes `worker-died` for a job whose
answer is readable in its own log, and nothing in the row points at it — filed as **OAI-106**, since
teaching `/oai:result` a `persistence-pending` state is the durable-channel design this feature's
plan did not cover. The heartbeat is stopped in an outer `finally` so it beats through both
terminal writes. **It does not follow that a beat lands during a contended one, and an earlier draft
of this paragraph claimed it did.** `withBusyRetry` sleeps with a synchronous `Atomics.wait`, so
`setInterval` cannot fire while a retry is in progress — `job-busy.mjs` says so where the sleep is
defined, and this paragraph now defers to it rather than contradicting it eight lines away. What the
`finally` buys is that the interval is not *cleared* early; what it cannot buy is a beat from a
blocked thread.

That is accepted, with the numbers: the silence is bounded by the 30-second budget plus the
documented up-to-10-second attempt overshoot, against a `STALE_BEAT_MS` of 60 seconds — so a
contended terminal write never reads as stale, and `stalled` is not a verdict in any case, since
`livenessOf` decides by pid and only corroborates with the beat.

### Exhausting a retry is a fourth answer, not the absence of one

`withBusyRetry` rethrows when its budget runs out, and the seven retried sites split three ways rather
than two. At **four** of them rethrowing is right — the open, the queue timeout, the completed write,
and `registerWaiter`, whose throw reaches the worker's top-level handler and kills a worker that has
sent nothing. At the **spawn stamp**, at the worker's **`failed` write** and at the **launch-outcome
write** it is not, and for three different reasons. Four rethrowing and three converting, which is the
seven above.

**What those three converting sites CATCH is no longer uniform, and the difference is deliberate.**
Two of them — the worker's `failed` write and the launch-outcome write — catch any storage fault and
do not ask which; and since OAI-67's third review pass the **spawn stamp** does the same. It formerly
caught its exhausted busy alone and rethrew everything else, which meant a corrupt database, a disk
error or a schema fault reproduced through that line the exact loss the retry existed to prevent: the
submission rejected, the id was never printed, and a detached worker already created was left
unnameable. All three sites sit past a point where a live worker may exist, and at every one of them
the fault's CLASSIFICATION changes nothing a reader can act on — so all three report by message and
none rethrows.

The completed write sits in the first group **with a qualification**: its exhausted busy is rethrown
unchanged, and that is still right, but it is no longer rethrown *alone* — `salvageOutcome` runs
first, from a catch that returns rather than throws, for exactly the reason the `failed` write's
catch does. The distinction is that the spawn stamp, the `failed` write and the launch-outcome write
**convert** their exhaustion into something else (a warning, a preserved diagnosis, a reported storage
fault); the completed write converts nothing. It rescues the payload and lets the error travel.

Take the `failed` write first, because its defect was invisible in the shape rather than the policy.
A `throw` raised inside a `catch` block **replaces the pending rethrow**, so an exhausted busy escaped
as `database is locked` and the `throw error` beneath it never ran. The row write is exactly what
failed, so the diagnosis was in no channel at all: a job that died of a bad credential was logged as
contention. The retried write now sits in its own `try`, the storage failure is reported as itself on
stderr — which is the job log — and the error that actually killed the job is what propagates.

**That inner catch does not test `isBusy`, and the reason is the same defect found twice.** Its first
version caught the busy and rethrew everything else, which fixed the exhausted lock and left a disk
error, a corrupt file or a schema fault reproducing the identical loss through the identical line.
Which storage fault occurred does not change what a reader needs, so neither error is discarded: the
storage one by message, the diagnosis by propagating. `error.cause` was rejected for carrying it —
`oai-companion.mjs` prints `error.stack`, which does not render a cause, so it would preserve the
fault somewhere nobody reads.

And the **spawn stamp**. The retry narrows the
lost-id window without closing it, and when it closes a detached worker has been created and is
expected to be spending money — so rethrowing trades the one fact worth keeping for one worth much
less. *Expected*, not established: the `'spawn'` event proves the child existed, and this process
watched nothing after that, which is the same limit the warning further down is careful about. Without the
stamp, `livenessOf` falls back to `created_at`, which only shortens a startup grace window, and once
the worker registers itself the stamp is not consulted at all. Without the id there is no way to poll
or cancel a job that may be costing the user money. So that site alone catches the exhausted busy, warns
on stderr, and returns the id.

**What that warning may say is narrower than what the site knows**, and an earlier wording overstepped
it: it said the job *is running* and only its grace window is affected. The spawn is observed; nothing
after it is. Thirty seconds of budget is long enough for the child to have registered, run, failed or
died unseen, so a submission that may have failed was being reported as a success with a caveat. The
wording now states the spawn, states that this session cannot see what followed, and points at
`/oai:status`, which reads the row instead of guessing. `tests/job-busy-placement.test.js` asserts the
warning printed at all — the control that keeps the next assertion from passing vacuously — and then
that it asserts no liveness.

The alternative raised in review was to **verify the registration before warning**, and it is declined:
verifying means more contended reads at the one moment the database is already saturated, on a path
whose whole purpose is to stop costing the user something when it is. Saying less is cheaper than
learning more here, and is sufficient, because `/oai:status` answers the question on demand and after
contention has cleared.

And the **launch-outcome write**. It takes the `failed` write's policy wholesale, because the shape is
the same one: the exhausted busy is reported by message on stderr and the launch error propagates, the
inner catch does **not** test `isBusy` — a disk error, a corrupt file or a schema fault would otherwise
reproduce the identical loss through the identical line — and the report itself is wrapped, because a
throw raised inside a `catch` replaces the pending rethrow. What is different is what the site is
allowed to say. **A rejected launch does not prove that no child exists:** `spawnWorker` awaits the
`'spawn'` event and only then closes its copy of the log descriptor, so a throw from that close rejects
after a detached worker was created and may still be running. The write therefore records a
launch that could not be completed or confirmed, never one that failed. And when the retry exhausts,
what it reports is a storage fault and nothing about the row: the row is left **untouched**, which is
not the same claim as left `queued` — an unregistered queued row ages out through the startup grace,
and a row a worker has already registered against is left to that worker's own lifecycle.
Registration establishes only that a worker REGISTERED as the waiter — `registerWaiter` sets
`waiter_pid` on a row that is still `queued`. Acquisition is the separate guarded transition to
`running`, which `tryAcquire` may never grant, and publication is separate again. Collapsing those
three is the same error as collapsing `waiter_pid` with `worker_pid`, which this store already
records as a shipped bug.

**Skip the tick, at the two beats (a, d) — but skip only what actually failed.** The next beat is five seconds away, and the stale-beat →
`stalled` path already represents a missed update correctly. The wait loop is *itself* a retry, with
its own deadline. Skipping is the cheapest correct answer at both.

The heartbeat's beat and its cancellation read get **separate** catches. Sharing one let a busy
*write* skip the *read* — and in WAL mode a reader does not block behind a writer, so that read would
usually have succeeded. Since sustained write contention is precisely when the beat keeps failing,
one try block made contention able to keep an expensive model request alive indefinitely after the
user asked for it to stop.

**Stop taking the lock, at the open (c).** This is the one that is not a retry at all. The journal
mode **persists in the database file** (measured), so the WAL pragma is needed on the first open of a
database and on no other, and reading the current mode is an ordinary read that takes no exclusive
lock. The set is therefore conditional. `openStore` keeps a retry around the whole open for the one
case left — two processes genuinely *creating* the database at the same moment.

**And the open's per-attempt timeout is lowered to 250ms**, restored to 10s only once the open has
succeeded. Without that the budget was not a bound at all: measured under a held write lock, a
first-creation `CREATE TABLE` blocks **10755ms** at the handle's 10s timeout, after which
`withBusyRetry` finds five seconds already spent and rethrows **having never retried once**. At 250ms
the same statement fails in 330ms and the retry loop governs. The long timeout is what every
*caller's* statement inherits, and those have no retry around them, so it is restored before the
handle is returned.

The measurement also separates the two writers, which reading cannot: `PRAGMA journal_mode = WAL`
consults **no busy handler at any value** — 0ms at 10s and at 250ms alike — which is why the retry
loop rather than the timeout is what covers it, while `CREATE TABLE` honours the timeout exactly.

### Why elapsed time, not an attempt count

`withBusyRetry`'s budget is wall clock. An attempt count is a bound on the wrong quantity: each
attempt may itself sit inside the 10-second `busy_timeout`, so "ten attempts" is anywhere from
milliseconds to a hundred seconds. What a caller needs to reason about is how long the process may
sit here, and that is what is bounded — provided no single attempt can outlast the budget, which is
the constraint `openStore`'s short per-attempt timeout exists to keep.

The clock is `performance.now()`, not `Date.now()`: the budget measures a duration, and a wall clock
can step under NTP correction or a manual change, either abandoning a retry immediately or extending
it by the size of the jump.

### Why `onCancel` is outside both catches

The heartbeat now has two catches — one for the beat, one for the cancellation read — and `onCancel`
is invoked outside them both. Inside either, a defect in the cancel path would be swallowed as though
it were contention, and a cancellation lost in silence is worse than a callback defect made visible.
`cancelled` stays `false` when the read itself was skipped, so a contended read is never mistaken for
"no cancel was requested": it means "not known this tick", and the next tick asks again.

### What is NOT protected, and why the list is enumerated

Every other write in this subsystem is untouched, and that is a
decision rather than an oversight — stated here because a doc that lists what was fixed and stops
reads as a claim about the database as a whole, which is the exact shape of the false comment this
ADR exists to remove.

- `insertJob` — precedes `spawnWorker`, so a busy there means no row and no worker. A clean failure
  with nothing running is a correct report, and retrying it would only delay one.
- `requestCancel` — its caller genuinely does treat a throw as the answer, and the distinction from
  `registerWaiter` above is the one worth stating: a busy here surfaces to a **user at a terminal**
  who can run the command again, where `registerWaiter`'s killed a worker nobody was watching.
  **Two things about that are weaker than they sound, and both are stated rather than smoothed over.**
  `runCancel` calls `reconcileAll` *before* `requestCancel` (`cmd-cancel.mjs:63`), so a busy can fail
  the command before the cancellation is attempted at all — the user's stop request never reaches the
  column. And what surfaces is a raw `database is locked`, not a `UserError` with a hint, so "run it
  again" is advice the output does not give. What holds is the part the decision rests on: the
  command **fails visibly and nonzero**, nothing is silently accepted, and the billable request the
  user wanted stopped is no worse off than before they typed it. Review argued the enumeration is
  lifecycle-biased — terminal facts get retries, a stop request does not — and that a cancellation
  deserves its own contention policy with a best-effort reconcile ahead of it. That is a behaviour
  change beyond this item's ask, which is that contention must not kill **live work**; it is filed as
  **OAI-107** rather than built here.
- Every write in `job-reconcile.mjs` — the sweep re-runs on the next read, so a busy costs one
  deferred reconciliation rather than a lost fact. **This one is a judgement, not a proof**: nothing
  measures how long a persistently contended database could defer a reconciliation, and the argument
  assumes a later read arrives. Filed as **OAI-105** rather than asserted.

### Why retrying `queue-timeout` does not overwrite a cancellation

Raised against the (b) fix: retrying `timeOut` widens the window in which a cancel request could
arrive and then be overwritten by `queue-timeout`. Dismissed, because the expiry *decision* provably
precedes the cancel — `expired()` has already fired by the time `timeOut` is called — and delaying
the persistence of a true fact does not make it untrue. The proposed remedy, a
`cancel_requested_at IS NULL` guard on the write, would be worse: it lets a cancel arriving *after* a
job legitimately timed out suppress the timeout's own diagnosis, replacing a reason the system can
name with one it cannot. What the widened window actually costs is that the row reads `queue-timeout`
rather than `cancelled` for a job that was both — a labelling question, not a lost fact, and the
timeout is the earlier truth.

### Why the catch is narrowed to `isBusy`

A blanket catch inside a timer nobody is watching would hide a genuine defect forever. Any error that
is not contention still kills the worker, deliberately. This is the invariant a mutation check
targets: widening the catch reddens *a non-busy error from the heartbeat is not swallowed*.

## Evidence

Each guarded site has a witness that drives a path where a busy error is really raised, and each
was proved load-bearing by a mutation that reddens **exactly one** named **behavioural** test — with
one stated exception, the diagnosis pair, where a single mutation reddens both because the code they
guard deliberately treats their two fault classes alike. The exception is written into the row rather
than left for a reader to discover, since a table claiming a property its own rows break is the shape
this ADR exists to remove. The word *behavioural* is load-bearing and is qualified under the table:

| Site | Witness | Mutation that reddens it |
|---|---|---|
| (a) heartbeat | `a busy beat skips the tick instead of killing the worker` (child process) | widen the catch → reddens the *non-busy* control |
| (b) completed | `the COMPLETED terminal write survives a transient busy` | unwrap the completed `finish` |
| (b) failed | `the FAILED terminal write survives a transient busy` | unwrap the failed `finish` |
| (b) queue-timeout | `the QUEUE-TIMEOUT terminal write survives a transient busy` | unwrap `timeOut`'s `finish` |
| (a) cancellation | `a busy BEAT does not suppress the cancellation read` | share one try block again |
| (c) open | `openStore does not re-set WAL on a database that is already WAL` | make the WAL set unconditional |
| (c) open — retry | `a busy during the open is RETRIED, not reported` | replace `withBusyRetry(openOnce, …)` with `openOnce()` |
| (c) open — cleanup | `each FAILED open attempt closes its handle before retrying` | delete the `db.close()` in `openOnce`'s catch |
| (d) queue | `a busy beat in the QUEUE wait loop does not kill a waiting worker` | unwrap the poll-loop beat |
| (e) spawn stamp | `a busy on the SPAWNED stamp does not lose an id whose worker is already running` | unwrap `markSpawned` |
| (e) exhaustion | `an EXHAUSTED spawn-stamp retry still reports the id` | rethrow instead of warning |
| (f) registration | `a busy while REGISTERING as the waiter does not silently lose the job` | unwrap `registerWaiter` |
| (g) launch outcome | `a TRANSIENT busy on the launch-outcome write is retried, not lost` | unwrap the `withBusyRetry` around `abandonUnstarted` |
| (b) placement | `a storage failure on the COMPLETED write is never republished as a task failure` | move the completed write back inside the `failed` catch |
| (b) diagnosis — both | both diagnosis witnesses | delete the inner `try` around the `failed` write — **reddens the pair, not one**, because the fix deliberately stopped distinguishing the two fault classes |
| (b) diagnosis — other | `a NON-BUSY failure of the failed write also leaves the diagnosis propagating` | restore the `if (!isBusy(storageError)) throw storageError` guard |

**The unqualified form of that claim was never true, and it was untrue from the moment the table was
written.** It read "a mutation that reddens **exactly one** named test — with one stated exception, the
diagnosis pair", and the structural guard breaks it for a whole column at once:
`tests/busy-site-count.test.js` counts occurrences of `withBusyRetry(` and `isBusy(` across
`scripts/lib` and requires the resulting spelled sentence to appear in this document, so **any**
mutation that adds or removes a counted occurrence reddens it as well — every `unwrap` row above, but
also `replace withBusyRetry(openOnce, …) with openOnce()`, also `widen the catch`, which deletes a
counted `isBusy(`, and also `restore the if (!isBusy(storageError)) throw storageError`, which is the
one that *adds* rather than removes. The rule is what to read, not the list.
It is not an exception to carve per site — the guard watches the *enumeration*, not any one site's
behaviour — so the exactly-one property is a statement about the behavioural witnesses and always was.
`busy-site-count.test.js` and this document landed in the same commit, `77c1eab`, so nothing here made
the claim stale; it was simply wrong when written, which is the defect this ADR keeps finding in its
own counts.

Measured 2026-08-12 rather than reasoned, since the point of the qualification is that reading the
table did not reveal it: unwrapping (f) `registerWaiter` in `scripts/lib/cmd-task-worker.mjs` reddened
**two** tests — its own witness `a busy while REGISTERING as the waiter does not silently lose the job`
and `every stated count of contention sites matches the code` — for 800 pass / 2 fail, restored to 802
pass / 0 fail on revert. **Those totals are the suite as it stood at that measurement, mid-OAI-67, and
they are deliberately not updated as it grows** — it ended that feature at 810. What the experiment
establishes is the DELTA and which two tests moved; a total refreshed to match today's suite would
claim the experiment was re-run when it was not. Said explicitly in the one document whose subject is
that stated numbers drift, and where a reader meeting 800 against a 810-test suite would otherwise be
right to wonder. Mutations that leave the counted occurrences alone leave the count guard
green, and the table names four of them: making the WAL set unconditional, deleting the open cleanup,
moving the terminal-write placement, and deleting the diagnosis catch.

The open has **three** rows because the first of them cannot fail on the other two: it inspects the
statements two *clean* opens execute, and raises no busy at all. Both of the mutations the other two
rows name were shown to leave the entire suite green while that row was the only witness — which is
how a check that reports success can be one that cannot fail, and why the count of rows is not the
count of sites.

Unwrapping the *completed* write leaves the *failed* witness green, which is why both exist: the
failed path is reachable with an unreachable transport, but only a live server puts the code in the
state the defect is about — the model has already answered.

The heartbeat witnesses run in **child processes**. The defect under test is process death, and
`node:test` intercepts uncaught exceptions and fails the test that raised them, so an in-process
assertion could not have passed for the right reason.

## Stated limits

1. **The rate at which this fires in the wild is unmeasured.** Three observed `database is locked`
   throws at the WAL pragma is what prompted this; nothing here measures how often contention reaches
   the other sites, and no claim is made that it is common.
2. **`budgetMs` is a floor, not a ceiling — and the overshoot is only as small as the caller's
   per-attempt timeout.** `withBusyRetry` checks elapsed time *before* sleeping again, and a
   synchronous SQLite call in progress cannot be interrupted, so a call overruns its budget by up to
   one attempt plus one delay. `openStore` bounds that overshoot at 250ms by construction. **Any
   other caller inherits the handle's 10-second timeout**, so **every retried site except `openStore`** —
   the three terminal writes, the spawn stamp, the registration and the launch-outcome write — may
   overshoot their 30-second budget by up to ten seconds. Stated as *all but one* rather than as a
   list, because the list was already wrong before this feature touched it: it omitted the
   registration (f), and enumerating it again would only have added (g) to a sentence that was
   incomplete on the day it was written. The property follows from the handle, not from which sites
   anyone remembered. That is accepted there — the alternative is losing an
   answer — but it is not a bound anyone should quote.
3. **A cancellation read that fails is still a delayed cancellation.** Splitting the catches means a
   busy *beat* no longer costs the tick its cancellation check, which was the common case. A busy
   *read* still does, and a database contended for a long stretch postpones a requested cancel by a
   multiple of `BEAT_MS`. Skipping remains the right answer — the alternative is a dead worker, which
   never notices the cancel at all — but the residual delay is real and unbounded here.
4. **Three of the retried sites were wrapped on reasoning alone.** `timeOut` is wrapped because its
   contention is *structurally* likely — it is reached only while another job runs, so a competing
   worker is beating throughout — and `markSpawned` and the launch-outcome write because of what they
   cost when they fail: for the stamp, an id nobody can poll or cancel by; for the launch-outcome
   write, an outcome nobody else is in a position to record, and a queue stalled for a whole startup
   grace behind a row that, if no worker registers against it, no one else will clear. None of the three was observed failing, and no production
   instance of any of their throws has been seen.
5. **The unprotected writes are argued, not measured.** The exclusion list above rests on
   `job-reconcile`'s sweep being re-run by a later read. Nothing bounds how long that deferral can
   last under sustained contention, and nothing proves a later read always arrives — OAI-105.

## Scope

`openStore`'s budget is 5 seconds rather than the helper's 30. Every command opens the store, so an
over-generous budget turns a rare creation race into a long unexplained pause on an ordinary
`/oai:status`; failing fast after five seconds of genuine contention is the better report.

`openStoreForReading` is deliberately untouched: it opens read-only, takes no exclusive lock, and its
`null` return already means "nothing to report".
