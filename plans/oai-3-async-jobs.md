provenance: harness slug composed-pondering-pudding

# Stage 1 — the async vertical slice (OAI-3)

## Context

`plans/local-llms-like-codex.md` Stage 1: `/oai:task --background` → a job id → `/oai:status` →
`/oai:result` → `/oai:cancel`, with a detached worker. The point is ergonomic, not algorithmic — a
local model call costs minutes (measured: ~335s of prefill alone on the dense model at 47k tokens),
and today the session sits and waits for it.

**The stage gate, verbatim from the plan:** a job launched in one Claude session is retrievable from
another, and editing source after submission does not change what the model saw. Both halves get a
test that crosses a real process boundary; the second is the mutation-check target.

### Two prohibitions reversed by the user, both recorded rather than silently edited

`plans/local-llms-like-codex.md`'s `What NOT to build` forbade a queue and SQLite. Both lines were
written by me and Codex; neither came from the user, and both are now reversed at their direction
(2026-08-04 and 2026-08-05). Each turned out to be the *simplifying* choice:

- **Queuing** removed the need for mutual exclusion at submission entirely — two submissions both
  succeed, which is what a queue is for.
- **SQLite** (`node:sqlite`, built into the installed Node 26.3.1, **zero dependencies**) removed the
  rest. Fourteen Codex gate rounds went into building transactional guarantees on a filesystem, and
  each round's fix produced the next round's defect. The parent plan gets an amendment recording both
  reversals.

The memory constraint motivating any of this is unchanged: `estimated_peak 25.10GiB` against
`safe_ceiling 25.08GiB`, so two models resident at once is what pushes this machine into trouble.

### What the probe established

**The reference plugin (`codex` 1.0.6) is a counter-example, not a template.** Its background jobs
**do not survive the session** (`session-lifecycle-hook.mjs:42-75` kills and deletes them on
`SessionEnd`, failing our gate outright); its state writes are non-atomic and `saveState` unlinks live
jobs computed from a stale in-memory list (`state.mjs:105-112`); it has **no liveness probe**; it
snapshots only the prompt and `cwd`, never repo content; and **cancel discards its own return value**
(`codex-companion.mjs:986`), so a job reads `cancelled` while the work continues.

**Load-bearing repo facts, verified by Codex against the files:**

- `runTask` (`cmd-task.mjs:51-110`) is **exactly 60 lines** against `MAX_FUNCTION_LINES = 60` —
  extraction is forced.
- `tests/helpers.mjs` `runCompanion` resolves on **`'close'`, not `'exit'`** (`helpers.mjs:237`). A
  detached child inheriting the parent's piped stdio holds those fds open, so `--background` silently
  becomes foreground and the suite hangs. **The single biggest trap in the feature**, and the one
  finding every round of review reconfirmed.
- `tests/plugin.test.js:68` asserts `commands/*.md` deep-equals the `SPECS` keys; `:73-77` that every
  spec flag appears in the markdown.
- `config.mjs:27-31` `configPath()` is the only path ladder. No state-dir precedent;
  `CLAUDE_PLUGIN_DATA` is referenced nowhere and must not be used — it is set only under the plugin
  harness, so tests and bench would see a different directory.
- `oai-companion.mjs` sets exit codes in one top-level catch with no `process.exit(0)`.
- `prompt.mjs:12-25` `readFileBlocks` reads attachments **eagerly**, before any network work
  (`cmd-task.mjs:62`), so the snapshot is nearly free.

**Verified by running it, not by reading docs** — the two properties the whole design now rests on:

```
AUTOINCREMENT after DELETE:  rows 2,3 deleted → next INSERT got seq 4, never 2   ✓ no reuse
Guarded UPDATE as election:  first  UPDATE … WHERE state='queued'  → changes 1
                             second UPDATE … WHERE state='queued'  → changes 0    ✓ create-once
```

No `ExperimentalWarning` on stderr, which matters because `--json` must stay parseable.

### Decisions taken with the user

1. **Task only.** `schema_version` and `kind` so `/oai:review --background` fits later without a
   migration, but only task is wired. Backgrounding review today would persist a *rendering* rather
   than its canonical outcome, and `/oai:result` could not reconstruct `findings: null` (unparseable)
   from `[]` (clean pass).
