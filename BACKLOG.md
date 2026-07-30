# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

**Current theme: make `/oai:review` trustworthy before extending the plugin further.** Where it
actually stands, stated plainly because it is easy to overrate: OAI-14 removed the largest
false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), and the 2026-07-30
OAI-19 attempt added two anchored true positives on a real commit diff (dense 27B on `scaffold`:
two *different* defects, one per attempt — `credential-inherited-across-origin`, then
`url-origin-strips-credentials`; neither found twice — joining the four anchored matches recorded
before it, one of which was the same case in commit mode by the old MoE quant on 2026-07-28) —
catches from arms that failed their acceptance gates, so recall remains without a publishable
number and the catches are existence proofs, not a rate. The binding constraint has moved: **server reliability — answered client-side by OAI-20
(2026-07-31), though whether retry recovers the observed 37.5% is itself a measurement OAI-19 will
read off the new attempt record — then the `analysis` ceiling where it still cuts** (dense on the largest cases; details under OAI-19).

The reviewer is useful once checking its claims costs less than its catches are worth. **OAI-15
(2026-07-28) changed how a censored run is treated, and raised the ceiling — it did not prove the
censorship gone, and the difference matters.** The `analysis` cap is now derived from the reply budget
each run is granted rather than fixed at a number the budget only coincidentally afforded, and a run it
truncates has its findings scored instead of discarded: half the corpus, 17 of 41 recorded runs, was
being thrown away along with two of the four anchored matches ever produced. So an agreement signal
(OAI-9) can now be measured through a sample that includes them, with the unresolved part shown as a
band rather than resolved by guesswork in either direction. **Whether the new ceiling is high enough
to stop truncating is a measurement, not a claim** — it is a wall-clock number, not one derived from a
distribution that was never observable. Measured 2026-07-30 (OAI-19 attempt, bounded — the arms
failed their gates): `config-origin` and `structured` no longer cut for the dense model
(`structured` on the diff-only rung there — see the confound note under OAI-19), but `scaffold`
still cuts 2/3–3/3 and `model-info` 1/3, so **the ceiling still binds for the dense model on the
largest cases**. See [ADR 008](adr/008-sizing-the-review-reply.md).

**OAI-12 has landed, so tuning is no longer guesswork — and it has now refuted its own first
headline, which is the instrument doing its job.** `npm run bench` scores the shipped command
against 11 catalogued defects in six snapshots of this repo's history and writes a per-run record,
ending the era where a conclusion was kept and its evidence thrown away (ADR 004 says "four runs",
`890ee2e` says "five", same experiment, neither now checkable). Baseline: ~~**1 of 6 scoreable defects
at N=1, 10.9 minutes**~~ — struck 2026-07-30: computed under the pre-OAI-15 rule that excluded cut
runs from the denominator, so it is not directly comparable with anything measured since (OAI-15
counts them, and reports the unresolved part as a band). **No comparable replacement exists yet** —
the OAI-19 re-measure was attempted 2026-07-30 and blocked by server reliability (see OAI-20);
until it completes, there is no baseline number for OAI-9 or OAI-11 to be scored against — though
OAI-20/OAI-21 (2026-07-31) removed what blocked it and gave the re-run an attempt-level record, a
warm-up and a control arm. 11 defects are catalogued, but 5 belong to the two cases whose
runs were cut mid-reasoning and are unscored rather than missed. **Re-measuring it under today's rule is OAI-19, now the top item —
OAI-20 and OAI-21 landed on 2026-07-31 and unblocked it** — because everything below wants a
number to beat and the methodology note below is exactly about this. One of its two headline results is now retracted
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

