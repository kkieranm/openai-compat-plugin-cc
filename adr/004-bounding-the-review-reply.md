# 004 — Bounding the review reply

Date: 2026-07-27
Status: accepted
Builds on: [ADR 003](003-structured-findings.md)

## Context

`/oai:review` works end to end but finds a real defect in roughly one run of five. Measured on one
135-line file with two known defects (`config.mjs` at `8990173`), four runs of the identical command
produced: one real defect, three false positives, two empty results, and **one run that returned
nothing at all** because it hit the token ceiling mid-JSON.

That last failure is not a quality problem, and it is the one this ADR addresses.

**It was a runaway, not a shortfall.** The failing run generated exactly **16,384** completion
tokens — the whole reserve, since `reserveFor(58112)` is `min(16384, 29056)` and the config sets no
`contextLength`. The runs that finished used 5,450 / 2,521 / 2,301. Raising the ceiling would only
have bought a longer runaway: the half-window cap allows 29k on this machine, which at the observed
rate is roughly four minutes to reach the same failure.

**The prompt is the wrong instrument.** The runaway run used the same prompt as the runs that
behaved. A model that has begun looping does not honour a request for brevity — the same lesson as
the earlier temperature-0 experiment, where greedy decoding degenerated into repeating two wrong
claims until the budget ran out.

Probing LM Studio serving `qwen3.6-35b-a3b-ud-mlx` established what the grammar *can* enforce:

- **`maxLength` on a string is enforced** — a hard cut at exactly the limit, `finish_reason: stop`.
- **`maxItems` on an array, alone, is actively harmful.** With `maxItems: 3` on a reasoning field the
  model emitted `analysis: []` in six tokens. The grammar offers a zero-cost exit and the model takes
  it — the exact commit-before-reading collapse ADR 003 exists to prevent.
- `minItems` restores the floor, and a bounded list of reasoning steps works well (8 steps, 1,333
  output tokens, no truncation). But choosing how many steps to reason in is *steering*, not
  bounding, and that is a different decision — see below.

## Decision

**The schema carries the bounds; nothing else changes.** Every string and array in `REVIEW_SCHEMA`
gets a ceiling: `analysis` 28,000 chars, `summary` 1,500, a finding's `file`/`summary`/`evidence`
200/300/600, and `findings` at most `MAX_FINDINGS` (20). Worst case is 53,360 characters — 15,695
tokens at the guard's conservative 3.4 chars/token, 14,782 at the 3.61 measured on real constrained
output — against a 16,384 reserve. (Output is *denser* than the 3.4 constant, which was measured on
input code and diffs, so predicting output with it errs toward over-estimating tokens. That is the
safe direction here.)

**Every first-guess number was wrong, and live verification is what caught them.** Three of the four
string caps bound on ordinary runs within an hour of being written:

- `evidence` at 400 cut a real finding on the first commit diff tried — 399 characters plus a
  mid-token cut that rendered as a garbled character. Now 600.
- `analysis` at 24,000 bound on a plain review of a 135-line file: cut mid-sentence while describing
  a defect in `buildProfile`, after which the model reported **zero** findings. Now 28,000.
- `summary` at 800 was cut mid-word on a commit diff, where the model wrote a numbered list into a
  field meant for a closing recap. Now 1,500.

**Pick a cap by the harm done when it cuts, not by what the field is nominally for.** The failure
was assuming a field's name constrains what goes in it: this model writes long prose into every
string it is offered, so a cap sized for the *intended* content binds constantly. Ranked by harm, a
cut `analysis` is worst (the model then reports nothing), a cut `evidence` next (the quoted line
stops being checkable against the code), and a cut `summary` least (the findings above it are
intact). That ordering, not field semantics, is what the numbers should reflect — and a cap sized
from observed *totals* will always bind, because the field it caps is most of the total and the
distribution has a long tail.

**This is a backstop against runaway, not a guarantee that truncation is impossible.** On a
small-window model the reserve is `contextLength / 2` — 4,096 on an 8k model — and the envelope's
worst case exceeds it. That is accepted rather than engineered around: observed good runs used
1,333–5,450 tokens, so most small-window reviews succeed, and refusing them all to protect a worst
case would break far more than it fixes. The existing `finish_reason === 'length'` error in
`cmd-review.mjs` is the correct answer there and stops being near-dead code. Claiming a guarantee we
do not have is this repo's signature defect class, so the wording matters.

**Ceilings belong on output, floors on thinking**, and the two are not interchangeable. `analysis`
stays a bounded *string* rather than the bounded list the probe demoed: the list's only unique
benefit is a step-count floor, which addresses no observed failure, while `maxItems` on it is exactly
what produced the six-token collapse.

**Size caps are not re-validated on the way back in.** `matchesSchema` still ignores `maxLength` and
`maxItems`, deliberately. Conformance exists to prove a reply is the grammar-constrained payload
rather than a scratchpad draft, and identity is settled by `type`, `required`,
`additionalProperties` and `enum`. The caps are instructions to the generator, not claims about the
payload — enforcing them would mean a server that accepted the schema and ignored a cap had its
perfectly good findings binned for being wordy, buying a new failure mode in exchange for none.

