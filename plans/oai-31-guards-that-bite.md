# OAI-31 — six findings OAI-26's pass 3 raised and could not fix

> **Correction, 2026-08-03 — three things below were refuted during the build and are left in place
> rather than rewritten, per this repo's convention that a plan records what was believed at the
> time.**
>
> 1. **"Budget: expected ~277 lines" (Phase 2) was wrong.** The edits took
>    `tests/bench-reliability.test.js` to 320 against the 300 ratchet. The ratchet was **not** raised;
>    the file was split at the accounting/prose seam its own comments already drew, and the prose half
>    is now `tests/bench-reason-notes.test.js`. Codex's plan gate had made the same wrong prediction
>    ("the proposed edits fit beneath the unchanged 300-line ratchet"), which is worth recording: the
>    gate is a reviewer, not an oracle.
> 2. **Phase 2 item 8's tripwire design was refuted twice.** It is not "keyed to the literal field
>    name" and it does not live "in this file, beside the prose". A **blind** re-ask of the plan gate
>    showed that pinning `Object.hasOwn(entry, 'serverResponded') === false` does not guard the
>    sentence it claims to: a future field named anything else falsifies the prose while the assertion
>    stays green, and `serverResponded` is not peer-reachability anyway — a TLS rejection reaches a
>    peer and obtains no response. The prose now **enumerates what the record holds** and the test pins
>    the whole key set.
> 3. **And the hand-written enumeration was refuted in turn**, by the review ladder's adversarial
>    stage: a transcribed list is a mirror, and it had already drifted — its first draft named eight of
>    the nine fields with the key-set test green beside it. The enumeration is now **generated** from a
>    single `RECORD_FIELDS` list. The same stage found the sentence's categorical reachability claim
>    contradicted `firstTextNote` in the same file; it now states the asymmetry instead.
>
> The through-line, which is also the item's own subject: **every draft that asserted something about
> a set it had not enumerated was wrong, including three written as the fix for the previous one.**

## Context

OAI-26 shipped two paragraphs of the benchmark's reliability report. Its pass 3 was the
no-mutation pass, so six defects were recorded rather than patched. Two are **false sentences in
rendered output**, which a reader of the OAI-19 write-up would take at face value; three are
assertions that pass for the wrong reason, so the guards protecting that prose protect nothing;
one is an alternation that pins neither of its branches.

All six were **verified before planning** — three by Codex reading the cited code, three by
mutation against the live tree (restored clean, `git status` empty):

| # | Claim | How verified |
|---|---|---|
| 1 | `reliability-report.mjs:72` "the reason code is all an attempt record carries" is **false** | Codex: `newEntry` also records `index`, `cause`, `promptChars`, `warmEligible`, `waitedMs`, `outcome`, `prefillMs`, `generationMs` |
| 2 | `:112` "a replacement request … was dispatched" equates entry creation with the wire write | Codex: `ledger.begin` (`chat.mjs:54`) precedes `postChat` (`:64`); body serialization (`provider.mjs:124`) and URL validation (`http.mjs:244`) can still throw before `request.write` (`http.mjs:288`) |
| 3 | The two-fixture loop at `tests/bench-reliability.test.js:190` is vacuous | **Mutation**: both fixture strings replaced with identical `JUNK JUNK JUNK` → 19/19 green |
| 4 | ``assert.match(markdown, /`shape-rejected`/)`` matches the count-table row | **Mutation**: paragraph body gutted → assertion still passed, matching `` | `shape-rejected` | 1 | `` |
| 5 | `sawReason`'s `key === code` is unguarded, and `transport` ⊂ `non-retryable-transport` | **Mutation**: `key.includes(code)` → **404/404 green**, and a `non-retryable-transport`-only sweep then printed "a further attempt could plausibly survive" about a code never retried |
| 6 | The `not**`/`not` alternation at `:178` passes either way | Read |

A seventh fact surfaced during the probe and is the sharpest one here: **`tests/bench-reliability.test.js:207`
asserts the false sentence verbatim** — `assert.match(para, /the reason code is all an attempt record carries/)`.
The guard is holding the falsehood in place, so the prose and its test must move together.

Intended outcome: no false sentence in rendered output, and every assertion that survives this
change fails when the thing it names changes.

## Decisions settled with Codex (grill)

- **Finding 1 — neither "delete" nor my proposed "narrow".** Codex rejected both. Deleting the
  peer-reachability apparatus makes the report *less* safe today (a reader will read
  `non-retryable-transport` as "the server was reached and failed"); my "retains nothing further
  about the transport error" is an open-ended semantic universal — the same style of claim as the
  defect, harder to falsify than necessary. Adopted instead: **name the missing capability.**
  "…because the attempt record has no peer-reachability field." Precise, and **mechanically
  falsified when OAI-35 lands `serverResponded`**.
- **Finding 3 — collapse, don't enrich.** One document containing *both* dead runs, with three
  independent witnesses, beats a richer parametrisation and costs fewer lines. Codex's addition to
  my proposal: asserting only the *absence* of `CERT_HAS_EXPIRED` is weak — it also passes if the
  TLS run vanishes from the listing — so assert `certificate has expired` is **present** too.
