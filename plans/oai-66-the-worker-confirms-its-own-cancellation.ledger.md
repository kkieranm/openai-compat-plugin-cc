# OAI-66 — review ladder disposition ledger

Frozen artifact: the working tree against `HEAD` = `4587c5b`, comprising the tracked diff over
`CLAUDE.md`, `adr/014-async-jobs.md`, `scripts/lib/{cmd-task-worker,job-heartbeat,job-reconcile,job-retention}.mjs`,
`tests/{cancel,retention}.test.js`, plus the untracked `scripts/lib/cancel-ack.mjs`,
`tests/cancel-confirmation.test.js`, `tests/cancel-helpers.mjs`.

Acceptance criteria: the approved plan `plans/oai-66-the-worker-confirms-its-own-cancellation.md`
(digest `a30cfa883e02`), Change phases 1/2/3/3b/4 and its Verification section.

Entry tier: **full**. Triggers: none fired — no vendor dialect or wire format is touched, so
`lean-wide` does not fire; `security-review` is structurally unreachable in this repo and its lens
folds into `codex-adversarial`, so **every pass here completes with a coverage gap** and `adr/032`'s
confirmation pass can never trigger.

## Step 5 evidence (handover into the ladder)

**Key invariant:** a `running` row that died with a cancellation pending reads `cancelled` only on a
present, id-matching acknowledgement; a `queued` one reads `cancelled` with no evidence at all.

| # | Mutation | Predicted | Observed | Tool |
|---|---|---|---|---|
| M1 | drop the `row.state !== 'running' \|\|` split in `terminalizeDead` | the queued witness reddens | `✖ cancelling a queued job stops it before it reaches the model at all`, 10/1 | `mutation-landed.py` LANDED; restored, `diff` identical |
| M2 | `cancelAckMatches` returns true whenever an id is given | the death witnesses redden | 5 reddened (killed-worker, id-match, symlink, FIFO, decision P), 6/5 | `mutation-landed.py` LANDED; restored, `diff` identical |
| M3 | remove `O_NOFOLLOW` from the read | the symlink witness reddens | `✖ a symlink at the acknowledgement path cannot aim the read at the job log` | by hand; restored |
| M4 | remove `O_NONBLOCK` from the read | the FIFO witness rejects **by name** | rejected by name at 20s, and the suite terminated | by hand; restored |
| M5 | remove `writeCancelAck`'s own `try/catch` | decision P's witness reddens | **it did NOT** — 1/0 green. See L6. | by hand; restored, `diff` identical |

Live verification against LM Studio `qwen/qwen3.6-27b`, both directions of the actual defect:

- job `f5f334b6` (seq 16) cancelled cooperatively → `16.cancel-ack` written `-rw-------`, first line
  `f5f334b6`; `/oai:status` reads **`cancelled`**.
- job `645e2aa4` (seq 18) cancelled and then `kill -9`ed → **no** acknowledgement; `/oai:status` reads
  **`failed`** and `/oai:result` prints *"exited after a cancellation was requested, but never
  confirmed that the cancellation is why it stopped — so it may instead have died."* Before this
  change that run published a clean `cancelled` with no note.

`npm test`: 810 → **817 pass / 0 fail**. Plugin loads for real (`/oai:setup` renders the provider table).

## Pass 1

Stages: `acceptance-audit` ✔ collected, `advisor-opener` ✔ collected, `codex-adversarial` (running),
`codex-plain` (pending), `advisor-closer` (pending). `security-review` and `lean-wide` did not fire.

### Entries

**L1 — witnesses split across three files rather than the one the plan names.**
Class: plan-deviation / test layout. Observed: `tests/cancel-confirmation.test.js`,
`tests/cancel-helpers.mjs` (new) vs the plan's *"Witnesses, in `tests/cancel.test.js`"*.
Evidence: `acceptance-audit` C1/B1. Cause: `tests/structure.test.js`'s 300-line file budget — the
combined file measured 416.
Classification: **inside the ask** — the plan required these witnesses; the file boundary is the
ratchet's choice, not a reviewer enlarging scope, so `adr/056`'s user escalation does not apply.
Disposition: **dismissed**, recorded as a plan deviation for step 8. State: `open`.
Verifiers: (`acceptance-audit`, the three test files).

**L2 — `cancelAckPathFor` lives in `cancel-ack.mjs`, not `job-store.mjs` beside `logPathFor`.**
Class: plan-deviation / module placement. Observed: `scripts/lib/cancel-ack.mjs:36`.
Evidence: `acceptance-audit` C2. Cause: `job-store.mjs` sits at its 300-line ratchet (297 + 20 = 317);
the plan's own size note anticipated *"the log read may warrant its own small module"*.
The stated intent — no caller builds the name itself — holds: `job-retention.mjs:15` imports it.
Disposition: **dismissed**, recorded as a plan deviation for step 8. State: `open`.
Verifiers: (`acceptance-audit`, `job-store.mjs` + `cancel-ack.mjs` + `job-retention.mjs`).

**L3 — decision P's witness drives `EEXIST`, not an injected throw.**
Class: witness fidelity. Observed: `tests/cancel-confirmation.test.js`, *"a worker whose
acknowledgement will not write exits anyway"*. Evidence: `acceptance-audit` C3. Superseded in
substance by **L6**, which is the sharper statement of the same doubt. State: `open`.

**L4 — the queued witness's `readAck(...) === null` does not itself prove no log was consulted.**
Class: claim vs assertion. Observed: `tests/cancel.test.js`, queued case.
Evidence: `acceptance-audit` D. Adjudication: the guarantee is carried by **M1**, which reddened
exactly this witness when the split was removed — so the property IS witnessed, by the mutation
rather than by the assertion's text. Disposition: **dismissed with the record corrected here**.
State: `open`. Verifiers: (`acceptance-audit`, `tests/cancel.test.js` + `job-reconcile.mjs`).

**L5 — `writeCancelAck`'s `!jobId` guard is unwitnessed.**
Class: test coverage of a stated plan requirement. Observed: `scripts/lib/cancel-ack.mjs:53`.
Plan text: *"the default `onCancel` writes nothing when it was given no id, so a future test driving
the default cannot put an `undefined`-id acknowledgement into a real state directory."*
Disposition: **accepted, in scope** — add a unit assertion that `writeCancelAck(seq, undefined)` is
`false` and leaves no file. State: `open`, for batch 1.
Verifiers: (`acceptance-audit`, `cancel-ack.mjs` + its witness).

**L6 — decision P's witness confirms the outcome but cannot discriminate the guard (M5).**
Class: a check that cannot fail. Observed: `tests/cancel-confirmation.test.js`, decision-P case.
Evidence: **M5** above — removing `writeCancelAck`'s `try/catch` left the test green, because an
uncaught throw inside the heartbeat's `setInterval` kills the worker anyway: dead pid, no
acknowledgement, same `cancel-unconfirmed` verdict. What the guard actually buys is the clean
`process.exit(0)` and the *"Cancellation requested: exiting without recording an outcome."* line on
the job log instead of a stack trace — which IS observable, on the log the fixture already owns.
Note the asymmetry: the READ side's catch *is* witnessed (M2 and M3 both redden through it).
Disposition: **accepted, in scope** — strengthen the witness to assert the job log carries the
notice and no uncaught-exception trace, and re-run M5 as its discriminator. State: `open`, for batch 1.
Verifiers: (`advisor-opener`, `cancel-ack.mjs` + `job-heartbeat.mjs` + the decision-P witness).

