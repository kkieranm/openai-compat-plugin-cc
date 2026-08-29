# OAI-151 — cross-run sweep reproduction reader

provenance: harness slug snoopy-rolling-dawn

## Context

An overnight review sweep (`bench/review-sweep.mjs`) reviews git commits newest-first with a local
LLM and appends each commit's outcome to a `review-sweep-<stamp>.ledger.jsonl` file. **There is no
way to compare one sweep with another**, so every sweep A/B in the tracker was read by hand and, per
OAI-141, read as a measurement when it was not: run-to-run spread (~30% of finding-bearing commits do
not reproduce on identical inputs) exceeds the config differences people compare. The number that
decides whether any sweep A/B means anything — a **per-commit reproduction rate across runs** —
cannot currently be computed by anything.

This ships a **stateless reader** (owner-chosen, both Claude and Codex concurred) in the
`bench/compare.mjs` mold: it takes N ledger paths, groups the runs by a comparability signature, and
prints the per-commit reproduction matrix, an aggregate rate, and the per-run finding-bearing spread.
The ledgers are already durable on disk and ARE the history — "consume, not replace" (OAI-151's own
framing). No new storage, no persistence, no SQLite.

Verified against the 8 real on-disk ledgers: grouping runs by **observed** model (`entry.model`, not
the often-null `requestedModel`) yields a real 3-run group (`qwen3.8-27b-mlx`) with 22 commits
reviewed by ≥2 runs, 8 disagreeing on findings-state (~36%) — the tool reproduces OAI-141's number
from existing data.

## Decisions already settled (with the owner / Codex)

- **Storage:** stateless N-ledger reader. No persistence.
- **Legacy comparability:** existing ledgers do not record `--diff-only` (OAI-141's actual confound:
  whole-file vs diff-only runs reproduce differently) and it is **not recoverable** from entries
  (`hunksOnly` is a windowing *outcome*, not the request). Owner chose: **existing all-unknown-mode
  runs compare NOW, with a loud disclosed "review-mode unverifiable" caveat**, and the envelope grows
  going forward to record the mode so new ledgers are unambiguous.
- **Granularity:** **outcome-level only** — did the commit yield a finding-bearing outcome in each
  *reviewed* run. Finding-level (same-defect) matching has no stable cross-run identity and is
  OAI-141's documented trap.
- **Report scope:** per-commit reproduction matrix + aggregate rate + per-run reviewed/finding-bearing
  totals (the 17-vs-22 spread), plus a **separate leads section** for `truncated`/`substituted`
  entries that carry findings (real signal but NON-observations for the rate).

## Load-bearing facts (verified in probe, Codex-confirmed)

- Cross-run commit identity is `entry.sha` (`%H`, review-sweep.mjs:92, spread onto every entry). **No
  40-hex validation** — `%H` is a SHA-1 assumption; join on the string as-is.
- `REVIEWED = new Set(['findings','clean'])` (`bench/lib/sweep-outcome.mjs:29`) is exactly the set of
  outcomes where the model actually reviewed the commit → the **honest reproduction denominator**.
  Every other outcome (`starved`/`failed`/`crashed`/`truncated`/`substituted`/`skipped-*`) is a
  **non-observation**, not a non-reproduction. Using this denominator automatically absorbs OAI-141's
  subtraction (a discarded/unreadable answer drops out rather than counting against reproduction).
- Numerator = `outcome === 'findings'`. Within `REVIEWED`, that is equivalent to
  `sweep-report.mjs`'s `hasFindings` (`findings.length > 0`); `hasFindings`'s extra robustness only
  matters for the leads section (truncated/substituted).
- `readLedger(path)` (`bench/lib/sweep-ledger.mjs:258`) returns `{ header, entries, gaps, discarded }`.
- `parseArgs(argv, SPEC)` (`scripts/lib/args.mjs:90`) stops at the first positional; options MUST come
  before positionals (same rule recover-sweep/compare use).
