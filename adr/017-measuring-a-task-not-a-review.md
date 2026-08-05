# 017 — Measuring a task, when the answer is prose

Date: 2026-08-05. Status: accepted. Builds on [ADR 016](016-a-template-is-three-things.md).

## The problem

Stage 2 of `plans/local-llms-like-codex.md` asks for "a small task benchmark distinct from the review
benchmark", to answer its gate: **the artifacts are useful often enough that Claude verifying them
costs less than Claude doing the work.**

The review benchmark cannot be reused, and the reason is structural rather than convenient.
`bench/lib/score.mjs` states its own rule — *"Nothing here reads a finding's prose"* — and matches a
finding to a defect by a quoted anchor line or a line range. A task answer has no anchor. It is three
prose sections.

## What was built

Four pieces, in the order they had to come.

### `/oai:task --json`, because the alternative was a retracted class

`bench/run.mjs` drives the real CLI through `--json` under a stated constraint: *"a harness that
reimplemented the request would measure a reimplementation, and report the number as the reviewer's."*
`/oai:task` had no such surface, so the bench would have had to parse the prose footer — the
"server prose as protocol" pattern this repo has retracted twice.

Importing `executeTask` directly was rejected for a sharper reason: it bypasses `cmd-task.mjs`'s
*admissibility* decisions — argument handling, the background split, the substitution notice, the
empty-answer refusal — and so would measure a lower-level component while claiming to measure the
command.

The reply stays an **opaque string**. ADR 016 is explicit that a template asks for its shape in prose
and nothing parses it; structuring the transport does not change that, and the envelope carries no
field claiming the reply conformed. It does carry `notes`, because a rendering that dropped the
template's caveats would be instance 16 on a new path.

### Graded markers, and what they are not

Each case declares markers grouped by what naming them **demonstrates** — `site`, `mechanism`,
`remedy` — and the score keeps the group vector rather than collapsing it. That reproduces ADR 016's
zsh result exactly: site hit, experiment hit, mechanism wrong.

`contradicted` ranks **below** `missed`, deliberately. An answer asserting the wrong mechanism costs a
reader more than one that says nothing, because it has to be disproved.

An LLM judge was rejected: correlated misconceptions, rubric drift, and it would likely have smoothed
that wrong-mechanism answer into "mostly correct" — losing the most informative thing about it.

`MARKER_LIMITS` ships **in the module** and every report prints it. A marker match shows the answer
named something, never that it understood it; a miss is not proof of absence, so the scorer
undercounts in the same direction as anchor matching and for the same reason.

### The executable witness, in place of anchor-liveness

The review corpus tests that every anchor is real code. A prose corpus structurally cannot. Its
replacement: each case carries `before/` and `after/` trees and a **witness** that must FAIL against
the first and PASS against the second, proved by `tests/task-corpus.test.js` on every run. A case
whose witness does not separate them is not evidence, however good its prose. A commit reference or a
human description is not the equivalent of a live anchor.

The loader also refuses any prompt containing a marker it will be scored on — otherwise the case
measures its own prompt.

### Framing as a paired dimension, never a flag

ADR 016 found framing to be the dominant variable. So both prompts run for every case, the report
shows them as separate rows and **never averages them**, and a single-arm sweep prints INCOMPLETE in
its own heading rather than looking finished.

Arm order **alternates across repetitions**, which is not tidiness: both arms send a nearly identical
prefix, and ADR 009 measured 421.7s cold against 11.5s warm on the same prefix here. A fixed order
would bill one arm the cold prefill every time and report the difference as a property of the framing.

## The correction that matters most

**A marker profile is not the Stage 2 gate, and calling it one would be wrong.**

The gate is economic. Marker scoring answers "did the local model emit useful evidence?" It does not
answer "did verifying cost less than doing?" Satisfying the gate needs a **paired arm** — an assisted
run where Claude verifies the artifact against the fixture, and a control run where Claude gets the
same files and question with no artifact — with two riders: if Claude rejects the artifact and redoes
the work, assisted cost is verification *plus* redo; and if Claude **accepts a wrong artifact, that is
a gate failure, not cheap verification**.

That arm is designed and not built. It costs real tokens per case per arm, and spending them at corpus
scale is the user's call.

## The one template whose answer a machine can judge

`patch` is the exception to all of the above. `git apply --check` settles whether a diff applies
without reading a word, which is why the template asks for a diff and nothing else — the shape request
and the oracle are one requirement stated twice.

Three states, never a boolean: `applies` / `rejected` / `absent`. Collapsing the last two would let a
template that emitted prose read as one that emitted a broken patch. And the note refuses to let
`applies` imply `correct` — a clean application is no evidence the change is right, which is instance
14's shape. Nothing is ever applied.

## First measurement

One case, both arms, `qwen/qwen3.6-35b-a3b`: **neutral `missed`, pointed `exact`** — ADR 016's hand
grade, produced automatically. It counts for something only because the scorer was written from those
transcripts *before* the run, and its unit fixtures are the real replies: an instrument tuned until it
agreed would prove nothing.

One case, one repetition, one model. The direction is established; the magnitude is not.

## Known limits

- The corpus has **one** case. A second (the zsh word-splitting defect) has an executable witness
  available — comparing argv across shells — and was not built for time.
- No paired economic arm, so the gate is unmeasured.
- `bench/task-run.mjs` has no npm script, deliberately: `package.json`'s test scope is load-bearing and
  asserted by a structural test, and sibling scripts invite careless edits to that line.
