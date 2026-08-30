ARCHIVE — not the current spec; the live plan is the file beside it.
provenance: unattended backlog run (no harness plan slug); consensus gate = Codex + verdict-signer

# OAI-9 — Multi-pass review with a deduplicated union

## Problem

A single `/oai:review` pass is a lottery: measured on one 135-line file with two known defects, five
runs produced 1 real defect, 3 false positives, 2 empty results, 1 budget failure — a 20% per-run hit
rate, output varying 1,709→5,450 tokens on identical input. Independent passes are the lever; unioning
three or four would have caught both real defects. Agreement across passes is itself a confidence
signal — the closest thing to a free verifier.

## Design decisions (resolved: advisor + Codex probe; item intent)

1. **`--passes N` flag, default 1.** Opt-in. **The N=1 path stays byte-identical to today** — the
   multi-pass code is gated on `passes > 1`, so the flagship command's cost, wall-clock, output bytes
   and every existing test are unchanged. Default 3 was rejected: tripling the flagship's default cost
   and forking bench comparability is an owner-level call, not a shippable default (advisor, strong).

2. **A pass = one full `requestFindings` + `parseFindings`** — its own salvage/retry/capability ladder
   and its own attempt ledger, exactly as the single-pass call today. Passes run **sequentially**: one
   local model, so concurrency buys nothing here (the concurrent case is cross-provider, OAI-11's).

3. **All passes share one resolved target** (window/lens/model), from the existing
   `resolveTarget` — that shared resolution is what makes the passes comparable and the union
   meaningful. **But each pass gets its OWN fresh `reviewPlan` call and its OWN ledger** (see Impl):
   the target is shared, the attempt bookkeeping is not. And a pass is structured as a unit that takes
   its target as a parameter, even though all N are identical today, so OAI-11 (per-pass
   `{provider, model, lens}`) is a config change not a rewrite (BACKLOG OAI-11 asks for exactly this).

   **Served-model agreement is required AND must be confirmed, fail-closed.** Each pass's *served*
   model is read off its own reply (`result.model`) and may differ from the requested id (LM Studio
   answers with whatever is loaded). The union is only a measurement of one model if every readable
   pass was served the same model. Two guards, both fail-closed:
   - **Confirmation:** `result.model` falls back to the *requested* id when the server did not name
     what it served, recorded by `result.modelReported === false` (`review-report.mjs:171-193`). An
     unconfirmed served model is not agreement — two passes can both echo the requested id with
     `modelReported:false` and `substitution()` sees no mismatch though nothing was confirmed. So
     **every readable pass must have `modelReported === true`**; any readable pass with
     `modelReported:false` fails the run closed with an *unconfirmed-served-model* error.
   - **Agreement:** given confirmation, if any two readable passes disagree on served model — or any is
     a substitution (`substitution(requested, served)`) — the run fails closed with a
     *served-model-disagreement* error.
   This is exactly `bench/sweep-reproduction`'s ungroupable-on-unconfirmed-model rule, and it keeps the
   merged envelope's single top-level `model` honest for `outcomeFor`'s substitution check.

4. **Merge / dedup key = `file` + exact `line`.** Deviates from the item's literal "file+line+claim":
   a local model paraphrases claims, so keying on the summary provably *undercounts* agreement (the
   signal the feature exists to produce). Instead:
   - **Retain every distinct summary** under a merged finding, so a reader can see whether two passes
     at one location actually said the same thing.
   - **Severity = highest observed** across the merged passes; severity never enters the key (passes
     disagree on it for the same defect, and keying on it would split agreement).
   - **`line === null` findings are kept UNMERGED** — each its own entry. Keying a location-less
     finding on file+summary would reintroduce the paraphrase problem for exactly the subset with no
     location to anchor on (advisor).

5. **Agreement K = number of SUCCESSFUL passes whose (per-pass-deduped) findings contain that key.**
   Counts *passes*, not raw findings, so one pass double-reporting a line cannot inflate K. Agreement
   is a **disclosed lower bound**: off-by-a-line and paraphrased duplicates don't merge, so true
   agreement is ≥ K. This is the repo's house style (findings-empty's "disclosed cost, fail-closed").

