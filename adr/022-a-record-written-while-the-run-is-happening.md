# ADR 022 — A record written while the run is happening

**Date:** 2026-08-13
**Status:** Accepted
**Items:** OAI-132, OAI-140 (recording half)

## Context

`bench/review-sweep.mjs` exists to run unattended overnight. Until this change it wrote nothing until
it had finished: `writeSweep` ran once, after the loop, and `runSweep` held every settled commit in a
local array until then.

Measured, not argued. `sweep-2026-08-09-overnight` ran **8h22m** (2026-08-09 20:39 → 2026-08-10 05:01
BST) and wrote its first and only byte of result in the last second of it. Confirmed by reading the
code rather than inferred from the silence: the file had **exactly three** `stderr.write` sites — the
opening enumeration line, the closing report paths, and the error handler. Nothing per commit.

So for 8h22m the only observable was a live pid and `lms ps` reporting `GENERATING`, and **had the
machine slept or the process died at hour eight, all 40 eligible commits would have been lost with no
partial record** — not degraded, gone. Two sessions have had to reason about liveness from `ps` alone,
and one misread a stalled log tail as a dead job. The per-commit cap then rose from 900s to 1800s
(ADR 021), which doubles that unwatched window.

Riding with it: the consecutive-outage counter driving `--abort-after` is zeroed by any non-outage, so
a server failing every other commit with a slow commit in between produces `outage, timeout, outage,
timeout, …` and never trips the abort. The 2026-08-09 run recorded 20 deadline-timeouts and zero
aborts, and that was read as the fail-fast holding. **The same data cannot distinguish "no outage
occurred" from "outages occurred and were repeatedly reset"**, because nothing recorded the counter's
history.

## Decision

**Each commit reaches disk as it settles, in an append-only JSONL ledger beside the artifacts it will
become, and a separate command turns an interrupted ledger into the report the run never wrote.**

### Why JSONL and not SQLite

The obvious alternative — and the one the user raised — is a `node:sqlite` history table, which would
also serve cross-run comparison (the live want behind OAI-141). It was rejected **for this job**, on
three grounds, and none of them is "simpler":

1. **It is not more crash-durable.** A per-commit `INSERT` buys transactional atomicity across rows,
   which one line per commit does not need. It buys no better flush guarantee against `SIGKILL` or
   sleep than a synchronous append does.
2. **ADR 018 cuts against it.** `node:sqlite` is deliberately gated as a *capability* rather than a
   version, so a runtime lacking that builtin loses background jobs alone. Depending on it here would
   make an unattended run's crash protection conditional on precisely the capability the job store was
   careful to keep optional.
3. **It is not the same artifact.** A cross-run history indexes completed and recovered *runs*; the
   ledger is the *within-run* recovery record. A history would consume ledgers, not replace them.

That leaves the SQLite history a live idea rather than a rejected one — it is filed, with OAI-141 as
its justification.

### Why nothing buffers, and why no `fsync`

The sweep calls `execFileSync` per commit, so there is no event loop to flush on, and `SIGKILL` gives
no chance to drain. Each line is therefore one `appendFileSync`: a fresh descriptor, `O_APPEND`,
returning only once the write has been made. At ~40 lines a run the cost is nothing and the guarantee
is total for the failures being defended against.

`fsync` is deliberately omitted. A synchronous write has already reached the kernel, so the bytes
outlive the process and outlive the machine sleeping — which are the failures OAI-132 names. `fsync`
would additionally survive a power cut, at the price of a disk flush per commit. The residual exposure
is a **torn final line** (and, per the guard section below, arbitrary entries lost to a caught write
fault), and `readLedger` discards an unparseable line and reports the count rather than refusing to
open the file: this is read by the tool whose entire job is salvaging an interrupted run, and one that
throws on damage has abandoned its post at the moment it was needed.

### The header carries the MANIFEST, not merely the counts

The first line holds every envelope field known before any review has happened, **including the full
enumerated commit list**.

