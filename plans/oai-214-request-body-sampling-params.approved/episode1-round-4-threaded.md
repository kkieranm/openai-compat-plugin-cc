ARCHIVE — not the current spec; the live plan is the file beside it.
provenance: harness slug streamed-squishing-thunder

# OAI-214 — let the request body express vendor-recommended sampling/reasoning params

## Context

The chat-completions request body this plugin sends is a closed field set — `client.mjs`
`chatCompletion` (client.mjs:44-47) builds `{ model, messages, stream, stream_options }` plus optional
`temperature`, `max_tokens`, `response_format`, and **nothing else**. There is no route to
`reasoning_effort`, `top_p`, `top_k`, `min_p`, or `presence_penalty`, nor to a chat template's own
variables.

**Dated instance (OAI-214, 2026-08-25):** `qwen/qwen3.8-27b` scored 0 of 6 bench cases, every one lost
to a runaway that never wrote an answer, because the model ships with `reasoning_effort` defaulting to
`xhigh` (its most verbose setting) and the plugin had no way to send `low`. The parameter was reachable
all along — LM Studio honours it — the plugin simply could not put it on the wire. Vendor sampling
recommendations (qwen/gemma per-mode `temperature`/`top_p`/`top_k`/`min_p`) are unreachable by the same
gap.

**Intended outcome:** the five named params above become expressible per invocation, each as its own
named body field, so a benchmark (or an everyday review/task) can run a model at the settings its vendor
recommends. **Explicitly not a generic body-merge passthrough** — the admission boundary must make it
impossible for a caller to overwrite `messages` or `stream`, which the transport's contracts depend on.

Probe verified (Codex, 4/4 claims TRUE; one wording correction — the DTO field is camelCase `maxTokens`,
not wire `max_tokens`): the body field set is closed; `temperature` flows flag → `parseNumericOptions`
→ `reviewPlan`/`taskRequest` → `send`/`request` → `chatCompletion` named body field with no transform;
the `--background` DTO persists and reconstructs `temperature`/`maxTokens` as siblings of `messages` via
`withoutUndefined`; and `send` is spread into `attemptSalvage`'s follow-up call, so anything on `send`
reaches salvage requests too.

## Decisions already settled (grill, with Codex's steer — both agreed on every fork)

1. **Admitted set = the OAI-214 named five:** `reasoning_effort`, `top_p`, `top_k`, `min_p`,
   `presence_penalty`. Not `frequency_penalty` (no dated instance). Each justified by the item.
2. **`reasoning_effort` validation is shape-only** — a non-empty, whitespace-free token, then let the
   server refuse an unknown value. A client-side allowlist would re-create OAI-214's own defect: refusing
   a vendor value the server honours (`xhigh` is already outside OpenAI's `low`/`medium`/`high` set, and
   this repo cannot verify any vendor's full value set). `resolveTemplate` closes a *repo-owned*
   namespace; `reasoning_effort` values are *server-owned*, so only transport-safe shape validation is
   authoritative here.
3. **Flags only for v1.** No `providers.json` sampling defaults in this feature (deferred to its own
   backlog item — vendor recs key on the *model*, not the provider, and one profile serves many models,
   so a per-model config map balloons the item). No chat-template variable passthrough (no dated
   instance; an arbitrary KV passthrough reopens the exact injection surface the item bans).
4. **Echo the normalized sent sampling params in the `--json` envelope** (both `/oai:review` and
   `/oai:task`), making the request-side half of OAI-217 recordable — server-side configuration capture
   stays OAI-217's, not absorbed here.

## Design decisions this plan makes (not previously grilled — flagged for the gate)

**A. One registry, not five inline fields.** The five params each span parse, body-build, DTO-persist,
DTO-reconstruct, and two flag specs. Threaded inline like `temperature`, that is ~5 sites × 5 params of
hand-mirrored edits, and the persist/reconstruct pair is exactly where one end gets dropped silently
(the "reported state differs from what happens" defect class both approvers flagged). Instead: a new
`scripts/lib/sampling.mjs` holds a single `SAMPLING_PARAMS` table — one row per param carrying its flag
name, its option key, its wire field, and its validator — and every site consumes the table. This is the
repo's own "generate, don't mirror" / single-authority posture (`model-selection.mjs` is described as
"the single authority"; the `buildProfile` whitelist comment warns a field added in one place and
forgotten in another "validates and then does nothing").

