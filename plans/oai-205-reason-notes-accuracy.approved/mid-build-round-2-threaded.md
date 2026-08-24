ARCHIVE — not the current spec; the plan beside it is
provenance: none — harness plan mode skipped for this unattended run by the owner's ratified
charter (AskUserQuestion, 2026-08-24, before departure): no plan-mode prompts; approval is the
dual gate (Codex `--approved`/`--dual-approved` + independent fable verdict subagent), which the
/feature skill itself sanctions as one of the two closing signatures.

# OAI-205 — reasonNotes: fix the false token-reserve-cutoff clause; explain the three attempt-level codes

## Premise (probe-confirmed, Codex claim-check 2026-08-24)

`bench/lib/reason-notes.mjs`'s paragraphs gate on **attempt-level** reason codes: `sawReason`
(`bench/lib/reliability-report.mjs:44`) reads `stats.byReason`, tallied at
`bench/lib/attempt-rows.mjs:127` from failed attempts' own `reason`. Two gaps:

1. The `token-reserve-cutoff` paragraph asserts the salvage follow-up "already ran and failed; a
   row carrying this reason here is one neither attempt could recover" — **false whenever a later
   salvage answered**: the trimmed-fallback test pins `salvaged: true` beside a failed
   `token-reserve-cutoff` attempt row (`tests/salvage.test.js:791,805-806`). The probe also
   sharpened the item's second falsity route: the reachable no-follow-up case is not the
   reasoning/content eligibility gate (not demonstrated reachable for this reason) but
   `attemptSalvage`'s own context-budget check — a grown follow-up the window cannot fit returns
   `null` before any request is sent (`scripts/lib/review-request.mjs:463-498`).
2. Three attempt-level codes now appear in the failures-by-reason table with no explanatory
   paragraph: `reasoning-only` (an original request's clean reasoning-only stream, reclassified by
   `markUnanswered`), `token-exhaustion` and `empty-answer` (losing salvage follow-ups, via
   `salvageEmptyFailure`). Attempt-level `token-exhaustion` rows come **only** from salvage
   follow-ups — the run-level code of the same name (`review-unparsed.mjs`) is post-hoc and leaves
   its attempt row `answered` (probe claim 4, TRUE).

The paragraph prose also carries two tracker IDs — `(OAI-115)` and `since OAI-204` — in
user-facing report text, which the owner's standing comment rule bans from UI/diagnostic strings;
they are swept in the same edit.

## Design (`bench/lib/reason-notes.mjs` only, plus its test)

0. **Unnumber the file's two "three REASON codes" header comments** ("The REASON codes a reader
   could misread") — the count is already four and becomes seven; `reliability-report.mjs`'s own
   "Unnumbered deliberately" note is the repo's remedy for exactly this drift (round-1 Codex).

1. **Reword the `token-reserve-cutoff` paragraph.** Keep the two test-pinned claims verbatim —
   "**client-side** cutoff, not a server symptom" and "never retried" — and drop the tracker IDs.
   Replace the false closing clause with the accurate account:

   > `token-reserve-cutoff` below is a **client-side** cutoff, not a server symptom: the model was
   > actively generating reasoning and spending the request's own `max_tokens` pool on it, so the
   > watchdog disposed the stream at a conservative character threshold intended to preserve the
   > answer reserve, with no answer yet written. It is unrelated to `*-timeout` reasons and the cut attempt is never
   > retried as-is — instead a follow-up "conclude from what you have" salvage attempt
   > (`trySalvage`, up to two tries: trimmed, then untrimmed) is attempted afterwards, and each
   > follow-up actually sent appears as its own row. A row carrying this reason says this attempt
   > was cut off, nothing more: the run it belongs to may have been answered by a follow-up, the
   > follow-up may itself have failed, or none may have been sent at all — a follow-up grown past
   > the context window is refused before the wire.

   (Both round-1 verdicts, independently: the prior draft's "leaving no room to write an answer"
   misstated the watchdog — the answer reserve is exactly what it protects — and "runs afterwards
   and appears as its own row" was categorical against the refused-before-the-wire case its own
   closing sentence admits. Round-3 Codex: "before reasoning consumed the protected answer
   reserve" claimed exact token accounting where the cutoff is a deliberately conservative
   character estimate that can overshoot within a frame — hence the threshold wording.)

