ARCHIVE — not the current spec; the live plan is the file beside it.
provenance: harness slug recursive-napping-llama

# OAI-227 — reasoning-state comparability axis in `bench/compare.mjs`

## Context

`bench/compare.mjs` reads N `/oai:review` records together and withholds the ranking when they are
not like-for-like. `bench/lib/compare-model.mjs`'s `divergencesOf()` compares the per-case *lens*
(the `<rung>@<window>` depth a case was reviewed at) as one such comparability axis: two records that
reviewed a case at different depths are not a like-for-like recall comparison, so the ranking is
suppressed and the case named.

The observed **reasoning state** is the same class of server-controlled input. The thinking channel
is set by the server's chat template (`enable_thinking`) and no OpenAI-compatible request field
reaches it (OAI-221), so two records — two models, or one model on two days — can differ on the one
variable that moves review capability most, with nothing in the comparison to show it. `divergencesOf`
has no reasoning axis, so a record whose model reasoned and one whose did not (or one whose reasoning
state is unknown) rank as measuring the same thing, and a recall gap gets mis-attributed to whatever
axis the reader *does* compare.

The witness is already on the row: `bench/lib/case-rows.mjs` `caseRows` sets
`row.reasoning = reasoningSamples(runs)` — the deduped set of `reasoning-observed` /
`no-reasoning-observed` / `unknown` states (`scripts/lib/reasoning-witness.mjs`) over `measurable`
runs. Nothing consumes it for comparability yet. This is deferred OAI-220 residue: the axis set was
dual-approved without it, so this is its own comparability-axis change.

**Owner-confirmed (Claude + Codex both steered A): fail-closed.** Compare the observed reasoning-state
sets opaquely; a difference — including *known vs unknown* — suppresses the ranking, because an
`unknown` record cannot be proven not to have reasoned.

## Design (approach B — amended 2026-08-29 after review, see thread below)

**The comparison derives its per-case reasoning/lens sets over the SCORED run population**
(`run.score && !run.error && !truncated`) — the runs that produce the ranked measurement (recall) —
**not the `measurable` population** (`run.report && !run.error`, which includes truncated and
unreadable runs). This is what makes the axis actually fail-closed; see the thread for why measurable
was wrong.

- **One shared definition.** Export `scoredRuns(runs)` from `bench/lib/run-buckets.mjs` (the scored
  predicate currently inlined in `case-rows.mjs` `buckets()`), and use it in both `buckets()` and
  `compare-model.mjs` so the population has a single definition (`CLAUDE.md` one-definition rule).
- **Reasoning (new, comparison-only):** add `reasoningByCase(results)` in `compare-model.mjs` deriving,
  per case, the deduped `reasoningWitness` state set over `scoredRuns(runs)` → stored as
  `n.reasoningScored` on the normalized record (parallel to `n.lens`). The **displayed** `row.reasoning`
  (`case-rows.mjs` `reasoningSamples`, over `measurable`) is UNCHANGED — display and comparability are
  deliberately different populations.
- **Lens (pre-existing, comparison-only — owner-authorized sweep):** `n.lens` (`lensByCase`) is already
  comparison-only (the displayed lens is `row.lens`), so simply switch `lensByCase` from
  `measurable(runs)` to `scoredRuns(runs)`. No display impact.

