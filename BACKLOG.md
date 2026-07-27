# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

**Current theme: make `/oai:review` trustworthy before extending the plugin further.** Where it
actually stands, stated plainly because it is easy to overrate: OAI-14 removed the largest
false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), but **no run has yet
produced a verified true positive on a real commit diff.** Precision improved; recall is unmeasured
and unchanged — and it came at a cost: **the `analysis` cap now binds in 2 runs of 3 against ~1 in 5
on diffs, and both capped runs reported nothing**, so the wasted-run rate roughly tripled.

The reviewer is useful once checking its claims costs less than its catches are worth. **The
remaining lever on that ratio is an agreement signal to triage by** (OAI-9) — but tuning before
OAI-12 lands is guesswork, and OAI-14 is the argument: it shipped as half the design it was planned
as, because measuring the threshold showed the other half would never trigger and would drop the
wrong file when it did. Every reviewer decision before that rested on hand-verified anecdotes, and
OAI-10 got three cap values wrong in one afternoon for the same reason.

**OAI-8 may deserve to move up now, and that is a decision, not an oversight.** Its item said the
wait was a moving target until the context work settled. It has settled: whole-file reviews measured
38–245s against 7–27s for diff-only, 4–10× worse, and the `analysis` cap now binds in 2 runs of 3.
It still moves neither half of the useful-output ratio, so it stays where it is until asked.

> **Discharged 2026-07-27:** the owed built-in `/code-review high` ran over `structured.mjs`,
> `client.mjs` and `cmd-review.mjs` (`c552bcd..HEAD`), covering OAI-4 and OAI-10 in one pass —
> 25 agents, 1.07M tokens, no deaths. Ten findings: **5 confirmed and fixed**, 5 vendor-dependent
> and parked as **OAI-13**. The new-module trigger earned its keep: the two most severe (a cut
> review rendering as a clean pass; a 12k-token input-budget regression) were both in exactly the
> vendor-assumption code the trigger targets, and neither `advisor` nor the lean workflow caught
> them across four and two passes respectively.

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
  reasons for thousands of tokens before emitting anything at all. **OAI-14 has now landed and the
  wait is measured: 38–245s for a whole-file review against 7–27s diff-only, 4–10× worse, with a
  245s run that then reported nothing.** That was the "moving target" this item was waiting on, so
  the reason for deferring it has expired; it stays here only because it still moves neither half of
  the useful-output ratio. Worth reopening the ordering rather than leaving it settled by default.
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