2. **Add three gated paragraphs**, one per code, in the file's existing shape (`sawReason(code)`,
   the paragraph names its own code, no population claims, no cross-references to prose that may
   not print):
   - `reasoning-only`: a reply that finished cleanly with no non-whitespace answer content but
     non-whitespace reasoning — client-classified after a successful request (streamed or not;
     round-2 Codex: "clean stream" was too narrow, non-streamed completions reach the same
     predicate; round-3 Codex: "without writing the answer channel" was too strong, the predicate
     trims), never a transport failure or server drop. The row can be an original request
     (whose run a salvage follow-up may then have rescued) or a losing salvage follow-up.
   - `token-exhaustion`: an attempt that hit its token limit with no non-whitespace answer
     content (round-3 Codex: "answer channel still empty" was too strong, the gate trims).
     As a row in this table it is a **salvage follow-up** that spent its whole budget without
     concluding; a run-level failure of the same name is an **answered** attempt's own exhaustion,
     classified after the fact once its reply proved unusable — that attempt's row stays
     `answered` because the transport interaction succeeded. (Round-1 fable verdict: attributing
     the run-level code to "the original request" was false in a reachable case — a salvage
     follow-up accepted on partial truncated content can itself be the answered attempt the
     run-level exhaustion describes — so the paragraph attributes it to the answered attempt,
     true on every route; the test pin targets the stays-answered split, never the
     original-request attribution.)
   - `empty-answer`: a salvage follow-up whose reply contained no non-whitespace answer content —
     a positively identified empty answer, never an unclassified failure and never a server drop.
     (Round-2 Codex: "answer channel arrived holding only whitespace" overclaimed — the gate is
     `!content.trim()`, and the content channel can be zero-length outright when whitespace or
     content rode only the reasoning channel past the upstream blank-completion check.)

3. **Tests (`tests/bench-reason-notes.test.js`)**: amend the `token-reserve-cutoff` test — keep
   its two pinned phrases, add `doesNotMatch` for the withdrawn "neither attempt could recover"
   claim, a `match` for the new "may have been answered by a follow-up" hedge, and a `match` on
   the conditional "actually sent appears as its own row" wording plus the protected-reserve
   clause (round-1 Codex: the planned test would not have caught either overclaim); add one test
   per new paragraph (via the existing `renderWith`/`paragraphAbout` helpers) pinning each code's
   key claim (`reasoning-only`: never a transport failure/server drop; `token-exhaustion`: the
   salvage-follow-up-vs-run-level split; `empty-answer`: positively identified, not unclassified);
   and extend the results-not-glossary gating test's pattern so a sweep without these codes prints
   none of them (the existing `renderWith('transport')` test already proves the shape — add the
   three codes to its `doesNotMatch` set).

4. **Structure (mid-build amendment, /simplify convergence — three of four reviewers
   independently):** the seven `if (sawReason(code)) lines.push(prose, '')` copies fold into one
   exported `REASON_PARAGRAPHS` table — `[code, prose]` pairs, hand-authored prose unchanged
   byte-for-byte, the `non-retryable-transport` entry a thunk so `recordList()` still renders at
   call time — with `reasonNotes` reduced to one loop. Exported solely so the test can read it,
   the same deliberate coupling `RECORD_FIELDS` documents. The glossary gating test derives its
   `doesNotMatch` set from the export (every code except the one rendered) instead of
   hand-enumerating six literals, so an eighth code is auto-covered — the mirror-drift class the
   module's own comments name as the reason `RECORD_FIELDS` exists. The per-block gating invariant
   ("every paragraph is gated on the code it is ABOUT") becomes true by construction. Also: the
   new `doesNotMatch(para, /original request's own exhaustion/)` gets a one-line comment naming
   the reachable case it guards (a salvage follow-up accepted on partial content can be the
   answered attempt the run-level exhaustion describes), matching the file's every-negative-has-
   its-withdrawn-draft convention.

## Not in scope

- `RECORD_FIELDS` and both ledger-shape tests — the record schema is unchanged.
- `reasonNotes` coverage for run-level-only codes (`deadline-timeout`, `idle-timeout`, …) — the
  section documents the failed-attempt table, which never carries them.
- OAI-207's `STARVED_REASONS` drift concern — separate live item, untouched.

## Files

- `bench/lib/reason-notes.mjs`
- `tests/bench-reason-notes.test.js`

## Acceptance criteria

1. A sweep containing a failed `token-reserve-cutoff` attempt renders the reworded paragraph:
   both pinned phrases present, the "neither attempt could recover" claim gone, the three-way
   outcome hedge present.
2. Sweeps containing failed `reasoning-only` / `token-exhaustion` / `empty-answer` attempts each
   render that code's paragraph; a sweep without a code renders no paragraph for it.
3. Each paragraph states only what the code means and what the record holds — no population
   claims, no forward references, tracker IDs gone from the rendered prose.
4. Full `npm test` green.

## Verification

- Full `npm test` at the gate.
- Mutation check (the key invariant — each paragraph is gated on its own code): change one entry's
  code key in the `REASON_PARAGRAPHS` table (`'empty-answer'` → `'empty-answr'`) via
  mutation-landed.py; the new empty-answer test must fail; restore, prove the restore against the
  backup. (Mid-build episode 2, Codex: the pre-table form targeted a `sawReason('empty-answer')`
  call that no longer exists once the loop lands.)
