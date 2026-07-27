# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

**Current theme: make `/oai:review` trustworthy before extending the plugin further.** Where it
actually stands, stated plainly because it is easy to overrate: **every verified true positive so far
has come from a whole file, and real commit diffs have produced none across ~6 runs.** The order
below follows from that — fix the context we hand the model (OAI-14), then build the measurement that
lets any further change be judged (OAI-12), then the levers that move the hit rate (OAI-9, OAI-11),
and only then ergonomics and infrastructure.

The reviewer is useful once checking its claims costs less than its catches are worth. Today that is
roughly one real defect per five runs against two or three false positives per run, so checking
dominates. Only two things move that ratio: **fewer false positives** (OAI-14, which removes a class
our own harness creates) and **an agreement signal to triage by** (OAI-9). OAI-8 is real ergonomic
pain and moves neither — it is ordered after them deliberately.

Tuning before OAI-12 lands is guesswork; every reviewer decision so far rests on hand-verified
anecdotes, and OAI-10 got three cap values wrong in one afternoon for exactly that reason. OAI-10 did
close the first of the five wasted-run modes (the runaway); the remaining four are quality.

> **Discharged 2026-07-27:** the owed built-in `/code-review high` ran over `structured.mjs`,
> `client.mjs` and `cmd-review.mjs` (`c552bcd..HEAD`), covering OAI-4 and OAI-10 in one pass —
> 25 agents, 1.07M tokens, no deaths. Ten findings: **5 confirmed and fixed**, 5 vendor-dependent
> and parked as **OAI-13**. The new-module trigger earned its keep: the two most severe (a cut
> review rendering as a clean pass; a 12k-token input-budget regression) were both in exactly the
> vendor-assumption code the trigger targets, and neither `advisor` nor the lean workflow caught
> them across four and two passes respectively.

- **OAI-14** — Review whole changed files, not bare diff hunks. **The largest observed false-positive
  class is caused by our own harness, not by the model.** On `--commit 1ea398f` the reviewer reported
  "`positiveInteger` is not defined or imported" in three separate runs. It is defined at
  `model-info.mjs:48`; the diff carried only the call site at line 235. The model reasoned correctly
  from what it was given, and `REVIEW_SYSTEM_PROMPT` tells it never to speculate about code it was
  not shown — then we show it a file with the definitions cut out. Any identifier defined outside the
  changed hunks is a standing invitation to this error.
  The evidence also runs the other way: **every verified true positive so far came from `--file`,
  which sends whole files** (credentials stripped by `url.origin`; the dropped query string). Real
  diffs have produced zero verified catches across ~6 runs. So this moves real reviews into the only
  configuration that has ever worked.
  Shape: send each changed file whole, plus the diff so the model knows what actually changed —
  `readFileBlocks` in `prompt.mjs` already does the file half and `--file` already proves the path.
  Details that need deciding, not guessing:
  - **Which revision's content.** `--commit <ref>` must send the file *at that ref*, not the working
    tree; `--base` sends HEAD; `--staged` sends the staged blob. Getting this wrong reviews code that
    was never in the change.
  - **Deleted files** have no current content, and renames need the new path. Both fall back to the
    diff alone.
  - **Size.** Whole files are much larger than hunks, and this is the item most likely to hit the
    context guard. Needs a stated policy when they will not fit — fall back to diff-only and *say so
    on stderr*, never silently, since a silent fallback would reintroduce exactly the defect this
    item removes while reporting that it was fixed.
  - **Scope of the ask, and this is the real fork.** Given a whole file the model will find defects in
    code the change never touched. For "review my diff" that is noise; for "review this code" it is
    the point. Decide whether unchanged-code findings are dropped, or kept and labelled pre-existing.
    Labelling is probably better — a real bug is worth knowing about — but it must not be counted
    against the diff.
  **Measure it, do not assume it.** This is a context change of exactly the kind OAI-12 exists to
  judge, so the corpus should carry whole-file and diff-only variants of the same commits. Shipping
  it unmeasured would repeat the mistake OAI-10 made three times over.
