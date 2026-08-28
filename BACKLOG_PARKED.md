## 2026-08-28 — OAI-221 parked, `not worth doing` as its own item after its witness shipped

Its one actionable code consequence — a record could not say which side of the `enable_thinking`
switch a run ran on — shipped as `scripts/lib/reasoning-witness.mjs`'s observed reasoning witness in
`c0711d9`. What remains of OAI-221 is a true finding plus research residue (the multi-model agreement
signal, the MoE's precision) that is owned by OAI-9/OAI-11 and preserved in full at `evidence/221.md`,
so no further work belongs to OAI-221 as its own live item. The framing was never refuted — it is
correct and load-bearing — which is why this is `not worth doing`, not `refuted`.

**Reopening bar:** reopens if the observed witness proves insufficient — a provider whose
`reasoning_tokens` is unreliable enough that `no-reasoning-observed`/`unknown` mislead — or if active
pre-run verification of the thinking state (rather than post-hoc observation) is shown to be needed.

### OAI-221 — the thinking switch decides whether a local model can review at all

- **OAI-221** — **Whether a local model can review at all is decided by a setting this repo cannot
  reach, and every benchmark figure it has published was taken on the wrong side of it.** A reasoning
  model's thinking channel is controlled by the chat template's `enable_thinking` variable. It is not
  an OpenAI request field: `scripts/lib/client.mjs` cannot send it, `chat_template_kwargs` is not
  honoured by LM Studio (measured — a request carrying it returned identical reasoning-token counts
  to one without), and the only route is the server's own per-model configuration, in LM Studio's UI
  or `~/.lmstudio/hub/models/**/model.yaml`. **Dated instance 2026-08-26**: four models were scored
  on the `bench/` corpus with thinking ON and again with it OFF, everything else identical, each
  verified at `reasoning_tokens=0` immediately before its run.
  | model | thinking ON | thinking OFF |
  |---|---|---|
  | `qwen/qwen3.8-27b` | 0/6 cases, every one timed out | 4/6 cases, 1 anchored, clean control |
  | `qwen/qwen3.6-35b-a3b` | 2/6 cases, 1 anchored, 1,595s | 5/6 cases, 1 anchored, **319s** |
  | `google/gemma-4-26b-a4b` | 4/6 cases, 1 anchored | 4/6 cases, 1 anchored, 0 unmatched |
  | `gemma-4-12b-it-mlx` | *already off — no hub config to override the template default* | 5/6, 1 anchored |
  Generation time collapsed from hundreds of seconds to 1-34s per case; prefill then dominates, which
  is a hardware property rather than a model one. **The dominance of this one variable is what makes
  it worth an item rather than a note**: every other lever measured across ~110 review invocations —
  `reasoning_effort` (`low`/`medium`/`xhigh`), temperature, `top_p`/`top_k`/`min_p`, quantization from
  2-bit to 6-bit, reply budgets, `--structured-output`, `--parallel` 1/4/8, and prompt phrasing —
  moved availability or latency at best, and none moved capability. **Two consequences beyond the
  ranking.** First, the pre-2026-08-26 benchmark figures in this repo compare models that mostly had
  thinking on against `gemma-4-12b-it-mlx`, which had it off by accident of having no hub config —
  so the variable was confounded with model identity and nobody knew. Second, the corpus is not the
  one-case corpus it appeared to be: with thinking off, `qwen/qwen3.6-35b-a3b` anchored a defect in
  `scaffold`, a case no model had matched in any prior run, while losing `config-origin` — so the two
  best models now find **different** defects and neither finds the other's, which is the first direct
  evidence for the multi-model agreement signal OAI-9 and OAI-11 propose. Related: OAI-214 is the
  general inability to express vendor-required parameters; this item is the specific parameter that
  turned out to decide the outcome, and OAI-217 is why a record cannot show which side of it a run
  was on. The observed-witness consequence shipped in `c0711d9` (OAI-225 tracks the one remaining code
  gap: the failure envelope's witness is inert until a throw site attaches the reply's usage).
  **Evidence: [`evidence/221.md`](evidence/221.md)** — the measurement tables, the
  replication that revised them, and the corrections, recorded rather than summarised.

## 2026-08-27 — parked by the backlog sweep's worth bar

3 items plus 3 sub-items of a fourth, all `not worth doing`. All were verified STILL TRUE against
disk by three parallel scouts this same sweep (OAI-9/11/13/45/49/50/52/56/57/151/159/207/208/
210/211/212/213 — 17 pre-2026-08-25 live items in total; OAI-13 and OAI-159 were checked inline
rather than by scout). Every disposition below was also searched against `evidence/`,
`BACKLOG_DONE.md`, `bench/*.md` and `git log` for a dated instance the item's own body might not
carry, per this skill's "search both sources and both scopes" rule — none surfaced. Two items
(OAI-208, and OAI-52 sub-item (6)) verified STILL TRUE but stayed live: OAI-208's defect manifests
on every `npm test` run, which is itself the dated instance, and OAI-52(6) clears the worth bar via
the silence exception, argued in the item's own text. Everything below has no dated instance of
actual harm — only of discovery by a reviewer reading code, or (for OAI-52's three sub-items) by
the original OAI-3 plan review — and no silent-failure argument.

### OAI-52 sub-items (2), (4), (5) — parked, `not worth doing`

**Why parked:** All three are properties the OAI-3 plan said would be proved, found untested by a
reviewer re-reading that plan against the shipped tests — not defects anyone has observed firing.
(2) is an atomicity property that "holds by construction today"; nothing has ever exercised the
edit that would break it. (4) is an assumption about SQLite's own crash behavior, not about this
code, and no real kill-mid-transaction has ever been run against `jobs.db` (searched `tests/`,
`evidence/`, `BACKLOG_DONE.md` for any such test or incident — the nearest hits are a sweep-ledger
SIGKILL test and a job-log world-readability finding, both different mechanisms). (5) is a
test-methodology preference (row count vs mtime) with no instance of the count-based check ever
producing a false confidence. Sub-item (6), by contrast, stays live in `BACKLOG.md` — it argues the
silence exception directly (a session-id leak is exactly the class of defect an unfalsifiable check
would hide), which these three do not.

**Reopening bar (an instance, with a date):** (2) — a later edit is found to have split the
`state='running'`/`worker_pid` write into two statements, observed via a row where one is set
without the other. (4) — a real process kill mid-transaction against `jobs.db` is ever run (in a
test or in production) and produces a partial-state row. (5) — the row-count-based check for
"submitted exactly once" is shown to pass on disk while ordinary human debugging shows a job
that resent visible side effects.

*Filing kept verbatim (original OAI-52 sub-items, before this sweep split the item):*

- **(2) `state='running'` and `worker_pid` are never observable apart.** The plan called for this as
  an *atomicity* assertion, having previously called for a test of the window between them — which
  the one-transaction design makes unreachable, and a test that cannot fail was itself a gate finding.
  The property holds by construction today; nothing notices if a later edit splits the `UPDATE`.
- **(4) A real process killed mid-transaction leaves either the pre-transaction or the committed
  state, never a partial one.** This is a claim about SQLite rather than about this code, which is why
  it is fourth; but the design rests on it, and the repo's own habit is that a load-bearing claim gets
  executed rather than cited.
- **(5) The submitter writes the row exactly once on the success path** — counted through a fresh
  connection to the real store, **not** by mtime, an mtime being the last write rather than a count.

### OAI-56 — parked, `not worth doing`

**Why parked:** The prefill-overlap mechanism is real and measured (LM Studio's own disconnect
message, ~335s dense / ~67s MoE prefill), but no dated instance exists of it actually causing harm
— no observed double-model-residency crash or OOM traced to a cancel/dead-job overlap. This
session's own swap/OOM incidents (2026-08-26/27) were traced to a *different* mechanism entirely — a
stale resident model left loaded for hours, not a cancelled job's prefill overlapping a new load —
so they do not supply the instance this item needs, and searching `evidence/`, `BACKLOG_DONE.md`
found no other candidate.

**Reopening bar (an instance, with a date):** An actual double-model-residency crash, OOM, or
LM Studio guardrail refusal traced specifically to a cancelled-or-dead job's prefill overlapping a
different model's JIT load — not a stale-resident-model incident, which is the mechanism OAI-133
already governs.

*Filing kept verbatim:*

- **OAI-56** — The prefill-overlap bound: a cancelled or dead job can hold the server for the
  remainder of its prefill after the queue has moved on. **Measured, not assumed** — LM Studio says so
  itself on disconnect ("If the model is busy processing the prompt, it will finish first"), and
  prefill is the expensive half here at ~335s dense / ~67s MoE. Same model next: only a slowdown.
  Different model next: its JIT load overlaps that prefill, which is the two-models-resident case the
  memory ceiling forbids. **Deliberately not mitigated in OAI-3**, because the obvious mitigation —
  polling `lms ps` for idleness before dispatch — is a vendor-specific check in a plugin that is
  generic by construction ([ADR 001](adr/001-generic-openai-compatible-plugin.md)), and would put an
  `if LM Studio` where the whole repo has providers-as-data. Any fix must be shaped as configuration
  or as a generic post-cancel settle delay, not as a vendor probe.

### OAI-57 — parked, `not worth doing`

**Why parked:** The item's own text already names its trigger — "do it when something actually
consumes it" — and its one stated reason to want it sooner, OAI-80(a)'s forgeable `attachments`
line, was itself parked 2026-08-18 as `not worth doing`. No consumer has appeared since (the likely
first one, the `oai-delegate` agent, ships without needing it). Parking this makes the existing
deferral condition the tracker's own bar rather than a judgement call restated every sweep.

**Reopening bar (an instance, with a date):** A real consumer of `/oai:status`/`/oai:result` JSON
output appears — the `oai-delegate` agent or otherwise — and is blocked or degraded by its absence.

*Filing kept verbatim:*

- **OAI-57** — No `--json` on `/oai:status` or `/oai:result`. **The `/oai:task` half shipped
  2026-08-05** (`TASK_SPEC.booleanFlags` now includes `json`, mirroring `/oai:review`'s envelope) —
  full evidence moved to `BACKLOG_DONE.md`'s "OAI-57 (the `/oai:task` half)" entry, 2026-08-24, to keep
  this item's still-open ask readable. What remains live is `/oai:status` and `/oai:result`. OAI-80(a)'s forgeable `attachments` line is
  still the reason to want the status half — *OAI-80 was parked 2026-08-18, `not worth doing`, so this
  is a reason and no longer a dependency.* Left out of OAI-3 phase 4 as unrequested surface, and
  recorded here so the omission is a decision rather than an oversight. Still small (the rows are
  already JSON-shaped records) but a **contract** the moment it exists — the enumerated-field problem
  OAI-36 describes for the bench reliability prose applies to it exactly. Do it when something
  actually consumes it (the `oai-delegate` agent in OAI-5 is the likely first consumer), and version
  the envelope when you do.

### OAI-207 — parked, `not worth doing`

**Why parked:** Both sub-claims are structural drift risks found by a reviewer auditing OAI-204's
diff, not instances of anyone actually being misled. (1) means a reader cannot distinguish
trim-vs-fallback rescue rates from `bench/review-sweep.mjs` output without reading raw JSON — no
comparison has actually needed that distinction yet. (2) means three reason-lists could silently
diverge — checked `evidence/`, `BACKLOG_DONE.md` for any run whose classification was actually wrong
because of this; found only OAI-204's own shipping notes, which document the field's design, not a
misclassification it caused.

**Reopening bar (an instance, with a date):** (1) — someone actually needs a trim-vs-fallback
rescue-rate comparison from sweep output and has to read raw JSON to get it, with a date. (2) — a
sweep report's `starved`/not-starved classification for a real run is shown to disagree with what
`SALVAGE_REASONS`/`SALVAGE_SMALL_RESERVE_REASONS` would have classified it as, because the three
Sets have actually drifted apart in membership.

*Filing kept verbatim:*

- **OAI-207** — `bench/lib/sweep-outcome.mjs` has two pre-existing gaps, neither introduced by OAI-204
  but both found while auditing its diff: (1) `reported()` reads `report?.salvaged` explicitly but
  never reads the new `salvageTrim` field, so a sweep's outcome classification is blind to whether a
  rescued run was trimmed, fell back untrimmed, or wasn't eligible — out of scope for OAI-204 itself
  (that field's design is explicitly JSON-only, no sweep-integration was ever asked for), but a real
  gap for anyone wanting to compare trim-vs-fallback rescue rates from `bench/review-sweep.mjs` output
  without reading raw JSON records by hand. (2) `STARVED_REASONS` (a `Set` including
  `'token-reserve-cutoff'`/`'reasoning-only'` plus `'token-exhaustion'`) is a third, independently
  maintained copy of a reason list that overlaps but does not match either
  `SALVAGE_SMALL_RESERVE_REASONS` or `SALVAGE_REASONS` in `scripts/lib/review-request.mjs` — the exact
  drift risk OAI-204 consolidated those two into one shared `Set` specifically to prevent, one file
  over. Found by acceptance-audit's whole-artifact scout during the OAI-204 review-ladder, 2026-08-24.

## 2026-08-24 — parked by the backlog sweep's worth bar

4 items, all `not worth doing`. Each was verified STILL TRUE against disk by a scout this same sweep — the code they describe is real and unchanged — but each is a structural-hardening gap found by a reviewer reading code, not a dated instance of the defect actually manifesting, and three of the four already state their own reopening condition in the filing text. Applying the worth bar uniformly against the other 15 live items surfaced these four as the ones with no dated instance of actual harm, only of discovery.

### OAI-192 — parked, `not worth doing`

**Why parked:** The item's own text already concludes production spawns `process.execPath` directly, so a genuine spawn-error message here can only name the Node binary or a local path — never a remote endpoint, request, response, or credential. No secret-bearing spawn-error message has ever been observed; this is unexercised hardening against a class of input this call site cannot currently receive.

**Reopening bar (an instance, with a date):** An actual secret-bearing spawn-error message observed reaching `errorReport()` unredacted, with a date — the exact condition the item's own text already names.

*Filing kept verbatim:*

- **OAI-192** — **`job-launch-outcome.mjs:79`'s `terminalizeSpawnFailure` interpolates a raw spawn
  error's `.message` directly into the object it hands to `errorReport()`, bypassing that function's
  explicit-field-list redaction entirely** since the content is already baked into `.message` before
  `errorReport` ever sees it. Found and deferred during OAI-185's review ladder (pass 1, Codex steer:
  DEFER). Confirmed real but low-severity: production spawns `process.execPath` directly (the
  companion script is an argument, not the executable), so a genuine spawn rejection here names the
  Node binary or a local state/log path, never a remote endpoint, request target, response body, or
  authorization value — the class of naturally secret-bearing input OAI-185 protects against. Reopen
  if an actual secret-bearing spawn-error message is ever observed; until then this is structural
  hardening, not a demonstrated leak.

### OAI-194 — parked, `not worth doing`

**Why parked:** The item's own text already concludes the unredacted path is not currently exploitable: model selection runs inside `resolveTarget` at submission time, before the job row exists, so a refusal here fails the foreground call outright and never reaches `errorReport()`/`jobs.db` or a worker's log — the persistence path OAI-185 protects.

**Reopening bar (an instance, with a date):** Model selection moved to run inside the worker, so the unredacted message can reach `errorReport()`/`jobs.db` or a worker's log — the date of that code change, not a judged risk assessment.

*Filing kept verbatim:*

- **OAI-194** — **A server-reported model id can reach a `UserError` message unredacted, via
  `model-selection.mjs`'s `unservedProblem`/`autoSelect` (`listModelIds` over the server's own
  `/v1/models` response) → `delegate.mjs:111`'s `selectModel`.** Found by Codex during OAI-185's pass-5
  adversarial review, real but assessed as not currently exploitable through the background
  persistence path OAI-185 protects: model selection runs inside `prepareTask`'s `resolveTarget`,
  which completes at submission time — before `task-submit.mjs` ever creates the job row — so a
  refusal here fails the foreground submission outright rather than reaching `errorReport()`/`jobs.db`
  or a worker's job log. Reopen if model selection is ever moved to run inside the worker, or if a
  foreground-only exposure (this message on an operator's own terminal) is judged to need the same
  structured-field treatment OAI-185 gave the transport layer.

### OAI-201 — parked, `not worth doing`

**Why parked:** A real gap in `canon()`'s control-character range, confirmed against disk. But no in-tree filename actually containing a DEL or C1 control character has ever been observed reaching this check — the finding is a review-time code-reading gap, not an instance of the containment rule actually being bypassed.

**Reopening bar (an instance, with a date):** A real in-tree filename carrying a DEL or C1 control character observed being resolved and accepted by `canon()` despite the attachment rule's stated "refuse a control character," with a date.

*Filing kept verbatim:*

- **OAI-201** — `agents/oai-delegate.md`'s pre-existing `canon()` (path containment for `files`,
  unrelated to model selection) checks only `/[\x00-\x1f]/` — C0 controls — not the fuller
  `[\x00-\x1f\x7f-\x9f]` range OAI-181's model-id validator uses in the same file. A real in-tree
  filename containing DEL or a C1 control character would be resolved and accepted despite the
  attachment rule's stated "refuse a control character." Found by `codex-adversarial` during OAI-181's
  review ladder (pass verdict point, round 5), 2026-08-23 — concrete and verifiable, but a
  `files`/containment concern predating OAI-181, not a per-call-model one, so left out of that item's
  diff rather than absorbing a second subsystem's fix into it.

### OAI-202 — parked, `not worth doing`

**Why parked:** A real inaccuracy in a test file's header comment and test names, confirmed against disk (`/bin/ksh` and `/bin/tcsh` are both installed and both untested despite the "every shell" claim). But no instance exists of the overstatement actually misleading anyone — no bug shipped because a reader trusted "every shell" and skipped checking ksh/tcsh behavior themselves.

**Reopening bar (an instance, with a date):** A dated instance of the false "every shell" claim actually misleading a reader or reviewer into skipping a real check — e.g., a shell-specific bug that reached main because ksh/tcsh coverage was assumed to already exist.

*Filing kept verbatim:*

- **OAI-202** — `tests/delegate-template.test.js`'s file-level header comment ("runs the block under
  EVERY shell on the machine") and several test names/comments repeating that claim overstate the
  fixed `SHELLS` allowlist, which excludes any other shell installed on the machine — confirmed
  present on this machine at `/bin/ksh` and `/bin/tcsh`, neither tested (the latter a C-shell
  derivative, not even POSIX-family, so "every shell" was never literally true regardless of which
  allowlist shipped). Found by `codex-plain` during OAI-181's review ladder (pass verdict point, round
  5), 2026-08-23 — real, but a pre-existing documentation claim about the test file's own methodology,
  predating OAI-181 and not something its diff introduced or needed to correct.

## 2026-08-19 — parked by the user-directed backlog review

41 items. Unlike the 2026-08-18 sweep below, this pass did not re-verify every claim against disk — the user reviewed each item's existing text directly, tier by tier, and decided keep or park from that. All park here for `not worth doing` (no dated instance of the failure actually happening, as opposed to being reproduced under review or reasoned about), never `refuted`. OAI-191 is a new id, not a moved one: split out of OAI-160 the same session so the one live defect OAI-160 names is not hidden behind its own coverage-debt residue.

### OAI-27 — parked, `not worth doing`

**Why parked:** The concern this item raised (a TLS certificate error leaking a raw error code into a user-facing message) is already handled correctly and verified against disk, with a passing test (`tests/bench-reason-notes.test.js:171-172`) asserting the rendered text names the certificate, not the raw code. What remains is a disputed process question — whether the `security-review` skill should have triggered on the OAI-22 pass that first raised this — not a code defect.

**Reopening bar (an instance, with a date):** A concrete transport-classification concern this repo's security lens should have caught and did not, with the raw leak reproduced against current code and a date.

*Filing kept verbatim:*

- **OAI-27** — Put a security lens on the transport-classification path. **The instrument this item
  named is gone: `security-review` was retired 2026-08-13 (dotfiles `adr/100`), which folds its
  surface into `codex-adversarial`'s focus string — so this asks for that focus, not the deleted
  stage.** Filed 2026-08-01 from
  the OAI-22 ladder, where it was **evaluated and not triggered, and that call is disputed**. That
  skill's trigger list was auth/sessions, personal data, money movement, secrets and credentials, or
  anything irreversible — OAI-22 touches none of them, so it was skipped and the specific concern
  raised (`transportError` now branches on a `cause.code` that arrives from a remote peer, and a TLS
  rejection such as `CERT_HAS_EXPIRED` becomes `non-retryable-transport` with `cause.message`
  interpolated into a `UserError`) was closed by an explicit assertion instead: the code is preserved
  and the message still names the certificate.
  **Re-verified 2026-08-05 by the sweep, and it narrows what remains.** Both halves of the premise
  still hold on disk (`http-errors.mjs:135`, `:124`), and the closing assertion is real and passing —
  `tests/bench-reason-notes.test.js:171-172` asserts the rendered text matches `/certificate has
  expired/` and does **not** match `/CERT_HAS_EXPIRED/`. `describeFailure` (`provider.mjs:70`) returns
  the wrapped error untouched for this code, so `reword` never runs and the message passes through
  intact. So what is open is **not** whether the concern was handled — it was — but whether the skill's
  trigger list should have fired at all. That is a process disagreement, and reading code cannot settle
  it; only running the pass can. The `advisor` argued that is a security lens being
  recorded as "not triggered" when it does trigger. Cheap to settle, so settle it rather than leave
  the disagreement in a commit message: one fan-out over `http-errors.mjs`, `http.mjs`,
  `provider.mjs`. If it finds nothing, the trigger list stands as written and this closes as a
  recorded judgement rather than an open question.

### OAI-42 — parked, `not worth doing`

**Why parked:** The rename (`serverResponded` → something that does not imply the model server itself replied) turned out to be a bigger change than filed: the field is minted at roughly a dozen call sites and read to drive real logic in at least two, and every historical benchmark result file uses the old key. The item's own text already says the documentation now carries the distinction correctly, so this buys clarity rather than fixing a defect.

**Reopening bar (an instance, with a date):** A reader observed reaching a wrong conclusion from the field's name despite the existing documentation (ADR 012, ADR 013, CLAUDE.md, the test files), quoted, with a date.

*Filing kept verbatim:*

- **OAI-42** — Consider renaming `serverResponded` to say what it means. **Lowest priority, and it
  may well close as "no".** Filed 2026-08-04 because three independent reviewers across two OAI-35
  passes raised it unprompted: the name invites *the server responded to me* — a claim about a peer —
  where the field means only *an HTTP response was obtained*, and a proxy or gateway can produce one
  with the model server never seeing the request.
  The evidence for: this repo has now spent a great deal of prose defending that distinction — in ADR
  012, ADR 013, `CLAUDE.md`, `REPO_TRAPS.md`, two test files and the ledger's own minting comment —
  and a reader who trusts the name reaches the wrong conclusion without ever hitting one of them. The
  original backlog item for OAI-35 made exactly that error in its own text.
  The evidence against, which is why this is filed rather than done: the name **predates** OAI-35 —
  ~~`http.mjs` and `cmd-setup.mjs` were reading it~~ ~~corrected 2026-08-05 by the sweep: `http.mjs:107`
  and `http-errors.mjs:142` *mint* the field and `cmd-setup.mjs:32` is the only site that *reads* it~~
  **— that correction was itself WRONG and is corrected again 2026-08-14, verified against disk. The
  field is minted at roughly a dozen sites (`http-errors.mjs`, `provider.mjs`, `sse.mjs`, `body.mjs`,
  `chat.mjs`, `answer-attempts.mjs`, `attempt-outcome.mjs`, `attempt-ledger.mjs`) and it is READ to
  drive a decision in at least two: `attempt-outcome.mjs` `obtainedResponse` opens with
  `if (error?.serverResponded === true) return true;`, and `provider.mjs` propagates it. So
  `cmd-setup.mjs` is not the only reader, and the rename is LARGER than this item has ever said —
  which cuts against doing it, not for it.** The name predates the ledger,
  so a rename
  touches the transport, not just the record; and the documentation now carries the load correctly,
  so this buys clarity rather than fixing a defect. If it is done, `httpResponseObtained` was the
  suggested name and every recorded benchmark file under `bench/results/` carries the old key, so it
  needs the same read-both-shapes treatment the `not recorded` bucket already gives legacy records.

### OAI-70 — parked, `not worth doing`

**Why parked:** Part (a) was executed and confirmed — a row missing `auth.profile` did send a credential the job never named — but only via a forged or foreign row, not one this build's own writers produce. Parts (b) and (c) are incremental hardening on the same path with no observed failure of their own.

**Reopening bar (an instance, with a date):** An organically produced row (not injected or forged for a test) missing `auth.profile` that reached `resolveCredential` and sent an unintended credential, with a date.

*Filing kept verbatim:*

- **OAI-70** — **Three small correctness guards on the worker's row-decoding path.**
  **(a)** `resolveCredential` never checks `auth.profile` exists: `job-auth.mjs:54` passes
  `{provider: auth.profile}` and `config.mjs:245` *(line moved; verified again 2026-08-17)* treats a
  falsy provider as "use `defaultProvider`".
  Executed — a row whose `auth` lacks `profile` **completed and sent a credential the job never named**.
  Reachable only from a forged or foreign row, but one line (`if (!auth?.profile) throw`) closes it.
  **(b)** It pairs with a real structural gap: `cmd-task-worker.mjs` consumes a decoded row and never
  calls `isKnownVersion`, where `job-queue.mjs:57` and `job-reconcile.mjs:72` both do. *(Corrected
  2026-08-13 by the sweep, and it makes this WIDER, not narrower: "the only consumer" is **false** —
  `cmd-status.mjs` and `cmd-result.mjs` skip the check too, so three consumers do.)* — and the forward-compat story explicitly contemplates a newer writer's rows in the table.
  **(c)** A `transport` payload of JSON `null` crashes at `cmd-task-worker.mjs:40` before the auth
  check, giving exit 2 with a TypeError envelope rather than the UserError exit 1. No credential
  escaped (the positive control proves the probe would have seen one). Diagnosability only —
  deliberately not inflated.

### OAI-74 — parked, `not worth doing`

**Why parked:** The item's own text says this is "not a known exploit and not attacker-triggerable today" — a foot-gun that would become a disclosure path only if a repository file's content were treated as an instruction, which nothing in this repo currently does outside the already-enforced delegate path.

**Reopening bar (an instance, with a date):** An attachment reaching the configured endpoint from outside the intended boundary through a caller other than the delegate recipe, demonstrated end to end, with a date.

*Filing kept verbatim:*

- **OAI-74** — Enforce the attachment boundary for **every** caller, not just the delegate's recipe.
  **Narrowed 2026-08-05 by OAI-5's second review pass: the delegate path is now enforced.** Its recipe
  canonicalises per attachment — ~~`readlink -f`~~ **a `canon()` wrapping `realpathSync`, corrected
  2026-08-14 against disk; the recipe already made the (a) fix this item argues for below** — and
  refuses the submission when a resolved path leaves the git top
  level — falling back to the working directory outside a repository, so it is only as tight as where
  the session was rooted —
  proved with controls in `bash` and `zsh` (an in-tree symlink to `/etc/hosts` and a bare `/etc/hosts`
  both refused, in-tree files accepted). So the symlink variant that would have survived a
  `resolve()`-based fix is closed **for this agent**. What remains, and why the item stays open:
  the check lives in agent-authored shell, so it protects the delegate and not `prompt.mjs`'s other
  callers; and an agent holding unscoped `Bash` can still reach the network without the companion at
  all. Original framing follows.
  Filed 2026-08-05 from the OAI-5 plan gate, where Codex raised it and it was deliberately **not**
  grown into that item. `readFileBlocks` (`prompt.mjs:12`) accepts absolute paths and `..`, and
  `readFileSync` follows symlinks, so a component that selects its own attachments can send a file
  from outside the working tree to the configured endpoint. `agents/oai-delegate.md` states the rule
  — repository contents are untrusted data, and every attachment's *resolved* path stays inside the
  tree unless the user named the file — but prose is not a boundary, and the agent is the first
  consumer in this repo that chooses files without a human reading the list first.
  **Not a known exploit and not attacker-triggerable today**: it is a foot-gun that becomes a
  disclosure path the moment a repository file's content is treated as an instruction. The decision
  needed first is *where* the check belongs — `prompt.mjs` refusing an out-of-tree `--file` would
  also constrain the foreground commands, where the user typed the path themselves and the refusal
  would be wrong. So this is probably an opt-in flag the agent passes, which is a surface decision
  rather than a one-line guard.
  **Rescoped 2026-08-05 by OAI-5's security review, which showed the obvious implementation would not
  work.** Three corrections, the first of which is the reason this item is not what it looked like:
  **(a) It must dereference, not resolve.** The natural fix — `resolve()` plus a prefix test — accepts
  an **in-tree symlink pointing outside the tree**, and that variant is worse than the ones it does
  catch, because it is the only one that leaves *no trace*: verified by execution, a link at
  `./innocuous-note.txt` was read and `prompt.mjs:23` labelled it `innocuous-note.txt`, so the model
  header, `digestsOf` and the rendered attachment list **all** name the harmless in-tree path. Absolute
  and `..` attachments at least appear in those records. So the check needs `realpathSync`, and needs a
  decision about dangling links, where `realpathSync` throws `ENOENT` and today's code maps that to
  "File not found".
  **(b) Containment is necessary and not sufficient.** `.git/config` and `.git/logs/HEAD` (a token in
  an HTTPS remote), an in-tree `.env`, `.claude/settings*.json` are all *inside* the tree. A perfect
  boundary admits every one of them.
  **(c) `prompt.mjs` is not the last word.** The agent holds unscoped `Bash`, so `curl` bypasses the
  companion entirely; `commands/task.md:5` scopes its own grant to `Bash(node:*)` and the agent does
  not. Scoping the agent the same way is incompatible with its one-shell-invocation recipe, which
  needs `mktemp`, `awk`, `sleep` and `trap`. Now filed separately as **OAI-76** — *parked 2026-08-18, `not worth doing`, for naming no instance;
  it remains the second view of the boundary decision this item makes, so read it before designing one.* **Codex's adversarial
  stage rated the residual high (0.99) and said do not ship**; it shipped anyway, with the limits
  stated in [ADR 015](adr/015-a-context-broker-not-a-forwarder.md) — recorded here so the dissent is
  not lost.
  **(d) The check and the read are separated by a process boundary, so containment is TOCTOU.** Raised
  low by the security lens in pass 3 and high by `codex-adversarial` in pass 8. The delegate's shell
  canonicalises a *pathname* and compares it; `readFileBlocks` then resolves and opens that name again
  one process later, so an attacker able to swap a symlink or an ancestor directory *between* those
  moments defeats the check. It is open rather than urgent because it needs a **concurrent local
  attacker mutating the filesystem mid-run**, which is outside this feature's threat model of untrusted
  repository *content* — but it is the strongest argument for doing this item properly: the real fix is
  to validate and read through **one held descriptor** and submit the captured bytes, rather than
  re-opening a name that was checked earlier. That is only possible here, in `prompt.mjs`, and it
  cannot be done in agent-authored shell at all.
  **(e) Whatever lands here should also settle what the root IS.** The delegate anchors containment to
  `git rev-parse --show-toplevel`, falling back to the working directory outside a repository, so the
  boundary is only as tight as where the session was rooted — started at `$HOME`, it admits everything
  under `$HOME`. Stated in the agent text and ADR 015 rather than hidden, but a code-side boundary
  should decide this deliberately rather than inherit a shell fallback.

### OAI-75 — parked, `not worth doing`

**Why parked:** A single unidentified test-suite intermittent, seen once (2026-08-05) and never reproduced since. The item's own next step is capture, not reasoning — there is nothing actionable until it recurs.

**Reopening bar (an instance, with a date):** A second observed instance, with the failing output captured (not just noted), and a date.

*Filing kept verbatim:*

- **OAI-75** — **An unidentified suite intermittent, recorded because it was seen and not explained.**
  Observed once on 2026-08-05 during OAI-5, in the first `npm test` after a live delegation round trip:
  a `strictEqual` failure with `actual: 2, expected: 0`. It did **not** reproduce — three consecutive
  full runs green afterwards, on identical content — and **the failing test's name was not captured**,
  which is the gap that makes this an item rather than a fix. The count shape matches the
  `assert.equal(scenario.chats().length, 0, …)` family in `tests/job-auth.test.js:167` and
  `tests/queue-reconcile.test.js:31,67`, i.e. *two chat requests reached a recorder that should have
  seen none* — which would mean a worker ran where a blocker should have stopped it.
  **Two hypotheses were tested and neither is supported.**
  *(1) Store leakage from this machine's real job rows.* `tests/job-helpers.mjs:27-38,116-124` scopes
  `OAI_PLUGIN_STATE` to a temp dir per scenario and restores it in a `finally`. Not the explanation —
  though note this rules out the *helper*, not interleaving, which is why (2) was run.
  *(2) `process.env` interleaving with the new async test.* `OAI_PLUGIN_STATE` is process-global, and
  OAI-5 added the first `async` test to `tests/plugin.test.js`, which awaits a child four times — so a
  scenario overlapping it could read the wrong store. **Refuted by execution**: 8/8 green running
  exactly `node --test tests/plugin.test.js tests/job-auth.test.js tests/queue-reconcile.test.js`, the
  file combination that would have to interleave.
  **Attribution, stated at the strength the evidence supports:** 1 failure in ~9 full-suite runs with
  the OAI-5 diff, 0 in 5 full-suite runs with `tests/plugin.test.js` reverted, 0 in the 8 targeted
  runs. That is not enough to call it pre-existing and not enough to blame the diff; it is one
  unexplained event with two candidate causes eliminated.
  **Second observation, 2026-08-06, and it is a different shape — a HANG, not a failure.** Two
  independent `npm test` invocations were found still alive after **6h38m and 6h47m**, both wedged on
  the same file: `tests/review-json.test.js`. Both were runs this session started, saw exceed their
  tool timeout, and moved to the background without ever completing. Two separate runs stopping in the
  same place is not scheduling noise.
  **This retracts an explanation given earlier the same day.** A single failing test during the Stage 2
  work was dismissed as "flaky under parallel load" because it passed when re-run alone. That reading is
  unsupported: load does not explain a run that never terminates, and it was a guess offered as an
  answer.
  **The live capture was lost** — the two processes were killed at the user's request before a stack was
  taken, so the next step is to reproduce rather than to read. Concretely: run
  `node --test tests/review-json.test.js` alone in a loop and watch for one that does not return, then
  take a report with `kill -SIGUSR1 <pid>` **before** killing it. The fake server and its
  `runCompanion` children are the obvious suspects — `tests/helpers.mjs` resolves on `'close'`, which
  waits for every descriptor a child holds, and this repo has already shipped one hang from exactly that
  (see the footgun about a detached worker inheriting a descriptor).
  **Whether the two observations are one bug is unknown** and should not be assumed: one is a wrong
  count that vanished, the other is a run that never ends.
  **Still unidentified as of 2026-08-05, and deliberately NOT merged into OAI-62(c).** OAI-5's later
  passes produced a third `database is locked` sighting with a captured test name, which closed the
  naming gap **for that signature only**. This item's signature is different — a `strictEqual` of
  `2` against `0`, which is a chat-request count, not a locked database — and nothing since has
  reproduced it. Merging them on the strength of "both are flaky" would lose exactly the distinction
  that makes this one worth keeping open.
  This is a **different signature from OAI-62(c)** (a locked database), so it is filed separately
  rather than folded in. Both share the property that matters: a failure indistinguishable from a real
  regression. Next step is to capture the name — run the suite in a loop with the failing test's
  output retained, rather than reasoning about which assertion it must have been.

### OAI-77 — parked, `not worth doing`

**Why parked:** Requires local write access into the repository tree (an in-tree secret file, or a hardlink to an out-of-tree file) to matter at all; no instance of either has been observed.

**Reopening bar (an instance, with a date):** An observed disclosure of an in-tree secret file or a hardlink-based containment bypass through the delegate's attachment path, with a date.

*Filing kept verbatim:*

- **OAI-77** — **In-tree secrets are attachable, and containment cannot see it.** Filed 2026-08-05 at
  OAI-5's verdict point. The delegate's enforced check refuses paths that resolve *outside* the root;
  `.git/config` and `.git/logs/HEAD` (a token in an HTTPS remote URL), any in-tree `.env`, and
  `.claude/settings*.json` are all *inside* it. `agents/oai-delegate.md` names them as never-attach in
  prose, which is exactly the enforcement gap OAI-74 exists for, one direction over. A deny-list
  belongs wherever OAI-74's containment lands, since both are the same predicate on the same path.
  Note the asymmetry worth keeping: containment is a property of the path, while this is a property of
  the *content*, so a deny-list will always be a heuristic — which is an argument for keeping the
  attachment list small and visible, not against having one.
  **Widened 2026-08-05 by the ladder's pass-8 security lens: an in-tree HARDLINK to an out-of-tree
  file passes containment**, verified — `sub/hl.txt` disclosed a file outside the tree. A hardlink has
  nothing to resolve, so `realpathSync` cannot see through it the way it sees through a symlink, and
  **unlike the symlink case the audit trail is truthful**: that name genuinely is a name for that
  inode, so nothing is mislabelled and no check is forged. It belongs here rather than with the
  containment work because it needs local write access into the tree — the same premise as the rest of
  this item — and because no path-resolution fix can address it. If it is ever worth closing, the
  instrument is `st_nlink > 1` or a device/inode comparison against the root, not a path check.

### OAI-89 — parked, `not worth doing`

**Why parked:** This item is "an earlier review ladder never reached dual approval," not a code defect — it records a process gap in a ladder that has since been superseded by later ones.

**Reopening bar (an instance, with a date):** A decision that shipped without dual approval, from that specific ladder, later found wrong and costing something observable, with a date.

*Filing kept verbatim:*

- **OAI-89** — **The Stage 2 ladder never reached dual approval, and four of its entries are filed
  rather than fixed.** Filed 2026-08-06. Two passes ran (`80f6bea`, `4310475`), 39 ledger entries, and
  the ladder ended by **termination, not approval** — so nothing in it is `verified`; every entry is
  `pending verification`. The ledger is `plans/stage-2-ladder-ledger.md` and it is the handoff.
  **Pass 3 is owed for a specific reason, not as ceremony:** pass 2's batch **widened the frozen diff**
  to `cmd-task-worker.mjs` and `cmd-result.mjs`, which neither pass reviewed. Carried forward as
  filed-not-fixed: an empty file reporting one line where `wc -l` reports none; the slice note's
  position, which Codex argues belongs in the **system message** (the same move templates already
  make, and it would decouple the warning from the status excerpt entirely); `tests/file-slices.test.js`
  now pulling `node:sqlite` transitively, which is OAI-61's import chain; and `bench/task-run.mjs`'s
  `main()` having no test.
  **Start it in a FRESH session.** The clause in the repo's own methodology fired: pass 2's findings sat
  mostly inside pass 1's repairs, and two of them were defects the author had already reasoned about
  and shipped anyway.

### OAI-90 — parked, `not worth doing`

**Why parked:** Two deliverables were reported as shipped and were not built. The absence itself has not cost anything observed — no caller or user has been blocked or misled by their absence.

**Reopening bar (an instance, with a date):** An instance where the absence of these two deliverables blocked a caller or produced a wrong result, with a date.

*Filing kept verbatim:*

- **OAI-90** — **Two Stage 2 deliverables were never built, and were reported as shipped.** Filed
  2026-08-06 by the late review ladder, which is the only reason they are visible.
  **(a) Artifact PERSISTENCE.** The plan asks for "patches and findings stored as separate artifacts
  beside the raw output". Only the *check* was built: `saveArtifact` existed but was gated on a field
  nothing ever set, so it was unreachable, and it is now deleted rather than left looking shipped.
  Wiring a `--save-artifact <path>` flag was **deliberately rejected mid-ladder** — a caller-supplied
  write path for model-generated content is a new consideration that would fire `security-review`, and
  growing the reviewed surface inside a pass is its own defect. Decide the shape deliberately: a flag,
  a fixed location beside the job log, or not at all.
  **(b) Context manifests.** Never built, never deferred, never recorded until now. The plan pairs it
  with file slices ("context manifests and file *slices*"); slices shipped, manifests did not, and
  nothing anywhere said so. Decide whether a manifest is a distinct thing from the delegate's existing
  `files` list before building anything.

### OAI-95 — parked, `not worth doing`

**Why parked:** Permission hardening for the job state tree, withdrawn from an earlier item. The pre-existing bare `chmodSync` behavior is unchanged since the withdrawal — nothing regressed, the tree is exactly where it was before.

**Reopening bar (an instance, with a date):** An observed permission-related incident on the job state tree (unexpected access, a mode not repaired), with a date.

*Filing kept verbatim:*

- **OAI-95** — **permission hardening for the job state tree, withdrawn from OAI-61 with its findings.**
  `job-store.mjs` chmods `jobs.db` to `0600` best-effort and swallows every failure, so hardening that
  fails does so silently. OAI-61's ladder built a `state-permissions.mjs` (`restrict`, `narrowOrWarn`)
  to fix that and it was withdrawn with the rest of the unplanned scaffolding (`adr/033`); the tree is
  back to the pre-existing bare `chmodSync`, which is where it was rather than worse.
  **Design already established, and each point was proved by execution rather than argued:**
  `restrict()` must **verify the mode took** rather than trust `chmodSync` not to throw — disproved on
  a FAT image, where the call silently no-ops and leaves the file readable; the chmod must run **before**
  `PRAGMA journal_mode = WAL`, because SQLite creates `-wal`/`-shm` with the main file's mode as it
  stands at that moment and nothing chmods them afterwards, so a first-ever submission wrote the query
  string, the prompt and every attached file into a `jobs.db-wal` left at **0644**; and the failure must
  be **reported**, since the rest of the code's reassurances are written as though it succeeded.
  **Carry these open findings, none of which the withdrawn version closed:** `restrict()` returns true
  on a **symlink** (it follows one, making `openStore` a chmod primitive against any victim-owned path)
  and on a **dangling** symlink (ENOENT counted as success), and does not check the owner is the current
  user; on **macOS an ACL is invisible to `st_mode`**, so it can return true at 0600 while
  `group:everyone allow read` persists — the exact inverse of the FAT case, reachable with no attacker
  action via one inheritable ACE on any parent of `~/.local/state`, and this repo runs on darwin; the
  early chmod's return value is **discarded**, so a throw in `applySchema` (a too-new database, which is
  reachable and tested) skips the warning entirely; `jobs.db-journal` is in **no** narrowing list though
  SQLite writes it whenever WAL cannot engage, holding pre-images of committed pages; `openStoreForReading`
  narrows nothing, creating `-wal`/`-shm` at 0644; log files get the mode only on creation and `'a'`
  follows symlinks; and a state directory **owned by someone else** throws `ERR_SQLITE_ERROR`, which is
  not a `UserError`, so the single most likely permission failure a real user hits prints
  `Unexpected failure: <stack>` and exits 2 unclassified. Finally, the warning is **invisible on the
  worker path**: `cmd-task-worker.mjs` opens the store in a process whose stderr IS the job log, so it
  is written where the user has no reason to look, and it names neither the mode it wanted nor the mode
  it found — so a reader cannot tell 0644 from 0666. Any fix must also pin the hardening's own tests:
  in the withdrawn version, deleting the `-wal`/`-shm` entries from the narrowing list reddened
  **nothing**, and nothing asserted the directory mode at all.

