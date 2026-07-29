# ADR 009 — Measure prefill and generation separately, and pin the corpus commit

**Date:** 2026-07-29
**Status:** accepted
**Supersedes in part:** the `seconds` column described in [ADR 006](006-benchmarking-the-reviewer.md)

## The problem

`npm run bench --runs 3` reported one number per run — `durationMs`, total wall clock — and printed
its min–max as a `seconds` column. That number is two quantities added together, and a server-side
prompt cache treats them completely differently.

Measured 2026-07-29 against LM Studio serving `qwen/qwen3.6-27b`, one prompt of 56,805 tokens, three
consecutive streamed requests with no other change:

| run | time to first token | total | generation |
|---|---|---|---|
| cold | **421,660 ms** | 424.6 s | ~3.0 s |
| warm | 11,457 ms | 14.2 s | ~2.7 s |
| warm | 10,257 ms | 13.0 s | ~2.7 s |

**36.8× on prefill; ~1× on generation.** Cold prefill computes to 135 tok/s, which independently
reproduces the 132 tok/s recorded in `client.mjs` from an unrelated probe during OAI-6.

So `--runs 3` measured run 1 cold and runs 2–3 warm, and a `seconds` range of `13–425` described
nothing anyone would want to know. Worse, it flattered every repeat: the second run of a case is
doing materially less work than the first while appearing in the same table cell.

## What the probe established, including one thing that changed the plan

- **Cache state cannot be read off the reply.** LM Studio's `usage` carries no `cached_tokens` and
  its `stats` object is empty. Nothing in an OpenAI-compatible response says "this was a cache hit".
- **Labelling runs by position does not work**, which was the option the backlog item proposed.
  A *first* call in a fresh process came back warm at 956 ms because an earlier process had prefilled
  the same prefix. Run 1 of a case is cold only if nothing warmed it earlier that day, and nothing
  observable says whether that happened.
- **The measurement already existed and was thrown away.** `progress.mjs` stamps the first-token
  moment for the stderr heartbeat's tok/s figure and never returns it.
- **The benchmark was not sending the same bytes twice.** Found by a Codex check of the plan's
  premises, and confirmed directly. `materialize()` builds a fresh repo per run, and `--commit HEAD`
  puts `git show HEAD` in the prompt — whose first three lines are the commit sha, the author and the
  date. Two runs falling in different clock seconds therefore got different shas. Back-to-back inside
  one second the output is byte-identical, 1.5 s apart it is not, which is exactly why this survived
  unnoticed: a test reproduces the good case and a real bench always reproduces the bad one.

That last point interacts with the cache in a way nobody had accounted for. `buildMessages` puts file
blocks first and the prompt — ending with the diff — last. In whole-file mode the three varying lines
sit at the tail, so the file bulk still cached; in **`--diff-only` mode there are no file blocks at
all**, so the varying sha landed within the first few hundred characters and effectively nothing
cached. The two arms of the benchmark had systematically different cache behaviour, and `--diff-only`
is the within-case A/B control this repo already uses.

## Decision

**Measure both halves, report them separately, and never sum them.**

`chat.mjs` stamps the first frame that carries text — the same condition the idle budget already uses,
because a role-only frame or a keepalive is socket activity that proves nothing about generation — and
stamps again when the stream ends. `postChat` returns `prefillMs` and `generationMs`; they reach
`--json`, the text footer, and two benchmark columns that replace `seconds`.

Four details are load-bearing:

- **Measured, not derived.** An earlier draft had the benchmark compute generation as
  `durationMs - prefillMs`. The Codex plan challenge caught that this is not generation:
  `durationMs` starts before prompt building, token estimation and any rejected `response_format`
  attempt, while `prefillMs` starts inside the answering attempt, so a schema rejection alone could
  make "generation" several seconds for a reply that generated instantly. Both stamps now live inside
  one attempt.
- **`performance.now()`, not `Date.now()`.** A 400-second prefill is long enough for a wall-clock
  adjustment to land inside it, and a duration measured across one would be a reported figure that is
  not the figure.
- **Null, never zero, on the non-streamed path.** A server that ignores `stream: true` sends one
  whole document; there is no observable boundary between waiting and generating, and reporting the
  elapsed time as either half would assert a server-side fact from no evidence. `Number.isFinite`
  gates every consumer, because `durationMs - null` is `durationMs` — a null that reached arithmetic
  would relabel a whole run's wall clock as generation.
- **Per attempt, when the request is retried.** `postWithDegrade` loops and the `response_format`
  degrade retries at a higher level, so one answer can cost two or three requests. Timing from the
  first would report a cold review as warm — the exact confusion this item removes. The reported
  figures belong to the attempt that answered, and `--json` carries `retried` so a reader can see
  that earlier attempts existed rather than wondering at an unexpectedly fast prefill.

  `retried` counts **both** ladders. The first version derived it from the schema outcome alone,
  which saw the `response_format` retry and missed the `stream`/`stream_options` rungs one layer
  down — and those are not hypothetical: `tests/stream-budget.test.js` already drove three HTTP
  attempts for one answer through the real CLI. A field named for "more than one try" reporting
  `false` for a run that tried three times would have been the reported-state defect this repo keeps
  finding, in the field added to prevent it. Caught by the lean review. `degraded` is kept beside it
  for the narrower fact it actually names: the schema was refused and the reply was parsed from prose.

**Add `--cache-buster <token>` to `/oai:review`, and `--cold` to the benchmark.** The token goes at
the head of the *system message content*. Not "at token 0": the chat template's own role and preamble
tokens still precede it and may stay cached. A suffix would not work at all — a prefix cache reuses
the longest shared *prefix*, so a marker at the end leaves everything before it cached. Verified
before the flag was written, since it is the flag's entire premise:

