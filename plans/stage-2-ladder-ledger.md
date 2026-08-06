# Stage 2 review ladder — pass 1 disposition ledger
Frozen: 5a010e2..HEAD (8dfd85e). security-review: EVALUATED, NOT TRIGGERED.

## Accepted (fix in boundary batch)
L1  acceptance-audit  Context manifests never built AND never deferred. Fix: record honestly (log + backlog); do not build.
L2  acceptance-audit  saveArtifact unreachable; artifact PERSISTENCE never built. Fix: delete dead code, record unbuilt. (Advisor: do NOT wire a flag — a caller-supplied write path would newly fire security-review mid-ladder.)
L3  acceptance-audit  No estimate on the --background path, which is the path "before submission" most names. Fix: emit in task-submit.
L4  audit+advisor+codex-adv+codex-plain(P1)  ROOT: a run-scoped fact computed at RENDER scope. artifactVerdict runs inside report(), so /oai:result structurally cannot carry it, while PATCH_DISCIPLINE claims "whether it APPLIES is checked and reported above" — false there. Fix chosen: (b) refuse --template patch --background + conditional wording; file (a) move the check into executeTask+worker. Codex: "do not ship (c) alone".
L5  audit C4 + advisor  modelReported persisted but never adjudicated; bench report has no model column, so a substitution is invisible in the summary. Fix: surface in renderReport.
L6  advisor  ADR 017 cites a "first measurement" whose evidence is gitignored (bench/results/). Fix: soften the claim or commit the record.
L7  audit C2  bench/task-run.mjs main() untested. Fix: low priority, add or state.
L8  codex-adv  checkDiff has no unavailable/error state — a missing git or non-repo cwd reports "does NOT apply", which is a lie. Fix: add the state.
L9  codex-adv  cmd-result.mjs redefines a valid answer instead of sharing requireAnswer. PRE-EXISTING (file not in this diff). Fix: file.
L10 codex-plain P2  argv.includes('--json') misses the BLOB form — the form the slash command actually sends — so pre-request failures stay prose. Also treats --json after -- as intent. VERIFIED. Fix: derive intent with the parser's tokenization.
L11 codex-plain P2  --runs 0 / nope / negative persists an all-zero report with zero failures; unknown --arm sends undefined prompt. Fix: validate.
L12 codex-plain P2  --case good --case typo silently drops the typo; the empty guard does not fire, so the record claims it honored the request. Fix: reject unknown ids.
L13 codex-plain P2  Rate keys validated with Number.isInteger min 1, so 0.8 tok/s is refused though estimateRun accepts any finite positive. Fix: positive-number validation for rates.
L14 codex-plain P2  Trailing-newline phantom: split('\n') makes every newline-terminated file one line too long; :2-2 on a 1-line file is ACCEPTED with empty content. VERIFIED. Fix: drop the terminal sentinel only.

## Dismissed
L15 audit C1  requestArgs truthiness drops an explicit 0 for --max-seconds/--max-attempts. Dismissed: config/flag validation forbids 0 for both, so the value is unreachable.

## Added by lean-wide (pass 1)
L16 lean-wide  SEVERE. The slice NOTE is placed between the file blocks and the prompt, so requestTextOf returns "NOTE: ...\n\n<prompt>" and job-render.mjs:47 (`.split('\n')[0]`) shows the boilerplate warning instead of the request — for EVERY backgrounded sliced job, unrecoverably, since messages are frozen at submission. My guard test asserts `.pop()` (last line) while the consumer reads `[0]` (first), so it passes on the broken behaviour it names. Fix: put the note BEFORE the blocks, and re-point the test at the real consumer (excerptOf), not at requestTextOf.
L17 lean-wide  NO_RATE_NOTE is exported and documented as "so every caller says it the same way" — and no caller reads it. Second dead export in this diff (cf. L2 saveArtifact). Fix: use it or delete it.
L18 lean-wide  Contradiction markers match as bare substrings with no negation scope, so a correct hedged answer containing the phrase scores `contradicted` — ranked BELOW a miss. Fix: bound the match, or require it outside a negation.
L19 lean-wide (PLAUSIBLE)  The leakage guard checks claim.any but never claim.contradictions, so a prompt could bait an echo that scores as a genuine contradiction. Fix: scan both.
(L13 and L14 independently re-confirmed by lean-wide as findings 2 and 4.)

