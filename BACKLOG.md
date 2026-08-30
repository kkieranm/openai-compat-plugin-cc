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

- **OAI-210** — **Three `doesNotMatch` assertions in `tests/answer-channel.test.js` cannot fail.** The
  three marker tests (`:75`, `:95`, `:115`) each read `const messageLine = result.stderr.split('\n')[0]`
  and assert the server-controlled `finish_reason` marker is not fused into it. Line 0 of stderr is
  always `scripts/lib/delegate.mjs:145`'s `Checking <profile> for available models and context
  window...` progress line, never the error line the message lands on — so `messageLine` cannot
  contain the marker whatever the code under test does. A second, independent defeat: every guarded
  message ends in a period before `oai-companion.mjs:71`'s ` (${detail})` parenthetical, so the
  patterns `content \(`, `completion \(` and `answer \(` cannot match a period-preserving fusion
  either. Dated instance 2026-08-25: interpolating `finishReason` into `.message` at the three throw
  sites (`scripts/lib/completion.mjs:140`, `:161`, `client.mjs`'s empty-answer throw) and deleting the
  separate `.finishReason` assignment left all 8 tests in the file passing. The paired
  `assert.match(result.stderr, marker)` halves do work. **Not an open hole in the property itself**:
  `tests/structure.test.js:438`'s source-level scan catches that same mutation, so "no
  server-controlled value reaches a `UserError` message" stays pinned repo-wide — these three
  assertions are dead weight claiming to pin it. Whoever takes it should decide between repointing
  them at the real error line and deleting them as redundant with the structural scan; a fix that
  keeps them must be mutation-proved, since that is the property they failed.

- **OAI-228** — **A review reply that is valid `{"findings":[{file, line, message}]}` JSON is discarded
  wholesale because the findings key their description `message` instead of `summary`.** Dated
  instance 2026-08-30 (OAI-49's matched arm, `bench/2026-08-29-oai49-matched-arm.md`): the MoE
  `qwen/qwen3.6-35b-a3b` lost **5 runs of real findings this way** — all 3 `caps` runs (4, 1 and 5
  findings) and 2 `hold2-hostile-coercion` runs — each a syntactically valid JSON object with a
  populated `findings` array whose items carry `file`, `line` and `message`, which `JSON.parse`
  accepts and `parseFindings` then returns `null` on. The mechanism is `findings-candidate.mjs`'s
  `named` predicate (via `structured.mjs` `parseFindings` → `findingsShaped`): a finding is admitted
  only when it names both a `file` **and** a `summary`, so an array where every item uses `message`
  (or `code`+`message`) as the description names no element and the whole reply reads UNREADABLE —
  the same "real model work discarded" class as OAI-156, exercised live, not latent. The schema
  requests `file, line, severity, summary, evidence` (`review-schema.mjs:157`), so `message` is a
  model deviation from the asked shape — **the fork this item is: is accepting `message`/`description`
  as a `summary` alias the plugin's job (its whole lenient-parse philosophy — `findings-yaml`,
  `findings-empty` — says maybe yes, since the work is real and the deviation reasonable), or is the
  discipline that a reviewer must emit the requested field worth keeping (accept the alias and the
  next model spells it a third way)?** Note it discriminated the models here: the dense arm lost 0
  runs to this (its 7 non-scored runs were reasoning **prose**, a different, model-attributable
  cause), so the gap silently penalised whichever model happened to choose `message`. Any fix that
  widens `named` must be mutation-proved and must not re-admit the decoy shapes `findings-candidate.mjs`'s
  own comments document as hard-won. Raw replies: the two per-run records named in the doc.

- **OAI-9** — Multi-pass review with a deduplicated union, because a single pass is a lottery.
  Measured on one 135-line file with two known defects (`config.mjs` at `8990173`, both fixed later):
  five runs of the same command produced 1 real defect, 3 false positives, 2 empty results and 1
  budget failure — a **20% hit rate per run**, with output varying 1,709→5,450 tokens for identical
  input and quality tracking that spend. Independent passes are the lever: each costs ~40–90s and
  nothing else, and unioning three or four would have caught both real defects instead of gambling on
  one. Same shape as the loop-until-dry pattern. Needs: N passes (default 3?), dedupe on
  file+line+claim, and a count of how many passes reported each finding — agreement across
  independent passes is itself a confidence signal worth showing, since it is the closest thing to a
  free verifier. Decide whether passes run concurrently (one local model, so probably not) and how
  this interacts with OAI-8's progress reporting, which it makes far more necessary.
  **The "~40–90s each" estimate is wrong for passes 2..N, and now measurably so.** Every pass after
  the first sends the same prompt, so it is a prompt-cache hit: measured on a 56,805-token request,
  first token at 421.7s cold against 11.5s warm. The marginal pass is therefore *much* cheaper than
  the first — good for the feature, and an argument for more passes rather than fewer — but it makes
  a per-pass average meaningless, and any timing quoted for "a review" must say whether it is the
  cold one. OAI-18 landed `prefillMs`/`generationMs`, so this is now visible per pass rather than
  hidden inside a total; use them when costing this.

- **OAI-11** — Diverse passes: different models, and different lenses.
  **Check the rate metric before comparing across *servers*.** OAI-17's `gen tok/s` divides
  provider-reported `completion_tokens` by a window running from the first text frame to the end of
  the stream, so a server that delays its `usage`/`[DONE]` frame inflates the divisor by however long
  it delays — unbounded, and undetectable from here. Within one server (lenses, or JIT-swapped models
  on LM Studio) the figure is sound and this does not apply. Across two providers it is only sound if
  both terminate promptly, so a cross-server pass needs that checked first or the comparison measures
  protocol behaviour rather than throughput. Raised by the OAI-17 adversarial review at 0.96
  confidence and left stated rather than fixed, because on the measured case the divisor was 81–265s
  against sub-millisecond terminators. **OAI-9 decorrelates sampling
  noise; this decorrelates blind spots**, which is the more valuable axis — repeated samples of one
  model share its failure modes, so agreement between them says much less than agreement between two
  models trained differently. That makes cross-model agreement a genuinely strong confidence signal
  where cross-sample agreement is only a weak one.
  Three ways to get diversity, cheapest first: different **lenses** on the same model (one pass for
  correctness, one for security, one for edge cases) — free, and available today with one model
  loaded; different **models on different providers**, which is exactly what ADR 001's
  providers-as-data buys us, and the case where passes can genuinely run concurrently; different
  models on **one** provider, which on LM Studio means paying a JIT load between passes and is
  probably the worst of the three.
  Build OAI-9 so a pass carries its own `{provider, model, lens}` rather than inheriting one global
  target — then this is a config change, not a rewrite. Open question worth an experiment before
  committing: whether three lenses on one model beats three plain passes, since that would deliver
  most of the value with no second model to install.

- **OAI-45** — Close the two holes in OAI-34's end-to-end matrix. **Small, and filed because the
  matrix reads complete and is not.** OAI-34's own rule is "every verdict-bearing check gets a
  scenario crossing the real entry point", with one *stated* exemption (G8, structurally impossible to
  produce from a fake server). Measured after it shipped, there are two unstated ones:
  **(1)** `no-exposure` is the only episode verdict of the seven with no e2e scenario — every harness
  scenario uses a 500ms reply against a 300ms bar, so nothing ever produces a request that fails to
  clear the margin. It is the verdict that catches a wasted episode, so a break in it would show up
  as the sweep silently banking runs that tested nothing. A scenario needs only a reply delay below
  the bar. **Refined by the 2026-08-27 consolidation sweep**: `no-exposure` IS exercised today, but
  only by direct unit calls against the pure verdict function (`tests/ttl-vocabulary.test.js`,
  `tests/ttl-verdict.test.js`) — never through the real end-to-end driver/stub matrix, which is what
  this item is actually about. The gap is narrower than "untested" but the claim stands: nothing
  proves the verdict is *reachable through the real entry point*, which is OAI-34's own stated rule.
  **(2)** `tests/ttl-stub-lms.mjs` documents five scenario knobs; **three are used by no test** —
  `unreadableFromMs`, `lastUsedAdvances`, `failLoad`. Unused affordances in a fixture are worse than
  absent ones: they read as coverage. Either exercise them (the first two map to real recorded
  fields — polling continuity and the `lastUsedTime` evidence ADR 013 requires be recorded and never
  branched on) or delete them and the doc lines that advertise them.
  **Sharpened by OAI-34's real run, 2026-08-04: `lastUsedAdvances` models a state that does not
  occur.** LM Studio reports `lastUsedTime: null` for the whole time it is serving a request, so
  `activityObserved` returned `null` in every episode and the "advancing timestamp" the knob
  simulates was never observed against the real server. A fixture knob that produces a shape the
  vendor does not is worse than an unused one — a test built on it would pin the instrument against
  fiction. So for this knob the choice is narrower than for the other two: **delete it, or keep it
  explicitly as a not-observed-in-the-wild case and say so in the doc line.** `unreadableFromMs`
  is untouched by this and remains a genuine shape (the run recorded `unreadableSamples: 0`, so it
  is real but did not occur).
  Note the mechanical check that found both is worth keeping as a guard rather than a one-off: the
  set of episode verdicts reachable through the e2e matrix should be compared against
  `EPISODE_VERDICTS` minus the stated exemption, so the next hole fails the suite instead of waiting
  for a review.

- **OAI-52** — **Six items from OAI-3's own verification list did not land.** Filed the day the
  feature shipped, from reading the plan's verification section back against the tests that exist,
  so that `BACKLOG_DONE.md`'s OAI-3 entry cannot read as complete coverage. **Consolidation sweep,
  2026-08-27: verified STILL TRUE against disk, then worth-barred sub-item by sub-item — (2), (4)
  and (5) had no dated instance of the property they guard actually failing and no silent-failure
  argument, so they parked to `BACKLOG_PARKED.md` (`not worth doing`); (1) and (3) were already
  resolved/superseded; (6) is the one sub-item that survives live.**
  **~~(1) `scripts/lib/job-auth.mjs` has no test at all — neither side of it.~~ DONE 2026-08-05** —
  `tests/job-auth.test.js`, 8 tests, mutation-proved, shipped with a positive control. Full evidence
  moved to `BACKLOG_DONE.md`'s OAI-58 entry, 2026-08-24.
  **(3) is superseded by OAI-62**, which found the property is not merely untested but false at two
  sites, one of which kills a running worker.
  **(6) No session identifier appears in a row, and the one guard against it cannot be shown to
  fail.** `tests/status.test.js:43` asserts `doesNotMatch(JSON.stringify(row), /session/i)` (added in
  `3e7d429`, predating this filing) with no positive control proving the regex can ever match — a
  string match on a JSON dump would catch a column *named* with that word but not a session id stored
  under an unrelated key. **This clears the worth bar via the silence exception, not a dated
  instance**: the failure mode this guards against is a session identifier leaking into a persisted
  row, which is exactly the kind of defect an unfalsifiable check would hide rather than catch — an
  instance would only ever be observed by someone reading raw job rows by hand, which is the absence
  this check exists to make unnecessary. It is the property that distinguishes this design from the
  reference plugin's, whose `SessionEnd` sweep depends on exactly the field this schema omits. Noted
  in ADR 014 where the claim is made. Reconfirmed STILL TRUE against disk,
  2026-08-27 sweep: no positive control has been added since filing.

- **OAI-13** — Vendor-dependent findings that need a second server to settle. ~~**Now seven.**~~
  **Five, since the 2026-08-05 sweep split two of them out as OAI-84** — they stopped being
  vendor-dependent when OAI-51 made the prose-parse path the default. Added
  2026-07-28 from the OAI-6 built-in review: `refusedField` accepts 400/422 and pattern-matches the
  quoted error body, so a validation error that *echoes the request JSON* contains `stream` and
  `stream_options` and matches both capability rungs — two spurious retries with stderr claiming a
  cause that was never established, before the real error surfaces. Bounded (each rung fires once)
  and self-correcting, so it is filed rather than patched: tightening the prose match is exactly
  the fragile guessing items (1) and (2) below already describe, and the honest fix is the same
  one — read the server's status or error `type`/`code` field instead of its prose.
  **(7) Added 2026-08-01, moved here from OAI-22 when that item closed.** The capability negotiation
  is scoped to one `chatCompletion` call, so a review's `response_format` fallback mints a fresh
  `createNegotiation` and re-offers a capability the schema request already had refused — an
  asymmetry with the attempt ledger, which *was* deliberately threaded across both calls. Needs a
  server refusing BOTH `stream_options` and `response_format`, which nothing here has. **The OAI-22
  review added a consequence beyond the wasted round trip and the duplicate `refused` entry**: that
  needless refusal can consume what is left of `--max-seconds`, turning an answerable review into a
  client-imposed deadline failure. When it is fixed, only the capability state (`removed`) may be
  shared across the two calls — never the whole `{payload, removed, lastRung}`, whose payload is
  call-specific.
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
  note below.** (4) With the window unknown, `reserveFor` still puts `max_tokens: 16384` on the
  wire, where `/oai:task` sends none — a server that rejects an oversized `max_tokens` fails for a
  reason the plugin chose. Fixing (1) and (2) properly probably means the server's status
  or error `type`/`code` field rather than prose, which is an ADR 002 shape-not-name question and
  the reason this is one item rather than five.

  **(1), (2) and (7) are reachable only when `--structured-output` is passed** (no schema sent by
  default, `review-request.mjs:206`) — narrower than when filed, and one more reason they wait for a
  second server. (3) and (5) went the other way and moved to **OAI-84** 2026-08-05: the default
  prose-parse path runs the same `parseFindings`, so they stopped being vendor questions and became
  defects on the shipped default. Sub-item (4)'s reach is unchanged.

