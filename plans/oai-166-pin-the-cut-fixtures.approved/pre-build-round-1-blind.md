ARCHIVE — not the current spec; the plan beside it is
# OAI-166 — pin the fixtures OAI-161's scope cut left

## Context

OAI-161 (`6d06f6c`) fixed a real loss: retention could unlink the job log a live worker was still
salvaging its answer into. The code that fixes it is correct and is not in question here — one test
proves the exemption fires, and a mutation (`started_at IS NOT NULL` → `IS NULL`) reddens exactly it.

The feature was judged too big mid-build and cut by the user to "the minimum that fixes the loss".
Five of six planned fixtures were never built. What that leaves is a suite that cannot notice if
parts of `scripts/lib/job-retention.mjs` stop being correct — and two of the unpinned parts fail
**silently**: no throw, no log line, just a queue that looks healthy while it either stops collecting
history or quietly evicts it.

Every measurement below was taken during OAI-161 and recorded on the backlog item. None of it is
re-derived here. One premise from that record was **refuted at probe** and is corrected in fixture 2.

## What is unpinned, and why each obvious fixture does not work

`PRUNE` is `DELETE FROM jobs WHERE seq IN (SELECT … ORDER BY seq DESC LIMIT -1 OFFSET ?)`. Both
exemptions live in the **inner** `SELECT`, which is what makes an exempt row *uncounted* as well as
undeleted. Moved to the outer `DELETE`, each would spare its row and still spend one of the 50 kept
slots.

1. **`IS` vs `=`.** `json_extract` yields NULL for a row with no failure, and
   `NULL = 'operator-abandoned'` is NULL — `NOT (1 AND NULL)` is NULL, the `WHERE` drops the row, and
   every genuinely-run completed row leaves the candidate set and is never pruned again. Every
   existing fixture is insensitive because `fillTerminal` leaves `started_at` NULL, which
   short-circuits the conjunction to 0 before the comparison is reached.
2. **The `json_valid` guard.** `json_extract` throws on an unparseable payload, and `sweep()` runs in
   `task-submit.mjs` *before* the insert — so one corrupt `failure` row would sink every submission on
   the machine, not merely misfile a row.
3. **"Nor counted".** Measured: with the exempt row as the **oldest**, inner and outer placement both
   return `deleted=[2]` — identical, because an exempt row below the cutoff can never displace
   anything. The discriminating arrangement is `fillTerminal(RETAIN)` first, then the exempt row as
   the **newest**, asserting `deleted` is empty: inner gives `[]`, outer gives `[<oldest>]`.
   The existing **foreign-version** test has the same shape and the same blind spot — Codex confirmed
   at probe that its assertion holds identically under both placements, so the second half of its own
   title is unproven. That is a pre-existing gap this pass inherits, not one it introduces.
4. **The fork-3 narrowing** — that an operator-abandoned row which never ran is pruned like any other.
5. **No end-to-end proof** that a real live worker's log survives a real sweep.

## Decisions taken with the user (settled — not open for re-litigation)

- **A2** — leave the existing foreign-version test alone; **add a sibling** that proves only the
  not-counted half. Two halves, two witnesses, two independent mutations. (Codex steered the same.)
- **B1** — the end-to-end proof extends `tests/abandon-salvage.test.js`, which already drives a real
  worker across two processes with a held HTTP reply. Rebuilding that fixture elsewhere duplicates it.
  (Codex steered the same.)
- **Raw `UPDATE` with truncated JSON** for the corrupt payload. Note the probe **refuted** the
  OAI-161 record's claim that a raw `UPDATE` is *required*: `insertSynthetic` does
  `failure && JSON.stringify(failure)`, so `failure: ''` is falsy and passes through unchanged, and
  `json_valid('')` is 0. The raw `UPDATE` is chosen anyway because an empty string is a shape no real
  failure path writes, while a truncated payload is how a row actually gets corrupted.
- **Ship all six** rather than cutting again. The expensive part — deriving each discriminating
  arrangement — is already done and recorded.

## Phase 1 — `tests/retention.test.js`, four fixtures

Following the file's existing discipline: two rows in the same position differing in nothing but the
attribute under test.

**(1) The `IS`-vs-`=` control.** Two `completed` rows as the two oldest, both asserted pruned, one with
`startedAgoMs` set and `failure` NULL, one without. Under `=` the started one drops out of the
candidate set and survives; the control shows position and age were not what decided it.

**(2) The `json_valid` guard.** Insert a `failed` row with `startedAgoMs: 60_000` and an ordinary
`failure`, then corrupt it through `withStore` with
`UPDATE jobs SET failure = '{"reason":"oper' WHERE seq = ?`. `startedAgoMs` is required or the
short-circuit means `json_extract` is never reached **and the test cannot fail**. Assert *the sweep
completes and an ordinary over-cap row is still pruned* — never the malformed row's own fate, which
itself differs between `IS` and `=`.

**(3) "Nor counted", abandoned.** `fillTerminal(RETAIN)`, then the operator-abandoned ran row as the
**newest**; assert `deleted` is empty.

**(3b) "Nor counted", foreign version.** The same arrangement with `version: 99`, added beside the
existing test rather than replacing it.

**(4) The fork-3 narrowing.** An operator-abandoned row with **no** `started_at`, as the oldest,
asserted pruned with its log, against a ran-and-abandoned control in the same position that survives.

## Phase 2 — `tests/abandon-salvage.test.js`, the end-to-end proof

Between the abandon and `scenario.release()`, run `withStore(scenario.state, (db) => sweep(db, { retain: 0 }))` —
`withStore` because `sweep()` resolves the logs directory from ambient `OAI_PLUGIN_STATE`, not from
the handle it is given (confirmed at probe). Assert the row and its log both survive the sweep, then
let the existing salvage assertions run unchanged: the answer must still land in that file.

`retain: 0` makes the sweep maximally hostile — every non-exempt terminal row goes.

## Verification

1. `npm test` — full suite, quoting the summary line.
2. **Six mutations, one at a time, each proved landed with
   `~/Code/dotfiles/tests/mutation-landed.py`, the failing test named by hand, then restored and
   re-run green with the restore proved by `diff` against the backup.** A fixture whose mutation does
   not redden it is a finding, not a pass:
   - `IS ?` → `= ?` — must redden (1)
   - remove the `CASE WHEN json_valid(failure) THEN … END` wrapper — must redden (2)
   - relocate the abandonment clause from the inner `SELECT` to the outer `DELETE` — must redden (3)
   - relocate `schema_version <= ?` the same way — must redden (3b)
   - `started_at IS NOT NULL` → `IS NULL` — must redden (4) and the existing exemption test
   - remove the abandonment clause entirely — must redden the phase 2 end-to-end proof
3. The repo `verify` skill.

## Files

- `tests/retention.test.js` — four new tests
- `tests/abandon-salvage.test.js` — one sweep and two assertions inside the existing test
- `scripts/lib/job-retention.mjs` — **comment only**: the block ending "Neither is currently pinned by
  a test — the controls were cut with the rest of this feature's test matrix" stops being true.
- `CLAUDE.md` — no new line. This pins existing behaviour; the retention paragraph already describes
  it. Checked rather than assumed.

No production behaviour changes.
