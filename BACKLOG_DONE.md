## 2026-08-30 — OAI-228 closed: `message` read as a `summary` alias on the unconstrained path (`d3f5d35`)

A capable model (the MoE `qwen/qwen3.6-35b-a3b`) emitted valid review findings keyed
`{file, line, message}` — the linter/diagnostic convention — and every one was dropped for naming no
`summary`, so a review that found real defects reported UNREADABLE. Five runs of real findings were
lost this way in OAI-49's matched arm.

**Direction: widen, not enforce.** The repo's last three parser changes (`findings-yaml`,
`findings-empty`, bare-array=object) all chose "read what the model actually sent" for larger deviations
than a key spelling, and discarding real findings over a field name is the silent-work-discard class the
repo fights. The "next model spells it a third way" worry is answered by a CLOSED alias set (`{summary,
message}`, single-sourced in `descriptionOf`) extended only on a future dated instance — the worth bar,
not a slippery slope. `code`, seen beside `message`, is a rule id, not description, and is not a key.

**Binding site settled empirically before coding** (per the bench-coverage-loss-needs-raw-replies
discipline): replaying `parseFindings` on the actual replies in
`bench/results/2026-08-29T23-57-00-791Z.json` proved all five are WHOLE-reply JSON selected via
`findingsShaped`'s `every(record)` branch — so `named` never bound, and the drop was purely in
`normalizeFinding`. So the fix widened `normalizeFinding` ALONE. `named` (scanned candidate SELECTION)
stays `summary`-only: a `{file, message}` array quoted in prose is the single most likely embedded decoy,
and admitting it there would let it win on position over a real payload. The precise boundary is
SURVIVAL/normalization, not selection — a `message`-only entry survives once its array is already the
payload (a whole all-object reply, or a scanned array a `summary`-named sibling selected), but a
`message`-only array is never what gets selected. Both docstrings state the divergence so it is not
"reconciled" back.

**Scope, stated so the close-out doesn't over-claim:** the `--structured-output` schema path is
unaffected — `matchesSchema` requires `summary` and runs before normalization, so a `message`-only
finding is still rejected there (under a schema the model was held to the shape it was given). The fix
lives on the unconstrained/degraded path, which is the default since 2026-08-04 and where the dated
instance lived.

Verified: the five real replies now parse to exactly 4/1/5/1/1 (were all UNREADABLE); mutation-proven
(reverting the alias reds exactly the alias-dependent tests, the strictness-preservers stay green); all
decoy/candidate fixtures still refuse (99 tests); full suite 1443. Consensus: advisor + Codex steer on
the plan, Codex review of the diff (one Low docstring-precision finding, applied).

**Bench-record implication, recorded not rewritten** (as OAI-211's caps-r3 note did): under current code
the MoE's five discarded runs re-score to real findings, so the OAI-49 matched-arm comparison's
coverage/precision picture for that arm would shift — the historical record stands; this is the
now-would-parse fact beside it.

## 2026-08-30 — OAI-210 closed: the .message-purity marker tests can now fail (`91027df`)

Three `doesNotMatch` assertions in `tests/answer-channel.test.js` claimed to pin "a server-controlled
`finish_reason` marker is not fused into a `UserError` `.message`", but read `result.stderr.split('\n')[0]`
— always the `Checking...` progress line, never the error line — so they could not fire. Confirmed by the
item's exact mutation (interpolate `finishReason` into `.message` at the three throw sites, delete the
separate `.finishReason` assignment): all 8 tests stayed green while `structure.test.js`'s source scan
went red.

