# 014 — Background jobs: a database, not a protocol

Date: 2026-08-05
Status: accepted (OAI-3, Stage 1 of `plans/local-llms-like-codex.md`)

## Correction, 2026-08-05 — three claims below are wrong, and the text is left standing

Added after the OAI-58 review ladder (one pass, seven stages) ran over this feature. Following this
repo's convention, the original text is **not rewritten**: it records what was believed when the
decision was taken, and the corrections are stated here against it.

1. **"`/oai:status` names the blocking pid for the user to deal with by hand" (~line 180) does not
   hold.** `job-view.mjs:127` gates cross-workspace visibility on `row.state === 'running'`, but every
   queued blocker — a live unknown-version waiter, a `malformed` row, a `starting` row, the plain
   queued head — has `state='queued'`. So the blocker is filtered out, and the note explaining it is
   computed one line earlier and discarded. **This matters beyond the display**, because the
   recycled-pid wedge is accepted here *on the condition* that the user can see and resolve it. That
   condition is not met, so the trilemma was traded for something that does not currently exist.
   Filed as OAI-64; the wedge itself is OAI-69.

2. **The three-origin credential rule is stated correctly and is the wrong granularity.** The rule at
   ~147-152 is three *origins*, and the code implements exactly that — so this is not a violation of
   the ADR's letter. But ~143-145 already notices that "an origin drops the `/v1` path, the query
   string", and does not follow it through: a same-origin tenant move hands the **new** key to the
   **old** endpoint. Proved on the wire against a real server, with the `apiKeyEnv` swap variant
   sending an unrelated inherited secret. The harm this section names as its own justification
   therefore still happens, one path segment down. Filed as OAI-63.

3. **"The credential itself is never stored" (`job-auth.mjs:2-3`, echoed here) is defeated by the
   warning meant to protect it.** `task-submit.mjs:37-40` interpolates the base URL's query string
   verbatim into stderr, and `commands/task.md:57` invokes the companion with no redirection, so a
   query-string credential enters the session transcript. The `0600`/`0700` mitigation this ADR relies
   on does not apply to that channel. Filed against OAI-55.

Two further gaps in mechanisms this ADR describes, neither contradicting its text: the newer-database
refusal is checked only when a connection opens, so an in-flight worker bypasses it (OAI-68); and the
`SQLITE_BUSY`-is-retried property does not hold in the heartbeat, where an uncaught throw kills a
running worker mid-model-call (OAI-62).

## Context

A local model call costs minutes — measured, ~335s of *prefill alone* on the dense 27B at 47k prompt
tokens — and until now the Claude session sat and waited for it. `/oai:task --background` returns a
job id instead, and `/oai:status`, `/oai:result` and `/oai:cancel` address it afterwards from any
directory and from **any session**.

The gate this stage was built to pass, stated before any code existed:

> A job launched in one Claude session is retrievable from another, and editing source after
> submission does not change what the model saw.

Both halves are tested across a real process boundary. The second is the mutation target.

**The reference plugin (`codex` 1.0.6) is a counter-example, not a template**, and reading it is what
set the requirements. Its background jobs **do not survive the session** — `session-lifecycle-hook.mjs`
kills and deletes them on `SessionEnd`, which fails our gate outright; `saveState` unlinks live jobs
computed from a stale in-memory list; there is no liveness probe; it snapshots the prompt and `cwd`
but never repo content; and its cancel discards its own return value, so a job reads `cancelled`
while the work continues.

## The decision, and the two prohibitions it reverses

`plans/local-llms-like-codex.md`'s *What NOT to build* forbade **a queue** and **SQLite**. Both lines
were written by me and Codex, neither came from the user, and both were reversed at the user's
direction (2026-08-04, 2026-08-05). Each turned out to be the *simplifying* choice, which is the
whole content of this ADR:

- **Jobs queue rather than being refused.** The prohibition existed to keep two model calls off one
  server at once. A queue delivers that *and* removes the need for mutual exclusion at submission
  entirely: two submissions both succeed, which is what a queue is for. Refusing the second would
  have needed a lock at submission time — the thing that has to be correct — to deliver a worse
  outcome.
- **SQLite is the store** (`node:sqlite`, built into the installed Node 26.3.1, **zero
  dependencies**). Fourteen challenge rounds went into building transactional guarantees on a
  filesystem, and each round's fix produced the next round's defect. The substrate answers every one
  of them with a mechanism that was already correct.

