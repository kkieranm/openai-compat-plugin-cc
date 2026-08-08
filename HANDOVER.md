# Handover — overnight review sweep feature, mid-ladder

**This replaces the handover for unattended run `run-1786181658-201519007`, which is CLOSED** (0 done,
4 blocked; its three plan drafts are in `plans/` and its findings are recorded in `BACKLOG.md` under
OAI-67, OAI-66 and OAI-64). Nothing below reopens it.

## State, one line

**The `/feature` run for `bench/review-sweep.mjs` is in its review ladder, mid-PASS 2 of a computed
cap of 3.** Suite 730/0 at `e56e836`. The work is committed; the ladder is not finished.

## Where the durable state lives

- **Disposition ledger:** `<session scratchpad>/ledger-sweep.md` — 22 entries, their evidence, the
  batch design, the provenance assessment. **If it is gone the ladder restarts at pass 1** rather than
  guessing; that is the standing rule from the OAI-84 run and it still applies.
- **Register row:** `~/Code/dotfiles/claude/LADDER_REGISTER.tsv`, key `sweep-overnight-review`.
  `findings_per_pass` currently reads `13`; it must become `13,N` **before pass 2 closes**, and the
  `-` placeholders are filled at exit. Another session has that file modified — **re-read immediately
  before appending, append only.**
- **Approved plan:** `plans/oai-overnight-review-sweep.md` (harness slug `humble-snacking-melody`),
  approved by the USER via plan mode, Codex-challenged over 4 rounds first.

## What shipped, and the one thing it is really about

`bench/review-sweep.mjs` walks commits newest-first until a wall clock stops it and runs the real
review CLI once per commit; `bench/lib/sweep-outcome.mjs` `classify` decides what each reply means;
`bench/lib/sweep-report.mjs` renders the morning report. Decision record: **ADR 021**.

**Only `findings` and `clean` count as reviewed.** Everything else is coverage, because on this
hardware a starved run and a clean run are both an empty list (OAI-115), and a report that renders
both as silence tells the reader the opposite of the truth at the moment they can least check it.

## Ladder state

| Pass | Stages | Outcome |
|---|---|---|
| 1 | all 6 incl. `lean-wide` (genuine wide, first in this repo) | 13 accepted, 2 dismissed, 1 `widening` deferred. Verdict `CHANGES-REQUIRED`. Batch applied, green, committed `e56e836` |
| 2 | in flight — `acceptance-audit`, `advisor-opener`, `codex-adversarial` collected | 7 accepted so far (E16–E22). `codex-plain` and `lean-wide` running; `advisor-closer` owed |
| 3 | **the CONFIRMATION PASS, and terminal at the cap** | not started |

**All 7 pass-2 findings sit in pass 1's own fixes**, which triggers the confirmation pass. So **pass
2's boundary batch is the LAST one that can apply anything**; anything pass 3 raises maps to
`open at approval` or `unresolved at cap` and is filed as residue.

**Repeated semantic region, to be raised at the verdict point:** what `classify` does with the
envelope's caveat fields — accepted findings in both passes, opposite failures each time (pass 1: not
read at all; pass 2: read, but the renderer keyed on outcome rather than on the data). A repeated
region puts **REVERT** to the user as an option.

## Open, unapplied at this moment (pass 2's batch)

E16 unreachable guard in `failure()` · E17 ADR states a 4-step classification order while `classify`
checks `ENOBUFS` first · **E18 `truncated` hides the findings it did produce** (renderer only renders
`findings` entries) · **E19 caveats vanish for every non-`findings` entry** (`incompleteness()` called
only in that branch) · **E20 the `*-timeout` suffix over-corrects** — `first-byte-timeout` on a large
prompt is documented normal, so three big commits can abort a healthy sweep · **E21 `stderr` is
unbounded** while `MAX_RAW` caps only stdout · **E22 a non-string `reason` throws out of `runSweep`
and erases every later commit** (reproduced).

## What the user asked for next, and its one open question

**Benchmark first, then decide what runs overnight**: **5 models** (`qwen3.6-27b`,
`qwen3.6-35b-a3b`, `gemma-4-31b-qat`, `gemma-4-26b-a4b-qat`, `gemma-4-12b-qat`) **× 2 executions × the
same 10 commits**, **600s per-commit cap**, **whole files**, fix everything open first. ~16h worst
case, so it does not fit one night and was sequenced **after** the ladder closes.

**Blocking question for the user:** the arms are only comparable if every one enumerates the *same* 10
commits, and enumeration currently starts at `HEAD`, which the fix commits move. `--from <ref>` is the
fix and it is classified **`widening`** — nobody raised it, it is not in the approved plan, and it was
deliberately kept out of every ladder batch. It needs the user's word before it is built.

## Measured facts worth not re-deriving

- **~14 minutes** for one large commit on `qwen/qwen3.6-27b`, whole files. An 8-hour window is roughly
  30–35 commits, not 40.
- The smoke run's single finding was **fabricated** — a confident `high` claiming `scanFor` had an
  unused parameter shifting arguments; `scanFor` takes four parameters and its one call site passes
  four. **The report's "unverified claims, leads not conclusions" caveat is load-bearing, not manners.**
- `lean-wide` at genuine wide: 795k subagent tokens, 12 agents, ~8 minutes, `unadjudicated: 0`.
