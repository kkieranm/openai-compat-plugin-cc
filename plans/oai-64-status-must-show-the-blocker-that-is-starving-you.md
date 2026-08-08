# OAI-64 — `/oai:status` must show the blocker that is starving you

**STATE: `unattended-draft — NOT harness approved`.**

Not a plan in the `/feature` sense; no code may be written from it. Drafted during unattended run
`run-1786181658-201519007` with the user away, under `adr/045`. The Codex verdict at the end is
**pre-review, never authorisation**. No harness slug — this never entered plan mode.

## The item

**OAI-64**, tier 1, and the one item in this run's queue whose fix is **local, evidenced and free of
any open design fork**.

`job-view.mjs` `statusView` filters visibility with

```js
const shown = rows.filter((row) => row.workspace === cwd || row.state === 'running');
```

— a **state** predicate. But blocker-ness is not a state. It is a `queuedRole` verdict in
`job-queue.mjs`, which returns `blocks` for a queued row that is live-but-unknown-version, `starting`,
or `malformed`, and `decide` additionally treats the plain queued head as blocking. **Every one of
those blockers has `state = 'queued'`**, so none of them satisfies the `=== 'running'` exception. A
blocker in another workspace is therefore filtered out of the very command whose job is to name it.

**The file asserts the opposite in its own words**, immediately above the defect: *"a malformed row
holding the head of the queue is the one thing a user most needs to see — hiding either because it
belongs to a different directory would leave a stuck queue with no visible cause."* That is the
intent; the predicate does not implement it.

**Executed** (recorded in the item): `tryAcquire(A)` returns `blocked`, yet `statusView` shows only
job A plus `(1 more elsewhere — pass --all)`. `viewOf(jobB)` had the note **ready** — *"pid N is alive
but has not beaten since 10m ago"* — and it was never reached, because the row was filtered out one
step earlier. **The information is computed and then discarded.**

## Why this outranks its neighbours

**It voids the mitigation `adr/014` traded the recycled-pid wedge for.** That ADR accepts the wedge
*on the stated condition* that `/oai:status` names the blocking pid for the user to deal with by hand.
It does not. So:

- **OAI-69 is not an independent gap and must not be scheduled as one** — it is the accepted
  consequence whose acceptance depends on this working. Fix this first; then re-read OAI-69 to see
  what, if anything, is left of it.
- Reproducing it needs **no second plugin build**: one queued waiter whose pid was recycled or
  suspended suffices.

## The design — CORRECTED at round 1, because the draft's central premise was false

The first draft said blocker-ness has exactly one definition, `queuedRole`, and that exporting it
settles the matter. **That is wrong, and the correction is the most useful thing in this draft.**

**Blocking is RELATIONAL, not a property of a row.** `queuedRole` returns `blocks` only for the
*pathological* queued rows — `starting`, `malformed`, live-but-unknown-version. A perfectly ordinary
queued row that is live and known-version returns **`head`** — and `decide` still returns `blocked` to
every caller behind it, via its `row.seq !== seq` branch. So **an off-workspace queued head starving a
local waiter is exactly the case the item is about, and `queuedRole(row) === 'blocks'` does not catch
it.** A filter built on that predicate alone would ship, pass a test written from the item's own
transcript, and still hide the most ordinary blocker there is.

This means *"one exported predicate"* and *"show anything that blocks the queue"* **cannot both be
satisfied by a row-only predicate**, because the question "does this block?" has no answer without
asking "block *whom*?". Two admissible resolutions, and **the build may not pick between them
unattended** — they differ in what the command promises:

1. **Relational (matches the item's stated goal).** Show an off-workspace queued row when it precedes
   one of *this* workspace's queued rows in `seq` order — i.e. when it is genuinely ahead of something
   local. The predicate takes the local rows as an argument, not just the candidate row. Answers
   "what is starving me" correctly, including the ordinary-head case.
2. **Narrowed (cheaper, and honest if stated).** Restrict OAI-64 to the *pathological* blockers only —
   `starting`, `malformed`, unknown-version — and say plainly, in the item and in the command's help,
   that an ordinary off-workspace head is still summarised as `(N more elsewhere)`. This is a real
   reduction in scope, not a simplification, and `adr/014`'s mitigation is only partly restored by it.

**What remains settled either way:** the rule is exported from `job-queue.mjs` and consumed by
`job-view.mjs`, never re-derived — two copies of an admission rule is the defect class this repo's own
contract names (*"One definition, or one guard"*), and a copy would drift the moment `queuedRole`
gains a case. Under resolution 1 the exported thing takes both operands; under 2 it is `queuedRole`
itself.

Note `statusView` already computes `viewOf(row)` for every row *before* filtering, so `liveness` is in
hand at the filter and no extra probe is needed. Double-probing is not a risk here: `reconcile`
already accepts a caller-supplied `liveness` precisely so a row is never asked twice.

## Proposed phases

**Phase 0 — pick the resolution.** Relational or narrowed, per the section above. **This gates every
phase below** and is not the build's to choose.

**Phase 1 — one exported predicate.** Give `job-queue.mjs`'s blocker rule a name and export it, with
`decide` continuing to use it so there is provably one definition. Do not change what it decides.
Under resolution 1 the export takes the asking rows as well as the candidate; under 2 it is
`queuedRole` as it stands.

**Phase 2 — the filter admits blockers.** `statusView`'s predicate becomes *this workspace's rows, or
anything running, or anything that blocks the queue*. State in the comment that the third clause is
a **derived** verdict rather than a state, since that distinction is the whole defect — and, under
resolution 1, that it is **relational**, so the same row can be a blocker for one caller and not for
another. A comment that says "blocks" without saying "blocks whom" would re-plant the premise round 1
removed.

**Phase 2b — the malformed note must stop lying.** Round 1 found a rendering mismatch the fix would
otherwise expose: `job-render.mjs`'s `noteFor` describes **every** `malformed` row as *"running with
no worker pid recorded"*, but a malformed **queued** row is reachable (e.g. an invalid queue
timestamp) — and this change is precisely what starts showing those rows to users. Showing a row with
a false explanation of why it is stuck defeats the item's own purpose. Split the note by state, or
word it so it is true for both. **This is in scope**: it is created-by-this-change visibility, not a
pre-existing defect to file and walk past.

