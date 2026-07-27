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

`scripts/lib/git-diff.mjs` sends each changed file whole alongside the diff, taking content from the
revision the diff describes; `collectTarget` splits pinned `files` (untracked, `--file` — covered by
no diff) from droppable `changed`, and the reply falls back to the diff alone when the window is too
small — see [ADR 005](adr/005-whole-files-for-review.md).

`scripts/lib/structured.mjs` asks for JSON with a strict `response_format` schema, reads the payload
from whichever channel carries it, and degrades to prompt-and-parse when a server refuses the schema
— see [ADR 003](adr/003-structured-findings.md). Every string and array in that schema carries a
size ceiling as a backstop against a runaway reply, and hitting the `MAX_FINDINGS` cap is reported —
see [ADR 004](adr/004-bounding-the-review-reply.md).

`bench/` scores `/oai:review` against committed snapshots of this repo's history: each case is a
historical commit re-staged as `before/`/`after/` trees with its known defects catalogued, run through
the real CLI via `--json` and matched on a quoted anchor line — see
[ADR 006](adr/006-benchmarking-the-reviewer.md).

## Commands

- Test: `npm test` (`node --test` over `tests/**/*.test.js` — the path scope is load-bearing, see footguns)
- Benchmark the reviewer: `npm run bench` (opt-in, needs a real model; `--runs N`, `--case <id>`, `--diff-only`)
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
- LM Studio is installed and usually serves `qwen3.6-35b-a3b-ud-mlx` on :1234, but it is only up
  when started. Tests must stay network-free (fake server on an ephemeral port); use the stub for
  manual runs when nothing is listening.
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
  built-in `/code-review` (default `medium`, ceiling `high`) once per milestone only.
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
