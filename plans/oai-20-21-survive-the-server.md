# OAI-21 + OAI-20 — The bench keeps its evidence; the client survives the server

> **Codex plan gate: APPROVED at round 2 of 20.** Round 1 returned CHANGES-REQUIRED with three
> defects, all folded in and accepted on re-challenge: (1) the ledger settled too early — `postChat`
> returns *successfully* for the completion-level shapes, which are only detected one layer up at
> `finishAnswer`, so settling inside `postChat` would record a dead request as a successful physical
> attempt with no reason code; (2) `errorReport` alone does not preserve all-failed evidence,
> because `bench/run.mjs:116` discards the error envelope except `reason`; (3) cold-timing
> aggregation accepts every successful logical run (`case-rows.mjs:60`), contradicting
> `caveats.mjs:164`'s claim that every `--cold` prefill is independent once an answering retry can
> be warm-eligible. Round 2 found no new contradiction. Its one non-blocking note — attach the
> ledger before *every* terminal rethrow, not only exhaustion — follows from the plan's own rule and
> was carried into implementation rather than amended in, on Codex's explicit advice.

## Context

`npm run bench` is the instrument this repo uses to decide whether `/oai:review` is getting better.
On 2026-07-30 it could not produce a number: across four full-corpus invocations, **27 of 72 runs
died server-side (37.5%)**, in two observed shapes — an empty completion (`finish_reason: unknown`)
and a stream closed mid-reasoning, ~50k characters in. Both models failed, so the locus is LM
Studio's shared serving path, not either model. OAI-19 (the baseline re-measure that every item
below it wants a number from) closed **blocked**, and the failure rates became OAI-20.

Two problems sit behind that, and this feature fixes both.

**The client cannot tell a dead request from a bad answer.** A dropped request surfaces as a bare
`UserError` with no machine-readable cause, and there is no retry anywhere in the request path —
the only loops are capability-degrade ladders. So the harness records a server failure in the same
bucket as a model that answered badly, and a recall denominator quietly counts missing data as an
observed miss. That is the censored-denominator trap this repo has already caught once in its own
prose.

**The bench does not keep its own evidence.** `run.mjs` writes the JSON record but prints the
rendered Markdown — the human-readable form of every caveat — to stdout only. Last session it
survived because each arm's nohup log was copied beside the record by hand, and Codex's plan
challenge had already flagged that a reused log path would have silently overwritten arm 1's
report. Separately, each arm's first measured case carried the JIT model load until a warm-up was
scripted around the harness by hand.

Intended outcome: OAI-20 and OAI-21 both land, so the OAI-19 re-run's evidence and timing are clean
by construction and its runs survive a flaky server. **This feature does not run the arm** — that
is OAI-19, and it is next.

## Decisions (grilled and settled — not open for re-litigation)

- **Done gate**: OAI-20 closes on code + tests green against the in-process fake server, with each
  failure shape covered by a network-free fixture. The live full-corpus proof belongs to OAI-19,
  which has to run anyway. A clean arm is evidence about the *server*, not about this code.
- **Four failure shapes**, all retryable, all with structured reason codes assigned at the point of
  detection — never matched out of prose.
- **`--max-attempts` counts ANSWER attempts, default 3**, exposed on review and task and passed
  through by the bench; `attempts[]` counts *physical requests*. These are different numbers on
  purpose. `--max-attempts 1` reproduces today's behaviour exactly and is the control arm that
  measures the unretried failure rate on the same run.
- **The prompt is byte-identical across retries** (not re-minted). Each attempt records whether its
  prefill *could* have been served warm; the report refuses to quote a warm attempt as a cold
  measurement.
- **A short fixed delay before each retry**, recorded on the attempt, so the next characterization
  run can say whether pacing helped rather than us guessing again.
- **One attempt record per physical HTTP request**, whatever caused it — first try, degrade rung,
  `response_format` fallback, failure retry.
- **Wall clock is documented, not capped.** Without `--max-seconds` there is no finite worst case
  today, and retry multiplies it; `--max-seconds` already exists as the answer and the bench passes
  it. Inventing a default cap would silently kill long legitimate reviews on slow hardware.
- **`--warm-up` warms once per distinct resolved provider/model pair**, carrying the invocation's
  timeout and cap.
- **Bench reporting = Codex's A+**: a new `## Physical-attempt reliability` section leading with
  both denominators; the existing section renamed `## Logical runs that did not complete`.

