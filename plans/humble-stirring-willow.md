provenance: harness slug humble-stirring-willow

# Salvage the "reasoning-only, clean stream" review failure

## Context

An overnight review-sweep (`bench/review-sweep.mjs`, 2026-08-21) hit a case where a local model spent
~487s and tens of thousands of characters reasoning, then finished its stream normally with **empty
content** (`finish_reason` not `'length'` — it just stopped mid-reasoning without ever transitioning to
an answer). `scripts/lib/client.mjs`'s `requireAnswer()` throws for this shape but attaches no
`.reason` and no `.answer`, so the whole reasoning trace is discarded.

Two other failure shapes — `deadline-timeout` and `token-reserve-cutoff` — already get a salvage retry
(`scripts/lib/review-request.mjs`'s `trySalvage`, gated by `SALVAGE_REASONS`), asking the model to
conclude from its own partial reasoning instead of throwing it away. This shape gets none, even though
it's the same kind of situation: substantial reasoning exists, just no answer was ever written.

Probed and confirmed (independently verified by Codex): simply adding a reason string to
`SALVAGE_REASONS` would do nothing, because `requireAnswer`'s throw happens **after**
`review-request.mjs`'s `unconstrained()` has already returned successfully — a completely different
function is on the call stack by then (`cmd-review.mjs` → `parseFindings` → `review-report.mjs` →
`unparsedReply` → `requireAnswer`). `unconstrained()`'s own `catch` block, the only place `trySalvage`
is invoked, can't see it. The fix has to detect this shape **inside** `unconstrained()`, right after its
own `chatCompletion()` call, so the throw lands in the catch block that already has `built` (the
constructed prompt) in scope.

Grilled and settled: whether the sweep's outage counter (`bench/lib/sweep-outcome.mjs`'s `isOutage`)
should treat this newly-named reason as a possible server outage. Codex and a Claude reviewer debated
and converged: **exclude it** — real server-side stream drops already have their own separate,
still-counted classification (`COMPLETION_SHAPES`), so this shape (which only ever fires after a clean,
server-terminated stream) is structurally disjoint from an actual server failure. This requires no code
change — simply not adding the new reason to `serverUnwell`'s recognized sets already achieves it — only
a doc-comment update explaining the exclusion.

## Implementation

### 1. `scripts/lib/client.mjs` — extract a shared predicate

Add, directly above `requireAnswer` (currently lines 91–123):

```js
/**
 * The model finished cleanly (finishReason !== 'length') with nothing on the
 * content channel but something real on the reasoning channel — the shape
 * `requireAnswer` refuses on its own, and the one `review-request.mjs`'s
 * `unconstrained()` needs to recognize BEFORE that refusal, so a salvage
 * attempt can run on the still-in-scope built messages.
 */
export function isReasoningOnly(result) {
  return !result.content.trim() && result.finishReason !== 'length' && Boolean(result.reasoning.trim());
}
```

Change `requireAnswer`'s branch at line 111 from `if (result.reasoning.trim())` to
`if (isReasoningOnly(result))`. Verified no-op: by that line the `finishReason === 'length'` branch has
already returned via throw, and `content.trim()` is already known falsy, so the predicate is exactly
equivalent to the existing check for every one of `requireAnswer`'s 3 call sites (`review-unparsed.mjs`,
`task-report.mjs`, `cmd-task-worker.mjs`) — none of which change behavior.

### 2. `scripts/lib/review-request.mjs` — new check inside `unconstrained()`

Import `isReasoningOnly` alongside the existing `chatCompletion` import. In `unconstrained()`, right
after the `chatCompletion()` call succeeds and before the existing
`return { result, structured: false, ...built };`:

```js
if (isReasoningOnly(result)) {
  const failure = new UserError(`${profile.name} returned only internal reasoning and no answer.`, {
    reason: 'reasoning-only',
    hint: 'Raise --max-tokens, or ask a narrower question — the model never left its reasoning channel.',
  });
  failure.answer = { reasoning: result.reasoning, content: result.content };
  throw failure;
}
```

Message/hint text matches `requireAnswer`'s existing wording — this is the same refusal raised one
call-frame earlier, only when a salvage attempt is actually possible. Comment should note this never
applies to the `--structured-output` path (there, the reasoning channel legitimately carries the
constrained answer under a schema, so `unconstrainedLadder`'s structured branch has no counterpart
check).

### 3. `SALVAGE_REASONS` and the salvage-follow-up reserve

Add `'reasoning-only'` to `SALVAGE_REASONS` (line 238), with the doc comment above it extended to
explain it: the model left real reasoning to conclude from, discovered post-hoc rather than via a live
cutoff, but the same "actively working when the cut happens" logic applies.

**Required, not cosmetic** — `trySalvage`'s reserve ternary (~line 316):

```js
const salvageReserve = fallbackError.reason === 'token-reserve-cutoff' ? TOKEN_RESERVE_TOKENS : built.reserve;
```

must become:

```js
const salvageReserve = ['token-reserve-cutoff', 'reasoning-only'].includes(fallbackError.reason)
  ? TOKEN_RESERVE_TOKENS
  : built.reserve;
```

Reasoning: for `deadline-timeout`, no reasoning tokens were consumed against `built.reserve` (a
wall-clock cap, not a token one), so re-reserving the full `built.reserve` on the follow-up is safe. For
`reasoning-only`, the model just consumed most or all of `built.reserve` producing that reasoning — the
follow-up appends it back in as an assistant turn, and re-reserving the FULL `built.reserve` on top of
that would very likely overrun the context-budget check (`checkContextBudget`), causing `trySalvage` to
return `null` precisely on large, real reasoning traces — silently defeating the feature on exactly the
incident that motivated it. Update the comment above the ternary to name `reasoning-only` alongside
`token-reserve-cutoff` with this reasoning.

### 4. `bench/lib/sweep-outcome.mjs` — doc-only

No functional change to `isOutage`/`serverUnwell`. Update the "Still excluded" comment paragraph to add:
`reasoning-only`, which fires only after a clean, server-terminated stream — a genuine server-side
stream drop is already covered separately by `COMPLETION_SHAPES`'s `stream-unfinished`/
`empty-completion`/`blank-completion`.

State plainly (in the commit message, not just the comment): this is a real, intended classification
flip. Today this failure throws with no reason, and `isOutage` treats any reasonless failure as an
outage — so today's version of the motivating incident counts toward the sweep's fail-fast abort
counter. After this change it's named `reasoning-only`, which `serverUnwell` doesn't recognize, so it
stops counting. Correct (the server didn't misbehave), but worth stating explicitly rather than leaving
it as an incidental side effect of naming the reason.

### 5. Tests

**New file `tests/reasoning-only-salvage.test.js`**, modeled on `tests/salvage.test.js` and
`tests/token-reserve-cutoff.test.js` (each existing salvage trigger has its own file). Fixture must
stream strictly between `SALVAGE_MIN_REASONING_CHARS` (500) and the default scenario's watchdog
cutoff threshold (6144 chars, so the live watchdog doesn't fire first) of `reasoning_content`, then a
finish frame with empty content and `finish_reason: 'stop'`, then `[DONE]`, then close the stream
itself (unlike the two precedent fixtures, which never close since they exist to be cut by a live
timer) — e.g. ~20 repeats of the existing 51-char `reasoningFrame()` helper.

- **(a) salvage succeeds**: first request streams ~1020 chars reasoning + clean empty-content finish;
  follow-up returns real findings JSON. Assert `envelope.salvaged === true`, findings present, exactly
  2 chat requests, and — pinning the reserve fix — the follow-up request's `max_tokens` is 2048
  (`TOKEN_RESERVE_TOKENS`), not the full original reserve.
- **(b) salvage attempt itself fails**: follow-up returns 500. Assert `result.status === 1`,
  `envelope.reason === 'reasoning-only'`, `envelope.salvaged === undefined`,
  `envelope.partial.reasoning` present, exactly 2 chat requests. Model directly on
  `token-reserve-cutoff.test.js`'s equivalent test.
- **(c) below `SALVAGE_MIN_REASONING_CHARS`**: short reasoning, clean empty-content finish. Assert
  `envelope.reason === 'reasoning-only'`, exactly 1 chat request (no follow-up attempted at all).

**`tests/review-sweep-outcome.test.js`**: in the existing `'starvation and input refusals are NOT the
server being unwell'` test, add `assert.equal(serverUnwell('reasoning-only'), false);` with a one-line
comment matching the existing two entries' style.

**`tests/review-exhaustion-reason.test.js`**: the existing `'a reasoning-only reply that falls through
to requireAnswer still carries the attempt that produced it'` test uses reasoning well under 500 chars,
so after this change it's intercepted by `unconstrained()`'s new check before ever reaching
`requireAnswer` on the review path. Its existing assertions (status, `error: true`, the `attempts`
projection) still pass — `unconstrained()`'s catch still does `throw withLedger(fallbackError, ledger)`
regardless of which line threw — but the test should now also assert
`assert.equal(report.reason, 'reasoning-only')` to pin the new behavior, and its header comment should
be rewritten to describe the new interception point rather than the now-partially-stale "falls through
to `requireAnswer`" framing. `requireAnswer`'s own reasoning-only branch stays live and must NOT be
deleted — `task-report.mjs` and `cmd-task-worker.mjs` still call it directly, entirely outside
`review-request.mjs`, and still need it.

## Verification

- `npm test` full suite green.
- Mutation-check the key invariant: the `salvageReserve` ternary's inclusion of `'reasoning-only'`.
  Revert it to the current single-condition form, confirm test (a) above goes red (follow-up
  `max_tokens` assertion, or the salvage-succeeds assertion itself if the context-budget rejection
  makes `trySalvage` return `null` entirely), restore, confirm green again.
- Confirm `tests/review-exhaustion-reason.test.js`'s other tests (the token-exhaustion ones, the
  `--structured-output` boundary) still pass unchanged.
