STATE: dual-approved-unattended

Owner's authorisation for this unattended run (2026-08-27), quoted verbatim:

> "i will leave you unattended. keep iterating on items using /feature . when you have an option
> that you would usually put to me, instead try to converge using codex and a fable agent. do not
> prompt for plans as i will not be here"
>
> "you also have my permission to use lm studio if you need it"

Later steer (2026-08-27), also governing:

> "unless youre doing tangible code changes - move on to issues that actually matter and are likely
> to encounter"

# OAI-213 — the sweep report interpolates untrusted text into Markdown at every render sink

## The defect (confirmed by executing the renderer)

`bench/lib/sweep-report.mjs` (with siblings `sweep-health.mjs` and `sweep-notes.mjs`, which compose the
same `renderSweep` Markdown report) interpolates untrusted text — model-authored finding prose,
server-reported model ids, git commit subjects, operator paths, foreign-build ledger values — into
Markdown with no escaping. Reproduced 2026-08-28:

- `finding.summary` (worst — model prose ABOUT CODE, every ordinary run: the sweep never uses
  `--structured-output`, so `normalizeFinding` applies no cap/filter): a triple backtick opens an
  unterminated fence and swallows the rest of the report; a blank line breaks the list item.
- Every code-span sink (`entry.model`, `entry.sha`, `record.repo`, `record.requestedModel`,
  `record.from`) breaks its span on a backtick; `entry.subject` renders `**bold**` in the `###` heading.
- `record.include.join(', ')` throws a `TypeError` and loses the WHOLE report on a non-array
  foreign-ledger value (the loader `sweep-ledger.mjs` `envelopeOrNull` validates only that
  `envelope.commits` is an array; every other field is unchecked).
- `sweep-health.mjs`'s `${abortAfter ?? '(not recorded)'}` — `record.abortAfter` laundered through
  `serverHealth`'s parameter; same unchecked route.

Already safe: `displayReason` (OAI-209) — coerces non-strings via `JSON.stringify` (never throws),
metachars `/[\`*_[\]()<>#|~\\]/g` → `.`, flattens whitespace, caps at 120.

## The item's load-bearing constraint

Do NOT patch sinks one at a time — "patching one at a time is exactly how OAI-209 found a fourth after
fixing three." The real deliverable is a **structural test that fails if any untrusted value reaches a
render position unwrapped**, making the recurrence structurally impossible.

## Design decisions (converged via Codex steer + a fable agent + plan-gate readers)

Forks 1–3 converged to Option A (Codex steer `task-mtckysr5-d74aee`, fable agent). Fork 4's test shape
tightened MONOTONICALLY across three gate rounds, each step triggered by a proven counterexample:
namespace-scoped → pure default-deny → **anchored whole-expression grammar** (the terminal, and
simplest, form).

**Fork 1 — escape strategy: uniform dot-replacement** via one shared helper, two modes: `safeInline`
(single line) and `safeBlockquote` (per-line, keeps `\n`, for `finding.evidence`). Both use the same
metachar→`.` substitution. Stated cost: lossy on prose ("the \`foo_bar()\` call" → "the .foo.bar.. call")
— accepted; the threat model is corruption of a private (0600) file the owner reads, not XSS, and the
owner steered toward the simple provably-safe fix. A content-preserving prose mode (HTML entities) was
rejected: context-dependent (wrong inside code spans), a "small family" not one rule.

**Fork 2 — field scope: guard every rendered value**, numbers included. `safeInline` on a clean number
is a near-no-op.

**Fork 3 — fix + scan all three `renderSweep` files.**

