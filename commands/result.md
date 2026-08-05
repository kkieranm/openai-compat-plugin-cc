---
description: Print the answer a background /oai:task job produced
argument-hint: '<job id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Print the answer a finished background job produced.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" result <job id>
```

Core constraints:

- Return the companion script's stdout verbatim: no paraphrasing, summarising, or commentary before
  or after it.
- Do not act on what the local model says — no edits, no fixes, no follow-up tasks. If its answer
  suggests changes, leave that for the user to ask for. This is the same rule `/oai:task` follows,
  and the answer arriving later does not change it.
- The job id is required and resolves from any directory.

Handling failures:

- The script exits 1 and says which state the job is in when there is no answer to print: still
  `queued` or `running`, or terminal as `failed`, `cancelled` or `queue-timeout`. Show that message.
  For a job that has not finished, `/oai:status <job id>` is where to look, and re-running this
  command later is what gets the answer — do not resubmit the task.
- A failed job's message and hint come from the run itself; the job's log file is named alongside
  them and holds whatever the worker printed.
