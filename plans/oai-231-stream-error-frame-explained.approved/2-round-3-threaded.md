ARCHIVE — not the current spec; the live plan is the file beside it.
provenance: harness slug linear-yawning-quasar
# OAI-231 — explain a `stream-error-frame` row on both report surfaces

## Context

OAI-229 (`9860a8b`) added the non-retryable reason `stream-error-frame`: LM Studio refused a
request inside an HTTP 200 stream, before any text. `bench/lib/sweep-outcome.mjs`'s `serverUnwell`
deliberately returns `false` for it, so in the overnight sweep such a commit is a `failed` row that
is **not** an outage — and, per `bench/lib/sweep-health.mjs` `replayStreak`, resets a live outage
streak. That accepted cost is explained nowhere a reader sees it. The item as filed asked for a
`REASON_PARAGRAPHS` entry in `bench/lib/reason-notes.mjs`.

**Probe (Codex confirmed all four citations):** `REASON_PARAGRAPHS` renders in exactly one place —
`bench/lib/reliability-report.mjs`'s `outcomeNotes`, gated per **failed physical attempt** by
`sawReason` over `attemptRows`'s `byReason`, and composed only into the bench per-case report
(`bench/lib/report.mjs` `renderReport`). `bench/lib/sweep-report.mjs`'s `renderSweep` imports neither
module; a `stream-error-frame` sweep row prints from `coverageSection` as
`` **failed**: the review failed (`stream-error-frame`) `` — `WHY.failed` + `reasonSuffix` — and there
is no reason-keyed prose for `failed` rows analogous to `STARVED_WHY`. The outage streak is a
sweep-only concept; the bench report has none. So the fix as filed could not reach the sweep reader
the item names, and its streak clause would print in a report with no streak.

**Decisions already made with the owner (AskUserQuestion, 2026-09-02, Codex consulted first and
steering the same way):** scope is **both surfaces** — a bench-report paragraph WITHOUT the streak
clause, plus a reason-keyed explanation for `failed` sweep rows carrying the non-outage / streak-reset
clause where the streak exists. Codex's named guard: keep the sweep-only streak clause out of the
attempt-level paragraph. Codex's placement steer: emit the sweep prose as the `explanation` half of
the existing `${explanation}${reasonSuffix(entry.reason)}` composition, so explanation selection and
code rendering share `reasonPresent`'s judgement and the code is still appended after the sentence.

## Files

- `bench/lib/sweep-report.mjs` — new exported `FAILED_WHY` table, new `failedExplanation`, and
  `coverageSection` routing `failed` rows through it.
- `bench/lib/reason-notes.mjs` — new `REASON_PARAGRAPHS` entry `stream-error-frame`.
- `tests/sweep-report.test.js` — sweep-surface tests (below).
- `tests/bench-reason-notes.test.js` — bench-surface test (below).
- `tests/structure.test.js` — comment on the `'explanation'` allowlist entry only (the allowlist key is
  unchanged; its comment names the two sources of fixed prose and gains the third).
- `CLAUDE.md` — one line in the existing sweep-outcome/reason-notes paragraph (docs step).

No change to `sweep-outcome.mjs`, `sweep-health.mjs`, `failure-shape.mjs`, or any classifier.

## Phase 1 — sweep surface (`bench/lib/sweep-report.mjs`)

Add, beside `STARVED_WHY`:

```js
/**
 * Why a FAILED commit produced no review, in the reader's terms, keyed on the
 * reason — only for the reasons whose bare code a reader would misread.
 * Deliberately PARTIAL, unlike `STARVED_WHY`: a failed row whose reason has no
 * entry here keeps `WHY.failed`, so an unlisted or foreign-build reason reads
 * as a generic failure with its code appended, never as an unrecognised one.
 */
export const FAILED_WHY = {
  'stream-error-frame': 'the server refused the request inside an HTTP 200 stream before any content or reasoning text arrived — on LM Studio, typically a context overflow or a rejected sampling value; it was not re-sent, since a resend meets the same refusal; it is not counted as a server outage, so like any non-outage row it resets a live outage streak, and the next commit may still fare better',
};
```