- Markdown escaping: `safeInline` / `displayReason` / `safeBlockquoteLines`
  (`bench/lib/markdown-safe.mjs`), no options, never throw.
- The `known`/`unknown` axis machinery already exists in `bench/lib/compare-model.mjs:62-84`; the
  strict top-level-axis rule (`divergencesOf`, line 340) suppresses on ANY unknown, while the per-case
  reasoning axis (OAI-227, line 407) lets unknown-vs-unknown rank through with disclosure. Our
  review-mode axis follows the **disclosed** rule, not the strict one — that is the owner's decision.

## Comparability signature (the crux)

Per run, compute a signature over these axes, each `known(value)` or `unknown(reason)`:

- **Hard axes — must be known and equal, else the runs are NOT in the same group:** `repo`,
  `include` (sorted for stability), `maxSeconds`, and **observed model** (the distinct `entry.model`
  set over that run's `REVIEWED` entries). Observed model is `unknown` — never `known(null)` — whenever
  it cannot be pinned to a single real id: **empty (run reviewed nothing), a sole absent/null/non-string
  `entry.model`, or >1 distinct value** all yield `unknown`, so a run with no model identity is
  ungroupable rather than silently joined to another `null`-model run. (`reported()` sets
  `model: report?.model ?? null` on every `REVIEWED` entry, so the read is always defined.)
  **Integrity fail-closed:** a run with **any lost record — `integrity.gaps.length > 0 ||
  integrity.discarded > 0`** (`gaps` is an ARRAY of `{sha,why}`, `discarded` a count — a bare
  `gaps > 0` on the array is always false and would ship an inert guard) — cannot prove its surviving
  entries are its complete set, since a lost record could carry a *different* model, so its observed
  model is forced to `unknown` (ungroupable), never a `known` id derived from survivors alone. (Costs nothing
  on the current corpus: all 8 on-disk ledgers have 0 gaps and 0 discarded; it guards a damaged future
  run from falsely claiming an identity it can't prove.)
- **Soft axes — `diffOnly`, `maxAttempts`, `provider`:** read from the header envelope (new field;
  `unknown` on every existing ledger). Within a comparable group:
  - all known and equal → no caveat;
  - some `unknown` (rest unknown or equal) → **compare + disclose** "axis unverifiable for run(s) X",
    **naming the specific runs** — this fires for the mixed case too (one post-envelope run that records
    the mode beside one pre-envelope run that does not), not only when every run is unknown;
  - ≥2 distinct **known** values → **suppress the group + name the axis** (a real confound made
    visible — this is the concealment case OAI-227 calls ship-blocking).

A group with <2 runs, or whose runs share no `REVIEWED` sha, is reported as "nothing to compare",
never as a spurious rank.

## Reproduction computation

For each sha reviewed (`outcome ∈ REVIEWED`) by ≥1 run in a comparable group:
- `n` = count of runs that reviewed it (denominator); `k` = count with `outcome === 'findings'`.
- `reproduced` = the reviewed runs unanimously agree (all `findings` or all `clean`).
- A **gap** sha (settled but its write was lost) is NOT a reviewed observation and is excluded from
  `n`. Because a gap forces its run's observed model to `unknown` → **ungroupable**, a gap-bearing run
  never enters a comparable group, so gap shas cannot appear in the group matrix at all. The per-commit
  distinction a gap deserves is preserved **out of the matrix, in a per-run gap section** (below) that
  names each lost sha — never collapsed into `—`.
- **`n < 2` rows are flagged** (`n=1`, no reproduction claim) — the repo's N=1 footgun made structural
  in the output.
- Aggregate over `n ≥ 2` commits: the fraction unanimous, and the finding-bearing agreement rate.
- Per-run totals: `reviewedCount` and `findingBearingCount` per run (the 17-vs-22 spread).
- Leads: `truncated`/`substituted` entries with `findings.length > 0`, listed separately as
  disclosed non-observations.

## Phases

**Phase 1 — grow the envelope (foundational).** In `bench/lib/sweep-ledger.mjs` `envelopeFor`, add
`diffOnly`, `maxAttempts`, `provider` (a safe profile label; **NOT** raw `baseUrl` — credential
persistence, and endpoints are deliberately absent from the envelope today). Wire the values from
`review-sweep.mjs` options (`options.diffOnly`, `options.maxAttempts`, `options.provider` all already
parsed). Test: `envelopeFor` records the three fields. Existing ledgers stay valid (fields simply
absent → `unknown` downstream).

**Phase 2 — `bench/lib/sweep-reproduction.mjs` (compute, pure/testable).**
`readRuns(paths)` → per-run `{ stamp, header, signatureAxes, byCommit: Map<sha, outcome>, leads,
integrity: { gaps, discarded } }` via `readLedger` (which exposes `gaps` and `discarded` — neither
may be silently dropped). **`byCommit` retains EVERY entry's outcome (not just `REVIEWED`)** — the
`REVIEWED` denominator filter lives inside `reproductionOf`, not at map-build time, so that (a) the
filter is a single mutable point the step-5 mutation can flip, and (b) a sha starved in one run yet
reviewed in another is present, not silently dropped. `signatureOf(run)` builds the known/unknown axes
(reuse compare-model's `known`/`unknown` shape; observed-model from `entry.model` per the rule above).
`groupRuns(runs)` groups by the hard axes. `reproductionOf(group)` applies the `REVIEWED` filter to
compute the per-commit rows (n = runs with `outcome ∈ REVIEWED`, k = `outcome === 'findings'`,
reproduced, `n<2` flagged), the aggregate, per-run totals, and the soft-axis caveats/suppressions.
**Refuse a non-ledger file at parse via `readLedger`'s own contract: `header === null`** — `readLedger`
returns the bare envelope (or `null`) as `header`, NOT the tagged `{kind,envelope}` record, so a
`header.kind`/`header.envelope` check would reject every valid ledger. A file with entries but a null
header (unusable/absent envelope) is refused.

**Phase 3 — `bench/lib/sweep-reproduction-report.mjs` (render).** Markdown: a comparability header
(runs, signature, caveats / suppression reasons, **and per-run integrity — `gaps`/`discarded` counts,
disclosed loudly since a damaged run's coverage and identity are lower-confidence**), the per-commit
reproduction matrix (sha × run → `F` finding-bearing / `·` clean / `—` not-reviewed — grouped runs
are gap-free by construction, so no gap cell arises here), the aggregate rate, per-run totals, a
**per-run gap section** naming each lost sha (from `gaps`, which carry `{sha, why}`) plus the
`discarded` count so a lost observation is disclosed by commit and never read as not-reviewed, and the
leads section. Every
untrusted value (subject, sha, reason, model, provider) through `safeInline`/`displayReason`. **Add
`bench/lib/sweep-reproduction-report.mjs` to `SWEEP_RENDER_FILES` AND an entry (empty Set if no
exceptions) in `SWEEP_SAFE_EXPRESSIONS`** in `tests/structure.test.js`, or the grammar test throws.

**Phase 4 — `bench/sweep-reproduction.mjs` (CLI entrypoint).** `SPEC = { valueFlags: [], booleanFlags:
[], repeatableFlags: [] }`; positionals = ledger paths (≥2, else `UserError`). Self-invocation guard,
`process.exitCode` (never `process.exit()`), prints report to stdout like `compare.mjs`. **Add to
`CLI_ENTRYPOINTS`** in `tests/structure.test.js`. Fold in the one-line fix that `compare.mjs` is
itself missing from `CLI_ENTRYPOINTS` (mention, don't file).

**Phase 5 — docs.** CLAUDE.md: one present-tense architecture-note line naming the key symbol
(`sweep-reproduction.mjs`'s reproduction-over-`REVIEWED` computation and the disclosed review-mode
axis), and a `## Commands` bullet for `node bench/sweep-reproduction.mjs <ledger>...` mirroring the
recover-sweep/compare bullets (options-before-positionals, ≥2 ledgers, what it withholds). Honour
CLAUDE.md's size posture — one line for the note.

## Tests

- `tests/sweep-reproduction.test.js`: `signatureOf` (known/unknown per axis; observed-model from
  entries; requestedModel-null does NOT split same-observed-model runs); grouping by hard axes;
  `reproductionOf` denominator = `REVIEWED` only; `n<2` flagged; unanimity; **soft-axis known-divergence
  suppresses + names**, unknown discloses + compares; leads exclude from the rate.
- **Integrity guard, with a positive control** (its own firing coverage, per the repo's "never report
  clean without a control" rule): a run carrying a `gap` line **or** `discarded > 0` is forced to
  observed-model `unknown` and is ungroupable; the control is the SAME run with zero gaps/discarded,
  which groups normally. This is what proves the fail-closed guard is not inert (an array-vs-count
  mistake would otherwise pass green on the all-clean corpus). A gap sha appears in the per-run gap
  section, never in a group matrix.
- Structure-test additions above (render file + CLI entrypoint).
- Phase 1 envelope-field test.

## Verification (step 5)

1. `npm test` green; quote the summary line.
2. **Real end-to-end run** against the on-disk 3-run group:
   `node bench/sweep-reproduction.mjs bench/results/review-sweep-2026-08-21T21-50-10-204Z.ledger.jsonl
   bench/results/review-sweep-2026-08-24T03-30-51-713Z.ledger.jsonl
   bench/results/review-sweep-2026-08-24T21-28-16-242Z.ledger.jsonl`
   — expect a comparable group, 22 commits reviewed by ≥2 runs, ~8 non-reproductions, and the
   review-mode-unverifiable caveat (all three predate the envelope field).
3. **Mutation check** on the key invariant: inside `reproductionOf`, widen the denominator filter from
   `REVIEWED`-only to "all entries" (so non-observations count as reviewed) — prove it lands with
   `mutation-landed.py`, run the suite, name the failing reproduction test, restore, re-run green. **The
   fixture must carry a non-`REVIEWED` entry (e.g. `starved`) on a sha that is `REVIEWED` in another
   run of the group**, or the mutation is inert (an n=1-flagged row becomes an n=2 non-reproduction only
   when such a sha exists) and green would prove nothing.

## Review-ladder amendments (shipped design, beyond the approved text above)

The ladder widened the observed-model / integrity axes to close concealment paths this plan's original
text did not cover. All are fail-closed (over-suppress, never conceal) and no-ops on the current corpus:

- **Observed model is computed over ANSWER-BEARING entries, not just `REVIEWED` ones.** A
  `truncated`/`substituted` reply also ran a model; a second answerer or a missing id there makes the
  run ungroupable, where the approved "over REVIEWED entries" rule would have silently dropped it.
- **Model provenance is a real axis, not an assumption.** `entry.model` is the requested id echoed back
  when the server does not name itself (`completion.mjs`), so it is trusted as an identity only where
  `modelReported === true`. `review-report.mjs` now persists `modelReported` beside `model` (mirroring
  `task-report.mjs`); `sweep-outcome.mjs`'s `reported()` carries it onto the entry. An unconfirmed reply
  (`modelReported === false`) is ungroupable — the check runs over EVERY entry, not just model-bearing
  ones, so an explicit `false` on a report-bearing `unreadable` with no model string still fails the run
  closed rather than slipping through as verified. A legacy ledger (field absent — every existing one) is
  grouped on bare `entry.model` but DISCLOSED as provenance-unverifiable — the same "grow the envelope
  forward, disclose legacy" policy this plan already chose (in *Decisions already settled*) for the soft
  axes, `diffOnly` included, which is OAI-141's actual confound and a worse unknown than provenance on
  this corpus (whose models were demonstrably server-reported). Decided during the ladder on Codex + Claude
  agreement (per `/feature`'s approval rule) resting on that owner precedent; not separately re-put to the
  owner — owed a line in the step-8 report, with the review-ladder dissent that legacy grouping should
  refuse rather than disclose, so it can be vetoed at commit review.
- **A commit recorded twice in one ledger forces integrity `unknown`.** `byCommit` is last-write-wins, so
  a duplicate sha would silently conceal a contradictory outcome; a single sweep reviews each commit
  once, so a duplicate is a corrupt run.
- **A parseable entry with no commit id forces integrity `unknown`.** `readLedger` admits an entry on
  `entry` truthiness, not shape, so a sha-less record floats unattached to any commit; the run is
  malformed rather than intact.
- **The `provider` soft axis is nulled under a `--base-url` override** (`bench/lib/sweep-ledger.mjs`
  `envelopeFor`): a profile label no longer names the endpoint once the URL is overridden, so it is
  recorded `null` rather than a stale name. `softAxis`/`unverifiable` treat a recorded `null` as a real
  value for the divergence test (a named profile vs `null` suppresses) while separately disclosing it.
  Beyond the approved Phase-1 field list; the same `provider`-as-safe-label intent, made precise.
- **The `include` hard axis is de-duped, not just sorted** (`bench/lib/sweep-reproduction.mjs`
  `signatureOf`): `--include scripts --include scripts` records `['scripts','scripts']`, and repetition
  carries no CLI meaning, so two runs that requested the same include set with different repetition are
  one group, not two singletons. `[...new Set(header.include)].sort()`, reader-side only — the ledger
  envelope stays raw. Beyond the approved Phase-2 "include (sorted for stability)" text, and a pure
  over-suppression fix (it can only MERGE groups a stale sort-only key wrongly split).
- **The CLI de-dupes before it counts** (`bench/sweep-reproduction.mjs` `reproduce`): a realpath-alias
  collapse, then a byte-identical-content collapse (`startedAt` is inside the hashed bytes), then a
  `UserError` when two distinct-content ledgers share a run identity (`startedAt`). That third case is
  AMBIGUOUS, not a proven duplicate — `startedAt` is unique only within one `--out-dir`, so a
  same-`startedAt`/different-content pair is either a diverged copy of one run or two runs that genuinely
  started in the same millisecond in different dirs, and the tool cannot tell them apart. It refuses
  loudly rather than guess, because grouping a diverged copy with its source would read as a fabricated
  perfect reproduction — the silent fake agreement the dedup exists to prevent, which OAI-227 ranks worse
  than the loud over-suppression of a rare legitimate same-millisecond pair. Beyond Phase 4's bare "≥2
  positionals" text, and load-bearing: without it a copied ledger would rank against itself as perfect
  reproduction.

- **The render module's markdown-safety guard is made non-inert** (`bench/lib/sweep-reproduction-report.mjs`).
  Phase 3 added the file to `SWEEP_RENDER_FILES` "or the grammar test throws", but as first written the
  file emitted every value by `+` concatenation with no `${…}` sink, so `interpolations()` scanned nothing
  and an unwrapped value could not fail the test (mutation-proven inert). Fixed by emitting every untrusted
  SCALAR through a `${safeInline(…)}`/`${displayReason(…)}` interpolation, matching `compare-report.mjs`'s
  genuinely-scanned pattern — a mutation that unwraps one sink now reds `tests/structure.test.js`. The
  matrix column header (a variable number of stamps via `runs.map`) and each data row still concatenate
  already-wrapped cells (no `${…}`) — the one residual, identical to `compare-report.mjs` and named in the
  file header. Output is byte-for-byte unchanged (verified against the on-disk 3-run group).

## Out of scope / residue candidates

- Persistence / SQLite (owner declined).
- Finding-level (same-defect) reproduction matching (no ground truth — OAI-141 trap).
- Recovering `diffOnly` for pre-envelope ledgers (unrecoverable — disclosed as unknown).
- Adding `maxAttempts`/`provider` to the *comparison* as hard axes (kept soft/disclosed for now).
