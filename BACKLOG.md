# Backlog

IDs are stable and global (`OAI-n`, never reused). Item bodies sit in ascending ID order.
**`tests/backlog-structure.test.js` asserts this on every `npm test`.**

The direction is **"use local LLMs like I use Codex"** —
[`plans/local-llms-like-codex.md`](plans/local-llms-like-codex.md), paired with Codex. Two prior
sweeps' full rewrite notes (2026-08-05, 2026-08-14 — what shipped, what each sweep verified and
filed) are moved verbatim to
[`evidence/backlog-header-history.md`](evidence/backlog-header-history.md) rather than carried in
this header.

**The tier-ranking priority index and the absorbed-ID redirect table were retired 2026-08-20**,
owner-directed, matching the same removal in `~/Code/backlog` and `~/Code/dotfiles`: no more
priority-ranking pass over this file, and a merged item now gets a one-line stub bullet
(`- **OAI-n** — Absorbed into OAI-m; see that item.`) wherever the item it merged into lives,
resolved through the exact same `- **OAI-n**` shape as every other item — never a separate table.
Three such stubs exist in `## Items` below (OAI-30, OAI-38, OAI-41); OAI-6 and OAI-8, which the old
table resolved to `*shipped*` rather than another ID, are now ordinary `BACKLOG_DONE.md` entries
instead of stubs, since they already carried full shipped descriptions. OAI-71's own stub moved to
`BACKLOG_DONE.md` on 2026-08-23 when its target, OAI-59, shipped — a stub always lives wherever its
target lives.

### Standing methodology note, earned the hard way

Two claims in this file were promoted from a single run per arm, and both were wrong: "context
dilution is measured" (retracted 2026-07-28 — see below) and, one paragraph after diagnosing that
error, "two passes found different defects, so a union would score 2/2" — which compared runs from two
*different modes* and never reached this file only because it was caught first. **N=1 per arm is a
lottery ticket, not a comparison, and a pair of cases that differ in more than the variable under test
measures nothing.** Both are cheap to avoid: `--runs N` exists, and `--diff-only` gives a within-case
arm.

### The parked theme — "make `/oai:review` trustworthy before extending the plugin further"

Parked 2026-08-04 by the direction change, and kept here rather than in `BACKLOG_PARKED.md` because it
is context for the measurement-programme items (OAI-19, OAI-50, OAI-49, OAI-9, OAI-11, OAI-13) rather
than an item itself. Everything in it was sized to answer "is the reviewer
trustworthy" before extending the plugin — and OAI-51 then found the reviewer was crashing the model
backend with its own request, so the thing being measured was broken throughout. Stage 0 changed how
replies are produced, which invalidates any baseline taken before it.

Where the reviewer actually stands, stated plainly because it is easy to overrate: OAI-14 removed the
largest false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), and the 2026-07-30
OAI-19 attempt added two anchored true positives on a real commit diff (dense 27B on `scaffold`: two
*different* defects, one per attempt — `credential-inherited-across-origin`, then
`url-origin-strips-credentials`; neither found twice — joining the four anchored matches recorded
before it, one of which was the same case in commit mode by the old MoE quant on 2026-07-28). Those
are catches from arms that failed their acceptance gates, so recall remains without a publishable
number and the catches are **existence proofs, not a rate**.

The reviewer is useful once checking its claims costs less than its catches are worth. **OAI-15
(2026-07-28) changed how a censored run is treated, and raised the ceiling — it did not prove the
censorship gone, and the difference matters.** The `analysis` cap is now derived from the reply budget
each run is granted rather than fixed at a number the budget only coincidentally afforded, and a run it
truncates has its findings scored instead of discarded: half the corpus, **17 of 41 recorded runs**, was
being thrown away along with two of the four anchored matches ever produced. Measured 2026-07-30
(OAI-19 attempt, bounded — the arms failed their gates): `config-origin` and `structured` no longer
cut for the dense model (`structured` on the diff-only rung there — see the confound note under
OAI-19), but `scaffold` still cuts 2/3–3/3 and `model-info` 1/3, so **the ceiling still bound for the
dense model on the largest cases**. Then measured again 2026-08-04, MoE arm: **zero cut runs across
the corpus**, the first full arm on record with none. See [ADR 008](adr/008-sizing-the-review-reply.md).

**OAI-12 landed, so tuning is no longer guesswork — and it then refuted its own first headline, which
is the instrument doing its job.** `npm run bench` scores the shipped command against 11 catalogued
defects in six snapshots of this repo's history and writes a per-run record, ending the era where a
conclusion was kept and its evidence thrown away (ADR 004 says "four runs", `890ee2e` says "five",
same experiment, neither now checkable). Baseline: ~~**1 of 6 scoreable defects at N=1, 10.9
minutes**~~ — struck 2026-07-30: computed under the pre-OAI-15 rule that excluded cut runs from the
denominator, so it is not directly comparable with anything measured since. **No comparable
replacement exists yet**; producing one is OAI-19. 11 defects are catalogued, but 5 belong to the two
cases whose runs were cut mid-reasoning and are unscored rather than missed.

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
  so the new ceiling is sized from wall clock rather than from the distribution.

What the bench is *not* is a measure of true recall: the denominator counts only defects that could
be pointed at in the snapshot, which is smaller than what history claims and therefore flatters it.
See [ADR 006](adr/006-benchmarking-the-reviewer.md); the harness prints the same caveats every run.

> **Discharged 2026-07-27:** the owed built-in `/code-review high` ran over `structured.mjs`,
> `client.mjs` and `cmd-review.mjs` (`c552bcd..HEAD`), covering OAI-4 and OAI-10 in one pass —
> 25 agents, 1.07M tokens, no deaths. Ten findings: **5 confirmed and fixed**, 5 vendor-dependent
> and parked as **OAI-13**. The new-module trigger earned its keep: the two most severe (a cut
> review rendering as a clean pass; a 12k-token input-budget regression) were both in exactly the
> vendor-assumption code the trigger targets, and neither `advisor` nor the lean workflow caught
> them across four and two passes respectively.

