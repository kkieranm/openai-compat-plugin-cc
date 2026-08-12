# openai-compat-plugin-cc

Claude Code plugin (in the style of `openai/codex-plugin-cc`) that delegates work to models on any
OpenAI-compatible server — LM Studio, oMLX, Unsloth Studio, or anything else serving
`/v1/chat/completions`.

Architecture: providers are config data, never code paths — `commands/*.md` shell out to
`scripts/oai-companion.mjs`, which resolves a profile from `~/.config/oai-plugin/providers.json` and
makes one `fetch` call. See [ADR 001](adr/001-generic-openai-compatible-plugin.md).

`scripts/lib/model-info.mjs` detects a provider's context window and model types by probing vendor
endpoints by response shape, trusting only served windows over model ceilings — see
[ADR 002](adr/002-context-window-detection.md).

`scripts/lib/model-selection.mjs` is the single authority on which model a task will use:
`planSelection` picks the one the server reports `loaded` when several are offered and none was
named, and refuses an id a recognised catalogue does not list; `scripts/lib/model-identity.mjs`
`substitution()` is the one comparison that says the model which answered is not the one requested —
see [ADR 011](adr/011-which-model-actually-answered.md).

`scripts/lib/git-diff.mjs` sends each changed file whole alongside the diff **when the window can be
sized** — an unsizeable one skips that rung and the report says so — taking content from the
revision the diff describes; `collectTarget` splits pinned `files` (untracked, `--file` — covered by
no diff) from droppable `changed`, and the reply falls back to the diff alone when the window is too
small — see [ADR 005](adr/005-whole-files-for-review.md).

`scripts/lib/structured.mjs` can ask for JSON with a strict `response_format` schema, but **since
2026-08-04 it does not by default**: a schema builds a grammar in LM Studio whose lexer dies at ~14k
generated tokens and segfaults the model process, which cost ~38% of long requests and was
misdiagnosed as server flakiness for four days (OAI-51). The ordinary path now asks for the shape in
prose and parses leniently — a bare top-level array is the same reply as `{findings: […]}`, and the
channel is an ordered attempt over a candidate list that is `[content]` alone without a schema, which
is where that no-scratchpad guarantee is now written rather than inferred; `--structured-output`
opts back in for a server known not to have that
grammar engine — see [ADR 003](adr/003-structured-findings.md). Every string and array in that schema carries a
size ceiling as a backstop against a runaway reply, and hitting the `MAX_FINDINGS` cap is reported —
see [ADR 004](adr/004-bounding-the-review-reply.md).

`scripts/lib/json-scan.mjs` `extractJson` reads the LAST of the outermost bracketed runs that
`scripts/lib/findings-candidate.mjs` `findingsShaped` accepts, skipping past a start position that
never closes rather than treating it as the end of the scan — see
[ADR 003](adr/003-structured-findings.md).

`scripts/lib/http.mjs` is the only place this repo speaks HTTP: `send()` on `node:http`/`node:https`
with an explicit first-byte budget and an optional absolute deadline, streaming chat completions as
SSE, while the first-token and idle budgets that mean "the model is working" live in
`scripts/lib/stream-collect.mjs`, which `chat.mjs` calls to read one streamed reply —
see [ADR 007](adr/007-owning-the-transport.md).

`scripts/lib/review-schema.mjs` sizes the reply from the budget each run is granted —
`reviewSchemaFor(reserve)` — and a run its `analysis` ceiling truncates has its findings scored while
its silence widens the benchmark's recall into a band — see [ADR 008](adr/008-sizing-the-review-reply.md).

`scripts/lib/stream-collect.mjs` times each attempt on both sides of its first token — `prefillMs` and
`generationMs` — because a server-side prompt cache moves the first by tens of times and leaves the
second alone; `/oai:review --cache-buster <token>` defeats that cache for a measurement, and the
benchmark's `--cold` uses it — see [ADR 009](adr/009-measuring-prefill-and-generation.md).

`--max-seconds` caps a whole model call in wall clock, retries included — `scripts/lib/http-budgets.mjs`
arms it as the transport's `deadline` budget from one expiry `requestFindings` mints per command, and
`scripts/lib/throughput.mjs` divides the reply's completion tokens by the generation time it was
measured over — see [ADR 010](adr/010-bounding-and-rating-a-run.md).