**Fork 4 — anchored whole-expression grammar (pure default-deny, positive whitelist).** An
interpolation is ACCEPTED iff, after trimming, it is EXACTLY one balanced wrapper call
(`safeInline(...)` / `safeBlockquote(...)` / `displayReason(...)`) optionally followed by
`.slice(<int>, <int>)` — OR it is a file-bound reviewed-safe EXCEPTION. Nothing else. The two prior
rules were textual residual checks that Codex's round-3 blind re-ask showed leak by construction (a
param literally named `slice` passing as glue; computed properties; allowlist-by-dataflow). The
anchored form is a POSITIVE match of the only two safe shapes, so those leaks vanish and NO recursion,
residual stripping, or identifier analysis is needed — it is strictly less code as well as strictly
stronger. Proven 2026-08-28: it accepts every wrapped form and rejects `${slice}`,
`${safeInline(x) + entry.y}`, `${cond ? \`${entry.model}\` : ''}` (nested template — no recursion
needed), `${obj[entry.key]}`, and any trailing `|| more`.

## The shared helper — new module `bench/lib/markdown-safe.mjs` (NO options)

Three SINGLE-ARGUMENT exports, no options object anywhere — this is the round-5 reframe: Codex found
that a `whenAbsent`/`continuation` OPTION can carry unsanitized data (`{ whenAbsent: '' + entry.model }`,
a spread, a shorthand, an indirect variable), and rather than build an ever-tighter textual parser for
an options object (a leak surface that generated a finding for two rounds), the fix REMOVES the surface:
no wrapper takes options, so there is nothing to inject through one. Fallbacks move to a grammar-checked
trailing `|| '<string literal>'`; the blockquote continuation and every cap become constants inside the
helpers.

```
const MD_METACHARS = /[`*_[\]()<>#|~\\]/g;
const INLINE_CAP = 1000;          // roomy backstop: ids/paths are short, a finding summary fits
const BLOCKQUOTE_CAP = 2000;
const REASON_CAP = 120;           // reason codes; displayReason's historical cap, preserved
const EVIDENCE_CONTINUATION = '\n    > ';

function coerce(value) {
  if (typeof value === 'string') return value;
  let shown;
  try { shown = JSON.stringify(value); } catch { shown = undefined; }
  return typeof shown === 'string' ? shown : `(unrenderable ${typeof value})`;
}

function escapeScalar(value, cap) {              // NEVER recurses — circular-safe via coerce's try/catch
  let shown = coerce(value).replace(MD_METACHARS, '.').replace(/\s+/g, ' ');
  return shown.length > cap ? `${shown.slice(0, cap)}…` : shown;
}

function inline(value, cap) {
  if (value === undefined || value === null) return '';        // '' so a trailing `|| 'fallback'` fires
  if (Array.isArray(value)) {
    let out = '';
    try {                                        // incremental + throw-guarded (proxy / getter can throw)
      for (const v of value) {
        if (out.length >= cap) { out += '…'; break; }
        out += (out ? ', ' : '') + escapeScalar(v, cap);
      }
    } catch { return '(unrenderable array)'; }
    return out.length > cap ? `${out.slice(0, cap)}…` : out;
  }
  return escapeScalar(value, cap);
}

export function safeInline(value) { return inline(value, INLINE_CAP); }
export function displayReason(value) { return inline(value, REASON_CAP); }   // recognized wrapper name

