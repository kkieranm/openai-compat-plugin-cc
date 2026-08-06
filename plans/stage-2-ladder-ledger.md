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
