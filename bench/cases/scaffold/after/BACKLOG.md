# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

- **OAI-1** — Plugin skeleton + `/oai:setup` + synchronous `/oai:task`. **Code complete and verified
  against a stub server; still open for one step only:** live verification against a real model.
  Install LM Studio (and ideally oMLX + Unsloth Studio), load a small model, then confirm
  `/oai:setup` lists it and `/oai:task --provider <name>` returns real model output. Until that
  passes, the wire protocol is verified only against our own stub.
- **OAI-2** — Auto-detect the context window per provider so the size guard works without hand-setting
  `contextLength` (LM Studio's native `/api/v0/models` reports `max_context_length`; needs a
  provider-specific probe with a generic fallback).
- **OAI-3** — Background jobs: `--background`, plus `/oai:status`, `/oai:result`, `/oai:cancel`.
  Port the reference plugin's generic job model (per-workspace state dir, light index + per-job
  record, detached self re-exec worker); replace its RPC interrupt with an `AbortController`.
- **OAI-4** — `/oai:review`: send the working-tree or branch diff for a second-opinion review, with a
  strict JSON output schema (`response_format: {type: "json_schema", strict: true}`) so findings
  render consistently even from a small model.
- **OAI-5** — A delegation subagent (`/oai:rescue` + a thin forwarding agent) so a long local-model
  run does not consume the main session's context.
- **OAI-6** — Streaming output for `/oai:task`, so a slow local model shows progress rather than
  sitting silent behind a single stderr line.
- **OAI-7** — Publish: README install instructions, and verify the marketplace path
  (`claude plugin marketplace add`) actually resolves this repo once it has a remote.
