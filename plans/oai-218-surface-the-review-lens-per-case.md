STATE: dual-approved-unattended

Owner's per-run authorisation (2026-08-27, verbatim): "i will leave you unattended. keep iterating
on items using /feature . when you have an option that you would usually put to me, instead try to
converge using codex and a fable agent. do not prompt for plans as i will not be here" — and, the
same day: "you also have my permission to use lm studio if you need it".

Per `plans/README.md`, this state runs the dual gate in full (Codex + an independent Claude verdict
subagent, same digest, same turn, neither shown the other, Claude half under the read-only-delegation
snapshot protocol, fail-closed envelope parsing). Two genuine approvals authorise building for this
run only; anything short degrades this file to `unattended-draft` and blocks the item.

# OAI-218 — surface the review lens per case in the corpus benchmark report

## Context

A `bench/run.mjs` (`npm run bench`) per-model report's per-case table shows counts, prompt tokens and
timing, but not **which lens the review ran at** — whole-file vs hunks-only, and the context window
that decided it. `scripts/lib/review-ladder.mjs` `prepareLadder` picks the whole-file rung when the
window can hold the changed files (`:58`, sets `hunksOnly:false`/`rung:'whole'`) and falls to hunks
otherwise (`:82-87`, `hunksOnly:hasDiff`/`rung:'hunks'`/`skipped:'unsized-window'`). So the same case
reviewed by two models — or the same model on two days — can be read at very different fidelity purely
because of how much KV cache loaded, and the table gives no sign of it.

**Dated instance 2026-08-25**: `qwen/qwen3-coder-30b` loaded at 32,768 and lost the `structured` case
to an oversize refusal while `qwen/qwen3.5-9b` loaded at 154,624 and reviewed it whole; the two rows
sit in comparable reports with no indication one covered five cases and the other six for a reason
unrelated to the models. **Dated instance 2026-08-27**: `hold3-docs-only` (a 289KB file at the pinned
commit) drew a ~20x prompt-token spread — `qwen/qwen3.8-27b` (window 61,696) fell to a hunks-only
prompt (~3,890 tokens) while `qwen/qwen3.5-9b` (154,624) reviewed it whole (~88,170), both scoring it
near-clean, so the lens divergence surfaced as two models "compared" on a case they never reviewed at
the same depth.

**OAI-217 (shipped `d79164d`) already captured the data.** The review `--json` success envelope now
carries `contextWindow` (the effective/loaded window), and it already carried `hunksOnly` and
`skippedUnsizedWindow`; `bench/run.mjs`'s success path keeps the whole parsed envelope as `run.report`.
So the four numbers are present per run today — they are simply never aggregated into a row or rendered
into a cell. `bench/lib/case-rows.mjs` reads only `run.report.usage?.prompt_tokens`; `bench/lib/report.mjs`
`table()` renders 13 columns, none of them the window or the rung. **This item is therefore a
rendering/aggregation change on data OAI-217 already records — not a capture change.**

Probe verified (Codex, 4/4 claims TRUE): `report.mjs:85-88` has no window/rung/hunksOnly column and its
row renderer at `:112` matches that header; `case-rows.mjs` reads only `prompt_tokens` (`:99/106`) and
its row literal (`:236-268`) carries none of the four fields; the rung decision is in
`review-ladder.mjs:58/82-87`; the sweep path (`sweep-notes.mjs:34-35`) already renders `hunksOnly`/
`skippedUnsizedWindow` but no window. `npm run bench` renders ONE model per report
(`renderReport(...,{model})`, header "Benchmark — provider / model"); there is no multi-model table, so
cross-model comparison is done by the operator across separate reports.

## Decisions settled at grill (converged via Codex + a fable agent — both agreed on every fork)