**Phase 3 — the count must stay honest.** `elsewhere` is computed as `rows.length - shown.length`, so
it corrects itself as `shown` grows — but assert it, because a user who is now shown the blocker must
not also be told it is hidden. The `(N more elsewhere — pass --all)` line and the newly-shown row must
never describe the same row.

**Phase 4 — tests, with a control that fires.** Reconstruct the executed scenario: job A in this
workspace queued behind job B in another workspace whose pid is alive but stale. Assert `statusView`
now shows B **and** renders its note (*"pid N is alive but has not beaten since …"*), and that
`tryAcquire(A)` is `blocked` — the two must be true in the same run, or the test proves only that a
row is visible, not that the visible row is the cause.
**The positive control is mandatory and must be run against the pre-fix predicate**, showing the same
assertion fails there. This repo has recorded ten instances of a guard that could not fail, three of
them in witnesses written to end an earlier instance.
Cover **all three** pathological shapes — `starting`, `malformed`, and live-but-unknown-version — not
just the one from the item's transcript; they take three different routes to `blocks` and a fix that
only admits one of them would pass a single-shape test.
**And under resolution 1, a FOURTH case that no `queuedRole` verdict covers: the ordinary
off-workspace queued head** — live, known-version, `role === 'head'` — with a local waiter behind it.
That case is the one round 1 proved the original design would silently miss, so it is the test that
distinguishes a real fix from a plausible one. Under resolution 2 it is instead an **explicit
assertion that the row stays hidden**, so the narrowed scope is recorded as a decision rather than
discovered later as a gap.
For phase 2b, assert a malformed **queued** row's rendered note does not claim it is running.

**Size note:** `tests/structure.test.js` is at **exactly 300 of 300** (OAI-28) and cannot take another
guard without a deliberate ceiling raise, which is a separate commit that says why. Nothing here plans
one.

## What this draft does not do

- It does **not** touch OAI-69, and it does not decide whether OAI-69 survives. Re-read that item
  *after* this lands; deciding its fate now would be doing so on the strength of the very mitigation
  currently broken.
- It does **not** change what blocks the queue — only what is shown. Any change to `queuedRole`'s
  verdicts is out of scope and would need its own gate.
- It does not address **OAI-66/OAI-67**, whose drafts are adjacent in this run but share no code path
  with the view.

## Two implementation notes from the pre-review — consequences, not open decisions

Both stated by Codex at round 2 as direct consequences of the design, and recorded so the build does
not rediscover them:

- **Apply the exported verdict only to QUEUED candidates.** It classifies queued rows; handing it a
  running or terminal row asks a question it does not answer.
- **Compare `seq`, not `listJobs()`'s order.** `listJobs` returns rows in **descending display**
  order, so "ahead of me in the queue" is a `seq` comparison and reading it off the list order would
  invert it — a bug that would show the wrong row as the blocker while looking entirely plausible.

## Codex pre-review of this draft

**A verdict attaches to the exact bytes challenged and expires on amendment.**

| Round | Form | Digest | Thread | Verdict |
| --- | --- | --- | --- | --- |
| 1 | threaded | `8a24d801bbbd` | `019fe0d7-369b-7692-b802-25c711bae342` | CHANGES-REQUIRED (premise false) |
| 2 | **blind** | `aa16e596d84c` | `019fe0d9-007c-7521-a685-1e3e1ad9e080` | **APPROVE** |

Round 2 verbatim: *"The plan is implementable. The relational resolution can share the queue's actual
ordering rule with `decide`; the narrowed resolution can safely consume the exported queued-only
classification. The existing rendering defect is real and appropriately in scope. … No genuine defect
in the settled constraints."*

The round-2 verdict **was** piped through `check-plan-gate.sh --extract`, which read
`VERDICT: APPROVE DIGEST:aa16e596d84c` and exited 0 — so this one is a parsed verdict, not an
eyeballed one.

**No `plans/oai-64-…approved/` archive was written, deliberately** — same reason as the OAI-67 draft:
`--approved` records an approval *crossing the step-3 gate*, and this one did not. The draft never
entered plan mode and carries no harness slug; writing an archive would let a later session read the
gate as closed.

**Round 1 refuted this draft's central premise** — that blocker-ness is a row property with one
definition. That is worth carrying forward on its own, independently of this item: it is a fact about
`job-queue.mjs` that is easy to get wrong twice.

**This item remains blocked only on phase 0** — relational versus narrowed. Unlike OAI-66, nothing
here is unresolved *in principle*: both resolutions are fully specified and either could be built
immediately once chosen. **Of the three drafts this run produced, this is the one closest to
shippable.**
