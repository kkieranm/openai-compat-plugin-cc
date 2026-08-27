# Backlog

IDs are stable and global (`OAI-n`, never reused). Item bodies sit in ascending ID order.
**`tests/backlog-structure.test.js` asserts this on every `npm test`.** Project direction and prior
header narrative are in `CLAUDE.md`'s Work tracker section; the standing N=1-per-arm methodology note
is in its Session footguns section — not here.

## Items

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

- **OAI-45** — Close the two holes in OAI-34's end-to-end matrix. **Small, and filed because the
  matrix reads complete and is not.** OAI-34's own rule is "every verdict-bearing check gets a
  scenario crossing the real entry point", with one *stated* exemption (G8, structurally impossible to
  produce from a fake server). Measured after it shipped, there are two unstated ones:
  **(1)** `no-exposure` is the only episode verdict of the seven with no e2e scenario — every harness
  scenario uses a 500ms reply against a 300ms bar, so nothing ever produces a request that fails to
  clear the margin. It is the verdict that catches a wasted episode, so a break in it would show up
  as the sweep silently banking runs that tested nothing. A scenario needs only a reply delay below
  the bar.
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

- **OAI-52** — **Six items from OAI-3's own verification list did not land** — ~~five~~ **four remain
  here, both corrections dated 2026-08-05: item (1) is done, and item (3) was superseded by OAI-62,
  which found the property is not merely untested but false at two sites.** Item (6) also survives in
  a weaker form than filed — see its entry. Filed the day the feature shipped, from reading the plan's
  verification section back against the tests that exist, so
  that `BACKLOG_DONE.md`'s OAI-3 entry cannot read as complete coverage. None of these is a known
  defect; each is a property the plan said would be proved and that nothing currently proves. Ordered
  by what it would cost to be wrong about.
  **~~(1) `scripts/lib/job-auth.mjs` has no test at all — neither side of it.~~ DONE 2026-08-05** —
  `tests/job-auth.test.js`, 8 tests, mutation-proved, shipped with a positive control. Full evidence
  moved to `BACKLOG_DONE.md`'s OAI-58 entry, 2026-08-24, to keep this item's still-open sub-items
  readable.
  **(2) `state='running'` and `worker_pid` are never observable apart.** The plan called for this as
  an *atomicity* assertion, having previously called for a test of the window between them — which
  the one-transaction design makes unreachable, and a test that cannot fail was itself a gate finding.
  The property holds by construction today; nothing notices if a later edit splits the `UPDATE`.
  **(3) A `SQLITE_BUSY` expiry is retried, never terminalized.** `isBusy` exists in `job-store.mjs`
  and three call sites use it, but no test contends the database hard enough to produce one. This is
  the failure that kills live work if it ever regresses — a job failed because two processes wrote at
  the same moment.
  **(4) A real process killed mid-transaction leaves either the pre-transaction or the committed
  state, never a partial one.** This is a claim about SQLite rather than about this code, which is why
  it is fourth; but the design rests on it, and the repo's own habit is that a load-bearing claim gets
  executed rather than cited.
  **(5) The submitter writes the row exactly once on the success path** — counted through an injected
  store, **not** by mtime, an mtime being the last write rather than a count.
  **(6) No session identifier appears in a row.** ~~Structurally true … and guarded by nothing.~~
  **Corrected 2026-08-05 by the OAI-58 ladder: this sub-item was misfiled.** A guard exists —
  `tests/status.test.js:43` asserts `doesNotMatch(JSON.stringify(row), /session/i)` — and it was added
  in `3e7d429`, *inside* the OAI-3 range and **predating this filing** (`370efc1`). What is true is
  weaker than "no test": the check is a string match on a JSON dump, so it would catch a column *named*
  with that word but not a session id stored under an unrelated key, and it carries no positive control
  proving it can fail. So the remaining work is to strengthen an existing guard, not to write a missing
  one. It is the property that distinguishes this design from the reference plugin's, whose `SessionEnd`
  sweep depends on exactly the field this schema omits. Noted in
  [ADR 014](adr/014-async-jobs.md) where the claim is made.
  **(3) is superseded by OAI-62**, which found the property is not merely untested but false at two
  sites, one of which kills a running worker.

