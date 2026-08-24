ARCHIVE — not the current spec; the plan beside it is
provenance: none — harness plan mode skipped for this unattended run by the owner's ratified
charter (AskUserQuestion, 2026-08-24, before departure): no plan-mode prompts; approval is the
dual gate (Codex `--approved`/`--dual-approved` + independent fable verdict subagent), which the
/feature skill itself sanctions as one of the two closing signatures.

# OAI-203 — clean the 13 leaked temp directories in tests/delegate-containment.test.js

## Premise (probe-confirmed, Codex claim-check all-TRUE 2026-08-24)

`tests/delegate-containment.test.js` calls `mkdtempSync` at 14 sites. 13 of them — lines 60, 111,
123, 133, 143, 168, 192, 226, 248, 291, 294, 329, 335 — are never removed: the file imports no
removal function and has no `rmSync`, `finally` cleanup, or `after`/`afterEach` hook. The 14th
(line 75, `runContainment`) is cleaned by the recipe's own `trap 'rm -rf "$dir"' EXIT INT TERM HUP`
(`agents/oai-delegate.md:94`), which the dir the test passes always survives validation to arm.
The probe also found one leak the item did not list: the symlink at line 337 (`${real1}-link`, a
sibling entry in /tmp created by `symlinkSync`) is likewise never removed. `withScratchRepo`
(line 60) runs once per invoking test, so the per-run leak count exceeds 13.

The repo's existing cleanup idiom is `rmSync(path, { recursive: true, force: true })`
(`tests/job-busy.test.js:66`, `tests/bench-warm-up.test.js:138`).

## Design

One tracking helper plus one `after` hook, in this file only — not per-site `try/finally` (13
scattered blocks, and the next added site forgets its block; one helper is the repo's
"one definition, or one guard" convention).

```js
const TRACKED = [];
let trackedCalls = 0;
const track = (path) => {
  trackedCalls++;
  TRACKED.push(path);
  return path;
};
const tracked = (prefix) => track(mkdtempSync(prefix));
```

`track` is the one registration point — every path that enters `TRACKED` passes through it and
increments the counter, so the hook's equality holds whether the entry is a directory or the
symlink below (plan-gate round 2, Codex: pushing the symlink directly onto `TRACKED` left
`TRACKED.length === trackedCalls + 1` on every full run, failing the hook).

- All 13 leaking `mkdtempSync(<prefix>)` calls become `tracked(<same prefix argument>)` — the
  argument each site passes today is unchanged (12 pass `join(tmpdir(), '<name>-')`, line 335
  passes the literal `'/tmp/oai-delegate.'` the recipe's prefix check requires).
- The line-337 symlink path is registered via `track(link)` after `symlinkSync` creates it.
  `rmSync` on a symlink removes the link itself, never the target, so ordering against `real1`'s
  removal does not matter.
- Line 75 stays a bare `mkdtempSync`: the recipe's own trap — part of what this file exercises —
  already removes it. Stated limitation (plan-gate round 1, Codex, non-blocking): a failure
  between `mkdtempSync` and the shell reaching the trap line (manifest write, block extraction, a
  missing shell) still leaks that one dir; accepted, because routing it through `tracked()` would
  make the test-side cleanup mask whether the recipe's own trap performed its removal.
- One `after` hook (from `node:test`, alongside the existing `test` import):

```js
after(() => {
  assert.equal(TRACKED.length, trackedCalls, 'every scratch path must be tracked');
  for (const path of TRACKED) rmSync(path, { recursive: true, force: true });
});
```

The `assert.equal` is the hook's own positive control: mutate `tracked` to stop recording and the
hook fails any run in which the helper actually ran, so the cleanup cannot silently become a no-op
over an empty list. Counting invocations rather than asserting non-emptiness is deliberate
(plan-gate round 1, Codex): a legitimate `--test-name-pattern` run that skips every test still
fires the file-level `after` hook, and a bare `TRACKED.length > 0` would fail that run; `0 === 0`
passes it, while the removed-`push` mutation still fails every unfiltered run.

New imports only: `rmSync` (node:fs), `after` (node:test). The helper is named `tracked`, not
`scratch` — line 133 already binds a local `scratch`.

## Not in scope

- The rest of the suite leaks the same way (`mkdtempSync` in 27 test files, cleanup in only 3) —
  observed 2026-08-24 by repo-wide grep during the probe. That is other files' work; noted for the
  residue step's worth-bar judgement, not fixed here.
- No structural test ratcheting "every mkdtempSync must be tracked" — the defect class has one
  dated instance in one file; the repo graduates a class to `tests/structure.test.js` when it
  recurs.

## Files

- `tests/delegate-containment.test.js` — the only file changed.

## Acceptance criteria

1. All 13 listed sites route through `tracked()`; line 75 is unchanged; the line-337 symlink is
   tracked.
2. After `node --test tests/delegate-containment.test.js`, the temp locations hold no new
   `oai-containment-*`, `oai-not-the-right-prefix-*`, or `oai-delegate.*` entries created by the
   run (measured by listing before and after; positive control: the same measurement on the
   unfixed file shows a nonzero leak).
3. Full `npm test` green.
4. No test's assertions change — the diff is creation-site routing, tracking, imports, and the
   hook.

## Verification

- Positive control first: run the file on the current code, count new temp entries (expect > 13).
- Fix, rerun, count again (expect 0).
- Mutation check (the key invariant — cleanup actually tracks): remove the `TRACKED.push(path)`
  line inside `track` via mutation-landed.py; the `after` hook's `assert.equal` must fail the
  run; restore, prove the restore against the backup.
- Full suite at the commit gate.
