provenance: harness slug glimmering-jingling-torvalds

# OAI-64 — the blocker is relational, so the display must ask "blocks whom?"

Supersedes the unattended draft `plans/oai-64-status-must-show-the-blocker-that-is-starving-you.md`,
which stays on disk as evidence: it carries the round-1 refutation that this design is built on, and a
Codex pre-review APPROVE that authorises nothing.

## Context

`/oai:status` is the only way a user finds out why a background job is not starting. This repo runs one
background job at a time, machine-wide, so the thing starving your job is routinely a job submitted from
a different checkout. The command's own comment says that naming such a row is its purpose. It does not
do it — and an earlier decision accepted a known wedge (a queued worker whose pid was recycled or
suspended) specifically *on the condition* that `/oai:status` would name the blocking pid for a human to
deal with. That condition is unmet, which is what makes this the top item on the tracker.

The intended outcome: a bare `/oai:status`, run in a workspace whose job is queued, shows the row that
is ahead of it and says what that means — while the queue's own admission rule stays in exactly one
place, so the display can never drift from what `decide` actually does.

## The defect

`job-view.mjs:127` decides what a bare `/oai:status` shows:

```js
const shown = rows.filter((row) => row.workspace === cwd || row.state === 'running');
```

That is a **state** predicate. Every row that can block a queued caller other than a running one has
`state === 'queued'`, so the job starving you is filtered out of the one command whose stated purpose,
in its own comment at `job-view.mjs:114-123`, is to name it: *"a malformed row holding the head of the
queue is the one thing a user most needs to see — hiding either because it belongs to a different
directory would leave a stuck queue with no visible cause."*

The information is not merely unshown, it is **computed and discarded**: `statusView` maps every row
through `viewOf` — which resolves `liveness` and `display`, and so the `stalled` note *"pid N is alive
but has not beaten since 10m ago"* — at line 125, one line before the filter drops it.

## What the probe established

Verified against the files by this session and independently by Codex (claims 1–5, opened and read at
the cited lines).

1. **Blocking is relational, not a row property.** `queuedRole` (`job-queue.mjs:56-62`) returns
   `blocks` only for the *pathological* queued rows — live-but-unknown-version, `starting`,
   `malformed`. An ordinary live known-version queued row returns **`head`**, and `decide` still
   blocks every caller behind it via `row.seq !== seq` at `job-queue.mjs:96`.
2. **The reproduction recorded in OAI-64 is the ordinary case, not a pathological one.** The item's
   job B is a queued row in another workspace whose waiter pid is *alive* but has not beaten for ten
   minutes. `livenessOf` returns `live` for it — a stale beat never decides death
   (`job-liveness.mjs:22-36`) — and `displayOf` reaches `stalled` only when `liveness === 'live'`
   (`job-view.mjs:94`). So `queuedRole(jobB) === 'head'`. **This is what settles fork A below.**
3. **The queued scan stops at the first non-`skip` row.** Codex refuted this session's first
   characterisation: rows after the first non-`skip` row are never examined, *including* when that row
   is the caller's own `head`. So a `blocks` row sitting behind the caller cannot block it, and any
   rule that scans the whole queued set would name the wrong row.
4. **A caller can be told `blocked` with no blocker row in existence.** `claimJob`
   (`job-record.mjs:158`) returns false on a `waiter_pid` mismatch and `decide` maps that to
   `blocked`. Fork C below.
5. **`noteFor` (`job-render.mjs:59-62`) describes every `malformed` row as "running with no worker pid
   recorded".** That is false for a malformed **queued** row, which `livenessOf:85-87` reaches when
   `waiter_pid` is null and `spawned_at ?? created_at` will not parse — and this change is precisely
   what starts showing such rows.
6. **No extra probe is needed.** `viewOf` has already resolved `liveness` for every row before the
   filter runs, so the display can consult it without asking the OS about a pid twice.