- **OAI-12** — A labelled corpus and a benchmark harness, so reviewer changes stop being anecdotes.
  Every tuning decision so far (schema shape, temperature, budget) rested on one hand-extracted file
  and findings I verified by reading later commits. That does not scale and is not repeatable.
  **The ground truth already exists in this repo's history**: each defect a review confirmed and a
  later commit fixed is a labelled example — file at commit X contains defect Y, fixed in Z. Seeds
  available today: `config.mjs@8990173` (credentials stripped by `url.origin`; query string dropped —
  both fixed later), the ten findings from the OAI-1 `high` review fixed in `7d3a1a4`, and the OAI-2
  round fixed in `1ea398f`. Include **negative controls** — `25e1fcd` is documentation-only and the
  model correctly reported nothing there — because precision needs clean targets as much as recall
  needs dirty ones.
  Store as committed snapshots under `bench/` with a manifest, not `git show` at runtime: the corpus
  must survive a rebase and stay byte-stable, or scores drift for reasons that have nothing to do
  with the reviewer.
  **Constraint: this cannot live in `npm test`.** The suite is network-free by contract and the
  fake server exists precisely so it stays that way; a benchmark needs a real model and is
  non-deterministic besides. Separate opt-in entry point (`npm run bench`), skipped by default,
  reporting recall against known defects, false positives per run, tokens and wall clock.
  **The hard part is scoring** — deciding whether a free-text finding "is" a known defect. Options:
  match on file plus line proximity (cheap, brittle), keyword match on the defect's signature (cheap,
  gameable), or a stronger model as judge (accurate, costs API budget, and needs its own sanity
  check). Prototype the scorer against today's five recorded runs before building anything on top of
  it; if the scorer cannot reproduce the verdicts I reached by hand, it is not measuring the right
  thing.
  **Two experiments deferred here from OAI-10**, both one-line changes whose entire cost is measuring
  them. (1) A sentence in the prompt telling the model its reasoning budget: it cut a run from ~6,000
  to 1,333 output tokens and 88s to 22.7s, but that is steering the reviewer to reason *less*, and
  reasoning less is what made it useless before ADR 003 — worth real money if it costs no recall,
  worth nothing if it does. **Re-derive that effect against the shipped string schema before
  believing it**: the run it came from also used the array-of-steps shape ADR 004 went on to reject,
  so as measured it confounds the sentence with a schema that no longer exists. Two variables, one
  number. (2) Whether a floor on `analysis` (a `minLength`, or the bounded list of
  reasoning steps ADR 004 rejected) beats the plain bounded string. (3) Whether raising
  `REVIEW_MAX_TOKENS` — now safe, since the schema is bounded and cannot run away into the extra
  room — and widening the caps to match buys anything. The half-window rule allows 29,056 on the 58k
  machine, about double today's reserve.
- **OAI-9** — Multi-pass review with a deduplicated union, because a single pass is a lottery.
  Measured on one 135-line file with two known defects (`config.mjs` at `8990173`, both fixed later):
  five runs of the same command produced 1 real defect, 3 false positives, 2 empty results and 1
  budget failure — a **20% hit rate per run**, with output varying 1,709→5,450 tokens for identical
  input and quality tracking that spend. Independent passes are the lever: each costs ~40–90s and
  nothing else, and unioning three or four would have caught both real defects instead of gambling on
  one. Same shape as the loop-until-dry pattern. Needs: N passes (default 3?), dedupe on
  file+line+claim, and a count of how many passes reported each finding — agreement across
  independent passes is itself a confidence signal worth showing, since it is the closest thing to a
  free verifier. Decide whether passes run concurrently (one local model, so probably not) and how
  this interacts with OAI-8's progress reporting, which it makes far more necessary.
