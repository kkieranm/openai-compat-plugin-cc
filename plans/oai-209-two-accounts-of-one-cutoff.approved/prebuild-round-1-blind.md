ARCHIVE — not the current spec; the live plan is the file beside it.
STATE: dual-approved-unattended

Owner authorisation, 2026-08-25: "start an unattended session - iterate through items on the backlog
using /feature . When you need input, try to converge on an option using codex and a fable agent. do
not prompt for user input as i wont be here - this includes prompting for plan mode."

No `provenance:` line: this plan never entered harness plan mode, because the owner waived that
prompt by name. The step-3 dual gate ran in full against the digest of these bytes.

# OAI-209 — the two user-facing accounts of a token-reserve cutoff contradict each other

## The defect

One event, `reason: 'token-reserve-cutoff'`, is explained to a reader in three places. Two of them
say the model ran out of tokens. It did not.

- `scripts/lib/stream-collect.mjs:161` mints the `UserError` with
  `` `${profile.name} spent its whole reply budget reasoning before writing an answer.` ``
- `bench/lib/sweep-report.mjs`'s `STARVED_WHY` (`:33-35`) holds exactly one key, `reasoning-only`, so
  a `starved` entry whose reason is `token-reserve-cutoff` falls through at `:174-176` to
  `WHY.starved` (`:38`): "ran out of tokens before writing findings — the model reasoned until the
  budget was gone".
- `bench/lib/reason-notes.mjs:163-173` gets it right: a client-side cutoff at "a conservative
  character threshold intended to preserve the answer reserve".

The watchdog fires at `cutoffChars = (maxTokens - reasoningReserveTokens) * REASONING_CHARS_PER_TOKEN`
(`stream-collect.mjs:131-132`), a threshold chosen to trip **before** the pool is spent, precisely so
an answer reserve survives for the salvage follow-up. The first two accounts describe the failure the
watchdog exists to prevent.

Verified against disk and independently by Codex, 2026-08-25: all five load-bearing claims TRUE.
Codex added one caveat folded into the wording below — the threshold is a per-frame **character
estimate**, so the fix must not claim exact token accounting either.

Dated instances: `bench/results/review-sweep-2026-08-24*` carry both false renderings verbatim.

Display-only. `reason: 'token-reserve-cutoff'` is the machine-read discriminator and does not change.

## Decisions taken (unattended: Codex and a fable agent, 2026-08-25)

**A — the runtime message.** Replace the sentence; keep the hint. Both advisors agreed to replace and
to keep; the fable wording is adopted because it justifies each clause against the mechanism:

> `${profile.name} was still reasoning with no answer written as its reply budget neared exhaustion, so the stream was cut off to preserve an answer reserve.`

"still reasoning with no answer written" states the two facts the watchdog actually checked
(`content.length === 0`, reasoning grew past the threshold this frame). "neared exhaustion" is true
of a threshold set below the pool and claims no exact accounting. "the stream was cut off ... to
preserve an answer reserve" names the client as the actor and matches `reason-notes.mjs`'s prose, so
the surfaces tell one story. The hint, `Attempting to conclude from the partial reasoning instead.`,
stays: `trySalvage` does follow for this reason.

**B — the report layer: add the guard now, do not defer it to OAI-207.** Codex dissented, arguing a
new local allowlist deepens the duplication OAI-207 exists to remove. That objection assumed the
guard needs its own copy of the reason list; it does not. `STARVED_REASONS` is `const` at
`sweep-outcome.mjs:183` — exporting it is one keyword, and `tests/review-sweep-outcome.test.js` and
`tests/review-sweep.test.js` already import from that module. The guard therefore **consumes** the
list rather than copying it, and when OAI-207 relocates it the guard changes by an import path, not
in substance. The mechanism it prevents has a dated instance: it is this bug — a reason joined
`STARVED_REASONS` and silently inherited prose that is false for it.

**C — pin the message semantically, not byte-for-byte.** The defect was a false claim, so the
assertion guards the claim: the message must not match the overclaim and must name the cutoff. A
full-string pin would make a truthful future rewording a test failure — cost with no matching defect
coverage. The assertion must sit on an error produced by the **real firing path**, per this repo's
absence-assertion discipline and the live lesson of OAI-210.

## Phase 1 — the runtime message

