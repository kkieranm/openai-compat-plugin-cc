ARCHIVE — not the current spec; the live plan is the file beside it.
# OAI-221 — Surface an observed reasoning-state witness on records and reports

provenance: harness slug foamy-splashing-pascal

## Context

OAI-221 documented that a reasoning model's thinking channel is controlled by the chat template's
`enable_thinking` variable — unreachable over the OpenAI wire, set only in the server's per-model
`model.yaml`. It is the one variable that moved review *capability* across ~110 bench invocations,
yet every pre-2026-08-26 benchmark table was silently confounded by it: the model that "won" was the
only one with thinking off by accident, and nobody could tell from a record which side of the switch
a run ran on.

The witness already exists in every reply and is already stored raw — `usage.completion_tokens_details.reasoning_tokens`
rides in the `--json` envelope's `usage` and thus in every bench record — but **no source code reads,
derives, or surfaces it**. This change turns that buried number into a first-class, self-describing
field so a record self-labels its observed reasoning state and the confound cannot recur unseen.

Owner + Codex settled two forks (both recommendations agreed):
- **Placement**: a *separate* reply-observed field, kept distinct from `serverConfig` (which is the
  *request-provenance* axis, built at resolution time before any reply exists). Not a repurpose of
  `serverConfig.thinking`.
- **Semantics**: three states, and the raw count carried alongside for auditability. Never the word
  "off" — the witness reports only what the reply reported.

Scope A of the owner's "A then D": ship the witness, then park OAI-221 (step 9).

## Design

One pure leaf function is the single source of the derivation; every reader calls it. The stored
field lets an external `--json` consumer self-describe; internal readers (bench, text footer)
re-derive from the raw `usage` they already hold, so **old records with only `usage` render
correctly** and there is exactly one place the classification logic lives.

### 1. New leaf `scripts/lib/reasoning-witness.mjs`

Pure, imports nothing, never throws (same leaf discipline as `run-context.mjs`). One export:

```
reasoningWitness(usage) -> { state, tokens }
```

- Read `n = usage?.completion_tokens_details?.reasoning_tokens` **inside a `try/catch`** — the
  `catch` returns `{ state: 'unknown', tokens: null }`. This is load-bearing and the typeof guard is
  not a substitute for it: optional chaining does NOT suppress a **throwing getter or proxy trap** on
  `completion_tokens_details`/`reasoning_tokens` — that throws at the property *read*, before any
  coercion guard runs (a Codex + Claude plan-gate finding on round 1; both reviewers flagged that the
  original "typeof-guard makes it never-throw" rationale was wrong). In practice `usage` comes from
  `JSON.parse` (plain data objects, no getters), so this is defensive — but the never-throw contract
  is a real guarantee callers on the persistence path rely on, and the hostile-getter test below pins
  it, so the read must be wrapped, not just the coercion.
