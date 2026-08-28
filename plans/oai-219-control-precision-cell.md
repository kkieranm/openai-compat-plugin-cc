STATE: dual-approved-unattended

Owner's authorisation for this unattended run (2026-08-27), quoted verbatim:

> "i will leave you unattended. keep iterating on items using /feature . when you have an option
> that you would usually put to me, instead try to converge using codex and a fable agent. do not
> prompt for plans as i will not be here"
>
> "you also have my permission to use lm studio if you need it"

Later steer (2026-08-27), also governing:

> "unless youre doing tangible code changes - move on to issues that actually matter and are likely
> to encounter"

# OAI-219 — the control's precision measurement is printed as if it were a scoring artifact

## The defect (confirmed by reading the render code and probed by Codex)

The benchmark case table has an `unmatched` column: findings the model reported that matched no
catalogued defect. Its meaning is **case-dependent** and the table does not say so:

- On an **ordinary** case, an unmatched finding may be a real defect the anchor-line matcher missed
  in different words — a scoring artifact, not necessarily a false positive.
- On a **control** case — a commit with no code and zero catalogued defects, marked `"control": true`
  in its manifest (`bench/lib/corpus.mjs:59` enforces that a zero-defect case must set it) — there is
  nothing for a finding to have matched, so **every unmatched finding is a false positive by
  construction**: a precision measurement.

`bench/lib/report.mjs:127` renders the same bare `${row.unmatched}` for both, so a control's precision
figure is indistinguishable at a glance from an ordinary case's scoring artifact. The only distinction
is a prose caveat (`bench/lib/caveats.mjs:294-298`) that **hard-codes the literal id `docs-only`**.

Two facts make this a live bug rather than a latent one, both probed TRUE by Codex on 2026-08-28:

1. **The prose is already stale.** A second control case, `hold3-docs-only`, now exists
   (`bench/cases/hold3-docs-only/case.json`, `"control": true`, `"defects": []`), and a default run
   (`bench/run.mjs:214-224` `selectCases` returns all cases when `--case` is absent) includes both
   controls — but the caveat names only `docs-only`, so a reader is never told the false-positive rule
   applies to `hold3-docs-only`'s `unmatched` cell too.
2. **The renderer uses a proxy, not the flag.** `recallCell` (`report.mjs:74-75`) detects a control by
   `row.listed === 0`, and `case-rows.mjs`'s row literal (`:280-316`) never copies `caseDef.control`
   onto the row at all. So control detection is done three inconsistent ways: a proxy in one cell, a
   hard-coded id in the prose, and nothing in the `unmatched` cell.

Dated instance (from the item, 2026-08-25/26): comparing fourteen models required extracting the
`unmatched` column by hand and applying the false-positive rule mentally; the comparison misreported
at least one model's control behaviour before it was caught, and a verified re-run moved three
configurations across the pass/fail line on this measurement alone. The silent-failure shape: a model
with zero recall and zero control findings and a model with zero recall and three control findings
print an `unmatched` cell whose meaning the reader has to know to interpret.

## Design decision (converged via Codex steer + a fable agent, both STEER/RECOMMEND: A, unanimous with the orchestrator)

The fork the item names — "control earns its own reported figure" vs "`unmatched` on a no-code case
should simply be named what it is" — was put to a Codex steer and an independent fable agent. Both,
and the orchestrator, chose **mark-in-place (Option A)** over a dedicated precision column/section
(Option B), for these converged reasons:

- It applies the report's own established convention literally: a sub-count/label rides **inside** its
  parent cell as a parenthetical (`12/15 (3 cut)`, `4 (2 timed out)`), so `2 (false pos)` is that
  convention, not a new surface. The table is already 14 columns wide and the repo resists widening it.
- On a control the count already **is** the complete measurement — matched is 0 by construction, so
  `unmatched` = every finding = the false-positive count. A "first-class precision figure" (B) would be
  the same number relocated; there is no better-defined denominator that a rate would add.
