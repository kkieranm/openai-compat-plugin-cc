ARCHIVE — not the current spec; the plan beside it is
provenance: none — harness plan mode skipped for this unattended run by the owner's ratified
charter (AskUserQuestion, 2026-08-24, before departure): no plan-mode prompts; approval is the
dual gate (Codex `--approved`/`--dual-approved` + independent fable verdict subagent), which the
/feature skill itself sanctions as one of the two closing signatures.

# OAI-206 — attemptSalvage labels every empty follow-up `reasoning-only`; label by shape instead

## Premise (probe-confirmed, Codex claim-check all-TRUE 2026-08-24)

`attemptSalvage`'s empty-content branch (`scripts/lib/review-request.mjs:465-473`) calls
`result.markUnanswered(reasoningOnlyFailure(profile, result))` for ANY empty-content follow-up —
no `finishReason` check, no check that `reasoning` is non-empty — and `reasoningOnlyFailure`
unconditionally mints `reason: 'reasoning-only'`. `client.mjs` itself distinguishes three empty
shapes: `finishReason === 'length'` (token exhaustion, `requireAnswer` line 127), reasoning-only
(`isReasoningOnly` line 98 — requires `finishReason !== 'length'` AND non-empty reasoning), and
a bare empty answer (clean finish, both channels blank). `attempt-outcome.mjs`'s `markUnanswered`
(line 277) persists `error.reason` into the ledger entry, so the wrong label reaches a persisted
attempt record. Blast radius checked: `bench/lib/sweep-outcome.mjs` never reads attempt-level
reasons when classifying, and both `token-exhaustion` and `reasoning-only` sit in
`STARVED_REASONS`, so no sweep classification can move — this is a record-accuracy fix only.

## Design

One shape-dispatching helper in `scripts/lib/review-request.mjs`, used only by `attemptSalvage`'s
empty-content branch (the `unconstrained()` call site at line 292 already dispatches correctly —
it sits behind an `isReasoningOnly` guard):

```js
function salvageEmptyFailure(profile, result) {
  if (result.finishReason === 'length') {
    const failure = new UserError(
      `${profile.name} ran out of tokens before the salvage follow-up produced an answer.`,
      { reason: 'token-exhaustion' },
    );
    failure.answer = { reasoning: result.reasoning, content: result.content };
    return failure;
  }
  if (isReasoningOnly(result)) return reasoningOnlyFailure(profile, result);
  const failure = new UserError(`${profile.name} returned an empty answer to the salvage follow-up.`);
  failure.finishReason = result.finishReason ?? 'unknown';
  failure.answer = { reasoning: result.reasoning, content: result.content };
  return failure;
}
```

- `'token-exhaustion'` reuses the exact reason string `scripts/lib/review-unparsed.mjs:45` already
  mints for the same wire shape — no new vocabulary.
- The true reasoning-only shape keeps the existing `reasoningOnlyFailure` object unchanged.
- The bare-empty shape carries NO `reason` — `markUnanswered`'s existing `error?.reason ?? null`
  stores `null`, the same value a generic failure already gets — and carries the server's
  unvalidated `finish_reason` on `error.finishReason`, never in `.message`, per the OAI-185
  discipline (`client.mjs`'s `requireAnswer` third arm is the model). A null attempt reason
  renders as `unclassified` in `bench/lib/attempt-rows.mjs:127` (plan-gate round 1, Codex), so no
  reader breaks. **Reachability, verified against disk after round 1's dual dissent
  (`scripts/lib/completion.mjs:161-168`)**: a literally 0-char both-channels reply never reaches
  this branch — `refuseUnusable` throws `blank-completion` inside `chatCompletion` first — but its
  check is `.length === 0`, never `.trim()` (its own comment: whitespace has answered), so a
  WHITESPACE-only reply passes it, trims empty at `attemptSalvage`'s gate, and lands in this arm.
  Round 1's two dissents diverged here — Codex proposed dropping the arm as two-shapes-suffice,
  the fable verdict kept it for exactly this whitespace path — and the direct read settles it for
  three arms: a whitespace-only clean-finish reply has no reasoning, so labelling it
  `reasoning-only` would recreate the defect class under fix.
- `attemptSalvage:472` becomes `result.markUnanswered(salvageEmptyFailure(profile, result));`.
  The gate itself (`!result.content.trim()` → return `null`) is unchanged: what counts as a failed
  salvage does not move, only what the record says about it.
- The `attemptSalvage` docstring's "`content`, not `isReasoningOnly`" paragraph (lines 409-412)
  stays — it justifies the GATE, which is unchanged — and gains one sentence saying the failure
  label follows the reply's shape (`length` → token-exhaustion; clean-finish-with-reasoning →
  reasoning-only; otherwise unlabelled — a truly 0-char reply never reaches here, refused as
  `blank-completion` inside `chatCompletion`).

## Tests (`tests/salvage.test.js`, existing fixtures extended)

1. The existing test at line 762 ("a trimmed salvage attempt that lands empty falls back...")
   asserts `attempts[1].reason === 'reasoning-only'`; its fixture
   (`reasoningOnlyEmptyContentFrames`, non-empty reasoning, `finish_reason: 'stop'`) is the true
   reasoning-only shape, so the assertion stands unchanged — correct by construction now rather
   than by accident (both round-1 verdicts confirmed the fixture's shape independently).
2. New test: a salvage follow-up ending `finish_reason: 'length'` with empty content AND non-empty
   reasoning (non-empty so `refuseUnusable`'s blank check does not fire first) leaves the losing
   attempt's ledger entry `failed` / `'token-exhaustion'` — the case the item names.
3. New test: a salvage follow-up with a clean finish and WHITESPACE-ONLY content (e.g. a
   `finishFrame(' ')`-style fixture; whitespace passes `refuseUnusable`'s `.length` check, trims
   empty at the gate, and carries no reasoning) leaves the losing entry `failed` / `null` reason —
   the bare arm's one reachable route (round 1, both verdicts: a 0-char both-channels fixture is
   refused as `blank-completion` at the lower layer and never reaches this branch).

## Not in scope

- `bench/lib/reason-notes.mjs`'s prose gaps about attempt-level `reasoning-only` — that is OAI-205,
  a separate live item, and this fix narrows (not closes) the shapes that produce the label.
- Any change to `SALVAGE_REASONS`, `STARVED_REASONS`, or the salvage eligibility gate.

## Files

- `scripts/lib/review-request.mjs` — the helper and the one call-site change, plus the docstring
  sentence.
- `tests/salvage.test.js` — assertions per above.

## Acceptance criteria

1. A `finish_reason: 'length'` empty-content salvage follow-up persists `failed` /
   `'token-exhaustion'` in its attempt entry, proved by a test crossing the real request path
   against the fake server.
2. A clean-finish, reasoning-bearing, empty-content follow-up still persists `failed` /
   `'reasoning-only'`.
3. A clean-finish, whitespace-only-content follow-up (no reasoning) persists `failed` / `null` —
   the reachable form of the bare arm; a 0-char both-channels reply is out of reach by design,
   refused as `blank-completion` inside `chatCompletion`.
4. `attemptSalvage` still returns `null` for all three shapes (salvage outcome unchanged), and the
   full suite is green.

## Verification

- Full `npm test` at the gate.
- Mutation check (the key invariant — the dispatch actually reads the shape): flip the helper's
  `result.finishReason === 'length'` comparison to `!==` via mutation-landed.py; the new
  token-exhaustion test must fail; restore, prove the restore against the backup.