1. **One combined `lens` column, not two, and not a caveat (Fork 1 → 1b).** A single cell renders
   `<rung>@<window>` — `whole@154624`, `hunks@61696`, `hunks@unsized`, or `diff` for a `--diff-only`
   run. The reader's task is comparing the SAME case across two separate per-model reports, so the
   divergence must be visible in one cell-to-cell glance; the rung is meaningless without the window and
   vice versa (the incident's own comparand was exactly the pair `whole@154624` vs `hunks@61696`), and
   an aggregate caveat (1c) would re-create the item's silence one level up by not naming which case
   fell to hunks. The table is already 13 columns wide, which 1b respects and 1a (two columns) does not.
2. **Corpus path only (Fork 2 → 2a).** Both dated instances are corpus-path. The sweep path already
   renders `hunksOnly`/`skippedUnsizedWindow` as prose, so it has no silent-lens hazard — only the raw
   window *number* is unshown there, and that gap has **no dated instance**, so per the repo's filing
   bar it is noted here as an observation and NOT grown into scope or filed as a new item.
3. **`--runs N` divergence: render the deduped set of distinct lens values joined with ` / `.** It
   degenerates to one value when every run agrees and prints `whole@154624 / hunks@61696` when a JIT
   reload between runs changed the lens. Silently printing run 1's lens would reproduce the exact
   silent-conflation defect this item fixes, inside its own fix; dedupe-and-join is the minimal honest
   render and the table already has multi-run-cell precedent (`N/M measured`).

## Design

**A. `bench/lib/case-rows.mjs` — aggregate the lens per case.** Add two small helpers next to
`promptSamples`/`rateSamples` and a `lens` field to the row literal in `caseRows`:

- `lensLabel(run)` → the run's lens string:
  - `run.diffOnly` → `'diff'` (the whole-file rung is never attempted under `--diff-only`; the report
    header already states the mode globally, so the per-case label states only that it was diff-scoped).
  - else `rung = run.report.hunksOnly ? 'hunks' : 'whole'`, and
    `window = (run.report.skippedUnsizedWindow || !(Number.isFinite(run.report.contextWindow) && run.report.contextWindow > 0)) ? 'unsized' : String(run.report.contextWindow)`,
    returning `` `${rung}@${window}` ``. The `> 0` guard (plan-gate round 1, Claude verdict) so a
    `0`/negative window renders `unsized` rather than `whole@0` — not reachable in practice (the whole
    rung requires the files to fit a real window) but the honest label if it ever were.
- `lensSamples(runs)` → `[...new Set(measurable(runs).map(lensLabel))]` — over `measurable` runs
  (`run.report && !run.error`) ALONE, matching every other figure in the row: a substituted or failed
  run's lens is disowned here exactly as its prompt/timing figures are (a substituted run carries a
  report and a reply but is excluded from `measurable`, so its lens does not enter the cell). Returns a
  possibly-empty array.
- Row literal gains `lens: lensSamples(runs)`.

`measurable`/`Number.isFinite` are the established gates in this file; reusing them is why the lens
inherits the same substituted/degraded discipline without restating it.

