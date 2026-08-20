STATE: proceeded without harness plan-mode — explicit standing session authorization to bypass the
interactive ExitPlanMode gate (the operator stepped away and asked to iterate technical features
without user input, converging with Codex on any decision that would otherwise go to them). No
provenance: line: this was never a harness plan-mode plan. Approval for this plan is Codex and the
Claude verdict subagent in agreement — the /feature skill's own documented substitute for user
approval — not the operator's own sign-off. plans/README.md's unattended-draft state (per the ADR
it cites) would instead have this block the item; that mechanism was knowingly not used this run,
on the operator's explicit instruction, and this deviation is flagged for the operator on return.

# OAI-185 — the authorized endpoint's own baseUrl (and a server's echoed response body) can carry a
secret, and a connection or protocol failure echoes it verbatim into two persisted, longer-lived
records: jobs.db's row.failure.message, and the background worker's own job log.

## Problem, as verified

1. scripts/lib/provider.mjs's describeFailure() bakes profile.baseUrl directly into the thrown
   error's .message at all three reword(...) call sites (ECONNREFUSED ~line 64, ENOTFOUND/EAI_AGAIN
   ~line 69, and the generic fallback ~line 74, which also interpolates the underlying transport
   error's own .message).
2. scripts/lib/cmd-task-worker.mjs's publishFailure() → scripts/lib/review-report.mjs's
   errorReport(error) copies error.message verbatim into row.failure.message, persisted into
   jobs.db and later shown to any reader of /oai:result (cmd-result.mjs:81).
3. Independently, the worker's uncaught error (rethrown out of runAndPublish in
   cmd-task-worker.mjs) reaches the same top-level main().catch in scripts/oai-companion.mjs
   that every command shares, which prints error.message to stderr — and the worker's stdio is
   ['ignore', log, log] (job-spawn.mjs), so that stderr write lands in the job's own log file. A
   second, independent leak of the same value, not named in the original backlog text.
4. A third reviewer found a related, distinct vector reaching the same two sinks: assertOk() in
   provider.mjs (~line 84-112) embeds up to 400 chars of the *server's own* HTTP error response body
   into .message for a non-2xx reply. A server can echo the request path/query back in a 404/405
   body (LM Studio does), which can contain the same secret-shaped baseUrl segment. Widened into this
   plan's scope after a Codex steer (see Decisions).

baseUrl is already committed to the job row at submission time, unredacted, with a printed operator
notice (task-submit.mjs) — but nothing currently reads that stored field back out via /oai:status
or /oai:result; only failure.message is actively displayed later. So the exposure is specifically
in the two places above, not in the row's own baseUrl field.

Regex-scrubbing a secret-shaped substring out of an already-built message is explicitly ruled out
(OAI-63: five rounds of that approach, each defeated by a narrower bypass).

## Decisions (Codex-converged; no open forks left for the operator)

