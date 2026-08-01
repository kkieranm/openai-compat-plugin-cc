# OAI-22 — three bounded fixes: retry only what a retry can fix, check the cap once, warm the model that is about to run

## Context

`BACKLOG.md`'s top item, filed 2026-07-31 from the OAI-20/21 review and grown on 2026-08-01 by the
OAI-23 review. It is the last prerequisite-with-code ahead of OAI-19, the full-corpus re-measure —
but the three parts do **not** share one rationale, and the gate caught the plan pretending they did.
Two of them would corrupt the record OAI-19 reads — a retried DNS failure files three phantom server
failures, and an expiring cap files an entry for a request never sent. The **third does nothing for
OAI-19 at all**: it is a latent robustness fix for a corpus shape OAI-19 does not run (design decision
3). It ships now because it is the item's third sub-part and is cheap, not because the re-measure
needs it.

All four load-bearing claims were checked by Codex against the cited files and came back TRUE:

1. `bench/run.mjs:243-246` warms **every** resolved provider/model pair before any case runs. On a
   provider that keeps one model resident the last warm-up evicts the first, so the first case of the
   earlier model still pays the JIT load the flag exists to remove. **Latent, and it stays latent
   through OAI-19** — see the correction under design decision 3.
2. `http-errors.mjs:124` tags **every** request-layer failure `reason: 'transport'`, and
   `failure-shape.mjs:55` retries all of them. ~~So a hostname that will never resolve costs three
   requests and two 2-second sleeps~~ — **struck 2026-08-01, refuted by the stage-2 adversarial
   review and verified end to end.** `provider.mjs` `describeFailure` intercepts `ECONNREFUSED`,
   `ENOTFOUND` and `EAI_AGAIN` and returns *fresh* `UserError`s carrying no `reason`, `code` or
   `cause`, so those three never reached `answerWithRetry` as retryable in the first place:

   ```
   ENOTFOUND:    reason=undefined code=undefined cause=undefined retryable=false
   ECONNREFUSED: reason=undefined code=undefined cause=undefined retryable=false
   ```

   What was actually wrong is therefore **two different things**, and both are worse for OAI-19 than
   the premise they replace: (a) those terminal failures reach the attempt ledger with **no reason**
   and tally as `unclassified`, polluting the very `Failures by reason` table OAI-19 reads and
   OAI-26 is queued to explain; and (b) `EAI_AGAIN` — genuinely transient, and the one code in this
   feature's whitelist that most deserves a retry — was silently never retried. The premise *does*
   hold for every code `describeFailure` does not intercept: a TLS certificate rejection was being
   retried three times.

   The step-1 probe missed this because the claim cited `http-errors.mjs` and `failure-shape.mjs`,
   so those were the files checked — and the code does exactly what was claimed *there*. The defect
   is one layer up, in a wrapper the claim never named. Recorded as a methodology note below.
3. `chat.mjs:161` and `chat.mjs:253` both call `capBudgets`, straddling `ledger.begin` at 162 — a
   window in which an expiring cap mints a ledger entry for a request that never went on the wire.
   The chat.mjs comment at 182-187 already names this and names OAI-22 as its fix.
4. `createNegotiation` is scoped to one `chatCompletion` call. **Deliberately not fixed here** — see
   Scope below.

Intended outcome: the attempt record OAI-19 will quote separates **failures a retry could survive**
from **failures it could not** — deliberately the weakest claim the evidence supports, not "server
drop versus client fault", since a transient pre-response failure is neither party's fault and stays
retryable. No ledger entry describes a request that was never sent, and `--warm-up` warms the model
each case is about to use.

## Design decisions and why

### 1. Narrowing `transport` — classify at the call site, not by code presence

Codex proposed classifying inside `transportError()` by `error.code`, with an absent code treated as
non-retryable. That is half-right and would have caused a regression: `transportError` has **two
callers with opposite semantics**.

