ARCHIVE — not the current spec; the live plan is the file beside it.
provenance: harness slug virtual-plotting-wirth

# OAI-220 — a cross-run comparison reader for `bench/` records

## Context

`bench/` writes one JSON record + one `.md` report per invocation (`bench/lib/record.mjs`
`persist`, record.mjs:67; called once at run.mjs:311). Nothing reads more than one record at a
time — `renderReport` (report.mjs:160) consumes a single record's `results` array, and a repo-wide
search found no consumer of N records (Codex-verified in probe). So every cross-run comparison is
assembled by hand. The dated instance (2026-08-25/26): a ranking over 14 models / ~110 invocations,
built by hand, introduced **three errors — all comparability failures**: a lens recorded as
whole-file when the record said `hunksOnly`, a finding tally mixing per-finding and per-cluster
units, and a "worst performer" attribution drawn from the wrong run. The records were complete and
correct; only the by-hand assembly was wrong.

**Outcome:** a reader that ingests N records and emits the comparison directly from the records'
own already-correct numbers — never re-tallying — and that refuses to *rank* records that are not
like-for-like, because ranking incomparable records is exactly how those three errors happened.

## Decisions (grill + Codex steer, both recorded)

- **Input = explicit record paths** (`node bench/compare.mjs <record.json>... [--baseline <path>]`),
  shell-glob expanded. No auto-discovery/filter — mis-selection is the error class, so selection
  stays auditable and in the operator's hands.
- **One row per record**, labelled `<model> @ <stamp>` (stamp = the file basename minus `.json`).
  **Never auto-merge same-model records** — merging cold-vs-warm or differently-sampled runs of one
  model is the mis-attribution risk. On a label collision (the same file passed twice, so identical
  `(model, stamp)`), disambiguate deterministically by appending the input-order index `(#i)` —
  model+stamp stays the primary label (Codex round 2 reconciliation).
- **Reuse `caseRows(results, {cold})`** (case-rows.mjs:287) per record; read its already-aggregated
  fields (`opportunities`, `found`, `anchored`, `unmatched`, `control`, `scored`, `failed`,
  `timedOut`, `unreadable`, `capped`, `diffOnly`, `degraded`, `reported`, `lens` (a set), and the
  `prefill`/`generation`/`rate` `{values,measured,completed}` timing samples — **not** a `durationMs`
  field, which caseRows does not expose). **Never re-score or re-tally** — the records are correct;
  re-deriving would re-introduce the unit-mixing error.
- **Two views:** a **ranking summary** (one aggregate row per record) and a **per-case recall
  matrix** (rows = cases, columns = records). Tracker names both.
- **Comparability guard (owner-chosen: show tables, suppress ranking):** when the records diverge on
  a comparability axis, render the matrix and per-record panels but **withhold the ranking/ordering**,
  naming the divergent axes. Never a hard refuse (the corpus spans a month of schema/flag drift), and
  never a silent rank.
- **Deltas (owner-chosen: baseline-relative):** render per-case deltas against a baseline **only for
  exactly two records, or when `--baseline <path>` names one**; absolute values otherwise (deltas vs
  an ambiguous baseline for N>2 mislead).
- **Older records — evidence-based normalization (round-1 correction):** absence is read the way the
  writer reads it, not blanket-unknown. A not-passed **boolean** flag means `false` (the writer
  persists raw `options` and reads `Boolean(options[...])`); a not-set **value** flag means "default"
  and two records both omitting it stay comparable. Genuine unknown arises only where the record
  cannot prove the axis — an absent cap with a capped run, or a lens whose raw report fields predate
  the feature — and unknown on any axis suppresses ranking. A record whose nested shape `caseRows`
  cannot read is `incompatible`, excluded from ranking, never a crash.
- **Markdown to stdout** (ephemeral; a comparison is ad-hoc, not an artefact to persist like a run).
- **Scope = review records only** (the `{runsPerCase, options, warmed, results}` shape). A file that
  is not that shape (a sweep record, a task record) is refused with a clear message — sweeps are
  OAI-151's separate concern.

## Comparability axes (round-1 dual review corrected these)

