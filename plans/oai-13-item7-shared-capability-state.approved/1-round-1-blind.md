ARCHIVE — not the current spec; the live plan is the file beside it.
provenance: direct plan (no harness plan mode; unattended standing instruction)

# OAI-13 sub-item (7): share the capability `removed` state across a review's two calls

## Scope

Fix **only** OAI-13 sub-item (7). Leave (1)/(2) (`isFormatRejection` prose-matching) blocked on a
second server — their honest fix reads a vendor's status/error `type`/`code`, which needs real
vendor-error evidence this repo cannot produce. Defer (4) (`reserveFor` puts `max_tokens` on the
wire) with its named reason: removing `max_tokens` when the window is unknown changes the OAI-115
reasoning-reserve watchdog's arming, which requires a finite `maxTokens` — a separate design
question. Fixing (7) does **not** close OAI-13; strike sub-item (7) in the item body with date +
commit, item stays live.

## The defect

A `/oai:review --structured-output` run makes up to three physical model calls that must share one
capability negotiation but do not:

1. the schema request (`review-request.mjs:705`);
2. its `response_format`-rejection fallback, the unconstrained request (`:315`);
3. a salvage follow-up (`attemptSalvage`, `:504`).

Each reaches `answerWithRetry` (via `chatCompletion`), which mints a **fresh** `createNegotiation`
per call (`answer-attempts.mjs:116`). The attempt **ledger** is deliberately threaded across all
three (`send.ledger`, `review-request.mjs:677`), but the negotiation's `removed` set is not. So when
the schema request has already degraded past `stream_options`, the fallback re-offers it, collects a
second 400, reclimbs the ladder, writes a duplicate `refused` ledger entry, and — the consequence
OAI-22's review added — consumes what is left of `--max-seconds`, turning an answerable review into a
client-imposed deadline failure. Reachable only under `--structured-output` (no schema by default,
`review-request.mjs:206`).

## Design (unanimous consensus: fable-advisor + codex-rescue)

Thread **only** the capability state (`removed`, a Set of refused rung names) across the calls —
never the whole `{payload, removed, lastRung}`, whose `payload` is call-specific (the fallback drops
the schema; salvage rewrites the messages). The item's own constraint.

