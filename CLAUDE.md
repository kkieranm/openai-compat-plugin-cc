# openai-compat-plugin-cc

Claude Code plugin (in the style of `openai/codex-plugin-cc`) that delegates work to models on any
OpenAI-compatible server — LM Studio, oMLX, Unsloth Studio, or anything else serving
`/v1/chat/completions`.

Architecture: providers are config data, never code paths — `commands/*.md` shell out to
`scripts/oai-companion.mjs`, which resolves a profile from `~/.config/oai-plugin/providers.json` and
makes one `fetch` call. See [ADR 001](adr/001-generic-openai-compatible-plugin.md).

`scripts/lib/model-info.mjs` detects a provider's context window and model types by probing vendor
endpoints by response shape, trusting only served windows over model ceilings — see
[ADR 002](adr/002-context-window-detection.md).

`scripts/lib/model-selection.mjs` is the single authority on which model a task will use:
`planSelection` picks the one the server reports `loaded` when several are offered and none was
named, and refuses an id a recognised catalogue does not list; `scripts/lib/model-identity.mjs`
`substitution()` is the one comparison that says the model which answered is not the one requested —
see [ADR 011](adr/011-which-model-actually-answered.md).

`scripts/lib/git-diff.mjs` sends each changed file whole alongside the diff, taking content from the
revision the diff describes; `collectTarget` splits pinned `files` (untracked, `--file` — covered by
no diff) from droppable `changed`, and the reply falls back to the diff alone when the window is too
small — see [ADR 005](adr/005-whole-files-for-review.md).

`scripts/lib/structured.mjs` asks for JSON with a strict `response_format` schema, reads the payload
from whichever channel carries it, and degrades to prompt-and-parse when a server refuses the schema
— see [ADR 003](adr/003-structured-findings.md). Every string and array in that schema carries a
size ceiling as a backstop against a runaway reply, and hitting the `MAX_FINDINGS` cap is reported —
see [ADR 004](adr/004-bounding-the-review-reply.md).

`scripts/lib/http.mjs` is the only place this repo speaks HTTP: `send()` on `node:http`/`node:https`
with an explicit first-byte budget and an optional absolute deadline, streaming chat completions as
SSE, while the first-token and idle budgets that mean "the model is working" live in
`scripts/lib/stream-collect.mjs`, which `chat.mjs` calls to read one streamed reply —
see [ADR 007](adr/007-owning-the-transport.md).

`scripts/lib/review-schema.mjs` sizes the reply from the budget each run is granted —
`reviewSchemaFor(reserve)` — and a run its `analysis` ceiling truncates has its findings scored while
its silence widens the benchmark's recall into a band — see [ADR 008](adr/008-sizing-the-review-reply.md).

`scripts/lib/stream-collect.mjs` times each attempt on both sides of its first token — `prefillMs` and
`generationMs` — because a server-side prompt cache moves the first by tens of times and leaves the
second alone; `/oai:review --cache-buster <token>` defeats that cache for a measurement, and the
benchmark's `--cold` uses it — see [ADR 009](adr/009-measuring-prefill-and-generation.md).

`--max-seconds` caps a whole model call in wall clock, retries included — `scripts/lib/http-budgets.mjs`
arms it as the transport's `deadline` budget from one expiry `requestFindings` mints per command, and
`scripts/lib/throughput.mjs` divides the reply's completion tokens by the generation time it was
measured over — see [ADR 010](adr/010-bounding-and-rating-a-run.md).

`scripts/lib/failure-shape.mjs` names the shapes in which a request dies without the model saying no
and splits them by whether a retry could survive it — `transport` retries, `non-retryable-transport`
is a pre-response failure it does not recognise as transient — while `scripts/lib/provider.mjs`
`reword` improves such a failure's message without ever changing that verdict; and
`scripts/lib/answer-attempts.mjs` `answerWithRetry` retries only the retryable ones, spanning
`postWithDegrade` and `finishAnswer` so it can see every shape; `scripts/lib/attempt-ledger.mjs` records
one entry per physical request so scoring reads the attempt that answered while reliability reads
every attempt, and `scripts/lib/attempt-outcome.mjs` owns what one request's ending means — a refusal
becomes `refused` only when `begin` creates the replacement entry, and stays a `shape-rejected`
failure when nothing replaced it — see [ADR 012](adr/012-surviving-the-server.md).

Server-state questions are answered by shortening the TTL below a known prefill and trying to falsify
the JIT-TTL mechanism, never by sampling residency around a run — the instrument is specified, and
blocked on the attempt record not carrying `serverResponded`, in
[ADR 013](adr/013-observing-the-server.md).

`bench/lib/reliability-report.mjs` `reasonNotes` explains each reason code a reader could misread —
`shape-rejected`, `non-retryable-transport`, `transport` — gated on that code appearing in the
sweep, and claims only what the attempt record holds rather than where else a cause might be found.

`bench/` scores `/oai:review` against committed snapshots of this repo's history: each case is a
historical commit re-staged as `before/`/`after/` trees with its known defects catalogued, run through
the real CLI via `--json` and matched on a quoted anchor line — see
[ADR 006](adr/006-benchmarking-the-reviewer.md).