The fix decision took a detour worth recording: the obvious repair — repoint the assertion at the real
error line and `split(' (')[0]` to isolate `.message` — is **also dead**. Under correct behaviour the line
is `…no message content. (MARKER)`; under the fusion mutation it is `…no message content (MARKER).`; the
marker sits after the first ` (` either way, so the split excludes it and the assertion passes regardless.
`.message` purity is a property of the error OBJECT (`message` vs `finishReason` as separate fields), not
of the composed stderr line the renderer exists to join — no text heuristic on the joined output has a
single route to it (the repo's own negative-fixtures-need-one-route discipline). The advisor caught this
before it was built.

Where the property IS observable: the surface that serializes `.message` on its own. The `--json` refusal
envelope carries `message` as its own field (marker-free under correct behaviour) and — verified — carries
no `finishReason` field at all, so `envelope.message` is the serialized `.message` alone, a single route.
Each test now runs its scenario a second time under `--json --max-attempts 1` (the flag skips the retry
backoff; the final message is identical) and asserts the marker is absent from `envelope.message`. All
three shapes were verified to carry a distinct message field (empty-completion / entirely-empty / empty-answer).

Mutation-proven, both ways: fusing the marker at all three throw sites reds exactly the three tests (other
5 green); an isolated `client.mjs` mutation reds ONLY the requireAnswer test, preserving the per-throw-site
granularity the file's comments emphasize. The dead stderr assertions were deleted; the live halves
(`status === 1`, marker visible in stderr) were kept. `structure.test.js` still pins the same property at
the source repo-wide, so this is behavioral coverage at the serialized-object boundary complementing the
source scan, not a duplicate of it. Consensus: advisor (who caught the still-dead repoint) + Codex steer.
Test machinery, so direct edit + guards, not `/feature`.

## 2026-08-30 — OAI-208 closed: one shared tracked temp-dir helper for the whole suite (`f6e506e`)

`mkdtempSync` was called at ~75 sites across ~27 test files with no cleanup — one leaked dir per call on
every `npm test` — and three files had hand-rolled three independent copies of the same tracked-array +
`after()`-hook cleanup, a pattern already drifting (a third copy appeared after the item was filed). Kept
live rather than parked because the leak is a dated, recurring instance: it fires on every single suite
run, the same worth-bar shape OAI-203 (the one-file fix this generalizes) cleared.

Shipped the full package (consensus: advisor vote + Codex steer agreed the retrofit and the ratchet are
one inseparable unit — a default-deny guard cannot land with 25 violating files, and a helpers-only fix
leaves the drift mechanism alive): `tempDir(prefix)` in `tests/helpers.mjs` is now the single place a
scratch dir is created and tracked, cleaned by ONE lazily-registered `process.on('exit')` handler.
`createRepo`/`writeConfig`/`stateDir` route through it; every direct call site was retrofitted; the four
special files kept their extra behaviour (delegate-containment's load-bearing containment assertions,
bench-warm-up's eager per-test `try/finally`). A `structure.test.js` default-deny ratchet (allowlist:
`tests/helpers.mjs` only) catches a bare `mkdtempSync` reappearing — the recurring drift graduated from a
reviewer's prompt to a guard, this repo's stated promotion bar.

Two design points that were load-bearing, not incidental: (1) **`process.on('exit')`, not a top-level
`after()`** — verified empirically that an import-time `after()` in helpers.mjs runs BEFORE a test file's
own file-local `after()` hooks, so a shared `after()` would delete dirs before delegate-containment's
leftover assertions could inspect them; process-exit runs strictly after all file-local hooks. (2) an
**absolute `prefix` is used as-is** (via `isAbsolute`, tightened from `startsWith('/')` on a Codex review
finding) rather than joined onto `os.tmpdir()`, because delegate-containment's `/tmp/oai-delegate.` callers
exercise the real delegate recipe's hardcoded `/tmp/oai-delegate.*` check and `os.tmpdir()` is not `/tmp`
on macOS.

Verified: full suite 1436 green; `grep -rl 'mkdtempSync(' tests/` outside helpers.mjs is empty; the
ratchet was mutation-proven (a literal bare `mkdtempSync(` appended to a migrated file → ratchet RED
naming that file; removed → GREEN). The retrofit itself was done by an implementer subagent from an exact
spec; the diff was reviewed by Codex (one Low finding, applied). The graduation-to-structural-test question
the item left open is answered YES; no residue.

## 2026-08-30 — OAI-211 closed: the Invocation D run accounting reconciles; neither account is wrong (`e495188`)

OAI-211 alleged `bench/2026-08-23-oai19-run-notes.md` "does not add up" and that OAI-19's conclusions
rest on it: the per-case table (`caps 1/3`), G-C (`caps 1x2=2`), correction #1 ("8 no-report runs") and
G-L ("9 scored") never appeared to sum to the 18 that six-cases-by-three-runs produces (9 + 8 = 17).
The item correctly said resolution needed the raw Invocation D run data, not a wording edit, and
correctly hypothesized the missing shape — "a run could hold a report with `parsed:false`, unscored yet
not no-report" — but said no such run was named in the file.

Resolved by classifying all 18 runs in the results record
`bench/results/2026-08-24T02-22-35-984Z.json` (runsPerCase 3, model `qwen/qwen3.6-27b` — Invocation D)
under the file's own rule, scored = a `report` with `parsed !== false`: scored `1,3,2,0,0,3` (=9,
matching the table byte-for-byte), 8 no-report (matching correction #1's explicit list exactly), and
**exactly one** report with `parsed:false` — `caps` r3 (`finishReason: stop`, `findings: null`, 516-char
`raw`). The 8-no-report set and the 9-unscored set differ by precisely that run, so 9 + 8 + 1 = 18 and
nothing is contradictory — the "9 + 8 = 17" reading conflated "no-report" (8) with "unscored" (9). Every
account in the file is correct; the item's stronger prediction ("one of the two accounts is wrong about
`caps`") is **refuted**. No OAI-19 gate outcome is undermined. A dated reconciliation note was added
beside the per-case table; no historical number changed. (G-C's separate "17 of 33" is a
defect-weighted figure — `caps 1x2 + model-info 2x3 + scaffold 3x3` — coincidentally equal to the run
miscount, and correct.)

Characterization of `caps` r3 (advisor sharpener, no new scope): its `raw` is a clean whole-document
review — inline `findings: []` then prose, "No defects found" — the shape `findings-empty.mjs`
`emptyFindingsDocument` reads clean **today** (verified: returns `{findings:[]}`), but this run's own
build discarded it as unreadable. Under current code it would score as a clean 0-findings review,
moving `caps` to 2/3. Not OAI-228-shaped (that is a `message`-keyed findings array); no item filed —
`findings-empty.mjs` already shipped, so this is confirmation, not a live gap.

Consensus: a Codex claim-check and an advisor vote both confirmed the arithmetic airtight from the raw
record; Codex corrected one provenance-wording slip (the JSON is the results record, not the
`state-AFTER` `.log`). Forensic resolution, so a note edit + close, not `/feature`.

## 2026-08-30 — OAI-159 closed: retired `adr/` citations declared historical in the header (tracker edit, no code change)

The `adr/` ADR corpus was deleted whole in `d1ad2aa` (2026-08-13), leaving dangling citations in the
tracker. The fix the item proposed and this close-out took: option (a) — one header statement declaring
`adr/NNN` references historical provenance (carrying **no counts and no item names**, per the
prose-goes-stale discipline that made the item's own headline figures rot repeatedly) — plus de-linking
the single broken markdown link. **No option-(b) quoted-sentence replacement**, because on inspection
all four surviving references are provenance, not load-bearing evidence.

Two-sided reconciliation, both directions checked: the item's 2026-08-27 recount predicted survivors
OAI-11/13/45/52 once OAI-151 (which carried two) closed 2026-08-29 → exactly 4; a `grep` of the live
file found exactly 4, on the four predicted items. The formerly load-bearing citations the item worried
about — where an ADR **quote was the argument** (OAI-63/69/138) — had all departed with their own items'
closures, so no evidence-class citation survived to need (b). That is a dated observation about the
2026-08-30 survivors, not a retroactive claim that (b) was never warranted.

The four survivors, each with its claim stated inline beside the reference (so the reference is
provenance a reader can ignore): OAI-11 (ADR 001 "providers-as-data"), OAI-45 (ADR 013 `lastUsedTime`
record-never-branch rule), OAI-52 (ADR 014 — the broken markdown link, now plain `ADR 014`), OAI-13
(ADR 002 "shape-not-name"). The three prose mentions (ADR 001/002/013) are left **byte-untouched by
decision** — rewriting each one is the per-citation rebasing this repo's sweep discipline forbids
(it re-rots within hours), which is the whole reason option (a) exists.

Consensus: an advisor vote and a Codex steer both agreed with (a)-plus-de-link and with the
all-provenance judgement; each independently surfaced the two-sided reconciliation as the strongest
validation. Tracker maintenance, so direct edits + `backlog-structure` test, not `/feature`.

## 2026-08-30 — OAI-50 closed: `/oai:review` warns up front when it cannot size the window (`4ecd2fe`)

The open product question was what `/oai:review` should do when the context-window probe returns
nothing (or none is configured): the run proceeded silently under a fixed reply reserve
(`REVIEW_UNKNOWN_WINDOW_TOKENS`) with the input-size guard disarmed (`checkContextBudget` returns
`checked:false` and never throws), so an oversized request went out unrefused and failed at the server
minutes later — and the operator's only signal was the footer note, printed *after* that wait.

Consensus — two advisor votes plus a Codex steer — picked **warn louder** over the two alternatives.
**Refuse** was rejected: it contradicts `reserveFor`'s own documented reasoning ("refusing every review
would deny work that usually succeeds", measured good runs at 1,333–5,450 output tokens) and would
permanently break the steady-state server that never reports a window. **Retry the probe** was rejected
under the repo's worth bar: no dated instance shows a retry succeeding where the first probe failed.
The verified residual exposure justified disclosure, not refusal: the whole-file rung is already skipped
on the unsized path (`review-ladder.mjs` gates on `windowKnown`), so only the diff plus pinned
`--file`/untracked files still go out unchecked.

Shipped: an up-front stderr warning gated on `!contextLength`, emitted **after** `reviewPlan` (whose
`reserveFor` refuses a too-small `--max-tokens`, so "Proceeding" never precedes an immediate local
refusal) and **before** the "Reviewing…" line. It is **ad-hoc-aware** — the endpoint label and remedy
were factored out of `unsizedWindowNote` into shared `windowSource`/`windowRemedy` (review.mjs) and used
by both the report note and the warning, since an ad-hoc `--base-url` run has no config entry to set
"contextLength" on. Codex's implementation review drove both the ad-hoc-awareness and the
after-`reviewPlan` placement; each new behaviour was mutation-proven RED (`windowSource`, `windowRemedy`,
and the placement independently) before the clean Codex re-pass. Verified live: 1435 tests green, plugin
loads, a real LM Studio task round-trip returned an answer with the single-sourced footer note.

**Known residue, not filed** (same mechanism, no separate dated instance — this close-out is the citable
artifact): `checkContextBudget`'s footer note (context-guard.mjs) is still *not* ad-hoc-aware — it says
`set "contextLength" for provider "<name>"` even for an ad-hoc run — left untouched deliberately because
it is shared with `/oai:task` and OAI-50 is scoped to `/oai:review`. `/oai:task` reaches the same
`checked:false` silent path and gets no up-front warning at all, for the same scope reason.

## 2026-08-30 — OAI-49 closed: the matched-budget review arm is a config recipe, not a flag (`b7c0d4d`)

A cross-model `/oai:review` comparison is matched from configuration alone. `profile.contextLength` (a
first-class `providers.json` field, `config`-sourced in `effectiveWindow`, outranking detection) drives
**both** the reply reserve (`reserveFor`) **and** the input-packing rung (`git-diff` whole-file sizing),
so pinning it equal on both arms and varying only `--model` runs one instrument on both models —
stronger than OAI-49's option-1 framing, which noted only the reserve. `--max-tokens` already overrode
the reply reserve; `bench/run.mjs` already forwards `--provider`/`--model`/`--max-tokens`;
`compare.mjs`'s per-case lens axis (`rung@window`) already fails closed on a window mismatch and
`provider` is deliberately not a suppressing axis. So both of OAI-49's proposed options were mostly
already in the code; option 2's `--reserve`/`--analysis-cap` is largely `--max-tokens`, and a new
`--context-length` flag would only add surface this repo guards. Consensus (Codex claim-check + advisor
+ orchestrator): **Option A, no code** — document the recipe, leave the measured run an operator opt-in.
No product code changed; the matched profile lives in the operator's `providers.json`.

Measured 2026-08-30 at matched `W=61696` (dense `qwen/qwen3.8-27b` vs MoE `qwen/qwen3.6-35b-a3b`, 10
cases × 3 runs, whole-file, unconstrained): `compare.mjs` **did not** suppress on the window/lens axis
(identical `@61696` labels across arms — OAI-49's confound is provably gone) and withheld the recall
rank on a **coverage** divergence (`caps`: 2/3 scored dense, 0/3 MoE). A review-ladder fable audit
corrected the first draft's attribution: that coverage loss is **model-attributable, not the LM Studio
transport drop** — both arms recorded 0 failed physical attempts (30/30 answered), and the MoE's 10
non-scored runs were all *answered* then unscoreable (6 unreadable, 3 failed-shape, 1 token-exhausted).
So the binding incomparability, once the window is matched, is the MoE's own output parseability /
reasoning-budget spend, which sits inside the model comparison rather than being cleanly externalizable.
Co-scored per-case the MoE has higher recall (strictly better on hold1/hold4/scaffold/structured, tied
elsewhere) at ~4.5× throughput, but fails to emit scoreable output far more often (10 vs 7) and its
off-control unmatched-finding volume is much noisier (precision unmeasured). Recipe, provenance and the
full result: `bench/2026-08-29-oai49-matched-arm.md`.

## 2026-08-29 — OAI-151 shipped: a cross-run sweep reproduction reader (`f85578e`)

`bench/sweep-reproduction.mjs` reads N `review-sweep-<stamp>.ledger.jsonl` files and prints a per-commit
reproduction rate across runs — the number OAI-141 showed decides whether any sweep A/B means anything
(run-to-run spread exceeds the config differences people compare). Stateless: the ledgers on disk are the
history, consumed not replaced. `bench/lib/sweep-reproduction.mjs` computes; `sweep-reproduction-report.mjs`
renders. Runs group by a comparability signature — hard axes (repo, include [deduped], maxSeconds, observed
model) must match, integrity (gaps/discarded/dup-sha/sha-less) fails closed, soft axes
(diffOnly/maxAttempts/provider) disclose-or-suppress. Reproduction is over a REVIEWED-only denominator;
n<2 rows flagged; leads listed apart. The envelope grows the three soft fields going forward.

**Model provenance was the ladder's deepest thread.** `entry.model` is the requested id echoed back when
the server does not name itself (`completion.mjs`), so it is trusted as an identity only where
`modelReported === true`; **`scripts/lib/review-report.mjs` now persists that flag on the production review
path** (mirroring `task-report.mjs`), and a legacy ledger (field absent — every existing one) groups on the
bare id but is DISCLOSED as provenance-unverifiable — the same grow-forward/disclose-legacy policy the soft
axes take. **OWNER-VETO surfaced at commit:** this rests on the owner's soft-axis precedent, decided during
the ladder on Codex+Claude agreement (the AskUserQuestion was guard-blocked), NOT separately re-put to the
owner; a codex-adversarial dissent held legacy data should be shown but never grouped/ranked, overruled
because the corpus's models were demonstrably server-reported. Owner may veto (revert `review-report.mjs`'s
persist + the legacy-grouping stance). `task-report.mjs` shares the identical `modelReported ?? false` line
as latent residue.

The CLI de-dupes path aliases and byte-identical copies and refuses two distinct-content ledgers sharing a
`startedAt` — ambiguous between a diverged copy and two same-millisecond runs, refused loudly (OAI-227
principle: a loud over-suppression beats the silent fabricated reproduction a diverged copy would produce).
The render module's markdown-safety guard was found (full pass, mutation-proven) STRUCTURALLY INERT — it
used `+` concatenation with no scanned `${…}` sinks — and was fixed by emitting every untrusted scalar
through a scanned `safeInline`/`displayReason` interpolation (matching `compare-report.mjs`); the matrix
column-header stamps are the one wrapped-but-unscanned residual. Verified: 1430 tests green; real 3-ledger
e2e (14/22 agreed, 2/10 finding-bearing reproduced); REVIEWED-denominator + guard mutations proven;
live `/oai:task` round-trip healthy. Review ladder ran to dual approval (Codex APPROVE + verdict-signer,
digest `d5fab6b0b74a`).

## 2026-08-29 — OAI-227 shipped: a reasoning-state comparability axis for `bench/compare.mjs` (`506d8a7`)

`divergencesOf` (`bench/lib/compare-model.mjs`) gains a per-case `reasoning` axis so two review records
whose models reasoned vs did not are not ranked as like-for-like — the observed reasoning state is the
same class of server-controlled input as the `lens` axis (the thinking channel is set by the chat
template, unreachable over the wire, OAI-221). **The comparison — both the new `reasoning` axis AND the
pre-existing `lens` axis — derives its per-case sets over the SCORED-run population** (a new shared
`scoredRuns` in `bench/lib/run-buckets.mjs`, used identically by `case-rows.mjs` `buckets()` and the two
`*ByCase` derivations), never the wider `measurable` set. Fail-closed Option A: a differing set
suppresses ranking (known vs unknown included); two records both witnessing only `unknown` on reasoning
rank through. The displayed `row.reasoning`/`row.lens` stay over `measurable` — comparability and display
are deliberately different populations.

**The scored-vs-measurable population was the whole story of this item's review.** The first two designs
(read `row.reasoning` directly; then a two-arm "empty-set is unprovable" guard) both compared over
`measurable`, and review found that wrong twice: a `score`-without-`report` record ranks through
(defensive-reader-reachable), and — the ship-blocker that forced the redesign — a **truncated run can make
two records' measurable sets equal while their scored runs genuinely differ, concealing a real reasoning
difference** (real-writer-reachable, proven by repro). Fixing the population (compare over scored runs)
closed the concealment for both axes and collapsed the guard back to a single value arm, because with the
scored population an empty set means exactly `scored === 0`, which the coverage axis already owns. The
lens sweep was owner-authorized; the amended (approach B) plan was dual-approved. No residue.

## 2026-08-29 — OAI-220 shipped: a cross-run comparison reader for `bench/` records (`04333d9`)

`bench/compare.mjs` reads N review-record JSONs and emits a ranking summary plus a per-case recall
matrix built entirely from each record's own `caseRows` numbers — never re-tallying, which is what
re-introduced the unit-mixing error the dated hand-built ranking (2026-08-25/26) suffered.
`bench/lib/compare-model.mjs` is the pure core; `bench/lib/compare-report.mjs` renders and joins the
markdown-safety enforced set. It **withholds the ranking when the records are not like-for-like**,
naming the divergent axes across 15 comparability axes (the exact set `renderReport` threads, absence
read the way the writer reads it — a not-passed boolean is `false`, not unknown), and, under a distinct
reason, when no record produced a scoreable run; a control-only set ranks by control false-positive
rate.

Shipped through `/feature`; the review ladder ran to a clean terminal full pass over four discovery
passes (11 full, 12 diff, 13 full, 14 full) plus the verdict point, with plan re-gates at rounds 14
and 15. The last three passes each surfaced one instance of a single class — **a render that displays
the absence of a measurement as a concrete value**: an all-failed cell that collapsed mixed failure
kinds to one label (fixed to a disjoint per-kind decomposition, `— 2 failed, 1 substituted`); a
failed **control** case that read `— control` like a clean one (dated on real record
`2026-07-30T21-51-40-859Z.json`; fixed to `— control, <failures>`); and the aggregate false-positive
columns printing `0` for a zero-scored-run denominator (fixed to `—`). Pass 14 swept the whole class
and confirmed all nine render sinks name the absence rather than fabricate a value; the plan carries a
class rule so a future sink is a rule violation, not a fresh design question. Verification and mutation
proofs are in `evidence/oai-220-mutation-proof.md`. Residue filed as **OAI-227** (no reasoning-state
comparability axis). This is the reporting half of what OAI-217/218 describe from the recording side.

## 2026-08-28 — OAI-225 shipped: the failure envelope's reasoning witness is observable on the failure path (`439761c`)

OAI-221's `reasoning: reasoningWitness(error?.usage)` on `errorReport` was inert — no throw site set
`error.usage`, so every failure read `{state:'unknown', tokens:null}`, including token-exhaustion (the
mode it most wanted to observe). Fix attaches the reply's usage at each post-hoc throw site with it in
scope, in two carriers matching what each site already holds:

- **bare `error.usage`** where there is no reply envelope — `review-unparsed.mjs`'s token-exhaustion
  throw, `client.mjs`'s three `requireAnswer` refusals (length/reasoning-only/empty-answer).
- **`usage` on the `.answer` reply envelope** where one is built — `review-request.mjs`'s
  `reasoningOnlyFailure`/`salvageEmptyFailure`, via a new `replyEnvelope(result)` helper (also
  consolidating three drift-prone `{reasoning, content}` literals, from `/simplify`).

`errorReport` reads `reasoningWitness(error?.usage ?? error?.answer?.usage)`; the carriers are disjoint
by site (the bare-`error.usage` sites fire post-stream, never through `stream-collect`'s catch), so the
`??` order is defensive. The bare carrier is **load-bearing, not incidental**: reusing `.answer` at the
envelope-less sites would start persisting their reasoning as a `partial`. Usage never serializes raw —
it reaches only `reasoningWitness`, which returns a validated number, so the jobs.db fail-closed posture
is unchanged. The task failure path shares `errorReport`, so it gains the witness too, including
background tasks (whose run-context fields stay `null` but whose `requireAnswer` failures now carry
usage). Tests pin both carrier routes separately plus a positive control (no `completion_tokens_details`
-> `unknown`), reusing `completionFrames`' existing `reasoningTokens` option.

No product forks. Dual-approved plan (Codex + independent Claude verdict, one round). Review ladder: one
full pass + a verification-only pass. Pass 1 accepted **F1** (an overclaiming comment + CLAUDE.md note
that said the witness reads `unknown` in only two cases — corrected to enumerate all three: no usage
frame, a frame with no `reasoning_tokens` detail, or a `refuseUnusable` refusal that attaches no
carrier; fixed in the pass-1 exempt batch) and deferred **F2** to **OAI-226**. F2 (the `refuseUnusable`
gap) was raised by codex-adversarial at 0.99 as "do not ship"; an independent fable convergence agent
**refuted** the ship-blocking framing on the measured LM-Studio frame ordering (usage frame follows
`finish_reason`, so `STREAM_UNFINISHED` — gated on `!finishReason` — cannot carry usage; the dominant
drop is already covered via `error.answer.usage`), leaving only an unmeasured `EMPTY`/`BLANK`-with-usage
kernel → measure-first backlog item. Both verdict approvers accepted the deferral. Mutation check: two
independent mutations each red exactly their named test (drop the `?? error?.answer?.usage` fallback ->
reasoning-only test; drop the `review-unparsed.mjs` attach -> token-exhaustion test). 1331 tests green.
Plan: `plans/oai-225-usage-on-failure-path.md`.

## 2026-08-28 — OAI-219 shipped: a control case's precision measurement is named in the bench report (`d64b1a3`)

A control case (no code, no catalogued defects) measures precision — every unmatched finding there is
a false positive by construction — but the report printed that count in the same `unmatched` column as
an ordinary case's scoring-artifact unmatched, distinguished only by a caveat that hard-coded the id
`docs-only` (stale since `hold3-docs-only` was added, and present in every default run). Resolution took
the item's second option ("name `unmatched` on a no-code case what it is"), not the first (a dedicated
precision figure — no consumer, Option B declined):

- The manifest `control: true` flag is propagated onto each report row by `caseRows` and read by **one**
  predicate at every sink — `recallCell`'s `— (control)`, `unmatchedCell`, the caveat — replacing the
  `listed === 0` proxy.
- `unmatchedCell` marks a **measured** control's cell `N (false pos)`, and an **em dash** when no run
  scored it (a precision figure over zero observations is a measurement nobody made — the same honesty
  `tokenCell` already keeps; found by the review ladder, not the plan).
- The caveat names its control cases **structurally from the rows**, only the scored ones (matching the
  cell), replacing the hard-coded `docs-only` sentence — a second control had already made it stale.
- `corpus.mjs`'s `validateDefects` enforces the invariant **both ways**: a zero-defect case must set the
  flag, and the flag forbids **any** defect claim, `defects` or `dropped` (a dropped claim is a
  real-but-unlocated defect an unmatched finding could be catching, so a control with one is not a clean
  target — the guard the plan's first draft only half-wrote; the loader's own hint steers a
  `defects:[]`+`dropped:[…]` author straight into it).

Converged via Codex steer + a fable agent (Option A, unanimous). Dual-approved plan (two gate rounds:
round 1 caught the unenforced converse invariant). Five-pass review ladder: pass 1 found C1 (the
`0 (false pos)`-over-zero-runs honesty defect), pass 2 C3 (caveat/cell inconsistency the em-dash
introduced), pass 3 F3 (the dropped-claim guard gap) — with C4 (a substituted control run in the
`## Unmatched findings` supplement) **refuted by an executable repro** (a substituted run has `error`
set so `run.mjs` attaches no `run.score`, so it never reaches the supplement). Pass 4 converged, pass 5
(full) dual-approved with F5 (an invalid remediation path in the new guard's hint) fixed in an exempt
post-approval batch. 1311 tests green; each new conditional and the propagation invariant mutation-proved.

**Disclosed residue, recorded not filed (below the worth bar — structurally reachable, historically
unexercised: 0 of 660 recorded `finishReason`s):** the pre-existing `## Unmatched findings` supplement
(`report.mjs:181`, a documented raw superset residue) reads `run.score?.unmatched` over ALL runs. A
`finishReason: 'length'` reply whose findings JSON completed before the cut DOES parse (`refuseUnusable`
does not refuse a length reply carrying content; the token-exhaustion throw is on the `!parsed` branch),
so such a run carries a score yet is bucketed `truncated` (excluded from `scored`). A control whose only
run is that shape would show cell `—` while the supplement lists its findings — and the comments at
`run-buckets.mjs:32-33` / `caveats.mjs:40-42` calling truncated runs "never parsed" are false for that
reachable member. Untouched by this change (all pre-existing, not in the diff); the supplement is a
deliberate superset so filtering it would regress its purpose. Left as residue rather than filed per the
tracker's worth bar. Evidence: this feature's review transcript.

## 2026-08-28 — OAI-213 shipped: the sweep report escapes untrusted text at every render sink (`96d31d6`)

New `bench/lib/markdown-safe.mjs` (`safeInline`/`safeBlockquoteLines`/`displayReason`, one
Markdown-metacharacter escape → `.`, no options — a fallback is a caller's trailing `|| 'literal'`)
now wraps every untrusted value the overnight sweep report interpolates, across the three files
`renderSweep` composes. A default-deny structural test in `tests/structure.test.js` enforces the
boundary: every `${…}` in those files must be exactly one balanced wrapper call (optionally
`.slice`/`|| 'literal'`) or a file-bound `SWEEP_SAFE_EXPRESSIONS` exception — so a new sink added
unwrapped fails the test, closing the "found a fourth after fixing three" recurrence structurally.

Dual-approved unattended (Codex steer + fable + an independent Claude verdict subagent) over SIX
plan-gate rounds — the test shape converged monotonically namespace-scoped → pure default-deny →
anchored whole-expression → anchored no-options, each step forced by a proven counterexample
(`abortAfter` laundered through a parameter; a `slice`-named glue token; a `whenAbsent: '' + entry.x`
option). Code review of the IMPLEMENTED diff (Codex plain + adversarial + a Claude audit) then found
two HIGH throw paths the plan missed — `[finding.file, finding.line].join(':')` coerces via
`toString` BEFORE the wrapper (a throwing `toString` aborted the report), and `Array.isArray` throws
on a REVOKED proxy — plus a guard false-negative (`/* */` inside a template) and an empty-element
unbounded traversal; all four fixed and pinned with regression tests, Codex re-review clean.

The original three-sink framing understated it: the amended item had already found the header fields
and the cross-build ledger route, and the fix generalised to all three `renderSweep` files
(`sweep-report.mjs`, `sweep-health.mjs`, `sweep-notes.mjs`). Record JSON stays raw; escaping is
display-only. Disclosed residue: the file-bound bare-identifier exceptions (`severity`, `evidence`,
`line`, `note`, `explanation`, `why`, `cause`) are trusted by NAME — a future rebind to untrusted
data passes silently — irreducible in a textual scanner without a JS parser (disproportionate); a
`KNOWN WEAK EDGE` comment marks it. And `bench/lib/report.mjs:204-205` (the benchmark report, a
SIBLING artifact) interpolates server-reported model ids unescaped, the same class — latent
(model ids are clean in practice), noted not filed, `markdown-safe.mjs` now available to fix it.

---

## 2026-08-27 — OAI-216 shipped: the --max-seconds doc corrected for review salvage (`d4e8db5`)

`CLAUDE.md` and `commands/review.md` claimed `--max-seconds` "caps a whole model call in wall clock,
retries included". True for the original request and its retries, but a review's salvage follow-up
(`trySalvage`) opens its own fresh `SALVAGE_MAX_MS` (300s) deadline per attempt, outside `--max-seconds`
— so `review --commit f5addcb --max-seconds 900` ran 1105s (dated 2026-08-25). Fixed the DOC, not the
behavior: a `deadline-timeout` salvage runs precisely because the original budget is spent, so funding
it from the remainder would starve the rescue the dated instance shows working. The corrected wording
states the true ceiling is `--max-seconds` plus up to 600s (two salvage attempts for
`token-reserve-cutoff`/`reasoning-only`, one for `deadline-timeout`), on both review paths, and notes
`/oai:task` has no salvage. `commands/task.md`/`status.md` checked and left (accurate);
`bench/review-sweep.mjs` already documented the +600s exception. Fork converged B via a Codex steer and
a fable agent, both verifying the mechanism against the code. A hard-total-cap flag (`--total-seconds`)
was considered and NOT filed — no dated instance of the bounded overshoot causing harm, and the doc now
states it where the sweep operator reads it.

## 2026-08-27 — OAI-215 shipped: bench/run.mjs forwards --max-tokens and --temperature (`8469ef9`)

`bench/run.mjs` could not set the two sampling options `/oai:review` already accepts, so it scored
every model at the default reserve `min(32768, contextLength/2)` — the configuration observed producing
~700s runaways and empty answers on the dense 27b class (dated 2026-08-25: `--max-tokens 8192` cut a
`qwen3.5-4b-mlx` review from 740s/0 findings to 208s/3). Both flags now flow: added to
`SPEC.valueFlags`, forwarded by `reviewFlags` (temperature via `!== undefined`, since `--temperature 0`
is a legitimate deterministic setting a truthy check would drop), validated up front against
`MIN_REVIEW_RESERVE_TOKENS` (not 1 — `reserveFor` refuses a lower explicit `--max-tokens`
unconditionally, so a value in `[1, floor)` would otherwise materialize every repo and fail every
child), and threaded into the rendered report's identity and caveats so two arms differing only by a
knob are tellable apart. Codex's pre-commit review caught the floor and the report-identity gaps.

## 2026-08-27 — OAI-212 shipped: a whole-document empty-findings YAML review reads as clean (`c5ddc0f`)

A reviewer that finds nothing sometimes answers in whole-document YAML — `findings: []` then an
`analysis:` paragraph — which neither `extractJson` (no bracketed candidate; the `[]` is scanned and
rejected as an empty decoy) nor `findingsInYaml` (a block `- ` list, not an inline empty one) can see,
so a clean review was reported unreadable (OAI-156: 1245s of model work lost that way). New leaf
`scripts/lib/findings-empty.mjs` `emptyFindingsDocument` reads exactly that shape and returns
`{findings: []}`, wired last in `findingsIn` on the unconstrained (`!structured`) path.

Review-ladder Pass 4 found and fixed a silent-false-clean the earlier design missed (F1): the acceptor
is reached only after `extractJson(text, findingsShaped)` returns null, which ALSO happens for a real
finding it could not parse — quote-blinded, bare-object, malformed, or truncated bracketed payload — so
the acceptor would have masked it as clean. Guard: decline any `[`/`{` past the opener, the module's own
"no bracketed candidate anywhere" premise finally enforced. Measured cost 1/15 recorded clean replies
(one quoting a brace in prose) goes loud — fail-closed and recoverable. F2: `trim()` defeated the
claimed column-0 anchor, so the false doc claim was dropped rather than adding threat-model-free
machinery. The fix converged the long way — a lexical variant was broken twice at the Codex plan gate
(decisively on a truncated `{file:...` finding it turned silently clean) before settling on the
one-line bracket guard, which is provably safe against every case that broke the lexical one.

## 2026-08-27 — OAI-218 shipped: the corpus benchmark report names the review lens per case (`fd10a09`)

A `bench/run.mjs` per-model report's per-case table showed prompt tokens and timing but not the review
LENS — whole-file vs hunks-only, and the context window that decided it (`review-ladder.mjs` picks the
whole rung when the window holds the changed files, else hunks). So a case reviewed whole at 154,624
and one reviewed as hunks at 61,696 read as comparable rows, and comparing two per-model reports
silently became a lens comparison (both dated instances: 2026-08-25 `structured`, 2026-08-27
`hold3-docs-only` with a ~20x prompt-token spread and no code difference).

OAI-217 had already put `contextWindow`/`hunksOnly`/`skippedUnsizedWindow` in the review `--json`
envelope (kept as `run.report`), so this was rendering only. `bench/lib/case-rows.mjs`'s `lensSamples`
aggregates each case's distinct `<rung>@<window>` labels (`whole@154624`, `hunks@61696`,
`hunks@unsized`, `diff`) over `measurable` runs; `bench/lib/report.mjs` renders them in one combined
`lens` column beside `prompt tokens`. Deduped and joined with ` / ` — a `--runs` reload that changed
the lens shows both values instead of silently picking one — and a substituted/failed run's lens is
disowned exactly as its prompt and timing figures are.

**Grill (converged Codex+fable):** one combined `lens` column, not two and not a caveat; **corpus path
only** — the sweep path (`sweep-notes.mjs`) already renders `hunksOnly`, so only its window *number* is
unshown there, which has no dated instance (noted, not filed); `--runs` divergence renders the deduped
distinct set. **Review ladder** (one full pass, dual-approved `e173d6697a5b`): two adversarial findings
dismissed — an absent-`hunksOnly` "silent whole" (unreachable at the producer's contract:
`hunksOnly` is born `Boolean(target.diff.trim())`, always boolean into `jsonReport`; hardening the
consumer alone would be a one-field exception to the repo's trust-the-producer posture — Codex's fix
overruled by the convergence) and a case-id-with-`|` table break (pre-existing, and the lens alphabet
has no `|`). The dedup-honesty invariant is mutation-witnessed.

## 2026-08-27 — OAI-217 shipped: a record carries the server config that decided the run (`d79164d`)

A `--json` review/task envelope and a `bench/` record carried the run's identity and timings but
nothing about how the server was configured to run the model, so the `qwen/qwen3.8-27b` 0/6 runaway
(2026-08-25) was unattributable from the record alone. Now every run carries four fields: the
effective context window, its provenance (`contextSource`, a closed `CONTEXT_SOURCES` member), the
detected window, and a per-knob `serverConfig` marker (`requested` vs `server-default-unobserved`).
A new leaf `scripts/lib/run-context.mjs` builds them once for both flows from the *resolved* model's
`effectiveWindow` (never the default's) and overwrites them onto a thrown error at each
post-resolution catch, so the failure whose settings most need recording carries them.
`review-report.mjs` `errorReport` reconstructs all four FAIL-CLOSED before `jobs.db` persistence
(window via `positiveInteger`, source via a `CONTEXT_SOURCES` allowlist, `serverConfig` rebuilt as a
fresh snapshot-once map). Bench readers copy the four onto failed and success records; a `--note`
operator annotation (bounded by `boundNote`, MAX_NOTE 2000) rides the bench record alone, off the CLI
envelope and `jobs.db`. `delegate.mjs` `resolveTarget` now returns the resolved model's
window/source/detected-window, subsuming the old `selectModel`.

**serverConfig scope**: three knobs (`reasoningEffort`/`temperature`/`thinking`), the plan's explicit
choice — the other four `SAMPLING_PARAMS` are recorded in the separate `sampling` echo, not re-listed
here. **Background scope**: a background task failure records the four fields `null` (the worker never
runs the foreground catch), the same posture as `sampling` and the same gap OAI-214's deferred note
points at — still not filed (explicit `null`, not a silent failure; no dated instance).

**Review ladder** (5 passes, final full pass dual-approved `01b59cf1f4cc`): pass 1 caught two real
bugs (the review try-wrap started after `reserveFor`, letting a too-small-`--max-tokens` throw escape
with null run-context; a fail-closed TOCTOU fixed by snapshot-once). Pass 4 strengthened the
`boundNote` surrogate test — the even-parity input never landed mid-pair, so the back-off had no
positive control; an odd-parity case, mutation-witnessed against back-off deletion, gives it one.
Pass 5 dismissed two adversarial findings: a getter/prototype-pollution forge (unreachable — every
field repo-controlled, reads snapshot-once-then-validate, forging needs in-process ACE) and a
pre-dispatch `requested` marker (accurate under the marker's caller-intent contract — a `not-sent`
third state is undecidable at the pre-dispatch attach site and would contend with the co-located
failure reason; the same call OAI-214 made for its sampling echo). Its one accepted finding was an
exempt reword scoping the descriptive "resolved and acted on" over-claim to the window fields at nine
sites. Fork/fable/advisor converged against Codex's "add a third state" steer.

## 2026-08-27 — OAI-214 shipped: vendor sampling/reasoning params in the request body (`88b0a87`)

The chat body could carry only `model`/`messages`/`stream`/`stream_options` plus optional
`temperature`/`max_tokens`/`response_format`. Now `reasoning_effort`, `top_p`, `top_k`, `min_p` and
`presence_penalty` are expressible per invocation, each a named body field, driven by one
`SAMPLING_PARAMS` registry (`scripts/lib/sampling.mjs`) that also owns validation and the background
DTO's persist/reconstruct — a parameter cannot be admitted in one place and dropped in another.
`applySampling` iterates that table alone, so the body stays a closed set (`messages`/`stream`
structurally unreachable from caller sampling — the "not a generic passthrough" bar the item drew).
One `sampling` object threads `temperature`'s path through `/oai:review`, `/oai:task`, the
salvage/structured review calls, and `--background`. `parseNumber` moved to a leaf module to break a
`client → sampling → delegate → client` cycle. `reasoning_effort` is validated shape-only (its value
set is server-owned; an allowlist would re-create this item's own defect).

**Live-verified against the motivating model**: `qwen/qwen3.8-27b` at `--reasoning-effort low`
answered cleanly (finishReason `stop`), the model whose `xhigh` default scored it 0/6 on the bench.

**Grill/plan decisions** (Codex + Claude, four plan-gate rounds): the named five only (no
`frequency_penalty`); flags only for v1 — `providers.json` sampling defaults and chat-template
variable passthrough both deferred (no dated instance); the `--json` envelope echoes the *requested*
params on the foreground success and failure paths.

**Review ladder** (one full pass, dual-approved `fec4136065c0`): both Codex stages converged on one
finding — the failure envelope attached sampling on pre-dispatch failures too, while comments called
it "sent". Fixed by documenting the field as *requested* (parallel to `requestedModel`, present even
earlier since it is known from parse time), not by gating on dispatch (rejected: threads a flag
through four functions the command-catch design avoided, and drops the informative context-overflow
case). Two mutation-witnessed pre-dispatch regression tests pin it.

**Deferred, not filed** (fails the worth bar — explicitly latent, no dated instance): a `--background`
job *sends* sampling but its `--json` failure envelope shows `sampling: null` (the worker never runs
the command catch) and `/oai:result` surfaces no request knob — consistent with how `temperature` is
(not) surfaced there. Full background request-config capture is OAI-217's territory.

## 2026-08-25 — OAI-209 shipped: one event, one true account of it (`67c7e7d`)

Five review-ladder passes and three plan-gate episodes. The item as filed was display-only; the
ladder turned up four defects that were not, and twelve instances of the item's own defect class —
a sentence or comment asserting something the code does not do — every one caught by a reviewer and
none by a test.

**What shipped beyond the filed item.** `STARVED_WHY` became total over the exported
`STARVED_REASONS`, selected with `Object.hasOwn`, so an unrecognised starved reason reads as
unrecognised instead of inheriting `token-exhaustion`'s prose — production was fail-open, and the
first fix guarded it only from the test side. `WHY.starved` is deleted. `reasonSuffix` is now the one
place a row prints its reason, for every outcome: the predicate it replaced silently dropped a
malformed reason from a non-starved row, losing the only evidence such a row carried. `displayReason`
bounds and escapes every value it prints, because `unrecorded` carries a filesystem error message
rather than a code and a backtick in one corrupted its row — found by the first instrument that read
whole files instead of diffs, at pass four.

**Two wordings were rejected before the third stood.** "Spent its whole reply budget" was replaced by
"neared exhaustion", which is false at the arming boundary where the watchdog fires with half the
budget unspent; that by the firing predicate itself; and that, finally, by directly observed facts
only. Rendered sentences now make no causal, quantitative or proximity claim.

**The prose defect rate never fell** — twelve instances across six batches, every batch shipping at
least one, with two prescriptions tried and neither reversing it. The ladder stopped on instrument
coverage instead: diff review, whole-file read, cross-file data-flow trace and execution over a value
matrix have each been run against the final artifact and the last run of each found nothing new in
rendered output. `tests/sweep-report.test.js` now states in its own header that it pins which
sentence rendered and never whether it is true.

**Shipped knowingly not injection-safe.** `finding.summary`, `entry.model` and `entry.subject` still
reach Markdown unbounded and unescaped by independent, pre-existing routes — filed as OAI-213, and
disclosed to both approvers at the verdict point rather than left for them to find.

Suite 1220 → 1232, green. Every added conditional mutation-proved. Both plan-gate halves rejected a
round apiece; the terminal verdict was dual-approved on digest `f81f66784dea`.

- **OAI-209** — `scripts/lib/stream-collect.mjs`'s token-reserve-cutoff `UserError` message says the
  model "spent its whole reply budget reasoning before writing an answer" — false by the mechanism's
  own design: the watchdog fires at a character threshold chosen to trip BEFORE the pool is spent,
  preserving the answer reserve, and the report paragraph `bench/lib/reason-notes.mjs` now renders
  for the same event states that correctly, so the two user-facing accounts of one event contradict.
  Display-only (`reason: 'token-reserve-cutoff'` is the machine-read discriminator; no test pins the
  message). The same false claim renders a second way: `bench/lib/sweep-report.mjs`'s `STARVED_WHY`
  special-cases only `reasoning-only`, so a `starved` `token-reserve-cutoff` entry falls to the
  generic "the budget was gone" explanation — the report layer repeating the runtime message's
  overclaim — and the renderer tests cover `reasoning-only`/`token-exhaustion` but not
  `token-reserve-cutoff`. Dated instances: the `bench/results/review-sweep-2026-08-24*` reports
  carry both renderings verbatim. Found by `codex-adversarial` at the OAI-205 review-ladder's
  terminal pass, 2026-08-24; the report-layer sibling by the tracker-entry Codex check that
  followed it.

## 2026-08-24 — OAI-205 shipped: reasonNotes' paragraphs made true and complete (`314ab82`)

- **OAI-205** — `bench/lib/reason-notes.mjs`'s `reasonNotes` has two accuracy gaps against the OAI-204
  ledger fix, both display/prose-only (nothing dispatches on them): (1) it has no explanatory
  paragraph for `reasoning-only` now appearing as an ATTEMPT-level reason (`markUnanswered` can now
  reclassify a losing salvage sub-attempt to `failed`/`reasoning-only`) — it previously only ever
  covered `reasoning-only` as a run-level/top-level reason; **widened 2026-08-24 by OAI-206's ship:
  attempt-level reclassification reasons are now THREE codes — `reasoning-only`, `token-exhaustion`
  (a salvage follow-up's own `length` finish, distinct from the run-level code of the same name),
  and `empty-answer` (whitespace-only follow-up answer) — none with a `reasonNotes` paragraph;** (2) its `token-reserve-cutoff` paragraph
  (line 158) asserts "the follow-up... attempt already ran and failed" unconditionally whenever that
  reason appears anywhere in a run's `attempts[]`, which is now false whenever that attempt's own
  ledger entry survives alongside a LATER successful salvage or an ineligible-for-salvage run — the
  attempt remaining in the record no longer implies salvage failed. Found by `codex-plain` at the
  OAI-204 review-ladder's verdict point, 2026-08-24.
  **Shipped 2026-08-24, `314ab82`.** The false cutoff clause is replaced by the three-way outcome
  hedge (answered-by-follow-up / follow-up-failed / none-sent), the three attempt-level codes each
  get a gated paragraph, and the per-code `if` blocks fold into one exported `REASON_PARAGRAPHS`
  table with `reasonNotes` as one loop — glossary-test coverage derived from each entry's resolved
  prose bytes, plus pairing/uniqueness, all-seven multi-code, and per-label enumeration tests, every
  new assertion mutation-proved. Along the way the ladder also corrected the
  `non-retryable-transport` paragraph's ECONNREFUSED host attribution (the errno's origin — host,
  middlebox, or the local stack itself — is what the code alone does not identify; full-span
  regression pins), build-scoped its record enumeration, and fixed the same over-attributions in
  `failure-shape.mjs`/`attempt-rows.mjs` comments and two CLAUDE.md sentences (starved
  classification is `sweep-outcome.mjs` alone; `serverUnwell`'s drop routes include transport).
  Ten review-ladder passes, dual-approved at the cap with a declared exempt post-approval batch
  (the CLAUDE.md `serverUnwell` sentence, the `attempt-rows.mjs` comment); residue filed as
  OAI-209 (the `stream-collect.mjs` cutoff message contradicts the corrected account).

## 2026-08-24 — OAI-206 shipped: a losing salvage follow-up is labelled by its reply's shape (`f5addcb`)

- **OAI-206** — `attemptSalvage` (`scripts/lib/review-request.mjs`) labels ANY salvage follow-up that
  lands with empty content as `reasoning-only` via `reasoningOnlyFailure`, including one whose
  `finish_reason` was `'length'` — a token-exhaustion shape, not a clean-finish-with-no-content shape.
  This contradicts `client.mjs`'s own `isReasoningOnly` definition, which explicitly requires
  `finishReason !== 'length'`. Attempt-record display only (nothing dispatches on `reason` here), but
  a persisted record can now carry a wrong label for this case. Found by `agent-closer` at the OAI-204
  review-ladder's pass, 2026-08-24, while auditing the `markUnanswered` fix's blast radius.
  **Shipped 2026-08-24, `f5addcb`.** `salvageEmptyFailure` (`scripts/lib/review-request.mjs`)
  dispatches the recorded failure: `length` → `token-exhaustion` (reusing `review-unparsed.mjs`'s
  code for the same wire shape), the canonical `isReasoningOnly` → the existing
  `reasoning-only` failure, and a whitespace-only answer → `empty-answer` — a new
  attempt-level-only code in no reason `Set` (deliberately not `empty-completion`/
  `blank-completion`, whose transport semantics and `RETRYABLE`/`COMPLETION_SHAPES` memberships
  would misclassify model behaviour as server health), minted after the review ladder showed a
  `null` reason rendered a positively-identified cause as `unclassified` in
  `bench/lib/attempt-rows.mjs`. A truly 0-char reply never reaches the branch (refused as
  `blank-completion` upstream), so the bare arm's one reachable shape is whitespace-only — the
  round-1 dual dissent that settled the three-arm design against a two-arm simplification. A
  non-length terminal finish (`content_filter`) with reasoning still labels `reasoning-only` by
  the one canonical predicate, dismissed as correct on one-definition grounds by both approvers
  twice. Salvage gate and outcome unchanged; three tests pin the three arms; the `===length`
  dispatch mutation goes red four ways with restores diff-proved. Residue folded into live
  OAI-205 (attempt-level reason vocabulary now three codes, none explained by `reasonNotes`).
  Plan and three approval archives: `plans/oai-206-salvage-empty-label-taxonomy.md`.

## 2026-08-24 — OAI-203 shipped: every temp dir the delegate-containment suite creates is tracked and removed (`51e3354`)

- **OAI-203** — `tests/delegate-containment.test.js` leaks a temp directory on every one of 13
  `mkdtempSync` call sites (`withScratchRepo`'s `repo`, and the direct `outside`/`nogit`/preload/
  openssl-conf/wrong-prefix/symlink fixtures) — none is wrapped in a `finally` or removed by any
  `rmSync`/cleanup hook anywhere in the file, confirmed by reading the whole file. The 14th site, the
  recipe's own `$dir` inside `runContainment`, is the only one cleaned, by the real shell `trap
  'rm -rf "$dir"' EXIT INT TERM HUP` it exercises (`agents/oai-delegate.md:94`) — so this is
  specifically the 13 sites the recipe's own trap does not reach. `withScratchRepo` is invoked
  repeatedly across the file's tests, so the actual per-run leak count exceeds 13. Present,
  deterministic and silent on every test run (not a hypothetical), so it clears the filing worth bar
  unlike the other two candidates from the same sweep (see `bench/2026-08-23-oai19-run-notes.md`'s
  Codex-reviewed triage). Found by an overnight `bench/review-sweep.mjs` run, 2026-08-24, confirmed by
  direct reading and a second look from `codex-rescue`.
  **Shipped 2026-08-24, `51e3354`.** One `track(path)` registration point (incrementing a
  `trackedCalls` counter and pushing onto `TRACKED` in one body), `tracked(prefix)` wrapping every
  `mkdtempSync`, and one file-level `after` hook that removes every tracked path and carries two
  mutation-witnessed controls: registration equality (a removed `push` goes red) and an
  `lstatSync`-probed leftover audit (a removed `rmSync` loop goes red; `lstatSync` because
  `existsSync` follows symlinks and would false-pass a dangling tracked link). The review ladder
  widened the fix twice mid-build, each amendment dual-approved: `runContainment`'s dir — the one
  site the recipe's own `EXIT` trap cleans — is now tracked as a pre-shell-failure fallback AND the
  function asserts `existsSync(dir)` is false after the shell settles on success and refusal paths
  alike, converting the round-2 accepted limitation ("tracking would mask the trap") into an
  explicit trap verification (a neutered trap turns 7 tests red). Measured: 25 leaked entries per
  run before, 0 after, positive control first, with a sentinel dir ruling out an external tmpdir
  sweeper during the measurement window. Full suite 1210/1210 at the gate. Residue filed as
  **OAI-208** (the same leak class suite-wide, plus a second hand-rolled copy of this same tracking
  machinery in `tests/runtime-capability.test.js`). Plan and three approval archives:
  `plans/oai-203-clean-leaked-temp-dirs.md`.

## 2026-08-24 — OAI-19 concluded: baseline re-measurement, both arms published as failures, no scalar recall obtained

- **OAI-19** — Re-measure `/oai:review`'s recall baseline, dense 27B against the MoE, under a
  predeclared, adversarially-grilled gate (G-A through G-M — full DEFINITIONS, thresholds and stopping
  rule are not repeated here; they lived in `BACKLOG.md`'s own live-item text through 2026-08-23 and
  are recoverable from `BACKLOG.md`'s git history before this closure, e.g. `git show 7c21dd2:BACKLOG.md`.
  `evidence/019.md` holds the run-by-run arithmetic and verdicts scored AGAINST those gates, not the
  gate definitions themselves). **Concluded 2026-08-24: both arms exhausted their
  two allowed invocations under G-G and both published as failures — no scalar baseline exists for
  either model, and none can be obtained under this item without a fresh, newly-predeclared arm.**
  - **MoE arm** — both invocations (2026-08-07, A and B) failed G-B/G-C/G-E; published as a failure
    2026-08-08.
  - **Dense arm** — Invocation C (2026-08-08) failed G-B (`scaffold` 0/3) and G-E, blocked by an
    instrument defect (token-exhaustion emitted no `attempts[]`, making G-E structurally unpassable)
    until OAI-115/OAI-116 shipped 2026-08-20. Invocation D (2026-08-23/24, the second and final
    invocation) still failed G-B (3 of 6 cases below the replication floor) and G-C (17 of 33
    unresolved, ceiling 3) — worse than Invocation C. G-E passed cleanly this time (0 null ledgers
    across 18 runs), direct verification that OAI-115/OAI-116 fixed the observability defect that
    blocked this item; it did not fix recall. Reviewed by `codex-rescue`, which independently
    re-derived the same gate arithmetic and confirmed the verdict.
  - **The real deliverable turned out to be the failure mechanism, not a number.** Every no-report run
    fired `trySalvage`'s rescue; across all 14 salvage-eligible runs observed in the Invocation D
    session (main arm plus the deferred `--max-attempts 1` control arm), salvage fired 14/14 and
    rescued exactly 1/14. That finding, reviewed by Codex, produced **OAI-204** (shipped 2026-08-24,
    same day): a head+tail trim of the reasoning fed back into salvage, plus an untrimmed fallback
    after a live replay showed the trim alone regressing the one measured rescue.
  - **What remains genuinely open** — not this item's to carry, since it has no invocations left —
    is whether a fresh baseline arm is worth attempting now that OAI-204 has shipped, and whether
    **OAI-49** (matched-budget arm, still live) is the more useful next measurement given neither
    deployed-system arm ever cleared its gate. OAI-45 and OAI-50, also still live, are unaffected by
    this closure.
  - Full gate-by-gate arithmetic, every invocation's raw records, and the Codex reviews: `evidence/019.md`
    (invocations through 2026-08-08) and `bench/2026-08-23-oai19-run-notes.md` (Invocation D and the
    control arm, not yet folded into `evidence/019.md` — left to a later sweep per this repo's
    consolidation convention).

## 2026-08-24 — OAI-204 shipped: head+tail trim for salvage's fed-back reasoning, with an untrimmed fallback (`e1d3c99`)

- **OAI-204** — Filed 2026-08-24 from OAI-19's overnight measurement: salvage fired on 14 eligible
  failures and rescued only 1, because `trySalvage` fed the model's own full partial reasoning (tens of
  thousands of chars on the failing cases) back into the follow-up, and the model kept reasoning inside
  the salvage window too rather than concluding. `codex-rescue` steered toward a narrow first fix: a
  deterministic head+tail retention trim (1,500 head + 4,500 tail chars, derived from
  `TOKEN_RESERVE_TOKENS`), holding the salvage budget fixed, scoped to `token-reserve-cutoff`/
  `reasoning-only` only — `deadline-timeout` untouched. Grilled and shipped with no CLI flag,
  recorded JSON-only via a new `salvageTrim` field.

  A review-ladder pass on the shipped trim found it regressed the one salvage success OAI-19 had
  measured: a direct live replay against the exact same case (MoE model, `scaffold`) showed the trim
  turning a 1-of-3 anchored-finding rescue into a 0-of-3 miss. Per Codex's own conditional
  ("if the trimmed path repeatedly misses while an untrimmed control succeeds, add a fallback"), now
  met by direct evidence, the plan was amended to add an untrimmed fallback attempt — tried only when
  the trimmed one fails and trimming actually applied — with `result`/`budget`/`estimatedTokens`/
  `salvageTrim` always sourced from whichever attempt actually won, never mixed. That amendment went
  through **3 rounds** of dual Codex+Claude plan review before implementation, each round closing a
  precision gap the previous round's wording left open (attempt-attribution ambiguity, a surrogate-
  boundary count not propagating to the reported figures, an invalid JSON-round-trip test oracle).

  The review-ladder pass on the *implemented* fallback then found a second, independent, real bug
  (confidence 0.99): a rejected salvage attempt's ledger entry stayed `outcome: 'answered'` even though
  its content was unusable, so a run that failed once and then succeeded carried TWO `answered` entries
  in one `attempts[]` array — violating `bench/lib/attempt-rows.mjs`'s stated "exactly one answered
  attempt" invariant and misattributing `warmEligible`/prefill timing to the losing attempt. Fixed with
  a `markUnanswered(error)` reclassification hook (`attempt-outcome.mjs`/`answer-attempts.mjs`), applied
  at the new salvage-rejection site AND a pre-existing instance of the identical bug in
  `unconstrained()`'s own reasoning-only handling that predates OAI-204 entirely — required for the
  invariant to actually hold, not optional cleanup.

  Both the trim-scope gate and the ledger fix are mutation-verified. Full review-ladder pass — two
  rounds of acceptance-audit (checklist + whole-artifact instruments), adversarial and plain Codex
  review, fork-opener (once retried after a narration-echo non-answer), agent-closer — dual-approved at
  the verdict point with three non-blocking residue items, filed as OAI-205, OAI-206, OAI-207. Full
  evidence trail: `bench/2026-08-23-oai19-run-notes.md`, `plans/oai-204-salvage-reasoning-trim.md` and
  its `.approved/` archives.

## 2026-08-23 — OAI-181 shipped: per-call model selection for the delegate agent (`dd9de67`)

- **OAI-181** — Filed 2026-08-17 from a direct user request ("we should be able to specify per call
  what model to use"). `--model` was already a per-call flag on `/oai:task` and `/oai:review`; the gap
  was `agents/oai-delegate.md`, whose own text said "You do not choose the model... Never pass
  `--model` to work around it." Fixed: a caller-named model now writes to a `model` file the recipe
  reads and forwards as `--model <id>`, validated by a small inline Node script before being passed
  through as a CLI argument.

  Shipped after an unusually long review history. The plan-gate cycle (before code existed) ran
  several rounds correcting cross-reference/rule-text drift. The pass verdict point that closed the
  review-ladder pass — the review after code landed — then ran **7 rounds**, each finding one new,
  real, independently-verified issue in the same region: the model-id validator and the pre-existing
  `canon()` path resolver both invoke `node -e` inline, and that turned out to be reachable by
  collisions with Node's own exit-code space (rounds 1-2, fixed by moving custom codes to 20-25), an
  inherited `NODE_OPTIONS` (round 3), an inherited `OPENSSL_CONF` (round 4), and Node's own IPC/cluster
  startup bootstrap (round 5) — three rounds finding a new inherited-environment-variable hazard each
  time is this repo's own named "stop enumerating, redesign" signal, so round 5 replaced the enumerated
  blocklist with a safelist: both invocations now run under `env -i PATH="$PATH" node -e …`, an empty
  environment with only `PATH` restored. Round 5's own mutation testing separately surfaced a genuine
  production hazard distinct from the fix under test: an unfixed invocation under a specific inherited
  IPC variable could hang indefinitely rather than fail, when run through a pipe-capturing harness —
  fixed with an explicit `timeout: 10000` on the two regression tests that exercise it, so a future
  regression fails fast instead of hanging the suite. Round 6 raised two points against the safelist
  itself (a caller-controlled `PATH` substituting `env`/`node`; a legitimate Node version-manager shim
  breaking under `env -i`) and a non-blocking undercount in a mutation-check claim; round 7 confirmed
  both points out of scope (the former matches round 5's own `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES`
  dismissal — an already-compromised toolchain, not this recipe's threat model; the latter fails this
  repo's own filing bar for a new finding — a plausible future, not a dated instance) and confirmed the
  corrected mutation count (9 tests break on reverting `env -i`, not the originally-claimed 4, since it
  now also carries findings 3-4's clearing). Every finding across all 7 rounds was independently
  verified by direct reproduction against the real `node` binary before being accepted; every fix was
  mutation-tested (revert, confirm the exact predicted failure, restore, confirm full-suite green).
  Full suite green at 1200/1200. Two out-of-scope findings from the same review pass filed separately
  as OAI-201 and OAI-202 rather than absorbed into this diff.

## 2026-08-23 — OAI-86 shipped: the delegate recipe's containment machinery is now tested for real (`2956074`)

- **OAI-86** — `agents/oai-delegate.md`'s shell recipe is the one place this repo enforces that a
  delegated attachment stays inside the working tree — a Node-based `canon()` resolving every
  `--file` path, guarding against `--`-prefixed argument injection and a resolved path carrying a
  control character, and a boundary check refusing anything outside the git tree (or cwd, outside a
  repo). Filed 2026-08-05 by OAI-83's wide review: none of it was tested. `tests/delegate-template.test.js`
  deliberately stubbed `canon` and `root` to identity for its own (legitimate, distinct) purpose of
  testing argument construction, leaving containment itself entirely unexercised. Confirmed with a
  positive control at probe time: disabling the boundary check left the full 1158-test suite green.
  New `tests/delegate-containment.test.js` drives the real, unstubbed recipe text (extracted from the
  markdown via the same `indexOf`-window pattern the existing harness already used) against real
  filesystem entries, a real scratch git repo, and real symlinks — no production code changes,
  `agents/oai-delegate.md` itself is untouched. Every one of the 5 guards (the boundary check, the
  `--` separator, the control-character check, `[ -L "$dir" ]`, the `/tmp/oai-delegate.*` dir-prefix
  check) is individually mutation-proven: each temporarily disabled in the real recipe, confirmed the
  predicted test(s) fail with the predicted symptom, restored, confirmed green.
  Plan gate: 3 rounds, two real corrections. Round 1: the originally-proposed control-character test
  placed the hostile path outside the tree, where the (separate) boundary check would refuse it
  regardless of whether the control-character guard worked — both "guard present" and "guard absent"
  produced the same observable outcome, so the design could never distinguish a working check from a
  broken one. Replaced with an isolated `canon()`-only extraction, tested directly with no boundary
  check present to mask a result. Also round 1: the proposed Node `--require` option-injection test
  used a filename containing `/` inside one path component, which no filesystem can represent.
  Round 2: the round-1 replacement (`--require/evil.js`) turned out to still be wrong — confirmed
  directly against real Node that it triggers only a generic "bad option" rejection, never actually
  invoking `--require`'s module-loading behavior; landed on the verified construction
  (`--require=./evil.js`, backed by a real directory literally named `--require=.`) after this session
  independently re-verified the disagreement between Codex and a parallel Claude verdict subagent (the
  latter had approved the wrong construction) directly against real Node rather than trusting either
  verdict blind. Round 3 approved the final design.
  Review-ladder: 1 full pass, verdict point needed 2 rounds. Pass findings: one weaker-than-promised
  assertion (acceptance-audit, fixed), one real gap where two refusal tests checked only for a
  diagnostic message without proving the guard actually halted execution — a guard that warns but
  drops `exit 1` would still have passed them (codex-adversarial, fixed with a shared
  `assertDirRefused` helper, mutation-proven). Verdict-point round 1 was split (Claude approved,
  Codex found one more real gap: the plan explicitly called for an isolated `canon()`-level proof of
  the `--` separator, distinct from the two integration-level tests already present, which was
  missing) — fixed and mutation-proven, round 2 unanimous.
  Filed 2026-08-05; shipped 2026-08-23.

## 2026-08-23 — OAI-59 shipped: /oai:result defended against a foreign outcome/request/transport shape (`c8ad8a9`)

- **OAI-59** — `/oai:result`'s `writeAnswer` rendered a background job's persisted `outcome` (and,
  after this fix, `request`/`transport`) with no defense against a shape this build does not
  recognize — a newer or different plugin build's JSON blob, outside the `schema_version` gate. A
  renamed `content` field was reported as "recorded no answer" (false — the job produced one, the
  `findings: null` vs `[]` class of defect this repo has hit before); absent fields rendered
  literally (`NaNs`, `model: undefined`).
  Original fix (plan sections 1-3): split "no answer" from "shape I don't understand" in
  `writeAnswer`; `render.mjs`'s `timingParts`/`modelPart` omit an absent field rather than
  fabricating a number or printing it literally; persisted the context-window-unknown note through
  to the request DTO (closing OAI-71/OAI-85, below).
  **Review-ladder found the same architectural gap recur three passes in a row**, each on a
  different field of the same `job.outcome`/`job.request`/`job.transport` blobs, at a shrinking
  radius: pass 1 found `model`/`requestedModel`/`finishReason` plus `usage.*` in `render.mjs`; pass
  2 (two independent Codex reviewers) found `outcome.artifact` and the newly-persisted
  `contextNote` itself; pass 3 found `transport.name`, an array bypassing the artifact guard,
  `request.template`, and `request.estimatedTokens`. Codex, consulted directly on whether this
  recurrence was plan-amending, confirmed yes and named the fix codex-adversarial had already
  proposed in pass 2 and which had not yet been acted on: one boundary validator over every
  render-consumed field, composing the whole answer before a single stdout write so an unforeseen
  future gap fails before any output leaks rather than after. The amendment went through two rounds
  of plan-gate dual approval (Codex + independent Claude verdict subagent) — round 1 found two more
  real gaps (`transport.name` needing render-side graceful-degrade rather than validator-side
  tightening; `outcome.artifact`'s `.detail` validation needing to be state-dependent since
  `artifactNote` only skips reading it for the `applies` state) — before landing as
  `RENDER_CONSUMED_FIELDS`, a single exported table of `{path, get, valid}` entries consumed by both
  `validateOutcomeShape` and a structural test that proves each entry is actually enforced against a
  synthetic hostile-value row, rather than two independently hand-maintained lists that could drift
  together (the design a plan-gate round explicitly rejected).
  Every one of the 8 table entries, the required `outcome.content` check, `isOptionalArtifact`'s two
  independent sub-checks (state-enum, state-dependent detail), and `render.mjs`'s new `providerPart`
  helper were individually mutation-proven (backed out, confirmed the predicted test fails with the
  predicted symptom, restored, confirmed green) — 12 separate cycles in total. Verified live against
  the real production `jobs.db` and a running LM Studio server, not just synthetic test fixtures: a
  real completed job rendered correctly, and a hand-injected hostile `model` value on that same real
  row was refused cleanly by the actual CLI rather than crashing, then the row was restored.
  Review-ladder: 4 passes total (1 full, 3 diff), 8 real findings fixed across them plus 3
  non-blocking descriptive-prose findings in the final resumed pass (CLAUDE.md text left stale by
  the restructure), all fixed. Plan gate: 3 rounds total (1 original, 2 for the amendment).
  Filed 2026-08-05; shipped 2026-08-23.
  **Absorbed: OAI-71** (the context-window-unknown note was computed at submission but never
  persisted — the smaller half of the same root cause, folded into this item at filing time).
  **Closes: OAI-85**, filed separately the same day by a different review pass, discovered during
  this item's probe to describe the identical gap (`cmd-result.mjs` hardcoding `contextNote: null`,
  same file, same line, same root cause) — an undetected duplicate of OAI-71. Neither needed its
  own residue; both close by this same commit.

- **OAI-71** — Absorbed into OAI-59; see that item.

## 2026-08-23 — OAI-200 shipped: runEpisode's spawned child gets an 'error' listener (`995bcfd`)

- **OAI-200** — `bench/lib/ttl-episode.mjs`'s `runEpisode()` spawned a child with no `'error'`
  listener, so a spawn-level failure was an uncaught exception under Node's default `EventEmitter`
  behavior, crashing the whole ~45-minute unattended `ttl-challenge` sweep with no diagnostic. Added
  the listener, resolving the episode as "never dispatched" via the same null-safe helpers every
  downstream reader (`obtainedAnyResponse`, `episodeVerdict`, etc.) already handles for
  `attempts: null`. Restructured both `'error'` and `'close'` through a shared `settled`-guarded
  `finish(builder)` closure so whichever fires first still measures `durationMs` at the same point
  production always has, and survives Node's documented double-firing (`'error'` then `'close'`, code
  `-2`) for the same underlying failure without corrupting an already-resolved episode's `samples`
  array. Also covers a synchronous throw from `spawn()` itself (narrow, e.g. under Node's permission
  model) through the same path, and defers marking the sampler in-flight until Node's own `'spawn'`
  event confirms the child actually started, added a `spawnImpl` injection seam (the only way to make
  a spawn fail, since `materialize()` always returns a real directory) and 3 new tests.
  Plan gate: 2 rounds (a fall-through control-flow gap, a test-injection seam that didn't exist).
  Review-ladder: 3 discovery passes found and fixed 6 real issues total — listener registration
  ordering, optional chaining on stdout/stderr, the synchronous-throw path having no test coverage or
  cleanup, `sampler.dispatched()` firing before Node confirmed the child started, and the `settled`
  guard itself being untested (confirmed real by mutation: removing it corrupted `samples` after
  resolution). The terminal verdict point then went 2 rounds on its own — round 1 found a flaky
  200ms-sleep test and no per-test timeouts; round 2 replaced the sleep with a deterministic
  synchronously-registered `'close'`-event wait and added timeouts, both re-verified by tracing
  Node's actual `EventEmitter` dispatch semantics rather than trusting the description.
  Residue: none — this was itself OAI-199's deferred residue, closing that chain.

## 2026-08-23 — OAI-199 shipped: structural test + REPO_TRAPS entry + four sibling process.exit() sites fixed (`e18ec11`)

- **OAI-199** — The `process.exit()`-after-stdio-write defect class was confirmed twice
  (`scripts/oai-companion.mjs`, commit `31c98d7`; `bench/review-sweep.mjs`, OAI-198), crossing
  CLAUDE.md's "confirmed twice → add a permanent structural test" bar. Fixed the four remaining live
  instances of the identical shape — `bench/run.mjs:292`, `bench/recover-sweep.mjs:251`,
  `bench/task-run.mjs:197`, `bench/ttl-challenge.mjs:232,235` — each `process.exit()` replaced with
  `process.exitCode` plus a natural return; `bench/run.mjs`'s catch branch needed an added `return;`
  since its `UserError` branch previously fell through to an unconditional `throw error;` below it,
  which a bare substitution would have doubled up on. Added a permanent structural test in
  `tests/structure.test.js` scoped to an explicit `CLI_ENTRYPOINTS` list of six files (a repo-wide ban
  would need a growing allowlist for `job-heartbeat.mjs`'s deliberate `process.exit(0)` and a corpus
  witness script), scanning with comments stripped since this defect class's own explanatory prose —
  including this fix's own reference file — inherently mentions the banned call. Added a
  `.claude/REPO_TRAPS.md` entry generalized during review from "stderr + non-zero exit" to "any queued
  stdio stream + any exit code", since `scripts/oai-companion.mjs`'s original instance actually
  truncated stdout and `bench/ttl-challenge.mjs` writes stdout before exiting with either 0 or 1 — a
  narrower rule as first drafted would have permitted the same defect to reappear on a success path.
  Plan went through 5 rounds of dual-approval review (two false claims in the plan's own justification
  text corrected, a guard-design blocker fixed — the new test had to scan comment-stripped source,
  not raw source, or it would permanently flag `scripts/oai-companion.mjs` for its own explanatory
  prose), then one review-ladder pass found and fixed an off-by-one stale line citation and the
  stdout/exit-code narrowness above, both landed as exempt (comment-only) mid-pass fixes.
  Residue: `bench/lib/ttl-episode.mjs`'s `runEpisode()` spawns a child with no `'error'` listener —
  filed separately below.

## 2026-08-23 — OAI-198 shipped: stop process.exit() truncating stderr in bench/review-sweep.mjs (`785dfcc`)

- **OAI-198** — `bench/review-sweep.mjs`'s own `main()` had the same defect class the sweep-crash fix
  closed in `oai-companion.mjs`: it called `process.exit(1)` synchronously right after two
  `process.stderr.write` calls, so a large enough stderr payload could still be truncated at the OS
  pipe buffer before it drains. Fixed with the same `process.exitCode` substitution. Found during
  OAI-196/197's review ladder; landed separately since it was a different CLI entrypoint from the
  files that ladder touched. A draft `.claude/REPO_TRAPS.md` entry written during this item's own
  ladder was deliberately not committed here — Codex's plan-gate dissent judged it non-exempt surface
  (it prescribes a fix pattern for future sessions, not merely descriptive prose), so it landed later
  as its own reviewed item, OAI-199, which also fixed four more live instances of the same shape this
  item's `agent-closer` stage found but left out of scope.

## 2026-08-23 — OAI-196 shipped: rewrite the stale premise of credential-notice.test.js's pipe-buffer test (`b3938f8`)

- **OAI-196** — `tests/credential-notice.test.js`'s "the notice survives a preamble larger than the
  pipe buffer" test's header comment claimed `noteEndpointPersistence()` had to sit above
  `prepareTask()` because `process.exit(2)` discarded undrained stderr. Commit `31c98d7` already fixed
  `oai-companion.mjs` to set `process.exitCode` instead, so Node drains stdio naturally regardless of
  write order or size now — confirmed by mutation (both in the original backlog item and re-proven
  during this fix) that reordering the two calls no longer makes the test fail. Rewritten to describe
  the current state accurately: the notice/row/redaction assertions are still real, live coverage; the
  call order in `task-submit.mjs` stays unchanged, independently justified by `CLAUDE.md`'s own design
  note ("gating on nothing... no preamble can crowd it out"), not by anything this test can still
  detect; and the test can no longer catch a regression to `oai-companion.mjs`'s exit behavior
  specifically — deferred to OAI-199.

  **A design fork was resolved via two rounds of Codex steer, reversing its own first recommendation.**
  Reordering `task-submit.mjs` (notice after `prepareTask()`) would have turned this test into a
  mutation-provable regression guard for the broader `process.exitCode`-vs-`process.exit()` defect
  class — Codex's first pass recommended exactly that. Shown the CLAUDE.md passage documenting the
  current order as an independent, deliberate invariant (not a `process.exit(2)`-era workaround),
  Codex's second pass reversed itself: reordering would make the notice's emission conditional on
  `prepareTask()` succeeding and falsify that documented invariant. `task-submit.mjs` was left
  unchanged; only the test's comment was rewritten.

  Comment/docstring text only — zero test logic or production code changed. `fork-opener` failed twice
  within the review pass (a genuine launch, then a genuine pass-local retry with an explicit
  prohibition), both times via the same self-referential `ListAgents`/`TaskOutput` tool-loop — the
  10th recorded instance of this failure shape this session, now confirmed immune to even a proactive,
  explicit prohibition. Recorded as a permitted coverage gap.

## 2026-08-23 — OAI-197 shipped: fix two comments stating removed process.exit(2) behavior as fact (`773586b`)

- **OAI-197** — `scripts/lib/job-launch-outcome.mjs`'s `writeSync` rationale comment and
  `tests/job-helpers.mjs`'s `submitWithSlowStderr` docstring both stated `oai-companion.mjs`'s old
  `process.exit(2)`-discards-stderr behavior as current fact; commit `31c98d7` had already replaced
  that with `process.exitCode` plus natural drain. Rewritten to describe the current behavior
  accurately — comment/docstring text only, zero executable code changed.

  **The `job-helpers.mjs` docstring went through two drafts inside the same review pass.** The first
  rewrite ("keeps a write genuinely pending at exit time") was itself wrong under `process.exitCode`
  semantics — Node's event loop won't let the process exit while an async write is pending, so a
  write can never actually be pending at exit time. `codex-adversarial` caught this
  (medium/0.98-confidence), `agent-closer` independently re-derived the same conclusion, and the
  docstring was rewritten a second time to describe sustained backpressure delaying natural exit
  instead — a real, if subtle, defect this specific ladder pass introduced and then caught in the
  same pass.

  `tests/credential-notice.test.js` still carries a related, larger stale-premise claim about the
  same removed behavior; deliberately out of scope here, already tracked as OAI-196.

  `fork-opener` failed via a self-referential `ListAgents`/`TaskOutput` tool-loop that persisted
  even with an explicit prohibition in its prompt — an 8th recorded instance of this failure class,
  recorded as a coverage gap without a second retry rather than repeating a mitigation already known
  to fail on it.

## 2026-08-22 — OAI-195 shipped: normalizeFinding no longer throws on a hostile-coercion severity/line (`b96ae2c`)

- **OAI-195** — `normalizeFinding`'s `String(raw.severity ?? '')` and `Number(raw.line)` threw a
  `TypeError` when either was a JSON-producible object with no usable primitive coercion (own
  `toString`/`valueOf` set to `null`), crashing the whole reply's findings parse instead of dropping
  just that one malformed finding. Fixed by guarding both with a `typeof` check before coercion, the
  same pattern `normalizeFinding` already used for `file`/`summary`.

  **Fix shape deliberately diverges from what was originally filed**: the item as filed prescribed
  dropping the whole finding (the all-dropped/UNREADABLE path). Instead, a hostile-object
  severity/line is **kept**, defaulted to `'medium'`/`null` — converged on independently by a Codex
  STEER and a fable-model verdict (both, separately, landed on "keep and default"), reasoning that
  `file`/`summary` gate on the finding being *unverifiable*, which a garbage severity/line does not
  touch, and that treating only the non-coercible subset of malformed values as disqualifying (a
  plain `{}` already coerced to `'medium'`/`null` pre-fix and was kept) would be an arbitrary line no
  reader could predict. Both verdicts landed via the plan gate — dual-approved over two rounds; round
  1 caught an inaccurate mutation-check claim in the plan's own verification wording (fixed in round
  2). A fable-flagged implementation trap was folded into the fix: `Number("12")` already resolved to
  `12` pre-fix, so a numeric-*string* `line` had to keep resolving to a real integer — the guard
  admits `string | number` before coercing, not `typeof === 'number'` alone; pinned by a new test.

  Review ladder: one full pass, dual-approved, no findings — every stage (two `acceptance-audit`
  instruments, `fork-opener`, `codex-adversarial`, `codex-plain`, `agent-closer`) came back clean or
  with a confirmed-non-blocking note (the fix also changes behavior for other previously-coercing
  shapes, e.g. `severity: ['high']` now defaults instead of coercing — confirmed intentional, the
  same reject branch the new tests already exercise, not an accidental widening).

  **Not filed as new residue**: the full-file scout noted `scripts/lib/model-info.mjs:181`'s
  `matchKey(id)` does the same unguarded `String(id)` coercion on a server-reported model id — a
  genuine analogue of this bug's rationale, but never observed to have actually thrown (a plausible
  future, not a dated instance), so it fails the filing worth bar and is recorded here rather than
  given a tracker id.

## 2026-08-21 — OAI-28 (B)+(C) shipped: bodyStream's two untested transport writes now have direct coverage (`80fd3a6`)

- **OAI-28** (merged 2026-08-05 from OAI-28/OAI-30/OAI-41; part (A) already closed as moot, part (D)
  already withdrawn as a duplicate of (B) — see BACKLOG.md history) — parts (B) and (C) shipped.
  `scripts/lib/http.mjs`'s `bodyStream` generator had two writes with no behavioral test: the
  `!response.complete` branch (`error.reason = TRANSPORT`, `error.serverResponded = true`) and the
  catch block's `transportError(error, url, { delivered: true })` one line below. Both are
  unreachable through a real `node:http` server on Node 26.3 — measured, both ways of cutting a body
  (short content-length, chunked-no-terminator) raise on the stream instead. Fixed by exporting
  `bodyStream` under the same "exported for the test, not for a caller" precedent already documented
  on `requestErrorHandler` in the same file, and driving it directly with two stub async iterables in
  `tests/transport-classification.test.js`. No runtime behavior change. `tests/structure.test.js`'s
  locator regex and doc comment (which overclaimed "nothing behavioural can pin it") were corrected.

  2 plan-gate rounds: Codex round 1 found that exporting `bodyStream` breaks the structural test's
  line-anchored locator regex (`/^async function\* bodyStream\b/` stops matching once the declaration
  reads `export async function* bodyStream`) — caught before any code existed. The review-ladder's
  single pass then found one more real issue after code existed: `agent-closer` (fable) caught a
  sibling overclaim left in the same comment block being edited — the pre-existing text "deleting
  `{ delivered: true }` changes nothing today" is false as literally stated, since `delivered: true`
  also sets `serverResponded` unconditionally and dropping it visibly changes that field today,
  caught by an existing real-server test. Verified live against `http-errors.mjs` before fixing;
  amended to scope the claim to the retry verdict specifically. Fixed as exempt prose. Mutation-landed
  proof performed by hand for both writes before commit. Full suite green throughout, 1121/1121 at
  final state.

- **OAI-30** — Absorbed into OAI-28 (part C); see that item.

- **OAI-38** — Absorbed into OAI-28 (part D); see that item.

- **OAI-41** — Absorbed into OAI-28 (part A); see that item.

## 2026-08-21 — OAI-113 shipped: scanFor is no longer quadratic on unmatched brackets (`e0c085a`)

- **OAI-113** — `scanFor`'s restart-based scanning re-scanned the same trailing suffix once per
  unmatched opener, costing O(n²) on a reply of many unmatched brackets — a 200KB reply of unmatched
  `[` took ~36s through the real `extractJson()` entry point. Fixed by merging `balanced()`+`scanFor()`
  into one single linear pass: a stack of open-bracket positions LIFO-matches closes to opens, and a
  separate ordered list preserves opening-position order for evaluating `accept()` (a stack alone
  would emit closing-order, breaking a caller with a stateful `accept`). Now ~16ms for the same input —
  ~2200x measured speedup.

  Two deliberate, tested behavior changes ship with this: content fully inside a closed OR unclosed
  quoted string is no longer independently scanned as a candidate, since string/escape tracking is now
  continuous across the whole pass rather than reset per restart position. The true scope is wider
  than "content inside a quote" — one unbalanced quote anywhere in the text blinds the scan for the
  entire remainder, a plausible trigger given this repo's own review prompt orders quoting a source
  line that may itself contain an odd count of quote characters.

  **Went through 2 plan-gate rounds before any code existed**: round 1 caught the behavior-change
  section understating its scope (closed-quote content is affected too, not just unclosed) — fixed
  and re-approved round 2 with clean dual approval. **The review-ladder then independently found 4
  more real issues after code existed**: a diff pass found a genuine mutation-coverage gap (the
  LIFO-pop mutation witness didn't cover escape-handling; a separate `escaped`-flag mutation survived
  the whole suite until a properly-designed fixture — a bracket genuinely between two escaped quotes,
  not merely adjacent to them — was added), plus a docstring blast-radius correction; a full pass
  found two absolute "every balanced run" claims that had become overclaims, plus a claim that a
  quote-blinded reply returns "unreadable" that was verified false against the actual code — it
  returns `null`, which `structured.mjs` maps to `NO_PAYLOAD` (try next channel), not its own
  `UNREADABLE` (stop searching) sentinel.

  A genuinely thorough result for what looked like a small algorithmic swap on shared parsing logic
  exercised by every review/task response in the plugin. Shipped in `e0c085a`. Full plan history and
  every finding's disposition: `plans/oai-113-scanfor-linear-pass.md` and its `.approved/` archive (2
  plan-gate rounds; note round 1 has no archive file, since a dissent writes nothing). Full suite
  green throughout (1119/1119 final).

## 2026-08-21 — OAI-114 shipped: findingsShaped stops discarding a whole list for one non-object sibling (`16997a3`), OAI-195 filed (`d33aa36`)

- **OAI-114** — `findingsShaped`'s candidate-selection predicate required EVERY element of a
  candidate list to be a real object, so one non-object sibling (e.g. a malformed string) discarded
  a whole reply that had a genuine finding sitting right beside it, contradicting ADR 003's stated
  guarantee that a bare array is the same reply as `{findings: […]}` with malformed siblings counted,
  not fatal. Fixed by splitting the predicate into `record`/`named`/`usable`: a candidate is admitted
  when either every element is a real object (preserving the legacy all-objects boundary) or at least
  one element is a genuinely named finding (the actual fix).

  **Unusually deep for its apparent size.** Went through 3 review-ladder diff passes plus a full
  pass, each finding and fixing a real edge case: pass 1 (`codex-plain`) found `named`'s optional
  chaining could throw on a truthy non-function `.trim` value, closed with explicit `typeof` guards;
  pass 1's `agent-closer` found the docstring overclaimed defense against trailing decoys. Pass 2
  (`codex-plain`) found a genuine regression the pass-1-approved fix introduced — a mixed whole-array
  containing a nested `{findings:[...]}` wrapper could lose a recoverable finding to all-dropped
  normalization, where pre-fix base behavior recovered it via a fallback candidate — closed by
  changing the whole-reply branch to `list.every(record) || list.some(named)`; pass 2's
  `codex-adversarial` found the pass-1 docstring rewrite was itself self-contradictory and too
  narrow, rewritten again. Pass 3's `codex-adversarial` raised a further case (a whole array
  containing only a wrapper object, no primitive at all) — verified via a `git worktree` checkout of
  the pre-fix base commit to be IDENTICAL behavior before and after, not a regression, and dismissed
  as out of scope. The full pass's `codex-adversarial` (via `task`) found the docstring's "some,
  never every" heading had become false once `every(record)` was reintroduced as a disjunct, and that
  no test directly pinned the `NO_PAYLOAD`-vs-`UNREADABLE` boundary at the `findingsShaped` level
  (both fixed).

  **At the verdict point, Codex split from a fable-pinned verdict subagent** on two grounds: (1) a
  real but pre-existing, out-of-scope defect in `structured.mjs`'s `normalizeFinding` — `String()`/
  `Number()` coercion on `severity`/`line` throws on a JSON-producible object with no primitive
  coercion, verified identical at base and shipped code — deferred and filed as **OAI-195**; (2) the
  plan document itself had drifted from the shipped design across the review-ladder passes and was
  never amended at the time, a real process gap. Fixing that took **two further plan re-challenge
  rounds**: the first amendment attempt had its own internal contradictions (a Tests-section heading
  mismatching its own item list, a Docstring-section heading mismatching its own bullets, plus a
  genuine pass-attribution error Codex caught by re-tracing session history) — caught independently
  by both approvers and fixed in a second attempt, which received clean dual approval. Three plan-gate
  rounds total, archived in `plans/oai-114-findings-shaped-primitive-sibling.approved/`.

  Shipped in `16997a3` (fix + tests + plan). OAI-195 filed separately in `d33aa36`, since it is
  residue rather than part of this fix. Full suite green throughout (1114/1114 final).

## 2026-08-21 — OAI-160 shipped: dead/never-started note stops blaming a foreign plugin (`b04a3bf`, `5970422`)

- **OAI-160** — `job-render.mjs`'s `noteFor` had one unconditional message for a `dead`/
  `never-started` row: "written by a newer plugin", even for a row whose own `schema_version` this
  build understands fine. Two real, distinguishable causes reach that display state without a
  foreign row: (A) the DATABASE itself is too new (`user_version`), so `reconcileAll` never runs
  for any row this session, proved by execution against a seeded row; (B) reconciliation ran fine,
  but the row's liveness or a timing threshold (`STARTUP_GRACE_MS`) changed in the narrow window
  between that check and render — a benign TOCTOU race, found by Codex at plan-gate round 2, not a
  version story at all. `noteFor` now branches three ways on `isKnownVersion(view)` and a newly
  threaded `readOnly` parameter (through `renderList`, `renderDetail`, `cmd-status.mjs`'s `showOne`),
  naming the real cause per case; `job-view.mjs`'s `displayOf` docblock is corrected to stop claiming
  the old two-cause story is exhaustive. Plan-gate: episode 1 rounds 1-3 (two CHANGES-REQUIRED — a
  stale docblock claim, then the TOCTOU race the round-1 design missed — then APPROVE, digest
  `1d87a63b88e3`). Episode 2, opened AFTER that design was implemented, when review-ladder pass 1
  found the shipped case-B wording falsely claimed "the worker changed state" for the
  `never-started` sub-case (which can have no worker to change — a queued row crossing
  `STARTUP_GRACE_MS` with none ever registered), rounds 1-3 (two more CHANGES-REQUIRED, then APPROVE,
  digest `8b2f929c09c0`) — landed at `b04a3bf`.

  **`b04a3bf`'s own commit message is inaccurate** and is left uncorrected rather than amended: it
  describes episode 1's round-3 approval as "superseded before implementation by a mid-build
  amendment," but the amendment (episode 2) happened AFTER implementation, once review-ladder pass 1
  found the case-B bug on the already-implemented code. Disclosed as permanent git-history residue.

  **A resumed review-ladder pass over `b04a3bf` (four discovery passes) found the case-B message
  still made false per-row claims, fixed in `5970422`:** pass 1 removed "this build did reconcile
  the database this run" (implied THIS row was checked; false for a row stuck in an unsupported
  state `abandonUnstarted`'s `WHERE state = 'queued'` never matches, which survives every run
  untouched — codex-plain). Pass 2 removed "left this row exactly as found" (also a per-row claim;
  false for a row a concurrent submission inserts after `reconcileAll`'s `listJobs()` snapshot, whose
  worker then dies before render — never examined at all — codex-adversarial + codex-plain,
  independently converging). Pass 3 removed "usually a benign race" (an unmeasured frequency lean
  contradicting the design's own no-lean comment, and inverted for exactly the readers who see the
  note more than once — a scout, confirmed by codex-adversarial). Pass 4 (terminal) closed two more
  candidates as non-blocking for the shipped string (a comment-only overclaim, fixed as an exempt
  post-approval reword; a re-confirmation that the persistence clause is vacuous-not-false for a
  `dead` display, first dispositioned at pass 2) — both judged by two independent reviewers plus a
  closer.

  **The verdict point itself then took three rounds**, each closing a real gap in the tests rather
  than the shipped string: round 1 (Codex CHANGES-REQUIRED) found the two `queue-reconcile.test.js`
  regression tests used only fragment assertions (`doesNotMatch`/short `match`), which a
  differently-phrased regression could still pass — fixed with `text.includes()` of the complete
  literal note. Round 2 (Codex CHANGES-REQUIRED again) found `includes()` tolerates appended text
  alongside a correct match — fixed by switching to `assert.equal` against the row's own note line
  (`text.trim().split('\n').pop()`, valid because each fixture seeds exactly one row). Round 3: both
  approvers (Codex + an independent fable-pinned Claude verdict subagent) approved, digest
  `d4bb8e8376f2`. Every one of the seven fixes across both the pass chain and the verdict-point chain
  is mutation-proven — a targeted substitution or, for the verdict-point rounds, a specifically
  appended-text mutation, each reproducing exactly the assertion built to catch it; restored and
  reconfirmed green (1109/1109) every time.

  **Process notes, disclosed rather than hidden:**
  - The review-ladder pass that first found the case-B wording bug (on the original `b04a3bf` code)
    ran all three groups correctly against one frozen version, but its fix was applied mid-pass,
    before `agent-closer` ran — breaking the one-version-per-pass invariant. Caught by the advisor
    before the verdict point; fixed by treating it as pass 1 truncated-and-resumed (full stage
    re-run against the fixed version) rather than proceeding on a mixed-version read. The code was
    also committed (`b04a3bf`) before that resumed pass ran at all — a second, related slip, fixed
    the same way: the resumed pass ran against the committed bytes rather than being skipped because
    a commit had already landed.
  - Group-boundary git-status/hash checkpoints (the ladder's own requirement — after each of Groups
    A/B/C, plus once before the verdict digest) were skipped in the resumed pass's first three
    discovery passes (only opening baselines were taken); pass 4 took them properly at every
    boundary, all clean, no drift found.
  - OAI-184 and OAI-193, shipped earlier the same session, took their verdict points at diff-shaped
    review-ladder passes rather than a guaranteed first full pass — not reopened, but noted here so
    a later session catches it earlier.

## 2026-08-20 — OAI-193 shipped: setup --json surfaces listUnavailable (`1988153`)

- **OAI-193** — `cmd-setup.mjs`'s `jsonRow` never read the `listUnavailable` field `probeProvider`
  sets, so `/oai:setup --json` reported a "reachable, but serves no model list" provider as
  indistinguishable from a fully healthy one (`reachable: true, error: null` regardless). Found
  incidentally during OAI-185's review ladder. Fixed by mirroring the text view's semantics
  (`render.mjs`'s `providerLines` already showed this case) — `jsonRow` now returns
  `listUnavailable`, `reachable`/`error` unchanged. Dual-approved at both the plan gate (digest
  `399700b8c442`) and the verdict point (pass digest `b2052c350f2e`). One accepted
  codex-adversarial finding (severity medium, confidence 0.93: this diff newly places
  `transportDetail`-composed server response bytes, up to ~400 bytes, into the machine-readable
  `--json` channel, previously 0 bytes there) was dismissed rather than fixed — same bytes, same
  stdout, same operator, already-sanctioned for this command's text view since OAI-185's own pass 1;
  no in-repo consumer persists `--json` output anywhere (confirmed by grep). Not filed as a new
  backlog item — the exposure Codex names is prospective (a reflecting server plus an external
  capture pipeline that doesn't exist in this repo), not a dated instance or a mechanism that has
  actually fired, so it fails the 2026-08-18 worth bar; the codex-adversarial transcript is the
  citable evidence if it ever does. Plan: `plans/oai-193-jsonrow-listunavailable.md`.

## 2026-08-20 — OAI-184 shipped: dead db/seq params dropped from runJob (`da2c34a`)

- **OAI-184** — `cmd-task-worker.mjs`'s `runJob(db, seq, job)` never used `db` or `seq`; only `job`
  was read. Found by Codex during OAI-63's review-ladder pass 6, on a file OAI-63's diff only touched
  by one unrelated docblock comment — confirmed pre-existing, not introduced by that fix. Module-private,
  one call site (`runAndPublish`), no test double or other caller depended on the 3-arg arity. Shipped
  as `runJob(job)`, call site updated to match. Cosmetic, no behavioural effect — confirmed by a
  full-table review-ladder pass (acceptance-audit, codex-adversarial, codex-plain, agent-closer, all
  zero findings) and dual-approved at both the plan gate (digest `1d87a63b88e3`) and the verdict point
  (pass digest `8202870127ee`). Plan: `plans/oai-184-runjob-dead-params.md`.

## 2026-08-20 — OAI-6 and OAI-8 given real entries, migrated from the retired absorbed-ID table

Both had shipped and were never independently filed — the old table's "Was/Now" rows described them
as `*shipped*` rather than redirecting to another ID, with the full description below already
written there. Moved here as ordinary entries now that the table (and the tier-ranking index beside
it) is retired, owner-directed, 2026-08-20 — matching the same removal in `~/Code/backlog` and
`~/Code/dotfiles`.

- **OAI-6** — Streaming output for `/oai:task`. **Recovered 2026-08-13 by the sweep**, which found it
  cited by OAI-13 and resolving NOWHERE — it predates the done-file convention. Shipped:
  `scripts/lib/stream-collect.mjs`, and `http.mjs:157` requests `text/event-stream`.

- **OAI-8** — Liveness while a run is in progress. Same recovery, cited by OAI-9. Shipped:
  `scripts/lib/progress.mjs`, which renders a prefill-aware elapsed line.

## 2026-08-20 — OAI-156 shipped: a whole-document YAML-ish findings reply is recovered instead of discarded (`d397deb`)

- **OAI-156** — A complete, well-formed findings list expressed as whole-document YAML-ish prose (no
  bracket pair anywhere) was silently discarded, because `scripts/lib/json-scan.mjs`'s `extractJson`
  works exclusively on balanced-bracket runs. Reproduced 2026-08-14 on commit `9a38a2a6b`: 1,245
  seconds of real model work discarded this way, and the discarded reply's first finding named the
  same defect a separate baseline run had already reported as bracketed JSON on the same commit — not
  noise, a real finding lost to a parser gap.
  **Shipped**: a new module `scripts/lib/findings-yaml.mjs`, a narrow, whole-document-only YAML-ish
  acceptor — never a general YAML parser. It accepts a reply only when the entire trimmed text is a
  top-level `findings:` key, one or more `- `-prefixed flat-mapping items, and an optional trailing
  `summary:` scalar; anything else is a flat reject, never a partial parse. That whole-document-only
  posture sidesteps the decoy-vs-real-payload ranking problem `extractJson`'s own comments document as
  hard-won for the bracketed case. Never throws, matching `extractJson`'s own contract — which is what
  keeps it correctly outside `tests/structure.test.js`'s `RESPONSE_BOUNDARY_FILES` guard rather than
  needing enrollment in it. `scripts/lib/structured.mjs`'s `findingsIn` attempts `findingsInYaml` only
  when `!structured` — never on the constrained (`--structured-output`) path, where a
  schema-conforming JSON payload is the whole promise and racing the two acceptors risked a YAML
  reading pre-empting a valid embedded JSON payload before `matchesSchema` ever saw it.
  **Design converged with Codex plus a fable-model third opinion across 3 plan-gate rounds**: round 1's
  "the two grammars are provably disjoint" claim was refuted by both reviewers independently (a YAML
  value can carry an embedded balanced bracket run as ordinary scalar text); round 2 fixed this with an
  explicit leading-bracket rule and the `!structured` gate, but Codex found the round-2 test fixtures
  didn't actually discriminate the mutations they claimed to catch (an unmatched `{` proves nothing
  about ordering, and a `null`-vs-`null` comparison can't distinguish a correct gate from a broken one);
  round 3 fixed this with a genuinely discriminating fixture (an embedded, balanced, findings-shaped
  JSON object inside a YAML value, whose two possible readings disagree observably), approved by both.
  **The review-ladder's first pass found and fixed six real implementation gaps**, none caught by the
  plan gate: Group A (`acceptance-audit` + `fork-opener`, converging independently) found the trailing
  `summary:` scalar skipped the leading-bracket check every item field goes through, and a tautological
  no-regression test (comparing two calls of the same function to each other, which cannot fail — fixed
  by pinning against the actual expected output shape). Group B (`codex-adversarial` + `codex-plain`,
  converging independently on the same two bugs) found a repeated field key silently overwrote the
  earlier value and bypassed the 20-field cap, and a value beginning with YAML-special syntax this
  narrow acceptor cannot interpret faithfully (quotes, anchors, aliases, tags, block scalars) was read
  literally rather than rejected; `codex-plain` additionally found the continuation-indent check
  compared indent by length only, not as a strict prefix of the item's own indent. Group C
  (`agent-closer`, fable) found `__proto__` as a field key defeats this same pass's own duplicate-key
  fix (assigning a string to `item.__proto__` is a silent no-op, never an own property). Every fix
  carries a regression test and is mutation-proven (mutate the fix, confirm the target test goes red,
  restore, confirm green). **The terminal verdict point itself ran two rounds**: round 1's Codex found a
  leading `#` (YAML comment indicator) was read literally instead of rejected — a genuinely disputed
  point (the round-1 fable verdict subagent judged this a sound boundary, not a defect) resolved in
  Codex's favor on the plan's own text ("a value that itself needs YAML quoting to disambiguate is out
  of scope"); fixed and re-verified by both reviewers on round 2.
  Full suite 1108/1108 green throughout.
  **Ran unattended, without harness plan-mode** — same standing operator authorization already
  disclosed for OAI-185, OAI-115, and OAI-116, applied consistently.

## 2026-08-20 — OAI-116 shipped: a token-exhaustion failure now carries its attempt ledger (`bc41fd5`)

- **OAI-116** — A run lost to token exhaustion (or a reasoning-only reply with no usable answer) was
  recorded with `attempts: null`, because `scripts/lib/review-unparsed.mjs`'s `unparsedReply` — a
  post-hoc classifier of an otherwise-successful transport interaction — threw its `UserError` without
  ever attaching the request's own closed, populated ledger entry. This made OAI-19's gate criterion
  G-E ("a missing or self-inconsistent `attempts[]` on any run invalidates the invocation")
  structurally unpassable for any run that hit it — and since token exhaustion had become the
  dominant overnight-sweep failure mode (reconfirmed 2026-08-14: four of 40 commits starved, all four
  `attempts: null`), no benchmark arm could pass its own gate.
  **Shipped**: `unparsedReply` threads a `ledger` parameter and wraps both its throw paths — the
  `finish_reason === 'length'` branch, and a narrow wrap (only around the one call, not the whole
  function) on the `requireAnswer` fallthrough for a reasoning-only reply — with the existing
  `withLedger(error, ledger)` helper before throwing. `review-report.mjs`'s `reportFindings()` gained
  `ledger` in its own parameters; `parseFields()`/`jsonReport()` needed no change, since they already
  thread the whole `context` object through. Deliberately does not touch OAI-163's distinct, parked
  concern (a null `reason` field on the same `requireAnswer` throw, misclassified by the sweep's
  outage detector) beyond the incidental, harmless `attempts[]` attachment.
  **Unblocks OAI-19** (tier 6) together with OAI-115 — both instrument defects blocking the
  measurement programme are now shipped.
  **Ran unattended, without harness plan-mode** — same standing operator authorization already
  disclosed for OAI-185 and OAI-115, applied consistently.
  **Design converged with Codex in one steer — no genuine fork**, every question single-answer
  (thread `ledger` into `unparsedReply` itself, not wrapped at the two call sites; also wrap the
  `requireAnswer` fallthrough since it costs nothing and doesn't touch OAI-163's actual defect; no
  special handling needed for the salvage/retry interaction, since the ledger is created once and
  shared). A 1-round dual-approved plan gate, and a review-ladder pass where four independent
  reviewers (`acceptance-audit`, `fork-opener`, `codex-adversarial`, `codex-plain`) all found zero
  findings — `codex-adversarial` additionally ran a write-free module probe confirming the ledger's
  idempotency safety and the salvage/retry interactions directly. The terminal `agent-closer`
  (`fable`) hung once mid-`npm test` on its first launch (killed after 20+ minutes per the ladder's
  one-retry rule) and, on retry, independently executed its own negative control — reverting the fix
  to HEAD, confirming both new regression tests fail with the exact pre-fix symptom
  (`attempts: null`), then restoring and confirming green — before verdict CLOSE THIS PASS. Dual
  approval (Codex + an independent Claude verdict subagent, neither shown the other's reply) closed
  both the plan gate and the review-ladder's own verdict point. Full suite 1083/1083 green throughout.

## 2026-08-20 — OAI-115 shipped: a starving reasoning stream is cut before max_tokens is exhausted, and salvaged (`917c7fb`)

- **OAI-115** — `max_tokens` is a single pool shared by a reasoning model's thinking and its actual
  answer; on this repo's own hardware a model could spend nearly the whole budget reasoning and never
  write an answer, measured model-modulated (MoE 4-5/6 cases, dense 1/6, and dense has the *smaller*
  window — not fixable by picking a bigger model). Two easy fixes were already refuted by measurement:
  a larger budget is simply consumed (a 4.5x increase moved one metric from 0/3 to 1/3, not to a fix),
  and no server-side reasoning-control parameter works on this server (three tried, silently ignored).
  A 17-run sample of successful answers put the real cost at 205-1,116 tokens (median ~420), sizing the
  reserve this fix protects.
  **Shipped**: `stream-collect.mjs`'s `collectStream` gains a live, opt-in watchdog — once estimated
  reasoning tokens cross `(maxTokens - reasoningReserveTokens) * 3.0` chars, and only while `content`
  is still empty, it disposes the stream and throws synchronously with a dedicated
  `token-reserve-cutoff` reason (never `-timeout`, since several `bench/` paths classify any
  `*-timeout` reason as timing data). OAI-138's existing `trySalvage()` salvage mechanism is
  generalized via a reason allowlist to attempt the same "conclude from partial reasoning" follow-up
  for this trigger too, budgeted at a flat 2,048 tokens for this reason and left byte-for-byte
  unchanged (`built.reserve`) for the original `deadline-timeout`. Armed only when
  `built.reserve >= 2 * TOKEN_RESERVE_TOKENS` (4,096) — below that the cutoff would fire on the very
  first reasoning delta — and **never** for `--structured-output` requests (the real answer
  legitimately arrives via the reasoning channel under a `response_format` grammar there, making the
  content-empty guard meaningless) or the salvage follow-up itself (`reasoningReserveTokens` is never
  added to the shared `send` object, which is also spread into the follow-up's own call).
  **Ran unattended, without harness plan-mode** — same standing operator authorization and deviation
  from `plans/README.md`'s `unattended-draft`/`blocked-on-plan` posture already disclosed for OAI-185,
  applied consistently here rather than re-litigated.
  **Design converged with Codex across an unusually deep process**: a 4-round plan gate before any
  code existed, where three straight independent verdict subagents each found one real,
  previously-missed defect in the value's propagation chain (`review-request.mjs` → `client.mjs` →
  `answer-attempts.mjs` → `chat.mjs` → `stream-collect.mjs`) — a field silently dropped by
  explicit-field-list destructuring at two separate hops, and a budget-clamp formula that was a
  mathematical no-op — each caught only by re-tracing the whole chain rather than trusting the
  previous round's fix. Then a 3-round review-ladder pass, where `codex-adversarial` and `codex-plain`
  found and fixed: a structured-output false-trigger risk; a bug where a bare `dispose()` (no throw)
  let the watchdog's failure be silently discarded when a finish frame and `[DONE]` arrived buffered
  in the same transport chunk as the crossing frame; and, on a further round re-checking that very
  fix, a subtler async-iterator-cleanup race — throwing synchronously still runs `IteratorClose`
  before the `catch` executes, and that cleanup can itself await, leaving a gap where the semantic
  deadline timer could overwrite the cutoff's own failure — closed by making the deadline callback
  idempotent and clearing it early. Plus five smaller correctness/documentation fixes (a weak test
  assertion, inaccurate provenance attribution, stale comments, two stale plan-document passages
  caught by the terminal `agent-closer`). All nine findings fixed and mutation-tested; full suite
  1081/1081 green at every checkpoint. Dual-approved (Codex + an independent Claude verdict subagent,
  neither shown the other's reply) at both the plan gate and the review-ladder's own verdict point.

## 2026-08-20 — OAI-185 shipped: server-controlled content no longer reaches a persisted or logged UserError message (`d9dca45`)

- **OAI-185** — OAI-63's other confirmed sibling: the authorized endpoint's own `baseUrl` can itself be
  secret-shaped, and a connection or protocol failure echoed it verbatim into the persisted job record.
  Ran unattended, without harness plan-mode (the operator was away and gave standing authorization to
  proceed on Codex+Claude dual approval instead of their own sign-off — a deliberate deviation from
  `plans/README.md`'s `unattended-draft`/`blocked-on-plan` posture, disclosed in the plan file and
  flagged here for the record) — probe, grill (Codex-converged, no operator present), a 3-round plan
  gate, then an 8-pass review ladder.
  **Shipped**: `profile.baseUrl`/a server's echoed HTTP body/a redirect `Location`/an HTTP reason
  phrase/a JSON-parse excerpt/a `content-encoding` header/an unvalidated `finish_reason` all now travel
  on structured fields (`error.endpoint`, `error.responseBody`, `error.bodyExcerpt`,
  `error.finishReason`) rather than inside `.message`/`.hint` — composed for display only by a new
  `transportDetail()` helper, called only from a genuinely interactive command's own top-level catch
  (an explicit `Object.hasOwn` allowlist, never the background worker) or `cmd-setup.mjs`'s own
  rendering. `errorReport()` never copies any of the four fields, by explicit field list.
  **Discovery, not scope creep**: the plan named one site (`describeFailure`); the review ladder found
  six more of the exact same class across seven files (`provider.mjs`'s `assertOk`, `body.mjs`'s
  `readJson`, `sse.mjs`'s `readSse`, `http-errors.mjs`'s `assertDecodable`, `completion.mjs`'s
  `refuseUnusable`, `client.mjs`'s `requireAnswer`) — each pass finding one fewer than the last, four
  independent full-`scripts/`-tree sweeps converging on the same residual before the ladder closed.
  **A functional regression caught and fixed within the same ladder**: an early fix dropped
  `statusText` outright rather than folding it in like the redirect `Location` fix did, silently
  breaking `isFormatRejection`/`refusedField`'s capability-fallback detection for a server signalling
  refusal purely through the HTTP reason phrase with an empty body — found by Codex, fixed by folding
  `statusText` into `.responseBody` alongside the body detail, proven with a real HTTP request through
  `assertOk` (not a constructed error object).
  **A permanent structural test** (`tests/structure.test.js`, "no server-controlled value reaches a
  UserError message at the response boundary") scans the seven response-boundary files for this exact
  pattern, per this repo's "confirmed twice → structural test" rule (this class was confirmed seven
  times). The guard is itself proven against ten fixture reproductions of every historical leak this
  ladder found, each asserting every expected offending expression individually — a real
  regex-backtracking bug in the guard's own bare-`hint`-value scanning was found and fixed along the
  way (Codex review of the guard itself, not just the production code).
  **Three findings deferred as separate items**, each with a stated reopening condition: OAI-192 (a
  spawn error's local-process message, low/theoretical risk, different error type), OAI-193
  (`cmd-setup.mjs`'s `jsonRow` never reading `listUnavailable`, a pre-existing unrelated `--json` gap),
  OAI-194 (a server-reported model id reaching a message via `model-selection.mjs`/`delegate.mjs`,
  real but structurally unreachable through the background persistence path this fix protects).
  **Process**: 8 review-ladder passes (acceptance-audit, adversarial and plain Codex review,
  fork-opener, agent-closer), each accepted finding mutation-tested (fault injected, proven caught by
  a named test, restored, re-verified green) before the next pass. `fork-opener` failed twice with a
  narration-echo reply early in the ladder (a known, previously-documented failure mode) and was
  retried once each time per the skill's rule, then ran cleanly for the remaining six passes. Dual
  approval (Codex + a fresh Claude verdict-only subagent, neither told the other's reply) at digest
  `30a0eb38055e`. Full suite: 1072/1072.

## 2026-08-20 — OAI-183 shipped: pin the credential SOURCE a background job was authorized for (`f1d1982`)

- **OAI-183** — Split from OAI-63 2026-08-17: a worker could still send the wrong secret to the right
  endpoint via a `providers.json` `apiKeyEnv` repoint between submission and execution, since OAI-63's
  endpoint-vs-endpoint compare passes it through unchanged. The design fork was whether to pin the
  credential *value* (a hash) or its *source* (which env var, or inline) — Codex's decisive steer,
  taken over a value hash: source pinning preserves legitimate key rotation (a new value behind an
  unchanged source keeps working), while a value hash would strand every job still queued across an
  ordinary rotation.
  **Shipped**: `authPolicyFor` persists a tagged `credentialSource` (`{kind:'env', name}` or
  `{kind:'inline'}`) at submission, written only when a key was authorized; `resolveCredential`
  enforces it at resolution — an `apiKeyEnv` repoint or an env/inline transition refuses, an ordinary
  value rotation behind the same source still runs. `ROW_SCHEMA_VERSION` bumped 2→3; a row from
  `schema_version` 1 or 2 keeps today's behaviour unchanged (no source check at all); a v3 row with a
  missing or malformed pin fails closed rather than defaulting to the current source. `apiKeyEnv` is
  now validated as a non-empty string at config load (`validateConfig`, not `resolveApiKey` — the
  cross-endpoint `--base-url` scrub deletes `apiKeyEnv` before `resolveApiKey` would ever see it).
  **Deliberate, documented scope boundary**: the pin freezes the credential *slot*, not the secret
  *value* — an inline `apiKey` edited in place still passes, the same rotation-safety property as the
  env case, consistent with the codebase's standing rule that a credential is never persisted or
  value-pinned. A test asserts this passes on purpose.
  **Process**: probe (Codex, 4/4 claims verified), grill with Codex's steer on two design forks, six
  rounds of a dual-approved plan gate (Codex + an independent Claude verdict subagent, neither shown
  the other's reply) — every round found a real defect in the plan text and folded it in, none
  reopened the design itself. Two mutation checks proved the `kind` and `name` comparisons are
  independently load-bearing (a single mutation cannot cover both flagship tests, since the repoint
  case has both pins at `kind:'env'`). Full review-ladder pass, dual-approved: one accepted, ship-safe
  finding (a `job-store.mjs` docblock claim about which files gate on `isKnownVersion` was not
  exhaustive — corrected; fix confined to exempt descriptive-prose surface, non-blocking); two
  dismissed (the already-settled inline-value scope boundary re-raised independently by Codex's
  adversarial pass; a suggested code simplification that would have discarded a mutation-detectability
  property proven necessary in this same session); one noted in the review transcript rather than
  filed to the tracker — a hand-edited-`jobs.db` `schema_version` forgery, which requires a threat
  model (local SQLite write access) this subsystem defends against nowhere, which OAI-183 narrows
  rather than worsens, and which fails the repo's own filing-worth bar (no dated instance, purely
  hypothetical).
  **Residue**: none — every finding raised across probe, plan gate and review ladder was fixed,
  dismissed with reasoning, or explicitly noted as not clearing the filing bar. No item deferred, no
  item left open at approval.

## 2026-08-19 — OAI-55 shipped: named-profile query credential no longer persisted raw (`581ac7b`)

- **OAI-55** — The item's original filed framing had two halves: the secret persisting into
  `jobs.db`, and leaking via the delegate's unredirected stderr into the session transcript. Probing
  this session found the transcript-leak half already fixed on disk (`noteEndpointPersistence()`
  takes no argument and interpolates nothing; nothing renders `transport.query`). The remaining,
  real defect was plaintext-at-rest: a named `providers.json` profile's query string (a real
  credential, e.g. `?api_key=...`) persisted raw in `jobs.db` for the life of a job row. The user
  chose to fix the fixable case (named profiles) and leave ad hoc `--base-url` and path-embedded
  credentials as documented, accepted residue — the command line is their only copy, and re-invoking
  the CLI with it in `argv` is worse (visible in `ps`).
  **Shipped**: `job-auth.mjs`'s `authPolicyFor`/`resolveCredential` extend the existing `apiKey`
  doctrine (never persist, re-resolve from live config at worker time, bind to the frozen endpoint —
  OAI-63) to a profile's query string. A named, non-`adHoc`, non-empty query now stores only a salted
  SHA-256 commitment (`queryCommitment`/`querySalt`) in `transport`, not the raw value; the worker
  re-resolves the query fresh from config and verifies it against the commitment, refusing on drift
  exactly as the raw path did. Key authorization and profile provenance are tracked as two separate
  facts (`apiKeyAuthorized`) so a query-only credential can be re-resolved without ever authorizing a
  key nothing granted at submission — the escalation a query-only profile that later *gains* an
  `apiKey` would otherwise create. `ROW_SCHEMA_VERSION` bumped 1→2 for a legacy-default fallback that
  is scoped to `schemaVersion === 1`, not to "the field is missing", so a malformed v2 row can't
  silently inherit the fail-open default (a HIGH-severity finding from the review ladder's
  `codex-adversarial` stage). Ad hoc `--base-url` and path-embedded credentials are unchanged, and
  `noteEndpointPersistence()`'s wording now states that residue explicitly rather than implying full
  coverage.
  **Review-ladder: 3 discovery passes converged on zero remaining code defects** (2 real fixes: the
  `queryHash` presence-vs-truthiness discriminator, and the schemaVersion-scoped legacy default),
  **then 7 verdict-point rounds** before dual approval — rounds 1-4 were genuine artifact-completeness
  gaps in the frozen file manifest (each real, each fixed: missing consumers of changed exports,
  missing files naming a changed path); round 5 was a scope-of-search-method disagreement (imports
  only vs. all textual mentions) that an advisor consult resolved in Codex's favor — the ladder's
  "found by searching, not by judgement" rule explicitly includes docs, and a judgement-based
  narrowing to "functional dependents" is exactly what it forbids; rounds 6-7 were mechanical: a
  locally-aliased `grep` (`ugrep --ignore-files`) was silently applying `.gitignore` and dropping the
  entire `bench/results/` tree, and an over-broad `--exclude-dir=.claude` excluded more than the
  authorized `.claude/worktrees`. The final 162-file manifest (`command grep`, exactly `.git` and
  `.claude/worktrees` excluded, nothing else by judgment) approved on both sides with zero code
  findings across the last 5 rounds. Suite: 1040/1040 green.
  **Accepted residue, confirmed still true after shipping**: ad hoc `--base-url` still stores its
  query raw; a credential embedded in the URL *path* (not the query) still persists raw and renders
  via `job-render.mjs`, for named profiles as much as ad hoc ones — a strictly wider problem than
  this item, out of scope by design (no credential-shape detection, per the settled fork). Neither is
  a new tracker item: both were pre-declared, documented scope limits in the plan, not defects found
  during the ship.

## 2026-08-19 — OAI-138 shipped: doubled `--max-seconds`, added salvage (`64ce8e2`)

- **OAI-138** — **Half the eligible corpus was being lost to a per-commit deadline that was never
  calibrated for it, and everything the model had already reasoned through at the deadline was
  discarded.** User-prioritized 2026-08-19: "double the max seconds, and salvage." Full prior
  disposition (cap value, right-censoring argument, the four-commit probe, the throughput
  correlation) stays in `evidence/138.md`, unchanged. This entry records what actually shipped.
  **Change 1**: `bench/review-sweep.mjs`'s per-commit `DEFAULTS.maxSeconds` doubled from 1800 to 3600.
  **Change 2 (salvage)**: tier 1 — `scripts/lib/stream-collect.mjs`'s `collectStream` now attaches
  whatever partial `content`/`reasoning` had already streamed onto any failure it catches, instead of
  discarding it (same move, same reasoning as the pre-existing `.timings` attachment). Surfaced as a
  `partial` field on the JSON error envelope (`scripts/lib/review-report.mjs`'s `errorReport`) and
  carried onto a bench sweep's failed-entry classification (`bench/lib/outcome.mjs`'s new
  `partialFrom`, `bench/lib/sweep-outcome.mjs`'s `failure()`).
  Tier 2 — `scripts/lib/review-request.mjs`'s new `trySalvage`, called from both of `requestFindings`'s
  catch sites (the ordinary/`isFormatRejection`-fallback path via `unconstrained()`, and the
  `--structured-output` path directly), fires exactly one bounded follow-up chat completion when the
  failure is specifically `deadline-timeout` with substantial partial reasoning (500+ chars) and
  empty/near-empty partial content: a genuine 4-message array (original system+user unchanged, a
  synthetic assistant turn carrying the partial reasoning, a new user turn asking the model to
  conclude now), on its own independent 300-second budget (`SALVAGE_MAX_MS`, never reusing the
  original `--max-seconds`), re-validated against the context window before sending (refuses rather
  than sends unchecked if the grown prompt no longer fits). On success, tagged `salvaged: true` and
  threaded through every findings-rendering surface (JSON envelope, text report's parsed and
  unparsed-reply branches, bench sweep Markdown report) as a visible, unmissable warning — the item's
  own non-negotiable constraint: *"a salvaged review must never read as an ordinary complete one."*
  `retried` (`review-report.mjs`'s `runTimings`) now derives from the shared ledger's total entry
  count rather than the last completion call's own `requestCount`, so a review that failed once then
  salvaged successfully correctly reports `retried: true`.
  **Review-ladder: 8 discovery passes (Claude scouts/reviewers + Codex), each finding and fixing one
  real, progressively narrower defect** before converging: (1) text-report caveat gap for a salvaged
  unparsed reply; (2) missing context-window recheck before sending the follow-up; (3) two real Codex
  findings — `--structured-output` bypassed salvage entirely (its request path never called
  `trySalvage`), and a successful salvage misreported `retried: false`; (4) the follow-up claimed a
  JSON shape was "already asked for" when, for the `--structured-output` path, no message had ever
  actually stated it (only a grammar the follow-up doesn't reapply) — fixed by having `trySalvage`
  always state the shape itself via `schemaInstruction(findingsFirst(schema))`; (5) that same
  follow-up needed to explicitly override a stale, contradicting system-message instruction
  (`ANALYSIS_FIRST`) rather than silently embedding a conflicting shape; (6)-(8) three successive
  test-completeness gaps in the regression coverage for fix (5), each found by Codex and closed in
  turn (a regex that only matched a fragment of the override sentence; `.includes()` proving presence
  but not adjacency to the schema instruction that followed it; a missing message-count assertion that
  let a stray inserted turn go undetected). **Dual-approved** at the final digest by Codex and an
  independent Claude verdict subagent, neither shown the other's reply.
  **Known, disclosed, user-accepted residual limitation** — not a defect, a decision: the override
  sentence's effectiveness against a real instruction-hierarchy-aware model (system messages typically
  outweigh user messages) cannot be guaranteed by a stateless chat-completions API. The user was
  offered a choice between shipping this best-effort mitigation or pursuing a much larger restructure
  of `review.mjs`'s shared system-prompt construction (touching every review path, risking the
  prefix-cache property `adr/009` — since deleted, see OAI-159 — specifically engineered for), and
  chose to ship as-is. Consistent with an earlier-accepted result in the same feature: a live test
  against a real LM Studio server showed 0/2 salvage recoveries, attributed to genuine model behavior
  (a reasoning model restarting its own reasoning despite instructions) rather than a construction
  bug. Every salvage attempt fails gracefully to the ordinary failure report (tier 1's partial still
  attached) and every success is loudly labelled — nothing here can silently misrepresent a truncated
  review as a complete one, whether or not the override actually works on a given model.
  **Live verification, completed 2026-08-19** (`bench/results/oai138-salvage-reverify-2026-08-19/`):
  re-ran the 11 commits that failed with `deadline-timeout` in the 2026-08-18 overnight sweep, at the
  new 3600s cap, against a real LM Studio server. **9 of 11 now complete successfully** — the doubled
  cap alone was sufficient; none of the 9 needed salvage (`salvaged: false` on every one), they simply
  finished within the extended budget with real findings (0-4 per commit). **2 of 11
  (`6b3fead3`, `d1f3e2c8`) still fail, but the failure mode changed**: `token-exhaustion` rather than
  `deadline-timeout` — given twice the time the model reasons twice as long and still exhausts the
  reply-token budget before writing findings. That is OAI-115 (reply-token starvation), already
  tracked, not a new defect. **Salvage never fired in this run** — none of the 11 commits landed in
  its trigger shape (`deadline-timeout` specifically) at the new cap, so this run is real evidence
  Change 1 alone recovers most of this corpus, but gives no live evidence either way on salvage's own
  effectiveness. That remains exactly the disclosed, already-accepted gap above; a future overnight
  sweep hitting a genuine `deadline-timeout` at 3600s is what would finally exercise it live.
  Shipped `64ce8e2`. `npm test` green, 1027/1027, verified in the committed tree.

## 2026-08-19 — closed by the user-directed backlog review

- **OAI-131** — ANSWERED, no action needed: `idle-timeout` was never observed across 22 failures during the OAI-9-family model-matrix run. Closed 2026-08-19 in the user-directed backlog review as a settled finding, not deferred work.

## 2026-08-18 — OAI-72, OAI-93, and OAI-102 closed (`cb5b225`)

- **OAI-72** — **Two credential-exposure defects outside the OAI-3 range.** **(a)** `config.mjs`'s
  `loadConfig()` wrote `providers.json` with no mode on first run and never repaired a pre-existing
  loose file on later reads — the same shape OAI-65(b) closed for `jobs.db`'s directory. Fixed:
  `writeFileSync(..., {mode: 0o600, flag: 'wx'})` at creation, and an unconditional `chmodSync(path,
  0o600)` on every successful read, before content validation. **(b)** `cmd-setup.mjs`'s `probeProvider`
  built its `buildProfile`-failure fallback row from the raw, un-normalized `rawProfile.baseUrl` —
  reachable on any `buildProfile` throw (a missing `apiKeyEnv` value, most commonly) — and
  `render.mjs` printed it to stdout verbatim, including any query-embedded credential. Fixed: a
  `fallbackBaseUrl()` helper redacts through `normalizeBaseUrl` first, falling back to a static
  placeholder only if that itself throws.
  **(c)** moved into OAI-63 on 2026-08-05; closed there.
  A three-round review-ladder chain on the mode-repair logic surfaced and closed four further gaps
  before this shipped: the read-path chmod repair silently swallowed `EPERM`/`EACCES` (a file the
  process could not protect stayed loose and was used anyway) — fixed to re-throw for anything except
  `ENOSYS`/`EINVAL` (what a genuinely mode-less filesystem actually returns; the first attempt at this
  had the polarity backwards, wrongly treating `EROFS`/`EIO` as "no modes here"); the create-path write
  used the default truncating flag, so a concurrent creator racing the `ENOENT` check could have its
  file silently truncated — fixed with `flag: 'wx'` and an `EEXIST`-recurse; that recurse was itself
  unbounded, and a dangling symlink at the config path (`readFileSync` sees `ENOENT` on the missing
  target, the `wx` write sees `EEXIST` on the link itself, on every attempt) recursed to a raw
  stack-overflow `RangeError` — bounded via `MAX_CREATE_RACE_ATTEMPTS = 3`, with `loadConfig()` now a
  zero-arg wrapper around `loadConfigAttempt(attempt)`, throwing a clear `UserError` on exhaustion.
  All four fixes and their tests are mutation-proven; two structural test pins were themselves found
  checking substring order rather than branch membership (a branch-swap mutant would have passed them)
  and rewritten anchored on single contiguous regexes, whitespace-normalized against reformatting.
  Live-checked: a hand-loosened real `providers.json` (`chmod 644`) was repaired to `0600` by a real
  `/oai:setup` run, and a scratch config with a query-embedded fake secret and an unset `apiKeyEnv`
  produced no leak anywhere in the output.
  **Disclosed, accepted, non-blocking residue, not fixed here** — see the three live entries below:
  `http.mjs`'s unsupported-protocol branch still interpolates a raw URL but is unreachable via any
  config-sourced input (filed as **OAI-189**); `validateConfig`'s numeric-only interpolation (filed as
  **OAI-190**); the JSON-parse-leak test's marker check is V8-version-dependent in principle but the
  test also asserts the exact static message, so the vacuity (if any) is benign (not filed — no action
  possible against a hypothetical future V8 behavior).

- **OAI-93** — **`providers.json` is created world-readable and holds the long-lived credential.**
  The exact same defect as OAI-72(a), filed separately before the two were recognised as one; closed
  by the same fix in the same commit.

- **OAI-102** — **The refusal for a credential in a URL prints that credential.** `normalizeBaseUrl`'s
  three throw sites (unparseable, non-http scheme, embedded userinfo) all built their message from the
  raw input. The exact fix OAI-72(b)'s own review chain produced for the same function, landed in the
  same commit: none of the three now interpolates any raw input, structurally rather than by scrubbing
  a wrapped message (OAI-63 tried scrubbing and was defeated four times by a narrower shape each round).

## 2026-08-18 — OAI-180 closed by the backlog sweep

- **OAI-180** — **`BACKLOG.md`'s Tier 9 line and OAI-176's own body disagree on how many instances of
  the `fork-opener` echo defect have been observed.** Filed 2026-08-17 from OAI-165's verdict-point
  review (round 1, Codex) — flagged there, ruled out of scope for OAI-165 since it predates that diff
  entirely (the second-instance text was committed 2026-08-17 in `711c66a`, before OAI-165's own
  baseline). The tier summary still said *"one observed instance... needs a second instance before it
  is worth more than a note,"* while OAI-176's own body (*"Second instance, 2026-08-17, from OAI-170's
  review-ladder pass"*) already recorded that second instance and said it **refutes** the candidate
  mitigation rather than confirming it.
  **Fixed 2026-08-18 by the backlog sweep, in the sweep's own diff.** The correction made, in full: the
  Tier 9 OAI-176 paragraph now reads **two** observed instances and names both (2026-08-16 from
  OAI-167's ladder, 2026-08-17 from OAI-170's); "a candidate mitigation not yet worth standing
  instruction on one instance" is replaced with the body's own finding, that the disclaiming prompt line
  was tried proactively at the second instance, the fork echoed anyway, and the mitigation is therefore
  **measured-insufficient-alone** — what worked both times was the retry, not the content of either
  ignore-instruction; and *"needs a second instance before it is worth more than a note"* is replaced
  with the answer to this item's own second question — a standing instruction is not yet earned, because
  the only mitigation proposed has now been refuted rather than confirmed, and the harm is still
  bounded by the two retried passes it cost. The paragraph carries a dated parenthetical recording that
  the correction was made by this sweep and why. OAI-176 itself stays LIVE in tier 9, unchanged.

## 2026-08-18 — OAI-65 and OAI-150 closed (`687ed70`)

- **OAI-65** — **The `0600` protects the file that holds nothing; the WAL sidecar held the secrets,
  and the state directory's own mode was never re-tightened.** Four related defects in the state
  directory's posture.
  **(a)** `job-store.mjs` chmod'd only `databasePath()`. SQLite in WAL mode creates `jobs.db-wal`/`-shm`
  itself at default mode, which — under a loose containing directory — carried both the secret and the
  source while `jobs.db` itself stayed `0600` and empty of either.
  **Noted while reviewing OAI-63 (2026-08-17), and closed at the source that same day rather than left
  to (b) — by deleting the leak, not scrubbing it**: a regex-based scrub of a credential-carrying error
  message was tried and defeated four times by a narrower shape each round; fixed structurally instead
  by never forwarding the underlying error's message at all. See OAI-63's own DONE entry.
  **(b) — the load-bearing half.** `mkdirSync(..., {mode})` never re-applies a mode to an existing
  directory (Node's own documented behaviour) — a state dir or `logs/` inherited loose from an older
  build, or widened by anything else, stayed loose on every subsequent `openStore()` forever, and every
  WAL file created inside it inherited that.
  **(c)** `job-spawn.mjs` opened `logs/<seq>.log` with no `O_NOFOLLOW`, at a predictable sequential
  path — a symlink planted there was followed and appended to.
  **(d) already fixed** — OAI-67's submission reordering discharged it; the residual is a race, tracked
  as [OAI-149].
  **Fixed 2026-08-18, together with OAI-150 (the same underlying gap, reached through a different
  exploit — see below), in one diff, `687ed70`:** a new `refuseSymlink()` guard (`job-store.mjs`),
  checked immediately before every `mkdirSync`/`chmodSync`/database-open and re-checked across any
  intervening operation, refuses rather than follows a symlink planted at the state directory or
  `logs/`; both directories are now unconditionally `chmodSync`'d to `0700` on every open, the same way
  `jobs.db` already was to `0600`, closing (a) as a consequence of (b) rather than by chmod'ing the WAL
  files directly. `job-spawn.mjs`'s log open now uses `O_NOFOLLOW`, closing (c). Widened mid-review
  (user-approved) to also guard `openStoreForReading()` — the read-only opener backing the frequently
  polled `/oai:status`, previously unguarded entirely. Eight review-ladder passes; full history in the
  commit and its evidence trail. The remaining check-to-use window (an attacker with write access to
  the state directory's *parent* racing a check against the syscall right after it) is accepted and
  documented in `refuseSymlink`'s own docblock, on the same terms as [OAI-149]. Residue filed as
  [OAI-187] (the database file itself, `jobs.db`, is never checked for being a symlink — only its
  containing directory) and [OAI-188] (two smaller robustness gaps in `openStoreForReading()`/
  `openJobs()`, disclosed at this fix's own verdict point). Full filing and verification for OAI-65's
  original four sub-findings: [`evidence/65.md`](evidence/65.md).

- **OAI-150** — **the state directory's mode was requested at creation and never repaired, so the
  cancellation acknowledgement's trust footing was weaker than "whoever can write here can write
  `jobs.db`".** It failed exactly where an attacker could traverse the state directory, write `logs/`,
  and not write `jobs.db`: state `0755`, logs `0777`, database `0600` — the reachable middle case let
  that attacker plant a `<seq>.cancel-ack`, turning a worker's crash into a falsely clean `cancelled`,
  without ever touching the database the footing appealed to.
  **Fixed 2026-08-18, together with OAI-65(b) (the same underlying gap), `687ed70`.** The open question
  this item filed — repair or refuse a loose existing directory — was converged before implementation:
  repair, unconditionally, matching the precedent this file's own code already set for `jobs.db`.
  **The originally filed acceptance criterion ("state `0755`/logs `0700` is safe, leave it alone") was
  superseded once OAI-65(a)'s WAL/SHM sidecars were factored in** — they live directly in the state
  directory, so the state directory itself needed repairing unconditionally too, not just `logs/`. The
  discriminating fixture this item specified (state `0755`/logs `0777` must trip; state `0755`/logs
  `0700` must — under the superseded criterion — be left alone) is now asserted against the current,
  stronger behaviour in `tests/job-store-modes.test.js`.

## 2026-08-18 — OAI-63 closed (`1657ba5`)

- **OAI-63** — **The credential model authorises by ORIGIN while every request is by FULL URL, and the
  leak is proved on the wire.** `job-auth.mjs:28` stores `originOf(baseUrl)`, discarding path and
  query; `:45,:59` compare origins only; `cmd-task-worker.mjs:38-45` then builds the profile from the
  **frozen full endpoint** plus the **freshly resolved key**.
  Executed end to end through the real CLI — two real `--background` submissions, real detached
  workers, `providers.json` re-pointed while job 2 sat `queued`. What the server received:
  ```
  path=/tenant-a/v1/chat/completions  authorization=Bearer KEY-TENANT-A
  path=/tenant-a/v1/chat/completions  authorization=Bearer KEY-TENANT-B   <-- leak
  ```
  Confirmed variants: the query form (`?tenant=a` endpoint, key from the `?tenant=b` profile) —
  **FIXED 2026-08-17, both this and the path form, by comparing the freshly resolved profile's
  `baseUrl`/`query` against the already-persisted `job.transport`, which needed no schema change**:
  `transport` was already stored on every row for the unrelated reason of making the request at all.
  **Against the ADR, precisely:** `adr/014:147-152` states the rule as three *origins*, so this is not
  a violation of its letter — but `adr/014:143-145` **explicitly notices** that "an origin drops the
  `/v1` path, the query string" as its reason for storing the transport whole. The asymmetry was seen
  and not followed through, and the ADR's own justifying harm happens one path segment down.
  Severity is deployment-shaped: near-inert on `localhost:1234`, real on path-multiplexed gateways
  (LiteLLM, Azure APIM, Cloudflare AI Gateway). Not attacker-triggerable — a foot-gun for the
  legitimate user. Second-order: `task-submit.mjs:2-7` promises submission validates "in front of the
  user"; it validated `/tenant-a` with KEY-A and the worker sent KEY-B, so **that guarantee does not
  cover the credential**.
  **The other confirmed variant — an `apiKeyEnv` swap, `baseUrl` untouched, env var repointed — is
  NOT fixed by the above and remains open, split out as OAI-183.** The endpoint-vs-endpoint
  compare this fix adds cannot see it: the endpoint is unchanged, only the secret behind it moved.
  **The three-term check validates *where*, never *which secret* — that half of the finding stands.**

  **A second raw-value leak in this same fix's own refusal messages, closed the same day —
  `resolveCredential`'s refusals only; a THIRD, sibling leak through the connection-error path is
  separate and still open, filed as OAI-185.** The
  endpoint-mismatch refusal in `resolveCredential` originally interpolated both raw `baseUrl` values
  (and, in an earlier revision, the raw `query` values) directly into its thrown message — which
  persists into the job's failure record. `normalizeBaseUrl` does nothing to forbid a credential
  embedded in the URL **path** (only userinfo is refused), so a path-multiplexed gateway that puts a
  token in the path leaked it verbatim. **This was flagged once during review (pass 2 of this fix's
  ladder) and wrongly dismissed** on the reasoning that `baseUrl` is already shown unredacted
  elsewhere in this codebase (e.g. `/oai:setup`'s provider table) — which conflated a live,
  operator's-own-terminal display with a value persisted into a shared, longer-lived failure record
  (subject to OAI-65's WAL-mode file-mode gap). It was independently re-raised and reproduced at
  the final verdict-point check and fixed the same way as the sibling config-resolution leak: the
  message is now fully static, naming only the provider and pointing at `/oai:setup`, never
  interpolating either endpoint's raw value.

  **The same root cause one layer up — moved here 2026-08-05 from OAI-72(c), because it was not a
  second item. FIXED 2026-08-17 in the same pass as the worker-side half above.** `config.mjs`'s
  `sameOrigin` withholding was origin-only too, so `--provider prod --base-url <same origin,
  different path>` used to keep prod's key. `sameOrigin` is now `sameEndpoint`, comparing normalised
  `baseUrl` **and** `query`, and `resolveProfile`'s `--base-url` override branch withholds the
  credential (`credentialWithheld: true`) on any endpoint mismatch, not just an origin mismatch —
  covered by `tests/config.test.js`'s same-host-different-path and same-host-different-query cases.
  Both halves were the single decision "does authority attach to an origin or to an endpoint", and
  both are now answered the same way. **OAI-72 keeps its ID and its other two claims**, which are
  about file modes and stdout and share nothing with this.

  **Review history**: seven review-ladder passes, both structural leak fixes (config-resolution catch,
  endpoint-mismatch refusal) arrived at "quote nothing raw" only after five rounds of regex-based
  scrubbing were each defeated by a narrower bypass — recorded as a durable lesson (memory:
  `pass-mutation-discipline-fails-on-arrival`, and the "quote nothing raw" principle now stated
  directly in the code comments). Dual-approved (Codex + independent Claude verdict subagent) on
  digest `c5440227a9ce`. Residue: OAI-183 (apiKeyEnv-identity drift), OAI-184 (unused `runJob`
  parameters, pre-existing), OAI-185 (path-embedded secret via the connection-error path in
  `provider.mjs`).

## 2026-08-17 — OAI-177 closed (`8baf283`)

- **OAI-177** — **The mutation-witness gap OAI-170 closed for the foreign-version exemption was
  still open for this file's other two.** Filed 2026-08-17 from OAI-170's review. `tests/retention.test.js`
  states each exemption as two promises, "never deleted" and "not counted" (line 4), and OAI-166 only
  ever mutation-tested the "not counted" (placement) half of all three exemptions. OAI-170 closed the
  "never deleted" (existence) half for the foreign-version pair; the operator-abandoned exemption's
  existence test ("a row an operator abandoned after it ran is never deleted, and keeps its log")
  and the active-job exemption's existence test ("a job that is still active is exempt however old it
  is") carried no in-file note that their own removal mutation was ever run. Found by a `scout` during
  OAI-170's `acceptance-audit` stage, reading the whole file rather than the diff.
  **What shipped:** both mutated (operator-abandoned's `AND NOT (...)` clause; active-job's `STATES`
  bind list widened to include `queued`/`running`, each a coordinated bind-arity edit like OAI-170's),
  both reddened as predicted on the `deleted` array assertion, and both carry the same "the `readJob`
  assertion is structurally unreachable" note OAI-170 recorded for the foreign-version pair — a
  `DELETE ... RETURNING seq` cannot disagree with the row it deleted, so an earlier assertion on that
  array always fails first. This is the "adjacent finding" OAI-170 flagged (a fourth kind of gap: an
  assertion whose own sensitivity can never be measured by this instrument), now confirmed to hold for
  all three exemptions uniformly rather than accepted or restructured per-instance.
  **Residue from the verdict point, not filed separately — recorded here instead:** two consecutive
  verdict-point rounds each caught a different inaccuracy in a comparative claim attempting to
  characterize how the active-job exemption's implementation differs structurally from the other two
  (round 1: a false "no removable clause" claim; round 2: a false "base candidate domain vs layered
  condition" distinction, contradicted by the file's own placement doctrine). Round 3 deleted the
  comparative claim outright rather than attempting a third characterization — the measured mutation
  result stands without it. Dual-approved on digest `36e378fd460f`.

## 2026-08-17 — OAI-172 closed (`81a019e`)

- **OAI-172** — **Two sentences in the abandon command described behaviour it did not have.** Filed
  2026-08-16 from OAI-162's review; both verified pre-existing at HEAD, and merged into one item
  because one change corrected and pinned both.
  (1) `abandonDecision` returns `{ allowed: true, reason: 'forced' }` from TWO rungs — `no-beat`
  (a beat that is absent or will not parse) and `beating` (a beat that is genuinely fresh) — while
  `job-abandon.mjs` and `commands/abandon.md` both glossed the forced case as the one where "the beat
  was fresh and the operator overrode a worker that was checking in". False for the first rung. Fixed
  to describe both grounds, and to key the sleep caveat on the reason CODE (`stale`) rather than on
  whether `--force` was passed — a `--force`'d row whose beat was already stale still gets `reason:
  'stale'` and still gets the caveat, which the first rewrite of this sentence also got wrong (caught
  at the verdict point, round 1) before being corrected (round 2).
  (2) `cmd-abandon.mjs`'s `REFUSALS` docblock said `gone` "is absent deliberately" and that "every
  other reason `abandonDecision` can return must appear here". `dead` is also absent, and legitimately
  — a dead or never-started row is handed to ordinary recovery before the table is consulted. Fixed to
  name both `gone` and `dead`, and to state the actual invariant (every reason that reaches the
  `REFUSALS[outcome.reason]` call), since `forced`, `forced-malformed` and `stale` are ALLOWED
  outcomes that never produce a refusal at all — a third, distinct kind of exclusion the original
  "every other reason" phrasing didn't accommodate.
  A third, adjacent pre-existing false claim was also caught and fixed in the same pass (round 1's
  verdict-point review): `commands/abandon.md` said the command refuses a job "that has never checked
  in at all, and says so" — the actual no-beat refusal message deliberately avoids that claim ("no
  evidence either way about its process"), since an unparseable beat could mean several things.
  Dual-approved (Codex + independent Claude verdict subagent) on digest `1aa0deae31cc` after two
  verdict-point rounds. Residue: OAI-182.

## 2026-08-17 — OAI-165 closed (`c13696d`)

- **OAI-165** — **`--repo <path>` and `--include <prefix>` let the overnight review sweep run against
  a repo other than this tool's own.** Filed 2026-08-15 from a question about whether it can be
  pointed at another repo yet — at filing it could not: `bench/review-sweep.mjs` derived `ROOT` from
  the script's own location with no `--repo` in `SPEC`, so both `git()` and `invoke()` (the two call
  sites that actually touch the filesystem/subprocess) were pinned to this repo, and `DEFAULTS.include`
  — this repo's own layout — would have silently hollowed out a run pointed anywhere else. The decision
  (converged with Codex before implementation) was that the sweep is a tool other repos can run, not
  only this repo's own instrument.
  **What shipped:** `--repo <path>` and `--include <prefix>` in `SPEC`; both `git()` and `invoke()`
  root at `options.repo`; a foreign `--repo` with no `--include` is refused loudly rather than falling
  back to this repo's defaults; `normalizedInclude()` refuses `--include` values that parse but can
  never match a real git-relative path, trimming whitespace first; `--repo` itself is also trimmed
  before its empty-value check and `resolve()`; the sweep's JSON record and rendered report both name
  the repo swept. Documented in CLAUDE.md's `bench/review-sweep.mjs` paragraph and Commands table.
  **Unrelated, shipped in the same commit at the user's explicit mid-task direction:** this repo's
  file/function line-count "size ratchet" (`tests/structure.test.js`'s per-file/per-function budgets
  and `ALLOWLIST`) is retired outright — not raised, not exempted further — and every place in the
  tracked repo that referenced it as a live rule is reworded to history.
  **Took 5 review-ladder passes and 4 verdict-point rounds** — an unusually long run, worth recording
  honestly rather than smoothing over:
  - Passes 1-4 each mutated mid-pass (findings from one review group were fixed before the next group
    or the closer ran), which the ladder's own rules treat as re-running the pass rather than a
    shortcut; pass 5 ran clean, no mid-pass mutation, and converged with one small doc-pointer finding
    from its closer, fixed as a wholly exempt (prose-only, no-behavior-change) batch.
  - Passes found and fixed, cumulatively: repo attribution missing from sweep artifacts; a
    self-reference footgun comparing `--repo`'s syntactic presence instead of resolved path identity;
    duplicate is-this-foreign logic that only agreed by construction; a whitespace-trim bug in
    `--include` validation (validated a trimmed copy, used the untrimmed original) and the identical
    bug independently in `--repo`; an overly-broad `..`-prefix rejection that wrongly refused
    legitimate names like `..config`; a backward-compatibility gap for pre-existing sweep ledgers with
    no `repo` key; test isolation from the ambient machine/config; and repeated `BACKLOG.md` prose left
    contradicting itself after the ratchet retirement, most seriously a mislabeled absorbed-ID mapping
    (OAI-30 wrongly said to map to OAI-28's closed part (A) when it maps to the still-open part (C)).
  - The verdict point itself needed 4 rounds: round 1's Codex `CHANGES-REQUIRED` was a real but
    out-of-scope, pre-existing contradiction in an unrelated tracker item (OAI-176), verified via
    `git merge-base --is-ancestor` to predate this diff entirely — ruled out of scope rather than
    fixed here, filed as OAI-180. Round 2's Codex finding was real and in-scope (BACKLOG.md overclaimed
    the ratchet was "actively violated" when the file sat at exactly 300/300 with a `>` comparison —
    binding, not violated) and was fixed. Round 3's Codex approval was followed by an independent
    Claude verdict subagent finding an arithmetic error Codex had missed (a line-shift count of 57
    where the true figure, for that particular citation, was 51) — fixed. Round 4: both approvers,
    independently, verified the corrected arithmetic themselves rather than trusting the description,
    and both approved on digest `62f99a340680`.
  **Residue filed:** OAI-178 (misleading error on a bad `--repo` path), OAI-179 (a latent, unreachable
  default-argument gap in `runSweep`), OAI-180 (OAI-176's own pre-existing tracker inconsistency,
  surfaced but out of scope here).

## 2026-08-17 — OAI-170 closed (`feeab6d`)

- **OAI-170** — **Mutation-test the foreign-version "never deleted" witness.** Filed 2026-08-15 from
  OAI-166; closed 2026-08-17. Plan:
  [`plans/oai-170-witness-the-foreign-version-mutation.md`](plans/oai-170-witness-the-foreign-version-mutation.md),
  with `1-round-1-blind.md` beside it as the approving-round archive (round 2 — round 1's digest was
  superseded solely by adding the required `provenance:` header, both approvers re-verified rather
  than rubber-stamping).

  **What shipped.** `tests/retention.test.js`'s pre-existing "a row a newer plugin wrote is never
  deleted" test — unlike its OAI-166 sibling, never mutation-tested — is now recorded as measured.
  Measured, not assumed as the tracker item had it: the tracker's own "Cheap to close: one mutation"
  was wrong. Removing `schema_version <= ?` from `PRUNE`'s inner WHERE alone breaks bind arity
  (`prune()` binds positionally), so the real fault is **two coordinated edits** — the clause and
  `prune()`'s `ROW_SCHEMA_VERSION` bind argument, each landed and proved separately via
  `mutation-landed.py`. Both this test and its OAI-166 sibling reddened, each by a different
  mechanism (this one: `deleted` gains the foreign row itself; the sibling: the foreign row survives
  but consumes a kept place, evicting a different ordinary row) — and in both, the `readJob(state,
  'foreign')` assertion is provably never reached, since the preceding `deepEqual` throws first.
  Restored, proved by diff; no production code changed.

  **The review ladder itself caught two real defects in the fix's own wording**, both in the
  durable comment recording the measurement: a stale line-number self-reference (the sibling's line
  number shifted when this diff inserted lines above it — caught by three independent readers plus
  Codex adversarial review) and a false claim that the ORIGINAL test's own `readJob` assertion
  "failed too" (it is equally never reached — caught by the verdict-point reviewers themselves, one
  of whom reproduced the mutation empirically before approving). Both fixed as exempt, comment-only
  edits within the same pass; dual approval closed at digest `c4c4601c4320`.

  **What was left behind.** OAI-177 — the same never-mutation-tested existence-half gap is still
  open for this file's other two exemptions (operator-abandoned, active-job), and a related
  observation that the measured assertion's own sensitivity may be structurally unwitnessable by any
  `PRUNE` mutation. OAI-176 gained a second, evidence-refining instance: this pass's `fork-opener`
  echoed ambient "waiting" narration on its first launch even with an explicit ignore-instruction
  already in the prompt, which downgrades that instruction from untested candidate to
  measured-insufficient-alone.

## 2026-08-17 — OAI-168 closed, outside this repo (`72c91bf` in `~/Code/dotfiles`)

- **OAI-168** — **A positive control is itself a check that cannot fail until something witnesses it
  firing, and this repo had paid for that twice in one feature.** Filed 2026-08-15 from OAI-166, whose
  review found three assertions satisfied by an inert implementation, added a positive control to
  each, and then found the controls themselves unwitnessed — no mutation made `PRUNE` or `orphanSeqs`
  inert, so for one pass the fix was in the same class as the defect. Closed for OAI-166 by two
  mutations (`AND 0` in the inner `WHERE`; `orphanSeqs` returning nothing).

  **The item drafted itself as a `.claude/REPO_TRAPS.md` entry here; the routing decision went the
  other way.** Put to Codex and the user's advisor as a fork (repo traps file vs. dotfiles process
  machinery): Codex argued the rule belongs beside `review-ladder`'s existing "a fix that ADDS a
  conditional is mutation-checked in the SAME batch" paragraph, since that is the moment a reviewer
  executes it, and that dotfiles' own trap 32 and the global CLAUDE.md bullet already state adjacent
  halves without covering this one; the advisor argued for the rule in dotfiles plus an instance-only
  pointer here. The user chose dotfiles-only: the rule is generic test methodology with nothing
  repo-specific in it, the instance is already recorded in OAI-166's commit message, and a second copy
  here would be the cross-artifact drift class both files warn against.

  **What shipped**: one paragraph in `agents/skills/review-ladder/SKILL.md` (`~/Code/dotfiles`,
  `72c91bf`) — a fix that adds a positive control is witnessed in the same batch, on the production
  predicate the control exists to catch, never on the control itself; and the regress-stopping clause
  verbatim from the item (mutation-test production predicates and any control whose result passes
  through production branching; stop at a direct pre-action read of fixture state, provided each gate
  is asserted independently AND the read path is independent of the production path). No change landed
  in this repo. Verified by `bash tests/run-gate.sh` in dotfiles (12 guards green); no mutation check —
  normative prose with no invariant a single edit can break, stated and skipped rather than guarded by
  an inert grep.

## 2026-08-16 — OAI-167 closed (`6b3fead`)

- **OAI-167** — **A comment that denies a failure mode, and the catch that made it true.** Closed
  2026-08-16 by `6b3fead`. Plan:
  [`plans/oai-167-a-comment-that-denies-a-failure-mode.md`](plans/oai-167-a-comment-that-denies-a-failure-mode.md),
  with `1-round-1-blind.md` beside it as the one approving-round archive.

  **What shipped.** `orphanSeqs`'s bare `readdirSync` catch — deleted outright, not narrowed to
  ENOENT. A `logs/` read fault now reaches `sweepQuietly`'s existing rethrow (`task-submit.mjs`)
  instead of being swallowed as an empty list, proven by a new test that replaces `logs/` with a
  regular file and asserts `sweep()` throws `{code:'ENOTDIR'}`, using `withStore` directly because
  `runSweep`/`openStore` would throw `EEXIST` first. Five originally-named false comments struck,
  never rewritten, per this repo's delete-only rule for adjudicated-false descriptive prose: a wrong
  `2^63` gloss on a literal 192 off from the true value, a "guaranteed to contain it" containment
  claim falsified on every ordinary sweep (`prune` runs before the listing, not only under a race),
  `unlinkQuietly`'s "the file is absent either way", and `abandon-salvage.test.js`'s unverifiable
  "reviewed six times".

  **The scope decision that mattered most wasn't in the plan.** The probe found the readdir catch was
  the exact blanket catch `task-submit.mjs`'s own docblock forbids — Codex's plan-gate steer,
  scoped to `job-retention.mjs` alone, recommended deferring the catch deletion to its own item;
  the user sided with deleting it now, on evidence Codex hadn't been shown (`task-submit.mjs:91-93`'s
  stated policy, and `openStore`'s unconditional `mkdirSync` making the ENOENT arm near-unreachable).

  **Review found the diff had already touched what the plan said to leave alone.** The plan deferred
  a sixth false clause — `orphanSeqs`'s "anything in this listing already had a row when the listing
  was taken" — as pre-existing and out of scope, on the premise that it was a different sentence from
  the five named ones. A review-ladder stage found that premise false: the diff's own edit had
  already split that exact sentence, shipping the false half. Confirmed independently (`sweep()` runs
  `prune()` before `orphanSeqs()`, and the file's own `sweep()` docblock says a pruned row's log is
  collected as an orphan by the same sweep — no race required) and by a second, unrelated false claim
  in the same file (`ownedSeq`'s docblock argued the round-trip check was unsafe because "the unlink
  would take an unrelated file", which is false for the literal cited — it round-trips to itself) with
  a twin in the test fixture. Codex offered a rescue reading of the second claim; rejected as
  inconsistent with how the same phrase is used two lines earlier in the same docblock for a case
  where it IS true. All three were a widening beyond the approved plan — taken to Codex for a steer
  (batch-now) and then to the user, who chose to batch all three rather than defer.

  **Ladder cost.** One full pass (guaranteed, first), five stages, one retry (`fork-opener`'s first
  invocation echoed the orchestrator's own "waiting on siblings" transcript framing instead of
  reviewing — filed as **OAI-176**). Dual approval on the same digest after the widening batch;
  Codex and the Claude verdict subagent each independently re-verified all nine changed clauses
  against the bytes on disk rather than the prior stages' summaries. Suite 965/965 throughout;
  mutation-proven non-vacuous (catch reintroduced → the new test alone reddens → restored clean).

  **Residue.** **OAI-176** — the `fork-opener` retry, one observed instance, no measured mechanism.

## 2026-08-16 — OAI-162 closed (`d1f3e2c`)

- **OAI-162** — **An unreadable pid is not a dead process.** Closed 2026-08-16 by `d1f3e2c`. Plan:
  [`plans/oai-162-unreadable-pid-is-not-a-dead-process.md`](plans/oai-162-unreadable-pid-is-not-a-dead-process.md),
  with `pre-build-round-4-threaded.md` beside it as the one approving-round archive.

  **What shipped.** `pidLiveness` answers `live`, `gone` or `unreadable`; `isAlive` becomes a
  projection of it; `livenessOf` routes `unreadable` to the existing `malformed` verdict. Only `ESRCH`
  reads as dead. Both `running` and `queued` rows, since both read a pid. 16 files, four of them
  documentation, and no new module.

  **The shape check runs before the probe, and that order turned out to be the load-bearing part.**
  `kill(0, 0)` signals the process group and `kill(-1, 0)` every process the user may signal — both
  SUCCEED, so a `0` or `-1` in the column would have read `live`, which is worse than the defect being
  fixed. The catch-all arm's whole reachable population is a positive integer `2**31` or above, which
  Node's own validator rejects with `ERR_INVALID_ARG_TYPE` **before any syscall**, so no message
  downstream may say a probe was attempted and came back inconclusive. That is written into the module
  because the obvious guard for "an error we do not interpret" is `if (!error.code)`, which is false
  for a `TypeError` carrying a Node code rather than a POSIX errno.

  **Proved at the CLI, not only in the suite.** A seeded `running` row with `worker_pid = "garbage"`
  and a `queued` row with `waiter_pid = -1` both render `malformed` with distinct sentences; the
  flagless `/oai:abandon` refuses (exit 1); `--force` writes `failed` / `operator-abandoned` and the
  stored record attributes no probe and no pid. **The positive control is the same run with
  `pidLiveness` reverted to the old collapse**: both rows then auto-terminalize as `failed` — *"The
  worker for job X exited without recording an outcome"* — and `/oai:abandon` reports *"already
  settled by ordinary recovery: recorded as worker-died"*, about a pid of `"garbage"`. Source restored
  and proved identical to backup by `diff`. Suite 964/964 in the working tree and again in a fresh
  clone of the commit.

  **Three plan phases were withdrawn by the user AFTER approval**, at review pass 4, on Codex's scope
  review: the diff had reached 25 files and three modules against a plan naming 16 and one, and
  roughly 700 of ~960 new lines served two mechanisms the filed defect did not require. One of the
  three reversed a refuse-to-ship finding Codex itself had raised at the plan gate. The plan records
  each and why. Filing them was then re-adjudicated rather than assumed: only the exit-discovery one
  is live, as OAI-174.

  **What the review cost, and the one thing it found late.** Ten passes. The dominant finding class
  was *claiming more than was established* — the same defect OAI-162 is about — which recurred in five
  successive wordings of one sentence. A pass-7 documentation edit **silently no-op'd**: a `str.replace`
  whose needle an earlier edit in the same run had already rewritten matched nothing, wrote nothing,
  and the batch still reported green. Found by the next pass's fork; every subsequent replacement
  carried an `assert old in s` guard, which then tripped twice for real.

  **Residue, after Codex re-checked every proposed entry against the source.** Filed: **OAI-172**
  (two false descriptions in the abandon command, merged), **OAI-173** (the reconciler's failure
  vocabulary retyped with nothing pinning the copies), **OAI-174** (the status listing never names the
  exit for a malformed row — the one live withdrawn piece), **OAI-175** (`status.md` never names
  `starting`). **OAI-160 was AMENDED rather than duplicated**: it already named `displayOf`'s
  `dead`/`never-started` arms as *"reachable only for a row a newer plugin wrote"*, and that premise is
  false — an ordinary row renders `! written by a newer plugin (row schema 1)` whenever only the
  DATABASE pragma is too new, a sentence that contradicts itself in its own parentheses. **It stays in
  tier 11**: it was briefly moved to tier 1 and moved back the same day, because the row that branch
  mislabels is `dead` or `never-started` — the label is wrong, but no live work is at risk, and tier 1
  is for live work. Tier 1 is now empty and kept as a closure record; the priority view starts at
  tier 2.

  **Three candidate items were dropped on review rather than filed**, recorded so the judgement is not
  re-made from scratch: preserving the unreadable value in the failure record and routing an
  unrecognised `state` to `malformed` are both recoverable from the committed plan and neither is
  reachable from anything this build writes; extracting `abandonFailure` is already forced by the size
  ratchet at the moment it matters. A fourth — "a readable row in a too-new database has no exit" —
  was **withdrawn as wrong**: the block is `cmd-abandon.mjs`'s deliberate `DatabaseTooNewError`, not a
  version conflation, and the documented remedy (use the newer plugin) is a remedy. It was drafted on
  a mechanism I had mis-traced, and Codex refuted it against the source.

## 2026-08-15 — OAI-166 closed (`7f65ac6`)

- **OAI-166** — **The fixtures OAI-161's scope cut left are built, and the two silent traps are
  pinned.** Closed 2026-08-15 by `7f65ac6`. Plan:
  [`plans/oai-166-pin-the-cut-fixtures.md`](plans/oai-166-pin-the-cut-fixtures.md), with
  `pre-build-round-1-blind.md` beside it as the one approving-round archive.

  **What shipped.** Seven fixtures, not the six planned. Six in `tests/retention.test.js` — the
  `IS`-vs-`=` null-safety control, the `json_valid` guard, a placement witness for each of the THREE
  exemptions, and the `started_at` narrowing — plus a sweep inside `tests/abandon-salvage.test.js`'s
  live two-process scenario. `scripts/lib/job-retention.mjs` changed in comments alone.

  **The seventh fixture is the finding.** The module claims EVERY exemption's placement is
  load-bearing; the plan gave witnesses to two. The pre-existing active-job test asserts
  `deleted.length === 5` with the active rows OLDEST, which holds identically whether the clause sits
  in the inner `SELECT` or the outer `DELETE` — the same blind spot as the foreign-version test, in
  the exemption nobody had suspected of it.

  **The placement witnesses had to be inverted mid-review.** As approved they asserted `deleted` was
  EMPTY, which a `PRUNE` that deleted nothing satisfies. They now fill `RETAIN + 1` and assert the one
  ordinary row over the ceiling was taken. **Then the controls themselves needed witnessing** — no
  mutation made either mechanism inert, so for one pass the fix sat in the same class as the defect.
  `AND 0` in the inner `WHERE` and `orphanSeqs` returning nothing closed it. That general rule is
  filed as OAI-168.

  **Thirteen mutations**, one at a time, each proved landed by `mutation-landed.py` and each restore
  proved by `diff`, every one under the whole suite rather than one file — the first eight were
  measured file-locally and the universe was restated as `npm test` when review caught it.

  **Two review claims were refuted by measurement rather than filed.** `LIMIT 1 OFFSET ?` reddens
  seven tests including the cap test; an `ELSE 'operator-abandoned'` arm on the `CASE` reddens the
  `IS`-vs-`=` fixture. Neither is a coverage gap.

  **What it cost, and why.** Four review passes. Three of them were spent almost entirely on
  DESCRIPTIVE PROSE — comments and the plan — where each batch that fixed a false description wrote a
  new one. The rule that stops this (delete the proposition, do not rewrite it) landed in
  `~/Code/dotfiles` *twelve minutes into* the review, and this run followed the superseded copy for
  two batches before noticing. Filed as OAI-171.

  **Residue: OAI-167** (five pre-existing false comments, held out of scope because this feature did
  not author them), **OAI-168** (the control-of-a-control stopping rule), **OAI-169** (the
  `busy_timeout`/budget pair, unpinned and stated as such), **OAI-170** (nothing reddens the original
  foreign-version test), **OAI-171** (the mid-run skill change).

  **Process deviations, recorded rather than smoothed.** Pass 1's verdict point was not held —
  approval was forbidden by construction with nine accepted fixes unapplied — and the plan's
  provenance line was briefly deleted to preserve a digest before being restored. The
  `--dual-approved` gate at the plan stage was fed a paraphrase of the Claude verdict rather than its
  verbatim text; the pass-4 verdict was recorded verbatim.

## 2026-08-15 — OAI-161 closed (`6d06f6c`)

- **OAI-161** — **A salvaged answer now outlives the retention sweep.** Closed 2026-08-15 by
  `6d06f6c`. Plan: [`plans/oai-161-salvage-outlives-retention.md`](plans/oai-161-salvage-outlives-retention.md),
  with `pre-build-round-1-blind.md` beside it as the one approving-round archive.

  **What shipped.** `job-retention.mjs` `PRUNE` never deletes a row whose failure reason is
  `OPERATOR_ABANDONED` and whose `started_at` is set. The clause sits in the inner `SELECT`, which is
  what makes such a row **uncounted as well as undeleted** — moved to the outer `DELETE` it would
  spare the row and still spend one of the 50 kept places. `OPERATOR_ABANDONED` is now a constant in
  `job-record.mjs` because a writer and a reader agreeing by spelling was the drift risk, and a silent
  disagreement would simply resume deleting the rows the exemption exists to keep.

  **It reads no pid, and that was the fork.** A liveness-keyed exemption was cheaper and available —
  `finish` NULLs `worker_pid` but leaves `waiter_pid`, and `claimJob` writes the same number to both,
  so a terminal row still names the process that ran it with no schema change. It was rejected because
  the exemption would end when the worker exits, which is exactly when the log stops being rewritable
  and becomes the only copy, and because it would inherit OAI-162's malformed-pid-reads-dead defect.
  Codex and Claude recommended this independently; the user confirmed all three forks.

  **Two SQL properties are measured, not assumed.** `IS` rather than `=`, because `NULL = 'x'` is NULL
  and every genuinely-run completed row would otherwise leave the candidate set and never be pruned
  again. And `CASE WHEN json_valid`, because `json_extract` throws on an unparseable payload and
  `sweep()` runs before the insert, so one corrupt row would sink every submission. A later Codex
  review disputed the short-circuit claim behind the second; re-measured with a control — the same
  unguarded query throws with `started_at` set and does not with it NULL — the claim held, and the
  comment now says the order is the planner's rather than a documented guarantee, so the guard does
  not depend on it.

  **Accepted by design, and stated in the user-facing docs:** exempt rows accumulate without bound and
  nothing clears one, and they pile up in `/oai:status`, which caps nothing.

  **The feature was scope-cut by the user mid-build** as too big. One of six planned fixtures shipped.
  The other five, and the measurements behind each, are **OAI-166** — including that "nor counted",
  half of what this exemption is, cannot be tested by the obvious fixture at all.

## 2026-08-15 — OAI-69 closed (`6d41bd0`)

- **OAI-69** — **A wedged row now has an operator exit.** Closed 2026-08-15 by `6d41bd0`. Plan:
  [`plans/oai-69-a-wedged-row-needs-an-operator-exit.md`](plans/oai-69-a-wedged-row-needs-an-operator-exit.md).
  **The plan gate ran its full ten rounds and never dual-approved** — Codex found something real in
  every one of them and the Claude half approved every one — so the plan proceeded on the user's
  approval, recorded here because the archive directory that would otherwise show it does not exist.

  **What shipped.** `/oai:abandon <id> [--force]` writes off a row whose worker cannot be proved gone.
  `job-abandon.mjs` resolves liveness, decides and writes inside ONE `BEGIN IMMEDIATE` — the clock
  sampled inside too, because a default parameter samples before a lock that can block for
  `busy_timeout`. Four refusals no flag lifts; `malformed` is liftable, because refusing it outright
  leaves a corrupt row wedging the queue with no escape. A dead or never-registered pid is handed to
  ordinary recovery rather than recorded as the operator's verdict, and a row recovery already settled
  reports idempotently instead of refusing. `job-drain.mjs` `couldDrain` walks both of `decide`'s rungs
  and demands a readable, fresh beat — accepting `live` would reproduce inside this command the defect
  it exists to fix. Nothing is ever signalled.

  **The cost is stated rather than hidden.** Abandoning a running row is an operator-authorized
  exception to one-job-at-a-time; the five sites asserting that invariant now name the exception.

  **Four findings worth keeping.**
  1. *The command asserted a liveness probe it never performed.* The probe ran in another module,
     before the lock, and the unit tests bypassed it entirely — passing only because the fixture pid
     was the live test process. Found by a full pass reading assembled files; invisible to four diff
     passes.
  2. *`couldDrain` reproduced this feature's own defect class.* It treated a successor as runnable on
     `live`, which proves only that a pid number is occupied — so a dead successor holding a recycled
     pid would have been reported as about to start.
  3. *Three load-bearing guards shipped unpinned, and only mutation found them* — the `cancelled` arm
     of the classifier, `couldDrain`'s beat-parse check, and `remedyFor`'s liveness gate. Each was
     itself the fix for an earlier review finding. Six reading passes found none of the three.
  4. *A stale clock was invisible to both instruments.* `nowMs` sampled before the lock was correct
     code with a stale input — mutation cannot find that, because nothing is wrong to mutate.

  **Evidence.** 940 tests pass, from 891 at the baseline. Mutation controls fired for the stale-beat
  invariant (24 tests), every dispatch rung, the recovery-owned classifier, the drainage guards, the
  render gate, the in-lock clock, and the salvage branch. The completion-after-abandon race is driven
  end to end across two processes, with its control proved by removing the branch. Seven review passes
  fixed 71 findings; the suite was re-proved green from the committed state.

  **Residue:** OAI-161 and OAI-162, both filed live.

## 2026-08-14 — OAI-64 closed (`dd35df8`)

- **OAI-64** — **`/oai:status` now names the row that is actually starving you.** Closed 2026-08-14 by
  `dd35df8`, after five review passes and eleven plan-gate rounds. Plan:
  [`plans/oai-64-the-blocker-is-relational.md`](plans/oai-64-the-blocker-is-relational.md),
  dual-approved pre-build and again mid-build, both archives beside it.

  **What shipped.** `job-queue.mjs` exports `scanQueued`, the single definition of the queue's head, and
  `decide` dispatches on it. `job-view.mjs` `blockingSeqFor` walks `decide`'s two rungs read-only — a
  non-dead running row, else that head — and names one FOREIGN row when this workspace holds a queued
  job that is live or still inside its startup grace. `job-render.mjs` flags it with a NECESSARY
  condition: *must clear before this workspace's queued job can proceed*, which never promises yours
  runs next.

  **Three findings worth keeping, each proved rather than argued.**
  1. *This item's own diagnosis was incomplete.* It said blocker-ness is decided by `queuedRole`, which
     returns `blocks` for the pathological shapes. But an ordinary live known-version queued row returns
     `head` and still blocks everyone behind it via `decide`'s `seq` comparison — and the reproduction
     recorded in the item **is** that ordinary case. A fix built on the enumeration would have passed a
     test drawn from the item's own transcript while hiding the commonest blocker there is.
  2. *The first implementation committed this item's own defect.* It consulted the queued rung alone, so
     with a live running row it marked a queued job that clearing would not help, while the row actually
     holding the queue sat unmarked below it. Found at review pass 2, reproduced by execution, then fixed.
  3. *The witness rule was narrowed during review.* A local queued row with no waiting process — dead,
     never-started, malformed — no longer counts as evidence anyone is starved, because for such a row
     the flag's sentence is false rather than vacuously true. The superseded justification ("`decide`
     blocks it too, so excluding it would disagree with the queue") was unfalsifiable: those rows never
     call `decide` at all.

  **Evidence.** 891 tests pass, against 871 at the baseline. Nine mutation controls fired across the
  run, each caught by the test written for it — head-sort inversion, witness-comparison inversion,
  running-rung removal, `isKnownVersion` refusal deleted, local-head guard deleted, eligible-witness
  gate deleted, `scanQueued`'s `onSkip` deleted, `ORDER BY seq` deleted, `decide`'s state guard deleted.
  The `ORDER BY` one was undetectable until `PRAGMA reverse_unordered_selects` was used, since rowid
  order already matches `seq` order. Also driven through the real plugin against a seeded queue.

  **Dismissed, by the owner's decision:** the flag is not linearizable with the queue, because the
  display reads outside a transaction. `BEGIN IMMEDIATE` is impossible on the read-only connection,
  would not cover the OS pid probes the display also depends on, and would make every `/oai:status`
  contend for the queue's write lock against workers polling every 300ms. Internal consistency already
  holds — the whole report derives from one atomic `SELECT` — and no wrong-kill path exists, since
  `requestCancel` is state-guarded and a stale flag matches zero rows.

  **Residue:** OAI-160 here; process items 161 and 162 in `~/Code/backlog`. OAI-69's gating condition
  is discharged — re-read it.

## 2026-08-13 — closed by the backlog sweep, each verified against disk (OAI-33, OAI-84)

- **OAI-33** — **`plans/README.md` was missing.** Closed 2026-08-13 by the backlog sweep, which
  **verified the file exists on disk** rather than taking it off a commit message. The `/feature` skill
  points at it for naming, collisions and provenance; it is there. No code change was needed and none
  was made — this entry records that the gap closed at some point between the filing and the sweep.

  *Original filing, kept because it is the record of what was wanted:*

  - **OAI-33** — Write `plans/README.md`, which the `/feature` skill already points at and this repo
    does not have. Filed 2026-08-02, noticed while filing OAI-26's plan. The skill says naming,
    collisions, the `draft`/`final` distinction and provenance "live in `plans/README.md`" — so the
    one place those rules are supposed to be written down is missing here, and six plans have been
    written without them. In practice a convention has emerged and should just be recorded rather than
    invented: `oai-NN-slug.md`, one per item, occasionally spanning two IDs where the work was
    (`oai-20-21-survive-the-server.md`). Worth stating explicitly: a plan is **not** rewritten when
    review refutes it — OAI-26's carries a dated correction block at the top and leaves the refuted
    text in place, because the plan is the record of what was believed at the time, and that is the
    convention the next one should follow. Housekeeping, so it sits down here; it costs one short file.

- **OAI-84** — **Two ways `/oai:review` threw away an answer the model gave it, on the default path.**
  **Both repairs SHIPPED and VERIFIED on disk 2026-08-13** by the backlog sweep, independently of the
  entry's own claim to have shipped:
  **(a)** `scripts/lib/structured.mjs:202` now builds `const channels = structured ? [content, reasoning] : [content];`
  and tries each channel in turn, replacing the pre-parse ternary that buried a valid payload in
  `reasoning` when one stray character sat in `content`.
  **(b)** `scripts/lib/structured.mjs:242` wraps a bare top-level array —
  `Array.isArray(parsed) ? { findings: parsed } : parsed` — so a reply of `[{...}, {...}]` is no
  longer discarded. Both sites carry comments recording the old behaviour as a fixed defect.
  **The item did NOT close as a whole, and this is the honest split.** Its ladder ended at its terminal
  pass without dual approval, and the candidate-selection design it grew is under a partial plan
  withdrawal that the user adjudicated PARTIAL on 2026-08-07. That remainder **could not close
  independently** of the replacement, so it merged into **OAI-112**, which now carries it; OAI-84's ID
  redirects there. Its two live sibling defects stay separately filed as **OAI-113** (quadratic scan)
  and **OAI-114** (a primitive sibling discarding a whole findings list), both re-verified STILL TRUE
  by this sweep.

  *Original filing, kept in full because its evidence is the record:*

  - **OAI-84** — **Two ways `/oai:review` throws away an answer the model gave it, on the default path,
    and reports the throw-away as "no findings in the requested shape".**
    **STATUS 2026-08-07 — BUILT AND SHIPPED, ladder ended WITHOUT approval, item stays LIVE and is
    BLOCKED on the user.** Both repairs landed and were independently audited (commits through
    `674cf49`, suite 692/0 verified in a committed copy, verify skill all three steps including a
    CLI-level before/after control). The six-pass review ladder then ended at its terminal pass with
    **both approvers returning `CHANGES-REQUIRED`**, and raised a partial plan withdrawal against the
    candidate-selection design — filed as **OAI-112**, which the user must adjudicate part-versus-whole
    before any replacement is planned. Two live defects the ladder found are filed separately and are
    fixable without waiting for that decision: **OAI-113** (quadratic scan, measured 39s end-to-end) and
    **OAI-114** (a primitive sibling discarding a whole findings list, a regression from base). Do NOT
    mark this done: what it was filed for works, but the design it grew is withdrawn.
    The register row is `84-two-ways-a-reply-is-thrown-away` (exit_mode `withdrawn`, 16 filed at exit). **Split out of OAI-13 on
    2026-08-05 by the backlog sweep**, which verified against disk that these two stopped being what
    they were filed as. They were filed 2026-07-27 from the OAI-4/OAI-10 built-in review as
    vendor-dependent behaviour of a *degraded* path — untestable here, waiting for a second server. OAI-51
    then made the unconstrained prose-parse path the **default** (2026-08-04), and the default runs the
    same `parseFindings`. So neither needs a second server any more, and both are reachable on every
    ordinary review this plugin now performs.

    **(a) The channel is picked before the parse, and there is no fallback.**
    `scripts/lib/structured.mjs:265` — `const text = structured && !content.trim() ? reasoning : content;`
    — chooses one of `content` / `reasoning_content`, and `extractJson` then tries only that text. One
    stray non-whitespace character in `content` discards a valid payload sitting in `reasoning`. Verified
    2026-08-05 as applying **regardless** of `structuredOutput`, so the schema flip did not narrow it.

    **(b) A bare top-level findings *array* is discarded**, though the adjacent comment promises repair.
    `scripts/lib/structured.mjs:269` —
    `if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) return null;` — so a
    reply of `[{...}, {...}]` fails the object test and returns null. Under a grammar this was a
    degraded-path curiosity; under prose instructions, "emit the findings" answered with a plain array is
    an *ordinary* thing for a model to do, which makes this the most likely candidate for a review that
    found something reporting nothing — a candidate, not a measurement; see the next-but-one paragraph.

    **Why this outranks the vendor items it was filed with.** Both render as trap instance 14 — the
    `findings: null` versus `[]` distinction that [ADR 003](adr/003-structured-findings.md) exists to
    protect. The distinction itself is intact and test-pinned (`tests/review-json.test.js:83`), which is
    precisely what makes this worth fixing: the plumbing correctly reports "unparseable", and the parser
    is calling things unparseable that are not. The user sees an honest message about a dishonest verdict.

    **Not yet measured, and say so rather than guess.** How often either fires on the current default is
    unknown — no run has been instrumented for it. The 2026-08-04 whole-tree run that returned **0
    findings** with `parsed: true` is *not* evidence for this item (it emitted content and genuinely found
    nothing), and must not be recruited as such. The cheap instrument is to log the raw reply whenever
    `parseFindings` returns null and read a handful; the cheap fix for (b) is to accept an array and wrap
    it, which the comment already says was intended.

    **Sequencing.** Before **OAI-19**, or the baseline measures a parser that is about to change — this
    is the same argument OAI-51 made for suspending that run, one layer down. Cheap enough that it should
    not delay anything: (b) is a few lines, (a) is a try-the-other-channel fallback.

## 2026-08-13 — the sweep writes as it goes, and says what the server did to it (OAI-132, OAI-140 recording half)

- **OAI-132** — **An overnight sweep emitted NO signal until it ended, so a crash lost the whole
  night.** Shipped 2026-08-13, commit `223136e`. 870 tests green, measured in a fresh clone of the
  committed tree rather than the working tree.
  Each settled commit now reaches disk immediately, in an append-only JSONL ledger beside the artifacts
  it will become (`bench/lib/sweep-ledger.mjs`), and `bench/recover-sweep.mjs` turns an interrupted
  ledger into the report the run never wrote — through the same `writeSweep` a completed run uses. The
  header carries the enumerated **manifest**, not counts, which is what stops a recovered report saying
  *"enumerated 40 · reviewed 2"* above *"every enumerated commit was reviewed"*. See
  [ADR 022](adr/022-a-record-written-while-the-run-is-happening.md).
  **Two decisions worth not relearning.** Records are written LEADING-newline-first, because a
  terminated record that fails part-way leaves a fragment the next *successful* append fuses onto,
  losing a line whose own write succeeded. And because `settle` guards the sink so a recording fault
  cannot cost review coverage, a missing entry became ambiguous — hence `unobserved` (never reached, or
  settled and lost, and the ledger cannot tell which) versus `unrecorded` (a `gap` line proves it
  settled and the write failed). Reporting either as "never settled" would have been false precisely
  because the harness defended against a failing disk.
  **Verified by a real crash**, not an injected sink counting calls: a child drives the real `runSweep`
  against a real ledger and SIGKILLs itself mid-loop, with a positive control that writes the header
  and suppresses only the per-entry writes. Also run live end to end against LM Studio.
  **The review ladder ended `terminated`, not dual-approved** — Codex approved; the Claude verdict-only
  subagent returned CHANGES-REQUIRED on ADR 022 naming the wrong file for the crash test. Both that and
  a second nit were corrected before the commit, at the user's direction, without a further verdict
  round. Recorded because the register says `terminated` and the reason belongs beside it.

  *Original filing, kept because it is what priced the work:*

  - **OAI-132** — **A two-hour sweep arm emits NO signal until it ends.** Filed 2026-08-09 from running
    the matrix. `writeSweep` runs once, after the loop, so an arm in progress is observable only as a
    live pid and a SHA in `ps`; a healthy run and a doomed one look identical from outside for hours.
    The fail-fast covers an outage, not "is this producing anything useful". Observed directly: arm 1 ran
    2h13m with no readable output, and the four aborted gemma arms were only diagnosable afterwards.
    **For a harness whose whole purpose is running unattended, that is the wrong end of the trade.**
    Fix shape: append each entry to the record as it settles, or emit one progress line per commit.
    **PRICED 2026-08-10 by a full overnight run**, which is why this is no longer a nuisance item.
    `sweep-2026-08-09-overnight` ran **8h22m** (2026-08-09 20:39 → 2026-08-10 05:01 BST) and wrote its
    first and only byte of result at the very end. Confirmed by reading the code, not inferred from the
    silence: `review-sweep.mjs` has **exactly three** `stderr.write` sites — the opening enumeration
    line, the closing report paths, and the error handler. **Nothing per commit.** So for 8h22m the
    only observable was a live pid and `lms ps` reporting `GENERATING`, and **had the machine slept or
    the process died at hour eight, all 40 eligible commits would have been lost with no partial
    record** — not degraded, gone. Two sessions have now had to reason about liveness from `ps` alone,
    and one of them (2026-08-09) misread a stalled log tail as a dead job. The append-as-settled fix
    shape is the one to take: a progress line helps a watcher, but only an incremental record survives
    the crash that makes the silence expensive.

## 2026-08-13 — the worker confirms its own cancellation, and a crash stops reading as one (OAI-66)

- **OAI-66** — **Two reconciler diagnoses that contradicted the row they were written from.** Shipped
  2026-08-13, commit `e966c95`, direct to `main`. 820 tests green, measured from a clean extract of the
  commit rather than the working tree.
  **(a)** `terminalizeDead` treated any pending `cancel_requested_at` as proof the cancellation
  completed, so a worker that CRASHED with a cancel in flight was published as a clean `cancelled` with
  `failure=null` and no rendered note. Now the exiting worker announces itself in `<seq>.cancel-ack`
  beside its job log, bearing the row's id, and the reader splits on the row's own state: a `queued`
  row reads `cancelled` needing no evidence (acquisition is what makes a row `running`, so it provably
  sent nothing), a `running` row only on a present, id-matching acknowledgement, and otherwise `failed`
  / `cancel-unconfirmed`.
  **(b)** `terminalizeUnstarted` blamed the submitter for a crash it could not establish. The draft's
  fix — condition the hint on `spawned_at` — was **refuted during the probe**: OAI-67 had made a NULL
  `spawned_at` possible while a real worker exists, so it would have replaced one false claim with
  another. The hint now scopes its ignorance to itself and points at the log.
  **A file, not a row, and beside the log rather than in it.** A terminal row would clear the `running`
  blocker and let the queue dispatch before the process reached `process.exit()`; and the log carries
  model output via `SALVAGED_OUTCOME`, so a verdict that SUPPRESSES a crash diagnosis must not rest on
  bytes the model could author. The read runs inside the queue's `BEGIN IMMEDIATE`, so it opens
  `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`, bounds the size, and never throws.
  **Carried in the same change:** retention sweeps the acknowledgement with the log, keys its orphan
  scan on the union of both names and admits only sequences it can address again; `/oai:status` stops
  promising a cancelling job "reads cancelled once its worker has exited"; and three hints stop
  asserting what they cannot establish.
  **Live evidence**, LM Studio `qwen/qwen3.6-27b`, both directions: a cooperative cancel reads
  `cancelled` with the acknowledgement on disk; a SIGKILL with a cancel pending reads `failed` naming
  the ambiguity. Before this, that second run was a clean `cancelled` with no note.
  **Review:** three ladder passes, three batches, one verification-only pass, three verdict rounds.
  Nine mutations, eight discriminating; M7 was RETIRED rather than passed after measurement showed the
  term it tested could never decide anything. **Committed on the user's approval, not on dual approval**
  (`adr/088`): round 2 split — Codex approved while an independent Claude subagent caught an
  "exactly equivalent" claim that was false and self-contradicting across two adjacent ADR lines — and
  round 3 rejected on the status-line promise, whose fix no approver has seen. Every pass carried a
  coverage gap: `security-review` cannot run in this repo.
  **Residue filed rather than built:** OAI-149 (bind the orphan-sweep key to a store incarnation) and
  OAI-150 (repair or refuse an inherited state-directory permission chain), both cleared by both
  approvers as bounded deferrals, with the shipped artifacts stating their residuals.
  Full ledger: `plans/oai-66-the-worker-confirms-its-own-cancellation.ledger.md`.

## 2026-08-12 — a failed launch stops holding the queue, and housekeeping stops sinking live submissions (OAI-67)

- **OAI-67** — **A failed spawn blocked the whole queue; post-spawn write failures reported failure
  while the worker ran on.** Shipped 2026-08-12, commit `9883f7f`, on branch
  `oai-67-spawn-failure-must-not-hold-the-queue`. Three fixes, all one defect class — the submitter
  asserting more about a worker than it can observe:
  **(a)** an unconfirmed launch now terminalizes its own row via `abandonUnstarted`'s
  `state = 'queued' AND waiter_pid IS NULL` compare-and-set, so the 120s startup grace no longer
  blocks every successor. The CAS rather than `finish` is the whole design: a rejection does NOT prove
  no child exists, since `spawnWorker` closes its log descriptor AFTER the `'spawn'` event fires.
  **(b)** the retention sweep moved before `insertJob`, so a non-busy sweep failure can no longer sink
  a submission whose worker may already be spending.
  **(c)** the row stamp now reports ANY storage fault and still returns the id — with the report
  itself guarded, since a throwing stderr would lose the id it was announcing.
  Five review passes, 26 accepted findings, four batches, dual approval on digest `ad3dc1daf058`.
  810 tests green; nine mutations re-run after every batch; live round trip against LM Studio.
  **What was deliberately NOT done here, and why it is not residue but scope:** the root cause in
  `job-spawn.mjs` is **OAI-145** (the user chose containment over enlarging this change), the
  liveness overclaims in pre-existing text are **OAI-146**, and a structural-guard blind spot found
  during the review is **OAI-147**. **OAI-108 was amended rather than fixed** — this change ENLARGED
  it: a `--json` caller now sees ordinary success after a corrupt-database submission that previously
  rejected. That trade was put to the user with both my recommendation and Codex's, and chosen
  knowingly.

## 2026-08-09 — the load hints stop predicting an outcome the plugin cannot control (OAI-134)

- **OAI-62** — **The `SQLITE_BUSY` property does not hold at two sites, and one of them kills live work.**
  OAI-52 item (3) recorded "a `SQLITE_BUSY` expiry is retried, never terminalized" as an untested
  property. It is not merely untested; it is **false in two places**, and this item supersedes that
  sub-item.
  **(a) The heartbeat kills the worker outright.** `job-heartbeat.mjs:57-60` calls `beat` and
  `cancelRequested` inside a `setInterval` callback with **no try/catch**, and `job-record.mjs:176` and
  `:207-209` are bare `db.prepare(...).run(...)` with no busy retry. **Proved by execution**:
  `startHeartbeat` with a handle whose `prepare()` throws "database is locked" (errcode 5) kills the
  process — exit 1, the probe's "SURVIVED" line never printed. So a contended database kills a running
  worker **mid-model-call**. ADR 014 (~296) itself notes a suspended process holds the writer lock
  until other writes fail past the timeout, so the contention it needs is a case the design already
  anticipated.
  **(b) `finish` discards a completed answer.** `cmd-task-worker.mjs:74` calls `finish` with no busy
  retry, unlike queue acquisition which has one (`job-queue.mjs:111`). If the lock is held past the
  10s timeout **after the model has already answered**, the outer catch files a storage error as a task
  failure and the expensive answer is gone.
  The catch added for (a) must be **narrowed to busy** — a blanket swallow would hide real corruption,
  and the stale-beat → `stalled` → non-terminal path already handles a missed beat correctly.
  **(c) `openStore` itself can throw `database is locked`, at the line whose comment says it cannot.**
  Observed **once, live**, during the OAI-58 commit gate: `tests/queue.test.js:23` ("two jobs submitted
  at once run one after the other, never together") failed with
  `Error: database is locked at openStore (job-store.mjs:151)` — which is
  `db.exec('PRAGMA journal_mode = WAL')`, the statement immediately after `busy_timeout` is set. The
  comment at `:145-149` argues that setting `busy_timeout` **first** is what stops exactly this ("with
  no timeout in force yet a second process opening the store at the same moment fails outright…
  Every statement after this line waits instead"). It does not, at least not always: converting to WAL
  needs an exclusive lock, and the busy handler is not honoured for every such case.
  **Rate and trigger, stated honestly rather than inflated.** It did not reproduce: 8/8 green running
  `tests/queue.test.js` alone and 3/3 green on the full suite afterwards. The one occurrence was
  almost certainly two full `npm test` runs overlapping on this machine, which widens the window — a
  real contention scenario (two plugin commands at once produce the same thing), but not one the suite
  normally creates. **So this is a genuine intermittent whose rate is unmeasured**, and the value here
  is the located line plus a comment that overstates its guarantee, not a frequency.
  **Second occurrence, 2026-08-05, and it confirms the hypothesised trigger.** Seen during OAI-5's
  mutation testing, at the same line: `Unexpected failure: Error: database is locked at openStore
  (job-store.mjs:151)`, this time surfacing through `submitTask` (`task-submit.mjs:93`) rather than
  the queue test. It happened while two `npm test` invocations genuinely were overlapping — which is
  exactly the condition the paragraph above guessed at, so **the trigger is now observed rather than
  inferred**. Still unmeasured as a rate, and still indistinguishable from a real regression when it
  fires.
  **Third occurrence, 2026-08-05, during OAI-5's pass 8 audit — and it lands back on the ORIGINAL
  site.** `tests/queue.test.js:23`, the same test as the first sighting, again `database is locked`,
  again under concurrent runs, and green on the two runs either side of it. Three sightings, two
  distinct call sites (`openStore` via the queue test, and via `submitTask`), one trigger. That is
  enough to stop calling it unexplained: **the mechanism is contention on `PRAGMA journal_mode = WAL`
  during open, exactly where the comment at `job-store.mjs:145-149` claims the preceding
  `busy_timeout` makes waiting universal.** What remains unmeasured is the rate.
  It also means the suite carries a rare flake whose failure message is indistinguishable from a real
  regression — worth a targeted retry at this call site so a contended open waits rather than killing
  a submission.
  **STATUS, 2026-08-07 — built, committed, and NOT closed: the ladder ran its full ten passes and
  ended `cap-without-approval`.** (a), (b) and (c) are all fixed and shipped —
  `scripts/lib/job-busy.mjs` with `withBusyRetry` at six enumerated sites, the heartbeat and the
  queue's wait loop guarded, the `completed` write moved outside the catch that publishes `failed`,
  and `salvageOutcome` writing the answer to the job log when that write's retry exhausts. Suite
  660/0, verify skill green against a live server, and the design is [ADR 020].
  **What stops this closing is OAI-106.** At the terminal verdict point the Claude approver approved
  and **Codex refused**, on this ground: after an exhausted persistence retry the public lifecycle
  still reports `worker-died` for work that completed, and no product reader can recover the salvaged
  answer — a false terminal state produced by contention, which is one of the outcomes this item
  exists to remove. `salvageOutcome` keeps the bytes; it does not correct the verdict.
  **The decision is the user's**: build OAI-106 (a `persistence-pending` state, or a recovery pass
  that reads a salvaged line back into the row) and reopen this, or accept the artifact as shipped and
  close this item over Codex's objection. Also left `unresolved at cap`: [OAI-109] and [OAI-110].
  **CLOSED 2026-08-12 — over the reviewer's objection, deliberately and with both verdicts recorded.**
  The three shipped defects are the ones that destroyed work and they are fixed. What blocked closure
  was the residual: on retry exhaustion the row is never corrected, so reconciliation later publishes
  `failed`/`worker-died` for a job that answered (`job-reconcile.mjs:34-39`), and no command renders
  the salvaged line.
  **Verified before deciding, not taken on the backlog's word**: the answer is NOT unreachable — both
  `/oai:status` and `/oai:result` print the job log path literally and the failure hint already says
  the output is in the log; what is missing is that nothing names the `SALVAGED_OUTCOME` marker or
  renders it. The trigger is `SQLITE_BUSY` past a 10s timeout **after** the model answered, and that
  path's rate is **unmeasured and never observed in the wild** (the three recorded sightings are
  `openStore` contention at a different site, under two overlapping test runs).
  **Both verdicts, unresolved rather than merged.** Codex, asked as an owner-level scheduling
  question, reversed its own ladder refusal: *"A loses because it expands a rare, unmeasured residual
  into a state-machine change that risks creating broader lifecycle defects"* — RECOMMEND B (close).
  Claude agreed on B and added the narrowing that made it defensible: the defect Codex named is a
  **false sentence**, not a missing state, so OAI-106 was re-scoped to separate its cheap half (stop
  asserting "exited without recording an outcome" when a salvage line exists — no new state) from its
  expensive half (a `persistence-pending` state). The user decided.
  **Left open and tracked, not silently dropped**: OAI-106 (both halves, plus the missing test that
  would let the false terminal state fail), [OAI-109] and [OAI-110], all `unresolved at cap` from that
  ladder.

- **OAI-139** — **When nothing is resident the window is unknown, so the size guard is DISABLED and
  the drop-to-hunks fallback can never fire — a cold start sends untrimmed input.** Filed 2026-08-10,
  found while probing OAI-138 and **distinct from it**: this is a window-detection defect, not a
  wall-clock one, and raising `--max-seconds` cannot touch it.
  **Reproduced by accident, then confirmed in code.** Commit `77c1eab97` was re-run alone on a fresh
  process with `lms ps` empty. It failed in **14 seconds** with `empty-completion` on all three
  attempts, at **`promptChars: 492053`** — roughly **145k tokens against a 61,696 window**. The same
  commit in the overnight sweep, reviewed mid-run with the model already resident, built a prompt of
  **150,056 chars** — **3.3x smaller** — and failed as `deadline-timeout` instead. Same commit, same
  code, same machine; the only difference is whether a model was loaded when the process started.
  **The mechanism, read off the code rather than inferred.** `context-guard.mjs:46-51`:
  `if (!contextLength) return { checked: false, note: 'Context window unknown for …' }`. The guard
  **returns without checking**, so the oversize refusal below it never throws. That refusal is the one
  carrying `reason: 'oversize'` — its own comment calls it *"the one refusal that sending less input
  can fix, so the one a caller may retry smaller"* — and it is what makes a caller drop `changed`
  files and fall back to the hunks. **No refusal, no retry, no dropping.** `contextLength` comes from
  `loaded_context_length` (CLAUDE.md: never `max_context_length`), which is **null for a model that is
  not resident**, so the whole chain is disarmed exactly when a run starts cold.
  **Why it matters beyond one commit.** Every sweep starts with nothing loaded, so its **first**
  review runs unguarded, and any single-commit invocation does too. `adr/005`'s guarantee — *"the reply
  falls back to the diff alone when the window is too small"* — is **unavailable in precisely the
  situation it was written for**. The failure is then attributed to the server (`empty-completion` is
  a documented LM Studio drop shape), which is how it stayed invisible: a client-side sizing bug
  wearing a known server-side symptom.
  **A hypothesis this DISPROVED, recorded so it is not re-run.** The obvious next thought was that
  last night's 20 timeouts were also over-window. **They were not**: measured across all eligible
  entries, the failures' inputs run 7,253-48,583 tokens with **zero above 61,696**. They are 2-3x
  larger than the completions (median 33,071 vs 9,213-15,669) and that is why they are slow, but they
  fit. **OAI-138 remains a time problem; this is a separate size problem.**
  **DECIDED 2026-08-10 (user, Claude and Codex agreeing): do NOT set a per-provider `contextLength`
  as an interim mitigation.** It was proposed and rejected on Codex's reasoning: `delegate.mjs:149`
  lets a configured value override per-model detection **unconditionally**, this profile serves six
  models whose windows were never measured, and `adr/002` records the author removing exactly such an
  override from their own config. Decisively, it would **mask this defect while making the guard look
  armed** — removing the runtime symptom OAI-139 needs to stay observable and preventing an ordinary
  run from ever testing the fallback. **The accepted risk of leaving it unset** is that a cold-start
  first review stays fail-open; that risk is visible and attributable, which the alternative is not.
  **CODEX REVIEW 2026-08-10 — two of the three claims above were overstated. Corrected here.**
  - **Claim A (the guard returns early) — TRUE**, `context-guard.mjs:46`.
  - **Claim B — FALSE AS WRITTEN, narrower version true.** I cited the wrong files: the caller is
    `review-ladder.mjs:47`, not `review.mjs` or `git-diff.mjs`, and the drop happens there via
    `if (error.reason !== 'oversize') throw error;` then a rebuild with whole files off. Other paths
    DO reach the hunks rung independently — explicit `--diff-only` (`git-diff.mjs:219`), and changes
    with no readable body (deletions, binaries, vanished files) — but **none of them drops a populated
    `changed` collection.** So "the fallback is reached only via that refusal" is false; **"an
    oversized whole-file review with an unknown window never drops those files" is true**, and that is
    the defect.
  - **Claim C — FALSE AS UNCONDITIONAL, true for unconfigured LM Studio.** `delegate.mjs:149` resolves
    `contextLength: profile.contextLength ?? windowFor(described, model)`, so **a configured
    `contextLength` still arms the guard** — which is why the note tells the user to set one, and it
    is a real mitigation available today. Detection is also stricter than I said: `model-info.mjs:87`
    requires `state === 'loaded'` **and** a positive integer, not merely a non-null field. And it does
    not generalise: llama.cpp `/props`, TGI `/info` and oMLX report a served window **without**
    residency, so this is an LM-Studio-shaped hole, not a universal one.
  **FIX RECOMMENDED BY CODEX: option 3, as a cap on optional whole-file ENRICHMENT — not option 1.**
  I had favoured assuming a small window; Codex argued the better seam is `target.changed`, which is
  already explicitly droppable, where `target.files` may be the only copy of untracked or `--file`
  content. In `prepareLadder`, build and measure the whole-file candidate and choose the hunks rung
  when it exceeds a named enrichment ceiling **even when `contextLength` is unknown**, keeping the
  existing guard for authoritative refusal when a real window IS available. **This invents no window
  number**, which is the objection to option 1.
  Its stated constraints: never silently truncate an individual file; never apply the cap to
  `target.files`; never turn an oversized irreducible diff into a fabricated context-window refusal;
  set `hunksOnly: true` exactly as the existing fallback does; and **give the ceiling its own name and
  rationale** — `REVIEW_UNKNOWN_WINDOW_TOKENS` is a *reply* budget and must not be reused as an input
  threshold.
  Its risks, as stated rather than as reassurance: on a large but undetectable window it may discard
  whole-file context that would have fit, reducing precision and possibly reviving the false positives
  `adr/005` exists to address; the threshold is a heuristic, not proof of fit; a huge diff or a pinned
  `--file` can still overload an unknown window because those inputs cannot honestly be dropped; and a
  threshold chosen against this 61,696-token machine may age badly across providers.
  Note the interaction with OAI-134: that item established the plugin has **no channel to influence a
  load**, so it cannot ensure residency — it can only notice.
  **PRE-REGISTERED EXPERIMENT, launched 2026-08-10 21:35, thresholds fixed BEFORE the result exists.**
  A `--diff-only` sweep over the same pinned SHA, window, model and 1800s cap as that night's
  whole-file run — `bench/results/oai139-diff-only-2026-08-10/`. Diff-only **is** the rung this item's
  enrichment ceiling would force, so this prices the fix's stated risk (under-enrichment reviving the
  false positives `adr/005` exists to address) before a line of it is written.
  Read against the whole-file baseline of **17 finding-bearing commits of 40 eligible**:
  - **CHANGES THE DESIGN** if diff-only loses **5 or more** of those 17 (~30%) with no credible
    replacement findings. A low blanket ceiling would then be wrong, and the fix needs a higher or
    selective threshold, or a different cold-start sizing mechanism entirely.
  - **CHANGES NOTHING** if **15 or more** of the 17 still produce credible findings with no material
    rise in false positives.
  - **Between those: INCONCLUSIVE, and explicitly not evidence for changing the design.**
  - **A better completion rate on its own changes nothing** — the ceiling is *expected* to improve
    fit, so that result is not informative about the risk being measured.
  **It is a CONSERVATIVE test and its asymmetry is stated:** `--diff-only` strips enrichment from
  every commit, where the ceiling would strip it only above the threshold. So a good result strongly
  de-risks the fix, while a bad one identifies the risk but likely overstates its incidence.
  **RESULT 2026-08-11: INCONCLUSIVE by the letter, and the letter is what counts.** Diff-only kept
  **12** of the 17, **lost 5** (all five going to `clean`, not to fewer findings), and made **7** new
  commits finding-bearing; totals 19 finding-bearing and 35 findings against 17 and 23. Neither branch
  fires: the design-change branch needed 5+ lost **with no credible replacements** and replacements
  exist; the changes-nothing branch needed 15+ kept and only 12 were. Recorded as inconclusive rather
  than argued either way.
  **The result NOT in the thresholds is the one that matters: all five losses became `clean`.** A
  false-clean is this repo's worst outcome shape, and it is exactly the under-enrichment risk. Also as
  pre-registered, diff-only's better completion (39 of 40 vs 36) is **uninformative** here.
  **REPLICATION LAUNCHED 2026-08-11 08:26, design challenged and changed by Codex.** My proposal was
  two more whole-file runs to bound variance; Codex rejected it — that leaves the **diff-only** arm,
  the one whose effect must actually be identified, as a single draw. Running instead **one more of
  each arm**, both at 1800s on the same pinned SHA, **diff-only FIRST** so that any drift with time or
  machine state no longer lines up with the arm as it did before. `lms unload --all` between arms for
  the same cold-start state. Records in `bench/results/oai139-replication-2026-08-11/`.
  **The decision statistic, fixed in advance: EXCESS NON-REPRODUCTION `E`.** Over the original 17
  whole-file finding-bearing commits, let `L` be how many have their credible original finding absent
  in a run; `E = mean(L_diffonly_1, L_diffonly_2) - L_wholefile_2`. **`E >= 5`: reject a blanket low
  enrichment ceiling. `E <= 2`: the loss is ordinary run variation, proceed with the ceiling design.
  Between: inconclusive.** Match **substantive findings**, not merely whether a commit produced any.
  **Total findings and finding-bearing counts are explicitly NOT the decision statistic** — extra
  findings may be false positives and cannot automatically offset lost established ones.
  **REPLICATION RESULT 2026-08-12 — the diff-only concern is REFUTED, and `E` clears the bar.** Of
  whole-file #1's 17 finding-bearing commits, the re-runs were finding-bearing again: **whole-file #2
  kept 12 (absent 5)**, **diff-only #1 kept 12 (absent 5)**, **diff-only #2 kept 14 (absent 3)**.
  **`E = mean(5, 3) - 5 = -1`**, comfortably inside the pre-registered `E <= 2` branch: *the loss is
  ordinary run variation, proceed with the ceiling design.* **The same configuration re-run against
  itself lost exactly as many as diff-only did**, so the five losses that looked like an
  under-enrichment signal were noise from a single draw.
  **The variance is larger than the effect anyone was arguing about**: whole-file's own finding-bearing
  count moved **17 -> 22** between identical runs.
  **A caveat that is NOT a hedge: this is the finding-bearing PROXY, not substantive matching.** The
  full per-commit comparison is committed alongside the records at
  `bench/results/oai139-replication-2026-08-11/substantive-comparison.md` (gitignored directory - the
  numbers here are the durable copy).
  **What the substantive read shows, and it changes the meaning of "absent":** across the 10 commits
  where any run went quiet, "absent" almost never means *the defect was not found*. It usually means
  **a different defect was reported**. `d2396ce08` had its relative-path guard defect found by three of
  four runs; `caa9d85ba`'s `reduce`/NaN defect was found by the baseline and by diff-only #1 in nearly
  identical words. **Only ONE of the 17 - `10b29cbda` - went clean in all three re-runs**, making its
  baseline finding the single best candidate for a baseline false positive.
  **One commit is the exception worth keeping in view**: `f5079538d`'s `coverageSection` exactly-once
  pair was found by **both whole-file runs, in near-identical words, and by neither diff-only run**.
  That is the only per-commit pattern in the set that looks like a genuine enrichment effect rather
  than churn, and it is one commit - not evidence, but the thing to watch if the ceiling ships.
  **Codex's stated failure mode for this design: nonstationary pseudo-replication.** Two sequential
  samples per arm can look stable while power state, thermal load, residency or rare decoding paths
  shift together, and `E` also rests on a human judging whether findings substantively match. A
  decisive-looking answer may reflect one machine-day and one adjudicator.
  **DONE 2026-08-12.** `prepareLadder`'s first rung now requires `windowKnown`, and it returns the rung
  it took plus `skipped: 'unsized-window'` so the report OBSERVES the branch rather than recomputing
  its premise — a design reversal made mid-build after `codex-adversarial` showed the recomputation
  could contradict the request. Verified cold on the reproduction commit: `77c1eab97` now sends 40,139
  prompt tokens and COMPLETES with 3 findings in 1,432s, where on 2026-08-10 it died in 14s at ~145k
  tokens. Deterministic control alongside it: 146,265 prompt chars unsized vs 482,836 with a window
  declared. Mutation-proved after every batch — removing the guard reddens the request-log witness and
  both disclosure tests together. `adr/005` amended; three of its own claims were adjudicated FALSE
  during review and corrected in place with the originals quoted. Ladder: 3 passes, 13 accepted
  findings, terminated early at the user's decision once the implementation was judged stable and the
  remaining findings were all in the prose describing it. Residual, disclosed rather than fixed:
  pinned/untracked bodies are still sent unmeasured under an unsized window, because `adr/005` refuses
  to drop the only copy of that code — see the ADR. Widening filed as OAI-142.

- **OAI-134** — **SHIPPED as `d2dd70e`, with its filed mechanism refuted and its proposed fix refuted
  too.** What shipped is two hint strings and a README paragraph. What it cost was a full `/feature`
  run plus a light review pass, and the value was almost entirely in the refutations, not the diff.
  **Refuted #1 — the mechanism.** The item said the plugin sizes a JIT load by `max_context_length`.
  It does not, because **it has no load channel at all**: `client.mjs:40` is the only completion body
  and carries no `ttl`/`context_length`/load parameter, `/chat/completions` is the only POST, the model
  endpoints are GET probes, and no `lms` subprocess exists. Confirmed independently by a Codex consult
  reading the same files. The symptom was real and reproduced; the cause is the **server's own** JIT
  configuration, which this plugin neither sets nor sees.
  **Refuted #2 — the fix.** The plan's next candidate was a pre-emptive "model is not loaded" warning,
  and a blanket refusal behind it. Both died on a live check against a **second** server: oMLX 0.5.7
  JIT-loads successfully (`loaded_count` 0 → 1 inside a 7s prefill), so *not loaded* is its **normal
  successful path** and the warning would have fired on runs that work. LM Studio 0.4.20 attempts the
  load and may refuse for memory (a 7.15 GB model sized at 44.87 GB) — and, observed the same day,
  succeeds on a model that fits. Two servers at two versions support no claim about servers in general.
  **Also rejected: shelling out to `lms load` or a vendor REST load call** — `adr/001`'s "providers are
  config data, never code paths".
  **What actually shipped.** Both hints used to end *"to have it loaded on demand"*. Neither predicts
  an outcome now. The none-loaded hint (`:199`) names only the decider; the no-candidates hint (`:171`)
  says nothing about outcomes at all, because that branch fires when the server offers **no** chat model
  and "an id it has not loaded" would presuppose it knows the id. README.md is the single home for the
  dated per-server pair, and says explicitly that two observations are not an account of every server.
  **Three drafts of one string were caught, each a weaker version of the same defect** — "to have it
  loaded on demand" (promises the load) → "the server will try" (promises the attempt; caught at the
  plan gate) → "the server's to do or refuse" (names a two-outcome set; caught by `codex-plain` in the
  review pass). The third excluded the **third** thing a server does: answer from whatever else it has
  loaded — the substitution `unservedProblem` catches before the fact and `model-identity.mjs` after.
  The working test, recorded because it is reusable: **does the sentence permit silent substitution?**
  **Verified by running the changed path, not by the suite.** No test pins either string
  (`grep -rn "loaded on demand" tests/` returns nothing), so a green suite here **could not have
  failed** — this repo's dominant defect class, arriving inside its own fix. With LM Studio serving 5
  unloaded chat models, the none-loaded hint printed the old wording before the edit and the new
  wording after.
  **Process, recorded honestly:** the review ladder ran **one light pass** and ended
  `exit_mode: terminated` without a verdict point — the window closed. Pass 1 raised 5 findings, all
  accepted and all fixed in the one authorised batch; one of them (the docstring claiming the hints
  "name who decides, never what will happen") was an `adr/083` adjudicated falsehood, which is why
  pass 1 could not be terminal. Four **pre-existing** defects the pass surfaced went to **OAI-136**
  rather than into the batch. The process cost far exceeded the change; that observation goes to
  `ROUTING_LOG`.

## 2026-08-09 — the schema arm becomes measurable, and `bench/run.mjs` stops running on import (OAI-117)

- **OAI-117** — **`bench` could not pass `--structured-output`, so the schema arm could not be measured.**
  `bench/run.mjs`'s `SPEC` now carries the flag, `reviewFlags` forwards it, and the artifact records
  it in **two** places — the report header, where two files are compared, and a caveat naming the
  trade. Suite 771/0 → **777/0**.

  **The caveat states a trade, not a flag**, because the reading to prevent is "same measurement,
  tidier reply": a schema was measured to *cause* the transport drops (OAI-19 T2, controlled A/B) and
  the unconstrained default was measured to spend its whole shared budget reasoning (OAI-115). An arm
  run under a schema compares one failure class against the other. **This does not answer OAI-115** —
  it makes the question askable, and taking the measurement belongs to OAI-19's arm work.

  **A second, larger defect was found while building the seam, and it is the reason this entry is not
  a one-liner.** `reviewFlags` was unreachable, so exporting it was the obvious move — and the first
  import from `tests/` **ran a full six-case benchmark and wrote a report and a record into
  `bench/results/`**, because `main()` was called unconditionally at module scope rather than under a
  `process.argv[1]` guard. Every `npm test` would have done it. Fixed with the guard
  `bench/review-sweep.mjs:291` already had; proved both ways — import writes nothing (61 artifacts
  before, 61 after), and `node bench/run.mjs --runs 0` still reaches `main()`'s validation.
  **I asserted that guard existed before checking**, and the check is what disproved it; the comment
  claiming it has been replaced by one recording what actually happened. OAI-125's body is updated,
  and this does **not** close it.

  **Every assertion shipped with its negative twin, and the twins were mutation-checked.** Forcing the
  header marker unconditionally makes the `doesNotMatch` halves fail — without that, a marker that is
  always present would distinguish nothing, and a schema arm could be differenced against an
  unconstrained one as though the only change were parsing. `tests/bench-review-flags.test.js` covers
  the command line (including that `--structured-output` is **absent** by default, per ADR 003), and
  `tests/bench-report.test.js` covers the artifact.

  Two structural guards fired during the work and were satisfied rather than silenced: `flagNotes`
  crossed the 60-line function budget (split into `schemaNote`), and the first split left a doc
  comment documenting nothing — briefly "fixed" by downgrading it to a plain comment, which was
  dodging the guard, then fixed properly by reordering.

## 2026-08-09 — the tracker's own invariant gets a guard (OAI-104)

- **OAI-104** — **this file's structural invariant was enforced by a script that did not exist.**
  Closed by `tests/backlog-structure.test.js`, which asserts on every `npm test` that the tier index
  covers the live set exactly, that no id is indexed under two tiers, that the bodies are in ascending
  ID order (`adr/025`), that nothing is live and closed out at once, and that every absorbed-ID
  redirect lands on something live. Suite 766/0 → **771/0**.

  **The claim was false and the drift was already there.** On its first run the guard failed three
  ways: tier 12 still indexed **six ids closed the previous day** (OAI-118, 119, 120, 121, 122, 124),
  **OAI-131 and OAI-106 were each indexed under two tiers**, and **OAI-123's body sat out of order
  behind OAI-134**. All three are fixed in the same commit, so the guard passes on a tracker it
  actually corrected rather than on one written to suit it.

  **Proved by mutation, in the shape this repo requires** — control fires, fix catches, and each
  assertion is independently falsifiable. Re-indexing a closed id trips only *covers the live set*;
  indexing one id under two tiers trips only *listed twice*; swapping two bodies trips only *ascending
  order*. `BACKLOG.md` was restored byte-identically (md5 `f3d7cf4d…`) after each mutation.

  **One false positive was caught and removed before shipping**: matching any bolded id in
  `BACKLOG_DONE.md` reported five live items (OAI-11, 45, 74, 84, 95) as closed, because a done
  entry's prose legitimately names live work. The extractor is pinned to the same `- **OAI-n**`
  heading shape `bodyIds` uses.

  The prose promising the absent script is replaced in both `BACKLOG.md` and `CLAUDE.md` by a sentence
  naming the guard — OAI-104's own instruction was to do one or the other and not leave the sentence
  standing.

## 2026-08-08 — the review-sweep follow-on (OAI-118, 119, 120, 121, 122, 124)

Shipped in `10b29cb`. All six filed defects are fixed and were audited 18/18 by the ladder's
acceptance stage; suite 766/0.

**The ladder ended `cap-without-approval` at the computed cap of 3**, which is NOT a statement about
these six: their fixes landed and were verified. It is a statement about the SIX NEW findings that
pass raised — filed as OAI-125 to OAI-131 (tier 12b) — led by the resolved-SHA guarantee reaching the
artifact via one untested path.

Highlights worth not re-deriving:
- `classify` now builds every report-derived entry through one mapping, with a differing verdict as an
  override; that closed 120 as a consequence of fixing 121's rule.
- `serverUnwell` took **five** iterations. The rule that held is the CLI's own per-budget hint:
  `deadline` and `first-token` say raise the timeout, `idle` says raising it will not help. The fourth
  iteration — removing every timeout — was a regression caught one pass later.
- Two `.claude/REPO_TRAPS.md` classes were graduated from this feature: *a stub gentler than the
  dependency it stands for*, and *a test that asserts presence where the code guarantees presence*.

- **OAI-118** — **The sweep report's "exactly one disposition section" invariant is both VIOLATED and
  UNGUARDED.** Filed 2026-08-08 from the review-sweep ladder, `unresolved at cap`. A `truncated` entry
  carrying findings renders in **both** the Findings section and Coverage, against `adr/021`'s claim
  that each enumerated commit appears exactly once. And the only test that claims to guard it —
  `tests/sweep-report.test.js` `every commit appears exactly once` — asserts only
  `assert.match(out, /sha/)`, which one occurrence and ten both satisfy: it has failure power on
  absence and **none on duplication**. A positive control run against the checked-out bytes rendered a
  SHA twice with the assertion still green, and the fixture cannot exercise duplication at all (every
  entry in it is either REVIEWED-only or non-REVIEWED-only). **Both halves must land together**: the
  module header states the invariant confidently, so a future reader will believe it. Either dedupe the
  rendering or state the two-role policy in `adr/021` — and make the test count occurrences.
- **OAI-119** — **`deadline-timeout` is a caller-selected cap, and treating it as server death aborts
  healthy sweeps.** Filed 2026-08-08 from the review-sweep ladder, `unresolved at cap`. **CODE
  DEFECT.** `serverUnwell` admits `deadline-timeout`, but that reason is `--max-seconds` firing — the
  harness's own cap — not evidence the server is unwell. Three slow large commits in a row therefore
  trip `--abort-after` and mark every remaining commit `skipped-abort`. This is the **third** narrowing
  of the same predicate (any `*-timeout` → `{deadline, idle}` → `{idle}`), each of which removed a real
  false positive. Leaves `idle-timeout` alone in that group, which is correct: a stream that stalls
  mid-generation is the server stopping. **Workaround until fixed: `--abort-after 99`.**
- **OAI-120** — **A substituted model's findings are silently dropped from both artifacts.** Filed
  2026-08-08 from the review-sweep ladder, `unresolved at cap`. **CODE DEFECT, reproduced.**
  `classify`'s `substituted` branch returns without copying `settled.report.findings` or the caveat
  fields, so when a server answers with a model other than the one requested, the real defects it found
  never reach the report — the commit shows only in Coverage with "a different model answered".
  **This is trap instance 11 verbatim** — fixing the branch in front of you leaves the adjacent one
  wrong — committed in the very pass that fixed the identical omission for `truncated` and wrote the
  rationale for not doing it. **Adjudicated a RECURRENCE of OAI-121's identity**, which is why that
  item is also open. **This one blocks the model benchmark specifically**: substitution is the failure
  `adr/011` exists for, and an affected arm would report as having found nothing.
- **OAI-121** — **`classify` must carry EVERY belief-changing envelope field on EVERY path.** Filed
  2026-08-08 from the review-sweep ladder, `unresolved at cap` **by recurrence**. The identity is
  *"`classify` does not carry onto the entry an envelope field that changes what a reader should
  believe"*. It was fixed twice — `analysisCut`/`atCap`/`hunksOnly`, then `dropped` — and recurred as
  OAI-120 on a branch the fix never reached. **The fix is the RULE, not another branch**: a single
  place that maps a parsed report to an entry, used by every path, so a fourth path cannot be added
  without it. A structural test belongs here: this class has now been confirmed three times, which is
  past this repo's graduate-to-a-guard bar.
- **OAI-122** — **`adr/021` contradicts the shipped code on two superseded claims.** Filed 2026-08-08
  from the review-sweep ladder, `unresolved at cap`. It still documents an any-`*-timeout` outage set
  (narrowed twice since) and a two-section disposition claim (there are three sections). Both would
  license reintroducing rejected behaviour during maintenance. Non-executable text only.
- **OAI-124** — **`bench/review-sweep.mjs` cannot pin its enumeration, so benchmark arms are not
  comparable.** Filed 2026-08-08. **This is a `widening` awaiting the user, not a defect**: nobody
  raised it in review and it is not in the approved plan. Enumeration starts at `HEAD`, so any commit
  landing between arms shifts the window and two arms review different commits. The model benchmark
  the user asked for — 5 models x 2 executions x the same 10 commits — needs `--from <ref>`, or some
  other way of pinning, before its arms mean anything.

# Done

- **OAI-94** — a credential notice that cannot print the credential. Done 2026-08-07, decision record
  [ADR 019](adr/019-a-notice-that-cannot-print-the-secret.md). `warnAboutQueryCredentials` is replaced
  by `noteEndpointPersistence()`, which **takes no argument, gates on nothing past
  `requireDatabaseSync()`, and runs before anything else writes to stderr**. Seven review-ladder
  passes, dual-approved at pass 7.
  **The position is the part that was nearly lost.** The call originally kept its old spot below
  `prepareTask`, and pass 5's review dismissed the resulting delivery risk on a measurement that varied
  stderr volume *after* the notice and never before it — the wrong axis. Both approvers then rejected
  the feature at the verdict point on the same defect, reproduced against the real CLI: a 1 MB provider
  name (config puts no ceiling on one) pushes the notice past the pipe buffer, `process.exit(2)`
  discards what has not drained, and the notice is **lost on a run that has already written a row
  holding the credential** — 131245 bytes of stderr, notice absent. The appealing remedy,
  `fs.writeSync(2, …)`, was measured and **does not work**: `process.stderr.write` queues in userland
  and flushes asynchronously. Moving the call above `prepareTask` does, at an accepted cost in
  precision — it now also fires on submissions that persist nothing, where the sentence stays true
  because its conditional is "if this submission creates a job record".
  **What it left behind:** four further credential disclosures its own reviews found and filed rather
  than fixed — OAI-99, OAI-100, OAI-101, OAI-102 — so six now stand enumerated and unfixed. One output
  path was made safe. OAI-100 is the sharpest: the notice now *precedes* the transport errors that
  disclose a path credential, so a caller is warned and then leaked to by a different code path that
  says nothing.
  **`security-review` never ran, in any of the seven passes**, and this was a credentials feature. Not
  a flaky launch: the stage is a built-in command whose frontmatter interpolates
  `git diff --name-only origin/HEAD...` before reading its argument, and this repo has no remote. A
  security lens folded into `codex-adversarial` stood in for it and is what found OAI-100. Filed
  against the toolchain, not this repo.

- **OAI-61** — capability-gate `node:sqlite` so the plugin loads on the runtimes `package.json`
  declares. Done 2026-08-06. **Shipped NARROWED**: a partial plan withdrawal under `adr/033` returned it
  to its approved scope after six review-ladder passes established that the build had grown three
  mechanisms no plan approved — a credential-notice subsystem, a permission-hardening module, and an
  `onProfile` hook — and that the large majority of ~5.5M subagent tokens had gone on reviewing that
  scaffolding rather than the gate, which was stable and repeatedly confirmed from pass 2. The withdrawn
  work is **OAI-94** and **OAI-95**, each carrying its open findings. Codex ruled the decomposition; the
  user adjudicated partial over whole.
  **What the ladder found that the gate itself needed:** a static `node:sqlite` import in
  `tests/job-helpers.mjs` killed ELEVEN test files at LINK time on the exact runtimes this feature
  restores — no skip can rescue a link failure — now fixed lazily and guarded structurally by
  `tests/harness-guards.test.js`, the class having been confirmed three times. And `npm test` passed
  only while the working tree was DIRTY: one test asked the ambient directory for uncommitted changes,
  which the commit gate's own commit removes, so the suite read 632/0 dirty and **630/2** clean. Every
  green reported during this feature before that fix was conditioned on it. The gate is now measured in
  a committed copy.
  **Proven vs cited:** the guard is proved structurally and by mutation (four capability tests fail by
  name), and the `--no-experimental-sqlite` arm is a real runtime without the module, executed here. The
  version thresholds (22.13 / 23.4 / 18.19 / 20.6) are **cited, not executed** — this machine has only
  v26.3.1 and the user directed that no older Node be installed.

Newest first.

- **OAI-57 (the `/oai:task` half)** — `--json` on `/oai:task`, shipped 2026-08-05 as the prerequisite
  Stage 2's task benchmark turned out to have: a bench that cannot read a machine-readable envelope
  must parse prose, which is the retracted class. **Full evidence, migrated 2026-08-24 from the live
  OAI-57 entry in `BACKLOG.md` to keep that item's still-open `/oai:status`/`/oai:result` ask
  readable** (verbatim, no wording changed): What landed mirrors `/oai:review` exactly — the reply as
  an opaque `content` string (nothing parses the answer's shape), the `notes` array so the template's
  caveats cannot go missing on the machine path, `contextChecked` beside `estimatedTokens`, and
  `errorReport` on failure with the exit code and stderr unchanged. **Verified against `TASK_SPEC` and
  by running the command, same day:** before this shipped, only `/oai:review` had `--json`
  (`REVIEW_SPEC.booleanFlags` included `json`; `TASK_SPEC.booleanFlags` was `['background']`, and
  `task --json` exited 1 with "Unknown option"). The gap mattered because **Stage 2's task benchmark
  needed exactly this** — a bench that cannot read a machine-readable task envelope must parse the
  prose footer, which is the class this repo has retracted twice.

- **OAI-83** — Task templates, starting with the one that makes a local **advisor** something you
  invoke rather than a prompt you rewrite. **Completed 2026-08-05**, Stage 2's first piece of
  `plans/local-llms-like-codex.md`. Plan: `plans/oai-83-advisor-template.md`; decision record:
  [ADR 016](adr/016-a-template-is-three-things.md).
  `/oai:task --template advisor` ships: `scripts/lib/task-template.mjs` owns the skeleton, the reply
  shape and the discipline, and `agents/oai-delegate.md` passes the flag when the delegated work is a
  second opinion. **The forks it was filed with were all settled** — (a) a template lives in a code
  module selected by a flag, not in agent prose or a `templates/` directory; (b) a template never
  chooses files, so the conflict with the broker is designed out rather than arbitrated; (c) a lens is
  a **parameter** of a template, decided now and built when OAI-11 needs it, so no `--lens` shipped.
  **One premise it was filed with was wrong**: OAI-84 was not a sequencing dependency. `parseFindings`
  has exactly one production caller and the task path parses nothing, so the template's output shape
  never touched the parser OAI-84 changes.
  **The ceiling is a heuristic and is labelled as one** — 8000 tokens, anchored between the measured
  1,680-token run that produced a checkable finding and the 49,378-token run that returned nothing. A
  large request is answered with a caveat, never refused or trimmed.
  **What the two review passes actually caught was the plumbing, never the design**, which had
  survived four Codex plan-gate rounds. The sharpest: the delegate recipe's unquoted
  `${template:+--template "$template"}` produced a **single** argument under **zsh** — the shell these
  recipes run in — so every delegate advisor submission was refused, while the guarding test ran `sh`
  and stayed green. The suite now runs the recipe's real block under every shell with zsh **required**
  and declared. Two more of the same family: a bare `TEMPLATES[name]` accepted `--template toString`
  and ran with the default prompt, and a test comment claimed containment coverage that a mutation
  disproved. Verified live on both paths against a real model; ladder ended on dual approval.

- **OAI-5** — A delegation subagent, so neither the reading nor the reply lands in the calling
  session. **Completed 2026-08-05**, Stage 1b of `plans/local-llms-like-codex.md`. Plan:
  `plans/oai-5-delegation-broker.md`; decision record:
  [ADR 015](adr/015-a-context-broker-not-a-forwarder.md).
  `agents/oai-delegate.md` ships as a **context broker, not a forwarder** — it picks the files, makes
  the submission, waits, and returns an account plus the job id rather than the model's reply. No
  `.mjs` changed; the feature is one markdown file plus four guards in `tests/plugin.test.js`.
  **The invariant was corrected on the way in.** Both this file's old entry and the parent plan said
  "exactly one companion call", which is not implementable — an oversize refusal *is* a call, and
  re-selecting is the broker's mandate. It ships as **at most two `task` submissions, at most one
  accepted job**, in that wording in the agent, the ADR and the parent plan's dated correction block.
  **Verified live, end to end, against LM Studio** rather than a stub. A nested session invoked
  `oai:oai-delegate`, which selected **one file (`scripts/lib/errors.mjs`, 711 B)**, submitted job
  `e3835ded`, polled it to `completed`, and returned a summary, the file list, the id, an explicit
  "unverified — leads, not conclusions" caveat and a pointer to `/oai:result` — without pasting the
  reply. The model's answer was then checked against the file and was accurate. This is also the first
  evidence in this repo that **`${CLAUDE_PLUGIN_ROOT}` expands inside an *agent's* Bash call**, which
  the whole design rests on and which nothing here had ever proved.
  **Three mutations, each with a restore proved against a backup — and one of them refuted a claim in
  this feature's own plan.** The plan said reordering the rendered line would turn the *consumer*
  assertion red. It does not: the exact-line assertion fires first and aborts the test, so no renderer
  mutation can separate the two. The consumer assertion was therefore proved by mutating the agent's
  own `awk` expression instead (`$3` → `$2`), which leaves the renderer untouched — one test red, on
  the right assertion. The other two: collapsing the two-space separator turns the **exact-line**
  assertion red, and dropping a `TERMINAL_STATES` member turns the **vocabulary** guard red. Recorded
  because a mutation that cannot fail is this repo's most-repeated defect class, and the plan proposed
  one.
  **The step 6 ladder ran EIGHT passes and closed by dual approval** (Codex `APPROVE` + a verdict-only
  Claude approver `APPROVE`, combined with `check-plan-gate.sh --dual-approved`, exit 0). Stages per
  pass: `acceptance-audit`, `advisor-opener`, `codex-adversarial`, `codex-plain`, `security-review`
  and `advisor-closer`. `security-review`'s packaged skill **cannot launch in this remoteless repo**
  (`git diff origin/HEAD...`; that is OAI-7) and was substituted by scoped agents each pass, recorded
  as a substitute and never as the skill passing — the OAI-58 precedent. `lean-wide` was evaluated
  every pass and never triggered: no module is introduced or altered. The `advisor` failed four times
  (overload, a reply describing a different session, a reply impersonating the orchestrator, a
  timeout) and completed five; it is never recorded as passing on a pass where it did not complete.
  Two verdict points rejected before the third approved — the first on ADR staleness, the second on
  pass completeness, and both objections were fixed rather than argued.

  **The finding worth remembering, because I got it wrong first.** Pass 7 found that
  `real=$(canon "$f")` is command substitution, which strips trailing newlines — so a symlink to a
  file whose *name* ends in a newline yields a path **nobody canonicalised**, and a sibling planted at
  that shortened name and pointing outside the tree is read and recorded under the innocent in-tree
  name. I first **filed** it as a reporting-integrity nit on grounds I reasoned to ("containment is not
  escaped, both files are inside the root"); the security lens **refuted those grounds by execution**
  in the next pass, attaching `/etc/passwd` while the audit trail said `sub/target`. It was then fixed
  at the canonicaliser — which refuses any resolved path containing a control character — reproduced
  pre-fix, blocked post-fix, with an ordinary in-tree file still accepted, and re-confirmed
  independently in pass 8 with its own positive control. **The fix forbids a legal filename rather
  than handling it**: a repository holding a file whose name ends in a newline now has that file
  refused. Deliberate, and stated rather than silent. The defect **forged the very audit trail** the
  design tells its reader to trust, which is why it earned a `.claude/REPO_TRAPS.md` class of its own
  alongside the option-injection one.

  **Five consecutive fixes each introduced the next pass's defect**, all inside the same six-line
  shell block: pass 3's armed an RCE (`node -e … "$1"` executing a `--require=` filename), pass 4's
  broke the failure report, pass 6's created an unsatisfiable instruction, pass 7's was the filing
  above, pass 8's produced a clobbered error message. That record is why the last three findings ship
  **stated rather than fixed** — a sixth edit was likelier to add a defect than remove one — and it is
  the argument both approvers accepted. They point at one decision rather than more edits: move the
  lifecycle out of agent-authored shell, which is OAI-74 with OAI-76.

  **The plan gate ran six rounds** (Codex `APPROVE` at the last, on the exact text handed over), and
  four of them found real defects: a shell-injectable prompt recipe, a status field read at the wrong
  index, an autonomous selector with no repository boundary (filed as **OAI-74**), and — the one that
  would have broken the feature outright — a poll loop that assumed shell state survives between Bash
  tool calls, so the captured job id would have been empty and `status ""` would have silently
  returned the job *list*. Codex also corrected a claim of mine: `README.md`'s "non-streaming" is still
  true for user-visible output even though the transport consumes SSE, because the reply is buffered
  until complete.

- **OAI-78** — A newline-terminated canonical path substituting a sibling file. **Resolved inside
  OAI-5, 2026-08-05, before that feature shipped**; commit `306ff75`. Moved here by the 2026-08-05
  sweep, which found it sitting in the live ordered list describing itself as resolved.
  It was filed mid-ladder as a low-severity reporting nit, on the stated grounds that containment was
  not escaped.
  **Those grounds were refuted by execution in the next pass**: the truncated path was one nobody had
  canonicalised, a planted sibling escaped the tree, and `/etc/passwd` was read while the audit trail
  named an in-tree file. It was fixed in the same feature (the canonicaliser now refuses a resolved
  path containing a control character), reproduced pre-fix and blocked post-fix. Kept here rather than
  deleted because this file's IDs are stable and global, and because the filing-then-refutation is the
  most instructive thing the ladder produced. Full account in the OAI-5 entry above.

- **OAI-58** — **The owed step 6 review ladder on OAI-3. Run and closed 2026-08-05**, by
  dual approval at the verdict point (Codex `APPROVE`; a verdict-only Claude approver `APPROVE`;
  combined with `check-plan-gate.sh --dual-approved`, exit 0). It was filed the same day OAI-3
  shipped, because an owed review that lives only in a session transcript is one that never
  happens. Original scope and reasoning below, followed by what the ladder found.
  The precedent for filing it as an item at all is the discharged `/code-review high` block, recorded
  in `evidence/backlog-header-history.md` since 2026-08-24 (moved out of `BACKLOG.md`'s header along
  with the rest of the retired "parked theme" section it sat in).
  **Scope:** `e74eb2c^..HEAD` — eight commits, 19 new modules, 44 new tests.
  **It triggers `lean-wide` on the repo's own terms, and not marginally:** the CLAUDE.md rule is that
  wide mode fires when a change introduces or alters a module carrying vendor or protocol assumptions,
  and this one introduces process-lifecycle *and* persistence assumptions — a detached worker, pid
  liveness, a database with two version axes, and a credential decision replayed in a second process
  minutes later.
  **The cost is the reason this is an item rather than a step someone squeezes in:** a full ladder
  here measured ~1.7M subagent tokens, which is one feature per session. The lever is `review-lean`
  in wide mode **once over the whole feature** rather than per phase — per-phase passes were
  deliberately not run for this reason, and each phase got a single `advisor` request instead as the
  tripwire (**every one of which failed to launch, overloaded** — so the mid-build tripwire produced
  nothing across all eight phases, and this pass is carrying more than it usually would).
  **OAI-52 item (1) is closed (2026-08-05)** — it was done first, deliberately, because an untested
  auth module is a finding the fan-out would certainly raise and paying five verifiers to repeat what
  is written down here is waste. `tests/job-auth.test.js` is therefore **inside this scope**, which
  stays `e74eb2c^..HEAD` and so extends to it automatically.
  **Full evidence, migrated 2026-08-24 from the live OAI-52 entry in `BACKLOG.md` to keep that item's
  still-open sub-items readable** (verbatim, no wording changed; one blank line added between the
  two original paragraphs for blockquote rendering):
  > `tests/job-auth.test.js`, 8 tests. Both sides: `authPolicyFor` records an origin and provably not
  > the key, and `resolveCredential` is exercised on each of its four refusal legs plus the happy path.
  > The wire assertion the plan asked for is there as a real submission and a real detached worker, with
  > the queue held open by a synthetic `running` row so `providers.json` can be repointed in the window
  > between them — the worker then fails `credential-unavailable` and **contacts the endpoint not at
  > all** after the edit, which is asserted against a request-count taken at that moment rather than
  > over the whole recording (submission's own probes legitimately carried the old key, in the
  > foreground, while it was still authorised). **It ships with a positive control in the same file** —
  > the identical fixture with the config left alone completes and carries `Bearer key-a` on the wire —
  > because without it a worker that died before ever reaching `resolveCredential` satisfies every
  > assertion in the negative test. Mutation-proved: neutering the third origin comparison to `false`
  > turns both the unit test and the wire test red and leaves the control green.
  >
  > **Why it was the sharpest of the six, kept because it is the reason for the ordering:** `authPolicyFor`
  > (submission) and `resolveCredential` (the worker) implement the rule that a key is sent only when
  > the current profile's origin, the persisted `authorizedOrigin` and the persisted transport's origin
  > **all three** agree — a rule adopted *because* the two-term version was found to be tautological in
  > the plan gate. The plan asked for "a profile that moved origin between submission and worker start
  > yields `credential-unavailable`, asserted on the wire". `tests/config.test.js:59-68` covers the
  > foreground analogue (`resolveProfile` does not carry a key to another origin), which is adjacent
  > evidence and not this: it exercises neither module, and the three-term check is exactly the part the
  > foreground path does not have.
  **Check `unadjudicated` before reading any verdict:** wide mode returns `findings: []` when its
  verifiers die on the cap, and that shape reads exactly like a clean pass.

  ### The ladder RAN, 2026-08-05 — one pass, seven stages, 29 ledger entries

  Frozen at `59662b3`, tree clean, baseline `npm test` 533 pass / 0 fail. Stages, in table order:
  `acceptance-audit` (scout, ~30 plan obligations enumerated); `advisor-opener` (**failed overloaded
  on first launch, completed on retry** — a died stage, not a coverage gap); `codex-adversarial`
  (`needs-attention`, 4 high); `codex-plain` (6 findings); `security-review`
  (**the packaged skill could not launch** — its preamble runs `git diff origin/HEAD...` and this repo
  has no remote, which is OAI-7; the lens was applied by two scoped substitute agents and is recorded
  as a substitute, never as the skill passing — logged to `ROUTING_LOG.md` because it blocks the
  security stage of every ladder in any remoteless repo); `lean-wide`; `advisor-closer`.

  **`lean-wide` completed CLEAN, and this was checked rather than assumed**: `unadjudicated: 0` across
  all three causes (`agentFailure`, `missingVerdict`, `setupFailure`), `findersReturned` 5/5, 12
  agents, 0 errors, 0 empty results, 9 candidates, 5 refuted, 1 duplicate collapsed. 961k subagent
  tokens. The `findings: []`-from-dead-verifiers shape did **not** occur.

  **The pass refuted one of its own findings, by execution.** A `null !== null` hole in
  `job-auth.mjs`'s origin comparison was raised by the orchestrator, and a security agent killed it by
  running it with a positive control in the same run: leg 2 is an interlock a null-ish value cannot
  satisfy, because `normalizeBaseUrl` guarantees an http(s) URL whose `.origin` is never null. The
  control sent a credential; every null variant reached the server zero times.

  **Two lenses contradicted each other on WAL file modes and both were right** — SQLite removes the
  WAL on a *clean* close, so the agent that measured after close saw nothing and the agent that
  measured in-flight and after SIGKILL saw a world-readable file holding the prompt. Recorded because
  a reader finding only the reassuring measurement would conclude OAI-65 was refuted.

  Findings are filed as **OAI-61 … OAI-73 in `BACKLOG.md`**, with amendments to OAI-52, OAI-55 and OAI-59.
  Executable probes — red-before fixtures whose controls are already proved to fire — are preserved at
  `~/.claude/projects/-Users-kieran-Code-openai-compat-plugin-cc/oai-58-probes/`, because they are most
  of the mutation proof the fixes owe and rewriting them is the expensive path.

  **No code fix was applied, and none is claimed.** This was the ladder's terminal pass, which by
  its own rule has no fix batch; every finding was dispositioned by FILING it, which the verdict
  bar explicitly permits ("every still-open entry is one the approver would ship — dismissed,
  filed, or out of scope"). The work itself is OAI-61 … OAI-73, ordered by impact.


- **OAI-3** — Background jobs: `--background`, plus `/oai:status`, `/oai:result`, `/oai:cancel`.
  **Completed 2026-08-05** as Stage 1 of `plans/local-llms-like-codex.md`. Plan:
  `plans/oai-3-async-jobs.md`; decision record: [ADR 014](adr/014-async-jobs.md).
  **The stage gate, in the plan's own words — "a job launched in one Claude session is retrievable
  from another, and editing source after submission does not change what the model saw" — is met, and
  both halves cross a real process boundary rather than being asserted.** Half 1 is
  `tests/status.test.js` "a job submitted by one process is retrievable by another, from a different
  directory": two separate `runCompanion` invocations, the second from a different cwd. Half 2 is
  `tests/background.test.js` "what the model sees is frozen at submission, not read when the worker
  runs", which uses a **barrier that already existed in the code** rather than a scheduling race —
  attachments are read before `resolveTarget` probes `/v1/models`, so the fake `/models` handler
  mutates the file before replying and the eventual chat completion is asserted to carry the original
  bytes. Mutation-checked: making the worker re-read attachments from disk turns that test red.
  **The item as filed said to port the reference plugin's job model and "replace its RPC interrupt
  with an `AbortController`". Both were rejected on evidence, and the reversals are the substance of
  the work.** The reference plugin (`codex` 1.0.6) kills its background jobs on `SessionEnd`, so
  porting it would have failed the gate outright. And no `AbortController` exists here: the worker's
  heartbeat calls `process.exit()`, because setting `process.exitCode` leaves the open socket and the
  heartbeat timer holding the loop and the request simply continues.
  **Two prohibitions in the parent plan were reversed at the user's direction, and each turned out to
  be the simplifying choice** (both now amended in `plans/local-llms-like-codex.md` rather than left
  contradicting the code): jobs **queue** rather than being refused, which removes the need for mutual
  exclusion at submission entirely; and **SQLite** (`node:sqlite`, zero dependencies) is the store,
  after fourteen review rounds spent building atomic publication, a never-reused queue position and
  terminal immutability out of `wx` files — where every round's fix produced the next round's defect.
  The whole concurrency design is now one `BEGIN IMMEDIATE` transaction.
  Nineteen plan-gate rounds, ~74 findings, all accepted, closing on Codex `APPROVE`. What the gate
  bought, beyond the protocol: a cancel that would have sent `SIGTERM` to a pid the plan itself
  admitted might be recycled; a credential check comparing two values both derived from submission,
  and so tautological; a `--base-url` query string silently persisting an API key while the plan
  claimed credentials were never stored; **two tests that could not fail**; and `--max-wait` capping
  nothing because two rules contradicted each other.
  **Shipped state:** 8 phases; **525 tests green**, 44 of them added by this feature. 19 new modules
  under `scripts/` (2,150 insertions), 10 new files under `tests/` (1,410), and 3 new command
  markdowns. One real end-to-end run against LM Studio, plus a seeded-history run through the real
  CLI for retention.
  **What did NOT land, stated rather than implied by silence: six items from the plan's own
  verification list — see OAI-52**, which is filed above precisely so this entry cannot read as
  complete coverage.

- **OAI-51** — **The review schema crashed the model backend, and the crash was ours.**
  **Completed 2026-08-04** as **Stage 0** of `plans/local-llms-like-codex.md`; commits `db46d1f`
  (stop sending a grammar), `5675da5` (answer first) and `a23fdde` (the whole-tree confirmation).
  **Verified against disk by the 2026-08-05 backlog sweep** rather than taken from the commit
  messages, because the live backlog header was still calling this the one open item:
  `cmd-review.mjs:113` gates the schema behind `--structured-output`, and `commands/review.md:27`
  documents that default as deliberate.
  **Both halves of the Stage 0 gate hold, and the second is test-pinned.** The first — repeated long
  generation does not crash the backend — is the measurement below. The second — a parse failure must
  never render as "no findings" — is `review-report.mjs:140` (`findings: parsed?.findings ?? null`,
  never `[]`), asserted at `tests/review-json.test.js:83` ("null, not [] — an empty list is a clean
  review"), with the rendered path printing the reply verbatim at `review-report.mjs:69`.
  **One deviation from the plan's wording, recorded rather than glossed.** The plan asked for
  `parsed: complete | partial | failed`. What shipped is a boolean plus a `dropped` count
  (`structured.mjs:278-281`, `review-report.mjs:139`): per-record loose parsing **is** built — one
  malformed finding no longer destroys the array — but the tri-state enum does not exist. Functionally
  the gate is met; the plan's literal shape is not, and a reader comparing the two should know which.
  **Residue that did NOT come with it:** `parseFindings` still picks one channel and never falls back,
  and a bare top-level findings *array* is still discarded. Both were OAI-13 sub-items filed as
  vendor-dependent; the default path now runs the same parser, so they stopped being vendor questions
  and are **OAI-84**, live.

  The filing account, kept whole because every paragraph in it is a dated measurement:

  **Filed 2026-08-04.** **The review schema crashes the model backend. This is the cause of the "server
  drops", and it is ours, not LM Studio's.** Filed 2026-08-04, from the LM Studio server log — which
  has existed at `~/.lmstudio/server-logs/` throughout, was never read, and names the failure
  outright. **This supersedes the framing of OAI-20, OAI-24 and OAI-34**, all three of which
  characterised these failures from the client side as properties of an unreliable server.
  The mechanism, quoted from the log rather than inferred:
  `ValueError: LLGuidance matcher error: lexer error: too many states: 250000 >= 250000`, with
  `Stop: LexerTooComplex`, raised inside the grammar LLGuidance builds from the `response_format`
  JSON schema this repo sends (ADR 003). It propagates as a *fatal exception in the backend
  generation thread*, and the model process then dies with `Fatal Python error: Segmentation fault`
  → `The model has crashed`. LM Studio reloads it about 12 seconds later, **which is exactly why
  retry sometimes works** — the retry meets a freshly loaded model.
  It fires at **~14k constrained tokens**: five instances on 2026-08-04 at 13,956–14,744 tokens and
  43,389–50,497 bytes, tightly clustered and independent of whether `maxLength` was 65,499 or 74,000.
  So the trigger is **how long the model generates inside the grammar**, not the cap itself. This
  repo already wrote the number down and could not explain it — CLAUDE.md's footgun says "a stream
  drop **~50k chars** into reasoning".
  **The 2026-07-30 session that produced the 27/72 figure has the same signature**: 53
  `LexerTooComplex` events and 8 crashes, against zero on 07-28 (81 completions) and zero on 07-29
  (28 completions). And `empty-completion` and `stream-unfinished` are not two failure modes but
  **one event observed on either side of first token**, which is why OAI-20's split on "was a prefill
  measured" partitioned them 13/4 exactly.
  **Why local coding never sees it, which is the observation that prompted the search:** `/oai:task`
  sends no `response_format`, so no grammar is built and no lexer state accumulates. Only
  `/oai:review`'s structured output does. The failure is not a property of these models or of this
  server; it is a property of asking for long-form generation inside a constrained grammar.
  Options, and this is a design decision rather than a fix: **(a)** take `analysis` out of the schema
  entirely and let the model reason unconstrained, parsing only `findings` — the reasoning is already
  arriving in `reasoning_content` under a grammar that stops the model closing its think block, which
  is the same problem seen from the other end; **(b)** cap `analysis` far below the ~14k-token
  threshold, which reintroduces the censorship OAI-15 was raised to remove and makes ADR 008's
  sizing argument moot; **(c)** drop the schema for large targets and use ADR 003's prompt-and-parse
  fallback, which touches no grammar at all. **(a) and (c) are the ones that address the mechanism**;
  (b) trades one known defect for another.
  **Stage 0 landed 2026-08-04, and running it produced two results — one banking the gate, one new.**

  **Gate 1 PASSED, measured not argued.** An unconstrained review generated **59,918 characters of
  reasoning over 340s** — past the 43,389-50,497 byte band in which every grammar-constrained run
  segfaulted — and the backend did not crash. The server log is the proof: it stood at 43
  `LexerTooComplex` events and 5 crashes before that run and at **exactly 43 and 5 after it**. The
  claim "unconstrained is safe" was untested when Stage 0 was planned, and this is the test.

  **New result: removing the grammar removed a second thing nobody had accounted for.** That run
  produced NO findings — it spent its whole token budget reasoning and died at `finish_reason:
  length`. The schema's `maxLength` on `analysis` was doing **double duty**: bounding the reply, and
  forcing the model to stop reasoning and move on to `findings`. The system prompt still says *'Use
  the "analysis" field first ... Only then fill in findings'*, and the schema ordered
  `analysis -> findings -> summary`, so with nothing enforcing the bound the model reasons until the
  budget dies and never reaches the answer. Under a grammar that ordering was safe by construction;
  unconstrained it is a guarantee of silence on any target big enough to think about.
  The fix is to invert it — findings first, analysis after — so a budget-exhausted reply still
  carries what it found. Cheap, and only discoverable by running the thing.

  **The ordering fix landed and was measured, 2026-08-04.** Same file, same model, same flags:
  before it, `scripts/lib/throughput.mjs` drew 38,956 characters of `analysis` and was still climbing
  when killed at 160s; after, the run finished in 135s with `finish_reason: stop` and a finding.
  Reasoning volume barely moved (33,217 chars, 10,221 reasoning tokens) — the model still thinks just
  as hard, it now **stops and answers**. The instruction is conditional, not global: `analysis` stays
  first under a grammar, where the measured evidence for that ordering was gathered and still holds,
  and `findingsFirst()` reorders the schema the prose instruction is rendered from so the two cannot
  drift. **Attribution caveat, stated rather than glossed:** the small-file baseline was *killed*, not
  run to failure, so it alone does not establish the fix — the case that definitively failed was the
  whole-tree target (`finish_reason: length`, no findings, 59,918 chars), and that is the comparison
  worth quoting.

  **That comparison has now been run, and it confirms the fix.** Whole working tree, same model,
  49,378 prompt tokens: it completed with `finish_reason: stop` where the pre-fix run died at
  `length`, having reached its answering phase after 54,127 characters of reasoning. `degraded: false`
  and `retried: false` held on a 49k-token request too.
  **It returned 0 findings, and that is a recall observation rather than a Stage 0 failure** —
  `parsed: true` with content emitted is a genuine "found nothing", not a guillotine. Set beside the
  1,680-token single-file run, which produced a specific checkable finding, it is also the first
  direct measurement of the workload envelope the plan asserts: a ~49k-token target is on the reject
  list, and this is why.

  **A defect the flip introduced, caught in review and worth recording as a class.** `runTimings`
  derived both `retried` and `degraded` from `!structured`, which meant "we fell back" only while a
  schema was *always* requested. With the default flipped, every ordinary run would have reported
  `retried: true` for a single-request run and `degraded: true` for a schema nobody asked for — into
  the very record OAI-19 reads reliability from. `degraded` now needs both facts (asked for, not
  obtained) and `retried` needs neither, deriving from the request count alone. This is CLAUDE.md's
  "when a field's *meaning* changes, grep the aggregates and derived variables" rule, and the field
  that broke is the one whose own docstring warns about this exact inversion.

  **First real finding off the new path was a false positive, and that is the system working.** It
  claimed an explicit `null` `completion_tokens` bypasses validation at `throughput.mjs:37`.
  `Number.isFinite(null)` is `false`, so it does not; the model confused it with the global
  `isFinite`, which coerces. Refuting it cost under a minute against the code, which is the whole
  premise of `commands/review.md` — leads, not conclusions.

  **Note against OAI-15 and ADR 008:** raising the reply ceiling *permits* longer constrained
  generation, so it moves runs toward this threshold rather than away from it. Whether OAI-15 caused
  the crashes is NOT established here — the derived cap landed 2026-07-28 (`b66a3d5`) and 07-28/07-29
  are clean, so a corpus-size or backend difference is unexcluded — and it must not be asserted
  without checking. What is established is the mechanism, its threshold, and its presence in the
  sessions whose numbers this backlog quotes.

- **OAI-34** — Build the TTL challenge instrument, then run it. **Completed 2026-08-04, and the
  answer is negative: the DETERMINISTIC form of the JIT-TTL hypothesis is REFUTED.** A cold request
  stayed in prefill for 336s under a TTL deliberately shortened to 120s, three times out of three,
  with the model continuously resident throughout.
  **Provenance, because the done-condition asks for it rather than a timestamp:** instrument at
  `0c566b6` (the last commit touching any `ttl-*` module), run from `518db21` with a clean tree,
  record at `bench/results/ttl-challenge-2026-08-04T18-35-03-245Z.json` —
  `protocol.canonical: true`, `startedAt 2026-08-04T18:04:02Z`, 67 minutes after the instrument
  commit.
  Accepted verdicts: `deterministic-form-refuted`, `inconclusive-failure`. Obtained:
  `deterministic-form-refuted`, exit 0.
  **The numbers are quoted here, not just the path, because `bench/results/` is gitignored.** The
  record exists on one machine. `BACKLOG.md`'s own opening paragraph names what that costs — "ADR
  004 says four runs, `890ee2e` says five, same experiment, neither now checkable" — so the evidence
  is transcribed into the tracker where it survives the file:
  - **Prefill, the controlled quantity: 336.7s / 336.3s / 336.5s** across the three episodes —
    identical to within 0.4s — against a calibration prefill of 338.0s at the long 4h TTL.
    (`durationMs` was 389s / 580s / 407s; that spread is generation length and says nothing about
    the mechanism. Quote prefill.)
  - **The episodes were genuinely independent trials, and the record proves it rather than assuming
    it.** All four runs sent an identical prompt (`promptChars: 172431`) and their prefills sit
    within **1.64s** of each other, `warmEligible: false` throughout. [ADR
    009](adr/009-measuring-prefill-and-generation.md) is the reason this matters: a server-side
    prompt cache moves prefill by *tens of times* — 421.7s cold against 11.5s warm on a comparable
    request — so a cache hit would have read ~10s, not 336s. The `unload` → `load` cycle between
    episodes therefore defeated the cache. **This is load-bearing for the headline**: the ~63% bound
    assumes three independent trials, and cache-correlated episodes would have inflated N and
    understated the bound. It strengthens the refutation rather than qualifying it.
  - **`exposureRatio` 2.80× in every episode**, `slackMs` 216.7s / 216.3s / 216.5s. The refutation
    rests on `c < prefillMs - ttlMs`, so the narrowest slack — 216s — is the condition, and it is
    the figure the verdict sentence quotes.
  - **`appliedTtlMs: 120000` read back from the server in every in-flight sample**, not inferred
    from `lms load` exiting 0. The shortened treatment was in force for the whole run.
  - **Continuous residency**: 194 / 289 / 203 in-flight samples, `unreadableSamples: 0`, maximum
    sample gap 2.15s against a 2s interval, `targetResidentAtStart: true`, and the model absent from
    **none** of them. `unloadAt: null` in all three — no absence was ever observed, so nothing had
    to be recorded-and-not-attributed.
  - **All four validity checks passed in every episode**: `validityFailures: []`,
    `competingModels: []` (G2), `obtainedResponse: true` (G5), applied TTL matching requested (G6),
    `contradiction: null` (G8).
  - Verdict sentence, verbatim: *"3 cold request(s) remained in prefill well past a deliberately
    shortened TTL without unloading or failing, refuting the DETERMINISTIC form of the mechanism. It
    does not show the failure rate is low: the one-sided 95% upper bound on 0 events in 3 is ~63%.
    The narrowest episode cleared expiry by 216s, and this holds provided request serialization and
    server admission took less than that."*
  **What this does NOT establish, stated at the same volume as what it does.** It is the dense
  `qwen/qwen3.6-27b` only, one case (`scaffold`), one TTL (120s), N=3 — and the outcome sentence's
  own ~63% bound is the instrument saying so. The 27/72 drop rate was observed on **both** models,
  so the MoE half is untouched by this. And **the cause of those drops remains unresolved**: this
  refutes one hypothesis about them, it does not explain them. Under no outcome may a write-up name
  JIT-TTL as the mechanism — the instrument refutes and cannot confirm, which is the design change
  the plan gate forced.
  **One observation about the evidence base, recorded and attributed to nothing.**
  `activityObserved` is `null` in all three episodes — not because the sampler failed, but because
  **LM Studio reports `lastUsedTime: null` for the whole time it is serving a request** (`status`
  was `processingPrompt` for 168 consecutive samples per episode, then `generating`). ADR 013
  nominated `lastUsedTime` as the activity evidence to record-but-never-branch-on; the run shows the
  field is simply not populated while a request is in flight. That is a fact about what the server
  exposes. It is **not** evidence about what its timer does, and it must not be read as any.
  It also sharpens **OAI-45**(2): the stub's `lastUsedAdvances` knob models a state the real server
  never produces during flight, which is a stronger reason to reconsider it than "unused affordance".
  **Discharged here rather than carried:** OAI-34's warning that the terminal review batch was
  itself unreviewed. That batch's only code was `bench/lib/ttl-calibration.mjs`; it was reviewed on
  2026-08-04 before this run was written up, and the entailment rule reads correctly — `no-response`
  returns alone, `request-failed` and `no-prefill-measured` remain independent, and `prefill-short`
  sits in the `else` so an unmeasured prefill is never also called short. **One reviewer, not a
  ladder pass.** Note also that `calibrationSays` never executed in this run because the calibration
  cleared; it is exercised by the e2e harness's short-calibration scenario, not by anything in
  anger.
  **Known gap, carried forward unchanged:** the withdrawn draft's ten pass-2 findings are still only
  eight recovered. The two that were never written down anywhere have **not** been recovered — the
  e2e harness was the recovery mechanism and it surfaced defects in its own scenarios instead. Say
  that rather than letting a green run stand in for it.
  **The tracker guard moved with this entry.** `tests/ttl-vocabulary.test.js` parses the
  `Accepted verdicts:` line and compares it set-wise against the `CONCLUSIVE` list the driver's exit
  code imports; it was anchored to `- **OAI-34**` in `BACKLOG.md` and now reads this file. It fails
  closed on a missing anchor, so relocating the entry turned it red rather than passing vacuously —
  which is how it was noticed. **OAI-46 is still open and its subject is this guard**: it pins this
  one line and nothing else in the entry.

- **OAI-32** — Stop `review-lean`'s verifiers mutating the LIVE working tree. **Completed
  2026-08-04.** The fix is in `~/Code/dotfiles` as its backlog item 55, commits `d07ea90` and
  `cf23052`, with the decision recorded in dotfiles `adr/012-isolating-review-verifiers.md` — this
  repo is where it bit and where it was tracked, not where it lives.
  **The item's own premise was refuted before it was built, and that shaped the answer.** It said
  `isolation: "worktree"` was "the only remaining real control". Measured on Claude Code 2.1.221: a
  worktree is a **clean checkout of the default branch**, carrying none of the uncommitted change
  under review — so the flag *alone* would have made every verifier adjudicate the wrong code while
  sounding exactly as confident, trading a visible corruption for a silent wrong verdict. Verifiers
  are now isolated **and seeded**, and the seed is proven before any verdict counts; a batch that
  cannot prove its copy returns no verdicts at all and never falls back to the shared tree.
  Two traps came out of it, both now in dotfiles `.claude/REPO_TRAPS.md` and both guarded:
  `--exclude='/.git/'` **deletes** a worktree's `.git` (it is a FILE; a trailing slash matches
  directories only), after which git resolves upward and later writes land in the main repo while the
  copy still looks isolated; and a content digest built with `[ -f ]` **follows symlinks**, so this
  repo's one relative symlink hashed at the source and dangled in the copy — which is what failed the
  first live mechanism run, after review had passed the code.
  The reporting half also landed: a run whose verifiers all died returned `findings: []` beside
  `unadjudicated: N` and read as clean. An incomplete run now **omits `findings` entirely** and leads
  with `error`, gated on every candidate adjudicated, every finder returned, **and** setup having
  succeeded — the last clause because with zero candidates the other two hold vacuously.
  **Standing practice this retires:** the manual `rsync -a` snapshot before every wide run was the
  only thing making the corruption visible. Keep taking one until a `--wide` run has actually
  exercised the new path — see the caveat below.
  **Not proven end to end.** The seed protocol was validated by running the real emitted script in a
  real isolated worktree (exit 0; modified, untracked, staged-add and staged-rename artifacts all
  present; suite 425/425; edits contained), but **no full `--wide` run has used it**, because the seed
  resolves the *session's* repo and this feature was built from a session rooted here rather than in
  dotfiles. Filed there as items 81 (the same one-character `.git` defect in `/feature`'s own restore)
  and 82 (a scope-time snapshot, stronger but needing a lifecycle), plus 83-86 from the review that
  closed it — of which **83 is the one to read**: it is the ledger of what this feature was *not*
  checked by, and it is what the caveat above resolves to. *(Those two were filed as 56/57 and
  renumbered the same day: dotfiles never reuses an ID, and 56/57 were already absorbed.)*

- **OAI-35** — Carry `serverResponded` onto the attempt entry. Completed 2026-08-03, **with OAI-37
  absorbed into it** (see below). The field means *an HTTP response was obtained* — headers arrived —
  and rides on every entry: `settle` and `pendUntilReplaced` write `true` from the outcome itself,
  since an answered request and a refused shape both required a response, while only `fail` weighs
  evidence, from several independent witnesses (the transport's flag, an HTTP status code, a
  completion shape, or a measured prefill). Named rather than counted, because the count drifted the
  moment a fourth was added — see below. Several because one is a single point of forgetting:
  `provider.mjs` pairs the flag with
  `.status` today, but a post-response path added later that omits it would silently record a server
  that answered as one that never did. Proved live as well as on the fake server — a real LM Studio
  run wrote `{outcome: 'answered', serverResponded: true, prefillMs: 4094}`.
  **Three of the item's own claims were wrong, and the third is the one worth remembering.**
  (1) It cited ADR 012 for the phrase "does not establish whether a peer was reached"; that phrase is
  in ADR 013, quoting it. (2) It predicted the enumeration tripwire would fire "the moment `fail()`
  copies a tenth field" — `tests/bench-reason-notes.test.js` was already passing `serverResponded`
  into `fail()`, so the tripwire was pre-armed and fired on the `RECORD_FIELDS` edit instead.
  (3) **It framed the field as settling whether a *peer was reached*, and it does not.** `ENOTFOUND`
  contacted nothing, `ECONNREFUSED` reached a host that answered with a reset, and a TLS rejection
  reached a peer outright — all three obtained no response and all three record `false`. So the
  reachability limitation is *not* removed, ADR 012's rejection of the name `unreachable` stands, and
  the `non-retryable-transport` paragraph keeps its hedge instead of losing it. Caught at the plan
  gate's **blind** re-ask after two thread-carrying rounds had passed it, and recorded as instance 8
  in `.claude/REPO_TRAPS.md` — the first instance of that class found in a tracker item rather than in
  code, which is the more dangerous site because nothing executes it.
  Also landed: the reliability report splits failures on the new field with **three** buckets, the
  third for records written before it existed, because folding those into `false` would turn missing
  instrumentation into an observation that nothing answered. `reasonNotes`, `RECORD_FIELDS` and
  `recordList` moved to `bench/lib/reason-notes.mjs` — the split the old file's own comment
  prescribed for whoever added the tenth field, rather than raising the 300-line ratchet.
  **The review's second pass found eleven defects, and five of them were the first pass's own fixes
  being unproved or overclaimed rather than anything new in the feature.** The instructive one: a test
  written to guard the three sites that mint the flag built its own error with
  `serverResponded: true` already on it, so it proved only that `fail()` copies a flag — while its
  comment said dropping the write at `sse.mjs`, `body.mjs` or `http.mjs` would go red. A verifier
  deleted the write in `body.mjs` and ran the suite: all green. The sites are now driven end to end
  through a fake server in `tests/attempt-response-sites.test.js`, and both deletions redden exactly
  their own case. That is also why `obtainedResponse` has a fourth witness: a measured `prefillMs`
  proves headers arrived without depending on any site *remembering* to set a flag, which is the
  failure that turned out to be real rather than theoretical.
  **A third pass then found that fix had broken the test it shipped beside, and the ladder stopped
  there because it had started finding its own tail.** The new end-to-end case delivered model text
  before cutting the socket, so the fourth witness measured a prefill and reconstructed `true` — the
  case passed with the flag write deleted, which is the same vacuous-guard class arriving by the
  opposite route. A debug stack showed it never reached the site it was named for either: a destroyed
  socket throws from the iterator, so `http.mjs`'s `!response.complete` branch cannot see it. The
  fixture now sends a **role-only delta** — bytes without text, so the catch runs with `delivered`
  while no prefill is stamped — and each of the three covered sites reddens on deletion of its own
  write, all three verified by mutation. The two sites nothing reaches are named as uncovered rather
  than implied to be guarded. Pass 3 also caught the witness count going stale in three documents at
  once, one of which contradicted itself thirty lines later; the count is gone and the witnesses are
  enumerated, because a number kept away from the list it describes had by then drifted three times.
  Both tightened guards (`Number.isInteger(status) && >= 100`, `Number.isFinite(prefillMs) && >= 0`)
  are mutation-proved, and `prefillMs: 0` is asserted to survive them — a first text inside the
  timer's resolution is a measurement, not junk.
  **Three** invariants with no independent derivation behind them were mutation-proved, and the count
  is three because the review found the first pass had claimed two: reverting `pendUntilReplaced` to a
  derived value reddens the refusal test, loosening the three-bucket `=== false` to `!== true` reddens
  the legacy-record test, and — the one that was missing — deleting the `RESPONSE_BUCKETS` seed left
  the **whole suite green**, so the fix that made a zero row print had nothing behind it at all. Its
  guard is now a test where exactly one bucket is populated, since the existing ones filled all three
  organically and could not see the seed disappear.

- **OAI-37** — `ECONNREFUSED` cited as an example of never reaching a peer. Completed 2026-08-03,
  **absorbed into OAI-35**, which had to rewrite the very paragraph the clause sits in. Leaving it
  open would have left a tracked item pointing at prose that no longer existed. The sentence now puts
  `ECONNREFUSED` with the codes that *did* reach something — its reset is the host itself answering —
  and `ENOTFOUND` alone on the side that contacted nothing. The item's instruction not to reword the
  surrounding inherited prose was kept for **two of the three** clauses it named: the hedge and the
  warm-eligibility caveat are byte-unchanged, and `tests/bench-reason-notes.test.js` pins each. The
  **asymmetry clause was not** — it gained `**on that axis**` and two sentences pointing at the new
  response table, which is unavoidable once a table answers the narrower question the clause says
  cannot be answered. An earlier version of this entry claimed all three were untouched: a property of
  two members asserted of the set, written into the very entry documenting that trap class. Caught in
  review by diffing the rendered paragraph against `git show HEAD`.

- **OAI-31** — Five findings OAI-26's pass 3 raised and its own rules would not let it fix, plus a
  sixth noticed while filing. Completed 2026-08-03. **All six were verified before any code was
  written** — three by Codex reading the cited code, three by mutation against the live tree — and
  the mutations are the interesting half, because each proved a guard hollow rather than merely
  suspicious: replacing **both** fixtures of the two-fixture pair with identical junk left the suite
  green; gutting the `shape-rejected` paragraph left its assertion green, matching the count-table
  row; and `key === code` → `key.includes(code)` left **all 404 tests green** while making a
  `non-retryable-transport`-only sweep print "a further attempt could plausibly survive" about a
  code that by definition was never retried.
  **The two false rendered sentences are fixed, and the second one twice.** "The reason code is all
  an attempt record carries" was false — the entry also holds `index`, `cause`, `promptChars`,
  `warmEligible`, `waitedMs`, `outcome` and both timings. Its first replacement, "the attempt record
  has no peer-reachability field", *read* as the narrow specific form and was not: it quantifies
  over the meaning of every field that might ever be added, so it can go false via a field named
  anything at all. A **blind** re-ask of the plan gate caught that; the thread-carrying round before
  it did not. **The rule that came out of it — do not assert what a record LACKS, enumerate what it
  HOLDS** — is now the governing comment in `reasonNotes`, recorded as instance 7 in
  `.claude/REPO_TRAPS.md`, and pinned: the paragraph names its nine fields and the test pins the
  whole key set, coupling it to every ledger addition **on purpose**. Proved by simulating OAI-35's
  `serverResponded` copy inside `fail()` and watching it go red.
  Separately, "a replacement request … **was dispatched**" and its closing "a replacement was
  **sent**" both claimed a wire write that is not established — `refused` is written at
  `ledger.begin`, several frames before a socket, with body serialization and URL validation still
  able to throw. Both now claim an *initiated* replacement, and the ordering sentence was folded
  rather than deleted because it carries a distinct invariant.
  **`tests/bench-reliability.test.js` was split rather than the ratchet raised.** The repairs took
  it from 270 to 320 against a 300 ceiling; it is now the attempt-**accounting** suite plus a new
  `tests/bench-reason-notes.test.js` carrying the reason-code **prose**, both comfortably under that
  ceiling — line counts deliberately not quoted here, because the first draft of this entry quoted
  one that was stale within the hour. With the one shared fixture
  moved into `tests/bench-report-fixtures.mjs` — which exists because another suite was split the
  same way for the same reason. **Plan-gate history worth keeping:** round 1 approved and its
  prediction that the edits would fit under the ratchet was wrong; round 2 caught a stale
  cross-reference the split created; the blind round 3 caught the prose/test mismatch above. Plan in
  `plans/oai-31-guards-that-bite.md`.

- **OAI-24** — Record what the SERVER was doing. Completed 2026-08-03 **as a decision, not an
  instrument** — the driver it produced was withdrawn from its own commit and is now OAI-34's to
  finish. **The item asked which of three options to take and the answer was none of them** — and
  then none of the design that replaced them either, which is the part worth keeping.
  **What shipped:** the decision and its rationale (ADR 013), ADR 012's false "not observable from
  the client" corrected, the unprovenanced "~10 minute TTL" corrected wherever it appeared, a reader
  for evidence already recorded (`byFirstText`), and a new `.claude/REPO_TRAPS.md` class. **What did
  not:** `bench/ttl-challenge.mjs` and `bench/lib/ttl-verdict.mjs`, stashed rather than committed
  (`git stash pop`, or `873dc05`) with ten open findings and a production-code prerequisite, OAI-35.
  **All three filed options were refuted, not merely declined.** Sampling residency around a run
  (options b and d) suffers temporal aliasing: a bracket spanning several attempts and many minutes
  cannot tell "loaded throughout" from "unloaded then silently JIT-reloaded". A per-attempt plugin
  probe (option c) has the resolution but may reset the very timer it measures, costs 2s on a path
  where `--max-seconds` already binds, and leaks a vendor dialect out of `model-info.mjs`. Their
  replacement — a matched TTL crossover over the corpus — died too: TTL is assigned per *block*, so
  the independent n is blocks not requests, and at 3 per arm the best two-sided p is 0.25. Reaching
  9–12 pairs costs 3–4h on the MoE, which is the **wrong model** (prefill ~5× faster, never
  approaches the TTL), and 9–12h on the dense.
  **The premise turned out weaker than the file claimed, which is what made the cheap design
  possible.** Measured dense prefills — `scaffold` 335s, `model-info` 286s, `structured` 191s — all
  sit *below* the ~600s the hypothesis assumed, and the "~10 minute idle TTL" had **no provenance
  anywhere in the repo** (LM Studio documents a resetting timer, 60-minute JIT default). So:
  falsify rather than estimate: shorten the TTL to 120s against a 335s prefill — the most favourable
  condition the mechanism could get — where three survivals refute its deterministic form in ~45
  minutes. Specified in ADR 013; **building and running it is OAI-34**.
  **Reading a real `lms ps --json` corrected the design twice.** It reports `ttlMs`, so the applied
  treatment is confirmed from the server rather than assumed from an exit code — a draft comment had
  asserted the opposite. And it reports `lastUsedTime`, the idle timer's own anchor, which is a far
  more direct instrument than waiting for an unload: whether it advances during a long prefill is the
  hypothesis in the server's own terms. Recorded, deliberately not acted on.
  **The driver's worst defect was demonstrated by accident.** `main()` sat at module scope, so
  importing it for its unit tests *ran the experiment* — against a server that was down, adding 44s
  to the suite and writing a junk record. An earlier draft then rendered `inconclusive-failure`, a
  verdict about the mechanism, from a run in which no request ever reached the wire. In the draft this
  became an `instrument-failed` outcome that refuses to describe the server at all, plus a test
  pinning the entry-point guard — the symptom is slow and quiet rather than red.
  **Review pass 1 found eight more of the same shape, and that is the finding.** Three lenses —
  `advisor`, both Codex stages, and a wide `review-lean` — converged on one class: **a guard that
  narrates instead of refusing.** `calibrate` printed `ABORT` and continued; a *failed* calibration's
  1,800s timeout read as a 1,800s prefill; the verdict used the TTL that was *requested* rather than
  the one `lms ps` confirmed; a survival stood even when residency showed an unload; the post-exit
  sample counted as evidence of a mid-request unload; `activityObserved` measured across generation
  while claiming to measure prefill; and `summarize`'s fallback said "No episode stayed in flight
  past expiry" for sweeps in which one did. Every one would have let the experiment answer
  confidently from a run that tested nothing — the exact failure OAI-24 exists to prevent, inside
  OAI-24's own instrument. All fixed **in the stashed draft**, each with a test that fails without
  the fix; none of it is committed.
  **Scope, stated precisely because the batch is about overclaiming.** The wide verifiers corrected
  one of these downward: a short calibration could *not* fabricate `deterministic-form-refuted`,
  because `episodeVerdict` applies the same margin per episode, so an under-exposed sweep lands on
  the honest `no-exposure` branch. The confirmed harm was the false `ABORT` string, a zero exit code,
  no machine-readable disqualification in the record, and ~45 minutes spent on a run the gate had
  already rejected.
  **Then pass 2 found ten more — one of them introduced by pass 1's own batch — and the driver was
  withdrawn.** Two let it issue `mechanism-reproduced` from evidence that did not support it (an
  unload during *generation*; an unload past `ttlMs` in an episode that was never an exposure), and
  one disabled two of pass 1's fixes on the failure path, because `runEpisode` read a top-level
  `prefillMs` the failure envelope does not carry. The decisive one was not in the driver at all:
  **the attempt record drops `serverResponded`**, so a mid-prefill eviction before first token is
  indistinguishable from a connection that reached no peer — the instrument is blind to its own
  target event, and fixing that is production code OAI-24's plan forbade — filed as **OAI-35**, which
  **OAI-34** is blocked on. Every finding is written down there; the criterion for withdrawal was
  fixed *before* the last pass ran, so it was not chosen against the defect that turned up.
  **The lesson worth keeping**: eight defects in pass 1, ten in pass 2, in logic that had never
  executed against a real server. Review found every one of them and review was not converging —
  which is an argument for running the thing against a stub early, not for reviewing harder.
  **Also shipped: the reader for evidence already recorded.** `attempt-outcome.mjs` had been keeping
  timings on *failed* attempts so the record could say "whether failures cluster before or after the
  first token" — its own words — and nothing read them. `bench/lib/attempt-rows.mjs` now splits
  failures on whether a prefill was measured, with the claim bounded to what that proves: the attempt
  crossed the first-text boundary, not why a later stream died, and absence is not evidence of a
  cause. Near-empty until OAI-19 runs; the whole corpus holds one failed attempt.
  **No production plugin code changed.** Corrected `adr/012:230`'s false "not observable from the
  client". Partially discharged OAI-31 item (1). See
  [ADR 013](adr/013-observing-the-server.md).

- **OAI-26** — Explain `shape-rejected` and `non-retryable-transport` in the reliability report,
  where they appeared bare. Completed 2026-08-02. Prose only, as filed: no schema change and no
  change to counting — `byReason` already tallies every failed attempt's reason, so both codes were
  in the table and only the explanation was missing. What shipped is three gated paragraphs in
  `bench/lib/reliability-report.mjs`, each on its OWN code, plus the tightened `refused` paragraph
  the item asked for.
  **~~"Point the reader at `.code`"~~ — struck, refuted three times over.** The item instructed the
  paragraph to send the reader to `.code`; the plan gate refuted it (the attempt record has no such
  field), the replacement "the code is not carried in this report" was refuted by the pass-1 wide
  review (`report.mjs` prints a dead run's whole stderr, and a Node syscall message embeds the code),
  and the third try, "the listing usually names the underlying code", was refuted decisively in
  pass 2 — a TLS rejection's message is the words "certificate has expired" and contains no
  `CERT_HAS_EXPIRED`, so it was false for exactly the examples the paragraph itself cites. The
  shipped paragraph therefore says nothing about where a cause can be found.
  **~~"It must not be called a reachability finding"~~ — also struck, and this one came from the
  item itself.** `ENOTFOUND` and `ECONNREFUSED` are deliberate exclusions from
  `TRANSIENT_CONNECT_CODES`, so they carry `non-retryable-transport` and reached no peer at all. The
  instruction was true of the three examples it named and false of the class. The shipped text says
  the code records a retry decision and does not establish whether a peer was reached, naming both
  directions.
  **The review cost more than the change and earned it.** Three passes; the two defects nothing else
  caught both came from wide mode, which is why the trigger was pulled on a prose-only change. The
  recurring defect — prose asserting a property of a whole class from examples covering one
  sub-population — is now a `.claude/REPO_TRAPS.md` class with **six** confirmed instances, three of
  which landed *after* the entry documenting it was written. Pass 3's five open findings are carried
  by **OAI-31**, which is the honest cost of the no-mutation rule rather than a clean finish.

- **OAI-25** — Make the `postWithDegrade` cap-ordering invariants reachable behaviourally, instead of
  only structurally. Completed 2026-08-01. **The item's own premise was half-refuted by the probe,
  which is the part worth keeping.** OAI-25 asked whether anything was left to buy and suggested not:
  "the already-expired case is behaviourally tested, and what remains is guarded structurally
  instead". The second clause was false. `tests/structure.test.js`'s two guards each justified
  themselves with a claim that the ordering *could not* be reached behaviourally — and moving
  `capBudgets` below `ledger.begin` turns `tests/failure-shape.test.js:224` red, which was already
  true before this change. The guards were asserting something the suite disproved.
  **The seam was also unnecessary.** OAI-25 proposed injecting a `now` parameter into the budget
  calculation and flagged that changing production code for testability deserved its own grill. It
  does not need one: `capBudgets` reads the bare global `performance.now()`, so replacing
  `globalThis.performance` in a test reaches it and **zero production bytes changed**.
  **What landed.** `tests/cap-ordering.test.js` drives the real `postWithDegrade` loop under a
  controlled clock, advancing it at named semantic boundaries rather than by counting clock reads:
  after `ledger.begin` for OAI-22's carried-budget rule (red if `postChat` recomputes the cap), and
  inside the handle's `refuse` for the OAI-23 window this repo's prose named but nothing drove — a
  capability refusal whose replacement the cap refuses, which must stay `failed`/`shape-rejected`
  with no phantom second entry. Both proved by mutation. Both guards kept, with their rationale
  rewritten to say what they actually do: localize the contract, not substitute for cover.
  **The class it produced, and its third instance.** A guard justified by "this cannot be tested"
  carries an untested claim, and it is self-protecting — a reviewer who reads it stops looking for
  the test. The feature reproduced the class *in its own fix* (a comment claiming "No mutation
  distinguishes the two placements", from one experiment) and review caught it; a third instance
  survives at `tests/structure.test.js:279,287` and is filed as **OAI-30**. Recorded in
  `.claude/REPO_TRAPS.md`. See [ADR 012](adr/012-surviving-the-server.md).

- **OAI-22** — Retry only what a retry can fix; check the cap once; warm the model that is about to
  run. Completed 2026-08-01. Three bounded fixes, and **the review refuted the premise of the first
  one**, which is the part worth keeping.
  **The transport split.** `transport` was one bucket and `isRetryable` said yes to all of it, so a
  TLS certificate rejection cost three requests and two 2-second sleeps to establish what the first
  proved. It is now `transport` (retryable: the post-headers cut, plus pre-response codes on a
  transient whitelist) and `non-retryable-transport` (everything else pre-response, including
  unknown and absent codes — the same whitelist direction `RETRYABLE` already took). Decided at the
  **call site** via a `delivered` flag, not by reading `error.code`: measured on Node 26.3 a
  mid-body cut arrives as a code-less-in-principle `Error: aborted`, so code-only classification
  would file the most retryable shape here as terminal on a version that omits it. The name
  `unreachable` was rejected — the pre-response path carries TLS, protocol and parser errors, all of
  which *reached* a peer. **The axis is retryability, never blame.**
  **What the review found, and what it cost the premise.** The backlog claimed an unresolvable
  hostname was retried three times. It was not: `provider.mjs` `describeFailure` rewrote
  `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN` into *fresh* errors carrying no `reason`, `code` or
  `cause`, so they arrived unclassified and unretried — verified end to end. The real defects were
  worse for OAI-19 than the claimed one: those attempts tallied as `unclassified` in the very
  `Failures by reason` table it reads, and `EAI_AGAIN`, which genuinely should retry, never did.
  Fixed by `reword()`, which carries the classification through the better message. Every earlier
  test passed because they called `transportError` directly, one layer below where the verdict was
  being discarded. **Methodology: a probe claim about what a value *reaches* must name the
  consumer, not the producer.**
  **One cap evaluation per dispatch**, carried into `postChat` instead of recomputed there — closing
  the last gap OAI-23 left, where a cap falling due between the two checks left a `refused` entry
  beside a phantom `failed` one. **Warm-ups interleave** on each change of resolved pair; grouping
  the corpus by pair was rejected because it reorders cases, and residency, prompt cache and thermal
  state are shared mutable state. That third fix is **latent for OAI-19**, which runs one arm per
  invocation with `--model` and so resolves to a single pair — the backlog paragraph claiming
  otherwise was wrong and is corrected. Also here: `chat.mjs` crossed its size budget a third time,
  so stream reading moved to `scripts/lib/stream-collect.mjs`. See
  [ADR 012](adr/012-surviving-the-server.md) and [ADR 006](adr/006-benchmarking-the-reviewer.md).

- **OAI-23** — Tie a `refused` reclassification to the replacement request actually being dispatched.
  Completed 2026-08-01. `refused` is the ledger's third outcome, meaning the server rejected the
  request's SHAPE and the plugin then sent a different one that worked — benign negotiation,
  excluded from the failure count. Both call sites *stated* it before the replacement went out, and
  the replacement could then never go out at all, so a run that died could read `0 failed,
  1 refused`: a terminal failure dressed as negotiation, understating exactly the reliability figure
  OAI-19 reads.
  The fix makes it structural rather than ordered. `refuse()` and `refuseLast()` now close the entry
  as the failure it is and *register* a pending reclassification; `attempt-ledger.mjs`'s `begin` is
  the only place `refused` is ever written, and it writes it as the first act after the replacement
  entry exists — no replacement, no reclassification. An abandoned refusal keeps a named terminal
  reason, **`shape-rejected`**, because a 400 carries `.status` and never `.reason` and the bench
  would otherwise tally it as `unclassified` beside genuinely unrecognised failures. A *flipped*
  entry keeps `reason: null`, deliberately, so it stays byte-identical to the records OAI-19 is
  differenced against. `attempt-ledger.mjs` crossed the file budget and split, with
  `attempt-outcome.mjs` taking what one request's ending means. See
  [ADR 012](adr/012-surviving-the-server.md).
  **The end-to-end deadline test the original entry asked for was not written, and that is a
  finding rather than an omission.** The transport arms the remaining wall-clock cap as its own
  deadline, so a request cannot *complete* after expiry — which leaves the window between a refusal
  and the next `capBudgets` only a few call frames wide. An e2e trying to land an expiry inside it
  would be a coin flip, and a flaky test is worse than none. What shipped instead: unit coverage on
  both call-site APIs with no following `begin()`, positive controls driving each call site's real
  sequence end to end, the existing oversize e2e extended to assert the reason, and — after the wide
  review proved by mutation that nothing pinned it — a **structural guard** that `capBudgets`
  precedes `ledger.begin` in `postWithDegrade`. Moving that call had left all 370 tests green while
  reopening the defect; the guard is now the only thing that catches it, and the class went into
  `.claude/REPO_TRAPS.md` as *an ordering that carries an invariant, pinned by nothing*.
  Two residues are recorded, not hidden. Ledger-entry creation is still not proof of *dispatch*,
  because `postChat` checks `capBudgets` a second time before `request()` sends — imprecise rather
  than false, since the run still reads as dead, and closed by **OAI-22**'s compute-the-budget-once
  fix, which is the only fix for it. And whether the structural guard should be a behavioural test
  behind an injected clock is **OAI-25**, raised in the terminal review pass.
  Review: three ladder passes, no stage skipped. Pass 1 accepted two findings, pass 2 three, pass 3
  terminal with two recorded. The wide stage died once at its scope agent and was resumed rather
  than read as clean.

- **OAI-20** — Survive the server: classify LM Studio's delivery failures and retry the attempt.
  Completed 2026-07-31. Four shapes now carry structured reason codes assigned where they are
  detected — `empty-completion`, `stream-unfinished`, `transport`, and a **fourth the item did not
  know about**: `applyText` sets `sawContent` for any string including `''`, so a reply of
  `content: ""` passed every guard and reached the caller looking successful, was reported as "the
  model did not return findings in the requested shape", and was filed by the bench as *unreadable*.
  A dead request recorded as a bad answer, which is the censored-denominator trap one layer below
  where this file already caught it. `answerWithRetry` retries only whitelisted shapes, spanning
  `postWithDegrade` **and** `finishAnswer` because the transport raises one shape and `finishAnswer`
  raises three. `--max-attempts` counts **answer attempts** (default 3) rather than physical
  requests — capping requests at 1 would have disabled capability degradation instead of retry — so
  `--max-attempts 1` reproduces the old behaviour exactly and is the control arm.
  `scripts/lib/attempt-ledger.mjs` records one entry per physical request, and the bench renders
  `## Physical-attempt reliability` beside the recall table with **both denominators stated
  together**. Three things review found rather than the plan specifying: an entry must settle only
  *after* `finishAnswer` judges it (`postChat` returns successfully for three of the four shapes, so
  closing at the transport would file dead requests as answered); a third outcome `refused` is
  needed or a server that refuses `stream_options` headlines a **50% failure rate while answering
  100% of shaped requests** — and it must be recorded by the layer that sends the replacement, never
  inferred from a status, because a context-limit rejection is also a 400; and `warmEligible` needs
  evidence of *model execution*, not prompt identity, or every degraded run's prefill is silently
  deleted from the benchmark's cold samples. **Not proven sufficient**: these are the shapes
  observed, and whether retry recovers the 37.5% is a measurement OAI-19 reads off the new record.
  Server state is not recorded — it is not observable from the client. See
  [ADR 012](adr/012-surviving-the-server.md).
- **OAI-21** — The bench keeps its own evidence and pays the model load itself. Completed
  2026-07-31, alongside OAI-20 as the item directed. The rendered report is written to `<stamp>.md`
  beside `<stamp>.json` under one stamp computed before rendering; `--warm-up` sends one unscored
  request per **distinct resolved provider/model pair**, carrying the invocation's budgets, and the
  record states that it ran. *(Those mechanics were superseded 2026-08-01 by **OAI-22**: warm-ups
  now fire on each **change** of resolved pair rather than once per distinct pair up front, because
  warming them all in advance let the last evict the first on a single-resident provider.)* Two things only running it revealed: the first version built the argv
  prompt-before-flags, which `/oai:task` refuses — and because warm-up records rather than throws,
  an arm would have carried on having warmed nothing (84ms against the expected ~11s was the only
  tell); and the outcome field is `answered`, not `ok`, because a reasoning model spends its budget
  thinking and exits non-zero on a request that loaded the weights perfectly well. See
  [ADR 012](adr/012-surviving-the-server.md).
- **OAI-16** — Say when the served model is not the requested one, and select the loaded one.
  Completed 2026-07-29. The probe made the first half considerably worse than the item described.
  **The item said a stale pin got substituted; the truth is that *any* wrong id does.** Reproduced
  live in a single call: `POST /v1/chat/completions` naming `totally-not-a-real-model` returned
  **HTTP 200 and a normal completion from `qwen/qwen3.6-27b`**, the model that happened to be loaded.
  Not a stale-config problem — a server that answers as something else whenever it is asked for
  anything it does not have. `jsonReport` already recorded the served id correctly and *nothing
  compared it to the id requested*, so the fact was recorded and never used: a benchmark arm could
  spend its whole wall clock on a model it did not claim to test and leave a clean-looking record.
  Now one predicate — `substitution()` in `scripts/lib/model-identity.mjs` — is the only comparison,
  used by the footer, the stderr warning and the bench alike. It is **exact, never `matchKey`**,
  because the second probe finding is that `@4bit` is a real identity: requesting
  `qwen/qwen3.6-27b@4bit` made LM Studio try to load a *different* model and fail on resources, so
  normalising the suffix would hide precisely the quantization swap that contaminates an A/B arm most
  quietly. It returns null when either id is missing — absent is "nothing was determined", never
  evidence of a swap.
  **Caught twice, and the second catch is the one the item asked for.** Before the run,
  `planSelection` refuses an id a recognised catalogue does not list, on both the `--model` and
  `defaultModel` paths, so a wrong id costs milliseconds rather than a full run. After it, the footer
  renders `model: <served> (requested <requested>)` — inside the `model:` field rather than on a line
  of its own, because that is the field a reader consults to learn which model produced the output —
  plus a stderr warning. A substitution **warns and never fails**: the work is already paid for, and
  ADR 008 records what discarding runs cost when it was tried.
  **The second half: refusing while holding the answer.** `planSelection` refused with "offers N
  models" while `readLmStudio` was already reading each model's `state` and using it only to gate a
  context window. It now selects the one the server reports `loaded` — a fact being read, not a
  guess, since ADR 002 already treats `loaded` as authoritative (it is why `loaded_context_length` is
  trusted and `max_context_length` is not), and the OAI-2b defect it warned against was taking the
  *first* entry, which is arbitrary. Two conditions gate it, both from the plan challenge: every
  candidate must carry a **recognised value** (`state: entry.state` creates the key even when
  undefined, so presence proves nothing, and partial coverage would draw a conclusion over a subset),
  and every record must have been **joined on an exact id** (the `matchKey` join is conservative for
  the embeddings denylist but would become a routing decision here). "None loaded" and "several
  loaded" each get their own message; nothing measured says a server holds only one model resident,
  so the code does not depend on it.
  **The reviews changed the shape of this twice, and both are worth recording.** The first version
  left the up-front refusal *opportunistic* — `resolveTarget` probed only for what the config left
  unanswered, so a profile setting both `defaultModel` and `contextLength` never fetched a catalogue
  and never got the check. That shipped documented and tested as a deliberate compromise, and the
  built-in review showed the framing was hiding a defect: `/oai:setup` probes **unconditionally**, so
  it *did* refuse, printing `No provider can take a task right now` about a task that ran fine.
  That is this repo's signature class with its sign flipped, and it defeats the cure ADR 002
  prescribes for it — **one authority is not enough when its two callers feed it different
  evidence.** `resolveTarget` now always fetches the list, superseding an ADR 002 consequence; the
  cost is a `/v1/models` GET on a path that was about to post a whole prompt anyway, and the
  recommended config (no `contextLength`) was already paying it.
  Second: membership is tested against the **union** of `/v1/models` and the dialect's own catalogue.
  Keying it on `/v1/models` alone refused a model the dialect reported `loaded` — the one the server
  had resident — whenever that list was narrower. The adversarial review raised this at 0.98
  confidence, **it was dismissed**, and the lean review then reproduced it end to end. The refusal is
  also gated on the dialect having published a per-model catalogue rather than merely being
  recognised: llama.cpp and TGI are recognised, publish no list, and ignore the requested name, so
  the stricter gate would have broken a working setup.
  Benchmark side: a substituted run is recorded **failed** with reason `model-substituted`, rendered
  as `(N substituted)` inside the failed cell and in its own report section — not under "Runs that
  did not complete", because it did complete. Deliberately a different call from a truncated run,
  which ADR 008 scores: a cut run is this model measured incompletely, while this is a *different*
  model measured correctly, so the number is not uncertain but mislabelled. Two latent defects fell
  out of that: the timing, throughput and prompt-size samples gated on a report alone and would have
  contributed wrong-model figures to a row that disowned the run, and the `scored` bucket was the one
  of four with no `!run.error` guard — held together only by `run.mjs` declining to attach a score,
  the exact cross-file fragility `unreadableRuns` documents about itself.
  Leaves for **OAI-11**: which model answered is now per-run evidence rather than a config
  assumption, which is what cross-model passes need.
  See [ADR 011](adr/011-which-model-actually-answered.md).

- **OAI-17** — Bound a run in wall clock, and report what it generated per second. Completed
  2026-07-29. Three gaps, and the probe reshaped two of them.
  **Nothing bounded a run that was working, and the item did not know that.** It asked for a bench
  `--timeout`, but `--timeout` names the wait for the *first* token only: once text arrives that
  budget is retired and the idle budget takes over, resetting on every text-bearing frame. Confirmed
  against the code by an independent read — *"there is no absolute total deadline for the streamed
  response"*. With ADR 009's own figures (generation spanning 165–747s on one case), a six-case
  corpus at N=3 had no worst case at all, which is the thing that actually blocks OAI-11. So the
  feature added `--max-seconds` as well as forwarding `--timeout`: a wall-clock cap on the model
  call, opt-in with no default, arming the transport's `deadline` budget from **one expiry minted per
  command and shared by every retry**. That last part was a plan-challenge correction, and the reason
  matters: the first draft armed a fresh cap per attempt, so three attempts under `--max-seconds 600`
  could have run 1,800s with each honouring its cap — and its defence, that refused capabilities cost
  nothing, is a claim ADR 009 had *already recorded as unverified*.
  **A timeout was indistinguishable from a model failure in the record.** The reason was structured
  internally all along (`error.reason`) and thrown away at the exit, which left `bench/run.mjs` a
  prose blob to pattern-match — the class this repo files as OAI-13 items 1 and 2. Now `--json` is
  machine-readable on **both** paths: a failed run prints `{error, reason, message, hint}` to stdout
  and still exits 1 with the same prose on stderr, and the bench records `reason` beside the stderr
  it already kept. The envelope covers everything after argument parsing, guards and internal crashes
  included; the single stated exception is a malformed command line, because parsing is what
  establishes `--json` was passed at all.
  **Nothing reported a rate.** `tokensPerSecond` divides the reply's `completion_tokens` by
  `generationMs` — never `durationMs`, which would fold a 421s prefill into the divisor and read ~7×
  low — and appears in the `/oai:review` footer and a `gen tok/s` benchmark column, per run and
  ranged, never `sum(tokens)/sum(ms)`. The figure is named for what it is: **provider-reported
  completion tokens per measured generation second**. An earlier draft called it "thinking included",
  which the plan challenge refused as a vendor convention this repo cannot confirm.
  **The item's motivating number was stale and is not repeated.** It said runs "died on the 300s
  client timeout"; that is the pre-ADR-007 undici cap, and the default first-token budget has been
  600s since. The gap was real, the figure was not current.
  Three defects were caught in this feature's own code before it shipped, all by the delta
  re-challenge: `serverResponded` captured at arm time (always false) rather than read in the timer
  callback; a live cap reporting its *remaining* time as the configured number; and a tie-break that
  relied on `setTimeout`'s FIFO ordering, which Node documents as approximate. The last is now
  suppression rather than a race, with all four cases of the truth table pinned — including a cap
  *longer* than the first-byte budget, the only one that proves the rule is a rule.
  **Live, and quoted here because `bench/results/` is gitignored.** `config-origin --runs 2` on the
  dense 27B rendered `prompt tokens 1575 | prefill s 1–3 | generate s 81–265 | gen tok/s 14.5–16.6`.
  That row is the argument for the column: generation spread **3.3×** on an identical prompt while
  the rate spread **1.15×**, so the model was not varying in speed, it was varying in how much it
  chose to say — and `81–265` alone reads as the opposite. The same case under `--max-seconds 20`
  produced `failed: 1 (1 timed out)` with `reason: "deadline-timeout"` in the record, cut after
  82,775 characters, and the hint that rendered was the mid-generation one rather than the
  nothing-arrived one — the conditional a Codex finding added.
  **Six defects in this feature's own code were caught before it shipped, none of them by the tests**
  — a per-attempt cap, a flag captured at arm time instead of read at fire time (twice, the second
  by copying the first fix's shape without its wrapper), a cap reporting its remaining time as the
  configured one, a FIFO-dependent tie-break, a cap above ~24.8 days that would have fired
  immediately, and a hint claiming the model was generating on the strength of raw SSE bytes. That
  last one is the instructive one: the branch existed only because an earlier reviewer objected to a
  hint claiming more than was known, so a fix for one false assertion introduced another from a
  worse signal. Three of four review finders converged on it independently.
  296 tests green (275 at the start). See [ADR 010](adr/010-bounding-and-rating-a-run.md).

- **OAI-18** — Measure prefill and generation separately, and pin the corpus commit. Completed
  2026-07-29. The bench reported one wall-clock number per run and ranged it across `--runs 3`; that
  number is two quantities added together, and a server-side prompt cache moves one by ~37× and
  leaves the other alone. Measured on one 56,805-token prompt, three consecutive requests: first
  token at **421,660 ms cold and 11,457 / 10,257 ms warm**, generating ~3 s in all three. So a
  `seconds` cell reading `13–425` was one cold run and two cache hits, printed as a spread in the
  reviewer. `chat.mjs` now stamps the first frame carrying text and the end of the stream, and
  `prefillMs`/`generationMs` reach `--json`, the text footer and two benchmark columns that replace
  `seconds`. Live, after the change: `model-info` at 41,010 prompt tokens over two runs reported
  **prefill 7–289s and generation 398–726s** — a 39× spread the report computed itself, beside a 1.8×
  spread that has nothing to do with the cache. Welded together, that row read `687–1015` and looked
  like ordinary variance.
  **The claim that generation is comparable is false and was written twice before it was caught.**
  The adversarial review refuted the first version; the first live run to print the second version
  disproved it in its own row (`config-origin`: prefill 1–10s, generation 165–747s). The cache not
  touching generation and generation being comparable are different claims — the tidy contrast keeps
  inviting the second. The note now states only the ratio it counted, and the tokens-per-second
  quotient that would make generation comparable is OAI-17's.
  `--cold` verified live on `config-origin --runs 3`: prefill `10–10s` against `1–10s` without it —
  three independent cold samples instead of one cold and two hits — and the report swaps the cache
  caveat for a statement that the flag was on.
  **The `prompt tokens` column was the same defect, one column to the left.** It summed
  `usage.prompt_tokens` across runs, which is invisible at N=1 (every figure in ADR 006 came from an
  N=1 sweep) and wrong by a factor of `runs` after that: it printed 82,020 for a case ADR 006 records
  at 41,016. Caught by checking why two live runs disagreed on a figure that is a property of the
  input, *after* every review stage had passed over the diff. Now per-run, ranged when the runs
  genuinely differ, with the ADR's own pasted table corrected.
  **The item proposed two options and the probe killed one of them.** "Accept warm runs and report
  cold and warm separately" has nothing to label from: LM Studio publishes no `cached_tokens` and an
  empty `stats`, and position is not evidence — a *first* call in a fresh process came back warm at
  956 ms because an earlier process had prefilled the same prefix. So the cache is measured, not
  classified, and `--cold` (via a new `/oai:review --cache-buster`) buys independent runs when they
  are wanted. Busting always was rejected on cost and fidelity: three cold runs of that case cost
  ~21 min of prefill against ~7.5, and real `/oai:review` usage is warm.
  **Generation is measured, not derived, and that came from the plan challenge.** The draft computed
  it as `durationMs - prefillMs`, which is not generation — `durationMs` starts before prompt
  building and any rejected `response_format` attempt, so a schema rejection alone would have shown
  as seconds of "generation" for a reply that generated instantly.
  **A Codex probe check also refuted the claim that the bench sends the same bytes twice**, which
  nothing had noticed: `materialize()` builds a fresh repo per run and `--commit HEAD` sends
  `git show HEAD`, so the commit sha and date differed whenever two runs fell in different clock
  seconds. Inside one second they agree — which is what a test reproduces — and minutes apart they do
  not, which is what a real run reproduces. Now pinned. Note the consequence: this removes an
  accidental cache bust that applied to `--diff-only` alone, so **that arm's timings from before this
  change are not comparable with figures after it.**
  See [ADR 009](adr/009-measuring-prefill-and-generation.md).

- **OAI-15** — Size the reply from the budget the run actually has, and stop discarding the runs the
  cap censors. Completed 2026-07-28. The `analysis` ceiling was a flat 28,000 characters while the
  budget paying for it shrank per run, so the two agreed only by coincidence — and on the largest
  input they did not: `scaffold` sent `max_tokens: 11,043` against a schema envelope of ~15,695
  tokens. `scripts/lib/review-schema.mjs` now derives the cap from the reserve granted
  (`reviewSchemaFor`), clamped between a floor and a **wall-clock** ceiling of 74,000 characters
  (~28 min of generation on a dense 27B; verified that LM Studio compiles a grammar that large before
  relying on it). `REVIEW_MAX_TOKENS` rose 16,384 → 32,768 where the window is known, reversing
  ADR 004's refusal on the evidence that made it — **the cost it feared no longer existed**, because
  the `minReserve` shrink recorded in that same ADR means a review is refused only when under 4,096
  tokens remain, whatever the constant says. BACKLOG's "the tension is real and is the whole
  decision" was describing pre-`minReserve` behaviour.
  **The reserve was never the constraint — the accounting was.** On five of six cases the reserve was
  ~55,700 characters while `analysis` got 28,000, because ~24,500 was held back for a 20-finding
  reply. Six is the most any reply has ever carried, so the budget now reserves for eight; the schema
  still permits twenty and the rare overrun fails loudly. **That eight is a policy bet, not a
  measurement** — every observation behind it was taken under the old cap, and more room may itself
  produce more findings.
  **The half that changed most is what a censored run is worth, and it came from the plan challenge
  rather than the code.** Both obvious readings are wrong: discarding cut runs threw away 17 of 41
  recorded runs carrying two of the four anchored matches ever produced, while folding them in counts
  every finding the run never reached as a confirmed miss. A truncated run's positives are
  trustworthy and its absences are unknown, so `defects found` now reports **only what was observed**
  and a new `unresolved` column says how much of the denominator is uninterpretable, with the upper
  bound stated in prose. A low–high band was built first and removed by the adversarial review: an
  unobserved figure printed under a heading that says "found" made a wholly censored run
  indistinguishable from a perfect one. Rows with nothing cut are unchanged, so past figures stay
  comparable.
  **Measured after the change** (3 runs, `config-origin`, dense 27B, derived cap 74,000): analysis
  lengths **7,075 / 19,942 / 21,240, cut 0 of 3** where that case cut 6 of 9 before — and the right
  edge of the distribution is observable for the first time, since every value at the old 28,000 was
  previously indistinguishable from one that would have run to 90,000. The longest run stopped
  *below* the old ceiling, which contradicts ADR 004's "the model fills whatever it is given" for
  this model and case. Read no further than that: one case, one model, N=3; `structured` (4 of 4 cut)
  and `scaffold` (4 of 11) have not been re-run; **all three runs found nothing**, so this buys
  measurement, not review quality; and it costs wall clock (129–363s against 49–156s).
  Nothing claims the reply fits its budget: `RESERVED_CHARS` is documented as an estimate
  (`maxLength` caps decoded strings, not serialized JSON; `line` has unbounded width;
  `CHARS_PER_TOKEN` was calibrated on input code), and the tests assert the formula rather than a
  guarantee. See [ADR 008](adr/008-sizing-the-review-reply.md).

- **OAI-6 + OAI-17a + OAI-8** — Streaming, and owning the timeouts it exposes. Completed 2026-07-28.
  `timeoutSeconds` never worked above five minutes: Node's `fetch` is undici, undici applies its own
  300s `headersTimeout`, and an `AbortSignal` beside it can only *lower* the bound — so the real
  limit was always `min(timeoutMs, 300_000)` and **14 of 18 benchmark runs died** with 1800 in the
  config. `scripts/lib/http.mjs` now owns the request on `node:http`, streaming chat completions as
  SSE. **The obvious fix was not enough, and finding that out is the result worth keeping**: streaming
  moves the wall from `headersTimeout` to `bodyTimeout` rather than removing it, because prefill emits
  no body — a cache-busted 52k-token prompt took **393.7s to its first token** (9.3s warm). OAI-17a's
  own text claimed streaming would settle it; that claim was written before it was measured.
  **The budgets bound tokens, not bytes**, which is the correction the plan challenge forced: an SSE
  keepalive comment, a role-only delta and a half-delivered frame are all socket activity proving
  nothing about generation, so a byte-driven budget would have let `:\n\n` every 30s run forever while
  reporting itself armed — the defect class the feature exists to remove, reintroduced by its own fix.
  The transport bounds `firstByteMs` plus an optional absolute `totalMs`; the first-token and idle
  budgets live in `client.mjs` and reset only on a parsed delta carrying a string. `totalMs` is what
  keeps `/oai:setup` safe, since its probes are bounded totals today and it awaits every provider.
  Chosen over a working `Symbol.for('undici.globalDispatcher.1')` wrapper **on failure mode, not size**:
  the symbol is not public API and a future Node moving it would disarm the override silently.
  **OAI-8 closes because the heartbeat is timer-driven**, not delta-driven — a delta-driven tick is
  silent through exactly the prefill it was asked to cover, and closing the item on that would have
  been the reported-state-vs-actual class one level up.
  **Accepted on the benchmark, not on a demo.** `scaffold` — 47,069 prompt tokens, one of the 14 that
  died — now completes in **959 seconds** with `failed: 0`, and a live `/oai:task` over a 42,043-token
  cold prompt ran **444s** (≈295s of it silent prefill) where the old code died at 300s. What that does
  **not** buy is a score: the same run came back `cut: 1`, so 0 of 3 listed defects were scoreable. The
  dense-27B arm is unblocked and still unanswerable until OAI-15 sizes the `analysis` ceiling.
  Guarded by a new structural test — **nothing calls the global `fetch`** — with no exemptions, because
  the defect was an invisible default rather than a typo. Four defects were caught before commit that
  the suite would not have found: a `'data'` listener racing the consumer, a first-byte timer re-armed
  at headers (silently doubling the advertised budget), `idleSeconds` validated but dropped by
  `buildProfile` so it did nothing, and — found by the design review — **every existing test replying
  `application/json`, so all 198 would have taken the degrade path and reported a green suite with no
  streaming coverage at all.** Design in [ADR 007](adr/007-owning-the-transport.md).

- **OAI-12** — A labelled corpus and a benchmark harness. Completed 2026-07-28. `npm run bench` runs
  the shipped `/oai:review` against six committed snapshots of this repo's own history and scores the
  findings; `--runs N`, `--case <id>`, `--diff-only`. **It drives the real CLI through a new
  `/oai:review --json`, never a copy of the pipeline** — a bench that scored a reimplementation and
  reported it as the reviewer's score would be this repo's signature defect at the meta level, and
  `structured` (64,357 tokens against a 54,016 threshold) makes it concrete by falling to ADR 005's
  second rung where the others do not. **Baseline: 1 of 6 scoreable defects at N=1, 10.9 minutes** —
  11 catalogued, 5 unscored because their runs were cut. Two findings outweigh that number.
  Its first reading claimed context dilution was measured; **a three-arm run the next day retracted
  that** — the pair behind it varied mode and prompt shape alongside token count, and at N=3 the same
  case at half the tokens found nothing at all. The instrument refuting its own first headline inside
  a day is the item working as intended. What survived and grew: **the `analysis` cap bound on 2 of 6
  runs here and on 6 of 15 runs recorded overall**, both reporting nothing, wasting a third of the run
  and 45% of the corpus's defects with it — and it binds on the *smallest* input, not the largest.
  **The corpus is smaller than history claims, on purpose.** A defect is listed only if it can be
  pointed at in the snapshot; 8 further claims are recorded as dropped with reasons. Applying that
  rule caught **two of my own attributions being wrong** — a defect assigned to `65373a0`, which does
  not touch `config.mjs` at all, and one assigned to `8990173`, where the code did not yet exist —
  both of which would have scored the reviewer for missing code it was never shown.
  **The scorer was validated against hand verdicts before any number shipped** (3 adjudications, 3
  agreements), and immediately justified its design: the model placed the run's only true positive at
  line 83 when the defect is at line 90, so the cheaper file-plus-line-proximity scorer would have
  reported 0/11. **Two guards were earned from defects the corpus itself caused**: `node --test` with
  no path discovered the corpus's historical tests and ran them against today's tree, and a new
  flag-documentation check found `/oai:task` had been accepting `--system` undocumented.
  **The lean review then found six more defects, three of them the signature class** — including one
  in `review-report.mjs`, the module written specifically to stop a caveat being true on one path and
  absent on the next (instance 16). One of the six is why the baseline reads 1 of 6 and not 1 of 11:
  cut runs were entering the recall denominator as zeroes while this ADR claimed they were counted
  separately. Design in `adr/006-benchmarking-the-reviewer.md`.

- **OAI-14** — Review whole changed files, not bare diff hunks. Completed 2026-07-27. Each changed
  file is now sent whole alongside the diff, taken from the revision the diff describes (`git show
  <ref>:<path>` for `--commit`, the index blob for `--staged`), with `--diff-only` restoring the old
  behaviour. **The target class is gone: the "`positiveInteger` is not defined" false positive ran
  3-of-3 before and 0-of-3 after.** Honest scoring is 1 false positive → 0 with true positives
  unchanged at 0 — `1ea398f` is the commit that *fixed* the OAI-2 findings, so it is near-clean and
  the baseline's only output was the false positive. **This bought precision and says nothing about
  recall.** The diff-only arm stopped producing it too, via the new hunks-only prompt sentence, so
  the six runs do not isolate which mechanism does the work.
  **Shipped as a two-rung ladder, not the per-file shed the plan had.** The reserve arithmetic
  collapses to `fit ⟺ estimate ≤ contextLength − minReserve`, so the real threshold is 54,016 and
  the largest measured commit is 41,790 — shedding never triggers on observed data, and ordered
  largest-first it would have dropped `model-info.mjs`, the very file whose missing definition caused
  the false positive. Untracked and `--file` blocks are pinned and never dropped, so an empty review
  is impossible by construction. Cost: 2.5× the input, 4–10× the wall clock, and the `analysis` cap
  now binds in 2 runs of 3 — which makes OAI-8 more necessary, not less. A root-commit bug
  (`git diff-tree` lists nothing without `--root` where `git show` prints a diff) was caught by a
  test and is now a repo trap. **Four claims-vs-reality defects were caught before commit, none by
  the test suite**: the root commit, a subdirectory cwd reading nothing and reporting a normal run,
  a blanket "you have only hunks" asserted while whole files sat in the same request, and — found by
  the lean review, after I had already "fixed" the git-edges class and written the merge case off as
  safe from one trivial example — merges silently losing their bodies, plus an unreadable file
  vanishing with the prompt still vouching for it. Design in `adr/005-whole-files-for-review.md`.

- **OAI-10** — Bound the review reply so a runaway cannot eat a whole pass. Completed 2026-07-27.
  Every string and array in `REVIEW_SCHEMA` now carries a grammar-enforced ceiling, sized above every
  observed successful run; hitting the findings cap is reported rather than silently binning a
  defect. **Shipped as half the item it was written as.** "Raise the ceiling" was dropped on
  evidence: the failing run generated all 16,384 tokens it was allowed against 5,450 / 2,521 / 2,301
  for the runs that finished, so more room only buys a longer runaway. The prompt-side cap was
  dropped too — probing showed the reduction it appeared to give came from *steering the model to
  reason less*, which is an unmeasured recall trade and now an OAI-12 experiment. Probing also found
  that `maxItems` on a reasoning field with no floor collapses it to `[]` in six tokens, now a repo
  trap. **Both first-guess cap values were wrong and live verification caught them** — `evidence` cut
  a real finding, `analysis` cut mid-sentence and the run then reported none. Honest scope: a
  runaway now fails cheaply and parseably in ~70s rather than dead-ending on a truncation error, but
  the cut is not a rescue and this does not move the hit rate. Design in
  `adr/004-bounding-the-review-reply.md`.

- **OAI-4** — `/oai:review`: a local second opinion on the diff. Completed 2026-07-27, pulled ahead
  of OAI-3 so it could be used while building the rest. Strict `json_schema` findings read from
  whichever channel carries them, degrading to prompt-and-parse when a server refuses the schema;
  the target is collected in Node and includes untracked files. Fixed a shipped defect on the way:
  an empty answer was reported as success. Live-verified against LM Studio — five findings on a real
  commit in 32s, a 74.5k-token input refused before sending, and a false positive correctly refuted
  rather than fixed. Design in `adr/003-structured-findings.md`.

- **OAI-2 + OAI-2b** — Context-window auto-detection and embedder exclusion. Completed 2026-07-27.
  Probes by response shape across LM Studio, vLLM, llama.cpp, TGI and (unverified) oMLX, trusting only
  served windows over model ceilings; automatic model selection drops embedders and refuses to guess
  between several candidates. Live-verified against LM Studio with all hand-set config removed:
  detected 58.1k with attribution, picked the chat model over the embedder, and still refused a
  65.4k-token input. Design in `adr/002-context-window-detection.md`.

- **OAI-1** — Plugin skeleton + `/oai:setup` + synchronous `/oai:task`. Completed 2026-07-27.
  Live-verified against LM Studio serving `qwen3.6-35b-a3b-ud-mlx` (58k loaded window): `/oai:setup`
  listed the provider and model, `/oai:task` returned real model output through a `--plugin-dir`
  load, the context guard refused a 65.4k-token input before sending, and a 22.5k-token whole-repo
  summarization ran in 62s. Reviewed by advisor, the lean workflow, and a high-effort `/code-review`
  (15 findings total, all fixed). Design in `adr/001-generic-openai-compatible-plugin.md`.
