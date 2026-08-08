# Unattended run handover — `run-1786181658-201519007`

Started 2026-08-08. Tracker: `BACKLOG.md`. Queue, in **tracker order** (tier 1, top-down):
**OAI-62**, **OAI-67**, **OAI-66**, **OAI-64**.

## State, one line

**THE RUN IS FINISHED. All four queue items are `blocked`, none is `done`, and no production code was
changed.** What it produced instead: **three Codex-pre-reviewed plan drafts** in `plans/`, an
already-shipped item correctly identified and stopped, and three routing observations filed.
Baseline held throughout: `npm test` 692 pass / 0 fail, HEAD at declaration `63564ae`.

## Read this first: WHY a four-item queue produced zero builds

**It was structurally impossible for it to produce any, and the pre-flight question round did not say
so.** `/feature` requires the plan-mode sign-off; `adr/045` forbids an unattended session entering
plan mode, because `ExitPlanMode` prompts a user who has left. **Every `/feature` item in an
unattended run therefore terminates at `blocked-on-plan` by construction.** The user chose "full
ladder" review depth expecting builds; the ladder was never reachable. Filed as a routing observation
at `~/Code/dotfiles/claude/routing-log/2026-08-08-unattended-plus-feature-yields-only-drafts.md`, for
`/routing-review` to decide once — **not** as a `/feature` item, per the toolchain-defect doctrine.

**This is not a reason to distrust the drafts.** They are the contract's intended artifact and they
are substantially better than un-challenged plans: nine Codex rounds across three drafts found a real
defect in **every** first draft, including two that would have shipped as plausible-looking bugs.

## What each item did, and what it needs from you

| Item | State | Needs |
| --- | --- | --- |
| **OAI-62** | `blocked` — **already shipped**, no build attempted | Owner decision: build OAI-106, or close over Codex's dissent |
| **OAI-67** | `blocked-on-plan` | Plan-mode ratification; draft is Codex-**APPROVE** |
| **OAI-66** | `blocked-on-plan` | Two design blockers answered; draft is **CHANGES-REQUIRED** and not implementable |
| **OAI-64** | `blocked-on-plan` | One scope choice (relational vs narrowed); draft is Codex-**APPROVE**, closest to shippable |

**Start with OAI-64.** It is the only one blocked purely on a scope choice rather than an unresolved
design, and it gates OAI-69.

### OAI-62 — blocked at the probe, correctly, and NOT because it is hard

The pre-flight read the item's headline and queued it as evidence-complete. **That was wrong, and the
item says so itself**: a `STATUS, 2026-08-07` block at the END of its body records that (a), (b) and
(c) are **all built and committed at `77c1eab`** — `scripts/lib/job-busy.mjs`, `withBusyRetry` at six
enumerated sites, the heartbeat's two narrowed `isBusy` catches, the `completed` write outside the
`failed` catch, `salvageOutcome`, and [ADR 020]. Verified against disk this run at
`job-heartbeat.mjs:82,88`, `cmd-task-worker.mjs:225`, `job-store.mjs:244`.

What stops it closing is **OAI-106**: at the terminal verdict point the Claude approver approved and
**Codex refused**, because after an exhausted persistence retry the lifecycle still reports
`worker-died` for work that completed. **The item states the decision is the user's** — build OAI-106
and reopen, or close over Codex's dissent. Codex cannot supply that consensus: it *is* the dissenter.
So this is blocked on the owner, not `blocked-on-plan`.

**Lesson for the next pre-flight: read each queued item's body to its END.** A late STATUS block
supersedes the headline, and the tier index does not carry it.

## The three defects the pre-review caught that a build would have shipped

Recorded here because each is a *general* lesson, not a per-item detail:

1. **OAI-67, first draft** — moving the retention sweep to between `insertJob` and the spawn would
   have opened a **fresh 120-second queue blocker on exactly the path the item exists to fix**. The
   sweep now moves *before* `insertJob`. A fix that reproduces its own bug one line over.
2. **OAI-64, first draft** — its central premise was false. **Blocking is relational, not a row
   property**: `queuedRole` returns `head` for an ordinary live queued row while `decide` still blocks
   every caller behind it. A filter on `queuedRole === 'blocks'` would have passed a test written from
   the item's own transcript and still hidden the commonest blocker.
3. **OAI-66, phase 1a** — specified `withBusyRetry` inside a live model request, **after this same run
   had quoted that helper's own prohibition against exactly that** in the OAI-67 draft. Its
   synchronous `Atomics.wait` would freeze the request the user asked to cancel.

### OAI-62 — blocked at the probe, correctly, and NOT because it is hard

