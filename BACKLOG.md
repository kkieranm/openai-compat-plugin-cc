# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

**Current theme: make `/oai:review` trustworthy before extending the plugin further.** Where it
actually stands, stated plainly because it is easy to overrate: OAI-14 removed the largest
false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), and the 2026-07-30
OAI-19 attempt added two anchored true positives on a real commit diff (dense 27B on `scaffold`:
two *different* defects, one per attempt — `credential-inherited-across-origin`, then
`url-origin-strips-credentials`; neither found twice — joining the four anchored matches recorded
before it, one of which was the same case in commit mode by the old MoE quant on 2026-07-28) —
catches from arms that failed their acceptance gates, so recall remains without a publishable
number and the catches are existence proofs, not a rate. The binding constraint has moved: **server reliability — answered client-side by OAI-20
(2026-07-31), though whether retry recovers the observed 37.5% is itself a measurement OAI-19 will
read off the new attempt record — then the `analysis` ceiling where it still cuts** (dense on the largest cases; details under OAI-19).

The reviewer is useful once checking its claims costs less than its catches are worth. **OAI-15
(2026-07-28) changed how a censored run is treated, and raised the ceiling — it did not prove the
censorship gone, and the difference matters.** The `analysis` cap is now derived from the reply budget
each run is granted rather than fixed at a number the budget only coincidentally afforded, and a run it
truncates has its findings scored instead of discarded: half the corpus, 17 of 41 recorded runs, was
being thrown away along with two of the four anchored matches ever produced. So an agreement signal
(OAI-9) can now be measured through a sample that includes them, with the unresolved part shown as a
band rather than resolved by guesswork in either direction. **Whether the new ceiling is high enough
to stop truncating is a measurement, not a claim** — it is a wall-clock number, not one derived from a
distribution that was never observable. Measured 2026-07-30 (OAI-19 attempt, bounded — the arms
failed their gates): `config-origin` and `structured` no longer cut for the dense model
(`structured` on the diff-only rung there — see the confound note under OAI-19), but `scaffold`
still cuts 2/3–3/3 and `model-info` 1/3, so **the ceiling still binds for the dense model on the
largest cases**. See [ADR 008](adr/008-sizing-the-review-reply.md).

**OAI-12 has landed, so tuning is no longer guesswork — and it has now refuted its own first
headline, which is the instrument doing its job.** `npm run bench` scores the shipped command
against 11 catalogued defects in six snapshots of this repo's history and writes a per-run record,
ending the era where a conclusion was kept and its evidence thrown away (ADR 004 says "four runs",
`890ee2e` says "five", same experiment, neither now checkable). Baseline: ~~**1 of 6 scoreable defects
at N=1, 10.9 minutes**~~ — struck 2026-07-30: computed under the pre-OAI-15 rule that excluded cut
runs from the denominator, so it is not directly comparable with anything measured since (OAI-15
counts them, and reports the unresolved part as a band). **No comparable replacement exists yet** —
the OAI-19 re-measure was attempted 2026-07-30 and blocked by server reliability (see OAI-20);
until it completes, there is no baseline number for OAI-9 or OAI-11 to be scored against — though
OAI-20/OAI-21 (2026-07-31) removed what blocked it and gave the re-run an attempt-level record, a
warm-up and a control arm. 11 defects are catalogued, but 5 belong to the two cases whose
runs were cut mid-reasoning and are unscored rather than missed. **Re-measuring it under today's rule is OAI-19 —
OAI-20 and OAI-21 landed on 2026-07-31 and unblocked it** — because everything below it wants a
number to beat and the methodology note below is exactly about this.
**Reordered 2026-08-01: OAI-19 sits behind its prerequisites rather than ahead of them.** Two of
them change what the run would measure — OAI-23 fixed an attempt record that could file a terminal
failure as benign negotiation, which is the reliability figure OAI-19 reads, and OAI-22 fixed a
retry classification that filed terminal DNS and refusal attempts as `unclassified` in the very
`Failures by reason` table the write-up quotes — and OAI-24 must be decided before that write-up
names a mechanism. Landing them afterwards would mean running the corpus twice. **OAI-23 and OAI-22
are done (2026-08-01)**; OAI-23's review filed OAI-25 and OAI-26, which remain ahead of the run.
*(OAI-22's `--warm-up` half was originally ordered here as "exactly the two-arm case OAI-19 runs".
That was wrong: OAI-19 runs one arm per model as separate invocations, each passing `--model`, which
overrides every case — so each arm resolves to a single pair and nothing evicts anything. The
warm-up fix is latent robustness for mixed-pair invocations, not an OAI-19 cost.)* The order is
**OAI-25 → OAI-26 → OAI-24 → OAI-19**; **OAI-25 landed 2026-08-01, OAI-26 on 2026-08-02 and OAI-24
on 2026-08-03**. OAI-24 did not answer the JIT-TTL question so much as establish that a sweep cannot
— it decided the design and shipped the instrument, and the *run* is **OAI-34**, so the remaining
order is **OAI-34 → OAI-19**. One of its two headline results is now retracted
and the other has grown:

