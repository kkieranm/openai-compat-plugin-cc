# OAI-220 verification — the comparison reader's guard tests fire, and it runs on the real corpus

Positive controls for `tests/bench-compare.test.js` and `tests/structure.test.js`, run
against the real source files at their real paths (not copies). Each mutation was
applied, shown to land, run, seen to turn its NAMED target test(s) RED, then restored —
after which the file is byte-identical and the suite green (1376/1376 full suite at the
time of writing). This is the control-fires → fix-catches → fix-removed-doesn't-fire
shape: without it, a passing suite proves nothing about whether the guard can fail.

## Behavioural mutations (bench/lib/compare-model.mjs)

| Mutation | Change | Named target(s) that went RED |
| --- | --- | --- |
| M-A | `divergencesOf` returns `[]` (records always compare equal) | all `… suppresses ranking …` comparability tests (16 of them) |
| M-B | `hasEvidence = true` (never withhold for lack of evidence) | `two all-failed records are WITHHELD (nothing to rank)` |
| M-C | reinstate the pre-fix `if (ar === null && br === null) return byLabel` early return | `a control-only comparison ranks by control-FP rate, not alphabetically` |

M-A is the plan's step-5 Verification item 3 (the comparability-suppression invariant).
M-B and M-C cover the two null-recall behaviours added in the full-pass batch: the
no-evidence withhold, and control-only ranking by false-positive rate.

## Failure-cell composition (bench/lib/compare-report.mjs)

`cellText` renders the per-case matrix cell for a case no run scored. It once
picked a single highest-priority failure label (`substituted` over `capped`
over `timeout` over `unreadable` over `failed`), which concealed the other
failure kinds when a case failed several ways across its runs — a case with
one model-substituted run and two provider-failed runs rendered only
`— substituted`. `failureCells` now decomposes the row's failure sub-counts
into disjoint buckets (`failed − timedOut − substituted`, `timedOut − capped`,
`capped`, `substituted`, `unreadable`, `truncated`) and names each present one
with its count.

Positive control: `an all-failed case with mixed failure kinds names every
one, not just the top-priority label` (three runs — one `model-substituted`,
two `provider-error`) was run against the pre-fix single-label `cellText` and
went **RED** (`Input: … | c1 | — substituted |`, no `2 failed`), then GREEN
after the composition fix — the control-fires → fix-catches shape, run against
the real file at its real path. The pre-existing `an all-failed case renders
its failure state` test (a single capped run) stays green: the cell reads
`— 1 capped`, which still matches `/capped/`.

The empty-`parts` fallback reads `no runs` (a corrupt record whose case carried
no runs at all), never a fabricated `failed`. Its test — `a case that carried
no runs reads "no runs", never a fabricated failure` (a case with `runs: []`) —
doubles as whole-condition mutation coverage for `failureCells`. Two mutations
were run against the real file: flipping `if (plainFailed > 0)` to `>= 0` (the
cell renders `— 0 failed …`, the fallback never fires) turned it **RED**, and
reverting the fallback string `no runs` back to `failed` turned it **RED** — so
each of the six `> 0` guards and the fallback string is pinned. Both restored;
suite green (1378/1378). The mixed-failure assertion is anchored on the trailing
`|` cell delimiter (`/— 2 failed, 1 substituted \|/`) so a trailing `0
unreadable, 0 truncated` from a flipped guard would no longer match it either.

## Absence-of-measurement renders "—", not a fabricated value (bench/lib/compare-report.mjs)

Two sinks rendered a concrete value for a measurement that never happened, and
both are dated on the real corpus. `cellText`'s control arm returned `—
control` for a control case before checking `row.scored`, so a control whose
runs all failed read the same as one that measured clean — real record
`bench/results/2026-07-30T21-51-40-859Z.json`, control case `docs-only`, one
`first-byte-timeout` run, `scored=0`. `fpText` returned `String(count)` when
its scored-run denominator was 0, so the aggregate Unmatched and Control-FP
columns printed `0` for a record no run scored. The fixes: a failed control
reads `— control, <failure cells>`; `fpText` reads `—` when `scored === 0`
(safe because both counts sum over the scored bucket alone, so `scored === 0 ⟹
count === 0` — the rows are recomputed through `caseRows`, never read as stored
fields, so a foreign record cannot carry `scored=0, unmatched>0`).

Positive controls, run against the real file at its real path: `an all-failed
control case discloses its failure beside the control marker` (a control with
one `first-byte-timeout` run) and `a record with no scored run shows "—" for
the false-positive columns` (two all-failed records rendering the unranked
aggregate table) were both **RED** on the pre-fix code (`— control` with no
timeout; `— | 0 | 0 | —`) and GREEN after. Each test also carries a positive
arm for the measured case — a scored control still reads bare `— control`, and
`fpText` with a positive denominator still reads `3 per 4` — so the fix cannot
have simply blanked the columns. Suite green (1380/1380).

## Render-grammar mutation (bench/lib/compare-report.mjs)

The plan's step-5 Verification item 1 requires that a deliberately-unwrapped
interpolation in the render file fails the markdown-safety grammar. Injecting
`` lines.push(`RAW ${model.baselineLabel}`) `` (a bare `${…}`, not a
`safeInline`/`displayReason` wrapper) turned `tests/structure.test.js`'s
`every untrusted interpolation in the sweep render files is markdown-safe-wrapped …
(OAI-213)` test RED, naming `bench/lib/compare-report.mjs: ${model.baselineLabel}` as
the offending sink — proving the grammar covers this file specifically, not only in the
abstract. Reverted; structure suite green.

## Deliberately NOT mutation-tested through `buildComparison`

The comparator's `if (ar === null) return 1` "sorts last" arm and any evidence-presence
pre-order. The coverage axis forces a rankable set to agree per-case on which runs
scored, so a mixed null/non-null pair — and a `controlScored`-absent record beside a
`controlScored`-present one — cannot occur in a rankable set. A test claiming to
exercise those arms through the public path would be a false green.

## Real-run arms (against the real 201-record corpus)

Three withhold/render outcomes, run through the real `bench/compare.mjs`:

- **Withheld — incomparable:** `2026-08-27T09-17-38-084Z.json` + `…09-12-36-685Z.json`
  → "Ranking withheld — records are not like-for-like", naming the `coverage` and `lens`
  divergences.
- **Withheld — no scoreable run:** `2026-07-29T09-23-08-250Z.json` + `…09-24-02-095Z.json`
  (two all-failed `config-origin` runs) → "Ranking withheld — no record produced a
  scoreable run". Before the full-pass fix this pair ranked 1/2 with recall `—`; that was
  the positive control the fix removed.
- **Ranking renders (positive arm):** NO real-corpus pair exercises this, and it is a
  corpus-composition fact, not a code gap: every pre-OAI-217 record is withheld on `lens`
  (the `contextWindow`-key rule), and a scan of the corpus finds **zero** post-OAI-217
  records carrying a scored run — so no real pair is simultaneously axis-matching,
  post-OAI-217, and scored. A fresh scored pair could not be minted here either: bench's
  model-selection does not recognise the LM Studio model ids currently served (an
  environment/bench issue unrelated to this reader). The render-when-matching path is
  instead covered by the synthetic fixtures throughout `tests/bench-compare.test.js`
  (e.g. the ranking-order, tie-break, delta, and control-only-disclosure tests, each of
  which renders the `## Ranking` table and asserts its rows), and was exercised live
  during review on constructed control-only records (ranking table rendered, ordered by
  control-FP rate).
