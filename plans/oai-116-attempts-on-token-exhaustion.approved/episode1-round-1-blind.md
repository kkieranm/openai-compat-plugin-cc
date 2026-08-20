ARCHIVE — not the current spec; the plan beside it is
STATE: proceeded without harness plan-mode — explicit standing session authorization to bypass the
interactive ExitPlanMode gate (the operator stepped away and asked to iterate technical features
without user input, converging with Codex on any decision that would otherwise go to them). No
provenance: line: this was never a harness plan-mode plan. Approval for this plan is Codex and the
Claude verdict subagent in agreement — the /feature skill's own documented substitute for user
approval — not the operator's own sign-off. plans/README.md's unattended-draft state (per the ADR
it cites) would instead have this block the item; that mechanism was knowingly not used this run,
on the operator's explicit instruction (already flagged for OAI-185 and OAI-115, applied
consistently here), and this deviation is flagged for the operator on return.

# OAI-116 — the token-exhaustion failure path emits no `attempts[]`, making OAI-19's gate criterion
G-E structurally unpassable for any run that hits it.

## Problem, as verified

`scripts/lib/review-unparsed.mjs`'s `unparsedReply(result, { structured, profile })` throws a
`UserError` (`reason: 'token-exhaustion'`) when `result.finishReason === 'length'` — the model
exhausted `max_tokens` before writing usable findings. This is a **post-hoc classification of an
otherwise-successful transport interaction**: the request completed, and the ledger already holds a
closed, populated entry for it. But the thrown `UserError` never gets `error.attemptRecords`
attached via the existing `withLedger(error, ledger)` helper (`scripts/lib/attempt-ledger.mjs:168-174`),
because `unparsedReply`'s signature never receives `ledger` at all. `errorReport()` in
`review-report.mjs` (`attempts: error?.attemptRecords ?? null`) therefore falls through to `null` for
every token-exhaustion failure, even though a fully populated ledger sits one function call away in
scope (`cmd-review.mjs` already threads `ledger` into the `context` object `report()` receives).

This makes OAI-19's gate criterion G-E ("a missing or self-inconsistent `attempts[]` on any run
invalidates the invocation") unpassable for any run that hits this failure mode — and since token
exhaustion is now the dominant failure mode in overnight sweeps (reconfirmed 2026-08-14: four of 40
commits starved, all four recorded `attempts: null`, against a populated `attempts[]` on every commit
that answered in the same run), no benchmark arm can currently pass its own gate. Blocks OAI-19.