`scripts/lib/failure-shape.mjs` names the shapes in which a request dies without the model saying no
and splits them by whether a retry could survive it — `transport` retries, `non-retryable-transport`
is a pre-response failure it does not recognise as transient — while `scripts/lib/provider.mjs`
`reword` improves such a failure's message without ever changing that verdict; and
`scripts/lib/answer-attempts.mjs` `answerWithRetry` retries only the retryable ones, spanning
`postWithDegrade` and `finishAnswer` so it can see every shape; `scripts/lib/attempt-ledger.mjs` records
one entry per physical request so scoring reads the attempt that answered while reliability reads
every attempt, and `scripts/lib/attempt-outcome.mjs` owns what one request's ending means — a refusal
becomes `refused` only when `begin` creates the replacement entry, and stays a `shape-rejected`
failure when nothing replaced it — see [ADR 012](adr/012-surviving-the-server.md).

Server-state questions are answered by shortening the TTL below a known prefill and trying to falsify
the JIT-TTL mechanism, never by sampling residency around a run — the instrument is
`bench/ttl-challenge.mjs`, and it **refutes but cannot confirm**: proving an unload was post-expiry
needs residency observed *after* expiry, which a mechanism firing *at* expiry never leaves behind, so
an observed absence is recorded and attributed to nothing. Its I/O half is driven end to end against a
stub `lms` in `tests/ttl-challenge-e2e.test.js`, because the same instrument was withdrawn once for
having a decision-shaped half that had never executed. **Run 2026-08-04: the deterministic form is
refuted** — 3/3 episodes held 336s of prefill under a 120s TTL, continuously resident — which
removes a candidate for the observed request drops without explaining them; their cause is still
unresolved. See [ADR 013](adr/013-observing-the-server.md).

Every attempt entry carries `serverResponded` — *an HTTP response was obtained*, never *a peer was
reached* — which `settle` and `pendUntilReplaced` take from the outcome while `fail` weighs
`obtainedResponse`'s independent witnesses — the transport's flag, an HTTP status code, a completion
shape, or a measured prefill; see [ADR 012](adr/012-surviving-the-server.md).

`bench/lib/reason-notes.mjs` `reasonNotes` explains each reason code a reader could misread —
`shape-rejected`, `non-retryable-transport`, `transport` — gated on that code appearing in the
sweep, and enumerates what the attempt record holds rather than asserting what it lacks, rendering
that list from `RECORD_FIELDS`, whose membership `tests/bench-reason-notes.test.js` pins against a
closed ledger entry.

`/oai:task --background` returns a job id instead of waiting: `scripts/lib/job-store.mjs` is the only
place this repo opens a database, and the whole concurrency design is a SQLite transaction rather than
a file protocol — publication is an `INSERT`, a queue position is an `AUTOINCREMENT` that is never
reused, and `job-queue.mjs`'s `BEGIN IMMEDIATE` makes the eligibility check, the owner registration
and the transition to `running` one statement nothing can interleave with. **`waiter_pid` (a worker
exists and is waiting) and `worker_pid` (a worker is running this job) are two different facts, and
collapsing them made every legitimately queued job look abandoned.** Two versions are tracked
separately because one number cannot mean both: `PRAGMA user_version` describes the table and a newer
one is refused for all mutations, while a row's `schema_version` describes its payload, and a row this
build cannot read is never mutated and never deleted. `job-liveness.mjs` decides death by pid and only
corroborates with the heartbeat — a worker's last act is to beat — and nothing here ever signals a
process it cannot verify, which `tests/queue-guards.test.js` enforces structurally; cancel is
therefore cooperative, and `job-retention.mjs` keeps the newest 50 finished jobs, deleting each row
before its log so that a crash in between leaves an orphan the same sweep already collects. What the
model sees is frozen at submission as `request.messages`, so the worker never reads the filesystem —
see [ADR 014](adr/014-async-jobs.md).

