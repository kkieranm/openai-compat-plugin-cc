# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

**Current theme: make `/oai:review` trustworthy before extending the plugin further.** Where it
actually stands, stated plainly because it is easy to overrate: OAI-14 removed the largest
false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), but **no run has yet
produced a verified true positive on a real commit diff.** Precision improved; recall is unmeasured
and unchanged — and it came at a cost: **the `analysis` cap now binds in 2 runs of 3 against ~1 in 5
on diffs, and both capped runs reported nothing**, so the wasted-run rate roughly tripled.

The reviewer is useful once checking its claims costs less than its catches are worth. **OAI-15
(2026-07-28) changed how a censored run is treated, and raised the ceiling — it did not prove the
censorship gone, and the difference matters.** The `analysis` cap is now derived from the reply budget
each run is granted rather than fixed at a number the budget only coincidentally afforded, and a run it
truncates has its findings scored instead of discarded: half the corpus, 17 of 41 recorded runs, was
being thrown away along with two of the four anchored matches ever produced. So an agreement signal
(OAI-9) can now be measured through a sample that includes them, with the unresolved part shown as a
band rather than resolved by guesswork in either direction. **Whether the new ceiling is high enough
to stop truncating is a measurement, not a claim** — it is a wall-clock number, not one derived from a
distribution that was never observable. First evidence: `config-origin` on the dense 27B now runs
**0 of 3 cut** (7,075 / 19,942 / 21,240 characters) where it cut 6 of 9 before, but `structured`
(4 of 4 cut) and `scaffold` (4 of 11) are unmeasured, and all three of those runs found nothing — so
this bought an uncensored measurement, not a better reviewer. See
[ADR 008](adr/008-sizing-the-review-reply.md).

**OAI-12 has landed, so tuning is no longer guesswork — and it has now refuted its own first
headline, which is the instrument doing its job.** `npm run bench` scores the shipped command
against 11 catalogued defects in six snapshots of this repo's history and writes a per-run record,
ending the era where a conclusion was kept and its evidence thrown away (ADR 004 says "four runs",
`890ee2e` says "five", same experiment, neither now checkable). Baseline: **1 of 6 scoreable defects
at N=1, 10.9 minutes** — **computed under the pre-OAI-15 rule that excluded cut runs from the
denominator, so it is not directly comparable with anything measured since** (OAI-15 counts them, and
reports the unresolved part as a band). Re-measure the baseline before using it as an A/B arm; the
methodology note below is exactly about this. — 11 are catalogued, but 5 belong to the two cases whose runs were cut
mid-reasoning and are unscored rather than missed. One of its two headline results is now retracted
and the other has grown:

- ~~**Context dilution is measured.**~~ **Retracted 2026-07-28, by the instrument itself.** The
  "found at 1,575 tokens, missed at 47,072" pair varied token count, git mode, prompt shape and
  defect count together, at N=1 per arm. A three-arm run settled it: the same case at **half the
  tokens produced zero findings in three runs**, and the corpus's *smallest* input was cut 3 times
  out of 3. There is no dilution effect in this data, and the reordering it was about to justify has
  been dropped. See the correction section in [ADR 006](adr/006-benchmarking-the-reviewer.md).
- **The `analysis` cap was the binding constraint, and it was mis-sized.** **17 of 41 runs ever
  recorded here never finished looking.** The ceiling was set in OAI-10 "above every observed
  successful run" from a sample that had not yet seen a normal run reason long — it sat *inside* the
  model's ordinary reasoning distribution, truncating working reviews rather than runaways. Cutting
  does **not** track input size: the 1,575-token case reasoned for 7,367–9,440 completion tokens
  where the 47,072-token case used 3,552, and the corpus's smallest input cut 6 of 9 while a case
  barely larger cut 0 of 9. **Addressed in OAI-15, 2026-07-28** — and note what that did *not*
  settle. The reasoning distribution had no observable right edge under a cap truncating 41% of runs,
  so the new ceiling is sized from wall clock rather than from the distribution, and whether it still
  binds is a measurement to be read off the next full corpus run.

What the bench is *not* is a measure of true recall: the denominator counts only defects that could
be pointed at in the snapshot, which is smaller than what history claims and therefore flatters it.
See [ADR 006](adr/006-benchmarking-the-reviewer.md); the harness prints the same caveats every run.

