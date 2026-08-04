# OAI-35 — carry `serverResponded` onto the attempt entry

state: `final`
provenance: written in-session at step 3. Probe: one `Explore` sweep + one Codex claim check. Plan
gate: three Codex rounds, `APPROVE` on the blind re-ask of this version.


## Context

`scripts/lib/http.mjs:107` already sets `error.serverResponded = true` when a socket is cut mid-body,
and `scripts/lib/cmd-setup.mjs:32` reads it to tell "the server is down" from "the server is up and
lacks this endpoint". But `attempt-outcome.mjs`'s `fail()` copies only `outcome`, `reason`,
`prefillMs` and `generationMs`, so the flag dies before the ledger.

The consequence is that in the benchmark's reliability record, **a `transport` failure with a null
`prefillMs` is indistinguishable from an `ECONNREFUSED` that obtained no response at all** — which is
precisely the shape a model evicted mid-prefill produces. OAI-34's TTL instrument is blind without
it, and `bench/lib/reliability-report.mjs` currently spends four lines of prose saying the table
cannot tell you which. This removes the limitation instead of describing it.

> **Corrected during the plan gate, round 3** — that last sentence is half wrong, and is left standing
> per this repo's convention. Only the *response-obtained* half of that limitation is removed; the
> *peer-reached* half survives. See "What this does and does not remove" below.

## Decisions settled before planning

Reached with Codex, then confirmed with the user where scope changed.

1. **The field is a boolean on every entry**, meaning *"an HTTP response was obtained"* — headers
   arrived, the same evidence ADR 012 says `delivered` carries. Not `null`-on-answered: unlike
   `prefillMs: null` the answer is already known, and a `null` beside `outcome: "answered"` in
   exported JSON reads as *no response* rather than *not measured*. This is forced anyway —
   `tests/bench-reason-notes.test.js:197-236` asserts all four closing paths leave an identical key
   set, so the field must be minted in `newEntry`.
2. **OAI-37 is absorbed.** Its subject is one clause in the very paragraph this item must rewrite.
   Preserving a known-false clause to keep the changes separate would leave a tracked item pointing
   at prose that no longer exists.
3. **A count table splits failures on the new field, with three buckets** (user-confirmed; it grows
   the item past its written done-conditions). Without it the paragraph's limitation stays literally
   true *of the table*, so it cannot shrink — only be reworded into a different description of a gap,
   which is the prose churn this file's own comments record.

## Two corrections to the item's text, carried into the work

- The item cites **ADR 012** for the phrase *"does not establish whether a peer was reached"*. That
  literal phrase is in **`adr/013-observing-the-server.md:25-27`**, quoting ADR 012; the substantive
  ADR 012 passage is `:71-74` (the rejected `unreachable` name). Both get edited; the citation in the
  backlog was wrong.
- The item says the tripwire fires "the moment `fail()` copies a tenth field".
  `tests/bench-reason-notes.test.js:182` **already passes `serverResponded: true` into `fail()`** — the
  tripwire is pre-armed and fires on the `RECORD_FIELDS` edit.

## Phase 1 — the field on the record

`scripts/lib/attempt-ledger.mjs`, `newEntry` (`:59-78`): mint `serverResponded: false` alongside the
other eight, with a comment saying `false` means *no HTTP response was obtained*, never *no host was
reachable*.

`scripts/lib/attempt-outcome.mjs`:

- A new pure `obtainedResponse(error)` beside `reachedTheModel`, taking **three independent
  witnesses** so no single forgetful call site can silently record a false negative — the failure
  mode this design carries:
  ```js
  error?.serverResponded === true        // the transport saw headers
  || error?.status !== undefined         // an HTTP status IS a response
  || COMPLETION_SHAPES.has(error?.reason) // a reply document arrived and was judged unusable
  ```
  This is not hypothetical: `tests/failure-shape.test.js:161,173` mint 400-status errors with no
  `serverResponded`, though `provider.mjs:108` always pairs them in production.
- `settle()` → `entry.serverResponded = true` (an answered attempt definitionally obtained one).
- `pendUntilReplaced()` → `entry.serverResponded = true` **unconditionally**, not derived. A shape
  rejection *is* an HTTP response — the server read the request and rejected it — so the value follows
  from the outcome, not from evidence. Deriving it here would be actively wrong:
  `ledger.refuseLast()` is called with **no error** at `tests/failure-shape.test.js:174,188`, so
  `fail()` would record `true` from the 400's status and `pendUntilReplaced` would immediately
  overwrite it with `false`, and `refuse({reason: null})` at
  `tests/bench-reason-notes.test.js:216` would mint a refused entry claiming no response was
  obtained. So only ordinary `fail()` needs the three-witness helper.
