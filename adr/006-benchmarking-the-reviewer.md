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
| `scaffold` | `8990173` | `--commit` | the same two defects buried in 14 code files — the pair varies mode *and* framing *and* size together, so it isolates none of them (see below) |
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
- **cut runs are counted separately.** ~~A run with `analysisCut` or `finishReason: "length"` scores
  recall 0 while never having finished looking; averaging it in blames the reviewer for the harness's
  budget.~~ **Revised 2026-07-28 by OAI-15.** Half right: averaging a cut run in as a zero does blame
  the reviewer for the budget, but *excluding* it discards findings that are perfectly good — the cut
  lands on `analysis`, which the schema orders first, so the model still emits its findings normally.
  Discarding them cost 17 of 41 recorded runs and two of the four anchored matches ever produced.
  A cut run's **positives count and its absences are unknown**, so recall is now reported as a band
  that collapses to a single number wherever nothing was censored. `finishReason: "length"` is a
  separate predicate now — that reply never parsed and has nothing in it to score. See ADR 008.

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
| `model-info` | 41,016 | 7,818 | 217 | n/a (2) | **yes** | never finished looking |
| `structured` | 28,610 | 8,186 | 192 | n/a (3) | **yes** | never finished looking |

**1 of 6 scoreable defects, at N=1** — 11 are catalogued, but 5 belong to the two cases whose runs
were cut and are therefore unscored rather than missed. Counting them as zeroes would charge the
reviewer for the token budget, so they show as n/a. Four observations, in descending order of how
much they should change what happens next:

- ~~**Context dilution is real and now measured.**~~ **Retracted the next day; see "The three-arm
  correction" below.** What this section originally claimed — `url-origin-strips-credentials`
  **found at 1,575 prompt tokens and missed at 47,072**, therefore dilution — was one run per arm
  across three variables that move together, and the sentence "the only difference is that `scaffold`
  buries `config.mjs` among 24 files" was simply false: `config-origin` is mode `file`, which
  `git-diff.mjs` short-circuits into a different code path with no diff and no ladder. The claim is
  left visible rather than deleted because it is the exact error this ADR's own no-guessing rule
  exists to catch, and it got into the ADR anyway.
- **The `analysis` cap bound on 2 of 6 runs, and both reported nothing.** Both were large inputs
  (41k and 28.6k prompt tokens, 7.8k and 8.2k output). ADR 005 measured 2-in-3 on whole-file diffs
  and ADR 004 measured ~1-in-5 on plain ones; this sits between them. **A third of this run was
  wasted**, which is OAI-8's and OAI-9's argument, not this ADR's — recorded, not acted on. It also
  costs more than a third of the *evidence*: those two cases hold 5 of the 11 catalogued defects, so
  **45% of the corpus went unscored**. ~~and the cases that get cut are the large ones~~ — **that
  inference was wrong, and inverted.** Both cut runs here happened to be large, so this section read
  a correlation off n=2; the three-arm run below cut the corpus's *smallest* input, 1,575 tokens,
  three times out of three. Cutting tracks how long the model chooses to reason, and a small focused
  target makes it reason **more**, not less.
- **The anchor scorer earned its keep on the first run.** The model placed its finding at **line 83;
  the defect is at line 90**. A file-plus-line-proximity scorer — the cheapest option the backlog
  listed, and the one a reasonable person would reach for first — would have scored the run's only
  true positive as a miss and reported 0/11.
- **The junk finding is a placeholder, not a hallucination.** `caps` returned
  `{file: "a.js", line: 3, summary: "boom", evidence: "x()"}` — the model filling the schema with a
  toy example rather than inventing a plausible-but-wrong claim about real code. Those are different
  failures needing different fixes, and only the printed residue makes the difference visible.

## The three-arm correction

**The first reading's headline result did not survive its first test, and the instrument is what
killed it.** That is the instrument working — but it is worth being exact about how the error was
made, because it was made *inside* a document whose central rule is "a defect is listed only if it
can be pointed at."

The claim was that dilution costs recall, evidenced by `config-origin` (1,575 tokens, found) against
`scaffold` (47,072 tokens, missed). Those two cases differ in **token count, git mode, prompt shape
and defect count** — `git-diff.mjs:199-202` returns early for `--file`, so that arm has no diff, no
droppable `changed` list and never touches the two-rung ladder. One run per arm across four moving
variables is not a measurement, and the corpus manifest asserted the pair "measures whether context
dilution costs recall" as though it were designed to isolate one.

Three arms, N=3 each, on 2026-07-28, `qwen3.6-35b-a3b-ud-mlx`. Arm B is the discriminator: same
case, same mode, same files, roughly half the tokens.

