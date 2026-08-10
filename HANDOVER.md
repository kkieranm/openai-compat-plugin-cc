# Handover — 2026-08-10

**Everything is committed and both trees are clean. Nothing is running.** The overnight sweep
finished on its own; no ladder pass marker or batch token exists; LM Studio holds nothing.

## FINISHED: the overnight review sweep

```
node bench/review-sweep.mjs --from 2f170b28871e910bbad8697b2e6037eadafe0bb9 \
  --minutes 600 --provider lmstudio --model qwen/qwen3.6-27b \
  --out-dir bench/results/sweep-2026-08-09-overnight
```

Ran **2026-08-09 20:39 → 2026-08-10 05:01 BST (8h22m)** and stopped because **every enumerated commit
was settled** — not on its 10-hour bound. **The first sweep ever run to completion here.**

**76 enumerated · 40 eligible · 18 reviewed.** skipped-no-code 36 · **failed 20, every one
`deadline-timeout`** · findings 11 · clean 7 · unreadable 1 · starved 1.

- **The result is OAI-138**: half the eligible corpus was lost to `--max-seconds 900`, a cap
  *inherited* from the harness's first commit rather than chosen. It also inverted OAI-115 —
  starvation once, wall-clock exhaustion twenty times, zero transport drops.
- **Two findings were verified by hand**; the rest are unverified small-model claims. `readOmlx`'s
  empty-`models` fallback is **real** and is now OAI-137. The `caveats.mjs:167` "high" syntax-error
  claim is **false** — the string is single-quoted and those backticks are literal markdown; the file
  parses and the suite never went red.
- **Artifacts**: `bench/results/sweep-2026-08-09-overnight/review-sweep-2026-08-10T04-01-56-336Z.{md,json}`.
  **`bench/results/` is gitignored.** The disposition table lives in OAI-138, but the **JSON is the
  only copy of the per-attempt timings** the cap calibration needs — read it before any clean.
- **`--from` took a full SHA on purpose** — OAI-125 is open, so until that seam lands the resolved-SHA
  guarantee reaches the artifact by one untested path and short revs must not be used here.

Everything below describes the 2026-08-09 session that preceded it.

## The one-line answer to what this session was for

**The multi-provider premise was validated against a second real server, and it changed a decision.**
oMLX 0.5.7 JIT-loads a model on demand; LM Studio 0.4.20 attempts it and may refuse for memory. That
single fact refuted OAI-134's planned fix — a "model is not loaded" warning would have fired on
oMLX's *normal successful path*. An hour with a second vendor found more than three review passes.

The earlier half of the session stands: **use `qwen/qwen3.6-27b`** for the overnight sweep (7 of 10
pinned commits in both runs; the MoE managed 3 and 5, starving as OAI-115 predicted). The overnight
sweep was **deliberately killed by the user** to give the machine to the oMLX validation. It was the
right call.

## State

- **HEAD** carries OAI-134 (`d2dd70e`) and its residue (`4fa7d7c`), on top of the review-sweep
  harness, OAI-104 (`c542e34`) and OAI-117 (`d2396ce`). **Suite green at HEAD; run `npm test` for the
  count.** No figure is quoted here on purpose: this line described *HEAD*, which moves, and the
  number was hand-copied from a run taken before the commits it described. It was false as 766/0,
  then corrected to 777/0 in a review-ladder batch that itself added two tests and made it false
  again. A dated figure against a named commit is a record and belongs in `BACKLOG_DONE.md`; a figure
  against a moving HEAD is a claim that rots.
- **Benchmark records**: `bench/results/model-matrix-2026-08-08/` — 10 arms, ~364 KB.
  **`bench/results/` is gitignored**, so quote figures from the tracker rather than assuming these
  files survive a clean.
- **Tracker**: **tier 12d leads (OAI-138, OAI-137)**, filed 2026-08-10 from the completed sweep;
  tier 12c holds OAI-136 and what the benchmark found; tier 12b is the follow-on ladder's residue.

## Servers, as left

- **LM Studio** on `:1234`, app **0.4.20+1**, CLI commit `71bd99c`. **Nothing resident** — the sweep
  ended and the model aged out on its 10-minute TTL; `lms ps` is empty. Current ids are
  `qwen/qwen3.6-27b` and `qwen/qwen3.6-35b-a3b` plus three gemmas.
- **oMLX 0.5.7** on `:8000`, served by the **DMG menu-bar app**. It was installed **twice** — once via
  CLI, once via DMG — and the user flagged the possible conflict; the DMG app is what answered. Its
  key is wired through **`apiKeyEnv: OMLX_API_KEY`**, not a config file, so a fresh shell must export
  it or `/oai:setup` reports the variable empty (that is what it currently shows in a subprocess).
  **The key was pasted into a session transcript — rotate it in the oMLX UI.**
