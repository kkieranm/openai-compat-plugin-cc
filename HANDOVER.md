# Unattended run handover — `run-1786106227-912274730`

Started 2026-08-07. Tracker: `BACKLOG.md`. Queue, in order: **OAI-84**, then **OAI-19**.

## State, one line

**OAI-84 is BUILT — all three phases committed — and is in its review ladder.** Passes 1 and 2 are
complete and both were non-clean; pass 2's between-pass batch is landing now, and pass 3 is required
because pass 2 raised a code defect. The plan is
`plans/oai-84-two-ways-a-reply-is-thrown-away.md`, approved by Codex and re-approved mid-build after
the size budget forced a new file into the file list. The ledger mirror lives in this session's
scratchpad as `ledger-84.md`; if it is gone, the ladder restarts at pass 1 rather than guessing.

**This section is a live progress marker, not a run-start snapshot** — run-start facts are quarantined
under "Environment recorded at run start" below. It was stale once already (it claimed phases 2 and 3
unstarted at a HEAD where both were committed, quoted a suite count two commits out of date, and
pointed `git log` at a commit five back), which the ladder caught as a finding. Re-write it whenever
the state it describes changes.

## Where to pick up

```sh
cd /Users/kieran/Code/openai-compat-plugin-cc
bash ~/Code/dotfiles/tests/check-unattended-run.sh --show      # this run's file and item states
git log --oneline 77c1eab..HEAD                                 # every OAI-84 commit, however many there are
```

Then run `/feature` on the topmost `open` item. **OAI-84 must land before OAI-19 runs** — the arm
would otherwise measure a parser that is about to change, which is the same argument OAI-51 made for
suspending that run, one layer down. That sequencing is the tracker's, not a preference.

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