**Reordered again 2026-08-01, impact first: OAI-30 moved down to sit beside OAI-28.** It had been at
the top on filing date rather than on impact — it is a doc-comment correction, and everything above
it either unblocks the OAI-19 measurement or settles a disputed security call. The pairing is the
stronger half of the reason: **OAI-28 and OAI-30 are the same edit twice** — "drive `bodyStream`
directly with a stub", one for the `!response.complete` branch and one for the catch below it — and
both collide with the same 299-of-300 ratchet in `tests/structure.test.js`, which OAI-30 already
proposes escaping by putting the fixture in `tests/cap-ordering.test.js`. Adjacent means that
placement decision is made once, against both tests, instead of twice against one.

- ~~**Context dilution is measured.**~~ **Retracted 2026-07-28, by the instrument itself.** The
  "found at 1,575 tokens, missed at 47,072" pair varied token count, git mode, prompt shape and
  defect count together, at N=1 per arm. A three-arm run settled it: the same case at **half the
  tokens produced zero findings in three runs**, and the corpus's *smallest* input was cut 3 times
  out of 3. There is no dilution effect in this data, and the reordering it was about to justify has
  been dropped. See the correction section in [ADR 006](adr/006-benchmarking-the-reviewer.md).
- **The `analysis` cap was the binding constraint, and it was mis-sized.** **17 of 41 runs ever
  recorded here never finished looking.** The ceiling was set in OAI-10 "above every observed
  successful run" from a sample that had not yet seen a normal run reason long — it sat *inside* the
  model's ordinary reasoning distribution, truncating working reviews rather than runaways. Cutting
  does **not** track input size: the 1,575-token case reasoned for 7,367–9,440 completion tokens
  where the 47,072-token case used 3,552, and the corpus's smallest input cut 6 of 9 while a case
  barely larger cut 0 of 9. **Addressed in OAI-15, 2026-07-28** — and note what that did *not*
  settle. The reasoning distribution had no observable right edge under a cap truncating 41% of runs,
  so the new ceiling is sized from wall clock rather than from the distribution, and whether it still
  binds is a measurement to be read off the next full corpus run.

What the bench is *not* is a measure of true recall: the denominator counts only defects that could
be pointed at in the snapshot, which is smaller than what history claims and therefore flatters it.
See [ADR 006](adr/006-benchmarking-the-reviewer.md); the harness prints the same caveats every run.

**A standing methodology note, earned the hard way.** Two claims in this file were promoted from a
single run per arm, and both were wrong: "context dilution is measured" (retracted above) and, one
paragraph after diagnosing that error, "two passes found different defects, so a union would score
2/2" — which compared runs from two *different modes* and never reached this file only because it was
caught first. **N=1 per arm is a lottery ticket, not a comparison, and a pair of cases that differ in
more than the variable under test measures nothing.** Both are cheap to avoid: `--runs N` exists, and
`--diff-only` gives a within-case arm.

