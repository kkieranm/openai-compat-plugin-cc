# OAI-24 — Record what the server was doing

*Written 2026-08-03. Approved at the third plan-gate round: two rounds of `CHANGES-REQUIRED` (a
clustered-unit statistical error, then a plan-file ordering objection), then a blind whole-plan
re-ask that approved. The design in the Context section is the third one attempted — the two it
replaced are recorded there rather than deleted, because a plan is the record of what was believed
at the time.*

> **Correction, 2026-08-03, after the fact — the plan is left standing below rather than rewritten.**
> Phase 2 did not ship. The driver was built, reviewed twice (eight defects in pass 1, ten in pass 2,
> one of the ten introduced by pass 1's own batch) and then **withdrawn from the commit**, because
> pass 2 found a blocker outside the bench entirely: the attempt record drops
> `error.serverResponded`, so a mid-prefill eviction before first token cannot be told apart from a
> connection that reached no peer. The instrument is blind to the event it exists to detect, and the
> fix is production code this plan's own Scope section forbids. Phases 1 and 3 shipped. The rest is
> **OAI-34**.
>
> The plan's own words on Phase 2 — *"Keep block/episode planning pure and unit-tested; the
> spawn/poll half is exercised by running it"* — turned out to be where the risk lived: the half
> nominated as "exercised by running it" was never run, and most of both passes' findings were in it
> or in the fields it feeds the pure half.

## Context

Across four full-corpus benchmark sweeps LM Studio dropped 27 of 72 runs (~37.5%), in two shapes: an
empty completion with `finish_reason: unknown`, and a stream that drops ~50k characters into
reasoning. OAI-20 landed the client-side answer — those shapes are classified, retried, and every
physical request gets a ledger entry — but the record cannot distinguish *failed because the model
was unloaded* from *failed under load*. OAI-19 is a multi-hour sweep whose write-up will name a
mechanism, so this must be settled first: measured, or explicitly labelled an inference.

**The item's three options were all rejected, and so was the design that replaced them.** The
reasoning is worth keeping because each step was refuted by evidence rather than preference:

1. **Bench-side sampling around each run** (options b and d) — temporal aliasing. A bracket around a
   multi-attempt, multi-minute run cannot distinguish "loaded throughout" from "unloaded then
   silently JIT-reloaded". A current-state snapshot is not lifecycle history.
2. **A per-attempt probe from the plugin** (option c) — has the resolution but perturbs what it
   measures (a GET may itself reset the idle timer), costs up to 2s on a failure path where
   `--max-seconds` already binds, and strains ADR 002's "one module knows a vendor dialect".
3. **A matched TTL crossover over the whole corpus** — the first replacement, and it died on two
   counts. TTL is assigned per *block*, so the independent n is the number of blocks, not the number
   of requests; at 3 blocks per arm the best achievable two-sided p is 0.25, licensing nothing
   inferential. Reaching a defensible 9–12 pairs costs 3–4 hours on the MoE — and the MoE is the
   **wrong model**, because its prefill is ~5× faster and would never approach the TTL at all. On
   the dense model the same design costs 9–12 hours.

**The premise itself is weaker than the backlog states, which is what makes the cheap design
possible.** Measured dense prefills, read off `bench/results/2026-07-30T{10-37-25,13-41-30}*.json`:

| case | prompt tokens | prefill |
|---|---:|---:|
| `scaffold` | 47,109 | **335s** |
| `model-info` | 41,048 | 286s |
| `structured` | 28,648 | 191s |
| `docs-only` | 4,490 | 28s |

Every one is **below** the ~600s TTL the hypothesis assumes — so the mechanism barely reaches its own
threshold even on the largest case. Worse, the "~10 minute idle TTL" figure repeated in `BACKLOG.md`
and ADR 012 **has no provenance in this repo**, and LM Studio documents the opposite semantics: the
idle timer resets when a model receives a request, and its JIT default is 60 minutes. Nothing on this
machine currently records what the TTL actually is.

**So: falsify, don't estimate.** Set the TTL *deliberately below* a known prefill — 120s against
`scaffold`'s 335s — which is the most favourable possible condition for the mechanism. If in-flight
prefill really is treated as idle, the model **must** unload and the request **must** fail. Three
clean survivals refute the deterministic mechanism outright, cheaply. This answers the question
OAI-19 actually needs answered — *may the write-up name JIT-TTL?* — rather than the corpus-wide
reliability estimate it does not need.

**Two corrections ship regardless of the experiment's outcome:**

1. `adr/012:230` is false — "It is not observable from the client". LM Studio's `state` *is*
   client-observable via `/api/v0/models`, which `scripts/lib/model-info.mjs:82` already reads and
   discards.
2. `prefillMs` is already recorded **on failed attempts** (`attempt-outcome.mjs:151`; timings
   attached at `stream-collect.mjs:111`), and its comment names the exact intended use — *"unable to
   say whether failures cluster before or after the first token — which is the first question anyone
   asks of this data"*. The data was deliberately kept; nobody built the reader.

## Scope

A **decision-and-experiment** item. **No production plugin code changes.** What ships is the decision
(as an ADR), one bench reporting addition, and a committed experiment driver. Running it is ~45
minutes on the user's own workstation and is launched when they say so.

## Phase 1 — The failure-shape split (`bench/`)

A reader for evidence already recorded.

- `bench/lib/attempt-rows.mjs` — one tally beside `byReason`/`byCase`/`byModel` (lines 68–70), keyed
  on whether first model text was observed:
  `byFirstText: tally(failed, ({ attempt }) => attempt.prefillMs === null ? 'no first model text observed' : 'first model text observed')`.
  Reuses the existing `tally`; `attemptRows` already returns `null` when no attempt record exists,
  which is the gate.
- `bench/lib/reliability-report.mjs` — a fourth `countTable(...)` beside the three at 165–167, plus
  one gated paragraph. Keep the paragraph in a small helper so no function crosses the 60-line limit.

**Wording is load-bearing.** The file's own rule (42–45) is that a paragraph may claim only what the
record holds:

- non-null `prefillMs` proves that attempt **crossed the first-model-text boundary** — it rules out
  that attempt ending before any output, including an unload solely during prefill;
- it does **not** explain why a later stream died;
- null is **absence of that evidence**, not evidence of an unload.

This is the `.claude/REPO_TRAPS.md` class with six confirmed instances (asserting a property of a
class from examples covering one sub-population), so it gets read for that specifically. Gate on a
**count** of failed attempts, never a substring test — OAI-31 finding (5) is live in this same file,
where `key === code` survives mutation to `key.includes(code)` because `transport` is a substring of
`non-retryable-transport`. Do not add a second instance.

**Tests go in a new `tests/bench-first-text.test.js`.** `tests/bench-reliability.test.js` is 271
lines against the 300 ceiling and `tests/structure.test.js` is at exactly 300 — neither has room.
Fixture counts must be **asymmetric** (two null-`prefillMs` failures, one non-null): a 1/1 fixture
would leave the rendered table unchanged when `prefillMs === null` is inverted, so the mutation check
would pass a broken implementation.

**The tally will be near-empty until OAI-19 runs** — the whole recorded corpus holds one failed
attempt, because the ledger postdates the big failure sweeps. Forward-looking instrumentation; the
gating is what stops it printing a measurement nobody took.

## Phase 2 — The challenge driver (`bench/ttl-challenge.mjs`)

**Protocol** (~45 minutes, decision rule declared before running):

1. **Record the configuration** — LM Studio version/build, backend, model quant, context length, JIT
   and Auto-Evict settings, and that no other client is connected. The TTL figure this repo has been
   quoting has no provenance; do not assume it, read it.
2. **Calibrate.** Load dense `qwen/qwen3.6-27b` with a long/disabled TTL. Run one `scaffold` review
   with a unique cache-buster and confirm first-token latency is comfortably above 120s — expect
   ~335s. If it is not, lower the challenge TTL keeping a generous margin.
3. **Challenge.** Reload the same model with `--ttl 120`, **confirming the applied value** rather
   than inferring it from the command exiting 0. Run **three** `scaffold` reviews, each with a fresh
   cache-buster, while sampling `lms ps --json` every 5–10s and retaining the LM Studio server log.
   Record timestamps for dispatch, TTL crossing, every state change, first token, and completion.
4. **If all three survive, stop.** Do not buy the crossover.
5. **If any fails**, run an immediately matched long-TTL control on an equivalent cold request. This
   is a diagnostic branch, not a precommitted experiment.

**Why three, and what three cannot do.** The hypothesis in its strong form is deterministic — every
sufficiently long prefill *must* be evicted — so one verified survival past expiry is already a
counterexample; three independently cold repetitions guard against cache contamination or one
anomalous run. But **0/3 does not establish a low failure rate**: the one-sided 95% upper bound is
still ~63%. It contradicts a deterministic mechanism and nothing more. Demonstrating <10% from zero
events would need 29 episodes, which OAI-24 does not need.

**A failure alone proves nothing either**, and the driver's header must say so. Any of these produce
the same client-visible shape: the pre-existing instability, a backend crash, memory-pressure
eviction, Auto-Evict from another model, a load/unload race introduced by changing TTL, a client
budget expiring, or an unload *after* the request had already failed. **A confirming event requires a
timestamped transition to unloaded at ~TTL expiry while the request is demonstrably still
prefilling**, ideally with the matching server-log line. That is why state sampling and log retention
are part of the protocol rather than optional extras.

**Implementation.** The driver imports `materialize`/`cleanup` from `bench/lib/corpus.mjs` and
invokes `scripts/oai-companion.mjs review` **directly**, not through `bench/run.mjs` — whose `SPEC`
(line 33) forwards neither `--max-tokens` nor `--cache-buster`. Passing `--max-tokens` at the review
floor ends an episode shortly after first token; without it each episode pays `scaffold`'s ~680s of
dense generation, adding ~34 minutes for nothing, since the outcome under test is decided during
prefill. Keep block/episode planning pure and unit-tested in `tests/ttl-challenge.test.js`; the
spawn/poll half is exercised by running it. Never `spawnSync` against an in-process fake server (repo
footgun). The file must land under the 300-line default — `ALLOWLIST` is empty and stays that way.

**This is the repo's first `lms` dependency**, confined to the bench, used to *set up conditions* and
to *observe residency*, never on the plugin's request path.

## Phase 3 — Docs and tracker

- **Fix `adr/012:230`** — server state is not recorded, though OAI-20 asks for it; model residency
  *is* client-observable (`/api/v0/models` reports `state`, and `loaded_context_length` while
  loaded, both already read by `model-info.mjs`); the attempt record does not sample it; `lms ps`
  remains external; request size landed as `promptChars`.
- **Correct the unprovenanced TTL claim** wherever it appears in `BACKLOG.md` and ADR 012 — the
  "~10 minute idle TTL" is asserted, not measured, and LM Studio documents both a resetting timer and
  a 60-minute JIT default.
- **New `adr/013-observing-the-server.md`** — the decision and why each rejected option was rejected
  (aliasing, perturbation, clustering, the unexposed MoE); the falsification design and its declared
  decision rule; the explicit limits of 0/3; the `lms`-in-bench amendment to ADR 001/002; and the
  outcome→wording table below.
- **`CLAUDE.md`** — one present-tense line naming the driver and linking ADR 013.
- **`BACKLOG.md`** — close OAI-24 to `BACKLOG_DONE.md`; file **OAI-34** ("run the TTL challenge"),
  ordered immediately before OAI-19, since like OAI-19 it is the user's hardware and their call.
- **`plans/oai-24-observing-the-server.md` is the first action on exiting plan mode** — before any
  code, and before the harness plan file is touched again. The `/feature` skill asks for the repo
  plan to be written *before* the harness copy; that ordering is not reachable here, because plan
  mode's harness constraint permits editing **only** the harness plan file and states in terms that
  it supersedes other instructions. Writing it at the earliest permitted moment satisfies the rule's
  purpose — the harness slug is reused and overwritten, so the repo copy is the durable record — and
  the deviation is recorded at step 8 rather than passed over.

### What OAI-19 may say, by outcome

| Outcome | May say | Must not say |
|---|---|---|
| 3/3 survive | On this version and configuration, three cold dense requests remained in prefill beyond a deliberately shortened 120s TTL without unloading or failing — refuting the deterministic form of the mechanism. The July failures remain server-side but mechanistically unresolved. | That TTL can never evict an active request; that any version behaves so; that TTL played no role historically; that the failure rate is low. |
| Failure **with** observed eviction | A shortened-TTL stress test reproduced an unload during active prefill, establishing this configuration *can* exhibit the mechanism. | That it caused the July failures; that 600s was ever reached historically; that it explains all empty completions or stream drops. |
| Failure **without** observed eviction | The test failed, but server-state evidence did not identify TTL eviction; inconclusive. | Anything naming JIT-TTL. |
| Mixed | An intermittent association at most. | That the deterministic mechanism holds. |

In no outcome may OAI-19 name JIT-TTL as *the cause* of the 37.5%.

## Verification

- `npm test` green (the `tests/**/*.test.js` scope is load-bearing — an unscoped `node --test` walks
  `bench/cases`).
- The repo `verify` skill: tests, a real plugin load, a delegation round trip.
- **Mutation check** — invert `prefillMs === null` in `attempt-rows.mjs` and confirm the asymmetric
  fixture in `tests/bench-first-text.test.js` goes red; prove the mutation landed and the restore was
  clean with `~/Code/dotfiles/tests/mutation-landed.py`, never by eye.
- Driver dry-run: the pure planning unit tests, plus one calibration episode with a long TTL, to
  confirm the `lms` calls are non-interactive (`-a`, `-y`), the state sampler runs, and the manifest
  writes. A few minutes, not the full experiment.
- The experiment itself is **not run as part of this item**. It is OAI-34.
