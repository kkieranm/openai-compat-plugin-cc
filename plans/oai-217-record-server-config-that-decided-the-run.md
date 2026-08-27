STATE: dual-approved-unattended

Owner's per-run authorisation (2026-08-27, verbatim): "i will leave you unattended. keep iterating
on items using /feature . when you have an option that you would usually put to me, instead try to
converge using codex and a fable agent. do not prompt for plans as i will not be here" — and, the
same day: "you also have my permission to use lm studio if you need it".

Per `plans/README.md`, this state runs the dual gate in full (Codex + an independent Claude verdict
subagent, same digest, same turn, neither shown the other, Claude half under the read-only-delegation
snapshot protocol, fail-closed envelope parsing). Two genuine approvals authorise building for this
run only; anything short degrades this file to `unattended-draft` and blocks the item.

# OAI-217 — record the server configuration that decided a benchmark run

## Context

`bench/` records the provider, the model id, the flags the run was invoked with, and every timing and
token figure — and nothing about how the server was configured to run that model. A reader cannot tell
from a record whether a model answered under `reasoning_effort: xhigh` or `low`, with its thinking
channel on or off, at what loaded context length, or at what temperature, because those live in the
server's own per-model configuration rather than in the request.

**Dated instance (OAI-217, 2026-08-25):** fourteen full six-case runs across eleven models; the
`qwen/qwen3.8-27b` rows — 0 of 6, every case lost to a reasoning runaway — are unattributable from the
record alone. The cause was `reasoning_effort` defaulting to `xhigh`, recoverable only by reading LM
Studio's UI or `model.yaml` by hand, long after the run. **The item's named silent-failure mechanism:**
"the report reads as complete… nothing signals that the variable which determined the outcome is
absent."

**Scope decided by Codex + a fable agent + the advisor (three-way convergence, 2026-08-27)** — the fork
that would otherwise have gone to the owner, converged under the standing authorisation above:

- **Capture the effective context window here (Option 1), not defer it to OAI-218.** The window is in
  OAI-217's own enumeration, and — per OAI-215's own text — the token-reserve watchdog threshold
  *derives* from the served window, so the window on a *failure* record is the single field that turns
  a runaway row from unattributable into readable. OAI-218's two dated instances are both about per-case
  *rendering*; that rendering is its remaining work and this capture does not front-run it. The
  motivating qwen rows are *failures* (`errorReport`), which per-case success-row rendering structurally
  never reaches.
- **Record provenance with the window** — `{contextWindow, contextSource, detectedWindow}`, reusing
  `effectiveWindow()` — because `resolveTarget` prefers a *configured* `contextLength` over detected
  state, and a bare number would let a reader mistake an operator assertion for an observed server fact.
- **Declared-unknown marker: per-parameter, request-conditional, never a constant stamp** — a fixed
  `"unknown"` goes false the day OAI-215 forwards `--reasoning-effort`; a per-knob map derived from what
  the request carried stays true across it.
- **Operator note: kept, but bench-level, not CLI-level** — off `errorReport`/`jobs.db`, resolving by
  construction the hazard that operator free text could carry a pasted secret into persisted job state.
- **No OAI-215 dependency; OAI-217 before OAI-218.**

## Round-1 plan-gate findings folded in (both approvers CHANGES-REQUIRED, converging)

The first digest went to both approvers. Codex and the Claude verdict subagent independently found the
same two load-bearing defects; Codex found three more. All are folded below — this is the amended
plan the round-2 gate judges whole.

- **F1 (both): the explicit `--model` is dropped.** `resolveTarget` selects via
  `selectModel(profile, options.model, described)`; `effectiveWindow(profile, described)` omits the
  model and re-resolves its own, so `--model B` would record model A's window. Fixed in decision C /
  Phase 1: `effectiveWindow(profile, described, options.model)` — its signature is
  `(profile, described, explicitModel)` and it routes through `planSelection(profile, explicitModel,
  described)`, the same selection `selectModel` uses, so the two provably agree.
