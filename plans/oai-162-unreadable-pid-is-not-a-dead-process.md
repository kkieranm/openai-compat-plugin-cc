provenance: harness slug buzzing-squishing-wand

# OAI-162 — an unreadable pid is not a dead process

## Context

`isAlive(pid)` (`scripts/lib/job-liveness.mjs:77-85`) folds three different facts into one `false`:

1. the pid fails a shape check (`!Number.isInteger(pid) || pid <= 0`) — **no OS probe happens at all**;
2. `ESRCH` — the OS says the process is gone;
3. any other throw from `process.kill` that is not `EPERM`.

Only (2) is evidence of death. The file's own comment already says so — *"Only `ESRCH` means gone"* —
but the code does not do it. `livenessOf` turns any `false` into the verdict `'dead'`, `job-reconcile.mjs`
terminalizes the row on that verdict, and `/oai:abandon` tells the operator *"its process was already
gone"* about a number that never denoted a process.

The row is auto-terminalized on evidence that proves nothing. That is the whole of OAI-162.

**Reachability, stated rather than assumed.** No writer in this build can produce such a pid:
`job-record.mjs:151` and `:173` only ever write `process.pid`, and `:258` writes `NULL`. The columns are
`waiter_pid INTEGER` / `worker_pid INTEGER` in a table that is **not** `STRICT` (`job-store.mjs:148-149`),
so a TEXT value can land there only via corruption, a manual edit, or a foreign writer. This is the same
category as the shape `livenessOf` already calls `malformed` — *"two shapes this build cannot produce and
will not guess at"*.

**Grill decisions (settled with the user, not open):**

1. **Fail closed.** The row is not auto-collected. It blocks, `/oai:status` names it, and the operator
   clears it with `/oai:abandon --force`. This applies the module's own stated policy — *"failing closed
   costs a stuck queue the user is told about, where guessing costs someone's live run"* — to a third
   shape. `tests/queue-reconcile.test.js:22-36` already asserts exactly this behaviour for the NULL-pid
   shape, so this is a new input to a tested branch, not a new behaviour class.
2. **Reuse `malformed`.** No fifth verdict. Every consumer's `malformed` branch already fails closed, so
   this adds a case to **no** switch. (Codex steered for a distinct `unreadable-pid` verdict; the user
   chose reuse. Recorded because the disagreement was real.)
3. **Split both arms (1) and (3).** Only `ESRCH` reads as dead.
4. **Both `running` and `queued` rows.**

## The semantic that shapes this plan

Decision 4's original rationale — *"`relevantPid` already picks the right column per state, so one split
fixes both by construction"* — is true about the **verdict** and false about the **semantics**. Round 1 of
the plan gate found why, and it is the root cause of most of the work below.

`registerWaiter` (`job-record.mjs:149-153`) is:

```sql
UPDATE jobs SET waiter_pid = ?, last_beat_at = ? WHERE seq = ? AND state = 'queued' AND waiter_pid IS NULL
```

That `AND waiter_pid IS NULL` splits the two queued-`malformed` shapes apart:

- **queued + unparseable timestamps** (today's shape) — `waiter_pid` is NULL, so a late worker **can**
  still attach. The wedge is transient and self-clearing.
- **queued + unreadable `waiter_pid`** (the shape this change creates) — the column is non-NULL, so
  nothing can **ever** attach, and no reconciler collects it. The wedge is **permanent**.

Every piece of queued-`malformed` operator guidance in this repo is written on the rescuable premise.
That is one root cause, not four unrelated string edits, and it is what Phase 2 exists to fix.

## SCOPE WITHDRAWN AFTER APPROVAL — 2026-08-16, by the user, on Codex's recommendation

**This section is later than the approval below and overrides it.** Review pass 4 established that
the build had grown two mechanisms the plan never described — an operator-advice surface deciding
when `/oai:abandon --force` may be named beside a row, and a bounded formatter for a recorded value
that is not a pid. The diff had reached 25 files and three new modules against a plan naming 16 and
one; roughly 260 lines served the liveness verdict and roughly 700 served those two.

Codex's scope review found neither mechanism required by the filed defect, and noted that the two
defects earlier passes raised against them are **conditional**: ungated advice matters only if advice
is added, and an oversized value can only make the write throw if the value is newly interpolated
into the payload. The user chose to strip.

**Withdrawn from the approved plan:**

- **Phase 2 item 5** — the recorded value is NOT preserved in the failure message. A
  recorded-but-unreadable pid takes the existing `malformed` arm, which says no liveness judgement was
  possible; that is true of it. For a running row `finish` NULLs the column, so the value is lost.
  This reverses a plan-gate round-1 finding Codex itself raised as refuse-to-ship, and the reversal is
  deliberate and recorded rather than silent.
- **The exit is not named beside the row.** `remedyFor` remains the only place this repo advises an
  action from a status listing, with its original four conditions. `/oai:abandon --force` is
  documented in `commands/status.md` and `commands/abandon.md`.
- **An unrecognised `state` is not routed to `malformed`** in `displayOf`.

Everything else in the plan shipped. **Whether each withdrawn piece became a tracker item was
re-adjudicated at close-out on 2026-08-16 rather than assumed, and only ONE did**: the exit not being
named beside the row is filed as OAI-174. Preserving the recorded value and routing an unrecognised
`state` to `malformed` were both dropped — neither is reachable from anything this build writes, and
this section is itself the durable record of the decision, which is what a tracker item would have
duplicated. The defects the review found in code that PRE-DATED this change are filed separately
(OAI-172, OAI-173, OAI-175, and an amendment to OAI-160).

## Approach

### Phase 1 — the split, in `scripts/lib/job-liveness.mjs`

Add a three-way sibling and leave `isAlive`'s contract exactly as it is:

```js
export function pidLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unreadable';
  try {
    process.kill(pid, 0);
    return 'live';
  } catch (error) {
    if (error?.code === 'EPERM') return 'live';   // exists, someone else's
    if (error?.code === 'ESRCH') return 'gone';   // the only proof of death
    return 'unreadable';                          // an errno we do not interpret
  }
}

export function isAlive(pid) {
  return pidLiveness(pid) === 'live';
}
```

`isAlive` keeps its exported name, its boolean type and its behaviour for every input. It has **no
non-test consumers** — `tests/cancel-helpers.mjs:26` and `tests/abandon-salvage.test.js:196` only — so
keeping the signature is free. Signal 0 is still the only signal sent, so `tests/queue-guards.test.js`'s
structural guard is undisturbed.

`livenessOf` then routes the third case to the verdict that already exists:

```js
if (pid !== null) {
  const verdict = pidLiveness(pid);
  if (verdict === 'live') return 'live';
  if (verdict === 'gone') return 'dead';
  return 'malformed';   // a pid was recorded and cannot be read as one
}
```

**No consumer needs a code edit.** (Not the same as "no branch changes": a malformed *running* row's
branch in `blockingSeqFor`'s running rung does change — excluded as `dead` today, the marked blocker
after. That is the fail-closed behaviour decision 1 asks for, and it arrives without an edit.)
Verified at every call site: `job-queue.mjs` `queuedRole:62-67` →
`'blocks'` and `decide:119-123` → `'blocked'`; `job-reconcile.mjs:131-135` → row untouched;
`job-abandon.mjs` `abandonDecision:127-129` → refusal, `--force` → `forced-malformed`; `job-view.mjs`
`displayOf:89-99` → `'malformed'` and `blockingSeqFor:195-198` → counted as a blocker;
`job-drain.mjs:31` → `couldDrain` false; `job-render.mjs` `remedyFor:144` → `null`. All fail closed,
none needs an edit. `tests/abandon-cli.test.js` pins `REFUSALS` against `abandonDecision`'s vocabulary
and this plan adds no reason string, so that pin is undisturbed.

### Phase 2 — the text that becomes false

Six sites, five of them downstream of the `registerWaiter` semantic above. Each is a factual correction,
not a rewording.

**Blocking, from the queued-permanence semantic:**

1. `job-render.mjs:69-72` — the **queued** arm of `noteFor` says *"malformed: queued with a timestamp this
   build cannot read."* False for the new shape, and reachable on the primary screen: such a row is
   `blocks`, so `blockingSeqFor` marks it and `renderList` prints this note. **This is the acceptance
   criterion for decision 1's escape hatch:** for a *local* queued row in this shape `blockingSeqFor`
   excludes it and `remedyFor` returns `null`, so this note is the only surface left telling the operator
   anything — and as written it tells them the row may still be picked up, which it never will be.
2. `commands/status.md:63-67` — *"Two shapes"*, *"A **queued** row whose timestamps will not parse"*, and
   *"a worker that registers against it can still pick it up"*. The last is what `registerWaiter` forbids.
3. `cmd-abandon.mjs:78-81` — the `REFUSALS.malformed` queued suffix, *"a worker that has not registered
   yet can still attach and run it, so forcing may write off work that was about to start."* False for
   the new shape, and it argues the operator **out** of the one action that clears it.
4. `job-view.mjs:163-166` — the docblock justifying exclusion of a malformed local row as a *transient*
   false negative *"because `registerWaiter` can still attach a worker to it"*. Permanently false here.

**Blocking, from evidence preservation:**

5. `job-abandon.mjs` `abandonFailure:159-186` — the `malformed` arm says there is *"no pid to
   attribute"* and omits `relevantPid(row)`. **`finish` (`job-record.mjs:258`) NULLs `worker_pid` and
   only `worker_pid`**, so the evidence loss is real for a **`running`** row holding `'garbage'` or
   `2 ** 40` and not for a queued one, whose `waiter_pid` survives the write. That contradicts what
   `commands/abandon.md:47-50` and `CLAUDE.md` both promise — the pid survives in the failure message as
   evidence. The arm splits: no pid recorded keeps today's wording verbatim (it is what
   `tests/abandon-recovery.test.js:62` asserts against a `running` row with `workerPid: null`); a pid
   recorded but unreadable records the raw value and says it could not be read as a pid. The `hint` at
   `:179-185` branches with it, as it already does. Neither the code nor the docs may claim `finish`
   clears the relevant pid column in every state.

