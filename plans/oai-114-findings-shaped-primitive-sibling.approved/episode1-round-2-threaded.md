ARCHIVE — not the current spec; the plan beside it is
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

# OAI-114 — `findingsShaped`'s `objects` predicate discards a whole findings list for one non-object sibling

## Bug, confirmed reproduced

`scripts/lib/findings-candidate.mjs:76`, inside `findingsShaped`:

```js
const objects = (list) => list.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
```

requires **every** element of a candidate findings list to be an object. A reply shaped
`{"findings":[{"file":"a.js","summary":"real bug"},"junk"]}` is therefore rejected as a candidate
entirely — `findingsShaped` returns `false` — and `structured.mjs`'s `findingsIn` reports the whole
reply as `NO_PAYLOAD` (surfaced as `null` from `parseFindings`) instead of keeping the valid finding
and counting `"junk"` as `dropped: 1`.

Reproduced live at the pre-fix code (this is the bug this plan fixes; the snippet below shows the
broken result, not the shipped one):

```
node -e 'import("./scripts/lib/structured.mjs").then(({parseFindings}) => {
  const content = JSON.stringify({findings: [{file:"a.js", summary:"real bug"}, "junk"]});
  console.log(JSON.stringify(parseFindings({content, reasoning: ""}, {structured: false})));
});'
# → null
```

