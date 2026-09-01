# Backlog

IDs are stable and global (`OAI-n`, never reused) and never encode order — item bodies are ordered
by priority, most urgent first (owner-directed 2026-08-27), and move as priority changes. To find a
specific item, search for its exact ID rather than scanning by number, e.g.
`grep -n '^- \*\*OAI-123\*\*' BACKLOG.md`. **`tests/backlog-structure.test.js` asserts canonical item
shape and tracker integrity (no duplicate or orphaned ID) on every `npm test`** — it does not and
cannot assert priority order, which is a judgement call. Project direction and prior header
narrative are in `CLAUDE.md`'s Work tracker section; the standing N=1-per-arm methodology note is in
its Session footguns section — not here.

References to a numbered `adr/NNN` ADR name the retired ADR corpus, deleted whole in `d1ad2aa`
(2026-08-13); they are historical provenance beside a claim stated inline, not live links, and are
deliberately not rebased (rewriting each one re-rots within hours — this repo's sweep discipline).

## Items

- **OAI-229** — **LM Studio delivers a request refusal as an HTTP 200 stream frame, and the plugin
  reads it as an empty completion and retries it.** Dated instance 2026-09-01, through the real CLI
  (`evidence/013.md`): with `stream: true` — the default — a context overflow or an out-of-range
  sampling value comes back as `200 text/event-stream` whose only event is `event: error` with
  `data: {"error":{"message":…},"message":…}` and no `[DONE]`. `sse.mjs` drops `event:` lines by
  design and yields the data frame; `applyFrame` finds no `choices`; `refuseUnusable` classifies it
  `empty-completion`, which is on `failure-shape.mjs`'s RETRYABLE whitelist — so the run re-sent a
  request that refuses identically three times, took 5.6s, and reported "returned a completion with
  no message content" with the server's own sentence (*The number of tokens to keep from the initial
  prompt is greater than the context length*) discarded. Reachable today via context overflow:
  `context-guard.mjs` estimates 3.4 chars/token and CJK text tokenizes near 1, so a 200,308-char
  prompt estimated at ~58,897 tokens overflowed a 154,624 window. Every out-of-range sampling value
  LM Studio refused is also refused client-side by `parseNumber`, so those are not reachable; the
  `response_format` refusals still arrive pre-stream as 400 and are unaffected. Fix (Codex-steered):
  detect on the frame's SHAPE in `readSse` — a top-level `error` object and no `choices` — never on
  the `event:` line the parser deliberately does not interpret; throw a `UserError` with a new
  non-retryable reason (`stream-error-frame` — not `*-timeout`, which bench reads as timing),
  `serverResponded: true`, the server's message bounded on `.responseBody` and never in `.message`;
  not added to RETRYABLE or `COMPLETION_SHAPES`, not fed to the capability rungs or
  `isFormatRejection` (both gate on HTTP 400/422), and `bench/lib/sweep-outcome.mjs`'s
  `serverUnwell` must return false for it (a refusal, not server health). The overflow stays a loud
  failure — the frame proves a refusal, not an oversize, and routing it into `review-ladder.mjs`'s
  size degrade would conflate it with the separate chars-per-token estimation defect. Test: replay
  the observed frame verbatim through the fake server, pin ONE request, the reason, the field
  placement and the preserved server text; mutation-prove by reverting the detection (three
  attempts and `empty-completion` return). Whether some of the 2026-07-30 "empty completion" sweep
  failures were this shape is unknown — no raw body was kept — and is not claimed.