- `http.mjs:118` — inside the `bodyStream` catch, which only ever runs **past headers**. Its own
  comment (109-116) describes the raw `Error: aborted` from a post-header reset that reaches exactly
  here. This is the genuinely transient shape and must stay retryable **regardless of whether Node
  populates `code`** — a version-dependent fact not verifiable from here.
- `http.mjs:248` — `request.on('error')`. Usually the connect phase, but **not always, and leaving it
  unclassified is a defect the gate caught**: it does `state.aborted ??= transportError(...)` *before*
  `fail()` consults `state.settled`, and `bodyStream`'s catch at 117 gives a stored `state.aborted`
  priority over the error the iterator threw. So a request-level error arriving **after** headers is
  stored here, escapes through the body path, and would be reported `non-retryable-transport` — a
  genuinely retryable delivery failure filed as one not worth retrying, which is this change's own
  purpose inverted. It must classify from the state it can
  see: `{ delivered: state.settled }`. `state.settled` is set at `http.mjs:168` when headers resolve
  (and at 234 by `fail`), so it is precisely "a response was obtained", which is what the whitelist
  needs to know.

  **Making that branch testable without a transport seam** (gate finding). `TRANSPORTS`
  (`http.mjs:52`) is module-private and `send()` exposes no injection point, so the post-header
  request-`'error'` event cannot be driven deterministically end to end — Node does not guarantee the
  request object emits `'error'` when the *response* stream fails, which is precisely the race. But it
  does not need a seam: the two-line handler moves out as an exported
  `requestErrorHandler(state, target, fail)`, and line 248 becomes
  `request.on('error', requestErrorHandler(state, target, fail))`. A unit test then calls the handler
  directly with `{ settled: true }` and asserts `state.aborted.reason === 'transport'`, and with
  `{ settled: false }` asserts `non-retryable-transport`. The remaining mutation — line 248 stopping using the
  handler at all — is already covered end to end by `tests/http.test.js:143`, which drives a real
  refused connection through `send()` and would go red if the wiring broke. Two cheap tests instead of
  a production indirection introduced for testability alone, which is the trade this repo deferred
  OAI-25 over.

So the phase is passed in by the code that knows it, which is `failure-shape.mjs`'s own stated rule
("tagged where it is *detected* — by the code that already knows what it saw"), and code-presence
stops mattering.

**Two reason codes, both whitelists:**

- `transport` (stays in `RETRYABLE`) — **a transport failure a second attempt could plausibly
  survive.** Covers the post-headers site unconditionally, plus pre-response failures whose code is in
  a transient whitelist: `ECONNRESET`, `EPIPE`, `ETIMEDOUT`, `ECONNABORTED`, `EAI_AGAIN` (DNS's own
  "temporary, try again").
- `non-retryable-transport` (**not** in `RETRYABLE`) — **a pre-response transport failure this client
  does not recognise as transient.** Covers `ENOTFOUND`, `ECONNREFUSED`, and **any unrecognised or
  absent pre-response code**, which is the whitelist direction the module already commits to: an
  unrecognised failure costs one honest request, not three misleading ones.

**The axis is retryability, not blame, and neither name may overreach — the gate caught this twice, in
both directions.** `EAI_AGAIN` and a pre-response `ECONNRESET` are `transport` yet no response was
ever carried, so `transport` cannot be read as "the server dropped it". And the non-retryable bucket
was first named `unreachable`, which was worse: `request.on('error')` before headers also carries TLS
certificate rejections, protocol and parser errors, and code-less failures — all of them cases where a
peer *was* reached — so "unreachable" would have asserted a fact the classification never established,
which is precisely the defect class this feature exists to remove. The name now states the decision
the code actually makes, and the reader is left to read `.code` for the rest. ADR 012, the CLAUDE.md
line and the OAI-26 prose obligation must all use this wording; neither code may be attributed to the
server, and `non-retryable-transport` may not be described as a reachability finding.