**A′. `parseNumber` moves to a leaf module first, to break a real import cycle.** `client.mjs` must
import `applySampling` from `sampling.mjs` (it owns the body build), and `sampling.mjs`'s validators
reuse `parseNumber` — which lives in `delegate.mjs`, and `delegate.mjs:3` imports from `client.mjs`. That
closes `client.mjs → sampling.mjs → delegate.mjs → client.mjs` (verified on disk: the back-edge is
`delegate.mjs:3`). So **Phase 1's first step is to extract `parseNumber` into a new leaf module
`scripts/lib/parse-number.mjs`** (its only dependency is `UserError` from `errors.mjs`, itself a leaf),
and import it into both `delegate.mjs` (replacing the local definition) and `sampling.mjs`. Then the
graph is `client.mjs → sampling.mjs → parse-number.mjs` (leaf) with no back-edge. This is the primary
plan, not a contingency.

**B. Thread ONE `sampling` object, not five fields.** `parseSampling(options)` returns a camelCase map
of only the params that were set (undefined ones omitted). That one object rides the existing path as a
single `sampling` field on `send`/`request` → `chatCompletion`, and `applySampling(body, sampling)` sets
`body[wire]` for each present param. The DTO persists/reconstructs the one `sampling` object. So the
threading and the drift surface both collapse to a single field per site.

**C. `client.mjs` stays the closed admission boundary.** `applySampling` iterates `SAMPLING_PARAMS`
only — it can set exactly the five wire fields and nothing else, so `messages`/`stream`/`stream_options`
are structurally unreachable from caller-supplied sampling. This is what satisfies the item's
"not a generic passthrough" ban, and it is enforced by a structural test, not by prose.

**D. `temperature`/`max_tokens` are left exactly where they are** — not folded into the registry. They
predate this, are separately validated (`temperature` 0–2) and tested, and the enforcement boundary
(named-field body build in `client.mjs`) stays closed whether or not they live in the table. Folding
them in would void existing tests for no correctness gain and widen the blast radius. The registry is the
home for *future* additions; migrating temperature is explicitly out of scope.

**E. `sampling` on `send` reaches salvage follow-ups, and that is correct.** Unlike
`reasoningReserveTokens` (deliberately kept off `send`), a user's chosen sampling settings *should* apply
to the salvage follow-up too — it is the same logical request. Stated as a decision so review does not
read it as unconsidered. (The `attemptSalvage` call overrides `messages`/`maxTokens`/`maxMs`/`expiresAt`/
`maxAttempts` after the `...send` spread, so those are unaffected; `sampling` simply passes through.)

**F. DTO migration = additive optional field, no `schema_version` bump.** `sampling` joins the
`withoutUndefined` DTO exactly as `temperature`/`maxTokens`/`maxAttempts` did (all added incrementally,
none with a bump). An older build reading a newer queued row drops the unknown `sampling` field and sends
a valid *unsampled* request; the downgrade-mid-queued-job window is negligible and a job is near-always
run by the build that submitted it. This is the established DTO convention, not a new posture.

## Files this plan touches

