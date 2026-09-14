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
- **OAI-5** — A delegation subagent (`/oai:rescue` + a thin forwarding agent) so a long local-model
  run does not consume the main session's context.
- **OAI-6** — Streaming output for `/oai:task`, so a slow local model shows progress rather than
  sitting silent behind a single stderr line.
- **OAI-7** — Publish: README install instructions, and verify the marketplace path
  (`claude plugin marketplace add`) actually resolves this repo once it has a remote.
