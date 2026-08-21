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

Reproduced live at HEAD:

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

## Fix

Consulted Codex on two candidate shapes (delete `objects` entirely vs. change it to `some`); Codex
recommended a third, more precise formulation that avoids both candidates' edge cases (an empty whole
array wrongly rejected under naive `every`→`some`; a pure-garbage whole array wrongly promoted from
"not a candidate" to "answered but unreadable" under outright deletion). Adopted as designed:

```js
const record = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);

const named = (item) =>
  record(item) &&
  typeof item.file === 'string' &&
  Boolean(item.file.trim()) &&
  typeof item.summary === 'string' &&
  Boolean(item.summary.trim());

const usable = (list) =>
  whole
    ? list.length === 0 || list.some(record)
    : list.some(named);
```

Replacing the current:

```js
const objects = (list) => list.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
const named = (item) => Boolean(item.file?.trim?.() && item.summary?.trim?.());
const usable = (list) => objects(list) && (whole || (list.length > 0 && list.some(named)));
```

Behavior table (verified by hand against every existing test in `tests/candidate-selection.test.js`
and `tests/findings-shape.test.js` before writing this plan — none regresses):

| Input (as candidate list) | `whole` | Old | New | Note |
|---|---|---|---|---|
| `[]` | true | usable | usable | unchanged: clean review |
| `[1,2,3]` (no object) | true | not usable → not a candidate | not usable → not a candidate | unchanged: preserves the "no payload" vs "answered but unreadable" boundary Codex flagged as worth keeping |
| `[{"id":1}]` (object, unnamed) | true | usable → normalizes to `[]` → `UNREADABLE` | usable → same | unchanged |
| `[{"id":1},"junk"]` | true | not usable (old `every` fails on `"junk"`) → not a candidate | usable (`some(record)` sees `{"id":1}`) → normalizes to `[]` → `UNREADABLE` | **changes**: this shape now reaches `UNREADABLE` consistent with the all-objects-unnamed case, instead of being invisible as "no payload" |
| `[FINDING, "junk"]` | false (scanned) or true (whole-reply) | not usable (old `every` fails) → not a candidate → `NO_PAYLOAD`/`null` | usable (`some(named)` sees `FINDING`) → normalizes → `{findings:[FINDING], dropped:1}` | **the bug fix** |
| `[FINDING, {evidence:"…"}]` (existing test) | either | usable | usable | unchanged, existing test still passes |
| `[{"file":"","summary":""}]` (existing decoy test) | false | not usable (`named` fails on empty strings) | not usable (`named` fails identically) | unchanged |
| all-strings decoy (existing test) | false | not usable | not usable (`record` fails on strings, so `named` fails) | unchanged |

The one behavior change beyond the bug fix itself is the `[{"id":1},"junk"]` (whole-reply, no valid
finding, non-object sibling present) row: it now reaches `UNREADABLE` instead of `NO_PAYLOAD`. This is
the correct classification per the file's own stated distinction — `UNREADABLE` means "answered but
we cannot read the answer", `NO_PAYLOAD` means "no candidate here at all" — and `[{"id":1}]` (all
objects, none named) already reached `UNREADABLE`; a mix of an unnamed object and a junk string should
not read more cleanly than the pure-unnamed-object case. Codex confirmed this reclassification is
correct and not a regression.

`named` is also simplified to check `record(item)` first via short-circuit `&&`, replacing the old
`item.file?.trim?.()` optional-chaining style — a plain property read guarded at the item level rather
than the property level, which is more robust once `usable` no longer guarantees every list element is
itself an object before `named` runs.

## Docstring update

`findingsShaped`'s docstring (`scripts/lib/findings-candidate.mjs:11-73`) documents the `every`→`some`
history for `named` alone and doesn't mention `objects`/`record` at all. Two passages need updating as
part of this diff, not left to drift:

- The "some, never every, and the same rule on BOTH spellings" section: extend it to note `objects`
  (renamed `record`) received the same class of fix here (OAI-114), for the same reason — one
  non-object sibling must not veto a candidate that has at least one usable finding.
- The "`objects([])` is vacuously true, so relaxing this would promote every trailing bare `[]`"
  sentence, in the section about a scanned bare array needing to be non-empty: this still describes
  the `whole`-only `list.length === 0` branch correctly (a bare `[]` is only ever vacuously accepted
  when it IS the whole reply), but should be reworded now that the empty-check is an explicit
  `list.length === 0`, not incidental to `every`'s vacuous truth on an empty list.

## Tests

Add to `tests/candidate-selection.test.js`, beside the existing
`'one malformed entry does not discard its siblings, in any spelling'` test (which only covers a
malformed *object* sibling, `{ evidence: 'also suspicious' }`) — a new test covering a non-object
(primitive) sibling, same three-spelling structure:

```js
test('a non-object sibling does not discard the list either, in any spelling', () => {
  const mixed = [FINDING, 'junk'];
  const expected = { findings: [FINDING], dropped: 1 };
  for (const [spelling, content] of [
    ['prose-wrapped', `Findings: ${JSON.stringify(mixed)}`],
    ['whole reply', JSON.stringify(mixed)],
    ['object-wrapped', JSON.stringify({ findings: mixed })],
  ]) {
    const parsed = parse(content);
    assert.equal(parsed?.findings.length, expected.findings.length, `${spelling}: the valid finding must survive`);
    assert.equal(parsed.dropped, expected.dropped, `${spelling}: the non-object sibling must be counted, not fatal`);
  }
});
```

(Using the file's existing local `parse` helper — check its exact name/signature against the file
before writing; if the existing malformed-entry test builds `parse` inline rather than via a shared
helper, mirror that structure exactly rather than introducing a new helper.)

## Verify

1. `npm test` full suite green.
2. Mutation check: revert `objects`/`record`/`usable` to the pre-fix `every`-based version in a copy,
   confirm the new test (and only tests targeting this exact predicate) goes red, restore, confirm
   green again — per the repo's mutation-landed protocol
   (`~/Code/dotfiles/tests/mutation-landed.py`).

## Files touched

- `scripts/lib/findings-candidate.mjs` (fix + docstring)
- `tests/candidate-selection.test.js` (new test)

## Residue

None anticipated. If review surfaces the `[{"id":1},"junk"]` reclassification (`NO_PAYLOAD` →
`UNREADABLE`) as worth a dedicated test of its own rather than only being covered by the behavior
table above, that's a plausible in-scope addition to fold into this same diff, not residue.