`scripts/lib/job-busy.mjs` `withBusyRetry` bounds a `SQLITE_BUSY` by elapsed time at seven enumerated sites,
while skip-only callers keep a bare `isBusy` catch and the store's open takes the exclusive WAL lock only
when the journal mode is not already set — and **where a retry sits decides what it can cost**: the
completed write sits outside the catch that publishes `failed`, and the `failed` write inside a catch of
its own that discards neither error, because a throw raised in a `catch` replaces the pending rethrow, while
an exhausted completed write hands its outcome to `salvageOutcome` — one `SALVAGED_OUTCOME` line on the log
the worker already owns, so the answer outlives the row that would not take it — see
[ADR 020](adr/020-a-contended-database-must-not-kill-live-work.md).

`scripts/lib/job-launch-outcome.mjs` `terminalizeSpawnFailure` is what a submitter may write about a
launch it could not confirm, and it **holds strictly less knowledge than its call site suggests**: a
rejection from `spawnWorker` does not prove no child exists, because that helper closes its copy of the
log descriptor *after* the `'spawn'` event fires. So the reason is `worker-launch-unconfirmed` rather
than `spawn-failed`, and the verb is `abandonUnstarted` — whose `state = 'queued' AND waiter_pid IS
NULL` compare-and-set makes both orderings safe — never `finish`, which would flip a row a live worker
owns and lose paid work behind a terminal state that never happened. Its ignored return is wider than
it looks: `false` means the row is no longer an unregistered queued row, not that a worker registered.
Four facts stay separate throughout — a child was CREATED, a worker REGISTERED, a worker ACQUIRED, a
worker PUBLISHED — and conflating any two is the defect class this module and OAI-67 exist to remove.
`task-submit.mjs` keeps the other half: the retention sweep runs **before** anything is inserted or
spawned, so a broken sweep can no longer sink a submission whose worker may already be spending, and
both post-spawn writes report any storage fault while still returning the id — including a guard on the
report itself, since a throwing stderr would lose the id it was announcing — see
[ADR 014](adr/014-async-jobs.md) and [ADR 020](adr/020-a-contended-database-must-not-kill-live-work.md).

`job-store.mjs` `requireDatabaseSync()` gates `node:sqlite` as a **capability rather than a version** —
one caught dynamic import classified at first use, so a runtime without that builtin loses background
jobs alone instead of every command, and an unrecognised fault keeps its cause instead of being
relabelled a stale Node — see [ADR 018](adr/018-a-capability-not-a-version.md).

`task-submit.mjs` `noteEndpointPersistence()` warns that a background submission persists its whole
endpoint by **taking no argument, gating on nothing, and running before anything else writes to
stderr** — the code cannot know which part of a URL is a secret, and `process.exit(2)` discards
undrained stderr, so the notice describes the storage rather than the credential and is emitted where
no preamble can crowd it out — see [ADR 019](adr/019-a-notice-that-cannot-print-the-secret.md).

`agents/oai-delegate.md` delegates as a **context broker rather than a forwarder** — it picks the
smallest sufficient file set itself, spends at most two `task` submissions on at most one accepted
job, and returns an account plus the job id instead of the model's reply, so neither the reading nor
the answer lands in the calling session; `tests/plugin.test.js` pins the status line it polls at both
ends, against `TERMINAL_STATES` and by running the agent's own `awk` expression — see
[ADR 015](adr/015-a-context-broker-not-a-forwarder.md).

`scripts/lib/task-template.mjs` makes `/oai:task --template advisor` a named question rather than a
prompt each caller rewrites: `TEMPLATES` holds the skeleton, the reply shape and the discipline, the
whole skeleton goes in the **system** message so `/oai:status` still shows what the user asked, and
`templateNotes` builds the caveats both `/oai:task` and `/oai:result` print; `advisor`, `diagnose` and
`patch` ship, and `--json` carries the same notes as an array so a harness cannot read a crowded reply
as a clean one — see [ADR 016](adr/016-a-template-is-three-things.md).

`scripts/lib/eta.mjs` estimates prefill and generation separately from two per-provider config rates
and prints **nothing** when a provider has none — a wait copied from other hardware is acted on as
confidently as a measured one. `scripts/lib/task-artifact.mjs` is the one place a task answer is
checked rather than captioned: it extracts a `patch` template's diff and runs `git apply --check`,
reporting `applies` / `rejected` / `absent` and never applying anything.