export function safeBlockquoteLines(value) {     // hardcoded evidence continuation; escape per line
  if (value === undefined || value === null) return '';
  let shown = coerce(value).replace(MD_METACHARS, '.');
  if (shown.length > BLOCKQUOTE_CAP) shown = `${shown.slice(0, BLOCKQUOTE_CAP)}…`;
  return shown.replace(/\r\n?|\n/g, EVIDENCE_CONTINUATION);     // ALL line endings → blockquote prefix
}
```

- No options → the entire round-4/round-5 option-injection class (concat, spread, shorthand, computed
  key, indirect variable) is gone by construction, and the grammar needs no option-object parsing.
- **Fallbacks** are a grammar-checked trailing `|| '<string literal>'` (below). This restores the
  ORIGINAL `where || '(no location given)'` semantics exactly, and for the former `?? 'x'` sinks the only
  change is that an EMPTY-string field now takes the fallback too — acceptable, and no test exercises it
  (the fallback tests all cover the ABSENT case, where `||` and `??` agree — verified against
  `sweep-health.test.js` `(not recorded)` and `sweep-recovery.test.js`).
- `displayReason` keeps its historical 120 cap and its exact behaviour for its actual inputs (a present
  string, or a non-string non-null object; never null/undefined). One documented, test-unexercised,
  still-safe divergence: an ARRAY reason now renders `a, b` where the old code rendered escaped
  `JSON.stringify`.
- **Array** iteration is non-recursive (`escapeScalar`; a circular/nested element → `(unrenderable
  object)` via `coerce`'s try/catch), INCREMENTAL (stops at cap, no full traversal), and try/catch-guarded
  (throwing proxy → `(unrenderable array)`). **`safeBlockquoteLines`** normalizes `/\r\n?|\n/g` so a bare
  `\r` cannot leave an un-prefixed line that breaks out of the blockquote. All proven 2026-08-28.
- This module is NOT scanned — its own interpolations ARE the sanitiser.

## The sinks and their wraps — the rule is WRAP DATA, EXCEPT FORMATTING

Every interpolation of untrusted DATA is wrapped; interpolations that emit intentional Markdown /
layout / non-report-content are file-bound exceptions (below). Confirmed by the scanner (empty
allowlist flags exactly the data sinks).

`sweep-report.mjs`: each `${field}` / `${field ?? 'x'}` → `${safeInline(field)}` /
`${safeInline(field) || 'x'}`. Specifics:
- `entry.sha` → `safeInline(entry.sha).slice(0, 9)` (coerce FIRST — a non-string sha can't throw on
  `.slice`).
- `finding.evidence` → `safeBlockquoteLines(finding.evidence)` (continuation hardcoded in the helper).
- `finding.summary` → `safeInline(finding.summary) || '(no summary)'`.
- `where` — keep the RAW join (so a hostile `finding.file`/`finding.line` is escaped whole), then the
  trailing `||` fallback (its ORIGINAL semantics, restored):
  `const where = [finding.file, finding.line].filter((p) => p !== undefined && p !== null).join(':');`
  then `${safeInline(where) || '(no location given)'}`. The fallback literal is a grammar-checked
  trailing `|| '...'`, never routed through the escaper (parens would dot).
- Other laundered locals wrapped at the interpolation: `${safeInline(outcome)}` (`tally` Map key),
  `${safeInline(found)}` / `${safeInline(asked)}` (shortfall), `${safeInline(enumerated)}`.
- Numeric sinks wrapped too (Codex round-3: wrap numerics rather than allowlist them):
  `${safeInline(missed.length)}`, `${safeInline(entries.length)}`, `${safeInline(n)}`,
  `${safeInline(reviewed)}`, `${safeInline(enumerated - reviewed)}`, `${safeInline(record.maxSeconds)}`,
  `${safeInline(record.scanLimit)}`, etc.
- `record.include.join(', ')` → `${safeInline(record.include)}` (array-aware helper: valid array →
  `scripts, bench`, each escaped; non-array coerced, no throw).
- `coverageSection`'s `WHY` lookup → own-property-only: `Object.hasOwn(WHY, entry.outcome) ?
  WHY[entry.outcome] : 'no explanation recorded'` (matching `starvedExplanation`'s `STARVED_WHY`
  discipline). Without it a `constructor`/`__proto__` outcome renders an inherited value carrying
  metacharacters (`WHY['constructor']` → `"function Object() { [native code] }"`, proven). This makes
  `explanation` (and `why`) provably fixed prose, sound as exceptions.

`sweep-health.mjs`: `${safeInline(abortAfter) || '(not recorded)'}`. Make `clock`
self-safe (`${safeInline(iso).slice(11, 19)}` inside it). Hoist the nested outage label to a named
arrow so its interpolations are top-level, and wrap `clock`'s call there too (double-application is
idempotent — dot-replace, whitespace-flatten and `…`-cap are each idempotent; a fixture asserts it):

```
const outageLabel = (entry) => `\`${safeInline(entry.sha).slice(0, 9)}\` ${safeInline(clock(entry.startedAt))}`;
```

`sweep-notes.mjs`: `${safeInline(entry.dropped)}`; `${safeInline(entry.signal)}`.

## File-bound exceptions (FORMATTING / intentional Markdown / non-report-content)

`SWEEP_SAFE_EXPRESSIONS` maps each file to a Set of EXACT expression strings (file-bound, not
file:line — line numbers churn). Every entry emits intentional Markdown, layout, or non-report content
— NOT untrusted data — and each carries a one-line reason:

- `sweep-report.mjs`: `subjectLine(entry)`, `answeredBy(entry)` (helpers emitting a code span);
  `reasonSuffix(entry.reason)`, `shortfall(record)`, `tally(record.entries)` (helpers whose internals
  are themselves wrapped/own-scanned); `severity` (intentional `**`), `evidence` (intentional `> `),
  `line` (a built finding line with a code span), `note` (an `incompleteness` sentence — fixed prose or
  wrapped in `sweep-notes`), `explanation`/`why`/`cause` (fixed prose composed from wrapped/own-property
  pieces), `indent` (layout whitespace — MUST NOT be wrapped: `safeInline`'s whitespace-flatten would
  collapse `'  '`); `stamp` (a filename), `renderSweep(record)` (the composed report),
  `JSON.stringify(record, null, 2)` (the private JSON record).
- `sweep-health.mjs`: `outages.map(outageLabel).join(', ')` (composition of the wrapped `outageLabel`);
  the numeric counts (`tried`, `commits`, `longest`, `resets`, `outages.length`) are WRAPPED instead.
- `sweep-notes.mjs`: none.

Every "safe local" exception (`severity`, `evidence`, `line`, `why`, `cause`) is sound because its OWN
construction interpolations are inside the scanned surface and independently wrapped — allowlisting the
local render cannot open a hole.

## The structural test — `tests/structure.test.js`, alongside `RESPONSE_BOUNDARY`

- `SWEEP_RENDER_FILES` = the three render files (NOT `markdown-safe.mjs`).
- `sweepStripComments(src)` — string-aware: removes `/* */` and cuts `//` only outside a `'`/`"`/`` ` ``
  string (Codex round-1: the shared `withoutComments` cuts any `//`, so a URL in a string before an
  interpolation would erase it). Proven to keep a `${entry.model}` after a `https://` string, still
  strip a real comment, and match the naive stripper on all three current files.
