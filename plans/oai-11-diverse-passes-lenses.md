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
- **The OAI-9 residue's top-level `attempts` aggregate AND truncation signal on the merged success
  envelope BOTH land — the scope check reversed at Pass 5 (round 6 re-gate below).** The original
  scope check reasoned only about `outcome.mjs`'s *scoring* parse and concluded no field was needed.
  That was wrong: two OTHER bench success consumers read these fields off `run.report`, and OAI-11's
  own `bench/run.mjs` `--passes` forwarding is exactly what makes a multi-pass success record reach
  them: `bench/lib/run-buckets.mjs` `truncatedRuns` reads `run.report.finishReason === 'length'` (a
  multi-pass run with no top-level `finishReason` misclassifies as scored rather than truncated —
  corrupting the A/B recall denominator the experiment depends on), and `bench/lib/attempt-rows.mjs`
  `everyAttempt` reads `run.report.attempts` (a multi-pass run's whole-run reliability reads null
  without it). See the round-6 amendment (as corrected in round 7) for the exact shape (`attempts` over
  ALL passes, `finishReason` = ANY pass carrying a result finished `'length'`), the disclosed
  `answeringAttempt` gap, and the `caveats.mjs` sweep.

### 7. Docs (`commands/review.md`)

Document `--lens a,b,c`: the named registry values, one-pass-per-lens semantics, the loud
`--passes`/`--lens` mutual-exclusion refusal, and the `--json` envelope additions (`strategy`,
`lenses`, per-pass `lens`, per-finding `lenses[]`) with the explicit note that a lens run's agreement
is coverage-across-focuses, not confidence. Required by `tests/plugin.test.js:40` (every
`REVIEW_SPEC` flag must be documented) — the test fails otherwise.

## Pass 1 review-ladder amendments (round 5 re-gate)

Pass 1 of the review-ladder (acceptance-audit + fork-opener + codex-adversarial + codex-plain +
agent-closer) found the code faithful to the approved design with no byte-identity or provenance
defect, but raised design deltas that change the approved spec and so are re-gated here (per the
plan-drift discipline: a design-changing ladder fix is re-amended and re-approved in its batch, not
deferred to the verdict point). Resolved via the fable-advisor + Codex consensus (unanimous):

- **§3 (CLI) — reject DUPLICATE lens names.** `parseReviewLenses` refuses a repeated name (e.g.
  `--lens correctness,correctness`). Two reasons: a repeated focus runs a pass twice while
  `mergePasses` dedups its provenance to one lens, contradicting the "coverage across focuses"
  semantics; and unbounded repetition would bypass the `--passes` ceiling. With duplicates rejected,
  every lens pass carries a DISTINCT lens, so for every merged finding `agreement === lenses.length`
  — the fact §5 below now relies on. `parseReviewLenses` also guards `typeof raw === 'string'` so a
  hostile non-string caller yields a controlled `UserError`, not a leaked `toString` throw.
- **§5 (envelope) — DROP per-finding `agreement`/`readablePasses` on the lens path.** This completes
  Fork C's own rationale, which named "the JSON exposes a bare `agreement` field" as a confidence-read
  vector but whose §5 spec only fixed the TEXT render. After §3's duplicate-rejection,
  `agreement === lenses.length` for every lens-path finding, so the field is redundant data wearing a
  confidence-shaped name — pure liability. The omission is at the ENVELOPE seam (`passesEnvelope` /
  `reportPasses`, strategy-conditional): `mergePasses` stays pure and strategy-neutral (it still
  computes `agreement`/`readablePasses`/`lenses`), and the `--passes` path is byte-unchanged. Safe:
  the bench scoring path (`scoreRun`) reads file/line/evidence, neither dropped field. Two-sided test:
  `agreement` ABSENT on lens-path findings, PRESENT on `--passes`-path findings.
- **§6 (bench) — the rendered report heading carries the pass strategy.** `renderReport` threads
  `passes`/`lens` (like `structured-output`/`max-tokens` today), so two arms differing only in pass
  strategy are tellable apart in the artifact, not just the JSON record — the existing "must be
  tellable apart" rule extended to this axis.
