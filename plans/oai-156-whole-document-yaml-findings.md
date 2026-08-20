STATE: proceeded without harness plan-mode — explicit standing session authorization to bypass the
interactive ExitPlanMode gate (the operator stepped away and asked to iterate technical features
without user input, converging with Codex on any decision that would otherwise go to them). No
provenance: line: this was never a harness plan-mode plan. Approval for this plan is Codex and the
Claude verdict subagent in agreement — the /feature skill's own documented substitute for user
approval — not the operator's own sign-off. plans/README.md's unattended-draft state (per the ADR
it cites) would instead have this block the item; that mechanism was knowingly not used this run, on
the operator's explicit instruction (already flagged for OAI-185/OAI-115/OAI-116, applied
consistently here), and this deviation is flagged for the operator on return.

# OAI-156 — a well-formed findings reply expressed as whole-document YAML-ish prose is silently
discarded because the parser only recognises bracketed JSON.

## Problem, as verified

`scripts/lib/json-scan.mjs`'s `extractJson` (feeding `scripts/lib/findings-candidate.mjs`'s
`findingsShaped`) works exclusively on balanced-bracket (`{...}`/`[...]`) runs found by a hand-rolled
scanner. A reply with no bracket pair anywhere — e.g. `findings:\n  - file: x\n    line: 1\n
summary: ...` — produces zero candidates; `extractJson` returns `null` before `findingsShaped` ever
runs. Reproduced 2026-08-14 on commit `9a38a2a6b`: an overnight sweep discarded 1,245s of real model
work this way (`parsed:false, outcome:unreadable`), and the discarded reply's first finding named the
same defect a separate baseline run had already reported as bracketed JSON on the same commit — not
noise, a real finding lost to a parser gap.

