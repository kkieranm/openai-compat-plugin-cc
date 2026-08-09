# Handover — 2026-08-09, session end

**Everything is committed and the tree is clean. Nothing is running.** No unattended run is open, no
background process of mine survives, and LM Studio has nothing resident.

## The one-line answer to what this session was for

**Use `qwen/qwen3.6-27b` for the overnight sweep.** It reviewed **7 of 10** pinned commits in both
runs; the MoE managed 3 and 5, starving exactly as OAI-115 predicted. The gemmas were not measured —
see OAI-133/134.

## State

- **HEAD** carries the review-sweep harness and its follow-on, plus OAI-104 (`c542e34`) and OAI-117
  (`d2396ce`). Suite **777/0** — this line said 766/0 until 2026-08-09, which those two commits made
  false; corrected in a review-ladder batch, not by the sessions that wrote them.
- **Benchmark records**: `bench/results/model-matrix-2026-08-08/` — 10 arms, ~364 KB.
  **`bench/results/` is gitignored**, so quote figures from the tracker rather than assuming these
  files survive a clean.
- **Tracker**: tier 12 (OAI-125–131) is the follow-on ladder's residue; **tier 12c** (OAI-131–134) is
  what the benchmark found.

## Stopped mid-flight, deliberately

The **gemma re-run was killed by the user about a minute in** — SSD usage spiked. Cause was almost
certainly **swap thrash, not writes**: the entire first matrix wrote 364 KB, while loading and
unloading 7–19 GB models back to back on a 36 GB machine pages hard. Models were unloaded; swap was
2.77 GB of 4 GB at the time and should have drained.

**If you resume it:** one model per sitting, `sysctl vm.swapusage` watched, and never a context that
leaves ~1.5 GB of headroom. The sized contexts are recorded in OAI-133 — they were measured by
actually loading each model, not calculated.

## What I got wrong this session, recorded so it is not re-derived

- **I reported a green suite that was not green.** A review fan-out was mutating the working tree while
  I sampled it; `lean-wide` caught the inconsistency via finder-digest mismatch and refused to report
  clean, and nothing does the equivalent for `npm test`. Routing log `8981747`.
- **I blamed the gemma failures on resident models. Wrong** — `lms ps` showed nothing loaded and it
  still failed. The real cause is OAI-134.
- **I sized contexts to *fit* and treated fitting as sufficient**, on a machine the user was using,
  without checking swap. That is what triggered the stop.
- **`serverUnwell` took five iterations** and the fourth was a regression. The rule that held reads the
  CLI's own per-budget hint. OAI-131 then measured that `idle-timeout` — the shape all that argument
  was about — never occurs here.

## Open, in priority order

**OAI-134** — `--model` cannot JIT-load; affects `/oai:task` and `/oai:review`, not just the sweep.
**OAI-125** — the resolved-SHA guarantee reaches the artifact by one untested path (mutation-proved);
the fix is a seam, because `main()` is unexported. **Until it lands, benchmark arms must pass a full
SHA.**
**OAI-128** — a new trap class: asserting presence where the code guarantees presence.
Then OAI-126, 127, 129, 130, 132, 133.

## Ladders

Two ran, both ended **`cap-without-approval`** at the computed cap of 3 — register rows
`sweep-overnight-review` and `sweep-followon-one-mapping`. That is now four such rows in the cohort,
so the evaluator will keep the cap at 3 for the next feature. Worth a `/routing-review` question:
whether a cap of 3 suits work whose region needs four or five narrowings.

The disposition ledgers lived in the session scratchpad and are **gone** with it. Both ladders are
closed and their residue is filed, so nothing depends on them.