This contradicts ADR 003's stated guarantee — a bare array is the same reply as `{findings:[...]}`,
and a malformed sibling is counted, not fatal — which this same file already fixed once, for a
different predicate. `findingsShaped`'s `named` predicate was changed from `every` to `some` for
exactly this reason (see the file's own docstring, "some, never every, and the same rule on BOTH
spellings"). `objects` was never given the same fix; this is that fix, extended to the second
predicate the docstring didn't originally cover.

Downstream, `normalizeFinding` (`scripts/lib/structured.mjs:108`) already tolerates a non-object raw
entry safely: `if (!raw || typeof raw !== 'object') return null;`. So a mixed list reaching
normalization already degrades correctly per-element — the only broken part is candidate *selection*
in `findingsShaped`, which rejects the whole list before normalization ever runs.

## Fix — AMENDED after review-ladder passes 1–2, re-approved as this text

**This section was rewritten mid-build; the original pre-build version is preserved verbatim in
`plans/oai-114-findings-shaped-primitive-sibling.approved/episode1-round-1-blind.md`.** The
review-ladder found two real defects in the originally-approved formulation below, each fixed as a
between-pass batch; this section now states the code as actually shipped, not the first draft.

Consulted Codex on two candidate shapes (delete `objects` entirely vs. change it to `some`); Codex
recommended a third formulation, adopted for the pre-build round:

```js
const record = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
const named = (item) => record(item) && typeof item.file === 'string' && Boolean(item.file.trim())
  && typeof item.summary === 'string' && Boolean(item.summary.trim());
const usable = (list) => whole ? list.length === 0 || list.some(record) : list.some(named);
```

**Review-ladder pass 1** (`codex-plain`) found `named`'s `.trim()` calls used optional chaining
(`item.file?.trim?.()`), which does not guard a truthy non-function value — an object whose own `trim`
key is e.g. `1` still gets called and throws. Fixed by requiring `typeof item.file === 'string'` (and
the same for `summary`) explicitly before calling `.trim()`, which is what the code above already
shows — that guard was present from the pre-build round and stayed correct throughout; only the crash
path through a hostile non-string `file`/`summary` value needed the explicit `typeof` check, which
this formulation already had. (The optional-chaining defect was in an intermediate implementation
draft that deviated from this approved text during coding — see "What changed during coding" below.)

**Review-ladder pass 2** (`codex-plain`) found the pre-build `usable`'s whole-reply branch,
`list.length === 0 || list.some(record)`, was too permissive: for a whole reply mixing a nested
`{findings:[...]}` wrapper object with a non-object sibling — e.g.
`[{"findings":[{"file":"a.js","summary":"x"}]}, "junk"]` — the outer array would win as the selected
candidate (since it contains a real object), then normalize to nothing and report the reply
`UNREADABLE`, discarding a finding that pre-OAI-114 base behavior recovered by REJECTING the outer
array and letting a later scan find the nested wrapper as a fallback candidate. **Fixed by changing the
whole-reply branch to `list.every(record) || list.some(named)`** — final shipped form:

```js
const record = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
const named = (item) =>
  record(item) &&
  typeof item.file === 'string' &&
  Boolean(item.file.trim()) &&
  typeof item.summary === 'string' &&
  Boolean(item.summary.trim());
const usable = (list) => (whole ? list.every(record) || list.some(named) : list.some(named));
```

Behavior table (final shipped behavior, verified by hand against every test in
`tests/candidate-selection.test.js` and confirmed by dual review-ladder approval):

| Input (as candidate list) | `whole` | Old (pre-OAI-114) | Shipped | Note |
|---|---|---|---|---|
| `[]` | true | usable | usable | unchanged: clean review, via `every(record)` vacuous truth |
| `[1,2,3]` (no object) | true | not usable → not a candidate | not usable → not a candidate | unchanged: preserves the "no payload" vs "answered but unreadable" boundary |
| `[{"id":1}]` (object, unnamed) | true | usable → normalizes to `[]` → `UNREADABLE` | usable (`every(record)`) → same | unchanged |
| `[{"id":1},"junk"]` | true | not usable (old `every` fails on `"junk"`) → not a candidate → `NO_PAYLOAD` | **not usable** (`every(record)` fails on `"junk"`; `some(named)` fails, nothing named) → not a candidate → `NO_PAYLOAD` | **matches pre-OAI-114 base**, not the pre-build draft's claimed `UNREADABLE` — see below |
| `[FINDING, "junk"]` | false (scanned) or true (whole-reply) | not usable (old `every` fails) → not a candidate → `NO_PAYLOAD`/`null` | usable (`some(named)` sees `FINDING`) → normalizes → `{findings:[FINDING], dropped:1}` | **the bug fix** |
| `[{"findings":[{"file":"a.js","summary":"x"}]}, "junk"]` (wrapper + junk) | true | not usable (old `every` fails on `"junk"`) → not a candidate → nested wrapper recovered by a later scan | **not usable** (`every(record)` fails on `"junk"`; `some(named)` fails, wrapper has no own `file`) → not a candidate → nested wrapper recovered | **matches pre-OAI-114 base** — this is pass 2's fix; the pre-build draft's `some(record)` alone would have made this shape `usable` and LOST the finding, which is exactly what pass 2 caught |
| `[FINDING, {evidence:"…"}]` (existing test) | either | usable | usable | unchanged |
| `[{"file":"","summary":""}]` (existing decoy test) | false | not usable | not usable | unchanged |
| all-strings decoy (existing test) | false | not usable | not usable | unchanged |
| a fully well-formed trailing decoy, no junk (e.g. one `{"file":...,"summary":...}` after a real payload) | false (scanned) | wins on position | wins on position | **unchanged, pre-existing, accepted trade** — content cannot distinguish a one-finding real reply from a one-finding decoy; not something this fix does or could close |

**The `[{"id":1},"junk"]` row is where the pre-build draft and the shipped code diverge, and the
shipped behavior is the correct one.** The pre-build draft's `some(record)` reclassified this shape
from `NO_PAYLOAD` to `UNREADABLE`, reasoned at the time as "more consistent" with the pure-unnamed-
object case — Codex agreed at the pre-build plan gate. Pass 2 showed that same permissiveness
generalizes unsafely to the wrapper-recovery case above, so the shipped `every(record) || some(named)`
form restores the pre-OAI-114 `NO_PAYLOAD` classification for `[{"id":1},"junk"]` instead. This is a
deliberate, reviewed retraction of the pre-build draft's one incidental side effect, not an oversight —
recorded here because a verdict-point approver flagged the plan/code divergence as needing an explicit
amendment rather than silent drift.

**Review-ladder pass 3** (`codex-adversarial`) raised a further case — a whole array containing ONLY a
wrapper object, or a wrapper plus an ordinary unnamed object, with no primitive sibling present at all
— also reports `UNREADABLE`/`null`. Verified via a `git worktree` checkout of the pre-OAI-114 base
commit and a live side-by-side comparison: this exact behavior is IDENTICAL at base and shipped code —
not a regression, and it matches the file's own long-documented "objects present, none named →
UNREADABLE" class already pinned by the pre-existing `[{"id":1}]` test. Dismissed as out of scope
rather than fixed.

**What changed during coding** (the pass-1 finding's actual proximate cause, recorded for the process
lesson): the pre-build round's approved `named` formulation above already used explicit `typeof`
guards — the implementation that reached review-ladder pass 1 had silently reverted to an
`item.file?.trim?.()` optional-chaining style closer to the ORIGINAL pre-fix code, a coding-step
deviation from the approved plan text that neither plan-gate approver's re-reading of the diff caught
(they traced the approved formulation, not what was actually typed). Review-ladder pass 1's
`codex-plain` stage caught it. Worth a standing note: an approved plan's exact code is not guaranteed
to be what gets typed, and something should check the implementation against the plan text explicitly
at the code step, not only at the two plan-gate approvals.

## Docstring update — amended at the pass-1 boundary, in pass 2, and in the full pass

`findingsShaped`'s docstring went through three rewrites as review findings landed, beyond the
pre-build round's original plan:

- **Pre-build round**: extend the "some, never every" section to note `objects` (renamed `record`)
  needed the same class of fix as `named`, for the same reason.
- **Pass 1's `agent-closer`** (fixed in the same batch that closed pass 1, before the pass-1→pass-2
  diff-convergence check): the docstring's trailing-decoy passage claimed content+position together
  fully defended against every trailing decoy trailing the payload; this was never fully true and the
  fix narrowed it further (a mixed trailing decoy — primitive plus one genuinely named object — now
  wins on position where it previously didn't). Rewritten to state the narrowed guarantee accurately,
  introducing a PURE-decoy (still defended, by position) versus MIXED-decoy (not defended, by design —
  narrowing `named` to refuse it would reopen the original bug) distinction.
- **Pass 2's `codex-adversarial`** (found alongside, and fixed in the same batch as, pass 2's
  `codex-plain` wrapper-recovery finding below): the pass-1 rewrite's PURE/MIXED distinction was itself
  too narrow and self-contradictory — it called out only MIXED trailing decoys as uncovered, when the
  real scope is any trailing decoy `named` accepts, mixed or not (a single well-formed decoy object
  wins too, and always could), and one sentence ("a PURE decoy that survives `some(named)`") was
  internally impossible given how "pure" had just been defined. Rewritten again to state the full
  scope and remove the contradiction.
