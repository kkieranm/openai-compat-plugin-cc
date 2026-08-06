# OAI-61 (narrowed) — capability-gate `node:sqlite`

provenance: replacement plan after a PARTIAL PLAN WITHDRAWAL at step 6, `adr/033`. Supersedes
`plans/oai-61-node-sqlite-capability-gate.md`, which remains as the record of what was approved and
what the build then grew beyond it.

## Why this plan exists

The original plan was approved for one thing: stop a static import chain reaching `node:sqlite`
before dispatch, so a runtime lacking that module loses background jobs instead of every command.

Across six review-ladder passes the build grew three mechanisms **no plan approved** — a rewritten
credential-notice subsystem, a permission-hardening module (`state-permissions.mjs`), and an
`onProfile` hook threaded through `prepareTask`. `adr/033` names this exact case: a supporting
mechanism absent from the approved plan is a changed phase approach, because otherwise "the ladder has
paid to review scaffolding rather than the feature". It did: the capability gate has been stable and
repeatedly confirmed since pass 2, while the large majority of ~5.5M subagent tokens went on the
scaffolding, and **both** still-open high-severity findings live in the scaffolding rather than the gate.

Codex ruled `REOPEN-STEP-3`; the user adjudicated **partial** withdrawal.

## Scope — what this feature IS

1. `scripts/lib/job-store.mjs`: `node:sqlite` reached by a **caught dynamic import at module scope**,
   the failure captured into `importFailure`, and classified at first use by `requireDatabaseSync()`.
   The export is asserted **inside** the `try`, so "`DatabaseSync` falsy" always implies
   "`importFailure` set".
2. `requireDatabaseSync()` at every entry to the store — `openStore()`, `openStoreForReading()`, and
   as the **first statement** of `submitTask` so a runtime that can never accept a job does not first
   pay **provider requests** it can never use. Deliberately nonnumeric: an earlier draft said "five
   HTTP round trips", which is the identity of this feature's own finding **N7** — *a precise count
   asserted as verified without an instrument* — reasserted in the plan written to replace it. What
   the evidence supports is that the provider receives **no requests**, which is what the ordering
   test observes. This changes **when** the pre-existing credential notice fires relative to the
   refusal; it does **not** change the notice's text.
3. Refusal message truth on all five surfaces — `job-store.mjs` plus `commands/{status,result,cancel,task}.md`
   — naming the floor **and** the two non-age causes (built without SQLite, `--no-experimental-sqlite`),
   never age framing useless to someone already past the floor.
4. **Harness portability**, which is inseparable from the claim: `tests/job-helpers.mjs` must not
   statically import `node:sqlite` (it killed 11 test files at link time on the exact runtimes this
   feature restores), plus named `NEEDS_SQLITE` skips, and `tests/harness-guards.test.js` as the
   structural guard the class earned by being confirmed three times.
5. `tests/runtime-capability.test.js`, `tests/no-sqlite-hook.mjs`, `tests/no-sqlite-register.mjs`.
6. `adr/018` and its one-line CLAUDE.md note.

### Two file sets, which are NOT the same set

Conflating them was a defect in an earlier draft of this plan: it demanded that files phase 1 deletes
or reverts also appear in the final diff, which cannot hold. They are listed separately.

**(A) Files OPERATED ON during the withdrawal** — everything phase 1 touches, including those it
removes. Stated in full because omitting the ten skip sites was **finding E1 of this feature's own
ladder** — *plan completeness: the declared file set versus the change's actual surface* — recurring
one plan later, in a plan written to correct a scope error:

`scripts/lib/job-store.mjs`, `scripts/lib/task-submit.mjs`, `scripts/lib/task-execute.mjs`,
`scripts/lib/state-permissions.mjs`, `tests/job-secrets.test.js`, `tests/job-helpers.mjs`,
`tests/harness-guards.test.js`, `tests/runtime-capability.test.js`, `tests/no-sqlite-hook.mjs`,
`tests/no-sqlite-register.mjs`, the ten skip sites
`tests/{background,cancel,heartbeat,job-auth,queue-reconcile,queue,result,retention,status,task-template}.test.js`,
`commands/{status,result,cancel,task}.md`, `agents/oai-delegate.md`,
`adr/018-a-capability-not-a-version.md`, `CLAUDE.md`, `BACKLOG.md`, and both plan files.

**(B) The EXPECTED FINAL DIFF against `487a63f`** — set (A) minus everything phase 1 fully reverts or
deletes. It therefore **omits** `task-execute.mjs` and `agents/oai-delegate.md` (reverted to their
`487a63f` text) and `state-permissions.mjs` and `tests/job-secrets.test.js` (deleted while untracked,
so they were never in the baseline and leave no trace). It **includes**
`plans/oai-61-node-sqlite-capability-gate.md`, the superseded original, which is retained as the
record of what was approved and what the build grew past it.

### `agents/oai-delegate.md` — reverted, not kept

Its current hunk deletes the justification "One of them echoes a base URL's query string", which the
**notice rewrite** made false. Withdrawing that rewrite makes the original sentence **true again**, so
the hunk reverts with the mechanism it belonged to. Keeping it would leave the delegate's
documentation describing a notice that no longer exists in this change set — the same false-record
defect as phase 2's, on a different surface.

