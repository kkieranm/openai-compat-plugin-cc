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
— it decided the design and shipped **that decision only**. Its draft instrument was **withdrawn**
after two review passes and is not in the repo, so **OAI-34 was build-then-run** — **the build landed
2026-08-04 and only the run is outstanding**, and the remaining order is **OAI-34 → OAI-19**, OAI-35
having landed 2026-08-03. The build changed what the run can conclude: the instrument refutes and
cannot confirm, so OAI-19's write-up may not name JIT-TTL under **any** outcome. One of its two headline results is now retracted
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

- **OAI-34** — Run the TTL challenge instrument. **The instrument is BUILT and self-tested as of
  2026-08-04; what remains is the ~45-minute run on the user's own LM Studio, launched when they say
  so, never incidentally.** Nothing else may be connected: another resident model can trigger
  Auto-Evict, which the sole-tenancy check now catches and voids the sweep over rather than scoring.
  **What shipped, and the one design change worth reading first: the instrument REFUTES but cannot
  CONFIRM.** The confirming verdict was withdrawn during the plan gate after four designs each failed
  on a different axis, because of a structural fact rather than an implementation gap — proving an
  unload happened after expiry requires observing the model still resident *after* expiry, and a
  mechanism that fires *at* expiry never leaves that observation behind. So `mechanism-reproduced` is
  gone, ADR 013's outcome table lost its confirming row, and an observed absence is recorded in full
  (`unloadAt`, `lastPresentAt`, bracket width, polling gaps, `exposureRatio`) and **attributed to
  nothing**. Refutation is unaffected: the spawn-to-request offset cancels between the two sides of
  the survival comparison, leaving `c < prefillMs - ttlMs` — the slack each episode achieved, ~215s at
  the measured `scaffold` prefill — which the verdict sentence states and the manifest records, quoting
  the *narrowest* episode. See [ADR 013](adr/013-observing-the-server.md)'s 2026-08-04 amendment, and
  **OAI-44** for the parked confirmation question.
  **The done-condition is rewritten, because the old one was already satisfied by junk.** Not "a file
  matching `bench/results/ttl-challenge-*.json` exists" — a pre-stash draft left one whose every
  episode died in ~1s at `--max-tokens 2048` against a 3,912 floor, and it recorded a verdict about
  the server anyway. That file was deleted 2026-08-04. **Done when a record exists with
  `protocol.canonical: true`, a stamp later than the commit that landed the instrument, and an
  accepted `outcome.verdict`** — and the handover records the exact result path
  and the instrument's commit SHA**, since a timestamp alone does not attest which revision produced
  it.
  Accepted verdicts: `deterministic-form-refuted`, `inconclusive-failure`. *(That line is parsed by
  `tests/ttl-vocabulary.test.js` and compared set-wise against the `CONCLUSIVE` list the driver's exit
  code imports. **That pins THIS line and nothing else** — a contradictory acceptance clause added
  elsewhere in the entry would not be caught, which a terminal review round demonstrated by adding one
  and watching the suite stay green. So the guard is a tripwire on the canonical line, not a proof the
  paragraph as a whole agrees with the code. An earlier draft said "any verdict other
  than `instrument-failed`", which
  quietly re-admitted `no-exposure` and `contradictory-evidence` — both of which ask to be re-run in
  their own text. Naming the two acceptable verdicts is the fix, and the driver now exits non-zero for
  everything else, so the exit code and this paragraph read one rule.)* `protocol.canonical` is false whenever any experimental parameter was overridden, which is what
  keeps a harness run from ever being mistaken for the experiment.
  **Known gap, stated rather than discovered later:** the withdrawn draft carried ten open pass-2
  findings and only eight are recoverable — seven were enumerated in this file and the eighth was the
  `serverResponded` blocker OAI-35 fixed. **Two were never written down anywhere.** The end-to-end
  harness is the recovery mechanism for them: it drives the real entry point against a stub `lms`, and
  it is the thing OAI-24 never had. **Neither has been recovered yet** — the harness's first run
  surfaced two defects in the harness's *own* scenarios, not in the instrument, and the one real
  instrument defect found during the build (`[].every()` is `true`, so an empty episode list rendered
  `deterministic-form-refuted` from zero episodes) was caught by reading rather than by running. Say
  so rather than letting "the harness caught things" stand in for "the two lost findings are back".
  **To run it:** `node bench/ttl-challenge.mjs` from the repo root, ~45 minutes, with LM Studio
  serving, `lms ps` reporting nothing resident, and nothing else connected. No flags — every flag except `--out-dir`
  makes the run non-canonical (writing the record elsewhere does not change what was measured).
  **The stash is gone, deliberately.** The withdrawn 876-line draft used to live in `stash@{0}` and
  the old text here said to `git stash pop` it. That became a **trap** the moment the rebuilt modules
  landed: popping would have dumped the superseded draft over `bench/lib/ttl-verdict.mjs` and
  `bench/ttl-challenge.mjs`. It was dropped after the build. **The archive is commit `873dc05`** —
  `git show 873dc05^3` while it survives gc — and it is superseded, not lost.

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
  **Enlarged 2026-08-04 by OAI-35, which added a second untested write to the same branch and
  re-proved the first.** That branch now sets `serverResponded = true` as well as the reason, and
  deleting *that* line also leaves the whole suite green — so the hole is two lines wide, and the
  half OAI-35 added is the half its own record depends on. OAI-35's `tests/attempt-response-sites.test.js`
  names this branch as uncovered rather than implying coverage, and an earlier draft of that file was
  wrongly credited with reaching it; a debug stack showed the request leaving through the catch below,
  exactly as this item recorded in 2026-08-01. **So whichever option is taken here, take it for both
  writes** — a fixture that reaches the branch should assert the reason *and* the flag, and a comment
  concluding unreachability must say so about both. (OAI-38 was filed for this and withdrawn as a
  duplicate the same day.)

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

