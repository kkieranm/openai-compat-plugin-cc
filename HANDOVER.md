# Unattended run handover — `run-1786181658-201519007`

Started 2026-08-08. Tracker: `BACKLOG.md`. Queue, in **tracker order** (tier 1, top-down):
**OAI-62**, **OAI-67**, **OAI-66**, **OAI-64**.

## State, one line

**Nothing built yet — the run was declared and this handover committed before item 1 started.**
Baseline at declaration: `npm test` 692 pass / 0 fail, working tree clean, HEAD `63564ae`.

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

## What has NOT started

- **OAI-62** — not started. No probe, no plan, no code.
- **OAI-67** — not started.
- **OAI-66** — not started.
- **OAI-64** — not started.

Nothing in this queue has been begun. No commits have been made under this run.

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