Add `failedExplanation(reason)`: `Object.hasOwn(FAILED_WHY, reason)` guarded by `reasonPresent(reason)`
(so a non-string / blank reason never indexes the table and `toString`/`constructor` never reach
`Object.prototype`), returning the entry only when it is a non-blank string, else `WHY.failed`. Same
own-property discipline as `starvedExplanation`; the fallback is the existing generic sentence, not an
"unrecognised" sentence, because for `failed` the generic sentence is true.

In `coverageSection`, the `explanation` assignment becomes a three-way dispatch: `starved` →
`starvedExplanation`, `failed` → `failedExplanation`, else the existing `Object.hasOwn(WHY, …)` lookup.
Keep the variable named `explanation` and the composition `${explanation}${reasonSuffix(entry.reason)}`
unchanged, so `tests/structure.test.js`'s `SWEEP_SAFE_EXPRESSIONS` allowlist (`explanation`, `why`)
still describes fixed prose — every value `failedExplanation` can return is a literal from this file.
The rendered row is then
`` **failed**: the server refused … may still fare better (`stream-error-frame`) ``.

**Shape after the post-build simplify pass (episode 2 amendment, 2026-09-02; behaviour identical to
the above, tests unchanged):** the "own-property lookup then non-blank-string check" tail shared by
`starvedExplanation` and `failedExplanation` is one private helper, `ownProse(table, reason)`,
returning the entry or `undefined`; `starvedExplanation` is `ownProse(STARVED_WHY, reason) ??
UNRECOGNISED_STARVED` after its existing two not-a-usable-code arms, and `failedExplanation` is
`(reasonPresent(reason) ? ownProse(FAILED_WHY, reason) : undefined) ?? WHY.failed`. The three-way
outcome dispatch lives in one private `explanationFor(entry)` (sequential `if`/`return`: `starved`
→ `starvedExplanation`, `failed` → `failedExplanation`, else the existing `Object.hasOwn(WHY, …)`
lookup with its `'no explanation recorded'` fallback), and `coverageSection` reads `const explanation
= explanationFor(entry);` — the variable name and the `${explanation}${reasonSuffix(entry.reason)}`
composition are unchanged, so the `SWEEP_SAFE_EXPRESSIONS` allowlist still describes fixed prose, and
its `'explanation'` comment names `explanationFor`. The `WHY` doc comment keeps only its existing
`starved` paragraph (the `failed` sentence proposed above duplicated `failedExplanation`'s own
docstring and was dropped); `starvedExplanation`'s docstring, whose `hasOwn`/value-shape paragraph now
describes `ownProse`, is reduced to its own three-arm/fallback behaviour.

## Phase 2 — bench surface (`bench/lib/reason-notes.mjs`)

Append to `REASON_PARAGRAPHS` (a plain string entry, like `transport`), placed after
`non-retryable-transport`/`transport` and before `token-reserve-cutoff`, since the paragraph contrasts
itself with the transport reasons:

```
`stream-error-frame` below is a request the server **refused inside an HTTP 200 stream**, before any
content or reasoning text arrived — on LM Studio, typically a context overflow or a sampling value it
rejected. An HTTP response was obtained and the server answered inside it, so it is neither a
transport failure nor a dropped request, and it is **not retried**: a resend meets the same refusal,
which is why it sits outside the retryable set. The row counts as a failed attempt and says nothing
about server health.
```

