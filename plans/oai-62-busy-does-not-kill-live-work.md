# OAI-62 — a contended database must not kill live work

provenance: written directly to `plans/` — the harness plan-mode round trip was skipped deliberately,
because `ExitPlanMode` blocks on a user who is asleep and who has directed plan approval to Codex.
Recorded as a deviation at the residue step.

## Context

`SQLITE_BUSY` is handled at some sites in the job store and not others, and the gaps are not
cosmetic — two of them destroy work that has already been paid for.

**Probed 2026-08-07 (Codex, plus one local reproduction). All four claims substantively TRUE; three
carried stale line numbers, corrected here, and one was factually wrong in a way that matters.**

- **(a) The heartbeat kills the worker outright.** `job-heartbeat.mjs:57-60` runs `beat()` and
  `cancelRequested()` inside a `setInterval` callback with no `try/catch`. **Reproduced today**: a
  handle whose `prepare()` throws `errcode 5` exits the process 1, with the stack
  `beat (job-record.mjs:177) ← job-heartbeat.mjs:58 ← Timeout._onTimeout`. So a contended database
  kills a worker **mid-model-call**, discarding a request already in flight.
- **(b) `finish` discards a completed answer.** `cmd-task-worker.mjs:79` (completed) and `:119`
  (failed) call `finish()` with no busy handling. A lock held past the 10s `busy_timeout` **after the
  model has answered** turns the outer catch into a storage-error report and the answer is gone.
  The item cited `:74`; that line is `chatCompletion()`.
- **(c) `openStore` throws at the line whose comment says it cannot.** The real site is
  `job-store.mjs:217-218`, not `:151` (the file has drifted; `:151` is now inside `SCHEMA`).
  `db.exec('PRAGMA journal_mode = WAL')` takes an exclusive lock, and the comment at `:210-216`
  claims "Every statement after this line waits instead." It does not. Three sightings in the wild,
  two distinct call sites, one trigger (overlapping `npm test` runs). Rate unmeasured.
- **Correction to the item.** `cancelRequested` (`job-record.mjs:208`) is a `.get()` **read**, not a
  `.run()` write. The "no busy retry" point stands; the description did not.
- **A fourth site the item does not name.** `awaitTurn`'s polling loop calls a bare `beat()` at
  `job-queue.mjs:152`, outside any `try/catch` — the same defect in the same helper, one phase earlier
  in the same lifecycle.
- **`isBusy(error)` already exists** at `job-store.mjs:135` and is used at `job-queue.mjs:111` and
  `task-submit.mjs:97`. Whatever is added reuses it; nothing re-defines what busy means.
- **Measured, and it reframes (c):** `journal_mode = WAL` **persists in the database file** across
  opens. Verified locally — set it, close, reopen, and `PRAGMA journal_mode` still reads `wal` before
  anything sets it. So the exclusive-lock statement is needed on the **first open ever** and on no
  other, which means (c) is fixable by *not taking the lock* rather than by waiting on it.

## Forks settled with Codex (the user is asleep and directed design forks there)

- **A1 — one policy-neutral helper.** `withBusyRetry()` beside `isBusy()`, both in `scripts/lib/job-busy.mjs` (see the phase 1 amendment). It
  retries **only** busy, rethrows a non-busy error immediately, and rethrows the final busy error.
  Callers decide what that means. **Sites that only need to skip keep a plain `isBusy()` catch and do
  not go through retries** — forcing one policy on six call sites is how the helper becomes wrong.
- **B1 — the heartbeat skips the tick.** Catch busy around the two database operations and continue;
  the next beat is already scheduled and the stale-beat → `stalled` path represents a missed update
  correctly. **The catch is narrowed to `isBusy`** — a non-busy error still kills the worker, because
  that is a defect, not contention. **`onCancel()` is invoked OUTSIDE the catch**: silently losing a
  cancellation is worse than surfacing a callback defect.
- **C1 — `finish` retries, bounded, then reports.** On exhaustion it reports a storage error and the
  answer is lost. Persisting the answer elsewhere is a **second source of truth** that `/oai:result`
  would have to learn to read — a payload decision, filed separately, not a locking fix. Indefinite
  retry can wedge the worker and the queue behind it. **Both terminal writes get the same discipline.**
  **The bound is ELAPSED TIME, not an attempt count**: each attempt already carries a 10s
  `busy_timeout`, so "five attempts with backoff" can exceed 80 seconds.