- `sweepInterpolationAccepted(expr)` — the anchored NO-OPTIONS grammar: trim; require a leading wrapper
  name (`safeInline` / `safeBlockquoteLines` / `displayReason`) + `(`; balance-match its `)`; the
  argument inside the parens has NO top-level comma (exactly ONE argument — so a two-arg options call is
  rejected outright); then the remainder is empty, or exactly `.slice(<int>, <int>)`, or a trailing
  `|| '<string literal>'` (or both), where the fallback is a WHOLE single string literal matched by an
  ANCHORED regex — `^\|\|\s*'[^'\\]*'$` or its `"` variant, i.e. one quote-delimited run with no
  interior quote/backslash and nothing after — so `|| 'x' + entry.y`, `|| 'a' + 'b'` and `|| entry.y`
  all fail. Because the helpers take no options, the entire round-4/round-5
  option-injection class (concat, spread `{ ...x }`, shorthand `{ whenAbsent }`, computed key, indirect
  variable) cannot even be written into an accepted form, and the grammar needs no object-literal
  parsing. The `||`/`.slice` checks are anchored full-matches, NOT `\s*`-before-lookahead (which
  backtracks — a repo lesson `structure.test.js` documents). Proven 2026-08-28: accepts every wrap form,
  rejects `safeInline(x, {...})`, `safeInline(x) || '' + entry.y`, `safeInline(x) || entry.y`, `slice`,
  a computed property, a nested template, and a `+ entry.y` tail.