The existing prompt instruction (`structured.mjs`'s `schemaInstruction`, appended by
`review-ladder.mjs`'s `unconstrainedLadder`) is already explicit: "Reply with JSON only — no prose,
no markdown fence — matching this JSON Schema exactly:" and still failed once. No YAML parsing exists
anywhere in this codebase today (confirmed: zero hits). No existing test fixture reproduces a
genuinely non-bracketed reply — every "prose" fixture today is prose *wrapping* bracketed JSON, a
different and already-handled shape.

## Decisions (Codex-converged, fable third-opinion reviewed; no operator present)

1. **Fix now, not measure-first.** One dated, reproduced instance with a named, understood
   mechanism (a parser that structurally cannot see an entire class of well-formed reply) already
   clears this repo's own filing-worth bar. The fix is small and additive (a new module, no change to
   the existing JSON path's behaviour on any input it already accepts), so there is no reason to defer
   engineering effort to wait for a larger sample — the mechanism, not the frequency, is what makes
   this worth fixing.

2. **A new, narrow, whole-document-only YAML-ish acceptor — new module `scripts/lib/findings-yaml.mjs`,
   sibling to `json-scan.mjs`.** Not a general YAML parser: it accepts a reply if and only if the
   **entire trimmed text** decodes as a top-level `findings:` key followed by a `- `-prefixed list of
   flat-mapping items (each item's fields are `key: value` lines at one consistent deeper indent, plus
   an optional trailing top-level `summary:` scalar). Any content that does not fit that exact shape —
   trailing prose, a second top-level key group that isn't `summary:`, nested lists, flow collections
   (`[...]`/`{...}`), anchors, multi-document markers — is a **flat reject**, not a partial parse. This
   sidesteps the decoy-vs-real-payload ranking problem `json-scan.mjs`'s own comments document as
   hard-won for the bracketed case (last-outermost-wins, quoted-source decoys): there is no ranking
   to do when only one shape can ever match, because a document containing anything else automatically
   fails whole-document-only.

3. **Never throws — same contract as `extractJson`.** Returns the parsed `{findings: [...], summary?}`
   object on a match, `null` on anything else (including a document that *starts* like `findings:` but
   contains disqualifying content later, or a genuinely malformed line inside an item — malformed is
   a reject, not a partial finding list). This is what resolves fable's condition B *by construction*:
   `tests/structure.test.js`'s `RESPONSE_BOUNDARY_FILES` list is enumerated over files that *construct*
   a `UserError` from server content (confirmed by reading it), and `json-scan.mjs` is correctly absent
   from that list for the identical reason (`extractJson` never throws). `findings-yaml.mjs` matching
   that contract exactly means it does not need to be added to the enumerated list — a decoder that
   never throws never gives server content a route into a `UserError.message` in the first place.

4. **Ordering and scope, revised after two independent CHANGES-REQUIRED verdicts (Codex, fable) on
   round 1 of this plan.** Round 1 claimed the YAML and JSON grammars were "provably disjoint"; both
   reviewers correctly refuted this as stated — a YAML-accepted document's item *value* can still
   contain a balanced `{`/`[` run as ordinary scalar text (e.g. `summary: found a { in the config`),
   so the grammars are not disjoint in that sense, and treating the claim as a proof rather than a
   judgment call was the defect. Two corrections:
   - **Leading-bracket rule, stated explicitly (fixes the actual ambiguity):** a value is a **flow
     collection** — and disqualifies the document — only when the value, after trimming, **starts
     with** `[` or `{`. A bracket appearing anywhere else inside an otherwise-ordinary scalar value is
     just text and does not disqualify the document. This is what "disjoint" actually means in
     practice: not that no accepted document can contain a brace, but that no accepted document can
     contain a *flow-collection-shaped* value — and that narrower claim is a judgment about how models
     write YAML-ish prose, held to the same epistemic standard `json-scan.mjs`'s own
     last-outermost-wins comment claims for its analogous heuristic, not a formal proof.
   - **Scope, gated to the unconstrained path only (fixes the structured-mode regression risk Codex
     raised):** `findingsIn` attempts `findingsInYaml(text)` **only when `!structured`**. Under
     `structured: true`, `findingsIn` goes straight to the existing `extractJson(text, findingsShaped)`
     path, unchanged in every respect — the YAML acceptor never runs there at all. This removes the
     regression Codex identified (a YAML match on a structured channel failing `matchesSchema` and
     silently discarding a payload `extractJson` would have accepted) by construction, and matches
     this plan's own Out-of-scope line, which round 1 stated but did not actually enforce in decision 4.
   - Concretely, on the unconstrained path: `findingsIn` tries `findingsInYaml(text)` first; on a
     match, use it and skip `extractJson` entirely for that channel; on `null`, fall through to the
     existing `extractJson(text, findingsShaped)` path unchanged. A bracketed-JSON reply — the
     overwhelming majority case — pays one cheap, fast rejection (the text doesn't start with a
     `findings:` line) before falling through to the unchanged JSON path, not a full scan.

5. **No size-cap replication beyond a hard line/item ceiling mirroring intent, not exact parity.**
   `review-schema.mjs`'s `MAX_FINDINGS=20` and per-field `maxLength` ceilings are schema/grammar
   constraints that gate a **constrained** (`--structured-output`) request; the unconstrained path's
   `capDiagnostics` is already null/advisory-only for the *existing* JSON path (confirmed: it does not
   enforce `MAX_FINDINGS` either, it only *reports* against it after the fact). So `findings-yaml.mjs`
   does not need to independently replicate those ceilings to reach parity with a mechanism the JSON
   path doesn't itself enforce at parse time — but the module does cap the number of top-level list
   items (ceiling: 200) and fields per item (ceiling: 20, generous against the four recognised fields
   plus headroom for unrecognised keys `normalizeFinding` will drop) it will attempt to parse, purely
   as a backstop against a pathological or adversarial reply causing unbounded work, matching this
   repo's "every string and array carries a size ceiling as a backstop" doctrine
   (`structured.mjs` module doc). Exceeding the backstop is a flat reject (`null`), not a truncation —
   truncating would silently under-report findings the model actually sent, which is the exact defect
   class `capDiagnostics`'s honesty is built to avoid; a reject at least falls through to being
   reported as unreadable/discarded like any other unparseable reply, which is visible, versus a
   silent partial list, which is not.

6. **Normalization reuses the existing pipeline unchanged.** `findingsIn` wraps the YAML acceptor's
   output exactly like it wraps `extractJson`'s: `shaped.findings.map(normalizeFinding)`, the
   `kept.length === 0` → `UNREADABLE` rule, `capDiagnostics`, all unchanged and untouched by this
   plan. `findings-yaml.mjs` only has to produce the same `{findings: [...], summary?}` shape
   `extractJson` already produces; it does not need to know about findings semantics beyond that.

## Grammar (minimal, exact)

Trimmed whole text must match, in order:
- A line that is exactly `findings:` (optionally followed on the same line by nothing — a flow value
  after the colon is a reject, not a shorthand).
- One or more list items: a line matching `^(\s+)-\s+(\w+):\s*(.*)$` establishes the item's base
  indent from `\s+` and its first field from the rest of that line; subsequent lines at that same
  exact indent plus one field-continuation level (`^\1  (\w+):\s*(.*)$`) add fields to the same item
  until a line at the item's own indent starting with `-` begins the next item, or a line at a
  shallower indent ends the list.
- Recognised fields per item: `file`, `line`, `severity`, `summary` (matching `normalizeFinding`'s own
  known fields — anything else is carried through as-is in the parsed object and left for
  `normalizeFinding` to drop, exactly as the JSON path already leaves unrecognised keys for
  `normalizeFinding` to filter).
- An optional trailing top-level `summary: <text>` scalar line after the list ends.
- Nothing else: any line that does not fit one of the shapes above, anywhere in the document,
  disqualifies the whole document — return `null`.
- Values are read as bare scalars (trimmed line remainder), **except**: a value that, after
  trimming, starts with `[` or `{` is a **flow collection** and disqualifies the whole document (the
  leading-bracket rule from decision 4). A bracket appearing anywhere in a value other than as its
  first character is ordinary scalar text and does not disqualify anything. No quoting, no
  multi-line block scalars (`|`/`>`). A value that itself needs YAML quoting to disambiguate is out
  of scope for this narrow acceptor — a reply that needs it is not the shape this ticket's evidence
  showed.
- Applies only on the unconstrained path (`structured: false`) — see decision 4's scope correction.

## Tests (new file `tests/findings-yaml.test.js`, plus one wiring test in `tests/structured.test.js`
or nearest existing suite for `findingsIn`)