2. **Global state dir**, `0700`/`0600`, each row naming its workspace. A bare `/oai:status` filters
   to the current repo, `--all` shows everything, and **anything addressed by job id resolves
   globally**.
3. **The `oai-delegate` subagent is deferred** to a named Stage 1b, recorded rather than dropped.
4. **Retention: newest 50 terminal rows**, active jobs exempt regardless of age.
5. **Two-phase cancel** — `/oai:cancel` reports `cancelling`; only an *observed* worker exit produces
   terminal `cancelled`.
6. **Jobs queue rather than being refused**, and a job may cap how long it waits (`--max-wait`).
7. **SQLite is the store.**

## Design

### The store

`<state>/jobs.db` (`0600`), WAL mode, `busy_timeout` set so concurrent processes wait rather than
fail. State dir ladder mirrors the shape of `configPath()`:
`OAI_PLUGIN_STATE` → `XDG_STATE_HOME/oai-plugin` → `~/.local/state/oai-plugin`.

```sql
CREATE TABLE jobs (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,  -- queue position; NEVER reused after DELETE
  id             TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,                      -- 'task'
  state          TEXT NOT NULL,                      -- queued|running|completed|failed|cancelled|queue-timeout
  schema_version INTEGER NOT NULL,
  workspace      TEXT NOT NULL,
  transport      TEXT NOT NULL,   -- JSON: {name, baseUrl, query} — the EFFECTIVE endpoint
  auth           TEXT NOT NULL,   -- JSON: {mode:'none'} | {mode:'profile', profile, authorizedOrigin}
  model TEXT, context_length INTEGER,
  request        TEXT NOT NULL,   -- JSON DTO; request.messages is canonical
  attachments    TEXT NOT NULL,   -- JSON: [{path, bytes, sha256}]
  created_at TEXT NOT NULL, spawned_at TEXT, started_at TEXT, completed_at TEXT,
  max_wait_ms INTEGER, last_beat_at TEXT, cancel_requested_at TEXT,
  waiter_pid  INTEGER,            -- a worker EXISTS and is waiting; written on start, guarded by state='queued'
  worker_pid  INTEGER,            -- a worker is RUNNING this job; set by the eligibility transaction
  outcome TEXT, failure TEXT      -- jsonReport- / errorReport-shaped
);
```

Only the log stays on disk: `<state>/logs/<seq>.log`, the worker's stdout and stderr.

### What the substrate gives us, and what it replaces

| Guarantee | SQLite mechanism | Replaces (all now deleted) |
|---|---|---|
| Atomic publication | `INSERT` in a transaction — the row is complete or absent | temp file + `linkSync`, `.pub-*` sweeping |
| Position never reused | `AUTOINCREMENT` (verified above) | tombstones, `.floor-<n>` markers, post-link floor re-check |
| Registration vs abandonment | `UPDATE … WHERE seq=? AND worker_pid IS NULL` | `<seq>.startup`, create-once links, compaction dominance |
| Terminal immutability | `UPDATE … WHERE state IN ('queued','running')` | `<seq>.terminal`, election stubs, `effectiveState` |
| One live worker | `BEGIN IMMEDIATE` around the eligibility check + CAS | the whole no-lock protocol, rules 0–3 |
| Locks released on crash | OS-held file locks; an aborted transaction rolls back | every "the process might be suspended" argument |
| Real retention | `DELETE` | tombstones, sidecar reclamation, `.upd-*` ownership proof |

**The eligibility check, the registration and the transition are ONE transaction** — which is what a
dozen rounds of filesystem protocol could not achieve, and splitting any of them apart reintroduces
exactly the defect the substrate was adopted to remove:

```sql
-- On start, long before eligibility: "a worker exists and is waiting."
UPDATE jobs SET waiter_pid=?, last_beat_at=? WHERE seq=? AND state='queued' AND waiter_pid IS NULL;

-- Later, when it may run:
BEGIN IMMEDIATE;
  -- Every 'running' row is a blocker UNLESS it is provably dead. Because state and
  -- worker_pid are now written together, a live row always has a pid; qualifying this
  -- with "AND worker_pid IS NOT NULL" would be a two-concurrent-calls bug.
  SELECT seq, worker_pid, schema_version FROM jobs WHERE state='running';   -- classify, below
  SELECT seq FROM jobs WHERE state='queued' ORDER BY seq;              -- classify, then take first eligible
  UPDATE jobs
     SET state='running', worker_pid=?, started_at=?, last_beat_at=?    -- all four, atomically
   WHERE seq=? AND state='queued' AND waiter_pid=?;   -- and it is still MY row
COMMIT;
```

