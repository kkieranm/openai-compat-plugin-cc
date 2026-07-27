# 006 — A labelled corpus and a benchmark harness

Date: 2026-07-27
Status: accepted
Builds on: [ADR 003](003-structured-findings.md), [ADR 004](004-bounding-the-review-reply.md), [ADR 005](005-whole-files-for-review.md)

## Context

Every reviewer decision this repo has made rested on anecdote. The schema shape, the temperature, the
token caps, whole-files-versus-hunks — each was settled from one hand-extracted file and findings
verified by reading later commits. That does not scale, is not repeatable, and has already been wrong
in public twice: **OAI-10 got three cap values wrong in one afternoon**, and **OAI-14 shipped as half
its planned design** because measuring a threshold showed the other half would never fire.

The record shows the cost directly. ADR 004 says "four runs"; `890ee2e` and BACKLOG.md say "five" —
same 1 real / 3 false / 2 empty / 1 failed tally. Both readings are internally consistent, so neither
is *wrong*; nobody can tell which happened, because **no run was ever recorded individually.** Only
conclusions were written down, and a conclusion whose evidence was discarded cannot be rechecked.

## Decision

**`npm run bench` reviews known-defective snapshots of this repo's own history and scores what comes
back.** Opt-in, never part of `npm test`: it needs a real model and is non-deterministic, while the
suite is network-free by contract.

### It drives the shipped command, through `--json`

`/oai:review --json` prints the whole run as one object — findings, summary, and **every caveat the
text report carries** (`hunksOnly`, `atCap`, `analysisCut`, `dropped`, `unreadable`), plus usage and
timing. The bench runs the real CLI exactly as a user would and reads that.

The alternative — reimplementing the request inside the harness — was rejected on this repo's own
history. **A benchmark that scores a reimplementation and reports the number as *the reviewer's*
score is trap instance 11 at the meta level**, and the corpus makes it concrete rather than
theoretical: `structured` measures **64,357 tokens against the 54,016 threshold**, so it falls to ADR
005's second rung while every other case takes the first. (Measured through the real `estimateTokens`
and `buildMessages`, not chars ÷ 3.4 — that shortcut produced the wrong threshold during the OAI-14
grill and had to be corrected mid-decision.) A harness with its own request path would
either skip that rung silently or hold a second copy of the fit decision, free to disagree with the
guard. The flag is a branch at one existing call site — `parseFindings` already returns the object
and `renderFindings` is already pure beside it.

Both renderings live together in `review-report.mjs` and derive from the same parsed object and the
same refusals, the rule `jsonRow` already follows in `cmd-setup.mjs`. **`parsed: false` is never an
empty findings list**, because the two are indistinguishable to a caller and one of them is a
failure; where the reply could not be read, the parse-derived flags are `null` rather than `false`.

### The corpus is committed snapshots, materialized as an ordinary commit

`bench/cases/<id>/` holds `case.json`, a `before/` tree and an `after/` tree — the parent state and
the commit state of the files one historical commit touched. Not `git show` at runtime: the corpus
must survive a rebase and stay byte-stable, or scores drift for reasons that have nothing to do with
the reviewer.

`materialize()` builds a throwaway repo, commits `before/`, **clears every tracked file**, writes
`after/`, and commits again — so a file the historical commit *deleted* is absent, rather than
surviving a change that removed it. The base commit is made even when `before/` is empty
(`--allow-empty`), which leaves every case an **ordinary commit with a parent** rather than a root
commit. Root commits are not broken — `git-diff.mjs` passes `--root` for exactly them since OAI-14 —
but the bench measures review quality, so cases should not vary git's listing path between them.

| case | target | mode | why it is here |
|---|---|---|---|
| `config-origin` | `config.mjs@8990173` | `--file` | the target every earlier measurement used — the only continuity back to the pre-benchmark record |
| `scaffold` | `8990173` | `--commit` | the same two defects buried in 14 code files, so the pair measures context dilution |
| `model-info` | `65373a0` | `--commit` | the commit whose review produced this repo's signature defect class |
| `structured` | `c552bcd` | `--commit` | 64,357 tokens — **the only case that exercises the diff-only rung** |
| `caps` | `ac58a35` | `--commit` | absence-shaped: the defect is a report that is missing |
| `docs-only` | `25e1fcd` | `--commit` | **negative control**, four markdown files and no code |