| Guarantee | SQLite mechanism | What it replaced, now deleted |
|---|---|---|
| Atomic publication | `INSERT` in a transaction — the row is complete or absent | temp file + `linkSync`, `.pub-*` sweeping |
| Position never reused | `AUTOINCREMENT` | tombstones, `.floor-<n>` markers, post-link floor re-checks |
| Registration vs abandonment | `UPDATE … WHERE seq=? AND worker_pid IS NULL` | `<seq>.startup` files, create-once links, compaction dominance |
| Terminal immutability | `UPDATE … WHERE state IN ('queued','running')` | `<seq>.terminal`, election stubs, `effectiveState` |
| One live worker | `BEGIN IMMEDIATE` around the eligibility check and the CAS | the entire no-lock protocol, rules 0–3 |
| Locks released on crash | OS-held locks; an aborted transaction rolls back | every "the process might have been suspended" argument |
| Retention | `DELETE` | tombstones, sidecar reclamation, `.upd-*` ownership proofs |

Two properties were **verified by running them** before the design rested on them, rather than read
off documentation: `AUTOINCREMENT` does not reuse a deleted `seq` (rows 2 and 3 deleted, next
`INSERT` got 4), and a guarded `UPDATE` is an election (first `UPDATE … WHERE state='queued'` changes
1, the second changes 0). Also that `node:sqlite` prints no `ExperimentalWarning` on stderr, which
matters because `--json` must stay parseable.

`scripts/lib/job-store.mjs` is the only place this repo opens a database, as
[ADR 007](007-owning-the-transport.md)'s `http.mjs` is the only place it speaks HTTP.

## The eligibility transaction, and the two pids that are not one pid

**The eligibility check, the OWNER registration and the transition are ONE transaction** — which a dozen
rounds of filesystem protocol could not achieve, and splitting any part out reintroduces exactly the
defect the substrate was adopted to remove. **Owner registration, not waiter registration** — the two
are different facts and this ADR's own vocabulary splits them. The waiter update is the first
statement below, and it runs on worker start, outside and long before this transaction; what happens
inside it is the `worker_pid` write that takes ownership. Said explicitly because the unqualified word
made this sentence false against the SQL printed directly beneath it (OAI-67, review pass 2).

```sql
-- On worker start, long before eligibility: "a worker exists and is waiting."
UPDATE jobs SET waiter_pid=?, last_beat_at=? WHERE seq=? AND state='queued' AND waiter_pid IS NULL;

-- Later, when it may run:
BEGIN IMMEDIATE;
  SELECT seq, worker_pid, schema_version FROM jobs WHERE state='running';  -- blockers, classified
  SELECT seq FROM jobs WHERE state='queued' ORDER BY seq;                  -- candidates, classified
  UPDATE jobs SET state='running', worker_pid=?, started_at=?, last_beat_at=?
   WHERE seq=? AND state='queued' AND waiter_pid=?;   -- …and it is still MY row
COMMIT;
```

**`waiter_pid` and `worker_pid` are two different facts, and collapsing them broke queuing outright.**
An earlier draft wrote a pid only in the eligibility transaction, so every legitimately waiting worker
presented `state='queued', worker_pid IS NULL` — *exactly* the abandonment signature. Anything queued
behind a run longer than the 120s grace would have been failed as `worker-never-started`, destroying
the feature this stage exists for. It also left a queued job uncancellable, there being no pid whose
death a reader could observe.

The word **"registration" means two different things** and the plan used it for both until that was
split. *Waiter* registration happens on worker start and records that a worker exists; *owner*
registration is atomic with the transition to `running`. Two guarantees, two writes.

**A `running` row blocks the queue unless it is provably dead, and "provably" differs by version.**
Without this classification the design contradicted itself and wedged the queue forever:

| `running` row | Blocks? | Why |
|---|---|---|
| live pid | yes | something is genuinely running |
| dead pid, known version | no | reconciled to terminal first, so it stops being `running` at all |
| dead pid, **unknown** version | **no**, and **not mutated** | the versioning rule forbids writing to it; counting it anyway made such a row block **forever** |
| **NULL** pid | yes, and surfaced by `/oai:status` as a malformed blocker | this build cannot produce it, so it is legacy or corrupt — fail closed rather than guess |

