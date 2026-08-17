provenance: harness slug quirky-greeting-spark

# OAI-170 — measure the sensitivity of the foreign-version "never deleted" witness

## Context

`PRUNE` in `scripts/lib/job-retention.mjs` exempts a row a newer plugin wrote, via one
`schema_version <= ?` clause in its inner `SELECT` (line 92). That exemption makes two promises, and
`tests/retention.test.js` has a test for each:

- **"a row a newer plugin wrote is never deleted"** (line 48) — pre-existing, predates OAI-166.
- **"a row a newer plugin wrote does not consume one of those places either"** (line 206) — added by
  OAI-166 to cover the placement half, which only discriminates from the newest end.

OAI-166 ran one mutation for this clause: **relocating** it from the inner `SELECT` to the outer
`DELETE`, which reddens the sibling at 206. The mutation that would redden the **original** at 48 —
removing the clause outright — was listed nowhere and never run. So one half of the exemption ships
with a measured witness and the other with an assumed one. That asymmetry is OAI-170, filed
2026-08-15. Probe confirmed all three claims TRUE via Codex (`task-msx106vn-u2n467`): one clause, both
tests present as described, and the plan's mutation list at line 116 naming only the relocation.

The intended outcome is that both halves have measured sensitivity, and that the measurement is
recorded where the next editor of that test will see it rather than only in this session's transcript.

## The mutation, and why it is two proved edits rather than one

Removing `AND schema_version <= ?` from the SQL alone breaks parameter arity — `prune()` binds
positionally, `.all(...TERMINAL_STATES, ROW_SCHEMA_VERSION, OPERATOR_ABANDONED, retain)` (line 104) —
so the suite would go red on a bind error rather than on the behaviour under test. A red for the wrong
reason measures nothing. The removal is therefore **two coordinated edits**, each proved landed
separately by `~/Code/dotfiles/tests/mutation-landed.py` against its own immediately-preceding backup
(the helper proves one occurrence per call):

1. In `PRUNE`, `WHERE state IN (${STATES}) AND schema_version <= ?` → `WHERE state IN (${STATES})`.
2. In `prune()`, drop `ROW_SCHEMA_VERSION, ` from the `.all(…)` argument list.

Arity after both: `STATES` placeholders, then `IS ?` (`OPERATOR_ABANDONED`), then `OFFSET ?`
(`retain`) — correct, so the query runs and the only change is that foreign-version rows re-enter the
candidate set.

**Predicted result, to be confirmed rather than assumed.** At test 48 the fixture inserts `foreign`
then `ours` as the two oldest of 52 terminal rows; with the exemption gone the candidate set is all 52,
`ORDER BY seq DESC LIMIT -1 OFFSET 50` takes the two oldest, so `deleted` has two entries and
`assert.deepEqual(deleted, [ours])` fails, as does `readJob(state, 'foreign')`. The same mutation is
expected to redden 206 as well (there `foreign` is newest, so `deleted` becomes `[kept[0], kept[1]]`).
Reddening both is fine — the claim being established is about 48, which had no measurement at all.

**If it does NOT redden 48, that is the finding**, not a pass: the test would be witnessing something
other than the exemption, and closing OAI-170 would then mean fixing the test rather than recording a
measurement. Handle it at that point; do not pre-design the fix.

## The change

`tests/retention.test.js` only — **one comment** at the test on line 48, in that file's existing
voice, naming the mutation that witnesses it and the date measured. Nothing else; no production change,
no new test.

The comment states what was tried and what happened — never that the test "cannot" fail otherwise, and
never a claim about all possible mutations. It also records that the removal is two edits because of the
binding, since that is the part a future editor would get wrong when re-running it. This mirrors how
the sibling at 206 and `retention-files.test.js` already carry their own blind-spot and control notes,
and `job-retention.mjs`'s docblock already delegates "which fixture pins what" to the test file.

## Verification

1. `npm test` green first, to have a baseline (`node --test "tests/**/*.test.js"` — the path scope is
   load-bearing, see CLAUDE.md footguns).
2. The mutation as specified above: `cp` backup, target and replacement written to files **before**
   each edit, `mutation-landed.py` printing `LANDED` for each of the two edits, then the whole suite
   run and **the failing test named by hand**. The universe is the literal `npm test`, not one file —
   a "only this test reddened" claim measured over one file is a claim about that file.
3. Restore from the pre-mutation backup and prove it by `diff` against that copy, never by eye and
   never with `git diff --quiet`. Re-run `npm test` green.
4. The repo `verify` skill (`.claude/skills/verify/SKILL.md`).
5. **No separate step-5 mutation on the deliverable itself.** The deliverable is a comment; there is no
   invariant a single edit can break, and the mutation in step 2 *is* this item's substance. Stated and
   skipped rather than manufactured.

## Close-out

- Commit `tests/retention.test.js` by pathspec, message recording the two-edit mutation, the test that
  reddened, and that no production behaviour changed.
- Separate commit moving OAI-170 to `BACKLOG_DONE.md` with the measured result, and removing it from the
  Tier 2 index line in `BACKLOG.md`.