- `fail()` → `entry.serverResponded = obtainedResponse(error)`.

**Hard constraint:** `obtainedResponse` must not touch `dispatched`, and `reachedTheModel` must not
change. Both read `error.status`, for *opposite* answers — a status means an HTTP response WAS
obtained and the model's prefill was NOT reached. Conflating them would corrupt `warmEligible`, which
silently deletes cold prefill measurements. A comment states this.

Tests, end to end through the ledger rather than on the error alone:

- **mid-body cut records `true`** — the fake-server fixture at
  `tests/transport-classification.test.js:227-250`.
- **refused connection records `false`** — `:185-193`, which dials `127.0.0.1:1` and is the real
  `ECONNREFUSED` case. *(An earlier draft of this plan cited `:217-225` for this; that test is
  `ENOTFOUND`, a DNS failure, and does not prove the refused-connection condition. It may assert
  `false` too, as a second shape, but it is not the fixture that matters.)*
- **`fail({status: 400})` → `refuseLast()` → replacement keeps `true`** — the path that regressed in
  the first draft, so it gets an assertion rather than trust.

## Phase 2 — split the file before adding to it

`bench/lib/reliability-report.mjs` measures **296** lines the way `tests/structure.test.js:53` counts
(`split('\n').length`, one more than `wc -l`) against a 300 ceiling, and `ALLOWLIST` is empty, so
every file is on the default. Its own comment at `:43-47` prescribes the seam.

New `bench/lib/reason-notes.mjs` takes `RECORD_FIELDS` (`:19-61`), `recordList` (`:63-67`) and
`reasonNotes` (`:74-167`). `reasonNotes(sawReason)` takes no `stats`, and `outcomeNotes` builds the
predicate at `:186` and calls it at `:207` — so this costs exactly one import back.
`tests/bench-reason-notes.test.js:5` repoints its `RECORD_FIELDS` import to the new module rather than
a re-export, which would be indirection existing only for a test.

Not an allowlist entry: `tests/structure.test.js:70` makes an allowlisted file skip the 60-line
per-function budget too, so raising a ceiling silently drops a second guard.

## Phase 3 — `RECORD_FIELDS`, and the paragraph

- Add `['serverResponded', 'whether an HTTP response was obtained']`. This turns
  `tests/bench-reason-notes.test.js:190-194` red by design; that is the mechanism working.
- Rewrite the `non-retryable-transport` paragraph (now in `reason-notes.mjs`) — **but only along the
  axis this change actually settles.** See "What this does and does not remove" below: the paragraph
  keeps a concise statement that neither the field nor the table makes a peer-reachability finding,
  and loses only the part that was about the record's inability to say whether a **response** was
  obtained. Correct the ECONNREFUSED clause along the axis split — `ENOTFOUND` reached no peer;
  `ECONNREFUSED` reached a **host** and obtained no HTTP response; a TLS or protocol failure reached a
  peer and obtained none either. Point at the new table for the response axis only.
- Its four guards must survive, and they do: `/before any response was obtained/`,
  `doesNotMatch(/not a reachability finding/)`, both codes still **named**, and
  `doesNotMatch(/was unreachable|unreachable host|server was down|could not reach/)`.
- Update the stale counts nine → ten: `reason-notes.mjs` (was `reliability-report.mjs:33`) and
  `tests/bench-reason-notes.test.js:169,187,197,200,229`.
- Update the two test comment blocks that repeat the refuted claim in prose,
  `tests/bench-reason-notes.test.js:9-16` and `:69-76` — a fix to the rendered paragraph alone would
  leave the comments asserting what the code no longer says.

## Phase 4 — the table

`bench/lib/attempt-rows.mjs`: a `byServerResponded` tally mirroring `byFirstText` (`:84-86`), with
**three** buckets — `HTTP response obtained` / `no HTTP response obtained` / `not recorded`. The third
is not optional: every record already in `bench/results/` predates the field, and folding `undefined`
into `false` would turn missing instrumentation into a negative observation — the trap `:81-83`
documents for `byFirstText`.

`bench/lib/reliability-report.mjs`: a gated note beside a `countTable(...)` call, worded strictly as
**"an HTTP response was obtained"**, never "peer reached" — a TLS handshake reaches a peer and obtains
no response.

## What this does and does not remove — and a third correction to the item

