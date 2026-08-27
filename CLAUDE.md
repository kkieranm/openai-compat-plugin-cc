# openai-compat-plugin-cc

Claude Code plugin (in the style of `openai/codex-plugin-cc`) that delegates work to models on any
OpenAI-compatible server — LM Studio, oMLX, Unsloth Studio, or anything else serving
`/v1/chat/completions`.

Architecture: providers are config data, never code paths — `commands/*.md` shell out to
`scripts/oai-companion.mjs`, which resolves a profile from `~/.config/oai-plugin/providers.json` and
makes one `fetch` call.

`scripts/lib/model-info.mjs` detects a provider's context window and model types by probing vendor
endpoints by response shape, trusting only served windows over model ceilings.

`scripts/lib/model-selection.mjs` is the single authority on which model a task will use:
`planSelection` picks the one the server reports `loaded` when several are offered and none was
named, and refuses an id a recognised catalogue does not list; `scripts/lib/model-identity.mjs`
`substitution()` is the one comparison that says the model which answered is not the one requested.

`scripts/lib/sampling.mjs`'s `SAMPLING_PARAMS` is the single registry of the vendor sampling/reasoning
parameters a request may carry — `reasoning_effort`, `top_p`, `top_k`, `min_p`, `presence_penalty` —
each row naming its flag, option key, wire field and validator, so `parseSampling` (validation),
`applySampling` (the body) and `job-request.mjs`'s DTO cannot admit a parameter in one place and drop
it in another; `applySampling` iterates that table alone, which is what keeps the request body a closed
set — `messages`/`stream` are structurally unreachable from caller sampling, never a merge.

