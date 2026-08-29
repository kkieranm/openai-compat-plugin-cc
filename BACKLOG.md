# Backlog

IDs are stable and global (`OAI-n`, never reused) and never encode order — item bodies are ordered
by priority, most urgent first (owner-directed 2026-08-27), and move as priority changes. To find a
specific item, search for its exact ID rather than scanning by number, e.g.
`grep -n '^- \*\*OAI-123\*\*' BACKLOG.md`. **`tests/backlog-structure.test.js` asserts canonical item
shape and tracker integrity (no duplicate or orphaned ID) on every `npm test`** — it does not and
cannot assert priority order, which is a judgement call. Project direction and prior header
narrative are in `CLAUDE.md`'s Work tracker section; the standing N=1-per-arm methodology note is in
its Session footguns section — not here.

## Items

- **OAI-151** — **There is no cross-run history, so no sweep can be compared with the sweeps before
  it.** Raised by the user during OAI-132's grill, 2026-08-13, as "some kind of history log using
  SQLite", and deliberately not built there.
  **Its justification is OAI-141**, which measured run-to-run spread (17 vs 22 finding-bearing commits
  on identical inputs; 5 of 17 not reproducing) *above* the difference between the configurations being
  compared. A per-commit reproduction rate across runs is the number that decides whether any sweep A/B
  means anything, and nothing can currently compute it.
  **What was settled and need not be re-derived** (ADR 022): SQLite is not more crash-durable than a
  synchronous append for the *within-run* job, and ADR 018 gates `node:sqlite` as a **capability**, so a
  hard dependency there would have made an unattended run's crash protection conditional on precisely
  what the job store kept optional. **Neither argument applies to a cross-run index**, which is not on
  the crash path and may reasonably be optional.
  **Feedstock already exists**: every run leaves `review-sweep-<stamp>.ledger.jsonl` carrying per-commit
  `startedAt`/`endedAt` and the full enumerated manifest in its header. A history would consume ledgers,
  not replace them.

- **OAI-49** — A matched-budget arm, so a cross-model comparison measures the model rather than the
  model plus its window. **Filed 2026-08-04 from OAI-19's gate grill; it is the reason that run
  publishes a deployed-systems comparison and reports the clean decomposition as NOT OBTAINED.** The
  reply budget is derived from each model's served window, so the two arms do not run the same
  instrument on the same case: measured 2026-07-30, `model-info` capped at 47,724 for the dense model
  against 74,000 for the MoE, and `scaffold` at 30,683 against 65,499 — the dense model reasoning
  under less than half the space on the corpus's largest case. `structured` differs in *input* rung
  on top of that. No case in the corpus is currently a clean model-only comparison, which is a
  stronger statement than the `structured` confound already on file and was not previously noticed.
  Options: pin an explicit `contextLength` for both profiles so the derived reserve matches; or add a
  `--reserve`/`--analysis-cap` override to the review command and run a matched arm beside the
  deployed one. The second is more honest — it leaves the shipped behaviour alone and makes the
  matched arm a separate, labelled instrument — but it is a new flag on a command whose surface this
  repo guards deliberately, so it is a decision rather than a fix.

- **OAI-50** — Decide whether a run whose context probe failed should be scored at all. **Filed
  2026-08-04 from OAI-19's gate work, where the July records answered the question by accident.**
  When `model-info.mjs` cannot detect a served window, the run proceeds with `contextChecked: false`
  and the reply budget falls back to a fixed value. **The 44,405 figure below is the July arms'
  observed `analysisCap` (a derived, character-based figure); re-checked 2026-08-24 against disk, the
  fallback constant itself is now `REVIEW_UNKNOWN_WINDOW_TOKENS = 16_384` (tokens, in
  `scripts/lib/review-request.mjs`) — the mechanism (fixed, unconditional, silent on probe failure)
  is unchanged, only the literal number is not directly comparable across the two.** Every off-pattern `analysisCap` in the
  2026-07-30 arms is exactly such a run — `config-origin` dense at 44,405 beside 74,000, `caps` MoE
  at 44,405 beside 74,000, `scaffold` MoE at 44,405 beside 65,499 — and they cluster immediately
  after a failed run, which suggests the probe fails in whatever server state a drop leaves behind.
  Those runs were **scored in July as if they were the same instrument as their siblings**, and the
  fallback is not uniformly conservative: dense `scaffold` derives 30,683, *below* the fallback, so a
  probe failure there *raises* the ceiling. OAI-19's gate (G-L) excludes them from scoring, which
  handles the benchmark. The open question is the product one: should `/oai:review` refuse, warn
  louder, or retry the probe, rather than quietly reviewing under a budget nobody chose? The size
  guard is disarmed on exactly that path, which is when an oversized request goes out unrefused.

