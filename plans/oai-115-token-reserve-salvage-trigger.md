STATE: proceeded without harness plan-mode — explicit standing session authorization to bypass the
interactive ExitPlanMode gate (the operator stepped away and asked to iterate technical features
without user input, converging with Codex on any decision that would otherwise go to them). No
provenance: line: this was never a harness plan-mode plan. Approval for this plan is Codex and the
Claude verdict subagent in agreement — the /feature skill's own documented substitute for user
approval — not the operator's own sign-off. plans/README.md's unattended-draft state (per the ADR
it cites) would instead have this block the item; that mechanism was knowingly not used this run,
on the operator's explicit instruction (already flagged once for OAI-185, applied consistently
here), and this deviation is flagged for the operator on return.

# OAI-115 — a reasoning model can spend its whole `max_tokens` pool on reasoning and never write an
answer; cut the stream before the pool is exhausted and salvage a conclusion from the partial
reasoning, generalizing OAI-138's existing salvage mechanism to a second trigger.

## Problem, as measured

`max_tokens` is a single pool shared between a reasoning model's thinking (`reasoning` channel) and
its actual answer (`content` channel). On this repo's own hardware, an MoE model starves — spends
nearly the whole budget reasoning, answer never written — on 4-5 of 6 review cases; a dense model on
this same server starves on 1 of 6, despite having the *smaller* context window, so this is not
fixable by picking a bigger model. Two mitigations are already refuted by measurement (OAI-115's own
prior sweeps): a larger `max_tokens` does not help (a 4.5x budget increase moved one metric from 0/3
to 1/3, not to a fix — the model just reasons more, consuming the larger pool); no server-side
reasoning-control parameter works on this server (three tried, all silently ignored). A 17-run
sample of *successful* answers measured answer cost at 205-1,116 tokens (median ~420) — a lower
bound, since it excludes starved runs that might need more once reached.

OAI-138 already ships a salvage mechanism for a related but distinct failure: when the wall-clock
`--max-seconds` deadline expires mid-stream with reasoning flowing and zero answer content yet,
`trySalvage()` (`scripts/lib/review-request.mjs`) builds one bounded follow-up request — the
original messages, the partial reasoning appended as an assistant turn, and a user turn asking to
conclude now, findings-first — capped at 5 minutes, one attempt, no further retry. This machinery
(follow-up construction, context-window re-check, `salvaged: true` tagging and the warning caveat it
carries through `review-report.mjs`/`review.mjs`) is trigger-agnostic: it operates on
`fallbackError.answer.reasoning`, not on *why* the stream stopped. What is not reusable is the
trigger itself — `deadline-timeout` only, produced by `stream-collect.mjs`'s time-based
`createDeadline` watchdog. OAI-115 needs a stream cut for a structurally different reason: not "the
server stopped answering", but "the model is still generating happily, just spending the wrong
pool" — there is no timeout to catch.

There is no live token count available mid-stream: `completion.mjs` only sets `answer.usage` from a
terminal frame that carries one, which arrives after generation ends (or never, if the server
refuses `stream_options`). The only thing visible per-delta, via the existing
`onProgress(answer)` callback in `stream-collect.mjs`'s `collectStream`, is the growing character
length of `answer.reasoning`/`answer.content`. Any live trigger can only use a character-length
proxy for token consumption.