# PASS 2 (frozen 80f6bea). security-review: re-evaluated, still NOT triggered.
P1 acceptance-audit  SEVERE, and it is pass 1's own repair: jsonIntent(["--file x --json"]) === false. My hand-rolled tokenizer bails at the first non-flag token, but splitBlob KNOWS which flags take values. So `--file <path> --json` — the most natural harness call — still escapes the envelope. The L10 fix does not fix L10. Fix: call splitBlob with TASK_SPEC instead of re-implementing it.
P2 acceptance-audit  NON_DURATION_KEYS now carries two members the RATE_KEYS branch `continue`s past, so they can never reach the check that set exists for. Redundant, harmless. Fix: drop them from the set.
P3 acceptance-audit  task-report.mjs:70-72 still documents the artifact enum as applies|rejected|absent — the same commit added `unavailable`. Stale comment describing a state set that is no longer the state set.
P4 acceptance-audit  bounded() is O(n^2) on adversarial input (measured 3.7x per doubling): a failed boundary check restarts indexOf at at+1 instead of skipping the match. Bench input is model output, i.e. untrusted length.
P5 acceptance-audit  An EMPTY file reports of:1 against wc -l 0. Pre-existing shape, not introduced by the trailing-newline fix, but the slice header would advertise a line that is not there.
P6 acceptance-audit  tests/file-slices.test.js now pulls node:sqlite transitively (job-render -> job-store) for a test about prompt formatting — and OAI-61 is precisely that static-import chain. Fix: import excerptOf without the store, or accept and note.
P7 acceptance-audit  validateConfig grew to 57 of 60 lines from the RATE_KEYS branch. Not a defect; one more branch trips the ratchet.

## Pass 1 lifecycle (recorded per the state machine)
L1-L19 all landed in the pass-1 boundary batch, which ended GREEN (621/621), so every accepted entry
moved `open` -> `pending verification`. None reached `verified`: promotion is evaluated after a whole
pass completes, and pass 2 is that pass.
**L10 returns to `open`** — P1 is an adjudicated, accepted RECURRENCE of its identity (the JSON-intent
decision disagreeing with the parser). A textual reappearance would not do this; a verified-wrong fix does.
L9 (cmd-result redefines a valid answer) stays `dismissed because pre-existing, filed`.
L15 stays `dismissed because unreachable`.

## P1 fix design (verified before writing, not after)
`splitBlob` is TOLERANT — it does not throw on an unknown flag, which is why the original pre-parse
existed at all — and it already resolves `--file x --json` to tokens containing `--json`. So the fix
is to tokenize with it and then walk with the spec's own value-flag set:
  tokens = argv.length === 1 ? splitBlob(argv[0], TASK_SPEC).tokens : argv
  walk: `--` -> false, `--json` -> true, non-flag -> false, and SKIP the next token when the flag takes a value.
Must also handle `--flag=value`. The test must include the BLOB form `['--file x --json']`, the exact
case that escaped both the fix and its test.

