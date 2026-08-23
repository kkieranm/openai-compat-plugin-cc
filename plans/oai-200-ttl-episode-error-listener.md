provenance: harness slug oai-200-direct

# OAI-200: `runEpisode`'s spawned child has no `'error'` listener

## Context

`bench/lib/ttl-episode.mjs:94` `runEpisode` spawns the real review command with `spawn()` and
registers `'data'` handlers on `stdout`/`stderr` and a `'close'` handler, but no `'error'` handler.
Node's `ChildProcess` is an `EventEmitter`; an `'error'` event with no listener is an uncaught
exception under Node's default behavior, crashing the whole process. `bench/ttl-challenge.mjs` runs
for ~45 minutes unattended per CLAUDE.md, so a single spawn-level failure would crash the entire
sweep with no diagnostic in the manifest, losing whatever the run had already observed.

Confirmed live that `spawn()` with a nonexistent `cwd` and no `'error'` listener throws an uncaught
exception and kills the process. **Corrected at plan-gate round 1** (an independent Claude verdict
subagent's own reproduction, on Node 26.3.1): the original draft claimed `'close'` never fires
alongside `'error'` for this failure — false on this Node version, where `'error'` fires first,
followed by `'close'` with code `-2`, consistently across 5 runs. The design below does not depend on
either ordering being universal: the `settled`-guarded `finish()` closure (see Change §1) makes
whichever event fires first win, and the second becomes a no-op, so the fix is correct whether a
given Node version emits `'close'` after `'error'` or never emits it at all.

**Downstream fields already tolerate a `null`/absent report.** `obtainedAnyResponse`,
`recordContradiction`, `prefillFromAttempts`, `clientBudgetReason` (all in `bench/lib/ttl-attempts.mjs`)
each already handle `attempts` being `null` or non-array, returning `false`/`null` rather than
throwing — and `episodeVerdict` (`bench/lib/ttl-verdict.mjs:116`) already reads `!obtainedResponse` as
`'not-dispatched'`, which is exactly the correct verdict for a request that never left this process.
Verified independently by both plan-gate reviewers by reading the source, not by trusting this plan's
citation. So the fix does not need a new record shape or a new verdict branch — it reuses the existing
"never dispatched" path by resolving with the same field set the `'close'` handler already produces,
with `attempts: null`.

Deferred from OAI-199 as unrelated: a hang inside `runEpisode()` never reaches
`bench/ttl-challenge.mjs`'s `process.exit()`/`process.exitCode` calls either way, since neither
`.then()` nor `.catch()` fires on a promise that never settles — so OAI-199's exit-mechanism fix
neither caused nor could have fixed this.

## Change

In `bench/lib/ttl-episode.mjs`'s `runEpisode`:

1. **Preserve exact original timing — caught at plan-gate round 1 (Codex) as a real ordering bug in
   the first draft.** The original `'close'` handler computes `durationMs: Date.now() - startedAt`
   INSIDE the object literal, which is constructed AFTER `sampler.stop()` and `cleanup(dir)` already
   ran — so `durationMs` in production today includes their time. A naive `finish(record)` that takes
   an already-built object would compute `durationMs` BEFORE those calls, silently shrinking the
   measurement. Fix: `finish` takes a **builder function**, not a value —
   `finish(() => ({ ...fields... }))` — and calls it only after `sampler.stop()` and `cleanup(dir)`
   have run, so `durationMs`'s measurement point is byte-for-byte where it is today. Guard with a
   `settled` boolean so a second event (`'close'` firing after `'error'` already won, or vice versa)
   is a no-op rather than a second resolve — see Context above for why this is required, not optional.
2. **Add an injectable spawn seam — caught at plan-gate round 1 (both reviewers) as a real gap: the
   verification section's test is not buildable against the current signature.** `runEpisode` calls
   `spawn` (from the top-level `node:child_process` import) directly, and `materialize` (imported from
   `corpus.mjs`) always returns a real, freshly-`mkdtempSync`-created directory — there is no way to
   make it return a nonexistent path, and this repo has zero dependencies and a Node floor below where
   `node:test` module mocking is available, so mocking the import isn't an option either. Add one
   optional parameter to `runEpisode`'s signature: `spawnImpl = spawn`, used in place of the bare
   `spawn(...)` call at the existing call site. Every production call site is unchanged (the default
   is the real `spawn`); a test supplies a wrapper that calls the REAL `spawn` with the caller's
   `command`/`args` but a forced nonexistent `cwd`, exercising the real Node ENOENT-on-bad-cwd path
   rather than hand-constructing a fake `EventEmitter` — the latter is exactly the "stub that returns
   sentinels where the real call throws" shape a REPO_TRAPS.md entry already warns against for this
   repo, so the seam is deliberately narrow (override the spawn call, not the event semantics).
3. Add `child.on('error', (error) => { ... })`, calling `finish` with a builder producing the same
   field set the `'close'` handler produces, adapted for "never dispatched": `exitCode: null`,
   `failed: true`, `obtainedResponse: false` (from `obtainedAnyResponse(null)`), `contradiction: null`
   (from `recordContradiction(null)`), `prefillMs: null` (from `prefillFromAttempts(null)`),
   `clientBudgetReason: null` (from `clientBudgetReason(null)`), `attempts: null`,
   `samples: sampler.samples`, `stderr: `spawn error: ${error.message}``, `durationMs` measured the
   same way as the `'close'` path. Call the same four helper functions already imported rather than
   hand-writing the `false`/`null` literals, so the record stays provably in sync with what those
   helpers actually return for `null` input.
4. `'close'`'s existing body is otherwise unchanged in content, just restructured to build its object
   inside a `finish(() => ({...}))` call instead of calling `resolve` directly.

No change to `bench/ttl-challenge.mjs`, `bench/lib/ttl-verdict.mjs`, or `bench/lib/ttl-attempts.mjs`,
and no change to `bench/lib/corpus.mjs`'s `materialize` — this item is scoped to the missing listener
and the one injectable seam needed to test it.

`cleanup(dir)` is confirmed safe to call unconditionally in the `'error'` path even for a directory
that was never created: it is `rmSync(dir, { recursive: true, force: true })` (`corpus.mjs:245`),
and `force: true` means a missing path is not an error. This is moot for the injected-`spawnImpl`
test scenario anyway — only the spawn's `cwd` is overridden there, so `dir` (what `cleanup` receives)
is always the real materialized directory, exactly as in production.

## Verification

- `npm test` full suite green.
- A new test in `tests/ttl-episode.test.js`: call `runEpisode` with the default (real) `materialize`,
  but pass `spawnImpl: (command, args, options) => spawn(command, args, { ...options, cwd:
  '/nonexistent/oai200-test-dir' })`. Assert the promise **resolves** (never rejects, never hangs —
  the test's own timeout is the proof it didn't hang) with `failed: true`, `obtainedResponse: false`,
  `exitCode: null`, and `stderr` containing `ENOENT`.
- Mutation check: revert the `'error'` listener, confirm the new test now hangs/times out or the
  process crashes (uncaught exception) rather than the assertion failing normally — demonstrating the
  test actually exercises the code path — then restore.