- **F2 (both, blocking): the task attach point cannot see the motivating failure.** `requireAnswer`
  is refused not in the executor but in `report()` (`task-report.mjs:124`), which `taskFlow` calls at
  `cmd-task.mjs:122` *after* `executeTask` has returned. Wrapping `chatCompletion` structurally cannot
  catch it. Fixed in Phase 3: attach at `taskFlow`'s `report(outcome, …)` call, using context carried
  on `outcome`; `cmd-task.mjs` added to touched files.
- **F3 (Codex): the background-worker failure path.** A `--background` submission uses `prepareTask`,
  not `executeTask`; a worker's later failure goes through `publishFailure → errorReport` and runs none
  of the foreground attach. Resolved by SCOPE (decision F): OAI-217 covers the foreground path (the
  bench dated instance is entirely foreground); the false claim "task failures flow through runTask" is
  removed; the background-null gap is filed as named residue at step 9 — the same distinct piece OAI-214
  already pointed here.
- **F4 (Codex): the motivating review-bench FAILURE record drops the fields.** `bench/run.mjs`'s
  `failedRun` (line 156) builds a narrow object `{diffOnly, error, reason, requestedModel, attempts}`,
  not the whole envelope, so readers added to `outcome.mjs` do nothing unless `failedRun` calls them.
  Fixed in Phase 4: one `runContextFrom(stdout)` reader, called from `failedRun`.
- **F5 (Codex): `??=` + unvalidated serialization.** `attachRunContext` using `??=` would preserve a
  pre-existing foreign `error.contextWindow`, which `errorReport` serializes into `jobs.db` unchecked.
  Fixed in decision A: `attachRunContext` OVERWRITES from the trusted resolved context, and `errorReport`
  validates/coerces each of the four fields at the persistence boundary.
- **F6 (Codex, minor): `effectiveWindow().detected` semantics.** It means "a detected value
  *conflicting* with the configured one," absent when detection agrees — not "the detected server
  window." Documented and tested as `detectedWindow: null` on agreement (decision C).
- **Non-blocking (Claude): name clash** between `serverConfigFrom` (builder) and a same-named bench
  reader — the bench reader is named `runContextFrom` (F4), so no clash. **Behavior shift (Claude):**
  `effectiveWindow` uses `positiveInteger(profile.contextLength)` where `resolveTarget` uses `??`, so a
  configured `0`/non-integer now falls through to detection rather than pinning the window — an
  arguably-correct improvement, noted for the reviewer, not a redesign.

## Round-2 plan-gate findings folded in (Codex CHANGES-REQUIRED; Claude APPROVE)

Round 2 confirmed F1–F6 correct and F3 honestly scoped. The two approvers split on one gap — Codex
blocking, Claude non-blocking (honest `null` parity with `requestedModel` on the same path, not the
motivating review-bench case). Resolved by fixing it, which satisfies both. Codex's other two findings
folded too.

- **F7 (Codex blocking, Claude noted): the foreground task transport/watchdog failure misses the
  attach.** A throw from `chatCompletion`/`withProgress` in `executeTask` (task-execute.mjs:200)
  propagates past `taskFlow`'s `report`-catch to `runTask` (sampling only), recording null run context.
  Fixed in Phase 3: `executeTask` gets a post-`prepareTask` catch attaching from `prep`. The task path
  is then fully covered post-resolution — oversize, transport/watchdog, reasoning-only — symmetric with
  the review whole-body wrap.
- **F8 (Codex): the coercion is not fail-closed.** `Number.isFinite` admits negative/fractional windows;
  a bare object check admits arrays/foreign objects as `serverConfig`. Fixed in decision A: windows
  through the exported `positiveInteger`; `serverConfig` accepted only as the exact three-knob status
  map, else `null`.
- **F9 (Codex): the F4 fix is unproven.** The listed tests exercise the CLI envelope and
  `sweep-outcome.mjs`, neither traversing `bench/run.mjs`'s private `failedRun`, and mutation 1's
  alternative wording let the sweep path stand in. Fixed: `failedRun` is EXPORTED (private today, unlike
  the exported `reviewFlags`), given a direct test, and mutation 1 targets `failedRun` specifically.

## Round-3 plan-gate findings folded in (Codex CHANGES-REQUIRED; Claude APPROVE)

Round 3 confirmed F9 resolved and mutations 2/3 correct. Codex found three narrowing hardening points
(Claude judged the coverage one "slightly overstated yet not a defect"); all folded.

