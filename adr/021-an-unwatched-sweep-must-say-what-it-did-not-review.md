# 021 — An unwatched sweep must say what it did NOT review

**Status:** accepted, 2026-08-08.

## Context

`/oai:review` reviews one target per invocation, interactively. The want is different: leave the
machine overnight, have a local model review recent commits newest-first, and wake to a list of
concerns to triage. `bench/review-sweep.mjs` is that harness.

The obvious design is a loop that collects findings. It is wrong, and the reason is specific to this
hardware.

**A starved run and a clean run are the same shape.** OAI-115 measured `max_tokens` to be a single
pool shared by reasoning and the answer: on a large target the model spends the whole budget thinking
and emits no findings. The MoE model starved on 4–5 of 6 benchmark cases and the dense one on 1 of 6.
A sweep that reports only what it found therefore renders "the model reasoned until the budget was
gone" and "the model read this and found nothing" as the same empty list — and the reader draws the
opposite conclusion from the truth, at the exact moment they are least able to check, because they
were asleep.

So the load-bearing output of this harness is not its findings. It is its **coverage**.

## Decision

**Every enumerated commit is disposed of exactly once, in one of THREE sections** — `Findings`,
`Reviewed, nothing reported`, or `Coverage` — never absent from all three and never in two of them.
Only two outcomes count as *reviewed*:

`findings` and `clean` are reviewed. `starved`, `truncated`, `unreadable`, `substituted`, `crashed`,
`output-too-large` and `failed` are **UNKNOWN** — the commit was not reviewed, and the report says
which kind of not-reviewed it was. Three further outcomes, `skipped-deadline`, `skipped-abort` and
`skipped-no-code`, were never attempted.

**The first version of this ADR claimed that invariant while the code broke it**, and the review that
followed found three ways. Recorded here rather than quietly corrected, because the gap between what
a decision record asserts and what its code does is the defect this repo keeps re-finding:

- **Aborting `break`ed out of the loop**, so on an outage the remaining commits appeared in neither
  section and the header's enumerated count silently shrank to match. They are now recorded
  `skipped-abort`, and the count comes from the enumeration rather than from the entry list.
- **A truncated analysis was reported `clean`.** `analysisCut` is the CLI's own caveat meaning the
  model never finished looking, and reading only `findings` conflated it with a clean review — the
  exact failure this ADR exists to prevent, one layer up. It is now the `truncated` outcome.
- **The harness's own 64MB capture ceiling was reported as `crashed`**, i.e. as the child dying.
  `ENOBUFS` is now `output-too-large`, which names it as a sweep defect rather than a review failure.

Three of those exist because each is a distinct way the night could lie:

- **`substituted`** — a server that answers with a *different* model returns a perfectly well-formed
  report. Counted as `findings`, it silently attributes one model's review to another. The answering
  model is therefore recorded **per commit**, never once in a header, because it can differ per
  request and a header value would assert a uniformity nothing enforces.
- **`crashed`** — a child that dies without emitting an envelope has no `reason` at all, so it matches
  no envelope-based branch and would otherwise fall through to whatever the last `else` happened to be.
- **`unreadable`** — `findings: null` (the reply could not be read) is not `findings: []` (it was read
  and was empty). That distinction is what `adr/003` exists to protect; collapsing it here would
  reintroduce the same defect one layer up.

### Two sections became three, and a commit stopped appearing twice

The first version claimed exactly-once over **two** sections while the code had no home for a plain
`clean` commit — it had no findings and was not a coverage row, so it appeared in **neither**. Adding
`Reviewed, nothing reported` closed that.

Then the opposite: a review that did **not** complete can still have reported something real, and
rendering those leads put such a commit in the Findings section **and** in Coverage. The resolution is
that **disposition and surfacing are the same act**: a disqualified review's findings render *under its
coverage row*, with the same file, line, severity, summary, evidence, answering model and
incompleteness notes a completed review's would get, flagged by the outcome that disqualifies them.
One commit, one place, nothing lost.

### Classification reads a field, never prose

`scripts/lib/review-report.mjs` now tags its token-exhaustion refusal `reason: 'token-exhaustion'`.
That is the single production change this harness required.

Without it the sweep would have to match the sentence *"ran out of tokens before it finished writing
its findings"* to tell starvation from a broken server. This repo has that defect class on file twice
(OAI-13 items 1 and 2: a harness that could distinguish a wall-clock cap from a 500 only by
pattern-matching), and `bench/lib/outcome.mjs` states the rule its readers keep — never regex a cause
out of prose. `UserError` already accepted a `reason` and `errorReport` already surfaced it; the field
was simply never set.

### Order of classification is load-bearing, not stylistic

