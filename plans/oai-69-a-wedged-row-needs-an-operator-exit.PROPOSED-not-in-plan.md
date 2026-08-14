# PROPOSED — NOT PART OF THE PLAN, NOT REVIEWED, NOT APPROVED

> **DISPOSITION, added at commit time: the amendment below SHIPPED.** It was held out
> of the plan because the gate hit its cap, then implemented during the code step
> with the user's agreement and reviewed by the seven-pass ladder that followed —
> `couldDrain` requires `role === 'head'` and no cancel-pending head, and the
> `already-recovered` idempotence arrived later from the same line of argument.
> This file is kept as the record of what the gate refused to bless, not as
> outstanding work. Read it as history.

This file holds the amendment responsive to the **final** plan-gate finding, held outside
`oai-69-a-wedged-row-needs-an-operator-exit.md` because the gate reached its ten-round cap without a
dual approval. At the cap, a responsive amendment does not enter the plan: the plan as it stands
(digest `6210ed0b8e93`) is the last version an approver actually read, and this delta has been read by
nobody. Labelling it `unverified` and folding it in anyway is not a control.

**Do not merge this into the plan without re-opening the gate.**

## The finding (Codex, round 10, verbatim)

> One blocking defect remains: `couldDrain` treats any `scanQueued` head as dispatchable. But
> `scanQueued` also returns `role: 'blocks'` for unknown-version, starting, or malformed rows; `decide`
> rejects those at `job-queue.mjs:126`. A head with `cancel_requested_at` also returns `cancelled` at
> line 108 rather than acquiring.
>
> Thus the plan could falsely report "a waiter may now start." Require no live running blocker,
> `role === 'head'`, and no pending cancellation on that head. Add a negative message/drain test for a
> non-dispatchable head. `blockingSeqFor` cannot supply this predicate because it identifies blockers,
> not runnable successors.

## Verified against the source

Both halves check out, read directly from `scripts/lib/job-queue.mjs:104-128`:

- `if (role === 'blocks') return 'blocked';` at `:126`. `queuedRole` (`:56`) returns `blocks` for a
  live row of unknown schema version, and for `starting` and `malformed` rows — so `scanQueued`
  yielding a head does **not** mean that head can run.
- `if (mine.cancel_requested_at) return 'cancelled';` at `:108`. A cancel-pending head never acquires,
  and a successor is still refused by `head.seq !== seq` at `:127`, so the queue does not move.

The last point in the finding is the sharpest and is the reason the plan's current citation is wrong
rather than merely incomplete: **`blockingSeqFor` identifies blockers, not runnable successors.** The
plan points at it as the rule to reuse. It is the right precedent for *walking two rungs* and the wrong
one for *this predicate*, and reusing it directly would reproduce the defect in a new place.

## The proposed change

Replace the two-rung `couldDrain` definition in Phase 3 with a three-condition one, still evaluated
inside the transaction against the state left after the write:

1. No **other** non-dead `running` row remains (unchanged — the running rung is checked first).
2. Excluding the target, `scanQueued` yields a head **whose `role` is `head`, not `blocks`**.
3. That head has no `cancel_requested_at`.

Phase 6 gains a negative message/drain pair for a **non-dispatchable head** — a queued successor that
is live but unknown-version, or cancel-pending — asserting the message does not say a waiter may start
and that no waiter acquires. Per the repo's negative-fixture rule, each negative fixture must differ
from its positive twin in exactly one thing, so these are two fixtures and not one.

Phase 2's stated return shape for `abandonRow` (`{ outcome, reason, state }`) also needs `couldDrain`
added to it; Phase 3 requires it and Phase 2 does not list it. Raised as non-blocking by the Claude
approver in round 9.

Phase 6's sentence "must not introduce even a probe" reads stricter than the guard it describes: the
`livenessAt` callback handed to `scanQueued` calls `livenessOf`, which probes. The specified assertion
(no `process.kill` text in `job-abandon.mjs`) is satisfied, since the probe lives in
`job-liveness.mjs` — but the prose should say so. Also raised as non-blocking in round 9.