- **F10 (Codex): F7's "every post-resolution throw" claim overstates a single-call wrap.** `executeTask`
  runs `taskRequest`/`artifactFor`/outcome-assembly outside the `chatCompletion` catch, and `taskFlow`
  runs `substitutionNotice` before its report-catch. Fixed in Phase 3 by making the claim TRUE, not
  narrowing it: each task function wraps its WHOLE post-resolution body (per-function, mirroring the
  review whole-body wrap), so `prepareTask` (post-`resolveTarget`), `executeTask` (post-`prepareTask`),
  and `taskFlow` (`substitutionNotice` + `report`) each attach from the context in their own scope.
- **F11 (Codex): the fail-closed coercion is untested and shape-checkable, not reconstructed.** Phase 5
  tested only a non-finite window; and an object with the right keys but a custom prototype/`toJSON`
  could pass a bare shape-check and alter persisted JSON. Fixed in decision A: `errorReport`
  RECONSTRUCTS — it builds a fresh `{reasoningEffort, temperature, thinking}` from the three own keys,
  each value admitted only if it is one of the two allowed strings (else that knob is `null`), rejecting
  a non-plain-object outright; `contextSource` is admitted only if it is one of the source values
  `effectiveWindow` can produce (`'config'` or a dialect source string), else `null`. Phase 5 gains the
  negative/fractional-window, array-`serverConfig`, extra-key/foreign-prototype-`serverConfig`, and
  unknown-`contextSource` cases, plus a task transport/watchdog failure-envelope test and its mutation.

## Design decisions

**A. One shared attach helper — `attachRunContext(error, ctx)` — applied at each flow's post-resolution
catch, mirroring `attachSampling`, but OVERWRITING not `??=`-ing.** The motivating failure is thrown by
the report stage after the model call returned, and the window is resolved mid-flow (not at command
entry), so it is not in scope in `runReview`/`runTask`'s catch. `attachRunContext` assigns
`error.contextWindow`, `contextSource`, `detectedWindow`, `serverConfig` from the single authoritative
resolved context (behind a `typeof error === 'object' && error` guard) — an overwrite, because there is
one resolution per run and no case where a nearer throw holds a more-specific window, and because a
foreign pre-existing value must not survive into `errorReport`'s `jobs.db` serialization (F5). A failure
*before* resolution never calls it, so the fields stay absent → `errorReport` reads `?? null` (the
`requestedModel` precedent: `null` = "failure preceded resolution", not "not captured"). `errorReport`
additionally coerces each field it reads, FAIL-CLOSED and by RECONSTRUCTION (F8/F11): the two windows
through the exported `positiveInteger` (a positive integer or `null` — negative/fractional refused);
`contextSource` admitted only if it is one of the values `effectiveWindow` can produce (`'config'` or a
dialect source string), else `null`; and `serverConfig` rebuilt as a fresh
`{reasoningEffort, temperature, thinking}` read from those three OWN keys of a plain object, each value
admitted only if it is `'requested'`/`'server-default-unobserved'` (else that knob `null`) — a non-plain
object, an array, extra keys, or a value carrying a custom prototype/`toJSON` cannot reach `jobs.db`,
because the persisted object is newly constructed, never the foreign one passed through.

**B. `serverConfig` is a status-only, per-knob map.** `{ reasoningEffort, temperature, thinking }`, each
`'requested'` or `'server-default-unobserved'`; `thinking` is always the latter (no flag requests it).
Values are not duplicated — `reasoning_effort`'s value lives in the `sampling` echo; temperature's value
is not added here (OAI-215-adjacent). Built by `serverConfigFrom({ sampling, temperature })` in
`run-context.mjs`.