`scripts/lib/run-context.mjs` records the server configuration a run resolved — the effective window
it acted on and its provenance (`contextWindow`/`contextSource`/`detectedWindow`, sourced once
from `resolveTarget`'s `effectiveWindow(profile, described, options.model)` so the recorded window is
the resolved model's, never the default's), and a per-parameter request-conditional `serverConfig`
marker (`serverConfigFrom` — a knob reads `requested` when the request carried it, else
`server-default-unobserved`, which stays true once bench forwards the flag rather than a constant
stamp). `attachRunContext` OVERWRITES these onto a thrown error at each flow's post-resolution catch —
the window is resolved mid-flow, so it cannot ride the command-level catch `sampling` uses; the review
flow wraps its whole post-resolution body, the task flow attaches in `prepareTask`, `executeTask` and
`taskFlow` (the reasoning-only refusal is raised in `taskFlow`'s `report`, after `executeTask`
returned). `review-report.mjs`'s `errorReport` reconstructs all four FAIL-CLOSED before persisting them
to `jobs.db` — a window only through `positiveInteger`, a source only if in `CONTEXT_SOURCES`, and
`serverConfig` rebuilt as a fresh three-knob map so a foreign prototype/`toJSON` never reaches the
serialized output. `bench/lib/outcome.mjs`'s `runContextFrom` copies the four onto a failed bench
record (`bench/run.mjs`'s `failedRun` and `sweep-outcome.mjs`'s `failure`, since neither keeps the whole
envelope), and `sweep-outcome.mjs`'s `reported` carries them on the success path — the failure path is
where the window matters most, since OAI-215's watchdog threshold derives from it. Foreground only: a
background task failure records the fields `null`, the same posture as `sampling`. The bench `--note`
(`bench/run.mjs`, `bench/review-sweep.mjs`, bounded by `sweep-ledger.mjs`'s `boundNote`) is the operator's
own annotation of what no API exposes, kept on the bench record alone, off the CLI envelope and `jobs.db`.

`scripts/lib/git-diff.mjs` sends each changed file whole alongside the diff **when the window can be
sized** — an unsizeable one skips that rung and the report says so — taking content from the
revision the diff describes; `collectTarget` splits pinned `files` (untracked, `--file` — covered by
no diff) from droppable `changed`, and the reply falls back to the diff alone when the window is too
small.

`scripts/lib/structured.mjs` can ask for JSON with a strict `response_format` schema, but **since
2026-08-04 it does not by default**: a schema builds a grammar in LM Studio whose lexer dies at ~14k
generated tokens and segfaults the model process, which cost ~38% of long requests and was
misdiagnosed as server flakiness for four days (OAI-51). The ordinary path now asks for the shape in
prose and parses leniently — a bare top-level array is the same reply as `{findings: […]}`, and the
channel is an ordered attempt over a candidate list that is `[content]` alone without a schema, which
is where that no-scratchpad guarantee is now written rather than inferred; `--structured-output`
opts back in for a server known not to have that
grammar engine. Every string and array in that schema carries a
size ceiling as a backstop against a runaway reply, and hitting the `MAX_FINDINGS` cap is reported.

`scripts/lib/json-scan.mjs` `extractJson` reads the LAST of the outermost bracketed runs that
`scripts/lib/findings-candidate.mjs` `findingsShaped` accepts, skipping past a start position that
never closes rather than treating it as the end of the scan.

`scripts/lib/findings-yaml.mjs` `findingsInYaml` reads a reply `extractJson` structurally cannot see
at all: a well-formed findings list with no bracket pair anywhere, expressed as whole-document
YAML-ish prose (reproduced 2026-08-14, OAI-156 — 1,245s of real model work discarded this way,
naming a defect a separate baseline run had already reported as bracketed JSON on the same commit).
Deliberately not a YAML parser and never throws — same never-throw contract as `extractJson`, which
is what keeps it correctly absent from `tests/structure.test.js`'s `RESPONSE_BOUNDARY_FILES` list
rather than needing to be added to it. Whole-document-only by design: it accepts a reply only when
the ENTIRE trimmed text is a top-level `findings:` key, one or more `- `-prefixed flat-mapping items,
and an optional trailing `summary:` scalar, and rejects everything else outright — never partially —
which is what sidesteps the decoy-vs-real-payload ranking problem `extractJson`'s own comments
document as hard-won for the bracketed case: there is no ranking to do when only one shape can ever
match. A value is a **flow collection**, and disqualifies the whole document, only when it **starts
with** `[`/`{` after trimming; a bracket appearing later in ordinary scalar text does not (`summary:
found a { in the config` is accepted verbatim) — the plan's own round-1 "provably disjoint" claim was
refuted on exactly this point by two independent review-ladder plan-gate verdicts (Codex, a fable
verdict subagent) before landing as this narrower, stated-as-judgment rule. `scripts/lib/structured.mjs`'s
`findingsIn` attempts `findingsInYaml` **only when `!structured`** — never on the constrained
(`--structured-output`) path, where a schema-conforming JSON payload is the whole promise and racing
the two acceptors risked a YAML reading pre-empting a valid embedded JSON payload before
`matchesSchema` ever saw it (round-2 plan-gate finding). On a match `extractJson` is skipped entirely
for that channel; on `null`, the unconstrained path falls through to the unchanged `extractJson` path
exactly as before this change. `MAX_ITEMS` (200) and `MAX_FIELDS_PER_ITEM` (20) are flat-reject
backstops against unbounded work on a pathological reply, not truncation — truncating would silently
under-report findings the model actually sent, the same honesty `capDiagnostics` protects elsewhere.
`normalizeFinding` guards `severity`/`line` with a `typeof` check before coercing, the same way it
already guards `file`/`summary`, so a hostile-object value (own `toString`/`valueOf` set to `null`)
defaults rather than throwing out of the whole reply's parse.

`scripts/lib/findings-empty.mjs` `emptyFindingsDocument` is the last-resort reader for a clean review
a model wrote as whole-document YAML — a first line that is an inline empty `findings: []` declaration
followed by prose — which neither `extractJson` (its only bracket is the embedded `[]`, read as scalar
text) nor `findingsInYaml` (a block list of `- ` items, not an inline empty one) can see, so the
review was discarded as unreadable instead of reported clean. It returns `{ findings: [] }` and never a
real finding — the YAML spelling of the empty mapping `extractJson` already accepts as JSON. Three
conditions must all hold to read clean, each refusing a way the reply could be hiding a finding: the
first line (after the whole text is `trim()`med — deliberately NOT a column-0 check) is exactly the
inline empty declaration; no later line is a second `findings:` KEY (plain or paired-quoted, any
indentation — a bracket-free decoy); and **no `[`/`{` appears past the opener** (OAI-212 Pass 4, F1).
That last guard is the module's own "no bracketed candidate anywhere" premise finally ENFORCED: since
the acceptor is reached only after `extractJson` returned null, any bracket past the opener is material
`extractJson` could NOT read — blinded by an unbalanced quote, malformed, truncated, or a rejected
shape — so a reply that declared `findings: []` yet carries it is contradictory and left loud, never
silently clean. Disclosed cost, fail-closed: a genuinely clean review that merely quotes a bracket in
prose also goes loud (1 of 15 recorded clean replies — the one quoting `response_format: {type:
"json_schema"}`); a bracket-free real finding written as pure prose, or under a case/position-variant
key, remains disclosed residue. Same never-throw contract as the two readers above, so it too stays off
`tests/structure.test.js`'s `RESPONSE_BOUNDARY_FILES` — it builds no `UserError`. `findingsIn` gates it
on `!structured` like `findingsInYaml` and places it last in the `shaped` `??` chain after
`extractJson`'s `parsed`; the bracket guard makes the two DISJOINT by construction (a bracket-free body
is one `extractJson` found no candidate in), so `parsed` always wins where it has one and the chain
order is no longer load-bearing — the old ordering mutation is inert, and the two bracket-guard decline
witnesses (a blinded array, a bare object) are what pin the behaviour instead.

`scripts/lib/http.mjs` is the only place this repo speaks HTTP: `send()` on `node:http`/`node:https`
with an explicit first-byte budget and an optional absolute deadline, streaming chat completions as
SSE, while the first-token and idle budgets that mean "the model is working" live in
`scripts/lib/stream-collect.mjs`, which `chat.mjs` calls to read one streamed reply.

`scripts/lib/review-schema.mjs` sizes the reply from the budget each run is granted —
`reviewSchemaFor(reserve)` — and a run its `analysis` ceiling truncates has its findings scored while
its silence widens the benchmark's recall into a band.

`scripts/lib/stream-collect.mjs` times each attempt on both sides of its first token — `prefillMs` and
`generationMs` — because a server-side prompt cache moves the first by tens of times and leaves the
second alone; `/oai:review --cache-buster <token>` defeats that cache for a measurement, and the
benchmark's `--cold` uses it.