> **Discharged 2026-08-05:** OAI-58, the owed step 6 review ladder on OAI-3, ran and closed by dual
> approval, producing the OAI-61 … OAI-73 block. Its record is in `BACKLOG_DONE.md`.

## Items

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

- **OAI-13** — Vendor-dependent findings that need a second server to settle. ~~**Now seven.**~~
  **Five, since the 2026-08-05 sweep split two of them out as OAI-84** — they stopped being
  vendor-dependent when OAI-51 made the prose-parse path the default. Added
  2026-07-28 from the OAI-6 built-in review: `refusedField` accepts 400/422 and pattern-matches the
  quoted error body, so a validation error that *echoes the request JSON* contains `stream` and
  `stream_options` and matches both capability rungs — two spurious retries with stderr claiming a
  cause that was never established, before the real error surfaces. Bounded (each rung fires once)
  and self-correcting, so it is filed rather than patched: tightening the prose match is exactly
  the fragile guessing items (1) and (2) below already describe, and the honest fix is the same
  one — read the server's status or error `type`/`code` field instead of its prose.
  **(7) Added 2026-08-01, moved here from OAI-22 when that item closed.** The capability negotiation
  is scoped to one `chatCompletion` call, so a review's `response_format` fallback mints a fresh
  `createNegotiation` and re-offers a capability the schema request already had refused — an
  asymmetry with the attempt ledger, which *was* deliberately threaded across both calls. Needs a
  server refusing BOTH `stream_options` and `response_format`, which nothing here has. **The OAI-22
  review added a consequence beyond the wasted round trip and the duplicate `refused` entry**: that
  needless refusal can consume what is left of `--max-seconds`, turning an answerable review into a
  client-imposed deadline failure. When it is fixed, only the capability state (`removed`) may be
  shared across the two calls — never the whole `{payload, removed, lastRung}`, whose payload is
  call-specific.
  The original five, from the OAI-4/OAI-10 built-in review, all vendor-
  dependent and none reproducible against LM Studio. They need a second server to settle, so they
  wait for one rather than being fixed blind. (1) `isFormatRejection` reads `error.message`, which
  ~~`client.mjs`~~ **`provider.mjs` (file attribution corrected 2026-08-14 against disk; `client.mjs`
  has no truncation logic at all)** truncates to 400 characters — a server whose validation dump names `response_format`
  later never triggers the degrade path, and `/oai:review` dies on a raw 400 instead. (2) The same
  matcher fires on *any* 400 whose body echoes the request, asserting "rejected response_format"
  as a cause it only guessed. ~~(3)~~ **and** ~~(5)~~ **left this item on 2026-08-05 — see the split
  note below.** (4) With the window unknown, `reserveFor` still puts `max_tokens: 16384` on the
  wire, where `/oai:task` sends none — a server that rejects an oversized `max_tokens` fails for a
  reason the plugin chose. Fixing (1) and (2) properly probably means the server's status
  or error `type`/`code` field rather than prose, which is an ADR 002 shape-not-name question and
  the reason this is one item rather than five.

  **Split 2026-08-05 by the backlog sweep, and the reason is that OAI-51 changed what these are.**
  Verified against disk: with no schema sent by default (`review-request.mjs:206`), sub-items (1), (2)
  and (7) are now reachable **only when `--structured-output` is passed** — a genuinely narrower
  trigger than when they were filed, and one more reason they wait for a second server. But (3) and
  (5) went the other way. The default prose-parse path runs the *same* `parseFindings`, so they stopped
  being vendor questions about a degraded path and became defects on the shipped default. They are now
  **OAI-84**, and they sort five tiers higher. Sub-item (4)'s reach is unchanged.
  *(Numbering note, since the count above just changed: the seven were (1)–(5), the unnumbered
  `refusedField` finding added 2026-07-28 in the paragraph at the top of this item, and (7). Five
  remain here.)*