**C. `effectiveWindow` is the single window authority; `resolveTarget` sources from it WITH the explicit
model.** `resolveTarget` is widened to return `{ model, contextLength, contextSource, detectedWindow }`,
all derived from `effectiveWindow(profile, described, options.model)` (F1) so the window the
ladder/watchdog acts on and the window the envelope records are one computation. `contextSource` is
`'config'` when a positive-integer `contextLength` is configured, else the detected source or `null`.
`detectedWindow` is present ONLY when a detected value conflicts with the configured one, `null`
otherwise (F6) — documented and tested, not relabelled as a universal "server window." `plan.problem`
from the same selection is preserved so a refused id still fails exactly as `selectModel` makes it fail
today (Phase 1 confirms `selectModel` and `planSelection` resolve the same id, or sources the model from
`effectiveWindow`'s `modelId`). A configured `0`/non-integer now falls through to detection (the noted,
accepted behavior shift).

**D. The operator note is a bench-harness flag, persisted only into the bench record.** `bench/run.mjs`
and `bench/review-sweep.mjs` gain a bounded `--note` (fixed max length, truncation recorded); it lands
in the sweep ledger's `envelopeFor` header and the review-bench record's config block, never the CLI
envelope, `errorReport`, or `jobs.db`.

**E. OAI-218 is not absorbed.** This plan lands `{contextWindow, contextSource, detectedWindow}` on every
per-run record; OAI-218's remaining, distinct work is surfacing the window and `hunksOnly` per case in
the rendered report *table*, narrowed at step 9.

