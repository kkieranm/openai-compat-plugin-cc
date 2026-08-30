ARCHIVE — not the current spec; the live plan is the file beside it.
STATE: dual-approved-unattended

Owner authorisation (2026-08-30, standing, this session): "keep on iterating on items in the backlog
unattended. use lmstudio whenever you need to for whatever you want. do not prompt for plans. when you
need input, use the usual consensus of fable advisor and codex". "do not prompt for plans" waives the
harness plan-mode prompt by name; the plan gate below runs in full (digest first, Codex + independent
`verdict-signer` launched the same turn, neither shown the other's reply, the Claude half under the
read-only snapshot protocol). Two genuine approvals authorise building for this run.

# OAI-11 (lens-first slice): diverse review passes by lens

## Context

`/oai:review --passes N` (OAI-9, shipped) decorrelates **sampling noise** — N runs of one model
with one prompt, unioned. Repeated samples of one model share its failure modes, so their agreement
is a weak confidence signal. OAI-11's premise is that varying the *lens* — one pass looking for
correctness bugs, one for security holes, one for edge cases — decorrelates **blind spots** instead,
which is the more valuable axis. Lenses are the cheapest of the three diversity routes in the item
(different lenses on one loaded model — free today; vs different models on different providers; vs
JIT-swapped models on one provider). Cross-**model** diversity is explicitly deferred: it collides
with `review-passes.mjs`'s `servedModelFailure` (refuses `served.length > 1`) and is the item's own
larger follow-on.

This slice ships the lens **mechanism** plus the **bench plumbing** needed to measure it, then runs
one A/B experiment (three lenses vs three plain passes) to decide whether lenses earn their keep
before any second model is installed. The bench plumbing is in-scope, not deferred: bench cannot
today produce a multi-pass record at all (`bench/run.mjs` forwards neither `--passes` nor a lens, and
`compare-model.mjs` reads every record as `passes=1`), so without it the experiment would read
reliability off records that structurally misread the runs — an unauditable A/B, which both
consensus reviewers named as the single biggest risk.

## Consensus record (grill gate)

Resolved via the standing fable-`advisor` + `codex:codex-rescue` consensus (not the user, per the
unattended standing instruction). Four forks:

- **A — lens as a closed built-in registry** (not free-form `--lens "text"`, which duplicates the
  existing trailing `instructions` and is an unbounded comparability axis `compare-model` could never
  rank like-for-like). Config-data lenses wait for a dated need.
- **B — `--lens a,b,c` runs one pass per named lens, mutually exclusive with `--passes N`, refused
  loudly** (not silently ignored). A `--lens` run routes through the multi-pass machinery even at one
  lens, so the envelope carries lens identity; OAI-9's byte-identical `--passes 1` promise stays
  scoped to lens-**less** runs (it was only ever promised there).
- **C — carry lens IDENTITY end to end, and on the lens path drop K's confidence framing.**
  `--passes` and `--lens` never co-occur (Fork B), so: on the `--passes` path K keeps its OAI-9
  agreement meaning, untouched; on the `--lens` path the agreement number is *not* a confidence
  signal (disjoint focuses), so the run names *which lenses* flagged each finding instead. Advisor
  and Codex converged here under the pre-stated tie-break "identity over relabeled numbers": a bare
  relabel is insufficient because `passesText` literally calls K "a LOWER BOUND on true agreement"
  and the JSON exposes a bare `agreement` field — both read as confidence unless the lens path
  replaces that framing with lens provenance.
