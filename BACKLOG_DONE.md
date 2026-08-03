# Done

Newest first.

- **OAI-24** — Record what the SERVER was doing. Completed 2026-08-03 **as a decision, not an
  instrument** — the driver it produced was withdrawn from its own commit and is now OAI-34's to
  finish. **The item asked which of three options to take and the answer was none of them** — and
  then none of the design that replaced them either, which is the part worth keeping.
  **What shipped:** the decision and its rationale (ADR 013), ADR 012's false "not observable from
  the client" corrected, the unprovenanced "~10 minute TTL" corrected wherever it appeared, a reader
  for evidence already recorded (`byFirstText`), and a new `.claude/REPO_TRAPS.md` class. **What did
  not:** `bench/ttl-challenge.mjs` and `bench/lib/ttl-verdict.mjs`, which stay uncommitted in the
  working tree with ten open findings and a production-code prerequisite.
  **All three filed options were refuted, not merely declined.** Sampling residency around a run
  (options b and d) suffers temporal aliasing: a bracket spanning several attempts and many minutes
  cannot tell "loaded throughout" from "unloaded then silently JIT-reloaded". A per-attempt plugin
  probe (option c) has the resolution but may reset the very timer it measures, costs 2s on a path
  where `--max-seconds` already binds, and leaks a vendor dialect out of `model-info.mjs`. Their
  replacement — a matched TTL crossover over the corpus — died too: TTL is assigned per *block*, so
  the independent n is blocks not requests, and at 3 per arm the best two-sided p is 0.25. Reaching
  9–12 pairs costs 3–4h on the MoE, which is the **wrong model** (prefill ~5× faster, never
  approaches the TTL), and 9–12h on the dense.
  **The premise turned out weaker than the file claimed, which is what made the cheap design
  possible.** Measured dense prefills — `scaffold` 335s, `model-info` 286s, `structured` 191s — all
  sit *below* the ~600s the hypothesis assumed, and the "~10 minute idle TTL" had **no provenance
  anywhere in the repo** (LM Studio documents a resetting timer, 60-minute JIT default). So:
  falsify rather than estimate: shorten the TTL to 120s against a 335s prefill — the most favourable
  condition the mechanism could get — where three survivals refute its deterministic form in ~45
  minutes. Specified in ADR 013; **building and running it is OAI-34**.
  **Reading a real `lms ps --json` corrected the design twice.** It reports `ttlMs`, so the applied
  treatment is confirmed from the server rather than assumed from an exit code — a draft comment had
  asserted the opposite. And it reports `lastUsedTime`, the idle timer's own anchor, which is a far
  more direct instrument than waiting for an unload: whether it advances during a long prefill is the
  hypothesis in the server's own terms. Recorded, deliberately not acted on.
  **The driver's worst defect was demonstrated by accident.** `main()` sat at module scope, so
  importing it for its unit tests *ran the experiment* — against a server that was down, adding 44s
  to the suite and writing a junk record. An earlier draft then rendered `inconclusive-failure`, a
  verdict about the mechanism, from a run in which no request ever reached the wire. `summarize` now
  returns `instrument-failed` and refuses to describe the server at all, and a test pins the
  entry-point guard because the symptom is slow and quiet rather than red.
  **Review pass 1 found eight more of the same shape, and that is the finding.** Three lenses —
  `advisor`, both Codex stages, and a wide `review-lean` — converged on one class: **a guard that
  narrates instead of refusing.** `calibrate` printed `ABORT` and continued; a *failed* calibration's
  1,800s timeout read as a 1,800s prefill; the verdict used the TTL that was *requested* rather than
  the one `lms ps` confirmed; a survival stood even when residency showed an unload; the post-exit
  sample counted as evidence of a mid-request unload; `activityObserved` measured across generation
  while claiming to measure prefill; and `summarize`'s fallback said "No episode stayed in flight
  past expiry" for sweeps in which one did. Every one would have let the experiment answer
  confidently from a run that tested nothing — the exact failure OAI-24 exists to prevent, inside
  OAI-24's own instrument. All fixed, each with a test that fails without the fix.
  **Scope, stated precisely because the batch is about overclaiming.** The wide verifiers corrected
  one of these downward: a short calibration could *not* fabricate `deterministic-form-refuted`,
  because `episodeVerdict` applies the same margin per episode, so an under-exposed sweep lands on
  the honest `no-exposure` branch. The confirmed harm was the false `ABORT` string, a zero exit code,
  no machine-readable disqualification in the record, and ~45 minutes spent on a run the gate had
  already rejected.
  **Then pass 2 found ten more — one of them introduced by pass 1's own batch — and the driver was
  withdrawn.** Two let it issue `mechanism-reproduced` from evidence that did not support it (an
  unload during *generation*; an unload past `ttlMs` in an episode that was never an exposure), and
  one disabled two of pass 1's fixes on the failure path, because `runEpisode` read a top-level
  `prefillMs` the failure envelope does not carry. The decisive one was not in the driver at all:
  **the attempt record drops `serverResponded`**, so a mid-prefill eviction before first token is
  indistinguishable from a connection that reached no peer — the instrument is blind to its own
  target event, and fixing that is production code OAI-24's plan forbade. Carried to **OAI-34** with
  every finding written down; the criterion for withdrawal was fixed *before* pass 3 ran, so it was
  not chosen against the defect that turned up.
  **The lesson worth keeping**: eight defects in pass 1, ten in pass 2, in logic that had never
  executed against a real server. Review found every one of them and review was not converging —
  which is an argument for running the thing against a stub early, not for reviewing harder.
  **Also shipped: the reader for evidence already recorded.** `attempt-outcome.mjs` had been keeping
  timings on *failed* attempts so the record could say "whether failures cluster before or after the
  first token" — its own words — and nothing read them. `bench/lib/attempt-rows.mjs` now splits
  failures on whether a prefill was measured, with the claim bounded to what that proves: the attempt
  crossed the first-text boundary, not why a later stream died, and absence is not evidence of a
  cause. Near-empty until OAI-19 runs; the whole corpus holds one failed attempt.
  **No production plugin code changed.** Corrected `adr/012:230`'s false "not observable from the
  client". Partially discharged OAI-31 item (1). See
  [ADR 013](adr/013-observing-the-server.md).