**`queued` rows need the same classification, and applying it only to `running` left the identical
wedge one state over** — a dead unknown-version queued row would sit at the head of the line forever.
A live `waiter_pid` blocks; a dead one is **skipped and left untouched**; a NULL one blocks only
within the 120s grace. Skipping is not abandoning: the row is left exactly as the newer plugin wrote
it, and the queue moves past it.

**`SQLITE_BUSY` after `busy_timeout` is retried, never terminalized.** A writer that timed out has
learned nothing about any job, and treating it as a verdict would kill live work because the database
was briefly contended. `isBusy` lives in `job-store.mjs` because it is a fact about SQLite rather than
about any one caller.

## The one boundary SQLite does not cover: publication versus spawn

Committing the row and spawning the worker cannot be one transaction, so a submitter that dies
between them leaves a head-of-queue row that will never acquire an owner. Waiting forever wedges the
queue; treating a null pid as immediate abandonment races an ordinary slow spawn. The bound is
explicit, and the CAS is what makes a late worker safe:

- A `queued` row with **`waiter_pid IS NULL`** past `spawned_at + 120s` (or `created_at + 120s`, when
  the submitter died before spawning at all) is failed as `worker-never-started` by a guarded
  `UPDATE … WHERE seq=? AND state='queued' AND waiter_pid IS NULL` — create-once by construction.
  **A worker that has registered is never abandoned however long it waits**, which is what makes an
  indefinite `--max-wait` coherent alongside a 120s grace.
- **A late worker needs no cooperation to be safe.** Its eligibility transaction requires
  `state='queued'`; against a row already failed the `UPDATE` matches nothing, `changes()` is 0, and
  it exits **without contacting the server**. The guard that elects a winner is the guard that
  protects the loser.

### The submitter closes its own end of that boundary — and holds less knowledge than it looks (OAI-67, 2026-08-12)

The bound above is a *reconciler's* 120-second grace. Until OAI-67 nothing shortened it from the
submitter's side: when `spawnWorker` rejected, the row was simply left, so the queue behind it waited
out the full grace for an owner that was usually never coming. The submitter now **attempts a guarded terminal
write** on that row — through **the same `UPDATE … WHERE seq=? AND state='queued' AND waiter_pid IS
NULL`**, reached as `abandonUnstarted`, not through `finish`. *Attempts*, because the CAS may
deliberately match nothing: that is the mechanism working, not failing.

**Using that CAS rather than `finish` is the whole of the decision, because a rejection does not
establish that no child exists.** `spawnWorker` awaits the `'spawn'` event and only then closes its
copy of the log descriptor; a throw from that close rejects after a detached worker was created and
may still be running.
`finish` admits `state IN ('queued','running')` — deliberately, so a worker can publish over its own
live row — and would therefore flip a *running* row to `failed` and null its `worker_pid`, after
which terminal immutability stops the real worker ever publishing. Paid work may be lost, behind a
row asserting a failure that did not happen — *may*, because a `running` row establishes that a worker
acquired the job, not that a billable call had begun.

The CAS makes both orderings safe, and **the second half of the safety is the property already stated
above rather than anything new**: if the child registered first, the submitter's write matches nothing
and the job is left to the worker's own lifecycle; if the submitter's write lands first, the late
worker stops at its own
guarded `registerWaiter` — which requires the same `state='queued' AND waiter_pid IS NULL` — and
returns before it sends anything (`cmd-task-worker.mjs:260`). It never reaches the eligibility
transaction described above; that is the *second* line of the same defence, not the first. Either way
the guard that elects a winner is the guard that protects the loser — read here from the submitter's
side.

What the row may CLAIM is bounded by the same uncertainty: the failure carries
`reason: 'worker-launch-unconfirmed'`, never `spawn-failed`, because in the admitted ordering a worker
process did start. The root ambiguity in `spawnWorker`'s contract is filed as **OAI-145** and
deliberately not fixed here; this is containment, and it is complete on its own terms.

### Two defaulted seams, and why neither is a runtime knob

`submitTask` takes `{ spawn = spawnWorker }` and `terminalizeSpawnFailure` takes `{ report =
reportToStderr }`. Both are defaulted parameters that no production caller passes, and both exist
because the paths they reach are otherwise unreachable from a test: `spawnWorker` is a static import
called unparameterised, and `writeSync` is an ESM named import whose binding a test cannot patch —
measured, after a probe patched `node:fs` and watched the real function run anyway.

