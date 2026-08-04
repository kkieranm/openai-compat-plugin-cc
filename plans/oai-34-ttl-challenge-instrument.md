# OAI-34 — build the TTL challenge instrument, then hand it over to be run

*Written 2026-08-04. provenance: harness slug `composed-pondering-pudding`. Approved at the eighth
plan-gate round: six rounds of `CHANGES-REQUIRED` (one of them a blind whole-plan re-ask), an APPROVE
at round 7 with three notes, and a final confirmation round on the exact text below. The single
largest change came at round 4, when the CONFIRMING branch was withdrawn entirely — see decision C.*


## Context

The standing question OAI-19's write-up must not answer by guesswork: **does LM Studio's JIT idle-TTL
fail to count an in-flight prefill as activity, so a long prefill is evicted mid-flight?** ADR 013
settled the *design* (falsify, don't estimate: shorten the TTL to 120s against `scaffold`'s measured
335s prefill — the most favourable condition the mechanism could get) and explicitly did **not** ship
the instrument. Building and running it is OAI-34, and it is the last thing between here and OAI-19.

A draft exists — 876 lines, **stashed not committed** (`git stash list`, or `873dc05^3`). It was
withdrawn after two review passes found 18 defects. The repo's own retro is the reason this plan is
shaped the way it is:

> "the half nominated as 'exercised by running it' was never run, and most of both passes' findings
> were in it" — `plans/oai-24-observing-the-server.md:18`
>
> "Review found every one of them and review was not converging — which is an argument for running
> the thing against a stub early, not for reviewing harder." — `BACKLOG_DONE.md:213`

So the deliverable is not "fix ten findings". It is **an instrument that has actually executed before
anyone reviews it**, because that is the one thing OAI-24 never did.

**OAI-34 is not done when this ships.** The code phase delivers a built, self-tested instrument. The
item closes only when the user launches the real ~45-minute run on their own LM Studio and the
verdict is recorded in `BACKLOG.md`.

## What the probe established

- **The stash is recoverable** and worth starting from — the decision rule is pure and unit-tested,
  and pass 1's eight defects are already fixed in it.
- **OAI-35 landed the unblocking field.** `serverResponded` is minted `false` at
  `attempt-ledger.mjs:83` and set on the failure path from `obtainedResponse(error, { prefillMs })`
  at `attempt-outcome.mjs:257`, which already weighs the transport flag, an HTTP status, a completion
  shape and a measured prefill.
- **Finding (1) is real.** `review-report.mjs`'s failure envelope (`errorReport`, lines 221–239)
  carries `attempts` but **no** top-level `prefillMs`; only the success path spreads `runTimings`.
  The draft reads `report?.prefillMs` at `ttl-challenge.mjs:150`, so it is null on every failed
  episode — exactly the episodes that matter.
- **The size ratchet binds hard.** `tests/structure.test.js` enforces 300 lines/file and 60
  lines/function over the whole repo with an **empty** `ALLOWLIST`. The draft's files are 298, 284
  and 293. Worse, `structure.test.js:71` does `if (ALLOWLIST[rel]) continue;` in the *function* check
  too — so an allowlist entry silently disables two guards, not one. `tests/helpers.mjs` is at 297,
  so the stub cannot live there.
- **The harness is buildable.** `bench/lib/corpus.mjs` `materialize()` builds a real git repo with a
  real diff; `tests/helpers.mjs` `startFakeServer(handler)` takes an arbitrary handler, so a delayed
  first SSE frame is achievable; and `OAI_PLUGIN_CONFIG` is the established seam for pointing the
  companion at a temp `providers.json`. The driver spawns the companion without an `env` override, so
  that variable already flows through.
- **The leftover artifact is a trap, and its recorded provenance is wrong.**
  `bench/results/ttl-challenge-2026-08-03T16-30-54-480Z.json` satisfies the done-condition as
  originally written. It was produced by a *pre-stash* draft: every episode died in ~1s at
  `--max-tokens 2048` against a 3912 floor, with the server **up** and the model resident (its own
  samples prove it). ADR 013 attributes that file to "a server that was down"; that is not what
  happened, and the note should be corrected rather than repeated.
- **Preconditions for the real run are currently satisfiable** — `lms ps` reports nothing loaded, and
  `qwen/qwen3.6-27b` is still served.

## Decisions

Grilled with Codex. Three of the four were settled there; the fourth was escalated, sent back for an
adversarial round at the user's direction, and came back with a **replacement** for the recorded
finding rather than an accept/reject.