- **OAI-19** — Re-measure the baseline on the full corpus, dense 27B against the MoE, before any
  arm is read as an improvement. **This is a measurement, not a feature. OAI-20/OAI-21 unblocked it
  (2026-07-31); the three items above it are its prerequisites, not competitors, and every item
  below it wants a number to beat.** It is also the one item here that is hours of wall clock on the
  user's own LM Studio rather than an edit, so it is launched when they say so, never incidentally.
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
  **The JIT-TTL question moved OUT of this run, 2026-08-03.** OAI-20 deferred it here and OAI-24
  found it could not be answered by a sweep at all: sampling residency around a run cannot tell
  "loaded throughout" from "unloaded then silently reloaded". It became **OAI-34**, an intervention
  run *before* this one, and **that run happened on 2026-08-04 and came back negative**: the
  deterministic form is refuted — 336s of prefill under a 120s TTL, 3/3, continuously resident, all
  four validity checks clean. This run may quote only what
  [ADR 013](adr/013-observing-the-server.md)'s outcome table permits, which after the 2026-08-04
  amendment has no confirming row at all. **So the branch this item used to reason forward from is
  closed, and closed in the direction that removes a conclusion rather than supplying one.** The old
  text said "if the mechanism is confirmed, `--warm-up` and pacing matter more than retry does" —
  nothing here confirms it, and nothing can, so **the write-up must report the cause of the drops as
  unresolved**. Refuting one hypothesis is not explaining the observation. Three limits belong
  beside the refutation whenever it is quoted: dense 27B only where the 27/72 drops were seen on
  **both** models, one case at one TTL, and N=3 with a ~63% one-sided upper bound on the failure
  rate. The attempt record still carries what a pacing effect would show (`promptChars`,
  `waitedMs`, per-attempt timings) and OAI-24's reader still splits failures on whether a prefill
  was measured — those stay useful for describing the drops, not for naming them.
  Two corrections that item produced and this one must not repeat: the **"10-minute idle TTL" has no
  provenance** here (LM Studio documents a resetting timer with a 60-minute JIT default), and every
  measured dense prefill — `scaffold` 335s, `model-info` 286s, `structured` 191s — sits *below* even
  the 600s the hypothesis assumed. **Whether OAI-15's wall-clock ceiling still binds** (answered in bounded form by the 2026-07-30 attempt — see below), and OAI-18's
  `prefillMs`/`generationMs` per case, which OAI-9 needs in order to cost a warm pass honestly.
  The OAI-11 termination caveat does not apply on one LM Studio, but cross-model `gen tok/s` is
  still only approximate — token counting need not be identical across models; wall-clock
  generation time is the directly comparable figure.
  Expect a JIT model load between arms. **With `--warm-up`, which this item mandates, the first case
  no longer carries it** — the warm-up absorbs the weights load, and `--cold` handles the separate
  question of prompt-cache uniformity. (Before OAI-21 that load landed on case 1 as a cold prefill
  that was not the model's; OAI-9's 421.7s-cold against 11.5s-warm on one 56,805-token request says
  how large the distortion would be if the flag were omitted.)
  Done when both arms are recorded with their bands, the pre-OAI-15 figure is struck through in this
  file, and the comparable one replaces it as the number OAI-9 and OAI-11 are scored against.

  ### Acceptance gate, predeclared 2026-08-04 and committed before the first arm

  The 2026-07-30 attempt is publishable *as a failure* only because its gate was written down before
  it ran. This one is written down for the same reason, and it is deliberately not the July gate:
  that one required zero failed runs across 18, which — at the measured ~37.5% per-attempt drop and
  a 3-attempt retry — an arm clears only about a third of the time **even when retry is working
  exactly as designed**. A gate that is likely to fail on a healthy instrument is not strictness, it
  is the July error in a new place. Grilled adversarially with Codex over two rounds; every
  criterion below that survived is one of us failing to break it.

  **The estimand, named before the number exists.** The published figure is recall of the
  **retry-enabled CLI** over the fixed 11-defect corpus, with unresolved opportunities reported as a
  band. It is *not* the model's one-request behaviour: `--max-attempts 3` is part of the instrument,
  and because a drop may correlate with reply length, a successful retry is not guaranteed to be an
  unbiased sample of what a single request would have produced. The ledger *describes* retry; it
  does not prove independence.

  Per arm, each arm judged independently:

  - **G-A — zero substituted runs.** Any substitution voids the arm; a mislabelled number is not an
    uncertain one, and no amount of sampling fixes a wrong label. **Stated limit, not gated:**
    substitution is checked at *run* level only. `applyFrame` records a served model id as frames
    arrive (`completion.mjs:65`), but a stream that dies unterminated throws `stream-unfinished`
    (`completion.mjs:98`), the ledger entry keeps no served identity (`attempt-ledger.mjs:56`), and
    `answerWithRetry` retries it — so a superseded attempt that observed a *different* model leaves
    no record. It is not checkable today. It is also not reachable here for the ordinary cause:
    substitution happens when the requested id is absent, and both ids are served by this machine.
    Instrumenting it is **OAI-48** — *parked 2026-08-18, `not worth doing`; this limit therefore stays
    stated rather than instrumented.*
  - **G-B — replication floor: every case, all six, contributes ≥2 scored runs of 3.** No case may be
    dropped from the headline. An earlier draft let cases fall out with the exclusion merely
    *named*; Codex killed it, correctly — `scaffold` and `structured` could both drop while the arm
    "passed", leaving a headline over 5 of 11 defects. Naming an exclusion does not repair the
    estimand, it documents that a different benchmark was measured. `docs-only` is gated too, despite
    holding no defects: it is the only negative control, so without it there is no false-positive
    evidence at all.
  - **G-C — unresolved-from-unscored ≤3 of 33.** Every unscored run (failed, truncated, unreadable)
    contributes its case's scoreable defects as **unresolved** — lower bound 0 found, upper bound all
    found — exactly as a cut run does, rather than shrinking the denominator. The corpus offers 33
    defect-run opportunities (11 × 3). The ceiling is chosen as the largest value that keeps
    missing-run uncertainty well below the cut-derived uncertainty already expected, so a missing run
    is never the dominant term.
  - **G-D — cut runs are not gated.** OAI-15 decided a cut run is scored with its silence reported as
    a band; capping the cut-derived band would re-litigate that by the back door, and is unachievable
    by construction for the dense arm (July: `scaffold` cut 2–3 of 3, `model-info` 1 of 3 → ≥8 of 33
    from cuts alone). The two bands are gated separately. **The *published* interval sums both** —
    only the thresholds stay apart, or the reported bound would undercover.
  - **G-E — ledger completeness.** A missing or self-inconsistent `attempts[]` on any run invalidates
    the invocation.
  - **G-F — sole tenancy and artifact identity.** Nothing else connected; `lms ps` recorded before
    *and* after each arm; harness SHA and tree-clean state, corpus state, LM Studio version and both
    model ids recorded by hand (OAI-47 is not landed). **Stated limit:** pre/post residency does not
    witness a reload *during* an arm.
  - **G-L — instrument uniformity: every scored run must carry `contextChecked: true`.** Found while
    writing this gate, in the July records: **every** off-pattern `analysisCap` there is exactly a
    run whose window probe failed and whose reply budget silently fell back to 44,405 instead of the
    window-derived figure — `config-origin` dense scored 44,405 beside 74,000, `caps` MoE 44,405
    beside 74,000, `scaffold` MoE 44,405 beside 65,499 — and those runs cluster immediately after a
    failed run. The fallback is not uniformly smaller (dense `scaffold` derives 30,683, below it), so
    it is not a conservative default; it is **a different instrument**, and July scored it as if it
    were the same one. Such a run is not scored and counts as unscored under G-C.

  **G-G — the stopping rule is mechanical, because otherwise it is optional stopping.** The *first*
  invocation of an arm satisfying G-A…G-L is the published arm **automatically, whatever recall it
  shows**. A second invocation happens if and only if the first fails the gate; the second is final,
  and if it fails too the arm is published as a failure, as 2026-07-30 was. No passing invocation is
  ever re-run, and no arm is a merge of two. Every invocation is reported — including the
  2026-08-04 smoke run (`--case docs-only --runs 1`, MoE, record `2026-08-04T19-53-16-806Z`) and any
  aborted one.

  **G-M — utility is separate from validity.** A valid arm whose full band (cut + unscored) leaves
  more than **11 of 33** opportunities unresolved is a *valid bounded observation* and a **failed
  baseline objective**: it is reported, it does **not** trigger another invocation, and it licenses
  no downstream A/B. Above a third unresolved, even the majority reading of the corpus is unresolved.
  This threshold sits only just above July's worst dense pattern, which is the honest position —
  this arm may well pass validity and fail utility, and that outcome is itself the finding that the
  OAI-15 ceiling must rise before a scalar baseline exists.

  **The cross-arm comparison is between DEPLOYED SYSTEMS, and the clean decomposition is reported as
  NOT OBTAINED.** This is the second thing Codex found and it is larger than the `structured`
  confound already on file. The reply budget is derived from each model's served window, so the arms
  do not run the same instrument on the same case — measured 2026-07-30, `model-info` capped at
  **47,724 dense against 74,000 MoE**, `scaffold` at **30,683 against 65,499**, while `structured`
  differs in *input* rung as well (dense `hunksOnly: true`, MoE `false`). **No case in this corpus is
  a clean model-only comparison**, so predeclaring a "common support" of 8 defects would have been
  false precision. What is published is "the shipped `/oai:review` with model A versus with model B,
  each as deployed, including its window-derived reply budget". The model-versus-scoring-rule
  decomposition this item originally wanted is **reported as not obtained**; a matched-budget arm is
  **OAI-49**. Per-run `analysisCap`, `hunksOnly` and `estimatedTokens` are transcribed for every case
  in both arms so the mismatch is data rather than prose. If one arm passes and the other fails, the
  passing arm's **absolute** figure stands alone; no comparison is published.

  **The control arm is a weak diagnostic and is labelled one.** `--max-attempts 1`, `scaffold`,
  both models, `--runs 3`, run *after* both main arms. At most 3 failure observations per model,
  temporally confounded by running last, and one case wide. It **cannot** establish retry's value or
  its independence; the primary retry evidence is the main arms' `attempts[]` ledger. It carries no
  gate — it is reported whatever it shows, and nothing from it may be quoted as a rate.


  **Run logs, diagnostics and the 2026-07-30 attempt moved to [`evidence/019.md`](evidence/019.md)**
  by the 2026-08-13 sweep — verbatim, nothing rewritten. That file carries: the 2026-08-04 run log
  (invocations 0-2, the drop-rate replication, the retry analysis, the two failure shapes); the
  2026-08-07/08 run log (invocations A-C and the token-exhaustion table); the diagnostics T1/T2/T3;
  and the 2026-07-30 attempt. **G-G's every-invocation rule is satisfied there, not here.**
  **The conclusion that matters: OAI-51 traded one failure class for another.** With a schema,
  grammar-driven `empty-completion` transport drops. Without one, reasoning consumes the whole shared
  budget and no findings are emitted. Both are now identified; neither is fixed.

  **THIS ITEM WAS BLOCKED ON INSTRUMENT DEFECTS, not on measurement effort — both now shipped
  2026-08-20 (OAI-115, OAI-116).** The token-exhaustion error path emitted no `attempts[]` at all,
  so **G-E was structurally unpassable** for any arm containing one such failure — and that was the
  dominant failure mode. Verified against 2026-08-04, where all 4 failed runs *did* carry ledgers, so
  this was specific to the new path rather than general. No further arm was run while blocked; a dense
  second invocation was deliberately not run for this reason, and because `scaffold` fails
  deterministically (41,251 / 42,064 / 41,404 chars, a ±1% spread). The `--max-attempts 1` control arm
  was deferred with it — all now unblocked, pending re-reading this body's other settled decisions
  before scheduling.

  **Dense arm's second and final invocation ran 2026-08-23/24 (Invocation D) — INVALID, and BOTH
  arms are now PUBLISHED AS A FAILURE under G-G.** G-B fails on three of six cases (`caps` 1/3,
  `model-info` 0/3, `scaffold` 0/3 scored — worse than Invocation C, which failed only on
  `scaffold`); G-C fails at 17 of 33 unresolved-from-unscored against a ceiling of 3. Reviewed by
  `codex-rescue` before this paragraph was written (session `01a032b0-a5e2-7ba3-b4fe-e3c766dd64ae`),
  which independently re-derived the same gate arithmetic and confirmed the verdict. No dense
  invocation remains (2 of 2 spent), and the MoE arm already exhausted both of its own in the 2026-08-07/08
  session — **so OAI-19 as scoped produces no scalar recall baseline for either model**, and every
  downstream item that "wants a number to beat" still has nothing to score against.
  G-E, by contrast, passes cleanly — 0 null ledgers across all 18 runs, which is direct verification
  that OAI-115/OAI-116 preserved a complete `attempts[]` for every observed run in this invocation
  (not a universal guarantee for every future failure shape). The observability defect that blocked
  this item is fixed; it did not fix recall. All 8 no-report runs in Invocation D fired the
  `trySalvage` rescue and none of the 8 recovered; across all 14 salvage-eligible runs observed this
  session (main arm + both halves of the deferred control arm) salvage fired 14/14 and rescued
  exactly 1/14 (the MoE control's `scaffold` run 1 — `salvaged: true`, one anchored finding) — real
  but rare, not "salvage never rescues." Full data, gate-by-gate arithmetic, and the Codex review are
  in `bench/2026-08-23-oai19-run-notes.md`; not yet folded into `evidence/019.md`, per this repo's
  convention of leaving that consolidation to a later sweep. **Open question, not decided here**:
  whether a fix to the salvage recovery path (Codex's steer: trim the reasoning fed back into the
  salvage prompt to a fixed head+tail retention, tried in isolation before touching the 2,048-token/
  300s budget) is worth attempting before any further baseline arm, and whether OAI-49's matched-budget
  arm becomes the more useful next measurement now that neither deployed-system arm cleared its gate.

  ~~**The measurement is SUSPENDED, and the reason is OAI-51: the drops are our own bug.**~~
  **Suspension DISCHARGED 2026-08-05 by the backlog sweep — OAI-51 is resolved and in
  `BACKLOG_DONE.md`, verified against disk rather than off its commit messages.** The suspension was
  right and the record of why it existed stands: the whole OAI-19/OAI-20/OAI-24/OAI-34 line of
  investigation inferred server behaviour from the client side while LM Studio was writing a server
  log the entire time, and that log names the cause outright as this plugin's own review schema.
  Resuming before the fix would have produced a baseline contaminated by a defect we could remove.
  **That defect is removed, so this run is launchable.** The gate below stands unchanged and was never
  re-opened by any of this: nothing in it was wrong, it simply gated a run whose premise had moved.
  **Two things the discharge does not license.** First, every arm run before 2026-08-04 was run against
  the crashing instrument, so the 2026-07-30 and 2026-08-04 records are reliability evidence and not
  recall evidence, and nothing from them may be differenced against a new arm. Second, **OAI-84 is a
  live change to the reply parser** — two ways the default path discards an answer — so measuring
  before it lands measures a parser that is about to change. That is the same argument OAI-51 made for
  the suspension, one layer down, and it is the reason OAI-84 sorts ahead of this item.

- **OAI-45** — Close the two holes in OAI-34's end-to-end matrix. **Small, and filed because the
  matrix reads complete and is not.** OAI-34's own rule is "every verdict-bearing check gets a
  scenario crossing the real entry point", with one *stated* exemption (G8, structurally impossible to
  produce from a fake server). Measured after it shipped, there are two unstated ones:
  **(1)** `no-exposure` is the only episode verdict of the seven with no e2e scenario — every harness
  scenario uses a 500ms reply against a 300ms bar, so nothing ever produces a request that fails to
  clear the margin. It is the verdict that catches a wasted episode, so a break in it would show up
  as the sweep silently banking runs that tested nothing. A scenario needs only a reply delay below
  the bar.
  **(2)** `tests/ttl-stub-lms.mjs` documents five scenario knobs; **three are used by no test** —
  `unreadableFromMs`, `lastUsedAdvances`, `failLoad`. Unused affordances in a fixture are worse than
  absent ones: they read as coverage. Either exercise them (the first two map to real recorded
  fields — polling continuity and the `lastUsedTime` evidence ADR 013 requires be recorded and never
  branched on) or delete them and the doc lines that advertise them.
  **Sharpened by OAI-34's real run, 2026-08-04: `lastUsedAdvances` models a state that does not
  occur.** LM Studio reports `lastUsedTime: null` for the whole time it is serving a request, so
  `activityObserved` returned `null` in every episode and the "advancing timestamp" the knob
  simulates was never observed against the real server. A fixture knob that produces a shape the
  vendor does not is worse than an unused one — a test built on it would pin the instrument against
  fiction. So for this knob the choice is narrower than for the other two: **delete it, or keep it
  explicitly as a not-observed-in-the-wild case and say so in the doc line.** `unreadableFromMs`
  is untouched by this and remains a genuine shape (the run recorded `unreadableSamples: 0`, so it
  is real but did not occur).
  Note the mechanical check that found both is worth keeping as a guard rather than a one-off: the
  set of episode verdicts reachable through the e2e matrix should be compared against
  `EPISODE_VERDICTS` minus the stated exemption, so the next hole fails the suite instead of waiting
  for a review.