- **Comparability (compare-model) refinements:** the lens-set axis is NOT sorted (execution order is
  material — first lens pays cold prefill, later lenses warm; same grain as `files`-order being a real
  input difference); and a persisted `options.lens` that **no real run could have produced** reads
  fail-closed `unknown` on ALL THREE derived axes (`passes`/`strategy`/`lenses`) together, never as
  the plain single-pass strategy. "Could a real run produce it" has ONE definition — the shared
  `parseReviewLenses` the CLI and bench already write through — so a non-string, an explicit `null`
  (which the parser aliases to absent, folded here into malformed via a zero-length guard, since with
  a missing key already the absent case a `[]` is reachable only from `null`), an unknown name, a
  duplicate, an empty entry, or a record carrying BOTH `--lens` and `--passes` (impossible — refused
  at write time; named by its own reason, since there the lens value is valid and only the combination
  is not) all become `malformed`. Registry drift is the accepted, disclosed cost
  (a record naming a since-removed lens over-suppresses — the fail-closed-safe side). Pinned by a
  DISCRIMINATING test: two IDENTICAL malformed-lens records must not rank (a malformed-vs-plain pair
  cannot distinguish the fix from a buggy zero-pass-"present" reading).
- **Validation order:** the `--lens`/`--passes` collision is refused BEFORE the numeric `--passes`
  parse (in both `reviewFlow` and bench `validateOptions`), so the collision — the more fundamental
  error — is what a user sees for `--lens x --passes nope`.
- **Text per-pass lines name the lens** (`formatPassLine`/`passSummary`), so a failed lens pass is
  diagnosable from the text report, not only the JSON `passes[]`.
- **Docs:** `commands/review.md`'s `--json` sentence is rewritten (no `agreement` on lens findings),
  and `CLAUDE.md`'s "runMultiPass reached only when passCount > 1" line is corrected (a single-lens
  run enters it) plus its `--json` enumeration gains `strategy`/`lenses`.

**Declined with disclosure (NOT fixed, NOT filed — recorded here as the citable artifact):** the
all-unreadable and served-model-refusal error envelopes do not carry `strategy`/`lenses`/per-pass
lens. Worth bar not met (unanimous): the failure is loud (exit 1), PARTIAL failures already carry
per-pass lens (`reportPasses` runs whenever ≥1 pass is readable), the bench A/B attributes its arm
from the forwarded options, no consumer reads per-lens attribution off an all-fail CLI error envelope,
and no such run has been observed. If one ever is, this note is the evidence.

## Pass 5 review-ladder amendment (round 6 re-gate)

Pass 5 (`codex-adversarial`) traced a plan-drift falsehood the earlier passes had cleared against the
wrong file: §6's original scope-check bullet (and the CLAUDE.md paragraph rewritten in the Pass-4
batch) asserted the merged success envelope needs no top-level `attempts`/`finishReason` because
"truncation rides `caveatFlags`" and "attempts read only from the failure envelope". Both are FALSE —
they were verified against the PRODUCER (`bench/lib/outcome.mjs`, which correctly does not read them)
rather than the CONSUMERS (`run-buckets.mjs`, `attempt-rows.mjs`, which do). Direct verification
confirmed Codex; two Claude review stages had missed it. A plan-drift finding that reverses a plan
conclusion → Pass 5 truncated, this batch lands the fix + this amendment + round-6 dual-approval, and
the resumed Pass 5 re-runs every stage (one pass against the cap). Resolved via the fable-advisor +
Codex consensus (unanimous on all three forks):

- **`attempts` aggregate over ALL passes.** `passesEnvelope` gains a top-level `attempts` computed by
  `aggregateAttempts(passes)` over EVERY pass (not readable-only) — the same population and helper the
  failure path's `allFailedError` uses ("reliability reads every attempt"), `null` when empty via the
  established `length ? … : null` convention. This mirrors `durationMs`, which also sums over all
  passes; `usage` stays readable-only. `everyAttempt` reads `run.report.attempts` (never `passes[]`),
  so no double-count. Computed in `reportPasses`, passed in as a named arg.