**`waiter_pid` and `worker_pid` are two different facts and collapsing them broke queuing outright.**
An earlier draft populated a pid only in the eligibility transaction, which meant every legitimately
waiting worker presented `state='queued', worker_pid IS NULL` — *exactly* the abandonment signature.
Any job queued behind a run longer than the 120s grace would have been failed as
`worker-never-started`, destroying the feature this stage exists for, and it also left a queued job
uncancellable (no pid whose death a reader could observe) and made the unknown-version live/dead test
inapplicable to queued rows.

**A `running` row blocks unless it is provably dead, and "provably" differs by version** — without
this the plan contradicted itself and wedged the queue forever:

| `running` row | Blocks? | Why |
|---|---|---|
| live pid | yes | something is genuinely running |
| dead pid, known version | no | reconciled to terminal first, so it stops being `running` at all |
| dead pid, **unknown** version | **no**, and **not mutated** | the versioning rule forbids writing to it; counting it anyway made an unknown-version row block **forever** |
| **NULL** pid | yes, and surfaced in `/oai:status` as a malformed blocker | this build cannot produce it (the two are written atomically), so it is legacy or corrupt — fail closed rather than guess |

**`queued` rows need the same classification, and applying it only to `running` left the identical
wedge one state over.** The head-of-queue selection is not unconditional:

| `queued` row | Head of queue? | Why |
|---|---|---|
| known version | yes — this is the ordinary case | it is ours to run |
| unknown version, **live** `waiter_pid` | **blocks** | a real worker is waiting; we simply cannot read its payload |
| unknown version, **dead** `waiter_pid` | **skipped, untouched** | it will never run, and the versioning rule forbids writing to it — so it must not hold the line either |
| unknown version, **NULL** `waiter_pid`, within the 120s grace | blocks | it may still be starting |
| unknown version, **NULL** `waiter_pid`, past the grace | **skipped, untouched** | nothing can start it and nothing may mutate it; blocking forever helps no one |

Skipping is deliberate and is not the same as abandoning: the row is left exactly as it is for the
newer plugin that wrote it, and the queue simply moves past it.

`changes()` tells the worker whether it won; a loser waits and re-evaluates.

**"Registration" means two different things and the plan previously used the word for both.** *Waiter*
registration happens on worker start, well before eligibility, and records that a worker exists.
*Owner* registration is atomic with the transition to `running`. So there is no window in which a job
is running without an owner, and no window in which a waiting worker looks unspawned — but those are
two separate guarantees from two separate writes, not one.

**`SQLITE_BUSY` after `busy_timeout` is retried, never terminalized.** A writer that times out has
learned nothing about any job; treating it as a failure would kill live work because the database was
briefly contended.

### The one boundary SQLite does not cover: publication versus spawn

Committing the row and spawning the worker cannot be one transaction, so a submitter that dies
between them leaves a head-of-queue row that will never acquire an owner. Waiting forever wedges the
queue; treating a null pid as immediate abandonment races an ordinary slow spawn.

The bound is explicit and the CAS is what makes a late worker safe:

- A `queued` row with **`waiter_pid IS NULL`** — no worker ever registered — past `spawned_at + 120s`
  (or `created_at + 120s` when the submitter died before spawning at all) is failed as
  `worker-never-started` **by a guarded
  `UPDATE … WHERE seq=? AND state='queued' AND waiter_pid IS NULL`** — create-once by construction.
  **A worker that has registered is never abandoned, however long it waits**, which is what makes an
  indefinite `--max-wait` coherent with a 120s grace.
- **A late worker needs no cooperation to be safe.** Its eligibility transaction requires
  `state='queued'`; against a row already moved to `failed` the `UPDATE` matches nothing,
  `changes()` is 0, and it exits **without contacting the server**. The guard that elects a winner is
  the same guard that protects the loser.

