---
description: Ask a background /oai:task job to stop
argument-hint: '<job id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Ask a background job to stop.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" cancel <job id>
```

Core constraints:

- Return the companion script's stdout verbatim: no paraphrasing, summarising, or commentary before
  or after it.
- The job id is required and resolves from any directory.
- Do not follow the cancellation with a re-submission unless the user asks for one.

What it does, and what it does not:

- It records the request and reports `Cancelling …`. It does **not** report `cancelled`, because at
  that moment the job is not cancelled: the worker notices at its next check-in — a few seconds — and
  exits, and the terminal state appears the next time anything reads the job. Run `/oai:status <job
  id>` to see it.
- A job still `queued` stops before sending anything to the model at all.
- Nothing is signalled. The plugin never sends a signal to a process it cannot prove is its own,
  since a recorded pid may since have been reused by something unrelated. Cancellation is a request
  the worker honours, not something done to it.
- A worker that has stalled — alive but no longer checking in, as `/oai:status` reports — will not
  see the request. That job needs dealing with by hand; the status output names the pid.

Handling failures:

- The script exits 1 for an unknown job id, for a missing id, and when the job database was written
  by a newer version of the plugin — cancelling is a write, and this build will not write to one it
  does not understand.
- A job that has already finished is not an error: the command says so, exits 0, and names the state
  it finished in. For a completed one it points at `/oai:result`.
- Background jobs need `node:sqlite`. Node.js provides it unflagged from 22.13 (23.4 on the 23.x
  line), but a build compiled without SQLite, or one started with `--no-experimental-sqlite`, lacks it
  at any version. On a runtime that does not provide it the script exits 1 saying so, and
  `/oai:setup`, `/oai:review` and
  foreground `/oai:task` keep working.
