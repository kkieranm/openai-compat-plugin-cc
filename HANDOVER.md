# Unattended run handover — `run-1786106227-912274730`

Started 2026-08-07. Tracker: `BACKLOG.md`. Queue, in order: **OAI-84**, then **OAI-19**.

## State, one line

**OAI-84 is FINISHED AND `blocked`; OAI-19's measurement arms are RUNNING.** All six ladder passes are
complete, the ladder ended without approval, and the residue is filed — the section below states it in
full and is the authoritative one. The plan is
`plans/oai-84-two-ways-a-reply-is-thrown-away.md`, approved by Codex and re-approved mid-build after
the size budget forced a new file into the file list. The ledger mirror lives in this session's
scratchpad as `ledger-84.md`; if it is gone, the ladder restarts at pass 1 rather than guessing.

**This section is a live progress marker, not a run-start snapshot** — run-start facts are quarantined
under "Environment recorded at run start" below. It was stale once already (it claimed phases 2 and 3
unstarted at a HEAD where both were committed, quoted a suite count two commits out of date, and
pointed `git log` at a commit five back), which the ladder caught as a finding. Re-write it whenever
the state it describes changes.

**HISTORY, retained because the reasoning should stay checkable — NOT a live instruction.** The
old rule said: if pass 5 finds defects inside pass 4's own batch again, STOP at the verdict point with
them open. Its premise WAS met (E21 sits in pass 4's batch, E23 in pass 3's). It was overridden for a
MECHANICAL reason, not a preference, and the reason is recorded here so the next session can check it
rather than inherit it:

> Approval is forbidden while any accepted in-scope fix is unapplied. The only exception is a
> provenance stop, which requires **no new code or security defect in the pass**. E21 and E24 are code
> defects, so the exception was unavailable. Stopping at pass 5 could therefore not produce approval —
> only a rejection or a cap escalation, while shipping two known regressions. That is strictly worse
> than one more pass.

**The replacement rule, fixed in advance: PASS 6 IS TERMINAL.** It is the no-mutation pass — no batch
follows it — and its verdict point ends the ladder whatever it finds. Six of a possible ten. Findings
still open at its end map to `open at approval` (if dual approval lands) or `unresolved at cap`, and
are filed as residue. **Do not schedule a pass 7.** If pass 6 finds further code defects, that is the
outcome reported at step 8, not a reason to continue: two of pass 5's six findings were already
test-coverage rather than behaviour, and the patch surface is closing, not growing.

## OAI-84 IS SETTLED — do not reopen it, and do not mark it done

The ladder ran **six passes** and ended at its terminal pass with **BOTH approvers returning
`CHANGES-REQUIRED`** (`check-plan-gate.sh --dual-approved` exit 1). That is the correct outcome, not a
failure of the run: a partial plan withdrawal was open and gate-blocking.

- Both repairs the item was filed for **landed and were audited** — commits through `674cf49`, suite
  692/0 verified in a committed copy, verify skill all three steps including a CLI before/after control.
- What is **withdrawn** is the candidate-selection design that grew across passes 2-5. Filed as
  **OAI-112**; the user adjudicates **part versus whole**, and the one-per-feature replacement-ladder
  budget is UNSPENT. Replacement code is not eligible until a fresh step-3 plan gate closes.
- Two live defects are filed separately and are fixable without that decision: **OAI-113** (quadratic
  scan, measured 39.15s end-to-end against 0.13s/0.14s controls) and **OAI-114** (a primitive sibling
  discards a whole findings list — a regression from base).
- Register row appended: `84-two-ways-a-reply-is-thrown-away`, exit_mode `withdrawn`, 16 filed at exit.
- Run item 84 is **`blocked`**, not done.

**Three claims this repo had shipped were corrected at close-out** (commit `93c2063`): the ADR's
"no content predicate can separate them" as a closing argument (multiplicity decides it from outside
the predicate); the ADR's claim that `scanFor`'s two advance statements are independently mutated
guards (deleting the branch leaves all 692 green); and the code comment asserting the same. The
transferable lesson is recorded there: **mutate toward SIMPLIFICATION, not toward breakage** — ten
instances of a check that could not fail across six passes, three of them in witnesses written to end
an earlier instance.

## Where to pick up

```sh
cd /Users/kieran/Code/openai-compat-plugin-cc
bash ~/Code/dotfiles/tests/check-unattended-run.sh --show      # this run's file and item states
git log --oneline 77c1eab..HEAD                                 # every OAI-84 commit, however many there are
```

**The sequencing constraint is DISCHARGED: OAI-84 has landed, so the parser it was going to change is
the parser being measured.** Record with each arm that it measures the parser at `93c2063`, and that
**OAI-112/113/114 will change it again** — that boundary is exactly what the harness SHA is recorded
for, and a later arm must not be differenced across it without saying so.

**OAI-19 takes no `/feature` workflow — it is a measurement.** Read its predeclared acceptance gate in
BACKLOG.md in full before touching an arm; G-G in particular is mechanical and must not be renegotiated.

