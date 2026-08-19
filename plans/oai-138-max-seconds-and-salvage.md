provenance: harness slug vivid-wiggling-starlight

## Context

Last night's overnight sweep (`bench/results/sweep-2026-08-18-overnight/`) lost 15 of 34 attempted
commits to `deadline-timeout` (the model was still working when `--max-seconds` fired) and 8 more to
`starved`/`token-exhaustion` (the model spent its whole reply budget reasoning and had nothing left
to write findings with). Both failure classes are already investigated in depth in `BACKLOG.md`
(**OAI-138**, with the full evidence trail in `evidence/138.md`): `--max-seconds` was already raised
once, from 900 to 1800, specifically because 900 was losing half the corpus — and OAI-138's own text
says raising it again recovers *some* losses but not reliably, and that the real fix is **salvage**:
today, when the deadline fires, the model has already produced (and the harness has already paid for)
a large partial `reasoning` — thrown away entirely. OAI-138 designs two tiers for this and explicitly
defers building either ("this session's feature budget was spent elsewhere"). The user has now asked
to build both, prioritized: **(1) double `--max-seconds`, (2) build salvage.**

Traced end-to-end against current code (not just the 2026-08-10 design text, which predates several
refactors):

- The actual `--max-seconds`/`deadline` budget is armed at the HTTP transport layer
  (`scripts/lib/http-budgets.mjs`'s `armBudgets`), using raw transport byte counts — **not** the
  model's answer text. It fires by calling `request.destroy()`, which `scripts/lib/http.mjs`'s
  `bodyStream` (lines 93, 123) turns into a re-thrown `state.aborted` (the real `budgetError('deadline',
  ...)` object) rather than a generic socket error. That error propagates up through `readSse` into
  `scripts/lib/stream-collect.mjs`'s `collectStream`, where it's caught at line ~106.
- **Critically, `answer` (the accumulator holding the real partial `content`/`reasoning` text,
  populated incrementally by `applyFrame` in `scripts/lib/completion.mjs`) IS in scope in
  `collectStream`'s catch block**, regardless of which budget produced the failure — this is the same
  place `failure.timings = timings(...)` is already attached (line ~117), with the exact comment this
  feature needs: *"Measured, then carried out on the error rather than discarded... throwing them away
  leaves the attempt record unable to say..."* — this is tier 1's precedent, verbatim.
- The call chain from there: `answer-attempts.mjs`'s `answerWithRetry` → `scripts/lib/review-request.mjs`'s
  `unconstrained()` (its catch at line ~169 wraps and rethrows) → `requestFindings` → `cmd-review.mjs`'s
  `runReview` → `scripts/lib/review-report.mjs`'s `errorReport()` (the JSON envelope's build site, no
  field today for partial text) → `bench/lib/sweep-outcome.mjs`'s `classify`/`failure()` (which reads
  `error === true` envelopes and returns `{outcome: 'failed'|'starved', reason, ...}`, no findings field
  at all today).
- **No multi-turn message construction exists anywhere in this codebase.** `scripts/lib/prompt.mjs`
  always builds exactly `[{role: 'system', ...}, {role: 'user', ...}]`. Tier 2's follow-up request is
  new code, not a variation on an existing path.
- The only numeric default for the sweep's per-commit cap is `bench/review-sweep.mjs:48`'s
  `DEFAULTS.maxSeconds: 1800`. `/oai:review` itself has no baked-in default (unbounded unless
  `--max-seconds`/a provider's `maxSeconds` is set) — nothing else needs touching for change (1).

## Change 1 — double `--max-seconds`

`bench/review-sweep.mjs:48`: `maxSeconds: 1800` → `3600`. Update the inline comment to record why
(user-directed, alongside salvage landing in the same change — not a re-run of OAI-138's own
worst-case-tail experiment). This is the only place the number lives; nothing else to touch.

## Change 2 — salvage

**Tier 1: keep the partial answer instead of discarding it.**

- `scripts/lib/stream-collect.mjs`: in `collectStream`'s catch block, right beside the existing
  `failure.timings = ...` line, add `if (failure && failure.answer === undefined) failure.answer =
  answer;` (guarded the same way, same reasoning). This attaches `{content, reasoning, ...}` to ANY
  failure caught here — deadline, idle, a raw transport drop — cheaply and uniformly; content stays
  empty and harmless when nothing had streamed yet.
- `scripts/lib/review-report.mjs`'s `errorReport()`: add a `partial` field — `null` unless
  `error?.answer` has non-trivial `reasoning` (say, non-empty after trim), in which case
  `{ reasoning: error.answer.reasoning, content: error.answer.content }`. Follows the file's own
  stated rule ("a fact changing what the reader should believe cannot live on one path alone").
- `bench/lib/sweep-outcome.mjs`'s `failure()`: add `partial: report?.partial ?? null` to the returned
  object, following the exact pattern the file's own comment insists on (one mapping, not a second
  construction site) — this is what makes a salvage-eligible failure visible to tier 2's trigger
  condition one layer up in `review-sweep.mjs`, and what lets a reader of a *failed* entry's JSON see
  what was salvageable even when tier 2 didn't run (e.g. `/oai:review` invoked directly without the
  sweep wrapper).

**Tier 2: a bounded follow-up asking the model to conclude from what it already reasoned.**

- New function in `scripts/lib/review-request.mjs`, called from `unconstrained()`'s catch (line ~169),
  gated on: `fallbackError.reason === 'deadline-timeout'` AND `fallbackError.answer?.reasoning` is
  substantial (non-trivial length) AND `fallbackError.answer?.content` is empty/near-empty (the
  documented majority shape — findings JSON is emitted only after reasoning completes, so a
  deadline-timeout with real content already underway is a rarer, different shape this tier does not
  attempt to complete; tier 1 still preserves it).
