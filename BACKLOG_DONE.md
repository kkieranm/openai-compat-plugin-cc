# Done

Newest first.

- **OAI-15** — Size the reply from the budget the run actually has, and stop discarding the runs the
  cap censors. Completed 2026-07-28. The `analysis` ceiling was a flat 28,000 characters while the
  budget paying for it shrank per run, so the two agreed only by coincidence — and on the largest
  input they did not: `scaffold` sent `max_tokens: 11,043` against a schema envelope of ~15,695
  tokens. `scripts/lib/review-schema.mjs` now derives the cap from the reserve granted
  (`reviewSchemaFor`), clamped between a floor and a **wall-clock** ceiling of 74,000 characters
  (~28 min of generation on a dense 27B; verified that LM Studio compiles a grammar that large before
  relying on it). `REVIEW_MAX_TOKENS` rose 16,384 → 32,768 where the window is known, reversing
  ADR 004's refusal on the evidence that made it — **the cost it feared no longer existed**, because
  the `minReserve` shrink recorded in that same ADR means a review is refused only when under 4,096
  tokens remain, whatever the constant says. BACKLOG's "the tension is real and is the whole
  decision" was describing pre-`minReserve` behaviour.
  **The reserve was never the constraint — the accounting was.** On five of six cases the reserve was
  ~55,700 characters while `analysis` got 28,000, because ~24,500 was held back for a 20-finding
  reply. Six is the most any reply has ever carried, so the budget now reserves for eight; the schema
  still permits twenty and the rare overrun fails loudly. **That eight is a policy bet, not a
  measurement** — every observation behind it was taken under the old cap, and more room may itself
  produce more findings.
  **The half that changed most is what a censored run is worth, and it came from the plan challenge
  rather than the code.** Both obvious readings are wrong: discarding cut runs threw away 17 of 41
  recorded runs carrying two of the four anchored matches ever produced, while folding them in counts
  every finding the run never reached as a confirmed miss. A truncated run's positives are
  trustworthy and its absences are unknown, so `defects found` now reports **only what was observed**
  and a new `unresolved` column says how much of the denominator is uninterpretable, with the upper
  bound stated in prose. A low–high band was built first and removed by the adversarial review: an
  unobserved figure printed under a heading that says "found" made a wholly censored run
  indistinguishable from a perfect one. Rows with nothing cut are unchanged, so past figures stay
  comparable.
  **Measured after the change** (3 runs, `config-origin`, dense 27B, derived cap 74,000): analysis
  lengths **7,075 / 19,942 / 21,240, cut 0 of 3** where that case cut 6 of 9 before — and the right
  edge of the distribution is observable for the first time, since every value at the old 28,000 was
  previously indistinguishable from one that would have run to 90,000. The longest run stopped
  *below* the old ceiling, which contradicts ADR 004's "the model fills whatever it is given" for
  this model and case. Read no further than that: one case, one model, N=3; `structured` (4 of 4 cut)
  and `scaffold` (4 of 11) have not been re-run; **all three runs found nothing**, so this buys
  measurement, not review quality; and it costs wall clock (129–363s against 49–156s).
  Nothing claims the reply fits its budget: `RESERVED_CHARS` is documented as an estimate
  (`maxLength` caps decoded strings, not serialized JSON; `line` has unbounded width;
  `CHARS_PER_TOKEN` was calibrated on input code), and the tests assert the formula rather than a
  guarantee. See [ADR 008](adr/008-sizing-the-review-reply.md).