**L7 — `sweep()`'s `logs` key changed meaning; checked for a stale consumer.**
Class: `adr/066` claim-vs-code. Adjudication: the only production caller,
`task-submit.mjs:110` `sweepQuietly`, **discards the return value**; nothing renders it. No user-facing
string reads it. Disposition: **no defect**. State: `open` (recorded for the report).
Verifiers: (`advisor-opener`, `job-retention.mjs` + `task-submit.mjs`).

**L8 — the orphan sweep's safety argument is FALSE under sequence reuse, and its docstring asserts it.**
Class: adjudicated falsehood in an artifact this feature authored. Observed:
`scripts/lib/job-retention.mjs` `orphanSeqs` docstring, and `adr/014-async-jobs.md:355-357`.
Evidence: `codex-adversarial` finding 1. Interleaving: `jobs.db` is recreated while `logs/` survives;
sweep A lists `2.cancel-ack`, reads rows (only seq 1 exists) and marks 2 an orphan; submission B then
inserts seq 2 and opens `2.log`; sweep A resumes and `removeFiles(2)` unlinks B's LIVE files.
Adjudication: **the race class is pre-existing** — the identical interleaving already deleted a live
`<seq>.log` when a stale `<seq>.log` survived a recreation — but the union scan widens which residues
can start it, and the docstring's *"anything in this listing already had a row when the listing was
taken"* is stated as unconditional and is not.
Disposition: **accepted, in scope, TEXT ONLY** — the docstring and the ADR must state the reuse
precondition instead of asserting safety. The mechanism fix needs a store-incarnation binding, which
is the schema change the user declined; that goes to the tracker as a new item.
State: `open`, for batch 1. Verifiers: (`codex-adversarial`, `job-retention.mjs` + `adr/014`).

**L9 — "never blocks" is not true of a stalled filesystem.**
Class: overclaim. Observed: `scripts/lib/cancel-ack.mjs` `cancelAckMatches` docstring.
Evidence: `codex-adversarial` finding 2 — `O_NONBLOCK` governs FIFOs and devices, not a regular file
on a hung NFS/FUSE mount, where `open`, `fstat` and `read` can all block while the write lock is held.
The written claim is scoped to the FIFO and is accurate as far as it goes; what is missing is the
limit. Disposition: **accepted, in scope, text only** — name the residual. State: `open`, batch 1.
Verifiers: (`codex-adversarial`, `cancel-ack.mjs`).

**L10 — the trust footing is false where `logs/` is pre-existing and group/other-writable.**
Class: adjudicated falsehood. Observed: `scripts/lib/cancel-ack.mjs` header and
`adr/014-async-jobs.md` (*"anything able to write that directory can already write `jobs.db`"*).
Evidence: `codex-adversarial` finding 3 — `job-store.mjs:222` requests `0700` only when it CREATES the
directory and never repairs an existing one's mode, while `jobs.db` is explicitly chmod'ed `0600`. So
another OS user with write access to a pre-existing `logs/` can plant an acknowledgement without being
able to write `jobs.db`, turning a crash into a clean `cancelled`. Codex separately confirms the
narrower claim — that plain chat-completion output cannot create the file — holds.
Disposition: **accepted, in scope, text only** — narrow the footing to what is enforced. Repairing an
existing directory's mode is a behaviour change the plan did not ask for and goes to the tracker.
State: `open`, batch 1. Verifiers: (`codex-adversarial`, `cancel-ack.mjs` + `adr/014` + `job-store.mjs`).

**L11 — the orphan-name regex accepts names the unlink cannot address.**
Class: correctness, low. Observed: `scripts/lib/job-retention.mjs` `OWNED_NAME`.
Evidence: `codex-adversarial` finding 4 — `0002.cancel-ack` parses to seq `2`, and `removeFiles(2)`
unlinks `2.cancel-ack`, leaving the listed file permanently. Large values lose precision the same way.
Pre-existing in shape (`LOG_NAME` had it) but the line is one this diff rewrote.
Disposition: **accepted, in scope** — restrict to canonical positive sequences. State: `open`, batch 1.
Verifiers: (`codex-adversarial`, `job-retention.mjs` + a witness).

**L12 — four pre-existing `adr/014` claims the code does not do, one of them falsified by this diff.**
Class: `adr/066` cross-artifact claim. Evidence: `codex-adversarial`, ADR mismatches. Each is
discharged by grepping the CLAIM repo-wide, never by editing the cited line alone.
 - `:278` *"Only an observed exit produces one"* — `terminalizeUnstarted` cancels an unstarted row
   after the grace with no exit observed. A line this diff touched.
 - `:311` *"the open socket and the heartbeat timer keep the loop running"* — `startHeartbeat` calls
   `timer.unref()`, so the timer does not.
 - `:314` *"The same applies to `--max-wait` expiry"* — that path terminalizes and returns normally.
 - `:358` *"Only `^\d+\.log$` is eligible"* — **falsified by this diff**, which added the union.
Disposition: **accepted, in scope** — all four. The last is ship-blocking under the
adjudicated-falsehood rule; the other three are corrected in the same batch because the grep for the
claim reaches them. State: `open`, batch 1. Verifiers: (`codex-adversarial`, `adr/014` + the modules).

**L13 — the decision-P witness would also pass with the `writeCancelAck` CALL removed.**
Class: a check that cannot fail. Evidence: `codex-adversarial`, Tests section — the fixture preplants
a wrong-id file, so deleting the write entirely still yields exit + `cancel-unconfirmed`. This is the
same hole **L6** names from the guard side, and one strengthened witness closes both: assert the job
log carries the clean exit notice and no uncaught-exception trace, and re-run M5.
Disposition: **merged into L6**. State: `open`, batch 1.

**L14 — the FIFO witness's own unwedging can hang and hide the failure it is reporting.**
Class: correctness, in a test. Observed: `tests/cancel-confirmation.test.js`, the FIFO cleanup.
Evidence: `codex-plain` — the cleanup opens the FIFO `O_WRONLY` in BLOCKING mode. That returns
immediately only because a reader is already blocked on it. If `scenario.run()` rejects for any other
reason — a spawn failure, say — no reader exists and the cleanup blocks forever, swallowing the real
error. Disposition: **accepted, in scope** — open it `O_NONBLOCK` (which fails `ENXIO` at once when
there is no reader) and guard it. State: `open`, batch 1.
Verifiers: (`codex-plain`, `tests/cancel-confirmation.test.js`).

**L15 — `tests/cancel.test.js`'s header claims every test drives a real second process.**
Class: adjudicated falsehood, in a header this diff edited. Evidence: `codex-plain` — the
*"nothing ever picked up"* case inserts synthetic `queued` rows with no worker at all and terminalizes
them through `status`. Disposition: **accepted, in scope, text only**. State: `open`, batch 1.
Verifiers: (`codex-plain`, `tests/cancel.test.js`).

