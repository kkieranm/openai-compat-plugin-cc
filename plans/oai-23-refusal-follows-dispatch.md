# OAI-23 — a refusal is a consequence of the replacement being dispatched

Status: draft, 2026-08-01.

## The defect

The attempt ledger records one entry per physical HTTP request, and `refused` means something
specific and benign: *the server rejected this request's shape, and the plugin then sent a different
shape that worked*. It is deliberately excluded from the reliability count, because a server that
refuses `stream_options` refuses it every time and counting that as unreliability inverts the figure.

In two places the entry is marked `refused` **before** the replacement is dispatched, and the
replacement can then fail to be dispatched at all:

1. `review-request.mjs:237` — `degraded()` calls `ledger.refuseLast(error)`, then
   `chatCompletion(...)`. The replacement's first act inside `postWithDegrade` is `capBudgets`
   (`chat.mjs:161`), which throws when the wall-clock cap has fallen due — before `ledger.begin()`
   at line 162.
2. `chat.mjs:177` — the rung path calls `handle.refuse(error)`, applies the rung to the payload, and
   loops; the next iteration runs the same `capBudgets` before `begin`.

Either way the record can hold a `refused` entry for a replacement that was never sent: a terminal
failure filed as benign negotiation, which understates exactly the reliability figure OAI-19 reads.
All three citations verified TRUE by the Codex probe, 2026-08-01.

Narrower than the defect it replaced — `degraded()` already orders `refuseLast` *after*
`degradedLadder()`, which closes the oversize case — and the same class. The remaining window is
order-dependence: the invariant holds only because two statements happen to be in the right order,
and any new pre-dispatch check reopens it.

## The fix — make it structural rather than ordered

**Option A, the ledger-held pending flip.** The refusing layer closes the entry as the terminal
failure it currently is, and *registers* a pending reclassification; the ledger applies it as the
first act of creating the next entry. No replacement entry, no reclassification.

Chosen over an explicit `replaces:` parameter on `begin()` — which would have to be threaded from
`review-request.mjs` through the send options and the budgets object into `postWithDegrade` — and
over a one-shot replacement-scoped ledger facade. Codex checked the coupling A relies on and found
no call sequence in these files that can violate it: in `postWithDegrade` there is no `await` between
the rung refusal and the next `begin`, in `degraded()` the next model operation is the replacement,
and nothing dispatches concurrent work against a shared ledger. The pending record holds the **entry
object**, not "the last entry", so it can only ever flip the one it was registered for.

### `attempt-ledger.mjs`

- New exported constant `SHAPE_REJECTED = 'shape-rejected'`. Housed here, not in `failure-shape.mjs`:
  that file is a taxonomy of *delivery* failures with retry policy built on it, and its contract is
  failures where the model never said no — an HTTP 400 validation rejection is the opposite. It is
  therefore also, and necessarily, outside `RETRYABLE`.
- `closeHandle(...).refuse(error)` no longer sets `outcome: 'refused'`. It sets
  `outcome: 'failed'`, `reason: error?.reason ?? SHAPE_REJECTED`, and registers the pending flip.
  It must **not** be implemented by delegating to `fail()`: `fail()` consults `reachedTheModel()`
  and can add the request key to `dispatched`, which is what makes a later identical request
  `warmEligible`. (For the status-carrying errors on this path `reachedTheModel` returns false
  anyway, so today it would be harmless — but the harmlessness is incidental, and the comment at
  `attempt-ledger.mjs:38` is on record about which direction that error runs in.)
- `refuseLast(error)` keeps its name and call site but registers the pending flip against
  `entries.at(-1)` instead of flipping it, and stamps the same terminal reason. Its doc comment is
  rewritten: it no longer *states* that negotiation happened, it *predicts* it and is settled by the
  dispatch.
- `begin()` consumes any pending flip **after** the new entry is constructed and pushed, and clears
  it. Not before: `newEntry` serializes the body, and `JSON.stringify` can throw — settling first
  would reclassify the refused entry with no replacement to show for it, which is this defect again
  in miniature. Raised by the round-2 plan re-challenge.
- `markRefused` stays non-enumerable, and gains the reason fallback so a flipped entry is not left
  with a `null` reason where its failed twin had one.

### Why the reason code