- **OAI-6 + OAI-17a + OAI-8** — Streaming, and owning the timeouts it exposes. Completed 2026-07-28.
  `timeoutSeconds` never worked above five minutes: Node's `fetch` is undici, undici applies its own
  300s `headersTimeout`, and an `AbortSignal` beside it can only *lower* the bound — so the real
  limit was always `min(timeoutMs, 300_000)` and **14 of 18 benchmark runs died** with 1800 in the
  config. `scripts/lib/http.mjs` now owns the request on `node:http`, streaming chat completions as
  SSE. **The obvious fix was not enough, and finding that out is the result worth keeping**: streaming
  moves the wall from `headersTimeout` to `bodyTimeout` rather than removing it, because prefill emits
  no body — a cache-busted 52k-token prompt took **393.7s to its first token** (9.3s warm). OAI-17a's
  own text claimed streaming would settle it; that claim was written before it was measured.
  **The budgets bound tokens, not bytes**, which is the correction the plan challenge forced: an SSE
  keepalive comment, a role-only delta and a half-delivered frame are all socket activity proving
  nothing about generation, so a byte-driven budget would have let `:\n\n` every 30s run forever while
  reporting itself armed — the defect class the feature exists to remove, reintroduced by its own fix.
  The transport bounds `firstByteMs` plus an optional absolute `totalMs`; the first-token and idle
  budgets live in `client.mjs` and reset only on a parsed delta carrying a string. `totalMs` is what
  keeps `/oai:setup` safe, since its probes are bounded totals today and it awaits every provider.
  Chosen over a working `Symbol.for('undici.globalDispatcher.1')` wrapper **on failure mode, not size**:
  the symbol is not public API and a future Node moving it would disarm the override silently.
  **OAI-8 closes because the heartbeat is timer-driven**, not delta-driven — a delta-driven tick is
  silent through exactly the prefill it was asked to cover, and closing the item on that would have
  been the reported-state-vs-actual class one level up.
  **Accepted on the benchmark, not on a demo.** `scaffold` — 47,069 prompt tokens, one of the 14 that
  died — now completes in **959 seconds** with `failed: 0`, and a live `/oai:task` over a 42,043-token
  cold prompt ran **444s** (≈295s of it silent prefill) where the old code died at 300s. What that does
  **not** buy is a score: the same run came back `cut: 1`, so 0 of 3 listed defects were scoreable. The
  dense-27B arm is unblocked and still unanswerable until OAI-15 sizes the `analysis` ceiling.
  Guarded by a new structural test — **nothing calls the global `fetch`** — with no exemptions, because
  the defect was an invisible default rather than a typo. Four defects were caught before commit that
  the suite would not have found: a `'data'` listener racing the consumer, a first-byte timer re-armed
  at headers (silently doubling the advertised budget), `idleSeconds` validated but dropped by
  `buildProfile` so it did nothing, and — found by the design review — **every existing test replying
  `application/json`, so all 198 would have taken the degrade path and reported a green suite with no
  streaming coverage at all.** Design in [ADR 007](adr/007-owning-the-transport.md).

- **OAI-12** — A labelled corpus and a benchmark harness. Completed 2026-07-28. `npm run bench` runs
  the shipped `/oai:review` against six committed snapshots of this repo's own history and scores the
  findings; `--runs N`, `--case <id>`, `--diff-only`. **It drives the real CLI through a new
  `/oai:review --json`, never a copy of the pipeline** — a bench that scored a reimplementation and
  reported it as the reviewer's score would be this repo's signature defect at the meta level, and
  `structured` (64,357 tokens against a 54,016 threshold) makes it concrete by falling to ADR 005's
  second rung where the others do not. **Baseline: 1 of 6 scoreable defects at N=1, 10.9 minutes** —
  11 catalogued, 5 unscored because their runs were cut. Two findings outweigh that number.
  Its first reading claimed context dilution was measured; **a three-arm run the next day retracted
  that** — the pair behind it varied mode and prompt shape alongside token count, and at N=3 the same
  case at half the tokens found nothing at all. The instrument refuting its own first headline inside
  a day is the item working as intended. What survived and grew: **the `analysis` cap bound on 2 of 6
  runs here and on 6 of 15 runs recorded overall**, both reporting nothing, wasting a third of the run
  and 45% of the corpus's defects with it — and it binds on the *smallest* input, not the largest.
  **The corpus is smaller than history claims, on purpose.** A defect is listed only if it can be
  pointed at in the snapshot; 8 further claims are recorded as dropped with reasons. Applying that
  rule caught **two of my own attributions being wrong** — a defect assigned to `65373a0`, which does
  not touch `config.mjs` at all, and one assigned to `8990173`, where the code did not yet exist —
  both of which would have scored the reviewer for missing code it was never shown.
  **The scorer was validated against hand verdicts before any number shipped** (3 adjudications, 3
  agreements), and immediately justified its design: the model placed the run's only true positive at
  line 83 when the defect is at line 90, so the cheaper file-plus-line-proximity scorer would have
  reported 0/11. **Two guards were earned from defects the corpus itself caused**: `node --test` with
  no path discovered the corpus's historical tests and ran them against today's tree, and a new
  flag-documentation check found `/oai:task` had been accepting `--system` undocumented.
  **The lean review then found six more defects, three of them the signature class** — including one
  in `review-report.mjs`, the module written specifically to stop a caveat being true on one path and
  absent on the next (instance 16). One of the six is why the baseline reads 1 of 6 and not 1 of 11:
  cut runs were entering the recall denominator as zeroes while this ADR claimed they were counted
  separately. Design in `adr/006-benchmarking-the-reviewer.md`.