`ECONNREFUSED` is decided explicitly rather than left "arguably": `http-errors.mjs:125-127` already
hangs the provider-specific *start your server* hint off `cause.code`, so retrying only delays the
useful message by ~4 seconds and files three phantom server failures against a stopped server.

**Consumer check (done):** nothing reads the literal `'transport'` out of a persisted record; no
`bench/results/*.json` contains it; `bench/lib/attempt-rows.mjs:68` `byReason` is a generic tally, so
a new code flows into `Failures by reason` with no schema change. Consequence to record: **OAI-26's
prose obligation grows by one line** — `non-retryable-transport` needs the same explanation
`shape-rejected` does, and for the same reason: it sits among the delivery failures and is not one.
Its paragraph says these attempts failed before any response and in a way this client does not
recognise as transient, so they were not retried, and points the reader at `.code` for which — and,
per the wording rule above, it must not imply the `transport` rows beside it are all the server's
doing.

Explicitly **not** in scope: `transportError` still does not set `serverResponded`. A post-headers
cut arguably should (the sibling branch at `http.mjs:101` does), but that changes what
`cmd-setup.mjs` tells a user about a running server, and it is a pre-existing behaviour this feature
did not disturb.

### 2. `capBudgets` computed once and passed down

Compute the remaining budget once at the top of `postWithDegrade`, **before** `ledger.begin`, and
pass the resulting object into `postChat`, which stops calling `capBudgets` itself. `postChat` is
module-private with `postWithDegrade` as its only caller (verified), so it needs no second guard —
and a second call would recreate the defect. The budget object becomes a required parameter so a
future caller cannot omit the contract silently.

The pre-computed `totalMs` is very slightly generous. There is **no `await`** between the
computation and `request()` — only ledger and options construction — so the overrun is sub-millisecond
against a second-or-minute cap, and it buys the removal of a physical-attempt record for a request
that never existed.

This closes the last gap the OAI-23 comment names: after it, `ledger.begin` is followed by a dispatch
that the cap can no longer refuse, so a `refused` entry can no longer sit beside a phantom `failed`
one. The comment at `chat.mjs:182-187` is rewritten to say the gap is closed rather than pending.

**The structural guard evolves, it is not deleted** (`tests/structure.test.js:215` says so in as many
words). `capBudgets < ledger.begin` alone would no longer prove the checked budget is the one the
transport uses. It becomes, over comment-stripped source: `postWithDegrade` contains **exactly one**
`capBudgets(` call; its result is bound to a const **before** `.begin(`; that identifier is passed to
`postChat(`; and `postChat`'s own body contains **no** `capBudgets(`.

**Partial free win on OAI-25:** the already-expired case needs no `now` seam — an `expiresAt` in the
past makes `postWithDegrade` throw with **no ledger entry created at all**, which is directly
assertable. If that test lands, OAI-25's remaining ask narrows to the mid-window case only, which is
what its backlog entry already asked to be re-checked once this landed. Recorded in the backlog either
way; OAI-25 is not closed here.

### 3. Warm-up: warm on every pair *change* (option 3c)

Warm whenever the resolved pair differs from the previous case's, rather than all pairs up front
(today) or once per pair at first use.

**First, a correction the gate forced, which changes why this ships.** `BACKLOG.md:98` claims the
multi-model case "is what OAI-19 runs, and there the first case of the earlier model still pays the
load". That is **false**. OAI-19 runs one arm per model as **separate invocations** (`BACKLOG.md:179`,
and the 2026-07-30 evidence is two files, `…-arm-dense.log` and `…-arm-moe.log`), and a command-line
`--model` overrides every case's model (`bench/run.mjs:64`), so each invocation resolves to exactly
one pair. Today's up-front warm-up warms that arm's sole model immediately before its cases, and
nothing inside the invocation evicts it. The plan's own test — `--model` collapses a mixed corpus to
one warm-up — is the same fact.

