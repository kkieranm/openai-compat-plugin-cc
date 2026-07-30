# OAI-19 — Re-measure the bench baseline, two arms, under the OAI-15 rule

> **Codex plan gate: NOT APPROVED at the 3-execution cap.** Rounds 1–2 findings were folded in and
> accepted on re-challenge. The final open objection: the arm acceptance gate ("zero
> failed/truncated/unreadable across the arm") conflicts with the one-retry policy — if gate
> statistics aggregate both attempts, a failed first attempt can never pass; if the gate reads only
> the retry, the outcome-conditioning bias returns. **Proposed resolution, held OUTSIDE the plan
> per the cap rule (your call):** the gate judges the retry invocation alone for whether the
> measurement is *usable*, while the documented record aggregates **all** attempts and reports the
> failure rate as reliability data — usability and reliability read different scopes, deliberately.
> Approving the plan as-is approves that reading; alternatively: no retry at all (any failure →
> arm incomplete).

## Context

The recorded baseline (**1 of 6 scoreable defects, 10.9 min, N=1**) was computed under the
pre-OAI-15 rule that excluded cut runs from the denominator; OAI-15 now scores cut runs and reports
their silence as a band, so that figure cannot be differenced against anything measured since. Two
things changed at once — the scoring rule (OAI-15) and the model (the local server moved from the
MoE to the dense 27B) — and OAI-19 separates them: **both models, full corpus, `--runs 3`, one arm
per model with nothing else varying.** This is a measurement, not a feature: no plugin code changes.

## Decisions (grilled, settled)

- **MoE arm model**: `qwen/qwen3.6-35b-a3b` — the `-ud-mlx` quant the old baseline ran is no longer
  offered by LM Studio; the quant change is a footnote in the record, since OAI-19 strikes the old
  figure rather than differencing against it.
- **Dense arm model**: `qwen/qwen3.6-27b` (the providers.json default, passed explicitly anyway).
- **`--cold` on both arms** — every prefill cold via the harness cache-buster; timing uniform.
- **`--max-seconds 1800` on both arms** — identical explicit bound, matching the provider timeout.
- **Run now, sequentially, in background Bash** — arm 1 (dense) to completion, then arm 2 (MoE).
- Explicit `--provider lmstudio --model <id>` on **both** arms (scout: a missing flag falls through
  to providers.json silently). No `--diff-only` (it silently skips the `file`-mode case).

## Probe findings (verified by Codex, 4/4 hold)

- `bench/run.mjs:31-35,63-69` — `--provider`/`--model` value flags exist; CLI overrides case pins.
- `bench/lib/outcome.mjs:62` — every parsed run checked via `substitution()`; substituted runs
  recorded but excluded from scoring (`run.mjs:147`, `case-rows.mjs:175`) and timing.
- `bench/lib/case-rows.mjs:157,197` + `caveats.mjs:50` — cut runs scored, silence reported as
  `unresolved`; report prints conservative recall plus lower/upper band in the caveat.
- `bench/run.mjs:46-62` — `--cold` cache-buster unique per invocation+case+run-index.
- LM Studio is up on :1234; all models currently `not-loaded`, so each arm JIT-loads (uniform
  under `--cold`).

## Files touched

Written: `BACKLOG.md`, `BACKLOG_DONE.md`, `adr/006-benchmarking-the-reviewer.md`,
`adr/008-sizing-the-review-reply.md`, plus new records under `bench/results/` and per-arm logs in
the session scratchpad. Read-only: everything under `bench/`. No plugin code changes.

## Phases

### 1. Preflight
- `npm test` green (commit-gate command; also proves the bench scope guard).
- Confirm LM Studio still lists both model ids.

### 2. Arm 1 — dense
```bash
cd /Users/kieran/Code/openai-compat-plugin-cc && npm run bench -- --runs 3 --cold \
  --max-seconds 1800 --provider lmstudio --model qwen/qwen3.6-27b \
  > <scratchpad>/bench-arm-dense.log 2>&1
```
Launched detached (`nohup`), **each arm with its own durable log file** — the rendered Markdown
report goes to stdout only (`run.mjs:255-258`), so the per-arm log *is* the report's persistence;
never reuse one log path across arms. Watched by polling the log/results dir.
Worst case ~18 runs × 30 min; realistic well under half that.

**Warm-up before each arm's bench**: one small unscored `/oai:task` request to the arm's model
first, so the JIT model load is paid outside the measured runs — `--cold` busts the prompt cache
but does not pre-load the model, and load cost differs by model, so without this the first case's
`prefillMs` carries a per-model contaminant OAI-9 would inherit.

**Arm acceptance gate, before arm 2 launches and before anything is documented**: the harness
writes a record and exits 0 even when every run failed, so "record lands" proves nothing. Read the
record and require **every case `scored=3` with zero failed, truncated, unreadable or substituted
runs** (`analysisCut` nonzero is fine — cut runs are scored). Retry policy, predeclared to avoid
outcome-conditioned sampling — failures are themselves benchmark data (`run.mjs:78`): **at most one
re-run per arm**, and **every invocation is reported** — the record cites both attempts and their
failure counts, never just the clean one; the retry's role is completing the measurement, not
replacing the evidence that the first attempt failed. An arm still failing after its one retry is
reported incomplete, and nothing is documented as that arm's measurement.

### 3. Arm 2 — MoE
Same invocation with `--model qwen/qwen3.6-35b-a3b` and its own log
(`bench-arm-moe.log`), launched only after arm 1 passes its acceptance gate.

### 4. Read the records (`bench/results/<stamp>.json` + rendered report)
Per arm: conservative recall + band; per-case `analysisCut` counts (**does the OAI-15 ceiling still
bind** — `structured` was 4/4 cut, `scaffold` 4/11, both unmeasured since); `prefillMs`/
`generationMs` per case (OAI-9's costing input); the "Runs answered by a different model" section
(a substitution on one arm would masquerade as a model-quality difference); `gen tok/s` —
**recorded as approximate across models**: one server settles the OAI-11 termination caveat, but
the two models' token counting need not be identical, so cross-model tok/s is indicative while
wall-clock generation time is the directly comparable figure. Exclude each arm's first-case timing
from OAI-9 costing if the warm-up somehow failed to absorb the load.

### 5. Docs
- **BACKLOG.md**: strike the pre-OAI-15 figure; record both arms with their bands as the number
  OAI-9 and OAI-11 are scored against; trim the theme paragraph where the new measurement answers
  its open questions (`structured`/`scaffold` cut counts).
- **BACKLOG_DONE.md**: move OAI-19 with date.
- **ADR 006** (benchmark) gets the two-arm result appended as evidence; **ADR 008** gets the
  "does the new ceiling still bind" answer. No new ADR — no architectural decision was made.
- CLAUDE.md: no change expected (no design change).

### 6. Verify + review (scaled to a no-code change)
- Verify skill: tests green; no plugin code changed, so the delegation round trip *is* the bench
  run itself — quote the observed report lines. Mutation check: **skip, stated** — no invariant a
  single edit can break (docs + a measurement record).
- Review ladder runs against the docs diff: stage 0 acceptance audit vs OAI-19's done-criteria
  (both arms recorded with bands; old figure struck; replacement is the scoring target), advisor
  opener, Codex adversarial (focus: "is the two-arm comparison methodologically sound as recorded"),
  Codex plain review, lean workflow, advisor closer, stage 8 audit. No security trigger; wide-mode
  trigger not fired (no vendor/protocol module changed — but note OAI-19 IS the milestone-shaped
  item; wide mode remains per-milestone and this is one item, not a milestone close).

### 7. Failure handling
- A run that dies (server crash, OOM on the MoE) → resume by re-running the arm; records are
  per-invocation files, nothing is overwritten. Never read results off a dead arm.
- Substituted-model runs in either arm → reported, and the arm's recall read only from the
  non-substituted runs (the harness already enforces this).

## Verification
Done when: both arm records exist in `bench/results/` and pass the acceptance gate; **the band is
rendered where `unresolved > 0` and recorded as a point estimate (degenerate band) where nothing
was unresolved** — the report only emits a band when unresolved exists (`caveats.mjs:45`), and a
band-free arm is a *good* outcome (the ceiling no longer binds), not a missing deliverable;
BACKLOG.md carries the
struck-through old figure and the new comparable numbers; OAI-19 moved to BACKLOG_DONE.md; ADR
006/008 updated; `npm test` green at the commit gate.

---

## Outcome, 2026-07-30 (appended after execution — the sections above are the approved plan, kept as written)

- The gate/retry question the header holds open resolved itself operationally: **both arms failed
  the gate under either reading** (dense 5/18 then 6/18 failed runs; MoE 10/18 then 6/18), so no
  arm was published; **this attempt is closed, and the OAI-19 backlog item stays open** — blocked
  on OAI-20, to re-run once it lands.
- **The gate/retry semantics above are superseded** by the contract now fixed in BACKLOG.md's
  OAI-20 item: bounded physical attempts per logical run; the gate defined over completed logical
  runs; reliability defined over every physical attempt; a failed attempt never enters a recall
  denominator. Arm-level re-runs (this plan's mechanism) were the wrong layer — each re-paid every
  surviving `--cold` prefill — which is the evidence the OAI-20 contract is built on.
- The MoE arm ran despite arm 1 being incomplete (a user decision mid-run, to test whether the
  failures were model-specific; they were not — the locus is server-side, mechanism unresolved).
- Evidence and bounded observations: ADR 006 (the attempt), ADR 008 (does the ceiling still bind),
  BACKLOG.md OAI-19/OAI-20.