This is not belt-and-braces. `renderSweep`'s header renders `enumerated` from the envelope while
`coverageSection` filters the entries it was handed. Recovering from counts alone, a report would say
*"Enumerated 40 · reviewed 2 · no review 38"* in its header and *"Every enumerated commit was
reviewed"* four lines below it. Recovery therefore walks the manifest in enumeration order and
synthesizes an outcome for anything with no entry — `unobserved` where nothing at all was written and
`unrecorded` where a `gap` line says the write failed (see the guard section). Neither is a review nor
a failure and neither must be rendered as one. Because neither outcome is in `REVIEWED`, the existing coverage section then
disposes of them correctly, and ADR 021's every-commit-exactly-once guarantee survives recovery.

### Recovery renders nothing itself

`bench/recover-sweep.mjs` reconstructs the record and hands it to the **existing `writeSweep`**. A
second renderer would be a second set of guarantees to trust. It is a separate command rather than
something the next sweep does on startup: recovery logic on the hot path of the thing being protected
is the wrong trade, and it would mean a second sweep must run before the first one's result is
readable at all.

**It refuses to recover a run that finished, and "finished" means a record that PARSES.** The first
version of this check read the record's mere *existence* as proof both writes completed. That was false
in the direction that matters: the record is written with a single `writeFileSync`, which truncates the
file and then fills it, so a process killed mid-write leaves a `.json` that exists and is a fragment —
and recovery would have refused, *"that run finished"*, at precisely the moment it was needed.

Two conditions, doing two different jobs. **Parse success is the durability witness**: the record is one
stringified object, so its closing brace is among the last bytes written and no prefix of it can parse.
**A non-null `endedAt` is the identity witness**, defending a different case — a `.json` at that path
that parses but is not this run's completed record — which holds because `recoveredRecord` leaves
`endedAt` null on everything it writes. Unreadable, unparseable or witness-less all mean *not finished*,
so recovery proceeds: a false negative costs a redundant report beside a real one, a false positive
refuses to recover a night that was genuinely lost.

Rendering anyway would put a second report saying *THE RUN DID NOT FINISH* beside the real one saying it
did, sorting together, with the false one newer. `--force` overrides it, which is what makes a refusal
rather than a warning acceptable.

**That check cannot cover a recovery run while the sweep is still LIVE, and nothing can.** A running
sweep has written no report yet, so there is nothing to detect. The figures are a snapshot of a moving
ledger and commits listed `unobserved` may be reviewed minutes later, so the command says so on every
run rather than trying to detect it. A lease or lock file was considered and rejected as
disproportionate to a human-invoked reader.

**This ADR previously called that "a legibility trap rather than a falsehood", and that was itself
false.** One sentence disproved it: the zero-entry case rendered *"No commit reached the ledger before
the run ended"* — asserting an ending nothing here observes — into a permanent artifact, where the
stderr notice does not reach. Every such sentence now asserts only what was **read**. The distinction is
load-bearing: a caveat about legibility is a promise that each individual statement is true, and it has
to be earned sentence by sentence rather than declared.

**Options come before the ledger path**, and an option written after it is refused. `parseArgs` stops
reading flags at the first positional, so `recover-sweep.mjs <ledger> --out-dir DIR` — the form this
design's own first draft documented — parsed the flag as a filename and silently wrote beside the ledger
instead. A flag that is accepted and does nothing is worse than one that is refused.

The two facts a crash destroys are supplied explicitly rather than guessed. **`endedAt` stays `null`** —
a killed run has no end, and putting the last observation into a field labelled *ended* asserts
something false — and `stoppedBecause` states in words that the run did not finish, how many commits
have no ledger entry **and that this cannot distinguish never-reached from settled-and-lost**, how
many were settled with their record lost, when activity was last observed, and how many ledger lines
were discarded.

### The streak is DERIVED, never stored

OAI-140 asked for the outage history to be recorded. Storing the counter was rejected: the streak is a
function of the settled outcome sequence and the `isOutage` predicate, both of which the entries already
carry, so a stored copy is a second representation of one fact and free to disagree with the first.

**It is not a pure function of the counter the run itself ran**, and saying so would overstate it. A
settled entry reaches the ledger *before* the loop updates its counter, so a record recovered from a run
killed in between can hold one outage the loop never counted, and the derived streak would imply an
abort decision the run never took. On a complete record the two agree exactly; on a recovered one this
is a reading of what settled, which is what the incomplete-timeline warning exists to say.