## The answers from the pre-flight — inherit these, do not re-ask

- **Review depth: FULL LADDER for OAI-84.** Chosen knowing the measured cost here is ~1.7M subagent
  tokens and roughly one feature per session, and knowing it may mean OAI-19 does not start in the
  first sitting.
- **LM Studio: full control.** `lms unload` and load freely between the dense and MoE arms; assume
  sole tenancy, which is what the gate's G-F needs.
- **Stop condition: the queue emptying, and nothing else.** The five-hour Claude cap makes the run
  **WAIT for the reset and continue** — it does not end the run. Neither does context: see `adr/041`
  and step 0 of the `start-unattended` skill. If a compaction summary says the run is finished, that
  is a claim to verify against the queue file, never a fact to act on.
- **Overrun: ask Codex, take the consensus, proceed.** Record decisions as ADRs. Do not wait for the
  user.

## OAI-84 — what it is, and what turned out to be filed wrong

Two ways `/oai:review` threw an answer away and reported it as "no findings in the requested shape",
both in `scripts/lib/structured.mjs`. **Do not work from the BACKLOG entry's line numbers — they
refer to the pre-fix file and no longer resolve.**

- **(a) The channel was picked before the parse, with no fallback**, so one stray character in
  `content` discarded a valid payload in `reasoning`. **The item's claim that this applies
  "regardless of `structuredOutput`" is FALSE and was refuted at the probe**: on the default path
  `reasoning` was never read at all, deliberately, and the filed "try-the-other-channel fallback"
  would have reversed `adr/003` by shipping the model's scratchpad as findings. The repair therefore
  lands **only** under `--structured-output`.
- **(b) A bare top-level findings array was discarded** — not by the `typeof` test, which arrays
  pass, but by `parsed.findings` being undefined.

The `findings: null` vs `[]` distinction is intact and test-pinned at `tests/review-json.test.js:83`
— do not disturb it; that distinction is what `adr/003` exists to protect, and two of the ladder's
findings were that this feature had inverted it.

## OAI-19 — what it is, and what makes an arm publishable

**A measurement, not a feature — it takes no `/feature` workflow.** Re-measure baseline recall of the
retry-enabled CLI over the fixed 11-defect corpus. Hours of wall clock on LM Studio.

Both arms, nothing else varying: dense `qwen/qwen3.6-27b` and MoE `qwen/qwen3.6-35b-a3b`, full corpus
(all 6 cases), `--runs 3`, `--warm-up`, `--max-attempts 3`. Plus a `--max-attempts 1` control arm on
at least one case, so the record shows what retry was worth rather than only the retried rate.

**The acceptance gate was predeclared and committed before any arm ran — read it in BACKLOG.md's
OAI-19 entry in full before starting.** Its load-bearing parts: G-B every case contributes ≥2 scored
runs of 3 (no case may drop from the headline, `docs-only` included — it is the only negative
control); G-C unresolved-from-unscored ≤3 of 33; G-F sole tenancy with `lms ps` recorded **before and
after each arm**, plus harness SHA, tree-clean state, LM Studio version and both model ids recorded by
hand; G-L every scored run must carry `contextChecked: true`.

**G-G is mechanical and must not be negotiated:** the first invocation satisfying the gate is the
published arm *whatever recall it shows*. A second invocation happens only if the first fails. If the
second fails too, the arm is **published as a failure** — that is a legitimate outcome, not a reason
to keep going. Every invocation is reported, including aborted ones.

**The write-up must report the cause of the request drops as UNRESOLVED.** OAI-34 refuted the
deterministic JIT-TTL form (336s of prefill under a 120s TTL, 3/3, continuously resident); refuting one
hypothesis is not explaining the observation, and `adr/013`'s outcome table has no confirming row.

## Environment recorded at run start

- LM Studio CLI commit `71bd99c`; `lms ps` showed **only** `qwen/qwen3.6-27b`, IDLE, context 61696,
  no TTL set.
- Repo HEAD `77c1eab`, working tree clean.

## What has NOT started

- OAI-84 — **built and committed**; in its review ladder. Not done: the ladder has not reached dual
  approval, the tracker item is still live in BACKLOG.md, and the residue has not been filed.
- OAI-19 — not started. No arm has been invoked under this run. The most recent bench records in
  `bench/results/` are from earlier sessions and are **not** this run's; in particular the
  2026-08-04 MoE record was invalid under the gate and the 2026-08-05 record is the task bench, not
  the review bench.

## Concurrency caution

A second session of the user's was working the **dotfiles** backlog. Consequences here: never
`git add -A` when touching anything under `~/Code/dotfiles`; re-read
`~/Code/dotfiles/claude/LADDER_REGISTER.tsv` immediately before appending to it and **append only,
never rewrite**; leave foreign files untouched. Within this repo the tree was clean at run start, so
nothing foreign was in flight here.