- **OAI-14** — Review whole changed files, not bare diff hunks. Completed 2026-07-27. Each changed
  file is now sent whole alongside the diff, taken from the revision the diff describes (`git show
  <ref>:<path>` for `--commit`, the index blob for `--staged`), with `--diff-only` restoring the old
  behaviour. **The target class is gone: the "`positiveInteger` is not defined" false positive ran
  3-of-3 before and 0-of-3 after.** Honest scoring is 1 false positive → 0 with true positives
  unchanged at 0 — `1ea398f` is the commit that *fixed* the OAI-2 findings, so it is near-clean and
  the baseline's only output was the false positive. **This bought precision and says nothing about
  recall.** The diff-only arm stopped producing it too, via the new hunks-only prompt sentence, so
  the six runs do not isolate which mechanism does the work.
  **Shipped as a two-rung ladder, not the per-file shed the plan had.** The reserve arithmetic
  collapses to `fit ⟺ estimate ≤ contextLength − minReserve`, so the real threshold is 54,016 and
  the largest measured commit is 41,790 — shedding never triggers on observed data, and ordered
  largest-first it would have dropped `model-info.mjs`, the very file whose missing definition caused
  the false positive. Untracked and `--file` blocks are pinned and never dropped, so an empty review
  is impossible by construction. Cost: 2.5× the input, 4–10× the wall clock, and the `analysis` cap
  now binds in 2 runs of 3 — which makes OAI-8 more necessary, not less. A root-commit bug
  (`git diff-tree` lists nothing without `--root` where `git show` prints a diff) was caught by a
  test and is now a repo trap. **Four claims-vs-reality defects were caught before commit, none by
  the test suite**: the root commit, a subdirectory cwd reading nothing and reporting a normal run,
  a blanket "you have only hunks" asserted while whole files sat in the same request, and — found by
  the lean review, after I had already "fixed" the git-edges class and written the merge case off as
  safe from one trivial example — merges silently losing their bodies, plus an unreadable file
  vanishing with the prompt still vouching for it. Design in `adr/005-whole-files-for-review.md`.

- **OAI-10** — Bound the review reply so a runaway cannot eat a whole pass. Completed 2026-07-27.
  Every string and array in `REVIEW_SCHEMA` now carries a grammar-enforced ceiling, sized above every
  observed successful run; hitting the findings cap is reported rather than silently binning a
  defect. **Shipped as half the item it was written as.** "Raise the ceiling" was dropped on
  evidence: the failing run generated all 16,384 tokens it was allowed against 5,450 / 2,521 / 2,301
  for the runs that finished, so more room only buys a longer runaway. The prompt-side cap was
  dropped too — probing showed the reduction it appeared to give came from *steering the model to
  reason less*, which is an unmeasured recall trade and now an OAI-12 experiment. Probing also found
  that `maxItems` on a reasoning field with no floor collapses it to `[]` in six tokens, now a repo
  trap. **Both first-guess cap values were wrong and live verification caught them** — `evidence` cut
  a real finding, `analysis` cut mid-sentence and the run then reported none. Honest scope: a
  runaway now fails cheaply and parseably in ~70s rather than dead-ending on a truncation error, but
  the cut is not a rescue and this does not move the hit rate. Design in
  `adr/004-bounding-the-review-reply.md`.

- **OAI-4** — `/oai:review`: a local second opinion on the diff. Completed 2026-07-27, pulled ahead
  of OAI-3 so it could be used while building the rest. Strict `json_schema` findings read from
  whichever channel carries them, degrading to prompt-and-parse when a server refuses the schema;
  the target is collected in Node and includes untracked files. Fixed a shipped defect on the way:
  an empty answer was reported as success. Live-verified against LM Studio — five findings on a real
  commit in 32s, a 74.5k-token input refused before sending, and a false positive correctly refuted
  rather than fixed. Design in `adr/003-structured-findings.md`.

- **OAI-2 + OAI-2b** — Context-window auto-detection and embedder exclusion. Completed 2026-07-27.
  Probes by response shape across LM Studio, vLLM, llama.cpp, TGI and (unverified) oMLX, trusting only
  served windows over model ceilings; automatic model selection drops embedders and refuses to guess
  between several candidates. Live-verified against LM Studio with all hand-set config removed:
  detected 58.1k with attribution, picked the chat model over the embedder, and still refused a
  65.4k-token input. Design in `adr/002-context-window-detection.md`.

- **OAI-1** — Plugin skeleton + `/oai:setup` + synchronous `/oai:task`. Completed 2026-07-27.
  Live-verified against LM Studio serving `qwen3.6-35b-a3b-ud-mlx` (58k loaded window): `/oai:setup`
  listed the provider and model, `/oai:task` returned real model output through a `--plugin-dir`
  load, the context guard refused a 65.4k-token input before sending, and a 22.5k-token whole-repo
  summarization ran in 62s. Reviewed by advisor, the lean workflow, and a high-effort `/code-review`
  (15 findings total, all fixed). Design in `adr/001-generic-openai-compatible-plugin.md`.