So this ships as what the backlog's *first* sentence already called it: a **latent robustness fix for
genuinely mixed-pair invocations**, which is a shape the harness supports (a case may pin its own
provider/model) and which nothing today prevents someone running. It is **not** removing a cost from
OAI-19, and Phase 4 corrects the backlog sentence that says it is.

Given that, the choice between the options is about not introducing a new defect while fixing the
latent one. Warming once at first use knowingly leaves a `p1,p2,p1,p2` corpus paying a JIT load on
cases 3 and 4 — the exact cost the flag removes. Grouping execution by pair would fix that but
**reorders the cases**, and independent scoring does not make order irrelevant: model residency,
prompt cache, thermal state and the correlated failure conditions OAI-20 exists to survive are shared
mutable state, so reordering an arm weakens any cross-arm comparison the corpus is used for. 3c gets
both.

On a single-pair invocation — which is every arm OAI-19 will run — 3c degenerates to exactly one
warm-up before case 1, behaviour identical to today, which a test pins.

Each `warmed` entry gains `beforeCase: <case id>`, because with warm-ups now inside the case loop a
reader of the OAI-19 record otherwise cannot tell a mid-run warm-up from a pre-run one — and this
module's whole stated point is that the record *states* that warm-up ran.

**The loop needs a testable seam, which today's code does not have** (gate finding). `bench/run.mjs`
calls `main()` at import, so the pair-change comparison cannot be reached from a test: asserting only
on `pairFor`/`pairKey` would stay green with the comparison deleted, which is a mutation check that
proves nothing. So the orchestration moves into `bench/lib/warm-up.mjs` as a pure, injectable
`runWithWarmUp(cases, options, { warm, run })` returning `{ results, warmed }`; `run.mjs`'s `main`
supplies the real `warmUpPair` and `runCase`. The test drives it with fakes and asserts the **order of
interleaved calls**, so removing the comparison goes red. This is also what makes mutation check (c)
honest rather than structural.

### Scope: claim 4 stays filed

The negotiation-per-call finding is parked in `BACKLOG.md` in the explicit "wait for a second server"
bucket alongside OAI-13, because triggering it needs a server refusing **both** `stream_options` and
`response_format`, which LM Studio does not. That is a recorded decision, not an open question.

Codex argued for shipping it and produced one genuinely new consequence the filed paragraph does not
carry: a re-offered `stream_options` refusal on the second call can consume the remaining
`--max-seconds`, turning an answerable review into a client-imposed deadline failure. That is
**added to the filed entry**, which moves to **OAI-13 as item (7)** since OAI-22 itself closes here.
Codex also correctly warns that if it is ever fixed, only the capability state (`removed`) may be
shared — never the whole `{payload, removed, lastRung}` object, whose payload is call-specific.

## Phase 1b — added by the stage-2 review, after the code was written

Three changes the plan did not foresee, all inside phase 1's own concern, all landed in the pass-1
boundary batch and mutation-checked.

- **`provider.mjs` `describeFailure` must preserve what the transport decided.** A new private
  `reword(error, message, options)` builds the provider-specific message while copying `reason`,
  `code`, `cause` and `serverResponded`. Rewording a failure must never reclassify it: the *message*
  belongs to the layer that knows the provider's name and its start hint, the *reason* to the layer
  that saw what happened. Without this the whole of phase 1 is invisible in production for the three
  commonest connect errors. Tests now cross the real `request()` boundary, which every earlier
  classification test did not — they called `transportError` directly, one layer below where the
  classification was being thrown away.
- **`transportError` sets `serverResponded` when `delivered`.** Scoped out in the original plan as
  pre-existing; the review showed the `delivered` flag is exactly the missing evidence, and that the
  sibling branch at `http.mjs:101` has always set it — so the two post-headers paths disagreed about
  a server they had both heard from, and `cmd-setup` could tell a user to start a running server.
- **The carried-budget comment overclaimed.** "Sub-millisecond" is not provable: `ledger.begin`
  serializes the messages for `promptChars` and `request` serializes the body again, so the honest
  bound is the synchronous work in that gap — milliseconds on a 60k-token prompt, against a cap in
  seconds. The comment now says that. The design is unchanged; only the claim was wrong.