## Commands

- Test: `npm test` (`node --test` over `tests/**/*.test.js` — the path scope is load-bearing, see footguns)
- Benchmark the reviewer: `npm run bench` (opt-in, needs a real model; `--runs N`, `--case <id>`, `--diff-only`, `--cold`, `--warm-up`, `--max-attempts N`)
- Load the plugin in a scratch session: `claude --plugin-dir /Users/kieran/Code/openai-compat-plugin-cc -p "/oai:setup"`
- No build step; the plugin is markdown + JSON + ESM scripts.

## Session footguns (repeat offenders — check before hitting them)

- The shell cwd resets between Bash calls — use absolute paths.
- **`node --test` with no path walks the whole repo**, so any directory of source-shaped *data* gets
  discovered as tests — `bench/cases` holds historical `tests/*.test.js` that were duly run against
  today's tree. The npm script's `tests/**/*.test.js` scope is what prevents it; a test asserts the
  scope survives. Node 26 also rejects a bare directory (`node --test tests/`) as a missing module.
- **Never `spawnSync` in a test that talks to the in-process fake server** — the sync spawn blocks
  the event loop, the server can never answer, and the run hangs until the client timeout (cost: one
  204-second suite). `tests/helpers.mjs` `runCompanion` is async for this reason; `await` it.
- `new URL('localhost:1234')` **parses** (scheme `localhost:`, null origin) — URL parsing alone does
  not validate a base URL, so `normalizeBaseUrl` also checks the protocol is http(s).
- LM Studio is installed and usually serves models on :1234, but it is only up when started
  (`-ud-mlx` quants are gone; current ids are `qwen/qwen3.6-27b` and `qwen/qwen3.6-35b-a3b`). Tests
  must stay network-free (fake server on an ephemeral port); use the stub for manual runs when
  nothing is listening.
- **LM Studio dropped ~1/3 of long requests across four full-corpus bench invocations**
  (27/72 runs, 2026-07-30, both models — so the locus is the shared serving path; the mechanism
  and the role of sustained load are unresolved): empty completion (`finish_reason: unknown`) or a
  stream drop ~50k chars into reasoning. It can also wedge with a model stuck `GENERATING`
  (fix: `~/.lmstudio/bin/lms unload`). **OAI-20 landed the client-side answer** — those shapes are
  classified and retried, and every physical attempt is recorded — but whether retry *recovers* the
  37.5% is a measurement OAI-19 reads off that record, not a settled fact.
- A model's usable window is `loaded_context_length`, **not** `max_context_length` — 58112 vs 262144
  for the same model here. `model-info.mjs` encodes this; never "simplify" it to the larger field.
- Plugin command markdown needs `allowed-tools: Bash(node:*)` or the companion call fails at runtime.
- A schema-constrained reply arrives in `reasoning_content` with `content` **empty** — the grammar
  stops the model ever closing its think block. Reading that channel is legitimate only under a
  schema, where parsing proves what it is; without one it is scratchpad and `requireAnswer` refuses.

## Grilling checklist — schema/shape forks to always surface

Universal:
- ids: type + provenance (job ids, once async delegation lands — who mints them, where stored)
- strings vs FKs; normalisation aggressiveness
- migration story for persisted state (the providers config, and any future job files)

Domain:
- Provider selection: config profile vs ad-hoc `--base-url` vs auto-detect by probing ports
- Model selection: pinned in config vs whatever is loaded vs JIT-load by name
- Sync vs async delegation, and whether a job model is warranted yet
- Context handling: fail loud vs truncate vs chunk; where the window figure comes from
- How much Claude session context is shipped to a local model, given small windows

## Verifying and reviewing changes

- Prove changes with the repo `verify` skill (`.claude/skills/verify/SKILL.md`).
- Review order: `advisor` → lean workflow (`.claude/workflows/review-lean.js`) per feature →
  the same lean workflow in **wide mode** (`--wide` args prefix: 5 finders, verifier cap 6) once per
  milestone, or when a change introduces or alters a module carrying vendor/protocol assumptions —
  which in this repo is most of them. Wide mode replaced the built-in `/code-review` here on
  2026-07-30 after it died at its verifier fan-out on both OAI-16 and OAI-17 (dotfiles `adr/003`); the
  built-in stays available at `medium` when typed by hand.
- Every recurring defect class graduates from a reviewer's prompt to a structural test — size/growth
  is itself such a class and is guarded by `tests/structure.test.js` (ratchet allowlist; raising a
  ceiling is a deliberate commit that says why). `tests/plugin.test.js` guards the markdown command
  surface, which nothing else notices when it rots.
- Commit gate: tests green + verify skill passed before committing.

## Work tracker

- `BACKLOG.md` — ordered, numbered items with stable global IDs (`OAI-1`, `OAI-2`, …).
- `BACKLOG_DONE.md` — completed items, newest first.
- "Pick next item" = top of BACKLOG.md; "mark done" = move the item to BACKLOG_DONE.md with the date.

## ADRs

Architecture decisions live in `adr/` as `NNN-slug.md`.