**F. Scope is the FOREGROUND path (F3).** The bench dated instance runs entirely foreground
(`/oai:review --json`, no `--background`). A `--background` task that fails records `contextWindow`/
`serverConfig` as `null`, exactly as it already records `sampling: null` (the worker never runs the
command-level catch — `errorReport`'s own comment at :267 documents this). Making the worker restore the
fields onto its failures — persist in the job DTO, restore before `publishFailure`, echo on the worker
success outcome, a `/oai:result` field, a background test — is the distinct larger piece OAI-214 already
named as "OAI-217's territory"; it is filed as a NEW residue item at step 9 (named mechanism: a
background `--json` task failure records incomplete server config because the worker bypasses the
foreground attach), not built here.

## Files this plan touches

New: `scripts/lib/run-context.mjs` (leaf, imports nothing: `serverConfigFrom`, `buildRunContext`,
`attachRunContext`, `reconstructServerConfig`; `CONTEXT_SOURCES` was relocated to `model-info.mjs` at
/simplify to sit with the readers that produce those strings), `tests/run-context.test.js`.
Edited:
`scripts/lib/delegate.mjs` (`resolveTarget` widens its return via `effectiveWindow(…, options.model)`),
`scripts/lib/cmd-review.mjs` (`reviewFlow`: build `serverConfig`; widen `named()` to carry run context;
wrap the whole post-resolution body — `requestFindings` + `parseFindings` + `report` — in one
`try/catch` that throws `named(error)`; pass the fields into `report`'s context),
`scripts/lib/task-execute.mjs` (`prepareTask`/`executeTask`: build `serverConfig`; carry the four fields
on `prep` and the outcome; attach around `prepareRequest`'s oversize throw, with `serverConfig` built
before that call),
`scripts/lib/cmd-task.mjs` (`taskFlow`: wrap `report(outcome, …)` in a catch doing
`attachRunContext(error, outcome)` then rethrow — F2),
`scripts/lib/review-report.mjs` (`jsonReport` + `errorReport` echo the four fields; `errorReport`
coerces them — F5),
`scripts/lib/task-report.mjs` (`jsonTaskReport` echoes them),
`bench/lib/outcome.mjs` (one `runContextFrom(stdout)` reader off the failure envelope),
`bench/run.mjs` (`failedRun` calls `runContextFrom` — F4; plus the `--note` flag),
`bench/lib/sweep-outcome.mjs` (`reported()` caveats + `failure()` carry the four fields — both paths),
`bench/review-sweep.mjs` (`--note` flag), `bench/lib/sweep-ledger.mjs` (`envelopeFor` header carries the note),
`CLAUDE.md` (one present-tense note).
`scripts/lib/model-info.mjs` (export `positiveInteger` for `errorReport`'s fail-closed window coercion —
F8; and — folded in at /simplify — name the dialect source strings as `SOURCE_*` constants and export
`CONTEXT_SOURCES` built from them, so the set `errorReport` validates `contextSource` against is
drift-proof by construction rather than a hand-copy; `effectiveWindow`'s branch logic otherwise
unchanged, its signature and conflict-only `.detected` confirmed at 245-288).
Read to confirm no change: `bench/lib/record.mjs` (persists the reduced result, not the envelope — which
is why F4's explicit copy is required), `bench/task-run.mjs` (task-bench record).

## Implementation

### Phase 1 — the leaf and the window authority
- `scripts/lib/run-context.mjs`: `serverConfigFrom({ sampling, temperature })` (decision B);
  `attachRunContext(error, ctx)` (decision A — overwrite, `typeof` guard).
- Widen `resolveTarget` (`delegate.mjs:129`) to `{ model, contextLength, contextSource, detectedWindow }`
  from `effectiveWindow(profile, described, options.model)`. Confirm `selectModel(profile, options.model,
  described)` and `planSelection(profile, options.model, described)` resolve the same id (both are how
  the repo picks a model); if any doubt, source `model` from `effectiveWindow`'s `modelId` and keep its
  `problem` so a refused id fails as today. Coerce `undefined` window/source/detected to `null` (the
  branch-dependent field set, probe claim 4).

### Phase 2 — review flow
- `reviewFlow` (cmd-review.mjs:131): after `resolveTarget`, build `serverConfig`. Extend `named()` to
  `attachRunContext` the four fields, and wrap the ENTIRE post-resolution body — `requestFindings`,
  `parseFindings`, and `report` — in one `try { … } catch (error) { throw named(error); }`, so a
  reasoning-only runaway thrown at report time carries the context. On success pass the four fields into
  `report`'s context (line 168).
- `jsonReport` (review-report.mjs:146) echoes the four fields; `errorReport` (line 239) reads and coerces
  them (F5).

### Phase 3 — task flow (F2 corrected, F10 broadened)
Each function wraps its WHOLE post-resolution body, so every foreground throw after `resolveTarget`
carries the context — the per-function analogue of the review whole-body wrap:
- `prepareTask` (task-execute.mjs:128): after `resolveTarget`, build `serverConfig` from
  `{ sampling, numeric.temperature }` and the local run-context; wrap the REST of the function
  (`prepareRequest` and the `prep` assembly) in `try { … } catch (error) { throw attachRunContext(error,
  ctx); }`; return the four fields on `prep`.
- `executeTask` (line 180): wrap the WHOLE body after `const prep = await prepareTask(args)` —
  `estimateRun`, `taskRequest`, `chatCompletion`/`withProgress`, `artifactFor`, outcome assembly — in
  `try { … } catch (error) { throw attachRunContext(error, prep); }`, and put the four fields on the
  returned `outcome`. This covers the transport/stream-watchdog throw (F7) and any outcome-assembly throw,
  not just `chatCompletion`.
- `taskFlow` (cmd-task.mjs:93): wrap `substitutionNotice` + `report(outcome, …)` (lines 119-122) in
  `try { … } catch (error) { throw attachRunContext(error, outcome); }` — where the reasoning-only refusal
  is raised (F2). `jsonTaskReport` (task-report.mjs:32) echoes the four fields; task failures rethrow
  through `runTask`'s catch → shared `errorReport`.
- Background (decision F): unchanged; a background failure records the fields as `null`, filed as residue.

### Phase 4 — bench records (F4)
- `bench/lib/outcome.mjs`: one `runContextFrom(stdout)` returning `{ contextWindow, contextSource,
  detectedWindow, serverConfig }` off the failure envelope (following `requestedModelFrom`).
- `bench/run.mjs` `failedRun` (line 156): spread `runContextFrom(error.stdout)` into the record — without
  this the motivating review-bench FAILURE record still drops the fields. EXPORT `failedRun` (private
  today, unlike the exported `reviewFlags`) so Phase 5 can exercise this reducer directly (F9).
- `bench/lib/sweep-outcome.mjs`: add the four fields to `reported()`'s `caveats` (~line 214) AND
  `failure()` (~line 185) — both paths, per this module's own rule.
- Review-bench success (`record.mjs`) and task-bench (`task-run.mjs`) store the envelope/outcome whole →
  automatic; confirm.
- `--note` (decision D): `bench/run.mjs` + `bench/review-sweep.mjs` parse a bounded `--note`;
  `sweep-ledger.mjs`'s `envelopeFor` header and the review-bench record's config block carry it.

### Phase 5 — tests (`tests/run-context.test.js` + additions)
- Unit: `serverConfigFrom` marks a knob `'requested'` iff the request carried it, `thinking` always
  `'server-default-unobserved'`, and stays correct when `sampling` gains `reasoningEffort` (post-215
  shape). `attachRunContext` OVERWRITES (a pre-existing foreign `error.contextWindow` is replaced, F5),
  and no-ops on a bare-primitive throw.
- **R1 explicit-model test (F1):** with a provider whose default model and an explicit `--model` have
  different windows, the recorded `contextWindow` is the explicit model's — not the default's. A mutation
  reverting to `effectiveWindow(profile, described)` must turn it red.
- **Failure-envelope crux, both flows:** `runReview` AND `runTask` with `--json` against a reasoning-only
  fake stream (empty content) → the ERROR envelope carries a non-null `contextWindow`. The `runTask` case
  is the one F2 was about; it fails under the pre-amendment (chatCompletion-wrap) design.
- Pre-resolution failure → `contextWindow: null` (distinct from "not captured").
- `errorReport` coercion (F8/F11), each fails closed: a non-finite, negative, or fractional `contextWindow`
  → `null`; an array, an extra-key object, and an object with the right keys but a custom prototype/`toJSON`
  as `serverConfig` → the reconstructed map with no foreign data; an unknown `contextSource` → `null`.
- **Task transport/watchdog envelope (F7/F10):** `runTask --json` against a fake server that drops the
  connection mid-stream → the error envelope carries a non-null `contextWindow` (proving the `executeTask`
  whole-body wrap, not the report-stage one).
- `detectedWindow: null` when detection agrees with config (F6).
- Sweep classifier: a `failure()`-path and a `reported()`-path entry both carry the fields.
- **`failedRun` direct test (F9):** call the exported `failedRun` with a synthetic failure whose `stdout`
  is a `--json` error envelope carrying the four fields, and assert the record carries them — this
  traverses `bench/run.mjs`'s own reducer, which neither the CLI-envelope nor `sweep-outcome.mjs` tests
  reach.

### Phase 6 — docs
`CLAUDE.md`: one present-tense line naming `run-context.mjs` (window+serverConfig capture, attach-after-
resolution, foreground scope) and the bench `--note`.

## Verification

Repo `verify` skill (`npm test`, real plugin load, delegation round trip); quote the green summary.
Live check permitted (owner granted LM Studio use): one `/oai:review --json` against a real model
confirming the envelope carries `contextWindow`/`contextSource`; corroboration, never the gate.

**Mutation checks (step 5), each proven with `~/Code/dotfiles/tests/mutation-landed.py`, control→fix→
fix-removed, restore proven by `diff`:**
1. **Failure-path capture (F9).** Remove `runContextFrom` from `failedRun` *specifically* (not the sweep
   path — the sweep two-path plumbing is proven separately by the sweep-classifier test). The direct
   `failedRun` test goes red — the motivating review-bench failure record.
2. **Explicit-model window (F1/R1).** Revert `resolveTarget` to `effectiveWindow(profile, described)`.
   The explicit-model test goes red.
3. **Task report-stage attach (F2).** Remove `taskFlow`'s `report`-catch attach. The `runTask`
   reasoning-only failure-envelope test goes red (the refusal is raised outside `executeTask`).
4. **Task transport attach (F7/F10).** Remove the `executeTask` whole-body wrap. The task
   transport/watchdog failure-envelope test goes red (the report-stage catch cannot see a throw from
   inside `executeTask`).

## Risks

- **R1 (F1, load-bearing): the recorded window must be the resolved model's.** Closed by passing
  `options.model` to `effectiveWindow` and confirming the two selections agree (Phase 1); pinned by the
  explicit-model test and mutation 2.
- **R2: `errorReport` persists to `jobs.db`.** The three envelope fields are not secret-shaped and are
  coerced (F5); the one operator-authored free-text field (`--note`) is kept off this path entirely
  (decision D).
- **R3 (F3): background/foreground record parity.** Explicitly scoped out (decision F) with the gap
  filed as residue, not left as an undocumented divergence.
