provenance: harness slug lovely-meandering-starfish

# OAI-199: structural test + REPO_TRAPS entry + fix four sibling process.exit() sites

## Context

The `process.exit()`-after-stderr-write pipe-buffer-truncation defect is now confirmed twice
(`scripts/oai-companion.mjs`, commit `31c98d7`; `bench/review-sweep.mjs`, OAI-198), crossing
CLAUDE.md's "confirmed twice → add a permanent structural test" bar. Filed observation-only per
`/feature`'s current no-proposed-fix rule — this plan is where the fix design happens.

Four more live instances of the identical shape exist: `bench/run.mjs:292`,
`bench/recover-sweep.mjs:251`, `bench/task-run.mjs:197`, `bench/ttl-challenge.mjs:235` (plus
`:232`, a second exit call on the success path — see below).

**Call-graph verification (required before applying the fix, per the REPO_TRAPS draft's own
standard):**
- `bench/run.mjs`, `bench/recover-sweep.mjs`, `bench/task-run.mjs` are `execFileSync`/sync-`fs`-only
  throughout — structurally identical to the two already-fixed files. Safe to apply the same fix.
- `bench/ttl-challenge.mjs` is different in kind: its `main()` awaits `runEpisode()`
  (`bench/lib/ttl-episode.mjs`), which does a real async `spawn()` with no `'error'` listener on the
  child, wrapped in a promise that settles only on `'close'`. Initially flagged as a possible risk
  (removing `process.exit()` might expose a hang) — **refuted by Codex**: a hang inside `runEpisode()`
  means neither `.then()` nor `.catch()` at the bottom ever fires, so `process.exit()` is UNREACHABLE
  in that case and was never actually a safety net against it. The missing `'error'` listener is a
  real, separate hardening gap (an unhandled `'error'` event on the child would crash the process via
  Node's default behavior, independent of these exit calls) — legitimate but **out of scope for this
  item**, filed separately at step 9. Both of `ttl-challenge.mjs`'s exit paths are safe to fix
  identically: the `.then((code) => process.exit(code))` success path is not different in kind from
  the failure path — `code` can be `0` or `1` on a normal, non-exceptional completion (an inconclusive
  experiment verdict), and it has the exact same stdout-truncation exposure (`report()` writes to
  stdout immediately before that exit).

**Structural guard design.** A regex-based proximity check ("a write near an exit") would need a
growing allowlist: `scripts/lib/job-heartbeat.mjs:73` has a deliberate, documented
`process.exit(0)` after a stderr write (the exit's SIDE EFFECT — closing the model socket to
actually stop generation server-side — is the whole point, not a truncation bug), and
`bench/task-cases/prototype-lookup/witness.mjs` has a write-then-`exit(1)` pattern too (a corpus
witness script, not production CLI surface). Instead: scope the guard to an **explicit list of this
repo's actual CLI entrypoints** — files directly invocable with `node <file>` (guarded so that
importing them for a test does not run `main()`), never mind that some are ALSO importable as
libraries — `scripts/oai-companion.mjs`, `bench/run.mjs`, `bench/review-sweep.mjs`,
`bench/recover-sweep.mjs`, `bench/task-run.mjs`, `bench/ttl-challenge.mjs` (six files).
**Corrections from the plan-gate review, four rounds:**
- (Round 1) This list does NOT match CLAUDE.md's Commands table verbatim — `bench/task-run.mjs`
  isn't named there at all (only in architecture prose, line 338), and `scripts/oai-companion.mjs`
  is referenced only indirectly (via `/oai:setup`), not as its own bullet.
- (Round 2, line numbers corrected at round 3) "Never imported as a library" was also false and has
  been removed above: `bench/task-run.mjs:12` states plainly "Everything here is importable," and
  `bench/run.mjs:57` documents its own `reviewFlags` as "EXPORTED for
  `tests/bench-review-flags.test.js`." Both files are
  imported as libraries AND directly invocable — the two are not exclusive. What actually
  distinguishes the six files is direct invocability behind a self-invocation guard (or, for
  `oai-companion.mjs`, being the one file always run directly with no guard needed) — confirmed by
  grep that `job-heartbeat.mjs` and `witness.mjs` have neither shape, so they're excluded on that
  basis, not on an importability claim.
- (Round 2) `bench/task-run.mjs:9-11`'s own header comment is now caught as STALE by this same
  reread: it says `bench/run.mjs` "runs `main()` at import, which is why it has no test" — but
  `bench/run.mjs:288`'s `process.argv[1]` guard means that hasn't been true since that guard landed.
  This plan's own justification depends on `run.mjs`'s guard being real and current, so the stale
  comment is corrected as part of this change (see Change section) rather than left contradicting
  the guard this plan relies on.

**Flat-ban `process.exit(` in all six** CLI-entrypoint files, since after this fix none of them
needs it anymore. This is simpler and more robust than proximity detection. **The scan MUST run
over `withoutComments()`, not raw source — caught at round 3 of the plan gate as an implementation
blocker, not a style choice.** `scripts/oai-companion.mjs` itself — the file whose already-shipped
fix this whole item is generalizing — has two prose mentions of `process.exit()` in its own
explanatory comments (lines 42, 50: "`process.exitCode`, never `process.exit()`, here" and
"`process.exit()` tears the process down..."), which a raw-source regex ban would match and flag
permanently, on the exact file the guard exists to protect. `tests/structure.test.js`'s "tests
never spawn a child synchronously" test (line 85) is a bare-regex-over-raw-source guard and was
initially cited as the shape to mirror — that citation was itself wrong for this purpose, since
this defect class's own explanatory comments (which this item's own REPO_TRAPS entry adds more of)
inherently mention the banned call. The new guard must instead follow the "nothing calls the global
fetch" test's shape (line 104), which does call `withoutComments()` for exactly this reason.