**Load-bearing subtlety (both approvers confirmed):** seeding `removed` *alone* makes the bug worse.
`postWithDegrade` does `RUNGS.find(c => !negotiation.removed.has(c.name) && c.matches(error))`
(`chat.mjs:67`). If the second call seeds `removed` with `stream_options` but its **fresh payload
still carries `stream_options`**, the server refuses it, `matches` is true but `!removed.has` is
false, so `find` returns undefined and the error is thrown as a **hard failure** instead of
degrading (`chat.mjs:79`). Therefore `createNegotiation(body, removed)` must also **re-apply each
already-removed rung's `apply` to the fresh payload, in `RUNGS` order**, so the call starts
already-degraded and never sends the refused capability. `capability-ladder.mjs`'s two rungs
(`stream_options`, `stream`) are each a rest-destructure safe on a body lacking the field, and
`stream.apply` already drops `stream_options` unconditionally — so pre-applying reproduces exactly
what `postWithDegrade` would have produced. `response_format` is **not** a rung (it is
`structured.mjs`'s own separate fallback), so the shared set only ever carries capability-ladder
names.

### Edits

1. **`scripts/lib/chat.mjs`** — `createNegotiation(body, removed = new Set())`: use the passed Set
   directly (not a copy — mirroring the ledger idiom, so mutations during call 1 persist into the
   shared set the later calls seed from), and pre-apply the removed rungs to the fresh payload:
   ```js
   export function createNegotiation(body, removed = new Set()) {
     let payload = body;
     for (const rung of RUNGS) if (removed.has(rung.name)) payload = rung.apply(payload);
     return { removed, payload, lastRung: null };
   }
   ```
   Update the docstring to name the shared-across-calls contract (the current one already documents
   why `removed`/`payload` are caller-owned, for the answer-retry case).

2. **`scripts/lib/answer-attempts.mjs`** — `answerWithRetry`: read `removed` from `options` and pass
   it: `const negotiation = createNegotiation(body, options.removed)`. Default `new Set()` keeps
   every caller that brings none byte-unchanged.

3. **`scripts/lib/client.mjs`** — `chatCompletion`: forward `removed: options.removed` in the
   explicit `answerWithRetry` options object (named, exactly like `ledger` at `:86` — a field left
   off here is silently dropped, the defect this file already warns about).

4. **`scripts/lib/review-request.mjs`** — `requestFindings`: mint **one** `removed = new Set()` and
   put it on `send` (`:677`), beside `ledger`. All three `chatCompletion` call sites already spread
   `...send`, so the schema request, the unconstrained fallback, and salvage inherit the one shared
   set — no per-site change. Scoped to a single `requestFindings`: `runMultiPass` calls
   `requestFindings` once per pass, so each pass gets its own set and multi-pass independence
   (OAI-9/11's pinned property) is untouched. Salvage inheritance is deliberate and in-scope (both
   approvers): salvage targets the same server/model, so a refused capability stays refused.

## Test (mutation-proved two ways, one test) — `tests/negotiation-record.test.js`

Add one e2e test beside the two existing negotiation controls. A **conditional** fake-server handler
(not a fixed `scriptOf` sequence — the request count differs between fixed and mutated code):
refuse `stream_options` on any chat body carrying it (400), else refuse `response_format` on any body
carrying it (400), else answer `FINDINGS`. Run `review --structured-output --json`, `contextLength`
large enough that no sizing shrink interferes.

Fixed-code expectations (GREEN):
- exactly **3** chat requests (`chatRequests(server).length === 3`);
- exactly **one** request carried `stream_options` (`filter(r => r.body.stream_options).length === 1`)
  — the schema request; the degraded schema request and the fallback both omit it;
- `report.attempts.length === 3`; `attempts[0].outcome === 'refused'` (stream_options),
  `attempts[1].outcome === 'refused'` (response_format, reclassified by `refuseLast` when the
  fallback dispatched), `attempts[2].outcome === 'answered'`;
- `result.status === 0`.

Mutation proofs (run both, see each RED live):
- **(a) revert the threading** (`createNegotiation(body)` — drop `options.removed`): the fallback
  mints a fresh set, re-offers `stream_options`, is refused, degrades, resends → **4** chat requests,
  two `stream_options`-bearing requests, an extra `refused` attempt. RED on the count assertions.
  Proves the threading.
- **(b) keep the threading, delete the pre-apply** (seed `removed` but don't re-apply rungs to the
  payload): the fallback body still carries `stream_options`, the server refuses it, but the rung is
  already in `removed` so `postWithDegrade` finds no rung and throws hard → the review fails,
  `result.status !== 0`. RED. Proves the pre-apply is load-bearing, not decorative.

## Verification (repo `verify` skill)

1. `npm test` green (network-free fake server).
2. Plugin surface loads (`claude --plugin-dir . -p "/oai:setup"`).
3. Live/stub delegation round trip — this change is on the shared request path; a stub round trip
   (`/oai:review` against the stub) confirms command → script → HTTP → render still works. Live LM
   Studio if one is up. The bug's own trigger (a server refusing both `stream_options` and
   `response_format`) is not reproducible against LM Studio — that is precisely why the item waited —
   so the mechanical proof is the fake-server test, and the live step proves no regression on the
   ordinary path.

## Out of scope (stated)

- (1)/(2): `isFormatRejection` prose-matching — needs a second server's real error strings.
- (4): `reserveFor`'s `max_tokens` on the wire — interacts with the OAI-115 watchdog's finite-
  `maxTokens` requirement; separate design question.
- No change to the findings-JSON reply contract, parsing, or the capability-ladder rung set.