New: `scripts/lib/parse-number.mjs` (leaf, extracted), `scripts/lib/sampling.mjs`,
`tests/sampling.test.js`.
Edited: `scripts/lib/delegate.mjs` (import `parseNumber` from the leaf),
`scripts/lib/client.mjs` (`applySampling` in the body build),
`scripts/lib/cmd-review.mjs` (`REVIEW_SPEC`, `runReview` parses `sampling` early + its catch attaches
`error.sampling`, `reviewPlan`/`report` context),
`scripts/lib/review-request.mjs` (`requestFindings` destructure + `send`),
`scripts/lib/cmd-task.mjs` (`TASK_SPEC`, `runTask` parses `sampling` early + its catch attaches
`error.sampling`, passes it into `taskFlow`),
`scripts/lib/task-execute.mjs` (`prepareTask`/`executeTask` receive `sampling` as a param; thread it
into `taskRequest`, the DTO `prep`, and the outcome),
`scripts/lib/job-request.mjs` (persist + reconstruct),
`scripts/lib/review-report.mjs` (`jsonReport` + `errorReport` echo) +
`scripts/lib/task-report.mjs` (`jsonTaskReport` echo),
`commands/review.md` + `commands/task.md` (flag docs — `tests/plugin.test.js` enforces),
`CLAUDE.md` (Phase 6 note).
Read to confirm no change needed: `scripts/lib/cmd-task-worker.mjs` (background worker call site —
consumes `reconstructRequest`'s output, so a new DTO field flows through untouched; its
`publishFailure` path is why background failures show `sampling: null`),
`scripts/lib/cmd-result.mjs` (`RENDER_CONSUMED_FIELDS` surfaces no request knob, so `/oai:result` is
unchanged), `scripts/lib/task-submit.mjs` (verified: `buildJob(prep)` forwards whole prep),
`scripts/lib/args.mjs`.

## Implementation

### Phase 1 — extract `parseNumber`, then the sampling registry

**First**, move `parseNumber` (delegate.mjs:15-28) into a new leaf module
`scripts/lib/parse-number.mjs` (imports only `UserError`). Replace `delegate.mjs`'s definition with an
import from it (delegate.mjs keeps re-exporting `parseNumber` only if an existing importer relies on
that path — grep first; otherwise a plain import). This is what lets `sampling.mjs` reuse the validator
without recreating the `client.mjs → sampling.mjs → delegate.mjs → client.mjs` cycle (see decision A′).

**Then** create `scripts/lib/sampling.mjs`. Export:

- `SAMPLING_PARAMS` — an array, one entry per param:
  `{ flag, key, wire, validate }` where `flag` is the CLI flag name (`reasoning-effort`, `top-p`,
  `top-k`, `min-p`, `presence-penalty`), `key` is the camelCase option field
  (`reasoningEffort`, `topP`, `topK`, `minP`, `presencePenalty`), `wire` is the OpenAI body field
  (`reasoning_effort`, `top_p`, `top_k`, `min_p`, `presence_penalty`), and `validate(raw)` returns the
  coerced value or throws a `UserError`. Validators:
  - `reasoning-effort`: shape-only, stated unambiguously — **trim surrounding whitespace; reject if the
    trimmed result is empty OR contains any internal whitespace; return the trimmed value** (no
    case-folding, no allowlist). So `" low "` → `"low"`; `""`/`"  "` → reject; `"a b"` → reject.
  - `top-p`, `min-p`: `parseNumber(raw, flag, { min: 0, max: 1 })` (reuse the extracted `parseNumber`).
  - `top-k`: `parseNumber(raw, flag, { integer: true, min: 1 })`.
  - `presence-penalty`: `parseNumber(raw, flag, { min: -2, max: 2 })`.
- `SAMPLING_FLAGS` — `SAMPLING_PARAMS.map(p => p.flag)`, spread into both command SPECs so the flag list
  is derived from the table, not hand-mirrored.
- `parseSampling(options)` — for each param whose `options[flag]` is defined, run its validator; collect
  results under `key`. Return the object, or `undefined` when none were set (so `withoutUndefined` and
  the `!== undefined` body guard both behave). **Called at the same early point `parseNumericOptions`
  is** — before any network work (see Phase 2 for the exact call sites), so a bad `--top-p 1.5` fails in
  milliseconds rather than after a wasted `/v1/models` probe.
