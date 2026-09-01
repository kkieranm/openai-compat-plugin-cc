provenance: harness slug squishy-stirring-dragonfly
# OAI-229 — a streamed refusal is a refusal, not an empty completion

## Context

LM Studio, under `stream: true` (the plugin's default), delivers a request refusal — a context
overflow, or a sampling value outside its schema — as an **HTTP 200 `text/event-stream`** whose only
event is `event: error` with `data: {"error":{"message":"…"},"message":"…"}` and no `[DONE]`.
Reproduced through the real CLI on 2026-09-01 (`evidence/013.md`): `scripts/lib/sse.mjs` drops the
`event:` line by design and yields the data frame; `applyFrame` (`scripts/lib/completion.mjs`) finds
no `choices`, so neither text channel is seen; `refuseUnusable` classifies it `empty-completion`, a
member of `failure-shape.mjs`'s RETRYABLE whitelist; `answer-attempts.mjs` re-sends the identical
request three times; the run reports *"returned a completion with no message content"* and the
server's own sentence is discarded. Codex confirmed all four citations (probe step).

Outcome wanted: one request, a loud failure that names itself as a server refusal inside the stream,
the server's text preserved where server-controlled text is allowed to travel (`.responseBody`, never
`.message`), and no retry — a deterministic refusal is never on the retry whitelist.

Design settled with Codex (`codex-rescue` steer, recorded in the OAI-229 body in `BACKLOG.md`):
detect on the **frame's shape**, never on the `event:` line; a NEW non-retryable reason
`stream-error-frame` (not `*-timeout`: bench reads that suffix as timing); not fed to the capability
rungs or `isFormatRejection` (both gate on HTTP 400/422, and LM Studio's `response_format` refusals
still arrive pre-stream as 400); `serverUnwell` must return false for it; the context-overflow
instance stays a loud failure (the frame proves a refusal, not an oversize).

**Scope boundary (plan-gate round 1, Codex):** an error envelope is not by itself proof of a
deterministic refusal — a server could also report a mid-generation failure that way. So the
non-retryable classification is confined to an error frame that arrives **before any text**, and
the boundary rests on the posture the code already takes rather than on the frame's wording: a
server-stated error before generation begins — an HTTP error status from `assertOk`
(`provider.mjs`), whatever the status, carries no `reason` and is never retried today — is the
server saying no, and `failure-shape.mjs`'s retry vocabulary is by its own definition only for a
request that "dies without the model having said no". An error frame that arrives **after** text has
streamed keeps today's classification exactly: the frame carries no `choices` and is ignored, the
stream ends without a terminator, and `refuseUnusable` reports `stream-unfinished`, which stays
retryable. That case is not this item's dated instance and is left disclosed, not redesigned.

## Files

- `scripts/lib/failure-shape.mjs` — new exported constant.
- `scripts/lib/completion.mjs` — the frame-shape predicate, beside `applyFrame`.
- `scripts/lib/stream-collect.mjs` — the before-any-text check and throw in `collectStream`.
- `tests/stream-error-frame.test.js` (new), `tests/attempt-response-sites.test.js`,
  `tests/failure-shape.test.js`, `tests/review-sweep-outcome.test.js` — tests.
- `CLAUDE.md` — one architecture line.

