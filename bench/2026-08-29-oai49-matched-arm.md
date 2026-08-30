# OAI-49 — matched-budget review arm

A cross-model `/oai:review` comparison measures the *model* only when both arms run the same
instrument. The reply budget and the input-packing rung are both derived from the served context
window (`reserveFor` and `git-diff`'s whole-file sizing read the same `contextLength`), so two models
on their own native windows are two different instruments — the confound OAI-49 was filed against
(2026-07-30: dense derived a 47,724-token reserve against the MoE's 74,000, and `--structured-output`
differed in input rung on top of that).

## The matched-arm recipe (no code change)

The instrument is already matchable from configuration alone — `profile.contextLength` is a
first-class `providers.json` field that `effectiveWindow` returns as a `config`-sourced window,
outranking server detection, and that one figure drives **both** the reply reserve and the input
packing. Pin it identically for both arms and only the model varies.

1. **Add a matched profile** to `~/.config/oai-plugin/providers.json` — a *separate*, labelled
   instrument, leaving the shipped `lmstudio` profile untouched:

   ```json
   "lmstudio-matched": { "baseUrl": "http://localhost:1234/v1", "contextLength": 61696, "timeoutSeconds": 1800 }
   ```

   Pick `W = contextLength` **≤ the smaller of the two models' loaded windows** (`loaded_context_length`
   from `GET /api/v0/models`). Pinning above a model's real served window disarms the oversize-input
   guard — the OAI-50 footgun — since `config` outranks detection silently. Loading both models in LM
   Studio at `--context-length W` keeps every served window `≥ W` (LM Studio may round *up* — the MoE
   below was asked for 61696 and served 71936), which is all the guard needs: the pin governs the
   instrument, and a served window at or above it cannot overflow.

2. **Run one arm per model**, identical except `--model`:

   ```
   npm run bench -- --provider lmstudio-matched --model qwen/qwen3.8-27b      --runs 3
   npm run bench -- --provider lmstudio-matched --model qwen/qwen3.6-35b-a3b  --runs 3
   ```

   `--runs 3` (not 1) is deliberate: a single run per arm is a lottery ticket, not a comparison (the
   same command has produced 1,709 vs 5,450 output tokens on identical input). Keep every other budget
   flag identical across the two arms, or restore the confound in a different axis.

3. **Compare, and let the comparison prove the match:**

   ```
   node bench/compare.mjs bench/results/<dense>.json bench/results/<moe>.json
   ```

   `compare.mjs` withholds the ranking unless the records are like-for-like. `provider`/profile name is
   deliberately **not** a suppressing axis, so the two-profile and one-profile-plus-`--model` forms both
   compare; the **window** is checked per case by the lens axis (`<rung>@<window>`). Two arms pinned to
   the same `W` show the same `whole@W` (or `hunks@W`) label and rank through; a window or rung mismatch
   suppresses the rank and names the case. The match is thus *proven by the report*, not asserted.

Why this over a new `--context-length` flag on `/oai:review`: it keeps `contextLength` as an operator
assertion about server configuration (its deliberately guarded meaning), adds no surface to a command
this repo guards on purpose, and the measured run is expensive and environment-dependent enough to be
an explicit operator action. Add the flag only if repeated matched experiments make profile-editing a
demonstrated operational problem (Codex + advisor + orchestrator consensus, 2026-08-29).

## The 2026-08-29 matched run

Provenance recorded before launch:
 - repo HEAD: `11cc64bb81cb32190e4d9d0bb08b91bf0b4f2c7b`; working tree carried only the untracked
   `plans/oai-151-…approved/` dir from prior work.
 - `W = 61696`, pinned on `lmstudio-matched` (`config`-sourced, so it governs packing and reserve for
   both arms — confirmed by the identical `@61696` lens label on both reports). Server-side both models
   were loaded with `--context-length 61696`, but LM Studio served the dense model at exactly 61696 and
   the **MoE at 71936** (`loaded_context_length` via `/api/v0/models`; it rounds up for this model).
   This did **not** disturb the match: the pin, not the served window, is the instrument, and
   `61696 ≤` both served windows (61696, 71936), so the oversize guard stayed armed on both — the
   pin's robustness is exactly why the recipe pins in the profile rather than trusting the load flag.
   Both models cap at `max_context_length` = 262144.
 - models: dense `qwen/qwen3.8-27b`, MoE `qwen/qwen3.6-35b-a3b`, both served and confirmed by hand.
 - sole tenancy; `--runs 3` over all 10 corpus cases (2 controls), each arm a separate invocation with
   the other model unloaded first.

Records:
 - dense `qwen/qwen3.8-27b`: `bench/results/2026-08-29T23-24-57-879Z.json`
 - MoE `qwen/qwen3.6-35b-a3b`: `bench/results/2026-08-29T23-57-00-791Z.json`

### The confound is gone; the rank is withheld for a *different* reason