- **OAI-56** — The prefill-overlap bound: a cancelled or dead job can hold the server for the
  remainder of its prefill after the queue has moved on. **Measured, not assumed** — LM Studio says so
  itself on disconnect ("If the model is busy processing the prompt, it will finish first"), and
  prefill is the expensive half here at ~335s dense / ~67s MoE. Same model next: only a slowdown.
  Different model next: its JIT load overlaps that prefill, which is the two-models-resident case the
  memory ceiling forbids. **Deliberately not mitigated in OAI-3**, because the obvious mitigation —
  polling `lms ps` for idleness before dispatch — is a vendor-specific check in a plugin that is
  generic by construction ([ADR 001](adr/001-generic-openai-compatible-plugin.md)), and would put an
  `if LM Studio` where the whole repo has providers-as-data. Any fix must be shaped as configuration
  or as a generic post-cancel settle delay, not as a vendor probe.

- **OAI-57** — No `--json` on `/oai:status` or `/oai:result`. **The `/oai:task` half shipped
  2026-08-05** (`TASK_SPEC.booleanFlags` now includes `json`, mirroring `/oai:review`'s envelope) —
  full evidence moved to `BACKLOG_DONE.md`'s "OAI-57 (the `/oai:task` half)" entry, 2026-08-24, to keep
  this item's still-open ask readable. What remains live is `/oai:status` and `/oai:result`. OAI-80(a)'s forgeable `attachments` line is
  still the reason to want the status half — *OAI-80 was parked 2026-08-18, `not worth doing`, so this
  is a reason and no longer a dependency.* Left out of OAI-3 phase 4 as unrequested surface, and
  recorded here so the omission is a decision rather than an oversight. Still small (the rows are
  already JSON-shaped records) but a **contract** the moment it exists — the enumerated-field problem
  OAI-36 describes for the bench reliability prose applies to it exactly. Do it when something
  actually consumes it (the `oai-delegate` agent in OAI-5 is the likely first consumer), and version
  the envelope when you do.

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

- **OAI-159** — **Citations in this file point at an `adr/` corpus that no longer exists.** Filed
  2026-08-14 by the backlog sweep at 78 citations across 37 of that day's 99 live items, counted
  rather than estimated; re-counted 2026-08-24 by this sweep against the *current* file — the backlog
  has shrunk since filing (many carrier items closed and took their citations with them, and this
  file's own header narrative, which used to carry a few, was retired entirely to
  `evidence/backlog-header-history.md`) — to **7 dangling citations, all in live item bodies (OAI-11,
  OAI-13, OAI-45, OAI-52, OAI-56, OAI-151 — one item, OAI-151, carries two)**, out of 15 live items
  today. The mechanism and every load-bearing example below are unchanged; only the headline count was
  stale.
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

- **OAI-207** — `bench/lib/sweep-outcome.mjs` has two pre-existing gaps, neither introduced by OAI-204
  but both found while auditing its diff: (1) `reported()` reads `report?.salvaged` explicitly but
  never reads the new `salvageTrim` field, so a sweep's outcome classification is blind to whether a
  rescued run was trimmed, fell back untrimmed, or wasn't eligible — out of scope for OAI-204 itself
  (that field's design is explicitly JSON-only, no sweep-integration was ever asked for), but a real
  gap for anyone wanting to compare trim-vs-fallback rescue rates from `bench/review-sweep.mjs` output
  without reading raw JSON records by hand. (2) `STARVED_REASONS` (a `Set` including
  `'token-reserve-cutoff'`/`'reasoning-only'` plus `'token-exhaustion'`) is a third, independently
  maintained copy of a reason list that overlaps but does not match either
  `SALVAGE_SMALL_RESERVE_REASONS` or `SALVAGE_REASONS` in `scripts/lib/review-request.mjs` — the exact
  drift risk OAI-204 consolidated those two into one shared `Set` specifically to prevent, one file
  over. Found by acceptance-audit's whole-artifact scout during the OAI-204 review-ladder, 2026-08-24.

- **OAI-208** — The temp-dir leak OAI-203 fixed in one file is the suite's normal state: `mkdtempSync`
  appears in 27 files under `tests/`, and cleanup exists in only 3 (`tests/job-busy.test.js`,
  `tests/job-busy-open.test.js`, `tests/bench-warm-up.test.js`) — counted by repo-wide grep,
  2026-08-24, during OAI-203's probe; every other file leaks its scratch dirs on every `npm test`.
  Present, deterministic and silent, the same worth-bar shape OAI-203 itself cleared. Two related
  facts for whoever takes it: (1) `tests/runtime-capability.test.js:74-87` already carries its own
  hand-rolled copy of the same tracked-array-plus-`after`-hook machinery OAI-203 shipped
  (`TEMP_STATE`/`stateDir`), so the suite now holds two independently-maintained copies that can
  drift — the OAI-203 `/simplify` reuse reviewer proposed extracting a shared helper into
  `tests/helpers.mjs` with both entry points (`tracked(prefix)` and a bare `track(path)` for
  non-mkdtemp paths), rejected there only as out of that item's approved scope; (2) OAI-203's plan
  deliberately declined a structural test ratcheting "every `mkdtempSync` is tracked" while the
  class had one dated instance — a suite-wide fix is the recurrence that decision named, so
  graduation to `tests/structure.test.js` should be re-judged here, not assumed either way.


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

- **OAI-212** — **A keyed, whole-document clean review is visibly discarded as `parsed: false`.** A
  reply whose ENTIRE text is `findings: []`, an `analysis:` paragraph and a `summary:` scalar — an
  unambiguous "no defects found" — is read by nothing and reported unreadable, while the same
  whole-document shape carrying one or more block-list items parses fine. The failure is asymmetric in
  the worst direction for a reviewer: a clean review is indistinguishable from a broken run, and only
  the clean one is lost. **Four observed replies across two dates**, not four independent
  reproductions: `bench/2026-08-08-oai19-run-notes.md:71` records two, correlated within a single
  qwen MoE invocation and pre-dating `findings-yaml.mjs` entirely, dismissed at the time as the model
  not following the format; 2026-08-25 reproduced it live on `google/gemma-4-12b-qat` and again on
  `google/gemma-4-26b-a4b-qat`, which is what establishes the gap is still open on today's tree.
  Neither model family is the subject — qwen produced it too. **Two rejections, in order**:
  `findings-yaml.mjs`'s first-line test requires line one to equal `findings:` exactly, so
  `findings: []` is refused before the flow-collection rule is ever consulted; `findingsIn` then falls
  through to `extractJson`, which scans the `[]` and hands it to `findingsShaped`, whose scanned-array
  branch requires a non-empty list. Each rule is defensible where it stands — the YAML acceptor is
  deliberately a narrow whole-document grammar rather than a YAML parser, and the non-empty rule
  refuses a trailing decoy that names nothing — and the reply falls between them. Verified by calling
  `parseFindings` directly rather than by reading it: `{"findings": [], "summary": "..."}` and a bare
  `[]` are both accepted as whole replies, block-style YAML with one item is accepted, and every
  `findings: []` variant returns `null`. **This does NOT meet OAI-112's reopening bar**, which names a
  SILENT wrong-candidate selection; here nothing is selected and the run says so. It does sit against
  that item's own carried evidence that *"a lone scanned empty could be accepted while genuine
  competitors are refused"*, and OAI-112's candidate-selection replacement could cure this symptom
  through the `extractJson` fallback without touching the YAML acceptor at all — so the two may later
  merge, and this item does not claim the YAML half is the only adequate fix. It does not inherit
  OAI-112's withdrawn-design plan gate. See also OAI-156 for the whole-document boundary the YAML
  acceptor was drawn at.

- **OAI-213** — **The sweep report interpolates untrusted text into Markdown at three sinks, and the
  worst is reached by every ordinary run.** OAI-209 closed one of them (`entry.reason`, via
  `displayReason`) after a `token-reserve-cutoff` row corrupted its own line; the focused
  trust-boundary sweep run at that item's review then traced every other value reaching rendered
  Markdown and found three more, all pre-existing and all by routes that change did not touch.
  **`finding.summary` is the worst**: model-authored prose about code, arriving through the
  unconstrained parser `bench/review-sweep.mjs` always uses — it never passes `--structured-output`,
  and `normalizeFinding` applies no cap and no filtering there, the schema's `maxLength` being prompt
  text a grammar engine may honour rather than anything this client enforces. It renders as plain
  text with **no code span and no newline handling**, so a triple backtick opens an unterminated
  fenced block and swallows the rest of the report, and a blank line breaks the list. Findings that
  quote source are the ordinary shape of a review reply, not an edge case. `finding.file` and
  `finding.evidence` share the route; `evidence` at least converts newlines to blockquote
  continuations. **`entry.model`** is a server-reported id echoed into a code span at two sites
  (`answeredBy`, and again inside `findingsBlock`), unbounded and unescaped — structurally the same
  shape as the defect OAI-209 fixed, and adjacent to the OAI-185 residue about a server-reported
  model id reaching a `UserError` message, though this is a different sink that note does not cover.
  **`entry.subject`** is a git commit subject, foreign under `--repo`. Dated instance 2026-08-25: the
  `entry.reason` case was reproduced by executing the renderer, and the enumeration above was
  verified the same way. Filed rather than fixed in OAI-209 because the routes are independent of
  that item's subject and predate it — a judgement `codex-adversarial` was asked to argue against and
  upheld ("different input route, different rendering contract, no causal overlap").
  **Amended 2026-08-25, same day, before the sweep's own enumeration was lost**: the three sinks
  above are not the whole boundary. The report's HEADER interpolates `record.repo`,
  `record.requestedModel` and `record.include` — operator-supplied strings, two of them inside code
  spans — unescaped and unbounded. And `bench/lib/sweep-ledger.mjs`'s `envelopeOrNull` (`:204-207`)
  validates only that `envelope.commits` is an array, so every other header field is unchecked: a
  ledger written by a different build can deliver any of them as an unexpected type or shape
  straight to those sites, which is the same cross-build route that made the `entry.reason` case
  reachable rather than theoretical. Whoever takes this should treat the corrective decision as one
  question — which values reaching this renderer are trusted, and what bounds the rest — rather than
  patching the sinks one at a time, since patching one at a time is exactly how OAI-209 found a
  fourth after fixing three.


- **OAI-214** — **The request body cannot express the parameters a model's own vendor says it needs,
  and a benchmark was invalidated by one.** `scripts/lib/client.mjs`'s body carries `model`,
  `messages`, `stream`, `stream_options` plus optional `temperature`, `max_tokens` and
  `response_format` — and nothing else. There is no `reasoning_effort`, no `top_p`, no `top_k`, no
  `min_p`, no `presence_penalty`, and no route to a chat template's own variables. **Dated instance
  2026-08-25**: `qwen/qwen3.8-27b` scored 0 of 6 cases on the `bench/` corpus, every case lost to a
  runaway that never wrote an answer, because the model ships with `reasoning_effort` defaulting to
  `xhigh` — its most verbose setting, which its release notes and third-party write-ups both single
  out as the thing to change first. The parameter was reachable all along: LM Studio honours it, and
  a direct API probe measured 74 reasoning tokens at `xhigh` against 36 at `low` on a trivial prompt.
  The plugin simply had no way to send it, so the benchmark measured the model at its worst setting
  and recorded the result as the model's. Vendor sampling recommendations are unreachable by the same
  gap: qwen and gemma both publish per-mode `temperature`/`top_p`/`top_k`/`min_p` values, and qwen
  splits `presence_penalty` by task, none of which this repo can express. **Not a request for a
  generic passthrough** — an arbitrary body-merge would let a caller overwrite `messages` or
  `stream`, which the transport's own contracts depend on. Whoever takes it should decide what the
  admitted set is and where it is validated.

- **OAI-215** — **`bench/run.mjs` cannot set the one option that made reviews work.** Its
  `SPEC.valueFlags` is `['runs', 'provider', 'model', 'timeout', 'max-seconds', 'max-attempts']`:
  no `max-tokens`, and no `temperature` either, though `/oai:review` accepts both. **Dated instance
  2026-08-25**: adding `--max-tokens 8192` to a review of one commit cut a `qwen3.5-4b-mlx` run from
  740s producing zero findings to 208s producing three, by dropping the token-reserve watchdog's
  firing threshold from ~92,160 reasoning characters to ~18,432 so a runaway is cut early enough for
  salvage to still answer. The benchmark cannot express that configuration, so it necessarily scores
  every model at the default reserve — `min(32768, contextLength/2)` — which is the configuration
  observed producing ~700s runaways and empty answers across the dense 27b class the same day. The
  effect is not neutral across models: the reserve is derived from the served window, so a model with
  a large window is given more rope than one with a small window, and the benchmark's own rows are
  therefore not budget-comparable to each other.

- **OAI-216** — **`--max-seconds` does not bound the command, and CLAUDE.md says it does.**
  `CLAUDE.md` states `--max-seconds` "caps a whole model call in wall clock, retries included".
  **Dated instance 2026-08-25**: `review --commit f5addcb --max-seconds 900` ran **1,105s**. The
  mechanism is not a bug in the deadline — it is a second, deliberate budget: the original request
  gets the one expiry minted from `--max-seconds`, and `scripts/lib/review-request.mjs`'s salvage
  path opens its own fresh `performance.now() + 300_000` for the follow-up. The attempt ledger shows
  it directly — attempt 1 `deadline-timeout` after ~900s and ~50,867 chars of reasoning, attempt 2
  the salvage follow-up answering 205s later. So the real bound is `--max-seconds` plus 300s, not
  `--max-seconds`. Both halves are defensible on their own and the conflict is between the behaviour
  and the documented contract, not within the code. It matters wherever a caller sizes a wall-clock
  budget against this flag — an overnight sweep's per-commit cap, or a review-ladder stage that must
  collect before a later group launches. Whoever takes it should decide which of the two is wrong:
  the sentence, or the second budget.

- **OAI-217** — **A benchmark record does not carry the server-side configuration that decided its
  result.** `bench/` records the provider, the model id, the flags it was invoked with, and every
  timing and token figure — and nothing about how the server was configured to run that model. A
  reader cannot tell from a record whether the model answered under `reasoning_effort: xhigh` or
  `low`, with its thinking channel enabled or disabled, at what loaded context length, or at what
  temperature and sampling settings, because those live in the server's own per-model configuration
  rather than in the request. **Dated instance 2026-08-25**: fourteen full six-case runs were
  recorded across eleven models, and the `qwen/qwen3.8-27b` rows — 0 of 6 cases, every one lost to a
  runaway — are unattributable from the record alone. The cause was `reasoning_effort` defaulting to
  `xhigh`, a fact recoverable only by reading LM Studio's UI or `~/.lmstudio/hub/models/**/model.yaml`
  by hand, long after the run. **The silent-failure mechanism is that the report reads as complete**:
  every column a reader expects is populated, so nothing signals that the variable which determined
  the outcome is absent. Two runs of the same model at different reasoning efforts produce records
  that are byte-identical in their identity fields and wildly different in their results. Whoever
  takes it should decide what is capturable without a provider-specific tangle — a served-model
  probe, an operator-supplied note, or a declared unknown — since `providers.json` is deliberately
  configuration rather than code paths.

- **OAI-218** — **A benchmark row's lens depends on whatever context length the model happened to
  load at, and the report does not say which.** `scripts/lib/review-ladder.mjs` picks the whole-file
  rung when the window can hold it and falls to hunks when it cannot, so the same case can be
  reviewed at very different fidelity by two models — or by the same model on two days — purely
  because of how much KV cache fitted. The report prints `prompt tokens`, from which a careful reader
  might infer the rung, but not the loaded context length, and `hunksOnly` is not surfaced per case.
  **Dated instance 2026-08-25**: in one sweep `qwen/qwen3-coder-30b` loaded at 32,768 and lost the
  `structured` case outright to an oversize refusal, while `qwen/qwen3.5-9b` loaded at 154,624 and
  reviewed it whole — the two rows sit in the same table with no indication that one covered five
  cases and the other six for a reason unrelated to the models. The same run also produced
  `google/gemma-4-26b-a4b` at 49,408 against `google/gemma-4-26b-a4b-qat` at 116,736, so a
  quantization comparison silently became a lens comparison. **Requesting a context length does not
  fix it**: LM Studio honours `--context-length` for some models and silently clamps or ignores it
  for others, which is itself only discoverable by reading the loaded value back. **Second dated
  instance, 2026-08-27**: the same case (`hold3-docs-only`, a 289KB `BACKLOG_DONE.md` at the pinned
  commit) produced a ~20x prompt-token spread across two models with no code difference at all —
  `qwen/qwen3.8-27b` (window 61,696) fell back to a hunks-only prompt at ~3,890 tokens, while
  `qwen/qwen3.5-9b` (window 154,624) reviewed the whole file at ~88,170 tokens. Both scored the case
  as a near-clean control, so the lens divergence did not surface as a failure — it surfaced as two
  models being compared on a case they were not actually reviewing at the same depth.

- **OAI-219** — **The one number that decides whether a reviewer is usable is not reported as a
  number.** `docs-only` is the corpus's clean control — it contains no code — so the report states
  that unmatched findings there "turn unmatched into false-positive by construction". That makes it
  the only case whose unmatched count is a precision measurement rather than a scoring artifact, and
  it is printed in the same `unmatched` column as every other case, distinguished only by prose the
  reader has to know to apply. There is no per-run precision figure and no control-specific row.
  **Dated instance 2026-08-25/26**: comparing fourteen models required extracting that column from
  each report by hand and applying the rule mentally; the resulting comparison misreported at least
  one model's control behaviour before it was caught, and a later verified re-run moved three
  configurations across the pass/fail line on this measurement alone (`qwen/qwen3.8-27b` at both
  `low` and `medium`, and `google/gemma-4-e4b`, each invented a defect on the control). **The
  silent-failure shape is that a model with zero recall and zero control findings and a model with
  zero recall and three control findings print an identical-looking row** — same `0/N` in every
  defect column — while one is merely useless and the other is actively harmful to a reviewer's
  time. Whoever takes it should decide whether the control earns its own reported figure or whether
  `unmatched` on a no-code case should simply be named what it is.

- **OAI-220** — **Nothing compares two benchmark runs, so every comparison is assembled by hand and
  the assembly is where the errors are.** `bench/` writes one record and one report per invocation
  and provides no way to read N of them together: no cross-run table, no diff of two records, no
  ranking across models. **Dated instance 2026-08-25/26**: producing a ranking over fourteen models
  and roughly 110 review invocations meant reading each report separately and building the table by
  hand, which introduced three errors that had to be caught and corrected afterwards — a case's lens
  recorded as whole-file when the record said `hunksOnly: true`, a finding tally that mixed per-finding
  and per-cluster units, and a "worst performer" attribution drawn from the wrong run. Each was
  recoverable only by rereading the records the harness had already written correctly. **The records
  are not the problem — they are complete and machine-readable**; what is absent is any consumer of
  more than one of them at a time, so the comparison a reader actually wants exists only in whatever
  they typed into a terminal. Note this is the reporting half of what OAI-217 and OAI-218 describe
  from the recording side: those items are about fields a record does not carry, this one is about
  the absence of any reader across records that do.

- **OAI-221** — **Whether a local model can review at all is decided by a setting this repo cannot
  reach, and every benchmark figure it has published was taken on the wrong side of it.** A reasoning
  model's thinking channel is controlled by the chat template's `enable_thinking` variable. It is not
  an OpenAI request field: `scripts/lib/client.mjs` cannot send it, `chat_template_kwargs` is not
  honoured by LM Studio (measured — a request carrying it returned identical reasoning-token counts
  to one without), and the only route is the server's own per-model configuration, in LM Studio's UI
  or `~/.lmstudio/hub/models/**/model.yaml`. **Dated instance 2026-08-26**: four models were scored
  on the `bench/` corpus with thinking ON and again with it OFF, everything else identical, each
  verified at `reasoning_tokens=0` immediately before its run.
  | model | thinking ON | thinking OFF |
  |---|---|---|
  | `qwen/qwen3.8-27b` | 0/6 cases, every one timed out | 4/6 cases, 1 anchored, clean control |
  | `qwen/qwen3.6-35b-a3b` | 2/6 cases, 1 anchored, 1,595s | 5/6 cases, 1 anchored, **319s** |
  | `google/gemma-4-26b-a4b` | 4/6 cases, 1 anchored | 4/6 cases, 1 anchored, 0 unmatched |
  | `gemma-4-12b-it-mlx` | *already off — no hub config to override the template default* | 5/6, 1 anchored |
  Generation time collapsed from hundreds of seconds to 1-34s per case; prefill then dominates, which
  is a hardware property rather than a model one. **The dominance of this one variable is what makes
  it worth an item rather than a note**: every other lever measured across ~110 review invocations —
  `reasoning_effort` (`low`/`medium`/`xhigh`), temperature, `top_p`/`top_k`/`min_p`, quantization from
  2-bit to 6-bit, reply budgets, `--structured-output`, `--parallel` 1/4/8, and prompt phrasing —
  moved availability or latency at best, and none moved capability. **Two consequences beyond the
  ranking.** First, the pre-2026-08-26 benchmark figures in this repo compare models that mostly had
  thinking on against `gemma-4-12b-it-mlx`, which had it off by accident of having no hub config —
  so the variable was confounded with model identity and nobody knew. Second, the corpus is not the
  one-case corpus it appeared to be: with thinking off, `qwen/qwen3.6-35b-a3b` anchored a defect in
  `scaffold`, a case no model had matched in any prior run, while losing `config-origin` — so the two
  best models now find **different** defects and neither finds the other's, which is the first direct
  evidence for the multi-model agreement signal OAI-9 and OAI-11 propose. Related: OAI-214 is the
  general inability to express vendor-required parameters; this item is the specific parameter that
  turned out to decide the outcome, and OAI-217 is why a record cannot show which side of it a run
  was on. **Evidence: [`evidence/221.md`](evidence/221.md)** — the measurement tables, the
  replication that revised them, and the corrections, recorded rather than summarised.

- **OAI-222** — **An exhaustive sampling-parameter search bought a real precision gain and no
  recall gain that survives leaving the panel it was tuned on.** A 7-stage, Codex-designed search
  over temperature/top_p/top_k/min_p/reasoning_effort/`--structured-output` across ~150 invocations
  (2026-08-26/27) froze one config per finalist model (`qwen/qwen3.8-27b`, `qwen/qwen3.5-9b`, both
  `enable_thinking: false` per OAI-221). **Dated instance**: on two hold-out cases the search never
  touched, both frozen configs anchored zero real defects across 20 combined repetitions
  (N=5 x 2 cases x 2 models) — not 20 independent misses, since 6 of the 20 were parser failures or
  a timeout rather than semantic misses (OAI-224). `qwen/qwen3.5-9b`'s config also **regressed**
  recall on the three hardest full-corpus cases versus its own untuned baseline: 0 of 11 answered
  reps anchored anything under tuning, vs 3 of 9 at baseline, while its clean-control precision
  improved (2/3 clean baseline -> 5/5 clean tuned) — the config was selected on a 2-case panel that
  never included the cases it regressed on, the overfitting risk the tune/hold-out split was
  designed to catch. Reopening path: fix OAI-212/OAI-224's parser gap first, then test materially
  different models against a preregistered, structurally diverse corpus with explicit recall and
  runtime gates — not more sampling search on these two models. **Evidence:
  [`evidence/222.md`](evidence/222.md)**.

- **OAI-223** — **`qwen/qwen3.8-27b` cannot complete a review of this repo's two largest bench
  cases within 600 seconds, confirmed directly rather than estimated.** `model-info` (~41k prompt
  tokens) and `scaffold` (~47k prompt tokens) timed out in every rep of Stages 2, 6 and 7 (12 of 12
  attempts) at the standard 300s cap. **Dated instance 2026-08-27**: a targeted diagnostic doubled
  the budget to `--max-seconds 600` for one rep of each case, frozen sampling config, no other
  change — both still failed, and neither produced any HTTP response at all within the full 600s,
  not merely a slow generation cut short. At this model's measured ~148 tok/s prefill rate, `caps`
  needed 215s of prefill alone for a 31,863-token prompt; `scaffold`'s ~47k-token prompt implies well
  over 300s of prefill before a token of `model-info`/`scaffold`'s own — larger — prompts could even
  begin generating. Distinct from OAI-216 (which is about `--max-seconds` not bounding the command's
  actual wall clock): this is the model failing to complete even under a budget already double the
  one OAI-216 shows the harness silently extends to. No budget beyond 600s was tried. **Evidence:
  [`evidence/222.md`](evidence/222.md)**.

- **OAI-224** — **`qwen/qwen3.8-27b` produced zero readable replies on `hold2-hostile-coercion`
  across 5 attempts.** **Dated instance 2026-08-27**: Stage 7 of the OAI-222 tuning exercise ran
  this case 5 times (N=5, frozen sampling config, `--cold`) and every single attempt was recorded
  `unreadable` — not a recall miss, no findings were ever extracted to score. This may be the same
  mechanism OAI-212 documents (a whole-document clean-or-near-clean reply the harness's acceptors
  cannot parse), but the raw replies were not captured in a form that lets this item confirm that
  identity — `bench/run.mjs` was run without `--json`, so only the rendered summary survives, not the
  raw completion. Filed separately from OAI-212 rather than folded in until that identity is
  checked, because OAI-212's own dated instances are all on `findings: []` clean replies, and this
  case has one real defect, so a genuinely different failure shape is also possible. Whichever it
  is, this is the second harness-side reason (with OAI-223's capacity ceiling) that qwen3.8 answered
  nothing on 2 of its 3 Stage 7 cases despite never having a chance to demonstrate recall on them.