**Hitting the findings cap is reported.** This is the one cap that can lose real output: the string
caps only ever trim reasoning, but a 21st finding is a defect the model actually found. Raising the
cap is not the fix — 50 findings would force `analysis` down to ~1,500 tokens to keep the total under
the reserve, gutting the reasoning space ADR 003 established as load-bearing. So the cap stays tight
and `renderFindings` says the list hit its limit and there may be more. At exactly the cap there is
no way to distinguish "found 20" from "found more and was cut", so it says that rather than inventing
a dropped count. The test is `=== MAX_FINDINGS`, not `>=`: a list *longer* than the cap is reachable
on a server that took the schema and ignored `maxItems` — the same case that keeps `matchesSchema`
out of the size business — and there every finding is already on screen, so the warning would be
about a cut that did not happen.

**Two levers were deliberately separated.** The bounded probe run finished in 22.7s / 1,333 output
tokens — but its caps never bound (longest step 1,120 of 1,500 chars). The reduction came from a
*sentence telling the model its budget*, which steers the reviewer to reason less, and reasoning less
is what made it useless before ADR 003. That is a recall trade with no measurement behind it, so it
does not ship; it is an OAI-12 experiment, along with whether a floor on `analysis` is worth adding.
The single bounded run found neither known defect and produced one false positive — at a 20% hit rate
that is noise, and it is evidence for nothing.

**Correction to ADR 003:** it records `REVIEW_MAX_TOKENS = 4096`. Commit `890ee2e` raised it to
16,384 when the `analysis` field was added, and it stays there — a backstop the schema should now
reach first.

## Consequences

- A pathological run now returns a *parseable* reply instead of nothing, because the grammar stops
  before `max_tokens` does on this machine. **It does not return good findings.** The one run
  measured hitting the `analysis` cap went on to report zero findings — the cut is not a rescue, it
  converts an error into a cheap empty answer. This is worth having (the pass fails in 70s instead of
  four minutes, and `/oai:review` never dead-ends on a truncation error) but it is not a hit-rate
  improvement, and nothing here should be read as one.
- **A cap cannot tell verbose from runaway.** Length is the only signal available at generation time,
  and the two distributions overlap. Every cap therefore has a range where it cuts productive work;
  the numbers above move that range above what has been observed rather than eliminating it. The
  `analysis` cap still binds in roughly one run of five even at 28,000 — but the run measured doing
  so went on to report a finding, where the same event at 24,000 produced none.
  **So the stated criterion is not actually met, and cannot be.** 28,000 is set by what fits the
  16,384-token reserve once the findings array is accounted for, not by what clears the observed
  distribution — that distribution has no visible right edge, since the model will fill whatever it
  is given. "Above the verbose-but-productive range" is the goal the numbers are pointed at, not a
  property they achieve. Raising the reserve is the only lever that would move it, which is the
  OAI-12 experiment noted below.
- **The caps were A/B'd against an uncapped schema and show no effect on how much the model reasons.**
  Identical input (the `1ea398f` diff), same prompt, only the caps differing. Analysis lengths came
  out 3,775 / 16,890 / 1,903 / 15,946 / 28,000 capped against 2,179 / 1,694 / 3,542 / 5,960
  uncapped — overlapping heavily, with the capped arm the *longer* of the two on average. An earlier
  three-run slice had suggested the opposite; the direction flipped when two more runs were added,
  which is the point. **Run-to-run variance on this model dwarfs anything measurable at n=5**, and a
  short collapse (~300 output tokens, no findings) appeared in both arms, so it is a property of the
  model rather than of the schema. This is precisely why OAI-12 exists: nothing about reviewer
  quality should be concluded from single runs, including anything claimed here.
- **Raising `REVIEW_MAX_TOKENS` is now safe in a way it was not before, and is untried.** The
  original refusal stands for its own reasons — more room bought only a longer runaway when nothing
  was bounded. With the schema bounded, a larger reserve instead buys room for larger caps: the
  half-window rule allows 29,056 on a 58k model, roughly double today's. Whether bigger caps improve
  anything is exactly an OAI-12 question, so it is recorded, not acted on.
- `tests/structured.test.js` guards that every string and array in the schema carries a ceiling, so a
  field added later without one fails there rather than in production. This is the defect class
  graduating from a reviewer's prompt to a structural test.
- A second test pins the decision not to validate sizes, so a future reader "fixing" the apparent
  omission in `matchesSchema` breaks a test that explains why.
- `MAX_FINDINGS` is exported and shared between the schema and the renderer rather than copied, so
  the cap and the warning about it cannot drift apart.
- The caps are unprobed on oMLX and Unsloth Studio. A server that ignores them degrades to exactly
  today's behaviour — the runaway is possible again, and the existing loud truncation error catches
  it. Nothing silently gets worse.
- Hit rate is untouched. This item removes one of the five ways a pass is wasted; the other four are
  OAI-9 (multi-pass union), OAI-11 (diverse models and lenses) and OAI-12 (the corpus that would let
  any of this be measured rather than argued).