| arm | command | prompt tok | cut | shared defects, uncut runs | findings per run |
|---|---|---|---|---|---|
| A | `--case scaffold` | 47,069 | 1/3 | 1/4 | 6, 0, 1 |
| B | `--case scaffold --diff-only` | 25,563 | 0/3 | 0/6 | 0, 0, 0 |
| C | `--case config-origin` | 1,575 | **3/3** | n/a — nothing scoreable | 0, 0, 1 |

Scored on the two `config.mjs` defects common to both cases; `scaffold`'s third defect is not in
`config-origin`'s denominator, so a raw recall comparison would compare different denominators.

- **No dilution effect.** Halving the tokens on the same target (B) produced **zero findings in
  three runs** — not one, matched or unmatched. The largest arm produced the only clean anchored
  match. Nothing here is monotone in prompt size.
- **B cuts tokens by removing content**, so it cannot separate "fewer tokens" from "less
  information"; it is the OAI-14 effect seen from the other side. What it does refute is the simple
  form of the claim, that a smaller prompt buys recall.
- **The cap bound on the smallest input in the corpus, 3 of 3**, at 7,367–9,440 completion tokens
  against `scaffold`'s 3,552 on thirty times the input. This is the finding that reorders the
  backlog, and it is unconfounded: **6 of 15 runs ever recorded here never finished looking.** It is
  also the experiment ADR 004 explicitly parked for this instrument rather than a reversal of it —
  that ADR states the cap's stated criterion "is not actually met, and cannot be", and names raising
  the reserve as the only lever. The claim that *is* false is `structured.mjs:20-21`, whose comment
  says the caps are "sized above every successful run observed, so a healthy pass never reaches
  them" — contradicting its own ADR, which is this repo's signature class expressed in a comment.
- **A cut run is not always a silent run.** Arm C run 3 was cut *and* returned a correct anchored
  finding; arm A run 2 was cut and returned nothing. So `analysisCut ⇒ unscoreable` was discarding
  real data. **Settled by OAI-15 on 2026-07-28**, and the corpus-wide figure is larger than this
  paragraph guessed: 6 of 17 cut runs emitted findings, 2 of them anchored matches — the same number
  the 24 uncut runs produced. Sizing the cap and deciding what a cut run contributes were indeed the
  same question; see ADR 008 for both answers.

**What was almost built on this.** The refuted claim had already been promoted to a proposed
reordering of the backlog — a partition-and-union feature justified entirely by dilution. It was
also nearly rescued by a second bad inference: that arm A run 3 and arm C run 3 found *different*
defects, so a union would score 2/2. Those are two single runs in **different modes** — the same
cross-arm reasoning error, reappearing one paragraph after it was diagnosed. Within either arm, no
two uncut passes found different defects. The union hypothesis (OAI-9) remains untested.

**The instrumentation this exposed as missing.** `--json` recorded `analysisCut` as a boolean and
never the length, so the distribution the cap truncates was unobservable, and `completion_tokens` is
not a substitute — it bundles reasoning with the findings payload, and on measured runs the
orderings cross (an uncut run at 7,576 sits above a cut one at 7,367). `analysisLength` and
`analysisCap` are now in the JSON for exactly this.

## Correction, 2026-07-29 (OAI-18)

Two claims this ADR rests on were wrong, and both are fixed rather than merely noted.

**The corpus was not a fixed target.** `materialize()` builds a throwaway repo per run and
`--commit HEAD` sends `git show HEAD`, whose first three lines carry the commit sha and date — so two
runs of the "same" case sent different bytes whenever they fell in different clock seconds, which in
a real bench is always. The case commit's identity is now pinned, and a test asserts the pinned date
is in force rather than merely that two materializations agree (agreement alone passes against the
defect, because inside one second the old code agreed too).