`unparsedReply` has two throw/return paths: (1) the `finish_reason === 'length'` branch throws the
`token-exhaustion` `UserError` directly; (2) a fallthrough branch either returns prose (structured
`content`/`reasoning` present) or calls `requireAnswer(result, profile)` (from `client.mjs`), which
itself throws a `UserError` with `reason: null` — a distinct, already-parked issue (OAI-163: a
healthy reasoning-only completion misclassified as a server outage in the sweep's `isOutage` check;
parked as "not worth doing" since the overnight-sweep program isn't currently running). OAI-163's
eventual fix is about giving that branch's error a non-null `reason` — it does not touch `attempts[]`
at all, so fixing `attempts[]` on both of `unparsedReply`'s throw paths does not conflict with or
preempt OAI-163's own eventual fix (confirmed with Codex).

## Decisions (Codex-converged; no operator present)

1. **Thread `ledger` into `unparsedReply`'s own signature: `{ structured, profile, ledger }`.** The
   ownership boundary belongs there, not at the call sites — `unparsedReply` is where a successful
   transport result becomes a post-hoc reporting failure, so it is the right place to decide that
   failure carries the attempts that produced it. Import `withLedger` from `./attempt-ledger.mjs`.
   **Never duplicate the wrap at both `review-report.mjs` call sites** — that is easier to forget on
   a future third call site and puts classification mechanics in the renderers instead of the one
   function that already owns this decision.

2. **`review-unparsed.mjs`'s `unparsedReply`, the `finish_reason === 'length'` branch: wrap before
   throw.**
   ```js
   throw withLedger(new UserError(`${profile.name} ran out of tokens...`, { reason: 'token-exhaustion', hint: ... }), ledger);
   ```

3. **`unparsedReply`'s fallthrough (`requireAnswer(result, profile).trim()`): also wrapped, narrowly.**
   Catch only around that one call, not the whole function body — a broad `try`/`catch` around
   `unparsedReply`'s other logic would also catch unrelated programming errors and misreport them as
   ledger-carrying failures.
   ```js
   try {
     return requireAnswer(result, profile).trim();
   } catch (error) {
     throw withLedger(error, ledger);
   }
   ```
   This is not OAI-163 scope creep: OAI-116 preserves `attempts[]`, OAI-163 would change the error's
   `reason` — independent concerns, and fixing one costs nothing toward or against the other.

4. **Call sites: `parseFields()` needs no functional change** — `jsonReport()` already destructures
   `ledger` from `context` and passes `context` straight through to `parseFields`, which already
   passes `context` straight through to `unparsedReply(result, context)`; `context.ledger` reaches
   `unparsedReply` by construction once its signature accepts it. **`reportFindings()` currently drops
   `ledger`** — its own destructured parameters need `ledger` added, and its `unparsedReply(result, {
   structured, profile })` call updated to `unparsedReply(result, { structured, profile, ledger })`.
   No upstream caller of `reportFindings` needs changing — the context it's called with already
   contains `ledger`; only `reportFindings`'s own destructuring and pass-through were missing it.

5. **No special handling needed for the salvage interaction (OAI-138/OAI-115).** The ledger is
   created once in `cmd-review.mjs` and shared through both the original request and `trySalvage`'s
   follow-up. If the salvage completion itself returns `finish_reason: 'length'`, `unparsedReply`
   attaches the same ledger after both physical attempts have closed — the expected record is the
   original cutoff/deadline attempt as `failed`, the salvage follow-up as `answered` at the
   transport/completion layer, and the overall logical review still reported as `token-exhaustion`.
   This is consistent with the ledger's existing physical-request semantics and needs no new code.

6. **Test coverage: extend `tests/review-exhaustion-reason.test.js` with a non-tautological
   projection of the attempt record**, not just a truthy/non-null check — a fake server drives a
   real completed request, and the assertion proves the post-hoc error retained a closed, internally
   consistent physical-attempt record:
   ```js
   assert.deepEqual(
     report.attempts.map(({ index, outcome, reason, serverResponded }) => ({ index, outcome, reason, serverResponded })),
     [{ index: 1, outcome: 'answered', reason: null, serverResponded: true }],
   );
   ```
   A separate salvage-length regression test (decision 5's scenario) is useful hardening but not
   required for this minimal fix — noted as optional, added only if cheap once the main fix lands.

## Non-goals / explicitly deferred

- OAI-163 (the `reason: null` / `isOutage` misclassification on `requireAnswer`'s throw) — untouched
  beyond the incidental `attempts[]` fix from decision 3, which does not resolve or interact with
  OAI-163's actual defect.
- A dedicated salvage-length integration test — optional per decision 6, added only if it lands
  cheaply alongside the required test.

## Files touched

- `scripts/lib/review-unparsed.mjs` — `unparsedReply` signature gains `ledger`; both throw paths
  (`finish_reason === 'length'`, and the `requireAnswer` fallthrough) wrap their `UserError` with
  `withLedger(error, ledger)` before throwing; new import of `withLedger`.
- `scripts/lib/review-report.mjs` — `reportFindings()`'s destructured parameters gain `ledger`; its
  `unparsedReply(...)` call passes it through. `parseFields()`/`jsonReport()` need no change (already
  threading `context`, which already carries `ledger`).
- `tests/review-exhaustion-reason.test.js` — new assertion pinning the attempt-record projection per
  decision 6.
- `CLAUDE.md` — a short architecture note naming `unparsedReply`'s ledger-wrapping and why it lives
  there rather than at the call sites.
- `BACKLOG.md` / `BACKLOG_DONE.md` — closed on completion.

## Design provenance

Codex steer (`task-mt1o0e1l-6fzb4p`) confirmed the diagnosis with one call-graph correction (only
`reportFindings` drops `ledger`; `parseFields`/`jsonReport` already carry it correctly) and gave a
decisive recommendation on all four questions raised, adopted verbatim above. No genuine design fork
remained after that steer — the fix shape, scope boundary against OAI-163, salvage interaction, and
test coverage were all single-answer, low-ambiguity questions, so no fable third opinion was sought
for this item (reserved for genuine forks, per this session's OAI-115 precedent).