A 400 from `provider.mjs` carries `.status` but never `.reason` (verified), so without this an
abandoned refusal records `reason: null` and `bench/lib/attempt-rows.mjs:68` tallies it under
`unclassified`, beside genuinely unrecognised failures — a hole in the one record OAI-19 reads
reliability off. `shape-rejected` names what happened: the server rejected the request shape and no
replacement followed. Named distinctly from the `refused` *outcome* so the two never read as
synonyms.

### `review-request.mjs`

`degraded()` registers the refusal **before** `degradedLadder()` rather than after.

**Amended during step 4, reversing this plan's own first answer.** The plan originally kept the
call where it was, on the reasoning that the existing ordering guard was worth preserving alongside
the new structural one. Building it showed that costs something real: on the oversize path
`degradedLadder` throws *first*, so `refuseLast` is never reached, and the entry keeps the
`reason: null` that `fail()` gave it — the abandoned refusal the record is least able to explain is
the one left `unclassified`. The test written for it failed on exactly that, which is the ordering
guard demonstrating it does not cover the case it was being kept for.

Registering first is safe precisely because the flip is now dispatch-gated: if `degradedLadder`
throws, the pending flip is simply never consumed and the run ends — nothing else calls `begin` on
that ledger afterwards. So the order now buys a named reason on **both** abandonment paths (oversize
and cap) and gives up nothing: the ordering guard's job is done by the gate.

## Tests

The deadline window itself is microseconds wide by construction — the transport arms the remaining
cap as its own deadline, so a request cannot *complete* after the cap, and the gap between a refusal
and the next `capBudgets` is a stderr write and a few call frames. An end-to-end test that tries to
land an expiry inside it would be a coin flip, and a flaky test is worse than an honest one. So the
deadline instance is covered at the seam where it is deterministic, and the reachable pre-dispatch
failure (oversize) is covered end to end:

1. **E2E, degraded path, replacement never dispatched** — the existing test at
   `tests/review-budget.test.js:225` (oversize). Extended with an assertion on the entry's `reason`,
   so the record is proven to name the failure rather than leaving it `unclassified`. This
   assertion is what forced the reversal recorded above.
2. **E2E, degraded path, replacement dispatched** — a server that 400s `response_format` and then
   answers. Entry 1 must be `refused`, entry 2 `answered`. This is the positive control: without it
   a fix that simply never reclassifies anything would pass every other test here.
3. **E2E, rung path, replacement dispatched** — a server that 400s `stream_options` and then
   answers. Entry 1 `refused`, entry 2 `answered`.
4. **Unit, both paths, replacement never created** — `refuse()` and `refuseLast()` each followed by
   no `begin()`: the entry stays `failed` and carries `shape-rejected`. This is the deterministic
   cover for the deadline instance, and it is the invariant stated directly.
5. **Unit, the flip targets its own entry** — register a pending flip, then `begin()` a second
   entry: entry 1 flips to `refused` and entry 2 is untouched.

The two existing tests that assert the old immediate-flip behaviour
(`tests/failure-shape.test.js:69` and `:125`) are updated to call `begin()` afterwards, since that is
now what the assertion means — not deleted, and not weakened to assert `failed`.

## Acceptance

- Both call sites register rather than assert, and no entry can read `refused` without a subsequent
  ledger entry existing.
- An abandoned refusal is `failed` with `shape-rejected`, and appears in the bench's failures-by-reason
  table under that name.
- `npm test` green; the `verify` skill passes; mutation check on the key invariant — **restore the
  immediate flip** (`refuse()`/`refuseLast()` writing `outcome = 'refused'` directly) and name the
  abandoned-refusal test that goes red. Not "make the consume fire unconditionally", which throws on
  a null slot: a crash is not a named failing assertion.

Also built, not in the first plan: `createLedger` crossed the 60-line function budget and
`attempt-ledger.mjs` the 300-line file budget, so the entry construction was lifted into `newEntry`
and the pending slot into `refusalSlot`. Structural, no behaviour change, and the ratchet is what
asked for it.

## Not in scope

The `capBudgets`-called-twice window and the `transport` reason-code narrowing are OAI-22, next.
They overlap this file's subject and are deliberately a separate change, so this one's review has a
single subject.
