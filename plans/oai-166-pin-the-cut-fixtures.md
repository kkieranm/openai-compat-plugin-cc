provenance: harness slug breezy-herding-dewdrop

# OAI-166 — pin the fixtures OAI-161's scope cut left

> **Amended after approval at digest `6c2033c80daa`.** The approved bytes are
> [`oai-166-pin-the-cut-fixtures.approved/pre-build-round-1-blind.md`](oai-166-pin-the-cut-fixtures.approved/pre-build-round-1-blind.md);
> `diff` it against this file for what changed.

## Context

OAI-161 (`6d06f6c`) fixed a real loss: retention could unlink the job log a live worker was still
salvaging its answer into. The code that fixes it is correct and is not in question here — one test
proves the exemption fires, and a mutation (`started_at IS NOT NULL` → `IS NULL`) reddens it.

The feature was judged too big mid-build and cut by the user to "the minimum that fixes the loss".
Five of six planned fixtures were never built. What that leaves is a suite that cannot notice if
parts of `scripts/lib/job-retention.mjs` stop being correct — and two of the unpinned parts fail
**silently**: no throw, no log line, just a queue that looks healthy while it either stops collecting
history or quietly evicts it.

Every measurement below was taken during OAI-161 and recorded on the backlog item. None of it is
re-derived here. One premise from that record was **refuted at probe** and is corrected in fixture 2.

## What is unpinned, and why each obvious fixture does not work

`PRUNE` is `DELETE FROM jobs WHERE seq IN (SELECT … ORDER BY seq DESC LIMIT -1 OFFSET ?)`. The
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
   anything. That is what puts the exempt row at the **newest** end in every placement fixture; the
   arrangement as built is in Phase 1.
   The existing **foreign-version** test has the same shape and the same blind spot — Codex confirmed
   at probe that its assertion holds identically under both placements, so the second half of its own
   title is unproven. That is a pre-existing gap this pass inherits, not one it introduces.
4. **The fork-3 narrowing** — that an operator-abandoned row which never ran is pruned like any other.
5. **No end-to-end proof** that a real live worker's log survives a real sweep.

## Decisions taken with the user (settled — not open for re-litigation)

- **A2** — leave the existing foreign-version test alone; **add a sibling** that proves only the
  not-counted half. Two halves, two witnesses. (Codex steered the same.)
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

## Phase 1 — `tests/retention.test.js`, five fixtures (six after the post-approval addition)

**(1) The `IS`-vs-`=` control.** Two `completed` rows as the two oldest, both asserted pruned, one with
`startedAgoMs` set and `failure` NULL, one without. Under `=` the started one drops out of the
candidate set and survives; the control shows position and age were not what decided it.

**(2) The `json_valid` guard.** Insert a `failed` row with `startedAgoMs: 60_000` and an ordinary
`failure`, then corrupt it through `withStore` with
`UPDATE jobs SET failure = '{"reason":"oper' WHERE seq = ?`. `startedAgoMs` is required or the
short-circuit means `json_extract` is never reached **and the test cannot fail**. Assert *the sweep
completes and an ordinary over-cap row is still pruned* — never the malformed row's own fate, which
itself differs between `IS` and `=`.

**(3) "Nor counted", abandoned.** `fillTerminal(RETAIN + 1)`, then the operator-abandoned ran row as
the **newest**; assert `deleted` is exactly the one ordinary row over the ceiling.

**(3b) "Nor counted", foreign version.** The same arrangement with `version: 99`, added beside the
existing test rather than replacing it.

**(4) The fork-3 narrowing.** An operator-abandoned row with **no** `started_at`, as the oldest,
asserted pruned with its log, against a ran-and-abandoned control in the same position that survives.

**(5) "Nor counted", ACTIVE job — added post-approval.** Same `RETAIN + 1` shape. The module names
**three** exemptions, and
the plan as approved gave placement fixtures to two. The pre-existing active-job test asserts
`deleted.length === 5` with the active rows OLDEST, which holds identically under either placement —
the same blind spot, in the exemption that had never been suspected of it. Same arrangement, with a
`running` row as the newest.