`stream-collect.mjs`'s `collectStream` also carries a second, opt-in watchdog (OAI-115) beside the
time-based one: `max_tokens` is one pool shared between a reasoning model's `reasoning` channel and
its `content` channel, and a model can spend the whole pool reasoning and never write an answer.
Armed only when a caller passes `reasoningReserveTokens` (a token count) alongside a finite
`maxTokens` (the request's own raw budget, threaded down separately — the two are never merged into
one value, since the synthesized failure needs both), it fires on the first frame whose reasoning
crosses `(maxTokens - reasoningReserveTokens) * REASONING_CHARS_PER_TOKEN` chars — a local,
output-specific char/token constant (3.0), deliberately not `context-guard.mjs`'s `CHARS_PER_TOKEN`
(3.4), which was measured against input code/diffs, a different population. Fires only while
`answer.content.length === 0`; any content permanently disarms it for that stream, and a defensive
`cutoffChars > 0` guard means a caller that forgets to gate on window size (`reserveFor`'s half-window
branch can drop under `2 * TOKEN_RESERVE_TOKENS`) still cannot arm it on the very first delta. On
firing it disposes the response and synthesizes a `UserError` on the SAME `expired` variable the
deadline watchdog uses — never a second one — and **throws it immediately, in the same synchronous
turn**, rather than relying on `dispose()`'s later async rejection: a review-ladder pass
(`codex-adversarial`) found that `readSse` can have further events already buffered from the same
physical chunk — a finish frame, `[DONE]` — which `drain()` yields with no `await` in between, so a
bare `dispose()` here let the loop keep consuming them and return a normal success, discarding the
cutoff entirely. `codex-plain`, independently and in the same pass, found a DIFFERENT race in the
same block: the deadline watchdog's own `onExpire` unconditionally overwrote `expired`, so a
still-armed idle timer firing after the cutoff already claimed it could silently replace
`token-reserve-cutoff` with `idle-timeout`. **Throwing synchronously does not by itself close that
second race** — a further round on the same pass found that throwing out of a `for-await` loop still
runs
`IteratorClose` on the async generator before this function's own `catch` executes, and that cleanup
can itself await, leaving a real gap in which the still-armed idle timer could fire and overwrite
`expired` — reproduced directly with a delayed iterator `return()`. Closed two ways: `onExpire` only
ever assigns `expired` when it is still `null`, and the cutoff itself calls `deadline.clear()` before
`dispose()`/`throw`, removing the timer from the race outright rather than merely surviving it. The
`catch` block's `expired ?? error` is what lets the real cause outrank the generic transport error a
raw `dispose()` alone would produce. Reasoned `token-reserve-cutoff`, deliberately not
`token-reserve-timeout` (several `bench/` paths classify any `*-timeout` reason as timing data, which
this is not); `failure-shape.mjs`'s `RETRYABLE` whitelist excludes it by
construction, with no code change needed there.

