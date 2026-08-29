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

## Design

One new per-case block in `divergencesOf()` (`bench/lib/compare-model.mjs`), placed **after** the lens
block inside the existing `else` branch, reusing the `rowsById` array already built at line 329
(`compatible.map((n) => new Map(n.rows.map((row) => [row.id, row])))`).

**Deliberately simpler than lens.** Lens re-derives via `lensByCase`/`lensLabelStrict` because
`lensLabel` is looser than *provable* depth (a middle-era record can't prove its window). Reasoning
has no such strict/loose split — `reasoningWitness` returns one classification, and `unknown` is a
real observed state, not "unprovable". So the axis reads `row.reasoning` directly; **no new normalized
field, no re-derivation helper.**

Per case id in `first.caseIds`:
- collect `rowsById.map((m) => m.get(id)?.reasoning)`;
- keep only non-empty sets (`r && r.length > 0`) — a record that scored nothing measurable carries no
  reasoning signal, exactly as the lens block filters `l.value.length > 0`; its coverage mismatch is
  the coverage axis's job, not this one's;
- signature each kept set as `JSON.stringify([...r].sort())` — **the sort is load-bearing**:
  `row.reasoning` is deduped but in first-seen order, so two records with the same multi-state set in
  different order must not read as divergent (lens's `lensByCase` sorts for the same reason);
- if ≥2 kept signatures and they disagree, push
  `{ axis: 'reasoning', detail: \`case "${id}" reviewed under different reasoning states\` }` and
  `break`.

This mirrors the lens block's own `observed`/divergence shape, minus the `unknown`-suppress arm lens
needs and reasoning does not.

## Files

- `bench/lib/compare-model.mjs` — the new block in `divergencesOf()` (~8 lines).
- `tests/bench-compare.test.js` — new cases (below), following the existing fixture builders.
- `CLAUDE.md` — the `bench/compare.mjs` paragraph lists "three per-case axes: coverage …, degradation
  class …, and a lens …". Update to four, naming the reasoning axis in one clause. One-line-in-spirit
  edit, kept terse.

## Tests (`tests/bench-compare.test.js`)

Reuse the file's existing record/run fixture helpers (usage is set via
`completion_tokens_details.reasoning_tokens`, cf. the `reasoning_tokens: 0` fixture already present).

1. **observed vs no-observed suppresses, names `reasoning`** — one record's case runs report
   `reasoning_tokens > 0`, the other `0`; assert `axisNames(comp)` includes `reasoning` and
   `rankable === false`.
2. **known vs unknown suppresses** (fail-closed / Option A) — one record `reasoning_tokens > 0`, the
   other with no `reasoning_tokens` detail (→ `unknown`); assert `reasoning` in divergences.
3. **agreement stays rankable** — both records same reasoning state (both observed, or both unknown);
   assert `reasoning` NOT in divergences and (given otherwise like-for-like inputs) `rankable === true`.
4. **order-insensitive** — two records whose case carries the same multi-state set
   (`[observed, no-observed]`) in different first-seen order stay rankable; guards the `.sort()`.

## Mutation check (step 5)

Key invariant: a differing observed reasoning set suppresses the ranking, order-insensitively. Two
candidate faults, either sufficient:
- drop the `.sort()` in the signature → case 4 (order-insensitive → rankable) goes RED;
- neuter the divergence push (e.g. force the disagreement test false) → case 1 goes RED.
Prove the mutation landed with `mutation-landed.py`, name the red test, restore, re-run green, diff
against the backup.

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
