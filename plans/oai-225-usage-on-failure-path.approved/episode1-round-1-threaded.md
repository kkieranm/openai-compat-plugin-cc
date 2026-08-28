ARCHIVE — not the current spec; the live plan is the file beside it.
STATE: dual-approved-unattended

Owner's authorisation for this unattended run (2026-08-27), quoted verbatim:

> "i will leave you unattended. keep iterating on items using /feature . when you have an option
> that you would usually put to me, instead try to converge using codex and a fable agent. do not
> prompt for plans as i will not be here"
>
> "you also have my permission to use lm studio if you need it"

Later steer (2026-08-27), also governing:

> "unless youre doing tangible code changes - move on to issues that actually matter and are likely
> to encounter"

# OAI-225 — attach the reply's usage to the error so the failure-path reasoning witness is observable

## The defect (confirmed by reading the code, probed TRUE by Codex 2026-08-28)

OAI-221 (shipped `c0711d9`) added `reasoning: reasoningWitness(error?.usage)` to `errorReport`
(`scripts/lib/review-report.mjs:319`) so a failed run's envelope self-describes whether the model was
observed reasoning. But **no throw site sets `error.usage`**, so the field is *always*
`{ state: 'unknown', tokens: null }` — including on the failure mode it would most want to observe:
token-exhaustion, where the model spent its whole budget reasoning and a real `usage` carrying
`reasoning_tokens` was in scope at the throw. The witness is inert exactly where it is most wanted.

Codex probe (2026-08-28), all TRUE:
1. `errorReport` reads `reasoningWitness(error?.usage)`; no failure constructor attaches `usage`.
2. `review-request.mjs:222` `reasoningOnlyFailure` and `:245` `salvageEmptyFailure` build
   `failure.answer = { reasoning, content }` but omit `usage`.
3. `stream-collect.mjs:214` attaches `failure.answer = answer`, and the `answer` accumulator
   (`completion.mjs` `emptyAnswer:17` / `applyFrame:65`) carries `.usage` set from the stream's usage
   frame — so a **generic stream drop already carries `error.answer.usage`** (null only when the drop
   preceded the usage frame).
4. `client.mjs:130` `requireAnswer`'s three refusals (length, reasoning-only, empty-answer) have
   `result.usage` in scope; none attaches it.

## Scope decision (the one design call — recorded for the plan gate to challenge)

**Fix the COMPLETE set of post-hoc throw sites that have the reply's `usage` in scope, not only the
two the item names.** The item names `review-unparsed.mjs` and `client.mjs`'s `requireAnswer`, but the
review-path reasoning-only failure — arguably the most common failure mode here — routes through
`review-request.mjs`'s `reasoningOnlyFailure`/`salvageEmptyFailure` (confirmed by the existing test
`tests/review-exhaustion-reason.test.js:88`), **not** `requireAnswer`. Fixing only the two named sites
would leave that route still `unknown`, defeating the item's stated purpose. The named sites in the
item are illustrative of the fix shape, not an exhaustive site list.

Deliberately **not** touched: mid-stream cutoffs (`token-reserve-cutoff`, deadline/idle timeouts). The
usage frame never arrives before those fire, so `answer.usage` is genuinely `null` — `unknown` is the
honest reading there, and manufacturing a witness would be a lie. `stream-collect.mjs` needs no change:
generic stream drops already carry `answer.usage` on the `.answer` envelope.

## Attachment convention (settled by codebase convention, not a fork)

Two carriers, matching what each throw site already has in hand:

- **A failure that already builds a reply envelope** (`.answer = { reasoning, content }`) gets
  `usage` added to that envelope → read as `error.answer.usage`. This is `reasoningOnlyFailure`,
  `salvageEmptyFailure`, and the generic stream drop (already carries it, no change).
- **A post-hoc throw with no reply envelope** gets a top-level `error.usage = result.usage`. This is
  `review-unparsed.mjs`'s token-exhaustion throw and `requireAnswer`'s three refusals.

`errorReport` reads both, post-hoc field first: `reasoningWitness(error?.usage ?? error?.answer?.usage)`.
The two are disjoint in practice (a site sets one or the other), so precedence is defensive, not
load-bearing.

## Persistence posture (pre-empting the gate's fail-closed probe)

`errorReport` **never serializes `error.usage`/`error.answer.usage` raw** — it feeds it only to
`reasoningWitness`, which extracts a single validated number (`Number.isFinite`, no coercion) and
returns a fresh `{ state, tokens }` of a constant string plus a primitive. So no foreign object,
prototype, `toJSON`, or secret-shaped value off the error can reach the jobs.db-persisted output
through this path. The `jobs.db` fail-closed discipline (`reconstructServerConfig`, `positiveInteger`,
`allowedSource`) is unchanged, and `reasoningWitness` needs no reconstruction pass the way pass-through
`serverConfig` does — the existing OAI-221 comment already states this; the fix makes it *reached*
rather than dead. The `partial` field (`review-report.mjs:326`) reads only `.answer.reasoning`/
`.content` and serializes exactly those two, so adding `usage` to a `.answer` envelope cannot leak
usage into `partial`.