- On trigger: build a genuine multi-turn `messages` array — the SAME `built.messages` (original
  system + user, unchanged) plus a synthetic `{role: 'assistant', content: <the partial reasoning>}`
  plus a new `{role: 'user', content: '<ask it to conclude findings now, in the same JSON shape>'}`
  — and fire one more `chatCompletion(profile, {...})` call, on its own small time budget (a new
  constant, NOT reusing `--max-seconds` — sized for "conclude now", not "review the commit"; OAI-138's
  own estimate is ~2-4 minutes given prefill-is-cheap economics, so a few hundred seconds is generous
  headroom). Exactly ONE follow-up attempt — on its own failure (including its own deadline), give up
  and fall through to the ordinary `deadline-timeout` failure report, tier 1's preserved `answer` still
  attached from the FIRST attempt. Never recurses.
- On success: the result flows back as an ordinary successful `requestFindings` return, but tagged —
  `built`/the context passed to `jsonReport` gets `salvaged: true`, following the exact pattern
  `hunksOnly`/`skippedUnsizedWindow` already use (a context-derived fact, not something read off the
  model's own JSON reply). `scripts/lib/review-report.mjs`'s `jsonReport()` includes it in its
  returned object.
- `bench/lib/sweep-outcome.mjs`'s `reported()`: add `salvaged: report?.salvaged ?? null` to the
  `caveats` object, alongside `analysisCut`/`atCap`/`hunksOnly`/`dropped` — same non-negotiable this
  file's own comments state for those: a fact that changes what a reader should believe cannot live on
  one path alone, and OAI-138's explicit constraint is that **a salvaged review must never read as an
  ordinary complete one.**
- `bench/lib/sweep-report.mjs`: render `salvaged` as a visible caveat wherever a `findings`/`clean`
  entry's caveats already render (same place `analysisCut`/`atCap` are surfaced today) — e.g. a
  `⚠ salvaged from a cut-short deadline-timeout` line beside the finding, so a reader scanning a
  report for real coverage cannot mistake a salvaged review for a complete one.

**Deliberately not built**: completing a truncated findings JSON that was already underway when the
deadline hit (rarer shape, different problem — resuming a cut JSON array reliably is a different and
harder prompting problem than "conclude from pure reasoning"); a configurable salvage time budget via
a new CLI flag (fixed internal constant for v1, matching this repo's "don't add a knob nothing asked
for" convention — can graduate to a flag if it ever needs tuning). Both apply equally to `/oai:review`
invoked directly and to the sweep harness, since the mechanism lives in `review-request.mjs`, which
both paths already share — a welcome side effect, not scope creep.

## Tests

- **Change 1**: no new test — a constant. `tests/` already has no test pinning its value (verified:
  grep for `maxSeconds.*1800` in `tests/` returns nothing), so nothing needs updating.
- **Tier 1**: a unit test on `collectStream` (there's an existing fake-SSE-server test harness this
  repo already uses for `stream-collect.mjs` / `chat.mjs` — reuse it) that forces a deadline expiry
  mid-stream (after some `applyFrame` calls have run) and asserts the thrown failure carries
  `.answer.content`/`.answer.reasoning` matching what was actually accumulated, not empty. A second
  test confirms a failure with NO stream progress (e.g. a first-token timeout) gets `answer` attached
  too but with empty fields, and that this doesn't crash anything downstream.
- **Tier 2**: an integration-style test against the existing fake OpenAI-compatible test server (the
  one `tests/helpers.mjs`'s `runCompanion` already spins up) configured to: on the FIRST request,
  stream a long `reasoning_content` then hang/never complete (forcing a real deadline-timeout at a
  short `--max-seconds` set for the test); on the SECOND request (the salvage follow-up), assert the
  received `messages` array has the expected shape (system, original user, assistant-with-partial-
  reasoning, new user ask) and reply with real findings JSON. Assert the CLI's `--json` output reports
  those findings with `salvaged: true`. A second test: make the follow-up ALSO fail, assert the final
  report is an ordinary `deadline-timeout` failure with `partial` still populated from the first
  attempt, and that exactly 2 requests were made (never a third — no recursion).
- **Bench-side**: unit tests on `sweep-outcome.mjs`'s `classify`/`reported`/`failure` for the new
  `partial`/`salvaged` fields, mutation-tested the same way this repo tests every belief-changing
  envelope field (`analysisCut` etc. already have this pattern to copy). A `sweep-report.mjs` test
  confirming a salvaged entry's caveat renders visibly.
- **Mutation-test every new conditional** per this repo's standing discipline (the trigger gate,
  the single-retry-never-recurse bound, the `salvaged`/`partial` field wiring) — this is exactly the
  "a fix that adds a conditional is mutation-checked" class.

## Verification

- `npm test` green.
- **Live check, since LM Studio is already warm right now**: run `/oai:review` for real against a
  large enough target with a deliberately short `--max-seconds` (short enough to force a genuine
  deadline-timeout on a real commit, e.g. 60-90s against a file that takes minutes to reason through),
  confirm salvage actually fires against the real server, produces real findings, and the JSON output
  carries `salvaged: true`. This is the one thing a unit test against a fake server cannot prove — that
  a real model's reasoning is actually salvageable in the shape this design assumes.
- Re-run last night's exact failed commits (the 15 `deadline-timeout` ones, e.g. `1657ba5b8`,
  `c13696d36`) at the new 3600s cap with salvage live, and confirm at least some of them now produce
  real findings instead of `failed`.