- **OAI-49** — A matched-budget arm, so a cross-model comparison measures the model rather than the
  model plus its window. **Filed 2026-08-04 from OAI-19's gate grill; it is the reason that run
  publishes a deployed-systems comparison and reports the clean decomposition as NOT OBTAINED.** The
  reply budget is derived from each model's served window, so the two arms do not run the same
  instrument on the same case: measured 2026-07-30, `model-info` capped at 47,724 for the dense model
  against 74,000 for the MoE, and `scaffold` at 30,683 against 65,499 — the dense model reasoning
  under less than half the space on the corpus's largest case. `structured` differs in *input* rung
  on top of that. No case in the corpus is currently a clean model-only comparison, which is a
  stronger statement than the `structured` confound already on file and was not previously noticed.
  Options: pin an explicit `contextLength` for both profiles so the derived reserve matches; or add a
  `--reserve`/`--analysis-cap` override to the review command and run a matched arm beside the
  deployed one. The second is more honest — it leaves the shipped behaviour alone and makes the
  matched arm a separate, labelled instrument — but it is a new flag on a command whose surface this
  repo guards deliberately, so it is a decision rather than a fix.

- **OAI-50** — Decide whether a run whose context probe failed should be scored at all. **Filed
  2026-08-04 from OAI-19's gate work, where the July records answered the question by accident.**
  When `model-info.mjs` cannot detect a served window, the run proceeds with `contextChecked: false`
  and the reply budget falls back to a fixed 44,405. Every off-pattern `analysisCap` in the
  2026-07-30 arms is exactly such a run — `config-origin` dense at 44,405 beside 74,000, `caps` MoE
  at 44,405 beside 74,000, `scaffold` MoE at 44,405 beside 65,499 — and they cluster immediately
  after a failed run, which suggests the probe fails in whatever server state a drop leaves behind.
  Those runs were **scored in July as if they were the same instrument as their siblings**, and the
  fallback is not uniformly conservative: dense `scaffold` derives 30,683, *below* the fallback, so a
  probe failure there *raises* the ceiling. OAI-19's gate (G-L) excludes them from scoring, which
  handles the benchmark. The open question is the product one: should `/oai:review` refuse, warn
  louder, or retry the probe, rather than quietly reviewing under a budget nobody chose? The size
  guard is disarmed on exactly that path, which is when an oversized request goes out unrefused.