- For each interpolation (via the existing `interpolations()` walker over the stripped source): accept
  if it is a file-bound `SWEEP_SAFE_EXPRESSIONS` entry OR `sweepInterpolationAccepted`; else offender.
  Assert zero offenders across the three files. Failure message: **"wrap it in
  safeInline/safeBlockquoteLines (fallback via a trailing `|| 'literal'`); add a file-bound exception
  ONLY for intentional Markdown/layout that is provably safe."**
- Positive control in the same run (`HISTORICAL_LEAKS`-style): the grammar MUST reject `entry.model`,
  `abortAfter ?? '(not recorded)'`, `safeInline(entry.model) + entry.provider`, `slice`,
  `obj[entry.key]`, `cond ? \`${entry.model}\` : ''`, `safeInline(x, { whenAbsent: entry.model })`,
  `safeInline(x) || entry.model`, and MUST accept `safeInline(entry.sha).slice(0, 9)`,
  `safeBlockquoteLines(finding.evidence)`, and `safeInline(where) || '(no location given)'`. Dry-run
  against the current files (the empty-exception flag set is exactly the data-sink wrap list) is the
  hand-check before trusting the walker.

## Verification

- `npm test` green (the anchored structural test is the load-bearing new guard; existing
  `tests/sweep-report.test.js` — malformed-reason, injection, circular, legitimate-`{"code":42}` —
  stays green: `MD_METACHARS` matches the same set the old `displayReason` regex did and excludes
  `{}`/`"`/`:`).
- Fixtures in `tests/sweep-report.test.js`: a hostile `finding.summary` (triple backtick), `entry.model`
  (backtick), `entry.subject` (`**bold**`), `abortAfter` (backtick), a `\r`-bearing multi-line
  `finding.evidence` (via `safeBlockquoteLines`), and a non-array / circular / throwing-proxy
  `record.include` all render WITHOUT corruption and without throwing; plus one `safeInline(safeInline(x))`
  idempotence fixture.
- **`tests/sweep-repo-cli.test.js:71` must be updated** (Codex round-4's blind spot, found by the
  Claude gate): it asserts the rendered report contains the RAW `--repo` path, but `record.repo` is an
  untrusted DATA sink now wrapped by `safeInline`, and a macOS temp path carries `_` (a metacharacter) →
  the report shows the escaped path → deterministic red. Owned decision: `record.repo` STAYS escaped
  (it is operator/foreign data rendered in a code span, where a backtick would break out — a real
  safety need; the `_`→`.` on inert chars is the uniform rule's disclosed lossy cost, minor for real
  repo paths which lack `_`). A code-span-only escape mode was considered and rejected — it reopens the
  converged Fork 1 for marginal gain against the owner's simple-fix steer. Fix the test to assert the
  report names the repo in its ESCAPED form (apply `safeInline` to the expected `target`), which still
  proves attribution survives escaping. `record.repo` in the JSON record stays raw (the `record.repo ===
  target` assertion at :70 is unaffected — only the rendered report is escaped).
- Mutation check: revert one sink's wrap (e.g. `finding.summary`) → the structural test goes red,
  named; restore → green. Prove the mutation landed with `mutation-landed.py`.

## Disclosed residue (narrow)

- **Concatenation / string-building OUTSIDE a template literal** (`lines.push('x' + entry.model)`) — no
  interpolation scanner sees it. Grepped 2026-08-28
  (`grep -nE '\+\s*(record|entry|finding)\.|(record|entry|finding)\.\w+\s*\+'`, three files) — NONE
  today. The test's guarantee is therefore scoped to TEMPLATE INTERPOLATIONS, not all string-building —
  the same scope the repo's `RESPONSE_BOUNDARY` test carries.
- **Walker string-blindness now fails CLOSED**: a `}` or an unbalanced paren inside a wrapper-call
  string argument would truncate the extracted expression, which then cannot match the anchored form →
  a false POSITIVE (a spurious offender), never a leak. A balanced-parens-in-string argument
  (`whenAbsent: '(no summary)'`) is accepted (fixture).
