# 001 — A generic OpenAI-compatible plugin, with providers as config data

Date: 2026-07-26
Status: accepted

## Context

We wanted `openai/codex-plugin-cc`'s ergonomics — delegate work from Claude Code to another
model without leaving the session — but pointed at models we host ourselves. The first framing was
"an LM Studio plugin". That was widened before any code was written: the same wire protocol serves
LM Studio, oMLX, Unsloth Studio and any other server exposing `/v1/chat/completions`, and we want to
test against all three.

Reading the reference plugin showed it splits cleanly in two. Its transport is Codex-specific — a
persistent `codex app-server` child spoken to over JSON-RPC, plus a unix-socket broker multiplexing
one shared connection. Its orchestration is generic: a dispatcher script invoked from command
markdown, a job-state model, prompt templates, strict output schemas. For an OpenAI-compatible
server the entire transport half collapses into `fetch()`, so only the orchestration shape was worth
keeping.

## Decision

**Providers are data, not code.** A config file at `~/.config/oai-plugin/providers.json`
(overridable with `OAI_PLUGIN_CONFIG`, honouring `XDG_CONFIG_HOME`) holds named profiles, seeded on
first run with `lmstudio` (:1234), `omlx` (:8000) and `unsloth` (:8888). A profile carries
`baseUrl` plus optional `defaultModel`, `contextLength`, `timeoutSeconds`, and either `apiKey` or
`apiKeyEnv`. Nothing in the request path branches on provider *identity*; the only provider-keyed
code is `START_HINTS` in `config.mjs`, which is presentation-only remediation text. (Amended by
[ADR 002](002-context-window-detection.md): `model-info.mjs` now recognises several vendor dialects
in order to detect a context window, but it matches on the *shape of a response*, never on a
profile's name — the property this rule exists to protect.) Adding a provider is
a config edit. Resolution order is `--base-url` > `--provider` > `defaultProvider`, and a named
provider must exist even when `--base-url` overrides its endpoint — accepting a typo silently
discarded the real profile's `contextLength` and disarmed the size guard.

A credential is scoped to the origin it was configured for: `--base-url` pointing at a different
host drops the key rather than forwarding it somewhere it was never meant to go, and says so on
stderr. Credentials embedded in the URL itself are refused, because rebuilding the URL would
otherwise discard them silently. A profile's query string is kept separate from its base URL so it
can be appended after the request path rather than swallowed in the middle of it.

The seeded ports are documented defaults, **not verified facts** — published defaults for MLX-family
servers vary widely (8000/8080/10240/11234/11435), so `setup` always prints the config path so a
wrong port can be corrected.

**Scope: synchronous only.** `/oai:setup` probes every configured provider concurrently and reports
what is reachable and loaded; `/oai:task` runs one non-streaming chat completion and prints the
answer. The reference's job model (background jobs, `status`/`result`/`cancel`, session-scoped
cleanup) and its fail-closed Stop review gate are genuinely reusable, but none of it is needed to
prove the transport, so it is deferred rather than ported.

**Oversized input fails loudly.** Local context windows are small, and silent truncation produces a
confident answer drawn from half the input. `context-guard.mjs` estimates tokens crudely (chars/4),
reserves headroom for the reply — `--max-tokens` when the caller gives one, otherwise 1024 — and
refuses with both measured numbers when the input will not fit.
The window is a property of how the model was loaded and is absent from `/v1/models`, so originally
the check only ran when a profile declared `contextLength`. [ADR 002](002-context-window-detection.md)
added detection; an explicit `contextLength` still wins, and an undetectable window still warns
rather than guessing. Auto-chunking was rejected for v1 — merge quality is dubious and it triples the complexity.

**Errors are specific, with remediation.** Exit 0 for success, 1 for user-fixable problems (server
down, no model loaded, input too large, missing file, unknown flag), 2 for a bug. Unknown flags are
an error rather than being swallowed into the prompt, so a typo never silently becomes prompt text.

## Consequences

- Adding or repointing a provider needs no code change, and remote OpenAI-compatible endpoints work
  through the same path via `apiKeyEnv`.
- No streaming: a 300s non-streaming call against a slow local model is indistinguishable from a
  hang, so the script writes a `Contacting <provider> (<model>)…` line to stderr before dispatching.
- The context guard is opt-in per provider. Auto-detecting the window (LM Studio's native
  `/api/v0/models` reports `max_context_length`) would be provider-specific and is left for later.
- `$ARGUMENTS` arrives as a **single** argv entry, so the companion re-splits that blob — but only
  the **leading flag region**. Everything from the first non-flag token onward is taken verbatim
  from the original string. Treating the whole blob as shell syntax was the first design and it was
  wrong: the blob is the user's prose, so an apostrophe in "the file's header" opened a quote that
  never closed and a backslash in `\d+` was eaten as an escape, both corrupting the model's input
  silently. Consequently flags must precede the request (or be separated with `--`); a known flag
  found inside the prompt is reported rather than absorbed, and `--prompt-file` remains the route
  for multi-line prompts. The same rule governs the separated-argv form — flag recognition stops at
  the first word of the request there too, since parsing flags past that point let
  `explain the --model flag` consume "flag" as a model id. Quoting marks a word as text, so a quoted
  `'--model'` is prompt rather than a flag, and passing both `--prompt-file` and inline text is an
  error rather than a silent choice between them.
- Claude Code supports two command-invocation styles and both are in use here: `setup.md` uses the
  `` !`…` `` pre-execution prefix (deterministic — it always runs), while `task.md` uses prose plus a
  fenced bash block, because Claude must first decide which files to attach. Both require
  `allowed-tools: Bash(node:*)` in frontmatter; without it the call fails at runtime, which
  `tests/plugin.test.js` now guards.
