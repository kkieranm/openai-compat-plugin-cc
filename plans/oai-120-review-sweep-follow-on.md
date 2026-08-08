---
provenance: harness slug humble-snacking-melody
---

# Review sweep follow-on — one mapping, one disposition, one pinned window

## Context

The overnight review-sweep harness shipped, but its review ladder ended `cap-without-approval` at the
computed cap of 3 with two code defects open and no boundary batch left to fix them. This is that
work, taken through its own gate. Six tracker items, filed 2026-08-08 as tier 12.

**It also unblocks the benchmark the user asked for** — 5 models × 2 executions × the same 10 commits
— which cannot run meaningfully until two of these land.

**Probe: all five load-bearing claims verified TRUE by Codex against current bytes**
(`bench/lib/sweep-outcome.mjs`, `bench/review-sweep.mjs`, `bench/lib/sweep-report.mjs`,
`scripts/lib/http-errors.mjs`).

### Grill decisions (settled with the user)

**OAI-118 and OAI-122 are IN scope**, because fixing OAI-120 makes OAI-118 strictly worse: once
`substituted` entries carry findings, the double-rendering spreads to a second outcome — and it is the
outcome the five-model benchmark is most likely to hit. **The benchmark starts automatically once the
suite is green.**

## The items, and why 120 and 121 are one fix

| Item | What is wrong |
|---|---|
| **OAI-121** | The *rule*: `reported()` is the only place the envelope's caveat fields reach an entry, and `classify` has a path that bypasses it. The identity was fixed twice and recurred once. |
| **OAI-120** | The *instance*: that path is the `substituted` branch, which drops findings **and** all four caveats. Reproduced. |
| **OAI-119** | `serverUnwell` admits `deadline-timeout`, which `http-errors.mjs` mints from the **caller's** `--max-seconds` budget. Three slow commits abort a healthy sweep. |
| **OAI-118** | A non-reviewed entry carrying findings renders in **both** Findings and Coverage, against the stated exactly-once invariant — and the test that names that invariant asserts only presence, so it cannot fail on duplication. |
| **OAI-122** | `adr/021` still documents the superseded any-`*-timeout` rule and a two-section disposition. |
| **OAI-124** | Enumeration always starts at `HEAD`, so a commit landing between benchmark arms shifts the window. |

## Design

### Phase 1 — one mapping, on every path (OAI-121, closing OAI-120)

`classify` stops constructing report-derived entries itself. Every parsed non-error report goes
through `reported()`, and a differing **verdict** is applied as an override on top:

```js
const settled = outcomeFor(stdout, false);
const entry = reported(settled.report);
if (settled.reason === 'model-substituted') {
  return { ...entry, outcome: 'substituted', reason: settled.reason, ...kept };
}
return { ...entry, ...kept };
```

**The invariant, stated correctly.** The first draft said "every report-derived outcome carries the
four caveats **plus findings**", which `reported()` itself contradicts: the `unreadable` branch
returns no `findings` property at all, because there was no array to carry. So the rule is:

> Every report-derived entry retains **all five carried report fields** — `model`, `analysisCut`,
> `atCap`, `hunksOnly`, `dropped` — and retains **`findings` whenever it is an array**.

`substituted` and `unreadable` are therefore tested **separately**: the first with a findings array
that must survive, the second asserting the caveats survive while `findings` legitimately does not.

**The guard is the point of OAI-121, not the fix.** Two layers, because the class has recurred once:

1. **Behavioural** — the semantic protection. Assert the invariant above across every report-derived
   outcome, `substituted` included.
2. **Structural — a tripwire, and claimed as no more than that.** Scan **comment-stripped** source
   and anchor the sole `reported(settled.report)` call site. It reddens on the named regression (the
   bypass turns one direct occurrence into two), which is worth having; but **an alias or a destructure
   would satisfy the count while bypassing the rule**, so the count does not *prove* one mapping and
   the plan must not say it does. The behavioural layer is what carries the semantics.

### Phase 2 — the third narrowing (OAI-119)