- **OAI-36** — If a re-render command is ever added, the reliability prose becomes schema-dependent.
  Filed 2026-08-03 from the OAI-31 review, where it was raised at high confidence (0.99) and
  **dismissed with evidence rather than fixed** — recorded here because the evidence is exactly what
  a future change would invalidate. `reliabilitySection` renders "an attempt record carries `<nine
  fields>`" from `RECORD_FIELDS`, pinned against a live ledger entry. That sentence is true of
  entries the *current* ledger produced, and today it can only ever describe those: `renderReport` is
  called from exactly one place, `bench/run.mjs:251`, on live results, and nothing reads
  `bench/results/*.json` back in. Add a `--render <file>` or any replay path and the report can
  describe a record written before `promptChars` or `waitedMs` existed, while the prose asserts nine
  fields it never had. The fix then is to version the serialized attempt schema at the report
  boundary and condition the enumeration on the schema actually present — not to weaken the sentence,
  which is the one thing that made it checkable. Cheap now, invisible later: whoever adds replay will
  not think to look at a paragraph in the reliability section.

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

- **OAI-38** — **WITHDRAWN 2026-08-04, same day, as a duplicate of [OAI-28](#). Use OAI-28.** The ID
  is kept because `plans/oai-35-server-responded.md` cites it in commit `a2395f6`, and a dangling
  reference is worse than a redirect. Filed from OAI-35's pass 3 for `http.mjs`'s `!response.complete`
  branch — which OAI-28 had already covered since 2026-08-01, and covered better: OAI-28 records that
  **both** obvious fixtures were measured on Node 26.3 and **both** raise on the stream instead, and
  names an HTTP/1.0 connection-close body as the likeliest remaining candidate. This item rediscovered
  the first half of that and proposed the two fixtures already ruled out.
  Worth stating why it happened, since the backlog is the thing that was supposed to prevent it: the
  finding arrived from a reviewer, was verified against the code, and was filed without first being
  searched for in `BACKLOG.md`. **Verifying a finding is not the same as checking whether it is
  already tracked.** Its one piece of new evidence has been moved into OAI-28.

- **OAI-39** — Four reads that hold only because today's callers behave. Filed 2026-08-04 from
  OAI-35's passes 2 and 3, where `codex-plain` and `codex-adversarial` raised them and they were
  rejected **only** as out of that commit's scope — every one predates OAI-35 and none was introduced
  by it. They are one item because they are one shape: *unreachable by an audit of today's call
  sites, rather than unreachable by construction* — and OAI-35 twice found that exact reasoning had
  quietly stopped being true, which is the whole reason they are worth the edit.
  1. **`attemptRows` counts `warmEligible` by truthiness** — `bench/lib/attempt-rows.mjs`,
     `all.filter(({ attempt }) => attempt.warmEligible)`. Any truthy value counts, the string
     `"false"` being the memorable one. Every sibling split in that function was tightened to a
     strict check during OAI-35; this one was missed.
  2. **`unresolved` tests `outcome === null` only** — same file. A serialized record that omits
     `outcome` carries `undefined`, so it increments `total` while landing in none of `answered`,
     `failed`, `refused` or `unresolved`. The totals then disagree with themselves, which is
     precisely the bug that bucket exists to make visible.
  3. **`runTotals` tests `run.error` for truthiness** — `bench/lib/reliability-report.mjs`. A failed
     run whose message is the empty string is reported as having completed, in the one line that
     states both denominators.
  4. **`withLedger` assumes the thrown value takes a property** — `scripts/lib/attempt-ledger.mjs`.
     `error.attemptRecords = ledger.entries()` on a thrown string or a frozen object throws a
     `TypeError` from strict-mode ESM, replacing the original failure with a confusing one at the
     exact moment the ledger was trying to preserve evidence about it.
  Each is a one-line fix plus a test that the bad value does not count — matching what
  `responseBucket` now does beside (1).
  **5. `reachedTheModel` reads `error?.status !== undefined` too — and this one is NOT a
  one-line fix. Read this before touching it.** It is the same loose check, in
  `scripts/lib/attempt-outcome.mjs`, sitting directly above the `obtainedResponse` that OAI-35
  tightened — so whoever does 1–4 will see the asymmetry and be tempted. The difference is the
  failure DIRECTION. A `status: null` makes it return `false` early, skipping the completion-shape
  and prefill checks below, so an attempt is left NOT warm-eligible. That under-marks, and ADR 012
  records under-marking as the deliberately chosen lesser evil: over-marking deletes a real cold
  prefill measurement with no trace, while under-marking quotes a possibly-warm figure beside a
  caveat that says so — only the second is visible to a reader. So the current looseness fails
  safe, which is why OAI-35's pass 3 rejected changing it and why it is recorded here rather than
  fixed. It is still wrong in one case worth naming: `{status: null, prefillMs: 7}` had a prefill
  measured, so the prompt WAS reached and a repeat could be served warm, and the early return says
  otherwise. Any fix must preserve the conservative direction — tighten the type check without
  letting a genuinely absent status fall through to a `true` it has not earned — and must come with
  a test asserting the cold-prefill column does not gain entries it never measured.

- **OAI-40** — Two pre-existing tests that do not prove what they are named for. Filed 2026-08-04 from
  OAI-35's passes 2 and 3 (`codex-plain` both times), rejected there as out of scope. This is the
  class OAI-35 added to `.claude/REPO_TRAPS.md` — *a test that manufactures or sidesteps the evidence
  it claims to guard* — found in tests that predate it, so the entry earns its keep immediately.
  1. **`exactly one attempt answers, and it is the one the headline timings came from`**
     (`tests/bench-reliability.test.js`) asserts **neither** claim in its title. `answeringAttempt` is
     a `.find`, so a second answered attempt passes; and it checks the attempt's `prefillMs` against a
     literal rather than against `run.report.prefillMs`, so it never shows the two share a source.
     Both halves matter — the second is what makes the cold-prefill exclusion meaningful.
  2. **`shape-rejected is explained as the terminal twin of refused`**
     (`tests/bench-reason-notes.test.js`) scopes its first assertion with `paragraphAbout` and then
     makes its other two document-wide. The comment directly above explains why that is worthless —
     the document-wide version passed on a count-table row, "proved by gutting the whole paragraph and
     watching it stay green" — and then two of three assertions are document-wide anyway. Route them
     through `paragraphAbout` and re-run the gutting mutation the comment describes.
  Both fixes are small; the value is that each one currently reports coverage it does not have.

- **OAI-41** — Two test files are at the 300-line ratchet, and one of them blocks OAI-40. Filed
  2026-08-04. **Not new — this promotes OAI-30's "budget note" from a warning inside another item to
  work of its own, because the headroom it warned about is now gone.** OAI-30 recorded
  `structure.test.js` at 299 of 300 on 2026-08-01 and told whoever picked it up to make room first;
  OAI-28 and OAI-30 both still collide with it. Measured rather than predicted:
  `tests/structure.test.js` is at **exactly 300** and
  `tests/bench-reliability.test.js` at **294** (`split('\n').length`, the way the ratchet counts —
  one more than `wc -l`). The comparison is `>`, so structure.test.js has **zero** headroom and
  bench-reliability has six lines. OAI-35 put ~140 of those lines there.
  This is the size-growth rule working as designed — the ceiling is meant to force a split rather
  than be raised — but it is now due, and it is due *before* the next person needs it: **OAI-40's fix
  lands in `bench-reliability.test.js`**, and `structure.test.js` cannot accept a single new
  structural guard, which is the file whose whole job is holding them.
  The seams are visible. `bench-reliability.test.js` mixes attempt ACCOUNTING (which bucket, which
  denominator) with report RENDERING (what the markdown says) — the same split
  `bench-reason-notes.test.js` was carved off along in OAI-31, so the precedent and the naming already
  exist. `structure.test.js` mixes the size ratchet with the other structural guards it has
  accumulated. Do **not** solve this with an `ALLOWLIST` entry: `tests/structure.test.js` makes an
  allowlisted file skip the 60-line per-function budget too, so buying headroom silently drops a
  second guard — the trap OAI-35 avoided by splitting `reason-notes.mjs` out instead.

- **OAI-42** — Consider renaming `serverResponded` to say what it means. **Lowest priority, and it
  may well close as "no".** Filed 2026-08-04 because three independent reviewers across two OAI-35
  passes raised it unprompted: the name invites *the server responded to me* — a claim about a peer —
  where the field means only *an HTTP response was obtained*, and a proxy or gateway can produce one
  with the model server never seeing the request.
  The evidence for: this repo has now spent a great deal of prose defending that distinction — in ADR
  012, ADR 013, `CLAUDE.md`, `REPO_TRAPS.md`, two test files and the ledger's own minting comment —
  and a reader who trusts the name reaches the wrong conclusion without ever hitting one of them. The
  original backlog item for OAI-35 made exactly that error in its own text.
  The evidence against, which is why this is filed rather than done: the name **predates** OAI-35 —
  `http.mjs` and `cmd-setup.mjs` were reading it before the ledger ever carried it — so a rename
  touches the transport, not just the record; and the documentation now carries the load correctly,
  so this buys clarity rather than fixing a defect. If it is done, `httpResponseObtained` was the
  suggested name and every recorded benchmark file under `bench/results/` carries the old key, so it
  needs the same read-both-shapes treatment the `not recorded` bucket already gives legacy records.

- **OAI-43** — Decide whether the attempt record deserves one schema both sides read. **Low priority,
  and it may close as "no" — it is filed because it was rejected on judgement rather than on
  evidence.** Raised by `codex-adversarial` in OAI-35's pass 2 and dismissed there as out of scope.
  The observation: adding a field to the ledger means editing two places — `newEntry` in
  `scripts/lib/attempt-ledger.mjs`, and `RECORD_FIELDS` in `bench/lib/reason-notes.mjs` — and
  `RECORD_FIELDS` is attempt-record schema metadata living in a *rendering* helper because one
  paragraph happens to enumerate it. Codex's read: a shared record schema would be the genuine seam,
  and the current arrangement is a size-driven extraction wearing one.
  The counter, which is why it was rejected: that two-place edit **is the designed tripwire**. The
  key-set test goes red the moment the two disagree, which is what forces the reader-facing paragraph
  to be re-read rather than left quietly describing a record it no longer matches — and that tripwire
  has now fired usefully twice (OAI-31, then OAI-35). A shared schema keeps them in sync
  automatically, which sounds better and would have *removed* the prompt to re-read the prose.
  So the real question is not "is this duplication" but **"is the duplication load-bearing"**, and
  OAI-35 gave weak evidence for both sides: the tripwire worked, and separately three documents
  still went stale on a witness count no tripwire watched. Worth an hour to decide deliberately;
  worth nothing to change by reflex. If it is done, the paragraph must keep something that fails when
  the record changes, or the one guard that has demonstrably worked here is traded for tidiness.

- **OAI-44** — Decide whether a *confirmation-capable* server-state instrument is worth building.
  **Parked, not closed.** Filed 2026-08-04 by OAI-34, which withdrew its own confirming verdict during
  the plan gate — see [ADR 013](adr/013-observing-the-server.md)'s amendment. The reason is structural
  rather than a gap in effort: proving an unload happened after expiry requires observing the model
  still resident **after** expiry, and a mechanism that fires **at** expiry never leaves that
  observation behind. Four designs were tried and each failed on a different axis (clock origin;
  bracket width, where present-at-119s/absent-at-121s straddles a 120s expiry; a calibration-derived
  bound on the spawn-to-receipt offset, invalid because `prefillMs` starts before the HTTP request and
  the driver's `Date.now()` is not the monotonic clock attempts are timed on; and gating on the
  exposure margin, which is post-treatment — the hypothesised eviction truncates the very measurement
  used to decide whether the episode was exposed).
  So this is not "try harder with sampling". The two designs that could actually earn a confirmation:
  **(a) matched controls** — randomised challenge TTLs with long-TTL controls, requiring unload timing
  to *move with* the assigned TTL, which makes TTL the manipulated variable instead of resting on one
  coincidence at 120s; ADR 013 costed the corpus-wide version at 3–4h on the MoE and 9–12h on the
  dense, but a single-case version is much cheaper and was never costed. **(b) server-side telemetry**
  — if LM Studio ever exposes an unload *reason* or a lifecycle event, the whole problem collapses to
  reading it. Check that first; it is a five-minute question and it decides whether (a) is worth
  hours.
  **Do not start this before OAI-34 has actually run.** If three episodes survive a 120s TTL against a
  335s prefill, the deterministic form is refuted and the appetite for confirming a mechanism that
  just failed to appear should be re-examined rather than assumed.