- **OAI-19** — Re-measure the baseline on the full corpus, dense 27B against the MoE, before any
  arm is read as an improvement. **This is a measurement, not a feature, and OAI-20/OAI-21 have now
  unblocked it (2026-07-31), so it is the top item — every item below it wants a number to beat.**
  Run it with `--warm-up` and `--max-attempts 3`, and take a `--max-attempts 1` control arm on at
  least one case so the record shows what retry was worth rather than only the retried rate. The recorded baseline — **1 of 6 scoreable defects,
  10.9 minutes, N=1** — was computed under the pre-OAI-15 rule that *excluded* cut runs from the
  denominator, and 17 of 41 runs recorded at the time were cut. OAI-15 now counts them and reports
  the unresolved part as a band, so that figure cannot be differenced against anything measured
  since: an OAI-9 union scoring "2 of 6" against it would be comparing two denominators, which is
  the N=1-per-arm error in the methodology note above wearing a different hat.
  Two things changed at once and must be separated, which is the whole design of the run: the
  **scoring rule** (OAI-15) and the **model** (the local server moved from the MoE
  `qwen3.6-35b-a3b-ud-mlx` to the dense `qwen/qwen3.6-27b`). Measuring only the dense arm would
  leave every prior number unusable and attribute the OAI-15 rule change to the model swap. So:
  both models, full corpus, `--runs 3` — N=1 is a lottery ticket, established twice in this file at
  the cost of two retracted claims — and one arm per model with nothing else varying.
  Read off the same run, because it is already paid for: **whether OAI-15's wall-clock ceiling
  still binds** (answered in bounded form by the 2026-07-30 attempt — see below), and OAI-18's
  `prefillMs`/`generationMs` per case, which OAI-9 needs in order to cost a warm pass honestly.
  The OAI-11 termination caveat does not apply on one LM Studio, but cross-model `gen tok/s` is
  still only approximate — token counting need not be identical across models; wall-clock
  generation time is the directly comparable figure.
  Expect a JIT model load between arms, so the first case of each arm carries a cold prefill that is
  not the model's — OAI-9's cache measurement (421.7s cold, 11.5s warm on one 56,805-token request)
  says how large that distortion is, and `--cold` exists to make it uniform rather than incidental.
  Done when both arms are recorded with their bands, the pre-OAI-15 figure is struck through in this
  file, and the comparable one replaces it as the number OAI-9 and OAI-11 are scored against.
  **Attempted 2026-07-30 — blocked on OAI-20, and the attempt is the evidence behind it.** Both arms
  ran twice (a predeclared one-retry-per-arm rule, every invocation reported); neither ever passed
  its acceptance gate (every case `scored=3`, no failed/truncated/unreadable/substituted runs), so
  under the plan's own terms **nothing here is published as the measurement** — the failure rates
  moved to OAI-20 are the deliverable this attempt actually produced. What the scored runs showed,
  stated as bounded observations, not the baseline: (a) the dense 27B anchored two `scaffold`
  defects on a real commit diff — *different* ones, one per attempt
  (`credential-inherited-across-origin`, then `url-origin-strips-credentials`), each hit in one
  scored run of three and neither recurring in the other attempt — two independent catches, not
  one catch replicated, and **not the benchmark's first**: four anchored matches predate them,
  including the same defect on the same case in commit mode by the old MoE quant
  (`bench/results/2026-07-28T07-57-15-522Z.json`);
  (b) the OAI-15 ceiling **still binds for the dense model on the largest cases** — `scaffold` cut
  2/3 then 3/3, `model-info` 1/3 in each — while `structured`, historically 4/4 cut, was never cut
  in any dense scored run, **but that last observation is confounded**: the dense model's smaller
  served window (61,696 vs the MoE's 71,936 — the MoE figure read live off `lms ps`, not present
  in any bench record; provenance in ADR 008) sent `structured` down ADR 005's diff-only rung
  (`hunksOnly: true`, ~28.6k prompt tokens) where the MoE received whole files (~59.7k), so "never
  cut" there may only mean "much smaller input", and the two arms did not review the same
  `structured` request; (c) the MoE generates ~4× faster (~50–78 vs 13–17 tok/s, prefill ~5×
  faster, a full arm in ~25 min vs ~3 h) and produced one **range** match on `scaffold`
  (`anchored=0` — a looser standard than the dense arm's anchored catches), finding nothing else;
  (d) the MoE arm ran as `qwen/qwen3.6-35b-a3b` — the `-ud-mlx` quant
  the old baseline used is no longer served, so even a clean future arm is a different quant, which
  the record must footnote. The MoE arm was launched with arm 1 already incomplete (a deliberate
  decision, to test whether the failures were model-specific; they are not). Raw records
  `bench/results/2026-07-30T*.json` with rendered reports beside them as
  `2026-07-30-oai19-arm-{dense,moe}.log` (gitignored; the quotable summary is in ADR 006).
- **OAI-22** — `--warm-up` warms every resolved pair up front, which on a provider that keeps one
  model resident lets the last warm-up evict the first. Filed 2026-07-31 from the OAI-20/21 review
  (Codex, P2). Latent today — the corpus resolves to a single pair, so nothing is evicted — but
  `--warm-up` exists precisely for the multi-model case, which is what OAI-19 runs, and there the
  first case of the earlier model still pays the load the flag promises to remove. Fix by
  interleaving: warm each pair immediately before the first case that uses it, or group execution by
  pair. Two smaller items from the same review, both bounded and neither corrupting a measurement:
  the `transport` reason code spans non-transient causes, so a hostname that will never resolve is
  retried three times with delays before reporting the same error (narrow it by `error.code`); and
  `capBudgets` is called twice per dispatch — once as the pre-check that keeps an expired cap from
  minting a phantom ledger entry, once inside `postChat` — leaving a microsecond window where the
  first passes and the second throws, recreating the phantom it prevents. Close it by computing the
  remaining budget once and passing it down.

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
  **The "~40–90s each" estimate is wrong for passes 2..N, and now measurably so.** Every pass after
  the first sends the same prompt, so it is a prompt-cache hit: measured on a 56,805-token request,
  first token at 421.7s cold against 11.5s warm. The marginal pass is therefore *much* cheaper than
  the first — good for the feature, and an argument for more passes rather than fewer — but it makes
  a per-pass average meaningless, and any timing quoted for "a review" must say whether it is the
  cold one. OAI-18 landed `prefillMs`/`generationMs`, so this is now visible per pass rather than
  hidden inside a total; use them when costing this.
- **OAI-11** — Diverse passes: different models, and different lenses.
  **Check the rate metric before comparing across *servers*.** OAI-17's `gen tok/s` divides
  provider-reported `completion_tokens` by a window running from the first text frame to the end of
  the stream, so a server that delays its `usage`/`[DONE]` frame inflates the divisor by however long
  it delays — unbounded, and undetectable from here. Within one server (lenses, or JIT-swapped models
  on LM Studio) the figure is sound and this does not apply. Across two providers it is only sound if
  both terminate promptly, so a cross-server pass needs that checked first or the comparison measures
  protocol behaviour rather than throughput. Raised by the OAI-17 adversarial review at 0.96
  confidence and left stated rather than fixed, because on the measured case the divisor was 81–265s
  against sub-millisecond terminators. **OAI-9 decorrelates sampling
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
