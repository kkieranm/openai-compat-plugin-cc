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

**A — the runtime message.** Replace the sentence; keep the hint.

**AMENDED, episode 2** (review-ladder pass 1, `codex-plain` and `codex-adversarial` independently,
confidence 0.98). Round 1's wording — "as its reply budget neared exhaustion" — replaced a false
ABSOLUTE claim with a false PROXIMITY one. `review-request.mjs:80` arms the watchdog whenever
`reserve >= 2 * TOKEN_RESERVE_TOKENS`, so at the boundary (`reserve` exactly 4,096) it fires at an
estimated 2,048 tokens — **half the budget unspent** — and the 3.0 chars/token conversion errs early
on top of that. "Neared exhaustion" is false for a reachable input, and so was the matching
`STARVED_WHY` prose ("the budget was close to gone").

The replacement states the firing predicate itself — `estimatedReasoningTokens >= maxTokens -
reserveTokens` — which is true at every arming point including the boundary, since the reserve there
simply *is* half the budget:

> `${profile.name} was still reasoning with no answer written once its reasoning was estimated to have consumed at least all but the answer reserve of the reply budget, so the stream was cut off.`

"estimated" carries the early-trigger honesty; "at least all but the answer reserve" is the predicate
rather than a proximity claim. The hint, `Attempting to conclude from the partial reasoning
instead.`, stays: `trySalvage` does follow for this reason.

**B — the report layer.** Round 1 added a test-side partition guard over an exported
`STARVED_REASONS` plus a second exported `GENERIC_STARVED_PROSE_IS_ACCURATE` whose only reader was
that test. Codex had dissented on the grounds that a new local allowlist deepens the duplication
OAI-207 exists to remove; that objection was answered (the guard *consumes* the list by import rather
than copying it, so OAI-207's consolidation changes an import path and nothing else).

**AMENDED, episode 2** (`codex-adversarial`, confidence 0.96). The guard was at the wrong altitude.
`sweep-report.mjs:187` renders `entry.reason in STARVED_WHY ? … : WHY[entry.outcome]`, so an
**unrecognised** starved reason still inherits `WHY.starved`'s "ran out of tokens … the budget was
gone" — production stays **fail-open**, and the defect this item removes is merely displaced onto
future reasons, with a test as the only thing that would notice. `in` also walks the prototype chain,
so the property the guard proved was not the property production used.

The fix moves the totality into production: one **total mapping** from every known starved reason to
its prose, selected by `Object.hasOwn`, with an **unrecognised** reason getting neutral prose rather
than a false generic sentence. A real string for `token-exhaustion` rather than a null sentinel —
`classify` sets `outcome: 'starved'` only when `STARVED_REASONS.has(reason)`, so `WHY.starved` is
unreachable for a starved row and a sentinel would resurrect a lookup rung for nothing.
`STARVED_REASONS` **stays exported**, so the totality test enumerates it from where it is defined
rather than hardcoding three strings and recreating the drift.

**C — pin the message semantically, not byte-for-byte.** The defect was a false claim, so the
assertion guards the claim: the message must not match the overclaim and must name the cutoff. A
full-string pin would make a truthful future rewording a test failure — cost with no matching defect
coverage. The assertion must sit on an error produced by the **real firing path**, per this repo's
absence-assertion discipline and the live lesson of OAI-210.

## Phase 1 — the runtime message

Files: `scripts/lib/stream-collect.mjs`, `tests/token-reserve-cutoff.test.js`.

1. Replace the message string at `stream-collect.mjs:161` with decision A's amended sentence. Nothing
   else in the block changes — not the hint, not `failure.reason`, not the attached fields, not the
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
2. `sweep-report.mjs`: make `STARVED_WHY` **total over `STARVED_REASONS`** and export it — add the
   `token-reserve-cutoff` prose from decision A, and move `WHY.starved`'s existing sentence verbatim
   onto a `token-exhaustion` key, with a comment stating why the generic claim is true there
   (`finish_reason: 'length'` means the budget really was spent). **Delete the `starved` key from
   `WHY`**: `classify` sets `outcome: 'starved'` only for a member of `STARVED_REASONS`, so it is
   unreachable for a starved row once the table is total.
3. `sweep-report.mjs`: add a module-private `UNRECOGNISED_STARVED` sentence and a
   `starvedExplanation(reason)` helper selecting with `Object.hasOwn` — **never `in`**, which walks
   the prototype chain — so an unrecognised reason gets neutral prose instead of a false generic
   sentence. The render at `:187` becomes
   `entry.outcome === 'starved' ? starvedExplanation(entry.reason) : (WHY[entry.outcome] ?? 'no explanation recorded')`.
4. `tests/sweep-report.test.js`: the per-reason prose tests stay — `reasoning-only`,
   `token-reserve-cutoff` (asserting the amended prose and neither "ran out of tokens" nor "the
   budget was gone"), and `token-exhaustion` as the control that its own generic sentence survives.
   Replace the two set-shaped tests with three against the **production lookup**, all through
   `renderSweep`:
   - **Totality**: every member of the imported `STARVED_REASONS` renders real prose — neither the
     neutral text nor `no explanation recorded`.
   - **Unknown reason** (`'some-future-reason'`): renders the neutral text and **not** "ran out of
     tokens". This is the fail-open regression control.
   - **Prototype key** (`reason: 'toString'`): renders the neutral text and does not throw.

Acceptance: `node --test tests/sweep-report.test.js tests/review-sweep-outcome.test.js` green;
deleting the `token-reserve-cutoff` key turns its prose test **and** the totality test red;
restoring `in` for `Object.hasOwn` turns the prototype-key test red; routing an unknown reason back
to `WHY.starved` turns the unknown-reason test red.

## Phase 3 — docs

`CLAUDE.md`'s existing sentence already ends "...`bench/lib/reason-notes.mjs` explains both codes to a
reader in prose." Extend that one line to name the new design symbol: `sweep-report.mjs`'s
`STARVED_WHY` is total over `STARVED_REASONS` and selected with `Object.hasOwn`, so an unrecognised
starved reason reads as unrecognised instead of inheriting a generic sentence that is false for it.
One line, present tense, no history, no tracker ID.

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