**Duplicates collapsed:** `codex-plain`'s `OWNED_NAME` finding is **L11** raised by a second lens (its
verifier set gains (`codex-plain`, `job-retention.mjs`)); its decision-P finding is **L6/L13** raised by
a third (gaining (`codex-plain`, the decision-P witness)). Neither is a new entry.

**L16 — the size ceiling on the acknowledgement is unwitnessed.**
Class: a stated guarantee resting only on reading the code. Observed: `scripts/lib/cancel-ack.mjs`
`MAX_ACK_BYTES` and its docstring (*"small enough that a file planted here cannot make the reader do
real work while it holds the write lock"*). Evidence: `codex-adversarial`'s missing-witness list,
surfaced in triage by `advisor-closer` — it was raised and had no entry, which is what makes it
blocking rather than optional. It discriminates: seed an acknowledgement over 4096 bytes whose FIRST
LINE matches the row id. As written, `stat.size > MAX_ACK_BYTES` rejects it and the row reads
`cancel-unconfirmed`; remove the size test and the `Math.min` still caps the read at 4096, the first
line still matches, and the row reads `cancelled` — so the witness reddens on removal.
Disposition: **accepted, in scope**. State: `open`, batch 1.
Verifiers: (`codex-adversarial`, `cancel-ack.mjs` + its witness), (`advisor-closer`, this transcript).

## Pass 1 close

Cap: **10**, computed via `check-ladder-register.sh --effective-cap`, not assumed.

Pass 1 is **completed with a coverage gap** (`security-review` unreachable) and **non-clean** — ten
accepted entries. It is not the last discovery pass, so `adr/089` does not fire here and there is no
verdict point: the boundary is batch-eligible and the ladder continues at pass 2.

**Batch 1 contents.** Accepted and to apply: L5, L6 (with L13 merged), L8 (text), L9, L10 (text),
L11, L12 (four claims, discharged by grepping each CLAIM repo-wide per `adr/066` — including
`CLAUDE.md`, which loads into every session), L14, L15, L16. Dismissed and not applied: L1, L2, L4, L7.

**Batch 1 ADDS EXECUTABLE SURFACE**, so `adr/056` applies: L11 rewrites `OWNED_NAME` in
`job-retention.mjs`, which is production code rather than text. **Pass 2 is therefore a FIRST REVIEW
OF NEW CODE for that change, not another convergence pass**, and is named so here before the batch
rather than reconstructed after it.

**Mutation obligations after the batch.** Verification is version-bound:
- **M1 survives** — `job-reconcile.mjs` is untouched by batch 1.
- **M2 and M5 are invalidated** — batch 1 edits `cancel-ack.mjs` (L9/L10/L16) and the decision-P
  witness (L6). Both must be re-run once the batch is green, and M5 must now REDDEN.
- **M6, new**: remove `stat.size > MAX_ACK_BYTES`; L16's witness must redden.

**Out of scope, to the tracker rather than this batch** — both are behaviour changes the plan did not
ask for, and one is the schema change the user declined at the grill:
- L8's mechanism: bind the orphan sweep to a store incarnation so a recreated `jobs.db` cannot let a
  sweep delete a live replacement job's files.
- L10's mechanism: repair a pre-existing state directory's mode rather than only requesting `0700` at
  creation.

## Batch 1 — applied, green

Snapshot `/var/folders/.../ladder-snap.qkqJix`, taken with the token `--close-for-batch` minted.
Suite: **819 pass / 0 fail** (817 before; L5 and L16 add one witness each).

Applied: L5, L6+L13, L8 (text), L9, L10 (text), L11, L12 (all four claims), L14, L15, L16.
Filed instead of fixed: **OAI-149** (store-incarnation binding for the orphan key) and **OAI-150**
(repair an inherited state-directory mode) — both in `BACKLOG.md` with bodies and tier-index entries,
and both CITED BY the text fixes, so the citations resolve rather than dangle.

L12 was discharged by grepping each CLAIM repo-wide, not by editing the cited lines:
 - *"observed exit"* — three sites. `adr/014:278` was false and is narrowed; `job-reconcile.mjs:45`
   and `tests/cancel.test.js:48` are both scoped to a dead-pid path and are TRUE, so both stand.
 - *"keep(s) the loop running"* — two sites. `adr/014:311` named the timer and is false
   (`timer.unref()`); `job-heartbeat.mjs:65` says a timer fires only while something else keeps the
   loop running, which is true. Only the first changed.
 - *"--max-wait"* — verified against `job-queue.mjs:172` and `cmd-task-worker.mjs`: it writes a
   terminal row and RETURNS, never `process.exit()`. `adr/014` said the opposite and now says this.
 - *`^\d+\.log$` is the only eligible name* — one site, falsified by this diff; now the union, and the
   canonical-sequence restriction is stated with it.

### Mutations re-run against the post-batch version

Verification is version-bound, so M2 and M5 were re-run and M6 is new. M1 attaches to
`job-reconcile.mjs`, which batch 1 did not touch, so it stands unre-run — stated rather than implied.

| # | Mutation | Result |
|---|---|---|
| M2 | ack read always succeeds | **6** witnesses redden (was 5 — L16's is the sixth) |
| M5 | remove `writeCancelAck`'s catch | **now REDDENS** — `doesNotMatch` fails on the uncaught `EEXIST` trace, which is exactly the observable the strengthened witness was given. The hole L6/L13 named is closed. |
| M6 | remove `stat.size > MAX_ACK_BYTES` | reddens L16's witness ✔ |

Every mutation restored and each restore proved by `diff` (identical).

**State transitions.** L5, L6 (with L13), L8, L9, L10, L11, L12, L14, L15, L16 move
`open` → `pending verification`, the batch having been green. L1, L2, L4, L7 were dismissed and never
entered it. Nothing is `verified` yet: that is evaluated after a whole pass completes.

## Pass 2 — a FIRST REVIEW OF NEW CODE for batch 1's `OWNED_NAME`, not a convergence pass

**L17 — L11's fix closes half its own evidence, and its claimed witness does not exist.**
Class: partial fix + a verifier obligation asserted rather than met. Observed:
`scripts/lib/job-retention.mjs` `OWNED_NAME`. Evidence: `acceptance-audit` round 2, reproduced here:
`node -e "console.log(\`${Number('123456789012345678901')}.log\`)"` prints
`123456789012345680000.log`. So `[1-9]\d*` still accepts a 21-digit name, `Number()` loses precision,
`logPathFor` / `cancelAckPathFor` interpolate a DIFFERENT string, `unlinkQuietly` swallows the `ENOENT`
and the listed file leaks permanently — which is the exact defect L11 was accepted to remove, and its
own entry named it (*"Large values can also lose precision the same way"*).
Second half: L11's verifier set claims (`codex-adversarial`, `job-retention.mjs` **+ a witness**) and
no such witness was written. The two tests batch 1 counted are L5's and L16's, both in
`cancel-confirmation.test.js`; `retention.test.js`'s two are the plan's own phase-3b coverage.
Adjudication: **L11 does not reach `pending verification`** — it returns to `open` with this entry
carrying the remainder. Disposition: **accepted, in scope** — decide membership by ROUND-TRIP
(`String(seq) === match[1]`) rather than by counting digits, which is exact for every input rather
than correct up to a bound, and add the witness the entry already promised.
State: `open`, for batch 2. Verifiers: (`acceptance-audit`, `job-retention.mjs` + its witness).

**L18 — two further `--max-wait` sites exist beyond L12's four; both are true.**
Class: completeness of an `adr/066` discharge. Observed: `scripts/lib/job-reconcile.mjs:10` and
`adr/014-async-jobs.md:266`, both saying a worker may still end *its own* run on cancel or
`--max-wait`. Adjudication: **true and untouched by this diff** — "ending its own run" is the process
exiting, which OAI-66 did not change; only whether a ROW is written changed. Recorded because a grep
that stops at the sites it fixed cannot show it was complete. Disposition: **no defect**.
State: `open` (for the report). Verifiers: (`acceptance-audit`, `job-reconcile.mjs` + `adr/014`).

**L19 — `sweep()`'s docstring still says "delete the logs nothing owns any more".**
Class: paraphrase survival of the claim L12 fixed. Observed: `scripts/lib/job-retention.mjs` `sweep`.
Adjudication: raised by `acceptance-audit` and already covered by **L7** — the key's sole consumer
discards it and nothing user-facing renders it — but the WORD is now narrower than the behaviour.
Disposition: **accepted, in scope, text only** — one word, so the sentence stops describing half of
what the sweep deletes. State: `open`, batch 2. Verifiers: (`acceptance-audit`, `job-retention.mjs`).

**L17's witness must DISCRIMINATE, not merely cover** (`advisor-opener`, pass 2). L11 shipped with a
witness its entry claimed and nobody wrote; replacing it with one that cannot fail would be the same
defect wearing a test's clothes. The witness seeds **two** orphans — `0002.cancel-ack` (the half
already fixed) and `123456789012345678901.cancel-ack` (21 digits, no leading zero, so `[1-9]\d*`
accepts it) — and asserts neither is reported by the sweep and neither is unlinked. **M7**: revert the
round-trip to `[1-9]\d*` and it must redden, because the long name then parses to
`123456789012345680000`, `removeFiles` addresses a path that does not exist, `unlinkQuietly` swallows
the `ENOENT`, and the file survives while `logs` reports its seq.
**The comparison must be against the CAPTURED STRING**, never against a value derived from the number
twice — `String(Number(x)) === String(Number(x))` round-trips trivially and is exactly the shape of a
check that cannot fail.

**Batch 2 adds executable production code AGAIN**, so **pass 3 is a first review of new code** for the
second `OWNED_NAME` rewrite. Naming it now rather than repeating the shape silently: this is the second
consecutive batch whose own fix is unreviewed surface, which is the cost `adr/056` exists to make
visible. Batch 2 touches `job-retention.mjs` only (L17) plus one word of its docstring (L19), so
**M1–M6 all survive it** and M7 is the only new obligation — stated rather than re-running six.

**Confirmed by the audit and requiring nothing:** L5 ships STRONGER than its entry (the guard and its
witness cover `seq` as well as `jobId`); L6, L8, L9, L10, L14, L15, L16 are present and do what their
entries say; OAI-149 and OAI-150 both resolve, body and tier index; batch 1's "exactly one executable
production change" holds once read as *batch 1's*, the rest of `job-retention.mjs` being the plan's own
phase 3b. Sites deliberately excluded from the grep and named rather than dropped: two frozen historical
plan documents, and three gitignored worktrees detached at an older commit.

**L20 — "a failure to write it does not delay the exit" is false: the WRITE can block too.**
Class: adjudicated falsehood. Observed: `scripts/lib/job-heartbeat.mjs` `exitOnCancel` docstring and
`adr/014-async-jobs.md`. Evidence: `codex-adversarial` pass 2 — round 1's finding 2 was answered on the
READ side only; `writeCancelAck`'s `openSync`/`writeSync`/`closeSync` are equally synchronous, so a
wedged NFS or FUSE mount keeps the paid request alive and the queue blocked. The sentence promises a
property the code does not have, on the exact axis the decision was argued.
Disposition: **accepted, in scope, text only** — say what is true: a write that FAILS does not delay
the exit; one that HANGS does, and no synchronous call can promise otherwise. State: `open`, batch 2.
Verifiers: (`codex-adversarial`, `job-heartbeat.mjs` + `adr/014`).

**L21 — OAI-150 states the permission precondition wrongly, and so do the two artifacts citing it.**
Class: adjudicated falsehood. Observed: `scripts/lib/cancel-ack.mjs` header, `adr/014-async-jobs.md`,
`BACKLOG.md` OAI-150. Evidence: `codex-adversarial` pass 2 — the residual needs the FULL chain: a
state directory the attacker can TRAVERSE, a `logs/` they can WRITE, and a `jobs.db` they cannot. My
wording, *"a pre-existing state directory more permissive than `0700`"*, is wrong at both ends: state
`0755` with a plugin-created `logs/` at `0700` is SAFE, and state `0777` lets the attacker replace
`logs/` and `jobs.db` alike, so the distinction the entry rests on disappears.
Disposition: **accepted, in scope** — correct all three, and rewrite OAI-150's witness bar to
precreate BOTH directories with discriminating modes. State: `open`, batch 2.
Verifiers: (`codex-adversarial`, `cancel-ack.mjs` + `adr/014` + `BACKLOG.md`).

**L22 — `adr/014` states the OLD matcher, contradicting both the code and its own next sentence.**
Class: cross-artifact claim, self-inflicted by batch 1. Observed: `adr/014-async-jobs.md` says
`^\d+\.(log|cancel-ack)$` while the paragraph below says canonical sequences only and the code says
`^([1-9]\d*)\.(?:log|cancel-ack)$`. Raised independently by `codex-adversarial` (P3) and `codex-plain`.
Disposition: **accepted, in scope, text only**; it will be rewritten again by L17's round-trip, so both
land together. State: `open`, batch 2. Verifiers: (`codex-adversarial`, `adr/014`), (`codex-plain`, same).

**L23 — `process.env.OAI_PLUGIN_STATE = undefined` stores the STRING "undefined".**
Class: correctness, in a test, leaking across tests. Observed: `tests/cancel-confirmation.test.js`, the
no-id witness's restore. Evidence: `codex-plain` — when the variable was absent to begin with, the
restore writes `"undefined"`, and every later in-process test resolves its state under `./undefined`.
Disposition: **accepted, in scope** — `delete` the property when the captured value was `undefined`.
State: `open`, batch 2. Verifiers: (`codex-plain`, `tests/cancel-confirmation.test.js`).

**L24 — the FIFO cleanup's single non-blocking attempt can lose the race it exists to win.**
Class: correctness, in a test. Observed: same file, the FIFO witness's `catch`. Evidence: `codex-plain`
— if the 20s bound fires BEFORE the child reaches its blocking open, the writer-open gets `ENXIO`,
cleanup returns, and the child then enters the open and hangs the runner indefinitely — the exact
outcome L14 was accepted to remove, one step later. Disposition: **accepted, in scope** — retry the
non-blocking open under its own bound until it lands or the run settles. State: `open`, batch 2.
Verifiers: (`codex-plain`, `tests/cancel-confirmation.test.js`).

**L25 — `O_EXCL` does NOT make a pre-existing acknowledgement "suspicious rather than authoritative".**
Class: adjudicated falsehood. Observed: `scripts/lib/cancel-ack.mjs` `writeCancelAck` docstring.
Evidence: `codex-plain` — `cancelAckMatches` has no provenance or freshness test, so a file
pre-created with a matching id IS authoritative and converts a later unconfirmed death into
`cancelled`. `O_EXCL` stops the WORKER overwriting one; it says nothing about the READER. The accepted
residual already records the limit; the word does not.
Disposition: **accepted, in scope, text only**. State: `open`, batch 2.
Verifiers: (`codex-plain`, `cancel-ack.mjs`).

**L26 — L6 RECURS: the decision-P witness still cannot show the write was ATTEMPTED.**
Class: adjudicated, accepted recurrence — so **L6 returns from `pending verification` to `open`**, per
the ledger's own state machine, and this pass may not mark it verified. Observed:
`tests/cancel-confirmation.test.js`, decision-P case. Evidence: `codex-plain` pass 2 — deleting the
`writeCancelAck(...)` CALL leaves every assertion green: the notice is printed by the `stderr.write`
above it, there is no `EEXIST`, the worker exits, the planted wrong-id file remains, and the row still
reads `cancel-unconfirmed`. Batch 1 closed the GUARD half (M5 reddens); the CALL half is still open.
Adjudication: the coverage does exist, in the sibling witness *"a running worker exits at its next
check-in"*, which asserts the acknowledgement file exists with the row's id and reddens if the call is
removed. What is wrong is this test's stated claim, not the suite's coverage.
Disposition: **accepted, in scope** — narrow this witness to what it establishes and cite the sibling
that carries "the write is attempted", so no reader takes one test for both. State: `open`, batch 2.
Verifiers: (`codex-plain`, the two witnesses).

**Merged into L17 as further lenses:** `codex-adversarial` P2-b and `codex-plain`'s first finding are
the same precision defect, independently reaching the same remedy — *"use the captured string as the
filename key"*. L17's verifier set gains (`codex-adversarial`, `job-retention.mjs`) and
(`codex-plain`, same). Two riders land with it: Codex confirms **no valid `AUTOINCREMENT` name is
rejected** by the current regex, and separately that `OWNED_NAME`'s new comment overclaims — the
helpers WOULD produce `0.cancel-ack` for seq 0, so "exactly the form the helpers produce" is wrong and
is narrowed in the same edit. `codex-plain` also gives a sharper leak than the ledger had: an orphan
`1000000000000000000000.cancel-ack` becomes `1e+21`, so the sweep deletes an unrelated `1e+21.log`
while leaving the listed file — **deletion of the wrong file, not merely a leak**.

**Confirmed by `codex-adversarial` and requiring nothing:** OAI-149's interleaving is true and
complete and filing the shipped race is honest; the oversized-ack and missing-id witnesses both fail
when their mechanisms are removed; leaving `terminalizeDead`'s observed-exit claim and
`job-heartbeat.mjs`'s timer claim untouched was correct within their scopes.

## Batch 2 — applied, green

Snapshot `ladder-snap.xY3o38`. Suite: **820 pass / 0 fail** (819 before; L17's witness is the one added).

Applied: L17 (+ its riders), L19, L20, L21, L22, L23, L24, L25, L26.
L17's fix is the ROUND TRIP — `ownedSeq()` returns a sequence only when
`String(Number(captured)) === captured` — chosen over a digit bound because it is exact for every
input rather than correct up to a limit someone must keep true, and because both Codex lenses
independently reached the same remedy (*"use the captured string as the filename key"*).

**M7**: revert the round trip to a bare `Number()` and L17's witness reddens ✔. Restored, `diff`
identical, suite re-proved green. M1–M6 all survive batch 2 — it touches `job-retention.mjs`,
`job-heartbeat.mjs` and `cancel-ack.mjs` prose plus three test bodies, none of which is a mechanism
those mutations attach to. Stated rather than re-run.

L17's witness carries **three** non-round-tripping fixtures, not one: `0002.cancel-ack` (the half the
regex already closed), `9007199254740993.log` (`MAX_SAFE_INTEGER + 2`), and
`1000000000000000000000.cancel-ack` — the last with an unrelated `1e+21.log` beside it that **must
survive**, because that name is what a number-keyed sweep would unlink. That fixture is the difference
between witnessing a leak and witnessing the deletion of someone else's file.

L24's fix is three mechanisms, because one was not enough: non-blocking (no reader exists on an
unrelated failure), **retried** (a single attempt races the child and `ENXIO`s before it opens), then
**unlinked and raced** regardless — the requirement being that the suite terminates, which only the
race guarantees.