- B has no named consumer today (the repo's worth bar: a dated instance or named mechanism, never a
  plausible future). Once the `control` flag is on the row and in the record JSON, a dedicated figure
  can be added the day someone actually aggregates precision across runs.

Both fable and Codex independently stressed the anti-staleness requirement: **derive the prose's
control names from the propagated flag**, so a third control case can never re-create the `docs-only`
staleness. That is built into the plan below.

## The change — one predicate, three consistent sinks

**Single source of truth.** `case-rows.mjs` propagates `control: caseDef.control === true` onto the
row. All three control-detecting sinks then read that one boolean instead of three different proxies.

**The invariant this rests on must be enforced, not assumed (plan-gate round 1, Codex).** The corpus
today enforces only one direction — `defects.length === 0 ⇒ control === true` (`corpus.mjs:59`) — and
NOT its converse, so a manifest with `control: true` *and* catalogued defects passes validation. Such
a case would read `— (control)` and have its genuine unmatched findings called false positives "by
construction", which is a contradiction: a control is by definition a clean, code-free target with no
catalogued defects (see `docs-only`'s own manifest note). So the plan closes the hole at the source
rather than relying on "no such case exists on disk". No existing case is affected — both controls have
`defects: []`.

### Phase 1 — enforce the control invariant, propagate the flag, mark the cell

0. `bench/lib/corpus.mjs`, `validateDefects`: after the existing zero-defect guard, add the symmetric
   guard — `if (manifest.control === true && defects.length > 0) throw new UserError(...)`, naming the
   contradiction ("a control case measures precision on a clean target, so it cannot also list
   defects"). This makes `defects.length === 0 ⇔ control === true` a real, both-directions invariant for
   every case the corpus loads, which is what lets `row.control` be a sound control predicate and what
   makes the equivalence the recallCell switch relies on genuinely true rather than true-in-practice.

1. `bench/lib/case-rows.mjs`: in the row literal returned by `caseRows` (`:280`), add
   `control: caseDef.control === true` (a normalized boolean beside `listed`). One short comment naming
   why the row carries the manifest flag rather than the `listed === 0` proxy.

2. `bench/lib/report.mjs`: add a small `unmatchedCell(row)` helper —
   `row.control ? \`${row.unmatched} (false pos)\` : \`${row.unmatched}\`` — with a docstring in the
   style of the neighbouring cell helpers (why the meaning differs on a control). Replace the bare
   `${row.unmatched}` interpolation in the table row (`:127`) with `${unmatchedCell(row)}`. The label
   shows for **every** control row including `0 (false pos)`, because a `0` that is not marked is again
   indistinguishable from an ordinary `0`.

3. `bench/lib/report.mjs`: change `recallCell` (`:75`) to detect the control by `row.control` rather
   than `row.listed === 0`, so all three sinks share the one propagated definition. Behaviour is
   unchanged for every case the corpus can load — with Phase-1 step 0 in place, `listed === 0 ⇔ control
   === true` holds in both directions for any validated case — and no test feeds `renderReport` a
   `defects: [] && !control` row (verified: both empty-defect fixtures set `control: true`). `row.listed`
   stays on the row — it is still used for `opportunities` and the dropped-defect maths; only the recall
   *detection* switches.

### Phase 2 — de-staleize the caveat (`bench/lib/caveats.mjs`)

Replace the hard-coded `docs-only` sentence (`:294-298`). Keep the unconditional first half verbatim
(**"Unmatched" is not "false positive"** … the scorer undercounts a re-worded match). Append a
control clause **only when the run contains a control**, naming the control cases **structurally from
the rows** (`rows.filter((row) => row.control).map((row) => row.id)`), each in backticks, and pointing
at the `(false pos)` cell marking. When no control case is present the clause is omitted entirely
(the current unconditional `docs-only` sentence is wrong for a `--case caps` run that has no control).
Case ids are corpus directory names, validated to equal the directory (`corpus.mjs:85`) — trusted
data, wrapped in backticks like the existing `\`docs-only\``, so no `markdown-safe` wrapping is owed
(this is not the untrusted-value class OAI-213 covers).

### Phase 3 — tests (`tests/bench-report.test.js`)

Add, each with its negative twin (a marker always present distinguishes nothing — the file's own
stated discipline):

1. **A control row names its unmatched as false positives; an ordinary row does not.** Build a control
   caseDef (`{ ...CASE, defects: [], control: true }`, id stays `sample` so the `cell` helper reads it)
   with a run whose `score.unmatched` has one finding → assert `cell(report, 'unmatched') === '1 (false
   pos)'`. Twin: an ordinary case (defects present, `control` false) with one unmatched finding →
   `cell(report, 'unmatched') === '1'` and `assert.doesNotMatch(cell(report, 'unmatched'), /false pos/)`
   — the assertion is scoped to the CELL, never the whole report, because the unconditional caveat
   legitimately contains the words "false positive" (plan-gate round 1, Codex).

2. **The false-positive caveat names every control structurally, not a hard-coded id.** Render a report
   with TWO control cases carrying ids that are **not** `docs-only` (e.g. `ctrl-one`, `ctrl-two`) →
   assert the caveat names **both** ids and does **not** contain the literal `docs-only`. This is the
   exact anti-staleness assertion: the old code would have named neither and hard-coded `docs-only`.
   Twin: an ordinary-only report (no control) omits the "false positive by construction" control clause
   while still emitting the unconditional "Unmatched is not false positive" sentence.

3. The existing `the control case is not reported as a recall failure` test (`:238`) keeps passing —
   `recallCell` still returns `— (control)` for a `control: true` row (now via the flag).

4. **The corpus rejects a contradictory control manifest** (`tests/bench-corpus.test.js`, beside the
   existing control test at `:197`): a manifest with `control: true` AND a defect throws a `UserError`.
   This pins Phase-1 step 0's converse guard and is the positive control proving the new invariant
   fires. Twin already present: a `control: true` + `defects: []` manifest loads fine.

## Verification (step 5)

- `npm test` green (currently 1305), quoting the summary line.
- Mutation of the key invariant — *a control row is distinguished from an ordinary row in the
  `unmatched` cell*: in `case-rows.mjs` change `control: caseDef.control === true` → `control: false`
  (drop the propagation). Prove it landed with `mutation-landed.py`, run the suite, name the failing
  test (Phase-3 test 1's `'1 (false pos)'` assertion), restore, re-run green, prove the restore against
  the backup. Single edit, behaviourally meaningful (a control cell reverts to bare), reds a named test.

## Out of scope

- No new column, summary row, or cross-run precision aggregation (that is Option B, and OAI-220's
  reader-across-records territory). If a machine consumer of precision appears later, the propagated
  `control` flag and the record JSON already carry what it needs.
- `bench/lib/report.mjs:204-205`'s unescaped server-reported model ids (OAI-213's disclosed sibling
  residue) — untouched; a different class, latent, below the worth bar per its finder.

## Disclosed residue (checked at step 9, not assumed)

None expected. The change closes the item's gap (control precision self-described in the cell) and
fixes the concrete stale-prose bug (`hold3-docs-only`) the probe surfaced. Walk all four residue
sources at step 9 before claiming "no residue".

## Plan-gate thread

**Round 1 (2026-08-28).** Codex: CHANGES-REQUIRED — the converse invariant `control === true ⇒
defects.length === 0` is unenforced (`corpus.mjs:59` guards only the forward direction), so a
`control: true` case with defects would validate, read `— (control)`, and have real unmatched findings
labelled false positives; also, the ordinary-row negative twin must scope `doesNotMatch(/false pos/)`
to the cell, not the whole report. Independent Claude verdict subagent: APPROVE, but flagged the SAME
biconditional imprecision as non-blocking (no such case on disk/fixtures, semantically nonsensical).
**Amended:** added Phase-1 step 0 (enforce the converse guard in `validateDefects`) + a corpus test
(Phase-3 test 4) making the invariant real in both directions; scoped the negative twin to the cell;
corrected the recallCell justification to cite the now-enforced biconditional. Both approvers' concern
resolved by closing the hole at source rather than relying on absence.
