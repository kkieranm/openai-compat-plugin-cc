# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

**Current theme: make `/oai:review` trustworthy before extending the plugin further.** Where it
actually stands, stated plainly because it is easy to overrate: OAI-14 removed the largest
false-positive class (3-of-3 → 0-of-3 on the one commit with a baseline), but **no run has yet
produced a verified true positive on a real commit diff.** Precision improved; recall is unmeasured
and unchanged — and it came at a cost: **the `analysis` cap now binds in 2 runs of 3 against ~1 in 5
on diffs, and both capped runs reported nothing**, so the wasted-run rate roughly tripled.

The reviewer is useful once checking its claims costs less than its catches are worth. **The
remaining lever on that ratio is an agreement signal to triage by** (OAI-9).

**OAI-12 has landed, so tuning is no longer guesswork — and its first reading already reorders what
is worth doing.** `npm run bench` scores the shipped command against 11 catalogued defects in six
snapshots of this repo's history and writes a per-run record, ending the era where a conclusion was
kept and its evidence thrown away (ADR 004 says "four runs", `890ee2e` says "five", same experiment,
neither now checkable). Baseline: **1 of 6 scoreable defects at N=1, 10.9 minutes** — 11 are
catalogued, but 5 belong to the two cases whose runs were cut mid-reasoning and are unscored rather
than missed. Two results matter more than that number:

- **Context dilution is measured.** The same defect was **found at 1,575 prompt tokens and missed at
  47,072** — `config-origin` and `scaffold` are the same `config.mjs` bug, alone and buried in 24
  files. That is the mechanism behind ADR 005's observation that every verified true positive so far
  came from `--file`, and it means **narrowing the target may beat any prompt or schema tuning.**
- **The `analysis` cap bound on 2 of 6 runs and both reported nothing** — a third of the run wasted,
  on the two largest inputs, taking **45% of the corpus's defects out of scoring with it**. That is
  OAI-8 and OAI-9's argument restated with numbers, and it is now also a limit on the instrument:
  the cases that get cut are the large ones, which are the ones the dilution result says matter most.

What the bench is *not* is a measure of true recall: the denominator counts only defects that could
be pointed at in the snapshot, which is smaller than what history claims and therefore flatters it.
See [ADR 006](adr/006-benchmarking-the-reviewer.md); the harness prints the same caveats every run.

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
  the reason for deferring it has expired. **And the old justification no longer holds either**: a
  four-minute run that reports nothing *is* a wasted pass, which is the same quantity OAI-9 exists to
  reduce — so this does move the ratio, contrary to what this item said while the wait was unmeasured.
  It sits here only because nobody has re-decided the order. Ask before treating that as settled.
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