- The exact reproduced shape from the ticket (a `findings:` list with `file`/`line`/`summary`
  items) parses to the same shape `extractJson` would produce for the JSON-equivalent reply.
- A bracketed JSON reply is unaffected: `findingsInYaml` returns `null` for it (no leading
  `findings:` line), and `findingsIn` falls through to the unchanged `extractJson` path — pin this
  with a direct before/after equality check against the pre-existing JSON test fixtures, proving no
  regression.
- A YAML-ish reply with trailing prose after the list (e.g. a closing sentence) is a flat reject —
  `null`, not a partial list.
- A YAML-ish reply with a nested list inside an item is a flat reject.
- A YAML-ish reply with a value whose trimmed text **starts with** `[` or `{` (a flow collection) is
  a flat reject — this is the leading-bracket rule's own dedicated fixture, pinned separately from
  the next one so an all-scalar implementation cannot pass by accident.
- A YAML-ish reply with a value that **contains** a `{...}` run *after* other scalar text (e.g.
  `summary: found a { in the config on line 3`) is **accepted**, and the value is carried through as
  plain text — this is the positive counterpart to the leading-bracket rule, and is what makes
  round-1's disjointness claim a stated judgment rather than a false proof: the whole document is
  still YAML-shaped, the embedded brace is not disqualifying, and `extractJson` never gets a turn on
  this channel because `findingsInYaml` already accepted it.
- A YAML-ish reply exceeding the 200-item backstop is a flat reject.
- A YAML-ish reply where one item exceeds the 20-field backstop is a flat reject.
- `findings-yaml.mjs`'s exported function never throws on any input, including empty string and
  binary-ish garbage.
- **Discriminating ordering/scope fixture, added after round-2 CHANGES-REQUIRED from Codex** (round
  1's "embedded brace" fixture used an unmatched `{`, which `extractJson` can never find a balanced
  candidate in — it could not actually prove precedence, and a YAML-shaped `structured: true` reply
  returns `null` whether the scope gate is correctly present or silently broken, so neither test could
  make its own targeted mutation go red). The fixture is one document that is BOTH whole-document
  YAML-shaped AND contains a genuinely balanced, `findingsShaped`-passing JSON object embedded inside
  one item's value (not leading the value, so it does not trip the leading-bracket rule) — e.g. an
  item whose `summary` value is `see {"findings": [{"file": "b.js", "line": 99, "summary": "decoy"}]}
  for detail`. This document has two DIFFERENT possible readings that disagree on the finding
  returned: the whole-document YAML reading (a finding naming the outer item's own `file`/`line`), and
  a JSON-bracket-scan reading of the embedded object (a finding naming `b.js`/`99`/`"decoy"`). Two
  assertions on this one fixture:
  - Unstructured (`structured: false`): `findingsIn` returns the **YAML reading** (the outer item),
    proving `findingsInYaml` ran first and won precedence — not merely that `extractJson` was never
    reached for an unrelated reason.
  - Structured (`structured: true`), same text, against a schema the embedded decoy object satisfies:
    `findingsIn` returns the **JSON-bracket-scan reading** (`b.js`/`99`/`decoy`), proving
    `findingsInYaml` was never attempted at all (not merely that it ran and then lost to
    `matchesSchema`) — a broken `!structured` gate would instead attempt the YAML reading first,
    likely fail `matchesSchema` against a schema shaped for the decoy object, and return `null`/
    `NO_PAYLOAD` instead of the decoy finding, which is an observably different result the mutation
    test below can catch.

## Mutation-proof plan (verify step)

- Mutate `findingsIn` to skip the YAML-first call entirely (fall straight to `extractJson`) — the
  ticket's own reproduced-shape test must go red.
- Mutate the whole-document-only check (e.g. allow trailing prose) — the trailing-prose reject test
  must go red.
- Mutate the leading-bracket rule to accept a flow-collection value — the flow-collection reject test
  must go red, while the embedded-brace-in-scalar-text accept test must stay green (proving the
  mutation is caught by the rule it targets, not by a broader, coincidentally-overlapping check).
- Mutate the 200-item backstop to a no-op — the backstop reject test must go red.
- Mutate the 20-field backstop to a no-op — the field-backstop reject test must go red.
- Mutate the `!structured` gate to always attempt `findingsInYaml` — the discriminating fixture's
  structured-mode assertion must go red (it stops returning the decoy finding), which is what
  actually proves the gate is load-bearing, unlike a bare `null`-vs-`null` comparison.

## Out of scope

- No change to `extractJson`, `findingsShaped`, `review-schema.mjs`, or the `--structured-output`
  path — this is additive on the unconstrained path only.
- No change to `schemaInstruction`'s prompt wording — decision 1 is fix-not-prevent; the existing
  instruction stays as the primary defence, this is the recovery path for when it's not followed.
- No general YAML library dependency, no multi-document support, no anchors/aliases/tags.
