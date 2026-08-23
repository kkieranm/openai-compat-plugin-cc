ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug idempotent-mapping-map

# OAI-59 (absorbs OAI-71, and folds in OAI-85 — same defect, filed twice)

## Context

`/oai:result` renders a background job's persisted `outcome` payload with no
defense against a shape it does not recognize. Filed 2026-08-05, raised to
non-cosmetic during the OAI-58 ladder: on the same code path, a newer build
that renamed the `content` field is reported as **"recorded no answer"** — a
false statement about a job that produced one, the same `findings: null` vs
`[]` class of defect this repo has hit before (ADR 003's territory). Absent
fields also render literally: `NaNs` for a missing `durationMs`, `model:
undefined` for a missing `model`.

OAI-71 (a separate, smaller filing, explicitly absorbed into this item at
filing time) is the same decision wearing a smaller hat: the "context window
unknown" note is computed at submission but never persisted, so `/oai:result`
hardcodes `contextNote: null` and silently drops a caveat the foreground path
shows for the exact same run.

**New in this probe:** OAI-85, filed the same day by a different review pass,
turns out to describe the identical gap (`cmd-result.mjs` hardcoding
`contextNote: null`, same file, same line, same root cause — the background
path never persists `budget`) — an undetected duplicate of OAI-71. Fixing
OAI-71's persistence closes OAI-85 too; both get closed at step 9 with a note
explaining the duplicate.

Root cause for the whole item: `outcome` is a JSON blob column
(`job-record.mjs`'s `JSON_COLUMNS`) explicitly NOT covered by
`isKnownVersion()`'s `schema_version` gate — confirmed by Codex against
`job-store.mjs`'s own comment, which scopes that gate to three other files
(`job-abandon.mjs`, `job-reconcile.mjs`, `job-queue.mjs`), never to a payload
shape check. So a row can be a fully "known version" while its `outcome`'s
internal fields are something this build has never seen. `cmd-result.mjs` must
defend on the payload's own shape, not on the version gate.

Probe: 4 load-bearing claims checked independently by Codex against the cited
files (`cmd-result.mjs`, `render.mjs`, `job-request.mjs`, `task-execute.mjs`,
`job-record.mjs`, `job-store.mjs`) — all TRUE. Codex additionally flagged an
edge case worth folding in: a present-but-non-string `content` would throw a
`TypeError` on `.trim()` rather than being caught by the current `!outcome
?.content?.trim()` check.

No genuine product fork here — grill skipped. Placement of the fix (request
DTO vs. worker recompute for the context note; guard inside the shared
`render.mjs` builder vs. at each call site; no `ROW_SCHEMA_VERSION` bump) is
settled by existing codebase convention, not preference:
- `render.mjs`'s `timingParts` already guards `prefillMs` with
  `Number.isFinite` *inside the shared builder*, not at each of its two call
  sites — extending that same guard to `durationMs` follows the existing
  pattern rather than inventing a new one.
- `budget` is already computed once, at submission, by `prepareTask`
  (`task-execute.mjs`) — the request DTO already carries other
  submission-time-only facts (`template`, `estimatedTokens`), so the context
  note joins them there rather than being recomputed by the worker (which
  would duplicate `checkContextBudget` and could disagree with what the
  operator was told at submission).
- Past `ROW_SCHEMA_VERSION` bumps (2, 3) were both for `transport`/`auth`
  shape changes that gate real mutation/queue decisions. `outcome` is
  documented elsewhere in this repo as the one payload deliberately *not*
  covered by that gate — a version bump here would be inventing a new
  precedent this change doesn't need; a defensive reader does the job.

## Fix

### 1. `scripts/lib/cmd-result.mjs` — `writeAnswer`

Split "no answer" from "shape I don't understand" into two distinct checks,
in this order:

```js
function writeAnswer(job) {
  const outcome = job.outcome;
  if (!outcome || typeof outcome !== 'object' || typeof outcome.content !== 'string') {
    throw new UserError(
      `Job ${job.id} completed, but its recorded outcome is not a shape this build understands.`,
      { hint: `A newer plugin build likely wrote it. Its log is at ${logPathFor(job.seq)}.` },
    );
  }
  if (!outcome.content.trim()) {
    throw new UserError(`Job ${job.id} completed but recorded no answer.`, { hint: `Its log is at ${logPathFor(job.seq)}.` });
  }
  ...
```

`typeof outcome.content !== 'string'` catches both "the key is entirely
absent" (`undefined`, the renamed-field case this item is about) and a
non-string value (Codex's edge case), before `.trim()` is ever called on it.
The existing "present but blank" case (`content: '   '`) is unchanged —
`tests/result.test.js`'s `insertSynthetic` fixture for that case still hits
the second branch with the same message.

### 2. `scripts/lib/render.mjs` — defend the footer generally

Any *other* field can be missing even when `content` survives (a future build
could rename `model` or drop `durationMs` while keeping `content` stable), so
the shared footer builder gets the same defense `prefillMs` already has:

```js
function timingParts(durationMs, prefillMs) {
  const parts = [];
  if (Number.isFinite(durationMs)) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  if (Number.isFinite(prefillMs)) parts.push(`prefill: ${(prefillMs / 1000).toFixed(1)}s`);
  return parts;
}
```

Omits the segment rather than fabricating a number — the same
omit-don't-invent rule the file already states for `prefillMs`. On every
existing (foreground and normal background) call site `durationMs` is always
a real finite number, so this is behavior-preserving there; it only changes
what was previously "NaNs" on an unrecognized payload.

`modelPart` gets the same treatment for the one case it doesn't already
handle — a wholly absent field, not the existing (accepted, out of scope)
`null` case a server that omits `model` in its response can legitimately
produce today:

```js
function modelPart(model, requestedModel) {
  if (model === undefined) return 'model: unknown';
  const swap = substitution(requestedModel, model);
  return swap ? `model: ${swap.served} (requested ${swap.requested})` : `model: ${model}`;
}
```

### 3. Persist the context note (OAI-71 / OAI-85)

`scripts/lib/job-request.mjs` `persistRequest` — add `budget` to the
destructured params and always persist both fields (unconditionally, not
behind `withoutUndefined`, since `checked` is a plain boolean and `note` is
only ever needed opposite it):

```js
export function persistRequest({ profile, numeric, messages, template, estimatedTokens, budget }) {
  const { maxTokens, temperature, timeoutSeconds, maxSeconds, maxAttempts } = numeric;
  return {
    messages,
    ...(template ? { template, estimatedTokens } : {}),
    contextChecked: budget.checked,
    contextNote: budget.checked ? null : budget.note,
    ...withoutUndefined({ ... unchanged ... }),
  };
}
```

No call-site change needed: `task-submit.mjs` already calls
`persistRequest(prep)`, and `prep` (from `task-execute.mjs`'s `prepareTask`)
already carries `.budget` — it is simply not read today.

`scripts/lib/cmd-result.mjs` — replace the hardcoded `contextNote: null` with:

```js
contextNote: job.request?.contextNote ?? null,
```

Reads as `null` both when the run was checked (stored `null`) and when
`job.request` predates this change or lacks the field entirely (`undefined`
→ `?? null`) — a pre-existing row degrades to exactly today's behavior, never
throws.

## Files touched

- `scripts/lib/cmd-result.mjs` — `writeAnswer`'s shape check, `contextNote` wiring
- `scripts/lib/render.mjs` — `timingParts`, `modelPart`
- `scripts/lib/job-request.mjs` — `persistRequest`

## Amendment (widening, review-ladder pass 3, plan-amending finding)

**Status: the above sections 1–3 already shipped and are committed to the working
tree, mutation-proven, 1150/1150 green.** Three consecutive review-ladder
passes on that implementation then each found MORE unguarded fields on the
same `job.outcome`/`job.request`/`job.transport` JSON blobs, reaching the
identical hazard (a hostile non-primitive value throwing `TypeError` on
interpolation or coercion, sometimes *after* partial stdout was already
written) through a different call path each round:

- Pass 2 (two independent Codex reviewers): `outcome.artifact` — unvalidated,
  crashes `task-artifact.mjs`'s `artifactNote()`; and `job.request.contextNote`
  itself — the very field section 3 above persists, crashes `render.mjs`'s
  `lines.join('\n')`. Both fixed and mutation-proven.
- Pass 3 (reviewing pass 2's own fixes): `job.transport?.name` — unvalidated,
  crashes `render.mjs`'s `` `provider: ${providerName}` `` interpolation; and
  `isOptionalArtifact` not excluding arrays (silently prints the literal
  string `"undefined"`). Both fixed and mutation-proven. Reviewing *that* fix
  surfaced two more: `job.request.template` (a hostile non-string value
  throws inside `Object.hasOwn(TEMPLATES, name)`'s `ToPropertyKey` coercion)
  and `job.request.estimatedTokens` (throws via `>`'s `ToPrimitive` coercion
  against `template.softCeilingTokens`) — both reachable from
  `task-template.mjs`'s `templateNotes`, called from `cmd-result.mjs` *after*
  the answer, footer, and artifact note have already been written to stdout.
  Plus: `isOptionalArtifact` still doesn't validate `.state` is one of the
  four values `artifactNote` actually recognizes — a plain object like `{}`
  passes and still prints the literal `"undefined"`.

Codex (consulted directly on whether this recurrence is plan-amending per
`/feature`'s "a supporting mechanism absent from the approved plan" rule):
confirmed yes, and named the fix — the field-by-field `isOptionalString`
pattern is no longer the adequate response; codex-adversarial had already
named this same fix during pass 2 ("a boundary validator covering every
persisted field consumed by rendering, followed by composing the complete
output before any write, would address both cases more robustly than
incremental interpolation guards") and it was correctly not acted on then
without a plan amendment. This section is that amendment. Classified as a
**widening** — moving from "guard the fields section 1 named plus the newly
persisted `contextNote`" to "validate every render-consumed field of
`job.outcome`, `job.request`, and `job.transport`" — authorized under this
session's standing instruction to resolve exactly this class of decision via
Codex rather than the user, since the user is not present this session and
pre-authorized that routing.

### Design: validate-then-compose-then-write

`writeAnswer` splits into two phases, in this order, so that even a field
this validator turns out to have missed still cannot leak partial output —
composition happens entirely before the single `stdout.write`:

**1. `validateOutcomeShape(job)`** — one function, called first, throws the
existing `UserError` ("not a shape this build understands") if any
render-consumed field is foreign-shaped. Covers, by name:

- `outcome.content` — required string (unchanged from section 1).
- `outcome.model`, `outcome.requestedModel`, `outcome.finishReason` —
  `isOptionalString` (unchanged from section 1/2).
- `outcome.artifact` — `undefined`/`null` (absence — `artifactFor` returns
  `null` for every non-`diff` template, the ordinary case) or an object,
  never an array, whose `.state` is one of `['applies', 'rejected',
  'unavailable', 'absent']` (the four values `artifactNote` actually
  branches on) — **and, found in plan-gate round 1 (Codex,
  `CHANGES-REQUIRED`): `.detail` validation must be STATE-DEPENDENT, not
  uniformly `isOptionalString`.** `artifactNote` (`task-artifact.mjs:83-88`)
  unconditionally interpolates `detail` in its `rejected`, `unavailable`,
  and default (`absent`) branches — an `undefined`/`null` detail there would
  print the literal string `"undefined"`/`"null"`, not crash, but the same
  failure class the array-exclusion fix already closed elsewhere. Only the
  `applies` branch never reads `detail` at all. So: `state === 'applies'`
  admits any `detail` (unused); every other valid state requires `typeof
  value.detail === 'string'` — a real string, not merely "optional".
- `job.request.contextNote` — `isOptionalString`.
- `job.request.template` — `isOptionalString`. (An unrecognized-but-string
  name is not an error — `templateNotes`'s own `UNKNOWN_TEMPLATE_DISCIPLINE`
  branch already handles that gracefully; only a non-string throws.)
- `job.request.estimatedTokens` — a new `isOptionalNumber` helper
  (`undefined`/`null`/`typeof value === 'number'`): legitimate values here
  are always numbers, so `isOptionalString` is the wrong shape for this
  field — the earlier omission wasn't just a missing field, it would have
  been the wrong check even if added ad hoc.
- `job.transport?.name` — `isOptionalString` at the validator (a hostile
  object is still refused). **Also found in plan-gate round 1: validation
  alone is not enough here.** `isOptionalString` legitimately admits
  `undefined`/`null`, and `render.mjs`'s `renderTaskFooter` currently
  interpolates `providerName` directly (`` `provider: ${providerName}` ``,
  unlike `model`, which already has `modelPart`'s `undefined →
  'model: unknown'` treatment) — so a `transport` missing `.name` would pass
  the validator clean and then print the literal string `"provider:
  undefined"`. Fixed at the render side, not the validator: `render.mjs`
  gets a new `providerPart(providerName)` helper, symmetric with the
  existing `modelPart`, returning `'provider: unknown'` for
  `undefined`/`null` and `` `provider: ${providerName}` `` otherwise. Every
  real job submission always sets `transport.name` to a real profile-name
  string, so this is behavior-preserving for every currently-valid row —
  it only changes the previously-buggy literal-`"undefined"` output for a
  synthetic/hostile row missing that field.

**Deliberately excluded, unchanged behavior**: `outcome.usage.prompt_tokens`
/ `completion_tokens` and `outcome.durationMs` / `prefillMs` / `generationMs`.
These already have an established, deliberate *graceful-omit* design in
`render.mjs` (via `Number.isFinite`, from section 2 above and pass 1's
findings) — a hostile value there is silently dropped from the footer rather
than refusing the whole answer. No reviewer across any pass has challenged
that design; folding these into the hard-refuse validator would change
accepted behavior this amendment has no mandate to touch, so they stay as
they are.

**2. Compose, then one write.** `writeAnswer`'s body builds the exact same
string fragments in the exact same order the current code already writes
(`outcome.content.trim()`, then `` `${renderTaskFooter(...)}\n` ``, then
optionally `` `\n${artifactNote(...)}\n` ``, then `` `\n${note}\n` `` per
template note), concatenates them, and issues exactly one
`process.stdout.write(...)` call at the end — byte-for-byte identical output
to today for every currently-valid shape; the only behavior change is that a
still-unforeseen hostile field now fails *before* any byte reaches stdout,
rather than after the answer is already visible. `substitutionNotice`'s
`stderr` write is unaffected — stderr was never part of the partial-leak
hazard and stays where it is, before the stdout composition.

### Files touched (amendment)

- `scripts/lib/cmd-result.mjs` — `writeAnswer` restructured into
  `validateOutcomeShape` + compose + single write; `isOptionalArtifact` gets
  the state-enum check and state-dependent `detail` requirement; new
  `isOptionalNumber` helper. `validateOutcomeShape`'s field checks are
  **table-driven off one exported array** (each entry: a dotted field path
  off `job` plus its validator function), so the "what does the validator
  cover" list exists exactly once in the source.
- `scripts/lib/render.mjs` — new `providerPart` helper, symmetric with
  `modelPart`.

### Tests (amendment, extend `tests/result.test.js`)

- `job.request.template` hostile (non-string) → refused, zero stdout.
- `job.request.estimatedTokens` hostile (non-number, not `undefined`/`null`)
  → refused, zero stdout.
- `outcome.artifact` a plain object with no recognized `.state` (e.g. `{}`)
  → refused, zero stdout, never the literal string `"undefined"`.
- `outcome.artifact: { state: 'rejected' }` (a recognized state, `detail`
  entirely absent) → refused, zero stdout — proves the state-dependent
  `detail` requirement, distinct from the array/no-state cases above.
- `job.transport: { name: undefined }` via a synthetic row with `transport`
  missing `.name` entirely → still exits 0 (a missing name is not hostile,
  just absent) and the footer reads `provider: unknown`, never the literal
  string `"undefined"`.
- **Structural test, found underspecified in plan-gate round 1 (Codex):**
  NOT two independently hand-maintained lists compared against each other —
  Codex correctly pointed out that two lists drifting together would still
  pass. Instead: a single test iterates `validateOutcomeShape`'s own
  exported field-path table and asserts, for every entry, that a synthetic
  row whose ONLY defect is a hostile object at that exact path is refused
  with the "not a shape this build understands" message and zero stdout —
  proving the table's coverage empirically rather than comparing it against
  a second list of the same claims. A future field added to `writeAnswer`
  or `renderTaskFooter` without a matching table entry is not caught by
  this test (that would need real static analysis, out of scope here) —
  what it does guarantee is that every entry the table currently claims to
  cover is actually enforced, so the table itself cannot silently rot.
- All existing hostile-value tests from passes 1–3 continue to pass
  unmodified — this amendment must not change any already-established
  refusal or already-established graceful-omit behavior.

## Verification

1. `npm test` — full suite green, including every amendment test above.
2. Mutation check, run individually per guarded field (the established
   pattern from passes 1–3): back out `validateOutcomeShape`'s check for that
   field alone, confirm the corresponding test fails with the exact predicted
   symptom (an uncaught crash, not a clean refusal), restore, confirm green.
   Run for every field in the coverage list, not just the amendment's four
   new ones — proves the consolidated function didn't silently drop a
   pre-existing check during the restructure.
3. Byte-for-byte output check: for an ordinary valid completed job, diff
   `/oai:result`'s stdout before and after this amendment — must be
   identical, proving the compose-then-write restructure changed no accepted
   output.
4. Manual end-to-end, as originally specified in Verification item 3 above,
   unchanged.

## Step 9 residue

- Close OAI-59, OAI-71 (already an absorbed stub), and OAI-85 — the last as
  "duplicate of OAI-71, same root cause, closed by the same fix" rather than
  filing new residue.
- Codex's non-string-`content` edge case is fixed inline as part of this
  change (already reflected in the `writeAnswer` guard above), not deferred.
- File one BACKLOG item at close, summarizing the pattern found across
  passes 1–3 for the record: three consecutive review rounds each found a
  new unguarded field on the same job-record JSON blobs reaching the same
  interpolation hazard, resolved by consolidating into one boundary
  validator rather than continued field-by-field patching — evidence for
  future review-ladder runs on this repo that this failure class warrants a
  structural test rather than one-off guards, cited above under Tests.