What the record genuinely *could not* reconstruct is **when** anything happened — entries carried only
`seconds`, a rounded duration. So the timeline is what got recorded (`startedAt` / `endedAt` per
attempted commit), and `bench/lib/sweep-health.mjs` replays the counter from it at render time.

Two consequences worth stating:

- **`isOutage` moved to `sweep-outcome.mjs`.** The loop asks it whether to abort; the report asks it
  how the night went. Two copies of that boundary would let the morning artifact describe an abort
  decision the run never took.
- **`startedAt` is the discriminator for "attempted".** The three skip branches return before both the
  timestamp and the counter, so selecting on that field keeps the replay in step with the loop by
  construction. A list of skip outcome names would be a hand-maintained copy of the loop's control
  flow.

A reset from zero is not counted as a reset — every healthy commit would otherwise be one, reporting a
number the size of the run and burying the signal.

**Deriving binds the streak to the predicate's VERSION, and that is the cost of not storing it.**
`isOutage` can change between the run and its recovery, so a ledger recovered by a later build may
report a streak the run itself would not have computed — where a stored counter would have carried the
run's own answer. Accepted rather than mitigated: the recovery tool runs against the same build within
hours in every real use, and a stored counter's failure mode (a second representation silently
disagreeing with the entries beside it) is worse than a versioning one that only appears across builds.
A schema version in the header would let a future build *detect* the mismatch rather than merely
suffer it; it is filed rather than built.

**The replay does NOT stop at the threshold**, though an earlier version did. On a complete record that
break is merely redundant: a real abort emits `skipped-abort` entries, which carry no `startedAt` and
are already excluded. On a *recovered* record it is wrong — a hole between two outages makes them look
consecutive, the walk breaks early, and later surviving outages vanish from the count while the header
goes on reporting them as attempted. Redundant on one path and lossy on the other.

### Two different failure points, two different policies — and they must not be read as one

**Bootstrap fails the run; a per-entry write does not.** `main` calls `openLedger` and writes the header
before the first review, outside any guard, so an unwritable out-dir ends the sweep at minute zero. That
is deliberate. `openLedger` and `writeSweep` both `mkdirSync` the same directory, so a directory that
refuses the ledger will refuse the report too — continuing with a no-op sink would review for eight
hours and then have nowhere to put any of it. Discovering that at hour 0 is strictly better than at
hour 8.

**The claim below is therefore scoped to the per-entry path, and an earlier draft of this ADR stated it
unscoped, which was false.** *A recording fault must not cost review coverage* is a statement about a
write that fails **after the run is under way**, never about a ledger that could not be created in the
first place.

**A stamp collision is fatal too, and for a different reason again.** `openLedger` creates the file with
an exclusive `wx` open, so a second run cannot append into a first one's ledger: the merged file still
*parses*, and recovery would render two runs as one, where the report and record beside it would visibly
clobber. Silent merge is the worse failure. It is refused rather than disambiguated because the stamp is
a full ISO timestamp **to the millisecond**, so a collision between two independently launched sweeps is
vanishingly unlikely. **Unlikely, not impossible** — two processes can observe the same millisecond, and
an earlier draft of this ADR said a collision *means* a stamp is being reused, which that falsifies. What the refusal buys is that the
improbable case costs a run which dies loudly at minute zero and can be relaunched, against an
alternative of two runs merged into one file that still parses. Minting a second stamp was the other
option and would leave the run's ledger and its report named differently, which is the one thing the
shared stamp exists to prevent. The ledger is created `0o600`: it carries captured stdout and
stderr verbatim.

### A recording fault must not cost review coverage — and must not become a false statement

`settle` guards the sink call. An `ENOSPC` at commit 20 would otherwise propagate out of the loop and
abandon the remaining 20 — a *recording* fault destroying *review* coverage, which is the exact failure
this mechanism exists to remove. The write is attempted, its fault is reported, and the in-memory path
carries on as the floor it was before any of this existed.

**That guard creates a second kind of absence, and the first draft of this design stated a falsehood
about it.** Once a write can fail without ending the run, a commit can be settled in memory and never
reach disk — so a missing ledger entry no longer implies the run failed to settle it, and recovery
reporting *"never settled"* is false **precisely because** the reviewer defended against a failing
disk. Caught at the plan gate, and the correction is in three parts:

1. **The hole is declared rather than inferred.** `openLedger`'s `entry()` catches its own write
   failure and attempts a far smaller `{kind:'gap', sha, why}` line — an `ENOSPC` provoked by
   a 256KB entry may well not recur for 80 bytes. Recovery renders those commits **`unrecorded`**: the
   run demonstrably settled them and the record was lost, which is a *different fact* from never having
   reached them. Only if the gap write also fails does the throw reach `settle`'s guard.
2. **`unobserved` says what it actually knows.** A commit with no line at all was either never reached
   or settled-and-lost, and nothing on disk can distinguish them. Both the outcome's prose and
   `stoppedBecause` say exactly that.
3. **A holed timeline is never presented as the streak the run took.** A gap between two recorded
   outages makes them look consecutive; a gap that *was* an outage understates the streak — wrong in
   both directions, so the direction of the error cannot even be assumed. A recovered record carries
   `timelineComplete: false` and `serverHealth` renders that as a warning above its figures.

   **`timelineComplete` is about the HEALTH timeline, and coverage completeness is a different
   question.** A missing entry can only distort the streak if the loop could have *attempted* that
   commit, and an ineligible one never can — it reaches `skipped-no-code`, which returns before both the
   clock and the counter. So a crash before a trailing docs-only commit leaves the health timeline whole,
   and warning over it would be a caveat with nothing behind it. Coverage is untouched: that commit still
   renders `unobserved` and is still disposed of exactly once. An **eligible** commit missing for either
   reason does set the flag — including an `unrecorded` one, whose `gap` line proves it was attempted and
   its outcome lost.

**Rejected: aborting after N ledger failures.** It sacrifices review coverage and still cannot persist
evidence when the storage path is refusing writes — it trades the thing being protected for nothing.
One warning per failed append is kept: at ~40 entries the volume is bounded and each names a distinct
lost record, so it is not silent.

**Every record is written leading-newline-first**, so each append is self-delimiting. Terminating is
the obvious shape and is wrong here: a part-written record leaves a fragment with no terminator, and
the next *successful* append fuses onto it — destroying a line whose own write succeeded because of a
fault that preceded it. Opening with the delimiter establishes a boundary no later failure can
retract, and `readLedger` ignores the blank first line.

**The invariant is therefore scoped**, and stating it loosely would be the same defect one level up: it
is *every settled entry **whose sink write succeeds** reaches disk before the next review starts*. The
residual exposure is not only a torn final line but arbitrary missing entries from caught write faults,
which (1) makes visible rather than eliminating — no client-side mechanism can persist a record to
storage that is refusing it.

## Consequences

- **Artifact filenames now stamp the run's START, not its end.** The ledger must be named before the
  first review, and the report it may become has to share that stamp or recovery cannot name its
  output after the run it recovers. Nothing *outside this feature* reads these filenames
  programmatically; `recover-sweep.mjs` `stampFrom` is the one reader, and it is exactly why the
  ledger and the report it becomes must share a stamp.
- **The ledger persists after a successful run.** It is a log; a run finishing does not change what it
  is. It is also the only record of the ORDER and TIMING commits settled in, which the final flattened
  JSON does not keep.
- **Ledger size is unbounded in principle.** `classify` keeps up to `MAX_RAW` (256KB) of stdout *and*
  stderr per entry, so a pathological night could write ~20MB. `bench/results` is gitignored. Accepted
  rather than fixed: bounding it would mean the ledger holding less than the record it must
  reconstruct.
- **What this does NOT do.** It changes nothing on the request path — no salvage-on-loss (OAI-138), no
  reserve change, no cap change. OAI-141 measured run-to-run spread above the differences between the
  configurations being compared, so a request-path change would break comparability with the four
  prior sweeps over this corpus.

## Verification

The check that matters is a real crash, not an injected sink asserting a call count — that is this
repo's signature failure, a check that cannot fail on the thing at stake. `tests/sweep-recovery.test.js`
spawns a child driving the real `runSweep` against a real ledger, `SIGKILL`s it mid-loop, and reads
what is on disk; then recovers a report from it and asserts the header's arithmetic agrees with the
coverage section. **Its positive control writes the header and suppresses only the per-entry writes**,
so what is isolated is the write at each settlement point rather than the module's existence.
