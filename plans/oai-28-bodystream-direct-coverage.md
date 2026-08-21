STATE: authored unattended, dual-gate route (not harness plan mode)

# OAI-28 (B)+(C) — direct coverage for bodyStream's two untested transport writes

Authored during an unattended session (user away, standing instruction to iterate on BACKLOG.md,
converge with Codex + a fable verdict subagent, never ask the user). This is a coverage-only change:
no runtime behavior in `scripts/lib/http.mjs` changes.

## Problem

`scripts/lib/http.mjs`'s `bodyStream` generator has two writes that have never been behaviorally
exercised, both recorded in BACKLOG.md's OAI-28 (B) and (C):

- **(B)** the `!response.complete` branch (lines ~93-107): sets `error.reason = TRANSPORT` and
  `error.serverResponded = true` when the iteration ends with no error event and the response never
  completed. Proved by mutation that the suite stays green if either line is deleted.
- **(C)** the catch block one line below (lines ~110-128): `throw error instanceof UserError ? error :
  transportError(error, url, { delivered: true })`. `tests/structure.test.js:220-242` guards this
  structurally (a regex over the function body) with a doc comment claiming "nothing behavioural can
  pin it" and "a test cannot make Node drop the code on demand; this can" — both measured true only
  in the sense that a *real* socket cut on Node 26.3 always raises with `ECONNRESET` attached, never
  reaching a code-less error. That doesn't mean no test can reach the code-less path; it means no
  *server-driven* fixture reaches it.

Both (B) and (C) are unreachable through a real `node:http` server on Node 26.3: measured, both ways
of cutting a body (short content-length, chunked-no-terminator) raise on the stream instead of ending
cleanly. The backlog's own suggested fix for both is the same: drive `bodyStream` directly with a stub
async iterable.

## Fix

`bodyStream` is currently module-private (not exported). `requestErrorHandler` in the same file is
already exported under a documented exception ("Exported for the test, not for a caller ... the
post-header race cannot be driven end to end"). Add `bodyStream` to that same exception, with a
comment of the same shape, and drive it directly with two stub fixtures:

1. **(B) fixture** — a `response` stub whose `[Symbol.asyncIterator]` yields one chunk then returns
   normally (no throw), with `response.complete = false`. A minimal `state` object (`received: 0`,
   `firstByteTimer: null`, `idleMs: null`, `idleTimer: null`, `totalTimer: null`, `aborted: null`) and
   a `request` stub exposing a no-op `destroy()` (called in `finally` since `response.complete` is
   false). Assert the thrown error has `error.reason === TRANSPORT` and
   `error.serverResponded === true` — the exact two writes OAI-28/OAI-35 proved undetected by
   mutation.

2. **(C) fixture** — a `response` stub whose `[Symbol.asyncIterator]` throws a plain `Error` with no
   `.code` property mid-iteration. Same minimal `state`/`request` stubs. Assert `isRetryable(error) ===
   true` — proving the catch's `{ delivered: true }` classification holds even when Node attaches no
   code, which is exactly what the structural regex test could never demonstrate.

Both fixtures go in `tests/transport-classification.test.js`, beside the existing
`'a body cut off mid-flight is retryable'` test (which stays — it's real server-driven adjacent
evidence, per that test's own comment, not a substitute).

3. **Fix the overclaim, and fix the locator it breaks.** `tests/structure.test.js:220-242`'s doc
   comment currently states "nothing behavioural can pin it" and "a test cannot make Node drop the
   code on demand; this can" — both now false. Correct the comment to state what's actually true: a
   real server-driven fixture can't reach this path on Node 26.3 (that part stays true and is why the
   structural guard exists as a second, independent check), but a direct fixture in
   `transport-classification.test.js` now pins the behavior.

   The structural test's own locator must also change, and this is not optional: it currently reads
   `functionBody('scripts/lib/http.mjs', /^async function\* bodyStream\b/)`. `functionBody()` matches
   from the start of a line, so once `bodyStream` is exported (`export async function* bodyStream`)
   this regex no longer matches anything and the test fails outright — caught at the plan-gate by
   Codex, round 1. The locator regex becomes `/^export async function\* bodyStream\b/`. With that fix
   the structural test still passes and still functions as the second, independent guard described
   above.

## Non-goals

No change to `bodyStream`'s runtime logic, no change to `send()`'s public contract, no change to what
`requestErrorHandler`'s existing export-for-test precedent means for other module-private functions.

## Acceptance criteria

- `bodyStream` is exported with a doc comment following the same shape as `requestErrorHandler`'s.
- A direct test proves both writes in the `!response.complete` branch (B): `error.reason` and
  `error.serverResponded`.
- A direct test proves the catch block (C) classifies a code-less error as retryable.
- `tests/structure.test.js`'s doc comment no longer claims the branch/catch cannot be behaviorally
  pinned, and its locator regex matches the exported declaration.
- Full suite green.
- Mutation-landed proof: deleting `error.serverResponded = true` (or flipping `error.reason`) makes
  the new (B) test fail; making the catch drop `{ delivered: true }` (or hardcode a different reason)
  makes the new (C) test fail.

## Risk

Very low — pure test/doc addition plus one new export of an already-internal function, following an
established precedent in the same file.