`outcomeFor` does a bare `JSON.parse` and **throws** on malformed input; `reasonFrom` is the helper
that gates on `error === true`. Both take **raw stdout** and parse internally — handing either a
parsed object returns `null` and silently loses every reason. So: **capture stdout and stderr, both
bounded** → **`ENOBUFS` first**, which is this harness's own capture ceiling rather than anything the
server did → classify unparseable output → `reasonFrom` for failure envelopes → only a valid non-error
report reaches `outcomeFor`. Reversed, one malformed reply overnight takes down the sweep instead of
being recorded as one bad commit.

**The `ENOBUFS` step was added to the code and not to this list**, which left this ADR describing a
four-step order the code no longer followed. It is spelled out because that gap — a decision record
asserting a sequence its code has since changed — is the same defect class as the coverage claims
above, and it was found only by auditing this document against its own earlier version rather than
against the change that was intended.

**A reason is only compared when it is a string.** The envelope is a document from another process and
its `reason` can be any JSON value; an object there used to throw out of the classifier and take the
whole sweep with it, erasing every commit not yet reached. An uninterpretable shape is recorded as no
reason rather than trusted — and "no usable reason" is itself the signal a wrong `--model` produces.

### The deadline governs starting, not finishing

Checked immediately before each review and never after — the discipline `awaitTurn` keeps in
`job-queue.mjs`, which reads its cap at the last moment before the thing it authorises. A review
already in flight is never truncated; overshoot is bounded by the per-commit `--max-seconds` instead.

`--max-commits` counts **eligible** commits, not commits walked past. Counting enumerated ones would
have made a sweep of this repo review nothing at all on some nights, its recent history being
documentation, while reporting that it had reached its limit.

#### The per-commit cap acquired a second job by accident, and 900s could not do it

Amended 2026-08-10. The paragraph above gives `--max-seconds` one job: bounding **overshoot** past
the stop time. It silently acquired a second — *deciding how long a review may take* — and nothing
ever calibrated it for that. The first sweep run to completion lost **half its eligible corpus** to
it: 20 of 40 commits, every one `deadline-timeout`, **not one** a transport drop.

The default is now **1800**, and the wording matters: it is **bounded by evidence, not identified by
it**. 900 is too low — the slowest *completion* was already 884s. At least one useful review needed
**1518s**. Beyond that more time cures nothing, because the reply-token reserve is a **second,
independent ceiling a longer deadline cannot relieve**: a run given 3600s exhausted its tokens at
1307s instead. **Nothing distinguishes 1800 from 2400** — the 2400s experiment finished at 1518s, so
it shows only that some cap above 1518 sufficed.

Validated after the fact rather than argued: four of the timed-out commits were re-run at a 2,400–
3,600s cap. **Two that returned nothing at 900s produced findings at 1,163s and 1,192s.** One starved
on tokens at 1,307s with the clock not binding, and one could not be measured at all — on a cold
process it builds a prompt far larger than the window, which is a sizing defect tracked separately.
So **no observed run approached 1800**, and the slowest completion ever recorded is 1,518s. The true
worst case of the corpus is still unknown, and the sample is four.

The trade is explicit: worst-case attempts in a ten-hour night halve, 40 → 20. That is right **only
while a cut run returns nothing at all**, which makes breadth bought at 900s breadth in the form of
unknown coverage. When salvage-on-loss lands and a cut run yields something, this should be
revisited — and revisited against **uncensored** timings, which no run has yet produced, since every
recorded failure sits exactly on whatever cap it was given.

One interaction to keep in view: a wall-clock failure is deliberately **not** an outage, so it does
not advance `--abort-after` — and it **resets** the consecutive counter. Doubling the cap therefore
doubles the window in which a genuine outage can hide behind slow commits. That is tracked
separately; it is not a reason to keep 900.

## Consequences

- **The report states its own weakness.** Findings are unverified claims from a small model, and they
  are **commit-local**: `--commit` sends each changed file whole at the commit's revision
  (`adr/005`, verified — `git show <ref>:<path>` with `--root`), but nothing the commit did not touch.
  A defect living in the relationship between a change and an existing caller elsewhere is invisible
  by construction. The report says so, in those words.
  **"Whole files" is conditional and the report now says when it did not hold**: the request ladder
  falls back to the diff alone when the changed files do not fit the window, **and skips the rung
  outright when nothing could size that window** (OAI-139), which the envelope reports as `hunksOnly`
  and — for the second cause only — `skippedUnsizedWindow`. An entry carrying it is annotated, because otherwise this ADR's own
  whole-files claim would be false for that commit with nothing saying so.
- **A completed review can still be incomplete, and says which kind.** `atCap` means the findings list
  hit the reporting ceiling; `dropped` counts findings the model emitted that normalization discarded
  for naming no file or no defect. Neither demotes the review — findings were produced — but both mean
  the list is shorter than what the model had to say, which a reader comparing two commits' counts
  needs. The raw `--json` per commit is retained in the record (bounded, with truncation recorded)
  rather than reduced to a classification.