`bench/task-run.mjs` scores `/oai:task` templates against declared markers grouped by what naming them
demonstrates, with both framing arms run and never averaged, each case guarded by an **executable
witness** that must fail on `before/` and pass on `after/` — and it states in every report that a
marker profile is evidence quality, **not** Stage 2's economic gate. See
[ADR 017](adr/017-measuring-a-task-not-a-review.md).

`bench/` scores `/oai:review` against committed snapshots of this repo's history: each case is a
historical commit re-staged as `before/`/`after/` trees with its known defects catalogued, run through
the real CLI via `--json` and matched on a quoted anchor line — see
[ADR 006](adr/006-benchmarking-the-reviewer.md).

`bench/review-sweep.mjs` reviews commits newest-first from `--from` until a wall clock stops it, and
`bench/lib/sweep-outcome.mjs` `classify` builds every report-derived entry through one mapping so each
carries the envelope fields that change what a reader should believe (`analysisCut`, `atCap`,
`hunksOnly`, `skippedUnsizedWindow`, `dropped`, `reason`) — leaving each commit disposed of exactly once across the report's
three sections, so a night lost to starvation reads as coverage rather than as silence — see
[ADR 021](adr/021-an-unwatched-sweep-must-say-what-it-did-not-review.md).

## Commands

- Test: `npm test` (`node --test` over `tests/**/*.test.js` — the path scope is load-bearing, see footguns).
  **Requires `zsh` on PATH**, and fails loudly without it: `tests/delegate-template.test.js` runs the
  delegate's shell recipe under every shell present, and zsh is the one that catches word-splitting
  bugs the POSIX shells agree to miss — it is also the shell the recipe actually runs in. Declared
  here rather than left implicit, and required rather than skipped, because a suite that silently
  shrinks its shell matrix is a check that has stopped being able to fail.
- Benchmark the reviewer: `npm run bench` (opt-in, needs a real model; `--runs N`, `--case <id>`, `--diff-only`, `--cold`, `--warm-up`, `--max-attempts N`)
- TTL challenge: `node bench/ttl-challenge.mjs` (opt-in, ~45 min, needs LM Studio with **nothing**
  resident — `lms ps` empty — and nothing else connected). Every flag except `--out-dir` makes the run
  non-canonical, which the record states as `protocol.canonical: false`.
- Load the plugin in a scratch session: `claude --plugin-dir /Users/kieran/Code/openai-compat-plugin-cc -p "/oai:setup"`
- No build step; the plugin is markdown + JSON + ESM scripts.

## Session footguns (repeat offenders — check before hitting them)

- The shell cwd resets between Bash calls — use absolute paths.
- **`node --test` with no path walks the whole repo**, so any directory of source-shaped *data* gets
  discovered as tests — `bench/cases` holds historical `tests/*.test.js` that were duly run against
  today's tree. The npm script's `tests/**/*.test.js` scope is what prevents it; a test asserts the
  scope survives. Node 26 also rejects a bare directory (`node --test tests/`) as a missing module.
- **Never `spawnSync` in a test that talks to the in-process fake server** — the sync spawn blocks
  the event loop, the server can never answer, and the run hangs until the client timeout (cost: one
  204-second suite). `tests/helpers.mjs` `runCompanion` is async for this reason; `await` it.
- **A detached worker must not inherit or be handed a descriptor.** `runCompanion` resolves on
  `'close'`, which waits for every descriptor the child holds open — so a grandchild holding an
  inherited pipe turns `--background` into a foreground run and hangs the suite. `job-spawn.mjs` uses
  `['ignore', log, log]`, and `tests/queue-guards.test.js` guards it.
- `new URL('localhost:1234')` **parses** (scheme `localhost:`, null origin) — URL parsing alone does
  not validate a base URL, so `normalizeBaseUrl` also checks the protocol is http(s).
- LM Studio is installed and usually serves models on :1234, but it is only up when started
  (`-ud-mlx` quants are gone; current ids are `qwen/qwen3.6-27b` and `qwen/qwen3.6-35b-a3b`). Tests
  must stay network-free (fake server on an ephemeral port); use the stub for manual runs when
  nothing is listening.