### OAI-96 — parked, `not worth doing`

**Why parked:** Three pieces of residue in the shipped `node:sqlite` capability guard, none wrong for a working install today.

**Reopening bar (an instance, with a date):** A dated instance of the `node:sqlite` capability guard misbehaving on a real install.

*Filing kept verbatim:*

- **OAI-96** — **three pieces of residue in the shipped `node:sqlite` guard.** All found by OAI-61's
  final pass, all in code that landed in `2312c47`, none blocking.
  (a) **`throw null` is still reachable.** `job-store.mjs`'s comment claims the invariant holds "by
  construction rather than by a null check a later edit can drop", and the truthy check closed the
  *resolved-but-no-export* route — but a **falsy rejection value** still reaches `throw importFailure`
  and prints `Unexpected failure: null`, the exact string the comment says was eliminated. Proved by
  execution with a loader hook; no shipping Node produces it, which is why it is low. Fix is
  `importFailure = error ?? new Error(…)` **plus softening the comment to what is true** — an
  overstated invariant is the more durable half of this defect.
  (b) **Two assertion triples in `tests/runtime-capability.test.js` are non-separable** — the exit-code
  assertions move as one under any exit-code edit, and the refusal-message assertions under any message
  edit. **They must NOT be deleted.** The `assert.deepEqual(server.requests, [])` check passes
  *vacuously* if the command dies for any reason before the probe, and its neighbours are what establish
  the refusal path was the one taken: they are subsumed-as-CONTROL, not subsumed-as-redundant. This
  repo deleted four assertions on the redundancy reading during that same ladder, so the distinction is
  filed as a documentation fix before someone applies the rule again.
  (c) Six unused imports in `tests/runtime-capability.test.js`, left by the split. No lint catches them.

### OAI-97 — parked, `not worth doing`

**Why parked:** An intermittent test failure, observed once during OAI-61 and never reproduced.

**Reopening bar (an instance, with a date):** A second observed instance, captured, with a date.

*Filing kept verbatim:*

- **OAI-97** — **an intermittent test failure, observed once and never reproduced.** During OAI-61 a
  full-suite run failed an `assert.equal(status, 0, stderr)` in a job/background test, with stderr
  opening on the ordinary `Checking fake for available models…` preamble. It did **not** reproduce
  across ten subsequent full-suite runs. Recorded rather than closed because a flake that is not
  understood is a test that cannot be trusted to fail for the right reason, and this suite gates every
  commit. The one lead: it is a submission returning non-zero, not an assertion about content, so the
  place to look is worker spawn or queue timing rather than any single test's logic.
  **Second occurrence, 2026-08-06, while closing the session**: a full-suite run read **629/1**, and the
  failure detail did not survive into the summary — three immediate reruns were 630/0. So the rate is
  now two observations against roughly fourteen clean full-suite runs, and it remains unidentified.
  Anyone picking this up should capture `npm test` to a file rather than grepping a live pipe, since
  both observations lost the failing test's name that way.
  **Third occurrence, 2026-08-07, during OAI-94's pass-6 batch**: `actual: 2, expected: 0` mid-batch,
  then three consecutive captured green runs at 637/637. The failing test's name was lost to a live
  pipe for the THIRD time, by the same person who wrote the sentence above telling them not to — which
  is the actual finding here. The rate is now three observations against roughly thirty clean
  full-suite runs. Anyone picking this up should make the capture the default, not the advice:
  a note that has failed to be followed three times is not a note, it is a missing default.

### OAI-98 — parked, `not worth doing`

**Why parked:** Job state is trusted completely once written to disk, with no integrity check on read. No corruption or tampering incident has been observed.

**Reopening bar (an instance, with a date):** A dated instance of corrupted or tampered job state being read and acted on as if valid.

*Filing kept verbatim:*

- **OAI-98** — **job state is trusted completely once it is on disk.** Two findings from OAI-61's
  `security-review`, both needing write access to the state directory — a shared `XDG_STATE_HOME`, a
  pre-created `/tmp` path, not the default `~/.local/state`.
  (a) **A tampered row redirects the prompt.** `cmd-task-worker.mjs` `transportProfile` takes `baseUrl`
  and `query` **verbatim** from the row, so replacing `jobs.db` sends the whole prompt and every attached
  file to an attacker's endpoint, and the reply is printed by `/oai:result` — reaching the delegate
  agent's context. *Proved not redirectable: the configured credential.* `job-auth.mjs`'s third
  comparison anchors on the **current config's** origin, so a forged `authorizedOrigin` is refused —
  that check genuinely defeats a fully attacker-written row and is worth keeping. But the common local
  case has no key (`mode:'none'`), and then nothing is checked at all.
  (b) **No `PRAGMA secure_delete`**, so `job-retention.mjs`'s `DELETE` leaves `transport.query` — and
  the prompt — recoverable in freelist pages of a file whose permissions are the only protection.
  Deliberately separate from OAI-95: hardening the *modes* does not help once the bytes are readable by
  a process that legitimately opened the file.

### OAI-106 — parked, `not worth doing`

**Why parked:** A worker's public status can say `worker-died` for work that actually completed and was salvaged. This was the reason an earlier ladder stalled without approval, but that objection was overruled and the underlying feature shipped anyway; the mislabeling itself has not been observed to mislead an operator since.

**Reopening bar (an instance, with a date):** A dated instance of an operator acting on a false `worker-died` status for work that had actually completed and was salvaged.

*Filing kept verbatim:*

- **OAI-106** — **the row is still wrong about why a salvaged job ended, and the CHEAP HALF is separable
  from the expensive one.** Narrowed by OAI-62, which originally filed this as the whole defect — a
  paid-for answer lost outright — and then had both approvers reject that filing: losing the answer
  *was* contention killing live work, which is precisely OAI-62's own ask, so it was fixed in the
  ladder rather than deferred. `salvageOutcome` now writes the outcome to the job log under the fixed
  prefix `SALVAGED_OUTCOME` before the storage error propagates, so the answer survives
  (`cmd-task-worker.mjs:183`, line moved; verified again 2026-08-17).
  **RE-SCOPED 2026-08-12, when OAI-62 was closed over the objection this item carries.** It was framed
  as "a `persistence-pending` state **or** a recovery pass" — both structural, and that framing is what
  kept it expensive enough to defer indefinitely. The thing that actually made the approver refuse is
  narrower than either, and it is a **sentence**:
  **(a) THE CHEAP HALF — stop asserting something false.** `job-reconcile.mjs:79-83` publishes
  *"The worker for job X exited without recording an outcome."* That is **false** whenever a salvage
  line exists: the worker recorded its outcome and SQLite refused the write. `terminalizeDead` can
  check the log for the marker and say so — *the worker recorded its outcome to the log but could not
  persist it, see `<path>`* — in the failure message and hint. **This touches no lifecycle state**,
  adds nothing to `TERMINAL_STATES` (`job-record.mjs:17`, four values, no SQL `CHECK`), and removes the
  actual falsehood. Do this one.
  **(b) THE EXPENSIVE HALF — a state that can express it.** An explicit non-terminal
  `persistence-pending` that `/oai:result` and reconciliation both understand, or a recovery pass that
  reads the salvaged line back into the row. This is a state-machine change in the subsystem whose
  entire tier is about lifecycle misreporting, so a new state is itself a plausible source of the class
  it is meant to fix. **It may never be worth building**, and (a) does not depend on it.
  **A witness is missing for BOTH halves and is worth having regardless.**
  `tests/job-busy-placement.test.js` asserts the salvage line is written and that the row is still
  `running` immediately after — it **never drives reconciliation**, so nothing observes the row
  becoming `failed`/`worker-died`. The false terminal state has no test that can fail on it, which is
  this repo's most-repeated shape. Related: [OAI-105] *(parked 2026-08-18, `not worth doing`)*.

