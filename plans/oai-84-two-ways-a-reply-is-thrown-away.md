# OAI-84 — two ways `/oai:review` throws away an answer, one of which is a decision

provenance: written directly to `plans/` under the unattended run
`run-1786106227-912274730`; the owner is absent and directed design forks to Codex, so Codex's
`VERDICT: APPROVE` is this plan's gate.

## What the probe established, including what it refuted

Five claims checked independently by Codex against the cited lines, all **TRUE**:

1. On the **default** path (`structured === false`, which is every ordinary review since the schema
   became opt-in) `parseFindings` never reads `reasoning` at all — the ternary at
   `structured.mjs:265` selects `content` unconditionally.
2. That is **deliberate**, and the module says so at `:244-253`: without a schema the reasoning text
   is the model's scratchpad, and shipping scratchpad as an answer is the class `adr/003` exists to
   prevent.
3. A bare top-level JSON array parses fine and is then discarded at `:269` — not on the `typeof`
   test, which arrays pass, but on `Array.isArray(parsed.findings)` being false.
4. The `findings: null` (unparseable) versus `[]` (parsed, found nothing) distinction is pinned at
   `tests/review-json.test.js:73-89` and must survive.
5. Ordinary reviews enter with `structured === false` (`review-request.mjs:206`), so (3) is reachable
   on every one of them.

**So the item is narrower than filed, and one of its two halves is filed against a decision.**
OAI-84 says the channel bug applies "regardless of `structuredOutput`" and proposes "a
try-the-other-channel fallback". On the default path that fallback would **reverse `adr/003`**. The
channel defect is real, but only under `--structured-output`.

## Forks, settled with Codex

- **Fork 1 — the bare-array repair.** Codex first chose "accept `[]`, reject a non-empty array whose
  elements all fail normalization". Challenged: that makes the verdict depend on **spelling**, since
  `["hello"]` would be unparseable while `{"findings":["hello"]}` already parses to
  `findings: [], dropped: 1` and reads as a clean review. **Consensus: treat a bare top-level array
  exactly as if it had been `{findings: <array>}`.** The two spellings then agree by construction.
  The pre-existing all-dropped-reads-as-clean hazard is **unchanged and out of scope**, filed as its
  own item — Codex explicitly accepted this.
- **Fork 2 — channel selection under a schema.** Stop choosing up front: try `content`, and if it
  does not yield a **schema-conforming** payload, try `reasoning`. `matchesSchema` remains the proof,
  so `adr/003`'s guarantee is untouched.
- **Fork 3 — a reasoning fallback on the default path.** **No.** Codex: unconstrained reasoning
  cannot be made safe to ship "without an independently enforced structure plus conformance
  validation — which would make it the structured path."

## Phases

### Phase 1 — a bare array is the same reply as `{findings: […]}`

`scripts/lib/structured.mjs`, in `parseFindings`: before the shape test at `:269`, normalize a
top-level array to `{ findings: parsed }`. Everything downstream — `normalizeFinding`, `dropped`,
`capDiagnostics`, `summary` — then runs unchanged, which is the point: the two spellings must not
diverge anywhere, not just at the accept/reject boundary.

`capDiagnostics` reads `parsed.analysis` and `parsed.findings.length`; an array-shaped reply has no
`analysis`, which already yields `analysisLength: null` and `summary: ''`. Under
`structured === false` the cap fields are **not uniformly null** — `atCap` and `analysisCut` are
`false` while `analysisLength` and `analysisCap` are `null` — and the point is only that every one of
them comes out identical to the object spelling of the same content. No special-casing.

Witnesses in `tests/structured.test.js`:

- a bare top-level array of valid findings parses to those findings, with the same result as the
  object spelling of the identical content (asserted by comparing the two)
- a bare `[]` parses to `findings: []` — a clean review, not `null`
- a fenced bare array parses too, since `extractJson` tries the fence
- **the null-vs-`[]` distinction still holds**: prose with no JSON is still `null`

### Phase 1b — the extraction the size budget forced (AMENDMENT, not in the approved plan)

Phase 1 took `scripts/lib/structured.mjs` to **301 lines against a budget of 300**, and
`tests/structure.test.js` failed. The repo's rule is extract or trim, never raise the ceiling, and
trimming alone would not have survived phase 2, which adds an ordered loop where a ternary was.

`FENCE`, `balancedObject` and `extractJson` — 69 lines, one cohesive stage — moved to a new
`scripts/lib/json-scan.mjs`. The seam is the file's own stated identity: `structured.mjs` opens by
calling itself "the one module that encodes structured-output dialect", and scanning prose for a
balanced object is not dialect. Nothing in the new module knows what a finding is, what a schema is,
or which channel a reply arrived on. `structured.mjs` is now 224 lines; the only live importer of
`extractJson` was `tests/structured.test.js`, whose import was repointed. Suite green at 664.

**This is why the plan is being re-challenged mid-build**: a file entered the file list.

**What proves the move was pure** is not the suite going 660 → 664 — those four tests are phase 1's,
not this one's. It is that the pre-existing `extractJson` cases in `tests/structured.test.js`
(bare, fenced, prose-wrapped, nested-object) passed before the move and pass after it, unchanged
except for the import path. That is the evidence, stated rather than assumed.

### Phase 2 — under a schema, a stray character in `content` no longer buries the payload

`scripts/lib/structured.mjs`: replace the up-front ternary with an ordered attempt over the
candidate channels. `structured === false` → `[content]` only, which is the `adr/003` guarantee and
must be visible in the code as such, not as a consequence. `structured === true` → `[content,
reasoning]`, each parsed and required to satisfy `matchesSchema`; the first that does wins; if none
does, `null`.

This subsumes the current empty-content special case: whitespace-only `content` simply fails to
parse and the loop moves on.

Witnesses:

- **the default path never reads `reasoning`** — empty `content`, a perfectly good payload in
  `reasoning`, `structured: false` → `null`. This is the `adr/003` guard and the mutation target.
- under a schema, one stray non-whitespace character in `content` with a conforming payload in
  `reasoning` → the payload is returned
- under a schema, a **non-conforming** payload in `reasoning` is still refused → `null`, so the
  fallback cannot become a scratchpad channel

### Phase 3 — docs

- Amend `adr/003-structured-findings.md`: a section recording that channel choice is now an ordered
  attempt gated by conformance rather than a pre-parse guess; that the default path reads `content`
  alone and why; and that **OAI-84's filed premise was partly refuted** — the "regardless of
  `structuredOutput`" claim was false, and acting on it would have reversed this ADR.
- One clause on the existing CLAUDE.md `structured.mjs` line naming the shape tolerance. Keep it one
  line.

## Verification

- `npm test`, quoting the summary line.
- The repo `verify` skill, all four steps; LM Studio is up, so step 4 is live rather than the stub.
- **Mutation, on the `adr/003` invariant** — the key one, because it is the thing a "helpful"
  future edit would break: delete the `structured` condition from the channel list so the default
  path gains a `reasoning` fallback. Prove it landed with `mutation-landed.py`, name the failing
  test, restore, re-prove green by `diff`.

## Residue expected

- the all-dropped-reads-as-clean hazard, applying to both spellings, unchanged by this item
- whatever the ladder leaves `open at approval` / `unresolved at cap`