- `tokens`: `n` when `typeof n === 'number' && Number.isFinite(n)`, else `null`. The `typeof` guard
  (like `findings-yaml.mjs`'s `normalizeFinding`) covers a hostile `valueOf`/`toString` during
  coercion; the `try/catch` above covers a throwing getter during the read. Both are needed.
- `state` (a fresh string constant, three values):
  - `Number.isFinite(n) && n > 0` → `'reasoning-observed'`
  - `Number.isFinite(n) && n === 0` → `'no-reasoning-observed'` (provider counted, got zero — **not**
    "off": may mean thinking off, unavailable, or a provider that reports zero unreliably)
  - otherwise (absent / non-number / `usage` null-ish) → `'unknown'`
- Returns a freshly-built object, so its output is safe to persist into `jobs.db` without a
  reconstruction pass — it is derived from a number, never a pass-through of a foreign object (the
  hazard `reconstructServerConfig` exists to stop). Negative `n` (never seen, but guard it) is not
  `>0` and not `===0` → falls to `unknown`, the honest reading of a nonsensical count.

### 2. `--json` envelopes carry `reasoning`

- `scripts/lib/review-report.mjs` `jsonReport`: add `reasoning: reasoningWitness(result.usage)`
  immediately beside `usage: result.usage ?? null`.
- `scripts/lib/review-report.mjs` `errorReport`: add `reasoning: reasoningWitness(error?.usage)`.
  A failed run carries no usage → always `{ state: 'unknown', tokens: null }`. Included on the failure
  path for **success/failure envelope shape parity** (the file's own `jsonReport`/`errorReport`
  side-by-side doctrine: a fact present in one must not be absent in the other). Self-constructed, so
  it is fail-closed for the `jobs.db` persistence this function feeds — no `reconstruct*` needed, and
  no secret-shaped server value can reach it (it reads only a number off `usage`).
- `scripts/lib/task-report.mjs` `jsonTaskReport`: same field beside `usage` (the task *success*
  envelope; task success carries `result.usage`).
- **Task failures need no separate edit** (round-1 finding, both reviewers). There is no task
  failure-envelope analogue: the task `--json` failure path reuses the *shared* review `errorReport`
  (`cmd-task.mjs:63`, `cmd-task-worker.mjs:154`), so the single `errorReport` edit above already lands
  `reasoning` on both the review and task failure paths. `errorReport` is also called elsewhere with
  synthetic `{ reason, message, hint }` errors (`job-queue.mjs`, `job-reconcile.mjs`,
  `job-abandon.mjs`, `job-launch-outcome.mjs`) — none carry `usage`, so all yield `unknown`,
  consistently. One shared function, so there is no double-add and no gap.

### 3. Bench report gains a `reasoning` column

Mirror the existing `lens` column exactly (distinct labels across a case's runs, first-seen order,
`measurable` runs only — a substituted/failed run's reply is not this case's).

- `bench/lib/case-rows.mjs`: add `reasoningSamples(runs)` beside `lensSamples`:
  `[...new Set(measurable(runs).map((run) => reasoningWitness(run.report.usage).state))]`.
  **Derive from `run.report.usage`, not `run.report.reasoning`** — so records written before this
  change (which have `usage` but no `reasoning`) aggregate correctly, and the derivation has one home.
  Add `reasoning: reasoningSamples(runs)` to the `caseRows` row object.
- `bench/lib/report.mjs`: add `reasoningCell(states)` (mirror `lensCell`: `states.join(' / ')` or `—`
  when empty), a `reasoning` header cell and a row cell, placed beside `lens` / `prompt tokens` (the
  reasoning state is why a generation time collapsed, the same "read the pair together" logic that
  put `lens` beside prompt tokens).

### 4. Interactive text footer (`scripts/lib/render.mjs`)

The footer already renders `usage.completion_tokens`/`prompt_tokens` (lines ~201–202). Add a compact
witness beside it, derived inline via `reasoningWitness(usage)` (e.g. `reasoning: reasoning-observed
(5998)` / `no-reasoning-observed` / omit when `unknown`). Derived from `usage` at render, so **no new
persisted field is consumed** and `cmd-result`'s `validateOutcomeShape` / `RENDER_CONSUMED_FIELDS`
table is untouched. Omitting on `unknown` keeps the line quiet where there is nothing to say.

## Files

| File | Change |
|---|---|
| `scripts/lib/reasoning-witness.mjs` | **new** — the pure `reasoningWitness(usage)` leaf |
| `scripts/lib/review-report.mjs` | `reasoning` on `jsonReport` + `errorReport` |
| `scripts/lib/task-report.mjs` | `reasoning` on `jsonTaskReport` (success); task failures covered by the shared `errorReport` edit |
| `scripts/lib/render.mjs` | footer witness line (derived from `usage`) |
| `bench/lib/case-rows.mjs` | `reasoningSamples` + row field |
| `bench/lib/report.mjs` | `reasoningCell` + header/row column |
| `tests/reasoning-witness.test.js` | **new** — unit table for the classifier |
| existing envelope + bench-report tests | add `reasoning` assertions |
| `CLAUDE.md` | one-line architecture note (step 6) |

## Tests

- **`tests/reasoning-witness.test.js`** (new): `>0 → reasoning-observed` with count; `===0 →
  no-reasoning-observed` count 0; absent `completion_tokens_details` → unknown/null; `reasoning_tokens`
  non-number (string, NaN) → unknown/null; `usage` `null`/`undefined` → unknown/null; hostile object
  (`reasoning_tokens` a throwing getter) → unknown, does not throw; negative → unknown.
- **Envelope tests**: extend the existing review/task envelope field tests to assert `reasoning` on
  success (observed, with count) and on the failure envelope (unknown). Confirm the failure envelope's
  field-list closure test (OAI-185 posture) still passes with the added self-constructed field.
- **Bench report/case-rows**: `reasoningSamples` yields distinct states; a record carrying only
  `report.usage` (no `report.reasoning`) still renders a correct cell (backward-compat); the column
  appears in the rendered table header + row and reads `—` when no run was measurable.

## Verification (step 5)

- `npm test` (needs `zsh` on PATH) — quote the green summary line.
- **Mutation**: in `reasoning-witness.mjs` flip `n > 0` to `n >= 0` (would misclassify an explicit
  zero as `reasoning-observed`). Prove it landed with `mutation-landed.py`, run the suite, name the
  reasoning-witness test that fails, restore, re-run green, diff against the backup. This is the key
  invariant: the three-state boundary, specifically that `0` is not `observed`.
- Real end-to-end via the `verify` skill; a bench record is not required for the unit+envelope proof,
  but if LM Studio is up, one `/oai:review --json` shows the live `reasoning` field.

## Out of scope (stated)

- `serverConfig.thinking` stays as-is (request-provenance placeholder) — the witness is deliberately a
  separate axis.
- The `bench/task-run.mjs` template report gets no column — the OAI-221 confound is the *review*
  benchmark; adding it there is unwarranted surface.
- No back-fill of existing records; the field is additive and old records derive from `usage` at read.

## After ship (step 9)

Park OAI-221 to `BACKLOG_PARKED.md` with a reopening bar: *reopens if the observed witness proves
insufficient (a provider whose `reasoning_tokens` is unreliable such that `no-reasoning-observed` /
`unknown` mislead), or if active pre-run verification of thinking state is shown to be needed.* Its
research residue (multi-model agreement, precision-of-the-MoE) already lives in OAI-9/OAI-11 and
`evidence/221.md`.
