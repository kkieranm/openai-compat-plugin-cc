provenance: no harness plan-mode session (operator asked this session to skip the interactive plan-mode
gate); authorized instead by the same dual-approval plan gate below (Codex + an independent Claude
verdict subagent, both against this plan's digest) that /feature's step 3 otherwise runs alongside
harness plan-mode, not in place of it

# OAI-160: the dead/never-started note blames the wrong version

## Context

`job-render.mjs`'s `noteFor` (line 143-144) has one unconditional message for `display === 'dead'`
or `'never-started'`:

```
written by a newer plugin (row schema ${view.schema_version}), so this build will not touch it.
```

The docblock above `displayOf` in `job-view.mjs` (lines 79-82) claims this state is reachable "only
on a row reconciliation could not touch — one a newer plugin wrote." That's false in at least two
distinguishable ways, both real:

**(A) A too-new database, proved by execution** (BACKLOG.md's OAI-160 entry): `cmd-status.mjs`'s
`runStatus` only calls `reconcileAll(db)` when the database opens **writable** (line 55); when the
database's own `PRAGMA user_version` is too new, `openJobs()` returns `readOnly: true` (job-view.mjs
line 40) and `runStatus` calls `tooNewNotice(version)` instead (cmd-status.mjs line 52) —
**reconciliation never runs at all**, for every row, regardless of that row's own `schema_version`.
So an ORDINARY row this build understands (`schema_version` known, e.g. `1`), whose worker has
genuinely died, reaches `viewOf` → `displayOf` → `'dead'` without ever getting a chance at
reconciliation, and `noteFor` prints "written by a newer plugin (row schema 1)" — self-contradictory,
since schema `1` is exactly what this build understands.

**(B) A TOCTOU race on an ordinary writable database, found by Codex at plan-gate round 2.**
`runStatus` performs two SEPARATE liveness observations: `reconcileAll` probes each row once
(line 55), and `statusView`/`viewOf` (called after, to build what gets rendered) probes liveness
again independently. A known-schema worker can be alive at the first probe (so `reconcile()` leaves
it as `running`/`queued`, nothing to collect) and die before the second probe — that row then also
renders `dead` (or crosses the `never-started` threshold similarly for a queued row), on a perfectly
ordinary, current-version, writable database. `isKnownVersion(view)` is `true` here too, so a branch
that only checks that flag (the round-1 design) would ALSO wrongly claim "the database was written
by a newer plugin" in this case, where in fact the database is fine — it's a benign timing race.

So the message needs **three** branches, not two, and needs `readOnly` in scope (not just
`isKnownVersion(view)`) to tell (A) apart from (B):

- Row schema unknown → genuinely a foreign row (unchanged from today).
- Row schema known AND `readOnly` → case (A): the database itself is too new; nothing was
  reconciled this run at all.
- Row schema known AND NOT `readOnly` → case (B): reconciliation DID run this pass and found
  nothing wrong at the time; something about the row (its liveness, or a timing threshold like the
  startup grace period) changed in the narrow window between that check and this render — not
  necessarily a worker state change, since a `never-started` row can cross `STARTUP_GRACE_MS` with
  no worker ever having existed. Not a version story at all.

This is a real, currently-live defect for case (A) — confirmed by an existing test that already
reproduces it without asserting on the note text: `tests/status.test.js`'s `'a database a newer
plugin wrote is read, said so, and never written to'` (line ~176) inserts a `schema_version: 1`
(default) row with a dead worker pid, sets the database's `PRAGMA user_version` to 99 via
`setUserVersion`, and runs `status --all`. Case (B) is real but not deterministically reproducible
through the black-box CLI test harness — it requires a process to die in a sub-millisecond window
between two liveness probes inside one synchronous command invocation, which this repo's test
helpers have no seam to control. The race itself remains untested for that reason, but the branch's
logic is directly covered without reproducing the race — see the amended Verification section below,
which replaces this plan's original "untested by design" disposition.

The eleven pure-coverage-debt branches and two unpinned timing constants a prior review pass also
found were already split out as OAI-191 (BACKLOG.md, 2026-08-19) and are explicitly out of scope
here.

## Change

**`scripts/lib/job-render.mjs`**:

- `noteFor`'s signature gains a third parameter: `noteFor(view, nowMs, readOnly)` (no default —
  every call site below is updated to pass it explicitly, so a forgotten call site fails loudly via
  a test rather than silently defaulting to the wrong branch).
