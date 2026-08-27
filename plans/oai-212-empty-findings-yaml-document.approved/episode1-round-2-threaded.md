ARCHIVE — not the current spec; the live plan is the file beside it.
STATE: dual-approved-unattended

Owner's authorisation for this unattended run (2026-08-27), quoted verbatim:

> "i will leave you unattended. keep iterating on items using /feature . when you have an option
> that you would usually put to me, instead try to converge using codex and a fable agent. do not
> prompt for plans as i will not be here"
>
> "you also have my permission to use lm studio if you need it"

# OAI-212 — a keyed, whole-document clean review discarded as `parsed: false`

## Context

A local reviewer model that finds no defects sometimes answers in whole-document YAML-ish prose
instead of JSON. That reply is silently discarded as unreadable — a CLEAN review (zero findings)
recorded `parsed: false` / `findings: null`, scored by the benchmark as `unreadable` when the model
in fact reviewed the diff correctly and found nothing.

**Reproduced against 15 real recorded replies** (`bench/results/2026-08-07T17-55-12-678Z.json` and
ten 2026-08-24…26 records; enumerated by scanning every `report.raw` for a `findings: []` line). Every
one of the 15 shares an exact shape:

- **Line 1 is `findings: []`** — inline empty list, spelled `[]`, in 100% of the 15.
- The remainder is free-form prose under `analysis:`, sometimes a trailing `summary:` scalar. **The
  `analysis:` value is often multi-line**, with blank lines, numbered lists (`1.` `2.`), colons, and
  braces in prose (one reply's analysis contains `response_format: {type: "json_schema", strict:
  true}`).
- All 15 are recorded `parsed: false`, `findings: null` — verified directly.

The JSON equivalent `{"findings": [], "analysis": "…"}` **already parses fine today** — `extractJson`
finds the `{…}` as the whole reply, `findingsShaped(value, whole=true)` accepts an empty list
vacuously (`[].every(record)` is true). Only the YAML surface form fails. So the defect is purely that
the YAML spelling of an already-accepted empty-findings mapping is not recognised.

### Why it fails (verified against the files)

- `scripts/lib/findings-yaml.mjs` `findingsInYaml` rejects all 15: line 1 must equal `findings:`
  exactly (`findings-yaml.mjs:74`) — it is `findings: []`; it rejects an empty findings list
  (`findings-yaml.mjs:153`); and its grammar has no `analysis:` key.
- `scripts/lib/json-scan.mjs` `extractJson` + `scripts/lib/findings-candidate.mjs` `findingsShaped`
  reject: the only bracket run is the `[]` inside `findings: []`, which is **embedded** (not the whole
  reply), so `findingsShaped` is called with `whole=false`, and an empty array fails `some(named)` —
  its deliberate decoy protection against a trailing bare `[]`.

The gap is specifically: a whole-document YAML mapping whose `findings` is an explicit empty inline
list matches neither acceptor.

### Relationship to OAI-112 (stated so the gate can check the fix does not foreclose it)

OAI-112 is a separate, deferred design: a candidate-selection replacement inside `extractJson` that
could subsume this symptom by ranking bracketed runs. This plan does **not** touch `extractJson` or
`findingsShaped`, adds a strictly-last-resort acceptor that only runs when both existing readers
returned null, and therefore leaves OAI-112's design space intact — an `extractJson` replacement that
later reads these replies would simply pre-empt the new acceptor (which is ordered after it), with no
code to unwind here. The item's own note that it "does not claim the YAML half is the only adequate
fix" is honoured: this is the smallest fix that clears the observed instances without widening the
false-clean surface.

## The fork, and how it was converged (grill step)

Per the owner's authorisation, the fix-locus fork was converged via Codex (a steer) and a fable agent
(stress-testing Codex's proposal), with an `advisor` consult on each side.

**Locus — settled LOCUS 2, both reviewers and my read agree.** A new narrow acceptor, not an extension
of `findingsInYaml`. The decisive fact is the observed **multi-line `analysis:`** value: `findingsInYaml`
is deliberately "not a YAML parser," line-oriented and whole-document-strict, and swallowing an
arbitrary multi-line prose value is exactly the shape that would confuse its block-item scanner.
LOCUS 2 never parses `analysis` at all.

**Strictness — the convergence OVERRULED Codex's specific proposal.** Codex recommended LOCUS 2 with a
tail-scan rejecting any later line matching `/^\s*-\s+/` (a dash bullet), to block a decoy where
`findings: []` on line 1 is followed by a second `findings:` block of `- ` items. The fable stress-test
(and `advisor`) refuted that strictness on three grounds, and I agree:

1. **False-positive cost is the common case.** A no-defects rationale very commonly contains a markdown
   `- ` bullet (the 15 observed replies used `1.`/`2.` numbered lists — dash bullets are the same
   generative habit). Codex's `- `-scan rejects those, re-discarding a clean review — the exact
   OAI-212 failure, reintroduced for an observed-class prose shape.
2. **Codex's decoy is constructed-adversarial, 0/15.** Two top-level `findings:` keys is duplicate-key
   malformed YAML no compliant emitter produces, and it requires the model to declare empty and then
   list items — self-refuting output. Never observed.
3. **Codex's `- `-scan is under-blocking anyway** — it *passes* the mapping-form spelling of its own
   decoy (`findings:\n  file: …\n  summary: …`, no dash), so it pays the bulleted-prose cost without
   fully buying its stated protection.

**Converged rule: anchor + `/^findings\s*:/` declaration tail-scan.** It catches both the list-form and
the mapping-form decoy at the declaration line, spares every bullet, and — because `extractJson` runs
before this rung — only bracket-free decoys can ever reach it, so the class it defends is already
narrow. The overruled Codex steer and the tie-breaking case are recorded here and will be named in the
commit, per the repo's dismissal-auditability rule.

**Residual accepted (stated, not hidden).** The single input this rule reads as a silent false-clean is
`findings: []` followed by findings-shaped `- ` items *under `analysis:`* with no second `findings:`
declaration:

```
findings: []
analysis:
- file: src/auth.mjs
  summary: Token check bypassed for empty strings.