### OAI-107 — parked, `not worth doing`

**Why parked:** Cancellation has no defined contention policy. Fires only under contention that has never been observed outside an injected test.

**Reopening bar (an instance, with a date):** A dated instance of a cancellation request producing a wrong or ambiguous outcome under real contention.

*Filing kept verbatim:*

- **OAI-107** — **cancellation is the one lifecycle fact with no contention answer.** `runCancel`
  calls `reconcileAll` before `requestCancel` and neither is retried, so a `SQLITE_BUSY` anywhere in
  the sweep fails the command before the stop request is attempted at all — and what the user sees is
  a raw `database is locked`, not a `UserError` with a hint, so even "run it again" is advice the
  output does not give. The billable request they wanted stopped carries on. OAI-62 declined to build
  this: a failed cancel is visible and nonzero, it kills nothing, and that item's ask is that
  contention must not kill live work. But review called the enumeration lifecycle-biased with
  justification — terminal facts get retries and a stop request does not. The fix is a cancellation
  contention policy: reconciliation best-effort under busy, `requestCancel` retried on a short bounded
  budget, and exhaustion converted to a `UserError` that states the cancellation was not recorded.
  Needs a witness driving a busy through both halves.

### OAI-108 — parked, `not worth doing`

**Why parked:** An unrecorded job start reaches a human (stderr) but no machine (`--json` output). No consumer has been observed reading a `--json` reply and missing this.

**Reopening bar (an instance, with a date):** A dated instance of a `--json` consumer acting incorrectly because an unrecorded start was invisible to it.

*Filing kept verbatim:*

- **OAI-108** — **an unrecorded start reaches a human and no machine.** When the spawn stamp's retry
  exhausts, `submitTask` warns on stderr that the job was spawned and that this session cannot see
  what the worker did next — but `--json` still emits `{id, background: true}`, byte-identical to a
  submission whose start was recorded. A harness therefore cannot distinguish them, and the one
  channel it reads says everything is normal. A `spawnConfirmed` field was built during OAI-62's
  ladder and **reverted**: it changed a published `--json` contract that item's approved plan never
  covered, and `commands/task.md` documents that envelope literally. Whatever lands here must ship
  with the doc, an end-to-end `--background --json` test, and a name describing what is actually
  unknown — the spawn IS confirmed, `spawnWorker` returned a pid; it is the recorded start that is
  missing, and a caller reading "unconfirmed spawn" could resubmit a billable request.
  **Enlarged by OAI-67 on 2026-08-12, and this is now the item's worst case rather than its original
  one.** OAI-67 changed the same stamp so that ANY storage fault — not only an exhausted lock
  contention — reports on stderr and still returns the id, because rethrowing lost the handle to a
  worker that may already have been spending. The `--json` channel did not change, so a submission
  made against a CORRUPT database or a FULL DISK now emits the same success envelope as a healthy one,
  where before that caller received a rejection and knew the submission was unhealthy. The trade was
  made deliberately (a lost id is unrecoverable and costs money; a silent success is recoverable by
  polling `/oai:status`), Codex and the author both recommended keeping it, and the user chose it — but
  it means **this item now covers a path that previously did signal**, not merely one that was always
  quiet. The contract fix is still the same fix, and it is still gated on the same doc-plus-test work.

### OAI-110 — parked, `not worth doing`

**Why parked:** A "six sites" count is stated in a doc with nothing tying it to the code, so it can drift silently. No drift has been observed.

**Reopening bar (an instance, with a date):** A dated instance where the stated count and the actual code disagreed and a reader was misled by it.

*Filing kept verbatim:*

- **OAI-110** — **the six-sites count is stated in a third document that nothing holds to the code.**
  `tests/busy-site-count.test.js` derives both counts from `scripts/lib` and requires the sentence in
  `adr/020` and `job-busy.mjs` — but CLAUDE.md states the same figure in its own words, outside that
  `documents` array. Proved with a mutation and a positive control: a seventh `withBusyRetry` site was
  added, the guard failed naming only the two documents, those two were corrected, the guard went
  green — and CLAUDE.md still said "six". **Adding CLAUDE.md to the array does not fix it**: the
  required sentence is the literal "six `withBusyRetry` call sites", and CLAUDE.md's "six enumerated
  sites" collapses two different counts into one number, matching neither the required-sentence check
  nor the wrong-number check. So the fix is to reword the CLAUDE.md line to carry both counts with
  their nouns, *then* add it to `documents`. This is the same defect the guard was written three
  review passes deep to eliminate, reproduced one document over. Raised and CONFIRMED by `lean-wide`
  in OAI-62's terminal pass.
  **RE-MEASURED 2026-08-14 by the sweep, and both numbers moved — read this before working it.** The
  counts are now **seven `withBusyRetry` sites and five `isBusy` sites**, and CLAUDE.md says "seven
  enumerated sites", which is **currently accurate**. Two things changed underneath the item: the
  guard's `documents` array is now `['scripts/lib/job-busy.mjs']` **alone**, because `adr/020` was
  deleted with the ADR corpus (`d1ad2aa`) — the deletion commit calls that *"A REAL WEAKENING"* in its
  own words, since one witness means a file and its own doc comment can now move together. So the
  defect is no longer "CLAUDE.md disagrees" but "**one witness, and CLAUDE.md still outside it**", and
  the fix is unchanged in shape while being more valuable than when filed.
  **FOLDED IN 2026-08-17 by the sweep, same shape one level out**: four more comments cite the deleted
  `adr/020` as settled policy nothing now holds to the code — `task-submit.mjs:182`,
  `cmd-task-worker.mjs:173`, `job-launch-outcome.mjs:86,105`. This item's whole subject is "a claim
  nothing holds to the code," so these are in scope for the same fix rather than a separate filing.

### OAI-111 — parked, `not worth doing`

**Why parked:** Stale git worktrees accumulate under `.claude/worktrees/` — housekeeping generated by review fan-outs, not a defect with an observed cost.

**Reopening bar (an instance, with a date):** A dated instance of stale worktrees causing a real problem (disk pressure, a collision, a confusing `git worktree list`).

*Filing kept verbatim:*

- **OAI-111** — **Stale git worktrees accumulate under `.claude/worktrees/`.** *(Count corrected
  2026-08-13 by the backlog sweep: **3 directories, 29M**, not the ~28 first filed — the retired
  review fan-outs stopped creating them, so the rate has fallen and the residue has not been cleared.)* Left behind
  by review fan-outs whose agents ran under `isolation: worktree`; each is a full checkout of this
  repo, so the disk cost is real and grows with every wide review. Nothing reads them after the run
  that made them. Needs a sweep that is safe against a worktree still in use — `git worktree list`
  plus a liveness check, not a blind `rm -rf` — and, if the harness offers one, a cleanup hook rather
  than a manual command nobody remembers to run.

### OAI-112 — parked, `not worth doing`

**Why parked:** The candidate-selection design underlying `structured.mjs` has real structural gaps (multiplicity and extent are not represented), but the two repairs it was originally filed for already shipped and were verified on disk. The remaining redesign needs a fresh plan gate, and its evidence is reproduced-in-review rather than an observed live misselection.

**Reopening bar (an instance, with a date):** A dated instance of `extractJson`/`findingsShaped` silently selecting the wrong candidate on a real reply, with the reply and the wrong selection shown.

*Filing kept verbatim:*

- **OAI-112** — **The candidate-selection design is under a PARTIAL PLAN WITHDRAWAL. ADJUDICATED
  PARTIAL BY THE USER, 2026-08-07** — so the two repairs OAI-84 shipped STAY, and only the
  candidate-selection design is replaced. The replacement goes through a fresh step-3 plan gate and
  earns its own ladder; the one-per-feature replacement budget is not consumed until that ladder's
  ledger opens. Filed 2026-08-07 from OAI-84's review ladder, which ran six passes
  and ended WITHOUT dual approval (both approvers returned `CHANGES-REQUIRED`). What is withdrawn is
  only the candidate-selection design that grew across passes 2-5 — **the two repairs OAI-84 was filed
  for both stand and are audited**: the channel fallback under `--structured-output`, and the bare
  top-level array. The defect is structural, not a bug list: `findingsShaped` (content) and
  `extractJson` (position, last-outermost) each decide alone, neither knows what the other guarantees,
  and **two signals the design never represents** are visible to neither — candidate MULTIPLICITY, and
  whether a candidate has a valid extent. Carried evidence, all reproduced first-hand: several
  outermost candidates are resolved silently by position; the "prose-wrapped clean review is
  unreadable" trade rests on a false binary, since a lone scanned empty could be accepted while genuine
  competitors are refused; a wrapper-shaped array element is kept in place of the payload it wraps; and
  `extractJson` admits a candidate with `end: undefined`, which survives the containment filter (every
  comparison against `undefined` is false) and wins the ranking — not live today only because the
  single caller's predicate happens to reject it, which is a coincidence of the caller rather than a
  property of the code. **Scope it as CANDIDATE SELECTION, not "ambiguity"** — scoped to multiplicity
  alone, the extent defect survives the replacement. Replacement code is not eligible until a fresh
  step-3 plan gate closes; the one-per-feature replacement-ladder budget is UNSPENT.


  **ABSORBED OAI-84 on 2026-08-13 by the backlog sweep**, whose two repairs are SHIPPED and were
  verified on disk (`structured.mjs:202`, `:242`). Only the withdrawal was still live, and it cannot
  close without this item's replacement — the merge criterion, not tidying. **Its record, evidence and
  register row are in `BACKLOG_DONE.md`; they are not restated here.** Note **OAI-114** sits inside
  this item's replacement scope, since `objects()` rejects at candidate SELECTION.

### OAI-125 — parked, `not worth doing`

**Why parked:** The resolved-SHA guarantee reaches the benchmark artifact through one untested code path (mutation-proved: deleting one assignment leaves the suite green). No run has been observed producing a mismatched artifact because of it.

**Reopening bar (an instance, with a date):** A dated instance of two benchmark runs against "the same" ref reviewing different commits because the resolved SHA was not what the artifact claimed.

*Filing kept verbatim:*

- **OAI-125** — **The resolved-SHA guarantee reaches the artifact by ONE UNTESTED PATH.** Filed
  2026-08-08 from the follow-on ladder, `unresolved at cap`. **MUTATION-PROVED**: deleting just the
  `options.from =` assignment in `bench/review-sweep.mjs` leaves the suite at 766/0, after which the
  record and report print the caller's typed ref instead of the resolved commit. Two benchmark arms
  invoked identically with `--from main` days apart would then review different histories while the
  artifact claimed the same window — **the exact defect OAI-124 exists to prevent, reintroducible with
  nothing going red.** Root cause: `main()` is unexported and runs only under the
  `process.argv[1] === fileURLToPath(import.meta.url)` guard, so no test can invoke the composition.
  **This is the shape of `bench/run.mjs`** — the file this harness's own header says it was
  deliberately structured NOT to imitate, because an unguarded main is why `run.mjs` has no test at
  all. `task-run.mjs`'s injectable seams were copied for the loop and not for the composition.
  **The fix is a seam, not another test**: export the composition, or `runMain(deps)`.
  **Update 2026-08-09 — `bench/run.mjs` was worse than this item said, and is now partly fixed.**
  Its `main()` was not merely unexported: it was called **unconditionally at module scope**, so the
  first `tests/` import of that module ran a whole six-case benchmark and wrote a report and a record
  into `bench/results/`, indistinguishable from a real arm. Found by OAI-117's seam and fixed there —
  `run.mjs` now has the `process.argv[1]` guard `review-sweep.mjs:291` always had, plus one exported
  function under test. **This does NOT close OAI-125**, whose defect is `review-sweep.mjs`'s
  `options.from =` assignment reaching the artifact untested; it removes the excuse that `run.mjs` is
  the shape to copy.
  **Until it lands, every benchmark arm must pass a full SHA and the pre-flight assertion is
  load-bearing rather than belt-and-braces.**

### OAI-126 — parked, `not worth doing`

**Why parked:** A bare `catch` deletes the error it was meant to report. No instance of a lost diagnosis has been observed.

**Reopening bar (an instance, with a date):** A dated instance where this bare catch swallowed an error that was needed to diagnose a real failure.

*Filing kept verbatim:*

- **OAI-126** — **A bare catch deletes the cause it was meant to report.** Filed 2026-08-08,
  `unresolved at cap`. `resolvePin` in `bench/lib/sweep-window.mjs` wraps its only git call in
  `catch { throw new UserError('--from did not resolve to a commit') }`, discarding the caught error —
  so a git **spawn** failure is reported as the revision being bad. **Reproduced against the real
  artifact at its real path**: with a PATH containing only node, `--from HEAD` printed
  `--from did not resolve to a commit: "HEAD"`, and a positive control showed
  `git rev-parse 'HEAD^{commit}'` resolves fine in the same tree. The harness's printer shows only
  `error.message` for a `UserError`, so the `spawn git ENOENT` text that named the real cause is
  deleted. One-line fix: carry the cause as the `hint`.

### OAI-128 — parked, `not worth doing`

**Why parked:** A test asserts presence where the code already guarantees presence — a check that cannot fail. No instance of a real regression slipping past it has been observed.

**Reopening bar (an instance, with a date):** A dated instance of a real regression in the guaranteed-presence path that this test failed to catch.

*Filing kept verbatim:*

- **OAI-128** — **A test that asserts presence where the code guarantees presence.** Filed
  2026-08-08, `unresolved at cap`. **A NEW TRAP CLASS, distinct from the stub-fidelity entry added the
  same day.** The OAI-121 caveat tests assert `key in entry` for all five carried fields, but
  `reported()` sets every one with `?? null` — so reading the WRONG source field (`hunksOnlyTypo`)
  leaves the key present with `null` and the assertion still passes. The test verifies the SHAPE of
  the mapping, not that it read the right field. **Fifth instance of "a test that cannot fail" in one
  feature**, and the second distinct shape; belongs in `.claude/REPO_TRAPS.md` as its own entry, since
  the stub-fidelity entry would otherwise read as covering it.
  *(Half done, verified 2026-08-14: the `REPO_TRAPS.md` entry now exists — "A test that asserts
  presence where the code guarantees presence". **The test itself is unchanged**, so what is live here
  is the fix, not the filing.)*

### OAI-129 — parked, `not worth doing`

**Why parked:** A failure cause is still guessable rather than explicitly named at one boundary. No instance of a wrong guess has been observed.

**Reopening bar (an instance, with a date):** A dated instance of a misdiagnosed failure at this boundary traced back to the guessed-rather-than-named cause.

*Filing kept verbatim:*

- **OAI-129** — **The shortfall cause is still guessable at one boundary.** Filed 2026-08-08,
  `unresolved at cap`. `walked >= scanLimit` is *also* true when exactly `scanLimit` commits are
  reachable, so a repo with exactly 200 reachable commits and a 200 limit is told "the scan stopped at
  its `--scan-limit`" when raising it would find nothing. Reproduced with a stub git. **The fix was
  named by the reviewer**: request `scanLimit + 1` and record whether an extra existed — that
  separates the two causes instead of inferring one. The docstring's claim "WHICH cause, not a guess"
  is false in exactly this case.

### OAI-133 — parked, `not worth doing`

**Why parked:** A record, not an open question: the gemma benchmark arms measured nothing about the gemma models. Kept as sized-context notes for a future attempt, not live work.

**Reopening bar (an instance, with a date):** A decision to actually attempt a gemma arm, at which point the sized-context notes here become inputs again.

*Filing kept verbatim:*

- **OAI-133** — **The gemma arms measured NOTHING about the gemma models. CORRECTED 2026-08-09.**
  The first filing guessed the cause was "something else resident"; that was **wrong and is recorded
  here rather than quietly replaced.** Measured with `lms ps` reporting **no models loaded at all**,
  `gemma-4-12b-qat` still failed: `HTTP 400 … requires approximately 44.87 GB`. The real cause is
  **OAI-134** — the plugin JIT-loads at `max_context_length` (262144 for every model on this server).
  **Sized contexts, measured by actually loading each one** (36 GB machine):
  | model | weights | verdict |
  |---|---|---|
  | `gemma-4-12b-qat` | 7.15 GB | **loads at 61,696** — the same context the qwen arms used |
  | `gemma-4-26b-a4b-qat` | 15.64 GB | loads, but **LM Studio ignores `-c`** and pins 116,736 |
  | `gemma-4-31b-qat` | 18.85 GB | **refused at 61,696** (needs 34.45 GB of 36); loads at 32,768 |
  KV cost derived from the error and confirmed by loading: ~0.144 MB/token for the 12b.
  **`gemma-4-31b` cannot be benchmarked on this machine at a context comparable to the qwens** — that
  is a fact about the machine, and it is the finding. `gemma-4-26b-a4b` gets nearly double the qwens'
  context, so its earlier `unreadable` replies (8 of 10, then 4 of 10 — it emitted `findings` and
  `analysis` as prose rather than the requested shape) are **not** explicable as a context handicap.
  **The re-run was STOPPED BY THE USER after ~1 minute: SSD usage spiked.** Cause was almost certainly
  swap thrash, not writes — the whole first matrix wrote 364 KB. Loading and unloading 7-19 GB models
  back to back on a 36 GB machine pages heavily. **Do not re-run three models in one sitting**; one
  model per session, with `sysctl vm.swapusage` watched, and never size a context that leaves only
  ~1.5 GB of headroom.

### OAI-135 — parked, `not worth doing`

**Why parked:** Four defects in the benchmark harness's own caveat-reporting layer, none of which affect the shipped `/oai:review` command — only what the benchmark reports about itself. No instance of a misleading benchmark conclusion traced to one of these has been observed.

**Reopening bar (an instance, with a date):** A dated instance of a benchmark report making a false confidence claim traceable to one of these four caveat-layer defects.

*Filing kept verbatim:*

- **OAI-135** — **The benchmark's caveat layer reports success where it cannot fail: four defects, none
  of them reachable by a diff-scoped review.** Filed 2026-08-09 from the OAI-104/OAI-117 review
  ladder's **confirmation pass** (`adr/032`), which exists precisely to look at code the ladder has not
  touched. Passes 1 and 2 read only the diff and found five and three defects, **all in the ladder's own
  fixes**; the confirmation pass read the surrounding module and found these, all **pre-existing**.
  Each is reproduced, three of them by executing the real unmodified code.
  1. **The prompt-cache caveat cannot print on the default invocation.** `caveats.mjs:87` `cacheNote`
     gates two paragraphs on a ratio needing **two prefill samples in one case**, but the default is
     `runsPerCase = 1` (`run.mjs:219`). Executed with a positive control: 1 sample → **0 of 2**
     paragraphs; 2 samples → **2 of 2**; at `--runs 3` with 1 surviving sample → **0 of 2**, so the
     gate is **sample count, not run count** — a run the server degraded (this repo measured LM Studio
     dropping ~1/3 of long requests) loses the warning exactly when it needs it. The second paragraph
     ("Generation is what the cache does not touch") **needs no ratio at all** and is bundled behind the
     same gate. `case-rows.mjs:74` justifies its `--cold`-only exclusion on the premise that "the caveats
     say so" — false on the default path, so a **behaviour is reasoned from a claim that does not hold**.
  2. **A truncated-but-parsed run is discarded, and the caveat asserts it could not exist.**
     `run-buckets.mjs:35` `truncatedRuns` filters on `finishReason === 'length'` with **no parse check**;
     `case-rows.mjs:197` then drops those runs from `scored`, and `caveats.mjs:38` explains the exclusion
     with *"the JSON never parsed, so there is nothing in them to score"* — which nothing enforces.
     **Reachable because ADR 003 removed the default schema on 2026-08-04**: without a grammar the model
     completes its JSON and keeps talking, so hitting the ceiling *after* a complete reply is the
     ordinary case now. The `cut` vs `truncated` split was sound while a schema guaranteed the JSON came
     last; **removing the schema invalidated the premise and this bucket was never revisited.**
  3. **The dropped-defects caveat mixes two units and inverts its own sentence.** `caveats.mjs:261` sums
     `listed` (distinct defects, **per case**) beside `scoreable` (`case-rows.mjs:236`:
     `listed * scored.length`, **defect-slots per case × scored runs**) and prints them as a subset:
     *"N scoreable of M listed defect(s)"*. Executed output at 3 scored runs: **"6 scoreable of 2 listed
     defect(s)"**. It has never failed a test because **every caveats test passes `runsPerCase: 1`**,
     where the two units coincide by coincidence. Reachable on any full-corpus run — `dropped` is
     non-empty for `config-origin`, `scaffold` and `model-info` — and **the sibling caveat two
     paragraphs above tells the reader to raise `--runs`**, so the report instructs you to do the thing
     that breaks it. *(Narrowed by its verifier: the trailing "smaller than the truth twice over" clause
     SURVIVES — in slot units the honest denominator is `(listed+dropped)*scored = 10 > 6`. The defect is
     purely the unit mismatch, plus understating the dropped gap by a factor of `scored.length`.)*
  4. **DONE 2026-08-09 (see below). The schema arm is captioned by what was ASKED FOR, not what happened.** `caveats.mjs:165` asserts
     *"the reply shape was enforced by a `response_format` schema"* gated on the **flag**.
     `review-request.mjs:224-232` **falls back to unconstrained** when a server rejects `response_format`
     and says so on stderr; `cmd-review.mjs:156-167` emits both facts and its own comment names the
     distinction — *"What was ASKED for, beside `structured` which is what was obtained."* **`bench`
     never reads `structured`** (`grep -rn structured bench/` returns only `structuredOutput`). Against
     oMLX, vLLM without the feature, or an older LM Studio, **both arms of the comparison are the same
     arm, labelled as different ones** — while the report instructs the reader to read one against the
     other. **Not pre-existing in the way the other three are**: the note and the flag forwarding are
     OAI-117's own. **Deferred out of the ladder deliberately, not missed** — the fix needs a new row
     field, a reduce across runs and a threaded argument (`caseRows` projects a fixed field set;
     `caveats` takes `structuredOutput` from the CLI options, never from `rows`), and it **cannot be a
     boolean**: with N runs a case can degrade on some and not others, so the caption must read
     *"requested; obtained on 2 of 3"* or it replaces one blind caption with another. Landing that in the
     ladder's **final** batch would have shipped it unreviewed, since `adr/089`'s verification pass opens
     no finding lenses.
  **ITEM 4 SHIPPED 2026-08-09**, once its cost turned out to be a tenth of the estimate: the CLI
  already emits `degraded` ("asked for, and not obtained") in the `--json` envelope, so no new fact had
  to be computed — `case-rows.mjs` counts it per run beside a `reported` denominator and
  `bench/lib/schema-degrade.mjs` prints it. **Per run, never a boolean**: a case can degrade on some
  runs and not others, and a wholly degraded arm now says **"THIS ARM DID NOT MEASURE A SCHEMA"** while
  a mixed one says it only partly did. Four mutations prove it, including the one that reinstates the
  original bug. **Items 1-3 and everything below remain open.**
  **Also here, same file, lower value:** `run.mjs:81-84` — an empty `--model=` suppresses the manifest
  fallback via `??` and is then discarded, so the harness **silently benchmarks the configured default
  and overrides a case-level model pin**, measuring a different target than the operator named; and
  `run.mjs:219` — an empty `--runs=` is truthiness-tested before conversion, so it reads as absent and
  runs 1 instead of rejecting the value. Plus one weak test: the `--cold` case never asserts `second`
  *has* a `--cache-buster`, so a `second` that dropped the flag entirely still satisfies `notEqual`.
  **The unifying class is this repo's own** — a check or claim that reports success while structurally
  unable to fail — and (1), (3) and (4) each additionally **cannot fail under the only configuration
  the tests exercise**. Fix (3) and (1) with tests at `runsPerCase > 1`, which no test currently uses.

### OAI-137 — parked, `not worth doing`

**Why parked:** `readOmlx` silently ignores `data` when `models` is an empty array, contradicting its own comment. Real and reproduced, but no caller has been observed hitting this path with data actually present.

**Reopening bar (an instance, with a date):** A dated instance of a real call reaching this path with `data` populated and an empty `models` array, and the data being silently dropped.

*Filing kept verbatim:*