## Phase 2 — `tests/abandon-salvage.test.js`, the end-to-end proof

Between the abandon and `scenario.release()`, run `withStore(scenario.state, (db) => sweep(db, { retain: 0 }))` —
`withStore` because `sweep()` resolves the logs directory from ambient `OAI_PLUGIN_STATE`, not from
the handle it is given (confirmed at probe). Assert the row and its log both survive the sweep, then
let the existing salvage assertions run unchanged: the answer must still land in that file.

`retain: 0` makes the sweep maximally hostile — every non-exempt terminal row goes. **An ordinary
terminal row is inserted before the abandon and asserted DELETED in the same breath**, because
survival alone is satisfied by a sweep that did nothing; and `withBusyRetry` with an explicit 2s
budget over a 250ms `busy_timeout` keeps the collision with the worker's heartbeat from blocking the
event loop that hosts the fake server.

## Verification

1. `npm test` — full suite, quoting the summary line.
2. **Mutations, one at a time, each proved landed with
   `~/Code/dotfiles/tests/mutation-landed.py`, the failing test named by hand, then restored and
   re-run green with the restore proved by `diff` against the backup.** A fixture whose mutation does
   not redden it is a finding, not a pass:
   - `IS ?` → `= ?` — must redden (1)
   - remove the `CASE WHEN json_valid(failure) THEN … END` wrapper — must redden (2)
   - relocate the abandonment clause from the inner `SELECT` to the outer `DELETE` — must redden (3)
   - relocate `schema_version <= ?` the same way — must redden (3b)
   - `started_at IS NOT NULL` → `IS NULL` — must redden (4) and the existing exemption test
   - relocate `state IN (…)` the same way — must redden (5), the post-approval fixture
   - remove the abandonment clause entirely — must redden the phase 2 end-to-end proof
   - the corrupt fixture's `UPDATE` aimed at a row that does not exist — must redden (2), proving
     that control reaches the code it controls
   - `fillTerminal(state, RETAIN + 1)` → `RETAIN` in the ABANDONED "nor counted" fixture — reddens
     its pre-sweep row-count assertion, which executes before `runSweep` and is therefore the only
     thing this mutation proves can fire. It says nothing about the `deleted` assertion; that is
     covered by the inertness and placement mutations below.
   - **`AND 0` added to `PRUNE`'s inner `WHERE`** — makes the statement inert while preserving its
     syntax and its bindings, which `return []` in `prune()` would not. Without this the
     positive controls added to every placement fixture are themselves unwitnessed.
   - **`orphanSeqs`'s final `return` replaced with `[]`** — the same for the file half.
   **The universe is the literal command `npm test`** (`node --test "tests/**/*.test.js"`), not a
   single test file: "only this test reddened" measured over one file is a claim about that file.
3. The repo `verify` skill.

## Files

- `tests/retention.test.js` — six new tests (five planned, one added post-approval); the three
  placement fixtures amended to the positive-control shape; the file-collection tests MOVED OUT
- `tests/retention-files.test.js` — **new**: the file half of the suite — the moved tests, plus a
  collectible orphan so an inert `orphanSeqs` cannot pass them
- `tests/retention-helpers.mjs` — **new**: `logPath`, `ackPath`, `writeLog`, `fillTerminal`,
  `runSweep`, `assertCorruptAndReachable`. The split was forced by the 300-line size ratchet in
  `tests/structure.test.js`, whose `ALLOWLIST` is empty
- `tests/abandon-salvage.test.js` — a control row and its log inserted before the abandon, the sweep
  wrapped in `withBusyRetry` with an explicit budget over an explicit `busy_timeout`, five assertions
- `scripts/lib/job-retention.mjs` — **comment only**.
- `CLAUDE.md` — no new line. This pins existing behaviour; the retention paragraph already describes
  it. Checked rather than assumed.

No production behaviour changes.