- **OAI-26** — Explain `shape-rejected` and `non-retryable-transport` in the reliability report,
  where they appeared bare. Completed 2026-08-02. Prose only, as filed: no schema change and no
  change to counting — `byReason` already tallies every failed attempt's reason, so both codes were
  in the table and only the explanation was missing. What shipped is three gated paragraphs in
  `bench/lib/reliability-report.mjs`, each on its OWN code, plus the tightened `refused` paragraph
  the item asked for.
  **~~"Point the reader at `.code`"~~ — struck, refuted three times over.** The item instructed the
  paragraph to send the reader to `.code`; the plan gate refuted it (the attempt record has no such
  field), the replacement "the code is not carried in this report" was refuted by the pass-1 wide
  review (`report.mjs` prints a dead run's whole stderr, and a Node syscall message embeds the code),
  and the third try, "the listing usually names the underlying code", was refuted decisively in
  pass 2 — a TLS rejection's message is the words "certificate has expired" and contains no
  `CERT_HAS_EXPIRED`, so it was false for exactly the examples the paragraph itself cites. The
  shipped paragraph therefore says nothing about where a cause can be found.
  **~~"It must not be called a reachability finding"~~ — also struck, and this one came from the
  item itself.** `ENOTFOUND` and `ECONNREFUSED` are deliberate exclusions from
  `TRANSIENT_CONNECT_CODES`, so they carry `non-retryable-transport` and reached no peer at all. The
  instruction was true of the three examples it named and false of the class. The shipped text says
  the code records a retry decision and does not establish whether a peer was reached, naming both
  directions.
  **The review cost more than the change and earned it.** Three passes; the two defects nothing else
  caught both came from wide mode, which is why the trigger was pulled on a prose-only change. The
  recurring defect — prose asserting a property of a whole class from examples covering one
  sub-population — is now a `.claude/REPO_TRAPS.md` class with **six** confirmed instances, three of
  which landed *after* the entry documenting it was written. Pass 3's five open findings are carried
  by **OAI-31**, which is the honest cost of the no-mutation rule rather than a clean finish.

- **OAI-25** — Make the `postWithDegrade` cap-ordering invariants reachable behaviourally, instead of
  only structurally. Completed 2026-08-01. **The item's own premise was half-refuted by the probe,
  which is the part worth keeping.** OAI-25 asked whether anything was left to buy and suggested not:
  "the already-expired case is behaviourally tested, and what remains is guarded structurally
  instead". The second clause was false. `tests/structure.test.js`'s two guards each justified
  themselves with a claim that the ordering *could not* be reached behaviourally — and moving
  `capBudgets` below `ledger.begin` turns `tests/failure-shape.test.js:224` red, which was already
  true before this change. The guards were asserting something the suite disproved.
  **The seam was also unnecessary.** OAI-25 proposed injecting a `now` parameter into the budget
  calculation and flagged that changing production code for testability deserved its own grill. It
  does not need one: `capBudgets` reads the bare global `performance.now()`, so replacing
  `globalThis.performance` in a test reaches it and **zero production bytes changed**.
  **What landed.** `tests/cap-ordering.test.js` drives the real `postWithDegrade` loop under a
  controlled clock, advancing it at named semantic boundaries rather than by counting clock reads:
  after `ledger.begin` for OAI-22's carried-budget rule (red if `postChat` recomputes the cap), and
  inside the handle's `refuse` for the OAI-23 window this repo's prose named but nothing drove — a
  capability refusal whose replacement the cap refuses, which must stay `failed`/`shape-rejected`
  with no phantom second entry. Both proved by mutation. Both guards kept, with their rationale
  rewritten to say what they actually do: localize the contract, not substitute for cover.
  **The class it produced, and its third instance.** A guard justified by "this cannot be tested"
  carries an untested claim, and it is self-protecting — a reviewer who reads it stops looking for
  the test. The feature reproduced the class *in its own fix* (a comment claiming "No mutation
  distinguishes the two placements", from one experiment) and review caught it; a third instance
  survives at `tests/structure.test.js:279,287` and is filed as **OAI-30**. Recorded in
  `.claude/REPO_TRAPS.md`. See [ADR 012](adr/012-surviving-the-server.md).

- **OAI-22** — Retry only what a retry can fix; check the cap once; warm the model that is about to
  run. Completed 2026-08-01. Three bounded fixes, and **the review refuted the premise of the first
  one**, which is the part worth keeping.
  **The transport split.** `transport` was one bucket and `isRetryable` said yes to all of it, so a
  TLS certificate rejection cost three requests and two 2-second sleeps to establish what the first
  proved. It is now `transport` (retryable: the post-headers cut, plus pre-response codes on a
  transient whitelist) and `non-retryable-transport` (everything else pre-response, including
  unknown and absent codes — the same whitelist direction `RETRYABLE` already took). Decided at the
  **call site** via a `delivered` flag, not by reading `error.code`: measured on Node 26.3 a
  mid-body cut arrives as a code-less-in-principle `Error: aborted`, so code-only classification
  would file the most retryable shape here as terminal on a version that omits it. The name
  `unreachable` was rejected — the pre-response path carries TLS, protocol and parser errors, all of
  which *reached* a peer. **The axis is retryability, never blame.**
  **What the review found, and what it cost the premise.** The backlog claimed an unresolvable
  hostname was retried three times. It was not: `provider.mjs` `describeFailure` rewrote
  `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN` into *fresh* errors carrying no `reason`, `code` or
  `cause`, so they arrived unclassified and unretried — verified end to end. The real defects were
  worse for OAI-19 than the claimed one: those attempts tallied as `unclassified` in the very
  `Failures by reason` table it reads, and `EAI_AGAIN`, which genuinely should retry, never did.
  Fixed by `reword()`, which carries the classification through the better message. Every earlier
  test passed because they called `transportError` directly, one layer below where the verdict was
  being discarded. **Methodology: a probe claim about what a value *reaches* must name the
  consumer, not the producer.**
  **One cap evaluation per dispatch**, carried into `postChat` instead of recomputed there — closing
  the last gap OAI-23 left, where a cap falling due between the two checks left a `refused` entry
  beside a phantom `failed` one. **Warm-ups interleave** on each change of resolved pair; grouping
  the corpus by pair was rejected because it reorders cases, and residency, prompt cache and thermal
  state are shared mutable state. That third fix is **latent for OAI-19**, which runs one arm per
  invocation with `--model` and so resolves to a single pair — the backlog paragraph claiming
  otherwise was wrong and is corrected. Also here: `chat.mjs` crossed its size budget a third time,
  so stream reading moved to `scripts/lib/stream-collect.mjs`. See
  [ADR 012](adr/012-surviving-the-server.md) and [ADR 006](adr/006-benchmarking-the-reviewer.md).

- **OAI-23** — Tie a `refused` reclassification to the replacement request actually being dispatched.
  Completed 2026-08-01. `refused` is the ledger's third outcome, meaning the server rejected the
  request's SHAPE and the plugin then sent a different one that worked — benign negotiation,
  excluded from the failure count. Both call sites *stated* it before the replacement went out, and
  the replacement could then never go out at all, so a run that died could read `0 failed,
  1 refused`: a terminal failure dressed as negotiation, understating exactly the reliability figure
  OAI-19 reads.
  The fix makes it structural rather than ordered. `refuse()` and `refuseLast()` now close the entry
  as the failure it is and *register* a pending reclassification; `attempt-ledger.mjs`'s `begin` is
  the only place `refused` is ever written, and it writes it as the first act after the replacement
  entry exists — no replacement, no reclassification. An abandoned refusal keeps a named terminal
  reason, **`shape-rejected`**, because a 400 carries `.status` and never `.reason` and the bench
  would otherwise tally it as `unclassified` beside genuinely unrecognised failures. A *flipped*
  entry keeps `reason: null`, deliberately, so it stays byte-identical to the records OAI-19 is
  differenced against. `attempt-ledger.mjs` crossed the file budget and split, with
  `attempt-outcome.mjs` taking what one request's ending means. See
  [ADR 012](adr/012-surviving-the-server.md).
  **The end-to-end deadline test the original entry asked for was not written, and that is a
  finding rather than an omission.** The transport arms the remaining wall-clock cap as its own
  deadline, so a request cannot *complete* after expiry — which leaves the window between a refusal
  and the next `capBudgets` only a few call frames wide. An e2e trying to land an expiry inside it
  would be a coin flip, and a flaky test is worse than none. What shipped instead: unit coverage on
  both call-site APIs with no following `begin()`, positive controls driving each call site's real
  sequence end to end, the existing oversize e2e extended to assert the reason, and — after the wide
  review proved by mutation that nothing pinned it — a **structural guard** that `capBudgets`
  precedes `ledger.begin` in `postWithDegrade`. Moving that call had left all 370 tests green while
  reopening the defect; the guard is now the only thing that catches it, and the class went into
  `.claude/REPO_TRAPS.md` as *an ordering that carries an invariant, pinned by nothing*.
  Two residues are recorded, not hidden. Ledger-entry creation is still not proof of *dispatch*,
  because `postChat` checks `capBudgets` a second time before `request()` sends — imprecise rather
  than false, since the run still reads as dead, and closed by **OAI-22**'s compute-the-budget-once
  fix, which is the only fix for it. And whether the structural guard should be a behavioural test
  behind an injected clock is **OAI-25**, raised in the terminal review pass.
  Review: three ladder passes, no stage skipped. Pass 1 accepted two findings, pass 2 three, pass 3
  terminal with two recorded. The wide stage died once at its scope agent and was resumed rather
  than read as clean.

- **OAI-20** — Survive the server: classify LM Studio's delivery failures and retry the attempt.
  Completed 2026-07-31. Four shapes now carry structured reason codes assigned where they are
  detected — `empty-completion`, `stream-unfinished`, `transport`, and a **fourth the item did not
  know about**: `applyText` sets `sawContent` for any string including `''`, so a reply of
  `content: ""` passed every guard and reached the caller looking successful, was reported as "the
  model did not return findings in the requested shape", and was filed by the bench as *unreadable*.
  A dead request recorded as a bad answer, which is the censored-denominator trap one layer below
  where this file already caught it. `answerWithRetry` retries only whitelisted shapes, spanning
  `postWithDegrade` **and** `finishAnswer` because the transport raises one shape and `finishAnswer`
  raises three. `--max-attempts` counts **answer attempts** (default 3) rather than physical
  requests — capping requests at 1 would have disabled capability degradation instead of retry — so
  `--max-attempts 1` reproduces the old behaviour exactly and is the control arm.
  `scripts/lib/attempt-ledger.mjs` records one entry per physical request, and the bench renders
  `## Physical-attempt reliability` beside the recall table with **both denominators stated
  together**. Three things review found rather than the plan specifying: an entry must settle only
  *after* `finishAnswer` judges it (`postChat` returns successfully for three of the four shapes, so
  closing at the transport would file dead requests as answered); a third outcome `refused` is
  needed or a server that refuses `stream_options` headlines a **50% failure rate while answering
  100% of shaped requests** — and it must be recorded by the layer that sends the replacement, never
  inferred from a status, because a context-limit rejection is also a 400; and `warmEligible` needs
  evidence of *model execution*, not prompt identity, or every degraded run's prefill is silently
  deleted from the benchmark's cold samples. **Not proven sufficient**: these are the shapes
  observed, and whether retry recovers the 37.5% is a measurement OAI-19 reads off the new record.
  Server state is not recorded — it is not observable from the client. See
  [ADR 012](adr/012-surviving-the-server.md).
- **OAI-21** — The bench keeps its own evidence and pays the model load itself. Completed
  2026-07-31, alongside OAI-20 as the item directed. The rendered report is written to `<stamp>.md`
  beside `<stamp>.json` under one stamp computed before rendering; `--warm-up` sends one unscored
  request per **distinct resolved provider/model pair**, carrying the invocation's budgets, and the
  record states that it ran. *(Those mechanics were superseded 2026-08-01 by **OAI-22**: warm-ups
  now fire on each **change** of resolved pair rather than once per distinct pair up front, because
  warming them all in advance let the last evict the first on a single-resident provider.)* Two things only running it revealed: the first version built the argv
  prompt-before-flags, which `/oai:task` refuses — and because warm-up records rather than throws,
  an arm would have carried on having warmed nothing (84ms against the expected ~11s was the only
  tell); and the outcome field is `answered`, not `ok`, because a reasoning model spends its budget
  thinking and exits non-zero on a request that loaded the weights perfectly well. See
  [ADR 012](adr/012-surviving-the-server.md).
- **OAI-16** — Say when the served model is not the requested one, and select the loaded one.
  Completed 2026-07-29. The probe made the first half considerably worse than the item described.
  **The item said a stale pin got substituted; the truth is that *any* wrong id does.** Reproduced
  live in a single call: `POST /v1/chat/completions` naming `totally-not-a-real-model` returned
  **HTTP 200 and a normal completion from `qwen/qwen3.6-27b`**, the model that happened to be loaded.
  Not a stale-config problem — a server that answers as something else whenever it is asked for
  anything it does not have. `jsonReport` already recorded the served id correctly and *nothing
  compared it to the id requested*, so the fact was recorded and never used: a benchmark arm could
  spend its whole wall clock on a model it did not claim to test and leave a clean-looking record.
  Now one predicate — `substitution()` in `scripts/lib/model-identity.mjs` — is the only comparison,
  used by the footer, the stderr warning and the bench alike. It is **exact, never `matchKey`**,
  because the second probe finding is that `@4bit` is a real identity: requesting
  `qwen/qwen3.6-27b@4bit` made LM Studio try to load a *different* model and fail on resources, so
  normalising the suffix would hide precisely the quantization swap that contaminates an A/B arm most
  quietly. It returns null when either id is missing — absent is "nothing was determined", never
  evidence of a swap.
  **Caught twice, and the second catch is the one the item asked for.** Before the run,
  `planSelection` refuses an id a recognised catalogue does not list, on both the `--model` and
  `defaultModel` paths, so a wrong id costs milliseconds rather than a full run. After it, the footer
  renders `model: <served> (requested <requested>)` — inside the `model:` field rather than on a line
  of its own, because that is the field a reader consults to learn which model produced the output —
  plus a stderr warning. A substitution **warns and never fails**: the work is already paid for, and
  ADR 008 records what discarding runs cost when it was tried.
  **The second half: refusing while holding the answer.** `planSelection` refused with "offers N
  models" while `readLmStudio` was already reading each model's `state` and using it only to gate a
  context window. It now selects the one the server reports `loaded` — a fact being read, not a
  guess, since ADR 002 already treats `loaded` as authoritative (it is why `loaded_context_length` is
  trusted and `max_context_length` is not), and the OAI-2b defect it warned against was taking the
  *first* entry, which is arbitrary. Two conditions gate it, both from the plan challenge: every
  candidate must carry a **recognised value** (`state: entry.state` creates the key even when
  undefined, so presence proves nothing, and partial coverage would draw a conclusion over a subset),
  and every record must have been **joined on an exact id** (the `matchKey` join is conservative for
  the embeddings denylist but would become a routing decision here). "None loaded" and "several
  loaded" each get their own message; nothing measured says a server holds only one model resident,
  so the code does not depend on it.
  **The reviews changed the shape of this twice, and both are worth recording.** The first version
  left the up-front refusal *opportunistic* — `resolveTarget` probed only for what the config left
  unanswered, so a profile setting both `defaultModel` and `contextLength` never fetched a catalogue
  and never got the check. That shipped documented and tested as a deliberate compromise, and the
  built-in review showed the framing was hiding a defect: `/oai:setup` probes **unconditionally**, so
  it *did* refuse, printing `No provider can take a task right now` about a task that ran fine.
  That is this repo's signature class with its sign flipped, and it defeats the cure ADR 002
  prescribes for it — **one authority is not enough when its two callers feed it different
  evidence.** `resolveTarget` now always fetches the list, superseding an ADR 002 consequence; the
  cost is a `/v1/models` GET on a path that was about to post a whole prompt anyway, and the
  recommended config (no `contextLength`) was already paying it.
  Second: membership is tested against the **union** of `/v1/models` and the dialect's own catalogue.
  Keying it on `/v1/models` alone refused a model the dialect reported `loaded` — the one the server
  had resident — whenever that list was narrower. The adversarial review raised this at 0.98
  confidence, **it was dismissed**, and the lean review then reproduced it end to end. The refusal is
  also gated on the dialect having published a per-model catalogue rather than merely being
  recognised: llama.cpp and TGI are recognised, publish no list, and ignore the requested name, so
  the stricter gate would have broken a working setup.
  Benchmark side: a substituted run is recorded **failed** with reason `model-substituted`, rendered
  as `(N substituted)` inside the failed cell and in its own report section — not under "Runs that
  did not complete", because it did complete. Deliberately a different call from a truncated run,
  which ADR 008 scores: a cut run is this model measured incompletely, while this is a *different*
  model measured correctly, so the number is not uncertain but mislabelled. Two latent defects fell
  out of that: the timing, throughput and prompt-size samples gated on a report alone and would have
  contributed wrong-model figures to a row that disowned the run, and the `scored` bucket was the one
  of four with no `!run.error` guard — held together only by `run.mjs` declining to attach a score,
  the exact cross-file fragility `unreadableRuns` documents about itself.
  Leaves for **OAI-11**: which model answered is now per-run evidence rather than a config
  assumption, which is what cross-model passes need.
  See [ADR 011](adr/011-which-model-actually-answered.md).

- **OAI-17** — Bound a run in wall clock, and report what it generated per second. Completed
  2026-07-29. Three gaps, and the probe reshaped two of them.
  **Nothing bounded a run that was working, and the item did not know that.** It asked for a bench
  `--timeout`, but `--timeout` names the wait for the *first* token only: once text arrives that
  budget is retired and the idle budget takes over, resetting on every text-bearing frame. Confirmed
  against the code by an independent read — *"there is no absolute total deadline for the streamed
  response"*. With ADR 009's own figures (generation spanning 165–747s on one case), a six-case
  corpus at N=3 had no worst case at all, which is the thing that actually blocks OAI-11. So the
  feature added `--max-seconds` as well as forwarding `--timeout`: a wall-clock cap on the model
  call, opt-in with no default, arming the transport's `deadline` budget from **one expiry minted per
  command and shared by every retry**. That last part was a plan-challenge correction, and the reason
  matters: the first draft armed a fresh cap per attempt, so three attempts under `--max-seconds 600`
  could have run 1,800s with each honouring its cap — and its defence, that refused capabilities cost
  nothing, is a claim ADR 009 had *already recorded as unverified*.
  **A timeout was indistinguishable from a model failure in the record.** The reason was structured
  internally all along (`error.reason`) and thrown away at the exit, which left `bench/run.mjs` a
  prose blob to pattern-match — the class this repo files as OAI-13 items 1 and 2. Now `--json` is
  machine-readable on **both** paths: a failed run prints `{error, reason, message, hint}` to stdout
  and still exits 1 with the same prose on stderr, and the bench records `reason` beside the stderr
  it already kept. The envelope covers everything after argument parsing, guards and internal crashes
  included; the single stated exception is a malformed command line, because parsing is what
  establishes `--json` was passed at all.
  **Nothing reported a rate.** `tokensPerSecond` divides the reply's `completion_tokens` by
  `generationMs` — never `durationMs`, which would fold a 421s prefill into the divisor and read ~7×
  low — and appears in the `/oai:review` footer and a `gen tok/s` benchmark column, per run and
  ranged, never `sum(tokens)/sum(ms)`. The figure is named for what it is: **provider-reported
  completion tokens per measured generation second**. An earlier draft called it "thinking included",
  which the plan challenge refused as a vendor convention this repo cannot confirm.
  **The item's motivating number was stale and is not repeated.** It said runs "died on the 300s
  client timeout"; that is the pre-ADR-007 undici cap, and the default first-token budget has been
  600s since. The gap was real, the figure was not current.
  Three defects were caught in this feature's own code before it shipped, all by the delta
  re-challenge: `serverResponded` captured at arm time (always false) rather than read in the timer
  callback; a live cap reporting its *remaining* time as the configured number; and a tie-break that
  relied on `setTimeout`'s FIFO ordering, which Node documents as approximate. The last is now
  suppression rather than a race, with all four cases of the truth table pinned — including a cap
  *longer* than the first-byte budget, the only one that proves the rule is a rule.
  **Live, and quoted here because `bench/results/` is gitignored.** `config-origin --runs 2` on the
  dense 27B rendered `prompt tokens 1575 | prefill s 1–3 | generate s 81–265 | gen tok/s 14.5–16.6`.
  That row is the argument for the column: generation spread **3.3×** on an identical prompt while
  the rate spread **1.15×**, so the model was not varying in speed, it was varying in how much it
  chose to say — and `81–265` alone reads as the opposite. The same case under `--max-seconds 20`
  produced `failed: 1 (1 timed out)` with `reason: "deadline-timeout"` in the record, cut after
  82,775 characters, and the hint that rendered was the mid-generation one rather than the
  nothing-arrived one — the conditional a Codex finding added.
  **Six defects in this feature's own code were caught before it shipped, none of them by the tests**
  — a per-attempt cap, a flag captured at arm time instead of read at fire time (twice, the second
  by copying the first fix's shape without its wrapper), a cap reporting its remaining time as the
  configured one, a FIFO-dependent tie-break, a cap above ~24.8 days that would have fired
  immediately, and a hint claiming the model was generating on the strength of raw SSE bytes. That
  last one is the instructive one: the branch existed only because an earlier reviewer objected to a
  hint claiming more than was known, so a fix for one false assertion introduced another from a
  worse signal. Three of four review finders converged on it independently.
  296 tests green (275 at the start). See [ADR 010](adr/010-bounding-and-rating-a-run.md).

- **OAI-18** — Measure prefill and generation separately, and pin the corpus commit. Completed
  2026-07-29. The bench reported one wall-clock number per run and ranged it across `--runs 3`; that
  number is two quantities added together, and a server-side prompt cache moves one by ~37× and
  leaves the other alone. Measured on one 56,805-token prompt, three consecutive requests: first
  token at **421,660 ms cold and 11,457 / 10,257 ms warm**, generating ~3 s in all three. So a
  `seconds` cell reading `13–425` was one cold run and two cache hits, printed as a spread in the
  reviewer. `chat.mjs` now stamps the first frame carrying text and the end of the stream, and
  `prefillMs`/`generationMs` reach `--json`, the text footer and two benchmark columns that replace
  `seconds`. Live, after the change: `model-info` at 41,010 prompt tokens over two runs reported
  **prefill 7–289s and generation 398–726s** — a 39× spread the report computed itself, beside a 1.8×
  spread that has nothing to do with the cache. Welded together, that row read `687–1015` and looked
  like ordinary variance.
  **The claim that generation is comparable is false and was written twice before it was caught.**
  The adversarial review refuted the first version; the first live run to print the second version
  disproved it in its own row (`config-origin`: prefill 1–10s, generation 165–747s). The cache not
  touching generation and generation being comparable are different claims — the tidy contrast keeps
  inviting the second. The note now states only the ratio it counted, and the tokens-per-second
  quotient that would make generation comparable is OAI-17's.
  `--cold` verified live on `config-origin --runs 3`: prefill `10–10s` against `1–10s` without it —
  three independent cold samples instead of one cold and two hits — and the report swaps the cache
  caveat for a statement that the flag was on.
  **The `prompt tokens` column was the same defect, one column to the left.** It summed
  `usage.prompt_tokens` across runs, which is invisible at N=1 (every figure in ADR 006 came from an
  N=1 sweep) and wrong by a factor of `runs` after that: it printed 82,020 for a case ADR 006 records
  at 41,016. Caught by checking why two live runs disagreed on a figure that is a property of the
  input, *after* every review stage had passed over the diff. Now per-run, ranged when the runs
  genuinely differ, with the ADR's own pasted table corrected.
  **The item proposed two options and the probe killed one of them.** "Accept warm runs and report
  cold and warm separately" has nothing to label from: LM Studio publishes no `cached_tokens` and an
  empty `stats`, and position is not evidence — a *first* call in a fresh process came back warm at
  956 ms because an earlier process had prefilled the same prefix. So the cache is measured, not
  classified, and `--cold` (via a new `/oai:review --cache-buster`) buys independent runs when they
  are wanted. Busting always was rejected on cost and fidelity: three cold runs of that case cost
  ~21 min of prefill against ~7.5, and real `/oai:review` usage is warm.
  **Generation is measured, not derived, and that came from the plan challenge.** The draft computed
  it as `durationMs - prefillMs`, which is not generation — `durationMs` starts before prompt
  building and any rejected `response_format` attempt, so a schema rejection alone would have shown
  as seconds of "generation" for a reply that generated instantly.
  **A Codex probe check also refuted the claim that the bench sends the same bytes twice**, which
  nothing had noticed: `materialize()` builds a fresh repo per run and `--commit HEAD` sends
  `git show HEAD`, so the commit sha and date differed whenever two runs fell in different clock
  seconds. Inside one second they agree — which is what a test reproduces — and minutes apart they do
  not, which is what a real run reproduces. Now pinned. Note the consequence: this removes an
  accidental cache bust that applied to `--diff-only` alone, so **that arm's timings from before this
  change are not comparable with figures after it.**
  See [ADR 009](adr/009-measuring-prefill-and-generation.md).

- **OAI-15** — Size the reply from the budget the run actually has, and stop discarding the runs the
  cap censors. Completed 2026-07-28. The `analysis` ceiling was a flat 28,000 characters while the
  budget paying for it shrank per run, so the two agreed only by coincidence — and on the largest
  input they did not: `scaffold` sent `max_tokens: 11,043` against a schema envelope of ~15,695
  tokens. `scripts/lib/review-schema.mjs` now derives the cap from the reserve granted
  (`reviewSchemaFor`), clamped between a floor and a **wall-clock** ceiling of 74,000 characters
  (~28 min of generation on a dense 27B; verified that LM Studio compiles a grammar that large before
  relying on it). `REVIEW_MAX_TOKENS` rose 16,384 → 32,768 where the window is known, reversing
  ADR 004's refusal on the evidence that made it — **the cost it feared no longer existed**, because
  the `minReserve` shrink recorded in that same ADR means a review is refused only when under 4,096
  tokens remain, whatever the constant says. BACKLOG's "the tension is real and is the whole
  decision" was describing pre-`minReserve` behaviour.
  **The reserve was never the constraint — the accounting was.** On five of six cases the reserve was
  ~55,700 characters while `analysis` got 28,000, because ~24,500 was held back for a 20-finding
  reply. Six is the most any reply has ever carried, so the budget now reserves for eight; the schema
  still permits twenty and the rare overrun fails loudly. **That eight is a policy bet, not a
  measurement** — every observation behind it was taken under the old cap, and more room may itself
  produce more findings.
  **The half that changed most is what a censored run is worth, and it came from the plan challenge
  rather than the code.** Both obvious readings are wrong: discarding cut runs threw away 17 of 41
  recorded runs carrying two of the four anchored matches ever produced, while folding them in counts
  every finding the run never reached as a confirmed miss. A truncated run's positives are
  trustworthy and its absences are unknown, so `defects found` now reports **only what was observed**
  and a new `unresolved` column says how much of the denominator is uninterpretable, with the upper
  bound stated in prose. A low–high band was built first and removed by the adversarial review: an
  unobserved figure printed under a heading that says "found" made a wholly censored run
  indistinguishable from a perfect one. Rows with nothing cut are unchanged, so past figures stay
  comparable.
  **Measured after the change** (3 runs, `config-origin`, dense 27B, derived cap 74,000): analysis
  lengths **7,075 / 19,942 / 21,240, cut 0 of 3** where that case cut 6 of 9 before — and the right
  edge of the distribution is observable for the first time, since every value at the old 28,000 was
  previously indistinguishable from one that would have run to 90,000. The longest run stopped
  *below* the old ceiling, which contradicts ADR 004's "the model fills whatever it is given" for
  this model and case. Read no further than that: one case, one model, N=3; `structured` (4 of 4 cut)
  and `scaffold` (4 of 11) have not been re-run; **all three runs found nothing**, so this buys
  measurement, not review quality; and it costs wall clock (129–363s against 49–156s).
  Nothing claims the reply fits its budget: `RESERVED_CHARS` is documented as an estimate
  (`maxLength` caps decoded strings, not serialized JSON; `line` has unbounded width;
  `CHARS_PER_TOKEN` was calibrated on input code), and the tests assert the formula rather than a
  guarantee. See [ADR 008](adr/008-sizing-the-review-reply.md).

- **OAI-6 + OAI-17a + OAI-8** — Streaming, and owning the timeouts it exposes. Completed 2026-07-28.
  `timeoutSeconds` never worked above five minutes: Node's `fetch` is undici, undici applies its own
  300s `headersTimeout`, and an `AbortSignal` beside it can only *lower* the bound — so the real
  limit was always `min(timeoutMs, 300_000)` and **14 of 18 benchmark runs died** with 1800 in the
  config. `scripts/lib/http.mjs` now owns the request on `node:http`, streaming chat completions as
  SSE. **The obvious fix was not enough, and finding that out is the result worth keeping**: streaming
  moves the wall from `headersTimeout` to `bodyTimeout` rather than removing it, because prefill emits
  no body — a cache-busted 52k-token prompt took **393.7s to its first token** (9.3s warm). OAI-17a's
  own text claimed streaming would settle it; that claim was written before it was measured.
  **The budgets bound tokens, not bytes**, which is the correction the plan challenge forced: an SSE
  keepalive comment, a role-only delta and a half-delivered frame are all socket activity proving
  nothing about generation, so a byte-driven budget would have let `:\n\n` every 30s run forever while
  reporting itself armed — the defect class the feature exists to remove, reintroduced by its own fix.
  The transport bounds `firstByteMs` plus an optional absolute `totalMs`; the first-token and idle
  budgets live in `client.mjs` and reset only on a parsed delta carrying a string. `totalMs` is what
  keeps `/oai:setup` safe, since its probes are bounded totals today and it awaits every provider.
  Chosen over a working `Symbol.for('undici.globalDispatcher.1')` wrapper **on failure mode, not size**:
  the symbol is not public API and a future Node moving it would disarm the override silently.
  **OAI-8 closes because the heartbeat is timer-driven**, not delta-driven — a delta-driven tick is
  silent through exactly the prefill it was asked to cover, and closing the item on that would have
  been the reported-state-vs-actual class one level up.
  **Accepted on the benchmark, not on a demo.** `scaffold` — 47,069 prompt tokens, one of the 14 that
  died — now completes in **959 seconds** with `failed: 0`, and a live `/oai:task` over a 42,043-token
  cold prompt ran **444s** (≈295s of it silent prefill) where the old code died at 300s. What that does
  **not** buy is a score: the same run came back `cut: 1`, so 0 of 3 listed defects were scoreable. The
  dense-27B arm is unblocked and still unanswerable until OAI-15 sizes the `analysis` ceiling.
  Guarded by a new structural test — **nothing calls the global `fetch`** — with no exemptions, because
  the defect was an invisible default rather than a typo. Four defects were caught before commit that
  the suite would not have found: a `'data'` listener racing the consumer, a first-byte timer re-armed
  at headers (silently doubling the advertised budget), `idleSeconds` validated but dropped by
  `buildProfile` so it did nothing, and — found by the design review — **every existing test replying
  `application/json`, so all 198 would have taken the degrade path and reported a green suite with no
  streaming coverage at all.** Design in [ADR 007](adr/007-owning-the-transport.md).

- **OAI-12** — A labelled corpus and a benchmark harness. Completed 2026-07-28. `npm run bench` runs
  the shipped `/oai:review` against six committed snapshots of this repo's own history and scores the
  findings; `--runs N`, `--case <id>`, `--diff-only`. **It drives the real CLI through a new
  `/oai:review --json`, never a copy of the pipeline** — a bench that scored a reimplementation and
  reported it as the reviewer's score would be this repo's signature defect at the meta level, and
  `structured` (64,357 tokens against a 54,016 threshold) makes it concrete by falling to ADR 005's
  second rung where the others do not. **Baseline: 1 of 6 scoreable defects at N=1, 10.9 minutes** —
  11 catalogued, 5 unscored because their runs were cut. Two findings outweigh that number.
  Its first reading claimed context dilution was measured; **a three-arm run the next day retracted
  that** — the pair behind it varied mode and prompt shape alongside token count, and at N=3 the same
  case at half the tokens found nothing at all. The instrument refuting its own first headline inside
  a day is the item working as intended. What survived and grew: **the `analysis` cap bound on 2 of 6
  runs here and on 6 of 15 runs recorded overall**, both reporting nothing, wasting a third of the run
  and 45% of the corpus's defects with it — and it binds on the *smallest* input, not the largest.
  **The corpus is smaller than history claims, on purpose.** A defect is listed only if it can be
  pointed at in the snapshot; 8 further claims are recorded as dropped with reasons. Applying that
  rule caught **two of my own attributions being wrong** — a defect assigned to `65373a0`, which does
  not touch `config.mjs` at all, and one assigned to `8990173`, where the code did not yet exist —
  both of which would have scored the reviewer for missing code it was never shown.
  **The scorer was validated against hand verdicts before any number shipped** (3 adjudications, 3
  agreements), and immediately justified its design: the model placed the run's only true positive at
  line 83 when the defect is at line 90, so the cheaper file-plus-line-proximity scorer would have
  reported 0/11. **Two guards were earned from defects the corpus itself caused**: `node --test` with
  no path discovered the corpus's historical tests and ran them against today's tree, and a new
  flag-documentation check found `/oai:task` had been accepting `--system` undocumented.
  **The lean review then found six more defects, three of them the signature class** — including one
  in `review-report.mjs`, the module written specifically to stop a caveat being true on one path and
  absent on the next (instance 16). One of the six is why the baseline reads 1 of 6 and not 1 of 11:
  cut runs were entering the recall denominator as zeroes while this ADR claimed they were counted
  separately. Design in `adr/006-benchmarking-the-reviewer.md`.

- **OAI-14** — Review whole changed files, not bare diff hunks. Completed 2026-07-27. Each changed
  file is now sent whole alongside the diff, taken from the revision the diff describes (`git show
  <ref>:<path>` for `--commit`, the index blob for `--staged`), with `--diff-only` restoring the old
  behaviour. **The target class is gone: the "`positiveInteger` is not defined" false positive ran
  3-of-3 before and 0-of-3 after.** Honest scoring is 1 false positive → 0 with true positives
  unchanged at 0 — `1ea398f` is the commit that *fixed* the OAI-2 findings, so it is near-clean and
  the baseline's only output was the false positive. **This bought precision and says nothing about
  recall.** The diff-only arm stopped producing it too, via the new hunks-only prompt sentence, so
  the six runs do not isolate which mechanism does the work.
  **Shipped as a two-rung ladder, not the per-file shed the plan had.** The reserve arithmetic
  collapses to `fit ⟺ estimate ≤ contextLength − minReserve`, so the real threshold is 54,016 and
  the largest measured commit is 41,790 — shedding never triggers on observed data, and ordered
  largest-first it would have dropped `model-info.mjs`, the very file whose missing definition caused
  the false positive. Untracked and `--file` blocks are pinned and never dropped, so an empty review
  is impossible by construction. Cost: 2.5× the input, 4–10× the wall clock, and the `analysis` cap
  now binds in 2 runs of 3 — which makes OAI-8 more necessary, not less. A root-commit bug
  (`git diff-tree` lists nothing without `--root` where `git show` prints a diff) was caught by a
  test and is now a repo trap. **Four claims-vs-reality defects were caught before commit, none by
  the test suite**: the root commit, a subdirectory cwd reading nothing and reporting a normal run,
  a blanket "you have only hunks" asserted while whole files sat in the same request, and — found by
  the lean review, after I had already "fixed" the git-edges class and written the merge case off as
  safe from one trivial example — merges silently losing their bodies, plus an unreadable file
  vanishing with the prompt still vouching for it. Design in `adr/005-whole-files-for-review.md`.

- **OAI-10** — Bound the review reply so a runaway cannot eat a whole pass. Completed 2026-07-27.
  Every string and array in `REVIEW_SCHEMA` now carries a grammar-enforced ceiling, sized above every
  observed successful run; hitting the findings cap is reported rather than silently binning a
  defect. **Shipped as half the item it was written as.** "Raise the ceiling" was dropped on
  evidence: the failing run generated all 16,384 tokens it was allowed against 5,450 / 2,521 / 2,301
  for the runs that finished, so more room only buys a longer runaway. The prompt-side cap was
  dropped too — probing showed the reduction it appeared to give came from *steering the model to
  reason less*, which is an unmeasured recall trade and now an OAI-12 experiment. Probing also found
  that `maxItems` on a reasoning field with no floor collapses it to `[]` in six tokens, now a repo
  trap. **Both first-guess cap values were wrong and live verification caught them** — `evidence` cut
  a real finding, `analysis` cut mid-sentence and the run then reported none. Honest scope: a
  runaway now fails cheaply and parseably in ~70s rather than dead-ending on a truncation error, but
  the cut is not a rescue and this does not move the hit rate. Design in
  `adr/004-bounding-the-review-reply.md`.

- **OAI-4** — `/oai:review`: a local second opinion on the diff. Completed 2026-07-27, pulled ahead
  of OAI-3 so it could be used while building the rest. Strict `json_schema` findings read from
  whichever channel carries them, degrading to prompt-and-parse when a server refuses the schema;
  the target is collected in Node and includes untracked files. Fixed a shipped defect on the way:
  an empty answer was reported as success. Live-verified against LM Studio — five findings on a real
  commit in 32s, a 74.5k-token input refused before sending, and a false positive correctly refuted
  rather than fixed. Design in `adr/003-structured-findings.md`.

- **OAI-2 + OAI-2b** — Context-window auto-detection and embedder exclusion. Completed 2026-07-27.
  Probes by response shape across LM Studio, vLLM, llama.cpp, TGI and (unverified) oMLX, trusting only
  served windows over model ceilings; automatic model selection drops embedders and refuses to guess
  between several candidates. Live-verified against LM Studio with all hand-set config removed:
  detected 58.1k with attribution, picked the chat model over the embedder, and still refused a
  65.4k-token input. Design in `adr/002-context-window-detection.md`.

- **OAI-1** — Plugin skeleton + `/oai:setup` + synchronous `/oai:task`. Completed 2026-07-27.
  Live-verified against LM Studio serving `qwen3.6-35b-a3b-ud-mlx` (58k loaded window): `/oai:setup`
  listed the provider and model, `/oai:task` returned real model output through a `--plugin-dir`
  load, the context guard refused a 65.4k-token input before sending, and a 22.5k-token whole-repo
  summarization ran in 62s. Reviewed by advisor, the lean workflow, and a high-effort `/code-review`
  (15 findings total, all fixed). Design in `adr/001-generic-openai-compatible-plugin.md`.
