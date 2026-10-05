# Changelog

All notable changes to this project are documented here, loosely following the
[Keep a Changelog](https://keepachangelog.com) convention.

## Unreleased

### Added

- `/oai:task` and `/oai:review` take `--enable-thinking true|false`, sent as the chat template's thinking
  switch (`chat_template_kwargs.enable_thinking`). Checked with Qwen3.8-27B (MLX 4-bit): `false` turned
  thinking off on oMLX, vMLX and Unsloth Studio; on LM Studio `true` did not make the model think, and
  there it thought when `--reasoning-effort` was sent and not otherwise. The `--json` envelope records the
  switch as requested, not as honoured: whether a reply reasoned is still read off the reply.
- `npm run bench` accepts `/oai:review`'s sampling and reasoning flags — `--reasoning-effort`, `--top-p`,
  `--top-k`, `--min-p`, `--presence-penalty`, `--enable-thinking` — forwards them to every review, states
  each one set in the report, and declines to rank two runs that differ in any of them. Unset, each server
  uses its own defaults, which may differ from server to server.
- The context window is now detected on vMLX, from the prompt cap it enforces, so the size check works
  there without a `contextLength` in the config. The window is read only while vMLX has a model
  loaded, so checking it does not wake a sleeping vMLX into reloading its model (for a `baseUrl` at
  the server's root without a query string). A cap set with `--max-prompt-tokens` above the model's
  own context is taken as given; set `contextLength` in that case.

### Fixed

- `npm run bench -- --temperature=` (an empty value, accepted as 0) no longer makes every review fail: the bench
  forwards `--max-tokens`, `--temperature` and the sampling flags as one `--flag=value` argument each,
  which the review's parser does not drop.
- `/oai:review` now says when the conservative count of non-ASCII text shaped an admitted review: when
  the diff-covered changed files went as diff hunks only although a typical count of the non-ASCII
  text would have fitted, and when the reply budget was cut materially further than a typical count
  would have cut it. Both appear as notes in the text report and as `skippedConservativeCount` and
  `conservativeReserveCut` in `--json`, including multi-pass runs. What is sent is unchanged.
- The benchmark drivers (`bench/run.mjs`, `compare.mjs`, `review-sweep.mjs` and the rest) now run
  when invoked through a path that contains a symlink, such as `node /tmp/<checkout>/bench/run.mjs` on
  macOS; all but `task-run.mjs` previously exited 0 having done nothing.

## 0.1.1

### Changed

- The installed plugin is now only its runtime — commands, agent, scripts, manifest and licence —
  instead of the whole repository with its tests and benchmark fixtures (adding the marketplace still
  clones the repository). The plugin lives in `plugins/oai/`; to load a checkout directly, use
  `claude --plugin-dir <checkout>/plugins/oai`.

### Fixed

- The context-size check no longer badly under-counts text in non-Latin scripts and emoji (Chinese,
  Japanese, Korean, …), which could let a prompt through that the server then rejected for exceeding
  its window. Non-ASCII text (accented Latin included) is now counted conservatively — about
  threefold for Chinese prose — so a prompt dense in it may be refused before the window is actually
  full, and the refusal usually notes when that may be the cause; text that is entirely ASCII is
  sized exactly as before.
- The test suite and the `bench/task-run.mjs` and `bench/ttl-challenge.mjs` drivers now work from a
  checkout whose path contains a space, `#` or `%`; `ttl-challenge` previously did nothing when run
  from such a path.

## 0.1.0

### Task delegation

- `/oai:task` sends a request to your own local (or otherwise self-hosted) model and prints its
  answer, with a footer of provider, model, duration and token counts.
- `--background` submits a task asynchronously and returns a job id instead of blocking your
  session — useful for anything slow enough that you'd rather not wait on it.
- `--json` produces a machine-readable answer envelope (content, timing, model, errors) in place of
  the normal text output.
- `--max-seconds` caps how long a single model call is allowed to run.
- Sampling and reasoning behavior is tunable per call: reasoning effort, temperature, top-p, top-k,
  min-p and presence penalty.
- `--template advisor` (and other templates) gives you a ready-made request shape with its own
  answer structure and caveats, instead of hand-writing the same prompt every time.
- A companion subagent can delegate a bounded task on your behalf — it picks the relevant files
  itself, submits the job in the background, and hands you back a short account plus the job id
  rather than dumping the raw reply into your session.

### Diff review

- `/oai:review` has a local model review your working tree, a staged diff, a commit, or a whole
  branch, then checks each finding against the real code before reporting it — a finding that can't
  be reproduced is marked refuted rather than acted on.
- Changed files are sent in full where the context window allows, not just the diff hunks, for a
  more accurate review; the plugin falls back to hunks-only or diff-only automatically when the
  input is too large, and says so.
- `--structured-output` opts into a strict JSON response schema for servers that support it well;
  the default instead asks for the shape in plain language, since a schema-enforcing grammar can
  crash or badly degrade some local servers.
- A review that ends without a visible answer may get up to two bounded follow-up attempts per review
  pass to recover a real answer from its reasoning — clearly labeled as recovered, not a normal
  result. Salvage can add up to 600s per pass beyond `--max-seconds`.
- Findings are read reliably regardless of small formatting differences in the model's reply — a
  JSON list, a differently-named field, a bare array, or a plain-language "no defects found" — rather
  than treating a real answer as unreadable.
- `--cache-buster` / `--cold` force an uncached run, for accurate timing measurements.

### Multi-pass and multi-lens review

- `--passes N` runs several independent review passes and merges the results, showing how many
  passes independently agreed on each finding — a cheap way to separate signal from one-off noise.
- `--lens correctness,security[,edge-cases,...]` runs one focused pass per named lens and merges the
  findings, tagging each one with which lens(es) caught it.

### Background jobs

- Background jobs are queryable from any session or directory, not just the one that submitted
  them: `/oai:status` reports progress, `/oai:result` prints the answer, `/oai:cancel` asks a job to
  stop.
- One job runs at a time; the rest queue automatically, and `/oai:status` names the specific job
  actually blocking yours rather than a generic "something's queued" message.
- `/oai:cancel` is cooperative — the worker confirms it actually stopped, so a crash mid-cancellation
  is reported honestly as a failure rather than shown as a clean cancel.
- `/oai:abandon [--force]` lets you force-terminate a job whose worker can no longer be confirmed
  alive, so a stuck job can't wedge the queue indefinitely.
- A submitted job's request — including the full text of every attached file — is frozen at
  submission time, so editing those files afterwards never changes what the model was actually asked.

### Provider and model selection

- Providers are plain configuration, not code: point the plugin at any server speaking the
  OpenAI-compatible `/v1/chat/completions` API by adding an entry to your config file.
- `/oai:setup` probes every configured provider, reports which are reachable, and shows what models
  each one has loaded.
- When no model is named, the plugin picks whichever model the server reports as already loaded, and
  never guesses between two equally plausible chat models or considers an embedding model a
  candidate.
- The plugin detects and reports when a server answers with a different model than the one you
  requested — a known quirk of some local servers — instead of silently trusting the requested name.

### Context-window handling

- The server's real usable context window is auto-detected (not just its advertised maximum) across
  several common local-serving stacks, and can be overridden per provider in config.
- Oversized input is refused up front whenever the window is known, with both numbers quoted, rather
  than being silently truncated or left for the server to reject.
- Where the window can't be detected, the plugin says so and warns rather than guessing — an
  unknown window is never treated as a generous one.
- A run's machine-readable output records the effective context window, its source, and other
  server configuration actually in effect, so a slow or failed run can be diagnosed after the fact.

### Reliability

- The different ways a local server can fail mid-request — a dropped stream, an empty or malformed
  completion, a transport error, or a refusal disguised as a normal response — are told apart, and
  the ones safe to retry are retried automatically, with the real cause reported rather than a
  generic error.
- A malformed piece of a model's reply (for example, a garbage field on a single finding) no longer
  discards the whole reply — the bad piece is dropped and the rest is kept.
- Sensitive detail — endpoint URLs, credentials, raw server response bodies — is kept out of
  persisted failure records and background-job logs; it appears only in the interactive command's own
  terminal output.

### Benchmarking

- `npm run bench` scores `/oai:review` against a labelled corpus of real historical commits with
  known defects, with options for run count, case selection, diff-only mode, cold-cache timing, and
  sampling parameters.
- An overnight sweep mode reviews many commits unattended (optionally against a different
  repository), writing results continuously so a crash doesn't lose the whole run; an interrupted
  sweep can be turned into a full report afterward.
- Comparing multiple benchmark or sweep runs side by side automatically withholds a ranking, rather
  than producing a misleading one, when the runs aren't genuinely comparable.
- Reports show which model actually answered, whether it visibly reasoned, and which review depth
  and context window were used per case, so results are never silently compared apples-to-oranges.

### Configuration and security

- The provider config file and the background-jobs database are created with restrictive file
  permissions, repaired automatically if ever found loosely permissioned.
- A queued background job is pinned to the exact endpoint and credential it was authorized against
  at submission time, so editing your config afterward can't redirect it to a different server or
  send the wrong credential; ordinary credential rotation still works as expected.
- For a background job, a credential in the query string of a *configured* provider's URL is
  committed to the jobs database as a verifiable hash rather than in plaintext, and re-resolved from
  your config when the job runs. A credential in a URL path, or in an ad-hoc `--base-url` query, is
  stored as given instead — and a path-embedded one is shown back to you on `/oai:status` and in
  interactive error output. Prefer an `apiKeyEnv` entry for any credential.

### Known limitations

- The token-size estimate used to size prompts is tuned for code and diffs, so very dense non-Latin
  text can still overflow a server's context window despite the built-in guard.
- `/oai:setup`'s compatibility check can occasionally disagree with whether `/oai:task` actually
  succeeds against that same provider and model, in cases involving model substitution or fallback
  selection.