- Its `dead`/`never-started` branch (currently lines 143-145) becomes three-way, keyed on
  `isKnownVersion(view)` (already imported, used at line 94 in `malformedNote`) and the new
  `readOnly` parameter:
  - Row schema unknown (`!isKnownVersion(view)`) — unchanged message: this genuinely is a row a
    newer plugin wrote.
  - Row schema known AND `readOnly` — new message naming the real cause: the database itself, not
    this row. Wording to match this file's tone and `tooNewNotice`'s phrasing: something like `the
    job database itself was written by a newer version of the plugin, not this row — its own schema
    (${view.schema_version}) is understood, but nothing here was reconciled, collected or written
    this run.`
  - Row schema known AND NOT `readOnly` — new message naming the race, cause-neutral between a
    liveness change and a timing threshold (revised after Group B review below): something like
    `its own schema (${view.schema_version}) is understood and this build did reconcile the
    database this run, but the row still shows ${view.display} — something about it (its liveness,
    or a timing threshold like the startup grace period) changed between that check and this
    render.` The earlier "its worker likely changed state" draft was shipped, then found false for
    `never-started` by `codex-adversarial` and `codex-plain` in review-ladder pass 1 (a queued row
    can cross `STARTUP_GRACE_MS` with no worker ever having existed to change anything) and reworded
    to the neutral phrasing above before commit.
- `renderList` (line 196) already receives `readOnly` in its options; pass it through to
  `noteFor(view, nowMs, readOnly)` at its one call site (currently line 223).
- `renderDetail` (line 256) gains `readOnly = false` in its options object (a default is fine here —
  see below), and passes it to `noteFor(view, nowMs, readOnly)` at its one call site (currently line
  260).

**`scripts/lib/cmd-status.mjs`**: `showOne` (line 33) gains a `readOnly` parameter —
`showOne(db, id, nowMs, readOnly)` — and passes `{ nowMs, readOnly }` to `renderDetail`. Its one
call site (currently line 61, inside `runStatus`, where `readOnly` is already destructured at line
51) becomes `showOne(db, id, nowMs, readOnly)`. (`renderDetail`'s own default of `false` is safe as
a fallback for any OTHER caller — none currently exists outside this file and its own tests — but
this repo's one real caller is updated to pass the true value explicitly, not to rely on it.)

**`tests/status.test.js`**: extend the existing test `'a database a newer plugin wrote is read, said
so, and never written to'` with an assertion on the `foreign` row's note text (case A) — that it
does NOT say "written by a newer plugin (row schema 1)" (the self-contradiction), and that it does
contain something naming the database rather than the row.

**`tests/queue-reconcile.test.js`**: added during review-ladder pass 1, at `codex-adversarial`'s and
`codex-plain`'s own suggestion, in place of the "untested by design" disposition this plan originally
carried for case (B) — both found case (B) directly coverable by seeding a synthetic known-schema,
writable row and rendering it through the exported `renderList`/`statusView` path, bypassing
`reconcileAll` entirely rather than needing to reproduce the sub-millisecond race end to end. Two new
tests: `'a known-schema dead row on a writable database is not blamed on a version or a worker it
does not have'` and `'a known-schema never-started row on a writable database is not blamed on a
worker that never existed'`. Both assert the message names neither a foreign plugin nor the
too-new-database story; the second additionally asserts it does not claim a worker changed state
(the false wording found and reworded above). Both also assert the message does contain "schema (1)
is understood."

**`scripts/lib/job-view.mjs`**: the docblock above `displayOf` (lines 79-82) currently claims
`dead`/`never-started` is reachable "only on a row reconciliation could not touch — one a newer
plugin wrote." Update it to name both real causes established above (the too-new-database case and
the reconcile/render timing race), and avoid re-asserting that those two are exhaustive — round-2
Codex review flagged that the enumeration itself must not overclaim completeness. (Codex plan-gate
round 1, `CHANGES-REQUIRED`: flagged the original stale claim as a concrete defect; an independent
Claude verdict subagent's round-1 review flagged the same gap as a non-blocking observation. Codex
plan-gate round 2, `CHANGES-REQUIRED`: flagged the TOCTOU race this version now accounts for.)

## Verification

- `npm test` green.
- The extended assertion in `tests/status.test.js` (case A) fails on the current code and passes
  after the fix — this doubles as the step 5 mutation check for that branch: reverting the
  `job-render.mjs` change reproduces the red test.
- Case (B)'s branch logic (schema known, not readOnly → race wording) is directly covered, not stated
  as untested: the two `tests/queue-reconcile.test.js` tests above seed a synthetic row and render it
  through `renderList`/`statusView` without going through `reconcileAll`'s actual timing race — this
  exercises the same branch the race would land in, deterministically, rather than reproducing the
  sub-millisecond window itself (which remains genuinely unreproducible through the black-box CLI
  harness, but is no longer what the tests are standing in for). Mutation-proven: reverting the
  `never-started` branch's wording back to "its worker likely changed state" reproduces a red test
  naming the false claim; restored and reconfirmed green.