### A defect is listed only if it can be pointed at in the snapshot

This is the load-bearing rule. Each entry carries `file`, `lines`, an `anchor` read **verbatim out of
the historical blob by line number** rather than retyped, a description, the commit that fixed it, and
a confidence. **Anything history claims but cannot be located is dropped, with its reason recorded in
the manifest — never guessed.** A fabricated label makes every number downstream fiction.

Applying it cost more than expected, and the corpus is smaller than the history's claims:

- **`1ea398f` claims 13 confirmed defects and enumerates six.** The rest survive only as a pattern in
  `REPO_TRAPS.md`, scoped there to "two features", so they cannot be mapped back to one commit.
- **Two of my own first-pass attributions were simply wrong.** "A string `contextLength` makes the
  guard NaN" was assigned to `65373a0`, which **does not touch `config.mjs` at all** (0 lines
  changed); "`--max-tokens` over the window blamed the input" was assigned to `8990173`, where
  `context-guard.mjs` does not read `maxTokens` — it arrived and was fixed later, in `4293726`. Both
  would have scored the reviewer for missing defects that were not in the code it was shown.
- **Co-located defects are dropped, not merged.** Two distinct bugs sit on `config.mjs:119` — a
  credential sent to a foreign origin, and a mistyped `--provider` silently accepted. An anchor match
  cannot tell them apart, so listing both would credit one finding twice.

**11 defects are listed; 8 further claims are recorded as dropped with a reason.** The denominator is
therefore smaller than the truth, which *flatters* recall — stated in the harness's own output every
run, not left to the reader.

### The scorer matches an anchor or a range, and prints everything else

A finding matches when it names the same file **and** either quotes the anchor line
(whitespace-collapsed) or points inside the range. File comparison is a **suffix match on whole path
segments**, because the model answers "config.mjs" for `scripts/lib/config.mjs` — and comparing
segments rather than string ends is what stops `myconfig.mjs` matching. An empty anchor can never
match, since every string contains `''`.

Nothing reads a finding's prose. Matching on summary text would be matching on paraphrase, which is
precisely what this scorer cannot judge — so instead:

- **recall is split by `anchor` versus `range`.** Quoted evidence proves the model read the line; a
  line number inside a five-line window may be proximity.
- **unmatched findings are printed in full and called *unmatched*, never "false positives".** The
  scorer undercounts paraphrase, so the residue holds both real catches it missed and genuine noise.
  Only `docs-only`, which contains no code, turns unmatched into false-positive by construction.
- **cut runs are counted separately.** A run with `analysisCut` or `finishReason: "length"` scores
  recall 0 while never having finished looking; averaging it in blames the reviewer for the harness's
  budget. That is trap instance 14 in arithmetic form.

Findings are not consumed, so one finding may satisfy two defects. That is a known inflation risk,
which is why the corpus avoids co-locating defects — a property of the corpus, not something the code
enforces.

### `--runs N`, defaulting to 1

Six cases at one run each is roughly 4–14 minutes. **The harness says on its own output that a single
pass is a lottery** — OAI-9 measured a 20% hit rate per run, and identical input has produced 1,709
and 5,450 output tokens — so an N=1 score cannot support an A/B conclusion. The flag exists so a real
comparison raises it.

Each case may pin its own `provider` and `model`, so OAI-11's cross-model passes become configuration
rather than a rewrite. LM Studio now serves three chat models; it served one when OAI-11 was written.

Raw per-run records are written to `bench/results/` (gitignored) beside the summary, because **the
summary is an argument, and this repo has already lost one experiment to keeping only conclusions.**

## The first reading

`qwen3.6-35b-a3b-ud-mlx` on LM Studio, 58.1k window, six cases at `--runs 1`, 10.9 minutes of model
time. **This is the baseline every later change is compared against, and it is deliberately recorded
here rather than left in `bench/results/`, which is gitignored.**

