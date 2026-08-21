STATE: authored unattended, dual-gate route (not harness plan mode)

No `provenance:` line — this plan was never entered through harness `EnterPlanMode`/`ExitPlanMode`,
which is a fact about its authority and stays true. It was authored 2026-08-21 during an unattended
~7-hour session, under the user's standing directive for that session: "iterate on some items in
backlog while i go away. converge with codex and a fable agent when needed. do not ask for user
input." `ExitPlanMode` requires user approval and would hang waiting for an operator who has left, so
harness plan mode was not entered. Per the `/feature` skill's own rule — "approval is EITHER Codex and
Claude in AGREEMENT, OR the user's" — this plan instead goes through the full dual-approval gate
(Codex `task` + a fable-pinned verdict subagent, launched together against one digest, neither shown
the other's reply, `--approved` + `--dual-approved`) as the user-absent route the process already
defines. If either approver fails to return a usable verdict, this plan degrades to
`plans/README.md`'s `unattended-draft` convention (Codex pre-review only, item left `blocked-on-plan`
for the user) rather than proceeding to build on a partial gate.

# OAI-113 — `scanFor` is quadratic on a reply of many unmatched brackets

## Bug, confirmed reproduced

`scripts/lib/json-scan.mjs`'s `scanFor` loops calling `balanced(text, from, open, close)`, and on
failure (an opener that never closes) advances `from = run.start + 1` and retries. `balanced` itself
scans forward from `start` to the END of `text` whenever the bracket never balances. For a reply
consisting of many unmatched openers, this makes `scanFor` re-scan the same trailing suffix once per
opener — O(n²).

Reproduced live:

```
node -e 'import("./scripts/lib/json-scan.mjs").then(({extractJson}) => {
  const big = "[".repeat(200000);
  const t0 = Date.now();
  extractJson(big);
  console.log(Date.now() - t0);
});'
# → 35936 (ms)
```

Nothing upstream bounds this: `--max-seconds` is a transport deadline, and this CPU is spent after
the bytes have already arrived.

## Fix — a single-pass, stack-based rewrite of `balanced`/`scanFor`

Consulted Codex on the design; two options were on the table (a stack-based single-pass rewrite, or
capping total scan work per the backlog item's own alternative suggestion). Codex recommended the
stack rewrite decisively: a work cap "cannot guarantee 'every nested span' beyond an arbitrary
threshold and would turn recoverable replies into unreadable ones" — capping trades away real
findings recovery to bound CPU, where the stack rewrite gets both correctness and linear time.

**Neither `balanced` nor `scanFor` is exported** — only `extractJson` is, and it has exactly one
consumer (`structured.mjs`). This is a contained, internal rewrite; nothing outside this file can
observe the change except through `extractJson`'s input→output behavior.

Replace the restart-from-every-position approach with ONE linear pass over `text` per bracket type,
maintaining an ordered list of "opener records" (an index, pushed as a stack for matching, plus
insertion order preserved for evaluation):

- String/escape tracking becomes CONTINUOUS across the whole pass (tracked once, not reset at every
  restart position, which is what the current `balanced` does today — its own docstring calls that
  reset a documented, accepted inaccuracy: "An open living inside a quoted string is therefore
  entered as if it were JSON... this function reports failure on inputs that are not malformed at
  all").
- On an `open` character (when not in a string): push a new opener record `{ start: index, end: null
  }` onto a stack, and also append it to an ordered list (for evaluation order — see below).
- On a `close` character (when not in a string): if the stack is non-empty, pop the top record and
  set its `end = index + 1`. If the stack is empty, ignore (no candidate, matches current behavior
  when `indexOf` finds no opener at all).
- After the pass, iterate the ORDERED LIST (not the stack, which discards order) and for every record
  with a non-null `end`, slice `text.slice(record.start, record.end)`, `JSON.parse` it, and call
  `accept(value)` exactly as `scanFor` does today — in OPENING-POSITION order, matching current
  behavior. (Codex's specific catch: "a naïve stack emits spans in closing order... Preserve \[opening
  order] because `accept` is caller-provided and could be stateful.")
- An opener left on the stack with no matching close at the end of the pass produces no candidate —
  matches current behavior for an unmatched opener.

Codex traced span equivalence by hand for `[[]]`, `[[][]]`, `text [1] more [2, [3]] end`, and
`["a ] b"]` — all four produce identical `(start, end)` sets under both the current restart approach
and the stack rewrite. This is expected: LIFO matching (a close pairs with the most recently opened,
still-unclosed opener) is exactly what the current per-position restart approach computes too, when
string/escape state does not diverge between the two approaches.

## Behavior change, deliberately accepted — not a regression to prevent, a trade to document

**Corrected after plan-gate round 1**: the first version of this section understated the scope.
Codex found the change is broader than "an unmatched quote" — it is any bracket pair sitting entirely
inside a CLOSED quoted string, not merely an unclosed one. `tests/candidate-selection.test.js:227`
does not prove equivalence for this class; it only proves a LATER real wrapper stays discoverable when
one exists, which is a different claim from "the quoted decoy itself produces the same candidate set."

The general rule: today's per-position reset scans blindly from every opener, ignoring true quote
context entirely, so it can accidentally find and parse ANY bracket-balanced content anywhere in the
text — including fully inside a closed quoted string — as its own independent candidate. The
continuous-tracking rewrite correctly recognizes quote context throughout and never treats content
inside ANY quote (closed or unclosed) as a candidate. Verified live at HEAD (pre-fix), with the
DEFAULT `accept` (matching how `tests/json-scan.test.js` exercises `extractJson` directly):

```
extractJson('prefix "quoted [1,2]" suffix')          // closed quote → [1, 2]
extractJson('unfinished explanation "\n{"a":1}')     // unclosed quote → {"a":1}
```

Both return a value today; both return `null` under the rewrite, for the same underlying reason (a
bracket pair the true document state places inside a string is no longer scanned as a candidate at
all, whether that string is later closed or never closes).

**Whether this reaches real behavior through `structured.mjs`'s actual caller, `findingsShaped`
(not the bare default `accept`)**: checked directly — a quoted decoy shaped like a real finding
(`"example: [{\"file\":\"fake.js\",\"summary\":\"fake\"}]"`) followed by a genuine trailing wrapper
still returns the real wrapper's findings under CURRENT code, because position ranking (last outermost
wins) already defeats a leading quoted decoy regardless of whether it was scanned as a candidate at
all. So in the specific shape this repo's system prompt produces (quoted source BEFORE the real
answer), this behavior change is not expected to alter production parsing outcomes — it removes
candidates that position-ranking was already discarding. The risk is narrower still than "any
decoy inside quotes now vanishes": it is that a quoted decoy could in principle be the ONLY
findings-shaped content in a reply (no real trailing payload), which today might be accidentally
"found" and reported as findings when it should read unreadable/no-payload — arguably a correctness
IMPROVEMENT, not a regression, though not the primary motivation for this fix.