**An environment variable overriding the worker's executable path was rejected**, though it would have
made the spawn testable too. It ships a runtime override of *which binary this plugin launches
detached* — a product capability nobody asked for and a durable one, readable and settable by anything
that can set an env var, in the one place in this repo that starts a process meant to outlive its
parent. A defaulted parameter is reachable only by a caller already inside the module graph, which is
to say by the tests. The seam should be as wide as the test needs and no wider.

## The snapshot: `request.messages` is canonical

The prompt, every attached file's full text, and the resolved request options are built **at
submission** and stored as a DTO. The worker never touches the filesystem for input, so the gate's
second half is true by construction rather than by discipline. `attachments` carries `{path, bytes}`
so a reader can see which files were sent and how much of each was captured. **It does NOT carry a
hash** — this sentence claimed `sha256` until OAI-67's review pass 2, and `digestsOf`
(`task-submit.mjs`) has never computed one, so "whether they have since changed" was a capability
described here and absent from the code.

The DTO has one rule, matching `client.mjs`: a field whose foreground value is `undefined` is
**absent** from the DTO and from the reconstructed request; `null` is invalid rather than a second
spelling of absence. `expiresAt` is **not** persisted — it derives from `performance.now()` and is
per-process — so `maxMs` is stored and the deadline minted in the worker.

**The record persists the effective transport, not an origin.** An origin drops the `/v1` path, the
query string and an explicit `--base-url`, so a worker rebuilding from `provider` alone would call a
different endpoint than the one submission validated.

**The credential is never stored; the authorization *decision* is** — `{mode:'none'}` or
`{mode:'profile', profile, authorizedOrigin}`. The worker sends a key only if **all three** agree:
the current profile's origin, `authorizedOrigin`, and the persisted transport's origin. All three,
because comparing only the last two is tautological — both came from submission, and the current
config is the only term carrying information. A profile that has since moved from host A to host B
and gained a new key would otherwise send B's credential to A.

That last sentence is the one `tests/job-auth.test.js` executes (added 2026-08-05, after this feature
shipped without it): a real submission, a real detached worker, and `providers.json` repointed in the
window between them while the queue is held open — the worker refuses, and contacts the endpoint not
at all. It carries a positive control in the same file, because a worker that died before ever
reaching the check satisfies every assertion in the refusal case.

