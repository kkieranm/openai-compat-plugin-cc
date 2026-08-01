# OAI-25 — make the cap-ordering invariant behavioural where it can be reached

Status: approved by the Codex plan gate (two rounds, both APPROVE), 2026-08-01.

## Context

BACKLOG.md **OAI-25** asks whether anything is left to buy from making the `postWithDegrade` ordering
invariant reachable behaviourally rather than only structurally, now that OAI-22 evaluates
`capBudgets` once and carries the result into `postChat`. Its own framing suggests not: "there is no
longer a window between the check and the dispatch for a seam to drive — the already-expired case is
behaviourally tested, and what remains is guarded structurally instead."

**The probe inverted part of that premise.** Moving `capBudgets` below `ledger.begin` in
`scripts/lib/chat.mjs` made `tests/failure-shape.test.js:224` fail (actual `[{index:1, outcome:null,
reason:null, …}]`, expected `[]`); production restored clean and re-proved by `diff`. So that
ordering *is* already covered behaviourally — which means the rationale comment at
`tests/structure.test.js:196-198`, "It cannot be reached behaviourally here", is **false as
written**, and has been sitting above the guard justifying its existence.

The probe also found the clock is reachable without any production change: `capBudgets`
(`chat.mjs:122-137`) reads only the bare global `performance.now()`. And it found a genuinely
untested production path: the one `chat.mjs:69-72` names in prose — a capability refusal followed by
a wall-clock cap falling due **before** the replacement is dispatched, so `pendUntilReplaced`'s
prediction is never settled and the entry must stay `failed`/`shape-rejected`. The nearest test,
`tests/review-budget.test.js:225`, reaches that outcome through an oversized-prompt context refusal
instead — a different route to the same code.

All five probe claims were confirmed TRUE by an independent Codex read. The scope fork (comment-fix
only vs. comment-fix plus two behavioural tests) was grilled to Codex, which chose the larger scope,
a test-only clock stub over a production seam, and hook-driven clock advancement over call counting;
the `advisor` independently reached the same three answers.

Outcome intended: OAI-25 closes with the false rationale corrected and the two reachable behaviours
pinned by tests, rather than closing as "nothing left to buy" on a premise the probe refuted.

## Scope — three deliverables, no more

Deliberately bounded. `OAI-28` (the `!response.complete` branch) and `OAI-29` (arming from a
recomputed remaining budget) are adjacent and stay out.

### 1. Correct the false rationale on the structural guards

`tests/structure.test.js`, the doc comments at 186-204 and 234-244. **Keep both guards** — they are
cheap and they name the class ("an ordering that carries an invariant, pinned by nothing"). Replace
the "cannot be reached behaviourally" justification with what is now true:

- the **consequence** is established behaviourally (cite `tests/failure-shape.test.js` "a cap that
  has ALREADY expired mints no ledger entry at all", and the two new tests below);
- the **guards** localize the contract to the two statements that carry it, so a future edit that
  preserves observable behaviour by accident still fails loudly.

Also correct the stale sentence in `tests/failure-shape.test.js:230-234`, which currently tells a
reader "after OAI-22 there is no such window left to drive, which is why a structural guard stands
for it instead" — the mid-window case is drivable with a controlled clock, and test (i) drives it.

### 2. Test (i): the cap falls due between `ledger.begin` and the socket

**New file `tests/cap-ordering.test.js`**, holding both new tests and the clock stub they share.

Not appended to `tests/failure-shape.test.js`, and the reason is the repo's own size ratchet
(`tests/structure.test.js`, `DEFAULT_MAX_LINES = 300`): that file is at **247** lines, and two tests
written at this repo's comment density would breach the budget. The seam is real rather than an
excuse — `failure-shape.test.js` states its own scope as "the rules in isolation", the predicates
underneath the end-to-end suites, and both new tests drive the real `postWithDegrade` loop against a
fake server under a controlled clock. That is a different subject and a different fixture.

`tests/structure.test.js` is at **299** of 300, so its comment corrections must be net-neutral or
shrink it. If the honest rewrite needs more room, tighten the existing prose rather than raise the
ceiling — a ratchet entry is a deliberate commit that must say why, and "I wrote a longer comment"
is not a reason.

- Drive the real exported `postWithDegrade` against a fake server (`startFakeServer` in
  `tests/helpers.mjs`) that answers one ordinary completion.
- Replace `globalThis.performance` with a stub reading a test-controlled offset; restore the original
  in `finally`.
- Advance past expiry **at an observable hook**: wrap the ledger's `begin` so it calls the real
  method and then advances the clock past `expiresAt` before returning the handle. Not by counting
  `performance.now()` calls — `postChat` and `stream-collect.mjs` call it too, and an Nth-call stub
  would couple this test to unrelated timing instrumentation.
- Assert: the request **is** dispatched (the fake server received a chat request), the clock hook
  ran, and **exactly one** ledger entry exists. `postWithDegrade` deliberately returns its entry
  handle still **open** — three of the four delivery failures are only detected a layer up by
  `finishAnswer` — so the test settles the returned handle itself and only then asserts
  `outcome === 'answered'`. Asserting `answered` on the entry without settling it would be asserting
  against `null` and would pass for the wrong reason.
- This is red iff `postChat` re-evaluates the cap — the OAI-22 defect — which is the invariant the
  second structural guard stands for.

### 3. Test (ii): the cap falls due after a refusal, before the replacement

Second test in `tests/cap-ordering.test.js`.

- Fake server returns `400 {error: "stream_options is not supported"}`, which
  `capability-ladder.mjs` `RUNGS[0]` matches.
- The clock advances past expiry when that response has been delivered, so the loop's next
  `capBudgets` throws before `ledger.begin` mints the replacement entry.
- Assert: `postWithDegrade` rejects with `reason === 'deadline-timeout'`; **exactly one** ledger
  entry; `outcome === 'failed'`; `reason === SHAPE_REJECTED`. Never `refused`, and never a second
  (phantom) entry.
- Expected values are read from a printed entry before being written, not assumed from
  `chat.mjs`'s prose. `pendUntilReplaced` (`attempt-outcome.mjs:114-118`) sets exactly
  `failed`/`SHAPE_REJECTED` for a 400 carrying no `.reason`, and only `begin` → `refusal.settle()`
  can flip it, so the predicted values are `failed`/`shape-rejected`.

## Files touched

- `tests/cap-ordering.test.js` — **new**, the two behavioural tests and their clock stub.
- `tests/failure-shape.test.js` — one comment correction (the stale "no such window left to drive").
- `tests/structure.test.js` — comment corrections only, no assertion changes, net-neutral in length.
- `plans/oai-25-cap-ordering-behavioural.md` — new (this plan).
- `BACKLOG.md` / `BACKLOG_DONE.md` — item moved at step 7.

**No production code changes.** That is the point of choosing the global stub over an injected `now`
seam: OAI-25 flagged "changes production code for testability" as needing its own grill, and the
grill's answer was that it is not needed.

## Risks, named

- **The stub is a global.** `globalThis.performance` is shared, so the restore must be in `finally`
  and the offset must be small (just past expiry, not `+1e9`) so `prefillMs`/`generationMs` arithmetic
  downstream stays sane. `node --test` runs files in separate processes and tests within a file
  serially by default, so a leak cannot cross into another suite's clock.
- **Test (i) could pass vacuously** if the hook never fires or the advance lands after the cap is
  already read. Guard it: assert the server actually received a chat request, and assert the clock
  hook ran.
- **Fake servers must be closed in `finally`** alongside the clock restore, or a failing assertion
  leaks a listening socket into the rest of the file.
- **No ADR.** This is coverage plus a comment correction, not an architectural decision. ADR 012
  already owns the attempt-record design; the CLAUDE.md line for it needs no change.

## Verification

1. `npm test` — full suite green, summary line quoted.
2. **Mutation check, the production one** (`~/Code/dotfiles/tests/mutation-landed.py`): re-add a
   `capBudgets` evaluation inside `postChat` so the carried budget is discarded. Test (i) must go
   red. Restore, prove against the backup copy with `diff`, re-run green.
3. Second mutation, for test (ii): in `postWithDegrade`, move the `capBudgets` call inside the
   `try` (or below `ledger.begin`) and confirm the refusal test's single-entry assertion goes red.
4. The repo `verify` skill (`.claude/skills/verify/SKILL.md`) — tests, a real plugin load, and a
   delegation round trip.