## Scope — what this feature is NOT

Withdrawn to separately planned features, carrying their open findings:

- **The credential-notice subsystem** → new backlog item. `warnAboutQueryCredentials` **pre-existed**
  and already interpolates the secret at `487a63f` (`(${profile.query})`). Its six rewrites, the
  `onProfile` hook and `tests/job-secrets.test.js` all leave this change set.
- **Permission hardening** → new backlog item. `state-permissions.mjs` (`restrict`, `narrowOrWarn`) is
  entirely new; `job-store.mjs` had only a bare unverified `chmodSync(path, 0o600)` at `487a63f`.

## The uncomfortable consequence, stated rather than buried

Reverting the notice **reintroduces S1**, a credential leak this ladder confirmed by execution: the
warning about a secret prints the secret. It is **pre-existing**, not introduced here, and this feature
never claimed to fix it — but a plan that quietly restored a known leak without saying so would be
exactly the kind of unstated regression this repo's review discipline exists to catch. It is therefore
stated here, and its new backlog item takes the **top** of the tracker rather than an ordinary slot.

## Phases

1. **Separate.** Revert the scaffolding hunks: `task-execute.mjs` entirely; `task-submit.mjs`'s notice
   docstring and body to their `487a63f` text; `job-store.mjs`'s `state-permissions` import,
   `restrict(path)` and `narrowOrWarn([...])` back to the bare `chmodSync`; and `agents/oai-delegate.md`
   entirely, per above. Delete `scripts/lib/state-permissions.mjs` and `tests/job-secrets.test.js`.
   Keep every gate hunk, including `requireDatabaseSync()` as `submitTask`'s first statement, and keep
   all ten files' named skips — they verify the gate, not the withdrawn mechanisms.
2. **Narrow `adr/018` in the same phase, not after it.** The ADR currently documents the withdrawn
   mechanisms — the notice's six rewrites, the `onProfile` hook, `state-permissions.mjs`, the
   permission guarantees and the now-deleted `tests/job-secrets.test.js`. Reverting the code while
   leaving that text **ships a false architectural record**, which is worse than no record: a decision
   document describing code that does not exist is exactly what a later reader trusts. Remove those
   sections, move their substance into the two new tracker items so the reasoning is not lost, and
   restate the "what is proven, and what is only cited" section against what the narrowed change set
   actually demonstrates — the structural guard and its mutation, the `--no-experimental-sqlite` arm
   executed here, and the version thresholds cited rather than executed.
   **Acceptance:** `grep -nE 'state-permissions|onProfile|narrowOrWarn|restrict\(|job-secrets' adr/018-a-capability-not-a-version.md`
   returns nothing except where it explicitly names the work as withdrawn to another item.

3. **Reverify**, per Codex's constraint that the narrowed feature is reverified before it may ship.
   Both required, because the first is not a gate on its own:
   - the repo `verify` skill;
   - the suite **in a committed copy** — `rsync` to temp, `git add -A && git commit`, `npm test` —
     never the working tree. G1 proved the working tree is not the state the gate asserts about: the
     suite read 632/0 dirty and **630/2** clean, because one test asked the ambient directory for
     uncommitted changes that the gate's own commit removes.
   - Re-run step 5's key-invariant mutation, which the separation invalidates.
4. **File** the two withdrawn mechanisms as tracker items carrying their open findings.

## Acceptance criteria

- No static `node:sqlite` import anywhere under `scripts/` or `tests/`; `tests/harness-guards.test.js`
  green and **positive-controlled** by reinstating the exact import.
- `node --no-experimental-sqlite` → `/oai:setup`, `/oai:review` and foreground `/oai:task` still work;
  the four job commands refuse with the both-directions message and exit 1, never 2.
- Suite green **in a committed copy**, and the mutation check names the test that failed.
- **In shipped code**: no `onProfile`, no notice-text change, and `scripts/lib/state-permissions.mjs`
  absent as a file. Stated as an executable condition rather than "nowhere in the result", which is
  unsatisfiable on its face — this plan and `adr/018` both name those terms while *recording the
  withdrawal*, and phase 2 explicitly permits that. Documentary references are allowed exactly where
  they record the withdrawal or the new tracker items, and nowhere else. Checked as
  `grep -rn 'onProfile\|state-permissions' scripts/ tests/ commands/ agents/` returning nothing.
- The candidate's file set equals **(B)** exactly, with nothing extra and nothing missing. Verified in
  the committed copy, after `git add -A`, with **`git diff --cached --name-only 487a63f`** — plain
  `git diff --name-only` cannot do this job: it does not see untracked files, of which this change set
  has several, and it reports nothing at all once the commit is made. An unplanned file in the
  candidate is a scope failure whether or not it is harmless.
- `adr/018` describes only what the narrowed change set contains, proved by the phase-2 grep. A
  decision record outliving the code it records is a defect in its own right, not untidiness.

## What is proven, and what is only cited

The version thresholds (`node:sqlite` unflagged from v22.13.0, v23.4.0 on 23.x; `node:module`
`register()` from 18.19/20.6) are **cited**, not executed: this machine has only v26.3.1 and the user
directed that no older Node be installed. The guard is proved **structurally** and by mutation, and
the `--no-experimental-sqlite` arm is a real runtime without the module, executed here.