**The `seconds` column measured two things at once and is gone**, replaced by `prefill s` and
`generate s`. A server-side prompt cache moves prefill by ~37× and leaves generation alone, so a
range across `--runs 3` was one cold run and two cache hits reported as a spread. Any `seconds`
figure quoted from this ADR or from a report predating the change carries that confound — and
**`--diff-only` figures specifically are not comparable across the change**, because the drifting sha
was accidentally busting the cache for that mode alone. See
[ADR 009](009-measuring-prefill-and-generation.md).

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
- **The lean review found six defects in this feature, and three were the signature class — inside
  the module written to prevent it.** Recorded because the pattern is the point, not the fixes:
  (1) `--json` omitted the context-budget caveat the text footer has always shown, so a caller could
  not tell an unverified token estimate from a checked one — in `review-report.mjs`, whose docstring
  promises "every caveat the text report carries appears here too", and whose whole reason to exist
  is that both renderings sit together. **Instance 16.** (2) A run that answered unreadably fell out
  of every bucket at once — not scored, not cut, not failed — while still counting toward the run
  total, so a row asserted full accounting over runs it had dropped; the null-vs-false collapse that
  caused it came from `jsonReport` correctly emitting `null` for "not determined" and `report.mjs`
  reading that null as false. (3) A failed run recorded the *last* stderr line, which is a
  `UserError`'s hint, so the report showed "Raise `--max-tokens`" as the reason a run failed while
  "ran out of tokens" was discarded — the remedy printed as the diagnosis, in the field whose comment
  calls itself the evidence the harness exists to keep. The other three were ordinary correctness:
  `materialize` outside its own `try`, killing a whole run and leaking a temp repo; `dropped`
  consumed unconditionally by the report but never validated by the loader, crashing the render with
  a raw `TypeError` after all model time was spent and before the records were written; and cut runs
  entering the recall denominator as zeroes despite this ADR claiming they were counted separately —
  **which is why the published baseline is 1 of 6 scoreable and not 1 of 11.**
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

## The two-arm attempt, 2026-07-30 (OAI-19) — blocked, and what it measured anyway

OAI-19 was designed to replace the struck pre-OAI-15 baseline with two comparable arms — dense
`qwen/qwen3.6-27b` against MoE `qwen/qwen3.6-35b-a3b` (the `-ud-mlx` quant the old baseline ran is
no longer served), full corpus, `--runs 3 --cold --max-seconds 1800`, one predeclared retry per
arm with **every invocation reported**, and an acceptance gate of every case `scored=3` with no
failed, truncated, unreadable or substituted runs. The gate and bounded-retry rule exist to avoid
outcome-conditioned sampling: re-running until clean would bias reliability, timing and recall
toward completions, so a failed attempt stays in the record beside its retry.

**Neither arm ever passed the gate, so no arm is published as the measurement.** Four full-corpus
invocations: dense failed 5/18 then 6/18 runs; MoE 10/18 then 6/18 — **27 of 72 (37.5%), all
server-side**, every one either an empty completion (`finish_reason: unknown`, no message content)
or a stream drop mid-reasoning (~50k chars in). Zero runs ended on the wall-clock cap; zero were
answered by a substitute model. Between the dense attempts the server wedged outright — model stuck
`GENERATING`, a trivial request receiving 0 bytes in 90 s — and needed a manual `lms unload`; that
retry was aborted before any record landed and relaunched against a verified-healthy server, which
is recorded in the arm log rather than silently discarded. Both models fail the same way, so the
locus is server-side — though the mechanism inside the LM Studio serving path is unresolved, and
"sustained load" is the observed correlate, not an established cause. The fix is filed as OAI-20
(client-side classification of the two failure shapes and bounded per-attempt retries inside one
invocation — arm-level re-runs re-pay every surviving `--cold` prefill, which this attempt proved
twice).

Bounded observations from the scored runs — quotable, but none of them the baseline: the dense
model anchored two `scaffold` defects on the commit diff — *different* ones, one per attempt
(`credential-inherited-across-origin` in attempt 1, `url-origin-strips-credentials` in attempt 2),
each in one scored run of three, neither replicated in the other attempt. They are **not the
benchmark's first anchored commit-diff matches**: `2026-07-28T07-57-15-522Z.json` records the same
defect anchored on the same case in commit mode by the old MoE quant two days earlier, one of four
anchored matches predating this attempt; the OAI-15 ceiling still binds for the
dense model on the largest cases (`scaffold` cut 2/3 then 3/3) while `structured` — 4/4 cut under
the old ceiling — was never cut in a dense scored run, though that comparison is confounded by the
dense window sending `structured` down the diff-only rung (see ADR 008's 2026-07-30 section); and
the MoE generates ~4× faster (~50–78 vs 13–17 tok/s, full arm ~25 min vs ~3 h) but produced only
one range match (`anchored=0`) across its **20 scored runs** — the denominator is scored runs, not
the 36 attempted: 16 failed server-side, and a failed run is missing data, not an observed miss.
Raw records:
`bench/results/2026-07-30T{10-37-25-889,13-41-30-372,14-06-27-605,14-42-10-361}Z.json`, rendered
reports beside them as `2026-07-30-oai19-arm-{dense,moe}.log` (gitignored — this section is the
kept summary).
