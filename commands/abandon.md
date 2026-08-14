---
description: Write off a background /oai:task job whose worker cannot be proved gone
argument-hint: '[--force] <job id>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Write off a background job's row when its worker cannot be proved gone.

Raw slash-command arguments:
`$ARGUMENTS`

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/oai-companion.mjs" abandon [--force] <job id>
```

Core constraints:

- Return the companion script's stdout verbatim: no paraphrasing, summarising, or commentary before
  or after it.
- The job id is required and resolves from any directory.
- **`--force` goes BEFORE the job id.** Flag parsing stops at the first positional argument, so
  `abandon <job id> --force` reads the flag as part of the id and fails.
- Do not follow an abandonment with a re-submission unless the user asks for one.
- Do not pass `--force` unless the user asked for it. It is the operator's assertion, not yours.

What it is for, and how it differs from `/oai:cancel`:

- `/oai:cancel` **asks** a worker to stop and writes no terminal state; the worker honours it. This
  command **asserts** that a row is finished and writes it off without the worker's agreement. Use it
  when a job is blocking the queue and cancellation cannot reach it — most often after a reboot, where
  a recorded pid has been reused by an unrelated process and so still reads as alive.
- The row becomes `failed` with the reason `operator-abandoned`. Never `cancelled`: nothing confirmed
  that the job stopped, and a tidy-looking `cancelled` would claim otherwise.
- It works on a `queued` or a `running` row, and on a row submitted from any directory — the queue is
  shared by the whole machine, and the row blocking you is usually someone else's. The command prints
  the row it acted on — id, state, pid, beat age, the workspace it came from and what it was asked to
  do — built from the same read the write used, so the row you are shown is the row that was written
  off. It is not a confirmation prompt: there is nothing to confirm and no way to abort.

What it does not do:

- **Nothing is signalled.** The plugin never sends a signal to a process it cannot prove is its own.
  If that process is alive it stays alive.
- The pid is recorded in the job's failure message as **evidence, not as a target**. This build cannot
  prove that number still belongs to this job — that inability is the whole reason the command exists —
  so it may since have been reused by something unrelated. It is there to say what was observed, not to
  tell you what to stop.
- Because of that, writing off a `running` row gives up the guarantee that one background job runs at
  a time: the abandoned process may still have a model request in flight while the queue starts the
  next job, and the two will overlap on this machine's memory. The command says so when it applies.
- When the row was allowed through on a **stale beat**, the reply adds that a beat also looks stale
  after the machine slept and the worker may simply resume — the case where "silent" is least likely
  to mean "gone". It is not printed on a `--force`d row, where the beat was fresh and the operator
  overrode a worker that was checking in.
- A `queued` row carries none of that risk — it had not started, so no request was sent and none will
  be.

Handling failures:

- If the job's process turns out to be genuinely gone — or if no worker ever registered against the row
  at all — ordinary recovery owns it, and the command hands it over and says which of those two it was,
  exiting 0 without writing anything off. That is the commonest case and needs no operator. The same
  applies if recovery had already settled the row: you are told so rather than refused. A row the
  SUBMITTER failed at launch is not that — it is an ordinary refusal, because the reply would
  otherwise credit ordinary recovery with a verdict it did not write. It makes no
  claim about whether the queue will now move; run `/oai:status` for that.
- Without `--force` the command refuses a job that is still checking in, or that has never checked in
  at all, and says so. A worker beats every few seconds, so a job silent for a minute is one whose
  process is not running its event loop — suspended, wedged, gone, **or on a machine that slept**, in
  which case the worker may simply resume. Sleep is also when pids get reused, so the two arrive
  together.
- A job submitted moments ago whose worker has not registered yet is refused, and `--force` will not
  lift that: the startup grace exists for exactly that window, and the refusal says how much of it is
  left. `/oai:cancel` can be recorded against such a row meanwhile — a worker that does register
  honours it at once, and if none ever does the row is collected as `never-started` when the grace
  expires. Neither command stops it sooner.
- `--force` overrides any beat-related refusal and a **malformed** row — one with no pid recorded at
  all, or timestamps that cannot be read. A pid that is present but corrupt is NOT this case: it reads
  as a dead process and is handled by ordinary recovery (OAI-162). It does **not**
  override a job that has already finished, a row written by a newer version of the plugin, one still
  inside its startup grace, or one whose process is simply **gone** — that last is ordinary recovery's
  work, and the command performs it and says so instead of writing your verdict over it. For any refusal it
  cannot lift, the command says so rather than letting you retry a flag that cannot help.
- The script exits 1 for an unknown job id, for a missing id, for every refusal above, and when the job
  database was written by a newer version of the plugin — writing off a row is a write, and this build
  will not write to a database it does not understand.
- Background jobs need `node:sqlite`. Node.js provides it unflagged from 22.13 (23.4 on the 23.x
  line), but a build compiled without SQLite, or one started with `--no-experimental-sqlite`, lacks it
  at any version. On a runtime that does not provide it the script exits 1 saying so.
