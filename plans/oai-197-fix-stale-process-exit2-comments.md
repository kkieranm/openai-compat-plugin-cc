provenance: harness slug lovely-meandering-starfish

# OAI-197: fix two comments stating removed process.exit(2) behavior as fact

## Context

`oai-companion.mjs`'s top-level error handler used to call `process.exit(2)` on an unexpected
failure. Commit `31c98d7` changed that to set `process.exitCode = 2` and return (letting Node drain
stdio before exiting), fixing a pipe-buffer-truncation defect. That fix's own review ladder
(OAI-196/197's ladder) found two comments elsewhere in the codebase that still describe the OLD
`process.exit(2)` behavior as current fact, unnoticed because the code beside each comment stays
correct either way:

1. `scripts/lib/job-launch-outcome.mjs:93-102` — `writeSync`'s rationale comment says "the error
   rethrown below reaches `oai-companion.mjs`, which writes and then calls `process.exit(2)`" and
   "`process.exit(2)` DISCARDS UNDRAINED STDERR." Both are now false.
2. `tests/job-helpers.mjs:264` (docstring for `submitWithSlowStderr`) — "leaves nothing pending for
   `process.exit(2)` to discard." Also now false.

Filed as OAI-197 during the same review ladder that shipped OAI-196's sibling fix in CLAUDE.md
(2026-08-22), out of scope for that ladder to avoid widening its batch.

## Change

Both comments need their `process.exit(2)` references rewritten to describe the current
`process.exitCode = 2` behavior, while preserving the substance of what they're each explaining —
neither comment's underlying point is wrong, only the mechanism they cite for it.

**`scripts/lib/job-launch-outcome.mjs`** (around lines 93-101): the comment argues `writeSync` is
needed because an async stderr write can be lost if the process exits before it drains. That
argument no longer strictly requires `process.exit(2)`'s discard behavior — `oai-companion.mjs` now
sets `process.exitCode` and returns, which lets Node drain stdio naturally. Rewrite the comment to
state the current behavior accurately: `oai-companion.mjs` now drains before exiting via
`process.exitCode`, so `writeSync` here is defensive belt-and-braces (matching the backlog item's own
framing: "the code beside each comment stays correct either way; `writeSync` is still defensible
belt-and-braces") rather than a strict correctness requirement — without inventing a new risk or
overstating what's still true.

**`tests/job-helpers.mjs`** (line 264): the docstring explains why `submitWithSlowStderr` exists —
`runCompanion` drains too fast to exercise the risk. Rewrite "leaves nothing pending for
`process.exit(2)` to discard" to describe what the fixture actually now tests: a slow reader that can
still observe whether output is written and drained correctly, without the (no-longer-applicable)
discard framing. The backlog item's own note applies here too: "the slow-stderr fixture still
exercises a real drain path" — so the fixture's purpose is intact, only the mechanism it originally
guarded against needs updating in the doc text.

No code logic changes in either file — comment/docstring text only.

## Verification

- Run `npm test` (full suite) — confirm nothing regresses (comment-only change, so this should be a
  pure formality, but run it per the repo's commit gate).
- Mutation check (step 5 of `/feature`): this is a case with "no invariant a single edit can break" —
  a comment change has no executable behavior to mutate-test. State this explicitly and skip per the
  skill's own allowance ("wiring, config, docs, a pure rename → say so and skip. Never manufacture a
  mutation").
- Manually re-read both edited comments against the current `oai-companion.mjs` behavior
  (`process.exitCode = 2`, no `process.exit()` call) to confirm they now state it accurately.

## Residue

None expected. This closes OAI-197; no follow-on work anticipated.