**The divergence block is then a single value arm per axis**, because with the scored population an
empty set means exactly `scored === 0`, which is the coverage axis's job (the original premise, now
valid) — so the two-arm unprovable guard and the added lens unprovable arm are REMOVED:
- Reasoning: among records whose `n.reasoningScored` is non-empty (i.e. `scored > 0`), a differing
  sort-canonicalised signature suppresses; two records both witnessing only `unknown` rank through
  (owner's Option A). A `score`-without-`report` scored run classifies as `unknown` (no usage), so it
  suppresses against a known state and ranks through only against another unknown — consistent with
  Option A, and no special empty-set arm is needed.
- Lens: reverts to its original `lensUnknown`-arm + value-arm form, now correct because a scored run
  with no report yields an unprovable (`unknown`) strict lens, caught by the existing `lensUnknown`
  arm.

The `[...].sort()` canonicalisation stays load-bearing (first-seen order).

## Amendment thread

- **Round 1 (original, dual-approved digest 9b7783774d17):** read `row.reasoning` (over `measurable`)
  directly, filter empty as "coverage's job". **Refuted in review:** `scored` gates on `run.score`
  while `measurable` gates on `run.report`, so the populations differ.
- **Pass 1 fix (two-arm):** kept the measurable population but added an unprovable arm suppressing a
  scored record with an empty set. Fixed the `score`-without-`report` instance. **Still wrong:**
  Pass 3 (codex-adversarial, confirmed by repro) showed the measurable population also CONCEALS a real
  scored-run difference — record A `[scored:observed, truncated:no-reasoning]` vs B
  `[scored:no-reasoning, truncated:observed]` have equal measurable sets and rank through though their
  scored runs differ. Truncated runs are real-writer-reachable, so this is a genuine fail-closed hole.
- **This amendment (approach B, owner-chosen):** fix the POPULATION (compare over scored runs), which
  removes the concealment for both axes and collapses the guard back to one value arm.

## Files

- `bench/lib/run-buckets.mjs` — export `scoredRuns(runs)` (the scored predicate), so the population
  has one definition.
- `bench/lib/case-rows.mjs` — `buckets()` uses the exported `scoredRuns` (behaviour-preserving refactor).
- `bench/lib/compare-model.mjs` — add `reasoningByCase` → `n.reasoningScored`; switch `lensByCase` to
  `scoredRuns`; rewrite the reasoning axis to a single value arm over `n.reasoningScored`; revert the
  lens axis's added unprovable arm.
- `tests/bench-compare.test.js` — update the score-without-report cases to the new semantics, ADD the
  concealment cases (both axes), keep the value-arm cases.
- `CLAUDE.md` — the axis paragraph, updated to name the reasoning axis and that both axes now compare
  over the scored-run population; kept terse.

## Tests (`tests/bench-compare.test.js`)

Reuse the fixture helpers; add a helper for a truncated run (`report.finishReason: 'length'`).

1. **observed vs no-observed suppresses, names `reasoning`**; **known vs unknown suppresses**;
   **both-unknown ranks through**; **order-insensitive** (the value-arm cases, over scored runs now).
2. **CONCEALMENT (reasoning)** — A `[scored:observed, truncated:no-reasoning]`, B
   `[scored:no-reasoning, truncated:observed]`: equal measurable sets but differing scored sets → the
   scored-population axis SUPPRESSES (rankable false, `reasoning` named). The regression test for this
   whole amendment.
3. **CONCEALMENT (lens)** — the same shape on lens → suppresses.
4. **score-without-report** — a scored run with no report classifies `unknown`: suppresses vs a known
   state; two such records rank through (both `unknown`, per Option A) on reasoning, while lens
   suppresses them via its `lensUnknown` arm.

## Mutation check (step 5)

Key invariant: the axis compares the SCORED-run population, so a concealed scored difference is
suppressed. Candidate faults:
- switch `reasoningByCase`/`lensByCase` back to `measurable(runs)` → the concealment tests (2, 3) go
  RED (this is the whole point of the amendment).
- drop `.sort()` in the reasoning signature → the order-insensitive test goes RED.
Prove landed with `mutation-landed.py`, name the red test, restore, re-run green.

## Verification (step 5, end to end)

- `npm test` green (quote the summary line); the new cases pass.
- `verify` skill (tests + real plugin load + delegation round trip), output quoted.
- Mutation check as above.

## Out of scope

- No renderer change: `bench/lib/compare-report.mjs` already prints every `divergences[]` entry
  generically (axis + detail), so a new axis name renders with no format work — confirm by reading,
  don't add code.
- The interactive per-case `reasoning` **column** already exists in `bench/lib/report.mjs`; this
  touches only cross-record *comparability*, not display.