- `applySampling(body, sampling)` — for each param, if `sampling?.[key] !== undefined`, set
  `body[wire] = sampling[key]`. Iterates `SAMPLING_PARAMS` only; cannot touch any non-listed body key.
  This is the closed admission boundary decision C names.

### Phase 2 — parse at the command entry, thread through both commands

**`sampling` is parsed once at the command entry (`runReview`/`runTask`), held in a variable in the
outer catch's scope, and threaded down as a value** — not parsed deeper in the flow. This placement is
load-bearing: it is the only scope that both runs before any network work (fail-fast) AND is visible to
the one catch every foreground failure funnels through (Phase 4's failure echo). Parsing it deeper —
inside `reviewFlow`/`prepareTask` — would leave it invisible to the command catch, which is the
round-3 gap.

- `cmd-review.mjs`: `REVIEW_SPEC.valueFlags` gains `...SAMPLING_FLAGS`. In `runReview`, declare
  `let sampling;` before the `try`, and **inside the try, before `reviewFlow`, assign
  `sampling = parseSampling(options)`** (so a bad `--top-p 1.5` is refused under `--json` like any other
  parse error, and before `collectTarget`/`resolveTarget` do any I/O). Pass `sampling` into `reviewFlow`
  → `reviewPlan` (as `plan.sampling`) and into the `report(...)` context (as `context.sampling`).
  `requestFindings` (review-request.mjs) destructures `plan.sampling` and adds `sampling` to the `send`
  object built at review-request.mjs:661.
- `cmd-task.mjs`: `TASK_SPEC.valueFlags` gains `...SAMPLING_FLAGS` (`TAKES_VALUE` derives from
  `TASK_SPEC`, so `splitBlob`/`jsonIntent` pick the flags up for free). In `runTask`, declare
  `let sampling;` before the `try` and assign `sampling = parseSampling(options)` inside it, right after
  `parseCommandLine`, then pass `sampling` into `taskFlow`.
- `task-execute.mjs`: `prepareTask` and `executeTask` **receive `sampling` as a parameter** (threaded
  from `taskFlow`), never parse it themselves. `prepareTask` returns it on `prep` (for the Phase 3 DTO);
  `executeTask` passes it into `taskRequest` (which adds `sampling` to the request object) **and puts it
  on the returned outcome** (for Phase 4's success echo). Both the foreground `submitTask` (background)
  and `executeTask` (foreground) paths get the same parsed value.
- `client.mjs`: in `chatCompletion`, after the existing `temperature`/`max_tokens`/`response_format`
  lines, `applySampling(body, options.sampling)`. Read `sampling` from `options`, consistent with how the
  other optional fields are read. `body` is mutated in place before it is handed to `answerWithRetry`
  (client.mjs:69), and nothing after reassigns body keys, so no existing field is overwritten.

### Phase 3 — background persistence (`job-request.mjs`)

- `persistRequest`: add `sampling` into the `withoutUndefined({...})` block, beside
  `temperature`/`maxTokens`. `persistRequest`'s destructure gains `sampling` (from the `prep` object it
  is already handed).
- `reconstructRequest`: add `sampling: dto.sampling` into its own `withoutUndefined({...})` block.
- **The `task-submit` seam is verified, not merely assumed:** `buildJob` calls `persistRequest(prep)`
  with the WHOLE `prep` object (task-submit.mjs:107, :283), so once `prepareTask` returns `sampling` on
  `prep`, it forwards with no subset step to drop it — no `task-submit.mjs` change is needed. (This
  closes the one seam a direct-`persistRequest` unit test could not exercise; the Phase 5 round-trip test
  plus this verified forwarding cover the background path.)

### Phase 4 — `--json` envelope echo (success AND failure)

The settled contract (decision 4) is realized on **both** the success and the failure envelope, because
OAI-217's motivating case is a *failure* (the qwen3.8 runaway that scored 0/6) — the run whose settings
most need recording is the one that died. **Exact scope, stated so it is a decision not a gap:**

- **Success — `review-report.mjs` `jsonReport`:** add `sampling: context.sampling ?? null` (a fact about
  what WE sent, same diagnostic class as `requestedModel`/`estimatedTokens`). `cmd-review.mjs`'s
  `report(...)` call passes `sampling: plan.sampling` in the context.
- **Success — `task-report.mjs` `jsonTaskReport`:** add `sampling: outcome.sampling ?? null`;
  `executeTask` already returns `sampling` on the outcome (Phase 2).
- **Failure — `review-report.mjs` `errorReport`:** add `sampling: error?.sampling ?? null`. `errorReport`
  is an explicit field list (not a spread) because it is persisted to `jobs.db`; `sampling` is
  user-typed, validated values — not server-controlled and not secret-shaped — so it is safe to add to
  that list. **The attachment is at the command-level catch, because that is the ONE point every
  foreground failure funnels through — including the post-dispatch refusals that are OAI-214's whole
  point.** A reasoning-only / length / empty-answer runaway is thrown by `requireAnswer` (task) or the
  `unparsedReply`/report stage (review) *after* `chatCompletion` has already returned, so any catch
  wrapping only the model call (or only `requestFindings`, as `named()` does) would miss it and emit
  `sampling: null` on exactly the failure whose settings most need recording. Because `sampling` is
  parsed at the command entry (Phase 2) it is in scope in both outer catches:
  - **`runReview`** (cmd-review.mjs): in the `catch`, before `errorReport(error)`, set
    `if (sampling !== undefined) error.sampling ??= sampling`.
  - **`runTask`** (cmd-task.mjs): the same, in its `catch` before `errorReport(error)`.
  - `??=` so a site nearer the throw that already set a more specific value wins; `!== undefined` so a
    parse failure (sampling never assigned) attaches nothing, which is honest — there were no valid
    settings to record. `named()` is left as-is for `requestedModel`; sampling does not ride it.
- **Explicitly OUT of scope — narrowed on evidence, not the earlier unevidenced `/oai:result` claim.**
  The `--background` path does not echo sampling in `--json`, and two facts on disk establish this is
  *consistent with the existing design*, not a gap:
  1. `/oai:result`'s `RENDER_CONSUMED_FIELDS` (cmd-result.mjs:73-75) reads only
     `request.contextNote`/`request.template`/`request.estimatedTokens` off `job.request` — it surfaces
     **no request knob at all**, `temperature` and `maxTokens` included. So not surfacing `sampling`
     there is exactly how `temperature` is (not) surfaced — one consistent posture, not a special case.
  2. A background *failure* is persisted by the worker's `publishFailure → errorReport(error)`
     (cmd-task-worker.mjs:154). The worker's `error` carries no `error.sampling` (the `executeTask`
     wrapper above runs only on the foreground path; the worker calls `chatCompletion` directly via
     `reconstructRequest`), so a background failure envelope legitimately shows `sampling: null`.
  The DTO still persists `sampling` as an execution input (Phase 3), so the worker **sends** the right
  params — the functional requirement OAI-214 is actually about. Re-surfacing background sampling in
  `--json` (worker success outcome + worker failure envelope + a `/oai:result` field + a background test)
  is a distinct, larger piece of work squarely in **OAI-217's** territory (server/request-config capture
  on a record); it is **filed as residue** at step 9, not built here. The `--background --json`
  submission ack (`cmd-task.mjs:95`, `{id, background:true}`) likewise stays as-is — an id
  acknowledgement, not a run report.