`UNWELL_TIMEOUTS` becomes `{'idle-timeout'}` alone. `deadline-timeout` is the harness's own
`--max-seconds` cap; `idle-timeout` is a stream that stalled mid-generation, which is the server
stopping. **An existing test asserts `deadline-timeout` is unwell and must flip** — a deliberate
behaviour change from an accepted finding, not a test edited to pass.

### Phase 3 — exactly one disposition per commit (OAI-118)

Rather than restate the invariant to permit double-rendering, **make it true**. Each commit is
rendered **once**, in the section matching its disposition, with its findings inline where it has any:

- `## Findings` — reviewed entries that reported defects
- `## Reviewed, nothing reported` — reviewed entries that did not
- `## Coverage` — everything not reviewed; **an entry here that carries findings prints them inline,
  flagged with the outcome that disqualifies the review**

That keeps the leads a `truncated` or `substituted` review produced (the reason OAI-120 mattered)
without the commit appearing twice.

**Nothing may be lost in the move.** A coverage row that carries findings must render the **same
detail the Findings section would have given it** — each finding's file, line, severity, summary and
evidence, plus the answering model and every incompleteness caveat — alongside its outcome and reason.
A summarised or truncated rendering here would trade one reporting defect for another.

**The test is rewritten to count occurrences, not presence** — `out.split(sha).length - 1 === 1` for
every entry — and its fixture must include a **non-reviewed entry carrying findings**, which the
current fixture cannot produce and which is why the old test could not fail.

### Phase 4 — a pinned window (OAI-124)

`--from <ref>` in `SPEC.valueFlags`; `enumerateCommits` passes it to `git log` in place of the
implicit `HEAD`, defaulting to `HEAD`. Recorded in the run record so a report says which window it
enumerated.

### Phase 5 — docs (OAI-122)

`adr/021` updated for: the narrowed timeout set, the three-section exactly-once disposition, and the
one-mapping rule with the recurrence that motivated it. The `CLAUDE.md` note stays one line.

## Files

`bench/lib/sweep-outcome.mjs` · `bench/lib/sweep-report.mjs` · `bench/review-sweep.mjs` ·
`tests/review-sweep-outcome.test.js` · `tests/sweep-report.test.js` · `tests/review-sweep.test.js` ·
`tests/structure.test.js` (one new guard) · `adr/021-…md` · `CLAUDE.md`

**Size:** `tests/structure.test.js` is at its own 300 ceiling with an **empty allowlist**, so the new
guard cannot simply be appended — it goes in the sweep's own test file unless a line can be recovered.
`sweep-report.mjs` is 237 and phase 3 restructures it; watch the 300/60 budgets.

## Verification

1. `npm test` — 747/0 before, and green after.
2. **Mutation on the phase-1 rule**: restore the `substituted` branch to construct its own object
   (bypassing `reported`). Prove it landed with `mutation-landed.py`; the OAI-120 behavioural test and
   the structural `settled.report` guard must both redden. Restore, prove against the copy, re-run.
3. Assert the OAI-118 test **fails** against the pre-phase-3 renderer — the whole point is that its
   predecessor could not.
4. `verify` skill, then a **real smoke run** against live LM Studio with `--from <sha>` on two commits,
   confirming the pinned window and that a report renders each commit once.

## Then, automatically

Start the benchmark: 5 models × 2 executions × the same 10 commits, 600s per-commit cap, whole files,
`--abort-after` at its default now that OAI-119 is fixed.

**`--from` alone does NOT deliver "the same 10", and the invocation must say so explicitly.** Three
things are required together, and the defaults defeat two of them:

- **`--from <full SHA>`, never a movable ref.** `HEAD` or a branch name would drift between arms,
  which is the whole defect being fixed.
- **`--max-commits 10`** — the default is **40**.
- **`--scan-limit` set high enough** that ten *eligible* commits are actually reachable from that SHA.
  Eligible-counting means a window thick with documentation commits can otherwise stop early and the
  arm silently reviews fewer than ten.

**Before the arms run, resolve the window once and assert it: enumerate with those exact flags and
confirm it yields exactly 10 eligible commits.** If it yields fewer, raise `--scan-limit` — do not
start a matrix whose arms each review a different number of commits.