Codex confirmed no existing test's own PASS/FAIL status depends on this class:
`tests/candidate-selection.test.js:219` (unmatched bracket, not a quote), `:227` (a later real
wrapper stays discoverable regardless — the specific assertion made, not "the quoted content is
still scanned"), `:260` (same-type nesting, unaffected), and `tests/json-scan.test.js:19` (string
awareness — the in-string `}` sits inside a string that is itself inside the accepted object, and
continuous tracking reaches it with `inString` correctly false, matching current behavior) all still
pass under the rewrite. Pinned explicitly as tests of the NEW (changed) behavior at the `extractJson`
layer with default `accept`, per the two live examples above, not silently absorbed.

**Out of scope, noted by Codex and correctly separate**: a deeply nested, fully-balanced input can
still have quadratic AGGREGATE work across `JSON.parse` calls on nested spans (parsing an
outer span re-parses everything inside it, and so does the next level in). This is inherent to
returning every nesting level as its own candidate (required — see `extractJson`'s "outermost" filter,
which needs every level to filter correctly) and is a different, pre-existing property of `scanFor`'s
contract, not the unmatched-opener rescan this item targets. Not fixed here.

## Tests

Add to `tests/json-scan.test.js` (the file whose existing tests directly exercise `extractJson`'s
scanning behavior, per its own header comment):

1. **Performance regression** (the backlog item's own ask — "a large malformed prefix"): a 200KB
   string of unmatched `[` characters must be handled by `extractJson` in well under a second (assert
   e.g. `< 1000` ms as a generous margin over measured linear-time performance, avoiding a flaky
   tight bound), returning `null`.
2. **Structural correctness AND opening-position evaluation order** — mirroring Codex's traced table
   AND the fable verdict subagent's caveat that a bare `extractJson` return cannot prove inner-span
   enumeration or ordering (containment/last-wins are order-independent from the outside). Use a
   STATEFUL custom `accept` callback (not the default) over `[[]]`-shaped input embedded in prose: the
   callback records each candidate span it is called with, in call order, and the test asserts (a)
   both the outer and inner spans are independently discoverable as candidates and (b) they arrive in
   OPENING-POSITION order (outer span's callback fires before the inner span's), not closing order —
   the specific property a naive stack-emits-in-closing-order implementation would get wrong.
3. **The deliberate behavior-change pin, both shapes**: with the DEFAULT `accept` (matching how this
   test file already calls `extractJson` elsewhere), assert both
   `extractJson('prefix "quoted [1,2]" suffix')` and
   `extractJson('unfinished explanation "\n{"a":1}')` now return `null` — the closed-quote and
   unclosed-quote cases respectively, both flipped from today's accidental recovery — with a comment
   naming the general rule (content inside ANY quote, closed or unclosed, is no longer independently
   scanned) and its rationale.

Existing tests in `tests/candidate-selection.test.js` (`:219`, `:227`, `:241`, `:251`, `:260`) and
`tests/json-scan.test.js` (all three) are expected to pass unchanged and serve as the regression
suite proving the rewrite is behavior-preserving apart from the documented trade above.

## Verify

1. `npm test` full suite green.
2. Mutation check on the rewrite's key invariant: mutate the stack-pop logic (e.g. change "pop the
   top record" to something that breaks LIFO matching, or remove the opening-order re-sort) and
   confirm the structural-correctness test(s) go red, restore, confirm green again — per the repo's
   mutation-landed protocol.
3. Re-run the live reproduction from the Bug section and confirm it now completes in well under a
   second rather than ~36s.

## Files touched

- `scripts/lib/json-scan.mjs` (rewrite `balanced`/`scanFor`)
- `tests/json-scan.test.js` (3 new tests: performance regression, structural correctness, behavior-
  change pin)

## Residue

None anticipated. The out-of-scope quadratic-aggregate-parse-cost property noted above is an existing,
inherent characteristic of `scanFor`'s contract (returning every nesting level as a candidate), not a
defect this item introduces or was scoped to fix — noted here rather than filed, since it is not a
dated instance or a demonstrated failure, just a documented shape of the existing design.
