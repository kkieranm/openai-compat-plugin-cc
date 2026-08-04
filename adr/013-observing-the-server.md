# 013 — Observing the server: intervene, don't sample

**Status:** the DECISION is accepted, 2026-08-03 (OAI-24). The instrument shipped 2026-08-04 (OAI-34),
**amended**: it can refute the mechanism and it can no longer claim to confirm it. Running it is still
outstanding.

## Amendment, 2026-08-04 (OAI-34): the confirming outcome is withdrawn

The row of the outcome table below that read *"Failure **with** observed eviction"* is **removed**, and
with it the verdict `mechanism-reproduced`. It was not removed because it was hard to implement. It
was removed because **it cannot be earned by this design**:

> Proving an unload happened *after* expiry requires observing the model still resident *after*
> expiry. If the mechanism is real it fires *at* expiry — so that observation cannot exist.

Confirmation-by-sampling is incoherent for a mechanism that fires exactly at the threshold you are
trying to prove you are past. Four designs were tried and each failed on a *different* axis: the
clock origin; bracket width (present at 119s, absent at 121s straddles a 120s expiry, so the true
unload may precede it); an attempt to bound the spawn-to-receipt offset from the calibration run
(invalid — `prefillMs` starts *before* the HTTP request, a calibration cannot bound a later process's
startup, and the driver's `Date.now()` is not the monotonic clock attempts are timed on); and finally
gating on the exposure margin, which is **post-treatment**: the hypothesised eviction truncates the
very measurement used to decide whether the episode was exposed, so a genuine fast eviction could
never qualify while every slow false positive would.

**What the instrument does instead.** An observed absence is recorded in full — `unloadAt`,
`lastPresentAt`, the bracket width, polling gaps, residency at start, `exposureRatio`, and whether the
failure reason was a client budget — and **attributed to nothing**. The episode vocabulary is
epistemically neutral (`failure-with-unload-observed`, `failure-without-unload-observed`); no label
says "post-TTL" or "eviction", because those are the facts that cannot be established.

**Refutation is unaffected**, which is why the instrument is still worth having. Survival needs the
request to outlast true expiry, and the spawn-to-request overhead *cancels* between the two sides of
that comparison — leaving only `c`, the serialization/socket-write/admission cost of one request. So
refutation rests on `c < prefillMs − ttlMs`, the slack the episodes actually achieved (~215s at the
measured `scaffold` prefill against a 120s TTL). That condition is **stated in the verdict sentence
and recorded in the manifest**, and the sweep quotes the *narrowest* episode's slack, because a sweep
is only as sound as its weakest one. `c` was **not measured**, and no black-box anchor available here
measures it.

**A follow-up item is filed** for a confirmation-capable design — matched TTL controls, or server-side
telemetry if LM Studio ever exposes an unload *reason*. The question is parked, not closed.

### The limits below are now enforced, and three of them decide

`validityChecks` in `bench/lib/ttl-verdict.mjs` turns three of this ADR's stated limits into code:
the applied TTL must match what was asked (read back from the server, not inferred from `lms load`
exiting 0); no model other than the target may appear while the child is alive, because Auto-Evict
produces the same client-visible shape; and an attempt record that contradicts itself
(`outcome: 'answered'` or `'refused'` with `serverResponded: false`) is a record the instrument does
not understand. Any of them yields `instrument-invalid` — **kept distinct from `not-dispatched`**,
because printing "never dispatched" for a competing model would be exactly the false string this ADR
exists to prevent.

**One caveat that would have been fatal to a confirming verdict, and is merely recorded now:** the
sampler's "in-flight" phase means *the child process is alive*, not *the HTTP request is open*. An
absence seen after the request already failed but before the companion exits falls inside that window.
That is this ADR's own "an unload after the request had already failed" disqualifier — harmless only
because nothing is attributed.

### Correction: the provenance of the leftover record

The note below says an accidental import ran the driver "against a server that was down". The one
artifact that survived on the development machine
(`bench/results/ttl-challenge-2026-08-03T16-30-54-480Z.json`, deleted by OAI-34) shows otherwise: the
server was **up** and the model **resident** — its own residency samples prove it — and every episode
died in ~1s at `--max-tokens 2048` against a floor of 3,912, before any request was sent. The lesson
is unchanged and arguably sharper: the instrument rendered a verdict about the mechanism from a run in
which the *instrument's own argument validation* had refused every episode.

Why the withdrawal, because it is the most useful thing this ADR records. A draft driver was written
and reviewed twice. Pass 1 found eight defects of one class — *a validity guard that narrates instead
of refusing*, now a `.claude/REPO_TRAPS.md` entry. Pass 2 found ten more, **one of them introduced by
pass 1's own fix**, and two of them cases of the driver issuing its strongest claim
(`mechanism-reproduced`) from evidence that did not support it. That is not convergence, and it is
what unexercised decision logic looks like under adversarial reading.

Then pass 2 found the blocker, which is not in the driver at all: **the attempt record cannot say
whether the server responded.** `scripts/lib/http.mjs` sets `error.serverResponded = true` when a
socket is cut mid-body — `cmd-setup.mjs` already uses it for exactly this question — but
`attempt-outcome.mjs` does not copy it onto the entry. So a model evicted mid-prefill *before any
text*, which is precisely the event this experiment exists to detect, is recorded as
`reason: 'transport'` with a null `prefillMs`: indistinguishable from an `ECONNREFUSED` that never
reached a peer. Any dispatch predicate built on today's record is therefore blind to the target
event, and no amount of care in the bench fixes it.

**So OAI-34 was blocked on OAI-35:** carry `serverResponded` onto the attempt entry. That is
production plugin code, which OAI-24's plan forbade, so it is its own item with its own plan gate
rather than something smuggled in here.

**Unblocked 2026-08-03 — OAI-35 landed, and it corrected the sentence that used to close this
paragraph.** That sentence said the item was worth doing because ADR 012 documents "does not
establish whether a peer was reached" as a limitation this would remove. It does not remove it.
`serverResponded` settles whether an **HTTP response was obtained**, and reachability is a separate
axis that stays unsettled: `ENOTFOUND`, `ECONNREFUSED` and a TLS rejection differ in how far they
got and all record `false`. ADR 012's rejection of the name `unreachable` therefore stands.

None of which weakens the unblocking, because the response axis is the one this experiment needs. A
model evicted mid-prefill has already had its headers sent, so it records `true`; a connection that
found nothing listening records `false`. Those were the two the record could not tell apart, and now
it can.

## The problem

`scripts/lib/attempt-ledger.mjs` records one entry per physical request, but nothing in it describes
the **peer**. An attempt that failed because the model had been unloaded and one that failed under
load land in the record identically. That is the one axis that would settle the standing JIT-TTL
hypothesis — *does an in-flight prefill count as idle, so a long prefill is evicted mid-flight?* —
rather than leaving it to be inferred, and OAI-19's write-up is about to name a mechanism.

## What we rejected, and why each was refuted rather than merely disliked

**Sampling residency around each bench run** (`lms ps`, or a bench-side `/api/v0/models` GET) —
**temporal aliasing.** A bracket around a run spanning several attempts and many minutes cannot
distinguish "loaded throughout" from "unloaded, then silently JIT-reloaded before the next sample".
Both samples read `loaded`. A current-state snapshot is not lifecycle history.

**Probing `/api/v0/models` per attempt from the plugin** — has the resolution, but three costs. It
may **perturb what it measures** (a GET could reset the idle timer or trigger a load); it adds up to
2s on a failure path where `--max-seconds` already binds; and it puts a vendor-shaped field into the
ledger and the `--json` envelope, straining [ADR 002](002-context-window-detection.md)'s "one module
knows a vendor dialect".

**A matched TTL crossover over the whole corpus** — the first replacement, refuted on two counts.
TTL is assigned per *block*, so the independent n is the number of blocks, not of requests: at three
blocks per arm the best achievable two-sided p is 0.25, which licenses nothing inferential. Reaching
a defensible 9–12 pairs costs 3–4 hours on the MoE — and the MoE is the **wrong model**, its prefill
being ~5× faster and never approaching the TTL at all. On the dense 27B the same design costs 9–12
hours.

## The premise was weaker than the backlog stated

Measured dense prefills, read off `bench/results/2026-07-30T{10-37-25,13-41-30}*.json`:

| case | prompt tokens | prefill |
|---|---:|---:|
| `scaffold` | 47,109 | **335s** |
| `model-info` | 41,048 | 286s |
| `structured` | 28,648 | 191s |
| `docs-only` | 4,490 | 28s |

Every one is *below* the ~600s TTL the hypothesis assumed. And the "~10 minute idle TTL" this repo
had been quoting **has no provenance in the record at all**; LM Studio documents a timer that resets
when a model receives a request, with a 60-minute JIT default. So the mechanism, as stated, barely
reached its own threshold even on the largest case.

That is what makes the cheap design possible.

## The decision

**Falsify, don't estimate.** Set the TTL *deliberately below* a known prefill — 120s against
`scaffold`'s 335s — which is the most favourable condition the mechanism could be given. If in-flight
prefill really is treated as idle, the model **must** unload and the request **must** fail. A
survival past expiry is a counterexample. One calibration run plus three challenge episodes, ~45
minutes.

**Built as specified** (OAI-34, 2026-08-04) in `bench/`: the rule that says what an episode MEANS is a
separate, pure, unit-tested module from the I/O that drives it, so the reading of the result was fixed
before any numbers arrived. `bench/lib/ttl-verdict.mjs` holds the rule, `bench/ttl-challenge.mjs` the
I/O, and the evidence readers sit between them — `ttl-residency.mjs` for `lms ps --json` and
`ttl-attempts.mjs` for the plugin's attempt record. That split was the one thing about the withdrawn
draft worth keeping, and it is what it kept.

This answers what OAI-19 needs — *may the write-up name JIT-TTL?* — not the corpus-wide reliability
estimate it does not need.

## What the instrument turned out to carry

A live `lms ps --json` entry reports more than residency, and reading a real one corrected two
assumptions this design was drafted on:

- **`ttlMs`** — the applied TTL, so the treatment is confirmed from the server rather than inferred
  from `lms load` exiting 0. An earlier draft asserted in a comment that it was not reported.
- **`lastUsedTime`** — the anchor the idle timer counts from, and the most direct instrument
  available: whether it *advances* during a long prefill is the hypothesis stated in the server's own
  terms. It is **recorded, not acted on** — the field's semantics are undocumented, and a verdict
  resting on them would outrun what is known.
- **`contextLength`** — the cross-arm identity check, so TTL is never confounded with load
  configuration.

## Limits the instrument MUST enforce in code, not leave to the reader

Each was learned from the withdrawn draft, most of them the hard way. They are requirements on
OAI-34's build, not a description of code in the repo.

- **0/3 refutes only the DETERMINISTIC form.** It does not show the failure rate is low: the
  one-sided 95% bound on zero events in three is still ~63%. Showing <10% would need ~29 episodes.
- **A bare failure confirms nothing.** A backend crash, Auto-Evict from another model, memory
  pressure, a load/unload race introduced by changing the TTL, an expiring client budget, or an
  unload *after* the request already failed all produce the same client-visible shape. A confirmation
  needs an observed unload past expiry while the request was still in flight.
- **An episode that never reached the SERVER voids the sweep.** Not hypothetical: an accidental
  import of the driver ran it against a server that was down, and an earlier draft rendered
  `inconclusive-failure` — a verdict about the mechanism — from a run in which no request existed.
  The sweep must report an instrument failure and refuse to say anything about the server. Note the
  test for this cannot be "an attempt entry exists": `ledger.begin` mints one before the socket is
  opened, and ADR 012's corrected text names `ENOTFOUND`/`ECONNREFUSED` as failures that reached no
  peer. Nor can it be inferred from reason codes alone — that is exactly what OAI-35 exists to fix.
- **A calibration that did not clear the bar must void the sweep**, machine-readably — in the record,
  not only on stderr, which the reader of a JSON artifact never saw. The first draft printed `ABORT`
  and then ran the full sweep anyway, exiting 0 with a normal-looking record: the word named an
  action the code never took.
- **Two thresholds, never one.** Whether an episode was an *exposure* is a design question and
  carries the safety margin (`ttlMs × EXPOSURE_MARGIN`); when the server's timer *expired* is a fact
  and carries none (`ttlMs`). Only the second may be compared against an unload's timestamp. The
  first draft used the margin for both, so an eviction at 10s inside a 300s request was filed as
  "past expiry" purely because the request was long — a fabricated confirmation, the strongest claim
  this experiment can make.
- **Samples are phase-stamped at collection**, and each reader takes only the window it is entitled
  to. An unload first seen *after* the child exited is not evidence about the request, and activity
  must be read over the prefill window rather than the whole episode — otherwise generation, the one
  activity nobody disputes counts, would set it `true` every time.
- **A success alongside an observed unload is a contradiction, not a survival.** The two instruments
  disagree, and that must be reported rather than the episode banked.

## What OAI-19 may say, by outcome

| Outcome | May say | Must not say |
|---|---|---|
| 3/3 survive | On this version and configuration, three cold dense requests remained in prefill beyond a deliberately shortened 120s TTL without unloading or failing — refuting the deterministic form, provided request serialization and admission fell inside the recorded slack. The July failures remain server-side but mechanistically unresolved. | That TTL can never evict an active request; that any version behaves so; that TTL played no role historically; that the failure rate is low. |
| Failure, **with or without** an observed absence | The test failed. Residency sampling is recorded alongside it and is not attributed; inconclusive. | Anything naming JIT-TTL — **including when an absence WAS observed**. See the 2026-08-04 amendment: that row used to license a confirmation, and no design could earn it. |
| `contradictory-evidence` | The request succeeded while residency showed an unload; the instruments disagree. | That either reading is the right one. |
| `no-exposure` — some or all episodes did not outlast expiry by the margin | Only that the run did not test the mechanism, and how many episodes cleared it. | That anything was refuted; a survival that never cleared the bar is not a counterexample. |
| `instrument-failed` — no response obtained, unconfirmed TTL, another model resident, a self-contradictory attempt record, or calibration short | Nothing. Fix the instrument and re-run. | Anything at all about the server. |

**In no outcome may OAI-19 name JIT-TTL as *the cause* of the 37.5%.** After the 2026-08-04 amendment
no outcome licenses naming it at all.

**The mapping is now a TEST, not a promise — for BOTH vocabularies.** The rows above are *sweep*
outcomes; the per-episode verdicts feeding them are a different set, and an earlier draft of this
paragraph claimed a guard while only the episode set had one. `bench/lib/ttl-verdict.mjs` exports
`SWEEP_VERDICTS` and `EPISODE_VERDICTS`, and `tests/ttl-verdict.test.js` drives the rule over every
input combination asserting each emitted set equals its documented set exactly. It also exports
`CONCLUSIVE` — the two outcomes that mean the experiment produced a result — because the others ask
to be re-run in their own text, and OAI-34's done-condition and the driver's exit code both read that
one list rather than restating it.

Every row must map to a verdict the code actually produces, and one row here did not. A "Mixed" row
licensing *"an intermittent association at most"* was removed on 2026-08-03: no verdict mapped to it,
and it contradicted the row above — a sweep of survivals plus one non-eviction failure returns
`inconclusive-failure`, whose own text says JIT-TTL may not be named, while "an intermittent
association" **is** naming it. Two adjacent rows gave opposite licences for one dataset. Caught by a
wide review reading the table against the code, and worth recording because it is this repo's
recurring class appearing in the document written to prevent it.

## Consequences

- **The driver is the repo's first `lms` dependency**, confined to `bench/`. It sets up
  conditions and observes residency; it never touches the plugin's request path, so
  [ADR 001](001-generic-openai-compatible-plugin.md)'s providers-as-data rule holds — no production
  code changed for OAI-24. The `serverResponded` prerequisite above *is* production code, and is
  **OAI-35**'s to justify.
- **A companion reader shipped for evidence already recorded.** `bench/lib/attempt-rows.mjs` splits
  failed attempts on whether a `prefillMs` was measured, which `attempt-outcome.mjs` had been
  retaining for exactly this and nothing read. A measured prefill proves the attempt crossed the
  first-model-text boundary; it does not explain why a later stream died, and its absence is not
  evidence of a cause. Near-empty until OAI-19 runs, and gated so it prints nothing rather than a
  measurement nobody took.
- [ADR 012](012-surviving-the-server.md)'s "server state … is not observable from the client" is
  corrected there: it is observable, and what is true is that the attempt record does not sample it.