- **The full pass's `codex-adversarial`** (via `task`): the "some, never every" heading itself became
  false once pass 2 added the `every(record)` disjunct to the whole-reply branch — `every` did not stop
  appearing, it stopped being the SOLE gate. Rewritten to state that distinction: `every(record)`
  preserves the legacy all-objects boundary, `some(named)` is the actual fix, and neither replaces
  the other.

Also fixed, spotted during the ladder's own acceptance-audit self-check: a code comment briefly
referenced the tracker ID directly, against this repo's standing rule against process/tracker
references in code comments — reworded to describe the defect class instead of citing the ID.

## Tests — as shipped (5 new tests across the pre-build round, passes 1–2, and the full pass)

1. `'a non-object sibling does not discard the list either, in any spelling'` — the pre-build round's
   original test, `mixed = [FINDING, 'junk']` across all three spellings, asserting the finding
   survives and the sibling counts as `dropped`.
2. `'a malformed field that is truthy but not a string does not crash candidate selection'` —
   pass 1's regression test, `[{file:{trim:1},summary:'x'}, 'junk', FINDING]`, proving the typeof-guard
   fix closes the throw path.
3. `'a whole-reply array does not preempt recovery of a valid wrapper nested inside it'` — pass 2's
   wrapper-recovery regression test, `[{findings:[FINDING],summary:...}, "junk"]`, asserting the
   nested wrapper's finding is still recovered.
4. `'a fully-formed trailing decoy still wins on position — accepted, not a defect'` — pass 2's
   pinning test for the pre-existing, unrelated trailing-decoy trade, so it cannot silently regress
   into "found" or "fixed" without notice.
5. `'findingsShaped itself distinguishes not-a-candidate from a candidate that reads unreadable'` —
   the full pass's direct-predicate test (bypassing `parseFindings`, which collapses `NO_PAYLOAD` and
   `UNREADABLE` to the same `null`), pinning five boundary cases against the exported `findingsShaped`
   directly: `[{"id":1}]`→`true`, `[{"id":1},"junk"]`→`false`, `[FINDING,"junk"]`→`true`,
   `[1,2,3]`→`false`, `[]`→`true`.

All five use the file's existing local `parse` helper (`const parse = (content) => parseFindings({
content, reasoning: '' }, { structured: false });`) or, for test 5, the newly-imported `findingsShaped`
export directly.

## Verify

1. `npm test` full suite green — confirmed at 1114/1114 in the shipped state.
2. Mutation check, run once per added conditional across the pre-build round and each review-ladder
   fix: the original `objects`/`record`/`usable` redesign; `named`'s `typeof` guards (pass 1); the
   whole-reply branch's `every(record) || some(named)` (pass 2) — each proven landed via
   `~/Code/dotfiles/tests/mutation-landed.py`, each turning the test(s) targeting that exact predicate
   red and nothing else, each restored clean and re-verified green.

## Files touched

- `scripts/lib/findings-candidate.mjs` (fix + docstring, amended across passes 1–2 and the full pass)
- `tests/candidate-selection.test.js` (5 new tests, as listed above)

## Residue

- **OAI-195** filed and deferred at the verdict point: `normalizeFinding`'s `String(raw.severity)` /
  `Number(raw.line)` throw on a JSON-producible non-coercible object value. Verified pre-existing
  (identical at base and shipped code via worktree comparison) and out of this plan's scope
  (`structured.mjs` was never a file this plan touched).
- This plan document itself was amended post-hoc at the verdict point to match code that had already
  shipped through three review-ladder passes — the divergence should have been caught by a mid-build
  plan re-challenge when pass 2's fix changed the design, and was not; a verdict-point approver caught
  it instead. Worth the same standing note as "What changed during coding" above: a design change
  found during review-ladder passes needs the plan document amended and re-approved as part of that
  pass's batch, not deferred to the verdict point.
