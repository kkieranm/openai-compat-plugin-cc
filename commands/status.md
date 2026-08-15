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

- With no arguments: jobs submitted from the current directory, plus anything running anywhere; and
  when the job obstructing this directory is a *queued* one in another checkout, that row is shown
  too — under the same condition as the flag described below, since being shown and being flagged are
  the same decision. A count of the rest is shown at the top.
- The obstructing row is flagged `! must clear before this workspace's queued job can proceed.` It is
  whichever row the queue itself stops at — the running job if one is running, otherwise the job at
  the head of the queue. The flag appears only while something here is verifiably waiting: a local job
  that is live, or still inside its startup grace. Your own jobs are never flagged, since they need no
  explaining.
- **Only the obstruction the queue reaches first is flagged, and clearing it does not mean your job
  runs next.** Other jobs from other checkouts may still be ahead of yours, queued behind the flagged
  one and counted in the tally rather than listed; `--all` shows them. The flag says what must clear,
  never what happens after. Nor does it always call for action: an ordinary running or queued job
  clears by finishing, and the states below say which ones need dealing with by hand or written off with `/oai:abandon`.
- `--all`: every job on this machine, whichever directory it was submitted from.
- With a job id: that one job in full, resolved from **any** directory — an id handed between
  sessions keeps working wherever it is used.

Reading the states:

- `queued` — waiting for its turn. One background job runs at a time, with the `/oai:abandon`
  exception described below.
- `running` — the model is working on it.
- `stalled` — its process is alive but has stopped checking in, so it is probably suspended or
  wedged. Nothing here will terminate it: the pid may since have been reused by an unrelated
  process, so the plugin never signals one it cannot verify. The job id and pid are shown for you
  to deal with by hand — and `/oai:abandon <job id>` writes the ROW off so it stops holding the
  queue, which is a different thing from stopping the process. That is the exception to "one at a
  time": the row stops blocking while its process may still be running, so a job that starts next can
  overlap with it.
- `overdue` — past its own `--max-seconds` cap while its process is still alive. Same caveat.
- `cancelling` — someone ran `/oai:cancel` on it and its worker has not exited yet. It stops at its
  next check-in. It then reads `cancelled` only if the worker confirms that is why it stopped; a
  worker that dies without confirming reads `failed`, with the reason `cancel-unconfirmed`. A job
  showing `stalled` instead will never see the request — use `/oai:abandon` for that one.
- `malformed` — a row this build cannot have produced, reported rather than guessed at. Two shapes,
  and they do not block the same people. A **running** row with no worker pid blocks every job waiting
  for a turn, until it is dealt with. A **queued** row whose timestamps will not parse holds the line only
  while it is the first row the queue does not skip — behind another blocker it stops nobody — and it
  is stuck only while it stays in that shape: a worker that registers against it can still pick it up.
- `completed`, `failed`, `cancelled`, `queue-timeout` — finished. `queue-timeout` means the job gave
  up waiting for its turn under `--max-wait` and never contacted the model.

Reading a job also collects any whose worker died, so a stuck queue often clears simply by running
this. If it reports the database was written by a newer version of the plugin, nothing was collected
— that is deliberate, and the newer plugin is the one that can do it safely.

History is bounded: the newest 50 finished jobs are kept, and older ones are discarded along with
their logs the next time a job is submitted. A job that has not finished is never discarded, however
long it has been waiting, so nothing here loses work that is still going.

Two kinds of finished job are exempt from that ceiling and are not counted against it: one a newer
version of the plugin wrote, and one `/oai:abandon` wrote off **after it had started running**. The
second is kept because its worker may have been alive when the row was written off, and may have
salvaged its answer into the job log; discarding the row would unlink that log underneath it. Those
rows accumulate — there is no way to clear one — which is the accepted cost of not destroying an
answer that was paid for.

Background jobs need `node:sqlite`. Node.js provides it unflagged from 22.13 (23.4 on the 23.x
line), but a build compiled without SQLite or a process started with `--no-experimental-sqlite` lacks
it at any version. On a runtime that does not provide it this command exits 1 saying so, and
`/oai:setup`, `/oai:review` and
foreground `/oai:task` keep working.