`max_tokens` itself (the request's own completion-token budget) is available at `chat.mjs`'s
`postChat`, in the `body` parameter, but is not currently threaded into `collectStream`.

## Decisions (Codex steer + an independent fable-model second opinion, both converged; see below)

1. **Trigger metric: relative to the request's own `max_tokens`, not an absolute character count.**
   `max_tokens` here ranges roughly 4k-32k depending on window and diff size (`reserveFor`,
   `scripts/lib/review-request.mjs`); an absolute threshold is wrong-sized at one end or the other.
   Fire when estimated reasoning tokens exceed `maxTokens - RESERVE`.

2. **Chars-per-token: a new, dedicated constant, `REASONING_CHARS_PER_TOKEN = 3.0`, defined in
   `stream-collect.mjs`, not `review-request.mjs` (round-2 correction).** This plan's first draft
   placed it in `review-request.mjs` beside `TOKEN_RESERVE_TOKENS`; Codex's plan-gate review caught
   that the char→token conversion is only ever performed inside `stream-collect.mjs`'s watchdog
   (decision 6) — the only value threaded across the module boundary is the already-computed
   `reasoningReserveTokens` option — so importing the constant from `review-request.mjs` would open
   the cycle `review-request → chat/client → stream-collect → review-request`. `stream-collect.mjs`
   owns the constant and the conversion; `review-request.mjs` owns only `TOKEN_RESERVE_TOKENS` (a
   token count, not a conversion rate) and passes it down as the `reasoningReserveTokens` option's
   value. Not the existing `context-guard.mjs` `CHARS_PER_TOKEN = 3.4` either way — that number was
   measured for *input* code and diffs, a different population from *output* reasoning prose. 3.0
   deliberately errs toward triggering early: the cost of guessing too low is preserving somewhat less
   reasoning before asking for conclusions (cheap); the cost of guessing too high is losing the review
   outright or overrunning the salvage follow-up's own context check (expensive). No config knob for
   v1 — one measurement supports one policy, not a tunable range; the estimate, character count,
   `maxTokens` and reserved tokens are attached to the failure record so a later measurement can
   justify revisiting the constant.

3. **Reserve floor: `TOKEN_RESERVE_TOKENS = 2_048`, hardcoded, not configurable for v1.** ~1.8x the
   largest observed successful answer (1,116 tokens), comfortably above the median (~420). A CLI/
   config knob would expose an uncalibrated implementation detail with interactions with
   `--max-tokens` a user would have to understand, on data that supports one number, not a range.

4. **Arm guard (fable amendment, adopted): only arm the watchdog when `maxTokens >= 2 * RESERVE`
   (4,096).** Below that, `maxTokens - RESERVE <= 0` and the watchdog would fire on the very first
   reasoning delta, `trySalvage` would then refuse (reasoning below `SALVAGE_MIN_REASONING_CHARS`),
   and every request on a small-window model would die as `token-reserve-cutoff` with nothing
   salvaged. This is reachable: `reserveFor`'s half-window branch deliberately drops the reserve
   under the schema's minimum below ~7,824-token windows, and ADR 004 pins the resulting
   `finish_reason: length` behaviour as the chosen outcome for that case, by test. An unguarded
   watchdog would silently overturn that decision. The arm condition also requires: the caller
   opted in (review salvage only — never `/oai:task`, capability probes, or the salvage follow-up
   itself), `maxTokens` is finite, and the response is streamed.

   **Review-ladder pass 1 amendment (`codex-adversarial`): also never `--structured-output`.**
   Under a `response_format` grammar the model can never emit the token that closes its own think
   block (documented above `client.mjs`'s `requireAnswer` already), so the real findings JSON
   legitimately arrives on the `reasoning` channel, never `content` — the false-trigger guard's
   `content.length === 0` condition (decision 5) is therefore always true throughout a structured
   request regardless of how much real answer has been written, and arming the watchdog there would
   cut off a reply that is actively finishing correctly. This was missed at plan-gate time because
   none of the four rounds traced the structured-output rung's own answer semantics against the
   arm condition; caught only once a reviewer read `requestFindings`'s structured branch beside
   `client.mjs`'s existing channel-ambiguity documentation. Fix: `requestFindings`'s
   `--structured-output` branch never passes `reasoningReserveTokens` at all — only
   `unconstrained()`'s own call site arms the watchdog.

5. **False-trigger guard: fire only when `answer.content.length === 0` (raw, not trimmed) AND the
   current frame just grew `answer.reasoning` past the threshold.** Once any content has appeared,
   permanently disarm for that stream — do not reconsider later. No plateau/rate-of-growth
   heuristic: a plateau cannot cross a character threshold on its own, and a second, independently-
   evidenced definition of "stuck" is not worth the complexity for what it would catch.

6. **Implementation shape: a second watchdog inside `stream-collect.mjs`'s `collectStream`, checked
   immediately after `applyFrame` in the `for await` loop — the same place the existing
   `deadline.progress()` call sits.** This is the one layer holding all three needed facts: the
   accumulated channels, the delta that just advanced reasoning, and ownership of
   `response.dispose()`. It must set the *same* `expired` variable the deadline watchdog uses
   (`stream-collect.mjs:81`), not a second variable — the `catch` block's `expired ?? error`
   (`stream-collect.mjs:110`) is what makes the synthesized failure outrank the generic transport
   error `dispose()` provokes a tick later; a second variable would lose the race and report a bare
   socket error instead of the real cause.

   The new option is threaded explicitly: `collectStream(..., { reasoningReserveTokens })`, `chat.mjs`
   combines it with `body.max_tokens` when calling `collectStream` from `postChat`. Absence of the
   option (the default for every existing caller) means the watchdog is not constructed at all —
   opt-in, not global.

   **Round-3 correction: the full call chain needs one more edit than originally listed.** A round-2
   independent verdict subagent traced `review-request.mjs` → `client.mjs`'s `chatCompletion` →
   `answer-attempts.mjs`'s `answerWithRetry` → `chat.mjs`'s `postWithDegrade`/`postChat` →
   `collectStream`, and found that `client.mjs`'s `chatCompletion` (lines 40-41, 69-81) does **not**
   spread its `options` parameter through to `answerWithRetry` — it destructures a fixed, named field
   list (`firstTokenMs, idleMs, onProgress, expiresAt, maxMs, requestedModel, maxAttempts,
   retryDelayMs, ledger`) and passes only those along. A new `reasoningReserveTokens` field set by
   `review-request.mjs` would be silently dropped at this boundary. `answer-attempts.mjs`'s
   `answerWithRetry` does spread its own remaining options through (`...rest`) into `budgets`.
   **The fix: `client.mjs`'s `chatCompletion` must also pass `reasoningReserveTokens:
   options.reasoningReserveTokens` in the object it builds for `answerWithRetry`** (alongside the
   existing `maxMs`/`expiresAt` fields at line ~74). `client.mjs` is added to Files touched below.

   **Round-4 correction: a second, structurally identical drop sits one hop further down the same
   chain, inside `chat.mjs`, plus a second value that was never named as needing to travel at all.**
   A round-3 independent verdict subagent traced the *entire* chain end to end (not just the one hop
   round 3 fixed) and found: `postWithDegrade` (`chat.mjs:64`) does pass the whole `budgets` object
   (which now legitimately carries `reasoningReserveTokens`, once the round-3 fix lands) into
   `postChat` as its third argument — but `postChat`'s own signature (`chat.mjs:145`,
   `async function postChat(profile, body, { onProgress, firstTokenMs, idleMs }, budget)`)
   destructures only three fields from it, dropping `reasoningReserveTokens` again — the identical
   bug class round 3 found in `client.mjs`, one hop later, in a file this plan already listed as
   touched but described only as "threads `reasoningReserveTokens`... into the `collectStream` call"
   without stating the destructuring edit that makes that possible. Separately: decision 1's trigger
   math (`maxTokens - RESERVE`) and decision 4's arm guard (`maxTokens >= 2 * RESERVE`) both need the
   request's raw `maxTokens` available *inside* `stream-collect.mjs`, and decision 7 requires the
   synthesized failure to carry `error.maxTokens` and `error.reserveTokens` as two distinct
   diagnostic fields — impossible if only the already-merged `reasoningReserveTokens` (which, as
   passed from `review-request.mjs`, is the bare `TOKEN_RESERVE_TOKENS` constant, 2,048 — not a
   computed threshold and not the request's `max_tokens`) reaches `collectStream`. `stream-collect.mjs`
   needs `body.max_tokens` threaded down as its own, separate value.

   **The fix, stated with the same precision as the round-3 client.mjs fix:**
   - `chat.mjs`'s `postChat` signature changes from `{ onProgress, firstTokenMs, idleMs }` to
     `{ onProgress, firstTokenMs, idleMs, reasoningReserveTokens }`.
   - `postChat`'s `collectStream` call (currently `{ startedAt, firstTokenMs: remaining, reportMs:
     firstTokenMs, idleMs, onProgress }` at line ~188) adds two fields: `reasoningReserveTokens`
     (passed through unchanged) and `maxTokens: body.max_tokens` (a **new, separate** field —
     `body` is already `postChat`'s second parameter, so `body.max_tokens` is available with no
     further threading).
   - `stream-collect.mjs`'s `collectStream` signature changes from `{ startedAt, firstTokenMs,
     reportMs, idleMs, onProgress }` to add both `maxTokens` and `reasoningReserveTokens`; the arm
     guard (decision 4) reads `maxTokens`, the trigger math (decision 1) reads both, and the
     synthesized failure (decision 7) reads `maxTokens` directly for `error.maxTokens` (with
     `error.reserveTokens` set from the `reasoningReserveTokens` parameter).

   **Review-ladder pass 1 amendment (`codex-adversarial` + `codex-plain`, independently, same
   underlying race): the watchdog must THROW immediately on firing, never merely set `expired` and
   `dispose()`.** `readSse` can have further events already buffered from the same physical
   transport chunk — a finish frame, `[DONE]` — which `drain()` yields synchronously with no
   `await` in between; a bare `dispose()` here let the surrounding `for await` loop keep consuming
   those buffered events and return a normal success, discarding the cutoff `expired` value
   entirely (reproduced directly by `codex-adversarial` against a single 6,144-char chunk carrying
   reasoning, a finish event and `[DONE]` together). The same fix closes a second race
   `codex-plain` found independently: the still-armed idle timer's `onExpire` unconditionally
   overwrites `expired`, so if the cutoff's own failure sat unconsumed across an `await`, an idle
   timer firing in that window could silently replace `token-reserve-cutoff` with `idle-timeout`.
   Throwing in the same synchronous turn the cutoff fires — before any further `await` — leaves no
   window for either race: the `catch` block reads `expired` immediately afterward, with nothing
   able to interleave.

   **Review-ladder pass 1, round 2 amendment (`codex-adversarial`, re-checking its own just-applied
   fix): throwing synchronously does not fully close the idle-timer race on its own.** Throwing out
   of a `for-await` loop still runs `IteratorClose` on `readSse`'s async generator BEFORE this
   function's own `catch` ever executes, and that generator's cleanup can itself `await` — a real
   gap, reproduced directly (a controlled async iterator with a delayed `return()`, forcing
   `collectStream` to report `idle-timeout` instead of the real cutoff) in which the still-armed
   idle timer could fire and overwrite `expired` in between. Closed two ways, together: `onExpire`
   (the deadline watchdog's own callback) only ever assigns `expired` when it is still `null` —
   idempotent, so a stale timer firing after the cutoff has nothing left to claim — and the cutoff
   itself calls `deadline.clear()` immediately, before `dispose()`/`throw`, removing the timer from
   the race outright rather than merely surviving it. This is the third round of scrutiny the exact
   same firing block received in one pass (round 1's original design, round 2's throw-immediately
   fix, round 2's own re-check of that fix) — each round finding one further real gap in a
   mechanism that reads as simple but sits at a genuine async-JS-semantics boundary.

   **Self-caught before round 4, same defect class, one hop earlier still (in `review-request.mjs`,
   never sent to a reviewer as a separate round):** `requestFindings`'s `send` object
   (`{ model, timeoutMs, idleMs, expiresAt, maxMs, temperature, maxAttempts, retryDelayMs, ledger,
   onProgress }`) is spread with `...send` at both the original request's `chatCompletion` call
   (inside `unconstrained()`) **and** `trySalvage`'s follow-up `chatCompletion` call —
   `trySalvage(profile, built, schema, shared, send, fallbackError)` receives the same `send` object
   and spreads it too. Adding `reasoningReserveTokens` to `send` itself would therefore leak it into
   the salvage follow-up's own request, arming the watchdog on a call decision 4 explicitly says must
   never carry it (the follow-up already runs under its own small, fixed `salvageReserve` budget —
   decision 10 — and re-arming a reasoning watchdog against that budget risks cutting the follow-up
   off before it can even conclude).
   **Fix: `reasoningReserveTokens` is never added to the shared `send` object.** It is passed only at
   `unconstrained()`'s own `chatCompletion(profile, { ...send, maxTokens: built.reserve,
   reasoningReserveTokens: armedValue, messages: built.messages })` call, computing `armedValue` from
   the arm guard (decision 4: `TOKEN_RESERVE_TOKENS` when `built.reserve >= 2 * TOKEN_RESERVE_TOKENS`,
   else `undefined`). **Corrected below (this decision's own pass-1 amendment):**
   `requestFindings`'s `--structured-output` branch never arms the watchdog at all, for a reason
   unrelated to `send` — see decision 4's amendment. `trySalvage`'s own `chatCompletion` call is
   unaffected by construction — it never names the field, and `send` no longer carries it — so no
   explicit override is needed there either.

7. **A dedicated failure shape, not `budgetError()`.** `budgetError()` is millisecond-denominated and
   produces `*-timeout` reasons by construction; this cutoff is neither a timer nor a server stall.
   A new `UserError` is synthesized directly with:
   - `error.reason = 'token-reserve-cutoff'` — **not** `'token-reserve-timeout'`. Several benchmark
     code paths (`bench/lib/sweep-outcome.mjs`, `bench/lib/reason-notes.mjs`) classify any
     `*-timeout` reason as timing data; that name would misclassify a budget cutoff as a stall.
   - `error.maxTokens`, `error.reserveTokens`, `error.reasoningChars`,
     `error.estimatedReasoningTokens` (all diagnostic, none reaching a persisted message per the
     OAI-185 discipline — none of these travel through `UserError`'s `.message`/`.hint`).
   - `error.serverResponded = true` (the stream was live; this is not a connectivity failure).
   - `error.answer` and `error.timings`, set exactly the way the existing `catch` block already sets
     them for any `failure` (unconditional, per the existing comment at `stream-collect.mjs:119-126`)
     — no new code needed there, since the watchdog produces `failure` via the same `expired` path.

8. **Not added to `failure-shape.mjs`'s `RETRYABLE` set.** `RETRYABLE` is a `Set` whitelist
   (`RETRYABLE.has(error?.reason)`); an unrecognised reason is not retried by default, so no change
   is needed there — confirmed by reading the predicate directly. Retrying a token-reserve cutoff
   would just reproduce the same starvation; `trySalvage` is the intended next step, not the normal
   retry ladder.

9. **`trySalvage()` generalized via a small reason allowlist, not forked into two functions.** The
   follow-up construction and context-window re-check discipline are identical across triggers —
   duplicating them would duplicate the hard-won parts (findings-first override, schema handling,
   the context-budget re-check). New:
   ```js
   const SALVAGE_REASONS = new Set(['deadline-timeout', 'token-reserve-cutoff']);
   ```
   `trySalvage`'s guard changes from `fallbackError?.reason !== 'deadline-timeout'` to
   `!SALVAGE_REASONS.has(fallbackError?.reason)`. The follow-up's user-turn wording changes from
   "You ran out of time before finishing" to a cause-neutral "Your previous response was cut off
   before it finished" — accurate for both triggers, and not a functional change to the
   deadline-timeout path's own established behaviour beyond the wording.

10. **Salvage follow-up budget: branch on the trigger reason, not a single blended formula (fable
    amendment, adopted; formula corrected after a Codex round-2 finding — see below).** Codex's first
    cut set the follow-up's own `maxTokens` and its `checkContextBudget` `reserveTokens` to the flat
    `TOKEN_RESERVE_TOKENS` (2,048) unconditionally, reasoning that reusing the original `built.reserve`
    could blow the context window once the partial reasoning is appended back into the prompt. That is
    correct for the *new* trigger, where the window has already been consumed down to ~2,048 tokens of
    headroom by construction — but `trySalvage` is shared, and on the pre-existing `deadline-timeout`
    path reasoning may be short and headroom large; flat-pinning 2,048 there is an unforced regression
    of shipped, previously re-verified OAI-138 behaviour (`built.reserve` was correct there and is not
    changing).

    **Round-2 correction:** this plan's first draft proposed clamping via
    `Math.max(TOKEN_RESERVE_TOKENS, built.reserve)` for the `token-reserve-cutoff` branch. Codex's
    plan-gate review caught that this does nothing: the arm guard (decision 4) already requires
    `built.reserve >= 4_096 > TOKEN_RESERVE_TOKENS`, so `Math.max` always evaluates to `built.reserve`
    — the exact value the whole point of this branch was to avoid, since appending
    `built.reserve - 2_048` tokens of consumed reasoning back into the prompt is what would make
    `checkContextBudget` reject the follow-up and reproduce the original starvation. **Corrected
    formula — a plain reason-keyed branch, no `Math.max`/`Math.min` at all:**
    ```js
    const salvageReserve = fallbackError.reason === 'token-reserve-cutoff'
      ? TOKEN_RESERVE_TOKENS
      : built.reserve;
    ```
    `salvageReserve` is used for both `checkContextBudget`'s `reserveTokens` and the follow-up
    `chatCompletion` call's `maxTokens`. This satisfies both invariants exactly: the
    `token-reserve-cutoff` path always asks for the small, already-proven-to-fit 2,048-token budget;
    the `deadline-timeout` path is byte-for-byte unchanged from today (`built.reserve`, as it already
    reads at `review-request.mjs:285,298`).

11. **`reasonNotes` and the sweep's `classify` envelope get the new reason.** `bench/lib/
    reason-notes.mjs`'s `RECORD_FIELDS`-pinned membership (per `tests/bench-reason-notes.test.js`)
    needs a `token-reserve-cutoff` entry so a reader isn't left to guess what the code means; an
    unsalvaged `token-reserve-cutoff` is classified as `starved` in the sweep's outcome taxonomy
    (`bench/lib/sweep-outcome.mjs`), alongside the existing starvation classification, not as a
    generic failure.

12. **Simpler alternative considered and rejected: wait for the terminal `finish_reason: "length"`
    instead of a live watchdog.** By the time that arrives, the reasoning has already consumed
    nearly the whole budget — appending the full reasoning trace back into the follow-up prompt
    would leave no guaranteed room for the follow-up's own answer, defeating the fix's own purpose.
    The watchdog is doing two jobs at once: preventing the original pool from being fully consumed
    by reasoning, and ensuring the *follow-up* prompt still has ~2,048 tokens of room. Only a live
    cut achieves both.

## Non-goals / explicitly deferred

- Configurability of `REASONING_CHARS_PER_TOKEN` or `TOKEN_RESERVE_TOKENS` — hardcoded per decision
  2/3 above; revisit only against new measurement.
- A rate-of-growth / plateau heuristic — explicitly rejected per decision 5.
- Extending this mechanism to `/oai:task` or capability probes — review-only per decision 6's opt-in
  gate.
- The exact clamp expression in decision 10 beyond the two invariants stated — an implementation
  detail resolved while writing the diff, not a design fork.

## Files touched

- `scripts/lib/stream-collect.mjs` — new watchdog logic in `collectStream`, reusing the existing
  `expired` variable and `response.dispose()` call; `collectStream`'s destructured parameter gains
  **two** new fields, `maxTokens` and `reasoningReserveTokens` (round-4 correction, decision 6 — both
  are needed separately: the arm guard and trigger math read both, and the synthesized failure's
  `error.maxTokens`/`error.reserveTokens` need the raw request budget, not just the merged reserve);
  new local constant `REASONING_CHARS_PER_TOKEN = 3.0` (owned here, not in `review-request.mjs` —
  round-2 correction, decision 2).
- `scripts/lib/client.mjs` — `chatCompletion` passes `reasoningReserveTokens: options.reasoningReserveTokens`
  through to `answerWithRetry`, alongside the existing `maxMs`/`expiresAt` fields (round-3 correction
  — see decision 6; without this the option is silently dropped at this boundary and never reaches
  `chat.mjs`).
- `scripts/lib/chat.mjs` — `postChat`'s destructured third parameter gains `reasoningReserveTokens`
  (was `{ onProgress, firstTokenMs, idleMs }`, round-4 correction — without this the value delivered
  by the round-3 `client.mjs` fix is dropped one hop later); its `collectStream` call adds both
  `reasoningReserveTokens` (passed through) and `maxTokens: body.max_tokens` (a new, separate field —
  `body` is already in scope as `postChat`'s second parameter).
- `scripts/lib/review-request.mjs` — **only** `unconstrained()`'s `chatCompletion` call opts into the
  new watchdog, by passing `reasoningReserveTokens:` an arm-guard-computed value (decision 4) directly
  at the call site — **never added to the shared `send` object**, since `send` is also spread into
  `trySalvage`'s follow-up call and must not carry it there (self-caught correction, decision 6).
  `requestFindings()`'s `--structured-output` branch never arms the watchdog at all (decision 4's
  pass-1 amendment — the model's real answer legitimately arrives via the reasoning channel there, so
  the false-trigger guard is meaningless). `trySalvage()` generalized per decisions 9-10; new
  exported constant `TOKEN_RESERVE_TOKENS` (a token count, not a conversion rate —
  `REASONING_CHARS_PER_TOKEN` lives in `stream-collect.mjs` instead, per decision 2's round-2
  correction).
- `scripts/lib/failure-shape.mjs` — no code change; confirmed `RETRYABLE` whitelist already excludes
  an unrecognised reason by construction (decision 8), documented in CLAUDE.md instead.
- `bench/lib/reason-notes.mjs`, `bench/lib/sweep-outcome.mjs` — new reason recognised (decision 11).
- `tests/` — new unit coverage for the watchdog trigger (arm/disarm conditions, the relative
  threshold math, the `expired` race with the deadline watchdog), new coverage for `trySalvage`'s
  generalized guard and the clamp behaviour on both trigger reasons, a `reasonNotes`/`sweep-outcome`
  membership test extension.
- `CLAUDE.md` — architecture note naming the new watchdog, its constants, the `token-reserve-cutoff`
  reason and why it avoids `-timeout` naming, and the `trySalvage` generalization.
- `BACKLOG.md` / `BACKLOG_DONE.md` — closed on completion per the repo's tracker convention.

## Design provenance

Codex steer (`task-mt1fpn06-gg3wtu`, full reply archived in this session's transcript) supplied
decisions 1-3, 5-9, 11-12 verbatim and decision 10 in its initial (later-amended) form. An
independent fable-model second opinion, briefed on the Codex steer without being shown Codex's
identity or told to agree, reviewed it blind and returned "approve, with two amendments" —
decision 4 (the arm guard) and decision 10 (the clamp, not flat-pin) — both adopted here. Round 1 of
this plan gate (Codex) found decision 10's clamp formula and decision 2's constant placement both
broken; both corrected. Round 2: Codex approved the corrections outright; an independent Claude
verdict subagent, reviewing the same round-2 text, verified both corrections were genuinely sound but
found a third, previously uncaught defect by tracing the full runtime call chain: `client.mjs`'s
`chatCompletion` does not spread its options through, so `reasoningReserveTokens` would be silently
dropped one hop into the chain. Fixed (`client.mjs` added to Files touched). Round 3: Codex approved
the fix, having independently re-traced the same chain and confirmed no further break; a *different*
independent Claude verdict subagent, asked specifically to re-trace the **entire** chain end to end
rather than just the fixed hop, found a fourth defect Codex's round-3 pass missed: `chat.mjs`'s
`postChat` also fails to destructure `reasoningReserveTokens` from its budgets parameter — the
identical bug class, one hop further down the same file this plan already listed as touched — plus
an unstated requirement that `body.max_tokens` itself needs to reach `stream-collect.mjs` as a
value distinct from the merged reserve, since the arm guard, trigger math and failure diagnostics
all need the raw number. Both are now fixed (decision 6, Files touched for `chat.mjs` and
`stream-collect.mjs`). **Three consecutive rounds each found one real, previously-missed defect in
the exact same propagation chain, each one hop further down than the last (`review-request.mjs`'s
own call → `client.mjs` → `chat.mjs`'s destructuring → `chat.mjs`'s `collectStream` call), each
caught only by an independent verdict subagent instructed to re-trace the whole chain rather than
trust the previous round's fix** — consistent with this repo's own `fixes-need-mutation-proof`
precedent that a fix applied is not a fix proved, and that the second, independent signature is not
ceremony. Round 4's plan gate must re-verify the *entire* chain once more, not just the two newly
edited files, given this pattern.
