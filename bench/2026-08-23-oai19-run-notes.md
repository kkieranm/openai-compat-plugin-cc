# OAI-19 run provenance, recorded by hand (G-F; OAI-47 is not landed)

Continuation of `bench/2026-08-08-oai19-run-notes.md`. That session spent the MoE arm's second
invocation (published as a FAILURE — Invocations A, B, both invalid, G-G exhausted) and the dense
arm's FIRST invocation (Invocation C, INVALID: G-B `scaffold` 0/3, G-E 3 null ledgers). Blocked
afterward on the token-exhaustion defects (no `attempts[]` on that failure path, so G-E was
structurally unpassable) until OAI-115 and OAI-116 shipped, 2026-08-20.

Tonight authorizes exactly two things, per OAI-19's body and G-G: the dense arm's SECOND AND FINAL
invocation, and the deferred `--max-attempts 1` control arm (scaffold, both models, N=3, no gate).
The MoE main arm is NOT re-run — it already exhausted both invocations and is published.

Recorded BEFORE Invocation D, 2026-08-23 ~21:20 BST:
 - harness SHA: a61f7929ace11327c63b82ac2ba9a8ec04cc0ec8, working tree CLEAN
 - LM Studio CLI commit: 71bd99c (same as the 08-07/08 session)
 - `lms ps` before: EMPTY (nothing resident)
 - model ids served, by hand, confirmed via `GET /v1/models`: qwen3.8-27b, qwen3.8-27b-mlx,
   google/gemma-4-31b-qat, google/gemma-4-12b-qat, google/gemma-4-26b-a4b-qat,
   qwen/qwen3.6-35b-a3b, qwen/qwen3.6-27b, text-embedding-nomic-embed-text-v1.5 — both ids this run
   needs (`qwen/qwen3.6-27b`, `qwen/qwen3.6-35b-a3b`) are present and byte-identical to the 08-07/08
   session's ids.
 - sole tenancy: yes, nothing else connected; no `jobs.db` present in the repo (no background-task
   queue to interfere).
 - Full state captured in `bench/results/2026-08-23-oai19-arm-dense-D-state-BEFORE.log`.

MODEL ID FOR THE DENSE ARM, decided before launch: `qwen/qwen3.6-27b`, matching Invocation C exactly
— NOT the newer deployed default `qwen3.8-27b-mlx`. G-G's "same arm, second invocation" reading only
holds if the instrument under test is unchanged; swapping to `qwen3.8-27b-mlx` would be a different
arm the item never predeclared, not a retry of this one. (`qwen3.8-27b-mlx` has the same 61,696
window per the qwen3.8 first-sweep note, so a future arm on it is plausible but is OAI-19's business
only if it is opened as a new arm, not folded into this one silently.)

PARSER BOUNDARY: this arm still measures the reply parser as of OAI-84, same as Invocation C —
OAI-112/113/114 have not landed. No later arm may be differenced across that boundary without
saying so.

INVOCATIONS THIS SESSION (G-G requires every one reported, aborted included):
 - Invocation D — dense qwen/qwen3.6-27b, full corpus, `--runs 3 --warm-up --max-attempts 3`.
   Launched 2026-08-23 ~21:20 BST, log `bench/results/2026-08-23-oai19-arm-dense-D.log`, record
   `bench/results/2026-08-24T02-22-35-984Z.json`, state-AFTER
   `bench/results/2026-08-23-oai19-arm-dense-D-state-AFTER.log`. ~5h02m wall clock. This is the
   dense arm's SECOND AND FINAL invocation under G-G — no third attempt is authorized.

## Invocation D — DENSE qwen/qwen3.6-27b, full corpus, N=3. Gate reading below; not yet written
into BACKLOG.md — that edit is deferred to a reviewed pass, not made live overnight.

Per-case scored/unscored (scored = has a `report` with `parsed !== false`):
  caps 1/3, config-origin 3/3, docs-only 2/3 (control, 0 defects), model-info 0/3, scaffold 0/3,
  structured 3/3.