- **LM Studio dropped ~1/3 of long requests across four full-corpus bench invocations**
  (27/72 runs, 2026-07-30, both models — so the locus is the shared serving path; the mechanism
  and the role of sustained load are unresolved): empty completion (`finish_reason: unknown`) or a
  stream drop ~50k chars into reasoning. It can also wedge with a model stuck `GENERATING`
  (fix: `~/.lmstudio/bin/lms unload`). **OAI-20 landed the client-side answer** — those shapes are
  classified and retried, and every physical attempt is recorded — but whether retry *recovers* the
  37.5% is a measurement OAI-19 reads off that record, not a settled fact.
- A model's usable window is `loaded_context_length`, **not** `max_context_length` — 58112 vs 262144
  for the same model here. `model-info.mjs` encodes this; never "simplify" it to the larger field.
- Plugin command markdown needs `allowed-tools: Bash(node:*)` or the companion call fails at runtime.
- A schema-constrained reply arrives in `reasoning_content` with `content` **empty** — the grammar
  stops the model ever closing its think block. Reading that channel is legitimate only under a
  schema, where parsing proves what it is; without one it is scratchpad and `requireAnswer` refuses.

## Grilling checklist — schema/shape forks to always surface

Universal:
- ids: type + provenance (job ids, once async delegation lands — who mints them, where stored)
- strings vs FKs; normalisation aggressiveness
- migration story for persisted state (the providers config, and any future job files)

Domain:
- Provider selection: config profile vs ad-hoc `--base-url` vs auto-detect by probing ports
- Model selection: pinned in config vs whatever is loaded vs JIT-load by name
- Sync vs async delegation, and whether a job model is warranted yet
- Context handling: fail loud vs truncate vs chunk; where the window figure comes from
- How much Claude session context is shipped to a local model, given small windows

## Verifying and reviewing changes

- Prove changes with the repo `verify` skill (`.claude/skills/verify/SKILL.md`).
- Review order: `advisor` → lean workflow (`.claude/workflows/review-lean.js`) per feature →
  the same lean workflow in **wide mode** (`--wide` args prefix: 5 finders, verifier cap 6) once per
  milestone, or when a change introduces or alters a module carrying vendor/protocol assumptions —
  which in this repo is most of them. Wide mode replaced the built-in `/code-review` here on
  2026-07-30 after it died at its verifier fan-out on both OAI-16 and OAI-17 (dotfiles `adr/003`); the
  built-in stays available at `medium` when typed by hand.
- Every recurring defect class graduates from a reviewer's prompt to a structural test — size/growth
  is itself such a class and is guarded by `tests/structure.test.js` (ratchet allowlist; raising a
  ceiling is a deliberate commit that says why). `tests/plugin.test.js` guards the markdown command
  surface, which nothing else notices when it rots.
- Commit gate: tests green + verify skill passed before committing.

## Work tracker

- `BACKLOG.md` — numbered items with stable global IDs (`OAI-1`, `OAI-2`, …). It opens with a
  **tier list between `<!-- tiers -->` markers** and an **absorbed-ID table**. **Since 2026-08-08 the
  tier list is the PRIORITY VIEW and the bodies below sit in ascending ID order** (`adr/025`); a
  re-order rewrites only the index. **`tests/backlog-structure.test.js` enforces this on every
  `npm test`** (OAI-104, 2026-08-09 — before it, the same guarantee was prose naming a script that
  did not exist, and it found three classes of live drift on its first run): the index covers the
  live set exactly, no ID repeats in it, the bodies are in ID order, and nothing is live and closed
  out at once. It is no longer true that
  the index sequence equals the heading sequence — that was the pre-migration invariant. Every ID ever
  issued must still resolve to exactly one live heading, one done/parked heading, or one redirect hop.
  *(A single bolded `**OAI-n**` inside the tier prose parses as a tier entry — refer to items in other
  tiers without bold.)*
- `BACKLOG_DONE.md` — completed items, newest first.
- `BACKLOG_PARKED.md` — items whose **framing** was disproved, not merely deprioritised. Each carries a
  **reopening bar**: what would have to be observed for it to become live again. An item still wanted
  but unscheduled stays in `BACKLOG.md`; parking is for a premise that no longer holds.
- "Pick next item" = top of BACKLOG.md; "mark done" = move the item to BACKLOG_DONE.md with the date;
  "park" = move to BACKLOG_PARKED.md with a reopening bar, and add a row to the absorbed-ID table if
  anything cites it.

## ADRs

Architecture decisions live in `adr/` as `NNN-slug.md`.
