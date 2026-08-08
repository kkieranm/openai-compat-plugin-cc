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

**Every enumerated commit appears exactly once — in the findings section or in coverage, never in
neither.** Only two outcomes count as *reviewed*:

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
parsed object returns `null` and silently loses every reason. So: capture stdout → classify
unparseable output first → `reasonFrom` for failure envelopes → only a valid non-error report reaches
`outcomeFor`. Reversed, one malformed reply overnight takes down the sweep instead of being recorded
as one bad commit.

### The deadline governs starting, not finishing

Checked immediately before each review and never after — the discipline `awaitTurn` keeps in
`job-queue.mjs`, which reads its cap at the last moment before the thing it authorises. A review
already in flight is never truncated; overshoot is bounded by the per-commit `--max-seconds` instead.

`--max-commits` counts **eligible** commits, not commits walked past. Counting enumerated ones would
have made a sweep of this repo review nothing at all on some nights, its recent history being
documentation, while reporting that it had reached its limit.

## Consequences

- **The report states its own weakness.** Findings are unverified claims from a small model, and they
  are **commit-local**: `--commit` sends each changed file whole at the commit's revision
  (`adr/005`, verified — `git show <ref>:<path>` with `--root`), but nothing the commit did not touch.
  A defect living in the relationship between a change and an existing caller elsewhere is invisible
  by construction. The report says so, in those words.
  **"Whole files" is conditional and the report now says when it did not hold**: the request ladder
  falls back to the diff alone when the changed files do not fit the window, which the envelope
  reports as `hunksOnly`. An entry carrying it is annotated, because otherwise this ADR's own
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
  `serverUnwell` defines as three groups: `TRANSPORT` / `NON_RETRYABLE_TRANSPORT`; `COMPLETION_SHAPES`
  (`empty-completion`, `stream-unfinished`, `blank-completion`); and any `*-timeout`, matched by
  suffix because `http-errors.mjs` mints those per budget and there is no constant to import. A
  failure envelope carrying **no reason at all** counts too — that is what a wrong `--model` produces,
  the likeliest unattended misconfiguration there is.
  **The second group is the load-bearing one and the first version omitted it**: ADR 012 and OAI-20
  measure the completion shapes as this hardware's dominant failure at 27 of 72 runs, so the guard
  could not fire on the exact outage it was written for. Starvation stays excluded — the model's
  budget, not the server's health, and three large commits in a row must not read as an outage — as do
  input refusals such as `oversize`.
- **Two artifacts per run**, `<stamp>.md` (the triage list) and `<stamp>.json` (the machine record
  that makes a later "since last sweep" mode and model-to-model comparison possible), written by a
  local writer rather than `bench/lib/record.mjs` `persist`, which hardcodes `<root>/bench/results`
  and so cannot honour `--out-dir`.
- **Nothing is written to the tracker.** Filing is deciding; triage is a morning job for a human.