- **OAI-137** — **`readOmlx` does not accept `data` when `models` is present but empty, though the
  comment four lines above says it does.** Filed 2026-08-10 from the overnight sweep, which reviewed
  the very commit (`1139d97`) that introduced the line. **Reproduced directly against the real
  predicate**, not argued:
  ```
  {models: [], data: [2 entries]}  ->  []          # data never reached
  {data: [1 entry]}                ->  [1 entry]   # data reached only when models is absent
  ```
  `model-info.mjs:130` is `[payload?.models, payload?.data, payload].find(Array.isArray) ?? []`, and
  `Array.isArray([])` is **true**, so an empty `models` array wins the `find` and short-circuits the
  fallback. The docstring at `:126` states *"`data` is still accepted — dropping it would swap a
  verified shape for an unverified assumption pointing the other way."* For the `{models: [], data:
  […]}` envelope that sentence is **false**.
  **Narrow envelope, and that is the argument for fixing it rather than against.** No observed server
  returns that shape today; the whole point of keeping `data` was to cover a server nobody has run
  this against. A fallback that silently does not fall back is worth less than no fallback, because
  the comment tells the next reader it is covered. **This repo's signature class** — a claim the code
  does not support — arriving inside the fix whose entire subject was vendor-shape assumptions.
  **Fix shape**: prefer the first **non-empty** array, or take the first array and fall through when
  it is empty. Either way the test must use `{models: [], data: […]}`, which no current test does —
  which is why the unit suite was green through the whole review.

### OAI-140 — parked, `not worth doing`

**Why parked:** A slow (not dead) commit resets the outage-streak counter, so a real outage interleaved with slow commits could go uncaught. The recording half already shipped; what remains is a policy decision (sliding window vs decay vs leave alone), and no missed real outage has been observed with the data now available to check.

**Reopening bar (an instance, with a date):** A dated sweep run where a real server outage, interleaved with slow commits, was not caught by `--abort-after` because a slow commit reset the counter — shown from the recorded server-health section.

*Filing kept verbatim:*

- **OAI-140** — **A slow commit RESETS the consecutive-outage counter, so a real outage interleaved
  with slow commits never trips `--abort-after`.** Filed 2026-08-10, surfaced by Codex while pricing
  OAI-138's cap rise and **separated from it deliberately**: it is a defect in its own right, it is
  live at today's 900s cap, and folding it into a cap change would hide it.
  `review-sweep.mjs:216` is `consecutiveOutage = isOutage(entry) ? consecutiveOutage + 1 : 0;` — the
  counter is a run of **strictly consecutive** outages, and **any** non-outage zeroes it. A
  `deadline-timeout` is deliberately not an outage: that is exactly what OAI-119 asked for and OAI-120
  delivered, and it was the right fix — three slow commits must not abort a healthy sweep. **The
  overcorrection is the reset.** A server that is genuinely failing every other commit, with a slow
  commit in between, produces `outage, timeout, outage, timeout, …` and the counter never reaches 3.
  The sweep runs to its full wall clock against a dead server and reports the result as coverage.
  **Evidence it is live, not theoretical:** last night's run recorded **20 deadline-timeouts and zero
  aborts**. That was read at the time as "the OAI-120 fix held in the field" and it did — but the same
  data cannot distinguish *"no outage occurred"* from *"outages occurred and were repeatedly reset"*,
  because **nothing records the counter's history**. This is the repo's own class again: a check that
  reported success without the evidence to fail.
  **OAI-138's cap rise makes it worse and is the reason it surfaced now.** At 1,800s a single
  pathological commit can burn 30 minutes without advancing the counter, so the interval over which a
  genuine outage stays undetected roughly doubles.
  **Fix shape (not decided, and it must not simply re-admit `deadline-timeout` as an outage — that
  reverts OAI-120).** Candidates: count outages in a sliding window rather than requiring them to be
  consecutive; decay the counter instead of zeroing it; or keep the streak but record every outage so
  the report can say how many occurred and how often the streak reset. **The last one is worth doing
  regardless**, since it is what would have let last night's record answer the question at all.

### OAI-141 — parked, `not worth doing`

**Why parked:** A statistical finding (run-to-run spread exceeds the differences typically being compared) that justifies keeping OAI-151 (cross-run history), rather than being independently actionable itself. Its evidence is preserved in OAI-151 and the bench ledgers.

**Reopening bar (an instance, with a date):** A future sweep needing this specific spread figure re-measured or extended beyond what OAI-151's cross-run index already provides.

*Filing kept verbatim:*

- **OAI-141** — **The reviewer's per-commit output is unstable enough that ~30% of finding-bearing
  commits do not reproduce run-to-run, and every single-run comparison in this tracker was read as if
  it were a measurement.** Filed 2026-08-12 from OAI-139's replication, which was designed to answer a
  different question and answered this one on the way.
  **Four sweeps over the same 40 eligible commits, same pinned SHA, same model, same 1800s cap.** Two
  whole-file, two diff-only. Finding-bearing counts: **17, 22** (whole-file) and **19, 21**
  (diff-only). **Whole-file re-run against ITSELF reproduced only 12 of its own 17 finding-bearing
  commits** — the same number the diff-only arm reproduced.
  **So the spread between identical runs (17 vs 22, and 5 of 17 not reproducing) is LARGER than the
  difference between the two configurations anyone was arguing about.** A single-run A/B in this
  harness cannot resolve an effect smaller than that, and nothing in the tracker previously said so.
  **What this does and does not invalidate**, judged rather than asserted:
  - **OAI-138's cap result SURVIVES.** 20 commits hitting the 900s boundary exactly, against 18
    completions demonstrably needing more than 900s, is far outside this spread. Codex made the same
    call independently.
  - **The diff-only comparison did NOT survive it** and was correctly recorded as inconclusive before
    the replication existed; the replication then refuted it outright.
  - **Anything else here resting on one run against one run should be re-read**, and future arms
    should say what effect size they can actually detect.
  **The likely mechanism is already measured, not speculative:** 97-98% of every completion is
  `reasoning_tokens` on an unconstrained path with no schema (`adr/003`), so what the model attends to
  varies run to run. The same commit has completed once and starved once on identical input.
  **What "absent" means here matters and was nearly mis-recorded:** across the 10 commits where a run
  went quiet, absence usually meant **a different defect reported**, not none — so a naive
  reproduction rate understates agreement. Only 1 of 17 went clean in every re-run.
  **Fix shape (not decided).** Options: report a reproduction rate alongside any sweep comparison;
  require N>=2 runs per arm before an A/B enters this tracker as evidence; or state a minimum
  detectable effect in the pre-registration. **The cheap half is the last one** — it costs a sentence
  and would have stopped this being read as a signal for two days.
  **A FIFTH run, 2026-08-14, and it is recorded here rather than as its own item.** Same model, same
  1800s cap, whole-file, warmed rather than cold-started; 35 eligible commits overlap the arms above.
  On that overlap: **15 finding-bearing tonight against 21**, 23 total findings against 33, **14 of
  21 reproduced, and 1 finding-bearing commit was novel**. That sits inside the spread this item
  measured (17 vs 22; 12 of 17), so it is a data point, **not** a regression — and the discipline
  this item asks for is what produced that reading. **It was nearly filed as a separate defect**: at
  36 of 40 commits the partial run showed 11 against 18 with *zero* novel commits, which looked like
  an asymmetry the noise model does not predict. The last four commits removed it. **A partial sweep
  is not a small sweep — reading one is how this item's own mistake gets made again.**
  One real subtraction survives: **1 of tonight's 7 non-reproductions is a discarded answer, not a
  quiet one** (OAI-156), so a reproduction rate computed off outcomes alone understates agreement by
  at least that much.

### OAI-143 — parked, `not worth doing`

**Why parked:** `errorReport` omits caveat fields (`estimatedTokens`, `hunksOnly`, `skippedUnsizedWindow`, `contextChecked`) that `jsonReport` carries, so a cut run tells a harness less than it could about why. Observed once while verifying OAI-139, worked around at the time with a separate deterministic stub run.

**Reopening bar (an instance, with a date):** A dated instance where a cut run's missing caveat fields blocked or delayed diagnosing a real sizing problem, with no workaround available.

*Filing kept verbatim:*

- **OAI-143** — **`errorReport` carries none of the caveat fields `jsonReport` does, so a run that was
  CUT tells a harness nothing about what it sent.** Filed 2026-08-12, observed while verifying
  OAI-139: a review cut by `--max-seconds` returns `{error, reason, message, hint, attempts,
  requestedModel}` and nothing else. `estimatedTokens`, `hunksOnly`, `skippedUnsizedWindow` and
  `contextChecked` are all absent — so the run carrying the MOST evidence about a sizing problem is
  the one that reports least about it. Concretely: the first live reproduction attempt for OAI-139 was
  cut at 900s and its envelope could not evidence the skip either way; the claim had to be carried by
  a separate deterministic stub run. `adr/012` already argues the failure path is where the attempt
  record matters most, and the same reasoning applies to the request-shape fields. Not a wide change —
  `errorReport` needs the context `jsonReport` already receives.

### OAI-146 — parked, `not worth doing`

**Why parked:** Narrowed to one remaining instance (2026-08-14): quoted test text in `tests/job-busy-spawn.test.js` overclaims worker liveness ("already running and about to make a real, billable model call"). It is comment/test-name text, not behavior — no code reads it, and the behavioral instance this item's evidence pointed to (the OAI-67 defect) already shipped its fix.

**Reopening bar (an instance, with a date):** A dated instance of code (not prose) acting on the overclaimed liveness and producing a wrong outcome.

*Filing kept verbatim:*

- **OAI-146** — **"A detached worker is running" is asserted in many places and established in
  none.** Filed 2026-08-12, from OAI-67's gate rounds, which kept surfacing instances OUTSIDE that
  feature's diff. The `'spawn'` event proves a child was CREATED; nothing in this repo watches it
  afterwards, so every sentence saying a worker "is running", "is alive", or "is about to make a
  billable call" claims continued liveness nobody observed. OAI-67 corrected every instance it
  touched and left these, which are pre-existing and unrelated to it: `adr/020`'s site (e) discussion
  and its evidence-table row name `a busy on the SPAWNED stamp does not lose an id whose worker is
  already running` (renaming it renames a live test, which is why it survives a claim sweep twice over
  — it is quoted text, not prose), and `tests/job-busy-spawn.test.js`'s header
  ("already running and about to make a real, billable model call"). **Why it matters rather than
  being pedantry:** the same overclaim, in `task-submit.mjs`, is what made a spawn rejection destroy
  a live worker's row — OAI-67's central defect — and the shape recurred eight times inside one
  feature once anyone looked. **Cheap first step is a grep, not a redesign**, and the honest bound is
  that this is comment/ADR text, not behaviour: no code reads these sentences.
  **NARROWED 2026-08-14 by the sweep, verified against disk — it is now ONE instance, not two.** The
  `adr/020` site (e) discussion went with the deleted ADR corpus (`d1ad2aa`), and `task-submit.mjs`
  has since been corrected on its own (*"a rejection may mean no child was ever created, or a child
  that is alive"*). What remains is `tests/job-busy-spawn.test.js`'s header and test names —
  *"already running and about to make a real, billable model call"* — which is **quoted test text, so
  renaming it renames a live test**, exactly the reason this survived two claim sweeps.

### OAI-147 — parked, `not worth doing`

**Why parked:** `tests/structure.test.js`'s orphaned-doc-comment guard is blind to a file's first doc comment. No instance of an orphaned first-comment slipping past review has been observed.

**Reopening bar (an instance, with a date):** A dated instance of a stale or orphaned first-file doc comment that this guard should have caught and did not.

*Filing kept verbatim:*

- **OAI-147** — **`tests/structure.test.js`'s orphaned-doc-comment guard is blind to a file's FIRST
  function, which is where the defect it exists for is most likely to be.** Filed 2026-08-12 from
  OAI-67's review pass 3, and **measured rather than argued**. The guard tracks `seenFunction` and only
  reports once a `function` declaration has been passed (`tests/structure.test.js:69,74`, moved from
  `:120,125` when the ratchet retirement deleted 51 lines above them, 2026-08-17 — the file lost 57
  lines total, but 6 of those sat below this site), so two
  adjacent doc blocks ABOVE a module's first function are invisible to it. That is exactly the shape
  `acceptance-audit` found by eye in `scripts/lib/job-launch-outcome.mjs`, where the module's own
  contract had detached onto a one-line stderr writer and the exported function carried no docstring at
  all — while this guard ran green in the same suite.
  **Positive control, both directions, in one run:** a probe file with the adjacency placed BEFORE the
  first function leaves the guard green; the identical adjacency placed AFTER a function reddens it and
  names the line. So the guard works and its scope is wrong, which is the more dangerous shape — it
  reports success over the case it was written for.
  The `seenFunction` gate is not gratuitous: its comment says it exists so a module HEADER, attached to
  nothing on purpose, is not called a defect. So the fix is not deleting the gate but distinguishing a
  header from an orphan — the last block before the first declaration is a header only if it is the
  ONLY one there. A new module is precisely where a first-function docstring gets written, which is why
  the blind spot and the defect coincide.

### OAI-148 — parked, `not worth doing`

**Why parked:** The evidence a review ladder produces does not outlive the session that produced it. A real cost (documented elsewhere in this repo's own memory as "ladder evidence dies with the session") but no single dated instance is named in this item's own text.

**Reopening bar (an instance, with a date):** A dated instance of a ladder needing to reconstruct lost evidence from a prior session, with the reconstruction cost stated.

*Filing kept verbatim:*

- **OAI-148** — **the evidence a ladder produces does not outlive the session that produced it.**
  Filed 2026-08-12 from OAI-67's review, which spent real effort rediscovering its own work twice.
  Two concrete losses, both measured rather than supposed:
  **(a)** the MUTATION SET was never written down. OAI-67 re-ran nine mutations after every batch, but
  the set existed only in one session's context; resuming after a compaction meant reconstructing it
  from what each witness appeared to guard, and one reconstructed mutation was wrong in a way that
  mattered — it produced a SYNTAX ERROR rather than a behavioural failure, which proves a file changed
  and nothing else, and would have been recorded as a passing mutation had it not been re-examined.
  **(b)** the plan cited a ledger at `scratchpad/ledger-oai-67.md` for its round-by-round measurements.
  That path is session-local and resolves to nothing in the repo, so an auditor could not corroborate a
  single cited figure; the plan now says so instead of citing it, which is honest but not a fix.
  **The shape of the fix is a durable per-feature evidence file** — the mutation set as a runnable
  list, and the measurements the plan relies on — sitting beside the plan rather than in a scratchpad.
  **The bar for it being real:** the mutation list must be EXECUTABLE, not prose. A written list of
  mutations nobody runs is exactly the class this repo keeps legislating against, and it would decay
  faster than the code it describes.
  Related: the ladder register already survives the session (`adr/082`), which is the precedent — this
  is the same argument applied to the evidence rather than to the metadata.

### OAI-155 — parked, `not worth doing`

**Why parked:** A coverage fact from one specific sweep run (2026-08-13): 31 old commits reviewed successfully, none of the 5 the sweep was actually launched for. A real result, not an ongoing defect — the overnight-sweep program is not currently running.

**Reopening bar (an instance, with a date):** A future sweep run again failing to reach its launch targets while reviewing unrelated back-catalog commits instead, with counts.

*Filing kept verbatim:*

- **OAI-155** — **The size ladder ends at the diff, so this repo's own large commits cannot be
  reviewed at all.** Filed 2026-08-14 from the overnight sweep. Two of the five never-reviewed
  commits were refused `oversize` in under a second: `d1ad2aa` at **128.9k estimated tokens** and
  `9883f7f` at **101.1k**, against **57.6k usable** (a 61.7k window less a 4.1k reply reserve) on
  `qwen/qwen3.6-27b`.
  **This is the ladder working, and that is what makes it filable rather than a bug report.**
  `prepareLadder` (`scripts/lib/review-ladder.mjs:60`) reaches the `hunks` rung only after the `whole`
  rung has thrown and every changed-file body has been shed, so those two figures are **the diff
  alone, with nothing left to drop**. There is no rung below it, so the refusal is honest and
  instant — and terminal.
  **The consequence is measured, not argued: the harness cannot review its own newest work.** Taken
  with three starvations (OAI-115), the split across the completed run is exact: of the five
  genuinely-unreviewed commits of 2026-08-13, **2 failed oversize and 3 starved — none produced a
  review**, while of the 35 older and smaller commits **33 did** (18 clean, 15 with findings, 1
  starved, 1 unreadable). So a sweep's coverage skews
  systematically toward small old commits, and a header reading "40 eligible" conceals that the
  interesting five were never seen.
  **Fix shape (not decided), and it is a decision rather than a patch**: a per-file rung below
  `hunks` (review each changed file's hunks alone and merge), or split the target and report N
  sub-reviews as one. Both change what a finding is scoped to, and the second changes what "a commit
  reviewed" means in every artifact this repo writes.
  **There is a cheaper repair in front of both, and the measurement is decisive.** The sweep selects
  commits by `--include scripts bench tests` but then sends the **whole** commit, so both refusals
  were mostly content the include filter had already declared irrelevant: `d1ad2aa`'s diff is
  **436,887 bytes whole and 34,800 restricted to those paths — 8%** (the rest is the deleted ADR
  corpus); `9883f7f` is **340,491 against 58,384 — 17%**. Both fit the window comfortably once
  scoped. So the first thing to try is not a new rung but **making the review honour the same
  pathspec the eligibility check uses** — a pathspec through `selectDiff`'s `listArgs` and diff
  command.
  **Do NOT reach for `--file` as the interim.** `collectTarget` (`scripts/lib/git-diff.mjs:199`)
  short-circuits on `options.file` **before** any diff selection, so `--commit X --file path`
  silently discards the commit and reads `path` from the **working tree**, returning `diff: ''` and a
  label of `N file(s)`. In a sweep artifact that would read as a review of the commit while being a
  review of today's tree — the wrong-content-under-a-right-looking-label class this tracker keeps
  filing. This entry previously recommended exactly that, on 2026-08-14, before the code was read.

### OAI-157 — parked, `not worth doing`

**Why parked:** The cheaper twin of OAI-155: say a commit is oversized before spending the night on it, not after. Same status — real finding from one run, not currently costing anything while sweeps are paused.

**Reopening bar (an instance, with a date):** A future sweep run again spending significant wall-clock on a commit only to reject it as oversized at the end, with the time cost stated.

*Filing kept verbatim:*

- **OAI-157** — **A sweep commits a night to a corpus it has never sized, so an impossible target is
  discovered at 08:00 rather than at 22:57.** Filed 2026-08-14, recommended by `codex-rescue` in its
  review of that night's run and adopted because the night it describes had already happened.
  **The evidence is the run itself**: the two commits refused `oversize` were refused in **under a
  second each**, on an arithmetic — estimated tokens against the served window — that needs no model
  and could have been done before the first review started. Instead it was done nine hours later, by
  hand, by a reader comparing two records.
  **Shape**: a `--plan-only` that runs everything up to the first request and then stops, emitting per
  enumerated commit — the resolved SHA, whether any prior ledger already covered it, the whole-file
  and diff-alone token estimates, which ladder rung those imply, and whether the target is reviewable
  at all. **It must run AFTER the warm-up**, or the window is unknown and every estimate it prints is
  the unsized-window case (OAI-139) rather than the one the night will run.
  **What it buys, stated as the thing it prevents**: 9h26m was spent to learn that 5 of 40 targets
  were unreachable. The same fact is a sub-second calculation. It also gives the sweep a refusal it
  cannot currently express — *this corpus contains targets no configuration of this run can review* —
  which is the only signal that would have stopped the 2026-08-13 night going ahead unchanged.
  **Related but NOT the same as OAI-155**: that item is about making a big target reviewable, this one
  about knowing it is not before spending the hardware. Either can land without the other, and this
  one is strictly smaller.
  **Coverage lookup is the one part with a dependency**: "has a prior ledger covered this SHA" is
  OAI-151's cross-run history. Until that exists `--plan-only` should print the sizing half and say
  the coverage column is unavailable, rather than growing its own second index.

### OAI-158 — parked, `not worth doing`

**Why parked:** The tracker's own structural guard cannot see six of the seven parked items (mutation-proved both directions), so a resurrected parked item would silently pass the suite. Real and cheap to fix, but no instance of a parked item actually resurfacing undetected has occurred.

**Reopening bar (an instance, with a date):** A dated instance of a parked item reappearing in the live index without the structural guard catching it.

*Filing kept verbatim:*

- **OAI-158** — **The tracker guard cannot see six of the seven parked items, so its "live and closed
  out at once" check is blind over most of its own domain.** Filed 2026-08-14 by the backlog sweep,
  **mutation-proved**, in the guard the PREVIOUS sweep shipped (OAI-104).
  `tests/backlog-structure.test.js` `closedIds` matches `^- \*\*(OAI-n)\*\*` — the list shape — and
  `BACKLOG_PARKED.md` writes the 2026-08-13 block as `### OAI-n — parked` headings. So the guard sees
  exactly **`OAI-44`**, and is blind to **`OAI-7`, `OAI-36`, `OAI-43`, `OAI-47`, `OAI-82`,
  `OAI-152`**.
  **Positive control, both directions, in one run:** resurrect `OAI-43` as a live body in ID order and
  add it to its tier index — the suite stays **6 pass / 0 fail**, so an item can be live and parked
  simultaneously with nothing going red. Restored, still 6/0.
  **The shape is this repo's signature and the location is the sting**: the guard was written because
  the invariant it enforces had been prose naming a script that did not exist, and it found real drift
  on its first run — but its own domain query cannot reach the file that the last sweep's worth bar
  filled. A check that reports success over the case it was written for.
  **Fix is one line and a decision**: match both shapes in `closedIds`, or normalise
  `BACKLOG_PARKED.md` to one heading shape. Prefer matching both — the parked file's two shapes are a
  real history (the `### ` block carries a reopening bar per item, the older `- ` entries do not), and
  a guard should read the tracker as written rather than require the tracker to be rewritten for it.
  **Whichever is chosen, the mutation above is the test**: a parked id resurrected as live must turn
  the suite red.

### OAI-163 — parked, `not worth doing`

**Why parked:** A healthy model still reasoning (not failed) gets misrecorded as a server outage, and three in a row abort a healthy sweep. A real wrong-verdict mechanism, but the overnight-sweep program this fires inside is not currently running.

**Reopening bar (an instance, with a date):** A future sweep run aborted by three consecutive false-outage verdicts while the model was actually healthy, shown from the recorded server-health section.

*Filing kept verbatim:*

- **OAI-163** — **A healthy model that reasons without answering is recorded as a SERVER OUTAGE, and
  three in a row would abort the night.** Filed 2026-08-15 from the qwen3.8 characterisation sweep;
  claim put to Codex as a refutation request and confirmed TRUE against the code.
  The same observable behaviour — the model reasons and never emits an answer — reaches the classifier
  in **two shapes, and only one is safe**. `finish_reason: 'length'` is tagged `token-exhaustion`
  (`review-unparsed.mjs:20-43`) and becomes outcome `starved`, which `isOutage` does not admit. But
  `requireAnswer()` throws a `UserError` carrying **no `reason`** for reasoning-only output
  (`client.mjs:104-107`); `errorReport` serialises `reason: null` (`review-report.mjs:200-216`); and
  `isOutage` admits `failed && !reason` **unconditionally** (`sweep-outcome.mjs:109-112`), which
  `runSweep` then counts toward the abort streak (`review-sweep.mjs:207-210`).
  **Evidence, 2026-08-15 02:26Z, commit `caa9d85ba`:** 31,249 characters of reasoning at ~15.4 tok/s
  over 633s, then the model ended its own turn without leaving the reasoning channel. It was recorded
  as the run's **only** server outage. The server was healthy — the commits either side of it answered
  normally, and the model went on to complete 17 reviews.
  **The blast radius is not just the abort.** The report's health section fired its
  "may have done so against a server that was failing intermittently rather than a healthy one"
  caveat on a healthy server, so the morning artifact understates its own trustworthiness.
  **Distinct from OAI-140, and in the OPPOSITE direction** — that one is a real outage the counter
  never reaches; this one is a non-outage the counter does. **A fix to either must not assume the
  other's direction**, and the two should be read together before either is designed.
  **Not covered by OAI-115 or OAI-116** — checked against both bodies. OAI-115 is the allocation
  defect that produces the behaviour; OAI-116 is the missing `attempts[]` on that path. Neither says
  the resulting envelope is admitted as evidence of an unwell server.
  **Fix shape (not decided, and cheap):** the code already distinguishes these two cases — the
  reasoning-only branch runs only after the `finish_reason: 'length'` test did not hold — so giving
  that refusal its own non-null reason would classify it beside `starved` without touching `isOutage`.
  The care needed is that it must not be folded into `token-exhaustion`: they have different causes
  and `tests/review-exhaustion-reason.test.js:56-77` varies `finish_reason` alone to keep them apart.

### OAI-164 — parked, `not worth doing`

**Why parked:** An open measurement question (is `qwen3.8-27b-mlx` worth adopting), not a defect. The item's own text says one more sweep may still not resolve the ambiguity against this harness's known run-to-run spread.

**Reopening bar (an instance, with a date):** A decision to actually take the measurement again, ideally after OAI-151's cross-run index exists to make the spread question answerable.

*Filing kept verbatim:*