| case | prompt tok | out tok | secs | found | cut | note |
|---|---|---|---|---|---|---|
| `config-origin` | 1,575 | 4,144 | 67 | **1/2** | no | the one true positive in the run |
| `caps` | 31,613 | 1,208 | 60 | 0/1 | no | one junk finding (below) |
| `docs-only` | 4,451 | 207 | 6 | — | no | **control: zero findings, correct** |
| `scaffold` | 47,072 | 2,370 | 113 | 0/3 | no | — |
| `model-info` | 41,016 | 7,818 | 217 | 0/2 | **yes** | never finished looking |
| `structured` | 28,610 | 8,186 | 192 | 0/3 | **yes** | never finished looking |

**1 of 11 catalogued defects, at N=1.** Four observations, in descending order of how much they
should change what happens next:

- **Context dilution is real and now measured.** `url-origin-strips-credentials` was **found at 1,575
  prompt tokens and missed at 47,072** — the same defect, the same model, the same afternoon; the
  only difference is that `scaffold` buries `config.mjs` among 24 files. `config-origin` and
  `scaffold` exist as a pair for exactly this comparison, and it is the first thing this instrument
  produced that no anecdote had shown. It also supplies the mechanism behind an old observation: ADR
  005 recorded that every verified true positive so far came from `--file`. This says why.
- **The `analysis` cap bound on 2 of 6 runs, and both reported nothing.** Both were large inputs
  (41k and 28.6k prompt tokens, 7.8k and 8.2k output). ADR 005 measured 2-in-3 on whole-file diffs
  and ADR 004 measured ~1-in-5 on plain ones; this sits between them and confirms the effect tracks
  input size. **A third of this run was wasted**, which is OAI-8's and OAI-9's argument, not this
  ADR's — recorded, not acted on.
- **The anchor scorer earned its keep on the first run.** The model placed its finding at **line 83;
  the defect is at line 90**. A file-plus-line-proximity scorer — the cheapest option the backlog
  listed, and the one a reasonable person would reach for first — would have scored the run's only
  true positive as a miss and reported 0/11.
- **The junk finding is a placeholder, not a hallucination.** `caps` returned
  `{file: "a.js", line: 3, summary: "boom", evidence: "x()"}` — the model filling the schema with a
  toy example rather than inventing a plausible-but-wrong claim about real code. Those are different
  failures needing different fixes, and only the printed residue makes the difference visible.

## Consequences

- **Two structural guards were earned on the way, both from defects the corpus itself caused.**
  (1) `node --test` with no path walks the whole repo, so the corpus's historical `tests/*.test.js`
  were discovered and run against today's tree — a green suite silently running the wrong century.
  The npm script is now scoped, and a test asserts it stays scoped, because the scope reads as
  redundant right up until someone removes it. (2) `tests/structure.test.js` skips `bench/cases` by
  **relative path** rather than by bare directory name, which would skip any `cases/` anywhere.
- **A flag-documentation guard, and a pre-existing gap it found immediately.** Nothing checked that a
  flag the parser accepts is mentioned in its command markdown — the OAI-14 notes claimed
  `plugin.test.js` covered this, and it did not. Adding the check found **`/oai:task` has accepted
  `--system` with no mention of it anywhere in `commands/task.md`**. Pre-existing, now documented.
- **The negative control had to be taught to the loader.** A case with no defects is either the point
  or a half-written mistake, and the two are identical on disk, so the manifest declares
  `control: true`. Rejecting empty cases outright would have thrown out the only clean target — and
  precision needs clean targets as much as recall needs dirty ones.
- **What this measures is narrower than "how good the reviewer is", in four ways**, all printed with
  every run: recall is against listed defects only; unmatched is not false-positive; a cut run is
  missing data, not a zero; and at N=1 the number is a sample. A benchmark that overstated its own
  reach would be the same defect class as the reviewer it exists to measure.
- **The scorer was validated against hand verdicts before any number was published**, which is the
  gate the backlog set. Its wording had to change: the gate said to prototype the scorer "against
  today's five recorded runs", but only the *verdicts* were ever kept, never the model's raw output —
  so the inputs were regenerated live and hand-adjudicated, with the labels still anchored to the
  historical verdicts. Three adjudications on the first run (two defects in `config-origin`, one junk
  finding in `caps`), three agreements. That is a small sample and is stated as one.
- **It does not make the reviewer better, and no claim here says it does.** It makes the next change
  arguable. The two experiments parked in OAI-12 — telling the model its reasoning budget, and
  whether a floor on `analysis` beats a bounded string — stay parked: running them here would use the
  instrument to justify itself.