No streak clause, no mention of outages-as-counted — the bench report has no streak (Codex's guard).
The entry's prose names its own code in backticks (the pairing test) and starts with the
`` `code` below `` opener (the `paragraphAbout` convention).

## Phase 3 — tests

`tests/sweep-report.test.js` (uses the file's existing `render`/`commit` helpers; import `FAILED_WHY`
beside `STARVED_WHY`, and `isOutage` from `../bench/lib/sweep-outcome.mjs`):

1. **`a failed stream-error-frame commit is explained as an in-stream refusal, not a generic failure`**
   — render `{ outcome: 'failed', reason: 'stream-error-frame' }`; assert the output includes the
   `FAILED_WHY['stream-error-frame']` string verbatim, includes `` (`stream-error-frame`) `` (the code is
   still appended), matches `/resets a live outage streak/`, and does NOT match `/the review failed/`.
2. **`every FAILED_WHY entry is non-blank prose for a failed-not-starved reason, and renders itself`** —
   first `assert.ok(Object.hasOwn(FAILED_WHY, 'stream-error-frame'), 'the entry this table was written
   for is missing — the loop below would assert nothing')` (the same non-vacuity guard
   `tests/sweep-report.test.js`'s `every starved reason renders prose of its own` puts on
   `STARVED_REASONS.size`); then for each key: string, non-blank, not in `STARVED_REASONS` (a starved
   reason never reaches this table, so an entry for one would be dead prose), and
   `render(commit({ outcome: 'failed', reason }))` includes it.
3. **`a FAILED_WHY entry that claims the row resets the outage streak is one isOutage rejects`** — for
   each key whose prose matches `/outage streak/`, `assert.equal(isOutage({ outcome: 'failed', reason }), false)`;
   count the keys checked and `assert.ok(checked > 0, 'no entry claims a streak reset — the pairing
   below was checked against nothing')`, so a rewording that drops the phrase, or an emptied table,
   turns this red rather than vacuous. This is the one mechanisable pairing between the prose and the
   behaviour it describes; it fails if a future entry copies the sentence onto a reason that IS an
   outage.
4. **`an unlisted failed reason keeps the generic sentence and its code`** — `reason: 'some-future-reason'`
   → matches `/the review failed \(`some-future-reason`\)/`; and `reason: 'constructor'` / `'toString'`
   → matches `/the review failed/`, does not match `/function|native code/`.
5. The existing `a non-starved row keeps a malformed reason instead of dropping it` test stays as the
   non-string-reason control (it already asserts `the review failed` + the recorded value).

`tests/bench-reason-notes.test.js`:

6. **`stream-error-frame is explained as a refusal inside a 200 stream, never a transport failure or a
   drop`** — `paragraphAbout(renderWith('stream-error-frame'), 'stream-error-frame')`; assert
   `/refused inside an HTTP 200 stream/`, `/before any content or reasoning text/`, `/\*\*not retried\*\*/`,
   `/neither a transport failure nor a dropped request/`; and `assert.doesNotMatch(para, /streak|outage/)`
   — the sweep-only clause must not leak into the attempt-level paragraph (Codex's guard, pinned).
   The file's existing derived tests (every code takes a turn as sole-observed; every entry names its
   own code; all codes at once) cover the new entry automatically.

`tests/structure.test.js`: comment-only change on the `'explanation'` allowlist line.

## Phase 4 — docs (`CLAUDE.md`)

One present-tense line appended to the existing paragraph that ends "…because `unrecorded` carries a
filesystem error message rather than a code." — naming `FAILED_WHY` as the reason-keyed prose a
`failed` sweep row consults before `WHY.failed` (partial by design), with `REASON_PARAGRAPHS` carrying
the attempt-level twin for the bench report without the sweep-only streak clause.

## Verification

- `npm test` green (quote the summary line).
- Mutation check on the key invariant, at the real path: delete the `'stream-error-frame'` key from
  `FAILED_WHY` → test 1 red (verbatim prose absent, `the review failed` present), test 2 red at its
  `hasOwn` guard, test 3 red at its `checked > 0` guard — three named reds, none vacuous; restore,
  diff against the backup. Second mutation: change
  `coverageSection`'s dispatch so `failed` rows skip `failedExplanation` → test 1 red. Third: add the
  words "outage streak" to the `REASON_PARAGRAPHS` entry → test 6 red (the leak guard fires).
- Real render: `node -e` importing `renderSweep` with one `failed`/`stream-error-frame` entry, quote the
  coverage line; and `renderReport` with one dead run carrying a `stream-error-frame` attempt, quote the
  paragraph.
- Repo `verify` skill (plugin load + delegation round trip) as the commit gate requires.

## Residue (to file at the close-out step, not now)

- The item's own framing was wrong about where `REASON_PARAGRAPHS` renders — recorded in the
  BACKLOG_DONE entry, no new item.
- `sweep-health.mjs`'s reset line still does not name WHICH reasons reset the streak; with `FAILED_WHY`
  naming it on the row, no dated instance of a reader misled remains — noted, not filed.