### What survives from the filesystem design, unchanged

These findings were substrate-independent and carry over verbatim:

- **The snapshot is `request.messages`, built at submission and canonical.** The worker never touches
  the filesystem for input, so gate half 2 is true by construction rather than by discipline.
  `attachments` carries digests so a reader can see which files, and whether they have since changed.
- **The record persists the *effective transport*, not an origin.** An origin drops the `/v1` path,
  query parameters and an explicit `--base-url`, so a worker rebuilding from `provider` alone would
  call a different endpoint than submission validated.
- **The credential is not stored, but the authorization *decision* is** — `{mode:'none'}` or
  `{mode:'profile', profile, authorizedOrigin}`. The worker sends a key only if **all three** agree:
  `current profile's origin === authorizedOrigin === persisted transport origin`. All three, because
  comparing only the last two is tautological — both came from submission. The current config is the
  only term carrying information: a profile that has since moved from A to B and gained a new key
  would otherwise have B's credential sent to A.
- **One exception, and the previous plan's claim was false without it.** `normalizeBaseUrl` preserves
  `url.search` verbatim (`config.mjs:122`), so a `--base-url` carrying `?api_key=…` puts a **real
  secret into stored job state**. "The credential is never persisted" was untrue. Submission now
  **warns explicitly** when the base URL query is non-empty, the DB is `0600`, and a backlog item
  covers redaction. Stated rather than quietly relied on.
- **The persisted request is a DTO.** One rule: a field whose foreground value is `undefined` is
  absent from the DTO and from the reconstructed request; `null` is invalid rather than a second
  spelling of absence — matching `client.mjs:41`. `expiresAt` is **not** persisted (it derives from
  `performance.now()`, per-process); persist `maxMs` and mint it in the worker. The ledger has
  methods and is recreated. Only resolved values are stored, since `send()` rejects a non-positive
  first-byte budget (`http.mjs:242`). The DTO covers everything `cmd-task.mjs:81` assembles.
- **Liveness reads whichever pid the row's state makes relevant** — `waiter_pid` while `queued`,
  `worker_pid` while `running` — so a queued worker's death is observable and a queued job can
  therefore reach terminal `cancelled` like any other. **The pid decides death, the heartbeat only
  corroborates.** "Beat fresh ⇒ alive" is false
  and deadlocks cancellation, since a worker's last act is to beat. Pid dead ⇒ terminal immediately.
  Pid alive + stale beat ⇒ `stalled`, derived at read time. Past its deadline with a live pid ⇒
  `overdue`. **No reconciler terminalizes a job whose pid is alive** — scoped to reconcilers, so a
  worker may still end its own run on cancel or `--max-wait`.
- **The trilemma, and its chosen corner.** Finite stale-worker recovery, zero overlap, and no
  signalling cannot all hold. Releasing at a deadline buys recovery by paying in overlap. So nothing
  terminalizes a live pid; a suspended or recycled-pid worker wedges the head of the queue;
  `/oai:status` names the blocking pid so the user can act. **The plugin never signals a process it
  cannot verify** — a recycled pid means the signal could land on something else entirely. How
  bounded that is for successors depends on `--max-wait`, whose default is indefinite.