`scripts/lib/review-request.mjs`'s `unconstrained()` — **and only `unconstrained()`, never
`requestFindings`'s `--structured-output` branch** — opts into that watchdog by passing
`reasoningReserveTokens: TOKEN_RESERVE_TOKENS` (2,048 — ~1.8x the largest observed successful review
answer across a 17-run sample) directly at the original-request `chatCompletion` call, only when
`built.reserve >= 2 * TOKEN_RESERVE_TOKENS` — **never on the shared `send` object**, since `send` is
also spread into `trySalvage`'s own follow-up call, which must never re-arm the watchdog against its
own small budget. The structured-output exclusion is load-bearing, not an oversight (review-ladder
pass 1, `codex-adversarial`): under a `response_format` grammar the model can never emit the token
that closes its own think block, so the real findings JSON legitimately arrives on the `reasoning`
channel rather than `content` (see `client.mjs`'s `requireAnswer` above) — the watchdog's
false-trigger guard (`content.length === 0`) is therefore always true throughout a structured request
regardless of how much real answer has been written, and arming it there would cut off a reply that
is actively finishing. `trySalvage` (OAI-138's original salvage mechanism) is generalized via a
`SALVAGE_REASONS` allowlist (`deadline-timeout`, `token-reserve-cutoff`, `reasoning-only`) rather than
forked, with the follow-up's own budget branching on the reason: `token-reserve-cutoff` and
`reasoning-only` both get a flat `TOKEN_RESERVE_TOKENS` — the window is already consumed down to that
headroom by construction for the former (the watchdog fires exactly there), and by the same logic
applied more conservatively for the latter, where only `SALVAGE_MIN_REASONING_CHARS` of consumption is
actually guaranteed; `deadline-timeout` keeps its original `built.reserve` ceiling unchanged.
`trimReasoning` (OAI-204) head+tail-trims the reasoning fed back into the follow-up's assistant turn —
1,500 head chars, 4,500 tail chars, derived from `TOKEN_RESERVE_TOKENS` — scoped by the same
`SALVAGE_SMALL_RESERVE_REASONS` set the reserve branch above uses, so `deadline-timeout`'s follow-up
stays untrimmed; measured overnight (OAI-19) that feeding back the full, untrimmed transcript rescues
almost nothing (1 of 14), which this is a first isolated trial against, not yet a confirmed fix. A
direct replay (OAI-204 amendment, review-ladder pass 1, `codex-adversarial`) confirmed the trim itself
regressed the one known-working case, so `trySalvage` now falls back to one further, untrimmed attempt
when the trimmed one fails and trimming actually applied — `scripts/lib/review-request.mjs`'s
`attemptSalvage` is the one physical-attempt helper both calls share, and the success envelope's
`result`/`budget`/`estimatedTokens`/`salvageTrim` are always read from whichever attempt's bundle
actually answered, never mixed across the two. This also means a trim SUCCESS is now ambiguous between
"the trim rescued it" and "the untrimmed fallback rescued it" without reading a run's own
`salvageTrim.applied` — no clean size-only isolation exists in this design, and the 25/75 head/tail
split remains a stated, unmeasured choice rather than a derived one. `salvageEmptyFailure` labels a
losing salvage follow-up's ledger entry by the reply's shape — `finish_reason: 'length'` →
`token-exhaustion`, the canonical `isReasoningOnly` → `reasoning-only`, a whitespace-only answer →
`empty-answer` — attempt-level labels only, never the run's top-level reason, which stays the
original failure's.
`client.mjs`'s `isReasoningOnly` is the shared predicate for a clean stream that left content empty
after real reasoning; `unconstrained()` checks it right after its own `chatCompletion` call succeeds so
the resulting throw lands in its own catch with `built` already in scope, since `requireAnswer`'s own
throw for the identical shape happens too late — after a separate, later call chain
(`unparsedReply`) — for `trySalvage` ever to see it. `bench/lib/sweep-outcome.mjs`'s `serverUnwell`
deliberately excludes `reasoning-only`: it fires only after a clean, server-terminated stream, while a
genuine server-side drop already reaches `serverUnwell` by other routes — the transport reasons it
accepts directly, or `COMPLETION_SHAPES`. `bench/lib/sweep-outcome.mjs`
classifies an unsalvaged `token-reserve-cutoff` alongside `token-exhaustion` as `starved`, never as
a generic failure or a server-health symptom; `bench/lib/reason-notes.mjs` explains both codes to a
reader in prose, and `bench/lib/sweep-report.mjs`'s `STARVED_WHY` is total over the exported
`STARVED_REASONS` and selected with `Object.hasOwn`, so a coverage row's sentence is the one written
for its own reason, while a reason that is unrecognised, blank or not text at all gets a sentence of
its own; `reasonSuffix` is the one place a row prints the reason itself, and `displayReason` bounds
and escapes every value it prints, because `unrecorded` carries a filesystem error message rather
than a code.

`scripts/lib/review-unparsed.mjs`'s `unparsedReply` is a post-hoc classifier, not a request-failure
path: `token-exhaustion` (`finish_reason: 'length'`) and the reasoning-only fallthrough to
`client.mjs`'s `requireAnswer` both fire *after* a physical request has already closed successfully
in the ledger, so both throw sites wrap their `UserError` with `withLedger(error, ledger)` (OAI-116)
— the ownership boundary lives here, in the one function that decides a completed answer is
unreportable, rather than duplicated at its two `review-report.mjs` call sites (`reportFindings`,
`parseFields`). Without it `errorReport()`'s `attempts` field silently read `null` for the dominant
overnight-sweep failure mode, which made OAI-19's gate criterion G-E structurally unpassable.

`--max-seconds` caps a whole model call in wall clock, retries included — `scripts/lib/http-budgets.mjs`
arms it as the transport's `deadline` budget from one expiry `requestFindings` mints per command, and
`scripts/lib/throughput.mjs` divides the reply's completion tokens by the generation time it was
measured over.

`scripts/lib/failure-shape.mjs` names the shapes in which a request dies without the model saying no
and splits them by whether a retry could survive it — `transport` retries, `non-retryable-transport`
is a pre-response failure it does not recognise as transient — while `scripts/lib/provider.mjs`
`reword` improves such a failure's message without ever changing that verdict, and the same file's
`describeFailure`/`assertOk` carry the endpoint and a server's echoed body on `error.endpoint` /
`error.responseBody` — joined for display only by `transportDetail`, and never inside `.message`
(OAI-185); `scripts/lib/body.mjs`'s `readJson`, `scripts/lib/sse.mjs`'s `readSse` and
`scripts/lib/http-errors.mjs`'s `assertDecodable` all carry a malformed reply or header value the
same way, on `error.bodyExcerpt`, and `scripts/lib/completion.mjs`'s `refuseUnusable` and
`scripts/lib/client.mjs`'s `requireAnswer` carry the server's unvalidated `finish_reason` on
`error.finishReason` — `tests/structure.test.js`'s `no server-controlled value reaches a UserError's
message` scans exactly these files, is itself exercised against every historical leak this discipline
was written from, and is scoped rather than repo-wide: a server-reported model id can still reach a
`UserError` message via `model-selection.mjs`/`delegate.mjs`, deferred as OAI-185 residue since it
never reaches the background persistence path this discipline protects; and
`scripts/lib/answer-attempts.mjs` `answerWithRetry` retries only the retryable ones, spanning
`postWithDegrade` and `finishAnswer` so it can see every shape; `scripts/lib/attempt-ledger.mjs` records
one entry per physical request so scoring reads the attempt that answered while reliability reads
every attempt, and `scripts/lib/attempt-outcome.mjs` owns what one request's ending means — a refusal
becomes `refused` only when `begin` creates the replacement entry, and stays a `shape-rejected`
failure when nothing replaced it.

Server-state questions are answered by shortening the TTL below a known prefill and trying to falsify
the JIT-TTL mechanism, never by sampling residency around a run — the instrument is
`bench/ttl-challenge.mjs`, and it **refutes but cannot confirm**: proving an unload was post-expiry
needs residency observed *after* expiry, which a mechanism firing *at* expiry never leaves behind, so
an observed absence is recorded and attributed to nothing. Its I/O half is driven end to end against a
stub `lms` in `tests/ttl-challenge-e2e.test.js`, because the same instrument was withdrawn once for
having a decision-shaped half that had never executed. **Run 2026-08-04: the deterministic form is
refuted** — 3/3 episodes held 336s of prefill under a 120s TTL, continuously resident — which
removes a candidate for the observed request drops without explaining them; their cause is still
unresolved.

Every attempt entry carries `serverResponded` — *an HTTP response was obtained*, never *a peer was
reached* — which `settle` and `pendUntilReplaced` take from the outcome while `fail` weighs
`obtainedResponse`'s independent witnesses — the transport's flag, an HTTP status code, a completion
shape, or a measured prefill.

`bench/lib/reason-notes.mjs` `reasonNotes` renders a gated explanatory paragraph for each reason
code a reader could misread, looping over one exported `REASON_PARAGRAPHS` table — an entry's code
is its gate, so gating cannot drift from membership, while right-prose-under-right-code is
test-asserted (each paragraph names its own code) rather than structural, and the glossary test
derives its absence checks from each entry's own prose bytes — and enumerates what the attempt
record holds rather than asserting what it lacks, rendering that list from `RECORD_FIELDS`, whose
membership `tests/bench-reason-notes.test.js` pins against a closed ledger entry.

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
corroborates with the heartbeat — and `pidLiveness` answers `live`, `gone` or `unreadable` rather than
a boolean, because **only `ESRCH` proves a process gone**: a value that is not a pid, and an errno this
build does not interpret, are both `malformed` — a verdict nothing collects — so a queued row holding
one can never be attached by `registerWaiter`, no automatic path collects it, and `/oai:abandon
--force` can write it off where this build can read the row at all — `unknown-version` refuses above
the malformed rung and no flag lifts that. **The
unreadable value is never quoted in the failure record and no command is named beside the row**:
keeping it and advertising the exit were both cut as separate work rather than grown inside this
change (`finish` NULLs `worker_pid` and only that, so a queued row's `waiter_pid` outlives the write,
though nothing displays it once the row is terminal) — a worker's last act is to beat — and nothing here ever signals a
process it cannot verify, which `tests/queue-guards.test.js` enforces structurally; cancel is
therefore cooperative, and **a dead pid says the process is gone, never why** — so
`scripts/lib/cancel-ack.mjs` has the exiting worker announce itself in a file beside the job log
(never a row, which would release the queue mid-request, and never a line in the log, which carries
model output), and a `running` row that died without one reads `failed` / `cancel-unconfirmed` rather
than as a tidy cancellation; a `queued` one provably sent nothing and needs no announcement.
`job-retention.mjs` keeps the newest 50 finished jobs, deleting each row
before its log so that a crash in between leaves an orphan the same sweep already collects, and every
exemption sits in `PRUNE`'s inner `SELECT` — which is what makes an exempt row uncounted as well as
undeleted — including the `OPERATOR_ABANDONED` row that reached `running`, whose worker may still be
salvaging an answer into the log a prune would unlink. `orphanSeqs` does not catch a `logs/` it cannot
list (OAI-167) — that fault reaches `sweepQuietly`'s existing rethrow rather than reading as an empty
directory. What the
model sees is frozen at submission as `request.messages`, so the worker never reads the filesystem.
**Blocking is relational, not a state**, so `job-queue.mjs` `scanQueued` is the one definition of the
queue's head — `decide` dispatches on it, and `job-view.mjs` `blockingSeqFor` walks `decide`'s own two
rungs (a non-dead running row, else that head) to name the foreign row a bare `/oai:status` marks,
gated on this workspace holding a queued job that is live or still inside its startup grace.

`scripts/lib/job-abandon.mjs` is the only path that terminalizes a row whose pid still reads `live`,
and it is an **operator-authorized exception to one-job-at-a-time rather than a reconciler**: nothing
signals anything, so `/oai:abandon` writes off the ROW as `failed` / `operator-abandoned` — never
`cancelled`, per OAI-66 — and `job-queue.mjs`, `job-heartbeat.mjs`, `job-liveness.mjs`,
`job-reconcile.mjs` and `commands/status.md` each name that exception where they state the invariant.
`abandonRow` reads, decides and writes inside **one** `BEGIN IMMEDIATE`, because `beat` refreshes
`last_beat_at` on any non-terminal row and `finish` compares only state, so a row read before the lock
is not an authoritative read — a property `tests/queue-guards.test.js` pins structurally, since a
synchronous `node:sqlite` makes it unreachable behaviourally. `abandonDecision` admits `queued` and
`running` by **whitelist** — an unrecognised non-terminal state is refused rather than left to produce
an uninterpretable `false` from `finish` — and refuses a fresh or unreadable beat unless `--force`, while
**four** refusals are lifted by no flag at all: an unknown `schema_version`, a state outside that
whitelist, a row still inside its startup grace, and a row whose pid is **dead or never registered** — that last
one is ordinary reconciliation's work, and `abandonRow` hands it over inside the same lock rather than
attributing a death to the operator who asked, reporting the two kinds apart because only one of them
ever had a process. A row **recovery has already settled** reports idempotently instead of refusing,
which is what stops a concurrent reconcile producing an exit-1 refusal at an operator whose queue was
just freed; a `failed` row recovery did not write stays an ordinary refusal, and an unreadable failure
payload fails closed to that. A `malformed` row is refused but IS liftable, because refusing it
outright would leave a corrupt row wedging the queue with no escape at all.
`scripts/lib/job-drain.mjs` `couldDrain` walks **both** of `decide`'s rungs so a queued head under a
live `running` row is never reported as having unblocked anything, and requires the successor's beat to
be readable and fresh — `live` proves only that a pid number is occupied, so accepting it would
reproduce inside this command the very defect it exists to fix. That bar is deliberately stricter than
`decide`'s own eligibility, so it under-claims rather than lies. **Liveness is resolved inside that transaction and passed into the decision**, so the probe the stored
message cites is the one the write was authorised on; the guard asserts at least one `livenessOf` call
inside the lock. `abandonFailure` is what the row says afterwards, in **two arms**: a `malformed` row was never probed
at all — no pid recorded, timestamps that will not parse, or a value that is not a pid — and only the
readable-pid arm may say a probe answered, citing the pid as **evidence and never as a target**, since
the inability to prove that number still belongs to the job is why this command exists. `/oai:status` names the
remedy only where it would work — a live owner, a stale beat, a known row version and a writable
database — and says nothing at all for a blocker the command would refuse.

`scripts/lib/job-busy.mjs` `withBusyRetry` bounds a `SQLITE_BUSY` by elapsed time at seven enumerated sites,
while skip-only callers keep a bare `isBusy` catch and the store's open takes the exclusive WAL lock only
when the journal mode is not already set — and **where a retry sits decides what it can cost**: the
completed write sits outside the catch that publishes `failed`, and the `failed` write inside a catch of
its own that discards neither error, because a throw raised in a `catch` replaces the pending rethrow, while
an exhausted completed write hands its outcome to `scripts/lib/cmd-task-worker.mjs` `salvageOutcome`
(the one step in this paragraph that is not `job-busy.mjs`'s) — one `SALVAGED_OUTCOME` line on the log
the worker already owns, so the answer outlives the row that would not take it.

`scripts/lib/cmd-result.mjs`'s `writeAnswer` defends `job.outcome`/`job.request`/`job.transport`
against a shape this build does not recognise — three JSON blob columns a newer or different build
may have reshaped — before ever asking whether it has an answer. Three consecutive review-ladder
passes on the original field-by-field guards each found another unvalidated field reaching the same
interpolation-throws-`TypeError` hazard through a different call path, which is what the fix
consolidated into `validateOutcomeShape`: a table (`RENDER_CONSUMED_FIELDS`) of every render-consumed
field outside the graceful-omit paths below, each an exported `{ path, get, valid }` entry, so the
coverage a reader can audit and the coverage `tests/result.test.js`'s structural test empirically
proves are the same list rather than two hand-maintained ones that could drift together.
`isOptionalArtifact` requires `outcome.artifact`'s `.state` to be one of the four values
`task-artifact.mjs`'s `artifactNote` actually branches on, and requires `.detail` to be a real string
for every state but `applies` — the one branch that never reads it — since `artifactNote`
unconditionally interpolates `detail` in the other three. `job.request.estimatedTokens` gets its own
`isOptionalNumber` rather than `isOptionalString`, since a legitimate value there is always a number.
`render.mjs`'s `providerPart` gives `transport?.name` an `undefined`/`null` → friendly-label
treatment, the same shape of fix `modelPart` already applies for `model` — though not identical:
`modelPart` special-cases only `undefined` (a legitimate `null` model, a server that answered
without naming one, still renders as `model: null`), while `providerPart` collapses both, since
there is no equivalent legitimate-`null` case for `transport.name`. Replaces an unguarded
`` `provider: ${providerName}` `` interpolation. `writeAnswer` composes every fragment — content, footer, artifact note, template
notes — into one array and issues exactly one `stdout.write`, so a field this table still somehow
missed fails before any byte reaches stdout rather than after part of the answer is already visible.
Deliberately excluded from the table: `usage.prompt_tokens`/`completion_tokens` and
`durationMs`/`prefillMs`/`generationMs`, already covered by an established, unrelated
`Number.isFinite`-based graceful-omit design (below) that this fix has no mandate to change.

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
report itself, since a throwing stderr would lose the id it was announcing.

`job-store.mjs` `requireDatabaseSync()` gates `node:sqlite` as a **capability rather than a version** —
one caught dynamic import classified at first use, so a runtime without that builtin loses background
jobs alone instead of every command, and an unrecognised fault keeps its cause instead of being
relabelled a stale Node.

`task-submit.mjs` `noteEndpointPersistence()` warns that a background submission persists its
endpoint by **taking no argument, gating on nothing, and running before anything else writes to
stderr** — the code cannot know which part of a URL is a secret, so the notice describes the storage
rather than the credential and is emitted where no preamble can crowd it out. A query string on an
endpoint resolved from `providers.json` is
committed via `job-auth.mjs`'s `queryCommitment`/`querySalt` rather than stored (OAI-55), with
key-authorization (`apiKeyAuthorized`) tracked separately from profile provenance so a query-only
credential can be re-resolved without ever authorizing a key nothing granted at submission; a query
on an endpoint given as `--base-url`, or a credential sitting in the URL path, is still written whole.
A key-authorized row also pins `credentialSource` (`{kind:'env', name}` or `{kind:'inline'}`) so a
`providers.json` `apiKeyEnv` repoint — a different secret behind the job's unchanged, authorized
endpoint — is refused at resolution, while an ordinary value rotation behind the same source is not
(OAI-183).

`agents/oai-delegate.md` delegates as a **context broker rather than a forwarder** — it picks the
smallest sufficient file set itself, spends at most two `task` submissions on at most one accepted
job, and returns an account plus the job id instead of the model's reply, so neither the reading nor
the answer lands in the calling session; `tests/plugin.test.js` pins the status line it polls at both
ends, against `TERMINAL_STATES` and by running the agent's own `awk` expression.

`scripts/lib/task-template.mjs` makes `/oai:task --template advisor` a named question rather than a
prompt each caller rewrites: `TEMPLATES` holds the skeleton, the reply shape and the discipline, the
whole skeleton goes in the **system** message so `/oai:status` still shows what the user asked, and
`templateNotes` builds the caveats both `/oai:task` and `/oai:result` print; `advisor`, `diagnose` and
`patch` ship, and `--json` carries the same notes as an array so a harness cannot read a crowded reply
as a clean one.

`scripts/lib/eta.mjs` estimates prefill and generation separately from two per-provider config rates
and prints **nothing** when a provider has none — a wait copied from other hardware is acted on as
confidently as a measured one. `scripts/lib/task-artifact.mjs` is the one place a task answer is
checked rather than captioned: it extracts a `patch` template's diff and runs `git apply --check`,
reporting `applies` / `rejected` / `absent` and never applying anything.

`bench/task-run.mjs` scores `/oai:task` templates against declared markers grouped by what naming them
demonstrates, with both framing arms run and never averaged, each case guarded by an **executable
witness** that must fail on `before/` and pass on `after/` — and it states in every report that a
marker profile is evidence quality, **not** Stage 2's economic gate.

`bench/` scores `/oai:review` against committed snapshots of this repo's history: each case is a
historical commit re-staged as `before/`/`after/` trees with its known defects catalogued, run through
the real CLI via `--json` and matched on a quoted anchor line. `bench/lib/report.mjs`'s per-case table
carries a `lens` column — `bench/lib/case-rows.mjs`'s `lensSamples` aggregates each case's distinct
`<rung>@<window>` labels (`whole@154624`, `hunks@61696`, `hunks@unsized`, `diff`) over `measurable`
runs and joins them, so two per-model reports compared on one case reveal when they reviewed it at
different depths rather than silently equating a hunks-only review with a whole-file one.

`bench/review-sweep.mjs` reviews commits newest-first from `--from` until a wall clock stops it,
against **this** repo by default or `--repo <path>` for another one — which requires an explicit
`--include`, since `DEFAULTS.include` is this repo's own layout and would silently review almost
nothing else pointed elsewhere (OAI-165); `git()` and `invoke()` both root at `options.repo`, and
`bench/lib/sweep-outcome.mjs` `classify` builds every report-derived entry through one mapping so each
carries the envelope fields that change what a reader should believe (`analysisCut`, `atCap`,
`hunksOnly`, `skippedUnsizedWindow`, `dropped`, `reason`) — leaving each commit disposed of exactly once across the report's
three sections, so a night lost to starvation reads as coverage rather than as silence.

`bench/lib/sweep-ledger.mjs` `openLedger` appends each commit to a JSONL ledger as it settles — one
unbuffered `appendFileSync` per line, every record written **leading-newline-first** so a part-written
line cannot fuse with the next successful one, the file created `wx` because two runs merging into one
ledger still parses where the artifacts beside it would visibly clobber, and the header carrying the
enumerated **manifest** so `bench/recover-sweep.mjs` can synthesize `unobserved` for what a crash never
reached and hand the result to the same `writeSweep` a completed run uses. **Three failure points, three
policies**: bootstrap kills the run, a per-entry write declares a `gap` and carries on, a stamp collision
is refused. `bench/lib/sweep-health.mjs` `serverHealth`
**derives** the consecutive-outage streak from the recorded timeline rather than storing a counter,
selecting attempted commits on `startedAt` — and its `timelineComplete` warning is about the HEALTH
timeline, so a missing **ineligible** commit does not raise it while coverage still disposes of that
commit.

`scripts/lib/config.mjs`'s `loadConfig()` gives `providers.json` the same posture `job-store.mjs` gives
`jobs.db` — `0600` at creation and unconditionally repaired on every later load, since a profile may
carry an inline `apiKey` — and `cmd-setup.mjs`'s `probeProvider` redacts a failed profile's `baseUrl`
through the same `normalizeBaseUrl` the success path already uses, rather than falling back to the raw
string a query-embedded credential could still be sitting inside.

## Commands

- Test: `npm test` (`node --test` over `tests/**/*.test.js` — the path scope is load-bearing, see footguns).
  **Requires `zsh` on PATH**, and fails loudly without it: `tests/delegate-template.test.js` runs the
  delegate's shell recipe under every shell present, and zsh is the one that catches word-splitting
  bugs the POSIX shells agree to miss — it is also the shell the recipe actually runs in. Declared
  here rather than left implicit, and required rather than skipped, because a suite that silently
  shrinks its shell matrix is a check that has stopped being able to fail.
- Benchmark the reviewer: `npm run bench` (opt-in, needs a real model; `--runs N`, `--case <id>`, `--diff-only`, `--cold`, `--warm-up`, `--max-attempts N`)
- Overnight review sweep: `node bench/review-sweep.mjs --minutes N|--until HH:MM [--repo <path> --include <prefix>...] [...]`
  (opt-in, needs a real model). With no `--repo`, sweeps this repo under its own defaults. Pointed at
  another repo, `--include` is **required** — one or more path prefixes in the target's own layout —
  or the command refuses rather than reviewing almost nothing under this repo's defaults.
- Recover an interrupted sweep: `node bench/recover-sweep.mjs [--out-dir DIR] [--force] <review-sweep-<stamp>.ledger.jsonl>`
  — turns the ledger a crashed run left behind into the report it never wrote. **Options come BEFORE the
  ledger path** (`parseArgs` stops reading flags at the first positional; the other order is refused
  rather than silently ignored), it takes exactly one ledger, and it refuses a run whose own record is
  already written and parses — `--force` overrides that.
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
  classified and retried, and every physical attempt is recorded. **OAI-19 (concluded 2026-08-24,
  both arms exhausted their gate invocations as failures — no scalar recall number for either model;
  see `BACKLOG_DONE.md`) did settle the retry question separately, despite the arm's overall
  invalidity: 11 runs answered on attempt 1, 3 more were rescued by retry, 4 were lost despite three
  attempts — 61.1% → 77.8% complete. But `scaffold` went 0 answered, 0 rescued, 3 lost. Retry rescues
  where a failure is independent and buys nothing where it's deterministic for that request — partial,
  and not on the case that matters most (`evidence/019.md`).**
- **Two claims about a bench arm were promoted from a single run per arm, and both were wrong**:
  "context dilution is measured" and, one paragraph after diagnosing that error, "two passes found
  different defects, so a union would score 2/2" — which compared runs from two *different modes* and
  never reached print only because it was caught first (full account:
  `evidence/backlog-header-history.md`). **N=1 per arm is a lottery ticket, not a comparison, and a
  pair of cases that differ in more than the variable under test measures nothing.** Both are cheap to
  avoid when running or reading a bench arm: `--runs N` exists, and `--diff-only` gives a within-case
  arm.
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
- Review runs the `review-ladder` skill's stage table — read the stages there; this file does not
  restate them. The built-in `/code-review` stays available at `medium` when typed by hand.
- Every recurring defect class graduates from a reviewer's prompt to a structural test —
  `tests/structure.test.js` holds the ones found so far (no file/function size ratchet — retired
  2026-08-17, see BACKLOG.md). `tests/plugin.test.js` guards the markdown command surface, which
  nothing else notices when it rots.
- Commit gate: tests green + verify skill passed before committing.

## Work tracker

- `BACKLOG.md` — numbered items with stable global IDs (`OAI-1`, `OAI-2`, …). IDs never encode
  order and never renumber. **`tests/backlog-structure.test.js` enforces tracker integrity on every
  `npm test`** (OAI-104, 2026-08-09 — before it, the same guarantee was prose naming a script that
  did not exist, and it found three classes of live drift on its first run): no ID repeats among the
  live bodies, every item-shaped line is a canonical top-level body (not a malformed or
  mis-indented one), nothing is live and closed out at once, and every stub bullet's target resolves
  in the same tracker and never to another stub. **The tier-ranking priority index and the
  absorbed-ID redirect table were retired 2026-08-20**, owner-directed, matching the same removal in
  `~/Code/backlog` and `~/Code/dotfiles` — there is no priority-ranking *pass* (no separate index,
  no table) over this file. A merged item now gets a one-line stub bullet
  (`- **OAI-n** — Absorbed into OAI-m; see that item.`) wherever the item it merged into lives,
  resolved through the ordinary `- **OAI-n**` shape every item uses, never a separate table.
  **Physical order is a separate question from the retired tier system, clarified 2026-08-27**:
  item bodies are ordered by priority, most urgent first, and moving an item is expected as
  priority changes — the 2026-08-20 retirement removed the *tiers* label and the redirect table, not
  the ability to reorder. Nothing mechanically enforces priority order (it is a judgement call,
  same as picking the next item always was); find a specific item by exact-ID search, not by
  position.
- The current direction is **"use local LLMs like I use Codex"** —
  [`plans/local-llms-like-codex.md`](plans/local-llms-like-codex.md), paired with Codex. Stated here
  rather than at the top of `BACKLOG.md`, which is data (items), not project context. Retired
  `BACKLOG.md` header narrative (prior sweep rewrites, and the pre-2026-08-04 "prove the reviewer
  trustworthy first" theme) is archived verbatim at
  [`evidence/backlog-header-history.md`](evidence/backlog-header-history.md); the N=1-per-arm
  methodology lesson moved live into this file's own "Session footguns" section instead, next to the
  bench footguns it's about.
- `BACKLOG_DONE.md` — completed items, newest first.
- `BACKLOG_PARKED.md` — two distinct reasons, never conflated: `refuted` (the item's **framing** was
  disproved) or `not worth doing` (the framing is right but no dated instance clears the worth bar —
  see `backlog-sweep`). Neither is "merely deprioritised." Each carries a **reopening bar**: what
  would have to be observed for it to become live again. An item still wanted but unscheduled, or
  awaiting a dated instance that just hasn't happened yet, stays in `BACKLOG.md`.
- **"Pick next item" means the first live body in `BACKLOG.md`** — physical top-to-bottom order
  encodes priority (owner-directed 2026-08-27), most urgent first, and reordering is expected as
  priority changes. IDs are stable global identities and are never renumbered when an item moves.
  "mark done" = move the item to BACKLOG_DONE.md with the date; "park" = move to BACKLOG_PARKED.md
  with a reopening bar. If a merge leaves an ID cited elsewhere with no body of its own, give it a
  one-line stub bullet wherever the surviving item lives.
- **Filing a NEW item clears the same worth bar `backlog-sweep`'s consolidate pass applies
  retroactively (2026-08-18, after 188 issued IDs and ~two-thirds of live items turned out to be
  another item's residue): a dated instance already observed, or a named silent-failure mechanism —
  never a plausible future, and never the filing session's own judgement that it's worth keeping.**
  This is not scoped to review-ladder's out-of-scope findings (`agents/skills/review-ladder/SKILL.md`
  already gates those prospectively) — it applies to a finding from ANY source considered for filing:
  an external tool's report (an overnight local-model sweep, a linter, a benchmark), an ad-hoc
  observation, a probe. A finding that is explicitly latent or unexercised in the code it was found in
  (the finder's own words, not a later rationalisation) fails this bar and is noted in the
  conversation rather than filed — it does not need a tracker ID to not be lost, since the artifact
  that found it (a sweep report, a review transcript) already exists and is the citable evidence if it
  ever does fire.