- **OAI-11** — Diverse passes: different models, and different lenses. **OAI-9 decorrelates sampling
  noise; this decorrelates blind spots**, which is the more valuable axis — repeated samples of one
  model share its failure modes, so agreement between them says much less than agreement between two
  models trained differently. That makes cross-model agreement a genuinely strong confidence signal
  where cross-sample agreement is only a weak one.
  Three ways to get diversity, cheapest first: different **lenses** on the same model (one pass for
  correctness, one for security, one for edge cases) — free, and available today with one model
  loaded; different **models on different providers**, which is exactly what ADR 001's
  providers-as-data buys us, and the case where passes can genuinely run concurrently; different
  models on **one** provider, which on LM Studio means paying a JIT load between passes and is
  probably the worst of the three.
  Build OAI-9 so a pass carries its own `{provider, model, lens}` rather than inheriting one global
  target — then this is a config change, not a rewrite. Open question worth an experiment before
  committing: whether three lenses on one model beats three plain passes, since that would deliver
  most of the value with no second model to install.
- **OAI-8** — Liveness for a run in progress: while a review or task is waiting, there is no way to
  tell slow from stuck. Today the user gets one stderr line and then silence — measured waits on the
  author's machine were 26s, 32s, 59s and 99s for the *same* command, and a loop of four reviews hit
  a 10-minute limit having printed nothing at all. Wants at minimum an elapsed-time heartbeat on
  stderr, ideally a token-rate figure and an estimate, so a stall is distinguishable from work.
  Overlaps **OAI-6** (streaming) — streaming would supply the signal for free on servers that
  support it, so decide whether this is a fallback for non-streaming servers or a separate progress
  line that works either way. Note the wait grew with OAI-4: the `analysis` field means the model now
  reasons for thousands of tokens before emitting anything at all. **Ordered here, not first**: it is
  the most-felt pain but it moves neither half of the useful-output ratio, and OAI-14 makes runs
  bigger — so the wait it addresses is a moving target until the context work settles.
- **OAI-6** — Streaming output for `/oai:task`, so a slow local model shows progress rather than
  sitting silent behind a single stderr line.
- **OAI-3** — Background jobs: `--background`, plus `/oai:status`, `/oai:result`, `/oai:cancel`.
  Port the reference plugin's generic job model (per-workspace state dir, light index + per-job
  record, detached self re-exec worker); replace its RPC interrupt with an `AbortController`.
- **OAI-5** — A delegation subagent (`/oai:rescue` + a thin forwarding agent) so a long local-model
  run does not consume the main session's context.
- **OAI-7** — Publish: README install instructions, and verify the marketplace path
  (`claude plugin marketplace add`) actually resolves this repo once it has a remote.
- **OAI-13** — The five PLAUSIBLE findings from the OAI-4/OAI-10 built-in review, all vendor-
  dependent and none reproducible against LM Studio. They need a second server to settle, so they
  wait for one rather than being fixed blind. (1) `isFormatRejection` reads `error.message`, which
  `client.mjs` truncates to 400 characters — a server whose validation dump names `response_format`
  later never triggers the degrade path, and `/oai:review` dies on a raw 400 instead. (2) The same
  matcher fires on *any* 400 whose body echoes the request, asserting "rejected response_format"
  as a cause it only guessed. (3) `parseFindings` picks a channel before parsing and never falls
  back, so one stray non-whitespace character in `content` discards a schema-valid payload sitting
  in `reasoning`. (4) With the window unknown, `reserveFor` still puts `max_tokens: 16384` on the
  wire, where `/oai:task` sends none — a server that rejects an oversized `max_tokens` fails for a
  reason the plugin chose. (5) On the degraded path a bare findings *array* is discarded, though the
  adjacent comment promises repair. Fixing (1) and (2) properly probably means the server's status
  or error `type`/`code` field rather than prose, which is an ADR 002 shape-not-name question and
  the reason this is one item rather than five.