The backlog item says this "would let the reliability report split failures on whether a **peer was
reached**", and that it "removes the limitation rather than describing it". **That framing is wrong,
and the plan must not inherit it.** `serverResponded` settles one axis only:

| axis | settled by this change? |
|---|---|
| was an **HTTP response** obtained | **yes** — that is the field |
| was a **peer/host** reached | **no** — `ENOTFOUND`, `ECONNREFUSED` and a TLS rejection differ here and can all record `false` |

So ADR 012's rejection of the name `unreachable` (`:71-74`) stays **substantively valid** and is not
struck; it gains a note that the record now settles the response axis while the reachability axis
remains open. The paragraph keeps a short peer-reachability disclaimer rather than dropping it
wholesale, and the ECONNREFUSED correction is what keeps the two axes visibly apart — which is the
strongest reason to absorb OAI-37 here rather than later.

This does **not** weaken the unblocking of OAI-34, whose question is "did a server answer at all
before the connection died" — a model evicted mid-prefill has already had its response headers sent,
so it records `true`, where `ECONNREFUSED` records `false`. That is the response axis, and it is
exactly the one this settles.

## Phase 5 — docs and tracker

`adr/012-surviving-the-server.md:71-74`, `:100-101` and the `Server state is not recorded` limitation
at `:230-234`; `adr/013-observing-the-server.md:14-27` (OAI-34 is no longer blocked); `CLAUDE.md:63-66`
(one line, per the repo's size rule); `.claude/REPO_TRAPS.md:746-747,764-765`. `BACKLOG.md` → OAI-35
and OAI-37 to `BACKLOG_DONE.md`, OAI-37 recorded as **absorbed**, and OAI-34's blocker struck. The
done entry records all three corrections to the item's own text — the ADR 012 citation, the
already-armed tripwire, and the peer-reached framing above — because this repo's convention is that a
refuted premise is written down rather than quietly fixed.

## Verification

1. `npm test` (the `tests/**/*.test.js` scope is load-bearing).
2. The repo `verify` skill — real plugin load and a delegation round trip.
3. **Mutation check on the key invariant.** The invariant is *`fail()` records `true` exactly when the
   error evidences an obtained response*. Mutate `obtainedResponse` to return a constant `false`,
   prove it landed with `~/Code/dotfiles/tests/mutation-landed.py`, and expect the mid-body-cut
   end-to-end test from phase 1 to go red. Restore and prove the restore against the backup.
4. Watch two budgets while editing: `tests/bench-reason-notes.test.js` is at **265** and gains tests,
   and `tests/structure.test.js` itself is at **exactly 300** with a `>` comparison — zero headroom,
   so nothing may be added to it.

---

## What changed during review — read this before trusting anything above

This plan was approved before any code existed and is kept as written, per `plans/README.md`. Three
review passes then changed four things it specifies. Where the two disagree, the code is right.

**`obtainedResponse` has FOUR witnesses, not three.** The plan lists the flag, a `status` and a
completion shape. Pass 2 added a measured `prefillMs`, because the third witness turned out to be a
single point of forgetting *in fact*: a verifier deleted the flag write in `body.mjs`'s `bad-json`
branch and the whole suite stayed green. A prefill is stamped by the code that read the stream, so it
is the one witness that does not depend on a minting site remembering anything.

**Both witness guards are stricter than "present".** `status` must be `Number.isInteger(...) && >= 100`
and `prefillMs` must be `Number.isFinite(...) && >= 0`. The plan's `error?.status !== undefined`
admitted `null`; the first tightening still admitted `0`, `NaN` and `Infinity`.

**`respondedNote` is `respondedSection`, and it returns the prose AND the table.** The plan has a note
beside a `countTable(...)` call. As two separate pushes into one array they came apart on the
zero-failure path — the note suppressed, the table printing three all-zero rows — so they are one
function now.

**The verification section is superseded.** It proposes one mutation, on `obtainedResponse` returning
a constant. What actually shipped: each of three minting sites reddens on deletion of its own flag
write; both tightened guards redden their own tests; the `RESPONSE_BUCKETS` seed reddens its test. The
plan's own proposal would have passed against a vacuous test — the mid-body-cut case it names
delivered model text, so the fourth witness reconstructed the value and the case survived deletion of
the very write it was written to guard. That is the single most useful thing this feature produced,
and it is recorded as a class in `.claude/REPO_TRAPS.md`.

Two minting sites remain UNCOVERED and are named in `tests/attempt-response-sites.test.js` rather than
implied to be guarded: `http.mjs`'s `!response.complete` branch and `body.mjs`'s oversized-document
branch. The first is filed as OAI-38.