- A future same-named local in the SAME file could be silently accepted by a file-bound exception —
  narrow; the alternative (file:line) churns on every edit.

## Out of scope

- `entry.model` reaching a `UserError` via `model-selection.mjs`/`delegate.mjs` is OAI-185 residue — a
  different sink; don't regress, don't fix here.

## Plan-gate thread

- **Round 1** — Codex (`task-mtclawxg-ejsoj5`): CHANGES-REQUIRED, 3 mechanism findings (wrapper-prefix
  fail-open; `//`-in-string stripping; array not total-capped / circular recursion) — all folded in.
  Claude subagent: CHANGES-REQUIRED, 1 blocking (`abortAfter` unwrapped sink the then-namespace-scoped
  rule couldn't catch) → triggered the reversal to pure default-deny.
- **Round 2** — Codex (`task-mtclvoqe-rpyxw5`): CHANGES-REQUIRED, 3 (nested-template fail-open;
  `WHY[entry.outcome]` prototype hole; evidence `.replace` residual offends the grammar) — folded in.
  Fresh Claude subagent: CHANGES-REQUIRED, same evidence finding; otherwise audited every interpolation
  and confirmed no other missed sink.
- **Round 3** — Codex (`task-mtcm8t2o-y0wryd`, blind): CHANGES-REQUIRED — the textual residual grammar
  leaks by construction (`slice` glue token; computed properties; allowlist-by-dataflow; concat scope)
  plus two real helper bugs (`\r` line endings; non-incremental array cap); recommended the anchored
  whole-expression grammar. Fresh Claude subagent: APPROVE (the residual version was sound, no blocker).
  Split resolved by ADOPTING Codex's recommendation — the anchored grammar is strictly simpler and
  stronger, preserves fable's fail-closed principle, and the Claude APPROVE confirms the surrounding
  design (sink inventory, allowlist reasoning, runtime) carries no blocker; the pivot only swaps the
  test's acceptance rule. Helper fixes 5/6 folded in regardless.
- **Round 4** — Codex (`task-mtcmuefy-rxrkzu`, threaded): CHANGES-REQUIRED — one blocking: the anchored
  grammar accepts a wrapper call whose `whenAbsent`/`continuation` OPTION carries an unsanitized
  identifier (`safeInline(null, { whenAbsent: entry.model })`). Folded in: the grammar now requires
  those options to be string literals (JS check, no `\s*`-lookahead trap). Codex confirmed everything
  else sound (exceptions, `where`/fallback behaviour, walker fail-closed). Fresh Claude subagent:
  CHANGES-REQUIRED — one blocking Codex missed: `tests/sweep-repo-cli.test.js:71` asserts the raw
  `--repo` path in the report, which `safeInline` escapes (`_`→`.` on a macOS temp path) → red. Owned:
  keep repo escaped (untrusted code-span data), fix the test to expect the escaped form. It confirmed
  every exception, the grammar both directions, runtime guards, and the other suites clean, and noted
  the `displayReason` array-reason divergence (now documented).
- **Round 5** — Codex (`task-mtcncuuk-6u8jqj`, threaded): CHANGES-REQUIRED — the option-literal check
  still failed open (`{ whenAbsent: '' + entry.model }` concat; a spread, shorthand, or indirect options
  variable). Resolved by REMOVING options entirely: helpers are single-argument, fallbacks are a
  grammar-checked trailing `|| '<literal>'`, the continuation and caps are constants — so the whole
  option-injection class cannot be written into an accepted form. Fresh Claude subagent: APPROVE, with a
  non-blocking note pointing at the SAME concat hole ("require exactly one string literal") — the
  no-options reframe supersedes it. Both confirm the repo-escape fix and everything else sound. Terminal
  grammar: no options → no option surface for a further round to probe.
- **Round count**: five discovery rounds, monotonically converging (sink fix sound since round 1; the
  grammar tightened namespace → default-deny → anchored → anchored-no-options, each a proven
  counterexample). Under the `/feature` plan-gate cap of 10.