**One probe finding does not survive:** the item and the draft both justify this work by citing
`adr/014` ("accepts the recycled-pid wedge on the stated condition that `/oai:status` names the
blocking pid"). The `adr/` corpus was deleted on 2026-08-13 (OAI-159), so that citation now resolves to
nothing and cannot be checked. **The defect stands on the code alone** and this plan cites no ADR. The
constraint it used to carry is restated inline where it is needed, per the docs step's rule that a
constraint a future editor would tidy away goes in a comment at the code it protects.

## The forks, and how they were settled

Settled by agreement between this session and Codex, under the user's standing rule for this run: where
both recommend the same option, proceed; where they differ, ask. There was no divergence.

- **Fork A — how far the fix goes. → A1, RELATIONAL.** Show an off-workspace queued row when it is
  genuinely ahead of one of *this* workspace's queued rows in `seq` order, sharing the queue's real
  head rule with `decide`. The rejected alternative (A2, admit only the pathological blockers by
  reusing `queuedRole(row) === 'blocks'`) is refuted by probe finding 2: **it would not fix the
  scenario the item was filed about**, and would ship a guard that passes a test written from the
  item's own transcript while hiding the commonest blocker there is.
- **Fork B — what the admitted row looks like. → B1, MARKED.** The row prints an explicit line saying
  what its being there means for this workspace. Unmarked, an off-workspace row appears under a header
  reading `N background jobs, <cwd>` with no stated reason for being there. It would carry its
  workspace line (`job-render.mjs:109` already prints one for any shown row from another directory,
  which is how the `state === 'running'` exception reads today) — that is attribution, not explanation.
- **Fork C — the unattributable block. → C1.** The display shows a blocker when one exists and says
  nothing when none is identifiable. C2 (state that no blocker could be named) was rejected because its
  condition would also fire when this workspace's row is currently eligible, and because no witness can
  be constructed for a `claimJob` mismatch on a row `decide` has just read as queued — this repo does
  not ship mechanisms no test can fire.

## Design

**One definition of the queue's head, exported from `job-queue.mjs` and consumed by `job-view.mjs`.**
Two copies of an admission rule is the defect class the repo contract names, and a copy would drift the
moment `queuedRole` gains a case.

```js
// job-queue.mjs
export function scanQueued(rows, livenessAt, onSkip) // rows ASCENDING by seq
  → { head, role }
```

- Walks the rows in order. For each, resolves `livenessAt(row)` and classifies with `queuedRole`. A
  `skip` row is handed to `onSkip(row, liveness)` **immediately, before the next row's liveness is
  resolved**, and the walk continues. The first non-`skip` row is returned as `head` with its `role`
  (`head` or `blocks`); rows after it are never touched.
- `head` is `null` when every queued row skips, or there are none.
- **`onSkip` is a callback rather than a returned list, and that is load-bearing.** An earlier draft of
  this design returned the skipped prefix for the caller to reconcile afterwards, which is **not**
  behaviour-preserving: today `decide` reconciles each skip before probing the next row, and
  `livenessOf` consults the OS at call time, so a process dying *during* a reconcile can change a later
  row's answer. Batching the probes ahead of the reconciles would turn a `tryAcquire` that makes
  progress into one that returns `blocked`. Rare, and in the safe direction, but it is a verdict change
  and this plan does not make one. The callback preserves the interleaving exactly.
- **Only the queued loop is extracted.** The running-rows loop at `job-queue.mjs:82-86` stays where it
  is and is not touched, or "no verdict changes" is false.

**`decide` is rewritten onto it and its verdicts do not change.** It passes
`(row) => livenessOf(row, nowMs)` and an `onSkip` that calls `reconcile(db, row, { nowMs, at, liveness })`
— the same call, in the same place in the sequence, as today. It then acts on the head exactly as the
current lines 91-97 do: `blocks` → `blocked`; `head.seq !== seq` → `blocked`; otherwise `claimJob`.
`head === null` → `gone`, which is where the current loop falls through to.

**`statusView` admits the blocker.** It selects the views with `state === 'queued'`, sorts them
**ascending by `seq`** — **not** `listJobs` order, which is `seq DESC`, and reading "ahead of me" off it
would invert the comparison and name a plausible wrong row — and runs `scanQueued` over them with
`(view) => view.liveness`, the value `viewOf` already computed, and a no-op `onSkip`: **`statusView`
reconciles nothing.** `cmd-status.mjs:55` has already run `reconcileAll`, and on a read-only database
deliberately has not.

The blocker is admitted when all five hold:

1. a `head` exists, and
2. `head.workspace !== cwd`, and
3. some row with `workspace === cwd && state === 'queued'` has `seq > head.seq`, and
4. that row has no `cancel_requested_at`, and
5. that row's `liveness` is `live` or `starting`.

**Condition 5 was added by REVIEW PASS 1 and REVERSES what this plan previously recorded as an
accepted imprecision** — the reversal is the user's decision, taken after Codex and this session
disagreed. The superseded text said the witness "need not be viable", justified by *"`decide` blocks
such a row too, so disqualifying it here would make the display disagree with the queue."* That
justification is **unfalsifiable**: a row with no caller issues no `tryAcquire`, so it produces no
verdict for the display to disagree with.

**Condition 5 is a conservative evidence threshold, not a claim about what can never happen.** The
marker is a causal sentence the user acts on, usually by killing a job in another checkout, so it is
printed only on positive evidence that something here is waiting; absence of evidence reads as no. Two
limits are accepted rather than solved, and the mid-build gate is what forced both into the record:

- **A `malformed` row is not permanently caller-less.** `registerWaiter` can still attach a worker to
  it, after which it reads `live` and is admitted. So excluding it hides the blocker for that window —
  a **transient false negative**, taken deliberately over a confident false accusation. An earlier
  draft of this amendment said "nothing will ever ask the queue" about such a row; that is false as a
  property of the row, and true only of the row *in its current shape*.
- **`live` proves only that the pid NUMBER exists.** `isAlive` asks the OS about a number, so a dead
  worker whose pid was recycled satisfies condition 5 and the marker can still name a healthy foreign
  job. That is the recycled-pid wedge this whole item sits downstream of — not something a display
  predicate can close, and precisely why `/oai:status` naming the blocker was the mitigation traded
  for accepting it.

`starting` is admitted and that is the load-bearing half of the condition: `registerWaiter` runs in
the **worker** (`cmd-task-worker.mjs:262`), so an ordinary submission is `starting` for its whole spawn
window. The narrower predicate first proposed in review — "claimable now", i.e. `queuedRole === 'head'`
— was rejected for exactly this: it would hide the blocker from a normally submitted local job, and
from a live unknown-version row whose newer-plugin waiter is a real waiting process.

Condition 3 is the relational half and is exact in one direction: `head` is the first non-`skip` queued
row, so any queued row behind it reaches it in `decide`'s loop and is returned `blocked`. A local queued
row *ahead* of the head is by construction a `skip` row — dead or never-started — and is not being
starved. **Condition 4 is what Codex's round-1 challenge added**: `decide` returns `cancelled` at
`job-queue.mjs:77` *before* it scans the queue, so a local queued row with a pending cancellation is
never blocked by anything and cannot serve as the witness that someone is being starved.

The admitted row joins `shown` as an **extra disjunct in the existing filter**, never as an append — an
append would list twice any row that already passes the predicate.

`statusView` returns `{ shown, elsewhere, blockingSeq }`, and **computes `blockingSeq` on the `--all`
path too** rather than returning early without it — the marker is as useful there, and an absent field
is a shape the renderer would have to special-case. `elsewhere` stays `rows.length - shown.length`, so
it self-corrects as `shown` grows and the blocker can never be both displayed and counted as hidden.

**The marker, and why its wording is not "takes its turn first".** `renderList` prints one extra line
against the view whose `seq === blockingSeq`, saying the row **must clear before this workspace's queued
job can proceed**. Codex's round-1 challenge refuted the earlier wording: a `blocks` head — malformed,
`starting`, unknown-version — may never take a turn at all; it holds the line until a human deals with
it. The adopted wording is true of both a live head that will run and a pathological one that will not.
The marker is the **only** relational statement in the renderer, and it is printed only for the row the
scan identified.

**`noteFor` stays a pure, non-relational function of one row.** Its signature is unchanged — it keeps
`(view, nowMs)` and gains **no queue-context argument** — and it makes no claim about who is waiting:
it is also called by `renderDetail`, which renders one row addressed by id from any directory and has
no queue in front of it at all. ("Relational" here means
caller-dependent — true for one asking row and false for another. It is *not* a synonym for "about the
queue": the running-`malformed` note's *"It blocks the queue"* stays, because a running row that is not
provably dead blocks **every** caller at `job-queue.mjs:82-86`, which makes it a row property.) Its
`malformed` branch splits on `view.state`:

- **running** — today's wording, unchanged, including *"It blocks the queue"*. For a running row that is
  unconditionally true: `decide` blocks on any running row that is not provably dead.
- **queued** — new wording, saying the row is queued with a timestamp this build cannot read and that
  **while it remains in this shape** this build will neither start nor collect it. Two constraints on
  that sentence, both from Codex's round-2 challenge:
  - **The condition is not decoration.** A malformed *queued* row is malformed because its
    `waiter_pid` is null and its stamp will not parse — and `registerWaiter`
    (`job-record.mjs:137`) can still supply that pid, after which `livenessOf` returns `live` from the
    pid branch without ever reaching the timestamp. So the state is escapable, and
    `queuedRole`'s own comment at `job-queue.mjs:58` already says something may yet come of such a row.
    An unconditional "will not be started" would contradict it.
  - **It must not claim to block the queue.** A malformed queued row sitting behind another non-`skip`
    head does not currently hold the line, and `noteFor` has no way to know which it is. That
    relational claim belongs to the marker or nowhere.

## Phases

**Phase 1 — `scanQueued` in `job-queue.mjs`, and `decide` rewritten onto it.** No verdict changes.
Run `npm test` — `queue.test.js`, `queue-reconcile.test.js`, `queue-guards.test.js`, `cancel.test.js`
and `background.test.js` are the ones that speak for this path.

**Phase 2 — `statusView` admits and reports the blocker.** Returns `blockingSeq` on both paths.
Comment states that the admission is a **derived, relational** verdict rather than a state, and that
the same row is a blocker for one caller and not another — a comment saying "blocks" without saying
"blocks whom" would re-plant the premise the draft's round 1 removed. Comment also records why
condition 4 exists, since a future editor would read it as redundant, and why condition 5 admits
`starting` — a reader who tightens it to "claimable now" breaks the ordinary submission window. The
comment must state the live-caller argument for the exclusion, **not** the disagree-with-`decide`
argument an earlier revision used, which was unfalsifiable for precisely the rows it was about.

**Phase 3 — the renderer, and one comment that now contradicts the code.** `renderList` prints the
marker for `blockingSeq`; `noteFor` splits the `malformed` branch by state, leaving the running wording
byte-identical so `tests/status.test.js:132-147` still speaks for it. In the same phase, correct
`livenessOf`'s docblock at `job-liveness.mjs:72-76`, which says of the two malformed shapes that
"**Both** block the queue": that is unconditionally true only of the running shape, and this change is
what makes the difference observable. The corrected comment is scoped to **callers that reach the
scans at all** — `decide` returns `cancelled` at `job-queue.mjs:77` before either loop, so a caller
with a pending cancellation is blocked by neither shape, which is the same fact admission condition 4
turns on. Within that scope it says the running shape blocks **every** such caller, while the queued
shape blocks those behind it **only when it is the first non-`skip` queued row** — with an ordinary
head at `seq=1`, a malformed queued row at `seq=2` and a caller at `seq=3`, `decide` stops at `seq=1`
and never examines the malformed row at all. Either an unqualified "both block the queue" or a bare
"blocks those behind it" is the same unconditional attribution the `noteFor` split exists to remove,
one file over. This is a comment fix at the code it describes, which is where the docs step says such a
constraint belongs.

**Phase 4 — tests, in a NEW file `tests/status-blocker.test.js`.** `tests/status.test.js` is at 201 of
its 300-line ceiling and this needs more than it has room for; `tests/structure.test.js` is at 299 of
300 and no ceiling is raised by this work — its `ALLOWLIST` is empty and the 300-line budget is the
default for every file, so a new test file needs no entry; `job-queue.mjs` (176), `job-view.mjs` (129)
and `job-render.mjs` (153) all have room, and every function added stays under the 60-line function
ceiling. Cases:

1. **The ordinary off-workspace head** — live waiter pid, known version, in another workspace, with a
   local queued row behind it. Assert `statusView` shows it, that the marker renders, **and** that
   `tryAcquire(db, localSeq, localPid)` returns `blocked` in the same run. Both must hold together or
   the test proves a row is visible without proving it is the cause. This is the case A2 would have
   missed.
2. **All three pathological shapes** — `starting` (null waiter pid, inside the 120s grace),
   `malformed` **queued** (null waiter pid and an unparseable `created_at`/`spawned_at` — note
   `insertSynthetic` always writes a parseable stamp, so this row needs a raw `withStore` UPDATE),
   and live-but-unknown-version (`version: 99`, live waiter pid). They take three different routes to
   `blocks` and a fix admitting one would pass a single-shape test. **Each shape gets its own scenario**
   — Codex's round-5 caution: put all three in one queue and only the lowest-`seq` one is ever the head,
   so the other two would go unexercised while the test still passed.
3. **The malformed queued row's note does not claim it is running, does not claim it blocks the queue,
   and states its condition as conditional rather than permanent.** Paired with an assertion that a
   malformed **running** row still says both of the things the queued one may not.
4. **A cancelled local row is not a witness** — off-workspace head, local queued row behind it carrying
   `cancel_requested_at`: nothing is admitted. This is Codex's round-1 finding, and without it the
   command would name a blocker for a job that `decide` returns `cancelled` for before it ever scans.
5. **No false positive** — head is local: nothing extra is admitted, and an unrelated off-workspace
   queued row stays in `elsewhere`.
6. **No local queued row** — an off-workspace head stays hidden and stays counted in `elsewhere`.
7. **The count is honest** — the admitted blocker is not also counted in `(N more elsewhere)`.

Added at review pass 1, with condition 5 and the `--all` findings:

8. **A local witness with nothing waiting on it admits nothing** — foreign live head, local queued row
   that is `malformed`: `blockingSeq` is null and the head stays counted in `elsewhere`.
9. **A local witness whose worker is still booting DOES admit** — foreign live head, local `starting`
   row: marked, and `tryAcquire` returns `blocked` in the same run. This is the case the rejected
   "claimable now" predicate would have broken, so it is pinned permanently.
10. **`--all` marks the blocker and keeps its workspace line** — `blockingSeq` names the same row
    `--all` shows, `elsewhere` is 0, and the marked row still prints the directory it lives in, since
    a sentence saying a job is holding yours up with no directory to look in names a cause the reader
    cannot act on.
11. **The cancellation fixture also asserts `tryAcquire` returns `cancelled`** — condition 4's premise
    lives in `decide`, in another file, and nothing else pins that the cancel check precedes the scan.

## Verification

**Phase 5 — verify, with the positive control.** Run the repo `verify` skill
(`.claude/skills/verify/SKILL.md`): the full `npm test` suite, a real plugin load
(`claude --plugin-dir . -p "/oai:setup"`) and a delegation round trip. Quote the observed green summary
line rather than asserting it ran.

Then the mutation check on the key invariant: revert `statusView`'s new clause, or invert the `seq`
comparison — the failure mode Codex named in the draft, which looks entirely plausible — prove the
mutation landed with `~/Code/dotfiles/tests/mutation-landed.py`, run the suite, **name the test that
failed**, restore, prove the restore by `diff` against the pre-mutation copy, and re-run green.

## What this does not do

- **It does not change what blocks the queue** — only what is shown. Any change to `queuedRole`'s
  verdicts is out of scope.
- **It does not decide OAI-69's fate.** OAI-64 gates it; re-read OAI-69 after this lands rather than
  deciding it now on the strength of the mitigation currently broken.
- **It does not fix the dead `adr/` citations** across the tracker — that is OAI-159, filed already.
- **It writes no ADR.** There is no corpus and no obligation; the decision is recorded in the commit.

## Risks

- **`decide` is the transaction-critical path.** The extraction is behaviour-preserving because
  `onSkip` keeps the probe/reconcile interleaving, but it is the one part of this change that could
  cost two concurrent model calls if wrong. Phase 1 runs the queue suites before anything else is built
  on it.
- **`seq` ordering.** `listJobs` is `DESC`; a comparison read off it inverts and names a wrong row that
  looks entirely plausible. Named in phase 2 and mutated in phase 5.
- **Read-only databases.** On a newer-schema database `reconcileAll` is skipped, so `statusView` sees
  uncollected dead rows. `scanQueued` skips them, which is the same answer `decide` would give.
- **A witness that cannot itself run** — CLOSED by condition 5, added at review pass 1. A local
  malformed or dead-waiter queued row survives `reconcileAll` on the *writable* path as well as the
  read-only one, so it really does reach `blockingSeqFor`; it is now excluded. Three residues remain,
  all named rather than solved: a `starting` row whose spawn actually died is admitted until the grace
  expires and `reconcileAll` collects it as `never-started` — that is the queue's own uncertainty
  (`job-queue.mjs:58-60`), and the display matching it is correct; a `malformed` row whose worker is
  mid-boot has its blocker hidden until `registerWaiter` runs; and a **recycled pid** reads `live`, so
  the marker can still name a foreign job on behalf of a local job whose worker is gone. The last is
  the wedge OAI-64 exists downstream of and cannot be closed here.