6. **Denominator = READABLE passes, where an empty `{findings:[]}` is READABLE.** `parseFindings`
   deliberately distinguishes a valid empty review (`{findings:[]}` — the model looked and found
   nothing, an observed "no-finding" *vote*) from an unreadable reply (`null`/`NO_PAYLOAD`)
   (`structured.mjs:311-319`). **A readable-but-empty pass IS an observation and stays in the
   denominator** — excluding it turns one hit plus two clean passes into a misleading `1/1`. The only
   non-observations are: a pass that **threw** (transport/budget/deadline failure) and a pass whose
   reply was **unreadable** (`parseFindings` → `null`). So: `readableCount` = passes that produced a
   findings array (possibly empty); agreement K counts readable passes containing the key; the
   denominator is `readableCount`. Non-observations are counted and named but are in no denominator
   (same spirit as `bench/sweep-reproduction`'s REVIEWED-only denominator).

7. **`--temperature 0`** makes passes 2..N near-duplicates of pass 1 (agreement vacuous). Documented,
   not guarded — the operator's choice, and the disclosure already says agreement is a lower bound.

8. **Salvage:** a salvaged pass unions in like any other successful pass; each pass carries its own
   `salvaged` flag in the envelope, and the existing salvage warning fires if **any** pass salvaged.

9. **`--max-seconds` is per-pass**, matching how a salvage follow-up already mints its own deadline
   per attempt (CLAUDE.md). Documented so the true wall-clock ceiling is legible.

## Implementation

### `scripts/lib/cmd-review.mjs`
Gate on `const passes = numeric.passes ?? 1`:
- `passes === 1` → the existing `requestFindings`→`parseFindings`→`report` block, **unchanged**.
- `passes > 1` → a loop of N iterations, **each calling `reviewPlan` afresh so it gets its own
  `ledger`** (the current flow creates one `createLedger()`+`reviewPlan` before the request at
  `cmd-review.mjs:169`; reusing them would make `attempts`/`retried` span passes and corrupt the
  per-pass metadata). Each iteration is `try/catch`, capturing
  `{ok:true, parsed, result, budget, …, salvaged, ledger}` or `{ok:false, error}`. A pass is
  **readable** when it did not throw AND `parsed !== null`; **non-observation** when it threw or
  `parsed === null`. Then one call to the new terminal render for the merged set. Progress prefixes
  the pass index (`pass 2/3`).

### `scripts/lib/review-passes.mjs` (new)
- `mergePasses(passOutcomes)` → `{ findings, passes, successfulCount }` where each merged finding is
  `{file, line, severity, summary, summaries[], agreement, evidence}` and `passes[]` is per-pass
  metadata (index, model, usage, prefillMs/generationMs, durationMs, salvaged, ok, reason). Dedup and
  agreement per decisions 4–6. Pure, unit-testable, never throws.
- The number parse for `--passes` lives beside the other `numeric` fields (positive integer, a
  sane ceiling mirroring `--max-attempts`; reject `0`/negative/non-integer with a `UserError`).

### All-failed terminal behavior (fail-closed)
When `readableCount === 0` (every pass threw or was unreadable), the run **must not** render
`findings: []` at exit 0 — that is a false clean review. It fails closed through the existing
failure-envelope contract: exit nonzero, and under `--json` the `errorReport` envelope (the same one
the single-pass catch produces), carrying the passes' reasons. A representative failure (e.g. the last
pass's error, run through `named`) drives it so the run context / attempts contract is preserved.

### Rendering (`scripts/lib/review-report.mjs` or a `review-passes-report.mjs` sibling)
- **Text:** a merged findings list annotating each finding `[K/S passes]` where **S = `readableCount`**
  (not N); a header line stating `S of N passes readable` (and any non-observations by reason), the
  lower-bound disclosure, and a per-pass one-line timing summary; the salvage warning if any pass
  salvaged.
- **`--json`:** ONE merged object (bench reads a single `JSON.parse(stdout)` at `outcome.mjs:119`, so
  the stream must stay one object). Shape:
  - top-level `findings[]` (merged, each carrying `agreement` (K), `readablePasses` (S), a canonical
    `summary` **and** `summaries[]`, `line`, `file`, `severity` (max)) — `findings` stays matchable on
    `{file, line, summary}` so bench anchor-matching is unaffected;
  - `passes[]` — per-pass records preserving each pass's identity/caveats/timing/attempts
    (`model`, `requestedModel`, `modelReported`, `reasoning`, `finishReason`, `analysisCut`, `atCap`,
    `salvaged`, `hunksOnly`, timings, `attempts`);
  - top-level `requestedModel` (shared) and `model` (the agreed served model — the run fails closed
    before here if passes disagree), so `outcomeFor`'s `substitution()` check reads a meaningful pair;
  - **aggregation rules, stated per field, fail-closed:** counts/times (`usage.*_tokens`, `durationMs`)
    are **sums** over readable passes; every *caveat* field (`salvaged`, `analysisCut`, `atCap`,
    `hunksOnly`, `skippedUnsizedWindow`) is a fail-closed **OR** — true at top level if **any** readable
    pass set it, so an incomplete/truncated/salvaged union can never read as a clean complete one;
    `contextChecked` is an **AND** (checked only if every pass was). Per-pass originals stay in
    `passes[]`.
- **Bench acceptance is empirical, not field-counting:** `outcomeFor` reads `requestedModel`/`model`
  directly then carries the whole report opaquely, so "those two fields present" does not prove bench
  can score it. The acceptance test actually **runs a `--passes 3 --json` record through the bench
  scoring path** and confirms it scores (anchor-matches a known defect), not merely that the two fields
  exist.

### Bench comparability (`bench/lib/compare-model.mjs`)
- Record `passes` on the review record and add it to `normalizeReviewRecord`'s compared `options` axis,
  so a multi-pass record is flagged incomparable against a single-pass one rather than silently
  mis-ranked (advisor; the `compare-over-measured-population` discipline).

### Command surface (`commands/review.md`)
- Document `--passes N` (default 1), the per-pass `--max-seconds`, the agreement-is-a-lower-bound
  disclosure, and the `--temperature 0` caveat.

## Out of scope (named, not done)
- Per-pass diverse `{provider, model, lens}` (OAI-11) — only structured for here.
- Concurrent passes (OAI-11's cross-provider case).
- Any change to the N=1 path or its output bytes.

## Acceptance criteria
- `--passes 1` (and no flag) produces byte-identical output to today; every existing test green.
- `--passes 3` on the fake server unions the passes, dedups on file+line, and reports per-finding
  `[K/S passes]` with S = readable passes and K counting readable passes only.
- A readable-but-empty (`{findings:[]}`) pass **stays in the denominator** as a no-finding vote; only a
  thrown or unreadable (`null`) pass is a non-observation, excluded from the denominator and named.
- `readableCount === 0` fails closed: nonzero exit and the `--json` error envelope, never `findings:[]`
  at exit 0.
- Two readable passes served different models → the run fails closed with a served-model-disagreement
  error, no union emitted. A readable pass with `modelReported:false` (requested-id fallback, server
  never confirmed) → the run fails closed with an unconfirmed-served-model error (own acceptance test).
- `line === null` findings are never merged with each other.
- Highest severity wins on a merge; distinct summaries are all retained (`summaries[]`), a canonical
  `summary` kept for bench matchability.
- A caveat (`salvaged`/`analysisCut`/`atCap`/`hunksOnly`) true on any readable pass is true at the
  merged top level (fail-closed OR).
- `--json` stays one object; a `--passes 3` record **run through the bench scoring path** scores (not
  just "fields present"); `compare-model` flags a multi-pass vs single-pass pair incomparable.
- Mutation proofs: the dedup key, the readable-only denominator (with empty-counts-as-readable), the
  null-line non-merge, the severity-max, the served-model fail-close, and the caveat-OR each have a
  test that RED-fails when the rule is inverted.

## Verify
`npm test` green; `verify` skill steps 1–2; a live `--passes 3` smoke run against LM Studio quoting
the agreement annotations (step 4) if a server is up, else marked pending.
