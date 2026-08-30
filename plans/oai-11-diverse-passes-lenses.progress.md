# OAI-11 progress (durable, unattended run)

STATE: TERMINAL — code complete, review ladder complete (resumed Pass 5 terminal, no blocking
findings), verdict point dual-approval in hand pending, then commit + close. Do NOT re-run the ladder
or re-verify; the only remaining step is the commit itself.

Plan dual-approved through round 8 (digest c47af9cbf7dc; archives 1-round-4/5/8-blind.md). Rounds 6-8
re-gated the Pass-5 bench-residue amendment: Codex caught the merged SUCCESS envelope needs top-level
attempts+finishReason (two bench consumers read them; the old scope check verified the wrong file);
round 7 Codex corrected finishReason to range over EVERY result-bearing pass (not readable-only — a
parse-null 'length' pass is excluded from readable yet carries the signal); round 8 both approved.

## The change (all on disk, HEAD e682fe6, uncommitted)
### Lens mechanism (ladder passes 1-4 cleared it clean)
- scripts/lib/review.mjs — LENSES registry + lensDirective + parseReviewLenses.
- scripts/lib/review-ladder.mjs — prepareLadder gains `lens` param, composed at build() tail
  `[prompt, suffix, lens ? lensDirective(lens) : null].filter(Boolean).join('\n\n')`.
- scripts/lib/review-request.mjs — lens threaded onto the ladder object (survives all 3 paths).
- scripts/lib/cmd-review.mjs — REVIEW_SPEC 'lens'; reviewPlan lens; mutual-exclusion refusal; gate
  `passCount>1 || lenses.length`; runMultiPass per-pass lens stamped BY VALUE on each outcome.
- scripts/lib/review-passes.mjs — mergePasses lenses[] by-value (keyed + null-line singles);
  passesText lens rendering (drops "LOWER BOUND", adds "flagged by:"); passesEnvelope strategy/lenses.
- scripts/lib/review-report.mjs — passEnvelope per-pass `lens` (all branches); reportPasses threads
  strategy/lenses.
- bench/run.mjs — SPEC passes/lens; reviewFlags forwards (no double-forward); validateOptions up-front
  refusals (ceiling, unknown/empty lens, mutual exclusion).
- bench/lib/compare-model.mjs — scalarAxes derives effective passes + strategy + lens-set from raw
  persisted options.lens. DEVIATION from plan §6 (accepted): DERIVE-in-scalarAxes rather than a
  persisted descriptor — same pattern as the existing `passes` axis; no write-back so no double-forward;
  compare-model still reads a real effective count. Not re-contested by any ladder stage.
- commands/review.md — --lens doc + --json envelope additions.

### Bench-residue (resumed Pass 5)
- scripts/lib/review-report.mjs reportPasses: top-level `attempts` = aggregateAttempts over ALL passes
  (null when empty); `finishReason` = passes.some(p => p.result?.finishReason === 'length') ? 'length'
  : null (every result-bearing pass, not readable-only). Both threaded into passesEnvelope.
- scripts/lib/review-passes.mjs passesEnvelope: destructures + emits both at top level.
- tests/review-multi-pass.test.js: attempts+finishReason REMOVED from PER_PASS_ONLY (retried stays);
  +2 e2e tests (attempts aggregate + attemptRows consumer; parse-null 'length' flips finishReason +
  truncatedRuns consumer). BOTH mutations proven RED (readable-only reds the parse-null test;
  attempts=null reds the aggregate test), reverted.
- bench/lib/caveats.mjs: truncated-run prose reworded ("reply was cut off short").
- CLAUDE.md: OAI-9 residue paragraph corrected + Pass-5 exempt-batch prose fixes.

## Resumed Pass 5 (review ladder) — TERMINAL, no blocking findings
Group A (acceptance-audit scout + fork-opener): both clean. Group B (codex-adversarial + codex-plain):
no blocking; 4 non-blocking. Group C (agent-closer): no blocking, convergence YES, +1 same-class
non-blocking. All 5 findings non-blocking, wholly exempt (descriptive prose). Post-terminal exempt
batch applied:
- bench/lib/caveats.mjs: "analysis was cut off short" → "reply was cut off short" (codex-plain).
- CLAUDE.md: "attempts/retried never span passes" corrected — per-pass ledgers independent so
  `retried` stays per-pass, but the top-level `attempts` aggregate DOES span all passes (codex-plain).
- CLAUDE.md: dropped a brittle "passEnvelope line 487" ref → "passEnvelope's result branch" (codex-plain).
- bench/lib/attempt-rows.mjs answeringAttempt docstring: corrected "exactly one answered attempt" — a
  merged record can hold several; `.find` returns the first, harmless (consumer inert) (agent-closer).
ACCEPTED (no adequate fix, recorded): codex-adversarial's shared-name tension — top-level `finishReason`
carries a UNION meaning while sharing the single-pass server-field name. Renaming would break
`run-buckets.mjs truncatedRuns`, which additive-equivalence REQUIRES to read the same field; the `kind:
'multi-pass-review'` discriminator + the code comment ("UNION CLASSIFICATION, never a synthesized
server value") are the mitigation. Not a dated instance or silent-failure mechanism → no tracker item.

## Verification
- npm test: 1508/1508 green.
- Mutation-proved: the two new bench-residue tests (readable-only reds the parse-null test; attempts=null
  reds the aggregate test); earlier lens tests (keyed lens-push removed reds by-value + failed-middle).
- Plugin surface (/oai:setup): loads, table renders.
- Live: 2-lens review against qwen/qwen3.8-27b confirmed both lenses tagged + warm-prefill cache.

## NOTE for commit
plans/oai-151-cross-run-sweep-reproduction.approved/1-round-4-blind.md is pre-existing OAI-151 residue
(untracked at session start) — keep it OUT of the OAI-11 commit.

## Remaining
Commit the OAI-11 feature to main; move OAI-11 to BACKLOG_DONE.md. The A/B experiment (3 lenses vs 3
plain passes) is post-ship validation, run separately, not a commit blocker.