`sse.mjs` is **not** changed: it stays a framing reader, and "has any text streamed yet" is a fact
only `collectStream` holds (its `firstTextAt`). `bench/lib/sweep-outcome.mjs` needs no code edit (its
`serverUnwell` admits only TRANSPORT/NON_RETRYABLE_TRANSPORT/COMPLETION_SHAPES/`idle-timeout`) —
only its "still excluded" docstring gains a clause naming `stream-error-frame` beside `oversize`;
`failure-shape.mjs`'s module note names the new constant as the one refusal kept there; the two
prose enumerations of the flag-only "no second witness" family — `attempt-outcome.mjs`'s
`serverResponded` docstring and the comment above `tests/attempt-server-responded.test.js`'s
three-reason loop (the loop itself stays at three; the fourth site's witness is the
`attempt-response-sites` row) — name `stream-error-frame` beside `protocol`/`bad-json`/`transport`,
comment-only; and, outside the code, `BACKLOG.md`'s OAI-229 body is annotated with the landed
detection site and `evidence/013.md` records the post-fix live re-run;
`chat.mjs`'s catch already passes a non-rung error through `handle.fail` (which reads
`serverResponded`) and rethrows; `stream-collect.mjs`'s own catch already attaches timings and the
accumulator to whatever the loop throws. `tests/structure.test.js` already lists
`completion.mjs` in `RESPONSE_BOUNDARY_FILES` but not `stream-collect.mjs`; the new throw interpolates
only `profile.name` (as the file's existing throws do) and puts the server's text on
`.responseBody`, so it honours the same discipline whether or not the scan reaches it — adding
`stream-collect.mjs` to that list is a one-line extension the implementation makes, since the file
now builds an error from server bytes.

## Phase 1 — the reason code (`failure-shape.mjs`)

Add `export const STREAM_ERROR_FRAME = 'stream-error-frame';` beside the other shape constants, with a
docstring stating current behaviour only: an HTTP 200 stream whose data frame, arriving before any
text, is an error envelope rather than a completion chunk — the server refused the request after
opening the stream, the streaming twin of an HTTP error status, which is never retried either. It is
added to **neither** `RETRYABLE` nor `COMPLETION_SHAPES`, and the docstring says why for each: not
RETRYABLE because a server-stated refusal before generation is not a delivery failure; not a
completion shape because no reply document was produced and bench's `serverUnwell` reads
COMPLETION_SHAPES as server-health evidence, which a refusal is not. It also states the boundary: an
error frame after text has streamed is still `stream-unfinished`.

## Phase 2 — the predicate (`completion.mjs`) and the check (`stream-collect.mjs`)

`completion.mjs` gains `export function errorFrame(frame)` beside `applyFrame` — the file that
already owns what a frame's shape means. It is the frame's SHAPE and nothing else:

- `frame` is a non-null, non-array object;
- it has an own `error` property whose value is a non-null object **or** a non-empty string
  (LM Studio's streamed refusal uses the object form; its non-streamed 400 body uses the string form
  `{error:"…"}`, so a server that streams that spelling is covered too);
- it has **no own** `choices` property (`Object.hasOwn`, like the `error` check). A frame carrying
  `choices` is a completion chunk whatever else it carries, and stays on the completion path.

It returns the server's text when the shape holds — `error.message` when that is a string, else
`error` itself when it is a string, else `JSON.stringify(error)` — and `null` otherwise, so the
caller has one call to make.

`collectStream` checks it at the top of its `for await` body, before `applyFrame`, and acts only
while `firstTextAt === null` (no text on either channel yet — the condition the timing already
treats as "generation has not begun") **and `expired === null`** (the same first-claimant guard the
reserve cutoff carries: a budget that already fired is the cause reported). When both hold:

- build `new UserError(`${profile.name} refused the request inside the stream.`, { hint: <literal>,
  reason: STREAM_ERROR_FRAME })` — the hint is a fixed literal: the server answered the stream with
  an error instead of a completion, so the request was not re-sent, because a refusal before
  generation begins is refused again. **The hint does not say where the server's text appears**: it
  is printed only on the interactive path (`oai-companion.mjs`'s top-level catch appends
  `transportDetail` for a command on its allowlist), and a background worker's persisted hint would
  otherwise promise text that never arrives (plan-gate round 2, Claude verdict);
- `failure.serverResponded = true`; `failure.responseBody = text.slice(0, 400)` (the cap `assertOk`
  uses; `transportDetail` already displays `.responseBody` interactively and `errorReport` already
  excludes it from the persisted envelope);
- then exactly the sequence the reserve cutoff in the same loop already uses, for the same reasons
  its comments give: `expired = failure`, `deadline.clear()`, `response.dispose()`, `throw failure`
  — synchronous, so no event buffered from the same chunk is consumed after it, and the idle timer
  cannot overwrite `expired`.

After text has streamed, the frame is not acted on: `applyFrame` sees no `choices` and the existing
`stream-unfinished` path reports it, unchanged.

## Phase 3 — tests

The dedicated `tests/stream-error-frame.test.js` replays use the observed bytes verbatim from
`evidence/013.md`: the `event: error` line, the `data:` line with the LM Studio overflow sentence
(*The number of tokens to keep from the initial prompt is greater than the context length…*), a
blank line, then `end()` with no `[DONE]`; the per-site fixture in item 2 below is the one exception. Because
`respondStream` JSON-encodes frames and cannot emit an `event:` line, each script writes the raw
bytes itself with `response.writeHead(200, {'content-type':'text/event-stream; charset=utf-8'})` +
`response.write`/`end`, the way `badSseFrame` does in `tests/attempt-response-sites.test.js` and
the frame helpers do in `tests/token-reserve-cutoff.test.js`.

1. `tests/stream-error-frame.test.js` (new), driven through `scriptedServer`-style fake server +
   `runCompanion(['task', '--json', 'say hi'])` with the DEFAULT `--max-attempts` (3):
   - **the dated instance**: the error frame alone → `chatRequests(server).length === 1` (the
     mutation control — reverting the check gives 3), exit status 1, envelope
     `reason === 'stream-error-frame'`, `attempts.length === 1` with `outcome: 'failed'` and
     `serverResponded: true`, `envelope.message` and `envelope.hint` free of the server sentence,
     and stderr (where `oai-companion.mjs`'s top-level catch prints `transportDetail` for any
     interactive command, `--json` or not) containing it;
   - **role-only frame, then the error frame**: same outcome — a role delta carries no text, so
     generation had not begun;
   - **text, then the error frame** (a content delta, then the same error bytes, no `[DONE]`):
     the boundary control — `reason === 'stream-unfinished'`, three requests, exactly as before this
     change;
   - **shape controls** through `errorFrame` directly: `{"choices":[…],"error":{…}}` → null;
     `{"error":null}` → null; `{"error":""}` → null; an INHERITED `error`
     (`Object.create({error:{…}})`) → null; `{"error":{"message":"x"}}` → `"x"`;
     `{"error":"x"}` → `"x"`.
2. `tests/attempt-response-sites.test.js` — one new `SITES` row: `['stream-collect.mjs — an error
   frame before any text', errorFrameScript, 'stream-error-frame']`, with a **minimal inline error
   frame** (`event: error` then `data: {"error":{"message":"refused"},"message":"refused"}`, no
   `[DONE]`) in that file's own
   per-site-fixture convention — the row proves the branch was reached by asserting the reason; the
   observed LM Studio bytes are replayed verbatim in `tests/stream-error-frame.test.js` alone.
3. `tests/failure-shape.test.js` — `isRetryable({ reason: STREAM_ERROR_FRAME })` is false and
   `COMPLETION_SHAPES.has(STREAM_ERROR_FRAME)` is false.
4. `tests/review-sweep-outcome.test.js` — `serverUnwell('stream-error-frame') === false`, beside the
   existing `deadline-timeout`/`first-byte-timeout` negatives, with a one-clause reason.
5. `tests/structure.test.js` — `stream-collect.mjs` added to `RESPONSE_BOUNDARY_FILES` (its
   existing template literals interpolate only `profile.name`, already a SAFE expression there —
   confirm by running the scan; if an existing interpolation in that file trips it, that is a
   finding to report, not to allowlist silently).

## Phase 4 — docs

One line appended to the `CLAUDE.md` paragraph that begins "`scripts/lib/http.mjs` is the only place
this repo speaks HTTP": `stream-collect.mjs`'s `collectStream` throws `stream-error-frame`
(non-retryable, `failure-shape.mjs`) when a data frame carrying a top-level `error` and no `choices`
(`completion.mjs`'s `errorFrame`) arrives before any text — the shape in which LM Studio streams a
refusal as HTTP 200 — with the server's text on `.responseBody`; after text, the same frame is still
`stream-unfinished`.

## Verification

- `npm test` green (quote the summary line).
- Mutation: back up `stream-collect.mjs`, drop the `firstTextAt === null` branch's throw (make the
  check a no-op), prove it landed with `mutation-landed.py`, run the suite — expected red: the
  dated-instance and role-only cases in `stream-error-frame.test.js` (3 requests,
  `empty-completion`) and the new `attempt-response-sites` row — restore, prove the restore
  against the backup, re-run green. A second, cheaper mutation on the boundary: remove the
  `firstTextAt === null` guard alone — expected red: the text-then-error control.
- The repo `verify` skill (real plugin load + delegation round trip against the stub).
- Not re-run against live LM Studio in the suite (tests stay network-free); the real-CLI
  reproduction in `evidence/013.md` is the dated instance, and re-running that exact command after
  the change (expected: one attempt, exit 1, the server sentence on stderr) is the manual check to
  record in the tracker close-out.

## Out of scope, to be filed at the residue step if the worth bar holds

- An error frame **after** text has streamed: still `stream-unfinished` and retried, its text
  discarded. No dated instance; disclosed in the `STREAM_ERROR_FRAME` docstring.
- `context-guard.mjs`'s 3.4 chars/token estimate under-counts CJK-dense input by ~2.6x (dated
  2026-09-01: 200,308 chars estimated at 58,897 tokens overflowed a 154,624-token window). A
  separate defect; this change makes its failure loud instead of retried.
- Whether `bench/lib/reason-notes.mjs` needs a paragraph for the new code — only if a reader could
  misread it; the name says refusal-in-stream and `serverUnwell` excludes it.