### Pass 3 is a DISCOVERY pass, and the reasoning is recorded before it opens

`adr/089`'s verification-only pass fires when the ladder WOULD end — the discovery budget spent, or the
verdict point unable to approve for want of an applied fix. **Neither holds**: the cap is 10 and this
is pass 3, and batch 2 leaves no accepted in-scope fix unapplied. So pass 3 is an ordinary pass and its
verdict point is the first at which dual approval is reachable.

It is also a **first review of new code**, for the second consecutive time: batch 2 rewrote `ownedSeq`
and added a witness, and nothing has read either.

**The provenance signal is present and is recorded rather than acted on.** Seven of pass 2's ten
entries were defects in batch 1's own fixes — past `adr/032`'s half-the-accepted-set threshold. Its
confirmation pass cannot trigger here, because the precondition is a GAP-FREE pass and
`security-review` is structurally unreachable in this repo, so every pass carries a gap. **`adr/010` is
unambiguous that yield terminates nothing and dual approval is the only terminator**, so the ladder
continues — but if pass 3's findings again sit mostly in batch 2's fixes, that is sampling rather than
converging, and the verdict point is where it ends.

## Pass 3 — the LAST DISCOVERY PASS

**The provenance rule fires, and it is not the yield rule.** `adr/010`'s *yield terminates nothing* is
about a low finding COUNT and does not reach this. What reaches it is the standing user guidance in
`CLAUDE.md`: *"When a pass's findings sit mostly in the previous pass's fixes… another pass is
sampling, not converging — close at the verdict point."* Measured: pass 2 was 7 of 10 in batch 1's own
fixes; pass 3 is almost entirely in batch 2's. **Pass 4 is not opened.** Pass 3's boundary takes batch
3, then the `adr/089` verification-only pass holds the verdict point.

