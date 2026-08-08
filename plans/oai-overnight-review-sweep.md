---
provenance: harness slug humble-snacking-melody
---

# Overnight review sweep — local models review recent commits, newest-first

## Context

You want to leave the machine overnight and have local models review recent work, so that in the
morning there is a list of concerns to triage. Today there is no way to do that: `/oai:review` reviews
**one** target per invocation and is interactive.

This is deliberately **not** shaped like the last run. The harness is built now, attended, through the
normal gates — so plan mode is available and nothing ends `blocked-on-plan`. Only the *run* is
unattended.

**The dominant risk is OAI-115, and it is unfixed.** `max_tokens` is a single pool shared by reasoning
and the answer; on a large target the model spends it all thinking and emits no findings. Measured:
the MoE starved on 4–5 of 6 benchmark cases, the dense model on 1 of 6. A sweep that ignores this
would report a starved night as a clean one. **Per-commit targets are the main mitigation** (small
inputs leave budget for the answer), and honest classification is the backstop.

### Decisions already made with you

One commit = one review · time-boxed, newest-first, stop at a wall clock · dense `qwen/qwen3.6-27b`
first but the model must be switchable · **raw collection only, no verification** · one dated report
file, **tracker untouched** · machine stays awake, LM Studio is sole-tenant and already running, hard
per-commit time cap.

## The one production change — and why it is load-bearing

`scripts/lib/review-report.mjs:32` throws `UserError('… ran out of tokens before it finished writing
its findings.')` **without a `reason`**. `UserError` supports one (`scripts/lib/errors.mjs:13`), and
`errorReport` surfaces `reason` into the `--json` envelope.

