provenance: harness slug mutable-brewing-music

# OAI-161 — a salvaged answer must outlive the retention sweep

## Context

`/oai:abandon` (shipped 2026-08-15, `6d41bd0`) created a category this queue never had: **a terminal
row whose worker may still be alive.** Retention was built on the opposite assumption.

The loss, verified against the code:

1. An operator abandons a row whose worker is genuinely running.
2. The worker's model call returns. It calls `finish()`, its compare-and-set matches nothing (the row
   is already terminal), and it writes the answer to its job log as a `SALVAGED_OUTCOME` line —
   `cmd-task-worker.mjs:180`.
3. That row is terminal, so once 50 newer terminal rows exist `job-retention.mjs` `sweep()` prunes it,
   and the orphan sweep **in the same call** unlinks `<seq>.log`.
4. `job-spawn.mjs` handed the worker that log as its stdout/stderr descriptor, so the worker keeps
   writing into an unlinked inode and the answer dies with the process.

Intended outcome: **the salvaged answer survives for as long as the row does.** `/oai:result` already
prints the log path for a `failed` row (`cmd-result.mjs:74`), so the reader exists — only the file's
survival was missing.

### Settled before this plan

Three forks, each recommended independently by Claude and Codex and confirmed by the user:

- **Arm B.** Never prune an operator-abandoned row, and do not count it toward the retain ceiling —
  matching the module's existing asymmetric exemption for rows a newer plugin wrote. Rejected:
  a live-pid exemption (cheap, since `finish` leaves `waiter_pid` and `claimJob` writes the same
  number to both — but it dies with the worker, turning "never readable" into "readable until the next
  submission"); salvaging by path; the incarnation-keyed store of OAI-149.
- **Unbounded growth accepted**, filed as a stated limit rather than fixed. No clear command, no
  second cap, no time window — each of those reintroduces the loss further away.
- **Narrowed to rows that reached `running`.** `claimJob` sets `state='running'` and `started_at` in
  one statement before the worker can contact the model, so a row abandoned while still queued
  provably sent nothing and has no paid-for answer to protect.

## Two traps, both proved by execution — and after the scope cut, neither is pinned

Measured against this build's `node:sqlite` (SQLite 3.53.4):

- **`=` is not NULL-safe and would stop retention pruning genuinely-run rows.** `json_extract`
  returns NULL for a row with no `failure`, `NULL = 'operator-abandoned'` is NULL, `NOT (TRUE AND
  NULL)` is NULL, and a WHERE clause drops it — so with `=` an ordinary completed row falls out of the
  candidate set and is never pruned, silently. Use `IS`.
- **`json_extract` throws on an unparseable `failure`** (`malformed JSON`). `sweep()` runs in
  `task-submit.mjs:110` **before** anything is inserted or spawned, so one corrupt payload on the
  machine would sink every submission. Guard with `CASE WHEN json_valid(failure) THEN … END`.

**BOTH traps are reachable only when `started_at IS NOT NULL`**, because `AND` short-circuits on `0`:
for a row with a NULL `started_at` the second operand is never evaluated, `NOT (0 AND NULL)` is `NOT 0`
is 1 under **either** operator, and `json_extract` is never called at all. Measured on the real clause —
with `IS` the candidate set was `[1, 2, 4, 5, 6]`, with `=` it was `[1, 4, 6]`, and the row that moved
is the one with `started_at` set and `failure` NULL.

The consequence: **every fixture in the suite today is insensitive to both mutations.** `fillTerminal`
calls `insertSynthetic` without `startedAgoMs`, which defaults to null, so the suite goes green with
`IS` changed to `=` and green again with the `json_valid` guard stripped. Production is not
insensitive — every genuinely run row has `started_at` set. **The controls that would catch these were
cut; the traps are real and remain unpinned, and that is filed as residue rather than glossed.**

## Phase 1 — the exemption

**`scripts/lib/job-record.mjs`** — export `OPERATOR_ABANDONED = 'operator-abandoned'` beside
`TERMINAL_STATES`. It is currently a literal in `job-abandon.mjs:169` (the writer) and would become a
second literal in retention (a reader that must agree); both modules already import `job-record.mjs`,
so this is one definition with no new import edge and no cycle. Update `job-abandon.mjs:169` to use it.

**`scripts/lib/job-retention.mjs`** — add the clause to `PRUNE`'s inner `SELECT`:

```sql
AND NOT (started_at IS NOT NULL
         AND (CASE WHEN json_valid(failure) THEN json_extract(failure, '$.reason') END)
             IS ?)
```

bound to `OPERATOR_ABANDONED`, ordered ahead of `retain` in the `.all()` arguments. **Placing it in
the inner `SELECT` rather than the outer `DELETE` is what makes exempt rows uncounted as well as
undeleted** — the same construction `schema_version <= ?` already uses, and the reason no second
statement and no two-phase select/filter/delete is needed. The value is a bound parameter, not
interpolation, so the module's SQL stays static.

Rewrite the module header's numbered exemption list from two entries to three, stating for the new one:
why it exists (a terminal row can now have a live worker), why it reads no pid (a liveness-keyed
exemption would inherit OAI-162, where a malformed pid reads dead), why it is narrowed to
`started_at`, and that its growth is unbounded and accepted.

## Phase 2 — the one test (`tests/retention.test.js`)

**SCOPE CUT, 2026-08-15, by the repo owner: this feature was judged too big mid-build.** The plan
originally specified five fixtures across two files. One ships. Everything else is filed as residue —
listed under "Known limits" below, with what was already measured about each so it is not re-derived.

The one test, following the file's existing discipline of a **positive control** — two rows in the
same position differing in nothing but the attribute under test:

**An operator-abandoned row that ran is not deleted, and its log survives.** Insert it as the oldest,
with a `failed` control of the same age carrying reason `worker-died` beside it, then `fillTerminal`
above them. The control goes; the abandoned row and its `<seq>.log` stay. The log assertion is the
point — it is the actual harm, and the module's existing exemption tests assert rows only.

## Phase 3 — docs

- **`cmd-task-worker.mjs`** `salvageOutcome` docblock currently states the OAI-161 bound as live
  ("once 50 newer terminal rows exist the retention sweep prunes it"). Replace with what is now true
  and what is still not: the row and its log are exempt, so the answer lasts as long as the row; it is
  still not a durable store with a lifecycle of its own.
- **`cmd-abandon.mjs:125`** — the comment citing OAI-161 says the pending cancellation is bounded by
  retention pruning the row. For a row that ran, that bound is gone.
- **`commands/result.md:36`** and **`commands/status.md:75`** state "only the newest 50 finished jobs
  are kept" without qualification, which the exemption makes false. Same for the hint at
  `cmd-result.mjs:109`.
- **`CLAUDE.md`** — extend the existing one-line `job-retention.mjs` note (line 109) with the
  exemption and its symbol. One line, present tense, naming the design not the defect.

## Verification

1. `npm test` — full suite, quoting the summary line.
2. The repo `verify` skill (`.claude/skills/verify/SKILL.md`): real plugin load plus a delegation
   round trip.
3. **Mutation, on the key invariant.** Back up `job-retention.mjs`, delete the `AND NOT (…)` clause
   **and its `OPERATOR_ABANDONED` binding together** — dropping the clause alone leaves an extra bound
   parameter, so `.all()` throws on every call and the suite fails indiscriminately instead of naming
   the test that is actually sensitive. Prove the mutation landed with
   `~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the test that fails (expected: the
   phase 2 exemption test), restore, and prove the restore by `diff` against the copy.

**The `IS` and `json_valid` mutations are NOT run, because after the cut nothing would catch them.**
Saying that plainly is the point: the code keeps both — they are correct and the guard is what stops a
corrupt payload throwing inside a pre-insert sweep — but their controls were cut, so this run makes no
claim that they are pinned. See the residue below.

## Known limits, to be filed at the residue step

Accepted by design:

- Exempt rows accumulate without bound and there is no way to clear one. They also pile up in
  `/oai:status`, which lists every row for the workspace with no cap.
- A row abandoned while `queued` is still pruned with its log. Correct by the fork-3 reasoning, but it
  means a worker that had registered and was about to acquire loses its log on the ordinary schedule.

Cut from this feature on 2026-08-15, each already measured — file with the measurement so none of it
is re-derived:

- **The `IS`-vs-`=` control.** Unbuilt, so the NULL-safety trap is unpinned. The one fixture that
  discriminates is a `completed` row with `startedAgoMs` set and `failure` NULL, asserted pruned.
- **The malformed-payload test.** Unbuilt, so the `json_valid` guard is unpinned. It needs
  `startedAgoMs` set (or the short-circuit means `json_extract` is never reached and the test cannot
  fail), and the row must be inserted normally then corrupted by a raw `UPDATE` through `withStore` —
  `insertSynthetic` does `failure && JSON.stringify(failure)`, which turns even `'{'` into valid JSON.
  It must assert *the sweep completes and an ordinary over-cap row is still pruned*, never the
  malformed row's own fate, which differs between `IS` and `=`.
- **The "nor counted" half of arm B is untested, and the obvious fixture cannot test it.** Measured:
  with the exempt row as the oldest, the correct implementation (clause in the inner `SELECT`) and the
  wrong one (clause moved to the outer `DELETE`, which deletes-but-counts) both produce `deleted=[2]` —
  identical, because an exempt row below the cutoff can never displace anything. The discriminating
  arrangement is `fillTerminal(RETAIN)` first, then the operator-abandoned ran row as the **newest**,
  asserting `deleted` is empty: inner placement gives `[]`, outer gives `[1]`. The matching mutation is
  relocating the clause from the inner `SELECT` to the outer `DELETE`.
  Note the existing foreign-version exemption test has the same shape and the same blind spot.
- **The fork-3 narrowing test** — an operator-abandoned row that never ran is pruned like any other.
- **The end-to-end proof** in `tests/abandon-salvage.test.js`: a `sweep(db, {retain: 0})` between the
  abandon and the release, driven through `withStore(scenario.state, …)` because `sweep()` resolves the
  logs directory from ambient state rather than from the handle it is given.
