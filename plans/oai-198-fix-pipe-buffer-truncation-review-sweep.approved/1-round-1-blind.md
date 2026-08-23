ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug lovely-meandering-starfish

# OAI-198: fix pipe-buffer truncation in bench/review-sweep.mjs's main()

## Context

`bench/review-sweep.mjs`'s top-level `main()` invocation (lines 358-366) catches a
thrown error, writes it to stderr across two `process.stderr.write` calls, then calls
`process.exit(1)` synchronously. `process.exit()` tears the process down immediately
without waiting for queued stdio writes to drain — so a large enough stderr payload
(an error message plus a hint line) can be truncated at the OS pipe buffer (64KB on
darwin) before it finishes writing.

This is the identical defect class already fixed in `scripts/oai-companion.mjs`
(commit `31c98d7`, "Stop process.exit() truncating a large --json failure envelope
at the pipe buffer"): that fix replaced `process.exit()` with setting
`process.exitCode` and returning, letting Node drain stdout/stderr naturally before
exiting on its own once the event loop empties.

Filed as OAI-198 during the review ladder that shipped OAI-196/OAI-197 (2026-08-22),
out of scope for that ladder since it touches a different entrypoint. Severity is
low in practice — this path only ever writes one error message plus a hint line,
nowhere near the 64KB boundary — the same "structural hardening, not a demonstrated
leak" framing OAI-192 already established for the identical shape in
`job-launch-outcome.mjs`. The fix is still worth making because it's cheap, it
matches an already-approved pattern in this repo, and it closes the defect class
completely rather than leaving one known instance of it.

## Change

In `bench/review-sweep.mjs`, in the top-level guarded `main()` invocation:

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof UserError ? error.message : String(error?.stack ?? error)}\n`);
    if (error instanceof UserError && error.hint) process.stderr.write(`${error.hint}\n`);
    process.exit(1);
  }
}
```

Replace `process.exit(1);` with `process.exitCode = 1;` — no `return` needed since
it's already the last statement in the `catch` block and the script has nothing
else to run after it. This is the only line that changes.

No other file needs touching: `bench/review-sweep.mjs` has no other `process.exit`
call, and this is the only synchronous-exit-after-stderr-write site outside the one
already fixed in `oai-companion.mjs`.

## Verification

- Run `npm test` (full suite) — this file has no dedicated unit test for its exit
  behavior; confirm nothing regresses.
- Mutation check (step 5 of `/feature`): temporarily revert to `process.exit(1)`,
  confirm no test goes red (expected — nothing exercises this path today, so this
  is stated as untested per the skill's "no invariant a single edit can break" /
  genuinely-uncovered allowance), then restore and confirm the diff matches the
  intended one-line change.
- Manually invoke `node bench/review-sweep.mjs` with an invalid argument (e.g. a
  bad `--repo` path) to confirm it still exits non-zero and still prints the error
  to stderr, just via `exitCode` instead of `exit()`.

## Residue

None expected. This closes OAI-198; no follow-on work anticipated.