- **Finding 2 — fold, don't delete (d2).** Sentence two carries a distinct invariant (ordering:
  `refused` is written only once the replacement has an entry, which is what makes the reading
  auditable), so it survives, folded. And the fix is **incomplete unless the closing sentence's
  "It says a replacement was **sent**" changes too** — it repeats the same wire-level overclaim.
- **Finding 5 — no standalone test.** The existing `non-retryable-transport` test already builds
  the exact single-code sweep required; one assertion plus a comment, not ten lines.
- **Ratchet: do not raise it.** `tests/bench-reliability.test.js` is at 270 of 300.

## Phase 1 — the rendered prose (`bench/lib/reliability-report.mjs`, 207 lines)

1. **`reasonNotes`, the `non-retryable-transport` paragraph (~line 72).** Replace
   "…because the reason code is all an attempt record carries." with
   "…because the attempt record has no peer-reachability field."
2. **The governing doc comment (lines 42–48).** It currently states the rule Codex rejected —
   "The attempt record retains nothing further about the transport error, and that is the whole of
   what the three paragraphs *in this function* may claim." Left as-is, the next drafter follows
   the comment rather than the fix. Rescope it to the falsifiable form: a paragraph may name a
   **specific field the record lacks**, never assert an open-ended absence. Keep the existing
   `firstTextNote` scope note.
3. **`outcomeNotes`, the `refused` paragraph (lines 108–119).** Adopt the (d2) wording: the
   capability rejection *triggers a replacement request*; the original "is marked `refused` only
   once that replacement has its own attempt entry, so one always follows it in the same run";
   and the closing claim becomes **"It records an initiated replacement, not a guaranteed wire
   write"**. Preserve the literal phrase `refused for their shape` — the ordering test at
   `tests/bench-reliability.test.js:229` anchors on it.

## Phase 2 — the guards (`tests/bench-reliability.test.js`, 270 lines)

4. **Finding 5, the one with teeth.** In the existing `non-retryable-transport` test, keep the
   `markdown` value instead of discarding it into `paragraphAbout`, and add
   ``assert.doesNotMatch(markdown, /^`transport` below/m)`` with a comment naming the substring
   collision and why the sibling's reverse containment is vacuous.
5. **Findings 1+3 together** — they are the same test. Collapse the two-fixture loop into one test
   rendering **both** dead runs in one document: keep the two refuted-draft negative assertions,
   swap the false-sentence assertion for `/no peer-reachability field/`, and add the three
   document-level witnesses — `EHOSTUNREACH` present, `certificate has expired` present,
   `CERT_HAS_EXPIRED` absent. That triple is the fact that refuted draft 3 and is currently
   asserted by nothing.
6. **Finding 4.** Replace the count-table-matching assertion with one scoped through the existing
   `paragraphAbout` helper: ``assert.match(paragraphAbout(markdown, 'shape-rejected'), /terminal twin of the `refused` outcome/)``.
7. **Finding 6.** Pin the emphasised branch only: `/\*\*not\*\* a count of server misbehaviour/`.
8. **New — the OAI-35 tripwire.** The peer-reachability sentence is a claim about the *record*, so
   pin it rather than asserting it. Drive a ledger entry through `fail()` with an error carrying
   `serverResponded: true`, then assert `Object.hasOwn(entry, 'serverResponded') === false`.
   Three deliberate choices: asserted **after `fail()` closes the entry**, not on the freshly
   minted one, because `fail()` (`attempt-outcome.mjs:155`) is where OAI-35 copies the flag and a
   test against `newEntry` would stay green forever; keyed to the **literal field name**, not the
   semantic property, since "no field tells you whether a peer was reached" is itself an
   unenumerated universal (and `warmEligible` derives from `reachedTheModel`, which is
   cache-warmth, *not* server-reached); and `Object.hasOwn`, per the `key in object` trap.
   Lives in this file, beside the prose it guards — the dependent is the prose, per the
   "enforce the invariant where the thing that depends on it lives" trap.

Budget: the collapse in (5) frees roughly what (4) and (8) spend; expected ~277 lines. Checked
before the commit gate.

## Phase 3 — record

9. **`.claude/REPO_TRAPS.md`.** The entry "Reader-facing prose asserts a property of a whole class
   from one sub-population" already documents these as instances 4–6 but names no guard. Add the
   **Guarded by** line, per the file's own convention.
10. **`BACKLOG.md` → `BACKLOG_DONE.md`.** No ADR: this is a correction batch, not a decision, and
    ADR 012's peer-reachability limitation stays accurate until OAI-35. CLAUDE.md's `reasonNotes`
    line stays true as written — checked.

## Verification

- `npm test` — 404 tests, quoted green summary.
- **Mutation (the feature's key invariant, per step 5):** `key === code` → `key.includes(code)`
  must now go **red**, naming the new assertion from (4). Run through
  `~/Code/dotfiles/tests/mutation-landed.py` with the backup-and-operands-written-first protocol,
  then restore and prove the restore against the copy.
- **Two confirming mutations**, since the point of this work is that these assertions bite:
  gutting the `shape-rejected` paragraph must fail (6)'s assertion; junking **one** of the two
  fixtures must fail (5)'s test.
- The repo `verify` skill.
- `tests/structure.test.js` green — the ratchet, unraised.

## Note on process

The `/feature` skill writes the plan to `plans/oai-31-*.md` in the repo *before* the harness plan
file. Plan mode permits editing only this file, so that mirror is written first thing on exit,
before any code.