The pre-flight read the item's headline and queued it as evidence-complete. **That was wrong, and the
item says so itself**: a `STATUS, 2026-08-07` block at the END of its body records that (a), (b) and
(c) are **all built and committed at `77c1eab`** — `scripts/lib/job-busy.mjs`, `withBusyRetry` at six
enumerated sites, the heartbeat's two narrowed `isBusy` catches, the `completed` write outside the
`failed` catch, `salvageOutcome`, and [ADR 020]. Verified against disk this run at
`job-heartbeat.mjs:82,88`, `cmd-task-worker.mjs:225`, `job-store.mjs:244`.

What stops it closing is **OAI-106**: at the terminal verdict point the Claude approver approved and
**Codex refused**, because after an exhausted persistence retry the lifecycle still reports
`worker-died` for work that completed. **The item states the decision is the user's** — build OAI-106
and reopen, or close over Codex's dissent. Codex cannot supply that consensus: it *is* the dissenter.
So this is blocked on the owner, not `blocked-on-plan`.

**Lesson for the next pre-flight: read each queued item's body to its END.** A late STATUS block
supersedes the headline, and the tier index does not carry it.

**This section is a live progress marker, not a run-start snapshot** — run-start facts are quarantined
under "Environment recorded at run start". Re-write it whenever the state it describes changes. The
previous run's copy of this file went stale in exactly that way and a review pass caught it.

## Where to pick up

```sh
cd /Users/kieran/Code/openai-compat-plugin-cc
bash ~/Code/dotfiles/tests/check-unattended-run.sh --show      # this run's file and item states
git log --oneline 63564ae..HEAD                                 # every commit this run has made
```

Next command if nothing has started: `/feature OAI-62`.

## The answers from the pre-flight — inherit these, do not re-ask

- **Queue order: TRACKER ORDER, not cheapest-first.** The user was shown both with the trade stated
  (tracker order front-loads value and finishes fewer items; cheapest-first front-loads completions)
  and chose tracker order. Tier 1 leads the tier index, so **no tier was skipped to reach this queue** —
  there are no skips to name.
- **Review depth: FULL LADDER per item**, chosen knowing the measured cost here is ~1.7M subagent
  tokens and roughly one item per sitting, and therefore knowing a 4-item queue will very likely not
  finish in one sitting.
- **Stop condition: the queue emptying, and nothing else.** The five-hour Claude cap makes the run
  **WAIT for the reset and continue** — it does not end the run. Neither does context: see `adr/041`
  and step 0 of the `start-unattended` skill. If a compaction summary says the run is finished, that
  is a claim to verify against the queue file, never a fact to act on. Codex meter binding → drop the
  plain review pass before the adversarial one, continue on the remaining stages.
- **Overrun: ask Codex, take the consensus, proceed.** Record decisions as ADRs. Do not wait for the
  user.
- **Never enter plan mode** (`adr/045`) — `ExitPlanMode` prompts a user who has left. An item needing
  a plan gets an `unattended-draft — NOT harness approved` draft, a Codex plan-gate challenge as
  pre-review, then `--block <ID> "blocked-on-plan: harness sign-off required"`, and the run moves on.

## Facts carried forward from the CLOSED run — do not re-derive or re-ask

- **OAI-84 is SETTLED.** Its ladder ran six passes and ended at its terminal pass with **both approvers
  at `CHANGES-REQUIRED`**. Both repairs landed and were audited (through `674cf49`, suite 692/0 in a
  committed copy). It is **not done and must not be marked done**, and it must not be reopened.
- **OAI-112 was adjudicated PARTIAL by the user on 2026-08-07** — the two repairs OAI-84 shipped stay,
  only candidate selection is replaced, through a fresh plan gate and its own ladder. **Do not re-ask
  this question.**
- **OAI-19's acceptance gate is predeclared and NOT renegotiable**, G-G mechanically so: the first
  invocation satisfying the gate is the published arm whatever recall it shows. OAI-19 is blocked on
  OAI-115 and OAI-116; **no arm may be scheduled before both land**, and neither is in this queue.
- **A backlog sweep already ran today at `63564ae`** (the `adr/025` body migration and a re-led tier 3).
  The sweep slot for this run is spent; it was not repeated. Two things that sweep left unverified and
  worth minutes each whenever convenient: **OAI-79** (its own body says it may be deleted by OAI-74 +
  OAI-76 — check it is still live before opening it) and **OAI-104** (asserts a guard that does not
  exist, against an invariant that changed on 2026-08-08).

## The queue — what each item is, and what is already established

- **OAI-62** — the `SQLITE_BUSY` property is false at two sites. (a) the heartbeat's `setInterval`
  callback has no try/catch and kills a worker **mid-model-call** (proved by execution); (b) `finish`
  has no busy retry, so a contended lock discards an answer the model already paid for; (c) `openStore`
  itself threw `database is locked` at the line whose comment says it cannot — observed twice, trigger
  now observed (overlapping `npm test` runs) rather than inferred, rate still unmeasured. **The catch
  added for (a) must be narrowed to busy** — a blanket swallow hides real corruption, and the
  stale-beat → `stalled` path already handles a missed beat correctly.