**Blocking, from the new shape reaching the running arm:**

6. `job-render.mjs:73` — *"malformed: running with no worker pid recorded"* is false for a row that
   recorded one.

**Checked and left alone** (accurate for both shapes, named so an implementer does not churn them):
`job-abandon.mjs:162-164`'s *"pid or timestamps could not be read"* sentence; `cmd-abandon.mjs:72` and
its `forced-malformed` sentence at `:121-122`; and `job-render.mjs` `workerField:187-191` /
`cmd-abandon.mjs` `describe:163`, which print the raw value harmlessly.

**Two rules the implementation must follow at every one of these sites:**

- **Distinguish the malformed variants with `pid !== null`, never truthiness.** A recorded `0` is
  "recorded but unreadable" and must survive into the forced-abandon payload; `if (pid)` would silently
  reclassify it as "no pid recorded" and lose exactly the evidence item 5 exists to keep.
- **Branch the queued messaging on whether a pid was RECORDED, not on `state === 'queued'`.** Both queued
  shapes share the state; only the pid column tells the rescuable one from the permanent one. Each site
  already holds what it needs: `noteFor` has `view.pid` and `view.state`, `REFUSALS.malformed` has
  `job.waiter_pid`, and `abandonFailure` has `relevantPid(row)` and runs *before* `finish`, so `row.state`
  is still the found state.

**Comments:** `livenessOf`'s *"two shapes"* enumeration (`job-liveness.mjs:100-118`) becomes three, and
must state that the queued one is permanent where the timestamp one is not. `isAlive`'s docblock
(`:70-76`) describes `pidLiveness` and what `isAlive` projects from it. `abandonDecision`'s docblock
(`job-abandon.mjs:96-97`) enumerates the same two shapes and becomes incomplete — it is in a file being
edited anyway, so it is corrected here rather than left to rot.

**Non-blocking, listed so it is not a surprise:** `tests/blocker-helpers.mjs:28-31` states the
queued-malformed shape *"cannot be inserted by the helper at all"*. After this change one of the two
queued shapes can be — which is what makes test 4 below possible — so the comment needs a sentence.

### Phase 2b — `job-abandon.mjs` is one line from its budget, so item 5 extracts rather than grows

Measured the way `tests/structure.test.js:53` measures (`split('\n').length`), with `ALLOWLIST` empty and
`DEFAULT_MAX_LINES = 300`: **`job-abandon.mjs` is 299 lines.** Item 5 adds a third `observed` arm and a
branching `hint` — realistically +6 to +12 against a 6-line and a 7-line block. It cannot fit.

**The call, owned here rather than improvised at a red commit gate: extract, do not raise the ceiling.**
`abandonFailure` and its `hint` are a cohesive stage — they build the row's permanent failure record and
nothing else in the file does that — so they move to a new `scripts/lib/abandon-failure.mjs`, which
`job-abandon.mjs` imports. This is the `/feature` leave-it-clean checkpoint applied at the moment the
file crosses, and it follows the precedent `job-drain.mjs`'s own header records: that file was split off
for exactly this reason. No `ALLOWLIST` entry is added; the empty allowlist stays empty.

`job-render.mjs` (221) and `cmd-abandon.mjs` (243) have room for Phase 2's edits and need nothing.
`job-liveness.mjs` goes from 130 to roughly 155.

**The FUNCTION ceiling is the one that will actually bite, and `ALLOWLIST` is its only escape too**
(`structure.test.js:13` `MAX_FUNCTION_LINES = 60`, escape at `:70`) — which Phase 2b has just forbidden.
`abandonFailure` spans 148→187 = **40 lines** today; item 5's +6/+12 puts it at 46–52 before the 4–8
comment lines this repo attaches to every new arm. It fits, but not with room to spare: **measure the
function span at code time, not just the file**, and split the `hint` builder out beside it if it crowds
60. Extraction alone does not solve this — moving a 52-line function to a new file leaves it 52 lines.

### Phase 3 — `commands/abandon.md`

`:80-82` currently asserts the opposite of what will ship:

> A pid that is present but corrupt is NOT this case: it reads as a dead process and is handled by
> ordinary recovery (OAI-162).