- Human (non-JSON) output is unchanged — this is JSON-only, matching the posture of `salvageTrim`/
  `analysisCap`.

### Phase 5 — tests (`tests/sampling.test.js`, plus additions to existing suites)

- **Unit (`sampling.mjs`):** each validator accepts a good value and rejects a bad one
  (`reasoning-effort` rejects empty and `"a b"`, accepts `"low"` and `"xhigh"`; `top-p`/`min-p` reject
  `1.5` and `-0.1`; `top-k` rejects `0` and `2.5`; `presence-penalty` rejects `3`). `parseSampling`
  returns `undefined` when no flag is set and an object with only the set keys otherwise.
- **Closed-boundary structural test — must exercise a HOSTILE unlisted key, or it proves nothing.**
  Call `applySampling(body, { reasoningEffort: 'low', messages: 'HACK', stream: false, model: 'evil' })`
  against a `body` pre-seeded with real `messages`/`stream`/`model` values, and assert: `body.messages`,
  `body.stream` and `body.model` are **unchanged**, and only `body.reasoning_effort` was added. Passing
  just `{reasoningEffort:'low'}` proves the mapping but not the boundary — the hostile keys are what make
  mutation #2 (iterate `Object.keys(sampling)`) actually go red. Plus the static check: no
  `SAMPLING_PARAMS.wire` value equals any reserved body key
  (`model`/`messages`/`stream`/`stream_options`/`temperature`/`max_tokens`/`response_format`).