## Codex challenge findings, folded in

Three were genuine defects in the pre-plan brief:

1. **`--max-attempts` was internally inconsistent.** Capping *physical* requests at 1 would disable
   capability degradation, since `postWithDegrade` (`chat.mjs:151`) already issues up to three.
   Redefined above as answer attempts.
2. **Re-entering `postWithDegrade` re-sends a rejected payload.** Its `removed` set and `payload`
   are locals reset per call (`chat.mjs:152`), so: server refuses `stream_options` → degraded
   request streams → truncated → retry starts from the *original* body → same 400 → reclimbs. The
   negotiated payload must persist across answer retries.
3. **"No attempt dispatched that the deadline can't fit" is not computable.** `capBudgets`
   (`chat.mjs:193`) knows only the remainder and refuses at zero; it cannot know whether an answer
   will fit. Narrowed to: never *begin* a delay or dispatch after expiry, and let the total timer
   kill an in-flight attempt.

And four refinements taken as stated: the retry loop spans `postWithDegrade → finishAnswer` **inside**
`chatCompletion` (wrapping `requestFindings` would re-run prompt sizing and the oversize ladder —
retrying the wrong thing); attempt records originate at **`postChat`**, the one-request-per-call seam,
finalized from `catch`/`finally` so failed attempts keep timings that are otherwise measured and
discarded; the ledger is **attached to the final error**, or an all-attempts-failed run has no
`attempts[]` in the bench JSON at all — precisely the data this exists to collect; warm-eligibility is
computed from the **actual serialized messages**, since the `response_format` fallback changes the
prompt.

## Phase 1 — OAI-21: the bench keeps its evidence

**`bench/run.mjs`** (268/300 lines — extraction required, see below)

- Compute the stamp **once, before rendering**; today it is minted at `run.mjs:252`, after the
  markdown renders at 238–246. Write `<stamp>.md` beside `<stamp>.json`, same gitignore rationale.
  Echo both paths to stderr.
- Add `--warm-up` (boolean) to `SPEC` at `run.mjs:31`.

**New `bench/lib/warm-up.mjs`**

- Resolve the distinct `{provider, model}` pairs across the selected cases — CLI flags override a
  case's own pins, per `run.mjs:63`. Today's corpus resolves to one pair, so this costs nothing now
  and is correct the moment a case pins a model.
- Before the first case using each pair, issue one tiny unscored request through the real CLI,
  carrying the invocation's `--timeout`/`--max-seconds` so the warm-up cannot itself hang.
- Return what was warmed and when; `run.mjs` stores it in the record so it states that warm-up ran
  rather than leaving the raw `options` object as the only evidence.

## Phase 2 — Failure classification

**New `scripts/lib/failure-shape.mjs`** — the reason-code constants and the retry whitelist in one
place, so the predicate is a list of codes rather than a scatter of checks.

**`scripts/lib/completion.mjs`** — `finishAnswer` (:90) tags its refusals and gains the fourth shape:

| # | Shape | Where | Code |
|---|---|---|---|
| 1 | no message channel present at all | `completion.mjs:91`, exists | `empty-completion` |
| 2 | stream ended without `[DONE]` and without a `finish_reason`, HTTP clean | `completion.mjs:96`, exists | `stream-unfinished` |
| 3 | connection closed mid-body | `http.mjs:92`, exists, already tagged | `transport` |
| 4 | at least one channel present, response finished, **every present channel exactly zero-length** | new, ordered after 1 and 2 | `blank-completion` |

Shape 4 uses **length, not `trim()`** — a whitespace-only reply is a real reply and must survive.
Reasoning-only stays valid here: non-empty `reasoning` prevents the blank classification, so
`/oai:task` keeps its specific "only internal reasoning" diagnostic at `client.mjs:104` rather than
retrying a deliberate response. `UserError` already carries `.reason` (`errors.mjs:16`), so this is
a constructor argument, not a new field.

## Phase 3 — The shared attempt ledger

**New `scripts/lib/attempt-ledger.mjs`**

- `createLedger()` → `{ begin(request), entries() }`. `begin` returns a handle finalized with
  `settle(outcome)` / `fail(error)`.
- Each entry: index, cause (a chain, not a flat string — one request can be both "failure retry 2"
  and "stream_options degrade"), outcome, reason code, `prefillMs`, `generationMs`, delay waited,
  and `warmEligible`.