**A standing methodology note, earned the hard way.** Two claims in this file were promoted from a
single run per arm, and both were wrong: "context dilution is measured" (retracted above) and, one
paragraph after diagnosing that error, "two passes found different defects, so a union would score
2/2" — which compared runs from two *different modes* and never reached this file only because it was
caught first. **N=1 per arm is a lottery ticket, not a comparison, and a pair of cases that differ in
more than the variable under test measures nothing.** Both are cheap to avoid: `--runs N` exists, and
`--diff-only` gives a within-case arm.

> **Discharged 2026-07-27:** the owed built-in `/code-review high` ran over `structured.mjs`,
> `client.mjs` and `cmd-review.mjs` (`c552bcd..HEAD`), covering OAI-4 and OAI-10 in one pass —
> 25 agents, 1.07M tokens, no deaths. Ten findings: **5 confirmed and fixed**, 5 vendor-dependent
> and parked as **OAI-13**. The new-module trigger earned its keep: the two most severe (a cut
> review rendering as a clean pass; a 12k-token input-budget regression) were both in exactly the
> vendor-assumption code the trigger targets, and neither `advisor` nor the lean workflow caught
> them across four and two passes respectively.

- **OAI-18** — **The prompt cache makes repeated runs of one case incomparable, and the bench does not
  know it.** Measured 2026-07-28 while probing OAI-6: the same 52k-token prompt reached its first token
  at **393.7s cold and 9.3s warm** — a 42× difference from LM Studio's prefix cache, on identical
  input. `--runs 3` therefore measures run 1 cold and runs 2–3 warm, so `durationMs` is not comparable
  *within* a case, let alone across an A/B. This silently corrupts exactly what OAI-17 exists to
  measure, and it also flatters every repeat: the second run of a case is doing materially less work.
  Needs a decision, not just a fix: either bust the cache per run (a nonce in the *first* message —
  a suffix does not work, since a prefix cache reuses the shared prefix), or accept warm runs and
  report cold and warm separately rather than averaging them. **Note the interaction with OAI-9**:
  multi-pass review over one target would be warm from pass two onward, which makes extra passes far
  cheaper than the first — good for the feature, misleading for any timing measured through it.
- **OAI-17** — Throughput is a product constraint, and nothing measures it. Swapping to a dense 27B
  at 6-bit produced **7.4 tokens/sec**, at which a run reasoning to the 28,000-character `analysis`
  cap needs ~17.5 minutes — so **all three benchmark runs died on the 300s client timeout**, and only
  the 4,448-token control finished at all. Three things follow. (1) **`bench/run.mjs` has no
  `--timeout`**, so a slow model cannot be benchmarked without hand-editing the provider config —
  which blocks OAI-11's cross-model passes outright, since the whole point there is running models of
  differing speed. (2) **Nothing records tokens/sec**, though `usage` and `durationMs` are both
  already in the JSON and the figure is their quotient; a model that is accurate but 10× too slow
  should be visible as such in the report, not inferred afterwards. (3) A timeout is currently
  indistinguishable in the record from a model that failed — both are a stderr blob — where the
  first is a harness limit and the second is a result. **This reframes OAI-9**: multiplying passes
  multiplies a wall clock that is already the binding constraint on the more capable models.
- **OAI-16** — A served model that is not the requested model must be said out loud, and a loaded
  model should not need pinning. Both found on 2026-07-28 by swapping the local model, and the first
  is the repo's signature class aimed straight at the benchmark.
  (1) **The server silently substituted.** The config pinned `qwen3.6-35b-a3b-ud-mlx`, which no
  longer existed; LM Studio served `qwen/qwen3.6-27b` and answered normally. `jsonReport` recorded
  the served model correctly — `result.model || model` — but **nothing warned that served ≠
  requested**, and the only visible symptom was a context note naming the absent model. A whole A/B
  arm can therefore run against a different model than the one it claims to test, and the record
  would look clean. The request names a model; when the reply names another, say so.
  (2) **Model auto-selection refuses when several are downloaded.** With the pin removed, `setup`
  reported `cannotDelegate: "This provider offers 5 models"` — correct per ADR 002's refuse-to-guess
  rule, but LM Studio publishes `state: "loaded"` on `/api/v0/models`, **the same endpoint
  `model-info.mjs` already reads for `loaded_context_length`**. Exactly one model is loaded at a
  time, so that field disambiguates without guessing. Refusing while holding the answer is the
  weaker half of a good rule. Note this interacts with OAI-11: cross-model passes will make
  "which model is loaded" a per-pass question rather than a config one.