- **DTO round-trip:** `reconstructRequest(persistRequest({... sampling:{topP:0.8}}), ...)` yields
  `sampling.topP === 0.8`; and a request with no sampling flags persists no `sampling` key (absent, not
  `null`).
- **Failure-envelope echo, unit:** an `errorReport` built from an error carrying `sampling` includes it;
  one from a bare error yields `sampling: null` (the "cannot live on one path alone" rule this file
  follows for `requestedModel`/`partial`).
- **Failure-envelope echo, END-TO-END through `runTask` — required, because the unit test above only
  proves serialization, not that the attachment REACHES `errorReport`.** Drive `runTask` with `--json
  --reasoning-effort low` against the fake server (`tests/helpers.mjs` `runCompanion`) returning a
  clean stream with **empty content** (the reasoning-only/empty runaway shape), so `requireAnswer`
  throws *after* `chatCompletion` returns, and assert the `--json` error envelope carries
  `sampling.reasoningEffort === 'low'` — not `null`. This is the exact post-dispatch path Codex's
  round-3 finding named, and the one that fails if sampling is attached anywhere narrower than the
  command catch.
- **Flag-docs:** `tests/plugin.test.js` already cross-checks each SPEC flag against the command md;
  document the five flags in `commands/review.md` and `commands/task.md` so it stays green (this is the
  test that will go red first if a flag is added and undocumented).

### Phase 6 — docs

`CLAUDE.md`: one present-tense line naming `scripts/lib/sampling.mjs`'s `SAMPLING_PARAMS` as the single
registry of the admitted sampling params and `applySampling` as the closed body-admission boundary. The
rationale, the deferred config/template-vars scope, and the OAI-217 link go in the tracker item, not the
note.

## Verification

Run the repo `verify` skill (`.claude/skills/verify/SKILL.md`) — `npm test`, a real plugin load, and a
delegation round trip. Quote the green summary line.

**Mutation check (step 5), the key invariant — two, because two independent properties matter:**

1. **DTO round-trip completeness.** Drop `sampling` from `reconstructRequest`'s `withoutUndefined` block
   (so a persisted param is silently lost on the background path). The DTO round-trip test must go red.
   This targets the exact "one end dropped silently" hazard.
2. **Closed admission boundary.** Change `applySampling` to also copy an unlisted key (e.g. iterate
   `Object.keys(sampling)` instead of `SAMPLING_PARAMS`). The closed-boundary structural test must go red
   — which it can only do because that test supplies the hostile `messages`/`stream`/`model` keys and
   asserts they stay unchanged.

Each mutation separately: back up the file, prove the mutation landed with
`~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the failing test, restore, re-run green,
and prove the restore by `diff` against the backup — never by eye.

**Manual end-to-end (if LM Studio is up, else stated as not run):** `/oai:task --json --reasoning-effort
low "hi"` against a reasoning model, and confirm the `--json` envelope echoes
`sampling.reasoningEffort: "low"`. Network-free tests must stay the gate; this is corroboration.