- **OAI-164** — **Is `qwen3.8-27b-mlx` worth adopting? One run says "findings level, reliability
  worse", and one run cannot say that.** Filed 2026-08-15 from the model's first characterisation
  sweep. **This is a measurement to take, not a defect.**
  **What the release does NOT change, and this is settled:** `loaded_context_length` is **61,696** —
  identical to the outgoing `qwen/qwen3.6-27b` — against a `max_context_length` of 262,144. Same
  `qwen3_5` arch, 4bit, artifact `lmstudio-community/Qwen3.8-27B-MLX-4bit`. So the release buys
  **nothing** on the constraint that actually binds this repo, and the OAI-115 starvation mechanism
  carries over rather than being fixed by it.
  **The 8h run, `--from 8275488`, `--max-seconds 1800`, `--max-attempts 2`:** 30 attempted, 18
  reviewed, 13 findings, 6 starved, 6 failed, 1 (wrongly) judged an outage — see OAI-163.
  **On the 27 commits this run and the 2026-08-13 baseline both attempted: findings 12 vs 12 — level.
  Non-answers 11 vs 6.** Throughput 3.7/hr against 4.2/hr.
  **Why that is not yet a result, and the reason this item exists rather than a conclusion:**
  **OAI-141** puts the run-to-run spread of this harness ABOVE an effect of this size, and records
  that *the same commit has completed once and starved once on identical input*. Codex was asked
  directly whether the non-answer delta clears that spread and said it does not. So what is
  established is "this run had 11 versus 6", **not** a property of the model — exactly the
  single-run-read-as-measurement error OAI-141 was filed to stop.
  **What would settle it:** a second qwen3.8 sweep from the same pinned SHA with the same flags, and —
  per OAI-141's own instruction — **state the detectable effect size before running it**, because a
  second run may still not resolve 11 vs 6. Until then the default model stays `qwen/qwen3.6-27b`.
  Artifacts (gitignored, this machine only): `bench/results/sweep-2026-08-15-qwen38/` — report, JSON
  record, ledger, `run.sh` and `provenance.txt` recording the served id, both context figures, the
  artifact identity and the `lms` CLI commit.

### OAI-171 — parked, `not worth doing`

**Why parked:** A loaded skill can go stale mid-session with no signal of when — real, and it cost OAI-166 two discovery passes — but no fix is proposed and the item names no mechanism to build, only a documented risk.

**Reopening bar (an instance, with a date):** A further ladder pass demonstrably wasted by stale mid-session skill content, with the pass cost stated and a date.

*Filing kept verbatim:*

- **OAI-171** — **The review ladder's own rules changed mid-run and the run followed the superseded
  copy for two batches, which is what caused two of its passes.** Filed 2026-08-15 from OAI-166.
  `~/Code/dotfiles` commit `8475d03` (2026-08-15 16:18) added a delete-only carve-out — when a stage
  adjudicates descriptive prose false, DELETE the proposition rather than rewriting it, because a
  rewrite keeps producing the next false description. OAI-166's ladder had loaded `review-ladder`
  before that commit and `feature` before `2f6fac8`, so batches 1 and 2 rewrote where they should
  have deleted, and each introduced a fresh false claim that the next pass then found. The operator
  discovered the staleness only by checking on a hunch.
  **A skill loaded into a session is a snapshot, and nothing tells the session it has gone stale.**
  Filed as a toolchain observation with no proposed fix: the obvious remedies (re-read every skill at
  every step; a version stamp compared at each invocation) each have costs this run is not evidence
  enough to judge. What the run does establish is the cost of not knowing — two discovery passes,
  roughly ten subagents and four Codex calls, spent on prose.

### OAI-176 — parked, `not worth doing`

**Why parked:** A `fork-opener` review subagent echoed the orchestrator's own status framing instead of reviewing, observed twice. The one proposed mitigation (a prompt line disclaiming ambient framing) was tried at the second instance and failed — measured-insufficient-alone, not an untested candidate. No further mitigation is currently proposed.

**Reopening bar (an instance, with a date):** A new mitigation candidate to test, or a third instance that changes what is known about the mechanism.

*Filing kept verbatim:*

- **OAI-176** — **A `fork-opener` subagent's first invocation, mid-review-ladder, returned a status
  message about its OWN siblings instead of performing its assigned review.** Filed 2026-08-16 from
  OAI-167's review-ladder pass. A fork inherits the whole calling session's transcript, and the
  transcript at launch time ended with the orchestrator's own "waiting on Group A subagents" narration
  plus a `ListAgents` call showing the fork itself as `running`. The fork's reply was that same
  narration verbatim — "Still waiting on the three Group A subagents... I'll pick this back up as soon
  as they report in" — not a review of the frozen artifact it was handed. Treated as a non-clean stage
  result and retried once, per the ladder's retry rule; the retry, with an explicit instruction to
  ignore ambient waiting-status framing in the transcript, produced a real review. **Not reproduced
  deliberately, and no root cause is established** — the working hypothesis is that a fork launched
  while the orchestrator's most recent turns are themselves about waiting for sibling agents can latch
  onto that framing as if it were its own instruction, but this is one observed instance, not a
  measured mechanism. Filed as a toolchain observation for the review-ladder skill's `fork-opener`
  stage, with a candidate mitigation worth evaluating rather than assumed: a fork-opener prompt could
  open by explicitly disclaiming any waiting/status framing already in the transcript as not being its
  own task, the way the retry prompt did successfully here — but one success against one failure is
  not enough evidence to make that a standing instruction.
  **Second instance, 2026-08-17, from OAI-170's review-ladder pass — and it REFUTES the candidate
  mitigation rather than confirming it.** This launch's very first prompt already carried an explicit
  disclaiming line ("Ignore any ambient narration in this transcript about what's 'still running' or
  'waiting' from moments before this fork was spawned") — the exact mitigation floated above, tried
  proactively rather than only at retry — and the fork still returned "Waiting on notifications from
  the remaining Group A/B stages," echoing the orchestrator's own prior turn. Retried once more with a
  more forceful instruction ("Produce the actual review in this response... Do not mention waiting,
  background tasks, or other stages' status"), which worked. **Two failures, two different mitigation
  strengths, both insufficient on the first try** — the disclaiming-line mitigation is downgraded from
  untested-candidate to measured-insufficient-alone. Whatever the mechanism is, one line naming the
  framing to ignore does not reliably suppress it; what worked both times was a *retry*, not the
  content of either prompt's ignore-instruction.

### OAI-189 — parked, `not worth doing`

**Why parked:** `http.mjs`'s unsupported-protocol refusal interpolates a raw URL, but the item's own text says nothing currently reaches it that way — dead for any config-sourced input today.

**Reopening bar (an instance, with a date):** A reachable path from user- or config-sourced input to this branch, demonstrated.

*Filing kept verbatim:*

- **OAI-189** — **`http.mjs`'s unsupported-protocol refusal still interpolates a raw URL, but nothing
  currently reaches it that way.** `send()`'s unsupported-protocol branch (`http.mjs:246`) builds its
  `UserError` from the full `url`, which would include a query string. Disclosed, not fixed, at OAI-72's
  final verdict point: both `provider.mjs:121` and `model-info.mjs:36` — the only two callers — always
  pass a URL already protocol-validated by `normalizeBaseUrl` upstream, which restricts to http/https
  before this point is ever reached, so the branch is currently dead for any config-sourced input.
  Worth a fix only if a future caller of `send()` bypasses `normalizeBaseUrl`; until then this is a
  one-line note, not a dated instance.

### OAI-190 — parked, `not worth doing`

**Why parked:** `validateConfig`'s numeric-only config keys interpolate their raw value on validation failure, but a secret could only appear there via a hand-misplaced key name under one of seven specific numeric keys — none of which are named or documented to accept one.

**Reopening bar (an instance, with a date):** An observed instance of a secret reaching one of these seven numeric config keys and being interpolated into an error.

*Filing kept verbatim:*

- **OAI-190** — **`config.mjs`'s `validateConfig` interpolates raw values for its numeric config keys.**
  Seven enumerated keys (`contextLength`, `timeoutSeconds`, `idleSeconds`, `maxSeconds`,
  `retrySeconds`, `prefillTokensPerSecond`, `generationTokensPerSecond`) have their raw value
  interpolated into a `UserError` when validation fails, via `JSON.stringify(value)` or `value`
  directly. Disclosed, not fixed, at OAI-72's final verdict point: this is a narrower, different shape
  than OAI-72 addressed (baseUrl/JSON content) — a secret could only leak here if hand-misplaced under
  one of these specific numeric key names, which none of these keys are named or documented to accept.
  Low enough probability and severity that it was left as a note rather than fixed alongside OAI-72.

### OAI-191 — parked, `not worth doing`

**Why parked:** Split from OAI-160, 2026-08-19: eleven branches in the background-job display and queue modules are reachable and untested, and two constants (`STARTUP_GRACE_MS`, `STALE_BEAT_MS`) are unpinned by any test that would fail if they moved severalfold. Enumerated by a scout against a fixed manifest, each entry checked by grepping the test tree rather than assumed. None is a live defect and none fires outside an injected test — the one entry that WAS a live defect (the `noteFor`/`displayOf` mislabeling of an ordinary row) stayed live as OAI-160.

**Reopening bar (an instance, with a date):** A dated instance of one of these eleven branches producing a wrong result on a real row, or one of the two constants drifting undetected and changing observed behavior.

*Filing:*

- **OAI-191** — **Eleven untested branches in the background-job display/queue modules, plus two
  unpinned constants, split from OAI-160's coverage-debt half.** Split 2026-08-19 because OAI-160's
  `noteFor`/`displayOf` mislabeling defect is live today and this residue is not; keeping them in
  one item let the live defect hide behind eleven inert ones. Enumerated by OAI-64's confirmation
  pass, steered at PRE-BATCH symbols precisely because the three passes before it had reviewed only
  new code: `job-view.mjs` `openJobs`' null-database return and `cmd-status.mjs` `runStatus`'
  matching "none has ever been submitted" branch; `noteFor`'s "written by a newer plugin" note (the
  non-mislabeling uses of it); `stamp`'s `—` fallback, `workerField`'s "no worker registered yet",
  and `fields`/`renderDetail` as a whole for a **queued** row, since no test renders the detail view
  of one; `isAlive`'s (now `pidLiveness`'s, per OAI-162) `EPERM` arm, still reached by no test;
  `inImmediateTransaction`'s ROLLBACK path, which nothing makes `decide` throw inside; `attempt`'s
  `isBusy` → `blocked` mapping, exercised only incidentally by real concurrency; `claimJob`'s
  `false` return, the late-arrival race its own comment names; and `showOne`'s "No job with id"
  `UserError`, whose identically worded assertions elsewhere hit `cmd-cancel`'s and `cmd-result`'s
  own copies, not this one. **Two constants are pinned by nothing that names them:**
  `STARTUP_GRACE_MS` (zero references in any test file) and `STALE_BEAT_MS` (referenced only as a
  bare comment beside a numeric literal in three test files, not as an imported symbol used in
  arithmetic — no test would fail if it moved). None of this was introduced by OAI-64; it predates
  that pass and none is a defect.

## 2026-08-18 — parked by the backlog sweep's worth bar