The axis set is **exactly what `renderReport` (run.mjs:296-309) threads into the report as "must be
tellable apart"**, sourced from the persisted raw `options` blob by its real keys, plus top-level
`runsPerCase`. Records are rankable together only when **all** axes match; a mismatch or a genuine
unknown suppresses the ranking and is named. Crucially, **absence is not blanket-unknown** — the
writer records raw `options` and reads booleans via `Boolean(options[...])`, so a not-passed boolean
means `false`, and treating it as unknown would suppress ranking on every ordinary record (Codex + the
Claude verdict subagent, round 1).

| Axis | Source (real key) | Absence semantics |
| --- | --- | --- |
| diff-only | `Boolean(options['diff-only'])` (also `row.diffOnly`) | `false` — definite |
| cold | `Boolean(options.cold)` | `false` — definite |
| structured-output (requested) | `Boolean(options['structured-output'])` | `false` — definite |
| structured-output (effective) | per-case `degradationClass(row)` (none/partial/all, from `row.degraded` / `row.reported`) | a **per-case** axis, not record-level (round-2 finding): same requested flag but a case whose degradation class differs across records did NOT run under the same constraint ⇒ suppress, naming that case |
| coverage (per shared id) | `row.scored > 0` | a **per-case** axis (round-2 finding): a case scored in one record but failed in another is not a like-for-like recall comparison ⇒ suppress, naming that case |
| timeout | `options.timeout` (value) | not set = provider default; both-absent = comparable |
| max-tokens | `options['max-tokens']` (value) | as above |
| temperature | `options.temperature` (value) | as above |
| max-attempts | `options['max-attempts']` (value) | a retry-policy arm forwarded to the review command (Codex round 2) — as above |
| warm-up | `Boolean(options['warm-up'])` | `false` — definite; a warmed server changes first-token conditions (Codex round 2) |
| wall-clock cap | `options['max-seconds']` (value) — **never `row.capped`** | 3-state, below |
| runs per case | top-level `record.runsPerCase` | always present; **must be equal to rank** |
| case set | set of `caseDef.id` across `results` | — |
| case definition (per shared id) | canonical serialization of **every own key of the parsed `caseDef`** (not an enumerated subset — includes `control`, `mode`, `origin`, `files`, `defects`, `dropped`, and any field a future manifest adds) | equal id but **any** changed field ⇒ different benchmark input or ground truth ⇒ suppress (Codex rounds 3-5) |
| per-case lens | `row.lens` **as a set**, gated on raw-field presence (below) | missing raw fields ⇒ lens unknown ⇒ suppress |

- **Cap is config, not outcome (Codex round 1).** `row.capped` is the count of `deadline-timeout`
  runs — an outcome — never the configured cap. Normalize `max-seconds` in three states: explicit
  value ⇒ compare the value; absent **and** any capped run ⇒ a cap existed at an unknown value ⇒
  suppress; absent **and** no capped run ⇒ "no CLI cap set", comparable, with the disclosed caveat
  that a provider-side cap cannot be *dis*proven from the record.
- **`runsPerCase` is load-bearing (Codex round 1).** The aggregate's recall is a rate (runsPerCase
  cancels), but the raw `unmatched` and control-FP totals scale with sample count, so ranking
  requires equal `runsPerCase` — hence it is an axis, not just a caveat.
- **Case identity is the whole definition, not the id or just the ground truth (Codex rounds 3-4).**
  `caseDef.defects`/`dropped` are the scoring ground truth (run.mjs:205, case-rows.mjs:293), but
  `caseDef.mode` decides effective diff-only (run.mjs:119) and `caseDef.origin`/`files` define the
  materialized input `materialize(caseDef, ROOT)` reviews (run.mjs:124) — so a shared id with a
  changed mode, revision, or file set is a different benchmark even with identical defects.
  Comparability therefore compares a **canonical serialization of every own key of the parsed
  `caseDef`** (object keys sorted; **array order preserved, never sorted** — `files` order is
  semantic, so reordering it is a real input difference the signature must not mask) per shared id —
  enumerating a subset is exactly
  what let the round-3 signature drop `control` (Codex round 5), so the rule is "serialize the whole
  object", not a field list. Any difference suppresses ranking and is named; a new `caseDef` field is
  covered automatically rather than silently ignored.