It reverses: a present-but-unreadable pid **is** malformed, is refused by default, and is liftable by
`--force`. The refusal-vocabulary paragraph and the *"ordinary recovery owns it"* paragraph are re-read
against the new routing, and the queued-permanence semantic is carried into both this file and
`commands/status.md` — a queued row in this shape is the one queued case `--force` is the *only* exit from.

### Phase 4 — tests

New file `tests/liveness-unreadable-pid.test.js` for the unit-level verdict, plus additions to the
existing queue and abandon suites so behaviour is pinned where the behaviour lives:

1. **Verdict** — `livenessOf` returns `'malformed'` for a `running` row whose `worker_pid` is each of
   `-1`, `0`, `1.5`, `2 ** 40` and `'garbage'`, and for a `queued` row whose `waiter_pid` is the same set.
   `2 ** 40` is the case that matters most: a plausible-looking positive integer no OS will ever hand out,
   today indistinguishable from a reaped pid.
2. **`isAlive` unchanged** — `true` for `process.pid`, `false` for `deadPid()` (`tests/job-helpers.mjs:94-99`),
   `false` for every unreadable value. The regression guard for the two test helpers that depend on it.
3. **Queue** — a `running` row with an unreadable `worker_pid` blocks the queue and is left alone,
   mirroring `tests/queue-reconcile.test.js:22-36`. `insertSynthetic` (`tests/job-helpers.mjs:119-143`)
   binds `workerPid` straight through a prepared statement, so a TEXT value reaches the column without a
   `STRICT` table rejecting it — the foreign-writer shape is reproducible in-process.
4. **Queued arm** — a `queued` row with an unreadable `waiter_pid` is not skipped and reconciled away,
   **and `registerWaiter` against it returns `false`** — the assertion that pins the permanence claim
   Phase 2's text now rests on, rather than leaving it as prose.
5. **Abandon** — `/oai:abandon` refuses such a row with reason `malformed`, and `--force` lifts it to
   `operator-abandoned`. **The persisted failure payload after `--force` is asserted to contain the raw
   recorded pid value**, which is Phase 2 item 5's executable check. **The row must be `running` with an
   unreadable `worker_pid`**: `finish` NULLs `worker_pid` only, so a queued row's `waiter_pid` survives
   the write and the same assertion would pass while covering nothing. Only the running row exercises the
   evidence loss.
6. **Note text** — the queued note for this shape does not claim a worker can still pick it up.

`tests/job-helpers.mjs:87-93` documents deliberately *avoiding* a synthetic out-of-range pid because
`isAlive` "would reject it on shape and the test would pass without ever asking the OS anything." That
comment is about `deadPid()` and stays correct — but the avoided fixture is test 1's subject, so it gains
a sentence pointing at where the shape case is now covered on purpose.

### Phase 5 — docs (`/feature`'s docs step, before review)

One present-tense line in `CLAUDE.md`'s `job-liveness.mjs` architecture note, naming `pidLiveness`, the
fact that only `ESRCH` reads as dead, and that the queued shape it creates is permanent. Context and the
reachability argument stay in the tracker item, not the note.

## Verification

- `npm test` — the repo gate (`node --test` over `tests/**/*.test.js`; needs `zsh` on PATH).
- The repo `verify` skill (`.claude/skills/verify/SKILL.md`) — tests, a real plugin load, a delegation
  round trip.
- **Mutation, per `/feature`'s verify step.** The key invariant is that an unreadable pid does not read as
  death. Collapse `pidLiveness`'s `'unreadable'` returns back to `'gone'`, prove the edit landed with
  `~/Code/dotfiles/tests/mutation-landed.py`, and expect test 1 and test 3 red — test 1 because the verdict
  flips to `'dead'`, test 3 because the row is then collected instead of blocking. Restore, re-run green,
  and prove the restore against the backup by `diff`, not by eye.
- **Every file this change touches stays under `tests/structure.test.js`'s 300-line default budget**, by
  the extraction Phase 2b decides rather than by an allowlist entry — measured before and after, not
  assumed. `job-abandon.mjs` starts at 299 and must come **down**; `job-liveness.mjs` goes 130 → ~155;
  `job-render.mjs` 221 and `cmd-abandon.mjs` 243 both have room. `ALLOWLIST` stays empty.
- **`2 ** 40` is the fixture worth naming explicitly, and its mechanism was verified by execution rather
  than by reading:** `process.kill(2 ** 40, 0)` throws `ERR_INVALID_ARG_TYPE`, a `TypeError` carrying no
  errno, so today it falls past the `EPERM` test to `false` → `'dead'`. Under `pidLiveness` it lands in
  the catch-all → `'unreadable'` → `'malformed'`. `-1` and `0` are caught by the shape check *before*
  `kill`, which is load-bearing: `kill(0, 0)` and `kill(-1, 0)` both **succeed** and would read as `live`.