| request | time to first token |
|---|---|
| cold, plain system prompt | 148,418 ms |
| warm, plain system prompt | 2,710 ms |
| **nonce at head of system** | **102,123 ms** |
| same nonce again | 1,756 ms |

`bench/run.mjs` mints one `randomUUID()` per invocation and appends the case id and run index. Not a
timestamp, which was the first draft: two invocations launched inside one clock tick would share it,
and a wall clock can step backwards onto a value already used.

**Pin the case commit's identity.** `commitAll` sets a fixed `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`
with an explicit timezone and passes `-c commit.gpgSign=false`; the env is merged over `process.env`
rather than replacing it. Same tree, parent, message, author, date and no signature ⇒ same sha, every
run and every day.

## What it looks like in the shipped report

`--case model-info --runs 2` on the dense 27B, after the change:

```
| case         | ... | prompt tokens | prefill s | generate s |
| `model-info` | ... | 41010         | 7–289     | 398–726    |
```

Two facts the old `seconds` column could not show, both in one row. Prefill spread 39× — the ratio
computed by the report itself, not carried over from the hand measurement above — and generation
spread 1.8× for a reason that has nothing to do with the cache. Welded together, that row would have
read `687–1015` and looked like ordinary variance.

And the flag, on `config-origin` at `--runs 3`, which is what it exists to do:

| run | prefill s | generate s |
|---|---|---|
| default (cache warm after run 1) | 1–10 | 165–747 |
| `--cold` | **10–10** | 90–479 |

Three independent cold samples instead of one cold and two hits, and the report drops the cache
caveat and states that `--cold` was on. Prompt size rises 1,575 → 1,613 per run, which is the nonce
itself arriving in the prompt.

### One number in that row was itself two quantities welded together

`prompt tokens` summed `usage.prompt_tokens` across the runs. At N=1 — which is how every figure in
ADR 006 was harvested — a sum equals the per-run value, so the column was correct for its entire
history and became wrong the first time this feature ran a case more than once. The table above
originally printed `82020` for a case ADR 006 records at 41,016, and `4839` under `--cold` for one of
1,613.

Found while checking why two live runs of the same case disagreed on a figure that ought to be a
property of the input. Worth stating plainly: this is the same defect as the `seconds` column, in the
table this ADR was adding columns to, and the caveat written *for this feature* directs the reader to
that column as the thing to read a generation figure against. It is now per-run, and a min–max range
when the runs genuinely differ — which under `--cold` they can.

## Alternatives rejected

**Bust the cache on every run.** Statistically cleanest, and rejected on cost and fidelity. The cache
is what makes `--runs 3` affordable: on the 56,805-token case, three busted runs cost ~21 minutes of
prefill against ~7.5 for one-cold-two-warm, and the full corpus at N=3 on two models is already an
afternoon. It would also perturb the input on every run of a corpus whose whole value is being a
fixed target, and it would throw away the fact that real `/oai:review` usage *is* warm.

**Accept warm runs and label them cold or warm.** This is what the backlog item proposed, and the
probe killed it: there is nothing to label from. Position is not evidence, and the reply carries no
cache field.

**Fix the commit drift as a separate item.** Rejected because it is not separable in practice: with
the sha drifting, the prefill column would have measured a cache behaving differently per mode, so
its first readings would have needed a caveat that a later item removed.

## Known limits, stated rather than assumed away

- **Nothing here makes warm and cold runs comparable.** It makes the incomparable part visible.
  Prefill figures must not be averaged across runs of a case.
- **And generation is not comparable either — only untouched by the cache.** This took two attempts
  to state correctly, which is worth recording. The first draft said "prefill is not comparable run
  to run; generation is", refuted by the adversarial review at 0.98 confidence: a model that reasons
  twice as long generates twice as long on the same input, and this repo has measured **1,709 against
  5,450 output tokens on identical input**. The second draft weakened it to "prefill varied 12× here,
  where generation — which a cache does not touch — did not", and the first live run to print that
  sentence disproved it in its own row: prefill 1–10s, generation 165–747s. *"The cache does not
  affect X"* and *"X is comparable"* are different claims, and the tidy contrast between them is what
  keeps inviting the second. The note now states only the ratio it counted. Making generation
  comparable needs the tokens-per-second quotient, which is OAI-17's work.
- **Against a server that prefills before rejecting a field**, the reported prefill understates the
  run, because the rejected attempt's work is invisible. No observed server does this — a 400 on
  `response_format` arrives in milliseconds, which is the stated basis on which this repo already
  calls that retry near-free — but nothing detects it.
- **`--cold` changes the model-visible prompt.** A `--cold` run is not a byte-identical repeat of the
  same request, so it may shift generation variance as well as prefill. The report says when it was
  on.
- **`generationMs` includes the server's own inter-token stalls**, so it is not a pure model-speed
  figure. OAI-17 will divide it into `usage` for a tokens/sec column.
- **`--diff-only` figures measured before this change are not comparable with figures measured
  after it.** Pinning the sha removes an accidental cache bust that applied to that mode alone, so
  that arm's timings will improve for a reason that has nothing to do with the reviewer.
- **The cache caveat hedges its mechanism on purpose** — "repeat runs *may* reuse a server-side
  prompt cache". This harness cannot inspect the server, caching may be off, and under `--cold` every
  run is deliberately a miss. The ratio it quotes is computed from the run, requires two positive
  measurements in one case, and is omitted otherwise: one run cannot establish variation, and a zero
  denominator would print `Infinity×`, which is a caveat that is itself a defect.
