ARCHIVE — not the current spec; the plan beside it is
provenance: harness slug bright-snacking-parrot

# OAI-195: normalizeFinding crashes on a hostile-coercion severity/line

## Context

`scripts/lib/structured.mjs`'s `normalizeFinding` parses one model-reported finding out of a
review reply. It already guards `file`/`summary` with `typeof` checks before use, and drops the
whole finding (counted in the `dropped` tally) when either ends up empty — because a finding
naming neither a place nor a problem is unverifiable.

`severity` and `line` are not guarded the same way: `String(raw.severity ?? '')` and
`Number(raw.line)` coerce directly. A JSON-producible object with no usable primitive coercion
(e.g. `severity: {toString: null, valueOf: null}`) makes either coercion throw
`TypeError: Cannot convert object to primitive value`, uncaught — which crashes the parse of the
*whole* reply's findings, not just this one malformed entry. Reproduced directly in `node -e`, and
independently confirmed by Codex reading the cited lines (probe step).

Filed as OAI-195 during OAI-114's review-ladder verdict point. Fix shape decided at the design
fork below.

## Design decision (Codex STEER + fable verdict, both independent, both landed on A)

Once `severity`/`line` are guarded so a hostile object can no longer throw, a finding with a
hostile-object `severity`/`line` should be **kept**, with `severity` defaulted to `'medium'` and
`line` defaulted to `null` — the same treatment an unknown-string severity (`'CRITICAL'` ->
`'medium'`) or a non-numeric-string line (`'around 12'` -> `null`) already get today. Not dropped:
`file`/`summary` gate on the finding being *unverifiable*; a garbage severity/line doesn't touch
that, since file/summary already passed and the finding is still actionable. Treating only the
non-coercible subset of malformed objects as disqualifying (plain `{}` already coerces to
`'medium'`/`null` today and is kept) would be an arbitrary line no reader could predict.

Implementation trap flagged by the fable verdict, folded into the fix below: `Number("12")` is
`12` today, so a numeric-*string* `line` currently passes through as a real line number (no
existing test pins this). A naive `typeof raw.line === 'number'` guard would silently regress it —
the guard must admit `string | number` before coercing, not narrow to `number` alone.

## Fix

In `scripts/lib/structured.mjs`, `normalizeFinding` (currently lines 108-125):

```js
function normalizeFinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const file = typeof raw.file === 'string' ? raw.file.trim() : '';
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!file || !summary) return null;

  const severity = (typeof raw.severity === 'string' ? raw.severity : '').toLowerCase();
  const line = Number(typeof raw.line === 'string' || typeof raw.line === 'number' ? raw.line : NaN);
  return {
    file,
    line: Number.isInteger(line) && line > 0 ? line : null,
    severity: SEVERITIES.has(severity) ? severity : 'medium',
    summary,
    evidence: typeof raw.evidence === 'string' ? raw.evidence.trim() : '',
  };
}
```

Same shape as the existing `file`/`summary` guards (`typeof` check before use), applied to
`severity`/`line` without changing their existing keep-and-default behavior for any input that
was already handled (unknown string severity, non-numeric string line, plain-object severity/line
that coerces without throwing).

## Tests

Add to `tests/structured.test.js`, beside the existing `'an unknown severity becomes medium...'`
and `'a non-numeric line becomes null instead of NaN'` tests (~line 144-152), using the same
`payload`/`FINDING`/`parseFindings` helpers already in that file:

- A finding whose `severity` is `{ toString: null, valueOf: null }` does not throw, and the
  finding is kept with `severity: 'medium'`.
- A finding whose `line` is `{ toString: null, valueOf: null }` does not throw, and the finding is
  kept with `line: null`.
- A finding whose `line` is the numeric string `'42'` still resolves to `42` (guards against the
  fable-flagged regression risk from narrowing the `line` guard to `typeof === 'number'` only).

## Verification

- `npm test` — full suite green, including the new tests above.
- Mutation check (step 5): back up `structured.mjs`, revert the `severity`/`line` guards to the
  unguarded `String(raw.severity ?? '')` / `Number(raw.line)` form, confirm the two new
  hostile-object tests fail (`TypeError` thrown out of `parseFindings`). **The numeric-string-line
  test does not go red under this mutation** — `Number('42') === 42` was already the behavior
  before this fix, so that test only proves the guard preserves it; it is a no-regression check,
  not a fault-injection target, and correctly stays green both before and after the revert.
  Restore, confirm green again.
