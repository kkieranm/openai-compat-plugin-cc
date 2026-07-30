# 008 — Sizing the review reply, and what a censored run is worth

Date: 2026-07-28
Status: accepted
Supersedes parts of: [ADR 004](004-bounding-the-review-reply.md)

## Context

ADR 004 gave `analysis` — the schema's first property, where the model does its reasoning — a
`maxLength` of 28,000 characters. A grammar enforces that as a hard cut at exactly the limit with
`finish_reason: stop`, so a guillotined review returns complete, valid JSON, usually with an empty
findings list. ADR 004 recorded that this reads on screen as a clean pass and added `analysisCut` to
say otherwise.

**What it did not fix is how often it happens, or what a cut run is then worth. 17 of the 41
benchmark runs ever recorded were cut**, and `bench/lib/report.mjs` excluded every one of them from
both the numerator and the denominator of recall — so on a corpus where half the runs are censored,
half the evidence was discarded. That is what blocked the dense-27B arm: `scaffold` completed in 959s
once OAI-6 removed the timeout, and still scored 0 of 3, reported as `cut: 1`. A result-shaped
nothing.

Four things the probe settled before any of this was designed:

| claim | verdict |
|---|---|
| Buying reasoning room costs reviewable input — BACKLOG's "the whole decision" | **stale**. `prepareRequest` shrinks the reserve to `max(REVIEW_MIN_TOKENS, contextLength − estimatedTokens)`; a review is refused only under 4,096 spare, whatever `REVIEW_MAX_TOKENS` says |
| The bench drops cut runs from recall entirely | true |
| 28,000 was set by the 20-finding worst case, not the observed distribution | true — ADR 004 says so in its own consequences |
| `structured.mjs`'s comment claimed the caps sit above every observed run | true, and it contradicted ADR 004 two files away |

And two the data settled:

- **Cutting does not track input size.** `config-origin` (1,575 prompt tokens) cut 6 of 9;
  `docs-only` (4,448) cut 0 of 9; `structured` cut 4 of 4; `scaffold` (47,069) cut 4 of 11. Sending
  less is not the lever, and the retracted dilution claim was the wrong one.
- **The reserve was never the constraint — the accounting was.** On five of six cases the reserve was
  ~55,700 characters while `analysis` got 28,000, because ~24,500 was held back for a 20-finding
  reply. **The most findings any recorded reply has carried is six.**

There was also a live defect nothing had tripped. `cmd-review.mjs` sends the *shrunk* reserve as
`max_tokens`, so on `scaffold` the budget on the wire was 11,043 tokens while the schema's envelope
was ~15,695. The flat cap agreed with the reply budget only by coincidence, and on the largest inputs
it did not agree at all.

## Decision

**The `analysis` ceiling is derived per run, from the reply budget actually granted.**
`reviewSchemaFor(reserveTokens)` in the new `scripts/lib/review-schema.mjs` sizes it as
`clamp(reserveTokens × CHARS_PER_TOKEN − RESERVED_CHARS, 2_000, 74_000)`. The number that bounds the
reply is now derived from the number that pays for it, rather than sitting beside it and agreeing by
luck. On the 58k-window MoE that is 74,000 characters for four of six cases (2.6× today), 46,620 for
`model-info`, and 26,046 for `scaffold` — which loses 7% and stops over-committing.

**The reply is budgeted for eight findings, not twenty.** `MAX_FINDINGS` stays 20 — the schema still
caps the list — but the *budget* no longer reserves room for a shape that has never occurred. This is
the trade the user chose explicitly: it frees ~13,000 characters for reasoning on every run, at the
cost of a rare `finish_reason: length` overrun if a reply ever does carry many long findings on a
tight window. That failure is loud and already handled; a shallower review on every large diff is not.

**`REVIEW_MAX_TOKENS` rises 16,384 → 32,768, and only where the window is known.** ADR 004 refused
this, and the refusal was right for its evidence: with nothing bounding the reply, more room bought
only a longer runaway. With the schema bounded it buys larger caps instead — and the cost the refusal
protected against no longer exists, because the reserve yields to the input. A separate
`REVIEW_UNKNOWN_WINDOW_TOKENS` stays at 16,384: with no window there is no shrink and no budget
check, so that number goes on the wire against a server whose capacity is a guess, and doubling a
guess is not an improvement (OAI-13 item 4).

