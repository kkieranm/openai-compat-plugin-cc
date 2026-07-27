# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

> **Owed:** one built-in `/code-review high` over OAI-4's vendor-facing modules
> (`scripts/lib/structured.mjs`, `client.mjs`, `cmd-review.mjs`). The new-module trigger fired —
> `structured.mjs` carries `response_format` and `reasoning_content` assumptions — but the five-hour
> window was at 73% when the feature landed, and a run that dies half way costs full price for
> partial coverage. Run it at the start of a fresh window.

- **OAI-3** — Background jobs: `--background`, plus `/oai:status`, `/oai:result`, `/oai:cancel`.
  Port the reference plugin's generic job model (per-workspace state dir, light index + per-job
  record, detached self re-exec worker); replace its RPC interrupt with an `AbortController`.
- **OAI-8** — Liveness for a run in progress: while a review or task is waiting, there is no way to
  tell slow from stuck. Today the user gets one stderr line and then silence — measured waits on the
  author's machine were 26s, 32s, 59s and 99s for the *same* command, and a loop of four reviews hit
  a 10-minute limit having printed nothing at all. Wants at minimum an elapsed-time heartbeat on
  stderr, ideally a token-rate figure and an estimate, so a stall is distinguishable from work.
  Overlaps **OAI-6** (streaming) — streaming would supply the signal for free on servers that
  support it, so decide whether this is a fallback for non-streaming servers or a separate progress
  line that works either way. Note the wait grew with OAI-4: the `analysis` field means the model now
  reasons for thousands of tokens before emitting anything at all.
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
- **OAI-10** — Bound the reasoning, and give it room. `REVIEW_MAX_TOKENS` is 16,384 and a 135-line
  file still blew it: the `analysis` field rambles without limit, and a run that overruns returns
  nothing at all (the guard reports it correctly, but the whole pass is wasted). Two halves: cap the
  analysis in the prompt — a word or section budget, so it stays a reasoning aid rather than an essay
  — and raise the ceiling, remembering the reserve is capped at half the window, so on the 58k
  machine anything above ~29k is unreachable. Worth measuring what analysis length actually
  correlates with finding real defects before picking numbers; the run that found the credential bug
  used ~6k, the run that found the query-parameter bug 5,450, and the empty runs ~2.3k.
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
- **OAI-5** — A delegation subagent (`/oai:rescue` + a thin forwarding agent) so a long local-model
  run does not consume the main session's context.
- **OAI-6** — Streaming output for `/oai:task`, so a slow local model shows progress rather than
  sitting silent behind a single stderr line.
- **OAI-7** — Publish: README install instructions, and verify the marketplace path
  (`claude plugin marketplace add`) actually resolves this repo once it has a remote.