- **Value flags compare numerically, not as strings (Codex round 3).** `options` retains raw parsed
  representations, so numeric value flags (`timeout`, `max-seconds`, `max-tokens`, `temperature`,
  `max-attempts`) are compared via `Number(...)` — `"1"`, `1`, and `"1.0"` are equal — with both-absent
  equal; booleans via `Boolean(...)`. A non-finite coercion (a garbage value) is treated as unknown,
  not silently equal.
- **`options.maxSeconds`, `structuredOutput`, and `reasoning_effort`/`top_p`/`top_k`/`min_p` do not
  exist in the record** — the first two are `renderReport` *parameter* names, never persisted keys;
  the last four are not in `run.mjs`'s `SPEC` at all. Read the real keys above; handle a stray
  sampling key defensively only if a future record carries one.

The matrix additionally marks a **per-cell** lens divergence even while the rest of that row is
shown, mirroring the single-record `lens` column.

### Lens raw-field presence — mirror `lensLabel` exactly (Codex rounds 1 & 2)

`lensLabel` (case-rows.mjs:153) branches: a `run.diffOnly` run returns `diff` **without reading any
report field**; otherwise the label reads `run.report.hunksOnly` (absent ⇒ falsy ⇒ `whole`) and
`contextWindow`/`skippedUnsizedWindow` (absent ⇒ `unsized`). So the presence check must mirror that
branch, not demand the report fields unconditionally (Codex round 2): a run's lens is **known** iff
`run.diffOnly` is a **present boolean** AND either it is `true` (known as `diff`, no report fields
needed) or `run.report` carries `hunksOnly`, `contextWindow`, and `skippedUnsizedWindow` as present
keys. Any absent raw key — including a missing `run.diffOnly`, which would silently read as a concrete
non-diff lens — makes that run's lens **unknown** ⇒ case lens unknown ⇒ suppress ranking. The check is
over `measurable` runs, the same population `lensSamples` uses. `row.lens` is still used for display.

## Files

- **`bench/compare.mjs`** (new, CLI entry) — parse args (record paths + `--baseline`); read and
  `JSON.parse` each file; **enforce the review-record discriminator and refuse anything else**; build
  `{path, stamp, record}` tuples; call the derivation, then the renderer; `process.stdout.write` the
  markdown. Header `allowed-tools` not needed (not a plugin command). Mirrors `bench/run.mjs`'s
  arg/`ROOT` style.
  - **Review-record discriminator (Codex round 3; Claude round 4 hardened):** scope is "review record
    only", so a bare `results` array is not enough — a sweep or task record could carry one. Require
    the full review shape: a top-level object with `runsPerCase` a number, `options` an object, and
    `results` a non-empty array, **and no top-level `kind` field** — a task record is
    `{kind:'task', options, ...sweep}` (task-run.mjs:189), carrying no top-level `runsPerCase` and an
    explicit `kind`, so both checks exclude it. A file missing the review shape is **refused at parse**
    with a clear out-of-scope message (sweeps are OAI-151), distinct from a review record whose deeper
    shape `caseRows` cannot read, which `normalizeReviewRecord` reports as `incompatible`.