- **D1 — conditional WAL plus a retry backstop.** Read `PRAGMA journal_mode` first (a plain read, no
  exclusive lock) and execute the set **only when it is not already `wal`**; wrap the open in a bounded
  busy retry for the genuine first-open race. **A retry must close any handle it opened before
  retrying**, or the fix leaks handles under contention. The `:210-216` comment is false as written and
  is replaced, not patched.
- **E1 — the fourth site is in scope.** One line, same helper, same lifecycle; excluding it ships a fix
  whose own tracker item is reopened by the same error.

## Phases

### Phase 1 — `withBusyRetry` in `job-busy.mjs`

**Amended mid-build 2026-08-07: the helper and `isBusy` live in a NEW module, `scripts/lib/job-busy.mjs`,
not in `job-store.mjs`.** Written as planned into `job-store.mjs` first, which pushed that file to 335
lines against this repo's 300-line ratchet — so the repo's own leave-it-clean rule applies: extract the
cohesive stage rather than raise the ceiling. The busy concern is exactly that stage; it is a fact about
SQLite that four unrelated lifecycle phases need, and it has no dependency on the store. `isBusy` moves
with it and its two existing importers (`job-queue.mjs`, `task-submit.mjs`) now import from the new
module — no re-export shim, because a shim would leave two homes for one name.

Signature `withBusyRetry(fn, { budgetMs = 30_000, delayMs = 50 } = {})`, synchronous.

- Loop: call `fn()`; return its value. On throw, `if (!isBusy(error)) throw error` — non-busy is never
  retried and never delayed.
- On busy: if the **elapsed wall-clock time** since the first attempt is at or past `budgetMs`,
  **rethrow that busy error**. Otherwise sleep `delayMs` (synchronously — every caller here is
  synchronous, and the alternative is making four call sites async for a path that is already blocking
  inside SQLite) and retry.
- The doc comment states the elapsed-time reason explicitly: the bound is time because each attempt can
  itself block for the full `busy_timeout`, so an attempt count does not bound anything a user feels.
- **`budgetMs` is a floor on when giving up begins, NOT a ceiling on total time, and the comment must
  say so.** A synchronous SQLite call already in progress cannot be interrupted, so the real elapsed
  time can overshoot by one attempt plus one delay. Documenting it as "a strict 30-second ceiling"
  would be the same class of false guarantee as the `openStore` comment this change is deleting.
- **The synchronous sleep is safe at the three sites that use it — `openStore` and the two `finish` calls — and only because of where they sit**: every
  retry happens before the model call or after it has settled, so none can freeze an in-flight
  request. During terminal persistence it does delay the heartbeat and the cancellation read — but no
  generation remains to cancel by then. Stated here so a fifth call site is not added casually.

### Phase 2 — `openStore` (defect c)

- Extract the body into an internal `openOnce()`; `openStore()` becomes
  `withBusyRetry(openOnce, { budgetMs: … })`.
- Inside `openOnce`, after `busy_timeout` is set, read `db.prepare('PRAGMA journal_mode').get()` and
  execute `PRAGMA journal_mode = WAL` **only when the result is not already `wal`**.
- **On any throw after `new Database(path)`, close the handle before letting the error escape**, so a
  retried open does not leak one per attempt. **The cleanup must preserve the ORIGINAL error**: close
  inside its own `try {} catch {}`, so a `close()` that throws cannot replace the `SQLITE_BUSY` that
  `withBusyRetry` is waiting to see. A cleanup failure masking the busy error would silently defeat
  the retry this phase exists to enable.
- Replace the `:210-216` comment. It must say: `busy_timeout` is set first so later statements wait;
  the WAL set is a **locking operation that the timeout does not reliably cover**, which is why it is
  now conditional; and it is needed only on the first open because the mode persists in the file.

### Phase 3 — the heartbeat (defect a)

`startHeartbeat`'s interval callback becomes:

- a `try` around `beat(...)` and `cancelRequested(...)`, `catch (error) { if (!isBusy(error)) throw error; }`
  — the busy case skips the tick;
- the `cancelRequested` result captured in the `try`, with **`onCancel()` called after the `catch`**,
  outside it, so a throw from the callback is not swallowed;