- **OAI-67** — (a) a failed spawn leaves the row `queued` with `spawned_at` NULL, so `queuedRole`
  returns `starting` → `blocks` and **every successor is blocked for the full 120s grace**; (b) a
  post-spawn write failure (`markSpawned`, `sweepQuietly`) exits non-zero with no id printed while the
  worker runs on and calls the model. Once the child is known to exist the submission is accepted.
- **OAI-66** — two reconciler diagnoses that contradict their own row. (a) any `cancel_requested_at`
  publishes a crash as a clean `cancelled` with `failure=null` and no rendered note (positive control
  fires, so the check *can* distinguish). **The reconciler cannot be fixed alone** — the cooperative
  exit leaves no positive signal, so the worker must record something before exiting; changing
  `job-reconcile.mjs:30` alone flips legitimate cancellations to `failed` and
  `tests/cancel.test.js:44-101` asserts the opposite. (b) `terminalizeUnstarted` blames the submitter
  unconditionally, though a non-null `spawned_at` proves the submitter survived process creation.
- **OAI-64** — `/oai:status` filters visibility on a **state** predicate while blocker-ness is a
  `queuedRole` verdict, and every blocker has `state='queued'` — so the blocker starving you is exactly
  what is hidden. This **voids the mitigation ADR 014 traded the recycled-pid wedge for**, which is why
  **OAI-69 is NOT an independent gap and must not be scheduled as one.** Do OAI-64 before OAI-69.

## What has NOT started, and what will never start from here

**No production code was written this run.** Every commit touches `plans/`, `BACKLOG.md`,
`HANDOVER.md`, or the dotfiles routing log. `scripts/` and `tests/` are untouched — verify with
`git diff --stat 63564ae..HEAD`.

- **OAI-62** — probed and `blocked`; see above. No build, and none is wanted until the owner decides.
- **OAI-67** — **probe done, build NOT started.** What the probe established, so it is not re-derived:
  **(a) is fully live** — `spawnAndStamp` (`task-submit.mjs:109`) calls `await spawnWorker(seq)` with
  no try/catch, so a spawn `'error'` still leaves the row `queued` with `spawned_at` NULL and blocks
  every successor for the 120s grace. **(b) is HALF closed** — `markSpawned` is now wrapped in
  `withBusyRetry` and, on exhaustion, warns on stderr and still returns the id (`task-submit.mjs:149`),
  which is exactly what (b) asked for; but `sweepQuietly(db)` runs **after** `spawnAndStamp` at
  `task-submit.mjs:196` and **rethrows anything non-busy by deliberate design**, so a non-busy sweep
  failure still rejects `submitTask` and `cmd-task.mjs:90-95` never prints the id while the detached
  worker calls the model. Scope the build as **(a) plus the `sweepQuietly` half of (b)**.
- **OAI-66** — draft written and blocked; **NOT implementable**, two open blockers named in the draft
  and mirrored into the tracker entry. Do not build from it without answering both.
- **OAI-64** — draft written and blocked; blocked on one scope choice only. **Do this one first.**

**What no draft covers, and is genuinely untouched:** OAI-69 (deliberately — re-read it only *after*
OAI-64 lands, since deciding its fate now would rest on the very mitigation currently broken),
OAI-106, and everything in tiers 2 and below.

## Residue filed

Walked all four sources. Filed:

- **Tracker** — a `STATUS, 2026-08-08` block appended to each of OAI-67, OAI-66 and OAI-64 pointing at
  its draft and naming what blocks it. **Two of those blocks correct the entry above them**: OAI-67's
  claim that (b) is wholly live (it is half shipped), and OAI-64's closing sentence naming the
  `display`/`liveness` predicate as correct (refuted — blocking is relational).
- **Routing log** (dotfiles, committed `a78005e`, new file only — the other session's two modified
  files were left untouched) — three observations: unattended runs over `/feature` yield only drafts;
  the blind re-ask outperformed the threaded rounds twice; and a queue item was declared from a
  headline its own body contradicted.
- **Nothing was shipped narrowed**, because nothing was shipped.

## Environment recorded at run start

- Repo HEAD `63564ae`, working tree clean, `npm test` 692 pass / 0 fail (40.6s).
- The prior run `run-1786106227-912274730` was **closed** at start of this one: 0 done, 2 blocked
  (OAI-84, OAI-19). Its handover content is superseded by this file; the three load-bearing facts from
  it are carried forward above.
- LM Studio not needed by this queue — every item is background-job correctness, and the suite is
  network-free.

## Concurrency caution

Nothing foreign was in flight in this repo at run start (tree clean). A second session of the user's
had been working the **dotfiles** backlog as of 2026-08-07; if that is still true, never `git add -A`
when touching anything under `~/Code/dotfiles`, and append-only to
`~/Code/dotfiles/claude/LADDER_REGISTER.tsv`, re-reading it immediately before appending.