## Change

**1. `bench/recover-sweep.mjs:251`, `bench/task-run.mjs:197`**: each `process.exit(1);` →
`process.exitCode = 1;`, mirroring the already-shipped pattern exactly (`scripts/oai-companion.mjs`,
`bench/review-sweep.mjs`) — in both files `process.exit(1)` is the last statement in its catch
block, so no other control flow changes.

**`bench/run.mjs:288-295` needs an additional fix, caught at the plan gate.** Its catch block is
```js
main().catch((error) => {
  if (error instanceof UserError) {
    process.stderr.write(`${error.message}\n${error.hint ? `${error.hint}\n` : ''}`);
    process.exit(1);
  }
  throw error;
});
```
A naive `process.exit(1)` → `process.exitCode = 1;` substitution falls through to the unconditional
`throw error;` on every `UserError`, printing the intended concise message and THEN an uncaught
stack trace — a real regression the other three files don't have, since their `process.exit(1)` is
already the catch's last statement. Fix: add `return;` after the `process.exitCode = 1;` assignment,
so the `UserError` branch exits the handler the same way `process.exit(1)` used to (by terminating
that call, not the process) — `throw error;` still runs for any non-`UserError`, unchanged.

**2. `bench/ttl-challenge.mjs:230-236`**: both exit calls become `process.exitCode` assignments —
`.then((code) => process.exit(code))` → `.then((code) => { process.exitCode = code; })`, and the
`.catch` branch's `process.exit(1);` → `process.exitCode = 1;`.

**3. New structural test in `tests/structure.test.js`**: a `CLI_ENTRYPOINTS` list (the six files
above, each with a one-line comment naming why it's on the list — self-invocation guard, or "the
one file always run directly" for `oai-companion.mjs`), scanning each with a regex ban over
`withoutComments(readFileSync(file, 'utf8'))`, in the same shape as the existing "nothing calls the
global fetch" test (line 104) — **not** the "never spawn a child synchronously" test, whose bare
raw-source scan would permanently flag `scripts/oai-companion.mjs` itself for its own explanatory
comments (see Context, corrected at round 3) — `assert.deepEqual(offenders, [], 'use
process.exitCode instead — see .claude/REPO_TRAPS.md')`.

**4. Stale header comments about `bench/run.mjs`'s own guard, corrected — three sites found across
two rounds of plan-gate reread, all comment/prose only, no logic change:**
- `bench/task-run.mjs:9-11` says `bench/run.mjs` "runs `main()` at import, which is why it has no
  test" — false since `bench/run.mjs:288`'s `process.argv[1]` guard landed.
- `bench/review-sweep.mjs:12-13` says the same thing in different words — "Structured after
  `bench/task-run.mjs`, NOT `bench/run.mjs`: that one calls `main()` at module scope, cannot be
  imported, and consequently has no test at all" — same stale claim, same fix (found at round 4,
  caught by Codex on the same reread that confirmed the other corrections).
- `bench/run.mjs:286`'s own comment cites `` `review-sweep.mjs:291` `` for that file's guard; the
  guard is now at line 358 (drifted from file growth, unrelated to this defect class but surfaced
  by the same reread) — corrected to the current line number.

This plan's own justification for the CLI_ENTRYPOINTS design depends on `bench/run.mjs`'s guard
being real, current, and consistently described, so all three contradictions are fixed rather than
left standing.

**5. New `.claude/REPO_TRAPS.md` entry**, close to the draft already written (then reverted) during
OAI-198's ladder: documents the class, the two originally-confirmed instances, the fix pattern
(`process.exitCode` instead of `process.exit()`), and now also names the structural test that
guards it and the four newly-fixed sibling sites — this time landing for real, since a full pass is
reviewing it as part of this item (unlike OAI-198, where it rode as an unreviewed batch fix on a
one-line change and was correctly rejected as non-exempt).

## Verification

- Run `npm test` (full suite).
- Mutation check on the new structural test (its own key invariant): temporarily reintroduce
  `process.exit(1)` in one of the six files (e.g. `bench/run.mjs`), confirm the new structural test
  goes red, restore, confirm green. This is the test's OWN validity proof — standard mutation-check
  mechanics.
- Mutation check per fixed file (following OAI-198's precedent exactly): for `bench/run.mjs`,
  `bench/recover-sweep.mjs`, `bench/task-run.mjs` — revert each `process.exitCode` back to
  `process.exit`, confirm the NEW structural test catches it (this is now the test's job; a
  behavioral mutation-check like OAI-198's — reverting and running the full suite to see a specific
  functional test go red — does not apply here, since these bench scripts have no functional test
  exercising their error-exit path the way `credential-notice.test.js` does for `oai-companion.mjs`;
  the structural test is the coverage). Confirm restored + green for each.
- For `bench/ttl-challenge.mjs`: same structural-test mutation check. Do NOT attempt a live/behavioral
  mutation test — running this file for real costs ~45 minutes and needs LM Studio in a specific
  state (opt-in, per CLAUDE.md); the structural test is the intended coverage here, consistent with
  the plan's own scope (this item is about the exit mechanism, not about ttl-challenge.mjs's broader
  behavior).
- Manually re-read all four fixed files plus the new structural test and REPO_TRAPS entry for
  accuracy.

## Residue

- File a new backlog item: `bench/lib/ttl-episode.mjs`'s `runEpisode()` spawns a child with no
  `'error'` listener, relying only on `'close'` — a real, separate hardening gap (an unhandled
  `'error'` event crashes the process via Node's default EventEmitter behavior, independent of this
  item's exit-mechanism fix), confirmed but explicitly out of scope here per Codex's steer.
