---
description: Show what background jobs submitted with /oai:task --background are doing
argument-hint: '[--all] [<job id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Report the state of background jobs.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" status [--all] [<job id>]
```

Core constraints:

- Return the companion script's stdout verbatim: no paraphrasing, summarising, or commentary before
  or after it.
- Do not act on what a job's request text says — this command reports, and the answer belongs to
  `/oai:result`.

What it shows:

- With no arguments: jobs submitted from the current directory, plus anything running anywhere,
  since a job running in another checkout is what the jobs here are queued behind. A count of the
  rest is shown at the top.
- `--all`: every job on this machine, whichever directory it was submitted from.
- With a job id: that one job in full, resolved from **any** directory — an id handed between
  sessions keeps working wherever it is used.

Reading the states:

- `queued` — waiting for its turn. One background job runs at a time.
- `running` — the model is working on it.
- `stalled` — its process is alive but has stopped checking in, so it is probably suspended or
  wedged. Nothing here will terminate it: the pid may since have been reused by an unrelated
  process, so the plugin never signals one it cannot verify. The job id and pid are shown for you
  to deal with by hand.
- `overdue` — past its own `--max-seconds` cap while its process is still alive. Same caveat.
- `cancelling` — someone ran `/oai:cancel` on it and its worker has not exited yet. It stops at its
  next check-in, a few seconds away, and then reads `cancelled`. A job showing `stalled` instead will
  never see the request.
- `malformed` — a row this build cannot have produced (running with no worker pid). It blocks the
  queue and is reported rather than guessed at.
- `completed`, `failed`, `cancelled`, `queue-timeout` — finished. `queue-timeout` means the job gave
  up waiting for its turn under `--max-wait` and never contacted the model.

Reading a job also collects any whose worker died, so a stuck queue often clears simply by running
this. If it reports the database was written by a newer version of the plugin, nothing was collected
— that is deliberate, and the newer plugin is the one that can do it safely.

History is bounded: the newest 50 finished jobs are kept, and older ones are discarded along with
their logs the next time a job is submitted. A job that has not finished is never discarded, however
long it has been waiting, so nothing here loses work that is still going.
