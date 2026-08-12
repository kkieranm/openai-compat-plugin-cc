ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug expressive-coalescing-quokka

# OAI-139 — a cold start must not ship unchecked whole files, and must say when it didn't

## Context

When the plugin cannot determine a provider's context window, `context-guard.mjs:46` returns
`{ checked: false }` without checking, so the oversize refusal never throws. That refusal is the only
thing that makes a caller drop `target.changed` and fall to the hunks rung (`review-ladder.mjs:47`,
`error.reason !== 'oversize'`). **No refusal, no retry, no dropping** — whole changed-file bodies are
attached to a request nothing can size.

Observed: commit `77c1eab97` on a cold process built a **492,053-character prompt (~145k tokens)
against a 61,696 window** and died in 14s as `empty-completion`. The same commit mid-sweep, with a
model already resident, built **150,056 characters** — 3.3× smaller. Same commit, same code, same
machine; only residency differed, because `contextLength` comes from `loaded_context_length`, which is
null when nothing is resident.

**The probe found the fix is much smaller than the design agreed on 2026-08-10.** `prepareLadder`
**already receives `windowKnown`** (`review-request.mjs:202`, `Boolean(contextLength)` — the same
value the guard tests). It applies it to the *prompt's* completeness claim
(`wholeFiles: whole && hasDiff && windowKnown && …`) but **not** to which files are attached
(`files: whole ? [...target.files, ...target.changed] : target.files`). The defect is an
inconsistency between two uses of one flag. **No new size constant is needed**, and Codex withdrew its
own named-ceiling design as "redundant scaffolding for this defect" — a ceiling addresses a *different*
case (a known, genuinely large window where enrichment fits but is huge), which is a cost/latency
policy and is explicitly **not** in scope here.

**One claim from the tracker is corrected by this plan**: the request is not necessarily sent
*oversized*, it is sent **without knowing whether it is**. A small diff plus small files may fit.

## Decisions already made

- **Skip the whole-file rung when the window cannot be checked, AND disclose the degradation**
  (user, 2026-08-12; Codex and I both recommended it). Silent degradation is rejected because
  `adr/005` already places incompleteness notices in the rendered artifact and names
  "silent absence of whole files followed by a normal-looking review" as the defect class it exists
  to prevent. A quiet diff-only result violates a local correctness invariant, not merely quality.
- **No named enrichment ceiling.** Rejected as redundant for this defect and as inventing a size
  number with no evidence behind it.
- **Do not touch model discovery, and add no LM-Studio-specific fallback** — either crosses into
  vendor-assumption territory and triggers the wide review fan-out.
- **Accepted cost, stated rather than mitigated**: an unknown window is *not* evidence of a small
  window, so this can downgrade a review that would have fitted. Affected: generic OpenAI-compatible
  `/models` responses, Ollama's listing, and **any failed probe**. Not affected: LM Studio (resident),
  llama.cpp, vLLM, TGI, oMLX, OpenRouter. The remedy is the existing per-provider `contextLength`.

## Change

**Phase 1 — `scripts/lib/review-ladder.mjs`.** One condition.

- `if (target.changed.length > 0)` becomes `if (windowKnown && target.changed.length > 0)`.
- Both rungs keep setting `hunksOnly` exactly as now. **Nothing new is carried out of the ladder** —
  see phase 2.
- Known-window oversize still falls back as today, yielding `hunksOnly: true` with the cause-specific
  fact false, which is correct: that review was sized and shed, not left unchecked.

**Phase 2 — DERIVE the fact where it is rendered; do not thread a field.** Amended after the plan
gate: a stored flag duplicates a fact already present at report time, and the derivation
`!budget.checked && target.changed.length > 0` has every required negative behaviour on its own — a
known window, `--diff-only` (empty `changed`), and an empty changed list each make it false. This
drops `review-request.mjs` and the ladder result from the change entirely.

- `budget` is already destructured in `jsonReport` (`review-report.mjs:184`). `reportFindings`
  (`:69`) does not receive it, so it gains that one parameter from `cmd-review.mjs`, which already
  holds `budget` (`cmd-review.mjs:145`).
- **The note must reach BOTH output paths.** `caveats()` runs only from `renderFindings()`, while
  `reportFindings` has a **separate unparsed branch** carrying only `unreadableNote()` — so a run that
  skipped bodies and returned malformed prose would not say so. Follow `unreadableNote()`'s existing
  shape: a **shared helper** both branches call. This was the gate's sharpest finding and it is the
  difference between the fix working and looking like it works.
- **The note must NAME NO MODEL.** `renderFindings` receives `result.model || model` — the model that
  *answered* — and its own comment at `:73-78` says that is deliberate, because naming the requested
  id in one place and the served id in another "would produce a single report naming two different
  models". The unknown window was established for the **requested** model, so the two can differ under
  substitution. The note names the **provider and the config key** and nothing else.
