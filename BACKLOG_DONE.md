# Done

Newest first.

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