**B. `bench/lib/report.mjs` — render the column.** Add a `lensCell(lens)` returning
`lens.length ? lens.join(' / ') : '—'` (em dash for a case whose every run failed/substituted, matching
`tokenCell`'s own `—`). Add a `lens` header cell and a row cell **between `failed` and `prompt tokens`**,
so the causal pair sits adjacent (`hunks@61696 | 3890` reads directly against `whole@154624 | 88170`).
**THREE lines change together, not two** (plan-gate round 1, Codex): the header string
(`report.mjs:85-86`), the **Markdown delimiter row** (`:87`, which gains a fourteenth `---` cell), and
the row push (`:112-114`). Adding a header/data cell while leaving thirteen `---` cells renders a
malformed table, and the fixtures' by-name `cell()` reader skips the delimiter row — so this defect is
invisible to a by-name test and needs the explicit delimiter edit plus the column-count invariant in
the tests below.

**C. No other path.** The sweep report, the `--json`/DB records, and the CLI are untouched. The sweep
path's unshown window number is noted here as a known, out-of-scope observation (decision 2), not filed.

**D. `--diff-only` and control cases are unaffected in shape.** A `--diff-only` run reads `diff`; a
control case (no listed defects) still gets a lens like any other row — the lens is about how the review
ran, orthogonal to whether the case had defects.

## Files this plan touches

Edited: `bench/lib/case-rows.mjs` (two helpers + one row field), `bench/lib/report.mjs` (`lensCell` +
one header cell + one row cell), `tests/bench-report.test.js` (lens tests — see below), `CLAUDE.md`
(one line: `report.mjs`'s `lens` column and `case-rows.mjs`'s lens aggregation, present-tense).
Read to confirm no change needed: `tests/bench-report-fixtures.mjs` (its `cell(report, column)` reads
by column NAME, so a new column perturbs no existing assertion — but the lens tests reuse it),
`bench/lib/caveats.mjs` (no change — 1b puts the fact in the row, not a caveat),
`scripts/lib/review-report.mjs` (already emits `contextWindow`/`hunksOnly`/`skippedUnsizedWindow`;
consumed, not changed).

## Implementation

1. `case-rows.mjs`: add `lensLabel` + `lensSamples`, add `lens: lensSamples(runs)` to the row.
2. `report.mjs`: add `lensCell`, the header cell, and the row cell in `table()`.
3. Tests in `tests/bench-report.test.js`, each reading the `lens` cell by name via the fixtures'
   `cell()`:
   - a whole-file run (`contextWindow: 154624, hunksOnly: false`) → `whole@154624`.
   - a hunks run (`contextWindow: 61696, hunksOnly: true`) → `hunks@61696`.
   - an unsized-window run (`skippedUnsizedWindow: true, hunksOnly: true, contextWindow: null`) →
     `hunks@unsized`.
   - a `--diff-only` run (`diffOnly: true`) → `diff`, AND a run with BOTH `diffOnly: true` and
     `hunksOnly: true` still → `diff` (plan-gate round 1, Claude verdict — proves the diff short-circuit
     takes precedence over the rung branch, not just that a bare diff-only run happens to read `diff`).
   - a case whose only run failed (no `report`) → `—`.
   - **column-count invariant** (plan-gate round 1, Codex): the rendered table's header row, delimiter
     row, and every data row split to the SAME number of `|`-delimited cells. This is the test that
     catches a delimiter row left at thirteen `---` while the header/data carry fourteen — a malformed
     table the by-name `cell()` reader cannot see, since it never reads the delimiter row.
   - **the honesty case**: two runs of one case at different lenses (`whole@154624` and `hunks@61696`)
     → cell reads `whole@154624 / hunks@61696` (order = first-seen), and two runs at the SAME lens →
     one value, no ` / `.
   - a substituted run (`report` present, `error` set) does not contribute its lens (paired with one
     good run of a different lens, the cell shows only the good run's lens).

## Verification

Run the repo `verify` skill (`.claude/skills/verify/SKILL.md`) — `npm test`, a real plugin load, and a
delegation round trip. Quote the green summary line. This change is renderer-only; a live model is not
required to exercise it, and the network-free suite is the gate.

**Mutation check (step 5), the key invariant — the dedup-both-shown honesty**, since that is the whole
point of the item (a silent single value is the defect):

- Mutate `lensSamples` to collapse to the first run's lens (e.g. return
  `measurable(runs).map(lensLabel).slice(0, 1)` instead of the deduped set). The honesty test — two runs
  at different lenses expecting `whole@154624 / hunks@61696` — must go RED.
- Back up the file, prove the mutation landed with `~/Code/dotfiles/tests/mutation-landed.py` (target
  and replacement written to files BEFORE mutation), run the suite, name the failing test, restore,
  re-run green, and prove the restore by `diff` against the backup — never by eye.

A positive control accompanies it: the same test must PASS on the real code (both lenses shown), so the
control fires (mutant red) → fix catches (real green) → and removing the fix does not stay green.