`bench/compare.mjs` over the two records **did not suppress on the window/lens axis** — every
co-scored case carries an identical lens label across both arms (`whole@61696`, or `hunks@61696` on
`hold3-docs-only` and `structured`). That is OAI-49's whole point: with `contextLength` pinned equal,
the two arms provably reviewed at the same rung and window, so a per-case difference is the model, not
the budget.

It **withheld the overall recall ranking** anyway — on a **coverage** divergence, not a window one:
`caps` was scored in the dense arm (2 of 3 runs readable) but all 3 MoE runs came back unreadable.

**That coverage loss is not a transport drop, and it is not one cause — two earlier drafts of this
note each got it wrong (first "LM Studio drop", then "the model's own failure to emit output"); the
real story only came out of reading the discarded replies.** Both arms recorded **0 failed physical
attempts** (30/30 answered each), so the LM Studio long-request drop the repo documents (OAI-20/OAI-50),
which surfaces as *failed/retried* attempts, played no part. What actually cost the `caps` coverage —
the divergence `compare.mjs` withheld the rank on — is a **plugin parser gap, not the model** (filed as
**OAI-228**): all 3 MoE `caps` replies were *valid* `{"findings":[{file, line, message}]}` JSON carrying
4, 1 and 5 real findings, and `parseFindings` discarded every one because the findings key their
description `message` instead of the schema's `summary`. The MoE produced the findings; the plugin threw
them away. That same gap cost 5 of the MoE's non-scored runs (`caps` ×3, `hold2` ×2). The **dense** arm
lost 0 runs to it — its 7 non-scored runs were reasoning **prose** ("Let me reason through the
code…", "I can't find anything in the diff…"), no JSON at all, which *is* model-attributable. So the
non-scored population is a mix of a plugin defect (MoE) and prose output (dense) plus a few
failed/exhausted runs, and `caps` is not even the corpus's largest case (31,823 prompt tokens, below
`scaffold` 47,279 and `model-info` 41,218).

The bearing on the comparison: the MoE's recall is **understated** here — its `caps` findings would have
scored but for OAI-228 — so `caps` is excluded for a harness reason, not a model one, and a clean
printed rank needs OAI-228 fixed first (and then a symmetric, predetermined successful-sample protocol
across both arms; re-running only `caps` until it reads would be outcome-dependent sampling). None of
this touches OAI-49's own result: the *window* is matched and `compare.mjs` proves it. (Codex
claim-check + fable review-audit + direct replay through `parseFindings` + orchestrator consensus,
2026-08-30.)

Aggregates (**not** like-for-like — shown unranked, as `compare.mjs` prints them):

| Arm | Recall | Throughput | Control FP |
|---|---|---|---|
| dense `qwen3.8-27b` | 2/42 = 5% | 16.2 tok/s | 0 per 6 |
| MoE `qwen3.6-35b-a3b` | 15/35 = 43% | 73.7 tok/s | 0 per 6 |

Per-case, matched `@61696`, MoE ≥ dense on every co-scored case (Δ = MoE − dense found-count):

| Case | dense | MoE | Δ |
|---|---|---|---|
| config-origin | 2/6 whole@61696 | 2/6 whole@61696 | ±0 |
| hold1-exit-code | 0/12 whole@61696 | 8/12 whole@61696 | +8 |
| hold4-unref-order | 0/1 whole@61696 | 2/2 whole@61696 | +2 |
| model-info | 0/6 whole@61696 | 0/6 whole@61696 | ±0 |
| scaffold | 0/9 whole@61696 | 1/3 whole@61696 | +1 |
| structured | 0/6 hunks@61696 | 2/6 hunks@61696 | +2 |
| caps | 0/2 whole@61696 | — 3 unreadable | — (coverage) |
| hold2-hostile-coercion | — 3 unreadable | — 1 failed, 2 unreadable | — |

Read the directional signal honestly, in both directions: **where its findings are scored the MoE has
the higher recall, and it runs ~4.5× faster** (gen 58.5–88.3 tok/s vs the dense 14.1–18.0, ranges never
overlapping). It has more unscoreable runs (10 of 30 vs the dense arm's 7), **but that comparison is
not model-vs-model**: 5 of the MoE's 10 were valid findings the plugin discarded (OAI-228), against the
dense arm's 7 that were genuinely prose — so on this corpus the MoE's *own* output-discipline failures
are actually fewer, and its recall is understated by the harness. Against it: its unmatched-finding
volume off the controls is far noisier (`structured` 23 vs 3, `model-info` 16 vs 7), so its **precision
outside the zero-FP controls is unmeasured**. The "MoE ≥ dense on every co-scored case" statement is
exactly that — *co-scored*, per case, recall-only; and because the excluded `caps` runs were the MoE's
valid findings lost to OAI-228, its true recall is **understated** here, so the directional edge is
conservative, not flattered. What OAI-49 set out to establish is settled independently of any of this:
the matched instrument is buildable from configuration alone, and `compare.mjs` fails closed on the
window axis exactly where it should.