- **`warmEligible`** = an earlier dispatch in this ledger used the same requested model and
  byte-identical serialized messages. It means "a prior dispatch had a cache-compatible prompt",
  never "the cache was warm" — the harness cannot observe a hit, exactly as `caveats.mjs:68`
  already says of the existing cache note.

**Plumbing**: `cmd-review.mjs` / `cmd-task.mjs` mint one ledger per command, beside the existing
`expiresAt`, and thread it → `requestFindings` → `chatCompletion` → `postWithDegrade` → `postChat`.
Review passes the **same** ledger to both `chatCompletion` calls (`review-request.mjs:228,250`), or
physical indexes reset and the structured request vanishes from the record. `reviewFlow` already
occupies the full 60-line function budget, so its new plumbing needs consolidation or extraction.

**`scripts/lib/chat.mjs`** (261/300): `postChat` (:210) records each dispatch. Timings must be
finalized from `catch`/`finally` with access to `firstTextAt` — today `collectStream` (:81) returns
them only on success (:117) and the catch at :113 discards them.

**A handle must not settle before `finishAnswer` has judged it.** `postChat` returns *successfully*
for shapes 1, 2 and 4 — they are only detected one layer up at `completion.mjs:90`. Settling the
entry inside `postChat` would therefore record a dead request as a **successful** physical attempt
with no reason code, which is the exact data corruption this feature exists to prevent. So: an
attempt rejected at the transport or by a capability rung finalizes inside `postChat`, but the
handle for a request that *returned bytes* stays open and is settled or failed around
`finishAnswer` in the answer-attempt loop.

## Phase 4 — Bounded retry

**New `scripts/lib/answer-attempts.mjs`** — `chatCompletion` is 41 lines and `chat.mjs` is at
261/300, so the loop gets its own module rather than pushing either past the ratchet.

- Extract "one answer attempt" = `postWithDegrade` → `finishAnswer`. Loop it up to `maxAttempts`
  (default 3, from a named constant beside `DEFAULT_TIMEOUT_MS`).
- Retry only on a whitelisted reason code from Phase 2. Everything else rethrows immediately, as now.
- **Carry the negotiated capability state across attempts** — Codex finding 2. Hoist
  `postWithDegrade`'s `removed` set and `payload` into a caller-owned object so a retry resumes with
  the payload that reached generation, instead of knowingly re-sending a body the server already
  400'd.
- Wait a short fixed delay before each retry; record it. Before both the delay and the next
  dispatch, stop if `expiresAt` has passed. Do not attempt to predict whether an answer "fits".
- On exhaustion, throw the last error **with the ledger attached**.

**`scripts/lib/client.mjs`**: `chatCompletion` keeps building the body and delegates the loop.

**Surface**: `--max-attempts` in `commands/review.md` and `commands/task.md` (guarded by
`tests/plugin.test.js`), parsed in `cmd-review.mjs`/`cmd-task.mjs` via the existing `parseNumber`
with a sane minimum, and passed through by `bench/run.mjs`. Document in the flag help and the ADR
that attempts multiply an already-unbounded wall clock unless `--max-seconds` is set.

**`/oai:task` behaviour note**: a blank reply now costs up to three calls before the same eventual
failure. That must be visible — the footer/error says how many attempts were spent, or it reads as
an unexplained hang.

## Phase 5 — Record shape and bench reliability reporting

**`scripts/lib/review-report.mjs`**: `jsonReport` (:123) gains `attempts[]`. `retried` stays,
derived from the ledger — which also fixes the reset bug that `|| !structured` (:106) currently
papers over. Top-level `prefillMs`/`generationMs` remain the **answering attempt's**, as the comment
at :85–100 already promises. `errorReport` (:201) emits the ledger so an all-failed run still
carries its attempts.

**`bench/run.mjs`**: emitting `attempts[]` from `errorReport` is **not sufficient on its own** — the
harness currently discards the whole error envelope except `reason` (`run.mjs:116`). `reviewOnce`
must parse and retain `attempts[]` from a nonzero-exit stdout, or an all-attempts-failed run — the
case with the most reliability evidence — contributes none of it.