- **This does not fix OAI-115.** It makes starvation visible and counted. A night that starves on
  every large commit still produces almost no findings — the difference is that you can tell.
- **`--abort-after` ends a sweep after N consecutive failures that mean the SERVER is unwell**, which
  `serverUnwell` defines as the two transport reasons, the `COMPLETION_SHAPES`, and **`idle-timeout`
  alone of the timeouts**. A failure envelope carrying **no reason at all** counts too — that is what a
  wrong `--model` produces, the likeliest unattended misconfiguration there is.
  **The axis that separates the timeouts is what the clock MEASURES, and the CLI already states it**
  in the hint it writes per budget: `deadline` says *"raise `--max-seconds`"*, `first-token` says *"a
  large prompt can take minutes to ingest — raise `--timeout`"*, and `idle` says *"the model began
  answering and then stalled — check the server log; raising `--timeout` will not help"*. A budget
  whose own hint says a bigger value fixes it measures the caller's patience; the one whose hint says
  it will not help reports something the server did. `collectStream` confirms the mechanism: the idle
  budget is armed only when a frame carried text.
  **This predicate took FIVE iterations, and the fourth was a regression** — any `*-timeout`, then
  `{deadline, idle}`, then `{idle}`, then none, now `{idle}`. Every wrong step generalised on a
  property of the reason NAME; the rule that held reads the CLI's own hint, which is an artifact
  rather than an inference. Recorded so a sixth reason is tested against the artifact.
  Still excluded: `token-exhaustion` (the model's budget), `oversize` and other input refusals, and
  `output-too-large` — this harness's own capture ceiling, which counting would have the sweep
  diagnose the server for its own limit.

- **A pinned window is a resolved SHA, not the text the caller typed.** `--from` accepts a ref for
  convenience and `resolvePin` (`bench/lib/sweep-window.mjs`) resolves it with
  `git rev-parse <ref>^{commit}`; the **resolved commit** is what is enumerated from, recorded, and
  rendered in the report header. Recording the raw ref would let two benchmark arms walk different
  histories from identical-looking input, which is the entire defect the flag exists to remove. A
  value beginning with `-` is refused before it reaches `git log`, where git would read it as an
  option rather than a revision.

- **A run that fell short says so in the artifact, not in the operator's memory.** The record carries
  the requested `--max-commits` beside the eligible count found, and the header states the shortfall
  when they differ. Without it an arm that reached six of ten reads as a completed run — and for a
  benchmark, arms are compared from the artifact, so a pre-flight check run by hand is not a property
  of the thing being compared.

- **One mapping builds every report-derived entry, and a differing verdict is an override on top.**
  `classify` no longer constructs entries itself: every parsed non-error report goes through
  `reported()`, and `substituted` is that entry with its outcome replaced. The rule it enforces:
  *every report-derived entry retains `model`, `analysisCut`, `atCap`, `hunksOnly`,
  `skippedUnsizedWindow` and `dropped`, and retains `findings` whenever it is an array* — `unreadable` legitimately has no array to carry.
  **This exists because the identity recurred.** "`classify` does not carry a belief-changing envelope
  field onto the entry" was fixed for `analysisCut`/`atCap`/`hunksOnly`, then for `dropped`, and then
  reappeared on the `substituted` branch, which the two fixes never reached. Fixing a third branch
  would have left a fourth possible; one construction site does not. A behavioural test asserts the
  rule across every outcome, and a source scan that the parsed report is read in exactly one place is
  a **tripwire only** — an alias would satisfy the count — so the semantics live in the tests.

- **What the report renders is decided by what an entry CARRIES, never by what its outcome is called.**
  Three defects came from keying on the outcome: a `truncated` review's real findings vanished from
  the artifact because only `findings` entries were rendered; caveats were emitted only in that same
  branch, so a `clean` entry reviewed diff-only read as a full review while the report claimed files
  were seen whole; and a failed row rendered "answered by X" from `requestedModel`, which
  `errorReport` emits **because nothing answered** — the requested-versus-served conflation `adr/011`
  exists to prevent, reappearing one layer up. Findings are rendered wherever they exist, flagged
  with the outcome that qualifies them; caveats are rendered on every row; and a completed review that
  is nonetheless qualified gets its own section, because it never reaches coverage.
- **Two artifacts per run**, `<stamp>.md` (the triage list) and `<stamp>.json` (the machine record
  that makes a later "since last sweep" mode and model-to-model comparison possible), written by a
  local writer rather than `bench/lib/record.mjs` `persist`, which hardcodes `<root>/bench/results`
  and so cannot honour `--out-dir`.
- **Nothing is written to the tracker.** Filing is deciding; triage is a morning job for a human.