**Reconciliation, 2026-08-30 (OAI-211):** nothing below is contradictory, only unstated — the
"8 no-report" set (correction #1) and the 9 unscored runs are DIFFERENT sets that differ by exactly
one run, `caps` r3. `caps` has two unscored runs of different kinds: r2 is a no-report run (one of the
8), and r3 has a `report` but with `parsed: false` (`finishReason: stop`, `findings: null`, a 516-char
`raw`), so it is unscored yet NOT no-report. Hence 9 scored + 8 no-report + 1 report-but-`parsed:false`
= 18; the "9 + 8 = 17" reading omitted only `caps` r3. Verified by classifying all 18 runs in the
results record `bench/results/2026-08-24T02-22-35-984Z.json` under this section's own rule: per-case
scored `1,3,2,0,0,3` matches the table above, the eight no-report runs match correction #1 exactly, and
`caps` r3 is the sole `parsed:false` report. (`caps` r3's `raw` is a clean whole-document review —
inline `findings: []` then prose, "No defects found" — the shape `findings-empty.mjs` reads clean
today but this run's own build discarded as unreadable; under current code it scores as a clean
0-findings review, moving `caps` to 2/3.) The G-C "17 of 33" below is a DIFFERENT 17 —
defect-weighted (`caps 1x2 + model-info 2x3 + scaffold 3x3`), coincidentally equal to the 9+8 run
miscount, and left as-is because G-C is correct.

 - **G-B FAIL** (>=2 scored of 3, every case): THREE of six below the floor — `caps` 1/3,
   `model-info` 0/3, `scaffold` 0/3. Worse than Invocation C, which failed only on `scaffold`.
 - **G-C FAIL** (unresolved-from-unscored <=3 of 33): computed by hand, defects-per-case x
   unscored-runs-per-case, summed: caps 1x2=2, model-info 2x3=6, scaffold 3x3=9, others 0 → **17 of
   33**. Far over the ceiling.
 - **G-E PASS** — checked programmatically: every one of the 18 runs, including all 6 failed ones,
   carries a non-null, self-consistent `attempts[]` (0 null ledgers, against 3 in Invocation C). This
   is the first arm on record where a token-exhaustion-shaped failure did not erase its own ledger —
   direct, verified evidence that OAI-115/OAI-116 fixed exactly the defect they targeted.
 - **G-A** — no evidence of substitution: `requestedModel` reads `qwen/qwen3.6-27b` on every run,
   scored and failed alike (the failed runs' ledgers are readable this time, unlike Invocation C/the
   July arms, so this is actually checkable here rather than merely asserted).
 - **G-F** — sole tenancy held: `lms ps` before was empty, after showed only `qwen/qwen3.6-27b`
   IDLE. Harness SHA unchanged (a61f792) and tree clean before and after (the only change is this
   notes file itself, untracked).
 - **G-L** — `contextChecked: true` on all 9 scored runs (spot-checked programmatically), no
   fallback-budget pattern observed.

**Reading, stated mechanically per G-G and not yet acted on**: this is the dense arm's second and
last invocation, and it fails G-B and G-C decisively. Under the item's own rule ("if it fails too the
arm is published as a failure, as 2026-07-30 was"), the dense arm now reads as **PUBLISHED AS A
FAILURE**, joining the MoE arm — OAI-19 fails to produce a scalar baseline for EITHER model. That
sentence is recorded here as the mechanical gate outcome, not written into BACKLOG.md tonight; per
this repo's standing rule a measurement conclusion is Codex-reviewed before it reaches the user, and
that review has not happened yet.

**The failure mechanism, characterized cleanly for the first time.** All 6 failed runs (`model-info`
x3, `scaffold` x3) show the IDENTICAL two-attempt shape: attempt 1 fires the OAI-115 watchdog
(`token-reserve-cutoff`) after reasoning consumes the whole budget at healthy speed (~14-17 tok/s);
`trySalvage` (OAI-138/OAI-115's generalization) then fires attempt 2 with a smaller budget and a
prompt that INCLUDES the partial reasoning as context (promptChars grows: `model-info`
155,091 → 202,380-202,553; `scaffold` 173,317 → 205,473-205,506) — and that salvage attempt also
never emits content, reasoning further at severely degraded and still-falling speed (14.6 tok/s at
the cutoff, decaying to ~0.2 tok/s at the start of the salvage window, recovering only to ~2 tok/s by
its own end) before the process gives up. Ledger-level `outcome: "answered"` on the salvage attempt
means the server completed the request cleanly (`serverResponded: true`, no transport error) — it is
`requireAnswer`'s reasoning-only check, downstream of the ledger, that turns a "clean but contentless"
salvage response into the run's final `error`/`reason: token-reserve-cutoff`. **The salvage mechanism
fires exactly as designed and does not rescue either case, 6 times out of 6.** This is a genuinely new
finding: OAI-115/116 fixed the OBSERVABILITY of this failure (G-E) perfectly, but not the underlying
recall loss — the two are separate and this arm is the first evidence separating them. Whether the
severe mid-salvage slowdown (a ~70x drop in tok/s) is context-window thrashing near the 61,696 ceiling
or something else is not established here — stated as a hypothesis, not a finding.

ORDER: dense arm (Invocation D) is done. THEN the `--max-attempts 1` control arm on `scaffold`, both
models, `--runs 3`, run last (predeclared weak, temporally confounded, no gate — reported whatever it
shows). Proceeding to it now — it is independently authorized by the item's text regardless of
whether the main arms passed their gates.

## Control arm — dense half. `scaffold`, `qwen/qwen3.6-27b`, `--max-attempts 1 --runs 3`.
Launched 2026-08-24 ~03:11 BST. Record `bench/results/2026-08-24T03-11-02-521Z.json`, state
before/after in `bench/results/2026-08-24-oai19-control-dense-state-{BEFORE,AFTER}.log`.
0/3 scored, 3/3 failed, all `token-reserve-cutoff`. 6 physical attempts (3 answered, 3 failed) — the
report confirms `trySalvage` still fires under `--max-attempts 1` (it is not counted as a retry), and
still does not rescue: same two-attempt-per-run shape as Invocation D's main arm. Confirms `scaffold`
fails deterministically on dense regardless of retry budget, consistent with the item's own note that
`scaffold` fails deterministically (~±1% prompt-char spread). Sole tenancy and harness SHA unchanged.
Reported as-is; this arm carries no gate and licenses no rate claim on its own.

## Control arm — MoE half. `scaffold`, `qwen/qwen3.6-35b-a3b`, `--max-attempts 1 --runs 3`.
Launched 2026-08-24 ~03:11 BST, ~19 min. Record `bench/results/2026-08-24T03-29-42-980Z.json`,
state before/after in `bench/results/2026-08-24-oai19-control-moe-state-{BEFORE,AFTER}.log`.
1/3 scored, 2/3 failed (`token-reserve-cutoff`, same shape as the dense half — salvage fires,
doesn't rescue). The one scored run anchored 1 of 3 scoreable defects. Sole tenancy and harness SHA
unchanged.

**Control arm summed, reported as-is, no gate, no rate claim**: dense 0/6 attempts usable across
3 runs (0 scored), MoE 1/3 runs scored with one anchored catch. One-case, one-model-pair, N=3,
`--max-attempts 1` sample — exactly as weak and temporally-confounded as predeclared. It does show
the MoE surviving `scaffold` once where the dense model never did across 6 runs tonight (3 main-arm +
3 control), which is a curiosity worth a footnote and not a conclusion: different window (71,936 vs
61,696), different verbosity, N=1 success.

## Session summary, 2026-08-23/24 overnight

All work this item authorizes for tonight is now complete: the dense arm's second-and-final
invocation (Invocation D) and the deferred `--max-attempts 1` control arm, both halves. Nothing
further on OAI-19 is launched without a fresh decision — in particular, no third dense invocation
(G-G forbids it), no MoE main-arm re-run (already published as a failure, both invocations spent),
and no arm on the newer `qwen3.8-27b-mlx` (would be a new, unpredeclared arm, not a continuation of
this one).

**Handoff, not yet actioned**: Invocation D's gate reading (PUBLISHED AS A FAILURE, mechanically, per
G-B/G-C) and the salvage-fires-but-doesn't-rescue finding are recorded above as evidence, not written
into `BACKLOG.md`. That edit — plus deciding whether the salvage-doesn't-rescue behaviour is worth its
own backlog item under the filing worth-bar (it is a dated, observed, reproduced-6-times mechanism,
not a speculative one) — is deferred to a reviewed pass with Codex, per this repo's standing rule that
a measurement conclusion is reviewed before it reaches the user.

## Codex review, 2026-08-24 (`codex-rescue`, session `01a032b0-a5e2-7ba3-b4fe-e3c766dd64ae`)

Reviewed before anything above went into `BACKLOG.md`. **The gate arithmetic and the "published as a
failure" verdict are confirmed correct** — G-B, G-C and G-G re-derived independently from the raw
records and BACKLOG.md's own gate text, matching this file exactly. G-E's pass is also confirmed, with
one hedge: "direct proof [OAI-115/116 fixed it]" above overstates it — read instead as "direct
verification the OAI-115/OAI-116 path preserved complete ledgers for every observed run in this
invocation," not a universal guarantee for every future failure shape.

**Four corrections, applied here rather than silently fixed in place, per this repo's own convention
for stating what was wrong and why:**

1. **"8 no-report runs, not 6."** Invocation D has 8 runs with no `report` (`caps` run 2, `docs-only`
   run 3, `model-info` x3, `scaffold` x3), all reasoned `token-reserve-cutoff` at the top level. The
   "salvage fires 6/6, rescues 0/6" claim above is accurate ONLY when scoped to `model-info` +
   `scaffold` specifically (the two cases this file's "failure mechanism" section describes) — it must
   not be read as "all of Invocation D's failures," which is 8, not 6. Re-checked: salvage (attempt 2)
   fired on all 8 dense-arm no-report runs and rescued 0 of them (7 answered-but-empty, 1 — `caps` run
   2 — timed out on the salvage attempt itself, `deadline-timeout`).
2. **"Salvage does rescue — once."** The MoE control run 1 that scored 1/3 above was NOT an ordinary
   clean success — checked the record directly: `salvaged: true`, `parsed: true`, one anchored finding.
   It is a genuine salvage rescue. Restated: across all 14 salvage-eligible runs observed this session
   (8 dense main-arm + 3 dense control + 3 MoE control), salvage fired on every one and rescued exactly
   1 of 14 — the MoE control run. "Salvage never rescues" is refuted by this session's own data; "salvage
   rarely rescues, ~1/14 here" is the supported claim.
3. **Recall-loss language overstated.** "The underlying recall loss is not fixed" should read "the loss
   of SCORABLE COVERAGE — and hence unresolved recall opportunities — is not fixed." G-C treats an
   unscored run as an unresolved band (0 found to all found), not a confirmed miss, and with no scalar
   baseline obtained, actual recall loss on these cases cannot be quantified from this arm.
4. **The ~70x mid-salvage slowdown is an artifact, not a finding — retracted.** The "0.2 tok/s
   collapsing to ~2 tok/s" read above came from the live console progress display, which shares ONE
   clock for the whole command and never resets `firstTokenAt` when the salvage attempt begins
   (`scripts/lib/progress.mjs`) — so the displayed rate during salvage divides the SECOND attempt's
   characters by the FIRST-plus-SECOND attempt's elapsed time, reading artificially slow. The
   authoritative per-attempt ledger (`prefillMs`/`generationMs` on each `attempts[]` entry, not the
   console log) shows salvage generating for ~149s each time — consistent with spending the 2,048-token
   allowance at ordinary dense-model speed. There is no evidence of context-window thrashing or any
   slowdown; that hypothesis is withdrawn, not merely hedged.

**Sweep findings, second look (Ask 2):** all three of my CONFIRMED verdicts stand, but only one clears
the filing worth-bar as-is:
 - `dirPreambleBlock` fragility — CONFIRMED, low severity, but the sweep's own framing is
   conditional ("if the line differs") — explicitly latent per CLAUDE.md's own worth-bar text. NOT
   filed; left as this evidence only.
 - `mkdtempSync` leak — CONFIRMED, low severity, and IS a present, deterministic, silent mechanism on
   every test run — clears the bar. **Filed as OAI-203**, corrected to the precise count Codex gave:
   14 total `mkdtempSync` sites, 13 uncleaned (the 14th, inside `runContainment`, is cleaned by the
   recipe's own shell trap — not by the test file).
 - `ttl-episode.mjs` `finish()` no-reject hazard — CONFIRMED as a real mechanism, medium severity, but
   tightened: it is "crash by default under Node's uncaught-exception policy, OR permanent-pending if
   an outer handler suppresses that" — not both at once, situationally. Does NOT clear the filing bar
   yet: the sweep's own framing is conditional ("if cleanup or sampler.stop throws") and no dated throw
   is on record. NOT filed; needs a targeted reproduction first.

**Steer on the salvage gap (Ask 3):** worth one narrowly-controlled fix attempt, because the MoE
control's one rescue proves the mechanism isn't intrinsically incapable. Recommends **direction (c)**
— trim the reasoning fed back into the salvage prompt to a deterministic, recorded head+tail
retention (not a second model-generated summary, which risks the same starvation) — over (b) (more
budget/time: the 300s deadline never bound, generation ended at ~149s, and T1 already showed the model
just expands into more budget) and (d) (route large cases through diff-only pre-emptively: too
invasive as a first move, changes what the ORIGINAL review sees rather than only the recovery path,
and creates a new window/hunks instrument-boundary confound on top of the one OAI-19 already
predeclared). Full reasoning in the Codex session log; biggest named risk of (c): a fixed trim could
discard the one reasoning span that anchors the eventual finding, forcing re-analysis and making any
resulting recall figure a biased, non-comparable instrument against everything measured before it.
