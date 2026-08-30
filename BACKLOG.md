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

- **OAI-13** — Vendor-dependent findings that need a second server to settle. ~~**Now seven.**~~
  **Five, since the 2026-08-05 sweep split two of them out as OAI-84** — they stopped being
  vendor-dependent when OAI-51 made the prose-parse path the default. Added
  2026-07-28 from the OAI-6 built-in review: `refusedField` accepts 400/422 and pattern-matches the
  quoted error body, so a validation error that *echoes the request JSON* contains `stream` and
  `stream_options` and matches both capability rungs — two spurious retries with stderr claiming a
  cause that was never established, before the real error surfaces. Bounded (each rung fires once)
  and self-correcting, so it is filed rather than patched: tightening the prose match is exactly
  the fragile guessing items (1) and (2) below already describe, and the honest fix is the same
  one — read the server's status or error `type`/`code` field instead of its prose. **The
  oversized-`max_tokens` rejection that was sub-item (4) folds in here too** — its design half was
  decided 2026-08-30 (KEEP sending `max_tokens: 16384` on the unknown-window path: the finite budget
  arms the OAI-115 watchdog on the unconstrained path and sizes `reviewSchemaFor`'s analysis ceiling,
  and no available server rejects it — LM Studio and omlx both returned HTTP 200 for
  `max_tokens: 99999999`, omlx even for `-5`; unanimous advisor + codex-rescue consensus, A over
  drop/lower), leaving only the reactive half: classify-and-degrade a *real* server's oversized-`max_tokens`
  rejection, which is the same read-the-status/`type`/`code`-not-prose work as (1) and (2) and waits
  for the same second server that actually rejects it.
  ~~**(7)** The capability negotiation was scoped to one `chatCompletion` call, so a review's
  `response_format` fallback minted a fresh `createNegotiation` and re-offered a capability the schema
  request already had refused — an asymmetry with the attempt ledger, which *was* deliberately
  threaded across both calls — consuming a round trip, a duplicate `refused` entry, and a slice of
  `--max-seconds` (an answerable review turned into a client-imposed deadline failure).~~ **SHIPPED
  2026-08-30**: the `removed` capability state is now minted once per `requestFindings` and shared
  across a review's calls (schema request → `response_format` fallback → salvage follow-ups) on the
  `send` object; `createNegotiation(body, removed)` pre-applies each already-removed rung to the fresh
  payload in `RUNGS` order, since seeding the set alone would re-refuse and hard-throw. Only the
  `removed` state is shared, never `{payload, lastRung}`. Mutation-proved in
  `tests/negotiation-record.test.js` (revert threading → 4 requests not 3; drop the pre-apply →
  hard-throw). A review-ladder adversarial pass raised, and unanimous consensus dismissed as
  unobserved and vendor-dependent (this item's own deferred class), the question of whether full
  streaming (`stream`) can be refused *conditionally on* `response_format`: if a second server ever
  did, sharing the `stream` rung across the `response_format` boundary could force a needless
  non-streamed fallback — deferred here because no server does, the failure would be loud, and keying
  the set by `response_format` presence would break the `stream_options` case, which is global (built
  on every body regardless of `response_format`). **This closes only (7); the item stays live for
  (1) and (2)** (and (4)'s reactive residue, now folded into them above).
  The original five, from the OAI-4/OAI-10 built-in review, all vendor-
  dependent and none reproducible against LM Studio. They need a second server to settle, so they
  wait for one rather than being fixed blind. (1) `isFormatRejection` reads
  ~~`error.message`~~ **`error.responseBody` (field attribution corrected 2026-08-24 against disk —
  OAI-185, 2026-08-20, moved this read off `.message` entirely; the 400-char truncation itself is
  unchanged, it just lands on `.responseBody` now, per `scripts/lib/provider.mjs:131`)**, which
  ~~`client.mjs`~~ **`provider.mjs` (file attribution corrected 2026-08-14 against disk; `client.mjs`
  has no truncation logic at all)** truncates to 400 characters — a server whose validation dump names `response_format`
  later never triggers the degrade path, and `/oai:review` dies on a raw 400 instead. (2) The same
  matcher fires on *any* 400 whose body echoes the request, asserting "rejected response_format"
  as a cause it only guessed. ~~(3)~~ **and** ~~(5)~~ **left this item on 2026-08-05 — see the split
  note below.** ~~(4) With the window unknown, `reserveFor` still puts `max_tokens: 16384` on the
  wire, where `/oai:task` sends none — a server that rejects an oversized `max_tokens` fails for a
  reason the plugin chose.~~ **(4)'s design half DECIDED 2026-08-30 (keep — see the fold-in note
  under the top of this item); its reactive residue merged into (1)/(2).** Fixing (1) and (2)
  properly probably means the server's status or error `type`/`code` field rather than prose, which
  is an ADR 002 shape-not-name question and the reason this is one item rather than five.

  **(1) and (2) are reachable only when `--structured-output` is passed** (no schema sent by
  default, `review-request.mjs:206`) — narrower than when filed, and one more reason they wait for a
  second server. (3) and (5) went the other way and moved to **OAI-84** 2026-08-05: the default
  prose-parse path runs the same `parseFindings`, so they stopped being vendor questions and became
  defects on the shipped default.