```

This is self-contradicting (declared empty, then listed items), 0/15, the same unobserved reachability
class as Codex's decoy — and it is **symmetric with the already-accepted JSON form**: today
`{"findings":[],"analysis":"…critical bug…"}` also reads clean and the repo accepts that. The fix makes
the YAML form behave like the JSON form it mirrors; it introduces no new asymmetric danger.

## Design decisions this plan makes (flagged for the gate)

**A. A new leaf module `scripts/lib/findings-empty.mjs`, not an edit to `findings-yaml.mjs`.** Keeping
the acceptor physically separate mirrors the repo's `findings-yaml.mjs` / `json-scan.mjs` /
`findings-candidate.mjs` split — one whole-document acceptor per file — and keeps `findingsInYaml`'s
block-list grammar untouched. Its only import is nothing (pure string work); it never throws.

**B. `emptyFindingsDocument(text)` contract.**
- Returns `null` for a non-string or a text whose trim is empty.
- Splits the trimmed text on `\n`. Requires `lines[0]` to match `/^findings:\s*\[\s*\]\s*$/` (line-1
  anchor: inline empty findings declaration, optional inner/trailing whitespace).
- Rejects (returns `null`) if any **later** line matches `/^findings\s*:/` (column-0 declaration
  tail-scan — a second findings declaration in either list-form or mapping-form).
- Otherwise returns `{ findings: [] }`.
- The line-1 anchor is checked FIRST and fails fast: a reply whose first line is not an inline empty
  `findings: []` returns `null` after one regex, before the tail-scan runs. This is what makes it cheap
  to call eagerly (decision E).
- Wrapped in `try/catch` returning `null` — the same never-throw contract `extractJson` and
  `findingsInYaml` hold. This is a real property (a pathological reply yields `null`, never an
  exception out of the parse) and worth a small assertion, but it is **not** the reason the file stays
  off `tests/structure.test.js`'s `RESPONSE_BOUNDARY_FILES`. That list scans only files that build a
  `UserError` message from server-controlled values — the `new UserError(` / `reword(` call sites
  (structure.test.js:300, :381). `findings-empty.mjs` constructs no `UserError` at all, so it is
  correctly absent for **that** reason, exactly as `findings-yaml.mjs` is. Never-throw and
  boundary-membership are independent facts; the plan does not tie them.

**C. Scope is the observed shape only: inline `findings: []`.** All 15 are inline `[]`; a block-empty
`findings:` (key with nothing under it) is not observed and is not accepted here — narrower is safer,
and a future dated instance can widen it. Stated so the gate does not read the omission as a miss.

**D. It returns `{ findings: [] }` with no `summary`.** Extracting a `summary:` scalar out of
multi-line prose is exactly the re-introduced-fragility LOCUS 2 exists to avoid, and `summary` is
cosmetic (the bench and `renderFindings` key on findings, not summary). A clean review needs no summary.

**E. Ordering in `structured.mjs` `findingsIn` — strictly last resort, precedence in the chain ALONE.**
The acceptor's result is USED only when `!structured` AND `findingsInYaml` returned null AND
`extractJson` returned null — but that precedence over `parsed` is expressed in exactly ONE place: the
`??` chain, with `emptyDoc` last. `emptyDoc` is gated on `structured` alone (mirroring the existing
`const yaml = structured ? null : …` line), **not** additionally on `yaml`/`parsed`. This is a
deliberate correction of the round-1 design, which guarded `emptyDoc` on `(structured || yaml ||
parsed)` AND placed it last — two redundant mechanisms each masking the other, so neither could be
witnessed by a single mutation (both plan-gate approvers found this). One expression of the precedence,
in the chain order, is both simpler and singly-witnessable: moving `emptyDoc` ahead of the `parsed`
branch alone flips the bracketed-payload test red. The cost of computing `emptyFindingsDocument`
eagerly when `parsed` already won is one line-1 regex (the anchor fails fast, decision B), discarded
unused — the same eager-work posture is acceptable because a redundant guard is what broke the witness.

## Files this plan touches

New: `scripts/lib/findings-empty.mjs`, and its tests fold into the existing `tests/structured.test.js`
(the suite that owns `parseFindings` behaviour) — or a new `tests/findings-empty.test.js` if that reads
cleaner; either is a test-file choice, not a design one.

Edited: `scripts/lib/structured.mjs` (`findingsIn` gains the last-resort call — one import, one
`?? emptyDoc` in the `shaped` chain, computed only when `!structured` and the two prior readers were
null), `CLAUDE.md` (one present-tense line naming `findings-empty.mjs` beside the `findings-yaml.mjs`
paragraph).

Read to confirm no change needed: `scripts/lib/findings-candidate.mjs` and `scripts/lib/json-scan.mjs`
(untouched — the fix is additive and downstream of them), `tests/structure.test.js`
(`RESPONSE_BOUNDARY_FILES` unchanged — the new file is never added to it, and a test asserts its
never-throw contract keeps it correctly absent).

## Implementation

### Phase 1 — the acceptor

Create `scripts/lib/findings-empty.mjs` exporting `emptyFindingsDocument(text)` per decision B. No
dependencies. A single leading `/^findings:\s*\[\s*\]\s*$/` test on line 1, a `.slice(1).some(...)`
`/^findings\s*:/` tail-scan, `{ findings: [] }` otherwise, all inside one `try/catch` → `null`.

### Phase 2 — wire it into `findingsIn`

In `scripts/lib/structured.mjs` `findingsIn(text, { structured, schema })`, import
`emptyFindingsDocument`. After the existing `yaml`/`parsed` computations, add the gated call and append
`emptyDoc` as the LAST term of the existing `shaped` chain:

```js
const emptyDoc = structured ? null : emptyFindingsDocument(text);
const shaped = yaml ?? (Array.isArray(parsed) ? { findings: parsed } : parsed) ?? emptyDoc;
```

`emptyDoc` is gated on `structured` alone and placed last, so `extractJson`'s result (`parsed`) always
wins when present — precedence lives in the chain order, with no redundant `parsed` guard (decision E).
It is USED only when `!structured` and both prior readers were null; computed eagerly otherwise but
discarded (one line-1 regex, decision B). A short behavioural comment states why there is no `parsed`
guard — one expression of the precedence, not two that can drift — with **no** reference to the review
process, the plan, or mutation testing (per this repo's code-comment rule). Everything downstream
(`!shaped` guard, `Array.isArray(shaped.findings)`, the `length > 0 && kept.length === 0` UNREADABLE
guard, and `capDiagnostics`) is unchanged and, verified by both plan-gate approvers, behaves correctly
on `{ findings: [] }`: length 0 → returns the shaped report with `summary: ''`, a clean review, never
NO_PAYLOAD or UNREADABLE. Note `parsed = yaml ? null : extractJson(...)` already runs `extractJson` on
the structured path (where `yaml` is null); `emptyDoc`'s `structured` gate is the sibling of `yaml`'s
and keeps the acceptor off that path explicitly rather than relying on the downstream `matchesSchema`
rejection as its only block.

### Phase 3 — docs

`CLAUDE.md`: one present-tense line, beside the `findings-yaml.mjs` paragraph, naming
`scripts/lib/findings-empty.mjs` `emptyFindingsDocument` as the last-resort acceptor for a
whole-document reply whose entire payload is an inline empty `findings: []` declaration plus prose —
the YAML spelling of the empty-findings mapping `extractJson` already accepts in JSON form — gated
`!structured` and after both other readers, with the declaration tail-scan as its anti-decoy guard.
Rationale, the OAI-112 relationship, and the overruled-Codex convergence go in the tracker item, not
the note.

## Tests

Fold into `tests/structured.test.js` (owns `parseFindings`), unit-testing both `emptyFindingsDocument`
directly and `parseFindings` end-to-end.

**Positive (the observed shapes must now read CLEAN — `{findings: []}`):**
- Line 1 `findings: []` + single-line `analysis:` (observed shape A).
- Line 1 `findings: []`, blank line, **multi-line** `analysis:` with a numbered list and a brace in
  prose (observed shape B) → accepted, findings length 0.
- Line 1 `findings: []` + `analysis:` containing a markdown `- ` bullet → accepted (the exact case
  Codex's `- `-scan would have wrongly rejected; this test is the record of the overruled steer).
- Bare `findings: []` alone (opener with no tail) → accepted.

**Negative (must NOT read clean):**
- `findings: []` line 1 followed later by a **bracketed** real payload `[{"file":"x","summary":"real"}]`
  → `extractJson` wins first, result is the real finding (length 1), acceptor never fires.
- List-form decoy: `findings: []` then a second `findings:` block with `- ` items → tail-scan rejects →
  parseFindings null (loud unreadable).
- Mapping-form decoy: `findings: []` then `findings:\n  file: …\n  summary: …` (no dash) → tail-scan
  rejects → null (the case Codex's `- `-scan misses).
- Embedded `findings: []` mid-prose (not line 1), e.g. `Here is my review.\nfindings: []` → null.
  (Rejected by BOTH the line-1 anchor and, independently, the `/^findings\s*:/` tail-scan — which is
  exactly why this fixture cannot witness the anchor mutation; see the arbitrary-prose fixture below.)
- **Arbitrary prose reply with no `findings:` line anywhere**, e.g. `The review is complete; no issues
  were found.` → null (reaches `emptyDoc` — `findingsInYaml` and `extractJson` both return null — and
  the line-1 anchor refuses it). This is the mutation-1 witness fixture: it is the ONLY negative whose
  refusal routes solely through the anchor, so it is what goes red when the anchor is removed.
- Under `--structured-output` (`structured: true`), the same `findings: []` YAML reply is NOT read by
  the acceptor → null (the `!structured` gate; `matchesSchema` would also reject `{findings:[]}` for
  lacking `analysis`/`summary`, so this test is not claimed as a witness for the gate, only that the
  structured path stays closed).

**Structural (unchanged guard stays honest):** `tests/structure.test.js`'s `RESPONSE_BOUNDARY_FILES`
does not list `findings-empty.mjs`, and the never-throw assertion covers it (feed a pathological input,
assert no throw / null).

## Verification

Run the repo `verify` skill (`.claude/skills/verify/SKILL.md`) — `npm test`, a real plugin load, and a
delegation round trip. Quote the green summary line.

**Mutation check (the key invariant — two, because two independent properties matter; each a SINGLE
edit that flips exactly one test, corrected after both plan-gate approvers found the round-1 witnesses
could not fire):**

1. **The line-1 anchor is load-bearing.** Mutate `emptyFindingsDocument` to skip the `lines[0]` anchor
   check (accept whenever the tail-scan finds no later `findings:` line). The **arbitrary-prose**
   negative test (`The review is complete; no issues were found.` → expected null) must go RED —
   it becomes `{findings:[]}`. This fixture is chosen precisely because its refusal routes ONLY through
   the anchor; the embedded-mid-prose fixture would stay green here (its `findings:` line is caught by
   the tail-scan regardless), which is why round-1's choice of it was invalid.
2. **The last-resort ordering is load-bearing.** Mutate `findingsIn`'s `shaped` line to place `emptyDoc`
   ahead of the `parsed` branch: `const shaped = yaml ?? emptyDoc ?? (Array.isArray(parsed) ? {
   findings: parsed } : parsed);`. The **bracketed real payload** test (`findings: []` line 1 then
   `[{"file":"x","summary":"real"}]`, expected 1 finding) must go RED — `emptyDoc` now pre-empts the
   real finding with `{findings:[]}`. This is a single edit that flips the test because the design
   holds the precedence in the chain order alone (decision E) — no redundant `parsed` guard masks it.

Each mutation separately: back up the file, apply the mutation via Edit, prove it landed with
`~/Code/dotfiles/tests/mutation-landed.py`, run the suite, name the failing test, restore, re-run green,
and prove the restore by `diff` against the backup — never by eye. **Because the anchor's fail-fast and
the chain-order precedence are each expressed once, each mutation is expected to flip exactly ONE named
test; if a mutation reds zero tests, the witness is not proven and the check is void (this repo's
"a check that cannot fire" rule) — do not proceed on it.**

**Manual end-to-end (if LM Studio is up, else stated as not run):** not required — the defect is a
pure parse-layer shape and the observed replies are captured bytes; the unit tests replay them exactly.
A stub/live run adds nothing the recorded replies do not already provide.
