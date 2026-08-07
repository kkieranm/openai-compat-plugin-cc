# ADR 019 — a notice that cannot print the secret

**Status:** accepted, 2026-08-06 (OAI-94)

## The problem

`/oai:task --background` persists the effective endpoint so the worker can reach the same server.
When a caller passes `--base-url 'https://host/v1?api_key=…'`, that credential goes to disk, and
saying nothing would be worse than saying something. So a notice existed — and it interpolated the
query string into its own warning about the query string, on **stderr**, which reaches terminals, CI
logs and the delegate agent's captured output. The notice about the secret printed the secret.

## Six wordings, each killed by an execution path

The design is not new. OAI-61's review ladder built it, reviewed it across four passes, then returned
it with a partial plan withdrawal (`~/Code/dotfiles/adr/033`); the code was never committed and the
record is the value that survived. Each candidate below was falsified by a path that runs, not by
argument:

1. **Interpolate the query string.** Prints the secret. The shipped defect.
2. **Print parameter NAMES only.** Defeated by a bare valueless token: `?SUPERSECRET123` parses AS a
   name, so the redaction prints exactly what it was redacting.
3. **"The key goes to the provider."** False whenever a `--file` is missing and the command dies
   before a byte is sent.
4. **"If this submission succeeds…"** False when `spawnWorker` throws after `insertJob`: the row is
   written, the process exits 2, and no job id is reported. The credential is on disk in the case the
   sentence excludes.
5. **"…readable only by you."** A guarantee the code cannot give. `job-store.mjs` hardens
   best-effort and swallows every failure (OAI-95), so the reassurance is independent of whether the
   hardening worked.
6. **Mechanism only, plus unfalsifiable advice.** True on every path, and uninformative — it bought
   safety by ceasing to tell the reader anything actionable.

## The decision

`noteEndpointPersistence()` in `scripts/lib/task-submit.mjs` emits the sentence below on every
background submission **that gets past the store-capability check**, before the provider is contacted
and before the store is opened — including ones that then die in the model probe, the context check
or a missing `--file` and persist nothing. The one exception is deliberate and is stated rather than
rounded off to "every": `requireDatabaseSync()` runs first, so a runtime without `node:sqlite`
(`adr/018`) gets no notice — and can create no job record either, so the sentence would have nothing
to describe.
That is a change from this ADR's first version and it is a delivery guarantee, not a preference; the
measurement is in *Where it fires*.

> Note: if this submission creates a job record, its full endpoint — including any query string —
> will be written to jobs.db; a later worker-start failure does not remove it.

Three properties, each answering one of the deaths above:

- **It takes no argument.** A function handed the URL is a function that will eventually interpolate
  it; removing the parameter removes the affordance rather than the discipline.
- **It gates on nothing.** Past `requireDatabaseSync()` it fires on every background submission,
  including ones that then die inside `prepareTask` and persist nothing — an imprecision bought
  deliberately, see *Where it fires*. What it never does is inspect the URL. A correct gate cannot be
  written: the code
  would have to know which part of a URL is a secret, and (2) shows the query-parameter shape defeats
  the obvious heuristic. A credential in the **path** is a sharper case still — `normalizeBaseUrl`
  keeps the path in `baseUrl`, so it is persisted with identical consequence and matches no test of
  `profile.query`. Under the old gate that case produced **no notice at all**. The cost is one line
  of stderr per `--background` run that reaches submission.
- **Its conditional is in what it says, not when it fires.** "If this submission creates a job
  record" survives a failure before `insertJob`, and the worker-start clause is true precisely
  because `spawnWorker` runs after it.

## Where it fires — a position that is a delivery guarantee, not a preference

The call sits **above `prepareTask`**, and the reason is measured. `oai-companion.mjs:37` ends a
failed submission with `process.exit(2)`, which **discards stderr that has not yet drained**;
`delegate.mjs:145` writes `Checking <provider name>…` from inside `prepareTask`, which under the old
position ran *before* the notice; and config validation puts **no ceiling on a provider name**. With the call below `prepareTask`, a 1 MB provider name pushed the
notice past the pipe buffer and it was **lost** — on a run that had already written a row holding the
credential. Measured against the real CLI, with a directory at the worker's log path forcing a
post-`insertJob` failure:

| provider name | before the move | after |
| --- | --- | --- |
| 4 chars | notice delivered | delivered |
| 100,000 | delivered | delivered |
| 1,000,000 | **131245 bytes of stderr, notice ABSENT, one row on disk holding the credential** | delivered |

That is the sentence's own scenario — row written, exit 2, no job id — failing silently, which is
worse than the leak this ADR set out to fix: a wrong warning at least tells you something.

**`fs.writeSync(2, …)` was tried first and does not work.** It keeps the position and changes only
the write, which is why it was preferred — but `process.stderr.write` queues the preamble in
userland and flushes it asynchronously, so a later synchronous write has no guaranteed position
relative to that queue. Measured: notice still absent. The move is the remedy that survives
measurement; the appealing one did not.

**The cost is accepted, not hidden.** The notice now also fires on a submission that dies inside
`prepareTask` — a missing `--file`, an unreachable server — which persists nothing. The sentence
stays **true** there, because its conditional is "if this submission creates a job record". What is
lost is precision. The earlier version of this ADR argued the opposite position was correct because
"such a submission has persisted nothing either"; that argument was sound and simply outweighed, once
the alternative turned out to be a notice that goes missing in the one case it was written for.

**The guarantee has one stated boundary, on the consumer's side.** A reader that attaches to the
child's stderr only *after* it has exited loses everything, notice included, whatever the ordering —
observed while building the measurement above, and initially mistaken for the defect itself. Shell
`$(…)` and `2>` are safe, as is any consumer reading from the start; a program that spawns the
command and subscribes late is not, and no write ordering inside this repo can fix that.

