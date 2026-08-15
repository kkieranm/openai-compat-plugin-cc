ARCHIVE — not the current spec; the plan beside it is
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

## Two traps, both proved by execution, both pinned by tests

Measured against this build's `node:sqlite` (SQLite 3.53.4):

- **`=` is not NULL-safe and would stop retention entirely.** `json_extract` returns NULL for a row
  with no `failure`, `NULL = 'operator-abandoned'` is NULL, `NOT (TRUE AND NULL)` is NULL, and a WHERE
  clause drops it — so with `=` an ordinary completed row falls out of the candidate set and **nothing
  is ever pruned again**, silently. Observed: the candidate set went from one row to empty. Use `IS`.
- **`json_extract` throws on an unparseable `failure`** (`malformed JSON`). `sweep()` runs in
  `task-submit.mjs:110` **before** anything is inserted or spawned, so one corrupt payload on the
  machine would sink every submission. Guard with `CASE WHEN json_valid(failure) THEN … END`.

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

## Phase 2 — unit tests (`tests/retention.test.js`)

Following the file's existing discipline: every exemption is asserted **with a positive control** —
two rows in the same position differing in nothing but the attribute under test.

- An operator-abandoned row that ran is neither deleted nor counted (control: a `failed` row of the
  same age with reason `worker-died` in the same position, which goes). Assert `deleted.length` too,
  or the counting half is untested.
- **Its log survives** — the actual harm. The existing exemption tests assert rows only.
- An operator-abandoned row that never ran is pruned like any other (the fork-3 narrowing).
- A row whose `failure` is not valid JSON does not break the sweep, and pruning proceeds around it.
- The NULL-safety trap: the existing "deletes finished jobs beyond the newest 50" test is already the
  positive control, since `fillTerminal` writes `completed` rows with a NULL `failure` — under `=` it
  goes red. Name that in a comment so a future editor cannot "simplify" `IS` back to `=`.

## Phase 3 — end-to-end proof (`tests/abandon-salvage.test.js`)

Extend the existing test rather than writing a new harness — it already drives a real worker to miss
its CAS across two processes. Between the abandon and `scenario.release()`, run `sweep(db, {retain: 0})`
in-process and assert the row and its log both survive; then release and assert the salvaged answer
lands in that surviving log. Under `retain: 0` every unexempt terminal row goes, so the exemption is
the only thing that can save it.

## Phase 4 — docs

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
3. **Mutation, on the key invariant.** Back up `job-retention.mjs`, delete the `AND NOT (…)` clause,
   prove the mutation landed with `~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the
   tests that fail (expected: the phase 2 exemption test and the phase 3 end-to-end one), restore, and
   prove the restore by `diff` against the copy.
4. A second mutation worth running because the trap is silent: change `IS` back to `=` and confirm the
   *unrelated* "deletes finished jobs beyond the newest 50" test goes red.

## Known limits, to be filed at the residue step

- Exempt rows accumulate without bound and there is no way to clear one. They also pile up in
  `/oai:status`, which lists every row for the workspace with no cap.
- A row abandoned while `queued` is still pruned with its log. Correct by the fork-3 reasoning, but it
  means a worker that had registered and was about to acquire loses its log on the ordinary schedule.