- **OAI-52** — **Six items from OAI-3's own verification list did not land** — ~~five~~ **four remain
  here, both corrections dated 2026-08-05: item (1) is done, and item (3) was superseded by OAI-62,
  which found the property is not merely untested but false at two sites.** Item (6) also survives in
  a weaker form than filed — see its entry. Filed the day the feature shipped, from reading the plan's
  verification section back against the tests that exist, so
  that `BACKLOG_DONE.md`'s OAI-3 entry cannot read as complete coverage. None of these is a known
  defect; each is a property the plan said would be proved and that nothing currently proves. Ordered
  by what it would cost to be wrong about.
  **~~(1) `scripts/lib/job-auth.mjs` has no test at all — neither side of it.~~ DONE 2026-08-05** —
  `tests/job-auth.test.js`, 8 tests. Both sides: `authPolicyFor` records an origin and provably not
  the key, and `resolveCredential` is exercised on each of its four refusal legs plus the happy path.
  The wire assertion the plan asked for is there as a real submission and a real detached worker, with
  the queue held open by a synthetic `running` row so `providers.json` can be repointed in the window
  between them — the worker then fails `credential-unavailable` and **contacts the endpoint not at
  all** after the edit, which is asserted against a request-count taken at that moment rather than
  over the whole recording (submission's own probes legitimately carried the old key, in the
  foreground, while it was still authorised). **It ships with a positive control in the same file** —
  the identical fixture with the config left alone completes and carries `Bearer key-a` on the wire —
  because without it a worker that died before ever reaching `resolveCredential` satisfies every
  assertion in the negative test. Mutation-proved: neutering the third origin comparison to `false`
  turns both the unit test and the wire test red and leaves the control green.
  **Why it was the sharpest of the six, kept because it is the reason for the ordering:** `authPolicyFor`
  (submission) and `resolveCredential` (the worker) implement the rule that a key is sent only when
  the current profile's origin, the persisted `authorizedOrigin` and the persisted transport's origin
  **all three** agree — a rule adopted *because* the two-term version was found to be tautological in
  the plan gate. The plan asked for "a profile that moved origin between submission and worker start
  yields `credential-unavailable`, asserted on the wire". `tests/config.test.js:59-68` covers the
  foreground analogue (`resolveProfile` does not carry a key to another origin), which is adjacent
  evidence and not this: it exercises neither module, and the three-term check is exactly the part the
  foreground path does not have.
  **(2) `state='running'` and `worker_pid` are never observable apart.** The plan called for this as
  an *atomicity* assertion, having previously called for a test of the window between them — which
  the one-transaction design makes unreachable, and a test that cannot fail was itself a gate finding.
  The property holds by construction today; nothing notices if a later edit splits the `UPDATE`.
  **(3) A `SQLITE_BUSY` expiry is retried, never terminalized.** `isBusy` exists in `job-store.mjs`
  and three call sites use it, but no test contends the database hard enough to produce one. This is
  the failure that kills live work if it ever regresses — a job failed because two processes wrote at
  the same moment.
  **(4) A real process killed mid-transaction leaves either the pre-transaction or the committed
  state, never a partial one.** This is a claim about SQLite rather than about this code, which is why
  it is fourth; but the design rests on it, and the repo's own habit is that a load-bearing claim gets
  executed rather than cited.
  **(5) The submitter writes the row exactly once on the success path** — counted through an injected
  store, **not** by mtime, an mtime being the last write rather than a count.
  **(6) No session identifier appears in a row.** ~~Structurally true … and guarded by nothing.~~
  **Corrected 2026-08-05 by the OAI-58 ladder: this sub-item was misfiled.** A guard exists —
  `tests/status.test.js:43` asserts `doesNotMatch(JSON.stringify(row), /session/i)` — and it was added
  in `3e7d429`, *inside* the OAI-3 range and **predating this filing** (`370efc1`). What is true is
  weaker than "no test": the check is a string match on a JSON dump, so it would catch a column *named*
  with that word but not a session id stored under an unrelated key, and it carries no positive control
  proving it can fail. So the remaining work is to strengthen an existing guard, not to write a missing
  one. It is the property that distinguishes this design from the reference plugin's, whose `SessionEnd`
  sweep depends on exactly the field this schema omits. Noted in
  [ADR 014](adr/014-async-jobs.md) where the claim is made.
  **(3) is superseded by OAI-62**, which found the property is not merely untested but false at two
  sites, one of which kills a running worker.

