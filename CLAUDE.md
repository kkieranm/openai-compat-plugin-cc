# openai-compat-plugin-cc

A Claude Code plugin (in the style of `openai/codex-plugin-cc`) that delegates work to models on any
OpenAI-compatible server — LM Studio, oMLX, Unsloth Studio, or anything else serving
`/v1/chat/completions`.

This file orients an agent or contributor working in the repo. User-facing behaviour is documented in
[`README.md`](README.md); shipped capabilities are summarised in [`CHANGELOG.md`](CHANGELOG.md).

## Architecture

Providers are **config data, never code paths**. `plugins/oai/commands/*.md` shell out to
`plugins/oai/scripts/oai-companion.mjs`, which resolves a profile from
`~/.config/oai-plugin/providers.json` and makes one `fetch` call. Adding a provider is a config edit,
not a code change.

There is no build step: the plugin is markdown command definitions + JSON manifests + ESM scripts.
The installed plugin is `plugins/oai/` alone — the marketplace `source` names it, so `tests/` and
`bench/` never reach the plugin cache; `tests/plugin.test.js` pins what may live there.

Key modules under `plugins/oai/scripts/lib/`:

- **`config.mjs`** — loads and normalises `providers.json`; `normalizeBaseUrl` validates the endpoint
  (a bare `host:port` is *not* a valid base URL — the protocol must be http(s)).
- **`model-info.mjs`** — detects a provider's context window and model types by probing vendor
  endpoints and trusting the window a server actually serves over a model's theoretical ceiling.
- **`model-selection.mjs`** — the single authority on which model a task uses: picks the server's
  loaded model when several are offered and none is named, and refuses an id no catalogue lists.
- **`sampling.mjs`** — `SAMPLING_PARAMS` is the one registry of vendor sampling/reasoning parameters a
  request may carry (`reasoning_effort`, `top_p`, `top_k`, `min_p`, `presence_penalty`); validation,
  request-body assembly and the DTO all iterate that one table, so a parameter can't be admitted in
  one place and dropped in another.
- **`http.mjs` / `stream-collect.mjs`** — the only place the repo speaks HTTP: streamed chat
  completions read as SSE, with explicit first-token and idle budgets that mean "the model is
  working".
- **`structured.mjs`** — can request a strict JSON `response_format` schema, but does **not** by
  default: a schema builds a grammar in some servers (LM Studio) whose lexer can crash on long
  generations, so the default path asks for the shape in prose and parses leniently.
  `--structured-output` opts back in for servers without that grammar engine.
- **`git-diff.mjs`** — for `/oai:review`, sends each changed file whole alongside the diff when the
  window can be sized, and falls back to the diff alone when it can't.
- **`job-store.mjs`** and the `job-*.mjs` family — background jobs (`/oai:task --background`). The
  concurrency design is a SQLite transaction, not a file protocol: one job runs at a time, the rest
  queue. Requires `node:sqlite` (see the footgun on Node versions below).

`bench/` scores `/oai:review` against committed snapshots of real project history; `bench/cases/`
holds those historical before/after trees as fixtures. `npm run bench` is opt-in and needs a real
model server.

## Commands

- **Test:** `npm test` (`node --test` over `tests/**/*.test.js`). The `tests/**/*.test.js` scope is
  load-bearing — see the footgun below. Requires `zsh` on PATH (see footguns).
- **Benchmark the reviewer:** `npm run bench` (opt-in, needs a real model).
- **Compare benchmark runs:** `npm run bench:compare`.
- **Overnight review sweep:** `npm run review-sweep -- --minutes N` (opt-in, needs a real model).
- **Load the plugin in a scratch session:** `claude --plugin-dir plugins/oai -p "/oai:setup"` (from
  the repo root).

## Session footguns (repeat offenders)

- **The shell cwd resets between separate Bash calls** — use absolute paths, or chain with
  `cd x && …` in one command.
- **`node --test` with no path walks the whole repo**, discovering source-shaped *data* (e.g. the
  historical test files under `bench/cases/`) as tests. The `tests/**/*.test.js` scope prevents this;
  a test asserts the scope survives. Recent Node also rejects a bare directory (`node --test tests/`).
- **Never `spawnSync` in a test that talks to the in-process fake server** — the sync spawn blocks the
  event loop, the server never answers, and the run hangs until the client timeout. `tests/helpers.mjs`
  `runCompanion` is async for this reason; `await` it.
- **A detached worker must not inherit or be handed a descriptor** — `runCompanion` resolves on
  `'close'`, which waits for every descriptor the child holds open, so a grandchild holding an
  inherited pipe turns `--background` into a foreground run and hangs the suite. Background jobs use
  `['ignore', log, log]`.
- **`new URL('localhost:1234')` parses** (scheme `localhost:`, null origin) — URL parsing alone does
  not validate a base URL, so `normalizeBaseUrl` also checks the protocol is http(s).
- **A model's usable window is `loaded_context_length`, not `max_context_length`** — these can differ
  several-fold for the same model. `model-info.mjs` encodes this; do not "simplify" it to the larger
  field.
- **Background jobs need `node:sqlite`**, which is available unflagged only on newer Node (22.13+).
  On older Node, background execution is unavailable and the sqlite-dependent tests skip; foreground
  `/oai:task` and `/oai:review` work regardless.
- **Plugin command markdown needs `allowed-tools: Bash(node:*)`** or the companion call fails at
  runtime.
- **A schema-constrained reply arrives in `reasoning_content` with `content` empty** — the grammar
  stops the model ever closing its think block. Reading that channel is legitimate only under a
  schema, where parsing proves what it is; without one it is scratchpad and is refused.
- **Tests must stay network-free** — the suite spins up a fake OpenAI-compatible server on an
  ephemeral port. Use the stub for manual runs when nothing is listening.

## Conventions

- **A code comment states current behaviour, not the process that produced it.** Write a comment only
  when the *why* is non-obvious.
- **Tests are network-free** and run against the in-process fake server; keep them so.
- **Every recurring defect class graduates from a review note to a structural test** —
  `tests/structure.test.js` holds these, and `tests/plugin.test.js` guards the markdown command
  surface (a missing `allowed-tools` entry or a renamed script would otherwise break silently).

## Verifying and reviewing changes

- Prove a change with the repo's **`verify`** skill (`.claude/skills/verify/SKILL.md`) — tests, a real
  plugin load, and a delegation round trip.
- Review with the built-in **`/code-review`**.
- Commit gate: tests green and the `verify` skill passed before committing.

## Grilling checklist — schema/shape questions worth surfacing early

- ids: type and provenance (e.g. who mints job ids, where they are stored).
- migration story for any persisted state (the providers config, the jobs database).
- Provider selection: config profile vs ad-hoc `--base-url` vs auto-detect by probing ports.
- Model selection: pinned in config vs whatever is loaded vs load-by-name.
- Sync vs async delegation, and whether a job model is warranted.
- Context handling: fail loud vs truncate vs chunk; where the window figure comes from.
- How much session context is shipped to a local model, given small windows.

## Tracker

Shipped work is summarised in [`CHANGELOG.md`](CHANGELOG.md); open work and bugs live in the
repository's issue tracker.