**Dismissed, with reasons.** Codex argued `ECONNREFUSED` should stay retryable because a local
server restarting can refuse once and accept two seconds later (medium, 0.88). Kept excluded: the
start-your-server hint is the more useful outcome, retrying delays it by ~4s, and the backlog filed
this sub-item precisely to stop retrying permanent configuration errors. Recorded rather than hidden.

**Also in this batch, from the size ratchet rather than a reviewer:** `chat.mjs` crossed its 300-line
budget for the third time, so the stream-reading half — `createDeadline`, `timings`, `collectStream`
— moved to `scripts/lib/stream-collect.mjs` (196 + 125 lines). A real seam: `chat.mjs` decides what
to send and how to degrade, `stream-collect.mjs` decides how long to keep listening once bytes come
back. Raising the ceiling was the alternative and was rejected — the file did not earn 306 lines
while holding two separable concerns.

**Methodology note, earned here.** A probe claim that names the files it expects to be true in will
be checked *in those files*. Claim 2 was true everywhere it was cited and false one layer up. When a
claim is about what a value **reaches** — a retry predicate, a ledger, a report — the probe must name
the consumer, not the producer.

## Phases

**Phase 1 — narrow the retry set.**
- `scripts/lib/failure-shape.mjs`: add `NON_RETRYABLE_TRANSPORT = 'non-retryable-transport'` (absent from `RETRYABLE`) and
  the transient connect-code whitelist, beside the existing reason vocabulary. Module still imports
  nothing.
- `scripts/lib/http-errors.mjs`: `transportError(error, url, { delivered = false } = {})` picks
  `TRANSPORT` when `delivered` or the code is whitelisted, else `NON_RETRYABLE_TRANSPORT`. `.code` and `.cause`
  preserved for the existing hints.
- `scripts/lib/http.mjs`: line 118 passes `{ delivered: true }`; the line-248 handler is extracted as
  an exported `requestErrorHandler(state, target, fail)` classifying on `state.settled`, with 248
  reduced to wiring it.
- Tests: `tests/http.test.js:143` flips from `transport` to `non-retryable-transport` (that assertion is the
  feature). New: `ENOTFOUND` and `ECONNREFUSED` are not retryable; a connect-phase `ECONNRESET` is; a
  post-headers error with **no** code stays `transport` and retryable; and `requestErrorHandler`
  driven directly at `settled: true` and `settled: false` for the competing-event path.

**Phase 2 — one cap check per dispatch.**
- `scripts/lib/chat.mjs`: bind `capBudgets(...)` once above `ledger.begin`, thread it into
  `postChat` as a required parameter, drop the call at line 253 and the now-unused `expiresAt`/`maxMs`
  from `postChat`'s destructure. Rewrite the 182-187 comment.
- `tests/structure.test.js`: rewrite the guard to the four assertions above, keeping its "do not
  delete this guard" framing.
- New behavioural test: a past `expiresAt` throws the deadline error and mints **zero** ledger entries.

**Phase 3 — warm on pair change.**
- `bench/lib/warm-up.mjs`: replace `resolvePairs(cases, options)` with `pairFor(caseDef, options)` +
  `pairKey(pair)`; export a single-pair `warmUpPair(...)` returning one record entry (with
  `beforeCase`), same execFileSync/record-never-throw behaviour and unchanged `warmUpFlags`; and
  export the injectable `runWithWarmUp(cases, options, { warm, run })` holding the pair-change loop.
- `bench/run.mjs`: `main` calls `runWithWarmUp` with the real `warmUpPair`/`runCase`, replacing
  `cases.map(runCase)` and the up-front `warmUp(...)`; `warmed` stays a top-level record field, `null`
  when the flag is absent.