**74,000 is a wall-clock bound, not an arithmetic one.** Roughly 21,765 tokens — 6-9 minutes of
generation on the MoE, ~28 minutes on a dense 27B. Above it the reserve would still permit more and a
review would stop being worth waiting for. It was verified against the server before being relied on:
LM Studio compiles a grammar at `maxLength` 74,000 and 90,000 without complaint.

**A cut run's findings are counted; its silence is not.** This is the correction the plan needed, and
it came from an independent challenge to the plan rather than from the code. The cut lands on
`analysis`, which the schema orders *first*, after which the model emits `findings` normally — so a
cut run's findings are as checkable as any other's. But a defect it did not name may be one it never
reached. **Positives are trustworthy; absences are unknown.** Folding those absences in as misses
would have traded the old censorship for a different distortion, understating the reviewer instead of
hiding it.

So the report separates the two. The `defects found` column counts **only what was observed** — a cut
run's unreported defects still sit in its denominator, which is the conservative reading — and a new
`unresolved` column says how many of those denominators are uninterpretable. The upper bound is
stated in the caveat, in prose, rather than printed.

**A band was tried first and rejected on an adversarial review of this design.** Printing
`0–3/3 (0%–100%)` under a heading that says "defects found" reports defects nobody found: the high
endpoint is not observed recall but the counterfactual that continued reasoning would have found
*everything* remaining, so a wholly censored run rendered indistinguishable from a perfect one. The
uncertainty is real and has to stay visible; it must not be smuggled into a figure whose name
promises observation. Where no run was cut, `unresolved` is zero and the row is byte-identical to
what this table printed before, so past figures stay comparable.

`analysisCutRuns` and `truncatedRuns` are now separate predicates. They were safely conflated only
while both were excluded: an analysis-cut reply is complete JSON with real findings, while a
`length` reply never parsed and has nothing in it to score.

## What was measured after the change

Three runs of `config-origin` on the dense 27B (`qwen/qwen3.6-27b`, 61,696-token window), immediately
after the change. Window → reserve 30,848 → derived cap **74,000**, which is what the records show the
request actually carried, so the derivation is confirmed end to end against a real server and not only
against a fake one.

| run | `analysisLength` | cut | findings | completion tokens | seconds |
|---|---|---|---|---|---|
| 1 | 7,075 | no | 0 | 1,945 | 129 |
| 2 | 21,240 | no | 0 | 5,768 | 363 |
| 3 | 19,942 | no | 0 | 5,789 | 360 |

**Cut 0 of 3, on the case that cut 6 of 9 before.** And for the first time the right edge of that
distribution is *observable at all*: under the old cap every run landing at 28,000 was
indistinguishable from one that would have stopped at 28,001 or at 90,000. Here the longest run
stopped at 21,240 — under the old ceiling — which says this model reasons to a natural end on this
case rather than filling whatever it is given. That directly contradicts the "the model will fill
whatever room it has" reading in ADR 004, at least for this model and case.

**Three things this does *not* show, stated because the temptation to over-read it is exactly what
this repo has retracted twice:**

- **It is one case, one model, N=3.** `structured` cut 4 of 4 and `scaffold` 4 of 11 on the MoE, and
  neither has been re-run. Whether 74,000 is high enough *in general* is unmeasured.
- **More reasoning bought no findings here.** All three runs reported nothing, on a case with two
  listed defects — where earlier runs of the same case did find one. This change removes censorship
  from the measurement; it is not evidence of better review quality, and reading it that way would
  repeat the dilution error.
- **It costs wall clock.** 129–363s per run against 49–156s for the same case before.

## What is deliberately not claimed

**No guarantee that the reply fits its budget.** `RESERVED_CHARS` is an estimate and is documented as
one. `maxLength` caps a *decoded* string, not its JSON serialization, so escaping expands it; `line`
is an integer of unbounded textual width; and `CHARS_PER_TOKEN` was calibrated on input code and
diffs, which is not evidence about output prose on an arbitrary tokenizer. A real bound would need
`MAX_FINDINGS` lowered to eight or the full twenty reserved, and neither is the trade taken. The
tests assert the **formula**, never "the envelope fits" — a test named for a guarantee the code does
not provide is this repo's signature defect wearing a green tick.

**Eight is a policy bet, not a measurement.** Every observation behind it was taken *under* the old
cap, and more reasoning room may itself produce more findings. Using the pre-change maximum to
predict the post-change tail assumes the intervention does not move the quantity being budgeted, and
there is no evidence for that. Revisit it against post-change data.

