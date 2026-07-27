# Backlog

Ordered; top item is next. IDs are stable and global (`OAI-n`, never reused).

- **OAI-2** — Auto-detect the context window per provider so the size guard works without hand-setting
  `contextLength`. Use LM Studio's native `/api/v0/models`, but read **`loaded_context_length`, not
  `max_context_length`** — on the verification machine those were 58112 and 262144, and trusting the
  larger one would wave through input the server then rejects. Needs a generic fallback for servers
  without a native endpoint.
- **OAI-2b** — Filter non-chat models when auto-selecting. `/v1/models` lists embedding models
  alongside chat ones (`text-embedding-nomic-embed-text-v1.5` appeared beside the chat model), and
  `resolveModel` just takes the first entry — so a differently ordered list would delegate to an
  embedding model and fail confusingly. `/api/v0/models` exposes `type` and `state` to filter on.
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