**No verdict point at pass 3**, and the ledger's earlier line saying otherwise was true when written
and is corrected here: L27–L36 are accepted, in scope and unapplied, so approval is forbidden by
construction and a verdict point would spend a Codex call and a subagent on a guaranteed dissent.

**L27 — L21 was applied to three sites and missed a fourth IN A FILE IT ALREADY EDITED.**
Observed: `BACKLOG.md` tier prose, still *"a state directory inherited more permissive than `0700`"* —
the exact wording L21's own body calls wrong at both ends. Evidence: `acceptance-audit` pass 3.
**Third instance of the same failure mode** (L12, L21, now this): editing cited sites is not
discharge. Batch 3 greps the WORDING — `more permissive`, `0700`, `inherited`/`pre-existing` near a
permission claim. Disposition: **accepted, in scope, text**. State: `open`, batch 3.

**L28 — L20 was applied to `job-heartbeat.mjs` and not to `adr/014`.** Observed: the ADR still
promises the worker *"exits anyway"* with no HANGS residual. Raised by `acceptance-audit` and
independently by `codex-adversarial` (3), which adds that *"a write that FAILS does not delay"* is
itself too broad — a filesystem call can block a long time and then fail. Disposition: **accepted, in
scope, text**; discharge by grepping `does not delay` and `exits anyway`. State: `open`, batch 3.