- **OAI-56** — The prefill-overlap bound: a cancelled or dead job can hold the server for the
  remainder of its prefill after the queue has moved on. **Measured, not assumed** — LM Studio says so
  itself on disconnect ("If the model is busy processing the prompt, it will finish first"), and
  prefill is the expensive half here at ~335s dense / ~67s MoE. Same model next: only a slowdown.
  Different model next: its JIT load overlaps that prefill, which is the two-models-resident case the
  memory ceiling forbids. **Deliberately not mitigated in OAI-3**, because the obvious mitigation —
  polling `lms ps` for idleness before dispatch — is a vendor-specific check in a plugin that is
  generic by construction ([ADR 001](adr/001-generic-openai-compatible-plugin.md)), and would put an
  `if LM Studio` where the whole repo has providers-as-data. Any fix must be shaped as configuration
  or as a generic post-cancel settle delay, not as a vendor probe.

- **OAI-57** — No `--json` on `/oai:status` or `/oai:result`. **The `/oai:task` half SHIPPED 2026-08-05**
  as the prerequisite Stage 2's task benchmark turned out to have: a bench that cannot read a
  machine-readable envelope must parse prose, which is the retracted class. What landed mirrors
  `/oai:review` exactly — the reply as an opaque `content` string (nothing parses the answer's shape),
  the `notes` array so the template's caveats cannot go missing on the machine path, `contextChecked`
  beside `estimatedTokens`, and `errorReport` on failure with the exit code and stderr unchanged.
  **What remains is `/oai:status` and `/oai:result`**, and OAI-80(a)'s forgeable `attachments` line is
  still the reason to want the status half — *OAI-80 was parked 2026-08-18, `not worth doing`, so this
  is a reason and no longer a dependency.* Left out of OAI-3 phase 4
  as unrequested surface, and recorded here so the omission is a decision rather than an oversight.
  **Corrected 2026-08-05, verified against `TASK_SPEC` and by running the command:** this entry used to
  say "`/oai:task` and `/oai:review` both have it", and that is **false** — only `/oai:review` does
  (`REVIEW_SPEC.booleanFlags` includes `json`; `TASK_SPEC.booleanFlags` is `['background']`, and
  `task --json` exits 1 with "Unknown option"). The mistake matters because it makes the item look
  smaller than it is and because **Stage 2's task benchmark needs exactly this** — a bench that cannot
  read a machine-readable task envelope must parse the prose footer, which is the class this repo has
  retracted twice. The row is already a JSON-shaped record, so the cost is still small — but
  the moment it exists it is a **contract**, and the enumerated-field problem OAI-36 describes for the
  bench reliability prose applies to it exactly. Do it when something actually consumes it (the
  `oai-delegate` agent in OAI-5 is the likely first consumer), and version the envelope when you do.

- **OAI-151** — **There is no cross-run history, so no sweep can be compared with the sweeps before
  it.** Raised by the user during OAI-132's grill, 2026-08-13, as "some kind of history log using
  SQLite", and deliberately not built there.
  **Its justification is OAI-141**, which measured run-to-run spread (17 vs 22 finding-bearing commits
  on identical inputs; 5 of 17 not reproducing) *above* the difference between the configurations being
  compared. A per-commit reproduction rate across runs is the number that decides whether any sweep A/B
  means anything, and nothing can currently compute it.
  **What was settled and need not be re-derived** (ADR 022): SQLite is not more crash-durable than a
  synchronous append for the *within-run* job, and ADR 018 gates `node:sqlite` as a **capability**, so a
  hard dependency there would have made an unattended run's crash protection conditional on precisely
  what the job store kept optional. **Neither argument applies to a cross-run index**, which is not on
  the crash path and may reasonably be optional.
  **Feedstock already exists**: every run leaves `review-sweep-<stamp>.ledger.jsonl` carrying per-commit
  `startedAt`/`endedAt` and the full enumerated manifest in its header. A history would consume ledgers,
  not replace them.

- **OAI-159** — **78 citations in this file point at an `adr/` corpus that no longer exists, and 37 of
  the 99 live items depend on one.** Filed 2026-08-14 by the backlog sweep, counted rather than
  estimated: `adr/` was deleted whole in `d1ad2aa` (2026-08-13, 23 files, owner's decision).
  **This is a decision that was deferred, not an oversight** — and the deletion commit says so in its
  own words: *"agents/oai-delegate.md and BACKLOG*.md are pinned by tests and were deliberately not
  touched"*, while comment-only references elsewhere were *"left dangling as history, matching the
  convention used for the deleted routing log"*. So the convention was chosen for code comments and
  **never applied to the tracker**, which is the file where a citation is doing different work.
  **Why the tracker is not the same case.** In a comment an `adr/020` reference is provenance a reader
  can ignore. Here it is frequently the EVIDENCE: OAI-63 argues *"Against the ADR, precisely:
  `adr/014:147-152` states the rule as three origins"*; OAI-69's urgency rests on ADR 014 accepting a
  wedge *"on the stated condition"*; OAI-138's whole cap argument turns on what `adr/021` assigns the
  deadline. Those claims are now **unverifiable by a reader**, and the ones with line numbers were
  already citations into a mutable file.
  **Distinct from the two items about counts** (OAI-110, OAI-146): those are about a figure stated in
  two places drifting. This is about the referent being gone.
  **The options, and none is "rewrite 78 citations by hand"** — that is the rebasing this repo's sweep
  discipline forbids, since it re-rots within hours: (a) declare tracker ADR references historical,
  the same convention the deletion used elsewhere, and say so once in this file's header rather than
  78 times; (b) for the handful that are load-bearing evidence, replace the reference with the
  **quoted sentence** it was standing in for, which survives the file it came from; (c) restore the
  corpus. **(a) plus (b) for the load-bearing few is the cheap combination**, and (b) is the only part
  that needs judgement — it means deciding which citations are evidence rather than provenance.
  The full list of affected items, so the judgement pass has a worklist: OAI-11, OAI-13, OAI-19,
  OAI-27, OAI-39, OAI-42, OAI-45, OAI-52, OAI-53, OAI-54, OAI-55, OAI-56, OAI-63, OAI-64,
  OAI-69, OAI-74, OAI-87, OAI-91, OAI-93, OAI-95, OAI-101, OAI-103, OAI-105, OAI-110, OAI-114,
  OAI-127, OAI-135, OAI-136, OAI-138, OAI-141, OAI-143, OAI-146, OAI-148, OAI-149, OAI-151, OAI-153.
  (OAI-59 dropped 2026-08-23 when it shipped and its body left this file.)

- **OAI-192** — **`job-launch-outcome.mjs:79`'s `terminalizeSpawnFailure` interpolates a raw spawn
  error's `.message` directly into the object it hands to `errorReport()`, bypassing that function's
  explicit-field-list redaction entirely** since the content is already baked into `.message` before
  `errorReport` ever sees it. Found and deferred during OAI-185's review ladder (pass 1, Codex steer:
  DEFER). Confirmed real but low-severity: production spawns `process.execPath` directly (the
  companion script is an argument, not the executable), so a genuine spawn rejection here names the
  Node binary or a local state/log path, never a remote endpoint, request target, response body, or
  authorization value — the class of naturally secret-bearing input OAI-185 protects against. Reopen
  if an actual secret-bearing spawn-error message is ever observed; until then this is structural
  hardening, not a demonstrated leak.

- **OAI-194** — **A server-reported model id can reach a `UserError` message unredacted, via
  `model-selection.mjs`'s `unservedProblem`/`autoSelect` (`listModelIds` over the server's own
  `/v1/models` response) → `delegate.mjs:111`'s `selectModel`.** Found by Codex during OAI-185's pass-5
  adversarial review, real but assessed as not currently exploitable through the background
  persistence path OAI-185 protects: model selection runs inside `prepareTask`'s `resolveTarget`,
  which completes at submission time — before `task-submit.mjs` ever creates the job row — so a
  refusal here fails the foreground submission outright rather than reaching `errorReport()`/`jobs.db`
  or a worker's job log. Reopen if model selection is ever moved to run inside the worker, or if a
  foreground-only exposure (this message on an operator's own terminal) is judged to need the same
  structured-field treatment OAI-185 gave the transport layer.

- **OAI-201** — `agents/oai-delegate.md`'s pre-existing `canon()` (path containment for `files`,
  unrelated to model selection) checks only `/[\x00-\x1f]/` — C0 controls — not the fuller
  `[\x00-\x1f\x7f-\x9f]` range OAI-181's model-id validator uses in the same file. A real in-tree
  filename containing DEL or a C1 control character would be resolved and accepted despite the
  attachment rule's stated "refuse a control character." Found by `codex-adversarial` during OAI-181's
  review ladder (pass verdict point, round 5), 2026-08-23 — concrete and verifiable, but a
  `files`/containment concern predating OAI-181, not a per-call-model one, so left out of that item's
  diff rather than absorbing a second subsystem's fix into it.

