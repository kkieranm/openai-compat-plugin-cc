ARCHIVE — not the current spec; the plan beside it is
# OAI-167 — a comment that denies a failure mode, and the catch that made it true

## Context

`BACKLOG.md` OAI-167 (Tier 2, "the suite says something false about itself") records five comments
that state false things. Codex verified all five independently against the cited files; every one is
false as filed. Two of them convert an I/O failure into a claim of benign absence — the shape that
makes a sweep look healthy while it silently collects nothing.

The probe found more than the item body records, and it changes the scope:

- **`sweep()` runs `prune()` before `orphanSeqs()`** (`job-retention.mjs:240-241`), so the docblock's
  "a row set read *afterwards* is guaranteed to contain it" is falsified on **every ordinary sweep**,
  not merely by a concurrent one. The item describes only the race.
- **`orphanSeqs`'s bare `readdirSync` catch is the blanket catch `task-submit.mjs:91-93` forbids.**
  That docblock states the sweep's policy: *"Anything else is a defect in the sweep and is raised
  rather than swallowed: a blanket catch would turn a broken sweep into an unbounded table nobody
  ever hears about."* `sweepQuietly` rethrows every non-busy error to enforce it — and `orphanSeqs`
  swallows the EACCES one level down, before that rethrow can ever see it.
- **The catch's own ENOENT arm is near-unreachable**: `openStore` unconditionally
  `mkdirSync(join(statePath(), 'logs'))` at `job-store.mjs:223` before any sweep runs. So the only
  realistically reachable arm is the I/O fault the comment denies.
- **Blast radius is the one OAI-67 already designed.** `sweep()`'s single production caller is
  `task-submit.mjs:110`, on an `openStore()` handle, and it runs *before* anything is inserted or
  spawned. No reader command sweeps. A propagating fault fails a submission that has created nothing
  and spent nothing.

**Decisions taken with the user (2026-08-16), both against a Codex steer that was scoped to
`job-retention.mjs` alone and so never saw `task-submit.mjs:91-93`:**

1. **Delete the catch, inside this item** — not narrow it to ENOENT (which would preserve an
   unreachable branch and require fresh prose describing a state that does not occur), and not defer
   it to its own item.
2. **Delete the false clauses; do not rewrite them.** Per the `review-ladder` delete-only rule: in the
   measured case every successive rewrite was itself false and only the deletions held.

Outcome: the four surviving comments say less and nothing false, the fifth disappears with the code
it described, and a fault reading `logs/` reaches the rethrow that exists to hear it.

## Phase 1 — delete `orphanSeqs`'s catch

`scripts/lib/job-retention.mjs:188-200`.

```js
function orphanSeqs(db) {
  const names = readdirSync(logsPath());
  const known = new Set(db.prepare('SELECT seq FROM jobs').all().map((row) => Number(row.seq)));
  ...
}
```

The `let names` / `try` / `catch` / `return []` all go, and the false comment goes with them. No
replacement prose: the deletion is the fix.

One clause is added to the `orphanSeqs` docblock recording *why* nothing is caught here, since a
future editor's instinct is to re-add tolerance — one sentence, naming `sweepQuietly` as the owner of
the decision, in the parenthesized bare `OAI-n` form the file already uses at `:20`, `:78`, `:182`.
This is a new proposition and therefore reviewed like code, not smuggled in as a deletion.

## Phase 2 — delete the four false clauses

Deletions only. Surrounding correct prose carries each argument.

| File:line | Struck |
| --- | --- |
| `job-retention.mjs:138` | `and is `2^63`` — the literal is 192 greater; only its `Number` value is `2^63`. The round-trip/`isSafeInteger` argument around it is sound and is left alone. |
| `job-retention.mjs:161` | `and a row set read *afterwards* is guaranteed to contain it` — false on every sweep. The docblock at `:225-237` already states the true reason a pruned row's log is safely collected. |
| `job-retention.mjs:210` | `the file is absent either way` — an EACCES leaves it present. The preceding sentence already justifies the tolerance, which stays: total tolerance is load-bearing per `:181-186` and OAI-66. |
| `tests/abandon-salvage.test.js:8` | `reviewed six times, and never once executed` — unverifiable history asserted in a test header. |

## Phase 3 — the witness

The catch is **provably never exercised today**: `orphanSeqs` is unexported, `sweep` is its only
route, and every caller goes through `withStore` → `openStore`, which always creates `logs/`. So the
existing suite passes whether the catch is bare, narrowed, or deleted — an unwitnessed change.

Add one test to `tests/retention-files.test.js` (213/300 lines in `abandon-salvage.test.js`,
`retention-files.test.js` has room; `job-retention.mjs` is 244/300):

- `withStore(state, …)` so `openStore` creates `logs/` as usual;
- inside the callback, `rmSync(join(state, 'logs'), { recursive: true })` then
  `writeFileSync(join(state, 'logs'), '')` — a **file** where the directory was;
- `assert.throws(() => sweep(db), { code: 'ENOTDIR' })`.

`ENOTDIR` rather than a permissions fixture deliberately: `chmod 000` is a no-op under root and would
make the witness silently vacuous on some machines, which is the defect class this item exists to
remove.

## Verification

1. `npm test` — full suite, green, summary line quoted.
2. **Mutation check (Phase 1's invariant).** Back up `job-retention.mjs`, re-introduce the
   `try`/`catch { return []; }` around `readdirSync`, prove it landed with
   `~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the failing test (expected: the
   Phase 3 witness), restore, re-run green, and prove the restore with `diff` against the backup.
   This is what makes Phase 3 non-vacuous — it is the positive control the catch has never had.
3. Phase 2 is pure comment deletion with **no invariant a single edit can break**; stated and skipped
   rather than given a manufactured mutation.
4. The repo `verify` skill (`.claude/skills/verify/SKILL.md`) — real plugin load and a delegation
   round trip.
5. `tests/structure.test.js` must stay green: it is at **exactly 300/300** and its orphaned-doc-comment
   guard fires on two consecutive `/**` blocks, which Phase 1's docblock edit sits next to.

## Docs

One clause added to CLAUDE.md's existing `job-retention.mjs` sentence, present tense, naming the
behaviour: a fault reading `logs/` propagates to `sweepQuietly`'s rethrow rather than reading as an
empty directory. No new paragraph.

## Files

- `scripts/lib/job-retention.mjs` — phases 1 and 2
- `tests/abandon-salvage.test.js` — phase 2 (header only)
- `tests/retention-files.test.js` — phase 3
- `CLAUDE.md` — docs