**L29 — the live round trip predates both batches.** Observed: the step-5 evidence was captured at 817
tests, before `job-retention.mjs` changed twice; `ownedSeq` runs on every submission via
`sweepQuietly`. Adjudication: **a verification obligation, not a fix** — discharged inside this pass by
submitting job `a6311f9e` post-batch-2, which **completed**. Claimed narrowly: this re-exercises the
SWEEP path live. The cancel-ack mechanism itself was untouched by both batches (every edit to
`cancel-ack.mjs` was prose), so the original `f5f334b6` / `645e2aa4` evidence still attaches to the
code that produced it. State: `open` (for the report); no batch entry.

**L30 — the round trip is NOT "the whole check": a value past SQLite's range round-trips.**
Observed: `job-retention.mjs` `ownedSeq`. Evidence: `codex-adversarial` (1) — `9223372036854776000.log`
matches and satisfies `String(Number(x)) === x`, but the value is `2^63`, beyond SQLite's maximum
sequence, so no row can own it and `removeFiles` DELETES AN UNRELATED FILE. Disposition: **accepted, in
scope** — add `Number.isSafeInteger`, which rejects it exactly, and correct the docstring's claim.
State: `open`, batch 3. Codex confirms separately that no name the plugin genuinely writes is rejected,
and that the comparison is not trivially true.

**L31 — the FIFO cleanup still cannot GUARANTEE termination.** Raised by both Codex lenses. If the
final writer-open `ENXIO`s and the child then enters its blocking open before the `unlinkSync`,
unlinking does not wake an open already waiting on the inode, and the 5s race stops awaiting `run`
without killing the child or closing its pipes. Retrying narrows the window; it does not close it.
Disposition: **accepted, in scope** — retry until `run` SETTLES rather than for a fixed count, so the
loop cannot expire while a child is still able to block. State: `open`, batch 3.

**L32 — the (b) hint I wrote in batch 1 is itself false.** Observed: `job-reconcile.mjs`
`terminalizeUnstarted`, *"Why the worker never started is not recorded anywhere"*, and
`tests/cancel.test.js` PINS it. Evidence: `codex-plain` — a spawned worker can fail before
`registerWaiter` (exhausted contention retries, say) and print that exact diagnosis to its pre-opened
job log. Disposition: **accepted, in scope** — the hint must stop asserting an absence it cannot
establish, and the assertion must stop pinning it. State: `open`, batch 3.

**L33 — "its output, if it produced any, is in the job log" is false.** Observed: both hints in
`job-reconcile.mjs`. Evidence: `codex-plain` — a worker killed after `runJob` returns but before
`finish` or `salvageOutcome` holds the answer only in memory. Disposition: **accepted, in scope, text**.
State: `open`, batch 3.

**L34 — "a file this plugin did not write is not this plugin's to delete" is false.**
Observed: `job-retention.mjs` `orphanSeqs` and its duplicate in `adr/014`. Evidence: `codex-plain` —
the code recognises NAMES, not creators: a user-created `77.cancel-ack` with no row 77 matches and is
deleted, and the existing test only shows that a non-matching `notes.txt` survives. Pre-existing
wording, in two lines this diff rewrote. Disposition: **accepted, in scope, text**. State: `open`, batch 3.

**L35 — "every failure of open, stat, read or close reads as no acknowledgement" is false.**
Observed: `cancel-ack.mjs` header. Evidence: `codex-plain` — a close that throws AFTER a successful
match is swallowed by the `finally` and the computed `true` stands. That is the right behaviour; the
sentence is what is wrong. Disposition: **accepted, in scope, text**. State: `open`, batch 3.

**L36 — the `MAX_SAFE_INTEGER + 2` fixture is INERT.** Observed: `tests/retention.test.js`, L17's own
witness. Evidence: both lenses — `9007199254740993` maps to absent `…992.*` paths, both unlinks fail,
`logs` stays empty and every assertion passes with the round trip removed. **A fixture that cannot
fail inside a witness that can is the same defect one layer down.** Disposition: **accepted, in
scope** — add the rounded-target bystander `9007199254740992.log` that must survive, so the mutation
deletes it. State: `open`, batch 3.

**L37 — two ledger inaccuracies, and the digest binds the ledger.**
(a) L17's rider says the `OWNED_NAME` overclaim was *"narrowed in the same edit"*; the audit found it
was DELETED — the constant sits bare. (b) Batch 2's mutation accounting names only M1 as standing;
**M3 and M4** attach to `O_NOFOLLOW` / `O_NONBLOCK` in `cancel-ack.mjs`, which batch 2 edited, and
they do stand because those edits were prose-only — but that must be stated, not left inferable.
Disposition: **accepted** — both corrected in batch 3. State: `open`, batch 3.

**Confirmed and requiring nothing:** `ownedSeq`'s comparison is against the capture and is not
trivially true; no filename the plugin can produce is rejected; L17's witness DOES redden without the
round trip (the `1e+21` bystander is deleted and `logs` becomes non-empty); L19, L22, L23, L25, L26
are present and do what their entries say.

## Batch 3 — applied, green

Snapshot `ladder-snap.HLjsLZ`. Suite: **820 pass / 0 fail**.

Applied: L27, L28, L30, L31, L32, L33, L34, L35, L36, L37. L29 discharged inside pass 3 as evidence.

**The five claim-greps were run FIRST, before any cited line was touched** — the L12/L21/L27 lesson,
now on its third instance — and the site counts recorded: `more permissive` 1; `0700` 9, of which 4
are unrelated (credential mitigation, `job-store.mjs`, `adr/015`); `does not delay` 1; `exits anyway`
2 (one a test NAME, which stays); `not recorded anywhere` 2 (code + the test that pinned it);
`in the job log` 2 (BOTH hints in `job-reconcile.mjs`); `did not write` 3, of which one is an
unrelated `queue-reconcile` header.

**Ledger corrections (L37), because the pass digest is computed over this file:**
(a) L17's rider said the `OWNED_NAME` overclaim was *"narrowed"*; it was **DELETED** — the constant
sits bare. (b) Batch 2's accounting named only M1 as standing; **M3 and M4 also stand**, attaching to
`O_NOFOLLOW`/`O_NONBLOCK` in `cancel-ack.mjs`, whose batch-2 edits were prose-only.

