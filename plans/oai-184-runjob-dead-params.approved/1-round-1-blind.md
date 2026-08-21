ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug quiet-percolating-oasis

# OAI-184: drop dead params from `runJob`

## Context

`scripts/lib/cmd-task-worker.mjs`'s `runJob(db, seq, job)` (line 104) never reads `db` or `seq` —
confirmed by reading the function body, which touches only `job`. Found by Codex during OAI-63's
review-ladder pass 6, on a file that OAI-63's diff only touched via one unrelated docblock comment.
Cosmetic, no behavioural effect. `runJob` is module-private (not exported) with exactly one call
site, `runAndPublish` at line 236, which already has `db`/`seq` in scope from its own signature.
`grep -rn "runJob"` across the repo (excluding stray `.claude/worktrees/` copies from unrelated
workflow runs) confirms no test, mock, or second caller depends on the current 3-arg arity.

## Change

In `scripts/lib/cmd-task-worker.mjs`:
- `async function runJob(db, seq, job) {` → `async function runJob(job) {`
- call site: `outcome = await runJob(db, seq, job);` → `outcome = await runJob(job);`

No other files change. The docblock above `runJob` (lines ~92-102) describes what the function
does and doesn't mention the parameters by name, so it needs no edit.

## Verification

- `npm test` green (existing suite; no new test needed — this is a pure signature narrowing with no
  behavioural branch to mutation-test, per the feature skill's step 5 "no invariant a single edit
  can break" exemption).
- `grep -n "runJob" scripts/lib/cmd-task-worker.mjs` after the edit shows both sites at 2-arg-free
  call shape.