- a `false` default for the captured result when the tick was skipped, so a skipped beat never reads as
  "cancel requested".

### Phase 4 — `finish` (defect b)

`cmd-task-worker.mjs`: both `finish(...)` calls — `:79` completed and `:119` failed — wrapped in
`withBusyRetry`. Nothing else changes; on exhaustion the existing outer catch reports the storage error
exactly as it does now.

### Phase 5 — the polling-loop beat (defect e)

`job-queue.mjs:152`: the bare `beat(db, job.seq, …)` becomes a skip-on-busy call — the same plain
`isBusy` catch as the heartbeat, not a retry, because the loop is already a retry loop with its own
deadline.

### Phase 6 — witnesses that can fail

New `tests/job-busy.test.js` (`NEEDS_SQLITE`-skipped where it opens a real store; the fake-handle tests
need no database):

1. **the heartbeat survives a busy beat** — `startHeartbeat` with a handle whose `prepare()` throws
   `errcode 5`; the process must still be alive after several ticks. This is the reproduction above,
   inverted: it fails today.
2. **a non-busy error from the heartbeat is NOT swallowed** — same shape, a plain `Error('boom')`; it
   must still escape. Without this, phase 3 could be satisfied by a blanket catch.
3. **`onCancel` throwing is not swallowed** — the callback throws; the error must escape.
4. **`withBusyRetry` rethrows a non-busy error immediately** — a counter proves it called `fn` once.
5. **`withBusyRetry` gives up on the elapsed budget and rethrows the busy error** — with a tiny
   `budgetMs`, so the test is fast and bounded.
6. **`withBusyRetry` returns the value once a transient busy clears** — throws busy twice, then
   succeeds.
7. **`openStore` does not re-set WAL on a database that is already WAL** — open once, then reopen with
   `DatabaseSync.prototype.exec` patched to record the statements it receives, and assert no
   `journal_mode = WAL` is among them. That prototype method is writable and configurable in this
   runtime (checked), and the patch is **restored in a `finally`** so a failing assertion cannot leave
   every later test running against an instrumented driver. This is the one that pins defect (c)'s
   actual fix rather than its symptom.
8. **`finish` survives a transient busy — exercised through `cmd-task-worker.mjs`, not composed in the
   test.** A witness that calls `withBusyRetry(() => finish(...))` itself proves only that the helper
   works, which tests 4-6 already prove; it would stay green if phase 4 were never applied. This one
   must drive the worker's own path so that removing the wrapping at `:79` reddens it.

### Phase 7 — docs

- `adr/020-a-contended-database-must-not-kill-live-work.md`: the four sites and what each destroyed;
  why the bound is elapsed time and not attempts; why WAL is conditional rather than retried (the
  persistence measurement); why `onCancel` sits outside the catch; and **three stated limits** — that
  the three wild sightings remain an unmeasured rate, so this fix is justified by the mechanism and the
  reproduction rather than by a frequency; that `budgetMs` is a floor on giving up rather than a
  ceiling on elapsed time; and that under **sustained** contention the skip-on-busy policy can delay a
  cancellation repeatedly, which is the accepted cost of B1 and not an oversight.
- One present-tense line in CLAUDE.md naming `withBusyRetry` and linking ADR 020.

## Verification

- `npm test` (full suite; `zsh` required) — quote the summary line.
- Repo `verify` skill, all steps; LM Studio is up, so the live step is live rather than stubbed.
- **Mutation**, two, each naming the single test it must redden:
  1. **Widen the heartbeat catch to swallow everything** (drop the `if (!isBusy(error)) throw error`)
     — must redden *a non-busy error from the heartbeat is not swallowed*. The narrowing invariant.
  2. **Make the WAL set unconditional again** — must redden *`openStore` does not re-set WAL on a
     database that is already WAL*. The invariant defect (c)'s real fix rests on.
  Both proved LANDED with `~/Code/dotfiles/tests/mutation-landed.py`, both restored by `diff`.
- Commit gate in a **committed copy**.

## Residue expected

- **C2**, the rejected fork: persisting a completed answer to a recoverable channel when `finish`
  exhausts its budget. Filed, not built.
- the rate of defect (c) in the wild, still unmeasured
- the plan-mode deviation recorded at the top of this file
- whatever the review ladder leaves `open at approval` / `pending verification`