**Two approvers rejected the feature over this**, at the ladder's verdict point, after a review pass
had dismissed the same class on a measurement that tested stderr volume *after* the notice and never
before it. The dismissal was wrong in a specific and repeatable way: it varied the wrong axis.

## Scope, stated because the previous attempt lost on it

Three adjacent disclosures are **out** and filed rather than folded in: OAI-91 (every
provider-touching command transmits a query credential and only this one says so — the fix belongs
where the URL is resolved), OAI-92 (`assertOk` embeds 400 characters of a server's error body into
persisted state), and OAI-93/OAI-95 (config and job-state file modes). Codex ruled each of these a distinct
output path with its own redaction semantics, none of which this notice needs to be safe and true.
Widening a feature to every place a defect could also apply is how OAI-61 stopped converging.

**This feature's own reviews then found four more, filed rather than fixed — OAI-99, OAI-100,
OAI-101, OAI-102.** That is the honest summary of the boundary: one output path was made safe here,
and **six** now stand enumerated and unfixed (OAI-91, OAI-92, OAI-99, OAI-100, OAI-101, OAI-102).
Each was verified by reading the code, not inferred:

- **OAI-99** — `provider.mjs` interpolates the `Location` header verbatim on a 3xx, so a
  query-preserving redirect puts the credential on five surfaces. **The redirect witness travels with
  it.** OAI-94's entry asked for a test answering `301` with `location: <full request URI>`. That
  witness has no subject here — it would exercise `provider.mjs`, which this change deliberately does
  not touch — so it is **not** written and **not** silently dropped: OAI-99 names it as a required test.
- **OAI-100** — `provider.mjs:64`, `:69` and `:74` interpolate `profile.baseUrl` into connection-refused,
  DNS and generic transport errors, so a credential in the URL **path** reaches stderr on a failed
  request. Found by the compensating security lens. Its relationship to this fix **changed with the
  amendment and the earlier claim is withdrawn**: those errors fire inside `prepareTask`, which the
  notice now precedes, so a caller is warned first and then has the credential disclosed anyway. The
  disclosure is undiminished; what is gone is the sharper form of it, where the notice never printed
  at all.
- **OAI-101** — `/oai:status` renders `transport.baseUrl`, displaying a path credential on an ordinary
  status check.
- **OAI-102** — `config.mjs:141` builds its *refusal of a credential-bearing URL* from the raw URL, so
  the message about the credential prints it. Raised by `codex-adversarial` at high confidence with a
  "do not ship" verdict, and it was nearly fixed here on the argument that it refutes this ADR's
  "a correct gate cannot be written". It does not, and the distinction is worth recording: that claim
  is about **this notice's trigger**, which fires before any URL is inspected and would have to
  classify an arbitrary URL's parts. `config.mjs` classifies nothing — it needs only to stop echoing
  `raw` in a branch that has already established what it is looking at. Different claims; the ADR is
  not false by omission, and `config.mjs` is pre-existing code this diff does not touch.

The notice's own claim is unaffected by all four, because it describes what a *created job record*
persists and makes no claim about the rest of the command.

## The test lesson, which cost four passes

Every assertion previously written about this notice ran on a **refusal path** where the notice never
fired, so a deliberately injected leak reported green. `tests/credential-notice.test.js` therefore
proves the notice **fired** — by matching the whole sentence — in the same test as every claim about
what it omits, on a submission that really reaches `insertJob`. Five of the seven also return a job
id; **two deliberately do not**, and those are the point of the file — both drive a failure *after*
the row is written, one for the wording invariant and one for the delivery invariant. Five further
properties each answer something the first round of tests could not see:

- **The persisted row is asserted, not just the output.** **Four** of the seven check the credential
  really is in `transport` — under `query`, under `baseUrl`, from a configured provider, and in the
  orphaned row — and a fifth checks the orphaned row exists at all, so the notice cannot become false
  by the storage changing underneath it. Not-leaky and true are different claims, and only the second
  keeps the sentence honest.
- **One case uses the CONFIGURED provider, with no `--base-url`.** Without it, a regression gating the
  notice on that flag would leave every other test green while a configured query credential went
  unannounced.
- **Death (4) has an executable witness.** The five successful cases are all blind to it, so moving
  the call after `spawnWorker` would keep every one of them green while suppressing the notice in
  exactly the case the sentence is built around. (The delivery test below is the other post-`insertJob`
  failure and would redden too — it was written later, for a different invariant, and does not make
  this one redundant.) The test puts a **directory** where `spawnWorker`
  opens `logs/<seq>.log`, which fails *after* `insertJob`: nonzero exit, no job id, and an orphaned
  row still holding the credential — with the notice already printed. A source-order assertion was
  written first and then deleted; it could be satisfied by a decoy occurrence in a comment or a
  duplicated call, so it guarded the text rather than the behaviour.

- **The expected sentence is written out again rather than imported.** Importing it was tried, and it
  makes the assertion tautological: the expectation would move with the code, so adding "accessible
  only to your account" would change both sides at once and pass. Where the wording *is* the security
  property, the duplication is the guard.
- **That guard is a WHOLE-LINE comparison, not a substring one**, and the difference was found by
  review rather than reasoned about: `stderr.includes(NOTICE)` stays true when an assurance is
  appended *inside* the notice, so the literal copy alone did not close the class it was introduced
  for. Its **remaining limit is stated rather than papered over**: a reassurance printed as a separate
  stderr line is not caught, and closing that would need a whitelist of every line the command may
  emit, which the estimate note and the substitution warning keep moving.