> **Discharged 2026-07-27:** the owed built-in `/code-review high` ran over `structured.mjs`,
> `client.mjs` and `cmd-review.mjs` (`c552bcd..HEAD`), covering OAI-4 and OAI-10 in one pass —
> 25 agents, 1.07M tokens, no deaths. Ten findings: **5 confirmed and fixed**, 5 vendor-dependent
> and parked as **OAI-13**. The new-module trigger earned its keep: the two most severe (a cut
> review rendering as a clean pass; a 12k-token input-budget regression) were both in exactly the
> vendor-assumption code the trigger targets, and neither `advisor` nor the lean workflow caught
> them across four and two passes respectively.

- **OAI-31** — Five findings OAI-26's pass 3 raised and its own rules would not let it fix. Filed
  2026-08-02. Pass 3 is the no-mutation pass, so these were recorded rather than patched; a fix there
  would have shipped prose and tests no lens had read, which is the failure the cap exists to
  prevent. Two are false sentences in **rendered output**, so do this before OAI-19's write-up quotes
  the table. Ordered by whether a reader is misled:
  **(1) "the reason code is all an attempt record carries" is false.** Raised at confidence 1.0 by
  the adversarial pass and independently by the plain one — two lenses, the only finding in the
  feature to be caught twice in a single pass. `newEntry` also records `index`, `cause`,
  `promptChars`, `warmEligible`, `waitedMs`, `outcome` and both timings. The intended claim is much
  narrower and is true: the record retains **nothing further about the transport error**. Delete or
  narrow the `because…` clause in `reasonNotes`. **The doc-comment half is DONE (2026-08-03, OAI-24)**
  — that sentence also scoped its claim to the whole file, which stopped being true when a paragraph
  claiming from an attempt's *timings* landed beside it, and editing it to rescope while leaving a
  clause known to be false was not an option. The **rendered** string is untouched and still open:
  `reasonNotes` line ~69 still says "because the reason code is all an attempt record carries".
  **(2) "a replacement request without it was dispatched" equates entry creation with the wire
  write** (0.94). `ledger.begin` mints the replacement's entry before `request` serializes and sends,
  so what is guaranteed is that the replacement *received its own attempt entry* — which is exactly
  what the following sentence already says, and is the precise, checkable version. Note this is the
  sentence OAI-26 was asked to tighten, so it was rewritten once already; the second draft traded one
  imprecision for another.
  **(3) The two-fixture test at `tests/bench-reliability.test.js:190` is vacuous.** Proved by
  mutation: the paragraph is static prose gated only on a reason code and never reads `run.error`, so
  replacing the fixture with junk leaves the suite green. Its comment claims the pair "proves the
  difference" and it discriminates nothing — the trap class reproduced one level up, at the test.
  Either delete the parametrisation or make the assertion actually read the failure listing.
  **(4) `assert.match(markdown, /`shape-rejected`/)` passes on the count-table row**, not the prose it
  was written to pin. Proved by mutation: replacing the whole paragraph body with a placeholder
  leaves that assertion green (its two siblings catch it, so this is an assertion that passes for the
  wrong reason rather than a coverage hole).
  **(5) `sawReason`'s exact match is unguarded, and this one has teeth.** `key === code` survives
  mutation to `key.includes(code)` with all 399 tests green — and `transport` is a **substring** of
  `non-retryable-transport`, so under the loosened gate a sweep whose only failures are
  `non-retryable-transport` also prints the `transport` paragraph, asserting "a further attempt could
  plausibly survive" about a code that by definition was never retried. That is the exact wrong-gate
  defect OAI-26 was reviewed three times to remove, reachable by a one-token edit. The existing
  negative test only checks the reverse containment, which is vacuous. One test fixes it: a
  `non-retryable-transport`-only sweep asserting the `transport` paragraph is **absent**.
  **(6) Minor, while in the file:** the transport test's
  `assert.match(para, /not\*\* a count of server misbehaviour|not a count of server misbehaviour/)`
  is an alternation that passes whether or not the emphasis is there, so it does not pin what its
  two branches disagree about. Pick one. Noticed while writing this item rather than by a reviewer,
  which is why it is filed with the four they found rather than as its own thing.