- **OAI-202** — `tests/delegate-template.test.js`'s file-level header comment ("runs the block under
  EVERY shell on the machine") and several test names/comments repeating that claim overstate the
  fixed `SHELLS` allowlist, which excludes any other shell installed on the machine — confirmed
  present on this machine at `/bin/ksh` and `/bin/tcsh`, neither tested (the latter a C-shell
  derivative, not even POSIX-family, so "every shell" was never literally true regardless of which
  allowlist shipped). Found by `codex-plain` during OAI-181's review ladder (pass verdict point, round
  5), 2026-08-23 — real, but a pre-existing documentation claim about the test file's own methodology,
  predating OAI-181 and not something its diff introduced or needed to correct.

- **OAI-203** — `tests/delegate-containment.test.js` leaks a temp directory on every one of 13
  `mkdtempSync` call sites (`withScratchRepo`'s `repo`, and the direct `outside`/`nogit`/preload/
  openssl-conf/wrong-prefix/symlink fixtures) — none is wrapped in a `finally` or removed by any
  `rmSync`/cleanup hook anywhere in the file, confirmed by reading the whole file. The 14th site, the
  recipe's own `$dir` inside `runContainment`, is the only one cleaned, by the real shell `trap
  'rm -rf "$dir"' EXIT INT TERM HUP` it exercises (`agents/oai-delegate.md:94`) — so this is
  specifically the 13 sites the recipe's own trap does not reach. `withScratchRepo` is invoked
  repeatedly across the file's tests, so the actual per-run leak count exceeds 13. Present,
  deterministic and silent on every test run (not a hypothetical), so it clears the filing worth bar
  unlike the other two candidates from the same sweep (see `bench/2026-08-23-oai19-run-notes.md`'s
  Codex-reviewed triage). Found by an overnight `bench/review-sweep.mjs` run, 2026-08-24, confirmed by
  direct reading and a second look from `codex-rescue`.

- **OAI-205** — `bench/lib/reason-notes.mjs`'s `reasonNotes` has two accuracy gaps against the OAI-204
  ledger fix, both display/prose-only (nothing dispatches on them): (1) it has no explanatory
  paragraph for `reasoning-only` now appearing as an ATTEMPT-level reason (`markUnanswered` can now
  reclassify a losing salvage sub-attempt to `failed`/`reasoning-only`) — it previously only ever
  covered `reasoning-only` as a run-level/top-level reason; (2) its `token-reserve-cutoff` paragraph
  (line 158) asserts "the follow-up... attempt already ran and failed" unconditionally whenever that
  reason appears anywhere in a run's `attempts[]`, which is now false whenever that attempt's own
  ledger entry survives alongside a LATER successful salvage or an ineligible-for-salvage run — the
  attempt remaining in the record no longer implies salvage failed. Found by `codex-plain` at the
  OAI-204 review-ladder's verdict point, 2026-08-24.

- **OAI-206** — `attemptSalvage` (`scripts/lib/review-request.mjs`) labels ANY salvage follow-up that
  lands with empty content as `reasoning-only` via `reasoningOnlyFailure`, including one whose
  `finish_reason` was `'length'` — a token-exhaustion shape, not a clean-finish-with-no-content shape.
  This contradicts `client.mjs`'s own `isReasoningOnly` definition, which explicitly requires
  `finishReason !== 'length'`. Attempt-record display only (nothing dispatches on `reason` here), but
  a persisted record can now carry a wrong label for this case. Found by `agent-closer` at the OAI-204
  review-ladder's pass, 2026-08-24, while auditing the `markUnanswered` fix's blast radius.

- **OAI-207** — `bench/lib/sweep-outcome.mjs` has two pre-existing gaps, neither introduced by OAI-204
  but both found while auditing its diff: (1) `reported()` reads `report?.salvaged` explicitly but
  never reads the new `salvageTrim` field, so a sweep's outcome classification is blind to whether a
  rescued run was trimmed, fell back untrimmed, or wasn't eligible — out of scope for OAI-204 itself
  (that field's design is explicitly JSON-only, no sweep-integration was ever asked for), but a real
  gap for anyone wanting to compare trim-vs-fallback rescue rates from `bench/review-sweep.mjs` output
  without reading raw JSON records by hand. (2) `STARVED_REASONS` (a `Set` including
  `'token-reserve-cutoff'`/`'reasoning-only'` plus `'token-exhaustion'`) is a third, independently
  maintained copy of a reason list that overlaps but does not match either
  `SALVAGE_SMALL_RESERVE_REASONS` or `SALVAGE_REASONS` in `scripts/lib/review-request.mjs` — the exact
  drift risk OAI-204 consolidated those two into one shared `Set` specifically to prevent, one file
  over. Found by acceptance-audit's whole-artifact scout during the OAI-204 review-ladder, 2026-08-24.

