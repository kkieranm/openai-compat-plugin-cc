provenance: none — harness plan mode skipped for this unattended run by the owner's ratified
charter (AskUserQuestion, 2026-08-24, before departure): no plan-mode prompts; approval is the
dual gate (Codex `--approved`/`--dual-approved` + independent fable verdict subagent), which the
/feature skill itself sanctions as one of the two closing signatures.

# OAI-203 — clean the 13 leaked temp directories in tests/delegate-containment.test.js

## Premise (probe-confirmed, Codex claim-check all-TRUE 2026-08-24)

`tests/delegate-containment.test.js` calls `mkdtempSync` at 14 sites. 13 of them — lines 60, 111,
123, 133, 143, 168, 192, 226, 248, 291, 294, 329, 335 — are never removed: the file imports no
removal function and has no `rmSync`, `finally` cleanup, or `after`/`afterEach` hook. The 14th
(line 75, `runContainment`) is cleaned on every shell run by the recipe's own `trap 'rm -rf "$dir"' EXIT
INT TERM HUP` (`agents/oai-delegate.md:94`), which the dir the test passes always survives validation
to arm — but leaks on a failure before the shell starts, which is why the design below now tracks it
as a fallback and asserts the trap's removal explicitly.
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
- The `runContainment` dir is `tracked()` too, **and** `runContainment` asserts, after the shell
  settles (success or refusal — the recipe's `EXIT` trap runs on both), that `existsSync(dir)` is
  false: the assertion is what verifies the trap performed its removal — a stronger check than
  leaving the dir uncleaned ever was — and the hook's `rmSync` with `force: true` is a no-op on
  the already-removed dir in the ordinary case while covering the pre-trap failure paths (manifest
  write failure, `containmentBlock` assertion firing on recipe drift, a missing shell). This
  replaces round 2's accepted limitation: the review-ladder pass-1 `codex-adversarial` stage
  showed the masking concern that justified it is avoidable (confidence 0.98), because an explicit
  post-run assertion tests the trap where silence merely spared it.
- One `after` hook (from `node:test`, alongside the existing `test` import):

```js
after(() => {
  assert.equal(TRACKED.length, trackedCalls, 'a track() registration must reach the cleanup list');
  for (const path of TRACKED) rmSync(path, { recursive: true, force: true });
  const leftover = TRACKED.filter((path) => {
    try { lstatSync(path); return true; } catch { return false; }
  });
  assert.deepEqual(leftover, [], 'cleanup must remove every tracked path');
});
```

The hook carries two positive controls, one per mutation it must catch. The `assert.equal` catches
a `track` that stops recording: mutate away the push and the hook fails any run in which the helper
actually ran. Counting invocations rather than asserting non-emptiness is deliberate (plan-gate
round 1, Codex): a legitimate `--test-name-pattern` run that skips every test still fires the
file-level `after` hook, and a bare `TRACKED.length > 0` would fail that run; `0 === 0` passes it.
The `leftover` assertion catches a cleanup that stops deleting (review-ladder resumed pass,
`codex-adversarial`, confidence 0.99: with only the equality control, removing the `rmSync` loop
left every test green — the mutation evidence pinned the bookkeeping, never the deletion). It reads
each path with `lstatSync`, not `existsSync`, because `existsSync` follows symlinks and would
false-pass a dangling tracked link whose unlink failed after its target was removed. New import:
`lstatSync` joins the `node:fs` list.

New imports only: `rmSync` and `lstatSync` (node:fs), `after` (node:test). The helper is named `tracked`, not
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

1. All 14 `mkdtempSync` sites route through `tracked()` — the 13 listed plus `runContainment`'s —
   and the line-337 symlink is tracked; `runContainment` asserts `existsSync(dir)` is false after
   the shell settles, on success and refusal paths alike.
2. After `node --test tests/delegate-containment.test.js`, the temp locations hold no new
   `oai-containment-*`, `oai-not-the-right-prefix-*`, or `oai-delegate.*` entries created by the
   run (measured by listing before and after; positive control: the same measurement on the
   unfixed file shows a nonzero leak).
3. Full `npm test` green.
4. No existing test assertion changes — the diff is creation-site routing, tracking, imports, the
   hook, and the one added trap-removal assertion inside `runContainment` (plus `existsSync` is
   already imported).

## Verification

- Positive control first: run the file on the current code, count new temp entries (expect > 13).
- Fix, rerun, count again (expect 0).
- Mutation check (the key invariant — cleanup actually tracks): remove the `TRACKED.push(path)`
  line inside `track` via mutation-landed.py; the `after` hook's `assert.equal` must fail the
  run; restore, prove the restore against the backup.
- Second mutation check (cleanup actually deletes): remove the `rmSync` loop line via
  mutation-landed.py; the hook's `leftover` assertion must fail the run; restore, prove the
  restore against the backup.
- Full suite at the commit gate.