- `mlx_lm.server` on `:8001`, incidental.

## What I got wrong this session, recorded so it is not re-derived

- **I reported a green suite that was not green.** A review fan-out was mutating the working tree while
  I sampled it; `lean-wide` caught the inconsistency via finder-digest mismatch and refused to report
  clean, and nothing does the equivalent for `npm test`. Routing log `8981747`.
- **I blamed the gemma failures on resident models. Wrong** — `lms ps` showed nothing loaded and it
  still failed. The cause was OAI-134's *symptom*; its filed *mechanism* was then also wrong (below).
- **I sized contexts to *fit* and treated fitting as sufficient**, on a machine the user was using,
  without checking swap. That is what triggered the stop.
- **`serverUnwell` took five iterations** and the fourth was a regression. The rule that held reads the
  CLI's own per-budget hint. OAI-131 then measured that `idle-timeout` — the shape all that argument
  was about — never occurs here.
- **A mutation proof grepped for a line `node --test` never emits.** Both directions printed nothing
  and I read the silence as the mutation firing. Only the positive control caught it. Same class:
  **a check that reports success while unable to fail** — this repo's dominant defect, arriving inside
  its own remedy for the third time today.
- **I opened a verification checkpoint on `e3b0c44298fc`** — the SHA-256 of the empty string, because
  `--pass-digest` reads stdin and I piped nothing. Terminated that checkpoint rather than reusing it.
- **`git checkout <file>` destroyed uncommitted work** during a mutation restore. Use `cp` file copies,
  or `batch-snapshot.sh`, never `checkout` on a dirty file.
- **I twice trimmed other people's load-bearing comments** to satisfy the size ratchet. Restored them
  and extracted a module instead. A budget is a prompt to find the seam, not a licence to delete the
  evidence.

## OAI-134, and why its cost is worth knowing

Shipped as `d2dd70e`: **two hint strings and one README paragraph**, no executable change. Both of the
item's load-bearing claims died before any code was written — the filed mechanism does not exist (the
plugin has no load channel at all), and the proposed fix would have fired on a working run. Full
account in `BACKLOG_DONE.md`; the cost observation is in the routing log.

**Three drafts of one string each smuggled the same promise back in** — "to have it loaded on demand"
→ "the server will try" → "the server's to do or refuse", the last excluding the third thing a server
does: answer from whatever else it has loaded. The test that finally settled it is one line and is
worth reusing: **does this sentence permit silent substitution?**

## Open, in priority order

**OAI-138** — half the eligible sweep corpus is lost to an uncalibrated per-commit cap; the
numbers are in the tracker and the timings are in a gitignored JSON.
**OAI-137** — `readOmlx` ignores `data` when `models` is an empty array.
**OAI-136** — `--model` bypasses the embedding-model rejection that `defaultModel` enforces, so a chat
request can be sent to an embedder; `README.md:74` currently claims the opposite. Pre-existing, found
by `codex-plain` while reviewing OAI-134. Fixing it is a **behaviour change needing its own grill** —
it is not obvious that an explicit `--model` should be overridden.
**OAI-125** — the resolved-SHA guarantee reaches the artifact by one untested path (mutation-proved);
the fix is a seam, because `main()` is unexported. **Until it lands, benchmark arms must pass a full
SHA.**
**OAI-128** — a new trap class: asserting presence where the code guarantees presence.
**OAI-135** — items 1–3 open; item 4 (the schema-arm caption) shipped this session.
Then OAI-126, 127, 129, 130, 132, 133.

## Ladders

Three ran. Two ended **`cap-without-approval`** at the computed cap of 3 — register rows
`sweep-overnight-review` and `sweep-followon-one-mapping`. The third,
`oai-134-conditional-load-hint`, ended **`terminated`** after **one light pass, 5 findings, no
verdict point**: the window closed. Its batch was applied and committed green, so nothing is
half-landed, but **`adr/089`'s verification-only pass never ran** — the last discovery pass was also
the last pass, which is exactly the shape `adr/089` exists to prevent. If OAI-136 is picked up, that
is the honest place to note the gap.

That is four `cap-without-approval` rows in the cohort, so the evaluator keeps the cap at 3 for the
next feature. Worth a `/routing-review` question: whether a cap of 3 suits work whose region needs
four or five narrowings — and, separately, whether a diff with **no executable change** is a
distinguishable tier class at all (one instance logged; that needs N features, not one).

The disposition ledgers lived in the session scratchpad and are **gone** with it. All three ladders
are closed and their residue is filed, so nothing depends on them.