**One exception, stated rather than quietly relied on.** `normalizeBaseUrl` preserves `url.search`
verbatim, so a `--base-url` carrying `?api_key=…` puts a real secret into stored job state. "The
credential is never persisted" was untrue without this sentence. Submission **warns explicitly** when
the base-URL query is non-empty (the user's decision: warn, do not refuse), the database is `0600` and
the state directory `0700`, and redaction is a backlog item.

## Liveness, the trilemma, and why nothing is ever signalled

**Liveness reads whichever pid the row's state makes relevant** — `waiter_pid` while `queued`,
`worker_pid` while `running` — so a queued worker's death is observable and a queued job can reach
terminal `cancelled` like any other.

**The pid decides death; the heartbeat only corroborates.** "Beat fresh ⇒ alive" is false and
deadlocks cancellation, since a worker's last act before exiting is to beat. Pid dead ⇒ terminal
immediately. Pid alive with a stale beat ⇒ `stalled`, derived at read time. Past its own deadline
with a live pid ⇒ `overdue`. **No reconciler terminalizes a job whose pid is alive** — scoped to
reconcilers, so a worker may still end its own run on cancel or `--max-wait`.

**The trilemma:** finite stale-worker recovery, zero overlap, and no signalling cannot all hold.
Releasing a job at a deadline buys recovery by paying in overlap. This design keeps the no-signalling
corner: a suspended or recycled-pid worker wedges the head of the queue, and `/oai:status` names the
blocking pid for the user to deal with by hand. **The plugin never signals a process it cannot
verify** — a recycled pid means the signal could land on something else entirely — and that is
guarded structurally, because a safety property of this shape erodes under a later "make it stop
faster" edit.

**Cancel is cooperative and signal-free.** `/oai:cancel` sets `cancel_requested_at`, **re-reads**, and
reports the terminal state if the job finished in between; otherwise `cancelling`. The worker sees it
at its next beat and **exits**; a later reader observes the dead pid and writes the terminal state.
Only an observed exit produces one **for a job a worker took** — a row nothing ever registered for is
terminalized on the startup grace instead, with no process to observe.

**A pending cancellation is not proof that the cancellation is what happened (OAI-66).** Until then the
reader inferred `cancelled` from the pending request alone, so a worker that **crashed** while a cancel
happened to be pending was published as a tidy `cancelled` — no failure, no note, and the crash
diagnosis discarded. A dead pid establishes that the process is gone, never why. So the reader now
splits on the row's own state, and only one half needs evidence:

- A **`queued`** row provably sent nothing: `job-queue.mjs` `decide` returns `cancelled` only while the
  row is still `queued`, and acquisition is what makes it `running`. Nothing was spent; `cancelled`
  needs no confirming and none is written.
- A **`running`** row may have been mid-request. It reads `cancelled` only if the worker left the
  acknowledgement `scripts/lib/cancel-ack.mjs` describes — a file beside the job log, bearing the row's
  id — and otherwise `failed` with `reason: 'cancel-unconfirmed'`, which says exactly what is known.

**The acknowledgement is a FILE and not a row**, because a terminal row would clear this job as a
`running` blocker and let the queue dispatch the next worker in the window before this process reaches
`process.exit()` — two model calls in flight, the one thing the queue exists to prevent. It is a file
**beside** the log rather than a line **in** it, because `job-spawn.mjs` sends stdout and stderr both to
that log and `salvageOutcome` (`cmd-task-worker.mjs`) writes the model's own answer onto it. That is the
demonstration, not the licence: a verdict that SUPPRESSES a crash diagnosis must not rest on bytes this
plugin did not author, and nothing the model emits can create a file. The claim is narrower than
authentication: another process running as this user could write one, and the reader cannot tell such a
file from a worker's. **The footing is narrower still than "whoever can write that directory can
already write `jobs.db`", and it needs the whole permission chain rather than a loose state
directory.** It fails exactly where an attacker can traverse the state directory, write `logs/`, and
not write `jobs.db` — state `0755`, logs `0777`, database `0600`. Neither end generalises: state
`0755` over a plugin-created `logs/` at `0700` is safe, and state `0777` lets that attacker replace
`logs/` and `jobs.db` alike, which collapses the distinction instead of widening it. `job-store.mjs`
requests `0700` at creation only and never repairs an inherited directory, which is what makes the
middle case reachable at all; `jobs.db` is separately chmod'ed `0600`. Tracked as **OAI-150**; what is
claimed here is only what is enforced.

**If the acknowledgement write FAILS, the worker exits anyway — and that is the whole promise, because
a synchronous call cannot make a wider one.** A write that HANGS still delays the exit: the open, the
write and the close are all synchronous, so a wedged NFS or FUSE mount keeps the paid request alive
and the queue blocked. Nor is "a write that fails does not delay" a claim about latency — a filesystem
call may block for a long time and then fail. The residual is the same one the read side records,
reached from the other direction, and it is stated rather than argued away.
A cancelled request costs money for
as long as it generates, while an unrecorded cancellation costs only the precision of the word the
reader publishes — recoverable from the log. Waiting on a contended filesystem would invert that, and
would repeat the defect `job-heartbeat.mjs` already documents: contention keeping an expensive request
alive after the user asked for it to stop.

**The exit mechanism is named, because the obvious one does not work.** Setting `process.exitCode`
leaves the process alive — the open socket keeps the loop running and the request continues. (Not the
heartbeat timer: `startHeartbeat` calls `timer.unref()`, so it holds nothing open. The socket is the
whole of it.) The heartbeat callback calls **`process.exit()`**, which closes that socket, and that is
what makes "no `AbortController`" true (a deliberate deviation from OAI-3's original note).
**`--max-wait` does NOT use this mechanism and does not need to**: it expires while the job is still
queued with no request in flight, so it writes its terminal row and returns normally.

**`--max-wait` fires while the job is still ineligible**, terminalizing as `queue-timeout` **without
sending a chat completion**. Submission has already probed `/v1/models` via `resolveTarget`, so the
guarantee is scoped to the expensive request, not to "no traffic" — and the test asserts that probe is
the only request the server saw.

## Two versions, because one number cannot mean both

A row-level `schema_version` does not version the *table*. A newer plugin could add a `NOT NULL`
column or change what a state means, and an older executable would fail — or mutate — before it ever
looked at a row.

- **Database level: `PRAGMA user_version`.** A database newer than this build is **refused for all
  mutations**: `/oai:status` may read it and say so, nothing writes, no migration runs. Enforced by
  opening `readOnly: true` rather than by every future caller remembering the rule.
- **Row level: a stable lifecycle envelope**, versioned separately from the payload. `seq`, `id`,
  `state`, `waiter_pid`, `worker_pid`, the timestamps and `schema_version` never change meaning
  across versions; `request`, `outcome` and `failure` may. That split is what lets an older build read
  a newer row's *liveness* without interpreting its payload.

An unknown-version row is therefore **never mutated and never deleted**.

## Retention is a `DELETE`

The newest 50 terminal rows are kept; the rest go in one statement that chooses and deletes together
(`DELETE … WHERE seq IN (SELECT … ORDER BY seq DESC LIMIT -1 OFFSET 50) RETURNING seq`). A separate
`SELECT` would name rows a concurrent worker could still be finishing into.

**Two exemptions, deliberately asymmetric.** An *active* job is exempt however old it is — age is not
evidence about a job. A row a *newer plugin* wrote is exempt **and is not counted toward the 50**:
deleting it is data loss dressed up as housekeeping, and counting it would let a machine that once ran
a newer plugin silently evict this build's own history to make room for rows it cannot read.

**The row goes first and its log second, because the two cannot be one transaction and only one order
is recoverable.** A crash in between leaves an orphan log, which the same sweep collects. The other
order leaves a live row pointing at a log that is gone, and nothing here would ever notice. Because a
pruned row's log *becomes* an orphan the moment its row is deleted, **the ordinary path and the
crash-recovery path are the same code** — so the recovery path runs on every submission instead of
rotting unexercised until the crash it was written for.

The orphan sweep **lists the directory before it reads the rows**, and that order is the whole safety
argument **while sequences cannot be reused**: a log is created only after its row exists, so anything
in the listing already had a row when the listing was taken. Read the rows first and a job submitted
in the gap looks like an orphan, and the sweep unlinks the log of a worker still writing to it.
A name is eligible when it matches `^[1-9]\d*\.(log|cancel-ack)$` **and its number is a safe
integer**. The union is there because keying on logs alone would strand an acknowledgement whose log
had already gone; the numeric test is there because these names are converted to numbers and the
unlink interpolates the result, so anything the conversion does not carry exactly addresses a
DIFFERENT file. A round trip (`String(Number(x)) === x`) was written alongside it and then removed on
measurement — and the relation is an **implication, not an equivalence**: within that regex
`isSafeInteger` implies the round trip, while the converse is false, since `9007199254740992` and
`9223372036854776000` both round-trip and neither is safe. So the round trip could never decide
anything *as a conjunct* — wherever the safe test passed it passed too — and a conjunct that cannot
change an answer is a check that cannot fail. The same asymmetry is why it could not be kept instead:
`9223372036854776000.log` survives it and is `2^63`, past any legal sequence. `0002.cancel-ack` parses to `2` and leaks the
listed file; `1000000000000000000000.cancel-ack` becomes `1e+21` and would delete an unrelated
`1e+21.log`. **A name is not a provenance**: the sweep can say a file is SHAPED like one it writes and
has no row to explain it, never who wrote it — a hand-made `77.cancel-ack` with no row 77 is deleted.
What holds is the converse: anything not of that shape is left alone.

**That safety argument has a stated precondition, and deleting `jobs.db` while `logs/` survives breaks
it.** `seq` restarts, so a sweep that listed a surviving `2.cancel-ack`, read the rows and found no
seq 2 can be overtaken by a submission that inserts seq 2 and opens its log — and the sweep then
unlinks a LIVE job's files. The race is not new (a surviving `<seq>.log` could always start it) and the
union widens which residues can. Closing it needs the orphan key bound to a store incarnation, which is
the schema change declined at this feature's grill; it is tracked as **OAI-149** rather than asserted
away here.

Sweeping is wired to **submission alone**: that is the only place a row is created, so it is the only
place the table grows, and a reader that deletes history is a surprise for no gain.

## What was measured rather than assumed

**Exiting the worker really does stop server-side generation** (2026-08-05, `qwen/qwen3.6-35b-a3b`,
nothing else resident). Killing a client mid-generation produced, in the same second:

```
[LM STUDIO SERVER] Client disconnected. Stopping generation...
                   (If the model is busy processing the prompt, it will finish first.)
[qwen/qwen3.6-35b-a3b] Finished streaming response
```

and `lms ps` showed the model `IDLE` 120s later. So the queue's guarantee is **one server-side
computation**, not merely one dispatched client request. That was the challenge thread's round-14
blocking finding, resolved by evidence.

**The bound the server states itself: a disconnect during *prefill* lets prefill finish.** Prefill is
the expensive half here — ~335s dense at 47k tokens, ~67s MoE — so a cancelled or dead job can hold
the server for the remainder of its prefill after the queue has moved on. If the next job uses the
same model that is only a slowdown; if a different one, its JIT load overlaps that prefill, which is
the two-models-resident case the memory ceiling forbids (`estimated_peak 25.10GiB` against
`safe_ceiling 25.08GiB`). Bounded by one prefill, recorded as a backlog item, and **not mitigated
further**: polling `lms ps` for idleness would be a vendor-specific check in a plugin that is generic
by construction ([ADR 001](001-generic-openai-compatible-plugin.md)).

**The first attempt at this measurement failed and is recorded rather than quietly rerun:**
`google/gemma-4-12b-qat` was refused at load as needing ~44.87 GB on a 36 GB machine, so no inference
ran and the bytes observed were an error response. Nothing was concluded from it.

## Consequences

- **The worker is this executable re-exec'd** as a hidden `task-worker --seq <seq>`, filtered out of
  the unknown-command list. Its stdio is `['ignore', log, log]` — **never `'inherit'`, never a pipe**;
  see the `.claude/REPO_TRAPS.md` entry, which is the single biggest trap in the feature. `unref()`
  comes **after** awaiting `'spawn'` against `'error'`, spawn failure being an async event, and an
  unresolved promise does not keep node alive. The worker **beats immediately** on start, or every new
  job reads `stalled` for its first ten seconds.
- **Only `/oai:task` is wired.** `kind` and `schema_version` exist so `/oai:review --background` fits
  later without a migration, but backgrounding review today would persist a *rendering* rather than
  its canonical outcome, and `/oai:result` could not reconstruct `findings: null` (unparseable) from
  `[]` (a clean pass). Backlog item.
- **The state directory is global**, not per-workspace, with each row naming its workspace: a bare
  `/oai:status` filters to the current repo, `--all` shows everything, and **anything addressed by job
  id resolves from any directory**. No session identifier appears in a row — which is precisely what
  the reference plugin's session sweep depends on. That absence is a property of the schema in
  `job-store.mjs` and is currently guarded by nothing; the plan called for a test and it did not land
  (see the backlog item enumerating that gap).
- **Known gap, recorded honestly:** foreground `/oai:task` and `/oai:review` do not participate, so the
  invariant is "one *background* job at a time". Backlog item.
- **The suspended-process wedge now reaches status operations too.** SQLite releases a *crashed*
  process's writer lock but a *suspended* one keeps it, so after `busy_timeout` expires other
  processes' writes fail with `SQLITE_BUSY`. Reads are unaffected under WAL. The retry rule above is
  what keeps this from being mistaken for a job failure.
- `runTask` was at exactly 60/60 lines against `MAX_FUNCTION_LINES`, so extraction was forced and came
  first: `task-execute.mjs` returns an outcome object and `task-report.mjs` renders it, which is also
  what let the worker and the foreground path share one execution.

## The gate that produced this design

Nineteen challenge rounds, ~74 findings, **all accepted and none argued down**, closing on `APPROVE`.
Beyond the concurrency protocol, findings that would otherwise have shipped: a cancel that would have
sent `SIGTERM` to a pid the plan itself admitted might be recycled; a credential check comparing two
values both derived from submission, and so tautological; a `--base-url` query string silently
persisting an API key while the plan claimed credentials were never stored; **two tests that could not
fail**; and `--max-wait` capping nothing because two rules contradicted each other. The full thread is
in `plans/oai-3-async-jobs.md`, including the rounds whose findings were *dissolved* by the move to
SQLite — recorded because they are the reason for the change, not because they still need fixing.