- **D — build the smallest mechanism + its bench plumbing, then A/B measure** with `--runs N` per
  arm (N=1-per-arm is this repo's named footgun), same corpus/model, metric and decision rule
  pre-stated (recall, then per-scored-run false-positive rate — the `compare.mjs` ranking's own
  ordering).

Two invariants both reviewers flagged:

- **Cache placement.** LM Studio prefix-caches; `--cache-buster` works by *prepending* to the system
  prompt, so a per-lens directive placed in the system prompt (or in the pre-diff `instructions`
  slot) is an accidental cache-buster on every pass, forfeiting the warm-pass economics (~421s cold
  vs ~11.5s warm first-token on a 56k-token request) that make "three lenses free" true. The lens
  directive must ride the **tail** of the user message, after the diff, so system + files + diff stay
  byte-identical across lens passes. The seam already exists: `review-ladder.mjs`'s
  `prepareLadder({ suffix })` appends `suffix` *after* the whole prompt including the diff
  (`prompt: suffix ? ${prompt}\n\n${suffix} : prompt`), today used only for the structured-output
  schema instruction. Accepted tension: a small model weights a tail directive less than a header;
  that salience question is exactly what the A/B measures, and placement is held constant across both
  experiment arms so the experiment measures lens value, not cache position.
- **Reply-shape contract stays lens-blind.** A lens varies *what to look for*, never the
  findings-JSON shape; `structured.mjs`/`json-scan.mjs`/parsing are untouched. Plan invariant.

## Approach

### 1. Lens registry (`scripts/lib/review.mjs`)

Add an exported closed registry beside `reviewSystemPrompt`:

```
export const LENSES = {
  correctness: '<directive: logic errors, wrong results, broken contracts, mishandled edge cases>',
  security:    '<directive: injection, auth/authz, unsafe input, secrets, unsafe deserialization>',
  'edge-cases':'<directive: boundary values, empty/null, concurrency, resource exhaustion, error paths>',
};
export function lensDirective(name) { /* returns LENSES[name] or throws UserError naming the valid set */ }
```

Each directive is a short *focus* clause (terse-and-negative house style, per `REVIEW_RULES`), NOT a
replacement of the rules or the findings-first ordering. It names what to prioritise; it does not
touch the reply contract.

### 2. Prompt injection — tail of user message (cache-preserving)

Thread an optional `lens` name through `reviewPlan` → `requestFindings` → the `ladder` object into
`prepareLadder` as a **dedicated `lens` parameter — NOT as `ladder.suffix`.** The suffix is already
load-bearing: `unconstrainedLadder` (the DEFAULT unconstrained path) *replaces* `ladder.suffix` with
`schemaInstruction(...)` at both its sizing calls (`review-ladder.mjs:105,109`), so a lens smuggled
in via `suffix` would be silently dropped on the unconstrained path and on the structured
schema-rejection fallback — it would survive only on the direct structured request
(`review-request.mjs:678`). Instead, `prepareLadder` gains a `lens` param and composes it at its
single `build()` site (`review-ladder.mjs:53`): the final user-message tail is
`[prompt, suffix, lens ? lensDirective(lens) : null].filter(Boolean).join('\n\n')` — lens LAST, after
both the diff and any schema-instruction suffix. **The `lens ?` guard is load-bearing, not
cosmetic**: `lensDirective` throws on any value outside the registry (§1), and every lens-less run
(including ordinary single-pass review) reaches `prepareLadder` with `lens` undefined, so an
unguarded `lensDirective(lens)` would throw on the default path and break OAI-9's byte-identical
promise. With the guard, a lens-less run contributes `null` to the join and the tail is byte-identical
to today. Every caller that spreads `...ladder` then carries the lens
through automatically, so no path (unconstrained, structured success, structured rejection/fallback)
can lose it, and the schema-first/lens-last order keeps the structured promise unaffected. System
prompt (`reviewSystemPrompt`) and the pre-diff `instructions` slot are **unchanged**. Result: the
cacheable prefix is identical across all passes of a `--lens a,b,c` run; only the tail varies.

### 3. CLI (`scripts/lib/cmd-review.mjs`, `scripts/lib/delegate.mjs`)

- Add `'lens'` to `REVIEW_SPEC.valueFlags` (`cmd-review.mjs:24`). Value is a comma-separated list of
  registry names.
- Parse/validate: split on comma, validate each against `LENSES` (`lensDirective` throws a
  `UserError` naming the valid set on an unknown lens), reject an empty entry.
- **Mutual exclusion**: if both `--lens` and `--passes` are present, refuse loudly with a `UserError`
  (matching the repo's refuse-not-ignore grain, e.g. `recover-sweep`'s flag-order refusal). Document
  the refusal.
- A `--lens` run (one OR many lenses) routes through the multi-pass path. Gate becomes: multi-pass
  machinery runs when `passCount > 1` **or** a lens list is present. The lens-less `passCount === 1`
  path stays byte-identical (OAI-9's graduation test still guards it).

### 4. Per-pass lens threading in `runMultiPass` (`scripts/lib/cmd-review.mjs`)

`runMultiPass` already loops and closes over one shared `{target, model, instructions}` and the
module doc comment (`cmd-review.mjs:249-251`) already names this seam for OAI-11. Add a per-pass
`lens` (from the lens list, indexed by pass) passed into each `reviewPlan({ ..., lens })` call. When
invoked for `--passes N` (no lens), `lens` is undefined for every pass — unchanged behaviour. The
pass count for a lens run is the length of the lens list.

**Each pass outcome carries its own `lens` BY VALUE** (the name, or `null`) — set here, from the pass's
own lens, and stamped onto the pass's result/report object that later flows into `reportPasses` →
`mergePasses`. This is the anchor for the provenance fix in §5: provenance must be read from the
outcome's own `lens`, never re-derived from a pass INDEX.

### 5. Envelope: carry lens identity, drop confidence framing on the lens path

- **Per-pass entry** (`passEnvelope`, `review-report.mjs`): add `lens` (the name, or `null`) to each
  `passes[]` entry — readable, non-observation, and thrown branches alike, so a diverse run proves
  every declared lens actually ran (the audit requirement).
- **Merged finding** (`mergePasses`, `review-passes.mjs`): derive `lenses[]` for each merged finding
  from the **`lens` value carried on each contributing readable outcome — NOT from a pass index.**
  This is a correctness requirement, not a style choice: `reportPasses` filters outcomes to the
  readable ones before calling `mergePasses` (`review-report.mjs:542`), and `mergePasses` assigns its
  `passes` Set from indices into that *compacted* readable array (`review-passes.mjs:106`). So a
  failed middle pass shifts every later index — original pass 2 becomes merge index 1 — and an
  index→(full ordered lens list) map would mis-attribute the finding to the wrong lens. Additionally,
  null-line findings are kept UNMERGED as singles and bypass the `passes` Set entirely, so an
  index-based scheme could not attribute them at all. The fix accumulates, per location key, the set
  of `lens` values from the actual contributing outcomes (deduped, order-preserving), and stamps each
  null-line single with its originating outcome's `lens` too. `summaries[]` retention and the
  `— summaries differ` marker are unchanged (still mandatory — location-only keying can still
  collapse a security and a correctness defect on one line). `agreement`/`severity`/null-line-unmerged
  logic otherwise unchanged.
- **Top-level** (`passesEnvelope`, `review-passes.mjs`): add `strategy` (`'passes'` | `'lenses'`)
  and, on the lens path, `lenses` (the ordered run list). `--passes`-path envelopes are unchanged.
- **Text render** (`passesText`): on the lens path, replace the `[K/S passes]` tag and the
  "LOWER BOUND on true agreement" paragraph with a lens-provenance rendering — each finding tagged
  with the lens(es) that flagged it (e.g. `flagged by: security`), and a header line stating that a
  lens run reports *coverage across focuses*, not confidence, so low agreement across lenses is not a
  demotion. The `--passes`-path rendering is unchanged.

### 6. Bench plumbing (`bench/run.mjs`, `bench/lib/compare-model.mjs`)

This is the OAI-9 deferred bench-wiring residue (PL3-1), landing now because the experiment requires it:

- `bench/run.mjs`: add `passes` and `lens` to `SPEC.valueFlags`; forward `--passes`/`--lens` in
  `reviewFlags`.
- **Validate `--passes`/`--lens` in `validateOptions` (bench/run.mjs:231), before any case runs.**
  This is not optional: `validateOptions` is the bench's guarantee that every forwarded flag is
  refused up front (its own comments describe the failure it prevents — a bad value otherwise
  materializes every repo, spawns every child, and records each child's CLI refusal as a *reviewer
  failure* with all-zero recall, contaminating the reliability data). Validate the pass ceiling
  (`PASSES_CEILING`), every lens name against `LENSES` (reject unknown/empty), and the
  `--passes`+`--lens` mutual exclusion — one immediate refusal, mirroring the review CLI's own
  refusals rather than deferring them to the children.
- **Persistence metadata is constructed SEPARATELY from the live forwarding `options`.** `reviewFlags`
  forwards straight from `options`, so the normalized descriptor `compare-model` needs (`strategy`,
  the *effective* pass count — the lens-list length for a lens run — and the lens set) must NOT be
  written back onto the live `options`: doing so would make `reviewFlags` forward BOTH `--passes` and
  `--lens` for a lens run, which the review CLI then refuses (the mutual exclusion), failing every
  case. Build the normalized descriptor as a distinct record field (or a persistence-only snapshot
  copy) so the forwarded flags stay exactly what the operator passed (one of the two, never both)
  while the record still carries a real effective pass count.
- `bench/lib/compare-model.mjs`: `scalarAxes` reads `record.options`. It already has
  `passes: numericAxis(o.passes ?? 1)`; point the pass-count axis at the normalized **effective**
  count from the persistence descriptor above (so a 3-lens run reads 3, not the raw-`options` `1`),
  and add a `strategy`/`lens`-set axis so a lens record is flagged incomparable against a plain-passes
  record rather than silently mis-ranked (same posture as the existing `passes` axis: absent
  normalises to the single-pass default so legacy records still compare).
- The OAI-9 residue also named a top-level `attempts` aggregate and a truncation signal on the merged
  **success** envelope for bench scoring. Scope check during code: if `bench/lib/outcome.mjs`'s
  single `JSON.parse(stdout)` + `{file,line,summary}` matching already scores the merged envelope
  (it parses OAI-9 records today), no new field is required for *scoring*; add the `attempts`
  aggregate only if the bench record actually reads it. Do not add envelope fields the bench path
  does not consume (honesty: no unused affordance).

### 7. Docs (`commands/review.md`)

Document `--lens a,b,c`: the named registry values, one-pass-per-lens semantics, the loud
`--passes`/`--lens` mutual-exclusion refusal, and the `--json` envelope additions (`strategy`,
`lenses`, per-pass `lens`, per-finding `lenses[]`) with the explicit note that a lens run's agreement
is coverage-across-focuses, not confidence. Required by `tests/plugin.test.js:40` (every
`REVIEW_SPEC` flag must be documented) — the test fails otherwise.

## Tests (mutation-proved)

- `tests/review-passes.test.js` (unit): `lensDirective` valid/invalid; `mergePasses` derives
  `lenses[]` from the per-outcome `lens` VALUE (a finding contributed by the correctness and
  edge-cases outcomes carries exactly those two lenses); **provenance survives a failed middle pass**
  — a three-lens run whose *middle* pass is unreadable must still attribute the surviving findings to
  the correct lenses (this is the test that would catch the index-shift defect; the all-readable
  0-and-2 case would NOT, since with no gap the compacted index equals the original); a null-line
  single carries its originating outcome's lens; `passesEnvelope` carries `strategy`/`lenses`;
  `passesText` lens path renders lens provenance and omits the confidence paragraph (assert the
  "LOWER BOUND" string is ABSENT on the lens path and PRESENT on the `--passes` path — a two-sided
  control).
- `tests/review-multi-pass.test.js` (e2e via fake server): a `--lens correctness,security` run
  produces 2 passes, each `passes[]` entry carries its lens, a finding at one location flagged by
  both carries both lenses; `--lens x --passes 2` is refused loudly (assert the `UserError` and exit
  code); an unknown lens is refused naming the valid set; `--passes 1` (no lens) stays byte-identical
  (existing graduation test unchanged). **The lens reaches all three prompt paths**: assert the lens
  directive appears in the sent user message on (a) the unconstrained (default) path, (b) the
  `--structured-output` success path, and (c) the structured schema-rejection fallback — the three
  places §2 identifies where a suffix-smuggled lens would have been dropped.
- `tests/plugin.test.js`: passes once `--lens` is documented (existing guard, no new test).
- **Bench guards** (wherever `validateOptions` is unit-tested, or a new bench test): `bench/run.mjs`
  refuses an over-ceiling `--passes`, an unknown/empty `--lens`, and `--passes`+`--lens` together
  *up front* (a `UserError` before any case materializes — the same early-refusal property the
  existing budget guards are tested for). Plus a persistence check: for a `--lens a,b` run the
  forwarded `reviewFlags` carry `--lens` and NOT `--passes` (no double-forwarding), while the
  persisted normalized descriptor records strategy `lenses` and effective pass count 2 — the property
  that keeps `compare-model` correct without contaminating forwarding.
- **Cache invariant**: a test asserting that across two lenses the system message and the user
  message up to and including the `--- END DIFF ---` marker are byte-identical (only the tail after
  it differs) — the mechanical proof of the warm-pass economics claim, and the thing a future
  refactor could silently break.

## Verification (repo `verify` skill)

1. `npm test` green (network-free fake server).
2. Plugin surface: `claude --plugin-dir . -p "/oai:setup"`.
3. Delegation round trip against LM Studio (a served model, e.g. `--model qwen/qwen3.6-27b`):
   `/oai:review --lens correctness,security --json` on a small seeded-defect file; confirm two
   passes, both lenses present in the envelope, findings tagged by lens, and (via `--cache-buster`
   off vs a warm second pass) that the second lens pass's prefill is warm — the cache-placement claim
   proved with real numbers, not just the byte-identity unit test.

## A/B experiment (post-ship validation, not code under review)

After the mechanism ships and verifies, run the decisive measurement (like OAI-9's live smoke, a
measurement, not a reviewed artifact):

- Arm 1: `--lens correctness,security,edge-cases` (3 diverse lenses, one model).
- Arm 2: `--passes 3` (3 plain passes, same model).
- `--runs N` per arm (N ≥ 3 — the N=1-per-arm footgun), same corpus, same model, same cache
  placement.
- Pre-stated metric + decision rule: recall first, then per-scored-run false-positive rate (the
  `compare.mjs` ranking's own ordering). Lenses "win" only if recall (blind-spot coverage) rises
  without a worse per-run FP rate.
- Record the result in the OAI-11 evidence trail; the outcome decides whether cross-model diversity
  (the deferred larger follow-on) is worth pursuing.

## Out of scope (deferred, stated)

- Cross-**model** and cross-**provider** passes (`servedModelFailure` collision; the item's larger
  follow-on).
- Config-data / free-form lenses (Fork A: registry-first; config waits for a dated need).
- Any change to the findings-JSON reply contract or parsing (invariant above).
