# OAI-94 — a credential notice that cannot print the credential

provenance: harness slug typed-baking-dusk

## Context

`warnAboutQueryCredentials` (`scripts/lib/task-submit.mjs:36-42`) exists to tell the user that a
`--base-url` query string is persisted with a background job. It interpolates that query string into
its own warning, on **stderr**, which reaches terminals, CI logs and the delegate agent's captured
output — so the notice about the secret prints the secret. Observed on a real submission.

OAI-61's review ladder built a fix, reviewed it across four passes, then returned it with a partial
plan withdrawal (`adr/033`). The withdrawn code was never committed; only the design survives, in
BACKLOG.md. Six wordings were killed there, each by an execution path that falsified it:

1. interpolate the query string → prints the secret
2. parameter **names** only → defeated by a bare valueless token `?SUPERSECRET123`, which parses AS a name
3. "the key goes to the provider" → false when a `--file` is missing and nothing is sent
4. "if this submission succeeds" → false when `spawnWorker` throws after `insertJob` (row written, exit 2, no id)
5. "readable only by you" → a guarantee the code cannot give (the chmod is best-effort and swallows failure — OAI-95)
6. mechanism-only plus unfalsifiable advice → bought safety by becoming uninformative

**Probe (2026-08-06, Codex, all four claims TRUE):** the interpolation is real and pre-`openStore`;
`normalizeBaseUrl` keeps everything but the query in `profile.baseUrl`, so a credential in the URL
**path** is persisted as `transport.baseUrl` with **no notice at all**; `insertJob` precedes
`spawnWorker`, so a spawn failure leaves a row and reports no id; `provider.mjs:99` interpolates
`response.headers.location` verbatim.

**Forks settled with Codex (the user is asleep and directed design forks there):**

- **Trigger — unconditional.** The code cannot know which part of a URL is a secret; any selective
  trigger either misses path credentials or guesses. The notice fires on every background submission
  and describes storage, which is universally true whenever a row is created.
- **Scope — the `Location` echo is OUT.** It is a distinct output path with its own redaction
  semantics, sibling to the already-filed OAI-92, and is not needed to make this notice safe and
  truthful. Filed at the residue step, cross-linked to OAI-92. Widening here is exactly how OAI-61
  stopped converging.

## Landing wording

> If this submission creates a job record, its full endpoint — including any query string — will be
> written to jobs.db; a later worker-start failure does not remove it.

Conditional (`if this submission creates a job record`) so a failure before `insertJob` does not
falsify it; the worker-start clause is true precisely because `spawnWorker` runs after `insertJob`;
it interpolates **nothing** and makes no permission guarantee.

## Phases

### Phase 1 — the notice

`scripts/lib/task-submit.mjs`:

- Replace `warnAboutQueryCredentials(profile)` with `noteEndpointPersistence()` — no parameter, since
  taking one invites interpolating it. Unconditional; emits the landing wording on stderr.
- Update the doc comment above it: it currently reasons about `profile.query` and asserts the row is
  `0600` and the directory `0700`. Both claims belong to OAI-95's withdrawn hardening; the comment must
  say why the notice takes no argument and why it is unconditional.
- Call site at `:99` becomes `noteEndpointPersistence()`. ~~Unchanged in position~~ — **superseded by
  the amendment below, which moves it above `prepareTask`.** It remains before `openStore`, so a store
  failure still does not suppress a notice about what a submission would persist.

**Amended 2026-08-07, at the review ladder's verdict point — the position is NOT free.** Both
approvers returned `CHANGES-REQUIRED` on a defect measured against the real CLI: `process.exit(2)`
in `oai-companion.mjs:37` discards pending stderr, and `delegate.mjs:145` writes
`Checking <provider name>…` **before** the notice, with provider names unbounded by config
validation. At a 1 MB provider name the pipe truncates at 128 KB and the notice is **lost**, while
`insertJob` has already written a row holding the credential — exit 2, no job id, no warning. That is
precisely the scenario the sentence exists to describe, failing silently.

Two remedies were measured, not argued. `fs.writeSync(2, …)` — which keeps the position and changes
only the write — **does not fix it**: `process.stderr.write` queues the preamble in userland and
flushes it asynchronously, so a later synchronous write has no guaranteed position relative to that
queue (measured: notice still absent). The remedy that works is to **move the call above
`prepareTask`**, so nothing precedes the notice on stderr and it always lands in the earliest bytes
(measured: delivered in all three arms, including 1 MB).

The cost is real and is accepted rather than hidden: the notice now also fires on a submission that
dies **inside** `prepareTask` — a missing `--file`, an unreachable server — which persists nothing.
The sentence stays **true** there, because its conditional is "if this submission creates a job
record". What is lost is precision, not honesty, and the alternative is a notice that goes missing in
the one case it was written for.

### Phase 2 — witnesses that can fail

New `tests/credential-notice.test.js` (`NEEDS_SQLITE`-skipped, fake server, `runCompanion`), each
assertion on a **success path** where the notice actually fires — the lesson that cost OAI-61 four
passes was that every prior assertion ran on a refusal path:

1. **query credential, success path** — submit `--background` against the fake server with
   `--base-url <server>/v1?api_key=SUPERSECRET123`; assert exit 0 and a job id on stdout (proving the
   notice fired on a real submission), assert stderr contains the notice, and assert stderr
   **does not contain** `SUPERSECRET123`.
2. **path credential** — `--base-url <server>/v1/SUPERSECRET123`; the notice still fires (it is
   unconditional) and stderr still does not contain the token. This is the case that had no notice at all.
3. **no credential** — a plain base URL still prints the notice, pinning "unconditional" rather than
   letting a future gate quietly return.
4. **the promise is not made** — stderr does not claim `readable only by you`.

Assertions 1 and 2 are the ones that must fail when the interpolation is restored; that is the
mutation in the verify step.

### Phase 3 — docs

- `adr/019-a-notice-that-cannot-print-the-secret.md`: the six killed wordings with the execution path
  that killed each, the unconditional-trigger decision and why a selective one cannot be written, the
  scope boundary against OAI-91/92/95, and the test lesson (a refusal-path assertion cannot fail).
- One present-tense line in CLAUDE.md naming `noteEndpointPersistence` and linking ADR 019.

## Verification

- `npm test` (full suite; `zsh` required) — quote the summary line.
- Repo `verify` skill, all steps.
- **Mutation.** The original instruction — "restore the interpolation" — is **retired as
  unimplementable**: the function takes no endpoint any more, so there is nothing to interpolate, and
  a hand-written query interpolation would redden the query case while leaving the path case green.
  Two mutations replace it, each naming the test it must redden, both proved LANDED with
  `~/Code/dotfiles/tests/mutation-landed.py` and both restored by `diff` against the backup:
  1. **Append an assurance inside the notice** (" It is accessible only to your account.") — must
     redden *the notice promises nothing about who can read the file*, and would NOT have reddened the
     `includes()` form this replaced. The wording invariant.
  2. **Move the call back below `prepareTask`** — must redden *the notice survives a preamble larger
     than the pipe buffer*. The delivery invariant, and the mutation the amendment exists for.
- Commit gate in a **committed copy**, per the OAI-61 lesson that a suite passed only while the tree
  was dirty.

## Residue expected

- the `provider.mjs` `Location` interpolation, cross-linked to OAI-92
- whatever the review ladder leaves `open at approval` / `pending verification`