- **Endpoint carriage: structured field, built at display time.** describeFailure() stops
  interpolating profile.baseUrl into .message; it sets a generic message (e.g. "Cannot reach
  lmstudio — connection refused.") plus a separate error.endpoint field carrying the raw baseUrl.
  Rejected alternative: a second, background-only message-composer that reconstructs a persistence-safe
  string from clean fields, living beside the existing message builder — rejected because it duplicates
  the transport-message vocabulary in two places that must be kept in sync by hand as reasons are
  added, and any future consumer defaulting back to .message for richer detail silently reintroduces
  the leak. One place builds the message; callers choose what to append.
- **Scope widened to assertOk's response-body leak (Codex steer: RECOMMEND A).** Same pattern:
  assertOk() sets error.responseBody carrying the raw (≤400 char) body detail; .message becomes
  generic (provider name, status, path — no body text). scripts/lib/structured.mjs's
  isFormatRejection() (its one functional, non-display consumer of that body text) is migrated from
  pattern-matching error.message to reading error.responseBody. Redirect's Location header
  (assertOk's other branch) is explicitly **out of scope** — not independently demonstrated as a
  leak vector; revisit only if it is.
- **Foreground display: explicit allowlist, not an exclusion.** Only genuinely interactive commands
  (setup, task, review, status, result, cancel, abandon — i.e. COMMANDS in
  oai-companion.mjs, never task-worker) get error.endpoint/error.responseBody appended to the
  printed stderr message. Allowlist rather than "skip task-worker" so a future internal command fails
  closed by default rather than needing to remember to exclude itself.
- **Persistence: absence by construction, not redaction.** errorReport() (review-report.mjs) is
  never given .endpoint/.responseBody to copy — it already only copies an explicit field list, so
  no change is needed there beyond a comment recording the omission is deliberate, plus a test proving
  it.
- **The generic fallback message (describeFailure()'s third reword() site) must omit both
  profile.baseUrl AND the underlying transport error's own .message** — that nested message can itself
  carry the request URL (a Node syscall error routinely does). "Generic" means neither source
  contributes to the persisted/logged string; a test proves both are absent, not just the literal
  baseUrl substring.

## Files touched

- scripts/lib/provider.mjs — describeFailure()'s three reword(...) sites (generic message +
  error.endpoint); assertOk()'s non-2xx branch (generic message + error.responseBody).
- scripts/lib/structured.mjs — isFormatRejection() reads error.responseBody instead of
  error.message.
- scripts/oai-companion.mjs — top-level main().catch: append error.endpoint /
  error.responseBody to the printed message only when command is in the interactive COMMANDS
  allowlist.
- scripts/lib/review-report.mjs — comment on errorReport() recording that .endpoint /
  .responseBody are deliberately never copied.
- Tests (new or extended, exact files chosen during implementation to match existing suite layout):
  - describeFailure() unit coverage: each of the three reason codes produces a generic message plus
    a populated .endpoint.
  - assertOk() unit coverage: non-2xx produces a generic message plus a populated .responseBody;
    isFormatRejection() still detects a schema refusal via .responseBody.
  - errorReport() adversarial test: given an error carrying secret-shaped .endpoint and
    .responseBody, the returned report object contains neither substring anywhere in its
    JSON-stringified form.
  - Worker end-to-end (extends existing background-job test infra): submission-time preparation
    (prepareTask -> resolveTarget) makes a live network call (the /v1/models probe) BEFORE the job
    row is created, so a provider that is simply unreachable fails at submission and never reaches
    the worker at all. The test must instead use tests/helpers.mjs's startFakeServer with a handler
    that answers the models probe successfully (so submission succeeds and the job is queued) and
    then fails or returns a marker-bearing non-2xx body on the chat completion request (so the
    worker's own attempt is what fails) — one variant for the connection-style failure
    (describeFailure path, e.g. the handler closes the connection or resets it on the chat request)
    and one for the echoed-body failure (assertOk path, e.g. a 404 whose body embeds the marker).
    Both variants assert: the resulting jobs.db failure.message is free of the marker, AND the
    job's own log file (stdout+stderr capture) is free of the marker.
  - Foreground behavior preserved: an interactive command's printed stderr still names the full
    endpoint on the same failure.

## Verify

- npm test.
- Mutation check on the key invariant: revert errorReport()'s omission (temporarily copy
  .endpoint into the returned object) and confirm the adversarial persistence test fails; restore
  and confirm green.
- Manual end-to-end: a live LM Studio target cannot carry an arbitrary marker path segment without
  breaking its own /v1/models route (the same sequencing problem the worker-test finding named,
  applied to the probe itself), so this step uses the same fake-server technique as the automated
  worker end-to-end test, run standalone rather than under node --test: start a local fake server
  (tests/helpers.mjs's startFakeServer, or an equivalent throwaway script) whose baseUrl carries the
  marker in its path, handler answers /v1/models successfully and fails the chat completion request,
  point a providers.json profile at it, submit a background job, confirm via sqlite3 jobs.db and the
  job's log file that the marker is absent from both, and confirm /oai:result on that job still
  reports a useful, generic failure message.
