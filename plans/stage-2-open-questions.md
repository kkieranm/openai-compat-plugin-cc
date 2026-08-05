# Stage 2, worked autonomously — the questions I did not ask

Started 2026-08-05, at the user's direction: work Stage 2's remainder end to end, resolve forks with
Codex and pointed subagents rather than by asking, and keep this file as the review artifact.

**How to read this.** Every entry is a fork I resolved without the user. Each says what I decided,
what I would have asked, why I decided it the way I did, and **how to reverse it** — because the
point of the list is that the decisions stay contestable after the fact.

Entries are appended in the order they arose, newest last.

## Standing decisions made at the outset

### S1 — Order of the five workstreams

**Decided:** benchmark first, then templates, then file slices, then pre-submission estimates, then
artifacts.

**Would have asked:** "the plan lists the benchmark last — do you want it first?"

**Why:** the benchmark *is* Stage 2's stated gate ("the artifacts are useful often enough that Claude
verifying them costs less than Claude doing the work"), and the 2026-08-05 six-run evaluation of the
advisor template was that measurement performed by hand. Building it first turns a hand-run into a
repeatable instrument and lets every later template be measured rather than asserted. The alternative
— ship four templates then measure — is what the direction change explicitly moved away from.

**Reversible by:** nothing depends on the order; a later workstream can be pulled forward at any time.

### S2 — Review depth per workstream

**Decided:** scale the review ladder to risk rather than running a full two-pass wide ladder on each
of five items.

**Would have asked:** "a full ladder ran ~1.67M tokens for one feature — do you want that five
times?"

**Why:** the user asked for autonomy and proportion; `lean-wide` is ~two-thirds of any pass's cost and
its trigger is a real condition (a module carrying vendor/protocol assumptions), not a cadence. I
apply the trigger honestly per workstream and record the call here each time.

**Reversible by:** re-running `review-lean --wide` against any commit named below.

### S3 — Bounded use of the user's LM Studio

**Decided:** model runs are bounded to what validates an instrument or a template. **No multi-hour
full-corpus sweep** without the user.

**Would have asked:** "may I spend an evening of your GPU on a full benchmark sweep?"

**Why:** a full sweep is hours of a machine I do not own, and it is the one cost here that is
genuinely theirs rather than mine. Building the instrument does not require running it at scale.

**Reversible by:** `npm run bench:task` (or whatever it lands as) with the corpus flag, when they say
so.

## Entries

### E1 — The task benchmark has an unnamed prerequisite: `/oai:task --json`

**Found by the probe, 2026-08-05.** The plan says "a small task benchmark distinct from the review
benchmark" and says nothing about an envelope. But `bench/run.mjs:58` drives the real CLI as
`['review', ...args, '--json']`, under a stated constraint (`run.mjs:5-7`): *"It drives the real CLI
through `--json`, never a copy of the pipeline… a harness that reimplemented the request would measure
a reimplementation, and report the number as the reviewer's."*

**`/oai:task` has no `--json`.** `TASK_SPEC` (`cmd-task.mjs:15-22`) has no such flag, and
`task-report.mjs:44` writes prose plus a footer to stdout. So a task benchmark either ships that
surface first, parses the prose footer, or reaches past the CLI.

**Would have asked:** "Stage 2's benchmark needs a machine-readable task envelope that nobody filed
as part of it — do you want `/oai:task --json` (which is roughly backlog OAI-57) pulled into this
work, or the benchmark deferred behind it?"

**Decided:** pending Codex consensus (F1) — recorded here before the answer so the question is visible
even if the answer turns out easy. Parsing the prose footer is the class this repo has retracted
twice, so it starts disfavoured.

### E2 — Two premises I was carrying were wrong, and the probe corrected them

Recorded because both were in my own summary to the user earlier, and a later reader should not
inherit them.

1. **There is no recall "band" in the review bench.** `adr/008` says a band was *tried and rejected*:
   printing `0–3/3 (0%–100%)` under a heading saying "defects found" reports defects nobody found.
   What shipped is a separate `unresolved` column plus the band stated **in prose only**
   (`bench/lib/caveats.mjs:59-62`). A task bench must not re-adopt the withdrawn design.
2. **`bench/ttl-challenge.mjs` is already the precedent for a second bench** on a shared chassis —
   reusing `loadCases` and `bench/results/`, replacing scoring wholesale with a pure, unit-tested
   verdict module. I had been treating "distinct from the review benchmark" as unexplored ground.