### M8 found a check that could not fail — in batch 3's own fix

L30 was accepted as *"add `Number.isSafeInteger`"* beside the round trip. Re-running **M7** against the
post-batch witness returned **GREEN**, which should have been impossible if both terms decided
anything. Measured directly:

| name | `isSafeInteger` | round-trips |
|---|---|---|
| `9007199254740992` | false | **true** |
| `9223372036854776000` | false | **true** |
| `9007199254740993` | false | false |
| `1000000000000000000000` | false | false |

Given `^[1-9]\d*$`, **`isSafeInteger` implies the round trip** — a safe value has at most sixteen
digits, and every such string converts and prints back identically, while everything that fails to
round-trip is by construction past `2^53`. So the conjunction's second term could never decide
anything: a check that cannot fail, shipped with a docstring claiming it worked. **Removed**, with the
reasoning and the measurement written where the code is, and `adr/014` rewritten to match.

That is a defect this ladder introduced in batch 3 and caught in batch 3, before the boundary closed.

| # | Mutation | Result |
|---|---|---|
| M7 | drop the round trip, keep the bound | **green** — which is what exposed the redundancy |
| M8 | drop `Number.isSafeInteger` | reddens L17/L30's witness ✔ (restored, `diff` identical) |

**M1–M6 all stand.** Batch 3 touches `job-reconcile.mjs` hint text, `job-retention.mjs`,
`cancel-ack.mjs` header prose, `adr/014`, `BACKLOG.md` and three test bodies — none is a mechanism
M2–M6 attach to, and `job-reconcile.mjs`'s state split (M1) is untouched. Stated, not inferred.

L36's fixture repair landed with it: the witness now also plants `9007199254740992.log` (what the
rounding would take) and `9223372036854776000.log` (past any legal sequence, and the case the round
trip alone would have missed), six survivors in all.

## Verification-only pass — `adr/089`, checkpoint `3bd521e81424`

Opened with `--open-verification`. It has **no stages and opens no new finding lenses**: it verifies
batch 3 and nothing else. Batch 3 contains real executable change (`ownedSeq`, the FIFO loop), so
verifying it is in scope and REVIEWING it is not — a new defect found here goes to the USER under
`adr/089`, never to a fourth discovery pass or a second unbudgeted batch.

**Green measured where it is claimed, not in the working tree.** The tracked files were extracted with
`git ls-files | tar` into a clean directory, the three untracked files copied in, and the suite run
there: **820 pass / 0 fail**. A working tree can be green on state a commit would not carry.

**Live, post-batch-3, against LM Studio `qwen/qwen3.6-27b`.** Job `7e1e0356` submitted (which runs the
rewritten `ownedSeq` through `sweepQuietly` on every submission), cancelled while running, and read
back: **`cancelled`**, with `20.cancel-ack` present in the state directory. The full path this feature
exists for still works end to end after three batches.

Earlier live evidence stands unre-run and is scoped rather than re-claimed: `f5f334b6` (cooperative
cancel → `cancelled`) and `645e2aa4` (SIGKILL with a cancel pending → `failed` /
`cancel-unconfirmed`) attach to the cancellation mechanism, and **every** edit to `cancel-ack.mjs` and
`job-heartbeat.mjs` across all three batches was prose. `a6311f9e` covers the sweep path post-batch-2.

**Mutation state at the verdict point:** M1 (the `queued`/`running` split), M2 (the ack read), M3
(`O_NOFOLLOW`), M4 (`O_NONBLOCK`), M5 (`writeCancelAck`'s guard), M6 (the size ceiling) and M8 (the
safe-integer bound) all discriminate. M7 is **retired**: it removed a term that measurement showed
could never decide anything, and the term is gone.

## Verdict point — CHANGES-REQUIRED, digest `37a62c2ff8a2`

Codex dissented. **A dissent from either approver ends the verdict point** (`adr/054`), so the Claude
verdict-only subagent was NOT asked — obtaining the second verdict only when the first approves is the
rule, and asking anyway would have been a guaranteed-redundant call. Read through
`check-plan-gate.sh --extract`, never by eye.

It accepted the two deferrals explicitly: *"OAI-149 and OAI-150 are acceptable deferrals, not evasions:
both disclose precise preconditions, impact, remedy, and witness bars."* The rejection is entirely
**false claims in artifacts this change authored** — the ship-blocking class.

**V1 — L35 was applied to `cancel-ack.mjs` and missed `job-reconcile.mjs`.** That docstring still says
*"Every failure of that check reads as absent"*, which `cancelAckMatches` contradicts: a `closeSync`
that throws after a successful match preserves the `true`.

**V2 — L28 is not actually applied where it was claimed.** `job-heartbeat.mjs` still says *"A write
that FAILS does not delay the exit"*. Codex is right and sharper than the ledger was: **failing is not
the same as failing FAST** — a synchronous filesystem call can block for a long time and then fail, so
the sentence is false on its own terms, not merely incomplete. `adr/014` already says this correctly;
the module does not.

**V3 — the approved PLAN still carries two claims the ladder adjudicated false**: that every
acknowledgement-check failure reads as absent, and that anyone able to write `logs/` can write
`jobs.db`.

**V1 and V3 are the FOURTH instance of one failure mode** — L12, L21, L27, now this: a claim-grep that
covers the sites a finding cited and not the sites the CLAIM lives at. Batch 3 ran five greps over
`adr/`, `scripts/`, `tests/`, `CLAUDE.md` and `BACKLOG.md` and **excluded `plans/`**, which is where V3
was hiding, and V1's wording differs enough from `cancel-ack.mjs`'s that a grep for the latter's phrasing
would not have found it.

**This goes to the USER** (`adr/089` D2): one final batch is the concession the verification pass
already spent, and an unbounded tail is what the cap exists to prevent. No fourth discovery pass and no
second unbudgeted batch are taken on this session's own authority.

## Dissent remedy — applied on the user's decision, then re-verdicted

The user chose *fix the three and re-run the verdict point*. Applied, text only, no executable change
and no test change; suite **820 pass / 0 fail**.

- **V1** — `job-reconcile.mjs` now says a failure to open, stat or read reads as absent, and names the
  close as the exception, pointing at where `cancel-ack.mjs` argues it.
- **V2** — `job-heartbeat.mjs` now claims what is actually true, and it is a claim about CONTROL FLOW
  rather than latency: the write's outcome is not waited on — nothing retries or escalates on it —
  while `openSync` itself may block a long time and then fail, so the exit is no earlier for the
  failure. Both the docstring and the call-site comment were wrong in the same way; both are fixed.
- **V3** — the plan gets an **ERRATA section**, and its body is deliberately NOT rewritten: those bytes
  are what the plan gate's approving archive attaches to, and silently editing them would falsify the
  one O(1) record of what was approved. The errata names both claims, states what is true, and points
  at this ledger and OAI-150.