Forty-one items, all `not worth doing` — **never `refuted`**. Every one was verified against disk
this session by five independent scouts and every one came back STILL TRUE or an accurate description
of current state; **none was refuted**, which is exactly why the bar applied here is worth rather than
truth. The bar was applied to all 112 live items, not to a chosen subset: the 70 that survive were
held to the same test and these 41 name no instance of harm that has already happened. **Seventeen
say so in their own words** — OAI-29, OAI-39, OAI-48, OAI-53, OAI-73, OAI-80, OAI-87, OAI-92,
OAI-109, OAI-130, OAI-149, OAI-169, OAI-175, OAI-179, OAI-182, OAI-186, OAI-188 — and those quotes
are kept verbatim below rather than paraphrased. Checked against the silence
exception item by item — the exception requires the ITEM to argue that its failure mode destroys its
own evidence, and none of these does; several argue the opposite (OAI-169: "shows as an intermittent
stall... not as silent wrongness"). **Every reopening bar here is an INSTANCE, not an argument**: a
better-sounding case for one of these does not reopen it, because that is what parked it.

### OAI-29 — parked, `not worth doing`

**Why parked:** No dated instance. The item's own text prices it: *"Small, and immaterial at present scales — the cap is seconds, the slip is milliseconds"*. The mechanism is real — `postWithDegrade` computes one `capBudgets` result that `postChat` arms the timer from a few call frames later — but no run has been observed where the recomputed budget would have changed what the transport did.

**Reopening bar (an instance, with a date):** An observed run where the transport armed its timer from a stale remaining budget and the request outlived the `--max-seconds` cap as a result. Record the cap, the measured overshoot, and the date.

*Filing kept verbatim:*

- **OAI-29** — Let the transport ARM from a recomputed remaining budget, without letting it refuse.
  Filed 2026-08-01 from the OAI-22 adversarial review (Codex, medium/0.96), where the finding was
  accepted as a *claim* correction and its recommendation deliberately not taken. The claim: OAI-22
  carries one `capBudgets` result from `postWithDegrade` into `postChat`, so the `totalMs` the
  transport arms is computed a few call frames before the socket is written. There is no `await` in
  that gap, but `ledger.begin` serializes the messages for `promptChars` and `request` serializes the
  body again — milliseconds on a 60k-token prompt — so a request dispatched a hair after expiry is
  granted the duration that remained at the check. Codex recommended carrying the absolute expiry
  into the transport and validating it at arming time; that half was **rejected and stays rejected**,
  because a transport that can *refuse* at arming reopens exactly the phantom-ledger-entry window
  OAI-22 closed. The safe half was never done: recompute the remaining time at arming and use it for
  the timer *only*, never to reject. Strictly tighter than today, no new refusal path, and it makes
  the generosity exactly zero instead of merely small. Small, and immaterial at present scales — the
  cap is seconds, the slip is milliseconds — so it is filed rather than urgent.
  **Independently rediscovered 2026-08-01 during the OAI-25 ladder**, by a `review-lean` verifier that
  had run the mutation itself, which is worth recording because it also states the coverage boundary
  precisely: a `postChat` that re-armed *from the carried `budget.totalMs` duration* rather than
  re-deriving from `expiresAt` would pass both new `cap-ordering.test.js` tests **and** the
  `occurrences(post, 'capBudgets(') === 0` structural guard. That is not a hole in those guards —
  re-arming from the already-checked value does not reopen the OAI-22 window, and none of them ever
  claimed to cover it — but it means **this item's window is guarded by nothing at all**, so if it is
  ever done, it needs its own test rather than an assumption that the OAI-25 pair reaches it.

### OAI-39 — parked, `not worth doing`

**Why parked:** No instance. All five loose reads are reachable only by values today's callers do not produce, and the fifth's own illustration is a constructed record — `{status: null, prefillMs: 7}` — that has never appeared in a ledger. The item itself classes them as *"unreachable by an audit of today's call sites"*, which is a statement about reachability, not about harm observed.

**Reopening bar (an instance, with a date):** A real attempt record or serialized run carrying one of the named values — a `"false"` string in `warmEligible`, an absent `outcome`, an empty-string `run.error`, a non-object thrown into `withLedger`, or a `{status: null, prefillMs: N}` — together with the bad statistic it produced, quoted, with the date.

*Filing kept verbatim:*

- **OAI-39** — **Five** reads that hold only because today's callers behave — four of them one-line
  fixes and the fifth deliberately not one. *(Header corrected 2026-08-05: it said "Four reads" while
  the body has always listed five, the fifth being the one carrying a "do not touch this the same
  way" warning — exactly the sub-item a stale count invites a reader to skip.)* Filed 2026-08-04 from
  OAI-35's passes 2 and 3, where `codex-plain` and `codex-adversarial` raised them and they were
  rejected **only** as out of that commit's scope — every one predates OAI-35 and none was introduced
  by it. They are one item because they are one shape: *unreachable by an audit of today's call
  sites, rather than unreachable by construction* — and OAI-35 twice found that exact reasoning had
  quietly stopped being true, which is the whole reason they are worth the edit.
  1. **`attemptRows` counts `warmEligible` by truthiness** — `bench/lib/attempt-rows.mjs`,
     `all.filter(({ attempt }) => attempt.warmEligible)`. Any truthy value counts, the string
     `"false"` being the memorable one. Every sibling split in that function was tightened to a
     strict check during OAI-35; this one was missed.
  2. **`unresolved` tests `outcome === null` only** — same file. A serialized record that omits
     `outcome` carries `undefined`, so it increments `total` while landing in none of `answered`,
     `failed`, `refused` or `unresolved`. The totals then disagree with themselves, which is
     precisely the bug that bucket exists to make visible.
  3. **`runTotals` tests `run.error` for truthiness** — `bench/lib/reliability-report.mjs`. A failed
     run whose message is the empty string is reported as having completed, in the one line that
     states both denominators.
  4. **`withLedger` assumes the thrown value takes a property** — `scripts/lib/attempt-ledger.mjs`.
     `error.attemptRecords = ledger.entries()` on a thrown string or a frozen object throws a
     `TypeError` from strict-mode ESM, replacing the original failure with a confusing one at the
     exact moment the ledger was trying to preserve evidence about it.
  Each is a one-line fix plus a test that the bad value does not count — matching what
  `responseBucket` now does beside (1).
  **5. `reachedTheModel` reads `error?.status !== undefined` too — and this one is NOT a
  one-line fix. Read this before touching it.** It is the same loose check, in
  `scripts/lib/attempt-outcome.mjs`, sitting directly above the `obtainedResponse` that OAI-35
  tightened — so whoever does 1–4 will see the asymmetry and be tempted. The difference is the
  failure DIRECTION. A `status: null` makes it return `false` early, skipping the completion-shape
  and prefill checks below, so an attempt is left NOT warm-eligible. That under-marks, and ADR 012
  records under-marking as the deliberately chosen lesser evil: over-marking deletes a real cold
  prefill measurement with no trace, while under-marking quotes a possibly-warm figure beside a
  caveat that says so — only the second is visible to a reader. So the current looseness fails
  safe, which is why OAI-35's pass 3 rejected changing it and why it is recorded here rather than
  fixed. It is still wrong in one case worth naming: `{status: null, prefillMs: 7}` had a prefill
  measured, so the prompt WAS reached and a repeat could be served warm, and the early return says
  otherwise. Any fix must preserve the conservative direction — tighten the type check without
  letting a genuinely absent status fall through to a `true` it has not earned — and must come with
  a test asserting the cold-prefill column does not gain entries it never measured.

### OAI-40 — parked, `not worth doing`

**Why parked:** No instance. Both named tests overclaim — `tests/bench-reliability.test.js`'s "exactly one attempt answers, and it is the one the headline timings came from" asserts neither half of its title, and `tests/bench-reason-notes.test.js`'s "shape-rejected is explained as the terminal twin of refused" makes two of three assertions document-wide — but no regression has ever been observed reaching a commit past either of them.

**Reopening bar (an instance, with a date):** A real defect that lands because one of those two tests stayed green — a prefill regression where the headline timing and the answering attempt diverge, or a gutted `shape-rejected` paragraph. Record the commit and the date.

*Filing kept verbatim:*

- **OAI-40** — Two pre-existing tests that do not prove what they are named for. Filed 2026-08-04 from
  OAI-35's passes 2 and 3 (`codex-plain` both times), rejected there as out of scope. This is the
  class OAI-35 added to `.claude/REPO_TRAPS.md` — *a test that manufactures or sidesteps the evidence
  it claims to guard* — found in tests that predate it, so the entry earns its keep immediately.
  1. **`exactly one attempt answers, and it is the one the headline timings came from`**
     (`tests/bench-reliability.test.js`) asserts **neither** claim in its title. `answeringAttempt` is
     a `.find`, so a second answered attempt passes; and it checks the attempt's `prefillMs` against a
     literal rather than against `run.report.prefillMs`, so it never shows the two share a source.
     Both halves matter — the second is what makes the cold-prefill exclusion meaningful.
  2. **`shape-rejected is explained as the terminal twin of refused`**
     (`tests/bench-reason-notes.test.js`) scopes its first assertion with `paragraphAbout` and then
     makes its other two document-wide. The comment directly above explains why that is worthless —
     the document-wide version passed on a count-table row, "proved by gutting the whole paragraph and
     watching it stay green" — and then two of three assertions are document-wide anyway. Route them
     through `paragraphAbout` and re-run the gutting mutation the comment describes.
  Both fixes are small; the value is that each one currently reports coverage it does not have.

### OAI-46 — parked, `not worth doing`

**Why parked:** No instance. This is a process finding from OAI-34's terminal review round: `tests/ttl-vocabulary.test.js:99` pins the `Accepted verdicts:` line in `BACKLOG_DONE.md` and nothing else, and the contradictory acceptance clause that demonstrated the gap was staged by the reviewer, not shipped. The guard's narrow scope is now honestly described, which is the half that was fixed.

**Reopening bar (an instance, with a date):** A contradictory verdict-acceptance clause is committed to a TTL-challenge entry, the suite stays green, and a non-conclusive run is subsequently read as complete. Record the clause, the commit and the date.

*Filing kept verbatim:*

- **OAI-46** — The tracker-consistency guard pins one line, and its prose now says so — decide whether
  that is enough. **Filed from OAI-34's terminal review round, which demonstrated the gap rather than
  argued it.** `tests/ttl-vocabulary.test.js:99` reads the `Accepted verdicts:` line and compares
  it set-wise against `CONCLUSIVE`, which the driver's exit code imports. That pins **that line**.
  *(Corrected 2026-08-13 by the sweep: it reads **`BACKLOG_DONE.md`**, where that line actually lives
  (`:919`), not this file — this entry only describes it. The mechanism and the gap are unchanged.)*
  The reviewer added a contradictory acceptance clause elsewhere in the OAI-34 entry and the suite
  stayed green.
  The claim was corrected rather than the guard — an overclaim about a guard is worse than a narrow
  guard honestly described, and OAI-34 was already four review rounds deep. But the honest description
  is not the same as adequate: a future edit can still mark a non-conclusive run complete under a
  green suite, which is exactly the drift the guard was added to stop.
  Options, cheapest first: **(a)** accept it, since the canonical line is where a reader looks and the
  prose no longer claims more; **(b)** assert the entry contains no *other* verdict-acceptance
  phrasing, which needs a rule for what that looks like and risks false failures on ordinary prose;
  **(c)** move the done-condition out of prose entirely into a small machine-readable block the tracker
  renders from. **(c) is the only one that actually closes it**, and it is a change to how this repo
  writes backlog items, not to one item — which is why this is a decision and not a fix.

### OAI-48 — parked, `not worth doing`

**Why parked:** No instance. This is a construction argument that Codex broke — correctly — but no ledger entry has ever been observed recording a wrong served-model identity. The item states its own boundary: the ordinary cause of substitution is requesting an id the server does not have, and both arms' ids were served, so *"the run states the limit rather than pretending to check it"*.

**Reopening bar (an instance, with a date):** An attempt ledger entry observed recording an answer from a model other than the one requested, with no served id captured — the `stream-unfinished` / `empty-completion` / `blank-completion` path the item describes. Quote the entry, the run and the date.

*Filing kept verbatim:*

- **OAI-48** — The attempt ledger records no *served* model identity, so a substituted attempt that
  was later superseded leaves no trace. **Filed 2026-08-04 from OAI-19's gate grill, where Codex
  broke a construction argument I had written to declare the hole unreachable.** The argument was:
  substitution means the server *answered*, an answered attempt ends the run, therefore no retry can
  wash it away. It is wrong on one path. `applyFrame` sets `answer.model` from each streamed frame
  (`completion.mjs:65`), so a served identity can be observed *before* the reply is usable; a stream
  that ends unterminated then throws `stream-unfinished` (`completion.mjs:98`), which
  `answerWithRetry` retries (`answer-attempts.mjs:111`); the ledger entry keeps timings and outcome
  but no served id (`attempt-ledger.mjs:56`); and only the final report reaches the run-level
  substitution check (`bench/lib/outcome.mjs:84`). `empty-completion` and `blank-completion` have the
  same shape. So a wrong-model partial answer followed by a right-model retry is recorded as clean.
  Fix: carry `requestedModel`, the observed served id, and an explicit **"identity not observed"**
  state on every attempt entry — the third is load-bearing, since a pre-response failure genuinely
  has no id and must not read as agreement. Not gated in OAI-19's run: the ordinary cause of
  substitution is requesting an id the server does not have, and both arms' ids are served here — so
  the run states the limit rather than pretending to check it.

### OAI-53 — parked, `not worth doing`

**Why parked:** Not a defect: a deliberate deferral. The item's own text — *"Deferred deliberately in OAI-3, not forgotten"* — and no user has been observed blocked by the absence of `/oai:review --background`. The blocker it names (a review needs an outcome object before it can be persisted) is design work nobody has needed yet.

**Reopening bar (an instance, with a date):** A `/oai:review` invocation a user actually needed to background — a foreground review long enough that they abandoned it, or that blocked a session they needed. Name the invocation and the date.

*Filing kept verbatim:*

- **OAI-53** — `/oai:review --background`. Deferred deliberately in OAI-3, not forgotten: `kind` and
  `schema_version` are in the schema so this fits without a migration, and the worker already runs the
  foreground executor rather than a copy of it. **The blocker is what gets persisted.** A review's
  canonical result is its findings, and today `/oai:review` renders them on the way out; persisting
  the rendering would leave `/oai:result` unable to reconstruct the one distinction that matters —
  `findings: null` (the reply was unparseable) against `[]` (a clean pass), which is trap instance 14
  in `.claude/REPO_TRAPS.md` and the defect [ADR 003](adr/003-structured-findings.md) exists to
  prevent. So this item is really "give the review path an outcome object the way OAI-3 gave the task
  path one" — `task-execute.mjs`/`task-report.mjs` is the shape to copy — and the backgrounding is the
  easy half that follows.

### OAI-54 — parked, `not worth doing`

**Why parked:** No instance. A known design gap, recorded in ADR 014 at the time rather than discovered later: foreground `/oai:task` and `/oai:review` do not join the queue. No foreground run has been observed colliding with a background job on this server, and the item itself says the fix needs a design decision with the user first.

**Reopening bar (an instance, with a date):** A foreground `/oai:task` or `/oai:review` observed running concurrently with a background job on the same server, with the consequence recorded — a memory-ceiling breach against the noted `estimated_peak 25.10GiB` / `safe_ceiling 25.08GiB`, or a run that failed or degraded because of it — and the date.

*Filing kept verbatim:*

- **OAI-54** — Foreground `/oai:task` and `/oai:review` do not join the queue, so the invariant OAI-3
  ships is honestly "one **background** job at a time". A foreground run started while a background
  job is mid-flight puts two model calls on one server, which is the case the queue exists to prevent
  and the memory ceiling makes expensive (`estimated_peak 25.10GiB` against `safe_ceiling 25.08GiB`).
  Recorded as a known gap in [ADR 014](adr/014-async-jobs.md) rather than discovered later.
  **The design question this needs answering first, and the reason it is not a small change:** a
  foreground command that waits its turn is a foreground command that hangs with no output, which is
  a worse experience than the overlap it prevents. Options are to wait with progress on stderr, to
  refuse with the blocking job named, or to make `--max-wait` mean something in the foreground too.
  Decide that with the user before building it.

### OAI-60 — parked, `not worth doing`

**Why parked:** No instance. `RETAIN` and the two literals agree today: `commands/status.md:56` and `commands/result.md:36` both say 50, which is the constant. The harm is entirely conditional on a change nobody has made.

**Reopening bar (an instance, with a date):** `RETAIN` changes and a command markdown is caught still stating the old number. Record the commit that changed the constant, the stale file, and the date.

*Filing kept verbatim:*

- **OAI-60** — The retention ceiling is a constant in one place and a **literal `50` in prose** in
  `commands/status.md:56` and `commands/result.md:36`. `cmd-result.mjs` interpolates `RETAIN` into its
  hint correctly, so changing the constant leaves the code truthful and the two command markdowns
  quietly wrong — and command markdown is precisely the surface CLAUDE.md notes "nothing else notices
  when it rots", which is why `tests/plugin.test.js` exists. It does not check this.
  Two lines of fix, and the feature skill's rule picks between them: one definition, or one guard.
  A guard is the cheaper of the two here — assert the rendered `RETAIN` appears in both files —
  because the alternative is generating prose from a constant, which is worse than the problem.

### OAI-68 — parked, `not worth doing`

**Why parked:** No instance. A structural argument about the two-version design on its own terms: `applySchema` (`job-store.mjs:120-125`) reads `PRAGMA user_version` once per open and a worker holds that handle for the life of the job. No mid-session schema bump against a live worker has ever been observed — this repo has run one build at a time throughout.

**Reopening bar (an instance, with a date):** A worker observed writing (`beat`, `claimJob` or `finish`) to a database whose `user_version` was raised by another build after that worker's handle opened. Record the two builds, the row and the date.

*Filing kept verbatim:*

- **OAI-68** — **`PRAGMA user_version` is checked only when a connection opens, so an in-flight worker
  bypasses the newer-database refusal.** `applySchema` (`job-store.mjs:120-125`) reads it once inside
  `openStore()`, and a worker holds that handle for the life of the job — minutes to the 3600s default
  cap. A newer build opening the same database in that window raises `user_version`; the old worker's
  later `beat`/`claimJob`/`finish` never recheck and write to a schema it does not understand. This is
  a hole in the two-version design **on its own terms**, since the stated rule is that a newer database
  is refused for all mutations. The fix (recheck under the same write lock) touches every mutation path
  and collides with whatever OAI-63 does to the persisted payload, so sequence it after that decision.

### OAI-73 — parked, `not worth doing`

**Why parked:** The item's own first sentence: *"None is a known defect."* Three uncovered paths — the v99 x NULL-waiter combination, `cmd-task-worker.mjs:92-97`'s lost-`registerWaiter` exit, and `job-liveness.mjs:87`'s `starting` branch — and no observed failure through any of them.

**Reopening bar (an instance, with a date):** One of the three fires in a real run and misbehaves: a late worker double-dispatching, an unknown-`schema_version` queued row with a NULL waiter going uncollected, or a `starting` row rendered wrongly. Record which path, the row and the date.

*Filing kept verbatim:*

- **OAI-73** — **Coverage the ladder found missing, beyond OAI-52's list.** None is a known defect.
  (a) an unknown-`schema_version` **queued** row with a **NULL waiter** — `queue-reconcile.test.js`
  covers the v1 NULL-waiter case and the v99 live/dead-waiter cases, never the v99 × NULL combination;
  (b) the late worker that loses `registerWaiter` and exits without dispatching
  (`cmd-task-worker.mjs:92-97`) — its stderr string appears nowhere in `tests/`, and it is the guard
  that stops a late worker double-dispatching; (c) the `starting` branch of `job-liveness.mjs:87`,
  which no test drives inside a paused publication/spawn window.
  Also recorded, not defects: `tests/job-store.test.js` and `tests/structure-jobs.test.js` (plan:435-436)
  were never created — their function was discharged by `queue-guards.test.js` and, at the time, the
  generic size ratchet (retired 2026-08-17 — see Tier 7); and the plan asked for the wall clock the new
  tests add, which was never reported (only the count).

### OAI-76 — parked, `not worth doing`

**Why parked:** No instance. `agents/oai-delegate.md:5` does grant bare `Bash` where `commands/task.md:5` scopes the same capability to `Bash(node:*)`, but no delegate run has been observed issuing a command outside its own recipe. **This is the paired half of OAI-74, which STAYS LIVE and carries the dated instance** — the two are one decision viewed twice, and parking the containment-surface half does not park the boundary decision.

**Reopening bar (an instance, with a date):** A delegate run observed executing a command that a `Bash(node:*)` scope would have blocked. Quote the command, the run and the date.

*Filing kept verbatim:*

- **OAI-76** — **The delegate's `Bash` grant is unscoped, so the companion is not a chokepoint.**
  Filed 2026-08-05 at OAI-5's verdict point, where the Codex approver refused to treat this as
  shippable-by-statement and was right: `agents/oai-delegate.md:5` grants bare `Bash`, while
  `commands/task.md:5` scopes the identical capability to `Bash(node:*)`. So every boundary OAI-74
  would add inside `prompt.mjs` is bypassable with one `curl`, and the agent's threat model — which
  explicitly treats repository contents as untrusted — depends on the agent not doing that.
  **Why it was not simply fixed:** `Bash(node:*)` is incompatible with the recipe as designed, which
  must be one shell invocation (shell state does not survive between `Bash` calls) and needs `mktemp`,
  `awk`, `sleep` and `trap` inside it. The options are a narrower allowlist covering exactly those
  commands, splitting the recipe and paying a different correctness cost, or moving the lifecycle into
  a companion subcommand so the agent's only verb is `node`. **The third is probably right** and is
  the same shape as OAI-74's "locked-down delegate mode" — decide them together.

### OAI-79 — parked, `not worth doing`

**Why parked:** Deliberately unfixed, and possibly moot. The item ships its own reason: five consecutive fixes in that six-line block each introduced the next pass's defect, so a sixth edit was judged likelier to add one than remove one, and both approvers accepted that. The tier index says outright that **OAI-79 may never be worked at all** — all three edges are deleted by moving the delegate lifecycle out of agent shell (OAI-74 with OAI-76, and OAI-76 is parked in this same sweep). All three fail closed; none has been observed firing.

**Reopening bar (an instance, with a date):** An observed delegate run where one of the three fires: `root=$(canon "$root")` clobbering the path out of its own `refusing: cannot resolve` message, `root=/` refusing every attachment, or `realpathSync("")` returning the cwd once a guard moved. Record the session, the symptom and the date.

*Filing kept verbatim:*

- **OAI-79** — **Three remaining sharp edges in the delegate recipe, all fail-closed, deliberately not
  fixed in OAI-5.** Filed 2026-08-05 from the ladder's terminal pass, where the reason they ship
  stated is itself the finding: five consecutive fixes in that same six-line block each introduced the
  next pass's defect, so a sixth edit was judged likelier to add one than remove one. Both approvers
  accepted that. Do these when the block is next opened for another reason — ideally when the
  lifecycle moves out of agent shell entirely (OAI-74 with OAI-76), which deletes all three.
  **(a) The root canonicalisation clobbers its own diagnostic.** `root=$(canon "$root")` assigns
  before the `||` runs, so on failure `root` is already the empty stdout and the message prints
  `refusing: cannot resolve ` with the path gone; node's stack carries no path either. The refusal is
  then global and permanent for that checkout while the agent text says "do not remove that check to
  make a request work". Two lines: capture `rawroot` first, canonicalise into `root`, name `$rawroot`
  in the message. Reachable only when a directory *above* the repository holds a control character.
  **(b) `root=/` refuses every attachment.** The pattern becomes `//*`, which matches no ordinary
  absolute path in bash or zsh, so a session at `/` outside a git repository can attach nothing. Fails
  closed; handle the filesystem root as its own case.
  **(c) `realpathSync("")` returns the cwd rather than throwing**, which is fail-*open* in direction.
  Masked today at both call sites — `[ -n "$f" ] || continue` for attachments, and root is either the
  git top level or `$PWD` — so it is latent, not live. It stops being masked the moment either guard
  moves, which is exactly the kind of change (a) invites.

### OAI-80 — parked, `not worth doing`

**Why parked:** No instance. Both halves are hypothetical: (a) needs an in-tree filename containing `, ` or ` (0 B` to forge or mask an entry in the `attachments` line, and (b) needs a server emitting misleading text into `assertOk`'s 400-character window. Neither has been observed, and the item itself notes neither is disclosure — both are *"strictly smaller than the model reply `/oai:result` already prints"*.

**Reopening bar (an instance, with a date):** An `attachments` line observed to have forged or masked an entry because of a filename, or a failure note whose embedded server-controlled text a reader acted on as diagnosis. Quote the line or the note, and the date.

*Filing kept verbatim:*

- **OAI-80** — **The delegate's own report can be forged or degraded by content it does not control.**
  Filed 2026-08-05 from the ladder's pass-6 and pass-8 security lenses. Neither is disclosure —
  containment is untouched and both are strictly smaller than the model reply `/oai:result` already
  prints — but both undermine the *reporting* contract the agent is judged on.
  **(a) The `attachments` line is ambiguous by construction.** `job-render.mjs:249` *(line moved;
  verified again 2026-08-17)* joins entries as
  `path (N B)` with `, `, and the agent is told to take its file list from that line precisely because
  it is what the job recorded. An in-tree filename containing `, ` or ` (0 B` can therefore forge an
  extra entry or mask a real one in the list reported upward. The fix belongs with OAI-57's `--json`,
  where the list is an array and the question does not arise.
  **(b) The failure note carries up to 400 characters of server-controlled text.** `assertOk` embeds
  the response body, the recipe now prints the status detail, and the agent is told to quote the note
  when a job failed — so an untrusted server's text reaches the transcript as something the agent is
  instructed to repeat. Bound it, or mark it as quoted foreign text rather than diagnosis.

### OAI-81 — parked, `not worth doing`

**Why parked:** No instance beyond the design's own accepted terms. `persistRequest` freezing `request.messages` is *why* editing a file after submission cannot change what the model was asked — the item says so — and no mis-selected attachment has been observed persisting in `jobs.db` to any concrete cost. The protection it rests on (`0600`/`0700`, unconditionally repaired) shipped with OAI-65 on 2026-08-18.

**Reopening bar (an instance, with a date):** An attachment observed in a retained job row that the submitter did not intend to persist and where the retention mattered — a credential, or a file whose retention broke a commitment. Record the seq, what was retained and the date.

*Filing kept verbatim:*

- **OAI-81** — **A submitted attachment leaves a durable plaintext copy outside the file it came
  from.** Filed 2026-08-05. `persistRequest` freezes `request.messages` — which contains every
  attached file's full text — into the job row, and `job-retention.mjs` keeps the newest 50 finished
  jobs. So one mis-selected attachment persists in `jobs.db` until fifty jobs later, **even on a
  localhost-only deployment where nothing ever left the machine**, in state the user does not think of
  as holding file contents and which is itself a valid future attachment target. This is a
  consequence of OAI-3's snapshot-at-submission design (that snapshot is *why* editing a file after
  submission cannot change what the model was asked), so the fix is not "stop storing it" — it is to
  decide whether the row should hold the text or a digest plus a reference, and what `/oai:result`
  then replays. Interacts with OAI-65's `0600`/WAL work: the protection those items argue about is the
  protection this content is resting on.

### OAI-87 — parked, `not worth doing`

**Why parked:** Deliberately not started, at a cost the user owns. The item's own text: ***"Not started because it spends the user's tokens per case per arm — it is the one item here whose cost is theirs rather than the machine's, so it is launched when they say so."*** Nothing currently misreports: `MARKER_LIMITS`, ADR 017 and the report itself all state that a marker profile is evidence quality and not Stage 2's economic gate.

**Reopening bar (an instance, with a date):** The user asks for the paired arm, OR `bench/task-run.mjs`'s marker numbers are observed being read as the Stage 2 economic gate by someone who then acted on them. Record the citation and the date.

*Filing kept verbatim:*

- **OAI-87** — **Stage 2's gate is unmeasured, and a marker score is not it.** Filed 2026-08-06.
  `plans/local-llms-like-codex.md` Stage 2 asks whether "the artifacts are useful often enough that
  Claude verifying them costs less than Claude doing the work" — an **economic** claim.
  `bench/task-run.mjs` answers a different question: did the local model emit evidence a case declared
  in advance. Both `MARKER_LIMITS` and [ADR 017](adr/017-measuring-a-task-not-a-review.md) say so, and
  the report prints it, so nothing currently misreports — **the gate is simply not measured.**
  **What would measure it**, settled with Codex and recorded in
  [`plans/stage-2-open-questions.md`](plans/stage-2-open-questions.md) E4: a **paired arm**. An
  assisted run where Claude verifies the artifact against the case's fixture, and a control run where
  Claude gets the identical files and question with no artifact and does the work. Both must satisfy
  the case oracle; record Claude's tokens, elapsed time and whether the conclusion was right. Two
  riders that are the whole point: if Claude rejects the artifact and redoes the work, assisted cost is
  **verification plus redo**; and if Claude **accepts a wrong artifact that is a gate FAILURE**, not
  cheap verification.
  **Not started because it spends the user's tokens per case per arm** — it is the one item here whose
  cost is theirs rather than the machine's, so it is launched when they say so.

### OAI-88 — parked, `not worth doing`

**Why parked:** A stated limitation, not a defect. `bench/task-cases/prototype-lookup` is the whole corpus, this file's own standing methodology note already says N=1 per arm is a lottery ticket, and the harness prints the caveat. No number from it has been observed misleading anyone.

**Reopening bar (an instance, with a date):** A second task case is actually added to `bench/task-cases/` (which closes this outright), or an n=1 task-corpus number is observed being cited as a rate and acted on. Record the citation and the date.

*Filing kept verbatim:*

- **OAI-88** — **The task corpus has ONE case, so every number it produces is n=1.** Filed 2026-08-06.
  `bench/task-cases/prototype-lookup` is the whole corpus. This file's own standing methodology note
  says N=1 per arm is a lottery ticket, and that applies to the instrument as much as to the runs.
  **The next case is already specified and cheap**: the zsh word-splitting defect from OAI-83, whose
  executable witness is a loop comparing argv across `sh`, `dash`, `bash` and `zsh` — the exact script
  that found it. A third could be the render-scope artifact defect from the Stage 2 ladder.
  **The bar a case must clear** is in `bench/lib/task-corpus.mjs`: `before/` and `after/` trees, a
  witness that FAILS on the first and PASSES on the second, and no prompt containing a marker it will
  be scored on.

### OAI-91 — parked, `not worth doing`

**Why parked:** No instance. A design gap recorded in `adr/018` at the time and deliberately scoped: `submitTask`'s notice is about STORAGE because a draft claiming transmission was false whenever `readFileBlocks` threw first. No user has been observed surprised that foreground `/oai:task`, `/oai:review` or `/oai:setup` transmitted a query-string credential unwarned.

**Reopening bar (an instance, with a date):** A user runs a foreground provider-touching command with a credential in `--base-url`'s query string and is observed surprised that it was transmitted with no notice. Record the command, the surprise and the date.

*Filing kept verbatim:*

- **OAI-91** — **A query-string credential is transmitted by every provider-touching command, and only
  background `/oai:task` says so.** `normalizeBaseUrl` keeps a base URL's query string verbatim, so
  `--base-url 'https://host/v1?api_key=SECRET'` sends that key on every request. `submitTask` warns,
  because the key also lands in the job row — but the notice is scoped to STORAGE, deliberately (see
  `adr/018`): a draft claimed transmission too and was false whenever `readFileBlocks` threw before a
  byte was sent. Foreground `/oai:task`, `/oai:review` and `/oai:setup`'s probe all transmit it and say
  nothing. Warning in one command and not the others is arbitrary, so the fix belongs where the URL is
  resolved, not where a job is submitted — probably `resolveProfile`, once, for every command.
  Found by the OAI-61 review ladder (pass 5) and scoped out of it rather than half-done.

### OAI-92 — parked, `not worth doing`

**Why parked:** No instance, and it requires a cooperating server. `assertOk` embeds up to 400 characters of a non-2xx body into persisted job state, but no proxy or gateway echoing `?api_key=…` back has been observed against this plugin. The item says as much — *"Requires a cooperating server, which is why it is filed rather than fixed inside OAI-61."*

**Reopening bar (an instance, with a date):** A real server's error body observed carrying a credential — or any foreign text a reader acted on as diagnosis — into the `failure` column and onto `/oai:status` or `/oai:result`. Quote the body and the date.

*Filing kept verbatim:*

- **OAI-92** — **`assertOk` embeds 400 characters of a server's error body into persisted job state.**
  `provider.mjs:96,99-105` *(lines moved; verified again 2026-08-17)* builds a non-2xx message from
  `readText(response, {limit: 400})`; that message
  reaches `errorReport` (`cmd-task-worker.mjs:117`), is written to the `failure` column, and is rendered
  by `/oai:status` (`job-render.mjs:80`) and `cmd-result.mjs`. A proxy or gateway that echoes the
  request URI in its 4xx page — nginx does — therefore writes `?api_key=…` into durable state and onto
  the screen. Requires a cooperating server, which is why it is filed rather than fixed inside OAI-61.
  Found by that feature's `security-review` stage.

### OAI-99 — parked, `not worth doing`

**Why parked:** No instance. Found by OAI-94's probe and confirmed by reading `provider.mjs`'s `assertOk`, which interpolates `response.headers.location` verbatim on any 3xx — but no redirect has been observed against this plugin at all, let alone a query-preserving one.

**Reopening bar (an instance, with a date):** A `Location` header observed carrying a credential onto one of the five surfaces the item names — stderr, the job log, the persisted `error` column, `/oai:status`, `/oai:result`. Quote the message and the date. (The `301`-answering witness the item specifies travels with the fix, not before the instance.)

*Filing kept verbatim:*

- **OAI-99** — **a query-preserving redirect puts the credential on five surfaces.** `provider.mjs`
  `assertOk` interpolates `response.headers.location` verbatim into a `UserError` on any 3xx. A server
  that redirects while preserving the query — the ordinary shape for a gateway moving `/v1` — echoes
  `?api_key=…` straight back, and that message reaches stderr, the job log, the persisted `error`
  column, `/oai:status` and `/oai:result`. Sibling to OAI-92, which is the same module doing the same
  thing with a 4xx body rather than a header. Found by OAI-94's probe and confirmed by reading the
  code; filed rather than folded in because it is a distinct output path with its own redaction
  semantics, and OAI-94's notice is safe and true without it.
  **A required test travels with this item, and it is the reason the item exists rather than a note:**
  OAI-94's backlog entry asked for a witness answering `301` with `location: <the full request URI>`
  and asserting the credential does not appear in the resulting message. That witness had no subject
  in OAI-94 — it exercises `provider.mjs`, which that change deliberately did not touch — so it was
  neither written nor silently dropped. Whoever fixes this writes it.

### OAI-100 — parked, `not worth doing`

**Why parked:** No instance. Found by OAI-94's compensating security lens and verified by reading the three call sites — `describeFailure` interpolates `profile.baseUrl` at `:64` (connection refused), `:69` (DNS failure) and `:74` (generic transport) — but no path-embedded credential has been observed reaching stderr in a real run.

**Reopening bar (an instance, with a date):** A credential observed on stderr from one of those three sites. Quote the message, name which of the three produced it, and the date.

*Filing kept verbatim:*

- **OAI-100** — **a path credential reaches stderr on any failed request.** `provider.mjs`
  `describeFailure` interpolates `profile.baseUrl` into three messages — connection refused (`:64`),
  DNS failure (`:69`) and the generic transport wording (`:74`). `normalizeBaseUrl` keeps a credential
  sitting in the URL **path** inside `baseUrl`, so `--base-url https://host/v1/sk-live-…` discloses it
  the moment the server is unreachable. It fires inside `prepareTask`, which OAI-94's notice now runs
  before — so the caller is warned that the endpoint will be persisted and then has the credential
  disclosed to stderr anyway, by a different code path that says nothing. Found by OAI-94's
  compensating security lens — that feature's `security-review` stage could not launch at all, SEVEN
  deterministic failures across seven passes, and the cause is now confirmed structural rather than
  flaky: the stage is a built-in command whose own frontmatter interpolates `git diff --name-only
  origin/HEAD...` before reading its argument, and this repo has no git remote — so the lens stood in for it — and verified by
  reading the three call sites.

### OAI-101 — parked, `not worth doing`

**Why parked:** No dated instance. `job-render.mjs` renders `provider` as `${transport.name} → ${transport.baseUrl}` and the row holds the effective endpoint by design (`adr/014`), so a path-form credential would display — but none has ever been observed on a `/oai:status` listing.

**Reopening bar (an instance, with a date):** A `/oai:status` listing observed printing a path-embedded credential on its provider line. Quote the line and the date.

*Filing kept verbatim:*

- **OAI-101** — **`/oai:status` prints the persisted endpoint, path credential included.**
  `job-render.mjs:243` *(line moved; verified again 2026-08-17)* renders `provider` as
  `${transport.name} → ${transport.baseUrl}`. The row holds
  the effective endpoint by design (a worker rebuilding from the provider name alone would call
  somewhere submission never validated — `adr/014`), so a credential in the path is displayed by an
  ordinary status check, and the delegate agent captures that output. The query string is not shown
  here, which is why this is separate from OAI-91: the disclosure is specific to the path form. Fix is
  a render-time redaction, not a change to what is stored.

### OAI-103 — parked, `not worth doing`

**Why parked:** No dated instance. `--background --json` returns a job id and routes `templateNotes` to stderr only, so a stdout-parsing consumer never sees them — but no consumer, including this repo's own delegate agent, has been observed reading a crowded reply as a clean one.

**Reopening bar (an instance, with a date):** A consumer — the delegate agent or any harness — observed treating a `--background --json` submission as caveat-free and acting wrongly on it. Record the consumer, the missed note and the date.

*Filing kept verbatim:*

- **OAI-103** — **`--json` omits the caveats the human-readable reply prints.** `/oai:task --json`
  carries `templateNotes` as an array precisely so a harness cannot read a crowded reply as a clean
  one (ADR 016). The `--background` submission path does not: it returns a job id, and the notes a
  foreground run would have printed — including the endpoint-persistence notice ADR 019 added — reach
  stderr only, where a `--json` consumer parsing stdout never sees them. So the machine-readable form
  is quieter than the human one about exactly the things a machine should not silently drop. Found
  during OAI-94's ladder and filed rather than folded in, because the fix is a payload decision that
  collides with OAI-57's, not a change to the notice.

### OAI-105 — parked, `not worth doing`

**Why parked:** No instance. The exclusion at `job-busy.mjs:64-70` rests on an argument rather than a witness, and the item is right that the argument is untested in both halves — but `job-reconcile.mjs`'s five unprotected writes (recounted against disk 2026-08-14, unchanged at this sweep) have never been observed losing a `SQLITE_BUSY` to any visible cost.

**Reopening bar (an instance, with a date):** A row observed sitting uncollected because a reconciliation write lost a `SQLITE_BUSY` and no later read arrived to redo it. Record the row, its state, how long it sat, and the date.

*Filing kept verbatim:*

- **OAI-105** — **the reconciliation writes have no contention answer, only an argument.**
  `job-busy.mjs:64-70` (the exclusion now lives here, not in the deleted `adr/020` — see OAI-110)
  retries seven sites with `withBusyRetry`, skips five more with a bare `isBusy` catch, and
  deliberately leaves `job-reconcile.mjs`'s **five (recounted against disk 2026-08-14, unchanged at
  the current sweep)** writes unprotected, on the reasoning that the sweep re-runs on the next read so a
  `SQLITE_BUSY` costs one deferred reconciliation rather than a lost fact. That reasoning is untested in
  both halves: nothing bounds how long the deferral can last under sustained contention, and nothing
  establishes that a later read always arrives — a database whose only reader has stopped running
  leaves a `worker-died` row uncollected indefinitely (`job-view.mjs:6-9`: *"a job whose worker died
  sits `running` until something looks, and forever if nothing ever does"*). Raised in OAI-62's review
  ladder and filed rather than fixed there, because widening that change to a fifth subsystem is how a
  batch stops converging. The fix is either a witness that drives a busy through a reconciliation sweep
  and proves the next read corrects it, or a `withBusyRetry` at those five writes and the deletion of
  the exclusion from `job-busy.mjs:64-70`. Do not leave the exclusion standing on reasoning alone.

### OAI-109 — parked, `not worth doing`

**Why parked:** The hole is argued unreachable by the item itself, and the argument holds: `outcomeOf` builds only strings, numbers, nulls, `artifactFor`'s `{state, detail}` of string literals, and `result.usage` — parsed from a JSON response and acyclic by construction — so no cycle and no BigInt can reach `JSON.stringify`. *"That hole is unreachable today."* No answer has ever been lost this way.

**Reopening bar (an instance, with a date):** A field is added that can make `outcomeOf`'s value unserialisable, or `salvageOutcome`'s / `publishFailure`'s inner stderr write is observed failing, and an answer is lost as a result. Record the commit or the run, and the date.

*Filing kept verbatim:*

- **OAI-109** — **the rescue's own guard is unwitnessed, and one narrow hole inside it is real.**
  `salvageOutcome` guards its stderr write, and if `JSON.stringify` throws it writes a
  "could not be written" line instead — at which point **the answer is lost**, which is the exact
  outcome the rescue exists to prevent. That hole is unreachable today, and the reason is worth
  keeping: `outcomeOf` builds only strings, numbers, nulls, `artifactFor`'s `{state, detail}` of
  string literals, and `result.usage`, which came from a parsed JSON response and is acyclic by
  construction — so no cycle and no BigInt can reach it. **A future field could open it**, and
  nothing would notice, because neither the serialisation-failure path nor the log-write-failure path
  has a witness. **CORRECTED 2026-08-17 by the sweep**: this item originally claimed
  `publishFailure`'s structurally identical guard (`cmd-task-worker.mjs:139-146`) already had one, in
  `tests/job-busy-diagnosis.test.js` — checked against disk and that is not what those tests witness.
  Both tests there inject a row-write failure and assert on the rejection that escapes
  `runTaskWorker`, which exercises `publishFailure`'s *outer* catch, not its inner `stderr.write`
  guard. That inner guard is exactly as unwitnessed as `salvageOutcome`'s, so the ask below applies to
  both, not just to this one. Two things to do, and they are separable: witness both paths — both
  guards, not one — and serialise before entering the terminal-write path so a serialisation fault is
  discovered while the row write is still available. Raised at high confidence by `codex-adversarial`
  in OAI-62's terminal pass. Related: [OAI-106].

### OAI-123 — parked, `not worth doing`

**Why parked:** No instance. Stated-untested at pass 1 of the review-sweep ladder and never fired since: `resolveDeadline` compares against `Date.now()`, so a wall-clock step could move it, but no sweep has been observed ending at the wrong time. The DST case that WAS observed is already fixed.

**Reopening bar (an instance, with a date):** A sweep observed stopping at the wrong time across an NTP correction or a manual clock change. Record the `--until`/`--minutes` given, the actual stop time, the clock adjustment and the date.

*Filing kept verbatim:*

- **OAI-123** — **The sweep's deadline has no monotonic guard.** Filed 2026-08-08 from the
  review-sweep ladder, stated-untested at pass 1 and never fixed. `resolveDeadline` now advances the
  local calendar date correctly across DST, but the deadline is compared with `Date.now()`, so a
  wall-clock step (NTP correction, manual change) moves it. Deliberately **not** fixed in-ladder:
  replacing the clock is larger than the batch it arose in, and a step is far rarer than the DST
  boundary that was fixed. `job-busy.mjs` uses `performance.now()` for exactly this reason.

### OAI-127 — parked, `not worth doing`

**Why parked:** No instance. `serverUnwell`'s hardcoded `idle-timeout` set and `http-errors.mjs`'s per-budget hints agree today; the harm is entirely conditional on a sixth timeout reason that has never been added. The item's own framing is that the record *promises something the code cannot keep*, not that the code is currently wrong.

**Reopening bar (an instance, with a date):** A new timeout reason ships in `http-errors.mjs` and is silently excluded from `serverUnwell`'s set (or `idle`'s meaning changes underneath it) and a sweep verdict is wrong as a result. Record the reason string, the commit and the date.