- **`finishReason` = ANY pass carrying a result finished `'length'`, envelope-side.** `passesEnvelope`
  gains a top-level `finishReason`: `passes.some((p) => p.result?.finishReason === 'length') ? 'length'
  : null` — never a synthesized `'stop'` (which would assert a uniform server fact that did not happen;
  `null` claims nothing and `truncatedRuns` only tests `'length'`). ANY, not ALL, matching
  `caveatUnion`'s adjudicated posture ("a union in which ANY pass was truncated never reads as clean
  complete"): under ALL, a 3-lens run whose one lens truncated would score as a COMPLETE measurement
  while structurally missing that lens's findings. **The population is EVERY pass with a `result`, NOT
  the readable subset (round-7 correction of the round-6 draft, found by `codex-adversarial`):** a
  PARSE-NULL pass — a reply arrived and `parseFindings` could not read it — is a non-observation
  EXCLUDED from `readable`, yet `passEnvelope` still preserves its `finishReason` (`review-report.mjs:487`,
  `pass.result.finishReason`), and token-exhaustion (`finish_reason: 'length'`) is a leading cause of a
  reply being unreadable in the first place. Ranging over `readable` only would therefore blind the
  truncation signal on exactly the passes most likely truncated — the inverse of fail-closed. A THROWN
  pass has no `result` and no `finishReason`, so `p.result?.finishReason` excludes it, which MATCHES
  single-pass semantics (`truncatedRuns` requires `!run.error` — a thrown pass is the error case, not
  the truncated-bucket case; its token-exhaustion reason is preserved on its own `passes[]` entry).
  Kept at the ENVELOPE, not by teaching `run-buckets` about multi-pass — which would fork the single
  definition of truncated and leave every future `finishReason` reader broken. It is a UNION
  CLASSIFICATION, not a server value; the per-pass literals stay in `passes[]`.
- **Graduation test: `attempts` + `finishReason` leave `PER_PASS_ONLY`; `retried` stays.** The merged
  envelope now carries the first two at top level, so the allowlist entries and the comment asserting
  it does not (`tests/review-multi-pass.test.js`, "unreachable today — bench cannot forward --passes")
  are corrected. `retried` stays PER_PASS_ONLY: no `bench/` code reads `report.retried` (single-pass
  `retried` is a per-pass request-count derivation), so graduating it would be an unused affordance.
- **`bench/lib/caveats.mjs` truncated prose swept.** Its "the JSON never parsed" clause reads FALSE
  for a multi-pass `'length'` record: a readable-but-truncated pass DID parse (`parsed: true` on the
  merged envelope). The clause is reworded so it does not assert non-parsing of a record that parsed.
  This is a descriptive-prose correction (a bench report string), fixed in this batch.
- **Disclosed gap (not guarded — the guard would be inert):** `answeringAttempt`'s "exactly one
  answered attempt per logical run" invariant is loosened by the all-passes `attempts` aggregate (a
  multi-pass run can hold several answered attempts, and `.find` returns the first). Its ONLY consumer
  chain — `answeredWarm` → `timingSamples` — reads `run.report.prefillMs`/`generationMs`, which the
  merged envelope does NOT carry (this change adds only `attempts`/`finishReason`, not timing), so
  every multi-pass run is filtered out by `Number.isFinite(undefined)` before `answeredWarm` is
  consulted. The loosening is therefore inert on exactly the records this change creates. A future
  change adding top-level merged timing OWNS redefining `answeringAttempt` for multi-pass; recorded
  here as the citable artifact.

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
- **Pass 1 amendment tests**: `parseReviewLenses('a,a')` throws (duplicate rejection); the merged
  envelope OMITS `agreement`/`readablePasses` on a lens-path finding and KEEPS them on a
  `--passes`-path finding (two-sided control for the §5 drop); the lens reaches the structured
  schema-rejection FALLBACK path (F1 — a server that rejects `response_format` then answers, asserting
  the fallback request carries the lens directive); and `compare-model`'s `scalarAxes` derives
  `strategy: 'lenses'`, effective `passes: 2`, and the ordered (unsorted) lens-set from a persisted
  `--lens a,b` record, with a non-string `options.lens` reading `unknown` on all three axes (F2).

- **Pass 5 amendment tests** (the bench-residue graduation): a `--passes 2` merged `--json` envelope
  carries a top-level `attempts` array aggregating BOTH passes' attempt records (mutation: dropping
  the aggregate reds it) and a top-level `finishReason`; a merged envelope in which one pass finished
  `'length'` reads top-level `finishReason: 'length'` while an all-`'stop'` run reads `null`
  (two-sided, the ANY-truncated rule), **and the truncated pass being a PARSE-NULL (unreadable) one
  still flips it — the discriminating case for the round-7 all-passes-with-a-result population, which
  a readable-only reading would miss**; and `bench/lib/run-buckets.mjs` `truncatedRuns` classifies such
  a multi-pass record as truncated (mutation: remove the `finishReason` synthesis → the record reads
  scored → RED — the bench-side consumer proof). The graduation test's `PER_PASS_ONLY` set no longer
  lists `attempts`/`finishReason` (its default-deny now REQUIRES them at top level) and still lists
  `retried`.

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