**A — the dispatch predicate: `serverResponded` alone.** Replace the draft's four-way disjunction
with `attempts.some(a => a.serverResponded === true)`. ADR 013 names the response axis as exactly
what this instrument needs, and a parallel predicate in `bench/` duplicates a production rule it can
drift from — it already had: `prefillMs != null` is looser than the production rule. This also
retires finding (6)'s doc/code mismatch (the comment claimed four witnesses, the code implemented
three) instead of patching the comment. **Renamed `obtainedAnyResponse`** — `reachedServer` asserts a
peer was reached, which ADR 013:27-32 says this field does *not* establish, and `dispatched` already
means something else in the ledger. Add a **record-contradiction check**: `outcome: 'answered'` with
`serverResponded: false` is an impossible record and must fail the instrument, not be quietly
accepted.

**B — execute before reviewing.** Build a hermetic end-to-end harness. This is the decision that
distinguishes OAI-34 from OAI-24, and it lands in the default `npm test` (user's call) so it cannot
quietly stop running.

**C — the confirming branch is WITHDRAWN. The instrument refutes; it does not confirm.**

This began as "replace recorded finding (3)" and became something larger over four gate rounds, each
of which killed a different rescue of the confirming verdict on a *different* axis: the clock origin;
then bracket width (present 119s / absent 121s straddles a 120s expiry); then `startupBoundMs`, which
is not a bound at all because `prefillMs` starts *before* the HTTP request (`chat.mjs:158`), a
calibration measurement cannot bound a later process's startup, and the driver's `Date.now()` is not
the monotonic clock `stream-collect.mjs:69` times attempts on.

Behind them is one structural fact, and it is the real finding: **proving an unload happened after
expiry requires observing the model still resident after expiry — and if the mechanism is real it
fires *at* expiry, so that observation cannot exist.** Confirmation-by-sampling is incoherent for a
mechanism that fires exactly at the threshold you are trying to prove you are past. No anchor rescues
it, which is why four attempts each failed somewhere new.

So:

| Episode verdict | Meaning | Sweep outcome |
|---|---|---|
| `survived-past-expiry` | outlived expiry by the margin, no unload seen | `deterministic-form-refuted` when all did |
| `no-exposure` | did not outlive expiry by the margin | `no-exposure` |
| `failure-with-unload-observed` | failed; residency also showed the model absent at some point | `inconclusive-failure` |
| `failure-without-unload-observed` | failed; residency showed no absence | `inconclusive-failure` |
| `survived-despite-unload` | succeeded, but residency showed an absence | `contradictory-evidence` |
| `not-dispatched` | no HTTP response was ever obtained | `instrument-failed` |

**The table is exhaustive over what the code can return, and that is a property to enforce rather
than assert.** `--episodes` must be a positive integer or the driver hard-fails at argument parsing,
so the draft's `no-episodes` outcome becomes unreachable and is deleted; `failed-early-with-unload`
goes with the attribution machinery. A test asserts the set of episode verdicts the module can emit
equals the set this table lists — the repo's own rule that a recurring defect class graduates into a
structural guard, and ADR 013 already lost a table row once to exactly this drift.

**`mechanism-reproduced` is removed as a licensed outcome**, and the vocabulary is epistemically
neutral throughout — no label says "post-TTL" or "eviction", because those are the facts the
instrument cannot establish. An observed unload is **recorded in full and attributed to nothing**.
User-approved; ADR 013's outcome table loses its confirming row, recorded as a finding rather than
edited silently.

**Refutation survives, and the clock offset cancels rather than being assumed away.** Write `P` for
the moment the plugin starts timing (just before it issues the request), `R = P + c` for server
receipt, and `S` for child spawn. Survival requires the request to still be in prefill after true
expiry, i.e. `firstToken > R + ttlMs`. Expanding both sides from `S`: `(S→P) + prefillMs >
(S→P) + c + ttlMs`. **The spawn-to-request overhead `S→P` — node startup, config load, model probing,
git diff, prompt build — appears on both sides and cancels.** The condition reduces to
`prefillMs > c + ttlMs`, where `c` is connect-and-transit **to localhost**: sub-millisecond, and
already inside `prefillMs` anyway. `EXPOSURE_MARGIN = 1.5` gives 60s of slack at `ttlMs = 120s`,
covering `c` by orders of magnitude.

This is only true if `exposed` is computed from **`prefillMs`, never from `durationMs`** — the
driver's wall clock carries the uncancelled `S→P` term, which is exactly the offset that defeated
four attempts at the confirming branch. The draft's `firstTokenMs ?? durationMs` fallback is
therefore removed rather than fixed: a survival always has a measured prefill, and an episode without
one is not a survival.

**`c` does not cancel, and the plan states its residual instead of waving at it.** `c` spans JSON
serialization of a ~47k-token body, the socket write and server admission (`chat.mjs:158` →
`provider.mjs:115` → `http.mjs:283`). Refutation therefore rests on exactly one inequality:

```
c < prefillMs - ttlMs          (the achieved slack)
```

Not the fixed `c < 60s` an earlier draft implied — the slack is whatever the episode actually
achieved, and at the measured `scaffold` prefill of ~335s against a 120s TTL it is **~215s**. So the
instrument **records `exposureRatio = prefillMs / ttlMs` and the achieved slack in the manifest**, and
the refutation wording states the condition rather than burying it: *this refutes the deterministic
form provided request serialization and admission took less than the recorded slack.* An episode
whose slack is small is not banked — that is what `no-exposure` already exists for, and the margin is
what keeps the condition far from binding. **What is not claimed is that `c` was measured**; it was
not, and no black-box anchor available here measures it.

The condition is per-episode, so **the sweep quotes the *minimum* slack across its episodes** — a
sweep is only as sound as its weakest one, and quoting the mean or the best would let a marginal
episode ride on its siblings.

**Three of the guards survive, as instrument-validity checks rather than as attribution:**

- **G2 sole tenancy** — no model other than the target appears in any in-flight sample. The protocol
  *requires* nothing else connected, so a competing model means the precondition was violated:
  `instrument-failed`, not a finding about the server.
- **G5 response obtained** — decision A; gates `not-dispatched`.
- **G6 treatment confirmed** — the applied `ttlMs` read back from the server matches what was asked.
- **G8 record self-consistency** — decision A's contradiction check, and it is a **validity input
  like the others, not a loose end**: an attempt with `outcome: 'answered'` **or `'refused'`** and
  `serverResponded: false` is an impossible record and yields `instrument-failed`. (`refused` is
  included on the same reasoning as `answered` — `attempt-outcome.mjs`'s closers make both impossible,
  so either appearing means the record is not what this instrument thinks it is reading.) It cannot be
  folded into G5, because capability degradation can produce several physical attempts, so an earlier
  `serverResponded: true` would satisfy `some(...)` while a later contradictory entry still stands.

The rest — the observation bracket (`lastPresentAt`, `firstAbsentAt`, width), unbroken polling,
residency at start, and whether the failure reason was a client budget (`http-errors.mjs:94` makes
every one a `*-timeout`) — become **recorded observation-quality fields**, not verdict inputs. They
tell a reader how clean the observation was without any of them being asked to carry a causal claim.

**One caveat this makes harmless, and which must be recorded rather than fixed:** the sampler's
"in-flight" phase means *the child process is alive*, not *the HTTP request is open*. An unload seen
after the request already failed but before the companion exits is inside that window. That would
have been fatal to a confirming verdict — it is ADR 013's own "an unload after the request had
already failed" disqualifier — but with attribution withdrawn it is a caveat on a recorded field.

**D — split along three seams rather than allowlisting.** Forced by the ratchet, and right anyway:

- `bench/lib/ttl-residency.mjs` — evidence from `lms ps --json`: `residencyOf`, `entryFor`,
  `inPhase`, `firstUnload`, plus the new `lastPresentBefore`, `otherModelsSeen`, `unreadableBefore`,
  and `activityObserved`.
- `bench/lib/ttl-attempts.mjs` — evidence from the plugin's attempt record: `obtainedAnyResponse`,
  `prefillFromAttempts`, `recordContradiction`.
- `bench/lib/ttl-verdict.mjs` — policy only: `EXPOSURE_MARGIN`, `calibrationCleared`,
  `validityChecks` (G2/G5/G6/G8), `episodeVerdict`, `summarize`.
- `bench/ttl-challenge.mjs` — I/O only: config, spawn, sample, manifest.

## Phase 0 — split and rename, no behaviour change

Restore the stash into the three-module shape above, `reachedServer` → `obtainedAnyResponse`, tests
split into `tests/ttl-verdict.test.js` and `tests/ttl-evidence.test.js`. The draft's source-shape
guard (the `main()`-not-called-at-module-scope regression test) moves with the driver. Every existing
assertion must still pass unweakened. `npm test` green before moving on.

## Phase 1 — the injection seam

One config object; production values are the module default; the harness overrides by **argv**, not
env, so a stray shell variable cannot alter the 45-minute run. Unknown flag ⇒ hard error.
Injectable: `--lms`, `--case`, `--challenge-ttl`, `--calibration-ttl`, `--episodes`, `--sample-every`,
`--out-dir`.

Two things this must get right:

- **The manifest's `protocol` is built from the EFFECTIVE config**, never from module constants
  (`ttl-challenge.mjs:279` reads them directly today). A record that asserts the production protocol
  while the harness ran something else is worse than no record.
- **`--out-dir` is not optional plumbing.** A self-test writing into `bench/results/` recreates the
  junk-record incident the draft's own guard test exists to prevent — and this time the junk matches
  the very glob the done-condition reads.

Add `protocol.canonical`: false whenever any experimental parameter (case, TTLs, episodes, `lms`
path, sample interval, provider config) differs from the shipped default. `--out-dir` alone does not
clear it.

**Ambient config must not be able to redirect a canonical run.** The gate round caught a real
contradiction here: the driver inherits `OAI_PLUGIN_CONFIG`, so a default-argv run could point the
companion at an arbitrary provider and still stamp `canonical: true`. So the provider config becomes
an explicit `--provider-config` argv flag that marks the run **noncanonical**, and a canonical run
**strips `OAI_PLUGIN_CONFIG` from the child's environment** rather than trusting it to be unset.

## Phase 2 — a minimal smoke harness, before the fixes

Deliberate ordering: stand the harness up and run it **before** the fixes, so the I/O half is
exercised as it was withdrawn. Two of the ten pass-2 findings were never written down anywhere; this
is the recovery mechanism for them, and anything it surfaces gets recorded rather than silently
fixed.

**Scope here is deliberately thin, per the gate round**: assert only that the real entry point
executes, the `lms` calls are shaped as expected, the manifest is written to the injected out-dir,
and exit codes are right. **No assertions on verdict semantics** — those behaviours are about to
change, and encoding them now would enshrine the unfixed rule and then have to be rewritten, which
teaches the suite nothing. Semantic scenarios land in phase 3.

- `tests/ttl-stub-lms.mjs` — a fake `lms` executable answering `ps --json`, `load`, `unload`,
  `version` from a scenario file (residency timeline, applied TTL, competing models), plus the
  scenario helper. Its own file: `helpers.mjs` is at 297 lines.
- `tests/ttl-challenge-e2e.test.js` — drives the **real entry point** as a subprocess against the
  stub `lms`, the repo's fake server on an ephemeral port via a temp `providers.json`, sub-second
  TTLs and a temp out-dir; asserts the written manifest.

**The spawnSync footgun applies at the OUTER boundary and not the inner one — both halves stated, so
neither gets "fixed" later.** The test process hosts the fake HTTP server, so it **must** launch the
driver asynchronously (`spawn`/`execFile` and await exit, as `tests/helpers.mjs` `runCompanion`
already does); a synchronous launch there deadlocks exactly as the repo footgun describes. The
driver's *own* `execFileSync` calls to `lms` are safe, because they block the driver's event loop
inside a child process rather than the test process where the server lives.

## Phase 3 — the fixes, and the scenarios that pin them

Findings (1), (2), (4), (5), (6), (7) as recorded; (3) per decision C; plus A's predicate and record
check. Specifically:

- **(1)** read `prefillMs` from the **answering attempt, else the last, else null** — stated so it
  does not break silently if `--max-attempts 1` ever moves.
- **(2)** is **withdrawn along with the confirming branch**, not implemented. It asked the confirming
  verdict to require the unload to precede first token; with no confirming verdict there is nothing to
  gate, and the "null first token makes it vacuously true" reasoning is *false* under the round-4
  correction — "in-flight" means the child is alive, so a request may already have failed before a
  later sample sees the absence. Any readable absence in that window is recorded neutrally as
  `failure-with-unload-observed`, with its timing exposed as observation quality only. Leaving the
  test in as "harmless" would keep it verdict-bearing.
- **`failed-early-with-unload` is deleted**, not retained — it is an episode outcome the new table
  does not list, and the early/late distinction was attribution machinery.
- **(4)** the mismatched-TTL warning currently says "this episode cannot be classified" and then
  classifies it — G6 makes the sentence true.
- **(5)** `calibrate` writes an **aborted manifest** carrying `summarize(..., { calibrationCleared:
  false })` and exits nonzero, instead of throwing the record away. With `no-episodes` deleted, this
  is the path that reaches `summarize` with an **empty** episode list, so the failed-calibration
  branch must **outrank the empty-list check** and return `instrument-failed` — a test pins that
  ordering, since getting it backwards is how the abort path would silently stop reporting.
- **(7)** extract the calibration rule as a pure `calibrationCleared(...)`.
- Also: `lms version` prints an ANSI banner, not a version, so `environment.lmsVersion` records
  garbage today — parse `CLI commit: <sha>` out of it, else null.

Harness scenarios, one per decision the instrument can get wrong: 3× survive → refuted; calibration
short → `instrument-failed` **and the aborted manifest written** and nonzero exit; no response
obtained → `instrument-failed`; a competing model appears → G2 → `instrument-failed`; an applied
`ttlMs` that does not match what was asked → G6 → `instrument-failed`; a failure with an unload seen
**and `firstTokenMs: null`** → `failure-with-unload-observed` → `inconclusive-failure`, and the
manifest carries the bracket *(the pin that the four gate rounds bought: this must NOT render a
causal claim)*; a failure with no unload → `failure-without-unload-observed`; success + unload →
`contradictory-evidence`.

**Every verdict-bearing check gets a scenario crossing the real entry point**, table-driven over
shared setup — plus one asserting the observation-quality fields (bracket, polling gaps, residency at
start, `*-timeout` reason, `exposureRatio`) are **present in the manifest and absent from the verdict
inputs**. A pure verdict test would prove only that the rule is right, never that the driver
*collected and transported* the fact — which is precisely the unexecuted-I/O failure this harness
exists to prevent.

**One stated exemption, so it is a decision and not an omission: G8 gets no e2e scenario.** The
production closer at `attempt-outcome.mjs:220` makes an `answered`-with-`serverResponded: false`
entry structurally impossible to produce, so no fake-server scenario can generate one without an
injection seam this feature does not otherwise need. G8 is therefore pinned by a unit test on the
pure rule, plus an e2e assertion that the driver **reads and forwards** the attempts array the rule
consumes — which is the plumbing the harness exists to prove.

## Phase 4 — docs and tracker

- **ADR 013** — amend, not rewrite, and the amendment is substantive: **the outcome table's
  confirming row is removed**, with the impossibility argument recorded as the reason (sampling
  cannot witness presence after an expiry the mechanism fires at). Also: recorded finding (3)
  superseded and why; G2/G5/G6 as the enforcement its own "limits" section demanded; the caveat that
  "in-flight" means the child is alive rather than the request open; and the corrected provenance of
  the leftover artifact. **`BACKLOG.md` gains a follow-up item** for a confirmation-capable design
  (matched TTL controls, or server-side telemetry if LM Studio ever exposes an unload reason) so the
  question is parked rather than closed.
- **`CLAUDE.md`** — one present-tense line naming the instrument and linking ADR 013.
- **`BACKLOG.md`** — rewrite OAI-34's done-condition. Not "a file matching the glob exists", which
  the leftover already satisfies, but: **`protocol.canonical: true`, a stamp later than the commit
  that lands the instrument, and an `outcome.verdict` other than `instrument-failed`** — plus the
  handover recording **the exact result path and the instrument's commit SHA**, since a timestamp
  alone does not attest which revision produced it. Delete
  `bench/results/ttl-challenge-2026-08-03T16-30-54-480Z.json` as part of this feature —
  `bench/results/` is gitignored, so no repo file can warn anyone about it.
- Record the two unrecoverable pass-2 findings as a known gap.

## Verification

- `npm test` green, quoting the summary line. The `tests/**/*.test.js` scope is load-bearing.
- **Report the measured wall-clock the harness adds.** Budgeted at ~15–20s. If it overshoots, cut
  **timings** — sub-second TTLs, shorter delays — or consolidate shared setup. **Never delete a
  decision-pinning scenario to meet the budget**: that trades the thing the harness exists for
  against a number, which is how the unexecuted half got unexecuted the first time. If the budget and
  the scenario set genuinely cannot both be met, report it rather than silently dropping coverage.
- The repo `verify` skill.
- **Mutation check on the key invariant** — make `obtainedAnyResponse` return `true`
  unconditionally; the e2e "no response obtained" scenario must go red. Chosen because it crosses
  both halves: a pure-rule mutation would prove only that the unexecuted half is still unexecuted.
  Prove the mutation landed and the restore was clean with `~/Code/dotfiles/tests/mutation-landed.py`,
  never by eye.
- **One real-CLI smoke check, not the experiment** — the stub cannot catch a change in the real
  `lms` dialect. Verify `lms ps --json` parses against the real binary and the load/unload cycle is
  non-interactive. Minutes, not 45 of them.

**Stated plainly: this phase does NOT run the experiment.** The ~45-minute run is the user's
hardware and their call, launched when they say so, with nothing else resident. I will ask at the
end; I will not launch it incidentally.

## Review

Per the repo's order: `advisor` → `review-lean` → **wide mode**, which this change triggers on its
own terms — it introduces modules carrying vendor/protocol assumptions about a server's lifecycle.