- **OAI-9** — Multi-pass review with a deduplicated union, because a single pass is a lottery.
  Measured on one 135-line file with two known defects (`config.mjs` at `8990173`, both fixed later):
  five runs of the same command produced 1 real defect, 3 false positives, 2 empty results and 1
  budget failure — a **20% hit rate per run**, with output varying 1,709→5,450 tokens for identical
  input and quality tracking that spend. Independent passes are the lever: each costs ~40–90s and
  nothing else, and unioning three or four would have caught both real defects instead of gambling on
  one. Same shape as the loop-until-dry pattern. Needs: N passes (default 3?), dedupe on
  file+line+claim, and a count of how many passes reported each finding — agreement across
  independent passes is itself a confidence signal worth showing, since it is the closest thing to a
  free verifier. Decide whether passes run concurrently (one local model, so probably not) and how
  this interacts with OAI-8's progress reporting, which it makes far more necessary.
- **OAI-11** — Diverse passes: different models, and different lenses. **OAI-9 decorrelates sampling
  noise; this decorrelates blind spots**, which is the more valuable axis — repeated samples of one
  model share its failure modes, so agreement between them says much less than agreement between two
  models trained differently. That makes cross-model agreement a genuinely strong confidence signal
  where cross-sample agreement is only a weak one.
  Three ways to get diversity, cheapest first: different **lenses** on the same model (one pass for
  correctness, one for security, one for edge cases) — free, and available today with one model
  loaded; different **models on different providers**, which is exactly what ADR 001's
  providers-as-data buys us, and the case where passes can genuinely run concurrently; different
  models on **one** provider, which on LM Studio means paying a JIT load between passes and is
  probably the worst of the three.
  Build OAI-9 so a pass carries its own `{provider, model, lens}` rather than inheriting one global
  target — then this is a config change, not a rewrite. Open question worth an experiment before
  committing: whether three lenses on one model beats three plain passes, since that would deliver
  most of the value with no second model to install.
- **OAI-3** — Background jobs: `--background`, plus `/oai:status`, `/oai:result`, `/oai:cancel`.
  Port the reference plugin's generic job model (per-workspace state dir, light index + per-job
  record, detached self re-exec worker); replace its RPC interrupt with an `AbortController`.
- **OAI-5** — A delegation subagent (`/oai:rescue` + a thin forwarding agent) so a long local-model
  run does not consume the main session's context.
- **OAI-7** — Publish: README install instructions, and verify the marketplace path
  (`claude plugin marketplace add`) actually resolves this repo once it has a remote.
- **OAI-13** — Vendor-dependent findings that need a second server to settle. **Now six.** Added
  2026-07-28 from the OAI-6 built-in review: `refusedField` accepts 400/422 and pattern-matches the
  quoted error body, so a validation error that *echoes the request JSON* contains `stream` and
  `stream_options` and matches both capability rungs — two spurious retries with stderr claiming a
  cause that was never established, before the real error surfaces. Bounded (each rung fires once)
  and self-correcting, so it is filed rather than patched: tightening the prose match is exactly
  the fragile guessing items (1) and (2) below already describe, and the honest fix is the same
  one — read the server's status or error `type`/`code` field instead of its prose.
  The original five, from the OAI-4/OAI-10 built-in review, all vendor-
  dependent and none reproducible against LM Studio. They need a second server to settle, so they
  wait for one rather than being fixed blind. (1) `isFormatRejection` reads `error.message`, which
  `client.mjs` truncates to 400 characters — a server whose validation dump names `response_format`
  later never triggers the degrade path, and `/oai:review` dies on a raw 400 instead. (2) The same
  matcher fires on *any* 400 whose body echoes the request, asserting "rejected response_format"
  as a cause it only guessed. (3) `parseFindings` picks a channel before parsing and never falls
  back, so one stray non-whitespace character in `content` discards a schema-valid payload sitting
  in `reasoning`. (4) With the window unknown, `reserveFor` still puts `max_tokens: 16384` on the
  wire, where `/oai:task` sends none — a server that rejects an oversized `max_tokens` fails for a
  reason the plugin chose. (5) On the degraded path a bare findings *array* is discarded, though the
  adjacent comment promises repair. Fixing (1) and (2) properly probably means the server's status
  or error `type`/`code` field rather than prose, which is an ADR 002 shape-not-name question and
  the reason this is one item rather than five.