*Filing kept verbatim:*

- **OAI-127** — **The decision record states a SEMANTIC rule the code cannot enforce.** Filed
  2026-08-08, `unresolved at cap`. `adr/021` says a future timeout reason must be judged against the
  CLI's own per-budget hint — the discriminator that finally ended five iterations — while
  `serverUnwell` is a hardcoded `idle-timeout` string set that nothing derives from or checks against
  `http-errors.mjs`. A sixth reason whose hint said "raising it will not help" would be silently
  excluded; a semantic change to `idle` would silently persist. **This is OAI-122's class one level
  up**: there the record contradicted the code, here they agree today and the record promises
  something the code cannot keep. Writing the rule down was supposed to be the fix.

### OAI-130 — parked, `not worth doing`

**Why parked:** No dated instance, and the item says why: *"Low impact while every arm passes `--model` explicitly, which the benchmark does."* `reported()` omits `report.requestedModel`, but no artifact has been observed where that absence actually hid what a substitution was substituted for — and the fact remains in the raw JSON.

**Reopening bar (an instance, with a date):** An artifact observed reporting a substituted model where the missing `requestedModel` in `reported()` hid what it was substituted FOR, and a reader acted on it. Quote the artifact and the date.

*Filing kept verbatim:*

- **OAI-130** — **A successful substituted reply drops `requestedModel`.** Filed 2026-08-08,
  `unresolved at cap`. `reported()` carries the served `model` and five caveats but not
  `report.requestedModel`, so when a sweep ran on a provider default the artifact says a different
  model answered without saying which model it was substituted FOR. The fact is in the raw JSON and
  absent from the summary. Low impact while every arm passes `--model` explicitly, which the benchmark
  does.

### OAI-136 — parked, `not worth doing`

**Why parked:** No instance. The item is explicit that it was **verified by reading the function, not inferred** — `model-selection.mjs:224` returns before the embeddings check — and equally explicit that whether an explicit `--model` *should* be refused is **not obvious and needs its own grill**. No chat request has been observed sent to an embedder, and no refusal has been observed suggesting one out of `catalogueIds`.

**Reopening bar (an instance, with a date):** A `--model <an id typed `embeddings`>` request observed reaching a chat completion, or a refusal observed suggesting an embedder the very next call then rejects. Quote the invocation, the message and the date.

*Filing kept verbatim:*

- **OAI-136** — **`--model` bypasses the embedding-model rejection that `defaultModel` enforces, and
  three smaller inconsistencies around the same split.** Filed 2026-08-09 from the OAI-134 ladder's
  `codex-plain` stage. All four are **pre-existing**: OAI-134 changed two hint strings and a README
  paragraph, and touched none of this behaviour. Verified by reading the function, not inferred:
  `model-selection.mjs:224` is `if (explicitModel) return unservedProblem(explicitModel, described) ??
  { modelId: explicitModel };` — it returns **before** the embeddings check, which lives in the
  `defaultModel` branch alone.
  1. **The bypass itself.** `--model <an id typed `embeddings`>` is selected and a chat request is sent
     to it. The `defaultModel` path rejects exactly this case with a specific message; the explicit path
     has no equivalent. Whether it *should* is **not obvious and needs its own grill**: an explicit
     `--model` is the caller's instruction, and `planSelection` deliberately lets a named model outrank
     our inference (`chatCandidates` is a denylist for the same reason — the verification machine's chat
     model reports type `vlm`). The choice is between refusing, warning, and documenting.
  2. **`README.md:78` says "embedding models are never chosen", which (1) makes FALSE.** Pre-existing
     prose. It sits in the paragraph OAI-134 extended but is not a sentence OAI-134 wrote, so it was
     dispositioned out of scope rather than fixed in that batch — fixing it is `widening` under
     `adr/056` and belongs to whichever option (1) settles on, since the honest sentence depends on it.
  3. **`:98-101`** — embedders are filtered out of `described.models` when building the offered list,
     but the offered set also unions `catalogueIds`, which is **not** filtered. So a refusal can suggest
     an embedder that the very next call then rejects — the failure mode that comment exists to prevent,
     surviving through the other half of the union.
  4. **`:159-170`** — the "this provider offers no model that can answer a chat request" conclusion
     reads only `described.models`, while catalogue-only ids count as served in `unservedProblem`. So it
     can assert "every id it lists is an embedding model" while a catalogue chat model is namable.
  **(3) and (4) are the same shape as each other and probably one fix**: two lists are treated as one
  for membership and as one-and-a-half for enumeration. **(1) is the only one with user-visible wrong
  behaviour**; (2) is a claim that is currently false; (3) and (4) are advice that can be wrong.

### OAI-142 — parked, `not worth doing`

**Why parked:** A constructed case, never observed. The rung flip it needs — the whole-file rung rejected on `prepareLadder` call 1 and fitting on call 2 — has not occurred in any benchmark run or overnight sweep on record. The item is correct that the docstring's reasoning is refuted rather than incomplete, and correct that **disclosure is unaffected**, which is what keeps the consequence bounded.

**Reopening bar (an instance, with a date):** An observed run where the two sizing passes chose different rungs and the reply was truncated or token-exhausted at the window boundary as a result. Record the target, both reserves and the date.

*Filing kept verbatim:*

- **OAI-142** — **`unconstrainedLadder` sizes the reply schema from a rung the request may not send.**
  Filed 2026-08-12 by `codex-adversarial` (high, confidence 0.96) during OAI-139's review ladder, and
  **deliberately not fixed there** — it is pre-existing, `git diff` confirms OAI-139 never touched
  `unconstrainedLadder`, and the user classified it a widening.
  `prepareLadder` runs **twice**: call 1 sizes against `REVIEW_SCHEMA`, the longest instruction, and
  the schema is derived from that call's reserve; call 2 uses the shorter derived instruction and is
  the request actually sent. If the whole-file rung is **rejected on call 1 and fits on call 2**, the
  reserve SHRINKS between them, so the schema advertises an `analysis` ceiling the budget cannot pay
  for — token exhaustion or a truncated unparseable reply, precisely at the window boundary.
  **The docstring asserts this cannot happen** (`review-ladder.mjs`): *"the cap derived from it can
  only under-state the room available: wrong in the safe direction by a bounded amount"*. That holds
  only while the rung cannot flip, which is the case this finding constructs — so the ADR-grade
  reasoning is refuted, not merely incomplete.
  Disclosure is **unaffected**: the report reads call 2's `rung`/`skipped`, so the bodies sent and the
  note about them still agree.
  Fix per Codex: make rung selection stable across sizing passes, or iterate until rung and reserve
  converge, deriving the final schema from the reserve of the exact request that will be sent. Needs a
  test pinning a target ON the fit boundary, which is the part with no precedent here.

### OAI-144 — parked, `not worth doing`

**Why parked:** Filed as UNVERIFIABLE rather than as a finding, and still unverified. The `finishReason === 'length'` check was only MOVED (`review-report.mjs` to `review-unparsed.mjs`), never introduced or altered, and no vendor among LM Studio, llama.cpp, vLLM, TGI or oMLX has been confirmed sending a shape it mishandles.

**Reopening bar (an instance, with a date):** A vendor confirmed emitting a truncation signal that `finishReason === 'length'` does not catch, so a run that ran out of room read as a run that finished. Quote the response, name the vendor and version, and the date.

*Filing kept verbatim:*

- **OAI-144** — **`finishReason === 'length'` is treated as a vendor-uniform signal and nothing
  establishes that it is.** Filed 2026-08-12 by `lean-wide`'s vendor-assumption lens during OAI-139's
  ladder, as an UNVERIFIABLE rather than a finding: the check was only MOVED in that change
  (`review-report.mjs` to `review-unparsed.mjs`), never introduced or altered. This repo targets LM
  Studio, llama.cpp, vLLM, TGI and oMLX, and `tests/` holds no per-vendor fixture set enumerating
  `finish_reason` values across them, so whether the field is uniformly named and valued is assumed.
  The consequence if it is not: a truncated reply from one of them is not recognised as truncated, and
  a run that ran out of room reads as a run that finished. Cheap first step is a fixture set, not a
  code change.

### OAI-145 — parked, `not worth doing`

**Why parked:** No instance, and OAI-67 already contained every destructive consequence: `abandonUnstarted`'s `state = 'queued' AND waiter_pid IS NULL` compare-and-set makes both orderings safe, so no row is destroyed and no paid work is lost. What survives is a submission reporting failure while its worker completes — and no such billing has been observed. The user chose deliberately to separate this from OAI-67 rather than fix it there.

**Reopening bar (an instance, with a date):** A post-`'spawn'` throw in `job-spawn.mjs` (`:33-50`, the `closeSync(log)` in `finally`) observed orphaning a running worker while the submitter reported failure, with the user billed for an answer they were told did not start. Record the job, the cost and the date.

*Filing kept verbatim:*

- **OAI-145** — **`spawnWorker` can reject after the child is alive, so "the spawn failed" is a
  claim it cannot support.** Filed 2026-08-12 by `codex-adversarial` (0.94) during OAI-67's ladder;
  OAI-67 CONTAINED the harm rather than fixing this, by the user's decision, so this is the root fix
  and nothing depends on it. `job-spawn.mjs:33-50` awaits the `'spawn'` event and then runs
  `closeSync(log)` in a `finally`; a throw there (EIO, EBADF) rejects the promise while a detached
  worker is already running, and `child.unref()` never executes either. The caller cannot tell that
  rejection apart from "no child was ever created", because the contract does not distinguish them.
  **What OAI-67 did instead:** the submitter terminalizes with `abandonUnstarted`, whose
  `waiter_pid IS NULL` compare-and-set makes both orderings safe — so no row is destroyed and no paid
  work is lost. What survives is milder and real: a submission REPORTS FAILURE while its worker runs
  to completion, and the user is billed for an answer they were told did not start. The fix is to
  preserve the pid once the `'spawn'` event has fired and report a cleanup fault separately, which
  changes the contract of the one function in this repo that launches a process meant to outlive its
  parent — its own header says every line is load-bearing, which is why this is a feature and not a
  patch. Codex recommended doing it inside OAI-67; the user chose to separate it.

### OAI-149 — parked, `not worth doing`

**Why parked:** The item's own closing words: ***"Without it this is a story about a race."*** Its precondition — a recreated `jobs.db` beside a surviving `logs/`, which restarts the `AUTOINCREMENT` seq — has never been observed created, and the docstring and `adr/014` now state that precondition instead of asserting safety, which is the honest half that shipped.

**Reopening bar (an instance, with a date):** The interleaving reproduced with a witness — recreate the store, plant the residue, submit, and see a live job's files unlinked — or an operator hitting it in production. Record the seqs, the files lost and the date.

*Filing kept verbatim:*

- **OAI-149** — **the orphan sweep's safety argument holds only while sequences cannot be reused, and
  deleting `jobs.db` beside a surviving `logs/` reuses them.** Filed 2026-08-13 from OAI-66's review
  (`codex-adversarial`, finding 1). `job-retention.mjs` `orphanSeqs` lists the directory *before* it
  reads the rows, and that order is what makes an unlisted seq safely an orphan — but `seq` is
  `AUTOINCREMENT` **per database**, so a recreated store restarts it. Interleaving: sweep A lists a
  stale `2.cancel-ack`, reads rows holding no seq 2 and marks it orphaned; submission B inserts seq 2
  and opens `2.log`; sweep A resumes and unlinks **B's live files**.
  **The race predates OAI-66** — a surviving `<seq>.log` could always start it — and OAI-66's union
  scan widened which residues can. The docstring and `adr/014` now state the precondition instead of
  asserting safety, which is the honest half; this is the mechanism half.
  **The shape of the fix is binding the orphan key to a STORE INCARNATION** — a value minted when the
  database is created and carried in the filename or a sibling — so a file from a previous incarnation
  can never be attributed to a current seq. That is the schema change OAI-66's grill declined, which is
  why it is separate rather than folded in.
  **The bar for it being real:** a witness that reproduces the interleaving — recreate the store, plant
  the residue, submit, and prove the live job's files survive. Without it this is a story about a race.

### OAI-169 — parked, `not worth doing`

**Why parked:** The item argues its own failure mode is **not** silent, which is what disqualifies it from the silence exception: *"Deleting either shows as an intermittent stall landing on the deliberate `unexpected second request` handler, not as silent wrongness — which is what makes leaving it unpinned defensible rather than merely cheap."* No such stall has been observed, and the item also notes a held-lock fixture would pin the pair in a NEW test while leaving the call site itself deletable.

**Reopening bar (an instance, with a date):** A suite stall traced to `tests/abandon-salvage.test.js`'s `PRAGMA busy_timeout = 250` or its `withBusyRetry(…, { budgetMs: 2_000 })` having been changed or removed. Record the run, the wall clock lost and the date.

*Filing kept verbatim:*

- **OAI-169** — **`tests/abandon-salvage.test.js`'s `busy_timeout` and retry budget are unpinned:
  delete either and the suite stays green.** Filed 2026-08-15 from OAI-166.
  `db.exec('PRAGMA busy_timeout = 250')` and `withBusyRetry(…, { budgetMs: 2_000 })` exist because
  `openStore` hands back a handle carrying a 10s `busy_timeout` and `budgetMs` is a floor rather than
  a ceiling — left at defaults, one attempt can block ~10s and the whole retry ~40s, in the process
  that also HOSTS the fake server, against a worker whose own 30s first-byte clock runs elsewhere.
  Nothing exercises that contention, so nothing notices if either value is removed.
  **State the exposure accurately: not "untested" but "unpinned".** Deleting either shows as an
  intermittent stall landing on the deliberate `unexpected second request` handler, not as silent
  wrongness — which is what makes leaving it unpinned defensible rather than merely cheap. A held-lock
  fixture would pin the pair but would pin it in a NEW test, leaving the call site itself still
  deletable, so it does not answer the question it appears to.

### OAI-174 — parked, `not worth doing`

**Why parked:** Describes a withdrawn plan decision, not a defect that fired. It was planned inside OAI-162 and then WITHDRAWN by the user after approval, on the ground the item itself states: **the gap is discovery from the listing, not documentation and not the exit** — `commands/status.md`, `commands/abandon.md` and the command's own refusal all name `/oai:abandon --force`. No operator has been observed failing to find it.

**Reopening bar (an instance, with a date):** An operator observed hitting a malformed row in `/oai:status` and not finding the remedy — not knowing `/oai:abandon --force` existed, or trying it where it would be refused. Record the session and the date.

*Filing kept verbatim:*

