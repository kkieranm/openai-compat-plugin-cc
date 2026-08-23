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

## Tests (extend `tests/result.test.js`, using the existing `insertSynthetic` fixture)

- Outcome with no `content` key at all (`outcome: { model: 'x' }`) →
  `/oai:result` exits 1 with a message distinct from "recorded no answer"
  (asserts on the new "not a shape this build understands" wording), never a
  crash.
- Outcome with `content` present but `model`/`durationMs` absent → exits 0,
  prints the answer, footer contains `model: unknown` and omits the duration
  segment — never `NaN`/`undefined` in `result.stdout`.
- The existing "hollow" test (`content: '   '`) still matches `/recorded no
  answer/` — proves the two branches didn't collapse back into one.
- A completed job whose request DTO carries `contextChecked: false,
  contextNote: '<note>'` (synthetic `request` override) → `/oai:result`'s
  footer includes that note, matching what `/oai:task`'s foreground path
  would have shown for the same run.

## Verification

1. `npm test` — full suite green.
2. Mutation check on the key invariant: revert the `typeof outcome.content
   !== 'string'` guard back to the original `!outcome?.content?.trim()`
   check, confirm the new "absent content key" test fails (proves the test
   catches the collapse), then restore and re-run green.
3. Manual end-to-end: submit a real `--background` task against the fake/stub
   server, then hand-edit the row's `outcome` JSON (via the same
   `insertSynthetic`-style raw update used in tests) to drop `content`, and
   confirm `/oai:result` reports the new message rather than crashing or
   claiming "no answer".

## Step 9 residue

- Close OAI-59, OAI-71 (already an absorbed stub), and OAI-85 — the last as
  "duplicate of OAI-71, same root cause, closed by the same fix" rather than
  filing new residue.
- Codex's non-string-`content` edge case is fixed inline as part of this
  change (already reflected in the `writeAnswer` guard above), not deferred.