Files: `scripts/lib/stream-collect.mjs`, `tests/token-reserve-cutoff.test.js`.

1. Replace the message string at `stream-collect.mjs:161` with decision A's sentence. Nothing else in
   the block changes — not the hint, not `failure.reason`, not the attached fields, not the
   `deadline.clear()` / `dispose()` / synchronous-throw ordering.
2. In `tests/token-reserve-cutoff.test.js`, extend the existing test `a salvage attempt that itself
   fails falls back to reporting token-reserve-cutoff plainly` (`:259`) — chosen because its envelope
   is minted by the watchdog actually firing, not by a hand-built error. Add to it:
   - `assert.doesNotMatch(envelope.message, /whole reply budget|budget was gone|ran out of tokens/i)`
   - `assert.match(envelope.message, /cut off/)` and `assert.match(envelope.message, /answer reserve/)`

   `envelope.message` is `errorReport`'s copy of `error.message` (`review-report.mjs:237`).

Acceptance: `node --test tests/token-reserve-cutoff.test.js` green; reverting the message string alone
turns the two new `assert.match` calls red and the `doesNotMatch` red.

## Phase 2 — the report layer

Files: `bench/lib/sweep-report.mjs`, `bench/lib/sweep-outcome.mjs`, `tests/sweep-report.test.js`.

1. `sweep-outcome.mjs:183`: `const STARVED_REASONS` → `export const STARVED_REASONS`. No other change
   in that file. (Its umbrella comment above the set already distinguishes the three reasons
   correctly and is left alone.)
2. `sweep-report.mjs`: add a `token-reserve-cutoff` key to `STARVED_WHY`, saying what happened —
   the client cut the stream while the model was still reasoning with no answer written, to hold back
   an answer reserve, and the budget was near gone rather than proven spent.
3. `sweep-report.mjs`: beside `STARVED_WHY`, add and export
   `GENERIC_STARVED_PROSE_IS_ACCURATE = new Set(['token-exhaustion'])`, with a comment stating why
   `WHY.starved` is the right text for that one reason: `token-exhaustion` is the server's own
   `finish_reason: 'length'`, where the budget genuinely was spent. Export `STARVED_WHY` too, so the
   guard can read it.
4. `tests/sweep-report.test.js`, two tests:
   - **Prose**, mirroring the `reasoning-only` pair at `:194-204`: a `starved` /
     `token-reserve-cutoff` entry renders the new `STARVED_WHY` text and does **not** render "ran out
     of tokens" or "the budget was gone".
   - **Partition guard**: every member of the imported `STARVED_REASONS` is a key of `STARVED_WHY`
     **or** a member of `GENERIC_STARVED_PROSE_IS_ACCURATE`; and the two are disjoint. A future
     starved reason therefore cannot silently inherit prose that is wrong for it.

Acceptance: `node --test tests/sweep-report.test.js tests/review-sweep-outcome.test.js` green;
deleting the new `STARVED_WHY` key turns the prose test **and** the partition guard red.

## Phase 3 — docs

`CLAUDE.md`'s existing sentence already ends "...`bench/lib/reason-notes.mjs` explains both codes to a
reader in prose." Extend that one line to name the new design symbol: `sweep-report.mjs`'s
`STARVED_WHY` carries per-reason prose whose coverage of `STARVED_REASONS` is partitioned against a
declared `GENERIC_STARVED_PROSE_IS_ACCURATE` exception rather than left to fall through. One line,
present tense, no history, no tracker ID.

## Out of scope, filed as residue at step 9, not fixed here

- `bench/lib/sweep-outcome.mjs:168` has a typo, `kkeeps`. Unrelated to this item.
- `plans/oai-138-max-seconds-and-salvage.md:7` repeats the old framing. A superseded plan is
  read-only evidence per `plans/README.md`; it is not corrected.
- Exporting `STARVED_REASONS` gives OAI-207's consolidation a consumer it did not have. Note it on
  that item.

## What this plan does not touch

`REASONING_CHARS_PER_TOKEN`, the arming condition, `TOKEN_RESERVE_TOKENS`, `trySalvage`, the
`SALVAGE_REASONS` / `SALVAGE_SMALL_RESERVE_REASONS` sets, `failure-shape.mjs`'s `RETRYABLE`
whitelist, or anything that reads `reason` as a discriminator. No behaviour changes; the classifier's
verdicts are identical before and after.