**Cold-timing independence must stop being assumed.** `caveats.mjs:164` claims that under `--cold`
every prefill figure is independent, and cold timing aggregation currently accepts every successful
logical run (`case-rows.mjs:60`). Once a run can be answered by a **warm-eligible retry**, that claim
is false and nothing detects it. Fix: identify the physical attempt that supplied the top-level
timings, exclude it from cold samples when `warmEligible`, and amend the caveat to say so. This is
the same censored-measurement class as the recall denominator, one layer over — and it is exactly the
number OAI-19 reads.

**New `bench/lib/attempt-rows.mjs`** — aggregate physical attempts by reason code, case, and
requested model, plus warm-eligible counts.

**New `bench/lib/reliability-report.mjs`** — render `## Physical-attempt reliability`, leading with
both denominators together:

> 18 logical runs: 17 scored, 1 did not complete.
> 27 physical attempts: 9 failed (33%).

Then compact tables by reason code, by case, and by requested model. Detailed stderr stays only
under exhausted logical runs — successful retries get aggregate counts, not repeated dumps.

**`bench/lib/report.mjs`**: `renderReport` is **exactly 60 lines** (:119–178), so it cannot absorb a
single line. Extract one existing supplemental block (the unmatched/failure/substitution rendering)
into its own function, then add the reliability call. Rename the existing section to
`## Logical runs that did not complete` — parallel naming is what makes the distinction
self-evident, and that heading already deliberately means logical runs, which is why substitutions
are excluded from it (:145).

**`bench/lib/caveats.mjs`** (233/300): one new caveat only — warm-eligible is not an observed cache
hit. The reliability *result* does not go here; caveats state what figures mean, and a reason-code
table there would turn prose into a second results channel and force physical-attempt data into
logical `rows`.

## Verification

Run the repo `verify` skill (`.claude/skills/verify/SKILL.md`). Plus:

- **New `tests/retry.test.js`** — the fake server produces each of the four shapes; assert the
  reason code, that retry fires, that `attempts[]` holds one entry per physical request with its
  own timings, that `--max-attempts 1` reproduces today's behaviour, and that an all-failed run
  still carries `attempts[]` on the error path. Async only — **never `spawnSync` against the
  in-process fake server** (a 204-second hang; `tests/structure.test.js:136` bans it anyway).
- **Capability-state regression**: refuse `stream_options`, then truncate the degraded stream, and
  assert the retry does **not** re-send `stream_options`. This is Codex finding 2 and nothing else
  covers it.
- **Split-scope test**: 2 failed + 1 successful attempt → top-level timings are the successful
  attempt's, `attempts[]` has three entries, recall denominator contribution is 1. This is the
  backlog's "scoring reads logical runs, reliability reads all physical attempts" made executable.
- **Ledger-settling test**: a request that returns bytes but is refused by `finishAnswer` must be
  recorded as a **failed** physical attempt carrying its reason code — never as a successful one.
- **Error-envelope test**: an all-attempts-failed run's `attempts[]` survives the bench's nonzero-exit
  path (`run.mjs:116`) into the JSON record.
- **Cold-independence test**: a run answered by a warm-eligible retry is excluded from cold prefill
  samples.
- Extend `tests/bench-report*.test.js` for the renamed section and the reliability section;
  `tests/plugin.test.js` for `--max-attempts`.
- **Mutation check** on the key invariant: remove a code from the retry whitelist (or flip shape 4's
  length test to `trim()`), confirm a named test goes red, restore, re-run green, and prove the
  restore against a copy — not by eye, and not with `git diff --quiet`, since the tree is dirty.
- `tests/structure.test.js` must stay green throughout: 300 lines/file, 60 lines/top-level function,
  **empty allowlist**. `chat.mjs` (261), `review-request.mjs` (253), `bench/run.mjs` (268) and
  `caveats.mjs` (233) all have little headroom, which is why extractions are planned up front
  rather than arrived at.

## Carried into implementation, not assumed

The backlog asks whether the 10-minute JIT TTL can unload a model under a long prefill. That is a
plausible *mechanism* for shape 1 — if the TTL counts idle time and a long prefill does not register
as activity, an unload mid-prefill produces exactly an empty completion with
`finish_reason: unknown`. If it is the cause, `--warm-up` and pacing matter more than retry does.
It gets characterized from the attempt record during OAI-19, not assumed here.

## Not in scope

Running the OAI-19 arm. The OAI-13 vendor-dependent findings. Arm-level retries — the retry lives
inside one companion invocation, because a bench-level re-run re-pays a whole `--cold` prefill for
every survivor, which is why arm-level was the wrong layer twice.