**The "raise --max-tokens" remedy does not always work now.** Below the ceiling every extra token
goes to `analysis`, not to the findings tail — so if a ninth long finding caused the overrun, raising
the budget buys more reasoning and the same failure. On a large input `prepareRequest` may shrink the
raised value straight back. The hint says what actually helps.

**A cut run still cannot be read as a clean pass.** The `unresolved` column exists precisely because
it cannot.

**The reply-budget floor is enforced on the explicit path only, on purpose.** An explicit
`--max-tokens` below `MIN_REVIEW_RESERVE_TOKENS` is refused; a *model* whose half-window reserve
lands below it is not. The two look alike and are not: the first is a mistake that costs nothing to
reject, the second is the only budget that model has, and refusing every review under ~7,824 tokens
of window would deny work that usually succeeds (ADR 004 measured good runs at 1,333–5,450 output
tokens). Below that window a reply may overrun and fail loudly with `finish_reason: length` — ADR
004's deliberate trade, not a regression. A reviewer flagged the asymmetry as a guard armed on one
path and disarmed on the other, which is the right instinct; it is now stated in the code and pinned
by a test so it stays a decision.

## Consequences

- An explicit `--max-tokens` below `MIN_REVIEW_RESERVE_TOKENS` (3,912) is **refused, naming the
  number**. `reserveFor` honours a requested value verbatim and nothing downstream raises it, so this
  was the one path that could ask for a reply too small to hold the schema about to be sent.
- `parseFindings` **requires** the schema when `structured` — as a thrown `TypeError`, because
  deleting a default does not enforce anything in JavaScript. The cap is per run, so a caller
  comparing against a different schema would report `analysisCut: false` for a guillotined run.
- **`analysisCap` is `null` on the degraded path.** No grammar applied there, so reporting a ceiling
  would name one that was never enforced. The degraded rung still *sizes* its instruction from its
  own reserve, resolved without an iteration by measuring once with the widest schema this module
  builds: that instruction is the longest possible, so the reserve it leaves is a lower bound and the
  cap derived from it can only under-state the room available.
- The report's exclusive buckets become `scored + truncated + unreadable + failed`, and the cut count
  rides *inside* the scored cell (`3/3 (2 cut)`). Those runs are scored; a bucket of their own would
  break the sum and read as an exclusive category it is not. `tests/bench-report.test.js` now looks
  cells up **by column name**, since adding the `unresolved` column would otherwise have shifted
  every positional index and left the assertions silently checking the wrong number.
- `tests/review-schema.test.js` pins the formula, the clamps, the per-run cut judgement and the
  every-field-has-a-ceiling guard **across a swept range of reserves** rather than on one constant.
- `structured.mjs`'s claim that the ceilings sit "above every successful run observed" is deleted. It
  was false when written and contradicted ADR 004 in the same repository.

## Does the wall-clock ceiling still bind? Partial answer, 2026-07-30 (OAI-19 attempt)

The full-corpus re-measure never produced a gate-passing arm (server reliability — see ADR 006 and
OAI-20), so this is evidence, not the measurement. Across the dense 27B's scored runs the ceiling
**still binds on the largest cases**: `scaffold` (47k prompt tokens) cut 2 of 3 scored runs in one
attempt and 3 of 3 in the other, `model-info` (41k) cut 1 of 3 in each. `structured` — the case
that was 4 of 4 cut under the old fixed ceiling — was **never cut in any dense scored run**, but
that observation carries a confound the raw records expose: the dense model's smaller served
window (61,696 vs the MoE's 71,936 — the dense figure is sourced earlier in this ADR; the MoE
figure was read live off `lms ps` during the attempt and appears in no bench record, which log
"context window unknown" for it) sent `structured` down ADR 005's diff-only rung
(`hunksOnly: true`, ~28.6k prompt tokens) while the MoE reviewed whole files (~59.7k), so the
dense "never cut" may only mean "much smaller input" — the two arms did not see the same request,
and the case exercises a *different rung per model*, which any future cross-model reading of it
must state. The MoE was cut once — in **20 scored runs**, not 36: the other 16 failed server-side
and a failed run is missing data, not an observed non-cut. What still hits the ceiling is the dense model
reasoning long on the biggest inputs; whether that residue is worth raising the ceiling for is a
question for a corpus run that completes (OAI-19, after OAI-20).