- `tests/bench-warm-up.test.js`: the "one warm-up per distinct pair" test is replaced by tests driving
  `runWithWarmUp` with fakes that record call order — a run of identical pairs warms once; an
  alternating corpus warms on every switch, each entry naming its `beforeCase`; a CLI `--model`
  collapses a mixed corpus to a single warm-up (today's real case); and the flag absent warms not at
  all. **Note from the approving gate round:** that collapse test must vary only the *model* across
  cases on a shared provider, or set both CLI provider and model — a `--model` override alone does not
  override a case-level `provider`, so a mixed-provider fixture would not collapse and the test would
  assert the wrong thing.

**Phase 4 — docs and tracker.**
- Amend **ADR 012** (failure classification) with the `transport`/`non-retryable-transport` split and the
  single-cap-check consequence for the OAI-23 gap — **and its line 130**, which currently states
  `--warm-up` sends "one tiny unscored request per **distinct resolved provider/model pair** before"
  the run. Under 3c that sentence is false: warm-ups are interleaved and a pair may be warmed more
  than once. Leaving it would make normative architecture documentation lie, so ADR 012 owns the
  warm-up mechanics correction (it is where `--warm-up` is documented; ADR 006 mentions it nowhere).
- Amend **ADR 006** (benchmark) with the *methodology* half only: why interleaving beats grouping —
  case order is preserved because residency, prompt cache, thermal state and correlated failure
  conditions are shared mutable state, so reordering an arm weakens the cross-arm comparison the
  corpus exists for.
- No new ADR — both are refinements to existing decisions.
- `CLAUDE.md`: the existing one-line ADR 012 note gains the split, staying one line.
- `BACKLOG.md` → `BACKLOG_DONE.md` for OAI-22; sub-item 4 moves to OAI-13 as item (7) with the
  cap-exhaustion consequence; OAI-25 and OAI-26 notes updated as described above.
- **Three stale backlog claims corrected while there, all about warm-up and all surfaced by the plan
  gate.** `BACKLOG.md:47-51` — the reorder rationale calls OAI-22 "exactly the two-arm case OAI-19
  runs" — is stale for the same reason as the two below and must be corrected in the same pass, or the
  done-entry contradicts the paragraph that ordered it. `BACKLOG.md:98` — "the multi-model case, which is what OAI-19 runs, and there the first case
  of the earlier model still pays the load" — is false for the reason given in design decision 3, and
  the done-entry must record the fix as latent-robustness rather than as an OAI-19 cost removal.
  `BACKLOG.md:196` — "Expect a JIT model load between arms, so the first case of each arm carries a
  cold prefill that is not the model's" — predates OAI-21's `--warm-up`, which the same OAI-19 entry
  now mandates; with the flag passed, the first case does not carry that load, and the sentence should
  say `--cold` handles *prompt*-cache uniformity while `--warm-up` handles the weights.
- `BACKLOG_DONE.md:69` carries the same now-false mechanics as ADR 012:130 — `--warm-up` sends one
  request per **distinct resolved pair** — stated unqualified and in the present tense. A done-file is
  a historical record, so the sentence is not rewritten as though it had always said something else:
  it gains a dated inline note that OAI-22 (2026-08-01) superseded the mechanics with pair-change
  interleaving. Adding a later OAI-22 entry elsewhere does not make an earlier unqualified claim true.

## Verification

- `set -o pipefail; npm test | tail -30` — quote the green summary.
- The repo `verify` skill (`.claude/skills/verify/SKILL.md`) — real plugin load plus a delegation
  round trip.
- Mutation check, one per phase's key invariant, restored and re-proved against a `cp` backup:
  (a) make `transportError` always return `TRANSPORT` → the ENOTFOUND-not-retryable test must go red;
  (b) move the `capBudgets` binding below `ledger.begin` → the rewritten structural guard must go red;
  (c) drop the pair-change comparison so warm-up runs once → the alternating-corpus test must go red.
- `npm run bench` is **not** run: it needs a live model and hours of wall clock, and it is OAI-19's
  own launch decision, made by the user.