## Pass 2 dispositions
P1 accept (fix above). P2 accept (trivial). P3 accept (stale comment). P4 accept (bound the scan).
P5 FILE, not fix — pre-existing empty-file shape, outside the frozen diff; fixing it widens the diff
and would re-arm M1 for no gain this pass.
P6 FILE — pre-existing static-import chain, already tracked as OAI-61.
P7 no action; recorded as headroom.
P8  codex-adv HIGH  checkDiff decides `unavailable` by matching stderr for "not a git repository" — fragile and locale-dependent. Fix: preflight `git rev-parse --is-inside-work-tree` and treat preflight/tool failure as unavailable BEFORE running apply.
P9  codex-adv HIGH  bounded() makes an accidental contradiction rarer without capturing POLARITY: a negation ("does NOT have a prototype problem") or a quoted restatement of the question still scores `contradicted`, which ranks below a miss. Fix: reject markers inside a negation window or a quotation, and add those exact regressions.
P10 codex-adv HIGH  `--arm neutral --arm neutral` has length 2, so `arms.length < ARMS.length` is FALSE and the sweep never prints INCOMPLETE while running a single arm — the completeness guard defeated by duplication. Fix: canonicalise through a Set and compare set equality with ARMS, never array length.
P11 codex-adv MED   Moving the slice note before the blocks decoupled it from what it describes: a long whole file after the note leaves the warning far from the slice it warns about. Codex's alternative is the one this repo already used for template skeletons — put it in the SYSTEM message, where it cannot reach the status excerpt at all.
P12 codex-adv LOW   `content === ''` should be zero lines and reject any positive slice start (same family as P5).
P13 codex-plain P1  jsonIntent fails on the ARRAY form too — ['--file','a.js','--json'] returns false, not only the blob form. My ledger entry P1 understated it: the fix is broken in BOTH forms.
P14 codex-plain P2  REGRESSION FROM MY OWN PASS-1 FIX. Adding unknown-`--case` validation, I deleted the `selected.length === 0` guard, so an EMPTY corpus now persists a successful report with zero rows — a no-evidence result reported as clean, which is the `[].every()` shape this repo names. Fix: keep BOTH checks; they answer different questions.
P15 lean-wide SEVERE  My pass-1 fix for L4 (refuse --template patch --background) makes the patch template UNREACHABLE through agents/oai-delegate.md, whose only invocation is `task --background`. A documented capability became dead code the moment the fix landed — and tests/delegate-template.test.js ENFORCES it, because it requires the recipe's arms to equal Object.keys(TEMPLATES), which still contains `patch`. No test covers the refusal at all, which is how this shipped. Fix: implement L4 option (a) — compute the artifact verdict in executeTask AND the worker so it flows through the outcome — and drop the refusal. The cheap alternative (drop `patch` from the delegate) removes the capability rather than restoring it.
P16 lean-wide  The `unavailable` branch I added in pass 1 NEVER FIRES: `git apply --check -` does not require being inside a repository, and does not emit "not a git repository", so the string match is unreachable and a non-repo cwd still scores as an ordinary applies/rejected. Third dead-code instance in this work (cf. saveArtifact, NO_RATE_NOTE). Fix: preflight `git rev-parse --is-inside-work-tree` as P8 says, and TEST the branch — a state nothing can reach is worse than no state.
P17 advisor-closer  Four dead-code instances is a class, so a structural guard was ATTEMPTED and
FAILED: "every scripts/lib export has a non-test consumer" yields 38 hits, mostly false, because this
repo has deliberate test-only exports that say so in their own docstrings. Narrowing to "no consumer
at all" catches 1 of 4. Recorded as REPO_TRAPS 17 with the negative result and a review question
instead of shipping a guard that cries wolf. Deleting the attempted test is the fix.

## Pass 2 boundary batch — applied, green (623/623)
Applied: P1/P13 (splitBlob tokenization), P2, P3, P4+P9 (bounded: linear scan, negation window,
quotation), P8+P16 (git preflight, and the branch is now REACHABLE and tested), P10 (arms by set
equality), P14 (empty-corpus guard restored beside the id check), P15 (the real fix — the verdict is
computed in executeTask AND the worker, flows through the outcome, /oai:result renders it, and the
refusal is GONE so the delegate's patch path works again).
FILED not fixed: P5, P6, P11, P12. P7 no action. P17 recorded as REPO_TRAPS 17 (negative result).
**The batch WIDENS the frozen diff** — cmd-task-worker.mjs and cmd-result.mjs are now in scope, which
pass 1 and 2 did not review. Pass 3 reviews a materially different artifact; do not treat pass 2's
coverage as carrying over to those files.
Mutation re-armed: the new artifact guard catches a render-scope regression (both new tests fail on
the mutation, restored clean). M1 not re-run — nothing in this batch touched prompt.mjs.
My negation fix committed the defect it fixes ('known'.includes('no')) and an EXISTING test caught it.
