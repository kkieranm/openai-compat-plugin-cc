# 005 — Reviewing whole files, not bare diff hunks

Date: 2026-07-27
Status: accepted
Builds on: [ADR 002](002-context-window-detection.md), [ADR 004](004-bounding-the-review-reply.md)

## Context

`/oai:review` produced two or three false positives per run against roughly one real defect per five
runs, so checking its claims cost more than the claims were worth. **The largest observed
false-positive class was caused by this harness, not by the model.**

On `--commit 1ea398f` the reviewer reported "`positiveInteger` is not defined or imported" in three
runs out of three. It is defined at `model-info.mjs:48`; the diff carried only the call site at line
235. `REVIEW_SYSTEM_PROMPT` tells the model *"Never speculate about code you were not shown"* — and
then we showed it a file with the definitions cut out. Reporting the identifier was the correct move
given the input. Every identifier defined outside a changed hunk was a standing invitation to this
error.

The evidence ran the same way from the other side: **every verified true positive so far came from
`--file`, which already sent whole files** (credentials stripped by `url.origin`; the dropped query
string). Real commit diffs had produced zero verified catches across roughly six runs.

## Decision

**Each changed file is sent whole, alongside the diff.** The diff still says what changed; the files
let the model resolve what the diff refers to but does not show. `--diff-only` restores the previous
behaviour for a fast pass, and is the A/B switch OAI-12 needs.

**Content comes from the revision the diff describes**, never the working tree — otherwise the model
reviews code that was never in the change:

| target | file list | content |
|---|---|---|
| `--commit <ref>` | `diff-tree --no-commit-id --name-status -r --root -z <ref>` | `git show <ref>:<path>` |
| `--base <ref>` | `diff --name-status -z <mergeBase>..HEAD` | `git show HEAD:<path>` |
| `--staged` | `diff --cached --name-status -z` | `git show :<path>` (the index blob) |
| default | `diff HEAD --name-status -z` | the working tree, plus untracked files as before |

`--base` reuses the `mergeBase` already computed for its diff rather than calling `merge-base` twice.
Deleted files have no content and fall back to the diff; renames use the new path; binaries are
skipped by the existing NUL test.

### Two file lists, and the distinction is load-bearing

`collectTarget` returns `files` and `changed`. **`files` is the request's only copy of that code** —
untracked files appear in no diff, and `--file` produces no diff at all — so it is never dropped.
`changed` is the whole content of tracked files the diff already covers, so it can be dropped and
still leave the model the hunks. Only `changed` is droppable. Under `--file`, `changed` is empty, so
an empty review is impossible by construction rather than by care.

### A two-rung ladder, not a per-file shed

When the whole files do not fit: send the diff alone, and say so. Not a per-file shed keeping as many
as fit. That was the plan of record and was **rejected on its own evidence**:

- **It never triggers.** The reserve arithmetic collapses to one condition. With `minReserve` set,
  the middle regime passes by construction — `reserve = contextLength − estimate`, so
  `budget = estimate` exactly — leaving **fit ⟺ `estimate ≤ contextLength − minReserve`**. On the
  58k machine that is **54,016**, and the largest measured commit is 41,790. There is no observed
  case for shedding to handle.
- **It would drop the wrong file.** Ordered largest-first, the first thing shed from `1ea398f` is
  `model-info.mjs` — second-largest of the eleven, and *the file whose missing definition produced
  the false positive this ADR exists to remove.* Distance between a definition and its hunk
  correlates with file size, so the cheapest shed order is anti-correlated with value.
- **Rung two is the previous behaviour**, which needs no per-file manifest to be honest. A partial
  shed would need one, and getting it wrong recreates the defect while reporting it fixed.

### What the request may claim about itself

The prompt asserts one of two things, and each is a fact the code must actually hold:

- *whole files* — "you have the complete current content of every changed file". Sent only when the
  files really are all there **and the context window is known**. With the window unknown the guard
  is unarmed, so a truncated request cannot be ruled out, and telling a model it holds a whole file
  it does not hold is this very defect regenerated. The files still go; the claim does not.
- *hunks only* — "do not report an identifier as undefined, unimported or missing; you have no way to
  tell from this". The direct antidote to the observed failure, on the rung where it can still occur.

**The incompleteness note lives in `renderFindings`**, beside `analysisCut`, `atCap` and `dropped` —
the same artifact as the claims it qualifies, derived from the attempt that produced them, emitted
once. It is raised only when bodies we actually had were dropped: under `--diff-only` none were
collected, so the note would describe a loss that never happened.

**Pre-existing defects are labelled, not suppressed.** Given a whole file the model finds defects in
untouched code whatever it is told; instructing it to ignore them only makes it report them
unlabelled, where they read as false positives. One prompt sentence asks for a `pre-existing:` prefix.
A `scope` enum in the schema was rejected: under `additionalProperties: false` it becomes required, so
any server omitting it fails `matchesSchema` and drops to the degraded path — a new failure mode
bought for formatting.