- **A separate note, not a rewording of the `hunksOnly` one.** That note is deliberately "worded for
  the state, not the cause"; this one names cause and remedy, so the existing one keeps its property.
- **The wording must say DIFF-COVERED changed files, not "changed files".** Amended after gate round
  2, and it is a correctness fix, not style: only `target.changed` is skipped, while `target.files` —
  untracked files and `--file` targets — **is still sent whole**. On a mixed target, "changed files
  were not sent whole" is simply **false**, and it would collide with the two-list distinction
  `adr/005` is built on. Shape: *the context window for this provider could not be determined, so the
  diff-covered changed files were not sent whole; files pinned by `--file` or untracked are
  unaffected. Set `contextLength` for `<provider>` to enable it.*
- Must not print a base URL, credentials, headers, or a server payload (`adr/019`'s discipline).
- **The `--json` field is named `skippedUnsizedWindow`**, a boolean, and this is its contract: **true
  iff the ladder held diff-covered changed files AND the provider's window could not be sized, so the
  whole-file rung was not attempted.** It is **false** when the window was known (including the
  known-window oversize fallback, which shed deliberately), when `--diff-only` was passed, and when
  there were no diff-covered changed files to send. Naming it explicitly rather than "beside
  `hunksOnly`" because it is a public envelope field and a position is not a contract. Add it to
  `tests/review-json.test.js`'s key list at `:54`, or the two views drift — the drift that test exists
  to catch.

**Phase 3 — tests.**

- **Primary witness is the fake server's own request log, not the report text** — assert the changed
  bodies are ABSENT from what was actually sent (`absence-assertions-need-the-firing-path`).
- **Assert absence using content that appears ONLY in the whole file, never in the diff.** Amended
  after the gate: changed lines are present inside the diff by construction, so asserting on generic
  file text yields a false failure. Use a file-block marker or a unique unchanged line.
- Positive case: `contextLength` absent, non-empty diff → `hunksOnly: true`, `skippedUnsizedWindow` true,
  remedy text present, bodies absent from the request.
- **Negative controls, each its own test, and each asserting the REMEDY TEXT IS ABSENT as well as the
  `skippedUnsizedWindow` being false.** Amended after the gate: asserting only "field is false" leaves mutation 2
  invisible, because a render condition mutated to fire unconditionally keeps the field false and the
  assertion still passes. Controls: known window sends whole files; `--diff-only`; empty `changed`.
- One test mirrors `review-json.test.js:185` — JSON and text asserted to agree about the same run.
- One test covers the **unparsed** path, or the gate's first finding has no guard.

**Explicitly NOT changed**: `context-guard.mjs` (its unknown-window return is correct — it reports it
cannot check, and that is now acted on), model discovery, `git-diff.mjs`'s `collectTarget`, and the
`--structured-output` path beyond carrying the field.

## Verification

1. `npm test` — expect green. Existing tests use fixtures with `contextLength` set, so they should be
   unaffected; **if something goes red, that is a finding, not a rebase.**
2. Run the repo `verify` skill. Steps 3–4 need a live server: **LM Studio with nothing resident is
   exactly the reproduction case** — `lms unload --all`, then a review that previously shipped
   untrimmed input should now report hunks-only with the remedy line. Quote the observed output.
3. **The reproduction is the real check.** Re-run commit `77c1eab97` alone on a cold process, as on
   2026-08-10 when it built 492,053 prompt chars and died in 14s. It must now build a prompt in the
   ~150k-char range and complete, or report honestly why not.
4. **Mutation**, two of them, because the change has two halves that fail differently:
   - Revert the `windowKnown &&` guard → the unchecked whole-file request is sent again, and the
     request-log assertion catches it.
   - Mutate the notice's condition to fire unconditionally → **a negative control must go red**, which
     is only true because those controls now assert the remedy text is absent. Before the gate raised
     this, the controls asserted only that the field was false, and this mutation would have passed
     unnoticed — a check that could not fail, in the fix for a defect about checks that could not fire.
   Prove each mutation landed with `mutation-landed.py` **before** running the suite, name the test
   that failed, and prove the restore by `diff` against the backup.

## Entry tier for review

Expected **light** under `adr/026` is **NOT** claimed: this adds an executable branch and a new
user-visible message across four modules, so it is a **full** entry. The wide-mode trigger should be
evaluated honestly at the ladder — the change is generic review policy and touches no vendor dialect,
which is the argument that it does not fire, but that is the ladder's call and not a claim to make here.

## ADR

Amend **`adr/005`**, which already owns "whole files if they fit, the diff alone if they do not" and
the incompleteness-notice rule. The decision to record is that **the ladder's first rung now requires
a checkable window, not merely a non-empty changed list** — and why the honest failure is a narrower
review that says so, rather than a request nobody can size. No new ADR.