- **`bench/lib/compare-model.mjs`** (new, pure) — the round-1 simpler-core shape (Codex):
  - `normalizeReviewRecord(entry)` where entry is `{path, stamp, record}` — **validates the minimum
    top-level shape** (`results` a non-empty array; each element an object with a `caseDef` object and
    a `runs` array) **plus two case-id guards that the downstream code depends on**, all BEFORE and
    OUTSIDE the try/catch below: every `caseDef.id` must be a **string or number** (it is
    string-coerced OUTSIDE the guard by `divergencesOf` — its case-set `.join(',')` signature and the
    `case "${id}"` divergence messages — and by the rendered matrix; `labelRecords` reads the model
    and stamp, not the id — so a non-primitive id, read here via `typeof`, which never invokes
    `toString`, is marked incompatible rather than crashing the run at one of those sites), and the case ids must be **unique** (a duplicate
    id double-counts in `aggregate`, which sums every row, while the Set/Map axes collapse it to one —
    a SILENT mis-rank, the exact failure this reader exists to prevent). It then wraps
    `caseRows(record.results, {cold})` in try/catch; on any failure returns `{incompatible: true,
    reason}` rather than throwing (a month-old corpus must not crash the run — Codex round 1). These
    guards are scoped to the JSON records `compare.mjs` feeds (`JSON.parse`, so no getters/Symbols/
    `NaN`/`Infinity` reach them); an unreachable hostile-programmatic-caller shape is deliberately not
    hardened against, per the repo worth bar. **It must NOT require each run to carry `score` or `error`** — a
    clean but *unreadable* run has neither (`run.mjs` attaches `score` only when
    `outcome.report?.parsed`, and `caseRows` supports unscored non-error runs via `unreadableRuns`),
    so demanding it would wrongly mark valid records incompatible (Codex round 2). `caseRows` already
    guards its own `score` reads (they run over the `scored` bucket / optional-chained), and the
    try/catch backstops any deeper missing field (e.g. a historical `caseDef` lacking `defects`/
    `dropped`). On success returns `{rows, identity (via reportIdentity(record.results,
    record.options)), axes}` where `axes` is the per-axis map of `known(value)` / `unknown(reason)`
    states built from the table above, including the cap 3-state and the lens raw-presence check.
  - `buildComparison(normalized[], {baseline})` — per-record aggregate (recall = Σfound / Σopportunities
    over non-control; `unmatched` total; control-FP total = Σunmatched over control cases; and a
    **representative generation throughput = median of `row.rate.values` over EVERY row's measurable
    runs — control cases and unscored-but-generated runs included, since throughput is a
    generation-speed property, not a recall population; `row.rate.values` is already scoped to
    `measurable(runs)`, so transport failures never pollute it**, a caseRows field with an explicitly
    stated statistic — `durationMs` is NOT a caseRows field, so the round-0 "median durationMs" is
    dropped). Computes `rankable` (all axes `known` and equal, equal
    `runsPerCase`, equal case-id set) with the named divergent/unknown axes, and baseline-relative
    deltas gated on `normalized.length === 2 || baseline named`. Incompatible records are excluded
    from ranking and surfaced in their own panel. **Ranking order (Codex round 2, must be explicit
    and deterministic):** among rankable records, order by aggregate recall (Σfound/Σopportunities
    over non-control) **descending**; ties broken by the **per-scored-run** false-positive RATES —
    `unmatched / scoredRuns` ascending, then control-FP / control-scored ascending — never the raw
    totals, which scale with sample count and would let a record with more runs rank behind an
    otherwise-equal one (round-2 finding); the final deterministic tiebreak is the row **label**
    (`<model> @ <stamp>`) lexicographic via a three-way comparator (`<`/`>`/`0`), not a two-way
    `stamp` compare, which returns the wrong sign for equal labels (round-4 finding). A
    fully-degenerate record (every case failed ⇒ Σopportunities = 0) guards the `0/0` and renders
    recall as `—`; the comparator retains a "sorts last" arm for it (Claude round-2 note), but that arm
    is now **unreachable in a rankable set** — a mixed degenerate/scored pair is excluded by the
    coverage axis, and an all-degenerate set is withheld by the no-evidence gate below — so it is
    defense-in-depth, not an observable ordering. **Null-recall handling (round-7/full-pass finding).** A WHOLE rankable set can be null-recall — a **control-only comparison** (no non-control
    opportunities). Recall is compared only while at least one side has it (a mix is unreachable in a
    rankable set: the coverage axis forces the records to agree per-case on which runs scored, so
    either every record's recall is non-null or none is); when none is, the order falls through to the
    same rate tie-breaks, so a control-only comparison **ranks by `controlFPRate` (fewer false
    positives first)** rather than alphabetically. Those rates are like-for-like for the same coverage
    reason (`controlScored`-presence is uniform), so no evidence-presence pre-order is needed — it
    would be inert and untestable through this path. **No-evidence withhold:** a like-for-like set with
    NOTHING to rank — every recall null AND no control case scored (every run failed) — is **not
    ranked at all**: `rankable` additionally requires at least one record to carry a rankable
    measurement (a non-null recall, or `controlScored > 0`), and the renderer withholds under a
    DISTINCT reason ("no record produced a scoreable run"), never the "not like-for-like" reason (the
    records ARE comparable). No I/O, no markdown — unit-testable.
- **`bench/lib/compare-report.mjs`** (new, render) — `renderComparison(model, {baseline})` → markdown
  string. This is the only new file that interpolates untrusted values (model ids, stamps, reasons),
  so **it joins the markdown-safety enforced set**: every untrusted interpolation wrapped in
  `safeInline`/`displayReason` (markdown-safe.mjs), its path added to `SWEEP_RENDER_FILES`
  (structure.test.js:543), **and a `SWEEP_SAFE_EXPRESSIONS['bench/lib/compare-report.mjs']` entry
  added unconditionally** — an empty `Set` if there are no intentional-layout exceptions, since the
  test does `SWEEP_SAFE_EXPRESSIONS[rel].has(...)` (structure.test.js:663) and a missing entry throws
  on `undefined.has` (both reviewers, round 1).
- **`package.json`** — add `"bench:compare": "node bench/compare.mjs"`.
- **`tests/bench-compare.test.js`** (new) — see Verification.
- **`CLAUDE.md`** — one present-tense architecture line for `bench/compare.mjs` (added at step 6,
  docs).

## Reused, not rebuilt

- `caseRows` (case-rows.mjs:287) — all per-case aggregation.
- `reportIdentity(record.results, record.options)` (record.mjs:39) → `{provider, model}`; the
  model+stamp row label is composed here (reportIdentity does not build it), stamp from the file
  basename.
- `safeInline` / `displayReason` (markdown-safe.mjs:74/85) — every untrusted interpolation.
- The `lens` set semantics already established by `lensSamples`/`lensLabel` (case-rows.mjs) — the
  matrix reads `row.lens` (compared as a set, order-insensitive), it does not recompute the label;
  comparability additionally checks the raw report fields the label derives from.

## Edge cases

- A case that failed every run in a record (no `score`): the matrix cell shows the failure state
  (`failed`/`timeout`/`unreadable`/`capped` from the row), never a fabricated `0` — the records
  distinguish "found nothing" from "never answered", and so must the reader.
- A control case (`row.control`): no recall (`— (control)`); its `unmatched` is a false-positive
  count, aggregated into the per-record control-FP figure, never into recall.
- A record whose every run was substituted/failed (no answered run): `reportIdentity` already falls
  back to the requested id marked unconfirmed — the row label carries that verbatim.
- Two entries with the same resolved stamp (same file passed twice): keep both, disambiguated by the
  input-order `(#i)` suffix on the `<model> @ <stamp>` label — passing a file twice is a no-op to no
  useful end but not an error, and the label stays deterministic. `labelRecords` makes the label set
  **globally unique**: a repeated base gets its `(#i)`, then the suffix is EXTENDED until the whole
  set is distinct — a single suffix could otherwise equal another entry's natural base label, since
  `stamp` is a user-supplied filename (`compare.mjs`'s basename), so a file literally named
  `<model> @ <stamp> (#1)` is reachable and would break the ranking comparator's label tiebreak (two
  distinct records comparing equal) and baseline lookup. The `<model>` half is `typeof`-guarded: the
  reply model is a string in bench's own output, but a corrupted non-string (whose coercion would
  throw when interpolated, outside `normalizeReviewRecord`'s guard) renders as `unknown` rather than
  crashing.

## Verification (step 5)

1. `npm test` green, and the new `tests/bench-compare.test.js`:
   - **Derivation — divergence flip set (round 1 expanded this):** two synthetic records matching on
     every axis are `rankable: true` with a correct aggregate; flipping **each** axis in turn makes
     `rankable: false` naming that exact axis — the set must include `cold`, **`structured-output`**
     (the round-0 wrong-key `options.structuredOutput` would have made this test silently never fire —
     Claude subagent), **`runsPerCase`**, `max-seconds` (explicit value), `timeout`, `temperature`,
     **`max-attempts`**, **`warm-up`** (Codex round 2), a case's lens, and a dropped case id.
   - **Absence ≠ unknown:** two records both omitting `cold`/`structured-output` are `rankable: true`
     (boolean absence = false), NOT suppressed — the specific regression the blanket-unknown rule
     would have caused.
   - **Cap config vs outcome:** two records with the same explicit `max-seconds` but different
     `row.capped` counts are `rankable: true` (capped is an outcome); a record with absent
     `max-seconds` **and** a capped run is `rankable: false` (cap existed, value unknown).
   - **Incompatible record:** a record whose nested shape `caseRows` cannot read is
     `{incompatible: true}`, excluded from ranking, and does not throw.
   - **Unreadable run is NOT incompatible (Codex round 2):** a record with a clean but unreadable run
     (no `score`, no `error`) normalizes fine and is rankable — the validator must not demand
     `score`-or-`error` per run.
   - **Case definition (Codex rounds 3-5):** for a shared id, a changed `caseDef.defects`, a changed
     `caseDef.mode`/`origin`/`files` with identical defects, **and a changed `caseDef.control`** each
     make the records `rankable: false`, naming case-definition divergence — the whole-object
     (every-own-key) signature must catch a changed input or classification, not only changed scoring.
   - **Review-record scope (Codex round 3; Claude round 4):** a non-review object carrying a `results`
     array but no `runsPerCase`/`options` is **refused at parse** (out-of-scope message), not silently
     normalized; likewise a task record (`{kind:'task', ...}`) is refused by the `kind`/`runsPerCase`
     checks.
   - **Numeric value flags (Codex round 3):** two records with `max-tokens` `"1024"` vs `1024` (or
     `temperature` `"1"` vs `1.0`) are `rankable: true` — compared numerically, not by string.
   - **No re-tally:** aggregate recall equals the sum of the records' own `caseRows` fields — asserted
     against hand-checked fixture numbers, so a re-derivation that mixed units would diverge.
   - **Deltas:** present for N==2 / named baseline, absent for N==3 with no baseline.
   - **Failure cells:** an all-failed case renders its failure state, not `0`.
   - **Markdown safety:** a record carrying a model id / reason with markdown metacharacters is
     escaped in the output (positive control: the raw metachar is absent, the dotted form present).
   - **Structure test:** `compare-report.mjs` is in `SWEEP_RENDER_FILES` and passes the enforced
     interpolation grammar (a deliberately-unwrapped interpolation would fail it — mutation-proved at
     step 5).
2. **Real run:** `node bench/compare.mjs` against two real `bench/results/*.json` records — confirm
   the ranking renders when they match and is suppressed with a named axis when they don't. Quote the
   observed output. **Outcome, recorded in `evidence/oai-220-mutation-proof.md`:** the two WITHHELD
   arms (incomparable, and no-scoreable-run) are demonstrated on real records; the render-when-matching
   arm has NO real-corpus example — every pre-OAI-217 record is withheld on `lens`, and no post-OAI-217
   record carries a scored run, so no real pair is simultaneously axis-matching and scored (and none can
   be minted here — bench's model-selection does not recognise the served model ids). That arm is
   covered by the synthetic fixtures instead.
3. **Mutation check (key invariant = ranking suppression on divergence):** flip the comparability
   comparison to always-equal, prove it landed (`mutation-landed.py`), run the suite, name the test
   that goes red (the divergence-suppression test), restore, re-run green.

## Out of scope / residue

- Cross-**sweep** history (review-sweep records) is **OAI-151**, explicitly separate — not touched.
- The pre-existing unenforced markdown safety in `report.mjs`/`case-rows.mjs`/`caveats.mjs` is a
  known gap (Explore); this feature adds the new file to the enforced set but does not retrofit the
  old ones — note as residue if worth filing at step 9.
- No persistence, no new record fields, no id minting — this is a pure reader over existing records.