- **Cancel is cooperative and signal-free.** `/oai:cancel` sets `cancel_requested_at`, **re-reads**,
  and reports the terminal state if the job finished in between — otherwise `cancelling`. The worker
  sees it at its next beat and **exits**; a later reader observes the dead pid and writes terminal
  `cancelled`. Only an observed exit produces it.

  **The exit mechanism is named, because the obvious one does not work.** Setting `process.exitCode`
  leaves the process alive — the open socket and the heartbeat timer keep the loop running, and the
  request continues. The heartbeat callback therefore calls **`process.exit()` explicitly**, which
  closes the socket and is what makes "no `AbortController`" true (a deliberate deviation from
  OAI-3's note). The same applies to `--max-wait` expiry.
- **`--max-wait` fires while the job is still ineligible**, which the filesystem draft's own rules had
  made impossible. It terminalizes as `queue-timeout` **without sending a chat completion** — but
  submission has already probed `/v1/models` via `resolveTarget` (`delegate.mjs:132-138`), so the
  guarantee is scoped to the expensive request, not to "no traffic".
- **The worker: hidden `task-worker --seq <seq>`**, one flag name everywhere (the previous draft
  contradicted itself with `--job <id>`), filtered out of the unknown-command list.
  `stdio: ['ignore', log, log]` — **never `'inherit'`, never a pipe** — `unref()` **after** awaiting
  `'spawn'` vs `'error'`, since spawn failure is usually an async event and an unresolved promise does
  not keep node alive. The worker **beats immediately** on start, or every new job reads `stalled` for
  ten seconds.
- **Versioning is two separate things, and conflating them was a defect.** A row-level
  `schema_version` does not version the *table*: a newer plugin could add a `NOT NULL` column or
  change lifecycle semantics, and an older executable would fail — or mutate — before it ever looked
  at a row.

  - **Database level: `PRAGMA user_version`.** A database newer than this build is **refused for all
    mutations** — `/oai:status` may read and say so, nothing writes, no migration runs. Refusing is
    coherent; silently migrating or interpreting familiar-looking columns is not.
  - **Row level: a stable lifecycle envelope**, versioned separately from the payload. `seq`, `id`,
    `state`, `waiter_pid`, `worker_pid`, the timestamps and `schema_version` **never change meaning
    across versions**; `request`, `outcome` and `failure` may. That is what lets an older build read a newer
    row's liveness *without* interpreting its payload.

  With that split the three contradictions the previous draft carried all resolve. An unknown-version
  row is **never mutated and never deleted**: a *live* one blocks the queue (something is genuinely
  running); a *dead* one is **skipped by eligibility rather than terminalized**, so it neither blocks
  nor gets written to — the earlier text claimed it would "go inert while untouched" while the queue
  SQL kept selecting it. Retention likewise **excludes unknown-version rows from deletion**, which the
  previous "newest 50 terminal rows" sweep would have destroyed outright.
- **Known gap, recorded:** foreground `/oai:task` and `/oai:review` do not participate, so the
  invariant is honestly "one *background* job at a time". A backlog item covers it.
- **The suspended-process wedge now also reaches status operations, and that is wider than before.**
  SQLite releases a *crashed* process's writer lock, but a *suspended* one keeps it — so after
  `busy_timeout` expires, other processes' writes fail with `SQLITE_BUSY`. Reads are unaffected under
  WAL. Recorded and tested rather than discovered later; the retry rule above is what keeps it from
  being mistaken for a job failure.
- **The server-side question is now MEASURED, not assumed** (2026-08-05, `qwen/qwen3.6-35b-a3b`, this
  machine, nothing else resident). Killing a client mid-generation produced, in the same second:

  ```
  [LM STUDIO SERVER] Client disconnected. Stopping generation...
                     (If the model is busy processing the prompt, it will finish first.)
  [qwen/qwen3.6-35b-a3b] Finished streaming response
  ```

  and `lms ps` showed the model `IDLE` 120s later. **So exiting the worker really does stop
  server-side generation, and the queue's guarantee is one server-side computation rather than merely
  one dispatched client request.** That was round 14's blocking finding and it is resolved by evidence.

  **The bound the server states itself: a disconnect during *prefill* lets prefill finish.** That is
  the expensive half here — ~335s dense at 47k tokens, ~67s MoE — so a cancelled or dead job can hold
  the server for the remainder of its prefill after the queue has moved on. Two cases: the next job
  uses the **same** model, which is only a slowdown; or a **different** one, whose JIT load overlaps
  that prefill and is the two-models-resident case the memory ceiling forbids. Bounded by one prefill,
  stated here, and not mitigated further — polling `lms ps` for idleness would be a vendor-specific
  check in a plugin that is generic by construction (ADR 001). A backlog item records it.

  **The first attempt at this measurement failed and is recorded rather than quietly rerun:**
  `google/gemma-4-12b-qat` was refused at load as needing ~44.87 GB on a 36 GB machine, so no
  inference ran and the bytes observed were an error response. Nothing was concluded from it. The
  instrument now confirms real streaming before it kills anything.

## Phases

**Phase 0 — extract the executor.** `runTask` is at 60/60, so this is forced and comes first. Split
into a plan-builder, `task-execute.mjs` returning an outcome object, and `task-report.mjs` rendering
it. **No behaviour change**; `tests/task.test.js` passes unweakened. Three things the extraction must
preserve: `expiresAt` still minted immediately before the call; the `durationMs` boundary; and
`requireAnswer` late enough that the substitution notice still precedes an empty-answer failure
(`cmd-task.mjs:103-108`).

**Phase 1 — the spike, before anything real is wired.** `job-store.mjs` (schema, migrations, the
transactional helpers) plus a *skeleton* worker that re-execs detached, writes one row and exits, and
`tests/background.test.js` driving it through the real companion. The risky unknown gets proved
first. Two things only running it can settle: the test must not close the fake server until the job
is terminal, and the temp `providers.json` needs tiny timeouts so a failure does not drag retries
through the suite.

**Phase 2 — real submission.** `--background`, `--max-wait`: resolve config, read attachments, probe
the target, decide the auth policy, warn on a non-empty base-URL query, default `--max-seconds` to
3600, `INSERT` the row, spawn, await `'spawn'`/`'error'`, print the id.

**Phase 3 — the queue.** The `BEGIN IMMEDIATE` eligibility transaction, the wait loop,
`queue-timeout`, and reconciliation of dead entries at the head of the line.

**Phase 4 — `/oai:status` and `/oai:result`**, with read-time reconciliation, `stalled`, `overdue`.

**Phase 5 — `/oai:cancel`**, cooperative and signal-free.

**Phase 6 — retention.** `DELETE` beyond the newest 50 terminal rows in one transaction with its
`SELECT`; active jobs and unknown-`schema_version` rows exempt; the log file goes with the row, plus
an **orphan-log sweep** — deleting the row and unlinking `<seq>.log` cannot be one transaction, so a
crash between them would otherwise leak a log permanently.

**Phase 7 — docs and tracker.** `adr/014-async-jobs.md`, the CLAUDE.md architecture paragraph, a
REPO_TRAPS entry for the detached-stdio trap, OAI-3 → `BACKLOG_DONE.md`, and items for the deferrals
(`/oai:review --background`; `agents/oai-delegate.md`; foreground paths joining the queue; query-string
credential redaction; and whatever the disconnect measurement leaves open).

## Verification

- `npm test` green, quoting the summary line; report the wall-clock the new tests add.
- The repo `verify` skill.
- **Gate half 1** — submit in one `runCompanion` invocation, read in a **separate** `runCompanion
  status` invocation. Two processes is that gate as tightly as a test can state it. Plus: **no session
  identifier appears in the row**, which is exactly what the reference plugin's session sweep depends
  on.
- **Gate half 2, and the mutation target — using a barrier that already exists in the code.**
  Racing an edit against submission is not a valid target (`runCompanion` resolves when the
  *submitter* closes, and `startFakeServer` records a request only after its body arrives, so the
  mutation could stay green on scheduling alone). Hand-inserting the row and launching the worker is
  better but proves only that a worker consumes an already-persisted DTO — **not that the real
  submission path produced it**, which is half the gate.

  The code supplies a deterministic barrier: attachments are read at `cmd-task.mjs:62`, *before*
  `resolveTarget` probes `/v1/models`. So **the fake `/models` handler mutates the file before
  replying**, and the test then asserts the eventual chat completion carries the **original** bytes.
  One run of the real `--background` command exercises submission, SQLite, the detached worker and
  the snapshot guarantee, with no scheduling race anywhere. Mutation: make the worker re-read
  attachments from disk; that test must go red. Proved with `~/Code/dotfiles/tests/mutation-landed.py`.
- **One test per defect the gate rounds found that still applies:**
  - two workers racing for the head of the queue: exactly one transitions to `running`, driven by
    concurrent `BEGIN IMMEDIATE` transactions from separate processes;
  - **`state='running'` and `worker_pid` are never observable apart** — asserted as atomicity, since
    the earlier plan called for exposing that window and the amended transaction makes it
    unreachable; a test that cannot fail is not a test;
  - a **synthetic malformed row** (`running`, NULL pid, as only a legacy or corrupt writer could
    produce) blocks the queue and is named in `/oai:status`;
  - an **unknown-version `running` row with a dead pid does not block and is not written to** — the
    self-contradiction that would otherwise wedge the queue permanently;
  - the same for an unknown-version **`queued`** row: a live waiter blocks, a dead one is skipped
    untouched, and a NULL waiter blocks only within the grace — the symmetric wedge, one state over;
  - a worker that loses the eligibility CAS **contacts nothing** — asserted on the fake server;
  - a submitter that dies **after committing the row but before spawning** is bounded: the row is
    failed as `worker-never-started`, and a late worker arriving afterwards loses the guarded
    registration and exits without dispatching;
  - a **legitimately registered worker waiting well past the 120s grace is NOT abandoned** — the
    case that would have broken queuing entirely, driven by a first job that runs longer than the
    grace;
  - **cancelling a still-queued job reaches terminal `cancelled`**, via the death of its
    `waiter_pid` — impossible while a queued row carried no pid at all;
  - reconciliation during a deliberately paused publication/spawn window does not terminalize a job
    whose worker is merely slow to start;
  - a **`SQLITE_BUSY` expiry is retried, never terminalized** — a contended database must not kill
    live work;
  - a **real process killed mid-transaction** releases its lock and leaves either the pre-transaction
    or the committed state, never a partial one;
  - a **database with a newer `PRAGMA user_version` is refused for every mutation** while status can
    still report it;
  - an unknown-`schema_version` row is **never mutated and never deleted by retention**, a live one
    blocks the queue, and a dead one is skipped rather than terminalized;
  - an orphaned `<seq>.log` whose row is gone is swept;
  - a job published later cannot sort ahead of one already published, and a `DELETE` never lets a
    sequence be reused;
  - a **live pid with a stale heartbeat stays non-terminal**; a dead pid terminalizes; a job past its
    deadline with a live pid is `overdue` but non-terminal;
  - the submitter writes the row **exactly once** on the success path — counted through an injected
    store, **not** by mtime, since an mtime is the last write rather than a count or an identity;
  - a spawn `'error'` event (not a synchronous throw) marks the job failed;
  - `--max-wait` fires **while another job is running ahead of it**, terminalizing as `queue-timeout`
    with **no chat completion** (the submission-time `/v1/models` probe is expected and asserted as
    the only request);
  - cancel sets only its column; the worker exits without terminalizing; the **next read** produces
    `cancelled`; and cancel reports the terminal state when the job finishes between its two reads;
  - a profile that moved origin between submission and worker start yields `credential-unavailable`
    rather than sending the new key to the old endpoint — asserted on the wire;
  - `reconstructRequest` **omits** an absent `temperature` rather than sending `null` — asserted on
    the body the fake server received, not on the DTO;
  - an unknown `schema_version` row is neither reinterpreted nor destroyed;
  - a **structural guard that no source file signals a process** (no `process.kill(` except a liveness
    probe with signal `0`) — cancel's safety property is exactly the kind that erodes under a later
    "make it stop faster" edit;
  - a structural guard that the worker spawn never uses `'inherit'` or a pipe.
- New test files throughout — `tests/job-store.test.js`, `tests/queue.test.js`,
  `tests/background.test.js`, `tests/job-helpers.mjs`, `tests/structure-jobs.test.js`.
  `tests/task.test.js` (299), `tests/helpers.mjs` (298) and `tests/structure.test.js` (300) have no
  room, and an ALLOWLIST entry would silently disable two guards.
- **One real end-to-end run against LM Studio** — submit a short background task, retrieve it from a
  separate invocation. Seconds, not the multi-hour bench.

## Review

`advisor` → `review-lean` → **wide mode**, which this triggers on its own terms: it introduces
modules carrying process-lifecycle and persistence assumptions.

## Challenge thread — 19 rounds, ~74 findings, all accepted, APPROVED at round 19

**Every finding was accepted; none was argued down.** The substrate change means they now split into
two groups, and saying which is which is the honest accounting.

**Dissolved by moving to SQLite** — these were defects in a filesystem protocol that no longer
exists, and are recorded because they are the *reason* for the change, not because they still need
fixing: the four rounds spent building a mutex out of `wx` files (a time-broken lock is not a mutex,
since suspension applies inside short critical sections too); `<seq>-<id>.json` not being an exclusive
pathname, so two submitters both "won"; `wx` creating a name but not the bytes, so publication was not
atomic; tombstones freeing sequence numbers and reopening late publication; a mutable `.floor` that
could regress under concurrent pruners; election markers deleted by retention, reopening elections;
an "optional projection" that could resurrect a pruned job; `effectiveState` needed because the
verdict and the record could disagree; `.upd-*` reclamation proving the wrong process was dead; and
an unbounded directory in three separate forms. **SQLite answers every one with a transaction, an
`AUTOINCREMENT`, a guarded `UPDATE`, or a `DELETE`.**

**Carried into this plan, substrate-independent:** the `runCompanion` `'close'` trap and the detached
stdio arrangement; canonical `messages` for the snapshot gate; the effective-transport persistence;
the three-way credential-origin check *and* the query-string credential leak that made the
non-persistence claim false; the DTO absence-vs-`null` rule with `expiresAt` minted per-process; the
liveness ladder and the trilemma's chosen corner; never signalling an unverifiable pid; cooperative
cancel with its post-write re-read; `--max-wait` needing to fire while ineligible; `queue-timeout`
scoped to "no chat completion" because submission probes `/v1/models`; async spawn `'error'` and
`unref()` ordering; the immediate first heartbeat; unknown-schema rows being neither reinterpreted nor
destroyed; the mutation test needing a deterministic window; the rule-1 test not being mtime-based;
`--seq` used consistently; and the server-side-inference caveat now being measured rather than assumed.


### Rounds 15–19 — the SQLite plan

**15 (3 findings).** The eligibility SQL could permit two model calls: qualifying the blocker with
`AND worker_pid IS NOT NULL` made a row that had reached `running` but not yet registered invisible
to the next worker. ⇒ one transaction sets state, pid, `started_at` and the first beat together, the
blocker counts every running row, and `SQLITE_BUSY` is retried rather than terminalized. Also:
publication-versus-spawn is not transactional ⇒ a bounded `worker-never-started` transition whose CAS
also makes a late worker exit safely; and a row-level version does not version the *table* ⇒
`PRAGMA user_version` with a newer database refused for all mutations, plus a stable lifecycle
envelope separate from the payload. Codex additionally supplied the mutation-test barrier that already
exists in the code — attachments are read *before* the `/models` probe, so the fake handler can mutate
the file before replying — replacing a test that proved only that a worker consumes a persisted DTO,
not that the real submission path produced it.

**16 (1).** The round-15 fix made every legitimately waiting worker present
`state='queued', worker_pid IS NULL` — the abandonment signature — so anything queued behind a run
longer than the grace would have been failed as `worker-never-started`, destroying queuing itself.
⇒ `waiter_pid` (a worker exists) split from `worker_pid` (a worker is running).

**17 (2).** Eligibility counted every running row while the versioning rule forbade mutating a dead
unknown-version one, so such a row blocked forever ⇒ blockers classified by version and liveness. And
the plan specified **a test that could not fail** — exposing a "running with null pid" window that the
now-atomic transaction makes unreachable ⇒ replaced with an atomicity assertion and a synthetic
malformed-row test.

**18 (1).** The same wedge one state over: `running` rows were classified but the head-of-queue
selection was unconditional, so a dead unknown-version *queued* row sat at the head forever
⇒ symmetric classification, with skipping explicitly distinguished from abandoning. Plus the
overloaded word "registration" split into waiter and owner registration.

**19 — APPROVE.** *"I found no new contradiction or implementation-blocking defect… The stated
SQLite-lock, PID-reuse, cancellation-during-prefill, and query-string-secret risks are explicit and
bounded or deliberately fail closed, with corresponding verification. The plan is implementable
against the named files."*

### What the gate actually bought

Beyond the concurrency protocol, findings that would otherwise have shipped: a cancel that would have
sent `SIGTERM` to a pid the plan itself admitted might be recycled — potentially killing an unrelated
process; a credential check comparing two values both derived from submission, and so tautological; a
`--base-url` query string silently persisting an API key while the plan claimed credentials were never
stored; two tests that could not fail; and `--max-wait` capping nothing because two rules contradicted
each other. The measurement of LM Studio's disconnect behaviour also converted the queue's central
promise from an assumption into evidence — and its first attempt failed outright, which is recorded
rather than quietly rerun.