- **OAI-32** — Stop `review-lean`'s verifiers mutating the LIVE working tree. Filed 2026-08-02 from
  OAI-26's pass 3, where it was observed rather than triggered — and the observation is the whole
  point, because nothing in the commit gate would have caught it. Verifiers prove findings by
  editing the tree and running the suite (which is exactly why their findings are trustworthy: two
  of OAI-26's best were mutation-proved). They restore afterwards by hand. In pass 3 one verifier
  reported watching **another verifier's** edit appear and revert underneath it, and rebuilt a
  pristine baseline elsewhere to get a trustworthy result; a second reported the same interference.
  Nothing went wrong this time — the files were read in full before the commit and were byte-correct
  — but **the failure mode is silent and undetectable by the usual checks**: the very finding those
  verifiers filed is that `key === code` → `key.includes(code)` leaves all 399 tests green, so a
  green suite proves nothing about an unrestored mutation, and neither does a grep. A wide run
  leaves a window in which the tree may not be what the author thinks it is.
  **The fix is not in this repo**: `.claude/workflows/review-lean.js` is a symlink into
  `~/Code/dotfiles`, and the `Workflow` tool already supports `isolation: 'worktree'` per agent,
  which exists for precisely this ("agents mutate files in parallel and would otherwise conflict").
  It costs ~200–500ms and disk per agent, which is nothing against a 500k-token verifier stage. Two
  parts: give mutating verifiers their own worktree, and — since a verifier that cannot mutate
  cannot prove — keep the mutation capability rather than forbidding it. Filed here rather than only
  in the dotfiles repo because this is where it bit and where a session picks up work; the edit
  itself belongs there and must be committed there.
  **While in that file, one reporting fix too.** A wide run whose verifiers die returns
  `findings: []` with `unadjudicated: N` and a `failures` block — a died run that reads as a clean
  one, which happened in OAI-26 pass 1 and hid a real defect until it was resumed. The standing rule
  says never read "no findings" off a run that died; the workflow should make that impossible to get
  wrong by refusing to report `findings` as authoritative while `unadjudicated > 0`.

- **OAI-34** — **Build** the TTL challenge instrument, then run it. Filed 2026-08-03 by OAI-24, which
  decided the design ([ADR 013](adr/013-observing-the-server.md)) and **withdrew the driver from its
  own commit** after two review passes. This is build-then-run, not just run.
  **The prerequisite is production code, and it is why the withdrawal happened.** The attempt record
  cannot say whether the server responded: `scripts/lib/http.mjs` sets `error.serverResponded = true`
  on a mid-body socket cut and `cmd-setup.mjs` already reads it for this exact question, but
  `attempt-outcome.mjs` never copies it onto the entry. So a model evicted mid-prefill **before any
  text** — the event the experiment exists to detect — is recorded as `reason: 'transport'` with a
  null `prefillMs`, indistinguishable from an `ECONNREFUSED` that reached no peer. Carry
  `serverResponded` onto the entry first; it touches the module OAI-20/22/23/25 hardened, so it gets
  its own plan gate.
  **A reviewed draft exists in the working tree, UNCOMMITTED and not launchable** —
  `bench/ttl-challenge.mjs`, `bench/lib/ttl-verdict.mjs`, `tests/ttl-challenge.test.js`. It is worth
  starting from rather than rewriting: its decision rule is pure and unit-tested, and the eight pass-1
  defects are already fixed in it. **It is untracked, so `git clean` would destroy it.** Ten pass-2
  findings remain open against it, and the first three each let it issue a verdict the evidence does
  not support:
  **(1)** `runEpisode` reads a top-level `report.prefillMs`, which the **failure** envelope does not
  carry (`review-report.mjs:104` is the success path only) — so `firstTokenMs` is null on every
  failed episode, `exposed` silently falls back to wall clock, and `activityObserved`'s window
  restriction goes inert on exactly the episodes that matter. Read it from `attempts`, as
  `attempt-rows.mjs` does.
  **(2)** The confirming branch never requires `unloadAt < firstTokenMs`, so an unload during
  **generation** renders `mechanism-reproduced` while the summary string asserts it happened "during
  an active prefill".
  **(3)** The two thresholds leave a gap — 130s in flight (not an exposure) with an unload at 125s
  (past `ttlMs`) classifies as confirming. Gate it on `exposed` too, and give the leftover state its
  **own** label: reusing `failed-early-with-unload` would print a false string.
  **(4)** The mismatched-TTL warning says "this episode cannot be classified" and then classifies it.
  **(5)** `calibrate` throws, discarding the calibration record — write an aborted manifest carrying
  `summarize(..., { calibrationCleared: false })` and exit nonzero.
  **(6)** `reachedServer` has **zero** unit tests, and its doc comment claims HTTP status is evidence
  when the attempt schema never retains `status`.
  **(7)** The calibration rule (`dispatched && !failed && firstTokenMs`, no `durationMs` fallback)
  lives in the untested I/O half — extract it as a pure `calibrationCleared(...)`.
  Then run it: **~45 minutes on the user's own LM Studio, launched when they say so, never
  incidentally** — same rule as OAI-19, which it sits ahead of because OAI-19's write-up may not name
  a mechanism until this has run. Nothing else may be connected: another resident model can trigger
  Auto-Evict and produce the shape the experiment reads. Done when
  `bench/results/ttl-challenge-*.json` exists and its `outcome.verdict` is recorded here with the
  wording ADR 013's table permits — and **`instrument-failed` is not a result**, it means the
  instrument did not run.

- **OAI-19** — Re-measure the baseline on the full corpus, dense 27B against the MoE, before any
  arm is read as an improvement. **This is a measurement, not a feature. OAI-20/OAI-21 unblocked it
  (2026-07-31); the three items above it are its prerequisites, not competitors, and every item
  below it wants a number to beat.** It is also the one item here that is hours of wall clock on the
  user's own LM Studio rather than an edit, so it is launched when they say so, never incidentally.
  Run it with `--warm-up` and `--max-attempts 3`, and take a `--max-attempts 1` control arm on at
  least one case so the record shows what retry was worth rather than only the retried rate. The recorded baseline — **1 of 6 scoreable defects,
  10.9 minutes, N=1** — was computed under the pre-OAI-15 rule that *excluded* cut runs from the
  denominator, and 17 of 41 runs recorded at the time were cut. OAI-15 now counts them and reports
  the unresolved part as a band, so that figure cannot be differenced against anything measured
  since: an OAI-9 union scoring "2 of 6" against it would be comparing two denominators, which is
  the N=1-per-arm error in the methodology note above wearing a different hat.
  Two things changed at once and must be separated, which is the whole design of the run: the
  **scoring rule** (OAI-15) and the **model** (the local server moved from the MoE
  `qwen3.6-35b-a3b-ud-mlx` to the dense `qwen/qwen3.6-27b`). Measuring only the dense arm would
  leave every prior number unusable and attribute the OAI-15 rule change to the model swap. So:
  both models, full corpus, `--runs 3` — N=1 is a lottery ticket, established twice in this file at
  the cost of two retracted claims — and one arm per model with nothing else varying.
  **The JIT-TTL question moved OUT of this run, 2026-08-03.** OAI-20 deferred it here and OAI-24
  found it could not be answered by a sweep at all: sampling residency around a run cannot tell
  "loaded throughout" from "unloaded then silently reloaded". It is now **OAI-34**, a 45-minute
  intervention run *before* this one, and this run may quote only what
  [ADR 013](adr/013-observing-the-server.md)'s outcome table permits. Two corrections that item
  produced and this one must not repeat: the **"10-minute idle TTL" has no provenance** here (LM
  Studio documents a resetting timer with a 60-minute JIT default), and every measured dense prefill
  — `scaffold` 335s, `model-info` 286s, `structured` 191s — sits *below* even the 600s the
  hypothesis assumed. If the mechanism is confirmed, `--warm-up` and pacing matter more than retry
  does; the attempt record carries what would show it (`promptChars`, `waitedMs`, per-attempt
  timings), and OAI-24 shipped the reader that splits failures on whether a prefill was measured. **Whether OAI-15's wall-clock ceiling still binds** (answered in bounded form by the 2026-07-30 attempt — see below), and OAI-18's
  `prefillMs`/`generationMs` per case, which OAI-9 needs in order to cost a warm pass honestly.
  The OAI-11 termination caveat does not apply on one LM Studio, but cross-model `gen tok/s` is
  still only approximate — token counting need not be identical across models; wall-clock
  generation time is the directly comparable figure.
  Expect a JIT model load between arms. **With `--warm-up`, which this item mandates, the first case
  no longer carries it** — the warm-up absorbs the weights load, and `--cold` handles the separate
  question of prompt-cache uniformity. (Before OAI-21 that load landed on case 1 as a cold prefill
  that was not the model's; OAI-9's 421.7s-cold against 11.5s-warm on one 56,805-token request says
  how large the distortion would be if the flag were omitted.)
  Done when both arms are recorded with their bands, the pre-OAI-15 figure is struck through in this
  file, and the comparable one replaces it as the number OAI-9 and OAI-11 are scored against.
  **Attempted 2026-07-30 — blocked on OAI-20, and the attempt is the evidence behind it.** Both arms
  ran twice (a predeclared one-retry-per-arm rule, every invocation reported); neither ever passed
  its acceptance gate (every case `scored=3`, no failed/truncated/unreadable/substituted runs), so
  under the plan's own terms **nothing here is published as the measurement** — the failure rates
  moved to OAI-20 are the deliverable this attempt actually produced. What the scored runs showed,
  stated as bounded observations, not the baseline: (a) the dense 27B anchored two `scaffold`
  defects on a real commit diff — *different* ones, one per attempt
  (`credential-inherited-across-origin`, then `url-origin-strips-credentials`), each hit in one
  scored run of three and neither recurring in the other attempt — two independent catches, not
  one catch replicated, and **not the benchmark's first**: four anchored matches predate them,
  including the same defect on the same case in commit mode by the old MoE quant
  (`bench/results/2026-07-28T07-57-15-522Z.json`);
  (b) the OAI-15 ceiling **still binds for the dense model on the largest cases** — `scaffold` cut
  2/3 then 3/3, `model-info` 1/3 in each — while `structured`, historically 4/4 cut, was never cut
  in any dense scored run, **but that last observation is confounded**: the dense model's smaller
  served window (61,696 vs the MoE's 71,936 — the MoE figure read live off `lms ps`, not present
  in any bench record; provenance in ADR 008) sent `structured` down ADR 005's diff-only rung
  (`hunksOnly: true`, ~28.6k prompt tokens) where the MoE received whole files (~59.7k), so "never
  cut" there may only mean "much smaller input", and the two arms did not review the same
  `structured` request; (c) the MoE generates ~4× faster (~50–78 vs 13–17 tok/s, prefill ~5×
  faster, a full arm in ~25 min vs ~3 h) and produced one **range** match on `scaffold`
  (`anchored=0` — a looser standard than the dense arm's anchored catches), finding nothing else;
  (d) the MoE arm ran as `qwen/qwen3.6-35b-a3b` — the `-ud-mlx` quant
  the old baseline used is no longer served, so even a clean future arm is a different quant, which
  the record must footnote. The MoE arm was launched with arm 1 already incomplete (a deliberate
  decision, to test whether the failures were model-specific; they are not). Raw records
  `bench/results/2026-07-30T*.json` with rendered reports beside them as
  `2026-07-30-oai19-arm-{dense,moe}.log` (gitignored; the quotable summary is in ADR 006).

- **OAI-27** — Run `/security-review` over the transport-classification path. Filed 2026-08-01 from
  the OAI-22 ladder, where it was **evaluated and not triggered, and that call is disputed**. The
  skill's trigger list is auth/sessions, personal data, money movement, secrets and credentials, or
  anything irreversible — OAI-22 touches none of them, so it was skipped and the specific concern
  raised (`transportError` now branches on a `cause.code` that arrives from a remote peer, and a TLS
  rejection such as `CERT_HAS_EXPIRED` becomes `non-retryable-transport` with `cause.message`
  interpolated into a `UserError`) was closed by an explicit assertion instead: the code is preserved
  and the message still names the certificate. The `advisor` argued that is a security lens being
  recorded as "not triggered" when it does trigger. Cheap to settle, so settle it rather than leave
  the disagreement in a commit message: one fan-out over `http-errors.mjs`, `http.mjs`,
  `provider.mjs`. If it finds nothing, the trigger list stands as written and this closes as a
  recorded judgement rather than an open question.

- **OAI-28** — Give `http.mjs`'s `!response.complete` branch behavioural coverage, or record why it
  cannot have any. Filed 2026-08-01. That branch — a socket cut mid-body ending the iteration with
  **no** `'error'` event — is the most retryable shape in the codebase, had **no test at all** before
  OAI-22, and OAI-22 *modified* it (the bare `'transport'` literal became the `TRANSPORT` constant).
  It is still untested behaviourally, and not for want of trying: measured on Node 26.3, both ways of
  cutting a body (a short `content-length`, and chunked with no terminator) raise on the stream
  instead, so the catch one line below handles them and this branch is never entered. The test added
  in OAI-22 asserts the *verdict* both paths must share, which is honest but does not reach here —
  proved by mutation: flipping this branch's constant left the suite green. Options: find a cut that
  Node reports as a clean end (an HTTP/1.0 connection-close body with a truncated payload is the
  likeliest candidate), drive `bodyStream` directly, or conclude the branch is unreachable on current
  Node and say so in a comment rather than leaving a silent hole. The constant swap already removes
  the divergence risk that motivated touching it, so this is coverage, not correctness.

- **OAI-30** — Retire the last "cannot be tested" justification, at `tests/structure.test.js:279,287`.
  Filed 2026-08-01 from the OAI-25 ladder (Codex adversarial, low/0.97, pass 3 — the no-mutation
  pass, so recorded rather than fixed; a fix there would have shipped unreviewed). The guard is
  OAI-22's, it is correct, and nothing about `delivered: true` is in doubt. What overclaims is its
  doc comment: "nothing behavioural can pin it" and "A test cannot make Node drop the code on
  demand". The evidence behind those sentences is narrower than they are — it establishes that on
  Node 26.3 a real mid-body cut *happened* to carry `ECONNRESET`, not that no test can exercise the
  code-less path. **The fix is known and cheap**: drive `bodyStream` directly with a stub async
  iterable that throws a code-less error, and assert the verdict stays retryable — which is
  OAI-28's "drive `bodyStream` directly" option applied one line lower. Adjacent to OAI-28 but
  distinct: that item is the `!response.complete` branch, this is the catch below it. Third confirmed
  instance of the class now recorded in `.claude/REPO_TRAPS.md`; the other two were OAI-25's subject
  and OAI-25's own first draft.
  **Budget note, because it will bite whoever picks this up:** `tests/structure.test.js` sits at
  **299 of the 300-line ratchet**. OAI-25's comment rewrites there were net-neutral by construction
  for exactly this reason. This item rewrites a comment in that same file *and* the honest replacement
  is longer than what it replaces, so room has to be made first — tighten neighbouring prose, or move
  the new behavioural test into `tests/cap-ordering.test.js` (204 lines) where the clock/stub fixtures
  already live. Raising the ceiling is the one option that needs a stated reason, per the ratchet's
  own rule.

- **OAI-29** — Let the transport ARM from a recomputed remaining budget, without letting it refuse.
  Filed 2026-08-01 from the OAI-22 adversarial review (Codex, medium/0.96), where the finding was
  accepted as a *claim* correction and its recommendation deliberately not taken. The claim: OAI-22
  carries one `capBudgets` result from `postWithDegrade` into `postChat`, so the `totalMs` the
  transport arms is computed a few call frames before the socket is written. There is no `await` in
  that gap, but `ledger.begin` serializes the messages for `promptChars` and `request` serializes the
  body again — milliseconds on a 60k-token prompt — so a request dispatched a hair after expiry is
  granted the duration that remained at the check. Codex recommended carrying the absolute expiry
  into the transport and validating it at arming time; that half was **rejected and stays rejected**,
  because a transport that can *refuse* at arming reopens exactly the phantom-ledger-entry window
  OAI-22 closed. The safe half was never done: recompute the remaining time at arming and use it for
  the timer *only*, never to reject. Strictly tighter than today, no new refusal path, and it makes
  the generosity exactly zero instead of merely small. Small, and immaterial at present scales — the
  cap is seconds, the slip is milliseconds — so it is filed rather than urgent.
  **Independently rediscovered 2026-08-01 during the OAI-25 ladder**, by a `review-lean` verifier that
  had run the mutation itself, which is worth recording because it also states the coverage boundary
  precisely: a `postChat` that re-armed *from the carried `budget.totalMs` duration* rather than
  re-deriving from `expiresAt` would pass both new `cap-ordering.test.js` tests **and** the
  `occurrences(post, 'capBudgets(') === 0` structural guard. That is not a hole in those guards —
  re-arming from the already-checked value does not reopen the OAI-22 window, and none of them ever
  claimed to cover it — but it means **this item's window is guarded by nothing at all**, so if it is
  ever done, it needs its own test rather than an assumption that the OAI-25 pair reaches it.

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

- **OAI-3** — Background jobs: `--background`, plus `/oai:status`, `/oai:result`, `/oai:cancel`.
  Port the reference plugin's generic job model (per-workspace state dir, light index + per-job
  record, detached self re-exec worker); replace its RPC interrupt with an `AbortController`.

- **OAI-5** — A delegation subagent (`/oai:rescue` + a thin forwarding agent) so a long local-model
  run does not consume the main session's context.

- **OAI-33** — Write `plans/README.md`, which the `/feature` skill already points at and this repo
  does not have. Filed 2026-08-02, noticed while filing OAI-26's plan. The skill says naming,
  collisions, the `draft`/`final` distinction and provenance "live in `plans/README.md`" — so the
  one place those rules are supposed to be written down is missing here, and six plans have been
  written without them. In practice a convention has emerged and should just be recorded rather than
  invented: `oai-NN-slug.md`, one per item, occasionally spanning two IDs where the work was
  (`oai-20-21-survive-the-server.md`). Worth stating explicitly: a plan is **not** rewritten when
  review refutes it — OAI-26's carries a dated correction block at the top and leaves the refuted
  text in place, because the plan is the record of what was believed at the time, and that is the
  convention the next one should follow. Housekeeping, so it sits down here; it costs one short file.

- **OAI-7** — Publish: README install instructions, and verify the marketplace path
  (`claude plugin marketplace add`) actually resolves this repo once it has a remote.

- **OAI-13** — Vendor-dependent findings that need a second server to settle. **Now seven.** Added
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
  wait for one rather than being fixed blind. (1) `isFormatRejection` reads `error.message`, which
  `client.mjs` truncates to 400 characters — a server whose validation dump names `response_format`
  later never triggers the degrade path, and `/oai:review` dies on a raw 400 instead. (2) The same
  matcher fires on *any* 400 whose body echoes the request, asserting "rejected response_format"
  as a cause it only guessed. (3) `parseFindings` picks a channel before parsing and never falls
  back, so one stray non-whitespace character in `content` discards a schema-valid payload sitting
  in `reasoning`. (4) With the window unknown, `reserveFor` still puts `max_tokens: 16384` on the
  wire, where `/oai:task` sends none — a server that rejects an oversized `max_tokens` fails for a
  reason the plugin chose. (5) On the degraded path a bare findings *array* is discarded, though the
  adjacent comment promises repair. Fixing (1) and (2) properly probably means the server's status
  or error `type`/`code` field rather than prose, which is an ADR 002 shape-not-name question and
  the reason this is one item rather than five.