**`UserError` gained `reason`.** The context guard tags only its oversized-input refusal `oversize`,
the one refusal sending less input can fix. A caller catching everything would launder an unrelated
bug into "too big" — the same shape as `planSelection` returning a `problem` for callers to format.

## Consequences

- **The target class is gone: 3 runs out of 3, against a 3-of-3 baseline.** Run 3's summary named
  `planSelection` and `effectiveWindow` as a single authority — knowledge available only from the
  whole files. `/oai:task` is untouched: shedding was never added to `prepareRequest`, so a `--file`
  the user named still produces a loud refusal rather than a quiet answer from half the input.
- **No findings appeared in any of the six A/B runs, and that is the expected result here.**
  `1ea398f` is the commit that *fixed* the OAI-2 findings, so it is close to clean; the baseline's
  only output was the false positive. The honest scoring is 1 false positive → 0, with true
  positives unchanged at 0. **This bought precision, and says nothing about recall.**
- **The diff-only arm stopped producing the false positive too** — plausibly via the hunks-only
  sentence, though that was never run without it, so the attribution is an inference and not a
  measurement. Either way both arms improved, so the six runs do not isolate which mechanism does the
  work and cannot be read as "whole files caused the improvement".
- **It costs 2.5× the input and 4–10× the wall clock**: 37,772 tokens and 38–245s, against 14,988 and
  7–27s. That makes OAI-8 (liveness) more necessary, not less.
- **The `analysis` cap now binds more often** — 2 of 3 whole-file runs, against the ~1 in 5 ADR 004
  measured on diffs. More input means more to reason about. ADR 004's `analysisCut` warning is what
  made this visible instead of silent, and both capped runs reported zero findings, so a cut run is
  still a wasted one. Whether the larger caps a bigger reserve would allow help is exactly the
  OAI-12 experiment already recorded there.
- **The diff-only arm's output collapsed to 395–731 tokens**, against 1,709–5,450 historically. That
  may be the hunks-only sentence steering the model to look less, or it may be the short-collapse
  ADR 004 recorded in both arms of its own A/B. At n=3 on a model whose run-to-run variance dwarfs
  the effect, it is not decidable here. Flagged for OAI-12, not concluded.
- **A root-commit bug was found by a test, not by a user.** `git show` prints a root commit's diff but
  `git diff-tree` lists nothing for it without `--root`, so whole files would have vanished for
  exactly the commit a new repository reviews first — with the hunks-only note truthfully saying the
  bodies were absent, which would have made it look intended. Guarded by
  `tests/git-diff.test.js` — "a repository's first commit still sends its files whole".
- **Two claims-vs-reality defects were caught in review, both of the shape this ADR is about.**
  (1) `git diff --name-status` reports root-relative paths from any directory while
  `git ls-files --others` reports cwd-relative ones, so a review run from a subdirectory read
  *nothing*, swallowed every error, and reported a normal run with the whole files silently absent —
  the exact silent fallback this item forbids. Everything now resolves against
  `git rev-parse --show-toplevel`, which also makes untracked collection cover the whole repository
  like the diff already did. (2) The hunks-only sentence said "you have been given only the changed
  hunks" while pinned files were in the same request, which would have suppressed findings on the
  files that appear in no diff. It is now scoped to what it is true of. Both are guarded.
- **Correction — this ADR asserted that merge commits were consistent, and they were not.** The
  original wording said merges "list no files, matching `git show`'s empty diff for them.
  Pre-existing, unchanged." That is true only of a trivially mergeable merge. `git show` prints a
  *combined* diff for any merge whose result differs from all parents — a resolved conflict, or an
  evil merge — while `git diff-tree` lists nothing for it without `--cc`. So whole files were
  silently never fetched for exactly the commits where the merge did real work, with the content
  sitting available at `git show <ref>:<path>`. `--cc` is now on the listing, which leaves ordinary
  and root commits byte-identical, and merge coverage exists where there was none. **An ADR about
  claims matching reality shipped a claim that did not, and it was asserted from one trivial
  example** — the same "agreement on ordinary input proves nothing about the edges" failure as the
  root-commit bug, three paragraphs above the correction.
- **`--base` was checked for the same disagreement and is genuinely clean.** A branch whose history
  contains a conflict-resolved merge still diffs `mergeBase..HEAD` as two trees, so no combined diff
  arises and the listing matches the diff exactly (verified: both give `a.txt`, `b.txt`). `--cc` is
  therefore on `--commit` alone, where `git show` can produce combined output. Recorded because
  "checked and fine" is worth as much as a fix — it is what stops the next reader re-deriving it.
- An unreadable file is reported on the **unparseable** reply path too, not just the parsed one, via
  a shared `unreadableNote`. It is a fact about the request, and both outputs derive from it;
  fixing only the branch in front of you is how instance 11 happened.
- No end-to-end coverage of `--commit`, `--base`, `--staged` or `--file` existed before this item;
  all four were unit-tested against `collectTarget` alone. `tests/review-context.test.js` adds it.