- **OAI-174** — **The rendered status output never names the exit for a malformed row.** Filed
  2026-08-16 from OAI-162's build, where it was planned and then WITHDRAWN by the user after approval
  (recorded in that item's plan). `remedyFor` is gated on `liveness !== 'live'`, so no `/oai:status`
  note names a command for any malformed shape, and `malformedNote` deliberately names none either:
  the operator is told the row will not be collected and left to find `/oai:abandon --force`
  themselves. **The gap is discovery from the listing, not documentation and not the exit** — both
  `commands/status.md` and `commands/abandon.md` name the flag, and the abandon command's own refusal
  names it when run. It was cut because naming a command beside a row is only correct where the
  command would work, and that condition is a second rule the note would have to carry: a row whose
  own `schema_version` is too new, or any row in a database that is, is refused with no flag able to
  lift it. Worth doing only if status-output discoverability counts as product work.

### OAI-175 — parked, `not worth doing`

**Why parked:** A pure documentation gap, filed at the bar's edge and saying so in its own body: *"Borderline against the filing bar and said to be: it is one paragraph of documentation."* `commands/status.md`'s "Reading the states" list omits `starting`, which `livenessOf` answers for the ordinary submit-to-register window. No operator has been observed confused by it.

**Reopening bar (an instance, with a date):** An operator observed misreading a `starting` row — treating it as stuck, or as a state this build should not produce — because `commands/status.md` does not list it. Record the session and the date.

*Filing kept verbatim:*

- **OAI-175** — **`commands/status.md` never names the `starting` display state.** Filed 2026-08-16
  from OAI-162's review; verified pre-existing at HEAD. The "Reading the states" list covers `queued`,
  `running`, `stalled`, `overdue`, `cancelling`, `malformed` and the four terminal states.
  `livenessOf` also answers `starting` — the ordinary window between a row being committed and its
  worker registering, which every normal submission passes through, and which `blockingSeqFor` treats
  as positive evidence that a local job is waiting. Borderline against the filing bar and said to be:
  it is one paragraph of documentation, filed because the omission is in the document whose whole
  purpose is to enumerate the states.

### OAI-178 — parked, `not worth doing`

**Why parked:** No instance. An observation from OAI-165's review-ladder pass 2 (`agent-closer`), explicitly non-blocking and deferred at the time. A bad `--repo` does fail on `--from did not resolve to a commit`, but nobody has been observed sent looking at the wrong thing by it.

**Reopening bar (an instance, with a date):** A real `bench/review-sweep.mjs --repo <bad path>` invocation where the `--from` wording actually misdirected someone. Record the command, what they looked at instead, and the date.

*Filing kept verbatim:*

- **OAI-178** — **A nonexistent or non-git `--repo` path fails on a misleading `--from did not resolve
  to a commit` error, not a clear "bad repo" message.** Filed 2026-08-17 from OAI-165's review-ladder
  pass 2 (`agent-closer`), non-blocking, deferred at the time. `bench/review-sweep.mjs`'s `optionsFrom`
  validates `--repo` is non-empty and resolves it lexically, but never checks the path exists or is a
  git working tree before `main()` calls `resolvePin`/`enumerateCommits` against it — the first git
  command against a bad path fails with a message about the `--from` ref, which does not name the real
  problem. Small: a clearer message at the first `git` call's failure, or a preflight `git rev-parse
  --git-dir` check in `optionsFrom`.

### OAI-179 — parked, `not worth doing`

**Why parked:** The item's own words: ***"No observed or reachable defect today"*** — `main()` is the only real call site and always passes `execute: (args) => invoke(args, options.repo)`, and every test that omits `execute` passes its own stub. It was filed so a future caller does not rediscover it, which is a note rather than work.

**Reopening bar (an instance, with a date):** A `runSweep` caller lands that omits `execute` while passing a foreign `options.repo`, and a sweep is observed reviewing this repo instead of the target. Record the commit, the wasted run and the date.

*Filing kept verbatim:*

- **OAI-179** — **`bench/review-sweep.mjs`'s `runSweep` silently reviews this tool's own repo if called
  with no `execute` and a foreign `options.repo`.** Filed 2026-08-17, an observation from OAI-165's
  verdict-point review (round 4, independent Claude verdict). `runSweep(commits, options, { execute =
  invoke, ... })` defaults `execute` to the module's `invoke`, whose own default `cwd` is `ROOT` — so a
  caller passing `options.repo` but no `execute` would review at this tool's own root regardless.
  **Latent only**: `main()` is the only real call site and always passes `execute: (args) =>
  invoke(args, options.repo)`; every test that omits `execute` passes its own stub instead. No observed
  or reachable defect today — filed so a future caller of `runSweep` doesn't rediscover it.

### OAI-182 — parked, `not worth doing`

**Why parked:** The reviewer's own framing, quoted in the item: *"the operative claim stays true... outside this round's scope."* Two additive documentation completeness gaps found at OAI-172's verdict point and left open deliberately — both non-blocking, neither a correctness defect, and no operator has been observed misled by either.

**Reopening bar (an instance, with a date):** An operator observed misreading a `forced-malformed` outcome — taking `abandon.md`'s two-case `--force` enumeration as exhaustive, or hitting `cmd-abandon.mjs`'s distinct `running`-arm message (*"Nothing could be judged about its process... an overlap cannot be ruled out"*) with nothing in the docs describing it. Record the session and the date.

*Filing kept verbatim:*

- **OAI-182** — **`commands/abandon.md`'s stale-beat caveat bullet is non-exhaustive about which
  `--force` cases skip it, and a separate bullet never mentions the malformed-running case at all.**
  Filed 2026-08-17 from OAI-172's verdict-point review (round 2, independent Claude verdict subagent)
  — both non-blocking, both left open rather than folded into OAI-172's fix.
  (1) The bullet's enumeration of when `--force` is what actually did the work — a fresh beat, or a
  beat whose recency couldn't be checked — omits `forced-malformed` (`abandonDecision`'s `malformed`
  rung), a third case where `--force` also did the work and the caveat is likewise absent. The
  operative claim (the caveat is keyed on `reason === 'stale'`) stays true regardless, but a reader
  may take the two-case enumeration as exhaustive.
  (2) `cmd-abandon.mjs`'s `report()` has a distinct `forced-malformed` message in its `running` arm
  ("Nothing could be judged about its process... an overlap cannot be ruled out") that `abandon.md`
  never describes at all — not wrong, just missing.
  Both are small, additive documentation completeness gaps, not correctness defects — the reviewer's
  own framing: "the operative claim stays true... outside this round's scope."

### OAI-186 — parked, `not worth doing`

**Why parked:** No instance. Found by an independent reviewer during OAI-65's own review-ladder pass 2, on a file outside that fix's four-file scope and untouched by its diff — the reviewer explicitly did not treat it as reopening OAI-65 (*"flag as a possible separate backlog item, not a reason to hold this change"*). `config.mjs:47-48` still does `mkdirSync` then `writeFileSync` with no `lstatSync` guard, but no symlink has ever been observed planted at `configPath()`'s directory.

**Reopening bar (an instance, with a date):** A symlink observed at the plugin's config directory (or at `providers.json` itself) that `mkdirSync`'s EEXIST-recovery stat or `writeFileSync` followed, with the seeded config landing somewhere it should not. Record the path, what was written where, and the date.

*Filing kept verbatim:*

- **OAI-186** — **`config.mjs`'s `loadConfig` creates the plugin's config directory the same
  symlink-following way `job-store.mjs` used to create the state directory.** Found by an independent
  reviewer during OAI-65's review-ladder pass 2, on a file outside that fix's four-file scope and
  untouched by its diff. `config.mjs:47-48`: on `ENOENT`, `mkdirSync(dirname(path), {recursive:
  true})` then `writeFileSync(path, ...)` — no `lstatSync` guard before either call, so a symlink
  planted at `~/.config/oai-plugin` (or wherever `configPath()` resolves) ahead of the plugin's first
  run would be walked into by `mkdirSync`'s own EEXIST-recovery stat, and the seeded default config
  would be written inside whatever directory the symlink points at.
  **Why this is a smaller, different-shaped item than OAI-65's fix, not a fold-in of it:** OAI-65's
  posture doc (`job-store.mjs:207-208`, "`0700` on the directory and `0600` on the file") explicitly
  names the state directory as secret-bearing — prompts and the full text of every attached source
  file. The config directory holds `providers.json`: provider names, base URLs, and (only when
  `apiKey` rather than the preferred `apiKeyEnv` is used) a credential — a real but narrower and
  differently-shaped exposure than OAI-65's threat model was scoped to close. The reviewer that found
  this explicitly did not treat it as reopening OAI-65: "outside this fix's stated threat model... flag
  as a possible separate backlog item, not a reason to hold this change."
  **The shape of the fix**, following OAI-65(b)'s own precedent directly: an `lstatSync`-based guard
  before `mkdirSync`, refusing rather than following a symlink at the config directory — the same
  `refuseSymlink` helper `job-store.mjs` now has, either reused or duplicated. Whether `providers.json`
  itself also needs the same `0600`/`0700` unconditional-repair treatment `job-store.mjs` now gives
  `jobs.db` and its directory is the open design question this item still needs a grill on — the
  config file is not currently chmod'ed at all, on either creation or a later load, which OAI-65 never
  claimed to touch.

### OAI-187 — parked, `not worth doing`

**Why parked:** No instance. Found by two independent reviewers during OAI-65's own review-ladder pass 4 and sharpened at pass 8, then disclosed at that fix's verdict point rather than folded in — widening an already eight-pass ladder onto a file-level guard with its own open design questions. `databasePath()` is still never passed to `refuseSymlink` in either `openOnce()` or `openStoreForReading()`, but no symlink has ever been observed planted at the `jobs.db` path.

**Reopening bar (an instance, with a date):** A symlink observed at the `jobs.db` path that `new Database(path)` or the subsequent `chmodSync(path, 0o600)` followed. Record the state directory's mode at the time, where the link pointed, and the date.

*Filing kept verbatim:*

- **OAI-187** — **`job-store.mjs`'s new symlink guard covers the state directory and `logs/`, never
  `jobs.db` itself.** Found by two independent reviewers during OAI-65's own review-ladder pass 4, and
  sharpened by a closing reviewer at pass 8: `databasePath()` is never passed to `refuseSymlink`
  anywhere, in either `openOnce()` or `openStoreForReading()` — only the containing directories are
  checked. A symlink planted at the exact `jobs.db` path, while the directory was still loose
  (pre-repair, from an older build or any other cause), is followed by `new Database(path)` and later
  `chmodSync(path, 0o600)`. **Not merely a pre-repair window**: the directory's own `chmodSync` repairs
  the directory's mode, not a symlink already sitting inside it, so a symlink planted at `jobs.db`
  survives the directory repair and is followed on every subsequent open too — a standing gap, not a
  bootstrap-only one.
  **Why this stayed out of OAI-65's own fix:** Codex (consulted directly during that review) suggested
  amending [OAI-95], but OAI-95's own text describes a different, withdrawn helper
  (`state-permissions.mjs`'s `restrict()`), never this gap — confirmed by grep across BACKLOG.md before
  filing here instead. Folding it into OAI-65 would have widened an already eight-pass ladder onto a
  file-level guard with its own design questions (does a readonly opener's guard differ from a writing
  one's; does this need the same two-check-per-operation TOCTOU narrowing OAI-65's directory guards
  now have) rather than the directory-symlink shape OAI-65/OAI-150 were scoped to.
  **The shape of the fix**, following OAI-65's own precedent directly: `refuseSymlink(path)` (or a
  variant checking the file rather than a directory — `lstatSync` already inspects the link itself
  regardless of what it resolves to) immediately before `new Database(path)`, in both `openOnce()` and
  `openStoreForReading()`, mirroring the two-check-per-operation pattern OAI-65's fix established for
  `state`/`logs`.

### OAI-188 — parked, `not worth doing`

**Why parked:** No instance. Two robustness gaps found during OAI-65's own review-ladder passes 7-8 and disclosed to (not fixed by) its dual-approval verdict point. `openStoreForReading()`'s `db.exec('PRAGMA busy_timeout = 10000')` has never been observed failing, and no newer-`schema_version` `jobs.db` paired with a loose state directory has ever existed on this machine. The item itself narrows (b): `openStoreForReading()` now carries the same symlink guard `openOnce()` does, *"so this is a MODE-repair gap specifically, not a symlink-following one"*.

**Reopening bar (an instance, with a date):** A leaked read-only handle observed from a failing `busy_timeout` pragma, OR a state directory observed staying loose across repeated `/oai:status` calls because `openJobs()` took the newer-`schema_version` branch. Record the mode, the two schema versions and the date.

*Filing kept verbatim:*

- **OAI-188** — **Two small robustness gaps in `job-store.mjs`'s `openStoreForReading()`/`job-view.mjs`'s
  `openJobs()`, found during OAI-65's own review-ladder pass 7-8 and disclosed to (but not fixed by)
  that fix's dual-approval verdict point.**
  **(a)** `openStoreForReading()`'s `db.exec('PRAGMA busy_timeout = 10000')` has no try/catch-and-close
  on failure, unlike `openOnce()`'s equivalent statements — a rare pragma failure leaks the just-opened
  read-only database handle rather than closing it before rethrowing.
  **(b)** When a database has a newer `schema_version` than this build understands, `openJobs()`
  returns the read-only handle from `openStoreForReading()` directly, without ever calling the hardened
  `openStore()` — so the unconditional directory-mode repair OAI-65 added never runs on that branch. A
  state directory that's loose and paired with a newer-schema `jobs.db` stays loose on every
  `/oai:status` for as long as that condition holds. Narrower than it sounds: `openStoreForReading()`
  now carries the same symlink guard `openOnce()` does (OAI-65's fix), so this is a MODE-repair gap
  specifically, not a symlink-following one.
  **The structural tests' comment-stripping regex** (`/\/\/.*$/gm` in `tests/job-store-modes.test.js`,
  pinning the check-ordering OAI-65 added) only strips `//` line comments, not `/* */` block comments —
  a latent gap with no live trigger in the file today, noted here rather than filed separately since
  it's the same "found during OAI-65's review, disclosed, not fixed" shape.
  **The shape of the fix**: (a) wrap the pragma call the same way `openOnce()` wraps its own; (b) either
  call `openOnce()`'s repair unconditionally before returning on the newer-schema branch, or accept and
  document that a newer-schema database is read-only territory this build cannot safely mutate anyway —
  a design question, not a mechanical fix.

## 2026-08-17 — parked by the backlog sweep's worth bar

One item, `not worth doing` — **never `refuted`**. The framing is correct: the duplication is real
and verified. It named no dated instance of drift, only a scenario ("a fourth failure reason added
without being added here") that has never occurred — the two vocabularies agree exactly at HEAD.
Checked against the silence exception and it does not qualify: when this does drift, the failure is
operator-visible (a wrongful `exit 1` from `/oai:abandon`), not evidence-destroying by nature.
Second-verdict from `codex-rescue` on 2026-08-17 concurred independently. **The reopening bar is an
INSTANCE, not an argument.**

### OAI-173 — parked, `not worth doing`

**Why parked:** No dated instance. `job-abandon.mjs`'s `RECONCILER_FAILURE_REASONS` set and
`job-reconcile.mjs`'s independently-written failure-reason literals currently agree exactly — verified
against disk 2026-08-17. The item's own stated consequence is conditional on a reconciler change that
has never happened.

**Reopening bar (an instance, with a date):** `job-reconcile.mjs` gains a new failure reason that
`job-abandon.mjs`'s `RECONCILER_FAILURE_REASONS` does not carry, and an operator observes `/oai:abandon`
exit 1 against a row whose queue recovery had in fact already freed it. Record the reason string added,
the commit, and the operator-visible symptom.

*Filing kept verbatim:*

- **OAI-173** — **The reconciler's failure vocabulary is retyped as literals with nothing pinning the
  two copies together.** Filed 2026-08-16 from OAI-162's review; verified pre-existing at HEAD.
  `job-abandon.mjs`'s `RECONCILER_FAILURE_REASONS` is `new Set(['worker-died', 'cancel-unconfirmed',
  'worker-never-started'])` — the failure reasons `job-reconcile.mjs` writes on a `failed` row,
  retyped, with no shared constant and no test asserting the two agree. (`reconcile` also returns
  `cancelled`, which is a state rather than a failure reason and is handled by its own arm in
  `recoveryOwned`.) The set decides that a `failed` row was settled by recovery and may be reported
  idempotently rather than refused. A fourth failure reason added to the reconciler without being
  added here would make `/oai:abandon` exit 1 at an operator whose queue recovery had in fact just
  freed — precisely the outcome the idempotent arm exists to prevent — and nothing would go red.

## 2026-08-14 — parked by the backlog sweep's worth bar

Two items, both `not worth doing` — **never `refuted`**. Each framing is correct. The bar was applied
to the ten items filed SINCE the 2026-08-13 pass, not re-applied to the 89 that pass already cleared:
re-litigating a bar one day later is not a sweep, it is churn. Eight of the ten carried a dated
instance; these two did not. **Every reopening bar here is an INSTANCE, not an argument.**

### OAI-153 — parked, `not worth doing`

**Why parked:** No instance. The item states its own harm as hypothetical — a later build deriving a
streak the run itself would never have computed — and says outright it is "not ship-blocking: in every
real use the recovery tool runs against the same build within hours". Verified 2026-08-14: the ledger
header still carries no `schemaVersion` (`bench/lib/sweep-ledger.mjs`), so the mechanism is real and
unfired. The record it cited to make itself filable, `adr/022`, was deleted with the ADR corpus.

**Reopening bar (an instance, with a date):** A recovery run whose derived streak disagrees with the
run's own — `bench/recover-sweep.mjs` producing a health section a reader acts on and that the original
sweep would not have produced. Record the two streaks and the date.

*Filing kept verbatim:*

- **OAI-153** — **The ledger header carries no schema version, so a recovered streak is bound to the
  build that recovers it.** Raised 2026-08-13 by `codex-adversarial` at pass 1 of OAI-132's review
  ladder [high/0.96]; the documentation half shipped, the mechanism did not.
  `isOutage` can change between a run and its recovery, so a later build may derive a streak the run
  itself would never have computed. That is the cost of deriving rather than storing, and **ADR 022 now
  states it**; a `schemaVersion` in the header would let a future build *detect* the mismatch instead of
  silently suffering it. Not ship-blocking: in every real use the recovery tool runs against the same
  build within hours. Deferred rather than dismissed — the stored-counter alternative is worse, since a
  second representation of one fact is free to disagree with the entries beside it.

### OAI-154 — parked, `not worth doing`

**Why parked:** Its shipped half is shipped (the ledger and record are created `0o600`, verified
2026-08-14 at `bench/lib/sweep-ledger.mjs` and `sweep-report.mjs`). Its live half is redaction, which
the item itself assigns elsewhere — "a base URL with an embedded credential is the subject of the
existing OAI-91/92/95" — so what remained here was a filing so the split was on the record, not work.
No instance of a credential reaching a sweep artifact has been observed.

**Reopening bar (an instance, with a date):** A credential actually found in a `bench/results/`
artifact — the ledger, the record or a captured stderr stream — quoted with the run stamp it came from.

*Filing kept verbatim:*

- **OAI-154** — **Captured stdout/stderr can carry a credential, and file mode is the only thing
  limiting who reads it.** Raised 2026-08-13 at pass 1 of OAI-132's ladder and split: **the file-mode
  half shipped** (the ledger is created `0o600`, and at pass 2 the `.json` record too, since only those
  two carry the raw streams — the rendered `.md` emits neither and is deliberately left at the umask).
  **Redaction was deferred and stays deferred.** A base URL with an embedded credential is the subject
  of the existing OAI-91/92/95, and widening a feature to cover it is how a feature stops converging.
  Filed here so the split is on the record and the shipped half is not mistaken for the whole.

## 2026-08-13 — parked by the backlog sweep's worth bar

Six items, all `not worth doing` — **never `refuted`**. Each framing is correct; none named an instance
of harm that had already happened, which is the bar (`adr/069`). Three said so in their own words, and
those quotes are kept below rather than paraphrased. **Every reopening bar here is an INSTANCE, not an
argument**: a better-sounding case for one of these does not reopen it, because that is what parked it.
The bar was applied to all 101 surviving items, not to a chosen subset.


### OAI-7 — parked, `not worth doing`

**Why parked:** No dated instance of harm exists in the body or in any ADR; the sweep searched both.

**Reopening bar (an instance, with a date):** Someone other than the author tries to install this plugin and cannot — a named person, with the date. Until then the `--plugin-dir` path is how it is used and nothing is blocked.

*Filing kept verbatim:*

  - **OAI-7** — Publish: README install instructions, and verify the marketplace path
    (`claude plugin marketplace add`) actually resolves this repo once it has a remote.


### OAI-36 — parked, `not worth doing`

**Why parked:** Verified 2026-08-13 by the sweep: nothing reads `bench/results/*.json` back in, and `renderReport` has exactly one production call site (`bench/run.mjs:265`). The trap is real and unreachable.

**Reopening bar (an instance, with a date):** A replay or re-render path is added — `--render <file>`, or anything that reads `bench/results/*.json` back. The sweep verified on 2026-08-13 that nothing does today, which is exactly why the trap cannot fire yet.

*Filing kept verbatim:*

  - **OAI-36** — If a re-render command is ever added, the reliability prose becomes schema-dependent.
    Filed 2026-08-03 from the OAI-31 review, where it was raised at high confidence (0.99) and
    **dismissed with evidence rather than fixed** — recorded here because the evidence is exactly what
    a future change would invalidate. `reliabilitySection` renders "an attempt record carries `<nine
    fields>`" from `RECORD_FIELDS`, pinned against a live ledger entry. That sentence is true of
    entries the *current* ledger produced, and today it can only ever describe those: `renderReport` is
    called from exactly one place, `bench/run.mjs:251`, on live results, and nothing reads
    `bench/results/*.json` back in. Add a `--render <file>` or any replay path and the report can
    describe a record written before `promptChars` or `waitedMs` existed, while the prose asserts nine
    fields it never had. The fix then is to version the serialized attempt schema at the report
    boundary and condition the enumeration on the schema actually present — not to weaken the sentence,
    which is the one thing that made it checkable. Cheap now, invisible later: whoever adds replay will
    not think to look at a paragraph in the reliability section.


### OAI-43 — parked, `not worth doing`

**Why parked:** Its own body: *"Worth an hour to decide deliberately; worth nothing to change by reflex"* — and it records the duplication tripwire firing usefully twice (OAI-31, then OAI-35).

**Reopening bar (an instance, with a date):** The two-place edit FAILS to fire: a field is added to the ledger and `RECORD_FIELDS` does not go red, or the reader-facing paragraph goes stale while the key-set test stays green. Its own body records the tripwire firing usefully twice, so the evidence currently runs the other way.

*Filing kept verbatim:*

  - **OAI-43** — Decide whether the attempt record deserves one schema both sides read. **Low priority,
    and it may close as "no" — it is filed because it was rejected on judgement rather than on
    evidence.** Raised by `codex-adversarial` in OAI-35's pass 2 and dismissed there as out of scope.
    The observation: adding a field to the ledger means editing two places — `newEntry` in
    `scripts/lib/attempt-ledger.mjs`, and `RECORD_FIELDS` in `bench/lib/reason-notes.mjs` — and
    `RECORD_FIELDS` is attempt-record schema metadata living in a *rendering* helper because one
    paragraph happens to enumerate it. Codex's read: a shared record schema would be the genuine seam,
    and the current arrangement is a size-driven extraction wearing one.
    The counter, which is why it was rejected: that two-place edit **is the designed tripwire**. The
    key-set test goes red the moment the two disagree, which is what forces the reader-facing paragraph
    to be re-read rather than left quietly describing a record it no longer matches — and that tripwire
    has now fired usefully twice (OAI-31, then OAI-35). A shared schema keeps them in sync
    automatically, which sounds better and would have *removed* the prompt to re-read the prose.
    So the real question is not "is this duplication" but **"is the duplication load-bearing"**, and
    OAI-35 gave weak evidence for both sides: the tripwire worked, and separately three documents
    still went stale on a witness count no tripwire watched. Worth an hour to decide deliberately;
    worth nothing to change by reflex. If it is done, the paragraph must keep something that fails when
    the record changes, or the one guard that has demonstrably worked here is traded for tidiness.


### OAI-47 — parked, `not worth doing`

**Why parked:** Its own body: *"So nothing is currently wrong."*

**Reopening bar (an instance, with a date):** A TTL challenge record is read somewhere its `BACKLOG_DONE.md` attestation is not — copied off this machine, or cited when the tree state matters — and its provenance cannot be established.

*Filing kept verbatim:*

  - **OAI-47** — Make the TTL challenge record self-attesting by stamping the git revision into
    `environment`. **Small, and filed as satisfied-but-improvable rather than as a defect.** The
    manifest's `environment` is `{startedAt, model, lmsCommit, residentBefore}` — it names the `lms`
    build but not the revision of *this* repo that produced it, so the artifact cannot say which
    instrument wrote it. OAI-34's done-condition anticipated exactly this and solved it out-of-band:
    the handover records the SHA in `BACKLOG_DONE.md`, and the 2026-08-04 run did so (`0c566b6`). So
    nothing is currently wrong. What is fragile is that the attestation lives in a *different file*
    from the record, and `bench/results/` is gitignored — a record copied off this machine arrives with
    no provenance at all. Add `gitRev` (and whether the tree was dirty, which matters more: a canonical
    run from a modified tree is not the reviewed instrument, and today nothing in the record would say
    so). Cheap, and it is the same class this repo already files — a claim that is true because a human
    remembered to write it down elsewhere.


### OAI-82 — parked, `not worth doing`

**Why parked:** Its own body: *"Not a defect — the invariant holds by instruction and the refusal is the point."*

**Reopening bar (an instance, with a date):** A delegate run is observed making more than two `task` submissions, or accepting more than one job. The invariant holds by instruction today and the item says outright it is not a defect.

*Filing kept verbatim:*

  - **OAI-82** — **"At most two `task` submissions, at most one accepted job" is not auditable.** Filed
    2026-08-05. The invariant is stated in the agent, ADR 015, this tracker and the done entry, and only
    its *accepted* half leaves a trace: an oversize refusal happens before any row exists, so a second
    submission is invisible afterwards and nothing can reconstruct the count from persisted state. Not a
    defect — the invariant holds by instruction and the refusal is the point — but it is a claim the
    repo cannot check, which is the class this repo keeps promoting into structural tests. If it is ever
    worth checking, the cheap form is a pre-publication attempt counter on the row rather than an
    idempotency key; note that Codex proposed the full transactional design and it is far more than this
    earns.


### OAI-152 — parked, `not worth doing`

**Why parked:** Its own body: *"Observed while building OAI-132, 2026-08-13; **not measured**."*

**Reopening bar (an instance, with a date):** An actual run fills a disk, or a ledger is observed above ~50MB. This bar is the item's own words, written when it was filed.

*Filing kept verbatim:*

  - **OAI-152** — **The ledger is written with nothing checking the disk can hold it.** Observed while
    building OAI-132, 2026-08-13; **not measured**. `classify` keeps up to `MAX_RAW` (256KB) of stdout
    *and* stderr per entry, so a pathological night could write ~20MB of JSONL into `bench/results`
    (gitignored). **Accepted deliberately rather than fixed** — bounding it would mean the ledger holding
    less than the record it must reconstruct — and a failed append declares a `gap` line rather than
    vanishing, so the loss is visible. Filed so the trade is recorded rather than rediscovered and
    re-argued. **The bar for it being real:** an actual run that fills a disk, or a ledger observed above
    ~50MB.

# Parked

Items whose *framing* was disproved, not merely deprioritised. Each carries a **reopening bar**: what
would have to be observed for it to become live again. IDs here are still stable and global, and a
merged item that landed here (rather than being independently parked) gets a one-line stub bullet
— `BACKLOG.md`'s tier-ranking index and absorbed-ID redirect table were retired 2026-08-20.

- **OAI-44** — Decide whether a *confirmation-capable* server-state instrument is worth building.
  **Parked 2026-08-05 by the backlog sweep.** It was already marked "Parked, not closed" in its own
  text and sitting in the live ordered list anyway; the sweep moved it to where that word means
  something. Filed 2026-08-04 by OAI-34, which withdrew its own confirming verdict during
  the plan gate — see [ADR 013](adr/013-observing-the-server.md)'s amendment. The reason is structural
  rather than a gap in effort: proving an unload happened after expiry requires observing the model
  still resident **after** expiry, and a mechanism that fires **at** expiry never leaves that
  observation behind. Four designs were tried and each failed on a different axis (clock origin;
  bracket width, where present-at-119s/absent-at-121s straddles a 120s expiry; a calibration-derived
  bound on the spawn-to-receipt offset, invalid because `prefillMs` starts before the HTTP request and
  the driver's `Date.now()` is not the monotonic clock attempts are timed on; and gating on the
  exposure margin, which is post-treatment — the hypothesised eviction truncates the very measurement
  used to decide whether the episode was exposed).
  So this is not "try harder with sampling". The two designs that could actually earn a confirmation:
  **(a) matched controls** — randomised challenge TTLs with long-TTL controls, requiring unload timing
  to *move with* the assigned TTL, which makes TTL the manipulated variable instead of resting on one
  coincidence at 120s; ADR 013 costed the corpus-wide version at 3–4h on the MoE and 9–12h on the
  dense, but a single-case version is much cheaper and was never costed. **(b) server-side telemetry**
  — if LM Studio ever exposes an unload *reason* or a lifecycle event, the whole problem collapses to
  reading it. Check that first; it is a five-minute question and it decides whether (a) is worth
  hours.
  **A second thing any confirming design must fix, recorded here so it is not rediscovered:** the
  sampler's `in-flight` phase means *the child process is alive*, not *the HTTP request is open*. An
  absence seen after the request already failed but before the companion exits falls inside that
  window. That is ADR 013's own "an unload after the request had already failed" disqualifier, and it
  is harmless today only because nothing is attributed. It becomes load-bearing the moment anything is.
  **The precondition on this item is now discharged, and it landed on the side that argues against
  building anything.** It said: do not start before OAI-34 has run, because if three episodes survive
  a 120s TTL against a 335s prefill then the deterministic form is refuted and the appetite for
  confirming a mechanism that just failed to appear should be re-examined rather than assumed. **That
  is exactly what happened on 2026-08-04** — 3/3 survived, 336s of prefill, continuously resident,
  216s of slack at the narrowest. So the honest default for this item is now **"no"**, and it needs a
  positive reason to move rather than merely an unanswered question. What would supply one: a drop
  recurring on the MoE, or on a case this run did not cover, since the refutation is dense-27B/
  `scaffold`/120s only.
  **One finding from that run bears directly on design (b), and shortens it.** The residency
  endpoint reports **`lastUsedTime: null` for the entire time it is serving a request** (`status`
  went `processingPrompt` for 168 consecutive samples per episode, then `generating`). So the field
  ADR 013 nominated as activity evidence is not populated in flight, and `activityObserved` came back
  `null` in all three episodes. Any telemetry-based design must therefore find a *different* signal
  than `lms ps`'s activity fields — checking whether one exists is still the five-minute question to
  ask first, but it should not be asked of that field.

  ### Reopening bar

  **A drop recurring on the MoE, or on a case the 2026-08-04 run did not cover.** The refutation that
  parks this item is dense-27B / `scaffold` / 120s only, at N=3 with a ~63% one-sided upper bound on
  the failure rate — so it does not cover the MoE, where 27/72 of the original drops were also seen.
  Either observation restores a live mechanism to confirm and makes this item worth costing again.
  **The cheap check comes first and is not gated by any of that:** if LM Studio ever exposes an unload
  *reason* or a lifecycle event, design (b) collapses to reading it, and that is a five-minute
  question. Asking it does not require reopening this item; getting a yes does.