Without a reason the sweep would have to **match on the message prose** to tell "starved" from
"broken" — which is precisely the defect class this repo already filed as OAI-13 ("read the structured
field, not the prose") and which `bench/lib/outcome.mjs` refuses to do ("never regex stderr for a
cause").

**Change:** add `reason: 'token-exhaustion'` to that throw. One line. It plugs into
`reasonFrom(bench/lib/outcome.mjs:32)`, which already reads `reason` off the failure envelope.
Everything else here is new files.

## Design

### `bench/review-sweep.mjs` — the harness

Follows **`bench/task-run.mjs`**, not `bench/run.mjs`. That matters: `run.mjs` calls `main()` unguarded
at module scope and therefore **has no test at all** (stated at `tests/task-bench-run.test.js:3-5`).
`task-run.mjs` has a guarded main and takes its executor as a parameter —
`runSweep(cases, options, { execute = invoke })` (`bench/task-run.mjs:79`) — so it is fully testable
with no model. Copy that seam exactly.

- **Enumerate**: `git log --no-merges --format=%H` from `HEAD`, newest-first.
- **Filter**: a commit is reviewed only if it touches one of `--include` (repeatable, default
  `scripts`, `bench`, `tests`). Without this the sweep would spend the night reviewing `HANDOVER.md`
  and `plans/` — **the six most recent commits on this branch are exactly that**. Filtered commits are
  recorded as `skipped-no-code`, never silently dropped.
- **Review one commit**: `execFileSync(process.execPath, [COMPANION, 'review', '--commit', sha,
  '--json', '--max-seconds', …, '--max-attempts', …, …model/provider passthrough])`, mirroring
  `bench/run.mjs:113`. `--max-attempts` matters: LM Studio drops ~1/3 of long requests.
- **Deadline** — `--until <HH:MM>` (local 24-hour, resolved to its **next occurrence** after start, so
  `--until 06:00` at 23:00 means tomorrow morning) **or** `--minutes <N>`; exactly one, and it is
  **required** — a sweep with no stop condition is not the thing you asked for, so it must not be
  defaultable. Checked **immediately before starting each review, never after** — the same discipline
  as `awaitTurn` (`job-queue.mjs:167-172`), which reads its cap "at the last moment before the thing
  it authorises". A review already running is never killed; overshoot is bounded by `--max-seconds`.
- **`--max-commits` counts ELIGIBLE commits** — those surviving `--include` — not enumerated ones.
  Counting enumerated commits would make `--max-commits 2 --include scripts` review *nothing* on this
  branch, whose six most recent commits are all docs. Enumeration walks back as far as it must to find
  that many eligible commits, bounded by `--scan-limit` (default 200) so a repo with no matching
  commits terminates.
- **Fail fast**: `--abort-after <N>` (default 3) **consecutive** failures whose reason is structurally
  a transport failure. Predicate imported, never re-derived: `TRANSPORT` and
  `NON_RETRYABLE_TRANSPORT` from `scripts/lib/failure-shape.mjs:53,66`, plus `crashed` (below). If
  LM Studio died at 01:00, the night should not be spent timing out against it.

### Per-commit classification — the honest core

**Classification order matters, and the two helpers do different jobs.** The challenge caught the plan
conflating them: `outcomeFor` (`bench/lib/outcome.mjs:84`) does a bare `JSON.parse` and checks only
model substitution — it does **not** validate failure envelopes; `reasonFrom` is the one that accepts
only `{ error: true }`. Reversed, malformed stdout throws and an error envelope is mishandled.

**Both helpers take RAW STDOUT, not a parsed document** — `reasonFrom(stdout)` (`outcome.mjs:32`) and
`outcomeFor(stdout, diffOnly)` (`:84`) each parse internally. Handing either a parsed object returns
`null`/garbage. `reasonFrom` is safe on anything (it catches); **`outcomeFor` does a bare `JSON.parse`
and will throw**, which is what makes the ordering below load-bearing rather than stylistic.

**The pipeline, in this order:**
1. Capture the child's exit status and **raw stdout**.
2. **No stdout, or stdout that will not `JSON.parse`** → `crashed` (non-zero exit) / `unreadable`.
   Nothing below runs. This is the step that stops malformed output throwing inside `outcomeFor`.
3. **`reasonFrom(stdout)`** — a non-null reason means a **failure envelope**: `starved` when the reason
   is `token-exhaustion`, otherwise `failed`, with the transport predicate deciding whether it feeds
   `--abort-after`.
4. **Only a valid non-error report reaches `outcomeFor(stdout, …)`**, for substitution and findings.

| Outcome | Condition | Counts as reviewed? |
|---|---|---|
| `findings` | parsed, `findings.length > 0` | yes |
| `clean` | parsed, `findings` is `[]` | yes |
| `unreadable` | `parsed: false` | **no — UNKNOWN** |
| `starved` | error envelope, `reason: 'token-exhaustion'` | **no — UNKNOWN** |
| `substituted` | `outcomeFor` reports `model-substituted` | **no — UNKNOWN** |
| `crashed` | child exited non-zero with **no parseable envelope** | **no — UNKNOWN** |
| `failed` | error envelope, any other reason | **no — UNKNOWN** |
| `skipped-deadline` / `skipped-no-code` | never attempted | **no** |

Three of these were added after the plan challenge and each closes a way the night could lie:

- **`substituted`** — the server answering with a *different* model than asked for produces a perfectly
  well-formed report. Counted as `findings`/`clean` it would silently attribute one model's review to
  another, which matters precisely because you want to switch models and compare. **The report records
  the answering model per commit, not once in the header.**
- **`crashed`** — a child that dies without emitting an envelope (OOM, a killed process, a segfault of
  the kind OAI-51 documents) has no `reason` at all, so it fits no envelope-based branch and would
  otherwise fall through.
- `findings: null` vs `[]` is a distinction `adr/003` exists to protect and
  `tests/review-json.test.js:83` pins — **do not collapse it.** `null` is unreadable, `[]` is clean.

### `bench/lib/sweep-report.mjs` — the morning report

Split out so the harness stays under the **300-line file / 60-line function** budgets that
`tests/structure.test.js` applies repo-wide (`ALLOWLIST` is empty — nothing is exempt).

Report shape, newest-first:
1. **Header** — commit range, wall-clock start/end, per-commit cap, and the model *requested*. The
   model that **answered** is recorded **per commit**, because it can differ per request and a single
   header value would assert a uniformity nothing enforces.
2. **Findings**, grouped by commit, each with file/line and the model's text, verbatim.
3. **COVERAGE — what was NOT reviewed and why**, every skipped/starved/failed commit listed with its
   reason. This section is the point: it is what stops a starved night reading as a clean one.
4. **A standing caveat**: these are unverified claims from a small model, to be treated as leads.

**Written by a dedicated writer in `sweep-report.mjs`, NOT by `persist` — reversing the first draft.**
`persist` hardcodes `<root>/bench/results` (`bench/lib/record.mjs:69`), so `--out-dir` cannot work
through it without changing shared code that three other harnesses depend on. A local writer is the
smaller change and buys `--out-dir` outright. **This is a deliberate non-reuse and the plan says so**
rather than leaving a later reader to wonder why the obvious helper was passed over.

**Two artifacts, and the brief already asked for both** — no contradiction to resolve. The option
chosen was *"one dated report file … **plus the raw `--json` per commit**"*: `<stamp>.md` is the
triage list you read in the morning; `<stamp>.json` is the machine record that makes a later
"since last sweep" mode and any model-to-model comparison possible. Same stamp, same directory.

**`bench/results/` is gitignored** — the report is durable on disk but is not committed, which matches
how every other bench record here is handled. The tracker is untouched, as you asked.

## What a commit-scoped review can and cannot see — a real limit, not a preference

Raised by the plan challenge and worth stating in the report itself.

**Better than it sounds:** `--commit` is not diff-only. `scripts/lib/git-diff.mjs` sends **each changed
file whole** alongside the diff, taking content **from the revision the diff describes**
(`adr/005`) — so the reviewer sees the full post-commit text of every file the commit touched, not
just the hunks, and "X is not defined" false positives are already designed out.

**But it still cannot see anything the commit did not touch.** A defect that only exists in the
relationship between the change and an *existing caller elsewhere* — a broken invariant, a type used
at a distance, a contract the rest of the repo depends on — is outside the target by construction. A
root commit has no parent, and the sweep must not treat that as a failure.

**Consequences, both binding:**
- The report describes its findings as **commit-local leads**, in those words. That is not modesty; it
  is the difference between "nothing found" and "nothing found *here*".
- **The smoke run must verify the actual target shape** — confirm the request really did carry whole
  files at the commit's revision, rather than assuming it from the ADR. One inspection, before you go
  to bed.

## Files

| File | Change |
|---|---|
| `scripts/lib/review-report.mjs` | **+1 line**: `reason: 'token-exhaustion'` on the exhaustion throw |
| `bench/review-sweep.mjs` | new — enumeration, filter, loop, deadline, classification, guarded main |
| `bench/lib/sweep-report.mjs` | new — markdown renderer |
| `tests/review-sweep.test.js` | new — DI-driven, no model |
| `tests/review-exhaustion-reason.test.js` | new — e2e for the tagged reason |
| `package.json` | `"review-sweep": "node bench/review-sweep.mjs"` |

Reused rather than rebuilt: `parseArgs` (`scripts/lib/args.mjs`), `UserError`, and the **exported**
`reasonFrom` / `requestedModelFrom` / `attemptsFrom` / `outcomeFor` (`bench/lib/outcome.mjs`).

**Two corrections to an earlier draft of this list, both caught at review:**
- **`failureEnvelope` is PRIVATE** (`bench/lib/outcome.mjs:54`, no `export`) and was wrongly listed as
  reusable. The harness never touches it — it reaches the same facts through the exported readers
  above, which is exactly why those readers exist.
- **`persist` is deliberately NOT reused** (see the writer note above).

**The transport predicate is a comparison, not an imported function.** No exported
transport-failure predicate exists; `failure-shape.mjs` exports the two reason *constants*
(`TRANSPORT:53`, `NON_RETRYABLE_TRANSPORT:66`) and the harness compares a reason against them locally.
That keeps the production surface to the single one-line change — **adding a shared predicate would
widen it, and is not needed.**

## Verification

1. **`npm test`** green (currently 692/0).
2. **Unit, via the injected `execute` stub** — no model, no child process. Cover **all seven** attempted-review
   classifications — `findings`, `clean`, `unreadable`, `starved`, `substituted`, `crashed`, `failed`
   — plus both skip reasons. (The first draft said "all six", which was one short of its own table.)
   Also: the deadline stops *starting* work but never truncates a running review; `--abort-after`
   fires on consecutive transport failures and **resets on any success**; `--include` filtering;
   `--max-commits` counting eligible commits; and **findings `[]` is `clean` while `null` is
   `unreadable`**.
3. **E2E for the production change** — `reviewScenario` + `startFakeServer`
   (`tests/helpers.mjs:13,246`) returning `finish_reason: 'length'`, then `runCompanion` with `--json`
   and assert the envelope carries `reason: 'token-exhaustion'`. **Must be async `spawn`** — a sync
   spawn deadlocks the in-process fake server, and `tests/structure.test.js:136-145` fails any test
   file containing `execFileSync`.
4. **Mutation check** on the classifier: force `starved` to classify as `clean`, prove the mutation
   landed with `mutation-landed.py`, name the failing test, restore, re-run green.
5. **A real smoke run before you go to bed** — `--max-commits 2 --include scripts` against live
   LM Studio, so the first time this touches a real model is *not* while you are asleep. This is the
   step that catches a wrong model id or a server that is not actually serving.

## Codex plan challenge — 4 rounds, APPROVE

Threads `019fe119`, `019fe11b`, `019fe11e`, `019fe11f`. Round 4 verbatim: *"No new contradiction or
missing interface prevents implementation as written."*

Eleven defects were found and folded in before approval. The four that would have cost real time:

- **`--max-commits` counting enumerated rather than eligible commits** would have made the smoke run
  review **nothing** — this branch's six most recent commits are all docs.
- **`outcomeFor` does a bare `JSON.parse` and throws**; the first draft called it before validating,
  so one malformed reply overnight would have taken down the sweep rather than being recorded.
- **Both helpers take raw stdout, not a parsed document** — the draft passed a parsed object, which
  returns `null` silently. Every failure would have classified as `failed` with no reason.
- **Model substitution produces a well-formed report**, so a server quietly answering with a different
  model would have been counted as a clean review by the model you asked for.

## What this deliberately does not do

- **No verification of findings** — raw collection, as chosen. The report says so.
- **No tracker writes.** Filing is deciding; you triage in the morning.
- **Does not fix OAI-115.** It makes starvation *visible and counted*, nothing more.
- **No resume-across-nights marker.** The record stores every sha with its outcome, so a "since last
  sweep" mode is easy later, but it is not built now.