- **OAI-159** — **Citations in this file point at an `adr/` corpus that no longer exists.** Filed
  2026-08-14 by the backlog sweep at 78 citations across 37 of that day's 99 live items, counted
  rather than estimated; re-counted 2026-08-24 by this sweep against the *current* file — the backlog
  has shrunk since filing (many carrier items closed and took their citations with them, and this
  file's own header narrative, which used to carry a few, was retired entirely to
  `evidence/backlog-header-history.md`) — to **7 dangling citations, all in live item bodies (OAI-11,
  OAI-13, OAI-45, OAI-52, OAI-56, OAI-151 — one item, OAI-151, carries two)**, out of 15 live items
  that day. **Re-counted a third time 2026-08-27 by this same consolidation sweep, after it parked
  OAI-56: 6 dangling citations across 5 live items (OAI-11, OAI-13, OAI-45, OAI-52, OAI-151 — OAI-151
  still carries two), out of 28 live items** — the newest items (OAI-207 onward, minus OAI-207 and
  OAI-56/57 themselves, now parked) carry none. The mechanism and every load-bearing example below
  are unchanged; only the headline counts were stale.
  `adr/` was deleted whole in `d1ad2aa` (2026-08-13, 23 files, owner's decision).
  **This is a decision that was deferred, not an oversight** — and the deletion commit says so in its
  own words: *"agents/oai-delegate.md and BACKLOG*.md are pinned by tests and were deliberately not
  touched"*, while comment-only references elsewhere were *"left dangling as history, matching the
  convention used for the deleted routing log"*. So the convention was chosen for code comments and
  **never applied to the tracker**, which is the file where a citation is doing different work.
  **Why the tracker is not the same case.** In a comment an `adr/020` reference is provenance a reader
  can ignore. Here it is frequently the EVIDENCE: OAI-63 argues *"Against the ADR, precisely:
  `adr/014:147-152` states the rule as three origins"*; OAI-69's urgency rests on ADR 014 accepting a
  wedge *"on the stated condition"*; OAI-138's whole cap argument turns on what `adr/021` assigns the
  deadline. Those claims are now **unverifiable by a reader**, and the ones with line numbers were
  already citations into a mutable file.
  **Distinct from the two items about counts** (OAI-110, OAI-146): those are about a figure stated in
  two places drifting. This is about the referent being gone.
  **The options, and none is "rewrite 78 citations by hand"** — that is the rebasing this repo's sweep
  discipline forbids, since it re-rots within hours: (a) declare tracker ADR references historical,
  the same convention the deletion used elsewhere, and say so once in this file's header rather than
  78 times; (b) for the handful that are load-bearing evidence, replace the reference with the
  **quoted sentence** it was standing in for, which survives the file it came from; (c) restore the
  corpus. **(a) plus (b) for the load-bearing few is the cheap combination**, and (b) is the only part
  that needs judgement — it means deciding which citations are evidence rather than provenance.
  The full list of affected items, so the judgement pass has a worklist: OAI-11, OAI-13,
  OAI-27, OAI-39, OAI-42, OAI-45, OAI-52, OAI-53, OAI-54, OAI-55, OAI-56, OAI-63, OAI-64,
  OAI-69, OAI-74, OAI-87, OAI-91, OAI-93, OAI-95, OAI-101, OAI-103, OAI-105, OAI-110, OAI-114,
  OAI-127, OAI-135, OAI-136, OAI-138, OAI-141, OAI-143, OAI-146, OAI-148, OAI-149, OAI-151, OAI-153.
  (OAI-59 dropped 2026-08-23, OAI-19 dropped 2026-08-24, each when it shipped/concluded and its body
  left this file.)

- **OAI-211** — **`bench/2026-08-23-oai19-run-notes.md` does not add up, and OAI-19's conclusions rest
  on it.** The per-case table (`:48`, `caps 1/3 ... structured 3/3`) and gate criterion G-C (`:53`,
  `caps 1x2=2`) both imply `caps` has 2 unscored runs; Codex correction #1 (`:152`) enumerates 8 runs
  with no report and names only one of them (`caps` run 2). With G-L's "all 9 scored runs" that gives
  9 + 8 = 17, not the 18 the six-cases-by-three-runs design produces. The file never states that
  "no-report" and "unscored" are the same set — a run could hold a report with `parsed: false`, which
  would be unscored yet not no-report — so the file is **ambiguous rather than provably
  self-contradictory**, and no such run is named anywhere in it. Resolving which reading is right
  needs the raw invocation-D run data, not a wording edit. Filed because this is published evidence a
  concluded item's numbers were drawn from: whichever way it resolves, one of the two accounts in the
  file is currently wrong about `caps`.

- **OAI-208** — The temp-dir leak OAI-203 fixed in one file is the suite's normal state: `mkdtempSync`
  appears in 27 files under `tests/` — recount 2026-08-27 matches the original 2026-08-24 count
  exactly — and cleanup by literal `mkdtempSync`+`rmSync` pairing exists in only 3 of them today
  (`tests/bench-warm-up.test.js`, `tests/delegate-containment.test.js`, `tests/runtime-capability.test.js`
  — **this list has drifted from the original filing**, which named `tests/job-busy.test.js` and
  `tests/job-busy-open.test.js`; those two clean up via the `stateDir()` wrapper in
  `tests/job-helpers.mjs` rather than a literal `mkdtempSync` call, so a literal grep never counted
  them as leaking or as clean — the leak count itself, ~22-24 of 27, is unchanged). **Consolidation
  sweep, 2026-08-27: kept live, not parked** — distinct from a structural-hardening ask with no
  observed harm, this defect manifests on every single `npm test` invocation, which is itself the
  dated, recurring instance. Present, deterministic and silent, the same worth-bar shape OAI-203
  itself cleared. Three related facts for whoever takes it: (1) `tests/runtime-capability.test.js:74-87`
  carries its own hand-rolled copy of the tracked-array-plus-`after`-hook machinery OAI-203 shipped
  (`TEMP_STATE`/`stateDir`); (2) **a third independent copy was found during this sweep**:
  `tests/delegate-containment.test.js:70,74` hand-rolls its own `tracked(prefix)`/`TRACKED`
  array-plus-`after()` cleanup, unrelated to either of the other two — the drift this item warned
  about is no longer hypothetical, it has already happened once more since filing, with no shared
  helper yet consolidating any of the three; (3) OAI-203's plan deliberately declined a structural
  test ratcheting "every `mkdtempSync` is tracked" while the class had one dated instance — now three
  independently-drifting copies plus 22-24 untracked files, so graduation to `tests/structure.test.js`
  should be re-judged here, not assumed either way.

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
  in [ADR 014](adr/014-async-jobs.md) where the claim is made. Reconfirmed STILL TRUE against disk,
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