## Salvage nuance (pre-empting gate churn)

After a failed salvage, the **original** failure rethrows (`review-request.mjs:336` `throw
withLedger(fallbackError, ledger)`), so `errorReport` reads the *original* reply's usage — correct,
since the run's top-level `reason` stays the original's. `salvageEmptyFailure`'s attachment labels the
losing salvage follow-up's ledger entry by shape and is attempt-level only; the usage it now carries is
still the right one to read if that failure ever became the propagated one.

## Phases

### Phase 1 — attach usage at the post-hoc throw sites

1. `scripts/lib/review-unparsed.mjs` token-exhaustion throw (`:38`): construct the `UserError` into a
   local, set `.usage = result.usage`, then `throw withLedger(err, ledger)`.
2. `scripts/lib/client.mjs` `requireAnswer` (`:130`): set `failure.usage = result.usage` on each of the
   three thrown errors (length, reasoning-only, empty-answer). The length branch throws inline today —
   hoist it to a local to attach, matching the empty-answer branch's existing local `failure`.
3. `scripts/lib/review-request.mjs` `reasoningOnlyFailure` (`:222`) and `salvageEmptyFailure` (`:245`):
   add `usage: result.usage` to the `failure.answer` object each already builds (all three branches of
   `salvageEmptyFailure`).

### Phase 2 — read both carriers in errorReport

`scripts/lib/review-report.mjs:319`: `reasoning: reasoningWitness(error?.usage ?? error?.answer?.usage)`.

### Phase 3 — docs (step 6, before review)

Two doc surfaces go false the moment the fix lands; both are inside the reviewed diff:

1. `review-report.mjs:310-318` comment — currently "No throw site sets `error.usage` ... so it is
   currently always `{ state: 'unknown', ... }`". Rewrite present-tense to state the new behavior: the
   witness reads the reply's usage carried on the error (`error.usage` from the post-hoc throws,
   `error.answer.usage` from the stream/reply-envelope failures), and is `unknown` only where no usage
   frame reached the reply (pre-stream refusal, mid-stream cutoff before the usage frame).
2. `CLAUDE.md` reasoning-witness note — the parenthetical "(the shared `errorReport` covers both
   failure paths, currently always `unknown` because no throw site sets `error.usage` ...)". Update to
   one present-tense line: the witness now reads the reply's usage off the error where the reply
   carried one. Keep it to one line; honour the file's size posture.

## Tests (Phase 1's positive controls)

All in `tests/review-exhaustion-reason.test.js`, reusing `completionFrames`'s existing `reasoningTokens`
option (no helper work — the "new fixture" the item's implementation note asks for is just that flag):

1. **token-exhaustion observes reasoning**: `replies({ finishReason: 'length', reasoningTokens: 512 })`
   → `report.reasoning` deep-equals `{ state: 'reasoning-observed', tokens: 512 }`. Exercises the
   `error.usage` route through `review-unparsed.mjs`.
2. **reasoning-only observes reasoning**: the existing reasoning-only fixture plus `reasoningTokens: 300`
   → same `{ state: 'reasoning-observed', tokens: 300 }`. Exercises the `error.answer.usage` route
   through `unconstrained()`/`reasoningOnlyFailure`.
3. **Positive control — no details reads unknown**: a `finishReason: 'length'` reply with NO
   `reasoningTokens` (the frame carries plain usage, no `completion_tokens_details`) → `report.reasoning`
   is `{ state: 'unknown', tokens: null }`. Proves the witness tracks the frame rather than being
   hardcoded, per the repo's positive-control rule. (One `finishReason: 'length'` case with details and
   one without = control fires, fix catches.)

## Verification (step 5)

- `npm test` green (currently 1311 per HANDOVER), quoting the summary line.
- Mutation of the key invariant — *the failure witness reads the reply's usage carried on the error*:
  in `review-report.mjs:319` drop the `?? error?.answer?.usage` fallback (revert to
  `reasoningWitness(error?.usage)`). Prove it landed with `mutation-landed.py`, run the suite, name the
  failing test (Phase-3 test 2, the reasoning-only route). Restore, re-run green, prove restore against
  the backup. Single edit, behaviourally meaningful (the `error.answer.usage` route reverts to
  `unknown`), reds a named test.
- Second, independent mutation (one per attachment carrier): in `review-unparsed.mjs` drop the
  `.usage = result.usage` attach → Phase-3 test 1 (token-exhaustion route) reds. Confirms the two
  routes are independently pinned.

## Out of scope

- Mid-stream cutoff / deadline / idle failures — no usage frame, honestly `unknown` (above).
- `task-report.mjs`'s success-path `reasoningWitness(result.usage)` — already works; task failures share
  `errorReport`, so Phase 2 covers them with no task-side change.
- Any new envelope field or shape change — `reasoning` already exists; this only populates it.

## Disclosed residue (checked at step 9, not assumed)

None expected. Walk all four residue sources at step 9 before claiming "no residue".

## Plan-gate thread

(to be filled by the gate rounds)
