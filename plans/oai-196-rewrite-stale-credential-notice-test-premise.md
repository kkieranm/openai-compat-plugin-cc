provenance: harness slug lovely-meandering-starfish

# OAI-196: rewrite the stale premise of credential-notice.test.js's pipe-buffer test

## Context

`tests/credential-notice.test.js:250`'s test `'the notice survives a preamble larger than the pipe
buffer'` was written when `oai-companion.mjs` called `process.exit(2)` on failure, which discarded
undrained stderr. Its header comment (lines 251-259) explains that `task-submit.mjs`'s
`noteEndpointPersistence()` call had to sit ABOVE `prepareTask()` so the notice would already be
flushed before a huge provider-name preamble (1MB, chosen to exceed the OS pipe buffer) could push it
past the buffer and get discarded on a forced exit.

Commit `31c98d7` fixed `oai-companion.mjs` to set `process.exitCode` instead of calling
`process.exit()`, so Node now drains stdio naturally before exiting regardless of write order or
size. Confirmed by mutation (recorded in the backlog item): reintroducing the exact regression this
test was written to catch — moving `noteEndpointPersistence()` below `prepareTask()` in
`task-submit.mjs` — still leaves the test green, because nothing forces an early exit anymore. The
test's premise is dead; its assertions (an orphaned row exists, the notice line appears in stderr,
the secret never leaks) are not.

**Design decision, settled via two rounds of Codex steer**: `task-submit.mjs`'s call order
(`noteEndpointPersistence()` before `prepareTask()`) stays **unchanged**. It was tempting to swap it
deliberately — putting the notice after the huge preamble would turn this test into a genuine,
mutation-provable regression guard for the broader `process.exitCode`-vs-`process.exit()` defect
class (partially addressing OAI-199's open ask for a structural test). Codex's first pass recommended
exactly that. But `CLAUDE.md`'s own documented design (`task-submit.mjs` `noteEndpointPersistence()`
section) states the current ordering is an **independent, deliberate invariant**, not a workaround for
the process.exit(2) bug: the notice is unconditional, "gating on nothing," and runs "before anything
else writes to stderr... where no preamble can crowd it out." Reordering would make the notice's
emission conditional on `prepareTask()` succeeding first, and would falsify that CLAUDE.md sentence.
Shown this passage, Codex's second pass reversed its own recommendation and confirmed: leave the
order alone, rewrite only the test's stale comment. **Production code (`task-submit.mjs`) does not
change in this item at all.**

## Change

**`tests/credential-notice.test.js`** (lines 251-259, the header comment on `'the notice survives a
preamble larger than the pipe buffer'` only):

Rewrite to state accurately what the test now verifies and why:
- The notice, the orphaned row, and credential redaction all still hold together even with an
  enormous preamble and a slow stderr consumer — this is real, still-live coverage.
- This no longer depends on `noteEndpointPersistence()` running before `prepareTask()` for
  correctness: `oai-companion.mjs`'s `process.exitCode` fix drains stdio naturally regardless of
  write order or size now, so nothing forces an early exit that could discard queued output.
- The call order in `task-submit.mjs` is unchanged and still correct — it remains defensive
  belt-and-braces (matching the framing already used in OAI-197's `job-launch-outcome.mjs` fix) and
  is independently justified by `CLAUDE.md`'s own "gating on nothing... no preamble can crowd it
  out" design note, not by anything this test can still detect.
- State plainly that this test can no longer catch a regression to `oai-companion.mjs`'s
  `process.exitCode` behavior specifically (the notice is already flushed well before the huge
  preamble in the current ordering) — that class is tracked separately under OAI-199, which remains
  open.

No change to the test's body: the 1MB provider name, `submitWithSlowStderr`, and all four assertions
(non-zero exit, one orphaned row, notice present, no secret leak) stay exactly as they are — they
remain real, independent coverage of notice/row/redaction behavior under load, just not of the
pipe-buffer-truncation defect class specifically.

No lasting change to any other file. `scripts/lib/task-submit.mjs` is read during planning/review to
confirm the call order claim, and is temporarily mutated and restored during step 5's verification
mutation check (see below) — never left edited. The commit that ships this item touches
`tests/credential-notice.test.js` alone.

## Verification

- Run `npm test` (full suite) — confirm nothing regresses (comment-only change).
- Mutation check (step 5 of `/feature`): the test's assertions ARE still a real invariant even though
  the pipe-buffer defect class is no longer catchable through this test. Prove the still-live
  invariant using the skill's standard mutation-check protocol (back up `task-submit.mjs`, mutate,
  prove the mutation landed, run the suite, name the failing test, restore, prove the restore against
  the backup): temporarily comment out the `noteEndpointPersistence()` call in `task-submit.mjs`,
  confirm this exact test goes red (the notice assertion fails), restore, confirm green again, and
  confirm the restored file matches the backup exactly. `task-submit.mjs` ends the item byte-identical
  to how it started — this mutation exists only inside the verification step, never in the diff that
  ships. This proves the rewritten comment's claim ("the notice... assertions... are real, still-live
  coverage") rather than asserting it untested. Do NOT attempt to mutation-prove the pipe-buffer/ordering
  claim — that is confirmed dead by the backlog item's own prior mutation test, and manufacturing a
  mutation against a claim the comment explicitly says is no longer testable would be dishonest.
- Manually re-read the rewritten comment against `task-submit.mjs`'s actual current call order and
  `oai-companion.mjs`'s actual current exit behavior to confirm accuracy.

## Residue

None expected beyond what's already tracked: OAI-199 (the structural-test/sibling-files item) stays
open and unaffected — this item doesn't touch it. No new backlog items anticipated.