**The grep was run over `plans/` this time**, which is where V3 was hiding and which batch 3's five
greps excluded. Also re-checked: `every failure` has nine other sites across the repo, all unrelated
and all true in their own context (`http-errors.mjs`, `model-info.mjs`, `answer-attempts.mjs`,
`job-retention.mjs`, `adr/019`, three tests).

## Re-verdict on `ea8fe6071daf` — the approvers SPLIT, so it is not approved

- **Codex: APPROVE.** *"Nothing remains that I would reject on. The errata is adequate: it precedes the
  unchanged approved body, explicitly retracts both false claims, and preserves the archived approval
  record. The code now states the close and synchronous-write behavior accurately. OAI-149 and OAI-150
  are acceptable, precisely bounded deferrals — not evasions — and the relevant witnesses discriminate
  under the recorded mutations."*
- **Claude verdict-only subagent: CHANGES-REQUIRED.** A fresh general-purpose agent, given the diff,
  the criteria, the ledger and the bar, and none of this session's reasoning. Its grounds were then
  requested separately; the verdict itself was not re-litigated.

`check-plan-gate.sh --dual-approved` returns **exit 1**. One approval and one dissent is not approval,
and the gate fails closed by design — the split is recorded rather than resolved by preference.

Both verdicts are reported to the user unresolved. The ladder marker is already `--terminate`d, so
nothing here is a fourth pass or an unbudgeted batch: this is the user's decision under `adr/088`,
where approval is EITHER the two approvers in agreement OR the user's.

## The dissent's grounds — correct, and Codex missed them

The Claude approver rejected on ONE defect in two artifacts, and it is a real falsehood:

**W1 — "exactly equivalent" is false; the relation is an IMPLICATION.** Within `^[1-9]\d*$`,
`Number.isSafeInteger(n)` **implies** `String(n) === capture`; the converse fails, and the ledger's own
M8 table names the two counterexamples — `9007199254740992` and `9223372036854776000` both round-trip
and neither is safe. Batch 3's docstring drifted from the true form to a bi-conditional.
**Why it matters rather than being pedantry:** equivalence would mean either term alone suffices, and
the very next sentence of `adr/014` said one of them does NOT — *"the round trip alone would not have
done"*. The two sentences were mutually exclusive on adjacent lines, and the falsifying input is
planted as a live fixture in `tests/retention.test.js` expecting to survive. **The artifact carried its
own counterexample.** A reader deciding whether to re-add the round trip was misled by it.
Fixed in `job-retention.mjs` and `adr/014`, text only: the code is correct as written and `ownedSeq` is
untouched. Suite **820 pass / 0 fail**. A repo-wide grep for `exactly equivalent` now returns nothing.

**W2 — a sixteen-digit phrasing that reads two ways** (*"a value is safe only when it has at most
sixteen digits, and every such string converts exactly"*): true when *"such string"* means a safe
value, false read as *any* sixteen-digit string — `9999999999999999` becomes `10000000000000000`. The
approver would not have blocked on it alone; it is gone with W1's rewrite rather than left to be
reintroduced.

**What the split demonstrates.** Codex approved this artifact while it contained a self-contradiction
across two adjacent lines of an ADR. The second approver is not ceremony: `adr/010`'s requirement that
the Claude half be an independent verdict-only subagent rather than `advisor` or the authoring session
earned its cost here, on the one pass where it was tested against a real disagreement.

The approver separately re-ran **M8 by hand** — `return seq;` at `ownedSeq`, `logs` came back
`[1e+21, 9007199254740992, 9223372036854776000]` against an expected `[]`, restored and `diff`ed — so
L36's fixture repair is confirmed by a second party rather than only by its author. It also confirmed
820/0, both deferrals as supportable, every still-open entry's disposition, and the plan errata as the
right remedy for V3.

## Third verdict — CHANGES-REQUIRED on a USER-FACING false claim

Codex, having approved the previous version, rejected this one on something no earlier stage found —
and it is the first finding of this ladder that a user would actually have read.

**X1 — `/oai:status` promised an outcome this build no longer guarantees.**
`job-render.mjs` `noteFor`'s `cancelling` branch said *"it stops at its next check-in, and reads
cancelled once its worker has exited."* **OAI-66 falsified the second clause**: an exit alone stopped
deciding the verdict. A worker that crashes, or whose acknowledgement will not write, exits and reads
`failed` / `cancel-unconfirmed`. Someone told the first sentence and then shown `failed` would
reasonably conclude the plugin had lost their cancellation — which is the same misreading this whole
feature exists to remove, reintroduced through the status line.
Fixed: the note now names both outcomes and what decides between them. **M9**: revert the wording and
*"cancel records the request and terminalizes nothing"* reddens ✔ (restored, `diff` identical).
Suite **820 pass / 0 fail**.

**FIFTH instance of the claim-grep failure, and the most expensive kind.** L12, L21, L27, V1/V3, now
this. Every batch's greps covered `adr/`, `scripts/lib` modules touched by the diff, `tests/`,
`CLAUDE.md`, `BACKLOG.md` and finally `plans/` — and never `job-render.mjs`, because no finding had
cited it. **The claim did not live where the change lived.** `job-render.mjs` was not in the diff at
all: OAI-66 falsified a sentence in a file it never edited, which is precisely the case a
cited-site-driven grep cannot reach and a claim-driven one can.

This is now the ladder's most-repeated defect class, ahead of every defect in the feature itself, and
it belongs in the toolchain rather than in this feature's residue — see the step-8 report.

## Outcome — committed on the USER's approval, not on dual approval

The user directed the commit after the third verdict round. Under `adr/088` that is a legitimate
approval path — *approval is EITHER Codex and Claude in agreement, OR the user's* — and it is recorded
as what it is rather than dressed up as a clean close:

- **Dual approval was never obtained.** Round 1 Codex `CHANGES-REQUIRED`; round 2 Codex `APPROVE` and
  the Claude subagent `CHANGES-REQUIRED`, so `--dual-approved` exited 1; round 3 Codex
  `CHANGES-REQUIRED` on X1. The X1 fix has been seen by **no approver**.
- **The ladder marker was `--terminate`d** before the remedy rounds, so those rounds sat outside pass
  bookkeeping. Stated, not implied.
- **Every pass completed with a coverage gap** — `security-review` is structurally unreachable here.
- Ladder shape: 3 discovery passes × 5 stages, 3 batches, one verification-only pass, 3 verdict rounds.
  37 ledger entries plus V1–V3, W1–W2 and X1. Nine mutations, eight discriminating, M7 retired.

**Open at commit, all dispositioned:** L1, L2 (dismissed — plan deviations forced by the size ratchet,
recorded for the report); L4, L7, L18 (no defect); L29 (verification obligation, discharged live).
Nothing accepted is unapplied.

**Filed rather than built:** OAI-149, OAI-150 — cleared by both approvers as bounded deferrals, with
the shipped artifacts stating their residuals instead of asserting safety.

### Coverage gaps

- `security-review` did not run and cannot run in this repo; its lens folds into `codex-adversarial`.
  The pass therefore completes **with a coverage gap**, never clean.
- The per-phase `advisor` tripwires for phases 1–3b did not run: the advisor was overloaded on three
  consecutive attempts. It recovered in time for `advisor-opener`, which read the same ground.
